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
use crate::state::{AppState, DocumentSnapshot, LaunchRequest};

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
    // simply will not refresh until the file is reopened. They are told once so
    // a silently stale preview is never mistaken for a save that did not land.
    match watch::spawn(app.clone(), generation, canonical.clone()) {
        Ok(watcher) => state.set_watcher(watcher),
        Err(error) => {
            state.clear_watcher();
            watch::report_watch_failure(app, generation, &canonical, &error);
        }
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

/// Resolve a relative Markdown link to a readable target inside `root`.
///
/// `root` is the active document's canonical folder. Traversal, absolute paths
/// and remote schemes are refused by the reference parser; symlinks are resolved
/// before containment is checked, so an in-folder link cannot point out of it.
/// The Markdown policy is then applied to the resolved file rather than to the
/// link text, so a link to `notes.txt` is refused even when it is spelled
/// `notes.md`.
pub fn resolve_linked_document(root: &Path, link_path: &str) -> Result<PathBuf, DocumentError> {
    let relative = paths::safe_relative_path(link_path)?;
    let canonical = paths::canonicalize(&root.join(relative))?;

    if !paths::is_within(root, &canonical) {
        return Err(DocumentError::Denied {
            reason: "linked documents must live inside the current document's folder".to_string(),
        });
    }
    if !paths::is_markdown(&canonical) {
        return Err(DocumentError::UnsupportedExtension {
            extension: paths::extension_of(&canonical),
        });
    }

    Ok(canonical)
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

    let canonical = resolve_linked_document(&root, &path_part)?;
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

/// Consume the queued OS launch request, if one is waiting.
///
/// The frontend drains this on mount and on every launch event, so a Finder
/// open that arrived before the webview was ready is still applied. The request
/// carries the sequence it was queued with, which lets the webview ignore a
/// request that a newer one has already overtaken.
#[tauri::command]
pub fn get_pending_launch(state: State<'_, AppState>) -> Option<LaunchRequest> {
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

    #[cfg(windows)]
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

    #[cfg(not(windows))]
    #[test]
    fn snapshots_use_the_posix_parent_folder() {
        let (snapshot, base) = build_snapshot(
            Path::new("/Users/test/docs/README.md"),
            "# Title".to_string(),
            7,
        )
        .expect("snapshot");

        assert_eq!(snapshot.name, "README.md");
        assert_eq!(snapshot.generation, 7);
        assert_eq!(snapshot.base_directory, "/Users/test/docs");
        assert_eq!(base, PathBuf::from("/Users/test/docs"));
        assert_eq!(snapshot.revision.len(), 32);
    }

    /// A canonical fixture folder, unique per test so the parallel runner does
    /// not let two tests share one directory.
    fn links_fixture(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("inkfin-links-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(directory.join("notes")).expect("create fixture folder");
        paths::canonicalize(&directory).expect("canonical fixture folder")
    }

    #[test]
    fn links_resolve_spaces_unicode_and_percent_encoding_inside_the_folder() {
        let root = links_fixture("names");
        std::fs::write(root.join("Guide Notes.md"), "# Guide").expect("write");
        std::fs::write(root.join("notes/Résumé 2026.md"), "# Résumé").expect("write");

        assert_eq!(
            resolve_linked_document(&root, "Guide%20Notes.md").expect("encoded spaces"),
            root.join("Guide Notes.md")
        );
        assert_eq!(
            resolve_linked_document(&root, "notes/Résumé 2026.md").expect("unicode name"),
            root.join("notes/Résumé 2026.md")
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn links_cannot_leave_the_folder_or_change_format() {
        let root = links_fixture("policy");
        std::fs::write(root.join("other.txt"), "not markdown").expect("write");
        std::fs::write(root.join("notes/chapter.markdown"), "# Chapter").expect("write");

        for refused in [
            "../outside.md",
            "notes/../../outside.md",
            "/etc/passwd",
            "https://example.com/README.md",
            "javascript:alert(1)",
            "file:///tmp/README.md",
            "other.txt",
        ] {
            assert!(
                resolve_linked_document(&root, refused).is_err(),
                "{refused} must be refused"
            );
        }

        assert_eq!(
            resolve_linked_document(&root, "notes/chapter.markdown").expect("markdown link"),
            root.join("notes/chapter.markdown")
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_link_to_a_missing_file_or_a_folder_is_reported() {
        let root = links_fixture("missing");
        std::fs::create_dir_all(root.join("bundle.md")).expect("folder named like a document");

        assert!(matches!(
            resolve_linked_document(&root, "gone.md"),
            Err(DocumentError::NotFound)
        ));

        // Resolution succeeds because the name is Markdown; the read is what
        // reports that a folder cannot be shown as a document.
        let folder = resolve_linked_document(&root, "bundle.md").expect("resolves");
        assert!(matches!(
            paths::read_document(&folder),
            Err(DocumentError::NotAFile)
        ));

        std::fs::remove_dir_all(&root).ok();
    }

    /// A link inside the folder that resolves outside it must not be followed,
    /// and one that resolves to another format must not be read as Markdown.
    #[cfg(unix)]
    #[test]
    fn links_through_symlinks_keep_the_folder_and_format_policy() {
        use std::os::unix::fs::symlink;

        let root = links_fixture("symlink");
        let secret = root
            .parent()
            .expect("parent")
            .join(format!("inkfin-links-secret-{}.md", std::process::id()));
        std::fs::write(&secret, "# secret").expect("write secret");
        std::fs::write(root.join("payload.txt"), "text").expect("write payload");
        symlink(&secret, root.join("escape.md")).expect("symlink out");
        symlink(root.join("payload.txt"), root.join("renamed.md")).expect("symlink format");

        assert!(matches!(
            resolve_linked_document(&root, "escape.md"),
            Err(DocumentError::Denied { .. })
        ));
        assert!(matches!(
            resolve_linked_document(&root, "renamed.md"),
            Err(DocumentError::UnsupportedExtension { .. })
        ));

        std::fs::remove_file(&secret).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(windows)]
    #[test]
    fn links_through_symlinks_keep_the_folder_and_format_policy() {
        use std::os::windows::fs::symlink_file;

        let root = links_fixture("symlink");
        let secret = root
            .parent()
            .expect("parent")
            .join(format!("inkfin-links-secret-{}.md", std::process::id()));
        std::fs::write(&secret, "# secret").expect("write secret");
        std::fs::write(root.join("payload.txt"), "text").expect("write payload");
        if symlink_file(&secret, root.join("escape.md")).is_err()
            || symlink_file(root.join("payload.txt"), root.join("renamed.md")).is_err()
        {
            // Creating symlinks needs Developer Mode or elevation.
            std::fs::remove_file(&secret).ok();
            std::fs::remove_dir_all(&root).ok();
            return;
        }

        assert!(matches!(
            resolve_linked_document(&root, "escape.md"),
            Err(DocumentError::Denied { .. })
        ));
        assert!(matches!(
            resolve_linked_document(&root, "renamed.md"),
            Err(DocumentError::UnsupportedExtension { .. })
        ));

        std::fs::remove_file(&secret).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    /// The security rule: a document may open a web page, never a local file or
    /// an executable scheme. Only refusal paths are exercised, so no browser is
    /// launched by the test suite.
    #[test]
    fn only_http_and_https_links_can_reach_the_operating_system() {
        for refused in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,<script>alert(1)</script>",
            "mailto:someone@example.com",
            "ms-settings:privacy",
            "not a url",
            "http://",
        ] {
            assert!(
                open_external_link(refused.to_string()).is_err(),
                "{refused} must not be handed to the OS"
            );
        }
    }
}
