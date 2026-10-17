//! Path policy: canonicalisation, containment and format limits.
//!
//! Every path that arrives from the frontend is treated as untrusted. Nothing
//! downstream of this module touches the filesystem without going through one
//! of these helpers first.

use std::path::{Component, Path, PathBuf};

use crate::errors::DocumentError;

/// Documents larger than this are rejected before loading.
pub const MAX_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;
/// Individual referenced images are bounded well below the document limit.
pub const MAX_ASSET_BYTES: u64 = 8 * 1024 * 1024;
/// Distinct images a single document may pull in.
pub const MAX_ASSETS_PER_DOCUMENT: usize = 128;

pub const MARKDOWN_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// Win32 device names that resolve to hardware regardless of extension.
#[cfg(windows)]
const RESERVED_DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
];

pub fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// Whether the file name ends in a supported Markdown extension.
///
/// The comparison is made on `OsStr` rather than on a `String`: macOS volumes
/// hold file names as arbitrary bytes, so a document can have a valid `.md`
/// suffix and a name that is not valid UTF-8. Decoding first would silently
/// refuse those files, including for the watcher, which matches events to the
/// document by name.
pub fn is_markdown(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        MARKDOWN_EXTENSIONS
            .iter()
            .any(|known| extension.eq_ignore_ascii_case(known))
    })
}

/// MIME type for an image the webview can decode.
///
/// SVG is intentionally absent: it is a scriptable document format, not an
/// image format, so it must never be handed to the renderer as trusted media.
pub fn image_mime(path: &Path) -> Option<&'static str> {
    match extension_of(path).as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// Resolve a path to its canonical form, collapsing symlinks and `..`.
///
/// `dunce::canonicalize` is used rather than `std::fs::canonicalize` so that
/// ordinary drive-letter paths are not rewritten into `\\?\` verbatim paths,
/// which would break component comparison against the document root.
pub fn canonicalize(path: &Path) -> Result<PathBuf, DocumentError> {
    dunce::canonicalize(path).map_err(DocumentError::from)
}

/// True when `candidate` is the same as, or nested beneath, `root`.
///
/// Both sides must already be canonical. Comparison is component-wise (so
/// separators, `.` and `..` never matter) and, on Windows, case-insensitive for
/// directory names, which is how NTFS behaves.
pub fn is_within(root: &Path, candidate: &Path) -> bool {
    let mut root_components = root.components();
    let mut candidate_components = candidate.components();

    loop {
        match (root_components.next(), candidate_components.next()) {
            (None, _) => return true,
            (Some(_), None) => return false,
            (Some(left), Some(right)) => {
                if !component_eq(&left, &right) {
                    return false;
                }
            }
        }
    }
}

fn component_eq(left: &Component<'_>, right: &Component<'_>) -> bool {
    match (left, right) {
        (Component::Prefix(a), Component::Prefix(b)) => prefix_eq(&a.kind(), &b.kind()),
        (Component::RootDir, Component::RootDir) => true,
        (Component::CurDir, Component::CurDir) => true,
        (Component::ParentDir, Component::ParentDir) => true,
        (Component::Normal(a), Component::Normal(b)) => {
            // NTFS is case-insensitive; the POSIX file systems Inkfin runs on
            // are not (APFS is case-sensitive when formatted that way). Both
            // sides are canonical, so an exact comparison is correct there and
            // prevents a case-only sibling from passing containment.
            #[cfg(windows)]
            {
                a.to_string_lossy()
                    .eq_ignore_ascii_case(&b.to_string_lossy())
            }
            #[cfg(not(windows))]
            {
                a == b
            }
        }
        _ => false,
    }
}

#[cfg(windows)]
fn prefix_eq(left: &std::path::Prefix<'_>, right: &std::path::Prefix<'_>) -> bool {
    use std::path::Prefix;

    match (left, right) {
        (Prefix::Disk(a), Prefix::Disk(b)) => a.eq_ignore_ascii_case(b),
        (Prefix::VerbatimDisk(a), Prefix::VerbatimDisk(b)) => a.eq_ignore_ascii_case(b),
        (Prefix::Verbatim(a), Prefix::Verbatim(b)) => a.eq_ignore_ascii_case(b),
        (Prefix::DeviceNS(a), Prefix::DeviceNS(b)) => a.eq_ignore_ascii_case(b),
        (Prefix::UNC(server_a, share_a), Prefix::UNC(server_b, share_b))
        | (Prefix::VerbatimUNC(server_a, share_a), Prefix::VerbatimUNC(server_b, share_b)) => {
            server_a.eq_ignore_ascii_case(server_b) && share_a.eq_ignore_ascii_case(share_b)
        }
        _ => false,
    }
}

