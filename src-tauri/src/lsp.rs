use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, Ordering},
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader as TokioBufReader};
use tokio::sync::{mpsc, oneshot};
use tauri::Emitter;

struct LspServer {
    msg_tx:      mpsc::UnboundedSender<serde_json::Value>,
    req_counter: Arc<AtomicI64>,
    pending:     Arc<Mutex<HashMap<i64, oneshot::Sender<serde_json::Value>>>>,
    _child:      tokio::process::Child, // kill_on_drop kills on drop
}

pub struct LspState(Mutex<HashMap<String, LspServer>>);

impl LspState {
    pub fn new() -> Self {
        LspState(Mutex::new(HashMap::new()))
    }
}

/// Read one Content-Length-framed LSP message from an async buffered reader.
async fn read_lsp_msg(
    reader: &mut TokioBufReader<tokio::process::ChildStdout>,
) -> Option<serde_json::Value> {
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await.ok()?;
        if n == 0 { return None; }
        let trimmed = line.trim();
        if trimmed.is_empty() { break; }
        let lower = trimmed.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length: ") {
            content_length = rest.trim().parse().ok()?;
        }
    }
    if content_length == 0 { return None; }
    let mut buf = vec![0u8; content_length];
    reader.read_exact(&mut buf).await.ok()?;
    serde_json::from_slice(&buf).ok()
}

/// Encode a JSON value as a Content-Length-framed LSP message.
fn encode_lsp_msg(msg: &serde_json::Value) -> Vec<u8> {
    let body = msg.to_string();
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut out = header.into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

fn make_lsp_process(exe: &str) -> tokio::process::Command {
    // On Windows, npm global binaries are .cmd shims; CreateProcess cannot resolve
    // them via PATHEXT. Delegate to cmd.exe so PATHEXT resolution works correctly.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", exe]);
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = tokio::process::Command::new(exe);

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    cmd
}

fn lsp_exe_and_args(language: &str) -> Option<(&'static str, &'static [&'static str])> {
    match language {
        "typescript" | "javascript" => Some(("typescript-language-server", &["--stdio"])),
        "rust"   => Some(("rust-analyzer", &[])),
        "python" => Some(("pylsp", &[])),
        _ => None,
    }
}

#[tauri::command]
pub async fn lsp_start(
    language: String,
    root_path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, LspState>,
) -> Result<(), String> {
    if state.0.lock().unwrap().contains_key(&language) {
        return Ok(());
    }

    let (exe, args) = lsp_exe_and_args(&language)
        .ok_or_else(|| format!("No LSP server configured for '{}'", language))?;

    let mut cmd = make_lsp_process(exe);
    for arg in args { cmd.arg(arg); }
    cmd.current_dir(&root_path);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn {} ({}): {}", exe, language, e))?;

    let stdin  = child.stdin.take().ok_or("stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("stdout unavailable")?;

    let (msg_tx, mut msg_rx) = mpsc::unbounded_channel::<serde_json::Value>();
    let req_counter = Arc::new(AtomicI64::new(1));
    let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<serde_json::Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Writer task: drain channel → stdin
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(msg) = msg_rx.recv().await {
            let bytes = encode_lsp_msg(&msg);
            if stdin.write_all(&bytes).await.is_err() { break; }
            let _ = stdin.flush().await;
        }
    });

    // Reader task: stdout → pending responses | frontend notifications.
    // msg_tx_r is used to auto-reply to server→client requests (see below).
    let pending_r  = pending.clone();
    let app_r      = app.clone();
    let lang_r     = language.clone();
    let msg_tx_r   = msg_tx.clone();
    tokio::spawn(async move {
        let mut reader = TokioBufReader::new(stdout);
        loop {
            let Some(msg) = read_lsp_msg(&mut reader).await else { break };
            let method_str = msg.get("method").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let has_method = !method_str.is_empty();
            let id_opt     = msg.get("id").and_then(|v| v.as_i64());

            match (has_method, id_opt) {
                // Response to a client request (id present, no method)
                (false, Some(id)) => {
                    if let Some(tx) = pending_r.lock().unwrap().remove(&id) {
                        let _ = tx.send(msg);
                    }
                }
                // Server→client request (both method and id present).
                // Auto-reply null so the server isn't left waiting.
                (true, Some(id)) => {
                    let _ = app_r.emit(&format!("lsp-server-request-{}", lang_r), &msg);
                    let _ = msg_tx_r.send(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id":      id,
                        "result":  null,
                    }));
                }
                // Pure server notification (method, no id) — forward normally
                (true, None) => {
                    let _ = app_r.emit(&format!("lsp-notification-{}", lang_r), &msg);
                }
                _ => {}
            }
        }
    });

    state.0.lock().unwrap().insert(language, LspServer {
        msg_tx,
        req_counter,
        pending,
        _child: child,
    });

    Ok(())
}

#[tauri::command]
pub async fn lsp_request(
    language: String,
    method: String,
    params: serde_json::Value,
    state: tauri::State<'_, LspState>,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = oneshot::channel();
    let (id, msg_tx) = {
        let guard = state.0.lock().unwrap();
        let srv = guard
            .get(&language)
            .ok_or_else(|| format!("LSP not running for '{}'", language))?;
        let id = srv.req_counter.fetch_add(1, Ordering::Relaxed);
        srv.pending.lock().unwrap().insert(id, tx);
        (id, srv.msg_tx.clone())
    };
    msg_tx
        .send(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| "LSP request timed out".to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_notify(
    language: String,
    method: String,
    params: serde_json::Value,
    state: tauri::State<'_, LspState>,
) -> Result<(), String> {
    let msg_tx = {
        let guard = state.0.lock().unwrap();
        let srv = guard
            .get(&language)
            .ok_or_else(|| format!("LSP not running for '{}'", language))?;
        srv.msg_tx.clone()
    };
    msg_tx
        .send(serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_stop(
    language: String,
    state: tauri::State<'_, LspState>,
) -> Result<(), String> {
    state.0.lock().unwrap().remove(&language);
    Ok(())
}
