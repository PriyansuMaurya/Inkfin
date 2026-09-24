//! Bounded read of images referenced by the active document.
//!
//! Images are served as bytes over IPC rather than through an asset protocol
//! with directory globs. The command is bound to the active document's
//! generation, so it cannot be used to enumerate directories, and every
//! reference must resolve inside the document's own folder after symlinks are
//! resolved.

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

    let relative = paths::safe_relative_path(&reference)?;
    let candidate = root.join(&relative);

    // Canonicalising resolves symlinks, so an in-tree link that points outside
    // the document folder is rejected rather than followed.
    let canonical = paths::canonicalize(&candidate)?;
    if !paths::is_within(&root, &canonical) {
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

    // Counted once per distinct path, so re-requesting the same image (theme
    // switch, refresh) never exhausts the budget. Registered only after a
    // successful read so a failed request does not burn a slot.
    state.register_asset(generation, &canonical)?;

    Ok(AssetPayload {
        mime: mime.to_string(),
        revision,
        bytes: bytes.len(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}
