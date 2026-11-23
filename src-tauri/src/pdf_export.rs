// SPDX-License-Identifier: GPL-3.0-or-later
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfOptions {
    pub(crate) paper: String,
    pub(crate) landscape: bool,
    pub(crate) margin_mm: f64,
    // Page numbers are part of the print document's @page margin boxes. Native
    // headers/footers stay disabled so Chromium cannot add another number/URL.
    pub(crate) page_numbers: bool,
}

impl PdfOptions {
    fn paper_mm(&self) -> Result<(f64, f64), String> {
        let dimensions = match self.paper.as_str() {
            "a4" => (210.0, 297.0),
            "letter" => (215.9, 279.4),
            _ => return Err("Invalid PDF paper size.".into()),
        };
        if !self.margin_mm.is_finite() || !(5.0..=40.0).contains(&self.margin_mm) {
            return Err("PDF margins must be between 5 and 40 mm.".into());
        }
        Ok(dimensions)
    }

    fn content_width_px(&self) -> Result<f64, String> {
        let (width, height) = self.paper_mm()?;
        Ok(((if self.landscape { height } else { width }) - self.margin_mm * 2.0) * 96.0 / 25.4)
    }
}

fn suggested_pdf_name(value: &str) -> String {
    let name: String = value.rsplit(['/', '\\']).next().unwrap_or("").chars()
        .filter(|ch| !ch.is_control() && !matches!(ch, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(160).collect();
    let name = name.trim().trim_end_matches(['.', ' ']);
    if name.is_empty() { "document.pdf".into() }
    else if name.to_ascii_lowercase().ends_with(".pdf") { name.into() }
    else { format!("{name}.pdf") }
}

/// The print view accepts only the already-typeset, self-contained document.
/// Put an additional policy before all supplied content. Document scripts are
/// also disabled by WebView2; only our host-injected readiness probe runs.
fn print_document(html: String) -> Result<String, String> {
    let lower = html.chars().take(4096).collect::<String>().to_ascii_lowercase();
    let Some(head) = lower.find("<head>") else { return Err("The PDF print document is invalid.".into()) };
    if html.contains('\0') { return Err("The PDF print document is invalid.".into()); }
    let mut result = html;
    result.insert_str(head + 6, "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'\">");
    Ok(result)
}

#[tauri::command]
pub async fn export_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    html: String,
    suggested_name: String,
    options: PdfOptions,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        // This entry point cannot be used by the temporary print webview.
        if window.label() != "main" && !window.label().starts_with("document-") {
            return Err("PDF export is unavailable in this window.".into());
        }
        options.paper_mm()?;
        let html = print_document(html)?;
        let guard = native::ExportGuard::acquire()?;
        tauri::async_runtime::spawn_blocking(move || {
            use tauri_plugin_dialog::DialogExt;
            let _guard = guard;
            let selected = app.dialog().file().set_parent(&window)
                .set_file_name(suggested_pdf_name(&suggested_name))
                .add_filter("PDF", &["pdf"]).blocking_save_file();
            let Some(selected) = selected else { return Ok(false) };
            let target = selected.into_path().map_err(|_| "The PDF destination is invalid.".to_string())?;
            if !target.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")) {
                return Err("Please use the .pdf extension.".into());
            }
            native::print_to_path(&app, html, target, options)?;
            Ok(true)
        }).await.map_err(|_| "PDF export could not finish.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, window, html, suggested_name, options);
        Err("Direct PDF export is currently available on Windows only.".into())
    }
}

