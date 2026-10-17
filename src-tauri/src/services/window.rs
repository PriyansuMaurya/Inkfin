//! Platform window behaviour.
//!
//! The webview never decides how the native window behaves. Keeping the policy
//! here means macOS can follow its dock convention without changing the
//! Windows close-to-exit path, and both platforms share the same activation
//! helper used by launch events.

use tauri::{AppHandle, Manager};

/// Bring the single main window to the front, restoring it if it was hidden.
///
/// Used by both the second-instance callback and the macOS `Opened`/`Reopen`
/// events, so "open a file" and "click the dock icon" behave the same way.
pub fn focus_main(app: &AppHandle) {
    // A launch or dock click should activate the application, not just its
    // window. `show` is the macOS application-level activation call.
    #[cfg(target_os = "macos")]
    let _ = app.show();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Apply the platform's close policy to window events.
///
/// macOS applications stay alive with no visible window; closing the last
/// window hides it so the dock icon can reopen the same document. Windows keeps
/// the existing behaviour, where closing the window ends the app.
pub fn on_window_event<R: tauri::Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    #[cfg(target_os = "macos")]
    {
        if window.label() == "main" {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // No platform-specific policy: keep the default close behaviour.
        let _ = (window, event);
    }
}
