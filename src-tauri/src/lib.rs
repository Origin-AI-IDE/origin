use keyring::Entry;
use patch_engine::{
    apply_snippet, delete_region, replace_region, DeleteRegionRequest, PatchRequest, PatchResult,
    ReplaceRegionRequest,
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
};
use tauri::Emitter;

const SERVICE: &str = "origin-ide";

// ── Keychain ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn set_secret(account: String, secret: String) -> Result<(), String> {
    Entry::new(SERVICE, &account)
        .map_err(|e| e.to_string())?
        .set_password(&secret)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(account: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pwd) => Ok(Some(pwd)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_secret(account: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── File system ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
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
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}

// ── File system mutations ─────────────────────────────────────────────────────

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn create_dir_cmd(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
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

// ── Git ───────────────────────────────────────────────────────────────────────

fn git_cmd() -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

#[tauri::command]
fn git_branch(path: String) -> Option<String> {
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

// ── Search ────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct SearchMatch {
    path: String,
    line: u32,
    col: u32,
    text: String,
}

const SEARCH_IGNORE: &[&str] = &[
    ".git", "node_modules", "target", ".next", "dist", "build",
    ".cache", "__pycache__", ".venv", "venv", ".turbo", "coverage",
    "out", ".parcel-cache", ".svelte-kit",
];

fn search_file(path: &std::path::Path, query: &str, results: &mut Vec<SearchMatch>) {
    let Ok(bytes) = std::fs::read(path) else { return };
    if bytes.contains(&0u8) { return } // skip binary files
    let Ok(text) = std::str::from_utf8(&bytes) else { return };
    for (i, line) in text.lines().enumerate() {
        if results.len() >= 500 { return }
        if let Some(col) = line.to_lowercase().find(query) {
            results.push(SearchMatch {
                path: path.to_string_lossy().into_owned(),
                line: (i + 1) as u32,
                col: col as u32,
                text: line.trim().to_string(),
            });
        }
    }
}

fn walk_search(dir: &std::path::Path, query: &str, results: &mut Vec<SearchMatch>) {
    if results.len() >= 500 { return }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut subdirs = vec![];
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let ns = name.to_string_lossy();
        if SEARCH_IGNORE.iter().any(|&s| s == ns.as_ref()) { continue }
        if path.is_dir() { subdirs.push(path) } else { search_file(&path, query, results) }
    }
    for d in subdirs { walk_search(&d, query, results) }
}

#[tauri::command]
async fn search_in_files(folder: String, query: String) -> Result<Vec<SearchMatch>, String> {
    if query.trim().is_empty() { return Ok(vec![]) }
    let q = query.to_lowercase();
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        walk_search(std::path::Path::new(&folder), &q, &mut results);
        results
    }).await.map_err(|e| e.to_string())
}

// ── Symbol search ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct SymbolMatch {
    name: String,
    kind: String,
    path: String,
    line: u32,
    line_content: String,
}

fn extract_ident(s: &str) -> Option<String> {
    let s = s.trim_start();
    let end = s.find(|c: char| !c.is_alphanumeric() && c != '_').unwrap_or(s.len());
    if end == 0 { None } else { Some(s[..end].to_string()) }
}

fn classify_ts(s: &str) -> Option<(String, &'static str)> {
    let s = s.strip_prefix("export default ").unwrap_or(s);
    let s = s.strip_prefix("export ").unwrap_or(s);
    let s = s.strip_prefix("declare ").unwrap_or(s);
    if let Some(r) = s.strip_prefix("async function ").or_else(|| s.strip_prefix("function ")) {
        return extract_ident(r).map(|n| (n, "fn"));
    }
    if let Some(r) = s.strip_prefix("class ")     { return extract_ident(r).map(|n| (n, "class")); }
    if let Some(r) = s.strip_prefix("interface ") { return extract_ident(r).map(|n| (n, "interface")); }
    if let Some(r) = s.strip_prefix("type ") {
        let name = extract_ident(r)?;
        let after = r[name.len()..].trim_start();
        if after.starts_with('=') || after.starts_with('<') {
            return Some((name, "type"));
        }
    }
    if let Some(r) = s.strip_prefix("const ").or_else(|| s.strip_prefix("let ")) {
        let name = extract_ident(r)?;
        let after = r[name.len()..].trim_start();
        if after.starts_with("= (") || after.starts_with("= async") || after.starts_with("= function") {
            return Some((name, "fn"));
        }
        if after.starts_with(':') || after.starts_with("= ") {
            return Some((name, "const"));
        }
    }
    None
}

