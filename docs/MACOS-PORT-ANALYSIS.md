# Inkfin macOS port analysis

**Status:** Baseline analysis, followed by the cross-platform foundation implemented on 17 October 2026 (see §0). macOS runtime remains unverified.
**Scope:** Whole repository at `main` (baseline at `130ba2e`, 25 Sep 2026), version 0.1.1.
**Purpose:** Establish how the Windows-first app is built today, what macOS can reuse unchanged, what must change, and how the port will be accepted without regressing Windows or the marketing website.

Legend:

- **Verified** — read in this checkout, or executed on this Windows machine.
- **Assumed** — high-confidence platform behaviour that has not been executed on macOS here.
- **Unknown** — genuinely unresolved; must be tested on a real Mac.

---

## 0. Implementation update (17 October 2026)

The launch, window, shortcut, path, bundle and capability parts of §6 are now implemented, without duplicating the renderer or changing Windows defaults:

- `src-tauri/src/services/launch.rs` converts macOS `file://` launch URLs to Markdown paths and canonicalises or refuses each launch path before it is queued. `launch_paths_from_urls` decides the whole Apple Event payload — decode, Markdown-only, canonicalise, drop duplicates, keep order — outside the `#[cfg(target_os = "macos")]` arm, so the policy is compiled and tested on Windows and the macOS arm is a five-line adapter.
- `src-tauri/src/lib.rs` handles `RunEvent::Opened` and `RunEvent::Reopen`; one `queue_launch` helper now serves argv, the second-instance callback and every URL in an Apple Event, so all entry points share one policy. `src-tauri/src/services/window.rs` provides shared activation plus macOS close-to-hide.
- The launch queue holds one request (`{ sequence, path }`): an undrained request is superseded by the next one, and `src/features/document/launchQueue.ts` serialises draining and ignores a sequence that is not newer than the one already applied. This is the ordering guarantee behind cold launch, Open With while running and rapid Finder switching. `docs/MACOS-FINDER-CHECKS.md` lists the checks that only a Mac can run.
- The shared `fileAssociations` entry now also declares `LSItemContentTypes` (`net.daringfireball.markdown`) and `LSHandlerRank` (`Default`), and a Rust contract test asserts both.
- The window shell was adapted to macOS from the shipped interface (not from `docs/DESIGN.md`, which describes an older blue system): `applyPlatform()` publishes the host on `<html>`, macOS gets the SF Pro font stacks and keeps its native overlay scrollbars, and the theme popover gained real menu keyboard behaviour. `docs/MACOS-UI-ADAPTATION.md` records the audit, the measurements and the twelve UI checks that only a Mac can run; `docs/screenshots/` holds Chromium-on-Windows captures.
- `src/features/platform/platform.ts` selects Command on macOS and Control elsewhere; the toolbar hints and copy follow it.
- `src-tauri/src/services/paths.rs` applies Win32 device/colon/drive rules only on Windows and compares POSIX components exactly; POSIX and Unix symlink tests were added.
- `src-tauri/tauri.macos.conf.json` adds `app`/`dmg` targets, `icon.icns` and macOS 14.2 while the base config keeps NSIS/WebView2/`.ico`.
- Capabilities remain window theme/title, dialog open and store only, scoped to the `main` window on desktop.
- The identifier (`com.inkfin.viewer`), store file/key and preference version are unchanged.

Verified on Windows: 71 frontend tests across 12 files, 30 Rust tests, typecheck, ESLint, Clippy, rustfmt and both Vite builds. A cross-target `cargo check --target aarch64-apple-darwin` was attempted and is blocked in `fsevent-sys`, so the macOS-only arms still compile for the first time on a Mac. Not verified: any macOS build or runtime behaviour, including Finder launch, dock reopen, bundle contents, the generated `Info.plist`, ICNS rendering, WKWebView and FSEvents. `docs/MACOS-FINDER-CHECKS.md` lists those as procedures. The sections below remain the baseline rationale and the acceptance checklist, not a claim about the current build.

---

## 1. Evidence collected

| Check | Result |
| --- | --- |
| `npm test` (Vitest, jsdom) | **Verified at baseline**: 9 files, 56 tests passing. After the 17 October foundation: 10 files, 61 tests |
| `npm run typecheck` | **Verified**: `tsc --noEmit` exit 0 |
| `npm run lint` | **Verified failing at baseline**: 18 errors, all in `website/app.js` and generated `website/dist/**`; the app's `src/**` was clean. Fixed on 17 October 2026 by excluding the separate website project from the app's ESLint run |
| `cargo test` | **Verified failing to start at baseline**: the build script read stale artifacts under `src-tauri/target/debug` that still pointed at `C:\Users\priya\Crisper\...`. Not a source defect. Verification on 17 October 2026 used a fresh `CARGO_TARGET_DIR`; 21 tests passed |
| Tauri APIs | **Verified in local crate sources**: `RunEvent::Opened { urls }` exists for macOS (`tauri-2.11.6/src/app.rs:263`); the default macOS menu is enabled by default (`app.rs:2031`); `tauri-plugin-single-instance 2.4.5` has a macOS implementation, but it uses a Unix socket and only intercepts a *second process* |
| macOS runtime | **Not executed.** This machine is Windows; no macOS build, install, Finder open, Gatekeeper or WKWebView check was performed |
| Git state at baseline | `main`; only `.freebuff/` was untracked. The foundation changes are described in §0 |

---

## 2. Architecture map

### 2.1 Layers and entry points

