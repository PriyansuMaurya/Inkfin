//! Launch-argument handling.
//!
//! When Explorer opens a file association, or when a second instance is started
//! while one is already running, the requested path arrives as a command-line
//! argument. A requested path is never silently discarded: it is queued and the
//! frontend drains the queue.

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
}
