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
    let input=std::path::PathBuf::from(&args[1]); let url:tauri::Url=args[3].parse().unwrap(); assert_eq!(url.host_str(),Some("127.0.0.1"));
    let target = std::path::PathBuf::from(&args[2]);
    assert!(!target.exists(), "Use a fresh PDF destination for this smoke test");
    let options = pdf_export::PdfOptions { paper:if args.iter().any(|arg| arg=="letter") {"letter"} else {"a4"}.into(),
        landscape:args.iter().any(|arg| arg=="landscape"),
        margin_mm:args.iter().find_map(|arg| arg.strip_prefix("margin=")).map(|value| value.parse().expect("Numeric margin")).unwrap_or(20.0),page_numbers:true };
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(move |app| {
        let view=tauri::WebviewWindowBuilder::new(app,"profile-editor",tauri::WebviewUrl::External(url)).visible(false).focused(false).skip_taskbar(true).build()?;
        view.with_webview(|platform| unsafe {platform.controller().SetIsVisible(true).unwrap();})?;
        let app = app.handle().clone();
        std::thread::spawn(move || {
            let result=(|| -> Result<(),String> {for i in 1..=3 {let path=input.with_extension(format!("{i}.html"));let start=std::time::Instant::now();while !path.exists(){if start.elapsed().as_secs()>100{return Err("Timed out waiting for prepared document".into())}std::thread::sleep(std::time::Duration::from_millis(20));}let dest=target.with_extension(format!("{i}.pdf"));assert!(!dest.exists());pdf_export::native::print_to_path(&app,std::fs::read_to_string(path).unwrap(),dest,options.clone())?;}Ok(())})();
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
