pub mod launch;
pub mod paths;
pub mod watch;
pub mod window;

/// Platform contract tests.
///
/// The two platform files are part of the native interface, so the shared test
/// suite asserts them on every platform: the registered extensions must match
/// the document policy, and the macOS override must stay minimal and correct.
#[cfg(test)]
mod contract_tests {
    use serde_json::Value;

    use crate::services::paths;

    /// Runs on Windows and macOS: a change to one extension list without the
    /// other fails here rather than on a user's machine.
    #[test]
    fn file_associations_cover_the_document_extension_policy() {
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("tauri.conf.json is valid JSON");
        let associations = config["bundle"]["fileAssociations"]
            .as_array()
            .expect("fileAssociations is an array");

        let mut configured: Vec<String> = Vec::new();
        for association in associations {
            for extension in association["ext"].as_array().expect("ext is an array") {
                configured.push(
                    extension
                        .as_str()
                        .expect("ext is a string")
                        .to_ascii_lowercase(),
                );
            }
        }
        configured.sort();

        let mut expected: Vec<String> = paths::MARKDOWN_EXTENSIONS
            .iter()
            .map(|extension| (*extension).to_string())
            .collect();
        expected.sort();

        assert_eq!(
            configured, expected,
            "registered extensions must match the reader policy"
        );
        assert_eq!(
            associations[0]["role"], "Viewer",
            "the association must not claim to be the editor"
        );
        assert_eq!(
            associations[0]["rank"], "Default",
            "Finder offers the app as a Markdown handler without claiming ownership"
        );
    }

    /// macOS matches documents by Uniform Type Identifier as well as by
    /// extension, and many Markdown files are identified by the standard UTI
    /// rather than by `CFBundleTypeExtensions`. Without it, "Open With" and
    /// double-click work only on some files; with a wrong identifier they never
    /// work at all. `net.daringfireball.markdown` is Apple's own Markdown type.
    #[test]
    fn the_macos_document_type_uses_the_standard_markdown_identifier() {
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("tauri.conf.json is valid JSON");
        let association = &config["bundle"]["fileAssociations"][0];

        let content_types: Vec<&str> = association["contentTypes"]
            .as_array()
            .expect("contentTypes is an array")
            .iter()
            .map(|value| value.as_str().expect("contentType is a string"))
            .collect();

        assert_eq!(content_types, vec!["net.daringfireball.markdown"]);
        assert_eq!(association["mimeType"], "text/markdown");
    }

    /// Held on both platforms so an edit to the macOS override is visible in
    /// the normal Windows verification run.
    #[test]
    fn macos_bundle_configuration_keeps_the_platform_contract() {
        let config: Value = serde_json::from_str(include_str!("../../tauri.macos.conf.json"))
            .expect("tauri.macos.conf.json is valid JSON");

        let targets: Vec<&str> = config["bundle"]["targets"]
            .as_array()
            .expect("targets is an array")
            .iter()
            .map(|target| target.as_str().expect("target is a string"))
            .collect();
        assert!(targets.contains(&"app") && targets.contains(&"dmg"));
        assert_eq!(
            config["bundle"]["macOS"]["hardenedRuntime"], true,
            "notarisation requires the hardened runtime"
        );

        let icons: Vec<&str> = config["bundle"]["icon"]
            .as_array()
            .expect("icon is an array")
            .iter()
            .map(|icon| icon.as_str().expect("icon is a string"))
            .collect();
        assert!(icons.contains(&"icons/icon.icns"));

        assert_eq!(config["bundle"]["macOS"]["minimumSystemVersion"], "14.2");
    }

    /// Identity is declared once. The macOS override may add macOS-only keys,
    /// but a second copy of the name, identifier or associations would drift
    /// from the Windows build and from the `Info.plist` contract above.
    #[test]
    fn the_macos_override_does_not_restate_the_app_identity() {
        let base: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("tauri.conf.json is valid JSON");
        let macos: Value = serde_json::from_str(include_str!("../../tauri.macos.conf.json"))
            .expect("tauri.macos.conf.json is valid JSON");

        assert_eq!(base["productName"], "Inkfin");
        assert_eq!(base["identifier"], "com.inkfin.viewer");
        assert_eq!(base["bundle"]["category"], "Utility");

        assert!(
            macos["productName"].is_null(),
            "name is declared in the base config"
        );
        assert!(
            macos["identifier"].is_null(),
            "identifier is declared in the base config"
        );
        assert!(
            macos["bundle"]["fileAssociations"].is_null(),
            "the shared association entry is what both platforms register"
        );
        assert!(
            macos["bundle"]["targets"]
                .as_array()
                .is_some_and(|targets| targets.len() == 2),
            "macOS produces an .app and a .dmg only"
        );
    }

    /// The Windows job is what publishes releases today; this pass must not
    /// have moved its configuration onto the macOS override.
    #[test]
    fn the_windows_installer_configuration_is_unchanged() {
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("tauri.conf.json is valid JSON");
        let targets: Vec<&str> = config["bundle"]["targets"]
            .as_array()
            .expect("targets is an array")
            .iter()
            .map(|target| target.as_str().expect("target is a string"))
            .collect();

        assert_eq!(targets, vec!["nsis"]);
        assert_eq!(
            config["bundle"]["windows"]["nsis"]["installMode"],
            "currentUser"
        );
        assert_eq!(
            config["bundle"]["windows"]["webviewInstallMode"]["type"],
            "embedBootstrapper"
        );
    }
}
