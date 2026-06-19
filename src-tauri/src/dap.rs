use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, Ordering},
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader as TokioBufReader};
use tokio::sync::{mpsc, oneshot};
use tauri::Emitter;

struct DapSession {
    msg_tx:      mpsc::UnboundedSender<serde_json::Value>,
    seq_counter: Arc<AtomicI64>,
    pending:     Arc<Mutex<HashMap<i64, oneshot::Sender<serde_json::Value>>>>,
    _child:      tokio::process::Child, // kill_on_drop kills the adapter on drop
}

pub struct DapState(Mutex<HashMap<String, DapSession>>);

impl DapState {
    pub fn new() -> Self {
        DapState(Mutex::new(HashMap::new()))
    }
}

// Content-Length framing is identical to LSP.
async fn read_dap_msg(
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

fn encode_dap_msg(msg: &serde_json::Value) -> Vec<u8> {
    let body = msg.to_string();
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut out = header.into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

/// Returns (exe, args) for a given adapter type.
/// adapter_path overrides the default binary path when provided.
fn dap_exe_and_args(adapter: &str, adapter_path: Option<&str>) -> Option<(String, Vec<String>)> {
    match adapter {
        "codelldb" => Some((
            adapter_path.unwrap_or("codelldb").to_string(),
            vec!["--stdio".to_string()],
        )),
        "debugpy" => Some((
            adapter_path.unwrap_or("python").to_string(),
            vec!["-m".to_string(), "debugpy.adapter".to_string()],
        )),
        _ => None,
    }
}

/// Spawn a debug adapter child process.
///
/// codelldb is a native binary — CreateProcess resolves it directly, no cmd /C needed.
/// debugpy uses 'python' which is often a .cmd shim on Windows (pyenv, conda); wrap in cmd /C.
fn make_dap_process(adapter: &str, exe: &str, args: &[String]) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    let mut cmd = if adapter == "debugpy" {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(exe);
        for a in args { c.arg(a); }
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW
        c
    } else {
        let mut c = tokio::process::Command::new(exe);
        for a in args { c.arg(a); }
        c.creation_flags(0x08000000);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = tokio::process::Command::new(exe);
        for a in args { c.arg(a); }
        c
    };

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    cmd
}

#[tauri::command]
pub async fn dap_start(
    session_id: String,
    adapter: String,
    adapter_path: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, DapState>,
) -> Result<(), String> {
    if state.0.lock().unwrap().contains_key(&session_id) {
        return Ok(()); // session already running
    }

    let (exe, args) = dap_exe_and_args(&adapter, adapter_path.as_deref())
        .ok_or_else(|| format!("No DAP adapter configured for '{}'", adapter))?;

    let mut cmd = make_dap_process(&adapter, &exe, &args);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn {} ({}): {}", exe, adapter, e))?;

    let stdin  = child.stdin.take().ok_or("stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("stdout unavailable")?;

    let (msg_tx, mut msg_rx) = mpsc::unbounded_channel::<serde_json::Value>();
    let seq_counter = Arc::new(AtomicI64::new(1));
    let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<serde_json::Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Writer task: drain channel → adapter stdin
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(msg) = msg_rx.recv().await {
            let bytes = encode_dap_msg(&msg);
            if stdin.write_all(&bytes).await.is_err() { break; }
            let _ = stdin.flush().await;
        }
    });

    // Reader task: adapter stdout → pending responses | frontend events
    let pending_r = pending.clone();
    let app_r     = app.clone();
    let sid_r     = session_id.clone();
    let msg_tx_r  = msg_tx.clone();
    tokio::spawn(async move {
        let mut reader = TokioBufReader::new(stdout);
        loop {
            let Some(msg) = read_dap_msg(&mut reader).await else { break };
            let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();

            match msg_type.as_str() {
                "response" => {
                    // Route to the pending oneshot via request_seq (NOT seq).
                    // seq is the adapter's own counter; request_seq echoes the client's seq.
                    if let Some(req_seq) = msg.get("request_seq").and_then(|v| v.as_i64()) {
                        if let Some(tx) = pending_r.lock().unwrap().remove(&req_seq) {
                            let _ = tx.send(msg);
                        }
                    }
                }
                "event" => {
                    let _ = app_r.emit(&format!("dap-event-{}", sid_r), &msg);
                }
                "request" => {
                    // Adapter → client request (e.g. runInTerminal). Forward and auto-reply null.
                    let _ = app_r.emit(&format!("dap-server-request-{}", sid_r), &msg);
                    if let Some(seq) = msg.get("seq").and_then(|v| v.as_i64()) {
                        let cmd_name = msg.get("command")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let _ = msg_tx_r.send(serde_json::json!({
                            "seq": 0,
                            "type": "response",
                            "request_seq": seq,
                            "success": true,
                            "command": cmd_name,
                            "body": null,
                        }));
                    }
                }
                _ => {}
            }
        }
    });

    state.0.lock().unwrap().insert(session_id, DapSession {
        msg_tx,
        seq_counter,
        pending,
        _child: child,
    });

    Ok(())
}

#[tauri::command]
pub async fn dap_request(
    session_id: String,
    command: String,
    arguments: serde_json::Value,
    state: tauri::State<'_, DapState>,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = oneshot::channel();
    let (seq, msg_tx) = {
        let guard = state.0.lock().unwrap();
        let session = guard
            .get(&session_id)
            .ok_or_else(|| format!("DAP session '{}' not running", session_id))?;
        let seq = session.seq_counter.fetch_add(1, Ordering::Relaxed);
        session.pending.lock().unwrap().insert(seq, tx);
        (seq, session.msg_tx.clone())
    };
    msg_tx
        .send(serde_json::json!({
            "seq":       seq,
            "type":      "request",
            "command":   command,
            "arguments": arguments,
        }))
        .map_err(|e| e.to_string())?;

    // 30s timeout — launch/attach requests can take several seconds
    tokio::time::timeout(std::time::Duration::from_secs(30), rx)
        .await
        .map_err(|_| format!("DAP request '{}' timed out", command))?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dap_stop(
    session_id: String,
    state: tauri::State<'_, DapState>,
) -> Result<(), String> {
    state.0.lock().unwrap().remove(&session_id);
    Ok(())
}
