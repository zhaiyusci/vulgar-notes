#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime_diagnostics;

fn main() {
    tauri::Builder::default()
        .plugin(runtime_diagnostics::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![
            runtime_diagnostics::record_runtime_event,
            runtime_diagnostics::runtime_log_path
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Vulgar Notes");
}
