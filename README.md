# Inkfin

**Read local Markdown files as a polished document.**

Inkfin is a small, local Markdown viewer for Windows, with a macOS build in progress. On Windows, double-click a `.md` or `.markdown` file (or drop one into the window) and read it as a GitHub Flavoured Markdown document with syntax highlighting, themes, search, zoom and live reload when the file changes on disk.

- **Read-only.** Nothing is ever written back to your documents.
- **Offline.** No network requests, accounts, analytics or telemetry. Remote images are blocked.
- **Safe.** Raw HTML in Markdown is never executed; links, assets and paths are validated on the Rust side.

**Platform status:** Windows is the only shipped platform. The source includes a macOS build foundation (Finder and Open With file opening, Command shortcuts, a universal `.app`/`.dmg` configuration with `icon.icns`, and a macOS-adapted window shell), but **no macOS artifact has been built, signed, notarised or run**. The [packaging and signing setup](docs/MACOS-PACKAGING.md) and the [acceptance run sheet](docs/MACOS-ACCEPTANCE-RUN.md) describe what is required; every acceptance row is still `NOT RUN`, so macOS is not offered for download. Background: [macOS analysis](docs/MACOS-PORT-ANALYSIS.md), [interface adaptation](docs/MACOS-UI-ADAPTATION.md), [document-pipeline audit](docs/MACOS-DOCUMENT-PIPELINE.md), [Finder checks](docs/MACOS-FINDER-CHECKS.md).

## Install

### Windows

