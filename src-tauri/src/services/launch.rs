//! Launch-argument handling.
//!
//! Windows delivers a file-association request as a command-line argument; macOS
//! delivers it as a `file://` URL through a run event. Both are normalised here
//! and queued, so the frontend only ever drains one kind of launch request.

use std::path::{Path, PathBuf};

use crate::services::paths;

/// First argument that looks like a Markdown document.
///
/// `argv[0]` is the executable itself and is skipped. Arguments starting with
/// `-` are flags, not files.
pub fn markdown_arg<S: AsRef<str>>(args: &[S]) -> Option<String> {
    args.iter()
        .skip(1)
        .map(AsRef::as_ref)
        .find(|argument| {
            !argument.starts_with('-') && paths::is_markdown(std::path::Path::new(argument))
        })
        .map(ToString::to_string)
}

/// First Markdown document in an OS launch payload delivered as a file URL.
///
/// macOS Finder and `open -a` deliver `file://` URLs through a run event rather
/// than argv. `to_file_path` decodes percent-escaped spaces and rejects every
/// non-file scheme, and the extension policy stays identical to argv launches.
pub fn markdown_path_from_url(url: &url::Url) -> Option<PathBuf> {
    let path = url.to_file_path().ok()?;
    paths::is_markdown(&path).then_some(path)
}

/// Resolve an OS open payload into the paths to queue, in the order received.
///
/// macOS hands Finder selections, "Open With" and dock drops to the app as one
/// Apple Event holding every URL, so the whole batch is decided here rather than
/// inside the platform arm: filtering, decoding, canonicalisation, the
/// Markdown-only policy and duplicate removal are the same on every platform and
/// stay covered by the test suite that runs on Windows.
///
/// Keeping the input order matters. The queue keeps the newest request, so the
/// last entry is the document that ends up on screen.
pub fn launch_paths_from_urls(urls: &[url::Url]) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for url in urls {
        let Some(path) = markdown_path_from_url(url) else {
            continue;
        };
        let Some(resolved) = resolve_launch_path(&path.to_string_lossy()) else {
            continue;
        };
        if !paths.contains(&resolved) {
            paths.push(resolved);
        }
    }
    paths
}

/// Resolve an OS-supplied launch path into what the queue should hold.
///
/// A readable Markdown document is canonicalised here, before the webview ever
/// sees it: symlinks collapse to one identity, so opening the same file through
/// an alias or a relative path cannot produce two different documents. Anything
/// that is not Markdown is refused outright, which keeps argv, Finder and dock
/// drops on one policy.
///
/// A Markdown path that cannot be read right now (removed, permissions, too
/// large) is kept as the trimmed original instead of disappearing. The reader
/// then gets the open command's actionable error rather than a click that did
/// nothing.
pub fn resolve_launch_path(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || !paths::is_markdown(Path::new(trimmed)) {
        return None;
    }

    match paths::validate_document_path(trimmed) {
        Ok(canonical) => Some(canonical.to_string_lossy().into_owned()),
        Err(_) => Some(trimmed.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_markdown_argument_and_ignores_the_executable() {
        let args = vec![
            r"C:\Program Files\Markdown Preview\Markdown Preview.exe",
            r"C:\docs\README.md",
        ];
        assert_eq!(markdown_arg(&args), Some(r"C:\docs\README.md".to_string()));
    }

    #[test]
    fn returns_none_when_no_markdown_argument_is_present() {
        let args = vec![r"C:\app.exe", "--flag", r"C:\docs\note.txt"];
        assert_eq!(markdown_arg(&args), None);
        assert_eq!(markdown_arg::<&str>(&[]), None);
        assert_eq!(markdown_arg(&[r"C:\app.exe"]), None);
    }

    #[test]
    fn flags_are_not_treated_as_files() {
        let args = vec![r"C:\app.exe", "--verbose.md"];
        assert_eq!(markdown_arg(&args), None);
    }

    #[test]
    fn file_urls_are_decoded_and_filtered_by_extension() {
        let path = std::env::temp_dir().join("Inkfin Notes.md");
        let url = url::Url::from_file_path(&path).expect("file url");
        assert_eq!(markdown_path_from_url(&url), Some(path));

        let other = std::env::temp_dir().join("Inkfin Notes.txt");
        let other_url = url::Url::from_file_path(&other).expect("file url");
        assert_eq!(markdown_path_from_url(&other_url), None);
    }

    #[test]
    fn non_file_urls_are_ignored() {
        let web = url::Url::parse("https://example.com/README.md").expect("web url");
        assert_eq!(markdown_path_from_url(&web), None);
    }

    #[test]
    fn launch_paths_are_trimmed_and_keep_their_extension_policy() {
        assert_eq!(
            resolve_launch_path("  /tmp/notes.md\n"),
            Some("/tmp/notes.md".to_string()),
            "a missing file is still worth reporting to the reader"
        );
        assert_eq!(resolve_launch_path("/tmp/notes.txt"), None);
        assert_eq!(resolve_launch_path("   "), None);
        assert_eq!(
            resolve_launch_path("/tmp/folder.md"),
            Some("/tmp/folder.md".to_string())
        );
    }

    #[test]
    fn an_existing_document_is_canonicalised_before_it_is_queued() {
        let root = std::env::temp_dir().join(format!("inkfin-launch-{}", std::process::id()));
        let real = root.join("docs");
        std::fs::create_dir_all(&real).expect("create fixture folder");
        let document = real.join("Guide.md");
        std::fs::write(&document, "# Guide").expect("write fixture document");

        let expected = paths::canonicalize(&document).expect("canonical path");
        // `..` must not survive into the queue, so the reader cannot be handed
        // two spellings of one document.
        let untidy = root.join("docs").join("..").join("docs").join("Guide.md");
        assert_eq!(
            resolve_launch_path(&untidy.to_string_lossy()),
            Some(expected.to_string_lossy().into_owned())
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_open_payload_keeps_only_markdown_in_the_order_it_arrived() {
        let root = std::env::temp_dir().join(format!("inkfin-payload-{}", std::process::id()));
        let notes = root.join("notes.md");
        let notes_again = root.join("notes.md");
        let other = root.join("todo.txt");
        let report = root.join("Report Q3.markdown");

        let payload: Vec<url::Url> = [&notes, &other, &report, &notes_again]
            .iter()
            .map(|path| url::Url::from_file_path(path).expect("file url"))
            .chain(std::iter::once(
                url::Url::parse("https://example.com/README.md").expect("web url"),
            ))
            .collect();

        let queued = launch_paths_from_urls(&payload);

        assert_eq!(
            queued,
            vec![
                notes.to_string_lossy().into_owned(),
                report.to_string_lossy().into_owned(),
            ],
            "a web URL and a .txt are refused, a duplicate is dropped and order is kept"
        );
    }

    #[test]
    fn an_empty_open_payload_queues_nothing() {
        assert!(launch_paths_from_urls(&[]).is_empty());
    }

    #[test]
    fn a_missing_markdown_document_is_queued_for_the_reader_to_see() {
        let missing =
            std::env::temp_dir().join(format!("inkfin-missing-{}.md", std::process::id()));
        let input = missing.to_string_lossy().into_owned();
        assert_eq!(resolve_launch_path(&input), Some(input));
    }
}
