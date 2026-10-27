use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{plugin::{Builder, TauriPlugin}, Manager, RunEvent, Runtime, WindowEvent};

const MAX_LOG_BYTES: u64 = 256 * 1024;
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_WRITE: Mutex<()> = Mutex::new(());
static WEBVIEW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

// This log contains event IDs and numeric native process diagnostics only. It
// must never include document text, selected file paths, URLs or window titles.
fn record(event: &str, details: &str) {
    let Some(path) = LOG_PATH.get() else { return };
    let Ok(_guard) = LOG_WRITE.lock() else { return };
    if fs::metadata(path).map(|meta| meta.len() >= MAX_LOG_BYTES).unwrap_or(false) {
        let previous = path.with_file_name("runtime-events.previous.log");
        if previous.exists() && fs::remove_file(&previous).is_err() { return; }
        if fs::rename(path, previous).is_err() { return; }
    }
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else { return };
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or(0);
    let line = format!("time_ms={timestamp} host_pid={} event={event} {details}\n", std::process::id());
    let _ = file.write_all(line.as_bytes());
    let _ = file.flush();
}

fn allowed_frontend_event(event: &str) -> bool {
    matches!(event,
        "frontend-ready" | "frontend-start-error" | "frontend-render-error" |
        "document-open-start" | "document-picker-start" |
        "document-picker-complete" | "document-read-start" | "document-read-complete" |
        "document-parse-start" | "document-parse-complete" | "document-open-complete" |
        "document-open-error" | "document-error-dialog-start" | "document-error-dialog-visible" |
        "document-error-dialog-close" | "unsaved-dialog-start" | "unsaved-dialog-visible" |
        "unsaved-dialog-close" | "document-save-start" | "document-save-complete" |
        "document-save-error"
    )
}

#[tauri::command]
pub fn record_runtime_event(event: String) -> Result<(), &'static str> {
    if event.len() > 48 || !allowed_frontend_event(&event) { return Err("Unknown runtime event"); }
    record(&event, "source=frontend");
    Ok(())
}

#[tauri::command]
pub fn runtime_log_path() -> Option<String> {
    LOG_PATH.get().map(|path| path.to_string_lossy().into_owned())
}

fn window_kind(label: &str) -> &'static str {
    if label == "main" { "main" } else if label.starts_with("document-") { "document" } else { "other" }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("runtime-diagnostics")
        .setup(|app, _| {
            if let Ok(directory) = app.path().app_log_dir() {
                if fs::create_dir_all(&directory).is_ok() {
                    let _ = LOG_PATH.set(directory.join("runtime-events.log"));
                }
            }
            record("runtime-start", "");
            Ok(())
        })
        .on_webview_ready(|webview| {
            let id = WEBVIEW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            record("webview-created", &format!("webview={id} window={}", window_kind(webview.label())));
            #[cfg(windows)]
            if let Err(error) = webview.with_webview(move |platform| windows_events::attach(platform, id)) {
                let _ = error;
                record("native-hook-dispatch-failed", &format!("webview={id}"));
            }
        })
        .on_page_load(|webview, payload| {
            let event = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "page-load-started",
                tauri::webview::PageLoadEvent::Finished => "page-load-finished",
            };
            record(event, &format!("window={}", window_kind(webview.label())));
        })
        .on_event(|_, event| match event {
            RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { .. }, .. } =>
                record("window-close-requested", &format!("window={}", window_kind(label))),
            RunEvent::WindowEvent { label, event: WindowEvent::Destroyed, .. } =>
                record("window-destroyed", &format!("window={}", window_kind(label))),
            RunEvent::ExitRequested { code, .. } => record("runtime-exit-requested", &format!("code={code:?}")),
            RunEvent::Exit => record("runtime-exit", ""),
            _ => {},
        })
        .build()
}

#[cfg(windows)]
mod windows_events {
    use super::record;
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::*, BrowserProcessExitedEventHandler,
        ProcessFailedEventHandler, WindowCloseRequestedEventHandler,
    };
    use windows::core::Interface;

    fn hook_result(result: windows::core::Result<()>, id: u64, hook: &str) {
        if let Err(error) = result {
            record("native-hook-failed", &format!("webview={id} hook={hook} hresult={:#x}", error.code().0));
        }
    }

    pub(super) fn attach(platform: tauri::webview::PlatformWebview, id: u64) {
        unsafe {
            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(error) => {
                    record("native-core-unavailable", &format!("webview={id} hresult={:#x}", error.code().0));
                    return;
                }
            };
            let mut browser_pid = 0;
            hook_result(core.BrowserProcessId(&mut browser_pid), id, "browser-pid");
            record("webview-browser-attached", &format!("webview={id} browser_pid={browser_pid}"));

            let mut token = 0;
            hook_result(core.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, args| {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(-1);
                let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON(-1);
                let mut exit_code = 0;
                if let Some(args) = args {
                    let _ = args.ProcessFailedKind(&mut kind);
                    if let Ok(extended) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                        let _ = extended.Reason(&mut reason);
                        let _ = extended.ExitCode(&mut exit_code);
                    }
                }
                record("webview-process-failed", &format!("webview={id} browser_pid={browser_pid} kind={} reason={} exit_code={exit_code}", kind.0, reason.0));
                Ok(())
            })), &mut token), id, "process-failed");

            hook_result(core.add_WindowCloseRequested(&WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                record("webview-window-close-requested", &format!("webview={id} browser_pid={browser_pid}"));
                Ok(())
            })), &mut token), id, "webview-close-requested");

            match platform.environment().cast::<ICoreWebView2Environment5>() {
                Ok(environment) => hook_result(environment.add_BrowserProcessExited(&BrowserProcessExitedEventHandler::create(Box::new(move |_, args| {
                    let mut kind = COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND(-1);
                    let mut exited_pid = 0;
                    if let Some(args) = args {
                        let _ = args.BrowserProcessExitKind(&mut kind);
                        let _ = args.BrowserProcessId(&mut exited_pid);
                    }
                    record("webview-browser-exited", &format!("webview={id} browser_pid={exited_pid} kind={}", kind.0));
                    Ok(())
                })), &mut token), id, "browser-exited"),
                Err(error) => record("native-hook-failed", &format!("webview={id} hook=browser-exited-interface hresult={:#x}", error.code().0)),
            }
        }
    }
}
