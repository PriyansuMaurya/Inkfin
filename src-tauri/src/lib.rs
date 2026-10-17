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

/// Event name the webview listens on to drain the launch queue.
const LAUNCH_REQUESTED: &str = "launch_requested";

/// Queue a path the operating system asked this app to open.
///
/// Every launch entry point funnels through here — command-line arguments, a
/// second launch, a Finder/Open With Apple Event and a dock drop — so one place
/// decides what counts as a document, what is canonical and which request is
/// newest. Returns whether a document was queued.
fn queue_launch(app: &tauri::AppHandle, requested: &str) -> bool {
    let Some(path) = services::launch::resolve_launch_path(requested) else {
        return false;
    };
    app.state::<AppState>().queue_launch(path);
    // The queue is the source of truth; the event is only a nudge, so a launch
    // that arrives before the webview is listening is not lost.
    let _ = app.emit(LAUNCH_REQUESTED, ());
    true
}

pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be registered before every other
        // plugin so a second launch is intercepted instead of opening a window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = services::launch::markdown_arg(&argv) {
                queue_launch(app, &path);
            }
            services::window::focus_main(app);
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
        // Platform window policy lives here rather than in the webview: on
        // macOS the last window hides so the dock can bring it back, while
        // Windows keeps its existing close-to-exit behaviour.
        .on_window_event(services::window::on_window_event)
        .setup(|app| {
            // Command-line launches (Windows Explorer, `Inkfin.exe notes.md`).
            // macOS does not use argv for Finder opens: `RunEvent::Opened`
            // below delivers them as an Apple Event instead.
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = services::launch::markdown_arg(&args) {
                queue_launch(app.handle(), &path);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Inkfin failed to start")
        .run(|app_handle, event| {
            // macOS delivers a Finder/Open With request as an Apple Event, not
            // as a command-line argument. Queue it exactly like a CLI launch so
            // the webview still drains one launch path through the same command.
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::Opened { urls } => {
                    // A Finder multi-selection arrives as one event holding
                    // every URL. Queueing them in the order received leaves the
                    // newest one on screen, which is what the single-document
                    // model means. The payload policy itself lives in
                    // `services::launch`, where it is compiled and tested on
                    // every platform; this arm stays a thin adapter.
                    for path in services::launch::launch_paths_from_urls(&urls) {
                        queue_launch(app_handle, &path);
                    }
                    // Focus even when the payload held nothing this reader can
                    // show: the user still expects the window to come forward.
                    services::window::focus_main(app_handle);
                }
                // Clicking the dock icon while the window is hidden (because
                // the user closed it) must bring the same window back.
                tauri::RunEvent::Reopen { .. } => services::window::focus_main(app_handle),
                _ => {}
            }

            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}
