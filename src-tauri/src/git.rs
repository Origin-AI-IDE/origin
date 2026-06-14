pub(crate) fn git_cmd() -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

#[tauri::command]
pub fn git_branch(path: String) -> Option<String> {
    let out = git_cmd()
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if branch.is_empty() {
        return None;
    }
    if branch == "HEAD" {
        let hash = git_cmd()
            .args(["rev-parse", "--short", "HEAD"])
            .current_dir(&path)
            .output()
            .ok()?;
        if hash.status.success() {
            return Some(format!(
                "HEAD:{}",
                String::from_utf8_lossy(&hash.stdout).trim()
            ));
        }
        return Some("HEAD".to_string());
    }
    Some(branch)
}

#[derive(serde::Serialize)]
pub struct CommitEntry {
    hash: String,
    msg:  String,
}

#[derive(serde::Serialize)]
pub struct GitChanges {
    files:         usize,
    commits_ahead: usize,
    log:           Vec<CommitEntry>,
}

#[tauri::command]
pub fn git_changes(path: String) -> Option<GitChanges> {
    let status = git_cmd()
        .args(["status", "--porcelain"])
        .current_dir(&path)
        .output()
        .ok()?;
    if !status.status.success() {
        return None;
    }
    let files = String::from_utf8_lossy(&status.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .count();

    let commits_ahead = git_cmd()
        .args(["rev-list", "--count", "@{u}..HEAD"])
        .current_dir(&path)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(0);

    let log = git_cmd()
        .args(["log", "--max-count=5", "--pretty=format:%h\x01%s"])
        .current_dir(&path)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let mut p = l.splitn(2, '\x01');
            CommitEntry {
                hash: p.next().unwrap_or("").to_string(),
                msg:  p.next().unwrap_or("").to_string(),
            }
        })
        .collect();

    Some(GitChanges { files, commits_ahead, log })
}

#[derive(serde::Serialize)]
pub struct StatusFile {
    status: String,
    path:   String,
}

#[derive(serde::Serialize)]
pub struct FullCommitEntry {
    hash:    String,
    subject: String,
    author:  String,
    date:    String,
}

#[tauri::command]
pub fn git_status_files(path: String) -> Vec<StatusFile> {
    let Ok(out) = git_cmd()
        .args(["status", "--porcelain"])
        .current_dir(&path)
        .output()
    else { return vec![] };
    if !out.status.success() { return vec![]; }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| l.len() > 3)
        .map(|l| StatusFile {
            status: l[..2].trim().to_string(),
            path:   l[3..].to_string(),
        })
        .collect()
}

#[tauri::command]
pub fn git_log_full(path: String) -> Vec<FullCommitEntry> {
    let Ok(out) = git_cmd()
        .args(["log", "--max-count=100", "--pretty=format:%h\x01%s\x01%an\x01%ar"])
        .current_dir(&path)
        .output()
    else { return vec![] };
    if !out.status.success() { return vec![]; }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let mut p = l.splitn(4, '\x01');
            FullCommitEntry {
                hash:    p.next().unwrap_or("").to_string(),
                subject: p.next().unwrap_or("").to_string(),
                author:  p.next().unwrap_or("").to_string(),
                date:    p.next().unwrap_or("").to_string(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn git_commit(path: String, title: String, description: String) -> Result<String, String> {
    let stage = git_cmd()
        .args(["add", "-A"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;
    if !stage.status.success() {
        return Err(String::from_utf8_lossy(&stage.stderr).into_owned());
    }
    let mut cmd = git_cmd();
    cmd.args(["commit", "-m", &title]).current_dir(&path);
    if !description.is_empty() {
        cmd.args(["-m", &description]);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[tauri::command]
pub fn git_commit_push(path: String, title: String, description: String) -> Result<String, String> {
    git_commit(path.clone(), title, description)?;
    let push = git_cmd()
        .args(["push"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;
    if !push.status.success() {
        return Err(String::from_utf8_lossy(&push.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&push.stdout).into_owned())
}