#[cfg(not(windows))]
fn prefix_eq(_left: &std::path::Prefix<'_>, _right: &std::path::Prefix<'_>) -> bool {
    // `Component::Prefix` is never produced on non-Windows platforms.
    false
}

/// Validate a user- or OS-supplied path as a readable Markdown document.
pub fn validate_document_path(input: &str) -> Result<PathBuf, DocumentError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(DocumentError::NotFound);
    }

    let raw = PathBuf::from(trimmed);
    if !is_markdown(&raw) {
        return Err(DocumentError::UnsupportedExtension {
            extension: extension_of(&raw),
        });
    }

    let canonical = canonicalize(&raw)?;
    // Check the policy again on the resolved path. A symlink named `notes.md`
    // is legal on macOS and Linux and can point at any file, so accepting the
    // link's own extension would let a launch, drop or link reach a document
    // format the reader refuses to open.
    if !is_markdown(&canonical) {
        return Err(DocumentError::UnsupportedExtension {
            extension: extension_of(&canonical),
        });
    }
    let metadata = std::fs::metadata(&canonical).map_err(DocumentError::from)?;
    if !metadata.is_file() {
        return Err(DocumentError::NotAFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(DocumentError::TooLarge {
            size: metadata.len(),
            limit: MAX_DOCUMENT_BYTES,
        });
    }

    Ok(canonical)
}

/// Read a validated document as UTF-8 text, shedding a leading byte-order mark.
pub fn read_document(path: &Path) -> Result<String, DocumentError> {
    let metadata = std::fs::metadata(path).map_err(DocumentError::from)?;
    if !metadata.is_file() {
        return Err(DocumentError::NotAFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(DocumentError::TooLarge {
            size: metadata.len(),
            limit: MAX_DOCUMENT_BYTES,
        });
    }

    let bytes = std::fs::read(path).map_err(DocumentError::from)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(DocumentError::TooLarge {
            size: bytes.len() as u64,
            limit: MAX_DOCUMENT_BYTES,
        });
    }

    let text = String::from_utf8(bytes).map_err(|_| DocumentError::InvalidUtf8)?;
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

/// Content revision used to decide whether a reload needs to re-render.
pub fn revision_of(content: &str) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let digest = hasher.finalize();
    let mut revision = String::with_capacity(32);
    for byte in digest.iter().take(16) {
        revision.push_str(&format!("{byte:02x}"));
    }
    revision
}

/// True for a Win32 device name such as `NUL`, `CON` or `LPT1`.
#[cfg(windows)]
fn is_reserved_device_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment);
    let normalised = stem.trim_end_matches([' ', '.']).to_ascii_uppercase();
    RESERVED_DEVICE_NAMES.contains(&normalised.as_str())
}

