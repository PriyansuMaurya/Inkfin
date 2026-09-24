use std::fmt;

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;

/// Every failure path the native bridge can report.
///
/// Variants stay coarse on purpose: the frontend renders `message` verbatim and
/// uses `kind` for control flow, so the actionable wording lives in one place.
#[derive(Debug)]
pub enum DocumentError {
    /// The requested path does not use a supported Markdown extension.
    UnsupportedExtension { extension: String },
    /// The path exists but is a directory, device or other non-regular file.
    NotAFile,
    /// The file (or a linked resource) does not exist.
    NotFound,
    /// The document exceeds the read limit.
    TooLarge { size: u64, limit: u64 },
    /// The bytes are not valid UTF-8.
    InvalidUtf8,
    /// The path failed the containment or scheme policy.
    Denied { reason: String },
    /// A resource reference was blocked by policy (remote, traversal, type).
    BlockedAsset { reason: String },
    /// No document is currently open.
    NoActiveDocument,
    /// The request belongs to a document generation that has been replaced.
    StaleRevision,
    /// An unexpected I/O failure.
    ///
    /// The raw OS string is deliberately not carried: RULES.md forbids exposing
    /// it to the reading surface, and nothing else needs it.
    Io,
}

impl DocumentError {
    /// Stable identifier used by the frontend for notices and tests.
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedExtension { .. } => "unsupported_extension",
            Self::NotAFile => "not_a_file",
            Self::NotFound => "not_found",
            Self::TooLarge { .. } => "too_large",
            Self::InvalidUtf8 => "invalid_utf8",
            Self::Denied { .. } => "denied",
            Self::BlockedAsset { .. } => "blocked_asset",
            Self::NoActiveDocument => "no_active_document",
            Self::StaleRevision => "stale_revision",
            Self::Io { .. } => "io",
        }
    }

    /// Whether a re-read of the same file could plausibly succeed shortly.
    ///
    /// Only states that occur *while a save is landing* qualify: a file that is
    /// momentarily absent, or momentarily half-written. Anything else is
    /// reported straight away.
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::NotFound | Self::InvalidUtf8)
    }
}

/// Actionable, reader-facing wording. Raw OS text never appears here.
impl fmt::Display for DocumentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedExtension { extension } if extension.is_empty() => {
                write!(
                    f,
                    "That file has no extension, so it is not a Markdown document."
                )
            }
            Self::UnsupportedExtension { extension } => write!(
                f,
                "Markdown Preview opens .md and .markdown files, not .{extension} files."
            ),
            Self::NotAFile => write!(f, "That path is not a regular file."),
            Self::NotFound => write!(f, "The file could not be found."),
            Self::TooLarge { size, limit } => write!(
                f,
                "The file is {} MiB, which is larger than the {} MiB limit.",
                size / (1024 * 1024),
                limit / (1024 * 1024)
            ),
            Self::InvalidUtf8 => write!(f, "The file is not valid UTF-8 text."),
            Self::Denied { reason } => write!(f, "Access denied: {reason}."),
            Self::BlockedAsset { reason } => write!(f, "Blocked resource: {reason}."),
            Self::NoActiveDocument => write!(f, "No document is open."),
            Self::StaleRevision => {
                write!(
                    f,
                    "That request belongs to a document that has been replaced."
                )
            }
            Self::Io => write!(f, "The file could not be read."),
        }
    }
}

impl std::error::Error for DocumentError {}

impl From<std::io::Error> for DocumentError {
    fn from(error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound,
            std::io::ErrorKind::PermissionDenied => Self::Denied {
                reason: "the system refused read access".to_string(),
            },
            _ => Self::Io,
        }
    }
}

/// Serialised as `{ kind, message }` plus the structured fields a notice needs.
impl Serialize for DocumentError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("kind", self.code())?;
        map.serialize_entry("message", &self.to_string())?;
        match self {
            Self::TooLarge { size, limit } => {
                map.serialize_entry("size", size)?;
                map.serialize_entry("limit", limit)?;
            }
            Self::UnsupportedExtension { extension } => {
                map.serialize_entry("extension", extension)?;
            }
            Self::Denied { reason } | Self::BlockedAsset { reason } => {
                map.serialize_entry("reason", reason)?;
            }
            // `Io` deliberately serialises nothing extra: `detail` holds raw OS
            // text that must never reach the reading surface.
            _ => {}
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_is_limited_to_save_in_progress_states() {
        assert!(DocumentError::NotFound.is_retryable());
        assert!(DocumentError::InvalidUtf8.is_retryable());
        assert!(!DocumentError::TooLarge { size: 1, limit: 0 }.is_retryable());
        assert!(!DocumentError::NotAFile.is_retryable());
        assert!(!DocumentError::Denied { reason: "x".into() }.is_retryable());
    }

    #[test]
    fn messages_are_actionable_and_never_contain_raw_os_text() {
        let message = DocumentError::Io.to_string();
        assert_eq!(message, "The file could not be read.");
        assert!(!message.contains("os error"));

        let large = DocumentError::TooLarge {
            size: 11 * 1024 * 1024,
            limit: 10 * 1024 * 1024,
        };
        assert!(large.to_string().contains("11 MiB"));
        assert!(large.to_string().contains("10 MiB"));
    }

    #[test]
    fn serialisation_carries_kind_and_message() {
        let json = serde_json::to_value(DocumentError::UnsupportedExtension {
            extension: "txt".to_string(),
        })
        .expect("serialisable");

        assert_eq!(json["kind"], "unsupported_extension");
        assert_eq!(json["extension"], "txt");
        assert!(json["message"]
            .as_str()
            .is_some_and(|message| message.contains(".md and .markdown")));
    }
}
