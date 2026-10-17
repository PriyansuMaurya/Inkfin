# Inkfin 0.1.1

Released 24 September 2026.

## Download

| Platform | File | Size | Status |
| --- | --- | --- | --- |
| Windows 10 / 11 (64-bit) | [`Inkfin_0.1.1_x64-setup.exe`](https://github.com/PriyansuMaurya/Inkfin/releases/download/v0.1.1/Inkfin_0.1.1_x64-setup.exe) | 3.5 MB | Available |
| macOS 14.2 or later (Apple silicon + Intel) | — | — | **Not published** |
| Linux | — | — | Not supported |

The Windows installer registers `.md` and `.markdown` associations, so files open from Explorer with
a double-click or **Open With**. It is not code-signed yet, so SmartScreen may warn on first run;
choose **More info → Run anyway**.

There is no macOS download. The source builds a universal `.app`/`.dmg`, but no such artifact has
been produced, signed, notarised, stapled or verified on a Mac. The open gate and the required
credentials are recorded in [docs/MACOS-PACKAGING.md](docs/MACOS-PACKAGING.md); the checks that must
pass first are in [docs/MACOS-ACCEPTANCE-RUN.md](docs/MACOS-ACCEPTANCE-RUN.md). Offering a macOS
build before those pass would overstate what has been tested.

## What this release is

A local, read-only Markdown reader: open one `.md` or `.markdown` file and read it as a GitHub
Flavoured Markdown document with syntax highlighting, light/dark/system themes, in-document search,
75–200 % zoom and automatic refresh when the file changes on disk.

## Requirements

- **Windows:** 64-bit Windows 10 or 11. WebView2 ships with both; the installer embeds the
  bootstrapper for machines where it is missing.
- **macOS (when published):** macOS 14.2 or later, universal for Apple silicon and Intel. The floor
  is set by the CSS Custom Highlight API used for search highlighting.

## Known limitations

- The Windows installer is unsigned, so SmartScreen warns on first run.
- No auto-update. Install a newer release manually.
- macOS is unreleased and unverified; no signed or notarised package exists.
- No editing, tabs, print/PDF, outline, recent files, cloud sync or telemetry.
- Remote images are blocked by design; raw HTML in Markdown is never executed.
- Documents over 10 MiB are refused.

## Verification in this release

- Automated: `tsc --noEmit`, ESLint, 84 Vitest tests across 14 files, `cargo test` and
  `cargo clippy -D warnings` pass on Windows.
- Packaging: the NSIS installer builds locally (`Inkfin_0.1.1_x64-setup.exe`, 3,677,220 bytes);
  the macOS bundle has never been built.
- Not covered: the installer has not been smoke-tested on a clean Windows machine, and no macOS
  behaviour has been exercised. The Windows release gates in [docs/PRD.md](docs/PRD.md) remain open.
