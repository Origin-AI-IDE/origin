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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
