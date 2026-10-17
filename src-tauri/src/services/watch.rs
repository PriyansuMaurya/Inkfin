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
//!
//! The loop is written against [`WatchHost`] rather than an `AppHandle` so the
//! ordering rules — debounce, stale documents, last-good preview, recovery —
//! can be driven by the test suite on every platform, including with a real
//! file-system watcher.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
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
pub struct ChangedPayload {
    generation: u64,
    path: String,
    revision: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailablePayload {
    generation: u64,
    path: String,
    reason: &'static str,
}

/// Sent when a file that had been reported missing is readable again without
/// its content having changed.
///
/// No `document_changed` event fires in that case — the revision on screen is
/// still correct — so without this the warning would stay on screen after the
/// file had come back.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredPayload {
    generation: u64,
    path: String,
}

/// Reported once when the document opened but its folder could not be watched.
///
/// macOS only permits the file the reader chose, so a document in a protected
/// folder can open while its parent folder is refused. The reader keeps a valid
/// document; they are simply not told otherwise that automatic refresh is off.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFailedPayload {
    generation: u64,
    path: String,
    reason: &'static str,
}

/// What the watch loop needs from its surroundings.
///
/// Implemented by the application for real use and by the test suite for the
/// ordering rules, so both run exactly the same loop.
pub trait WatchHost: Send + Sync + 'static {
    fn is_current(&self, generation: u64) -> bool;
    fn stored_revision(&self, generation: u64) -> Option<String>;
    fn emit_changed(&self, payload: ChangedPayload);
    fn emit_unavailable(&self, payload: UnavailablePayload);
    fn emit_recovered(&self, payload: RecoveredPayload);
}

struct AppHost(AppHandle);

impl WatchHost for AppHost {
    fn is_current(&self, generation: u64) -> bool {
        self.0.state::<AppState>().is_current(generation)
    }

    fn stored_revision(&self, generation: u64) -> Option<String> {
        self.0.state::<AppState>().stored_revision(generation)
    }

    fn emit_changed(&self, payload: ChangedPayload) {
        let _ = self.0.emit("document_changed", payload);
    }

    fn emit_unavailable(&self, payload: UnavailablePayload) {
        let event = if payload.reason == DocumentError::NotFound.code() {
            "document_missing"
        } else {
            "document_unavailable"
        };
        let _ = self.0.emit(event, payload);
    }

    fn emit_recovered(&self, payload: RecoveredPayload) {
        let _ = self.0.emit("document_recovered", payload);
    }
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
    spawn_with(Arc::new(AppHost(app)), generation, target)
}

/// Tell the renderer that this document cannot be watched.
///
/// A separate function because the caller already owns the failed `spawn`
/// result; the watcher itself no longer exists to report anything.
pub fn report_watch_failure(
    app: &AppHandle,
    generation: u64,
    target: &Path,
    error: &DocumentError,
) {
    let _ = app.emit(
        "document_watch_failed",
        WatchFailedPayload {
            generation,
            path: target.to_string_lossy().to_string(),
            reason: error.code(),
        },
    );
}

/// Start the watch loop for any host. See [`spawn`].
pub fn spawn_with(
    host: Arc<dyn WatchHost>,
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
        .spawn(move || run(host.as_ref(), generation, &target, receiver))
        .map_err(|_| DocumentError::Io)?;

    Ok(watcher)
}