fn classify_rs(s: &str) -> Option<(String, &'static str)> {
    let s = s.strip_prefix("pub(crate) ").unwrap_or(s);
    let s = s.strip_prefix("pub(super) ").unwrap_or(s);
    let s = s.strip_prefix("pub ").unwrap_or(s);
    if let Some(r) = s.strip_prefix("async fn ").or_else(|| s.strip_prefix("fn ")) {
        return extract_ident(r).map(|n| (n, "fn"));
    }
    if let Some(r) = s.strip_prefix("struct ") { return extract_ident(r).map(|n| (n, "struct")); }
    if let Some(r) = s.strip_prefix("enum ")   { return extract_ident(r).map(|n| (n, "enum")); }
    if let Some(r) = s.strip_prefix("trait ")  { return extract_ident(r).map(|n| (n, "trait")); }
    if let Some(r) = s.strip_prefix("type ")   { return extract_ident(r).map(|n| (n, "type")); }
    None
}

fn classify_py(s: &str) -> Option<(String, &'static str)> {
    if let Some(r) = s.strip_prefix("async def ").or_else(|| s.strip_prefix("def ")) {
        return extract_ident(r).map(|n| (n, "fn"));
    }
    if let Some(r) = s.strip_prefix("class ") { return extract_ident(r).map(|n| (n, "class")); }
    None
}

fn classify_line(line: &str, ext: &str) -> Option<(String, &'static str)> {
    let s = line.trim();
    if s.is_empty() || s.starts_with("//") || s.starts_with('#') || s.starts_with('*') { return None; }
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "vue" | "svelte" => classify_ts(s),
        "rs" => classify_rs(s),
        "py" => classify_py(s),
        _ => None,
    }
}

fn search_symbols_file(path: &std::path::Path, query: &str, results: &mut Vec<SymbolMatch>) {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e,
        None => return,
    };
    if !matches!(ext, "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "vue" | "svelte") { return }
    let Ok(bytes) = std::fs::read(path) else { return };
    if bytes.contains(&0u8) { return }
    let Ok(text) = std::str::from_utf8(&bytes) else { return };
    for (i, line) in text.lines().enumerate() {
        if results.len() >= 300 { return }
        if let Some((name, kind)) = classify_line(line, ext) {
            if query.is_empty() || name.to_lowercase().contains(query) {
                results.push(SymbolMatch {
                    name,
                    kind: kind.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    line: (i + 1) as u32,
                    line_content: line.trim().to_string(),
                });
            }
        }
    }
}

fn walk_symbols(dir: &std::path::Path, query: &str, results: &mut Vec<SymbolMatch>) {
    if results.len() >= 300 { return }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut subdirs = vec![];
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let ns = name.to_string_lossy();
        if SEARCH_IGNORE.iter().any(|&s| s == ns.as_ref()) { continue }
        if path.is_dir() { subdirs.push(path) } else { search_symbols_file(&path, query, results) }
    }
    for d in subdirs { walk_symbols(&d, query, results) }
}

#[tauri::command]
async fn search_symbols(folder: String, query: String) -> Result<Vec<SymbolMatch>, String> {
    if folder.is_empty() { return Ok(vec![]) }
    let q = query.to_lowercase();
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        walk_symbols(std::path::Path::new(&folder), &q, &mut results);
        results
    }).await.map_err(|e| e.to_string())
}

// ── Workspace file listing ────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct WorkspaceFile {
    name: String,
    path: String,
    ext: String,
}

