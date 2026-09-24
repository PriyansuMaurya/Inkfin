//! Read-only document commands exposed to the reading surface.
//!
//! The frontend never receives a generic filesystem capability. Each command
//! validates its own input on this side, and a new open invalidates every
//! request that belonged to the previous document.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::errors::DocumentError;
use crate::services::{paths, watch};
use crate::state::{AppState, DocumentSnapshot};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadResult {
    pub changed: bool,
    pub snapshot: DocumentSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedDocument {
    pub snapshot: DocumentSnapshot,
    pub fragment: Option<String>,
}

/// Build the serialisable view without round-tripping paths through a string,
/// which would be lossy for paths holding non-UTF-8 characters.
fn build_snapshot(
    canonical: &Path,
    content: String,
    generation: u64,
) -> Result<(DocumentSnapshot, PathBuf), DocumentError> {
    let base_directory = canonical.parent().ok_or(DocumentError::Denied {
        reason: "the file has no parent folder".to_string(),
    })?;

    let snapshot = DocumentSnapshot {
        generation,
        canonical_path: canonical.to_string_lossy().to_string(),
        name: canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("document")
            .to_string(),
        revision: paths::revision_of(&content),
        base_directory: base_directory.to_string_lossy().to_string(),
        content,
    };

    Ok((snapshot, base_directory.to_path_buf()))
}

/// Publish a new active document and atomically replace the file watch.
///
/// If a newer open has already won the race, `StaleRevision` is returned rather
/// than a snapshot: the caller's response is obsolete, and returning it would
/// hand the frontend a generation that the native state has already moved past.
fn install(
    app: &AppHandle,
    canonical: PathBuf,
    content: String,
) -> Result<DocumentSnapshot, DocumentError> {
    let state = app.state::<AppState>();
    // Allocate before installing so two interleaved opens are ordered by
    // generation: the older one loses and never becomes the active document.
    let generation = state.next_generation();
    let (snapshot, base_directory) = build_snapshot(&canonical, content, generation)?;

    if !state.install(
        snapshot.clone(),
        generation,
        canonical.clone(),
        base_directory,
    ) {
        return Err(DocumentError::StaleRevision);
    }

    // A failed watch is not fatal: the reader still has a valid document, it
    // simply will not refresh until the file is reopened.
    match watch::spawn(app.clone(), generation, canonical) {
        Ok(watcher) => state.set_watcher(watcher),
        Err(_) => state.clear_watcher(),
    }

    Ok(snapshot)
}

/// Open a document chosen by the user, the OS or a validated drop.
#[tauri::command]
pub fn open_document(app: AppHandle, path: String) -> Result<DocumentSnapshot, DocumentError> {
    let canonical = paths::validate_document_path(&path)?;
    let content = paths::read_document(&canonical)?;
    install(&app, canonical, content)
}

/// Follow a relative Markdown link from the active document.
///
/// The target must resolve inside the active document's own folder after
/// symlinks are resolved, so a link in untrusted Markdown cannot widen the
/// readable root.
#[tauri::command]
pub fn open_linked_document(
    app: AppHandle,
    generation: u64,
    link: String,
) -> Result<LinkedDocument, DocumentError> {
    let state = app.state::<AppState>();
    if !state.is_current(generation) {
        return Err(DocumentError::StaleRevision);
    }
    let root = state
        .base_directory(generation)
        .ok_or(DocumentError::NoActiveDocument)?;

    let (path_part, fragment) = split_fragment(&link);
    if path_part.trim().is_empty() {
        // A bare fragment is handled in the webview; there is nothing to load.
        let snapshot = state.snapshot().ok_or(DocumentError::NoActiveDocument)?;
        return Ok(LinkedDocument { snapshot, fragment });
    }

    let relative = paths::safe_relative_path(&path_part)?;
    let canonical = paths::canonicalize(&root.join(relative))?;

    if !paths::is_within(&root, &canonical) {
        return Err(DocumentError::Denied {
            reason: "linked documents must live inside the current document's folder".to_string(),
        });
    }
    if !paths::is_markdown(&canonical) {
        return Err(DocumentError::UnsupportedExtension {
            extension: paths::extension_of(&canonical),
        });
    }

    let content = paths::read_document(&canonical)?;
    let snapshot = install(&app, canonical, content)?;
    Ok(LinkedDocument { snapshot, fragment })
}

/// Re-read the active document, reporting whether the rendered content changed.
///
/// This is the only path that installs refreshed content, so the watcher can
/// stay a pure change detector and unchanged content never re-renders.
#[tauri::command]
pub fn reload_document(
    app: AppHandle,
    generation: u64,
    expected_revision: String,
) -> Result<ReloadResult, DocumentError> {
    let state = app.state::<AppState>();
    if !state.is_current(generation) {
        return Err(DocumentError::StaleRevision);
    }
    let canonical = state
        .canonical_path(generation)
        .ok_or(DocumentError::NoActiveDocument)?;

    let content = paths::read_document(&canonical)?;
    let revision = paths::revision_of(&content);

    if revision == expected_revision {
        let snapshot = state.snapshot().ok_or(DocumentError::NoActiveDocument)?;
        return Ok(ReloadResult {
            changed: false,
            snapshot,
        });
    }

    let snapshot = state
        .replace_content(generation, content, revision)
        .ok_or(DocumentError::StaleRevision)?;

    Ok(ReloadResult {
        changed: true,
        snapshot,
    })
}

/// Return the document currently on screen, if any.
///
/// Used when the webview reloads so an already-open document is not lost.
#[tauri::command]
pub fn active_document(state: State<'_, AppState>) -> Option<DocumentSnapshot> {
    state.snapshot()
}

/// Consume one queued Explorer or second-instance launch path.
#[tauri::command]
pub fn get_pending_launch(state: State<'_, AppState>) -> Option<String> {
    state.take_pending_launch()
}

/// Open an external link in the default browser after scheme validation.
///
/// Only `http:` and `https:` reach the OS. `file:`, `data:`, `javascript:` and
/// custom or executable protocols are refused.
#[tauri::command]
pub fn open_external_link(url: String) -> Result<(), DocumentError> {
    let parsed = url::Url::parse(&url).map_err(|_| DocumentError::Denied {
        reason: "the link is not a valid web address".to_string(),
    })?;

    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(DocumentError::Denied {
            reason: format!("{scheme}: links are not opened"),
        });
    }
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err(DocumentError::Denied {
            reason: "the link has no host name".to_string(),
        });
    }

    open::that_detached(parsed.as_str()).map_err(|_| DocumentError::Io)
}