| Layer | Files | Responsibility |
| --- | --- | --- |
| Rust binary | `src-tauri/src/main.rs` | Calls `markdown_preview_lib::run()`; release builds use `windows_subsystem = "windows"` |
| Tauri builder | `src-tauri/src/lib.rs` | Registers single-instance, dialog and store plugins; manages `AppState`; exposes seven IPC commands; reads cold-start argv in `setup` |
| React entry | `src/main.tsx` | Imports tokens, Tailwind, app and document CSS, mounts `<App />` in StrictMode |
| App shell | `src/App.tsx` | Composes preferences, document controller, search, drag/drop, keyboard map, toolbar, view switch and status bar |
| Native bridge | `src/bridge/{native,events,parse}.ts` | Typed `invoke` wrappers and event subscriptions; every payload is parsed, never cast |
| Document state | `src/features/document/*` | Reducer/controller, types, asset object-URL cache, link classification, scroll anchoring |
| Rendering | `src/components/DocumentView.tsx`, `MarkdownImage.tsx`, `CodeBlock.tsx` | react-markdown + remark-gfm render tree, safe links, bounded images, Shiki tokens |
| Search | `src/features/search/*` | Rendered-text index, CSS Custom Highlight ranges, reveal controller |
| Preferences | `src/features/preferences/*` | Theme, zoom, persistence via `tauri-plugin-store` |
| Native policy | `src-tauri/src/{state,errors}.rs`, `commands/*`, `services/*` | Generation-guarded read-only access, path containment, watcher, launch queue |
| Packaging | `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/icons/*` | Window, CSP, capabilities, NSIS bundle, file associations, icons |
| Release | `.github/workflows/release.yml` | Tag-triggered Windows build published with `tauri-action` |
| Website | `website/*` | Separate static Vite site with its own lockfile; no deploy workflow in this repo |

Toolchain in use: Tauri 2 (Rust crate 2.11.6, JS API 2.11.1, CLI 2.11.5), Rust 2021 with `rust-version = "1.82"`, React 19.3, strict TypeScript 6, Vite 8, Tailwind 4, Shiki 4, Vitest 5.

### 2.2 Native state and IPC contract

`AppState` (`src-tauri/src/state.rs`) owns:

- `document: Option<ActiveDocument>` — immutable snapshot plus canonical path, base directory, generation and the set of already-counted assets.
- `watcher: Option<RecommendedWatcher>` — one live watcher; replacing or dropping it stops the previous watch.
- `pending_launch: Option<LaunchRequest>` — the newest OS launch request, kept until React drains it. Only one document can be on screen, so an earlier request is superseded rather than opened first.
- `generation: AtomicU64` — monotonic id for every open; stale responses and events are rejected.

`DocumentSnapshot` is `{ generation, canonicalPath, name, content, revision, baseDirectory }`; `revision` is the first 16 bytes of SHA-256, hex encoded (32 chars).

Commands registered in `lib.rs:45`:

| Command | Input | Behaviour |
| --- | --- | --- |
| `open_document` | `path` | Validates extension, canonicalises, regular file, ≤ 10 MiB, UTF-8, strips BOM; installs snapshot; replaces watcher |
| `open_linked_document` | `generation`, `link` | Resolves a relative Markdown link inside the active document's folder after symlink resolution |
| `reload_document` | `generation`, `expectedRevision` | Re-reads; returns `changed: false` when the hash is unchanged |
| `active_document` | — | Restores the document after a webview reload |
| `get_pending_launch` | — | Consumes the newest queued launch request (`{ sequence, path }`) |
| `open_external_link` | `url` | Allows only `http:`/`https:` with a host; uses `open::that_detached` |
| `read_relative_image` | `generation`, `reference` | Canonicalises, contains, MIME-checks, ≤ 8 MiB, ≤ 128 distinct assets, returns base64 bytes |

Events: `document_changed`, `document_missing`, `document_unavailable`, `launch_requested` (`src/bridge/events.ts`). Drag/drop is a webview event, not an IPC command.

Frontend controller invariants (`documentController.ts`): one request wins by request id; a failed open never erases a readable document; stale work is silent.

### 2.3 How a file is opened today

| Path | Mechanism | Files |
| --- | --- | --- |
| Toolbar / empty state | `@tauri-apps/plugin-dialog` `open()` → `open_document` | `Toolbar.tsx`, `EmptyState.tsx`, `documentController.ts` |
| Drag and drop | `getCurrentWebview().onDragDropEvent` → first `.md` path → `open_document`; extra files produce a notice | `src/bridge/events.ts`, `src/App.tsx` |
| Explorer cold start | NSIS file association → path in `argv` → `setup` queues it | `tauri.conf.json`, `lib.rs:54`, `services/launch.rs` |
| Explorer second launch | A second process starts; `tauri-plugin-single-instance` forwards `argv` to the first process → queue → `launch_requested` | `lib.rs` |
| Finder cold start / Open With | `application:openURLs:` → tao `Event::Opened` → Tauri `RunEvent::Opened` → `markdown_path_from_url` → canonicalise → queue | `lib.rs`, `services/launch.rs` |
| Dock drop | Same Apple Event path as Open With; a non-Markdown file is refused by `resolve_launch_path` | `lib.rs`, `services/launch.rs` |
| Relative Markdown link | Renderer classifies → `open_linked_document` | `links.ts`, `DocumentView.tsx` |
| Webview reload | `active_document` restores the snapshot | `documentController.ts` |