fn walk_files(dir: &std::path::Path, results: &mut Vec<WorkspaceFile>) {
    if results.len() >= 2000 { return }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        if results.len() >= 2000 { break }
        let path = entry.path();
        let name = entry.file_name();
        let ns = name.to_string_lossy();
        if SEARCH_IGNORE.iter().any(|&s| s == ns.as_ref()) { continue }
        if path.is_dir() {
            walk_files(&path, results);
        } else {
            let ext = path.extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            results.push(WorkspaceFile {
                name: ns.to_string(),
                path: path.to_string_lossy().into_owned(),
                ext,
            });
        }
    }
}

#[tauri::command]
async fn list_workspace_files(folder: String) -> Result<Vec<WorkspaceFile>, String> {
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        walk_files(std::path::Path::new(&folder), &mut results);
        results
    }).await.map_err(|e| e.to_string())
}

// ── Terminal ──────────────────────────────────────────────────────────────────

struct TermInstance {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct TerminalState {
    instances: Mutex<HashMap<u32, TermInstance>>,
    next_id: AtomicU32,
}

impl TerminalState {
    fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

#[cfg(windows)]
fn default_shell() -> String {
    "powershell.exe".to_string()
}

#[cfg(not(windows))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

#[tauri::command]
fn terminal_create(
    cwd: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.cwd(&cwd);

    // Spawn the shell; slave is dropped after spawn so master gets EOF on exit
    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);

    // Background thread: read PTY output → emit Tauri events
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(&format!("terminal-output-{}", id), data);
                }
            }
        }
        let _ = app.emit(&format!("terminal-exit-{}", id), ());
    });

    state
        .instances
        .lock()
        .unwrap()
        .insert(id, TermInstance { master: pair.master, writer });

    Ok(id)
}