/// Split `path#fragment` into its two halves, decoding the fragment.
pub fn split_fragment(link: &str) -> (String, Option<String>) {
    match link.split_once('#') {
        Some((path, fragment)) => {
            let decoded = percent_encoding::percent_decode_str(fragment)
                .decode_utf8_lossy()
                .to_string();
            (path.to_string(), Some(decoded))
        }
        None => (link.to_string(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragments_are_split_and_decoded() {
        assert_eq!(
            split_fragment("docs/other.md#Getting%20Started"),
            (
                "docs/other.md".to_string(),
                Some("Getting Started".to_string())
            )
        );
        assert_eq!(split_fragment("other.md"), ("other.md".to_string(), None));
        assert_eq!(
            split_fragment("#section-two"),
            (String::new(), Some("section-two".to_string()))
        );
    }

    #[test]
    fn snapshots_expose_the_parent_folder_as_the_root() {
        let (snapshot, base) = build_snapshot(
            Path::new(r"C:\docs\project\README.md"),
            "# Title".to_string(),
            7,
        )
        .expect("snapshot");

        assert_eq!(snapshot.name, "README.md");
        assert_eq!(snapshot.generation, 7);
        assert_eq!(snapshot.base_directory, r"C:\docs\project");
        assert_eq!(base, PathBuf::from(r"C:\docs\project"));
        assert_eq!(snapshot.revision.len(), 32);
    }
}