Download the `Inkfin_<version>_x64-setup.exe` installer from the [latest release](https://github.com/PriyansuMaurya/Inkfin/releases/latest) and run it. The installer registers `.md` and `.markdown` file associations, so you can open files from Explorer with a double-click or **Open With**.

> The installer is not code-signed yet, so Windows SmartScreen may warn on first run; choose **More info → Run anyway**.

### macOS

**No macOS download is published yet.** The source builds a universal `.app`/`.dmg` for macOS 14.2 or later (Apple silicon and Intel), but it has not been signed, notarised, stapled or tested on a Mac, so publishing it would overstate what is verified. Follow the [packaging and signing setup](docs/MACOS-PACKAGING.md) and the [acceptance run sheet](docs/MACOS-ACCEPTANCE-RUN.md) for the release gate.

To produce a local test bundle on a Mac (explicitly unsigned, not a release):

```bash
npm ci
npx tauri build --target universal-apple-darwin --no-sign
```

## Requirements

| Platform | Versions        | Notes                                                                                                                                                       |
| -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | 10, 11 (64-bit) | WebView2 is included with Windows 10/11; the installer embeds the bootstrapper for machines where it is missing                                             |
| macOS    | 14.2 or later   | Universal build for Apple silicon and Intel, published as an unsigned test build; find-in-page needs the CSS Custom Highlight API available from macOS 14.2 |

## Features

- **Open** a file via the toolbar, drag and drop, Explorer double-click or Open With
- **Render** GitHub Flavoured Markdown: headings, lists, task boxes, tables, links, blockquotes, images, inline and fenced code, strikethrough and footnotes
- **Syntax highlighting** with Shiki in both light and dark themes; copy button on every code block
- **Find in document** with match count, active result tracking and keyboard navigation
- **Zoom** from 75% to 200%, persisted between sessions
- **Live reload** when another app saves the file, preserving your reading position and search query
- **Large files welcome**: documents up to 10 MiB open without freezing the UI
- **Light / Dark / System** theme, persisted locally

## Keyboard shortcuts

On macOS, use `Cmd` in place of `Ctrl`.

| Shortcut                | Action                           |
| ----------------------- | -------------------------------- |
| `Ctrl+O`                | Open a Markdown file             |
| `Ctrl+R`                | Reload from disk                 |
| `Ctrl+F`                | Find in document                 |
| `Enter` / `Shift+Enter` | Next / previous search match     |
| `Ctrl++` / `Ctrl+-`     | Zoom in / out                    |
| `Ctrl+0`                | Reset zoom to 100%               |
| `Escape`                | Close search or dismiss a notice |

## Development

Prerequisites: [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) stable, Windows Visual C++ Build Tools (see `tools/dev-setup/`), and on macOS the Xcode Command Line Tools.

```bash
npm ci          # install frontend dependencies
npm run dev     # start Vite dev server
npm run tauri dev   # run the desktop app with hot reload
```

Quality checks:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (84 tests)
npm run lint        # eslint
npm run format:check # prettier
```

Build a local installer (NSIS `.exe`):

```bash
npm run tauri build
```

## Releasing

One workflow, `.github/workflows/release.yml`, runs on each `v*.*.*` tag and on manual dispatch. It builds both platforms, verifies each artifact, then attaches the installable files to the GitHub release:

- **Windows** — `Inkfin_<version>_x64-setup.exe`, the NSIS installer, built on `windows-latest`.
- **macOS** — `Inkfin_<version>_universal.dmg`, one universal disk image for Apple silicon and Intel, built on `macos-15`. A manual run publishes `v<version>`; to re-build an existing release, dispatch the workflow against that tag rather than `main`.

A release is only published once **both** installers exist, so a half-built release never appears. The macOS file name states what it is: without Apple credentials it is `-unsigned`, and with a certificate but no notarisation it is `-signed-unnotarized`. Those are installable test builds, not notarised public releases.

To publish a new version:

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (keep them in sync).
2. Commit, then tag and push:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The macOS signing and notarisation secrets are listed in [MACOS-PACKAGING.md](docs/MACOS-PACKAGING.md) §4. Without them the macOS job still builds and verifies the two slices, and attaches the DMG under an `-unsigned` name; macOS blocks its first launch until you allow it in System Settings → Privacy & Security. A notarised build has never been produced.

## Limitations

- **Windows installer is unsigned.** SmartScreen warns on first run; there is no auto-update.
- **macOS is an unsigned test build.** The universal DMG builds in CI, but it is not signed or notarised (macOS blocks the first launch) and its Finder and WKWebView behaviour has never been exercised on a Mac. No signed or notarised package exists.
- **Linux is not supported.** No build target or packaging is configured.
- No editing, tabs, print/PDF, outline, recent files, cloud sync or telemetry. Remote images are blocked by design.
- Search relies on the CSS Custom Highlight API, which is why the macOS floor is 14.2 rather than an older release.

## Tech stack

| Layer          | Choice                                                                     |
| -------------- | -------------------------------------------------------------------------- |
| Shell / native | Tauri 2 + Rust (validated read-only file access, file watching, packaging) |
| Frontend       | React 19 + strict TypeScript + Vite                                        |
| Styling        | Tailwind CSS 4 + CSS variables                                             |
| Markdown       | react-markdown + remark-gfm (raw HTML disabled)                            |
| Highlighting   | Shiki                                                                      |
| Tests          | Vitest + Testing Library                                                   |

## Project structure

```text
src/                 React app
├── components/      Toolbar, DocumentView, SearchBar, ThemeMenu, …
├── features/        document, search, highlight, preferences
├── bridge/          typed IPC to the Rust backend
└── styles/          tokens, document and app CSS
src-tauri/           Rust backend (commands, services, Tauri config)
tests/               Vitest suites
docs/                PRD, architecture, design and task documents
tools/               icon generation and dev setup scripts
```

## Documentation

- [PRD](docs/PRD.md): product requirements and MVP scope
- [Architecture](docs/ARCHITECTURE.md): stack, IPC contract and security decisions
- [Design](docs/DESIGN.md): visual system and tokens
- [Rules](docs/RULES.md): coding and contribution guidelines
- [macOS document pipeline](docs/MACOS-DOCUMENT-PIPELINE.md): filesystem and watcher coverage, with the Mac run sheet
- [macOS packaging](docs/MACOS-PACKAGING.md): universal build decision, signing/notarisation secrets and the open release gate
- [macOS acceptance run](docs/MACOS-ACCEPTANCE-RUN.md): the ordered test matrix, environment record and evidence rules, with the committed fixture
- [Release notes](RELEASE-NOTES.md): current downloads, requirements and known limitations

## License

No license file has been published yet. All rights reserved by the author unless a license is added later.