#[tauri::command]
fn terminal_write(
    id: u32,
    data: String,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    let inst = instances
        .get_mut(&id)
        .ok_or_else(|| "terminal not found".to_string())?;
    inst.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_resize(
    id: u32,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let instances = state.instances.lock().unwrap();
    let inst = instances
        .get(&id)
        .ok_or_else(|| "terminal not found".to_string())?;
    inst.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_close(id: u32, state: tauri::State<'_, TerminalState>) -> Result<(), String> {
    // Dropping the TermInstance closes the master PTY, which sends EOF to the shell
    state.instances.lock().unwrap().remove(&id);
    Ok(())
}

// ── Git changes ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct CommitEntry {
    hash: String,
    msg:  String,
}

#[derive(serde::Serialize)]
struct GitChanges {
    files:         usize,
    commits_ahead: usize,
    log:           Vec<CommitEntry>,
}

#[tauri::command]
fn git_changes(path: String) -> Option<GitChanges> {
    // Require this to be a git repo
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

    // Commits ahead of upstream (silently 0 when no upstream is set)
    let commits_ahead = git_cmd()
        .args(["rev-list", "--count", "@{u}..HEAD"])
        .current_dir(&path)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(0);

    // Recent commit log (use \x01 as field separator)
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

// ── Git SCM ───────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct StatusFile {
    status: String,
    path:   String,
}

#[derive(serde::Serialize)]
struct FullCommitEntry {
    hash:    String,
    subject: String,
    author:  String,
    date:    String,
}

#[tauri::command]
fn git_status_files(path: String) -> Vec<StatusFile> {
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
fn git_log_full(path: String) -> Vec<FullCommitEntry> {
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
fn git_commit(path: String, title: String, description: String) -> Result<String, String> {
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
fn git_commit_push(path: String, title: String, description: String) -> Result<String, String> {
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

// ── System memory ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct MemoryInfo {
    used_gb:  f64,
    total_gb: f64,
}

#[tauri::command]
fn sys_memory() -> Option<MemoryInfo> {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total = sys.total_memory() as f64 / (1u64 << 30) as f64;
    let used  = sys.used_memory()  as f64 / (1u64 << 30) as f64;
    Some(MemoryInfo {
        used_gb:  (used  * 10.0).round() / 10.0,
        total_gb: (total * 10.0).round() / 10.0,
    })
}

// ── AI chat streaming ─────────────────────────────────────────────────────────

#[derive(serde::Deserialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(serde::Serialize, Clone)]
struct UsageInfo {
    input_tokens:  u32,
    output_tokens: u32,
}

#[derive(serde::Serialize, Clone)]
struct StreamChunk {
    token: String,
    done:  bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<UsageInfo>,
}

fn ai_emit_token(app: &tauri::AppHandle, stream_id: &str, token: String) {
    let _ = app.emit(&format!("ai-stream-{}", stream_id), StreamChunk { token, done: false, error: None, usage: None });
}

fn ai_emit_done(app: &tauri::AppHandle, stream_id: &str, usage: Option<UsageInfo>) {
    let _ = app.emit(&format!("ai-stream-{}", stream_id), StreamChunk { token: String::new(), done: true, error: None, usage });
}

fn ai_emit_error(app: &tauri::AppHandle, stream_id: &str, msg: String) {
    let _ = app.emit(&format!("ai-stream-{}", stream_id), StreamChunk { token: String::new(), done: true, error: Some(msg), usage: None });
}

fn drain_lines(buf: &mut String) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some(pos) = buf.find('\n') {
        let line = buf[..pos].trim_end_matches('\r').to_string();
        buf.drain(..=pos);
        lines.push(line);
    }
    lines
}

async fn stream_anthropic(
    client: reqwest::Client,
    app: tauri::AppHandle,
    model_id: String,
    api_key: String,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    stream_id: String,
) {
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    let mut body = serde_json::json!({
        "model": model_id, "max_tokens": 8096, "stream": true, "messages": msgs
    });
    if !system_prompt.is_empty() {
        body["system"] = serde_json::Value::String(system_prompt);
    }

    let mut resp = match client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            return ai_emit_error(&app, &stream_id, format!("HTTP {}: {}", status, text));
        }
        Err(e) => return ai_emit_error(&app, &stream_id, e.to_string()),
    };

    let mut buf = String::new();
    let mut input_tokens:  u32 = 0;
    let mut output_tokens: u32 = 0;
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                for line in drain_lines(&mut buf) {
                    let Some(data) = line.strip_prefix("data: ") else { continue };
                    let data = data.trim();
                    if data.is_empty() || data == "[DONE]" { continue; }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        match v["type"].as_str() {
                            Some("message_start") => {
                                if let Some(n) = v["message"]["usage"]["input_tokens"].as_u64() {
                                    input_tokens = n as u32;
                                }
                            }
                            Some("content_block_delta") => {
                                if let Some(t) = v["delta"]["text"].as_str() {
                                    if !t.is_empty() { ai_emit_token(&app, &stream_id, t.to_string()); }
                                }
                            }
                            Some("message_delta") => {
                                if let Some(n) = v["usage"]["output_tokens"].as_u64() {
                                    output_tokens = n as u32;
                                }
                            }
                            Some("message_stop") => {
                                let usage = (input_tokens > 0 || output_tokens > 0)
                                    .then(|| UsageInfo { input_tokens, output_tokens });
                                return ai_emit_done(&app, &stream_id, usage);
                            }
                            Some("error") => {
                                let msg = v["error"]["message"].as_str().unwrap_or("Unknown error").to_string();
                                return ai_emit_error(&app, &stream_id, msg);
                            }
                            _ => {}
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => return ai_emit_error(&app, &stream_id, e.to_string()),
        }
    }
    let usage = (input_tokens > 0 || output_tokens > 0)
        .then(|| UsageInfo { input_tokens, output_tokens });
    ai_emit_done(&app, &stream_id, usage);
}

async fn stream_openai(
    client: reqwest::Client,
    app: tauri::AppHandle,
    base_url: String,
    model_id: String,
    api_key: String,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    stream_id: String,
) {
    let mut msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    if !system_prompt.is_empty() {
        msgs.insert(0, serde_json::json!({ "role": "system", "content": system_prompt }));
    }
    let body = serde_json::json!({
        "model": model_id, "stream": true,
        "stream_options": { "include_usage": true },
        "messages": msgs
    });

    let mut resp = match client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            return ai_emit_error(&app, &stream_id, format!("HTTP {}: {}", status, text));
        }
        Err(e) => return ai_emit_error(&app, &stream_id, e.to_string()),
    };

    let mut buf = String::new();
    let mut input_tokens:  u32 = 0;
    let mut output_tokens: u32 = 0;
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                for line in drain_lines(&mut buf) {
                    let Some(data) = line.strip_prefix("data: ") else { continue };
                    let data = data.trim();
                    if data.is_empty() { continue; }
                    if data == "[DONE]" {
                        let usage = (input_tokens > 0 || output_tokens > 0)
                            .then(|| UsageInfo { input_tokens, output_tokens });
                        return ai_emit_done(&app, &stream_id, usage);
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
                            if let Some(n) = u["prompt_tokens"].as_u64()     { input_tokens  = n as u32; }
                            if let Some(n) = u["completion_tokens"].as_u64() { output_tokens = n as u32; }
                        }
                        if let Some(c) = v["choices"][0]["delta"]["content"].as_str() {
                            if !c.is_empty() { ai_emit_token(&app, &stream_id, c.to_string()); }
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => return ai_emit_error(&app, &stream_id, e.to_string()),
        }
    }
    let usage = (input_tokens > 0 || output_tokens > 0)
        .then(|| UsageInfo { input_tokens, output_tokens });
    ai_emit_done(&app, &stream_id, usage);
}