React drains the queue once on mount, once when the `launch_requested` subscription is established and on every `launch_requested`, so a path arriving before the webview listens — including one that lands between the first drain and the subscription — is not lost (`lib.rs` queue + event nudge, `features/document/launchQueue.ts`).

### 2.4 File access policy

`src-tauri/src/services/paths.rs` is the single gate:

- `validate_document_path`: non-empty, `.md`/`.markdown` case-insensitive, `dunce::canonicalize`, regular file, 10 MiB limit.
- `read_document`: repeats size/file checks, reads bytes, enforces UTF-8, strips one leading BOM.
- `is_within`: component-wise containment; `Normal` components compared ASCII-case-insensitively on every OS; Windows prefixes handled under `#[cfg(windows)]`.
- `safe_relative_path`: percent-decodes; rejects remote schemes, `//`, leading `/` or `\`, drive prefixes, NUL, `..`, empty segments, `:` inside a segment and Win32 device names (repeated because Win32 strips trailing spaces/dots).
- Assets: MIME from extension only (`png`, `jpg/jpeg`, `gif`, `webp`, `bmp`; SVG deliberately excluded), canonical containment, per-generation distinct-path budget, base64 over IPC, Blob/object URL, revoked on generation change. Remote images are refused in `MarkdownImage.tsx` before any IPC.

### 2.5 Rendering, search, themes, zoom, settings, watching

- **Markdown:** react-markdown + remark-gfm; raw HTML disabled; no `rehype-raw`; custom renderers for links, images, task checkboxes, `pre`, tables and headings; `safeUrlTransform` as defence in depth; no `dangerouslySetInnerHTML` anywhere in `src/`.
- **Highlighting:** Shiki core with the JavaScript regex engine (no WASM/CSP relaxation), grammars loaded by dynamic import, tokens rendered as React spans, 400k character cap, plain-text fallback for unknown/oversized/failed cases.
- **Search:** indexes rendered text, not source; a newline only at block boundaries; excludes `[data-search-exclude]` chrome; matches case-insensitively; paints via `CSS.highlights`/`Highlight` ranges, so the DOM, selection and copy are untouched; rebuilds on revision, root epoch and render epoch; reveals only on deliberate navigation.
- **Themes:** `light | dark | system`, stored as version 1 JSON via `tauri-plugin-store`; `matchMedia('(prefers-color-scheme: dark)')`; `data-theme` on `<html>`; native window `setTheme` with `null` for system.
- **Zoom:** 75–200% in discrete steps; applied as `--k-zoom` to document typography only; persisted; `Ctrl+0` resets.
- **Watching:** `notify::RecommendedWatcher` watches the parent directory non-recursively; filters events by basename; 200 ms debounce; up to 4 reads at 120 ms; hash comparison before emitting; watcher replaced per generation; deleted/unreadable file keeps the last readable preview and raises a notice.
- **Window chrome:** fully native. `decorations: true`, no `data-tauri-drag-region`, no custom titlebar component; only the title is set from React. This is the single most portable UI decision in the app.

### 2.6 Packaging, release and website

- `src-tauri/tauri.conf.json`: product `Inkfin`, version 0.1.1, identifier `com.inkfin.viewer`, 900×650 window (min 480×360), native decorations, strict CSP, asset protocol disabled, `bundle.targets: ["nsis"]`, Windows-only `webviewInstallMode: embedBootstrapper` and NSIS `currentUser` install, one file association for both extensions, icons are PNG + `.ico` only.
- `src-tauri/capabilities/default.json`: `core:default`, `allow-set-theme`, `allow-set-title`, `dialog:allow-open`, `store:default`; `"windows": ["main"]` is the **window label**, not the operating system.
- `.github/workflows/release.yml`: on `v*.*.*` tags or manual dispatch; `windows-latest`; Node 22; Rust stable; `npm ci`; `tauri-action` creates a published release. There is no test, lint or typecheck step, and no macOS job.
- Website: static Vite app in `website/`, independent `package.json`/lockfile; hero, features, privacy, FAQ, schema.org `SoftwareApplication` with `operatingSystem` Windows and a hard-coded `Inkfin_0.1.1_x64-setup.exe` download URL; `public/llms.txt`, `robots.txt`, `sitemap.xml`; deployed outside this repo (no workflow).

### 2.7 Shared versus Windows-bound code

| Fully reusable on macOS | Needs platform work | Windows-only today |
| --- | --- | --- |
| All seven commands, `state.rs`, `errors.rs`, watcher, generation model | `lib.rs` launch handling (`RunEvent::Opened`) | NSIS installer and `windows.*` bundle config |
| Path policy core (canonicalise, containment, size, UTF-8) | Case sensitivity, device-name and colon rules | `tools/dev-setup/{build.ps1,install-vsbuildtools.ps1,install-rust.sh}` |
| React shell, all components, controller, search, preferences, CSS tokens, scroll anchoring | Keyboard modifier map and Windows-specific copy | `windows_subsystem` release attribute (harmless on macOS) |
| CSP, capabilities, dialog and store plugins, external-link opener | Bundle config, icons, CI, docs/site copy | App screenshots used on the website |
| Vitest suites (61 tests) | Rust test fixtures that use `C:\...` paths | Rust tests under `#[cfg(windows)]` |

---

## 3. Windows-specific assumptions

