use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
};
use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_fs::FsExt;

/// File paths originate only from the OS/CLI. Frontend callers receive the
/// request assigned to their own window, never an arbitrary path reader.
#[derive(Default)]
pub struct SystemDocuments {
    pending: Mutex<HashMap<String, PathBuf>>,
    remaining_startup: Mutex<Vec<PathBuf>>,
    next_window: AtomicU64,
}

impl SystemDocuments {
    fn with_startup(paths: Vec<PathBuf>) -> Self {
        let mut paths = paths.into_iter();
        let mut pending = HashMap::new();
        if let Some(path) = paths.next() {
            pending.insert("main".into(), path);
        }
        Self {
            pending: Mutex::new(pending),
            remaining_startup: Mutex::new(paths.collect()),
            next_window: AtomicU64::new(1),
        }
    }

    fn take(&self, label: &str) -> Result<Option<PathBuf>, String> {
        self.pending.lock().map(|mut pending| pending.remove(label))
            .map_err(|_| "The pending document request could not be read.".into())
    }

    fn assign(&self, label: &str, path: PathBuf) -> Result<(), String> {
        self.pending.lock().map(|mut pending| { pending.insert(label.into(), path); })
            .map_err(|_| "The document request could not be prepared.".into())
    }

    fn take_remaining_startup(&self) -> Result<Vec<PathBuf>, String> {
        self.remaining_startup.lock().map(|mut paths| std::mem::take(&mut *paths))
            .map_err(|_| "The startup document requests could not be read.".into())
    }

    fn next_label(&self) -> String {
        format!("document-system-{}", self.next_window.fetch_add(1, Ordering::Relaxed))
    }
}

#[derive(Debug, Serialize)]
pub struct OpenedDocument {
    name: String,
    path: String,
    text: String,
}

fn supported_document(path: &Path) -> bool {
    path.extension().and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("vulgar") || extension.eq_ignore_ascii_case("json"))
}

fn document_arguments(arguments: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<PathBuf> {
    let mut after_separator = false;
    arguments.into_iter().skip(1).filter_map(|argument| {
        if argument == "--" {
            after_separator = true;
            return None;
        }
        if !after_separator && argument.to_string_lossy().starts_with('-') {
            return None;
        }
        let path = PathBuf::from(argument);
        if !supported_document(&path) { return None; }
        Some(if path.is_absolute() { path } else { cwd.join(path) })
    }).collect()
}

pub fn initial_state() -> SystemDocuments {
    // An inaccessible working directory is not a reason to panic at startup;
    // absolute requests still work and a relative request reports a read error.
    let cwd = std::env::current_dir().unwrap_or_default();
    SystemDocuments::with_startup(document_arguments(std::env::args_os(), &cwd))
}

fn ordinary_path(path: PathBuf) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let source = path.to_str().ok_or("The document path is not valid Unicode.")?;
        if let Some(rest) = source.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{rest}")));
        }
        if let Some(rest) = source.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(rest));
        }
    }
    Ok(path)
}

fn read_requested_document(path: PathBuf) -> Result<OpenedDocument, String> {
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("Could not open document {}: {error}", path.display()))?;
    if !canonical.is_file() {
        return Err(format!("The selected document is not a file: {}", path.display()));
    }
    let path = ordinary_path(canonical)?;
    let name = path.file_name().and_then(|name| name.to_str())
        .ok_or("The document filename is not valid Unicode.")?.to_owned();
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read document {}: {error}", path.display()))?;
    let path = path.to_str().ok_or("The document path is not valid Unicode.")?.to_owned();
    // Native JSON/schema validation remains in the shared document lifecycle.
    Ok(OpenedDocument { name, path, text })
}

