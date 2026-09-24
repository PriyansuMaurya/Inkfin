//! Change detection for the active document.
//!
//! Editors rarely overwrite a file in place: most write a temporary file and
//! rename it over the original. Watching the *parent directory* and filtering on
//! the target file name catches both ordinary saves and rename-over-original
//! saves with one mechanism.
//!
//! Events are coalesced over a short window, reads that fail mid-save are
//! retried with a bounded backoff, and the resulting content hash is compared
//! with the revision on screen so unchanged content never triggers a re-render.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::errors::DocumentError;
use crate::services::paths;
use crate::state::AppState;

/// Coalescing window. Rapid saves inside this window produce one refresh.
const DEBOUNCE: Duration = Duration::from_millis(200);
/// Backoff for reads that fail while a save is still landing.
const RETRY_DELAY: Duration = Duration::from_millis(120);
/// Bounded retry count. Atomic saves resolve well inside this budget.
const MAX_ATTEMPTS: usize = 4;
/// Blocking wait used while no change is pending.
const IDLE_WAIT: Duration = Duration::from_secs(3600);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedPayload {
    generation: u64,
    path: String,
    revision: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnavailablePayload {
    generation: u64,
    path: String,
    reason: &'static str,
}

/// Start watching the folder that contains `target`.
///
/// The returned watcher owns the file-system subscription; dropping it stops
/// delivery, which is how replacing the active document tears the old watch
/// down.
pub fn spawn(
    app: AppHandle,
    generation: u64,
    target: PathBuf,
) -> Result<RecommendedWatcher, DocumentError> {
    let directory = target
        .parent()
        .map(Path::to_path_buf)
        .ok_or(DocumentError::Denied {
            reason: "the file has no parent folder to watch".to_string(),
        })?;

    let (sender, receiver) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |result| {
        // A send failure only means the coordinator thread has stopped.
        let _ = sender.send(result);
    })
    .map_err(|_| DocumentError::Io)?;

    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .map_err(|_| DocumentError::Io)?;

    std::thread::Builder::new()
        .name("inkfin-watch".to_string())
        .spawn(move || {
            let mut armed = false;
            loop {
                // While unarmed the thread simply blocks; the long timeout only
                // exists so the loop can be woken for shutdown bookkeeping.
                let wait = if armed { DEBOUNCE } else { IDLE_WAIT };

                match receiver.recv_timeout(wait) {
                    Ok(Ok(event)) => {
                        if event_touches(&event, &target) {
                            armed = true;
                        }
                    }
                    Ok(Err(_)) => {
                        // An OS-level watch error is treated as a change; the
                        // read below decides whether anything actually differs.
                        armed = true;
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if armed {
                            armed = false;
                            inspect(&app, generation, &target);
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .map_err(|_| DocumentError::Io)?;

    Ok(watcher)
}

/// True when an event names the file we care about.
fn event_touches(event: &Event, target: &Path) -> bool {
    let Some(target_name) = target.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    event.paths.iter().any(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(target_name))
    })
}

/// Re-read the document, retrying briefly, and signal the frontend if it moved on.
fn inspect(app: &AppHandle, generation: u64, target: &Path) {
    let state = app.state::<AppState>();
    if !state.is_current(generation) {
        return;
    }

    let mut last_error: Option<DocumentError> = None;
    for attempt in 0..MAX_ATTEMPTS {
        match paths::read_document(target) {
            Ok(content) => {
                let revision = paths::revision_of(&content);
                let on_screen = state.stored_revision(generation);
                // Re-check before emitting: the document may have been replaced
                // while this read was in flight.
                if on_screen.as_deref() != Some(revision.as_str()) && state.is_current(generation) {
                    let _ = app.emit(
                        "document_changed",
                        ChangedPayload {
                            generation,
                            path: target.to_string_lossy().to_string(),
                            revision,
                        },
                    );
                }
                return;
            }
            Err(error) => {
                // A missing or half-written file is expected mid-save, so keep
                // retrying inside the bounded budget before reporting.
                let retryable = error.is_retryable();
                last_error = Some(error);
                if !retryable || attempt + 1 == MAX_ATTEMPTS {
                    break;
                }
                std::thread::sleep(RETRY_DELAY);
            }
        }
    }

    // The last readable document stays on screen; only a warning is raised.
    // A deleted file keeps the documented `document_missing` event name; every
    // other failure is reported as `document_unavailable` with a reason code.
    if state.is_current(generation) {
        let error = last_error.unwrap_or(DocumentError::NotFound);
        let event = if matches!(error, DocumentError::NotFound) {
            "document_missing"
        } else {
            "document_unavailable"
        };
        let _ = app.emit(
            event,
            UnavailablePayload {
                generation,
                path: target.to_string_lossy().to_string(),
                reason: error.code(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{EventKind, ModifyKind, RenameMode};

    fn event(paths: Vec<PathBuf>) -> Event {
        Event {
            kind: EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            paths,
            attrs: Default::default(),
        }
    }

    #[test]
    fn events_are_matched_on_the_target_file_name() {
        let target = PathBuf::from(r"C:\docs\README.md");
        assert!(event_touches(
            &event(vec![PathBuf::from(r"C:\docs\README.md")]),
            &target
        ));
        assert!(event_touches(
            &event(vec![PathBuf::from(r"C:\docs\readme.MD")]),
            &target
        ));
        assert!(!event_touches(
            &event(vec![PathBuf::from(r"C:\docs\README.md.tmp")]),
            &target
        ));
        assert!(!event_touches(
            &event(vec![PathBuf::from(r"C:\docs\other.md")]),
            &target
        ));
        assert!(!event_touches(&event(vec![]), &target));
    }
}