| # | Assumption | Where | macOS consequence |
| --- | --- | --- | --- |
| 1 | A file request arrives as a command-line argument | `lib.rs` `setup`, `services/launch.rs`, single-instance callback | Finder double-click does not put the path in `argv`; it sends an Apple Event (`RunEvent::Opened`). Cold start and "open while running" both fail |
| 2 | A second launch is a new process | `lib.rs:29` | Finder activates the running app and sends `open-file`; no second process exists, so the single-instance socket never sees it |
| 3 | Shortcuts use `Ctrl` only; `metaKey` disqualifies | `src/App.tsx:168`, `Toolbar.tsx` titles | Every shortcut is dead on macOS; `Cmd+O/F/R/+/-/0` do nothing |
| 4 | Copy says "Following Windows" / "Windows refused" | `ThemeMenu.tsx:96`, `App.tsx:110` | Wrong OS copy in normal use |
| 5 | Installer target is NSIS; icons are PNG + ICO | `tauri.conf.json:41,46` | No `.app`/`.dmg` target, no `icon.icns`; macOS bundling cannot succeed as configured |
| 6 | Renderer is Chromium/WebView2 | `vite.config.ts` `build.target: 'chrome120'` | WKWebView may receive syntax newer than the OS Safari supports; the target should be Safari on macOS |
| 7 | UI/code fonts are Segoe and Cascadia/Consolas | `src/styles/tokens.css` | Falls through to `system-ui`/`Courier New`; acceptable but visibly off-brand |
| 8 | Path policy is Win32-first | `paths.rs` | Drive-prefix, reserved-name and colon rules are unnecessary on macOS; ASCII-case-insensitive containment is unsafe on case-sensitive APFS volumes; `C:\...` unit-test fixtures fail on Unix |
| 9 | Release builds only on Windows | `release.yml` | No signed/notarized macOS artifact, no `universal-apple-darwin` build |
| 10 | The product is "for Windows" | `README.md`, `package.json`, `docs/*`, `website/index.html`, `llms.txt` | Product, download and schema copy exclude macOS |
| 11 | File associations are registered by NSIS | `tauri.conf.json` `fileAssociations` | Tauri maps the same entry to `CFBundleDocumentTypes` on macOS (assumed; verify in a built `Info.plist`) |
| 12 | Native chrome is sufficient | `decorations: true`, no drag region | Reusable, but macOS needs an app menu (Quit, Edit) and ideally a platform-appropriate title format |

**Native or custom window controls?** Native. The window is decorated by the OS and there is no custom titlebar, drag region or window-button component. macOS will get standard traffic lights automatically; no rewrite is needed. The only macOS-specific choice is whether to keep the current titlebar or adopt `titleBarStyle: "Overlay"` for a more unified look; that is a design decision, not a blocker.

---

## 4. macOS compatibility matrix

| Area | Today | Verdict | Action |
| --- | --- | --- | --- |
| Window creation / native chrome | `decorations: true`, resizable, min size | **Reusable** | Verify traffic lights, full-screen and close/minimise |
| Window/menu shortcuts | No custom menu; Tauri enables a default macOS menu by default (verified in crate source) | **Likely works** | Verify Cmd+Q, Cmd+C/V/A and Edit menu; add menu accelerators if desired |
| Toolbar Open (picker) | `plugin-dialog` | **Reusable** | Verify dialog filters and POSIX paths |
| Drag and drop | Tauri webview drag/drop event | **Likely works** | Verify `.md` from Finder, multiple files, drag-out cancellation |
| Finder double-click, app not running | argv only | **Broken** | Handle `RunEvent::Opened` and queue the path |
| Finder double-click / Open With, app running | single-instance argv only | **Broken** | Same `Opened` handler; also handle `Reopen` to focus the window |
| Closing the last window / dock reopen | Window close destroys the only window; no `Reopen` handler | **Likely broken** | App can stay running with no window. Handle `Reopen` (rebuild or show) or define close-to-quit behaviour |
| Second process (`open -n`, CLI) | Unix-socket single-instance implementation | **Likely works** | Test; keep Windows callback unchanged |
| Relative Markdown links / anchors | Rust containment + renderer fragments | **Reusable** | Test paths with spaces and non-ASCII names |
| Path policy | Win32 rules applied everywhere | **Works, over/under-restrictive** | Scope Windows rules; use volume-appropriate case comparison |
| File watcher | `notify` parent-directory watch | **Likely works** | Test TextEdit safe-save, VS Code, `vim` rename save, delete/recreate |
| Markdown rendering | react-markdown + remark-gfm | **Reusable** | Verify GFM fixture in WKWebView |
| Syntax highlighting | Shiki JS engine + dynamic import | **Likely works** | Verify grammar chunk loading under CSP and macOS WebKit |
| Images | base64 → Blob object URL | **Reusable** | Verify PNG/JPEG/GIF/WebP; BMP decode in WebKit is **unknown** |
| Remote images | Blocked before IPC | **Reusable** | Verify placeholder |
| Search matching/navigation | Rendered DOM index | **Reusable** | Verify Cmd+F, Enter/Shift+Enter, Escape |
| Search highlighting | CSS Custom Highlight API | **OS-version dependent** | Requires Safari/WKWebView 17.2 or newer (shipped with macOS 14.2 and later, and as a Safari update on some older macOS releases); Tauri's default minimum is 10.13. Set an explicit floor or add a fallback |
| Themes | `matchMedia` + `setTheme(null)` | **Likely works** | Verify live OS appearance change and titlebar appearance |
| Zoom | CSS custom property | **Reusable** | Verify 75–200%, Cmd+0, no horizontal overflow at 480 px |
| Preferences | `tauri-plugin-store` | **Reusable** | Verify path under `~/Library/Application Support/...` and migration on upgrade |
| Fonts | Segoe/Cascadia first | **Cosmetic gap** | Add SF Pro / SF Mono / Menlo fallbacks |
| Icons | PNG + ICO, no ICNS | **Broken for bundling** | Generate `icon.icns` and include it |
| Bundle / DMG | `targets: ["nsis"]` | **Broken** | Add macOS target config |
| Code signing / notarization | Unsigned | **Distribution blocker** | Developer ID + notarization, or document the Gatekeeper override |
| Universal binary | None | **Missing** | Build arm64 + x64 or `universal-apple-darwin` |
| CI release | Windows only | **Missing** | Add macOS job and signing secrets |
| Website | Windows-only copy and EXE link | **Needs copy** | Add macOS download while preserving the Windows link |
| Tests | 61 FE pass; Rust Windows path literals are now gated | **Addressed on Windows** | POSIX parent/containment/colon and Unix symlink tests run on a macOS build |
| Offline promise | No network paths | **Reusable** | Verify with network disabled and a request monitor |

