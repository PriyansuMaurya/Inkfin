use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use notify::RecommendedWatcher;
use serde::Serialize;

use crate::errors::DocumentError;
use crate::services::paths::MAX_ASSETS_PER_DOCUMENT;

/// Immutable view of the document currently on screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    /// Monotonic id of the open that produced this snapshot.
    ///
    /// Every follow-up command and every watcher event carries it, so the
    /// frontend can address the document it currently has on screen and discard
    /// anything belonging to a document that has been replaced.
    pub generation: u64,
    pub canonical_path: String,
    pub name: String,
    pub content: String,
    pub revision: String,
    pub base_directory: String,
}

#[derive(Debug)]
pub struct ActiveDocument {
    pub snapshot: DocumentSnapshot,
    pub canonical_path: PathBuf,
    pub base_directory: PathBuf,
    pub generation: u64,
    /// Distinct assets already served for this document. Re-requesting an image
    /// that is already loaded does not consume more of the budget.
    pub loaded_assets: HashSet<PathBuf>,
}

/// Everything the native bridge remembers between commands.
///
/// A new open allocates a fresh, monotonically increasing generation. Every
/// command and every watcher callback carries the generation it was created
/// for, so responses and events from a replaced document are discarded rather
/// than applied.
#[derive(Default)]
pub struct AppState {
    document: Mutex<Option<ActiveDocument>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    pending_launch: Mutex<Vec<String>>,
    generation: AtomicU64,
}

impl AppState {
    /// Allocate the next generation. Monotonic across the whole session.
    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// A generation is current when it is the newest one allocated and a
    /// document is installed for it.
    pub fn is_current(&self, generation: u64) -> bool {
        if generation == 0 || generation != self.current_generation() {
            return false;
        }
        self.document
            .lock()
            .map(|guard| {
                guard
                    .as_ref()
                    .is_some_and(|active| active.generation == generation)
            })
            .unwrap_or(false)
    }

    pub fn snapshot(&self) -> Option<DocumentSnapshot> {
        self.document
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|active| active.snapshot.clone()))
    }

    /// Read one field from the active document when it belongs to `generation`.
    fn with_active<T>(
        &self,
        generation: u64,
        project: impl FnOnce(&ActiveDocument) -> T,
    ) -> Option<T> {
        let guard = self.document.lock().ok()?;
        let active = guard.as_ref()?;
        if active.generation != generation {
            return None;
        }
        Some(project(active))
    }

    pub fn canonical_path(&self, generation: u64) -> Option<PathBuf> {
        self.with_active(generation, |active| active.canonical_path.clone())
    }

    pub fn base_directory(&self, generation: u64) -> Option<PathBuf> {
        self.with_active(generation, |active| active.base_directory.clone())
    }

    pub fn stored_revision(&self, generation: u64) -> Option<String> {
        self.with_active(generation, |active| active.snapshot.revision.clone())
    }

    /// Install a freshly opened document.
    ///
    /// Returns `false` when a *newer* open has already won, which keeps rapid
    /// file switching ordered even if two opens interleave.
    pub fn install(
        &self,
        snapshot: DocumentSnapshot,
        generation: u64,
        canonical: PathBuf,
        base_directory: PathBuf,
    ) -> bool {
        let Ok(mut guard) = self.document.lock() else {
            return false;
        };
        if guard
            .as_ref()
            .is_some_and(|active| generation <= active.generation)
        {
            return false;
        }
        *guard = Some(ActiveDocument {
            snapshot,
            canonical_path: canonical,
            base_directory,
            generation,
            loaded_assets: HashSet::new(),
        });
        true
    }

    /// Swap in new content for the active document, keeping identity fields.
    pub fn replace_content(
        &self,
        generation: u64,
        content: String,
        revision: String,
    ) -> Option<DocumentSnapshot> {
        let mut guard = self.document.lock().ok()?;
        let active = guard.as_mut()?;
        if active.generation != generation {
            return None;
        }
        active.snapshot.content = content;
        active.snapshot.revision = revision;
        Some(active.snapshot.clone())
    }

    /// Count an asset against the per-document budget, once per distinct path.
    pub fn register_asset(&self, generation: u64, path: &Path) -> Result<(), DocumentError> {
        let mut guard = self.document.lock().map_err(|_| DocumentError::Io)?;
        let active = guard.as_mut().ok_or(DocumentError::NoActiveDocument)?;
        if active.generation != generation {
            return Err(DocumentError::StaleRevision);
        }
        if active.loaded_assets.contains(path) {
            return Ok(());
        }
        if active.loaded_assets.len() >= MAX_ASSETS_PER_DOCUMENT {
            return Err(DocumentError::BlockedAsset {
                reason: "the document references more images than the reader will load".to_string(),
            });
        }
        active.loaded_assets.insert(path.to_path_buf());
        Ok(())
    }

    /// Hold the single live watcher. Dropping the previous value stops it.
    pub fn set_watcher(&self, watcher: RecommendedWatcher) {
        if let Ok(mut guard) = self.watcher.lock() {
            *guard = Some(watcher);
        }
    }

    pub fn clear_watcher(&self) {
        if let Ok(mut guard) = self.watcher.lock() {
            *guard = None;
        }
    }

    pub fn push_pending_launch(&self, path: String) {
        if let Ok(mut guard) = self.pending_launch.lock() {
            guard.push(path);
        }
    }

    /// Queued launch paths survive until the frontend drains them, so a launch
    /// that arrives before the webview is listening is never discarded.
    pub fn take_pending_launch(&self) -> Option<String> {
        let mut guard = self.pending_launch.lock().ok()?;
        if guard.is_empty() {
            None
        } else {
            Some(guard.remove(0))
        }
    }
}
