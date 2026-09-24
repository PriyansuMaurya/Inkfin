//! Markdown Preview native shell.
//!
//! The shell owns everything that touches the machine: window creation, the
//! single-instance queue, validated read-only file access, the file watcher and
//! opening external links. The webview only ever renders what these commands
//! hand it.

pub mod commands;
pub mod errors;
pub mod services;
pub mod state;

pub use errors::DocumentError;

use tauri::{Emitter, Manager};

use state::AppState;

/// Queue a path requested by Explorer or by a second launch.
fn queue_launch(app: &tauri::AppHandle, path: String) {
    let state = app.state::<AppState>();
    state.push_pending_launch(path);
}

pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be registered before every other
        // plugin so a second launch is intercepted instead of opening a window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = services::launch::markdown_arg(&argv) {
                queue_launch(app, path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            // The queue is the source of truth; the event is only a nudge, so a
            // launch that arrives before the webview is listening is not lost.
            let _ = app.emit("launch_requested", ());
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::assets::read_relative_image,
            commands::document::active_document,
            commands::document::get_pending_launch,
            commands::document::open_document,
            commands::document::open_external_link,
            commands::document::open_linked_document,
            commands::document::reload_document,
        ])
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = services::launch::markdown_arg(&args) {
                queue_launch(app.handle(), path);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Markdown Preview failed to start");
}