---

## 5. Risks

### High

1. **Finder/Open With launch is not implemented.** Both cold start and "open while running" depend on arguments. Tauri exposes `RunEvent::Opened` for exactly this; the app never uses the run-event callback. Without it, macOS's primary workflow (double-click a README) opens an empty window or does nothing. *Verified by code and crate API.* **Foundation (unverified on macOS):** `Opened`/`Reopen` are handled and the URL is queued through the shared launch path.
2. **macOS bundling is not configured.** `bundle.targets: ["nsis"]` cannot produce `.app`/`.dmg`; `icon.icns` is absent and `bundle.icon` lists no ICNS. *Verified by config and icon listing.* **Foundation (unverified):** `tauri.macos.conf.json` and `icons/icon.icns` now exist; no macOS bundle has been built.
3. **All keyboard shortcuts are Windows-only.** `App.tsx` requires `ctrlKey` and rejects `metaKey`. On macOS the app is usable only by mouse, except Escape/Enter in the search field. *Verified by code.* **Foundation:** `features/platform/platform.ts` selects Meta on macOS, and `tests/platform.spec.ts` covers both conventions.
4. **Unsigned distribution is harsher than SmartScreen.** A downloaded unsigned `.app`/`.dmg` is blocked by Gatekeeper with no "Run anyway" path in the normal dialog; users must use System Settings or `xattr`. Shipping without Developer ID signing and notarization is not a credible macOS release. *Assumed platform behaviour; standard for macOS.*
5. **WKWebView feature floor.** `minimumSystemVersion` defaults to 10.13 and Vite targets Chrome 120. Search highlighting needs the CSS Custom Highlight API (Safari/WKWebView 17.2+; macOS 14.2 ships it, and newer Safari updates brought it to some older macOS releases). On an older WebKit the app will report matches but paint no highlights, and `highlightsAvailable` is exposed but never shown to the user. *Externally assumed support floor; code path verified.*
6. **Windowless state after closing the last window.** Tauri follows the macOS convention of keeping the process alive when its last window closes, but the app has no `RunEvent::Reopen` handler. Closing the only window can leave a running app with no window and no obvious way to get one back. *Verified missing handler; exact Tauri close/reopen behaviour to confirm on macOS.*

### Medium

7. **Containment is ASCII-case-insensitive on every OS.** On a case-sensitive APFS volume, `is_within("/docs", "/DOCS/a.png")` can accept a sibling directory whose name differs only by case. Canonicalisation preserves the on-disk case, so exact comparison on Unix is sufficient and safer. *Verified by code; exploitability depends on the volume.* **Foundation:** comparison is now exact on POSIX and case-insensitive only on Windows; POSIX and Unix symlink tests were added.
8. **Rust tests are not portable.** `snapshots_expose_the_parent_folder_as_the_root` and `containment_accepts_children_and_rejects_siblings` use `C:\...` strings; on Unix those are single relative components, so they fail. The symlink-escape test is `#[cfg(windows)]` and is skipped on the platform where symlinks are most common. *Verified by reading; not run on macOS.* **Foundation:** Windows fixtures are gated, POSIX parent/containment/colon tests and a Unix symlink test were added; the POSIX tests run on a macOS build.
9. **Release automation has no macOS path and may race.** A second job publishing the same tag must attach to the existing release. Signing/notarization secrets (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) are absent. Universal builds need both Rust targets. *Verified absence; race behaviour assumed.*
10. **Watcher behaviour on FSEvents is untested.** Parent-directory watching should catch rename-over saves, but macOS safe-save, FSEvents coalescing and HFS+ Unicode normalization are not exercised. *Assumed.*
11. **File-association mapping is untested.** The same `fileAssociations` entry should become `CFBundleDocumentTypes` with role Viewer; only a built `Info.plist` and a real double-click can confirm. *Assumed.*

### Low

12. **Over-restrictive path rules on macOS.** A `:` inside a filename and names such as `CON.md` are legal on macOS but rejected. This is safe, only surprising.
13. **BMP support in WKWebView is uncertain.** The backend advertises `image/bmp`; verify decode or drop BMP on macOS.
14. **Fonts and copy.** Segoe/Cascadia fallbacks and "Following Windows"/"Windows refused" are visible polish gaps, not blockers.
15. **Scrollbar styling.** `scrollbar-width` support varies by Safari version; `::-webkit-scrollbar` may be ignored for overlay scrollbars. Cosmetic.
16. **Stale Cargo target directory** (verified here) blocks Rust builds after the checkout was renamed from `Crisper` to `Inkfin`; not macOS-specific but will waste the first porting session.
17. **Root lint is broken by the website.** `eslint .` lints `website/app.js` and generated `website/dist` with browser globals undefined. This masks app lint regressions and contradicts the README's "clean" claim. Fixing it is a prerequisite for a trustworthy port CI.
18. **`highlightsAvailable` is dead UI state.** No component reads it, so unsupported WebViews degrade silently. Either raise the OS floor or surface the limitation.