/// Reduce an untrusted relative reference to a safe relative path.
///
/// Rejects remote schemes, absolute paths, `..` traversal and NUL bytes. On
/// Windows it also rejects drive prefixes, alternate data streams and reserved
/// device names, which are legal path text on POSIX systems.
pub fn safe_relative_path(input: &str) -> Result<PathBuf, DocumentError> {
    let decoded = percent_encoding::percent_decode_str(input.trim())
        .decode_utf8()
        .map_err(|_| DocumentError::Denied {
            reason: "the reference is not valid UTF-8".to_string(),
        })?
        .to_string();

    let lowered = decoded.to_ascii_lowercase();
    if lowered.starts_with("http:")
        || lowered.starts_with("https:")
        || lowered.starts_with("data:")
        || lowered.starts_with("javascript:")
        || lowered.starts_with("file:")
        || lowered.starts_with("ftp:")
        || decoded.starts_with("//")
        || decoded.starts_with('\\')
        || decoded.starts_with('/')
    {
        return Err(DocumentError::Denied {
            reason: "only paths inside the document's own folder are allowed".to_string(),
        });
    }

    #[cfg(windows)]
    {
        let bytes = decoded.as_bytes();
        if bytes.len() > 1 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            return Err(DocumentError::Denied {
                reason: "absolute drive paths are not allowed".to_string(),
            });
        }
    }
    if decoded.contains('\0') {
        return Err(DocumentError::Denied {
            reason: "the reference contains an invalid character".to_string(),
        });
    }

    let mut safe = PathBuf::new();
    for raw_segment in decoded.split(['/', '\\']) {
        if raw_segment.is_empty() || raw_segment == "." {
            continue;
        }
        if raw_segment == ".." {
            return Err(DocumentError::Denied {
                reason: "the reference tries to leave the document's folder".to_string(),
            });
        }

        // Win32 strips trailing dots and spaces before resolving a name, so
        // `.. ` would otherwise slip past the check above. Unicode whitespace
        // is included for the same reason: no legitimate reference needs it.
        let segment = raw_segment.trim_end_matches(|c: char| c.is_whitespace() || c == '.');
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(DocumentError::Denied {
                reason: "the reference contains an invalid path segment".to_string(),
            });
        }
        #[cfg(windows)]
        if segment.contains(':') || is_reserved_device_name(segment) {
            return Err(DocumentError::Denied {
                reason: "the reference contains an invalid path segment".to_string(),
            });
        }
        safe.push(segment);
    }

    if safe.as_os_str().is_empty() {
        return Err(DocumentError::Denied {
            reason: "the reference is empty".to_string(),
        });
    }

    Ok(safe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_extension_matching_ignores_case() {
        assert!(is_markdown(Path::new("README.md")));
        assert!(is_markdown(Path::new("notes.MARKDOWN")));
        assert!(!is_markdown(Path::new("notes.txt")));
        assert!(!is_markdown(Path::new("notes")));
    }

    #[cfg(windows)]
    #[test]
    fn containment_accepts_children_and_rejects_siblings() {
        let root = Path::new(r"C:\docs\project");
        assert!(is_within(root, Path::new(r"C:\docs\project\sub\a.png")));
        assert!(is_within(root, Path::new(r"c:\DOCS\PROJECT\a.png")));
        assert!(is_within(root, Path::new(r"C:\docs\project")));
        assert!(!is_within(root, Path::new(r"C:\docs\project-other\a.png")));
        assert!(!is_within(root, Path::new(r"C:\docs\a.png")));
        assert!(!is_within(root, Path::new(r"D:\docs\project\a.png")));
    }

    #[cfg(not(windows))]
    #[test]
    fn containment_is_case_sensitive_on_posix_paths() {
        let root = Path::new("/Users/test/docs");
        assert!(is_within(root, Path::new("/Users/test/docs/sub/a.png")));
        assert!(is_within(root, Path::new("/Users/test/docs")));
        assert!(!is_within(root, Path::new("/Users/test/Docs/a.png")));
        assert!(!is_within(root, Path::new("/Users/test/docs-other/a.png")));
    }

    #[test]
    fn relative_paths_reject_traversal_and_remote_references() {
        assert_eq!(
            safe_relative_path("images/logo.png").expect("relative path"),
            PathBuf::from("images/logo.png")
        );
        assert_eq!(
            safe_relative_path("images\\logo%20dark.png").expect("windows separators"),
            PathBuf::from("images/logo dark.png")
        );
        for blocked in [
            "../secrets.png",
            "images/../../secrets.png",
            "https://example.com/a.png",
            "http://example.com/a.png",
            "data:image/png;base64,AAAA",
            "javascript:alert(1)",
            "//host/share/a.png",
            "/etc/passwd",
            "file:///c:/a.png",
            // Trailing space/dot normalisation must not defeat the `..` check.
            ".. /secrets.png",
            "images/.. /secrets.png",
            "..\u{00a0}",
        ] {
            assert!(
                safe_relative_path(blocked).is_err(),
                "{blocked} should be rejected"
            );
        }

        // These are path *text* rules, not filesystem checks, so the Windows
        // cases must stay in a Windows-only list.
        #[cfg(windows)]
        for blocked in [
            r"C:\Windows\a.png",
            "images/a:b.png",
            "NUL.png",
            "CON.md",
            "lpt1.png",
        ] {
            assert!(
                safe_relative_path(blocked).is_err(),
                "{blocked} should be rejected on Windows"
            );
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn posix_paths_allow_colons_that_windows_rejects() {
        assert_eq!(
            safe_relative_path("notes/2026:10:17.png").expect("colon in a POSIX name"),
            PathBuf::from("notes/2026:10:17.png")
        );
    }

    #[test]
    fn image_mime_only_covers_decodable_formats() {
        assert_eq!(image_mime(Path::new("a.png")), Some("image/png"));
        assert_eq!(image_mime(Path::new("a.JPG")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("a.svg")), None);
        assert_eq!(image_mime(Path::new("a.exe")), None);
    }

    #[test]
    fn revision_is_stable_and_content_sensitive() {
        assert_eq!(revision_of("hello"), revision_of("hello"));
        assert_ne!(revision_of("hello"), revision_of("hello "));
        assert_eq!(revision_of("hello").len(), 32);
    }

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("markdown-preview-test-{name}"));
        std::fs::create_dir_all(&directory).expect("scratch directory");
        directory
    }

    #[test]
    fn the_document_size_limit_is_enforced_at_the_boundary() {
        let directory = scratch("size-limit");
        let limit = MAX_DOCUMENT_BYTES as usize;

        let allowed = directory.join("allowed.md");
        std::fs::write(&allowed, vec![b'a'; limit]).expect("write at the limit");
        assert!(read_document(&allowed).is_ok());

        let rejected = directory.join("rejected.md");
        std::fs::write(&rejected, vec![b'a'; limit + 1]).expect("write over the limit");
        match validate_document_path(&rejected.to_string_lossy()) {
            Err(DocumentError::TooLarge {
                limit: reported, ..
            }) => {
                assert_eq!(reported, MAX_DOCUMENT_BYTES)
            }
            other => panic!("expected TooLarge, got {other:?}"),
        }

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn extension_encoding_and_byte_order_marks_are_handled() {
        let directory = scratch("encoding");

        let not_markdown = directory.join("notes.txt");
        std::fs::write(&not_markdown, b"hello").expect("write");
        match validate_document_path(&not_markdown.to_string_lossy()) {
            Err(DocumentError::UnsupportedExtension { extension }) => assert_eq!(extension, "txt"),
            other => panic!("expected UnsupportedExtension, got {other:?}"),
        }

        let invalid = directory.join("broken.md");
        std::fs::write(&invalid, [0xff, 0xfe, 0x00, 0x01]).expect("write");
        assert!(matches!(
            read_document(&invalid),
            Err(DocumentError::InvalidUtf8)
        ));

        let with_bom = directory.join("bom.md");
        std::fs::write(&with_bom, "\u{feff}# Title".as_bytes()).expect("write");
        assert_eq!(read_document(&with_bom).expect("read"), "# Title");

        let missing = directory.join("missing.md");
        assert!(matches!(
            validate_document_path(&missing.to_string_lossy()),
            Err(DocumentError::NotFound)
        ));

        std::fs::remove_dir_all(&directory).ok();
    }

    /// A link inside the document folder that resolves outside it must not be
    /// followed. Skipped when the account cannot create symlinks.
    #[cfg(windows)]
    #[test]
    fn symlink_escape_is_rejected() {
        use std::os::windows::fs::symlink_file;

        let base = std::env::temp_dir().join("markdown-preview-test-symlink");
        let root = base.join("root");
        std::fs::create_dir_all(&root).expect("root directory");

        let secret = base.join("secret.md");
        std::fs::write(&secret, "# secret").expect("write secret");

        let link = root.join("escape.md");
        if symlink_file(&secret, &link).is_err() {
            return;
        }

        let canonical_root = canonicalize(&root).expect("canonical root");
        let canonical_link = canonicalize(&link).expect("canonical link");
        assert!(
            !is_within(&canonical_root, &canonical_link),
            "a symlink out of the document folder must not count as contained"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    /// macOS and Linux do not need a privilege to create a symlink, so the
    /// containment rule must be exercised there too rather than only on Windows.
    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected_on_unix() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join("markdown-preview-test-symlink-unix");
        let root = base.join("root");
        std::fs::create_dir_all(&root).expect("root directory");

        let secret = base.join("secret.md");
        std::fs::write(&secret, "# secret").expect("write secret");

        let link = root.join("escape.md");
        symlink(&secret, &link).expect("create symlink");

        let canonical_root = canonicalize(&root).expect("canonical root");
        let canonical_link = canonicalize(&link).expect("canonical link");
        assert!(
            !is_within(&canonical_root, &canonical_link),
            "a symlink out of the document folder must not count as contained"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn file_names_with_spaces_and_unicode_survive_validation() {
        let directory = scratch("names");
        let name = "Résumé — 2026 notes.md";
        let path = directory.join(name);
        std::fs::write(&path, "# Notes").expect("write");

        let canonical = validate_document_path(&path.to_string_lossy()).expect("valid document");
        assert_eq!(
            canonical.file_name().and_then(|value| value.to_str()),
            Some(name)
        );
        assert_eq!(read_document(&canonical).expect("read"), "# Notes");

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn utf8_content_is_preserved_except_for_the_byte_order_mark() {
        let directory = scratch("utf8");
        let content = "# Héllo 👩‍💻\r\n\r\n| a | b |\r\n";
        let path = directory.join("emoji.md");
        std::fs::write(&path, content.as_bytes()).expect("write");
        assert_eq!(read_document(&path).expect("read"), content);

        let only_bom = directory.join("bom-only.md");
        std::fs::write(&only_bom, "\u{feff}").expect("write");
        assert_eq!(read_document(&only_bom).expect("read"), "");

        std::fs::remove_dir_all(&directory).ok();
    }

    /// A folder can be named `something.md`; it is not a document.
    #[test]
    fn a_directory_with_a_markdown_name_is_not_a_document() {
        let directory = scratch("directory");
        let folder = directory.join("fixtures.md");
        std::fs::create_dir_all(&folder).expect("create folder");

        assert!(matches!(
            validate_document_path(&folder.to_string_lossy()),
            Err(DocumentError::NotAFile)
        ));

        std::fs::remove_dir_all(&directory).ok();
    }

    /// The extension policy must apply to the file that is finally read, not to
    /// the name the reader clicked. Otherwise a symlink lends `.md` to anything.
    #[cfg(unix)]
    #[test]
    fn a_symlink_cannot_lend_a_markdown_extension_to_another_format() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join("markdown-preview-test-symlink-extension");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("base directory");

        let payload = base.join("payload.txt");
        std::fs::write(&payload, "not a document").expect("write payload");
        let link = base.join("innocent.md");
        symlink(&payload, &link).expect("create symlink");

        match validate_document_path(&link.to_string_lossy()) {
            Err(DocumentError::UnsupportedExtension { extension }) => {
                assert_eq!(extension, "txt")
            }
            other => panic!("expected UnsupportedExtension, got {other:?}"),
        }

        std::fs::remove_dir_all(&base).ok();
    }

    #[cfg(windows)]
    #[test]
    fn a_symlink_cannot_lend_a_markdown_extension_to_another_format() {
        use std::os::windows::fs::symlink_file;

        let base = std::env::temp_dir().join("markdown-preview-test-symlink-extension");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("base directory");

        let payload = base.join("payload.txt");
        std::fs::write(&payload, "not a document").expect("write payload");
        let link = base.join("innocent.md");
        if symlink_file(&payload, &link).is_err() {
            // Creating symlinks needs Developer Mode or elevation.
            return;
        }

        assert!(matches!(
            validate_document_path(&link.to_string_lossy()),
            Err(DocumentError::UnsupportedExtension { .. })
        ));

        std::fs::remove_dir_all(&base).ok();
    }

    /// macOS file names are bytes, not UTF-8. A `.md` suffix must still be
    /// recognised so such a file can be opened and watched.
    #[cfg(unix)]
    #[test]
    fn a_non_utf8_name_with_a_markdown_suffix_is_still_markdown() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let document = PathBuf::from("/tmp").join(OsStr::from_bytes(b"notes-\xff.md"));
        assert!(is_markdown(&document));
        assert_eq!(extension_of(&document), "md");

        let other = PathBuf::from("/tmp").join(OsStr::from_bytes(b"notes-\xff.txt"));
        assert!(!is_markdown(&other));
    }

    /// A refused read must be reported once, not retried like a half-written
    /// file: macOS TCC denies access to protected folders until the reader
    /// grants it, and no number of retries changes that.
    #[cfg(unix)]
    #[test]
    fn a_document_the_system_refuses_to_read_is_reported_as_denied() {
        use std::os::unix::fs::PermissionsExt;

        let directory = scratch("permissions");
        let path = directory.join("locked.md");
        std::fs::write(&path, "# locked").expect("write");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).expect("chmod");

        // Root ignores the permission bits; on such a machine there is nothing
        // to assert, so the read result is inspected rather than assumed.
        if let Err(error) = read_document(&path) {
            assert!(
                matches!(error, DocumentError::Denied { .. }),
                "got {error:?}"
            );
            assert_eq!(error.code(), "denied");
            assert!(!error.is_retryable());
        }

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).ok();
        std::fs::remove_dir_all(&directory).ok();
    }

    /// APFS and HFS+ compare names normalization-insensitively, so a Markdown
    /// reference typed in precomposed form must resolve a decomposed on-disk
    /// name. This can only be shown on a Mac.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_precomposed_reference_resolves_a_decomposed_macos_name() {
        let directory = scratch("unicode-normalization");
        let decomposed = "Cafe\u{301}.png";
        let precomposed = "Café.png";
        assert_ne!(decomposed, precomposed);
        std::fs::write(directory.join(decomposed), b"png").expect("write");

        let resolved = canonicalize(&directory.join(precomposed)).expect("resolve");
        assert_eq!(std::fs::read(resolved).expect("read"), b"png");

        std::fs::remove_dir_all(&directory).ok();
    }
}
