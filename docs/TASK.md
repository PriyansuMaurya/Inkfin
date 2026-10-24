# Markdown Preview - Execution Plan

**Status:** Implemented and shipped on Windows; a macOS build foundation is implemented but has not been built or run on macOS. The historical Windows package referenced below is `src-tauri/target/release/bundle/nsis/Markdown Preview_0.1.0_x64-setup.exe`. Check boxes only after verification; record evidence and deviations in MEMORY.md. Phases reflect desktop integration; there is no authentication phase because the product has no accounts.

Evidence key used below:
- `FE-TESTS` - `npx vitest run`: 16 files / 95 tests passing (17 October 2026).
- `STATIC` - `npx tsc --noEmit` and `npx eslint .` clean (17 October 2026).
- `RUST-TESTS` - `cargo test --manifest-path src-tauri/Cargo.toml`: 59 tests passing on Windows (17 October 2026); `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` clean. `docs/MACOS-DOCUMENT-PIPELINE.md` lists what each test covers.
- `MACOS-UNVERIFIED` - implemented in a `#[cfg(target_os = "macos")]` branch or macOS-only config, but not compiled by the Windows toolchain or run on macOS.
- `INSTALLER` - `npx tauri build` produced `Markdown Preview_0.1.0_x64-setup.exe` (about 3.4 MB; the release compile step took 3m59s on the first cold build) alongside `markdown-preview.exe` (FileVersion 0.1.0, ProductName "Markdown Preview"). Byte counts are not quoted exactly because each build regenerates hashed frontend assets.
- `UNVERIFIED` - implemented, but **not** exercised in an installed build. Per the rule at the bottom of this file, these boxes stay unchecked.
- `INSTALLED` - `node tools/windows/installed-audit.mjs <setup.exe>`: installs the NSIS package, drives the installed executable over the DevTools protocol, reads the registry, uninstalls, and restores the extension keys it snapshotted. On 17 October 2026 it exited 0 with no failures on this Windows 11 host (not a clean machine).
- `CYCLE` - `node tools/windows/reinstall-cycle.mjs <setup.exe>`: install, install over the top, uninstall, then read the extensions. Exit 1 on the pre-fix package (both extensions left pointing at a deleted ProgID), exit 0 after the NSIS hooks.
- `INTERACTION` - `node tools/windows/interaction-probe.mjs <inkfin.exe>`: no-argument launch, zoom bounds and reset, theme switch, reduced motion. Exit 0 on 17 October 2026.
- `CI-MAC` - `.github/workflows/macos-acceptance.yml` run 39048972496 on `macos-14`, `macos-26` and `macos-15-intel`: the DMG mounted, `lipo` reported `x86_64 arm64`, the app copied to `/Applications`, launched, took an opened document into the running instance and quit cleanly. Gatekeeper refused the unsigned bundle.

**Formatter caveat:** `npm run format:check` uses Prettier with the style in `.prettierrc.json` (100 columns, single quotes) over everything except the authored specification docs and the NSIS hook script, which `.prettierignore` excludes by design. The config was added during implementation and the tree has **not** been reformatted to it, so `npx prettier --check .` still reports differences in 26 files. Typecheck and lint are clean; treat the formatter as outstanding (see MEMORY.md, BUG-003).

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
- [x] Test Explorer double-click/Open With and second launch on a Windows build. - `INSTALLED`: both extensions registered to the installed executable and both dispatched through the shell into the running instance (`.md` 146 ms, `.markdown` 115 ms), with the process count unchanged. Still `PARTIAL` for release gate 1, which asks for a **clean** Windows environment where nothing else claims `.md`

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
- [x] Verify the toolbar stays stable and wide code/tables remain contained at the minimum window size. - `INSTALLED` (464 × 321 client area at a 480 × 360 window, `scrollWidth` == `clientWidth`, toolbar visible) and `INTERACTION` (125 % zoom at that size, still no overflow). Pointer-level layout on a Mac remains part of `CI-MAC`'s open rows

