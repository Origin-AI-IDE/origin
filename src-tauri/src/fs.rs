fn normalize_path(path: &std::path::Path) -> std::path::PathBuf {
    let mut out = std::path::PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir    => {}
            std::path::Component::ParentDir => { out.pop(); }
            c                               => out.push(c),
        }
    }
    out
}

fn assert_in_workspace(path: &str, workspace_root: &str) -> Result<std::path::PathBuf, String> {
    let root = std::path::Path::new(workspace_root)
        .canonicalize()
        .map_err(|e| format!("invalid workspace root: {e}"))?;
    let path_ref = std::path::Path::new(path);
    let candidate = if path_ref.is_absolute() {
        path_ref.to_path_buf()
    } else {
        root.join(path_ref)
    };
    let normalized = normalize_path(&candidate);

    // Resolve the nearest existing ancestor so links are checked even when the
    // requested file or one or more parent directories have not been created.
    let mut ancestor = normalized.as_path();
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(ancestor) {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let name = ancestor
                    .file_name()
                    .ok_or_else(|| format!("invalid workspace path: {path}"))?;
                missing.push(name.to_os_string());
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| format!("invalid workspace path: {path}"))?;
            }
            Err(error) => return Err(format!("cannot resolve workspace path: {error}")),
        }
    }

    let mut resolved = ancestor
        .canonicalize()
        .map_err(|e| format!("cannot resolve workspace path: {e}"))?;
    if !resolved.starts_with(&root) {
        return Err(format!("path escapes workspace through a symbolic link: {path}"));
    }
    for component in missing.iter().rev() {
        resolved.push(component);
    }
    if !resolved.starts_with(&root) {
        return Err(format!("path escapes workspace: {path}"));
    }
    Ok(resolved)
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| DirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            path: e.path().to_string_lossy().to_string(),
            is_dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String, workspace_root: Option<String>) -> Result<String, String> {
    let resolved = if let Some(root) = workspace_root {
        assert_in_workspace(&path, &root)?
    } else {
        std::path::PathBuf::from(&path)
    };
    std::fs::read_to_string(resolved).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String, workspace_root: Option<String>) -> Result<(), String> {
    let resolved = if let Some(root) = workspace_root.as_deref() {
        assert_in_workspace(&path, root)?
    } else {
        std::path::PathBuf::from(&path)
    };
    let p = resolved.as_path();
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if let Some(root) = workspace_root {
        let verified = assert_in_workspace(p.to_string_lossy().as_ref(), &root)?;
        return std::fs::write(verified, content).map_err(|e| e.to_string());
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_path(path: String, workspace_root: Option<String>) -> Result<(), String> {
    let resolved = if let Some(root) = workspace_root {
        assert_in_workspace(&path, &root)?
    } else {
        std::path::PathBuf::from(&path)
    };
    let p = resolved.as_path();
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn create_dir_cmd(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Returns the config base directory for a known editor on the current OS.
/// e.g. editor_config_dir("Code") → C:\Users\<user>\AppData\Roaming\Code
fn editor_config_dir(folder_name: &str) -> Result<std::path::PathBuf, String> {
    #[cfg(windows)]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
        Ok(std::path::PathBuf::from(appdata).join(folder_name))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(folder_name))
    }
    #[cfg(target_os = "linux")]
    {
        let config = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_default();
            format!("{home}/.config")
        });
        Ok(std::path::PathBuf::from(config).join(folder_name))
    }
}

fn editor_folder(id: &str) -> Option<&'static str> {
    match id {
        "vscode"   => Some("Code"),
        "cursor"   => Some("Cursor"),
        "windsurf" => Some("Windsurf"),
        _          => None,
    }
}

/// Read the keybindings.json for a given editor (vscode | cursor | windsurf).
#[tauri::command]
pub fn read_editor_keybindings(editor: String) -> Result<String, String> {
    let folder = editor_folder(&editor)
        .ok_or_else(|| format!("Unknown editor: {editor}"))?;
    let path = editor_config_dir(folder)?
        .join("User")
        .join("keybindings.json");
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Returns which of vscode / cursor / windsurf have a keybindings.json on disk.
#[tauri::command]
pub fn detect_installed_editors() -> Vec<String> {
    ["vscode", "cursor", "windsurf"]
        .iter()
        .filter(|&&id| {
            editor_folder(id)
                .and_then(|f| editor_config_dir(f).ok())
                .map(|p| p.join("User").join("keybindings.json").exists())
                .unwrap_or(false)
        })
        .map(|s| s.to_string())
        .collect()
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::assert_in_workspace;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn test_directory() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is valid")
            .as_nanos();
        std::env::temp_dir().join(format!("origin-fs-test-{}-{suffix}", std::process::id()))
    }

    #[test]
    fn workspace_path_resolves_new_files_under_root() {
        let root = test_directory();
        fs::create_dir_all(&root).expect("create test root");
        let requested = root.join("new").join("file.txt");
        let resolved = assert_in_workspace(
            requested.to_str().expect("UTF-8 test path"),
            root.to_str().expect("UTF-8 test root"),
        ).expect("allow new path inside workspace");
        assert_eq!(resolved, requested);
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn workspace_path_rejects_symlink_escape() {
        let root = test_directory();
        let outside = root.join("outside");
        fs::create_dir_all(&outside).expect("create outside directory");
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).expect("create workspace");
        std::os::unix::fs::symlink(&outside, workspace.join("linked"))
            .expect("create workspace symlink");

        let requested = workspace.join("linked").join("secret.txt");
        assert!(assert_in_workspace(
            requested.to_str().expect("UTF-8 test path"),
            workspace.to_str().expect("UTF-8 test root"),
        ).is_err());
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn workspace_path_accepts_symlinked_workspace_root() {
        let root = test_directory();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).expect("create workspace");
        let alias = root.join("workspace-alias");
        std::os::unix::fs::symlink(&workspace, &alias).expect("create workspace alias");

        let requested = alias.join("new").join("file.txt");
        let resolved = assert_in_workspace(
            requested.to_str().expect("UTF-8 test path"),
            alias.to_str().expect("UTF-8 workspace alias"),
        ).expect("allow paths under a symlinked workspace root");
        assert_eq!(resolved, workspace.join("new").join("file.txt"));
        fs::remove_dir_all(root).expect("remove test root");
    }
}
