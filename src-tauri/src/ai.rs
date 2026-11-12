use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

const PROXY_ALLOW_HOSTS: &[&str] = &[
    "api.anthropic.com",
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "openrouter.ai",
    "api.mistral.ai",
    "api.deepseek.com",
    "api.groq.com",
    "api.x.ai",
    "api.cohere.com",
    "raw.githubusercontent.com",
    "127.0.0.1",
    "localhost",
    "::1",
];

#[derive(Default)]
pub struct AiProxyState {
    custom_origins: Mutex<HashSet<String>>,
    active_requests: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1") || host.ends_with(".localhost")
}

#[tauri::command]
pub fn register_custom_api_endpoint(
    base_url: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AiProxyState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main application window may register an API endpoint.".into());
    }

    let mut origins = state.custom_origins.lock().map_err(|e| e.to_string())?;
    if base_url.trim().is_empty() {
        origins.clear();
        return Ok(());
    }
    let url = reqwest::Url::parse(&base_url).map_err(|e| format!("invalid base URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Base URL must be an HTTP(S) URL without credentials or a fragment.".into());
    }
    origins.clear();
    origins.insert(url.origin().ascii_serialization());
    Ok(())
}

#[derive(serde::Serialize)]
pub struct BashResult {
    stdout:    String,
    stderr:    String,
    exit_code: i32,
}

#[tauri::command]
pub async fn agent_bash_run(command: String, cwd: String) -> Result<BashResult, String> {
    // Reject empty or non-existent working directories
    if cwd.trim().is_empty() {
        return Err("cwd must not be empty".into());
    }
    if !std::path::Path::new(&cwd).is_dir() {
        return Err(format!("cwd does not exist or is not a directory: {cwd}"));
    }

    #[cfg(windows)]
    let (shell, flag): (String, &str) = ("powershell.exe".into(), "-Command");
    #[cfg(not(windows))]
    let (shell, flag): (String, &str) = (
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()),
        "-c",
    );

    let out = tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&shell);
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

#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProxyEvent {
    Status  { code: u16, headers: Vec<(String, String)> },
    Chunk   { bytes: Vec<u8> },
    Done,
    Error   { message: String },
}

async fn wait_for_cancellation(cancelled: Arc<AtomicBool>) {
    while !cancelled.load(Ordering::Acquire) {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

#[tauri::command]
pub async fn ai_stream_proxy(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    request_id: String,
    channel: tauri::ipc::Channel<ProxyEvent>,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AiProxyState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main application window may make API requests.".into());
    }
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    let host = parsed.host_str().unwrap_or("");
    if !matches!(parsed.scheme(), "http" | "https") || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("API request URL must use HTTP(S) and must not contain credentials.".into());
    }
    let fixed_origin = PROXY_ALLOW_HOSTS.iter().any(|allowed| host.eq_ignore_ascii_case(allowed))
        && (parsed.scheme() == "https" || is_local_host(host));
    let custom_origin = state.custom_origins.lock().map_err(|e| e.to_string())?
        .contains(&parsed.origin().ascii_serialization());
    if !fixed_origin && !custom_origin {
        return Err(format!("host not allowed: {host}"));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let method_val = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| e.to_string())?;
    if method_val != reqwest::Method::GET && method_val != reqwest::Method::POST {
        return Err("Only GET and POST API requests are supported.".into());
    }

    let mut req = client.request(method_val, &url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state.active_requests.lock().map_err(|e| e.to_string())?;
        if active.contains_key(&request_id) {
            return Err("Duplicate API request ID.".into());
        };
        active.insert(request_id.clone(), cancelled.clone());
    }
    let active_requests = state.active_requests.clone();

    tokio::spawn(async move {
        let response = tokio::select! {
            result = req.send() => result,
            _ = wait_for_cancellation(cancelled.clone()) => {
                if let Ok(mut active) = active_requests.lock() { active.remove(&request_id); }
                return;
            }
        };
        let resp = match response {
            Ok(r) => r,
            Err(e) => {
                let _ = channel.send(ProxyEvent::Error { message: e.to_string() });
                if let Ok(mut active) = active_requests.lock() { active.remove(&request_id); }
                return;
            }
        };

        let code = resp.status().as_u16();
        let resp_headers: Vec<(String, String)> = resp.headers().iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        if channel.send(ProxyEvent::Status { code, headers: resp_headers }).is_err() {
            if let Ok(mut active) = active_requests.lock() { active.remove(&request_id); }
            return;
        }

        let mut stream = resp;
        loop {
            tokio::select! {
                result = stream.chunk() => match result {
                    Ok(Some(chunk)) => {
                        if channel.send(ProxyEvent::Chunk { bytes: chunk.to_vec() }).is_err() { break; }
                    }
                    Ok(None) => { let _ = channel.send(ProxyEvent::Done); break; }
                    Err(e) => { let _ = channel.send(ProxyEvent::Error { message: e.to_string() }); break; }
                },
                _ = wait_for_cancellation(cancelled.clone()) => break,
            }
        }
        if let Ok(mut active) = active_requests.lock() { active.remove(&request_id); }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_ai_stream_proxy(
    request_id: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AiProxyState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main application window may cancel API requests.".into());
    }
    if let Some(cancelled) = state.active_requests.lock().map_err(|e| e.to_string())?.get(&request_id) {
        cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn fetch_text(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    let host = parsed.host_str().unwrap_or("");
    if !PROXY_ALLOW_HOSTS.iter().any(|allowed| host.eq_ignore_ascii_case(allowed))
        || (parsed.scheme() != "https" && !is_local_host(host))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(format!("host not allowed: {host}"));
    }
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
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
