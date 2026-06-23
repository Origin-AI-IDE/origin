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

fn assert_in_workspace(path: &str, workspace_root: &str) -> Result<(), String> {
    let norm_path = normalize_path(std::path::Path::new(path));
    let norm_root = normalize_path(std::path::Path::new(workspace_root));
    if !norm_path.starts_with(&norm_root) {
        return Err(format!("path escapes workspace: {path}"));
    }
    Ok(())
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
    if let Some(root) = workspace_root {
        assert_in_workspace(&path, &root)?;
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String, workspace_root: Option<String>) -> Result<(), String> {
    if let Some(root) = workspace_root {
        assert_in_workspace(&path, &root)?;
    }
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_path(path: String, workspace_root: Option<String>) -> Result<(), String> {
    if let Some(root) = workspace_root {
        assert_in_workspace(&path, &root)?;
    }
    let p = std::path::Path::new(&path);
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