## Phase 4 - Refresh, resilience and polish
- [x] Watch the parent directory for target-file changes including rename-over-original saves. - `services/watch.rs`; the watcher holds the parent directory so atomic saves are seen; `RUST-TESTS` drive the real platform watcher against real files for both save styles
- [x] Debounce change events, retry transient reads and compare revision/hash before rerender. - retryable (transient) failures separated from failures that report immediately; content comparison in `watch.rs` with `RUST-TESTS` (burst saves coalesce to one refresh, events for a replaced document are dropped, a half-written file is retried before it is reported)
- [x] Keep last good preview when missing/unreadable; show warning and recovery on return. - `document_unavailable` / `document_missing` events + notice; `document_recovered` withdraws the warning when the file returns unchanged; `RUST-TESTS` cover deletion, folder replacement, recovery and watch failure
- [x] Restore a nearest-visible-element scroll anchor, using ratio as fallback. - `scrollAnchor.ts`; `scrollAnchor.spec.ts` pins keep/restore/top, including "a different file starts at the top"
- [x] Preserve search query, focus and zoom after refresh; ignore obsolete watch events. - revision-guarded events; `useRenderedSearch.spec.ts`; `refreshContinuity.spec.tsx` asserts query, match count, theme and zoom across a real refresh through the app shell
- [x] Handle Ctrl+R explicit reload and cleanup of watchers on replace/close. - `App.tsx` keyboard map; watcher replaced on each open
- [x] Test rapid saves, atomic saves, switch during read, deletion/recreation and unchanged content in the installed package. - `INSTALLED`: an atomic rename over the open document appeared within 237 ms and the document folder held no leftover file; a refused open kept the previous document on screen. Rapid-save coalescing and unchanged-content handling remain `RUST-TESTS` only
- [x] Check keyboard-only operation, screen reader labels, 480 px minimum width and both themes. - `INSTALLED`: 11 Tab stops in the installed app, each with a visible focus ring; accessibility tree with 411 nodes and a textbox named `Find in document`; 464 × 321 client area with no overflow. `INTERACTION`: theme switched dark → light → dark and back without a restart; spoken screen-reader output is still unverified
- [x] Measure cold start and refresh in the release build and record device and document size. - `PKG` on this 13th Gen i7-13620H host: window 1129 ms (earlier build 772 ms), working set 26.96 MiB, refresh 234 ms, 364 KB / 5,000-line document 185 ms. `INSTALLED` on the same host: atomic save 237 ms
- [x] Build the Windows installer. - `INSTALLER`
- [x] Smoke-test the installed package on this machine: install the `*-setup.exe` produced by `tools/dev-setup/build.ps1`, then double-click a `.md` and a `.markdown` and confirm each renders. - `INSTALLED` on 17 October 2026: silent install, both extensions dispatched through the shell into the running instance, fixture rendered. This remains a smoke test and does **not** satisfy release gate 1, which asks for a clean Windows environment
- [ ] Run the release gates in PRD.md on a clean, offline Windows environment. - `UNVERIFIED`; gates 1–6 have not been executed
- [x] Record test evidence and deviations in MEMORY.md. - handoff section updated; the release decision itself is still open

## Phase 5 - Cross-platform foundation (macOS preparation)