async fn stream_gemini(
    client: reqwest::Client,
    app: tauri::AppHandle,
    model_id: String,
    api_key: String,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    stream_id: String,
) {
    let contents: Vec<serde_json::Value> = messages.iter().map(|m| {
        let role = if m.role == "assistant" { "model" } else { "user" };
        serde_json::json!({ "role": role, "parts": [{ "text": m.content }] })
    }).collect();
    let mut body = serde_json::json!({ "contents": contents });
    if !system_prompt.is_empty() {
        body["systemInstruction"] = serde_json::json!({ "parts": [{ "text": system_prompt }] });
    }
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        model_id, api_key
    );

    let mut resp = match client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            return ai_emit_error(&app, &stream_id, format!("HTTP {}: {}", status, text));
        }
        Err(e) => return ai_emit_error(&app, &stream_id, e.to_string()),
    };

    let mut buf = String::new();
    let mut input_tokens:  u32 = 0;
    let mut output_tokens: u32 = 0;
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                for line in drain_lines(&mut buf) {
                    let Some(data) = line.strip_prefix("data: ") else { continue };
                    let data = data.trim();
                    if data.is_empty() { continue; }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(t) = v["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                            if !t.is_empty() { ai_emit_token(&app, &stream_id, t.to_string()); }
                        }
                        if let Some(meta) = v.get("usageMetadata") {
                            if let Some(n) = meta["promptTokenCount"].as_u64()     { input_tokens  = n as u32; }
                            if let Some(n) = meta["candidatesTokenCount"].as_u64() { output_tokens = n as u32; }
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => return ai_emit_error(&app, &stream_id, e.to_string()),
        }
    }
    let usage = (input_tokens > 0 || output_tokens > 0)
        .then(|| UsageInfo { input_tokens, output_tokens });
    ai_emit_done(&app, &stream_id, usage);
}

async fn stream_ollama(
    client: reqwest::Client,
    app: tauri::AppHandle,
    model_id: String,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    stream_id: String,
) {
    let mut msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    if !system_prompt.is_empty() {
        msgs.insert(0, serde_json::json!({ "role": "system", "content": system_prompt }));
    }
    let body = serde_json::json!({ "model": model_id, "messages": msgs, "stream": true });

    let mut resp = match client
        .post("http://localhost:11434/api/chat")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            return ai_emit_error(&app, &stream_id, format!("HTTP {}: {}", status, text));
        }
        Err(e) => return ai_emit_error(&app, &stream_id, format!("Ollama not running: {}", e)),
    };

    let mut buf = String::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                for line in drain_lines(&mut buf) {
                    if line.is_empty() { continue; }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(c) = v["message"]["content"].as_str() {
                            if !c.is_empty() { ai_emit_token(&app, &stream_id, c.to_string()); }
                        }
                        if v["done"].as_bool().unwrap_or(false) {
                            return ai_emit_done(&app, &stream_id, None);
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => return ai_emit_error(&app, &stream_id, e.to_string()),
        }
    }
    ai_emit_done(&app, &stream_id, None);
}

