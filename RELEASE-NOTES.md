# Inkfin 0.1.2

Released 17 October 2026.

## Download

| Platform                                    | File                                                                                                                                           | Size   | Status              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------- |
| Windows 10 / 11 (64-bit)                    | [`Inkfin_0.1.2_x64-setup.exe`](https://github.com/PriyansuMaurya/Inkfin/releases/download/v0.1.2/Inkfin_0.1.2_x64-setup.exe)                   | 3.5 MB | Available           |
| macOS 14.2 or later (Apple silicon + Intel) | [`Inkfin-0.1.2-universal-unsigned.dmg`](https://github.com/PriyansuMaurya/Inkfin/releases/download/v0.1.2/Inkfin-0.1.2-universal-unsigned.dmg) | —      | Unsigned test build |
| Linux                                       | —                                                                                                                                              | —      | Not supported       |

The Windows installer registers `.md` and `.markdown` associations, so files open from Explorer with
a double-click or **Open With**. It is not code-signed yet, so SmartScreen may warn on first run;
choose **More info → Run anyway**.

The macOS download is a universal disk image built in CI on `macos-15`. It is **not signed and not
notarised**, so Gatekeeper blocks the first launch: open **System Settings → Privacy & Security** and
choose **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Inkfin.app`. It has not
been run on a Mac, and the acceptance matrix in
[docs/MACOS-ACCEPTANCE-RUN.md](docs/MACOS-ACCEPTANCE-RUN.md) is still unexecuted, so treat it as a
test build rather than a supported release. The signing gate and secret list are in
[docs/MACOS-PACKAGING.md](docs/MACOS-PACKAGING.md).

## What changed since 0.1.1

- macOS: native document opening, window behaviour and bundle support, so the same build runs on
  Apple silicon and Intel.
- macOS: one release pipeline builds the universal `.app`/`.dmg`, asserts both `lipo` slices and
  attaches the disk image to the GitHub release under a name that states its signing state.
- Release: both installers are published from a single workflow that runs only after both platform
  builds succeed.
- Website: a platform chooser that separates the available Windows download from the macOS build.

## What this release is

A local, read-only Markdown reader: open one `.md` or `.markdown` file and read it as a GitHub
Flavoured Markdown document with syntax highlighting, light/dark/system themes, in-document search,
75–200 % zoom and automatic refresh when the file changes on disk.

## Requirements

- **Windows:** 64-bit Windows 10 or 11. WebView2 ships with both; the installer embeds the
  bootstrapper for machines where it is missing.
- **macOS:** macOS 14.2 or later, universal for Apple silicon and Intel. The floor is set by the CSS
  Custom Highlight API used for search highlighting.

## Known limitations

- The Windows installer is unsigned, so SmartScreen warns on first run.
- The macOS build is unsigned and un-notarised; macOS blocks the first launch until you allow it.
- No auto-update. Install a newer release manually.
- No editing, tabs, print/PDF, outline, recent files, cloud sync or telemetry.
- Remote images are blocked by design; raw HTML in Markdown is never executed.
- Documents over 10 MiB are refused.

## Verification in this release

- Automated on Windows: `tsc --noEmit` and ESLint clean, 84 Vitest tests across 14 files pass.
- Packaging: both installers are produced by CI from the same tag; the macOS bundle is labelled
  `-unsigned` because no Apple Developer ID or notarisation credential is configured.
- Not covered: no Windows installer smoke test on a clean machine, no macOS launch, and no macOS
  acceptance run. The Windows release gates in [docs/PRD.md](docs/PRD.md) and the macOS gate in
  [docs/MACOS-PACKAGING.md](docs/MACOS-PACKAGING.md) §7 remain open.
