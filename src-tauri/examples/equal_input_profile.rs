// SPDX-License-Identifier: GPL-3.0-or-later
// An isolated, invisible WebView2 smoke test. It never opens the editor, reads
// user drafts, or invokes a file dialog. Pass prepared print HTML and a fresh
// PDF destination: cargo run --example pdf_export_smoke -- input.html out.pdf
#![allow(dead_code)]
#[path = "../src/pdf_export.rs"]
mod pdf_export;

#[cfg(windows)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 { eprintln!("Usage: pdf_export_smoke input.html output.pdf [landscape] [letter]");std::process::exit(2); }
    let input=std::path::PathBuf::from(&args[1]).canonicalize().unwrap(); let target=std::path::PathBuf::from(&args[2]);    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(move |app| {
        let (load,loaded)=std::sync::mpsc::channel(); let view=tauri::WebviewWindowBuilder::new(app,"profile-editor",tauri::WebviewUrl::External("about:blank".parse().unwrap())).on_page_load(move |_,e|{if e.url().scheme()=="file" && matches!(e.event(),tauri::webview::PageLoadEvent::Finished){let _=load.send(());}}).visible(false).focused(false).skip_taskbar(true).build()?;
        view.with_webview(|platform| unsafe {platform.controller().SetIsVisible(true).unwrap();})?;
        let app = app.handle().clone();
        std::thread::spawn(move || {
            let result=(|| -> Result<(),String> {for name in ["small","note1"] {for i in 0..4 {
let dest=target.join(format!("wv-{name}-{i}.pdf"));assert!(!dest.exists());
let mut url=tauri::Url::from_file_path(input.join(format!("weasy-{name}.html"))).unwrap();url.set_query(Some(&format!("run={i}")));
let (tx,rx)=std::sync::mpsc::channel();let start=std::time::Instant::now();view.navigate(url).unwrap();loaded.recv_timeout(std::time::Duration::from_secs(60)).unwrap();view.with_webview(move |p| unsafe {
use webview2_com::{Microsoft::Web::WebView2::Win32::*,PrintToPdfCompletedHandler};
use windows::core::{Interface,HSTRING};
let settings=p.environment().cast::<ICoreWebView2Environment6>().unwrap().CreatePrintSettings().unwrap();
settings.SetPageWidth(210./25.4).unwrap(); settings.SetPageHeight(297./25.4).unwrap();
settings.SetShouldPrintHeaderAndFooter(false).unwrap();settings.SetShouldPrintBackgrounds(true).unwrap();
let pdf=p.controller().CoreWebView2().unwrap().cast::<ICoreWebView2_7>().unwrap();
pdf.PrintToPdf(&HSTRING::from(dest.as_os_str()),&settings,&PrintToPdfCompletedHandler::create(Box::new(move|err,ok|{tx.send(err.is_ok() && ok).unwrap();Ok(())}))).unwrap();
}).unwrap();
assert!(rx.recv_timeout(std::time::Duration::from_secs(100)).unwrap());println!("{name} {i} {:.1}",start.elapsed().as_secs_f64()*1000.);}}Ok(())})();
            match result { Ok(())=>{println!("Native PDF smoke test succeeded.");app.exit(0);},
                Err(error)=>{eprintln!("Native PDF smoke test failed: {error}");app.exit(1);} }
        });
        Ok(())
    }).build(context).expect("Build hidden native PDF test");
    // Destroying the temporary last window must not race the explicit result
    // code returned by the worker (especially for a failed export).
    app.run(|_, event| {
        if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event { api.prevent_exit(); }
    });
}

#[cfg(not(windows))]
fn main() { eprintln!("The native PDF smoke test requires Windows WebView2.");std::process::exit(2); }
