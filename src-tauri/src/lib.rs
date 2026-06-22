mod ai;
mod dap;
mod fs;
mod git;
mod keychain;
mod lsp;
mod search;
mod system;
mod terminal;
mod tree;

use tauri::{AppHandle, Manager, WebviewBuilder, WebviewUrl};
use dpi::{LogicalPosition, LogicalSize};

// IMPORTANT: these commands MUST be `async fn`.
//
// `Window::add_child` (Tauri 2.11.2) dispatches the webview build onto the main
// thread via `run_on_main_thread` and then *blocks* on `rx.recv()` waiting for
// the result. A synchronous `#[tauri::command]` runs on the main thread itself,
// so the command would dispatch work to the main thread and then block that same
// thread waiting for it — a self-deadlock. The spinner would spin forever.
//
// Declaring the command `async` makes Tauri run it on its async runtime thread
// pool instead of the main thread, so the dispatch-and-wait completes normally.
#[tauri::command]
async fn embed_ide_panel(
    app: AppHandle,
    panel_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Destroy any existing embedded webview with this label first
    if let Some(existing) = app.get_webview(&panel_id) {
        let _ = existing.close();
    }
    let host = app
        .get_webview_window("main")
        .ok_or_else(|| "Host window not found".to_string())?;
    let window = host.as_ref().window();
    let parsed_url = url::Url::parse(&url).map_err(|e| e.to_string())?;
    window
        .add_child(
            WebviewBuilder::new(&panel_id, WebviewUrl::External(parsed_url)),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn resize_ide_panel(
    app: AppHandle,
    panel_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&panel_id) {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn destroy_ide_panel(
    app: AppHandle,
    panel_id: String,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&panel_id) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(terminal::TerminalState::new())
        .manage(lsp::LspState::new())
        .manage(dap::DapState::new())
        .invoke_handler(tauri::generate_handler![
            keychain::set_secret,
            keychain::get_secret,
            keychain::delete_secret,
            fs::read_dir,
            fs::read_file,
            fs::write_file,
            fs::rename_path,
            fs::delete_path,
            fs::create_dir_cmd,
            fs::reveal_in_explorer,
            git::git_branch,
            git::git_changes,
            git::git_status_files,
            git::git_log_full,
            git::git_commit,
            git::git_commit_push,
            system::sys_memory,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            search::search_in_files,
            search::search_symbols,
            search::list_workspace_files,
            tree::get_file_tree,
            tree::get_import_edges,
            ai::agent_bash_run,
            ai::ai_stream_proxy,
            ai::fetch_text,
            lsp::lsp_start,
            lsp::lsp_request,
            lsp::lsp_notify,
            lsp::lsp_stop,
            dap::dap_start,
            dap::dap_request,
            dap::dap_stop,
            embed_ide_panel,
            resize_ide_panel,
            destroy_ide_panel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