---

## 6. Proposed change list

This list is the original plan and its ordering. §0 records what was actually implemented on 17 October 2026, which is the current state; the items below remain the rationale. The order was chosen so macOS could be built and opened before UI polish.

### Phase 1 — Native launch and window activation (blocking)

- `src-tauri/src/lib.rs`
  - Replace `.run(tauri::generate_context!())` with `.build(...)` + `.run(|app, event| ...)`.
  - On `RunEvent::Opened { urls }` (macOS), convert each `url.to_file_path()`, accept Markdown paths, queue them (implemented as the shared `queue_launch`, which canonicalises, replaces instead of appending and emits `launch_requested`), then show/unminimise/focus the main window.
  - On `RunEvent::Reopen { .. }`, show/focus the main window, recreating it if closing the last window destroyed it.
  - Decide whether closing the last window hides it (so `Reopen` can show it) or exits; preserve Windows close semantics in either case.
  - Extract the existing focus/unminimise block from the single-instance callback into one helper so both paths behave identically.
  - Leave the Windows `argv` and single-instance paths untouched.
- `src-tauri/src/services/launch.rs`
  - Add a small, testable helper that filters a list of file URLs/paths to the first Markdown document (reuse `paths::is_markdown`).
  - Add unit tests for `file:///Users/.../README.md`, a non-Markdown URL, and a URL with percent-encoded spaces.
- `src-tauri/src/main.rs` — no change expected; confirm the `windows_subsystem` attribute is accepted (it is target-gated by `cfg_attr`).

### Phase 2 — macOS bundle and icon pipeline (blocking)

- `src-tauri/tauri.macos.conf.json` (new)
  - `bundle.targets: ["app", "dmg"]`.
  - `bundle.icon` including `icons/icon.icns`.
  - `bundle.macOS.minimumSystemVersion`: decide `"14.2"` (keeps CSS Custom Highlight support) or lower plus a search fallback.
  - `bundle.macOS.dmg` window/app positions if desired.
  - Leave `src-tauri/tauri.conf.json` Windows config as the base so `npm run tauri build` on Windows is unchanged.
- `src-tauri/icons/icon.icns` (new, generated)
- `tools/make-icons.py`
  - Generate a 1024px master and `icon.icns` (Pillow can write ICNS on macOS; alternatively use `iconutil` or `png2icns`).
  - Update the comment that currently declares ICNS "out of scope".
- `src-tauri/tauri.conf.json`
  - Either leave `targets: ["nsis"]` and rely on the macOS override, or change to `"all"` and verify Windows still emits NSIS. Prefer the platform override to minimise Windows risk.
  - Add `icons/icon.icns` to `bundle.icon` only if the macOS override cannot replace the list cleanly.
- `src-tauri/capabilities/default.json` — no change; confirm `"windows": ["main"]` is understood as the window label.

### Phase 3 — Keyboard, copy and renderer target

- `src/features/platform/platform.ts` (new)
  - `isMac` from the webview (`navigator.userAgent` containing `Mac OS X`; avoid adding a plugin for one boolean).
  - `primaryModifier(event)` and label helpers (`⌘O` vs `Ctrl+O`).
  - Keep it dependency-free and unit-testable.
- `src/App.tsx`
  - Replace `event.ctrlKey ... event.metaKey` gating with the platform-aware primary modifier; reject the opposite modifier and Alt.
  - Change "Windows refused to launch it" to OS-neutral wording.
  - Optionally format the window title as `Name — Inkfin` on macOS.
- `src/components/Toolbar.tsx`
  - Derive shortcut hints from the platform module.
- `src/components/ThemeMenu.tsx`
  - Replace "Following Windows" with "Following system" (correct on both platforms, no branching).
- `vite.config.ts`
  - Set the build target from `TAURI_ENV_PLATFORM`: `safari17` (or `safari17.2` for the highlight API) on `darwin`, keep `chrome120` on Windows. This preserves the Windows output byte-for-byte in intent and prevents newer syntax reaching WKWebView.
- `src/styles/tokens.css`
  - Add `'SF Mono', Menlo, Monaco` to `--k-font-code`; put `-apple-system` ahead of Segoe in UI/document stacks if desired.
- `tests/platform.spec.ts` (new)
  - Assert Mac uses Meta and rejects Ctrl, Windows uses Ctrl and rejects Meta, both reject Alt, and modifier labels are correct.

### Phase 4 — Path policy correctness and test portability

- `src-tauri/src/services/paths.rs`
  - Compare `Normal` components with `==` on Unix and ASCII-case-insensitively only under `#[cfg(windows)]` (or detect volume case sensitivity, but exact comparison is correct for canonical paths).
  - Gate Win32 reserved device names and the `:`-in-segment rejection under `#[cfg(windows)]`; keep NUL and traversal checks everywhere.
  - Add `#[cfg(unix)]` symlink-escape test using `std::os::unix::fs::symlink`.
  - Keep the existing Windows tests green.
