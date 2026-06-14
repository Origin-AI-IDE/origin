use std::collections::HashMap;

const PROXY_ALLOW_HOSTS: &[&str] = &[
    "api.anthropic.com",
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "openrouter.ai",
    "api.mistral.ai",
    "127.0.0.1",
    "localhost",
];

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

#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProxyEvent {
    Status  { code: u16, headers: Vec<(String, String)> },
    Chunk   { bytes: Vec<u8> },
    Done,
    Error   { message: String },
}

#[tauri::command]
pub async fn ai_stream_proxy(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    channel: tauri::ipc::Channel<ProxyEvent>,
) -> Result<(), String> {
    // Validate host against allowlist to prevent SSRF
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    let host = parsed.host_str().unwrap_or("");
    if !PROXY_ALLOW_HOSTS.iter().any(|&allowed| host == allowed) {
        return Err(format!("host not allowed: {host}"));
    }

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

#[tauri::command]
pub async fn fetch_text(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    let host = parsed.host_str().unwrap_or("");
    if !PROXY_ALLOW_HOSTS.iter().any(|&allowed| host == allowed) {
        return Err(format!("host not allowed: {host}"));
    }
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
