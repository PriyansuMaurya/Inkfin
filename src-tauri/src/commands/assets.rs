//! Bounded read of images referenced by the active document.
//!
//! Images are served as bytes over IPC rather than through an asset protocol
//! with directory globs. The command is bound to the active document's
//! generation, so it cannot be used to enumerate directories, and every
//! reference must resolve inside the document's own folder after symlinks are
//! resolved.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::errors::DocumentError;
use crate::services::paths;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPayload {
    /// MIME type decided natively from the extension, never from file content.
    pub mime: String,
    /// Revision of the document that requested the asset.
    pub revision: String,
    pub bytes: usize,
    /// Raw file bytes, base64 encoded, for an object URL on the frontend.
    pub data_base64: String,
}

/// A validated image read, before it is bound to a document generation.
#[derive(Debug)]
pub struct LoadedAsset {
    /// Symlink-free path the policy approved. Used as the per-document budget
    /// key, so two spellings of one image do not count twice.
    pub canonical: PathBuf,
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

/// Apply the whole image policy to one reference from a document.
///
/// `root` is the document's folder and must already be canonical. Kept out of
/// the command so containment, symlink resolution, format and size can be
/// exercised on every platform without starting an application.
pub fn load_asset(root: &Path, reference: &str) -> Result<LoadedAsset, DocumentError> {
    let relative = paths::safe_relative_path(reference)?;
    let candidate = root.join(&relative);

    // Canonicalising resolves symlinks, so an in-tree link that points outside
    // the document folder is rejected rather than followed. This is also what
    // makes a macOS alias-style link to another volume safe.
    let canonical = paths::canonicalize(&candidate)?;
    if !paths::is_within(root, &canonical) {
        return Err(DocumentError::BlockedAsset {
            reason: "the image is outside the document's folder".to_string(),
        });
    }

    let mime = paths::image_mime(&canonical).ok_or(DocumentError::BlockedAsset {
        reason: "only PNG, JPEG, GIF, WebP and BMP images are loaded".to_string(),
    })?;

    let metadata = std::fs::metadata(&canonical).map_err(DocumentError::from)?;
    if !metadata.is_file() {
        return Err(DocumentError::NotAFile);
    }
    if metadata.len() > paths::MAX_ASSET_BYTES {
        return Err(DocumentError::TooLarge {
            size: metadata.len(),
            limit: paths::MAX_ASSET_BYTES,
        });
    }

    let bytes = std::fs::read(&canonical).map_err(DocumentError::from)?;
    if bytes.len() as u64 > paths::MAX_ASSET_BYTES {
        return Err(DocumentError::TooLarge {
            size: bytes.len() as u64,
            limit: paths::MAX_ASSET_BYTES,
        });
    }

    Ok(LoadedAsset {
        canonical,
        mime,
        bytes,
    })
}

#[tauri::command]
pub fn read_relative_image(
    app: AppHandle,
    generation: u64,
    reference: String,
) -> Result<AssetPayload, DocumentError> {
    let state = app.state::<AppState>();
    if !state.is_current(generation) {
        return Err(DocumentError::StaleRevision);
    }

    let root = state
        .base_directory(generation)
        .ok_or(DocumentError::NoActiveDocument)?;
    let revision = state
        .stored_revision(generation)
        .ok_or(DocumentError::NoActiveDocument)?;

    let loaded = load_asset(&root, &reference)?;

    // Counted once per distinct path, so re-requesting the same image (theme
    // switch, refresh) never exhausts the budget. Registered only after a
    // successful read so a failed request does not burn a slot.
    state.register_asset(generation, &loaded.canonical)?;

    Ok(AssetPayload {
        mime: loaded.mime.to_string(),
        revision,
        bytes: loaded.bytes.len(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(&loaded.bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh canonical document folder per test. `name` keeps the tests
    /// from sharing state, because cargo runs them in parallel.
    fn fixture(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("inkfin-assets-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("create fixture folder");
        paths::canonicalize(&directory).expect("canonical fixture folder")
    }

    fn write(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create nested folder");
        }
        std::fs::write(path, bytes).expect("write fixture image");
    }

    #[test]
    fn images_in_the_document_folder_load_with_an_extension_decided_mime() {
        let root = fixture("mime");
        write(&root, "logo.png", b"png-bytes");
        write(&root, "photo.JPG", b"jpeg-bytes");
        write(&root, "images/deep/diagram.webp", b"webp-bytes");

        assert_eq!(
            load_asset(&root, "logo.png").expect("png").mime,
            "image/png"
        );
        assert_eq!(
            load_asset(&root, "photo.JPG").expect("jpeg").mime,
            "image/jpeg",
            "an upper-case extension is still an image"
        );
        assert_eq!(
            load_asset(&root, "images/deep/diagram.webp")
                .expect("nested")
                .bytes,
            b"webp-bytes"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// Spaces arrive percent-encoded from Markdown and Unicode names arrive as
    /// either normalization form, so both must survive the reference parser.
    #[test]
    fn spaces_unicode_and_encoded_names_resolve() {
        let root = fixture("names");
        write(&root, "images/My Diagram (1).png", b"space");
        write(&root, "images/Résumé.png", b"unicode");

        assert_eq!(
            load_asset(&root, "images/My%20Diagram%20(1).png")
                .expect("percent-encoded spaces")
                .bytes,
            b"space"
        );
        assert_eq!(
            load_asset(&root, "images/My Diagram (1).png")
                .expect("literal spaces")
                .bytes,
            b"space"
        );
        assert_eq!(
            load_asset(&root, "images/Résumé.png")
                .expect("unicode name")
                .bytes,
            b"unicode"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn traversal_absolute_and_remote_references_are_refused() {
        let root = fixture("escape");
        write(&root, "logo.png", b"png");
        let outside = root
            .parent()
            .expect("parent")
            .join(format!("inkfin-assets-outside-{}.png", std::process::id()));
        std::fs::write(&outside, b"secret").expect("write outside file");

        for reference in [
            format!("../{}", outside.file_name().unwrap().to_string_lossy()),
            "images/%2e%2e/secret.png".to_string(),
            "/etc/passwd".to_string(),
            "https://example.com/logo.png".to_string(),
            "file:///tmp/logo.png".to_string(),
            "//server/share/logo.png".to_string(),
        ] {
            assert!(
                load_asset(&root, &reference).is_err(),
                "{reference} should be refused"
            );
        }

        std::fs::remove_file(&outside).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn svg_and_non_image_types_are_never_served_as_images() {
        let root = fixture("types");
        write(&root, "icon.svg", b"<svg onload=\"alert(1)\"/>");
        write(&root, "payload.exe", b"MZ");
        write(&root, "notes.txt", b"text");

        for reference in ["icon.svg", "payload.exe", "notes.txt"] {
            match load_asset(&root, reference) {
                Err(DocumentError::BlockedAsset { .. }) => {}
                other => panic!("{reference} should be blocked, got {other:?}"),
            }
        }

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_missing_image_or_a_folder_is_refused() {
        let root = fixture("missing");
        std::fs::create_dir_all(root.join("images.png")).expect("folder named like an image");

        assert!(matches!(
            load_asset(&root, "gone.png"),
            Err(DocumentError::NotFound)
        ));
        assert!(matches!(
            load_asset(&root, "images.png"),
            Err(DocumentError::NotAFile)
        ));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_oversized_image_is_refused_before_it_is_encoded() {
        let root = fixture("size");
        let limit = paths::MAX_ASSET_BYTES as usize;
        write(&root, "huge.png", &vec![0u8; limit + 1]);

        match load_asset(&root, "huge.png") {
            Err(DocumentError::TooLarge {
                limit: reported, ..
            }) => {
                assert_eq!(reported, paths::MAX_ASSET_BYTES)
            }
            other => panic!("expected TooLarge, got {other:?}"),
        }

        // At the boundary the image is still served.
        write(&root, "exact.png", &vec![0u8; limit]);
        assert_eq!(
            load_asset(&root, "exact.png")
                .expect("at the limit")
                .bytes
                .len(),
            limit
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_document_folder_is_refused() {
        use std::os::unix::fs::symlink;

        let root = fixture("symlink");
        let base = root.parent().expect("parent");
        let secret = base.join(format!("inkfin-assets-secret-{}.png", std::process::id()));
        std::fs::write(&secret, b"secret").expect("write secret");
        symlink(&secret, root.join("innocent.png")).expect("create symlink");

        match load_asset(&root, "innocent.png") {
            Err(DocumentError::BlockedAsset { .. }) => {}
            other => panic!("expected BlockedAsset, got {other:?}"),
        }

        std::fs::remove_file(&secret).ok();
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(windows)]
    #[test]
    fn a_symlink_out_of_the_document_folder_is_refused() {
        use std::os::windows::fs::symlink_file;

        let root = fixture("symlink");
        let base = root.parent().expect("parent");
        let secret = base.join(format!("inkfin-assets-secret-{}.png", std::process::id()));
        std::fs::write(&secret, b"secret").expect("write secret");
        if symlink_file(&secret, root.join("innocent.png")).is_err() {
            // Creating symlinks needs Developer Mode or elevation.
            std::fs::remove_file(&secret).ok();
            std::fs::remove_dir_all(&root).ok();
            return;
        }

        assert!(matches!(
            load_asset(&root, "innocent.png"),
            Err(DocumentError::BlockedAsset { .. })
        ));

        std::fs::remove_file(&secret).ok();
        std::fs::remove_dir_all(&root).ok();
    }
}