fn run(
    host: &dyn WatchHost,
    generation: u64,
    target: &Path,
    receiver: mpsc::Receiver<notify::Result<Event>>,
) {
    let mut armed = false;
    // Whether the reader currently has a warning that the file is unavailable.
    // A successful read clears it, and if the content is unchanged the renderer
    // is told so the warning can go away.
    let mut unavailable = false;

    loop {
        // While unarmed the thread simply blocks; the long timeout only exists
        // so the loop can be woken for shutdown bookkeeping.
        let wait = if armed { DEBOUNCE } else { IDLE_WAIT };

        match receiver.recv_timeout(wait) {
            Ok(Ok(event)) => {
                if event_touches(&event, target) {
                    armed = true;
                }
            }
            Ok(Err(_)) => {
                // An OS-level watch error is treated as a change; the read
                // below decides whether anything actually differs.
                armed = true;
            }
            Err(RecvTimeoutError::Timeout) => {
                if armed {
                    armed = false;
                    inspect(host, generation, target, &mut unavailable);
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// True when an event names the file we care about.
///
/// Names are compared as `OsStr`: macOS file names are arbitrary bytes, and
/// requiring valid UTF-8 here would leave a document unrefreshable.
fn event_touches(event: &Event, target: &Path) -> bool {
    let Some(target_name) = target.file_name() else {
        return false;
    };
    event.paths.iter().any(|path| {
        path.file_name()
            .is_some_and(|name| same_name(name, target_name))
    })
}

fn same_name(candidate: &OsStr, expected: &OsStr) -> bool {
    if candidate == expected {
        return true;
    }
    // NTFS and default APFS are case-insensitive, and an editor that rewrites a
    // name's case is still saving the same file. A needless read is harmless:
    // the revision comparison below decides whether anything is reported.
    candidate
        .to_string_lossy()
        .eq_ignore_ascii_case(&expected.to_string_lossy())
}

/// Re-read the document, retrying briefly, and signal the frontend if it moved on.
fn inspect(host: &dyn WatchHost, generation: u64, target: &Path, unavailable: &mut bool) {
    if !host.is_current(generation) {
        return;
    }

    let mut last_error: Option<DocumentError> = None;
    for attempt in 0..MAX_ATTEMPTS {
        match paths::read_document(target) {
            Ok(content) => {
                let revision = paths::revision_of(&content);
                let on_screen = host.stored_revision(generation);
                // Re-check before emitting: the document may have been replaced
                // while this read was in flight.
                if host.is_current(generation) {
                    if on_screen.as_deref() != Some(revision.as_str()) {
                        host.emit_changed(ChangedPayload {
                            generation,
                            path: target.to_string_lossy().to_string(),
                            revision,
                        });
                    } else if *unavailable {
                        host.emit_recovered(RecoveredPayload {
                            generation,
                            path: target.to_string_lossy().to_string(),
                        });
                    }
                }
                *unavailable = false;
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
    if host.is_current(generation) {
        let error = last_error.unwrap_or(DocumentError::NotFound);
        host.emit_unavailable(UnavailablePayload {
            generation,
            path: target.to_string_lossy().to_string(),
            reason: error.code(),
        });
        *unavailable = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::Instant;

    use notify::event::{EventKind, ModifyKind, RenameMode};

    // ------------------------------------------------------------- unit rules

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

    /// The renderer drops any payload it cannot parse field by field, so a
    /// renamed or missing field would silently disable the feature instead of
    /// failing loudly. Pin the shape the bridge expects.
    #[test]
    fn watcher_payloads_match_the_bridge_contract() {
        let changed = serde_json::to_value(ChangedPayload {
            generation: 3,
            path: "/docs/a.md".to_string(),
            revision: "abc".to_string(),
        })
        .expect("serialisable");
        assert_eq!(changed["generation"], 3);
        assert_eq!(changed["path"], "/docs/a.md");
        assert_eq!(changed["revision"], "abc");

        let unavailable = serde_json::to_value(UnavailablePayload {
            generation: 3,
            path: "/docs/a.md".to_string(),
            reason: "not_found",
        })
        .expect("serialisable");
        assert_eq!(unavailable["generation"], 3);
        assert_eq!(unavailable["reason"], "not_found");

        let recovered = serde_json::to_value(RecoveredPayload {
            generation: 3,
            path: "/docs/a.md".to_string(),
        })
        .expect("serialisable");
        assert_eq!(recovered["generation"], 3);
        assert_eq!(recovered["path"], "/docs/a.md");

        let failed = serde_json::to_value(WatchFailedPayload {
            generation: 3,
            path: "/docs/a.md".to_string(),
            reason: "denied",
        })
        .expect("serialisable");
        assert_eq!(failed["generation"], 3);
        assert_eq!(failed["path"], "/docs/a.md");
        assert_eq!(failed["reason"], "denied");
    }

    /// macOS file names are not required to be UTF-8.
    #[cfg(unix)]
    #[test]
    fn a_non_utf8_document_name_still_matches_its_events() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let name = OsStr::from_bytes(b"notes-\xff.md");
        let target = PathBuf::from("/docs").join(name);
        assert!(event_touches(
            &event(vec![PathBuf::from("/docs").join(name)]),
            &target
        ));
        assert!(!event_touches(
            &event(vec![PathBuf::from("/docs/notes-other.md")]),
            &target
        ));
    }

    // ------------------------------------------------- real watcher scenarios

    #[derive(Debug, Clone, PartialEq)]
    enum Recorded {
        Changed { generation: u64, revision: String },
        Missing { generation: u64, reason: String },
        Recovered { generation: u64 },
    }

    /// The application, reduced to what the loop actually asks of it.
    #[derive(Default)]
    struct TestHost {
        current: AtomicU64,
        revision: Mutex<Option<String>>,
        events: Mutex<Vec<Recorded>>,
    }

    impl TestHost {
        fn new(generation: u64, content: &str) -> Self {
            let host = Self::default();
            host.current.store(generation, Ordering::SeqCst);
            *host.revision.lock().expect("revision lock") = Some(paths::revision_of(content));
            host
        }

        /// Simulate another document being installed over this one.
        fn replace_document(&self, generation: u64, content: &str) {
            self.current.store(generation, Ordering::SeqCst);
            *self.revision.lock().expect("revision lock") = Some(paths::revision_of(content));
        }

        fn revision(&self) -> Option<String> {
            self.revision.lock().expect("revision lock").clone()
        }

        fn events(&self) -> Vec<Recorded> {
            self.events.lock().expect("event lock").clone()
        }
    }

    impl WatchHost for TestHost {
        fn is_current(&self, generation: u64) -> bool {
            generation != 0
                && self.current.load(Ordering::SeqCst) == generation
                && self.stored_revision(generation).is_some()
        }

        fn stored_revision(&self, generation: u64) -> Option<String> {
            if self.current.load(Ordering::SeqCst) != generation {
                return None;
            }
            self.revision()
        }

        fn emit_changed(&self, payload: ChangedPayload) {
            self.events
                .lock()
                .expect("event lock")
                .push(Recorded::Changed {
                    generation: payload.generation,
                    revision: payload.revision,
                });
        }

        fn emit_unavailable(&self, payload: UnavailablePayload) {
            self.events
                .lock()
                .expect("event lock")
                .push(Recorded::Missing {
                    generation: payload.generation,
                    reason: payload.reason.to_string(),
                });
        }

        fn emit_recovered(&self, payload: RecoveredPayload) {
            self.events
                .lock()
                .expect("event lock")
                .push(Recorded::Recovered {
                    generation: payload.generation,
                });
        }
    }

    /// A fresh, canonical fixture folder so parallel tests never share one.
    fn fixture(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("inkfin-watch-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("create fixture folder");
        paths::canonicalize(&directory).expect("canonical fixture folder")
    }

    fn start(root: &Path, name: &str, content: &str) -> (PathBuf, Arc<TestHost>) {
        let target = root.join(name);
        std::fs::write(&target, content).expect("write fixture document");
        let host = Arc::new(TestHost::new(1, content));
        (target, host)
    }

    fn wait_for(host: &TestHost, ready: impl Fn(&[Recorded]) -> bool) -> Vec<Recorded> {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let events = host.events();
            if ready(&events) {
                return events;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for a watcher event; saw {events:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Longer than a debounce window, for assertions that nothing more arrives.
    const QUIET: Duration = Duration::from_millis(700);

    #[test]
    fn an_ordinary_in_place_save_refreshes_once() {
        let root = fixture("ordinary");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        std::fs::write(&target, "# two").expect("save");
        let events = wait_for(&host, |seen| !seen.is_empty());
        assert_eq!(
            events,
            vec![Recorded::Changed {
                generation: 1,
                revision: paths::revision_of("# two"),
            }]
        );

        // A second event from the same save must not produce a second refresh.
        std::thread::sleep(QUIET);
        assert_eq!(host.events().len(), 1);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_rename_over_the_original_refreshes_like_an_ordinary_save() {
        let root = fixture("atomic");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        // What vim, JetBrains and most editors do: write elsewhere, then rename
        // the temporary file over the document.
        let temporary = root.join(".notes.md.swp");
        std::fs::write(&temporary, "# atomic").expect("write temporary file");
        std::fs::rename(&temporary, &target).expect("rename over the original");

        let events = wait_for(&host, |seen| !seen.is_empty());
        assert_eq!(
            events,
            vec![Recorded::Changed {
                generation: 1,
                revision: paths::revision_of("# atomic"),
            }]
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rapid_saves_coalesce_into_one_refresh_of_the_final_content() {
        let root = fixture("burst");
        let (target, host) = start(&root, "notes.md", "# zero");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        for index in 1..=6 {
            std::fs::write(&target, format!("# write {index}")).expect("save");
            std::thread::sleep(Duration::from_millis(25));
        }

        wait_for(&host, |seen| !seen.is_empty());
        std::thread::sleep(QUIET);

        let events = host.events();
        assert_eq!(
            events.len(),
            1,
            "one burst must produce one refresh: {events:?}"
        );
        assert_eq!(
            events,
            vec![Recorded::Changed {
                generation: 1,
                revision: paths::revision_of("# write 6"),
            }]
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn another_file_in_the_folder_does_not_arm_the_watcher() {
        let root = fixture("sibling");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        std::fs::write(root.join("other.md"), "# other").expect("write sibling");
        std::thread::sleep(QUIET);

        assert!(
            host.events().is_empty(),
            "a sibling must not refresh this document"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_change_for_a_document_that_was_replaced_is_dropped() {
        let root = fixture("stale");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        // Another document is now on screen; generation 1 is no longer current.
        host.replace_document(2, "# other document");
        std::fs::write(&target, "# two").expect("save the replaced document");
        std::thread::sleep(QUIET);

        assert!(
            host.events().is_empty(),
            "events from a replaced document must be ignored"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deleting_the_document_keeps_the_last_readable_preview() {
        let root = fixture("deleted");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");
        let before = host.revision();

        std::fs::remove_file(&target).expect("delete the document");
        let events = wait_for(&host, |seen| {
            seen.iter()
                .any(|item| matches!(item, Recorded::Missing { .. }))
        });

        assert_eq!(
            events,
            vec![Recorded::Missing {
                generation: 1,
                reason: "not_found".to_string(),
            }],
            "only the warning is raised; no empty document is installed"
        );
        assert_eq!(
            host.revision(),
            before,
            "the last good revision must stay on screen"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// A document replaced by a folder (or any other non-file) is not a
    /// transient state, so it is reported at once and the preview stays.
    #[test]
    fn a_document_replaced_by_a_folder_is_reported_as_not_a_file() {
        let root = fixture("folder");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        std::fs::remove_file(&target).expect("remove the document");
        std::fs::create_dir_all(&target).expect("replace it with a folder");

        let events = wait_for(&host, |seen| {
            seen.iter()
                .any(|item| matches!(item, Recorded::Missing { .. }))
        });
        assert_eq!(
            events,
            vec![Recorded::Missing {
                generation: 1,
                reason: "not_a_file".to_string(),
            }]
        );
        assert_eq!(host.revision(), Some(paths::revision_of("# one")));

        std::fs::remove_dir_all(&root).ok();
    }

    /// Mid-save the file can hold bytes that are not valid UTF-8. That is a
    /// transient state, so the reader is retried briefly before being told.
    #[test]
    fn a_half_written_file_is_retried_before_it_is_reported() {
        let root = fixture("half-written");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        std::fs::write(&target, [0xff, 0xfe, 0x00]).expect("write a partial save");

        let events = wait_for(&host, |seen| {
            seen.iter()
                .any(|item| matches!(item, Recorded::Missing { .. }))
        });
        assert_eq!(
            events,
            vec![Recorded::Missing {
                generation: 1,
                reason: "invalid_utf8".to_string(),
            }]
        );
        assert_eq!(host.revision(), Some(paths::revision_of("# one")));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_document_that_returns_unchanged_clears_the_warning() {
        let root = fixture("recovered");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        std::fs::remove_file(&target).expect("delete the document");
        wait_for(&host, |seen| {
            seen.iter()
                .any(|item| matches!(item, Recorded::Missing { .. }))
        });

        // Same bytes as before the deletion: no `changed` event would fire, so
        // recovery has to be reported explicitly.
        std::fs::write(&target, "# one").expect("restore the same content");
        wait_for(&host, |seen| {
            seen.iter()
                .any(|item| matches!(item, Recorded::Recovered { .. }))
        });

        let events = host.events();
        assert!(
            !events
                .iter()
                .any(|item| matches!(item, Recorded::Changed { .. })),
            "unchanged content must not re-render: {events:?}"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_document_that_returns_with_new_content_refreshes() {
        let root = fixture("returned");
        let (target, host) = start(&root, "notes.md", "# one");
        let _watcher = spawn_with(host.clone(), 1, target.clone()).expect("watch");

        std::fs::remove_file(&target).expect("delete the document");
        wait_for(&host, |seen| {
            seen.iter()
                .any(|item| matches!(item, Recorded::Missing { .. }))
        });

        std::fs::write(&target, "# restored").expect("restore with new content");
        let events = wait_for(&host, |seen| {
            seen.iter()
                .any(|item| matches!(item, Recorded::Changed { .. }))
        });

        assert!(
            events.contains(&Recorded::Changed {
                generation: 1,
                revision: paths::revision_of("# restored"),
            }),
            "the restored content must be reported: {events:?}"
        );

        std::fs::remove_dir_all(&root).ok();
    }
}
