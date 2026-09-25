# Markdown Preview - Execution Plan

**Status:** Implemented; installable Windows package built at `src-tauri/target/release/bundle/nsis/Markdown Preview_0.1.0_x64-setup.exe`. Check boxes only after verification; record evidence and deviations in MEMORY.md. Phases reflect desktop integration; there is no authentication phase because the product has no accounts.

Evidence key used below:
- `FE-TESTS` - `npx vitest run`: 9 files / 56 tests passing.
- `STATIC` - `npx tsc --noEmit` and `npx eslint .` clean.
- `RUST-TESTS` - `cargo test --manifest-path src-tauri/Cargo.toml` 17 tests passing; `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` clean.
- `INSTALLER` - `npx tauri build` produced `Markdown Preview_0.1.0_x64-setup.exe` (about 3.4 MB; the release compile step took 3m59s on the first cold build) alongside `markdown-preview.exe` (FileVersion 0.1.0, ProductName "Markdown Preview"). Byte counts are not quoted exactly because each build regenerates hashed frontend assets.
- `UNVERIFIED` - implemented, but **not** exercised in an installed build. Per the rule at the bottom of this file, these boxes stay unchecked.

**Formatter caveat:** `npm run format:check` uses Prettier with the style in `.prettierrc.json` (100 columns, single quotes) over everything except the authored specification docs, which `.prettierignore` excludes by design. The config was added during implementation and the tree has **not** been reformatted to it, so `npx prettier --check .` still reports differences in 22 files. Typecheck and lint are clean; treat the formatter as outstanding (see MEMORY.md, BUG-003).

**Rebuild:** `powershell -ExecutionPolicy Bypass -File tools/dev-setup/build.ps1` puts `cargo` on PATH and prints the installer path, so the build does not depend on the shell's PATH (see MEMORY.md, BUG-001). The package it produces is unsigned, so expect a SmartScreen prompt on first run (More info → Run anyway).

## Phase 1 - Foundation and open-to-render vertical slice
- [x] Initialise Tauri 2 + Vite + React + TypeScript with strict compiler settings and lockfiles. - `STATIC`; lockfiles exist but nothing is committed, because this directory is not a VCS repository
- [x] Configure lint, Rust fmt/clippy and build scripts. - `STATIC`, `RUST-TESTS`, `INSTALLER`
- [ ] Verify a blank packaged window launches. - `UNVERIFIED`; the release binary was built but never launched
- [x] Add scoped Tauri capability file and restrictive CSP; audit plugin permissions. - `STATIC`; capabilities limited to the window, dialog and store plugins
- [x] Build semantic colour tokens and native-chrome window with empty state. - `src/styles/tokens.css`, `EmptyState.tsx`
- [x] Add native Open dialog filtered to `.md` and `.markdown`. - `FE-TESTS` (`native.spec.ts`), plugin-dialog with an extension filter
- [x] Implement Rust `open_document`: canonical path, regular file, extension, UTF-8 and 10 MiB checks. - `RUST-TESTS` (non-file, wrong extension, invalid UTF-8, over-limit, missing)
- [x] Define typed IPC result and document state machine; invalidate stale responses on file switch. - `RUST-TESTS`; generation comparison in `state.rs` means a later-issued generation always wins
- [x] Render basic Markdown via react-markdown and remark-gfm with raw HTML disabled. - `FE-TESTS` (`documentView.spec.tsx` asserts injected HTML stays inert text)
- [x] Handle empty, unreadable, invalid UTF-8 and oversized document states. - `RUST-TESTS` + error notices in `App.tsx`
- [ ] Verify the vertical slice by opening a representative README in the installed package. - `UNVERIFIED`; exercised through tests and `vite build` only

## Phase 2 - Native launch and safe document resources
- [x] Accept one file dropped onto the window; show a notice for extra dropped files. - `FE-TESTS` (`native.spec.ts`), notice copy in `App.tsx`
- [ ] Verify drag and drop in the installed package. - `UNVERIFIED`
- [x] Configure Windows installer association for both extensions and handle cold-start path. - one `fileAssociations` entry with `"ext": ["md", "markdown"]`; cold-start queue in `services/launch.rs` with `RUST-TESTS`
- [x] Queue secondary-instance launch requests until UI is ready; replace the active document. - `services/launch.rs` + `RUST-TESTS`
- [x] Implement safe external HTTP(S) opening and reject unsupported URL schemes. - `FE-TESTS` (`links.spec.ts`); `javascript:` and `file:` never become live destinations
- [x] Implement same-document anchors and validated relative Markdown link navigation. - `links.spec.ts`; fragment scroll in `DocumentView.tsx`
- [x] Add bounded relative-image command and object URL cleanup; block remote images. - `assets.ts` + `commands/assets.rs` (per-path accounting, size bounds, generation-guarded loads); remote sources render a placeholder
- [x] Verify traversal, symlink escape, executable link and malformed asset cases. - `RUST-TESTS`
- [ ] Test Explorer double-click/Open With and second launch on a Windows build. - `UNVERIFIED` (release gate 1)

