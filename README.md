# Inkfin

**Read local Markdown files as a polished document.**

Inkfin is a small, local Markdown viewer for Windows. Double-click a `.md` or `.markdown` file — or drop one into the window — and read it as a GitHub Flavoured Markdown document with syntax highlighting, themes, search, zoom and live reload when the file changes on disk.

- **Read-only.** Nothing is ever written back to your documents.
- **Offline.** No network requests, accounts, analytics or telemetry. Remote images are blocked.
- **Safe.** Raw HTML in Markdown is never executed; links, assets and paths are validated on the Rust side.

## Install

Download the `Inkfin_<version>_x64-setup.exe` installer from the [latest release](https://github.com/PriyansuMaurya/Inkfin/releases/latest) and run it. The installer registers `.md` and `.markdown` file associations, so you can open files from Explorer with a double-click or **Open With**.

> The installer is not code-signed yet, so Windows SmartScreen may warn on first run — choose **More info → Run anyway**.

## Features

- **Open** a file via the toolbar, drag and drop, Explorer double-click or Open With
- **Render** GitHub Flavoured Markdown: headings, lists, task boxes, tables, links, blockquotes, images, inline and fenced code, strikethrough and footnotes
- **Syntax highlighting** with Shiki in both light and dark themes; copy button on every code block
- **Find in document** with match count, active result tracking and keyboard navigation
- **Zoom** from 75% to 200%, persisted between sessions
- **Live reload** when another app saves the file, preserving your reading position and search query
- **Large files welcome** — documents up to 10 MiB open without freezing the UI
- **Light / Dark / System** theme, persisted locally

## Keyboard shortcuts

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

Prerequisites: [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) stable, and on Windows the Visual C++ Build Tools (see `tools/dev-setup/`).

```bash
npm ci          # install frontend dependencies
npm run dev     # start Vite dev server
npm run tauri dev   # run the desktop app with hot reload
```

Quality checks:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (56 tests)
npm run lint        # eslint
npm run format:check # prettier
```

Build a local installer (NSIS `.exe`):

```bash
npm run tauri build
```

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`). To publish a new version:

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (keep them in sync).
2. Commit, then tag and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

CI builds the Windows installer and attaches it to a published GitHub Release.

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

- [PRD](docs/PRD.md) — product requirements and MVP scope
- [Architecture](docs/ARCHITECTURE.md) — stack, IPC contract and security decisions
- [Design](docs/DESIGN.md) — visual system and tokens
- [Rules](docs/RULES.md) — coding and contribution guidelines

## License

No license file has been published yet. All rights reserved by the author unless a license is added later.