/// This request is consumed exactly once, including read failures. Reloading or
/// navigating to the document UUID must not reopen an old on-disk snapshot.
#[tauri::command]
pub async fn take_system_document(window: WebviewWindow, app: AppHandle) -> Result<Option<OpenedDocument>, String> {
    let request = app.state::<SystemDocuments>().take(window.label())?;
    let Some(path) = request else { return Ok(None); };
    let document = tauri::async_runtime::spawn_blocking(move || read_requested_document(path))
        .await.map_err(|error| format!("The document could not be read: {error}"))??;
    // Match picker-originated grants: allow just this file for subsequent Save
    // and recent-file reads. Never grant its directory or the entire filesystem.
    app.fs_scope().allow_file(&document.path)
        .map_err(|error| format!("The document could not be authorized: {error}"))?;
    Ok(Some(document))
}

fn show_window_error(app: &AppHandle, error: impl Into<String>) {
    app.dialog().message(error).title("Vulgar Notes").kind(MessageDialogKind::Error).show(|_| {});
}

fn create_document_window(app: &AppHandle, path: Option<PathBuf>) -> Result<(), String> {
    let requests = app.state::<SystemDocuments>();
    let label = requests.next_label();
    if let Some(path) = path { requests.assign(&label, path)?; }
    // Assign before creating the webview: its frontend may invoke immediately.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Vulgar Notes")
        .inner_size(1400.0, 900.0)
        .min_inner_size(800.0, 540.0)
        .disable_drag_drop_handler()
        .build();
    match window {
        Ok(window) => { let _ = window.set_focus(); Ok(()) }
        Err(error) => {
            let _ = requests.take(&label);
            Err(format!("Could not create a document window: {error}"))
        }
    }
}

fn focus_existing_window(app: &AppHandle) {
    let windows = app.webview_windows();
    if let Some(window) = windows.get("main").or_else(|| windows.values().next()) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else if let Err(error) = create_document_window(app, None) {
        show_window_error(app, error);
    }
}

fn open_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    let dispatch = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if paths.is_empty() { focus_existing_window(&dispatch); return; }
        for path in paths {
            if let Err(error) = create_document_window(&dispatch, Some(path)) {
                show_window_error(&dispatch, error);
            }
        }
    }) {
        show_window_error(app, format!("The document request could not be opened: {error}"));
    }
}

pub fn open_remaining_startup_documents(app: &AppHandle) {
    match app.state::<SystemDocuments>().take_remaining_startup() {
        Ok(paths) if !paths.is_empty() => open_paths(app, paths),
        Ok(_) => {},
        Err(error) => show_window_error(app, error),
    }
}

pub fn open_from_arguments(app: &AppHandle, args: Vec<String>, cwd: String) {
    // The official plugin preserves Unicode strings (including spaces/CJK).
    // It already splits argv; do not split whitespace or trim quoted filenames.
    open_paths(app, document_arguments(args.into_iter().map(OsString::from), Path::new(&cwd)));
}

pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::WindowEvent { label, event: WindowEvent::Destroyed, .. } = &event {
        let _ = app.state::<SystemDocuments>().take(label);
    }
    #[cfg(target_os = "macos")]
    if let RunEvent::Opened { urls } = event {
        let paths = urls.into_iter().filter_map(|url| url.to_file_path().ok())
            .filter(|path| supported_document(path)).collect::<Vec<_>>();
        if !paths.is_empty() { open_paths(app, paths); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn args(values: &[&str]) -> Vec<OsString> { values.iter().map(OsString::from).collect() }

    #[test]
    fn arguments_keep_spaces_unicode_and_multiple_files_without_treating_flags_as_documents() {
        let cwd = std::env::temp_dir();
        let paths = document_arguments(args(&["Vulgar Notes.exe", "研究 α.vulgar", "other.JSON", "--debug", "--configuration.json", "skip.txt"]), &cwd);
        assert_eq!(paths, vec![cwd.join("研究 α.vulgar"), cwd.join("other.JSON")]);
    }

    #[test]
    fn arguments_ignore_executable_and_support_explicit_separator() {
        let cwd = std::env::temp_dir();
        let paths = document_arguments(args(&["executable.vulgar", "--", "-actual.vulgar"]), &cwd);
        assert_eq!(paths, vec![cwd.join("-actual.vulgar")]);
    }

    #[test]
    fn absolute_arguments_do_not_use_another_instances_working_directory() {
        let path = std::env::temp_dir().join("absolute document.vulgar");
        let cwd = std::env::temp_dir().join("different-instance-cwd");
        assert_eq!(document_arguments(vec!["app".into(), path.clone().into_os_string()], &cwd), vec![path]);
    }

    #[test]
    fn startup_assigns_only_first_request_to_main_and_drains_others_once() {
        let state = SystemDocuments::with_startup(vec!["first.vulgar".into(), "second.vulgar".into(), "third.vulgar".into()]);
        assert_eq!(state.take("main").unwrap(), Some("first.vulgar".into()));
        assert_eq!(state.take("main").unwrap(), None);
        assert_eq!(state.take_remaining_startup().unwrap(), vec![PathBuf::from("second.vulgar"), PathBuf::from("third.vulgar")]);
        assert!(state.take_remaining_startup().unwrap().is_empty());
    }

    #[test]
    fn window_requests_are_isolated_and_unknown_windows_cannot_claim_other_paths() {
        let state = SystemDocuments::default();
        state.assign("document-system-1", "one.vulgar".into()).unwrap();
        state.assign("document-system-2", "two.vulgar".into()).unwrap();
        assert_eq!(state.take("main").unwrap(), None);
        assert_eq!(state.take("document-system-2").unwrap(), Some("two.vulgar".into()));
        assert_eq!(state.take("document-system-2").unwrap(), None);
        assert_eq!(state.take("document-system-1").unwrap(), Some("one.vulgar".into()));
    }

    #[test]
    fn concurrent_claims_consume_a_request_exactly_once() {
        let state = Arc::new(SystemDocuments::with_startup(vec!["one.vulgar".into()]));
        let claims: Vec<_> = (0..12).map(|_| {
            let state = state.clone();
            std::thread::spawn(move || state.take("main").unwrap().is_some())
        }).collect();
        assert_eq!(claims.into_iter().map(|claim| claim.join().unwrap()).filter(|claimed| *claimed).count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn canonical_windows_paths_are_returned_without_verbatim_prefixes() {
        assert_eq!(ordinary_path(PathBuf::from(r"\\?\C:\研究\paper.vulgar")).unwrap(), PathBuf::from(r"C:\研究\paper.vulgar"));
        assert_eq!(ordinary_path(PathBuf::from(r"\\?\UNC\server\share\paper.vulgar")).unwrap(), PathBuf::from(r"\\server\share\paper.vulgar"));
    }

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(1);
            let path = std::env::temp_dir().join(format!("vulgar-system-documents-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn reads_current_file_text_and_returns_a_normal_absolute_save_target() {
        let directory = TestDirectory::new();
        let path = directory.0.join("研究 notes.vulgar");
        let source = r#"{"title":"正文 α"}"#;
        fs::write(&path, source).unwrap();
        let opened = read_requested_document(path.clone()).unwrap();
        assert_eq!(opened.name, "研究 notes.vulgar");
        assert_eq!(opened.text, source);
        assert_eq!(PathBuf::from(opened.path), ordinary_path(fs::canonicalize(path).unwrap()).unwrap());
    }

    #[test]
    fn missing_documents_and_directories_return_errors_instead_of_panicking() {
        let directory = TestDirectory::new();
        assert!(read_requested_document(directory.0.join("missing.vulgar")).unwrap_err().contains("Could not open document"));
        assert!(read_requested_document(directory.0.clone()).unwrap_err().contains("not a file"));
    }

    #[test]
    fn invalid_utf8_returns_a_read_error_while_schema_validation_stays_in_the_frontend() {
        let directory = TestDirectory::new();
        let path = directory.0.join("invalid.vulgar");
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_requested_document(path.clone()).unwrap_err().contains("Could not read document"));
        fs::write(&path, "a malformed document").unwrap();
        assert_eq!(read_requested_document(path).unwrap().text, "a malformed document");
    }
}