## Phase 3 - Seven-feature reading experience
- [x] Style headings, lists, task boxes, tables, blockquotes, links and inline code. - `src/styles/document.css`; task boxes render disabled and read-only
- [x] Add Shiki with lazy grammar loading; plain-text fallback for unknown languages. - `highlighter.ts` + `CodeBlock.tsx`; `FE-TESTS` (`highlight.spec.ts`, `codeBlock.spec.tsx`)
- [x] Add code-block language label, scoped overflow and exact-content Copy. - `codeBlock.spec.tsx` asserts copy is the exact source with no added whitespace
- [x] Implement Light, Dark, System theme selector and OS theme listener. - `usePreferences.ts`, `ThemeMenu.tsx`; `preferences.spec.ts`
- [x] Persist and validate theme; test both palettes and OS change. - `FE-TESTS` (invalid stored values fall back); OS listener in the preferences hook
- [x] Build visible-text search index limited to document content. - `searchDom.ts`; `search.spec.ts` (chrome excluded, inline text runs together, no match across a line boundary)
- [x] Add highlight, result count, active match, Enter/Shift+Enter, Escape and Ctrl+F. - `useRenderedSearch.spec.ts` (reveal on request, no scroll on a mere rebuild) + `SearchBar.tsx`
- [x] Verify search does not break selection/copy and rebuilds after refresh. - highlights use the CSS Custom Highlight API, so the rendered tree is never mutated; rebuild on revision and on code-block settle
- [x] Implement 75–200% document zoom, buttons, shortcuts and persisted setting. - `preferences.spec.ts` clamps to range; zoom scales typography via `calc(var(--k-font-size-document) * var(--k-zoom))`; Ctrl+0 resets
- [ ] Verify the toolbar stays stable and wide code/tables remain contained at the minimum window size. - `UNVERIFIED` (release gate 3); scroll regions are in place in `document.css`

## Phase 4 - Refresh, resilience and polish
- [x] Watch the parent directory for target-file changes including rename-over-original saves. - `services/watch.rs`; the watcher holds the parent directory so atomic saves are seen
- [x] Debounce change events, retry transient reads and compare revision/hash before rerender. - retryable (transient) failures separated from failures that report immediately; content comparison in `watch.rs` with `RUST-TESTS`
- [x] Keep last good preview when missing/unreadable; show warning and recovery on return. - `document_unavailable` / `document_missing` events + notice; `RUST-TESTS`
- [x] Restore a nearest-visible-element scroll anchor, using ratio as fallback. - `scrollAnchor.ts`; `scrollAnchor.spec.ts` pins keep/restore/top, including "a different file starts at the top"
- [x] Preserve search query, focus and zoom after refresh; ignore obsolete watch events. - revision-guarded events; `useRenderedSearch.spec.ts`
- [x] Handle Ctrl+R explicit reload and cleanup of watchers on replace/close. - `App.tsx` keyboard map; watcher replaced on each open
- [ ] Test rapid saves, atomic saves, switch during read, deletion/recreation and unchanged content in the installed package. - `UNVERIFIED` (release gate 4; covered by Rust unit tests only)
- [ ] Check keyboard-only operation, screen reader labels, 480 px minimum width and both themes. - `UNVERIFIED` (release gate 3)
- [ ] Measure cold start and refresh in the release build and record device and document size. - `UNVERIFIED`; no timed run of the packaged binary yet
- [x] Build the Windows installer. - `INSTALLER`
- [ ] Smoke-test the installed package on this machine: install the `*-setup.exe` produced by `tools/dev-setup/build.ps1`, then double-click a `.md` and a `.markdown` and confirm each renders. - `UNVERIFIED`. This is a smoke test only; it does **not** satisfy release gate 1, which additionally covers Open With on a clean Windows environment (the release-gate item in this phase)
- [ ] Run the release gates in PRD.md on a clean, offline Windows environment. - `UNVERIFIED`; gates 1–6 have not been executed
- [x] Record test evidence and deviations in MEMORY.md. - handoff section updated; the release decision itself is still open

## Definition of done per task
Working code + relevant verification + no broadened permission or product scope + updated task status. A checkbox is not evidence of an installer-level behaviour until tested in a packaged Windows build.