- `src-tauri/src/commands/document.rs`
  - Gate `snapshots_expose_the_parent_folder_as_the_root` with `#[cfg(windows)]`, or rewrite it with platform-neutral `PathBuf` construction and separate Windows/macOS assertions.
- `src-tauri/src/services/watch.rs`
  - No production change expected. Add a macOS manual test fixture for TextEdit safe-save, VS Code save, and `vim` rename save; only change code if FSEvents proves lossy.
- `src-tauri/src/state.rs`, `commands/assets.rs`, `errors.rs` — no change expected.

### Phase 5 — CI, signing and release artifacts

- `.github/workflows/release.yml`
  - Keep the existing `build-windows-installer` job and tag/dispatch triggers.
  - Add a `build-macos` job. Pick the runner label deliberately after checking whether it is an Intel or Apple-silicon image; either build a universal binary by adding both targets, or use one runner per architecture.
  - Install both Rust targets when building universal: `aarch64-apple-darwin`, `x86_64-apple-darwin`.
  - Pass `--target universal-apple-darwin` (or per-arch) to `tauri-action`.
  - Inject signing/notarization secrets; do not hard-code them.
  - Confirm two jobs can publish into one release without racing; if not, upload artifacts to a draft release from a single job.
- Add a lightweight `check` job or step: `npm ci`, `npm run typecheck`, `npm test`, `cargo test`, `cargo clippy`, `cargo fmt --check`. The current workflow builds without testing.
- `eslint.config.js`
  - Ignore `website/**` (or at least `website/dist/**`) and give `website/app.js` browser globals, so root `npm run lint` is meaningful again.
- `package.json`
  - Add any macOS-specific scripts only if they remove real friction; otherwise document `npm run tauri build` per platform.

### Phase 6 — Docs, product copy and website

- `README.md`
  - Platform support, macOS install (DMG, drag to Applications, Gatekeeper note), macOS prerequisites (Xcode Command Line Tools), both shortcut sets, platform-specific release instructions.
- `package.json` `description` — drop "Windows".
- `docs/PRD.md` — change "Platform: Windows desktop first" to a supported-platform statement; keep macOS acceptance criteria in this document rather than rewriting the MVP.
- `docs/ARCHITECTURE.md` — add the macOS launch-event flow and platform-specific bundle layout.
- `docs/MEMORY.md` — record decisions (minimum macOS, universal vs per-arch, signing), evidence, and unresolved items; do not mark anything verified that was not run on macOS.
- `docs/TASK.md` — add a macOS phase with the acceptance criteria below as checkboxes.
- `website/index.html`
  - Add a macOS download button/link; keep the existing Windows EXE link and version untouched.
  - Update hero/eyebrow/FAQ, `SoftwareApplication.operatingSystem`, and any "for Windows" copy.
  - Consider a small OS-detected primary CTA, but do not remove the explicit Windows link.
- `website/public/llms.txt`
  - Add macOS support and both download filenames; keep the Windows link.
- `website/public/sitemap.xml`, `robots.txt` — no change expected.
- `website/app.js` — only if adding OS-aware CTA; keep it dependency-free.

### Phase 7 — Verification (no code)

- Build on macOS 14.2+ (arm64; optionally universal).
- Run the macOS acceptance criteria in section 7.
- Re-run the Windows release gates from `docs/PRD.md` on a Windows build from the same commit.
- Re-run `npm test`, `npm run typecheck`, root `npm run lint`, `cargo test`, `cargo clippy`, `cargo fmt --check`, and both Vite builds.
- Record exact commands, OS versions and observed behaviour in `docs/MEMORY.md`.

---

## 7. Acceptance criteria

### 7.1 macOS build and package

1. On macOS 14.2 or later with Node 20+, Rust stable and Xcode Command Line Tools, `npm ci && npm run tauri build` completes and produces `Inkfin.app` and a `.dmg` (or a documented universal equivalent).
2. The `.app` has the correct bundle identifier (`com.inkfin.viewer`), version matching `package.json` / `tauri.conf.json` / `Cargo.toml`, a valid `icon.icns`, and a `CFBundleDocumentTypes` entry for `md` and `markdown` with role Viewer.
3. The app launches with native traffic lights, no custom titlebar, and no console window.
4. If distributed outside the developer's machine, the build is Developer ID signed and notarized, and opens on a clean Mac without a Gatekeeper override. If unsigned, the limitation is documented and the build is not described as a normal install.

### 7.2 Opening files (all four routes)

Criteria 5–11 are executed as procedures with exact commands and expected results in `docs/MACOS-FINDER-CHECKS.md`; that file is the checklist to run on a Mac.

5. Toolbar Open opens the native picker filtered to `.md`/`.markdown`; choosing a file renders it.
6. Dragging one `.md` and one `.markdown` file onto the window renders each; dropping several shows the one-document notice and opens the first Markdown file; dragging a non-Markdown file produces a recoverable notice/error, not a crash.
7. Double-clicking a `.md` file in Finder with Inkfin not running launches the app and renders that file. No empty state, no lost path.
8. Double-clicking a `.md` file (or Open With → Inkfin) while Inkfin is running replaces the current document in the existing window and brings it to the front. No second window and no silently ignored path.
9. `open -a Inkfin /path/to/file.md` behaves like criterion 8.
10. Following a relative Markdown link inside the document replaces the document; `#fragment` links scroll; a link outside the document folder, an absolute path, `file:`, `javascript:` and `data:` are refused with a notice.
11. A webview reload (dev only) restores the active document.