- [x] Keep Markdown rendering, search, zoom, preferences and document state shared; no platform branches in those modules. - code review; `FE-TESTS`
- [x] Add a launch interface shared by argv and macOS file URLs (`services/launch.rs`), with URL tests. - `RUST-TESTS`
- [x] Handle macOS `RunEvent::Opened` and `RunEvent::Reopen` by queueing the path and focusing the existing window. - `MACOS-UNVERIFIED`; not executed on macOS
- [x] Route every launch entry point (argv, second instance, `RunEvent::Opened`, dock drop) through one `queue_launch` that canonicalises the path, refuses anything that is not Markdown, and replaces the pending request instead of appending. - `RUST-TESTS` (`state::tests`, `services::launch::tests`)
- [x] Drain the launch queue in the webview with one serialised loop that coalesces overlapping nudges and ignores a sequence older than the one already applied; also drain once the `launch_requested` subscription resolves, which closes the window between the first drain and the subscription existing. - `FE-TESTS` (`tests/launchQueue.spec.ts`, `tests/documentController.spec.tsx`)
- [x] Reject a launch-queue response that a newer open has overtaken, and stop a webview-reload restore from overwriting a document that a launch is opening. - `FE-TESTS` (`tests/documentController.spec.tsx`)
- [x] Declare the macOS document type by UTI as well as extension (`net.daringfireball.markdown`, rank Default) and assert it in the shared Rust contract tests. - `RUST-TESTS`; the generated `Info.plist` still needs a macOS build
- [x] Adapt the window shell for macOS from the shipped interface: macOS font stacks, native overlay scrollbars instead of the custom track, and the host published on `<html>` for CSS. - measured in the renderer (`docs/MACOS-UI-ADAPTATION.md` §3–§4); no macOS build
- [x] Audit title-bar spacing, window dragging, toolbar alignment and menu behaviour against macOS conventions, and record what deliberately does **not** change (native chrome, native title bar, Tauri's default menu). - `docs/MACOS-UI-ADAPTATION.md` §2; crate evidence for the default menu
- [x] Close the theme popover's keyboard gap: open on the current choice, Arrow/Home/End navigation, Space/Enter to apply, Escape/Tab to close and return focus. - `FE-TESTS` (`tests/themeMenu.spec.tsx`)
- [x] Raise the code Copy target to 28 px and re-measure the focus-ring clearance it sits in; an inset-ring override was measured and removed as unnecessary. - `docs/MACOS-UI-ADAPTATION.md` §2, §4
- [x] Keep keyboard labels platform-correct (⌘ on macOS, Ctrl elsewhere) and prove it in the running UI, not only in unit tests. - `FE-TESTS` + `docs/MACOS-UI-ADAPTATION.md` §4
- [x] Capture the shell at 900×650 and the 480×360 minimum, plus dark, narrow-search and forced-macOS variants, with the recipe and the platform caveat recorded. - `docs/screenshots/`; Chromium on Windows, not WKWebView
- [ ] Run the twelve UI checks that need a Mac (traffic lights, menu bar, SF Pro rendering, overlay scrollbars, focus rings, narrow window, zoom extremes). - `docs/MACOS-UI-ADAPTATION.md` §6; blocked until a Mac build runs
- [x] Add a window-behaviour interface (`services/window.rs`): shared activation, macOS close-to-hide, unchanged Windows close behaviour. - `MACOS-UNVERIFIED`; Windows side compiles
- [x] Scope Win32 drive/colon/device-name rules to Windows and compare POSIX components case-sensitively; add POSIX containment, colon and symlink tests. - `RUST-TESTS` on Windows; the `#[cfg(not(windows))]` tests will run on a macOS/Linux build
- [x] Make the shortcut modifier and labels platform-aware; keep Ctrl on Windows and use Command on macOS. - `FE-TESTS` (`tests/platform.spec.ts`)
- [x] Add macOS-only bundle config (`tauri.macos.conf.json`), `icon.icns`, and a macOS minimum of 14.2; leave the Windows base config unchanged. - `MACOS-UNVERIFIED`; no macOS bundle built
- [x] Preserve identifier `com.inkfin.viewer`, the store file/key and preference version 1. - diff review; no migration code changed
- [x] Audit capabilities: no filesystem or shell permission; only window theme/title, dialog open and store, scoped to `main` on desktop. - capability diff
- [x] Assert the file-association extensions and the macOS bundle contract against their config files from the shared Rust test suite. - `RUST-TESTS` (`services::contract_tests`)
- [x] Update `docs/ARCHITECTURE.md`, `docs/TASK.md`, `docs/MEMORY.md` and the macOS analysis with the real seams and unverified items. - this document set
- [ ] Build `.app`/`.dmg` on macOS and run every check in `docs/MACOS-FINDER-CHECKS.md` (Finder cold start, Open With while running, rapid switching, dock drop, dock reopen and Cmd shortcuts). - blocked until a macOS build runs
- [x] Decide distribution architecture and document the trade-off: one universal `.app`/`.dmg` rather than separate Apple silicon and Intel builds, revisiting if the download grows past roughly 50 MB. - `docs/MACOS-PACKAGING.md` §2
- [x] Add a macOS CI job that builds the universal bundle, labels the artifact by the signing secrets that exist, verifies both slices, and runs `codesign`/`spctl`/`stapler` checks when notarised. - `.github/workflows/release.yml`; YAML validated, shell steps reviewed, **never executed**
- [x] Publish the installable files to GitHub Releases from one workflow: Windows NSIS installer plus a universal macOS DMG whose file name states its real signing state, with a publish job that only runs once both builds exist. - `.github/workflows/release.yml`; YAML and script logic verified locally, no run on GitHub yet
- [x] Prepare signing and notarisation inputs without committing credentials: Developer ID certificate import, App Store Connect key handling, `APPLE_*` environment wiring and a secret list. - `docs/MACOS-PACKAGING.md` §4; no secret is stored in the repository
- [ ] Run the release workflow on a GitHub runner and attach the artifacts; record the distribution label, `lipo` output and signature results in `docs/MACOS-PACKAGING.md` §7. - blocked: no credentials available here, so M1–M6 stay open
- [x] Write one ordered macOS acceptance matrix covering install, every open path, associations, GFM, images, links, highlighting and copy, all three themes, search navigation, zoom bounds, ordinary and atomic saves, delete/recreate, invalid files and offline use; include the environment record, screenshot convention and defect/rerun rules. - `docs/MACOS-ACCEPTANCE-RUN.md`; **all rows NOT RUN**
- [x] Commit the fixture those rows use, including a relative image, a missing image, a blocked remote image, a long code line, inert raw HTML, a footnote and the two local links. - `docs/acceptance/fixture.md`, `docs/acceptance/linked-note.md`, `docs/acceptance/diagram.png`
- [x] Add a collector that records macOS version, hardware, artifact checksum, `lipo` slices, signing/notarisation state and the Gatekeeper verdict as a paste-ready table. - `tools/macos/acceptance-env.sh`; `bash -n` clean, exercised on the non-macOS path only
- [ ] Execute the acceptance matrix on Apple silicon and Intel (or Rosetta) with the signed/unsigned artifact, and record results, screenshots and defects. - **partially done**: `CI-MAC` run 39048972496 executed the automatable rows on macOS 14.8.9 (Apple silicon), 26.6.2 (Apple silicon) and 15.7.9 (Intel); install, launch, single instance, document open and clean quit all pass. Finder double-click, drag and drop, TCC folders, the pointer rows and spoken output still need a person on a Mac
- [x] Add a headless macOS acceptance script and a dispatch-only workflow so the Mac rows are decided by a real run rather than an assumption. - `tools/macos/acceptance.sh`, `.github/workflows/macos-acceptance.yml`; three green legs on 17 October 2026, and `build_run_id` lets a script fix be re-tested without rebuilding the DMG
- [x] Audit the installed Windows package: install, associations, Open With, second launch, minimum window, atomic save, denied file, keyboard, accessibility tree and offline simulation; then uninstall and restore the host. - `tools/windows/installed-audit.mjs`, `tools/windows/assoc-state.ps1`; exit 0, host byte-identical to its pre-install state
- [x] Fix the uninstall-after-reinstall association defect: an install over an existing install memorised Inkfin's own ProgID, so the uninstall restored an association to a ProgID it had deleted. - `src-tauri/nsis-hooks.nsh` via `bundle.windows.nsis.installerHooks`; `CYCLE` exit 1 before, exit 0 after, installed audit clean on the rebuilt package (BUG-008)
- [x] Rewrite the README install, requirements, release and limitation sections for two platforms without claiming a macOS download: Windows is available; macOS requirements, unsigned test-build command and the open gate are stated. - `README.md`; links resolve in the working tree
- [x] Add an explicit platform chooser to the single-page site: Windows with the real v0.1.1 installer, macOS marked `Not yet published` with no download link, plus requirements, signing status and a macOS FAQ entry. - `website/index.html`, `website/styles.css`, `website/public/llms.txt`; built and measured at 1440 and 390 px, no horizontal overflow
- [x] Add factual release notes with per-platform downloads, requirements and limitations, and keep the live GitHub release body unchanged until a macOS asset exists. - `RELEASE-NOTES.md`
- [x] Attach a macOS `.dmg` to the release alongside the Windows installer from one pipeline, named after its real signing state. - `v0.1.2`, run 39041541760: `Inkfin-0.1.2-universal-unsigned.dmg` 7,788,508 bytes, installer 3,700,009 bytes, `lipo` `x86_64 arm64`
- [ ] Attach a **signed, notarised** macOS `.dmg` and `.app.zip` to a release. - blocked: no Apple Developer ID or notarisation secrets are configured
- [x] Write a risk-based Windows/macOS test matrix covering opening, launch paths, rendering, search, zoom, themes, shortcuts, accessibility, refresh, hostile files and packaging, with blocking gates and per-row evidence keys. - `docs/TEST-MATRIX.md`
- [x] Audit the repository against that matrix, run the automated suites and drive the packaged Windows binary outside the app (window, CDP render, refresh, long document, signature state), and record per-row environment, result and evidence. - `docs/TEST-REPORT.md`; `FE-TESTS` 95/95, `RUST-TESTS` 59/59, clippy/fmt clean, packaged probe clean
- [x] Fix the relative-image first-paint race found by the packaged probe: images resolved before the asset cache had a document generation and stayed broken for the life of the document. - `src/features/document/assets.ts`; `tests/markdownImage.spec.tsx` (6 new tests), packaged probe now resolves the image in 1 ms
- [x] Add automated coverage for the file-level states the matrix names: empty, oversized, non-UTF-8, denied and vanished files through the real app shell. - `tests/fileStates.spec.tsx` (5 tests); `FE-TESTS`
- [ ] Verify the signed package on a clean Mac (Gatekeeper, stapling, acceptance matrix A1–K3) before publishing it. - blocked: no Mac and no credentials


## Definition of done per task
Working code + relevant verification + no broadened permission or product scope + updated task status. A checkbox is not evidence of an installer-level behaviour until tested in a packaged Windows build.


## Microsoft Store preparation — 24 October 2026

- [x] Prepare separate MSIX manifest, identity validation and Windows build workflow; MakeAppx build passed in run 40123888589.
- [x] Derive package logos and a 300×300 listing icon from the existing artwork.
- [x] Prepare listing/certification text and app privacy/support pages.
- [x] Build website and validate the static-assets Cloudflare deployment configuration with a dry run.
- [x] Push changes and execute the Windows MSIX workflow using the reserved Partner Center identity. - run 40123888589, artifact inkfin-microsoft-store-x64; checksum/block map/x64/unsigned-format verified.
- [ ] Test MSIX installation, both file associations, coexistence, offline use, update/removal and WACK on Windows.
- [ ] Capture current Store screenshots (at least 1366×768 PNG); existing screenshots are smaller.
- [ ] Deploy privacy/support pages to the existing Cloudflare project and verify their live URLs.
- [ ] Complete publisher verification/declarations, submit to Microsoft, and verify a live Store listing.

- [x] Remove the completed temporary preparation workflow after publishing the source branch. - commit 47c8676.
- [x] Add disposable-runner MSIX installation/rendering validation, with ephemeral signing of a test copy and cleanup. - store-validation.yml; execution result pending.