#[cfg(windows)]
pub(crate) mod native {
    use super::PdfOptions;
    use std::{
        fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf},
        sync::{atomic::{AtomicBool, AtomicU64, Ordering}, mpsc, Arc, Mutex},
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::*, take_pwstr,
        NavigationCompletedEventHandler,
        PrintToPdfCompletedHandler, ProcessFailedEventHandler, WebMessageReceivedEventHandler,
    };
    use windows::core::{Interface, HSTRING, PWSTR};

    static EXPORT_ACTIVE: AtomicBool = AtomicBool::new(false);
    static SEQUENCE: AtomicU64 = AtomicU64::new(1);
    // This synchronous host probe runs even with document scripts disabled.
    // Promises/timers inside an invisible WebView can remain suspended. Polling
    // from the host avoids that, while still requiring real resource readiness.
    const READY_PROBE: &str = r#"(()=>{
      if(window.__vulgarPdfStarted||document.readyState!=='complete')return;
      const images=Array.from(document.images);for(const image of images)image.loading='eager';
      void document.documentElement.offsetHeight;
      const fonts=Array.from(document.fonts);
      const font=fonts.find(f=>f.status==='error');
      const index=images.findIndex(image=>image.complete&&!image.naturalWidth);
      if(font||index>=0){
        window.__vulgarPdfStarted=true;chrome.webview.postMessage(font?'PDF font: '+font.family:'PDF image: '+(index+1));return;
      }
      if(document.fonts.status!=='loaded'||images.some(image=>!image.complete)){window.__vulgarPdfReadyAt=0;return;}
      const now=performance.now();if(!window.__vulgarPdfReadyAt){window.__vulgarPdfReadyAt=now;return;}
      if(now-window.__vulgarPdfReadyAt<100)return;
      window.__vulgarPdfStarted=true;chrome.webview.postMessage('vulgar-pdf-ready');
    })();"#;
    pub(super) struct ExportGuard;
    impl ExportGuard {
        pub(super) fn acquire() -> Result<Self, String> {
            EXPORT_ACTIVE.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map(|_| Self).map_err(|_| "A PDF export is already in progress.".into())
        }
    }
    impl Drop for ExportGuard { fn drop(&mut self) { EXPORT_ACTIVE.store(false, Ordering::Release); } }

    fn identifier() -> String {
        format!("{}-{}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos())
    }

    type EventHooks = Arc<Mutex<Vec<(u8, i64)>>>;
    struct TemporaryDocument { directory: PathBuf, window: Option<WebviewWindow>, hooks: EventHooks }
    impl TemporaryDocument {
        fn create(html: &str) -> Result<Self, String> {
            let directory = std::env::temp_dir().join(format!("vulgar-notes-pdf-{}", identifier()));
            fs::create_dir(&directory).map_err(|_| "The temporary PDF document could not be created.".to_string())?;
            let temporary = Self { directory, window: None, hooks: Arc::default() };
            fs::write(temporary.html_path(), html).map_err(|_| "The temporary PDF document could not be written.".to_string())?;
            Ok(temporary)
        }
        fn html_path(&self) -> PathBuf { self.directory.join("document.html") }
        fn pdf_path(&self) -> PathBuf { self.directory.join("document.pdf") }
    }
    impl Drop for TemporaryDocument {
        fn drop(&mut self) {
            if let Some(window) = self.window.take() {
                let hooks = self.hooks.clone();let (sent, received) = mpsc::channel();
                // Release event handlers which hold the PDF COM interface
                // before destroying the view, including after early failures.
                if window.with_webview(move |platform| {
                    unsafe {
                        if let (Ok(core), Ok(mut hooks)) = (platform.controller().CoreWebView2(), hooks.lock()) {
                            for (kind, token) in hooks.drain(..) {
                                let _ = match kind { 0=>core.remove_WebMessageReceived(token),
                                    1=>core.remove_NavigationCompleted(token), _=>core.remove_ProcessFailed(token) };
                            }
                        }
                    }
                    let _ = sent.send(());
                }).is_ok() { let _ = received.recv_timeout(Duration::from_secs(2)); }
                let _ = window.destroy();
            }
            // Only remove the two files created for this job. Chromium may take
            // a moment to release the navigation handle after window teardown.
            for _ in 0..20 {
                let _ = fs::remove_file(self.html_path());
                let _ = fs::remove_file(self.pdf_path());
                if fs::remove_dir(&self.directory).is_ok() { break; }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }

    struct PendingDestination(PathBuf);
    impl Drop for PendingDestination { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }
    fn save_completed_pdf(source: &Path, target: &Path) -> Result<(), String> {
        let mut file = File::open(source).map_err(|_| "The generated PDF could not be read.".to_string())?;
        let mut header = [0; 5];
        file.read_exact(&mut header).map_err(|_| "PDF generation did not produce a complete file.".to_string())?;
        if &header != b"%PDF-" { return Err("PDF generation did not produce a valid file.".into()); }
        let parent = target.parent().ok_or_else(|| "The PDF destination is invalid.".to_string())?;
        let pending = PendingDestination(parent.join(format!(".vulgar-notes-pdf-{}.tmp", identifier())));
        let mut output = OpenOptions::new().write(true).create_new(true).open(&pending.0)
            .map_err(|_| "The PDF destination could not be written.".to_string())?;
        output.write_all(&header).and_then(|_| std::io::copy(&mut file, &mut output).map(|_| ()))
            .and_then(|_| output.sync_all()).map_err(|_| "The PDF destination could not be written.".to_string())?;
        drop(output);
        fs::rename(&pending.0, target).map_err(|_| "The PDF destination could not be replaced.".to_string())
    }

    /// Called off the UI thread. The only destination passed here comes from a
    /// native Save dialog; the frontend never supplies an arbitrary output path.
    pub(crate) fn print_to_path(app: &AppHandle, html: String, target: PathBuf, options: PdfOptions) -> Result<(), String> {
        let mut temporary = TemporaryDocument::create(&html)?;
        let url = tauri::Url::from_file_path(temporary.html_path()).map_err(|_| "The PDF document URL is invalid.".to_string())?;
        let expected = url.as_str().to_string();
        let allow = expected.clone();
        let profile = std::env::var_os("VULGAR_PDF_PROFILE").is_some();
        let start = Instant::now();
        let print_window = WebviewWindowBuilder::new(app, format!("pdf-export-{}", identifier()), WebviewUrl::External("about:blank".parse().unwrap()))
            .title("PDF export").visible(false).focused(false).skip_taskbar(true).decorations(false)
            .inner_size(options.content_width_px()?.ceil(), 1100.0).resizable(false)
            .disable_drag_drop_handler().devtools(false)
            .on_navigation(move |url| url.as_str() == "about:blank" || url.as_str() == allow)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build().map_err(|_| "The PDF rendering window could not be created.".to_string())?;
        let built = Instant::now();
        if profile { eprintln!("window_ms={:.2}", (built-start).as_secs_f64()*1000.0); }
        temporary.window = Some(print_window.clone());
        let (send, receive) = mpsc::channel();
        let failed = send.clone();
        let output = temporary.pdf_path();let hooks = temporary.hooks.clone();
        print_window.with_webview(move |platform| {
            if attach_and_navigate(platform, expected, output, options, send, hooks, built, profile).is_err() {
                let _ = failed.send(Err("PDF rendering could not start.".into()));
            }
        }).map_err(|_| "The PDF renderer is unavailable.".to_string())?;
        let deadline=Instant::now()+Duration::from_secs(120);
        loop {
            match receive.recv_timeout(Duration::from_millis(50)) {
                Ok(result)=>{result?;break;},
                Err(mpsc::RecvTimeoutError::Disconnected)=>return Err("The PDF renderer is unavailable.".into()),
                Err(mpsc::RecvTimeoutError::Timeout)=>{}
            }
            if Instant::now()>=deadline { return Err("PDF export timed out.".into()); }
            print_window.eval(READY_PROBE).map_err(|_| "The PDF resources could not be checked.".to_string())?;
        }
        let write = Instant::now();
        let saved = save_completed_pdf(&temporary.pdf_path(), &target);
        if profile { eprintln!("write_ms={:.2}",write.elapsed().as_secs_f64()*1000.0); }
        saved
    }

    fn attach_and_navigate(platform: tauri::webview::PlatformWebview, expected: String, output: PathBuf,
        options: PdfOptions, send: mpsc::Sender<Result<(), String>>, hooks: EventHooks, built: Instant, profile: bool) -> windows::core::Result<()> {
        unsafe {
            let core = platform.controller().CoreWebView2()?;
            let settings = core.Settings()?;
            settings.SetIsScriptEnabled(false)?;
            settings.SetAreDefaultScriptDialogsEnabled(false)?;
            settings.SetAreDevToolsEnabled(false)?;
            settings.SetAreDefaultContextMenusEnabled(false)?;
            settings.SetIsWebMessageEnabled(true)?;
            platform.controller().SetZoomFactor(1.0)?;
            // The operating-system window remains hidden. Enabling its child
            // controller lets Chromium perform layout/font loading normally.
            platform.controller().SetIsVisible(true)?;
            let print_settings = platform.environment().cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
            if let Ok(extended) = print_settings.cast::<ICoreWebView2PrintSettings2>() {
                extended.SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)?;
            }
            let (width, height) = options.paper_mm().expect("validated PDF dimensions");
            print_settings.SetPageWidth(width / 25.4)?;
            print_settings.SetPageHeight(height / 25.4)?;
            print_settings.SetOrientation(if options.landscape { COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE } else { COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT })?;
            let margin = options.margin_mm / 25.4;
            print_settings.SetMarginTop(margin)?;print_settings.SetMarginRight(margin)?;
            print_settings.SetMarginBottom(margin)?;print_settings.SetMarginLeft(margin)?;
            print_settings.SetScaleFactor(1.0)?;
            print_settings.SetShouldPrintBackgrounds(true)?;
            print_settings.SetShouldPrintSelectionOnly(false)?;
            print_settings.SetShouldPrintHeaderAndFooter(false)?;
            let _ = options.page_numbers; // Controlled exclusively by the document's CSS.
            let pdf = core.cast::<ICoreWebView2_7>()?;
            let started = Arc::new(AtomicBool::new(false));
            let done = Arc::new(AtomicBool::new(false));
            let expected_message = expected.clone();
            let result = send.clone();
            let already_done = done.clone();
            let mut token = 0;
            core.add_WebMessageReceived(&WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut source = PWSTR::null();args.Source(&mut source)?;
                if take_pwstr(source) != expected_message { return Ok(()); }
                let mut message = PWSTR::null();args.TryGetWebMessageAsString(&mut message)?;
                match take_pwstr(message).as_str() {
                    "vulgar-pdf-ready" if !started.swap(true, Ordering::AcqRel) => {
                        let generate = Instant::now();
                        if profile { eprintln!("resources_ms={:.2}",(generate-built).as_secs_f64()*1000.0); }
                        let completed_result = result.clone();let done = already_done.clone();
                        let completed = PrintToPdfCompletedHandler::create(Box::new(move |error, successful| {
                            if profile { eprintln!("generate_ms={:.2}",generate.elapsed().as_secs_f64()*1000.0); }
                            if !done.swap(true, Ordering::AcqRel) {
                                let outcome = if error.is_ok() && successful { Ok(()) }
                                    else { Err("PDF generation failed.".into()) };
                                let _ = completed_result.send(outcome);
                            }
                            Ok(())
                        }));
                        if pdf.PrintToPdf(&HSTRING::from(output.as_os_str()), &print_settings, &completed).is_err() {
                            if !already_done.swap(true, Ordering::AcqRel) { let _ = result.send(Err("PDF generation failed.".into())); }
                        }
                    }
                    reason if reason.starts_with("PDF font: ") || reason.starts_with("PDF image: ") => {
                        if !already_done.swap(true, Ordering::AcqRel) { let _ = result.send(Err(reason.to_owned())); }
                    }
                    _ => {}
                }
                Ok(())
            })), &mut token)?;
            if let Ok(mut hooks) = hooks.lock() { hooks.push((0, token)); }
            let expected_navigation = expected.clone();
            let probe_result = send.clone();let probe_done = done.clone();
            core.add_NavigationCompleted(&NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                let (Some(sender), Some(args)) = (sender, args) else { return Ok(()) };
                let mut source = PWSTR::null();sender.Source(&mut source)?;
                if take_pwstr(source) != expected_navigation { return Ok(()); }
                let mut successful = false.into();args.IsSuccess(&mut successful)?;
                if !successful.as_bool() {
                    if !probe_done.swap(true, Ordering::AcqRel) { let _ = probe_result.send(Err("The PDF print document could not be loaded.".into())); }
                    return Ok(());
                }
                Ok(())
            })), &mut token)?;
            if let Ok(mut hooks) = hooks.lock() { hooks.push((1, token)); }
            core.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, _| {
                if !done.swap(true, Ordering::AcqRel) { let _ = send.send(Err("The PDF rendering process stopped unexpectedly.".into())); }
                Ok(())
            })), &mut token)?;
            if let Ok(mut hooks) = hooks.lock() { hooks.push((2, token)); }
            core.Navigate(&HSTRING::from(expected))?;
            Ok(())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn completed_pdf_replaces_destination_and_invalid_pdf_preserves_it() {
            let temporary = TemporaryDocument::create("<html><head></head></html>").unwrap();
            let destination = temporary.directory.join("result.pdf");
            fs::write(&destination, b"original").unwrap();
            fs::write(temporary.pdf_path(), b"invalid").unwrap();
            assert!(save_completed_pdf(&temporary.pdf_path(), &destination).is_err());
            assert_eq!(fs::read(&destination).unwrap(), b"original");
            fs::write(temporary.pdf_path(), b"%PDF-1.7\nnew").unwrap();
            save_completed_pdf(&temporary.pdf_path(), &destination).unwrap();
            assert_eq!(fs::read(&destination).unwrap(), b"%PDF-1.7\nnew");
            fs::remove_file(destination).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paper_dimensions_and_margins_are_bounded() {
        let mut options = PdfOptions { paper:"a4".into(), landscape:false, margin_mm:20.0, page_numbers:true };
        assert!((options.content_width_px().unwrap() - 642.519685).abs() < 0.0001);
        options.landscape = true;
        assert!((options.content_width_px().unwrap() - 971.338583).abs() < 0.0001);
        for margin in [f64::NAN, f64::INFINITY, -1.0, 4.9, 40.1] {
            options.margin_mm = margin;assert!(options.paper_mm().is_err());
        }
        options.margin_mm = 20.0;options.paper = "custom".into();assert!(options.paper_mm().is_err());
    }
    #[test]
    fn suggested_names_never_carry_paths_or_controls() {
        assert_eq!(suggested_pdf_name("C:\\notes\\a:b.pdf"), "ab.pdf");
        assert_eq!(suggested_pdf_name("../Title\n"), "Title.pdf");
        assert_eq!(suggested_pdf_name("..."), "document.pdf");
    }
    #[test]
    fn document_policy_precedes_supplied_content() {
        let html = print_document("<!doctype html><html><head><script>bad()</script></head><body>text</body></html>".into()).unwrap();
        assert!(html.find("script-src 'none'").unwrap() < html.find("<script>").unwrap());
        assert!(print_document("untrusted fragment".into()).is_err());
    }
}
