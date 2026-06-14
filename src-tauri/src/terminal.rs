use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
};
use tauri::Emitter;

struct TermInstance {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct TerminalState {
    instances: Mutex<HashMap<u32, TermInstance>>,
    next_id:   AtomicU32,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
            next_id:   AtomicU32::new(1),
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
pub fn terminal_create(
    cwd: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.cwd(&cwd);

    // Slave dropped after spawn so master gets EOF on shell exit
    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);

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
pub fn terminal_write(
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
pub fn terminal_resize(
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
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_close(id: u32, state: tauri::State<'_, TerminalState>) -> Result<(), String> {
    // Dropping TermInstance closes the master PTY, sending EOF to the shell
    state.instances.lock().unwrap().remove(&id);
    Ok(())
}