fn openai_base_url(provider_id: &str) -> &'static str {
    match provider_id {
        "openai"     => "https://api.openai.com/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "deepseek"   => "https://api.deepseek.com",
        "mistral"    => "https://api.mistral.ai/v1",
        "groq"       => "https://api.groq.com/openai/v1",
        "xai"        => "https://api.x.ai/v1",
        "cohere"     => "https://api.cohere.com/compatibility/v1",
        "lmstudio"   => "http://localhost:1234/v1",
        "vllm"       => "http://localhost:8000/v1",
        _            => "https://api.openai.com/v1",
    }
}

#[tauri::command]
async fn ai_chat_stream(
    app: tauri::AppHandle,
    provider_id: String,
    model_id: String,
    api_key: String,
    messages: Vec<ChatMessage>,
    system_prompt: String,
    stream_id: String,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    tokio::spawn(async move {
        match provider_id.as_str() {
            "anthropic" => stream_anthropic(client, app, model_id, api_key, messages, system_prompt, stream_id).await,
            "gemini"    => stream_gemini(client, app, model_id, api_key, messages, system_prompt, stream_id).await,
            "ollama"    => stream_ollama(client, app, model_id, messages, system_prompt, stream_id).await,
            _ => {
                let base = openai_base_url(&provider_id).to_string();
                stream_openai(client, app, base, model_id, api_key, messages, system_prompt, stream_id).await
            }
        }
    });

    Ok(())
}

// ── Agent bash runner ─────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct BashResult {
    stdout:    String,
    stderr:    String,
    exit_code: i32,
}

#[tauri::command]
async fn agent_bash_run(command: String, cwd: String) -> Result<BashResult, String> {
    #[cfg(windows)]
    let (shell, flag) = ("powershell.exe", "-Command");
    #[cfg(not(windows))]
    let (shell, flag) = (std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()).as_str(), "-c");

    let out = tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(shell);
        cmd.args([flag, &command]).current_dir(&cwd);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(BashResult {
        stdout:    String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr:    String::from_utf8_lossy(&out.stderr).into_owned(),
        exit_code: out.status.code().unwrap_or(-1),
    })
}

// ── AI stream proxy ───────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ProxyEvent {
    Status  { code: u16, headers: Vec<(String, String)> },
    Chunk   { bytes: Vec<u8> },
    Done,
    Error   { message: String },
}

#[tauri::command]
async fn ai_stream_proxy(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    channel: tauri::ipc::Channel<ProxyEvent>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let method_val = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method_val, &url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    tokio::spawn(async move {
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => { let _ = channel.send(ProxyEvent::Error { message: e.to_string() }); return; }
        };

        let code = resp.status().as_u16();
        let resp_headers: Vec<(String, String)> = resp.headers().iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let _ = channel.send(ProxyEvent::Status { code, headers: resp_headers });

        let mut stream = resp;
        loop {
            match stream.chunk().await {
                Ok(Some(chunk)) => { let _ = channel.send(ProxyEvent::Chunk { bytes: chunk.to_vec() }); }
                Ok(None)        => { let _ = channel.send(ProxyEvent::Done); break; }
                Err(e)          => { let _ = channel.send(ProxyEvent::Error { message: e.to_string() }); break; }
            }
        }
    });

    Ok(())
}

// ── HTTP fetch (for frontend pricing/data fetches) ────────────────────────────

#[tauri::command]
async fn fetch_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("User-Agent", "origin-ide/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

// ── Patch engine ──────────────────────────────────────────────────────────────

#[tauri::command]
fn patch_apply_snippet(req: PatchRequest) -> PatchResult {
    apply_snippet(req)
}

#[tauri::command]
fn patch_replace_region(req: ReplaceRegionRequest) -> PatchResult {
    replace_region(req)
}

#[tauri::command]
fn patch_delete_region(req: DeleteRegionRequest) -> PatchResult {
    delete_region(req)
}

// ── Source tree ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct FileTreeNode {
    name: String,
    path: String,
    size: u64,
    is_dir: bool,
    children: Vec<FileTreeNode>,
}