### 7.3 Window, menu and keyboard

12. Cmd+O opens the picker, Cmd+F opens search, Cmd+R reloads, Cmd++/Cmd+- zoom, Cmd+0 resets, Escape closes search then a notice.
13. Cmd+C/V/A/X work in the document and in the search field; Cmd+Q quits; the app menu and Edit menu are present.
14. Ctrl-key combinations do not trigger app shortcuts on macOS (and Meta does not on Windows).
15. The window title shows the file name and updates when the document changes. Closing the last window follows a documented macOS convention (hide with dock reopen, or quit), and clicking the dock icon after closing reopens a usable window rather than leaving a windowless process.

### 7.4 Rendering parity

16. The GFM fixture renders headings, lists, task boxes (disabled), tables, blockquotes, links, images, inline/fenced code, strikethrough and footnotes.
17. Known languages highlight in both themes; unknown/oversized fences remain readable plain text; Copy yields exact code with no markup or added whitespace.
18. Local PNG/JPEG/GIF/WebP images load from the document folder; missing/invalid images show alt text and a placeholder; remote images and SVG are blocked; images outside the folder and symlink escapes are refused.
19. Raw HTML in Markdown is displayed as inert text and never executed.
20. Wide tables/code scroll inside their own regions; the page never gains horizontal scroll at the 480×360 minimum window.

### 7.5 Search

21. Cmd+F focuses the field; visible rendered text matches case-insensitively; count and active position are shown, including `0 results`.
22. Enter/Shift+Enter cycle matches; the active match is visibly distinct and revealed; Escape closes and clears.
23. Search never mutates the document, selection or copy; it excludes toolbar/code-header chrome; it does not match across block boundaries.
24. On the declared minimum macOS, highlights are visible. If the floor is below 14.2, an explicit fallback or a visible "highlighting unavailable" notice is shown.

### 7.6 Themes, zoom and settings

25. Light, Dark and System work; System follows a live macOS appearance change without restart; the native titlebar follows.
26. Theme and zoom persist across quit/relaunch in the app's macOS support directory; a corrupt settings file falls back to defaults without blocking reading.
27. Zoom works from 75% to 200% via buttons and Cmd shortcuts, Cmd+0 resets, only document typography scales, and the setting persists.

### 7.7 Live refresh

28. Saving from TextEdit (safe-save), VS Code (ordinary write) and `vim` (rename-over-original) refreshes the rendered document without a manual reload.
29. Rapid saves coalesce into one refresh; unchanged content does not re-render or move the page.
30. An automatic refresh preserves the approximate reading position and the search query, and does not steal focus.
31. Deleting the file keeps the last readable preview with a warning; recreating it refreshes and clears the warning.
32. Switching documents while a read is in flight never leaves the older document on screen; stale watcher events are ignored.

### 7.8 Security and privacy

33. No outbound network request occurs during open, render, highlight, search or refresh; the app renders with networking disabled. Remote images never attempt a fetch.
34. Traversal, symlink escape, a case-only sibling on a case-sensitive volume, oversized documents (> 10 MiB), invalid UTF-8, non-Markdown extensions and non-regular files are rejected with actionable messages and no raw OS text.
35. No document file is ever written or modified; preferences are written only inside the app's macOS support directory.
36. Capabilities remain limited to window title/theme, dialog open and store; no filesystem or shell plugin is exposed to the webview.

### 7.9 Windows non-regression

37. The existing Windows job still produces `Inkfin_<version>_x64-setup.exe` on a version tag, and the installer registers `.md` and `.markdown`.
38. On Windows, Explorer double-click cold start, Open With while running, a second launch, drag and drop and the picker all still work; the new `RunEvent::Opened` code is not required to change Windows behaviour.
39. All seven MVP features behave as before on Windows; `npm test` (61), `npm run typecheck`, the Rust suite (21 tests on Windows), `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` pass on a clean target directory.
40. The Windows build remains unsigned/NSIS and its SmartScreen behaviour is unchanged.

### 7.10 Website and docs

41. `website` still builds with its own `npm ci && npm run build`.
42. The Windows download URL, version and file name are unchanged; a macOS download points to an asset that actually exists on the release.
43. Schema.org `operatingSystem`, FAQ, hero copy and `llms.txt` list both platforms; no page claims macOS support before a macOS artifact exists.
44. `README.md` documents both platforms, both shortcut sets, macOS prerequisites and the signing/Gatekeeper status accurately.
45. `docs/MEMORY.md` records exactly what was verified on which OS; no macOS release gate is marked passed without an observed run.

---

## 8. Open questions

1. **Minimum macOS:** 14.2 (simplest, guarantees the CSS Custom Highlight API) or an older floor with a Safari-17.2 check and a search-highlight fallback? This determines the deployment target and the Vite target.
2. **Distribution:** Developer ID + notarization now, or an unsigned preview with a documented Gatekeeper workaround? This determines whether Phase 5 is release-blocking.
3. **Architecture:** universal binary (larger, one artifact) or separate arm64/x64 DMGs (smaller, more assets)?
4. **Window chrome:** keep the standard macOS titlebar, or adopt `titleBarStyle: "Overlay"` for a more designed look? Native is the safe default.
5. **Website CTA:** one "Download" with OS detection plus explicit links, or two equal platform buttons? The latter makes the Windows link unambiguous.
6. **File associations on macOS:** verify the generated `Info.plist` and whether macOS requires `LSHandlerRank` for "Open With" to list Inkfin; Tauri may not expose that key.
