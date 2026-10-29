#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime_diagnostics;
mod system_documents;

fn main() {
    let app = tauri::Builder::default()
        .manage(system_documents::initial_state())
        // Forward Explorer/CLI launches before the secondary process creates
        // windows or initializes any of the other plugins.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            system_documents::open_from_arguments(app, args, cwd);
        }))
        .plugin(runtime_diagnostics::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|app| {
            system_documents::open_remaining_startup_documents(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_diagnostics::record_runtime_event,
            runtime_diagnostics::runtime_log_path,
            system_documents::take_system_document
        ])
        .build(tauri::generate_context!())
        .expect("failed to run Vulgar Notes");
    app.run(system_documents::on_run_event);
}