fn build_file_tree(dir: &std::path::Path, depth: usize) -> FileTreeNode {
    let name = dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| dir.to_string_lossy().to_string());
    if depth > 7 {
        return FileTreeNode { name, path: dir.to_string_lossy().into_owned(), size: 0, is_dir: true, children: vec![] };
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return FileTreeNode { name, path: dir.to_string_lossy().into_owned(), size: 0, is_dir: true, children: vec![] };
    };
    let mut children: Vec<FileTreeNode> = rd.flatten()
        .filter_map(|e| {
            let p = e.path();
            let n = e.file_name().to_string_lossy().to_string();
            if SEARCH_IGNORE.iter().any(|&s| s == n.as_str()) { return None; }
            if p.is_dir() {
                Some(build_file_tree(&p, depth + 1))
            } else {
                let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                Some(FileTreeNode { name: n, path: p.to_string_lossy().into_owned(), size, is_dir: false, children: vec![] })
            }
        })
        .collect();
    children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    FileTreeNode { name, path: dir.to_string_lossy().into_owned(), size: 0, is_dir: true, children }
}

#[tauri::command]
async fn get_file_tree(folder: String) -> Result<FileTreeNode, String> {
    tokio::task::spawn_blocking(move || Ok(build_file_tree(std::path::Path::new(&folder), 0)))
        .await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct ImportEdge {
    from: String,
    to: String,
}

fn parse_imports(text: &str) -> Vec<String> {
    let mut out = vec![];
    for line in text.lines().take(600) {
        for prefix in &["from '", "from \""] {
            if let Some(idx) = line.find(prefix) {
                let after = &line[idx + prefix.len()..];
                let end_ch = if prefix.ends_with('\'') { '\'' } else { '"' };
                if let Some(end) = after.find(end_ch) {
                    let p = &after[..end];
                    if p.starts_with('.') && !p.contains('\n') {
                        out.push(p.split('?').next().unwrap_or(p).to_string());
                    }
                }
            }
        }
    }
    out
}

fn resolve_import(from: &std::path::Path, import: &str) -> Option<String> {
    let base = from.parent()?;
    let raw = base.join(import);
    if raw.is_file() { return Some(raw.to_string_lossy().into_owned()); }
    for ext in &["ts", "tsx", "js", "jsx"] {
        let c = std::path::PathBuf::from(format!("{}.{}", raw.to_string_lossy(), ext));
        if c.is_file() { return Some(c.to_string_lossy().into_owned()); }
    }
    for ext in &["ts", "tsx", "js", "jsx"] {
        let c = raw.join(format!("index.{}", ext));
        if c.is_file() { return Some(c.to_string_lossy().into_owned()); }
    }
    None
}

fn collect_edges(dir: &std::path::Path, out: &mut Vec<ImportEdge>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if SEARCH_IGNORE.iter().any(|&s| s == name.as_str()) { continue }
        if path.is_dir() { collect_edges(&path, out); continue }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "ts" | "tsx" | "js" | "jsx") { continue }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        if bytes.contains(&0u8) { continue }
        let Ok(text) = std::str::from_utf8(&bytes) else { continue };
        let from_str = path.to_string_lossy().into_owned();
        for imp in parse_imports(text) {
            if let Some(to) = resolve_import(&path, &imp) {
                out.push(ImportEdge { from: from_str.clone(), to });
            }
        }
    }
}

#[tauri::command]
async fn get_import_edges(folder: String) -> Result<Vec<ImportEdge>, String> {
    tokio::task::spawn_blocking(move || {
        let mut edges = vec![];
        collect_edges(std::path::Path::new(&folder), &mut edges);
        Ok(edges)
    }).await.map_err(|e| e.to_string())?
}

// ── App entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            set_secret,
            get_secret,
            delete_secret,
            read_dir,
            read_file,
            write_file,
            rename_path,
            delete_path,
            create_dir_cmd,
            reveal_in_explorer,
            git_branch,
            git_changes,
            git_status_files,
            git_log_full,
            git_commit,
            git_commit_push,
            sys_memory,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_close,
            search_in_files,
            search_symbols,
            list_workspace_files,
            get_file_tree,
            get_import_edges,
            ai_chat_stream,
            agent_bash_run,
            ai_stream_proxy,
            fetch_text,
            patch_apply_snippet,
            patch_replace_region,
            patch_delete_region,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
