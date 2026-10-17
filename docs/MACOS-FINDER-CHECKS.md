# macOS Finder open-flow checks (must run on a Mac)

**Status:** not executed. This machine is Windows, so every check below is a
procedure with an expected result, not a result. The Windows-verifiable parts of
the same code path (queue ordering, canonicalisation, controller sequencing) are
listed at the end with their evidence.

Purpose: prove that opening a `.md` or `.markdown` document works through every
entry point macOS offers — Finder "Open With", double-click on an association,
drag and drop, a dock drop, a cold launch and a second document while Inkfin is
already running — and that each one replaces the single document rather than
opening a second window or leaving a stale one on screen.

## 0. Prerequisites

```bash
node --version            # 20 or newer
rustc --version           # 1.82 or newer
npm ci
npm run tauri build       # builds .app and .dmg
```

Artifacts:

- `src-tauri/target/release/bundle/macos/Inkfin.app`
- `src-tauri/target/release/bundle/dmg/Inkfin_0.1.1_*.dmg`

Install and re-register with Launch Services (needed after every rebuild, or the
Finder keeps using the previously registered copy):

```bash
cp -R src-tauri/target/release/bundle/macos/Inkfin.app /Applications/
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Inkfin.app
```

`npm run tauri dev` runs an unbundled binary with no `Info.plist`. It cannot be
targeted by "Open With" or double-click, and it will not receive Apple Events, so
checks F1–F4, F6–F9 and F12 require the bundled app. Keep `tauri dev` for
drag-and-drop and shortcut checks (F8, F10) only.

## 1. Plist and registration checks

| # | Command | Expected |
| --- | --- | --- |
| P1 | `plutil -p /Applications/Inkfin.app/Contents/Info.plist` | Contains a `CFBundleDocumentTypes` array with `CFBundleTypeExtensions` = `["md","markdown"]`, `CFBundleTypeRole` = `Viewer`, `LSItemContentTypes` = `["net.daringfireball.markdown"]`, `LSHandlerRank` = `Default` |
| P2 | `plutil -p /Applications/Inkfin.app/Contents/Info.plist \| grep -A2 CFBundleIdentifier` | `com.inkfin.viewer` |
| P3 | `mdls -name kMDItemContentType /path/to/notes.md` | `net.daringfireball.markdown` (if this returns `dyn.*`, the UTI check in F2 will not be decisive — record that) |
| P4 | `mdls -name kMDItemContentTypeTree /path/to/notes.md` | Includes `net.daringfireball.markdown` |
| P5 | Right-click `notes.md` → **Open With** → *Other…* → choose `/Applications/Inkfin.app` | Inkfin appears in the Open With list without using *Other…* |

## 2. Flow checks

Record macOS version, the `.app` build date and the result for each.

| # | Steps | Expected |
| --- | --- | --- |
| F1 | Quit Inkfin (⌘Q). In Finder, right-click `notes.md` → **Open With** → Inkfin | App launches, window comes to the front, `notes.md` is rendered, window title is `notes.md - Inkfin`, status bar shows the canonical path |
| F2 | Select `notes.md` → ⌘I → **Open With** → Inkfin → **Change All…** → Continue. Then double-click `notes.md` while Inkfin is running | Inkfin opens the document; the document is rendered in the existing window, not a new one |
| F3 | With `a.md` on screen, double-click `b.md` in Finder | The same window now shows `b.md`; window title and status path both change; no second window appears |
| F4 | Double-click `b.md` then `c.md` quickly (within about a second) | Ends on `c.md`. A brief flash of `b.md` is acceptable; ending on `b.md` or showing an error for either file is not |
| F5 | Select `a.md` and `b.md` together, right-click → **Open With** → Inkfin | Ends on the last selection; the single-document notice is not required here |
| F6 | Close the window with the red button (app stays in the dock), then double-click `b.md` in Finder | The window reappears with `b.md`; the app does not relaunch and a second dock icon does not appear |
| F7 | With the window closed, click the Inkfin dock icon | The window reappears showing the same document as before |
| F8 | Drag `notes.md` from Finder onto the Inkfin window | The drag overlay appears, then the document opens and replaces the current one |
| F9 | Drag `notes.md` onto the Inkfin dock icon | Same as F8 |
| F10 | Drop `notes.txt` onto the window | The previous document stays on screen and a notice explains the refusal; the app does not go blank |
| F11 | Drop two Markdown files at once onto the window | The first Markdown file opens and a notice says the other was ignored |
| F12 | Run `open -a /Applications/Inkfin.app /path/to/notes.md` twice with different files | The document is replaced; Activity Monitor shows exactly one `Inkfin` process |
| F13 | Open a document in a folder whose path contains a space and a non-ASCII character; then open the same file through a symlink elsewhere | Both show the file, and the status bar shows the canonical (symlink-resolved) path in both cases |
| F14 | With `a.md` open, move `b.md` to the Trash, then double-click `b.md` from the Trash while Inkfin is running | An actionable "not found" notice appears and `a.md` stays on screen |

## 3. Keyboard and dialog checks

| # | Steps | Expected |
| --- | --- | --- |
| K1 | ⌘O | The file picker opens filtered to `.md`/`.markdown` |
| K2 | Ctrl+O | Nothing happens (Control is not the macOS modifier) |
| K3 | ⌘F, ⌘R, ⌘+, ⌘-, ⌘0 | Search, reload, zoom in/out/reset |
| K4 | Toolbar **Open** button and the empty-state **Open a file** button | Same dialog as K1 |
| K5 | Cancel the dialog | The document on screen is unchanged |

## 4. Evidence the event path is wired as expected

The macOS entry point is Tauri's `RunEvent::Opened`, which is produced by
`application:openURLs:` in the NSApplicationDelegate. In the crates this project
builds against:

- `tauri-2.11.6/src/app.rs:263` — `RunEvent::Opened { urls: Vec<Url> }` (macOS, iOS, Android).
- `tauri-runtime-wry-2.11.4/src/lib.rs:4387` — forwards the runtime event to the builder's `run` closure.
- `tao-0.35.3/src/platform_impl/macos/app_delegate.rs:136` — `application:openURLs:` handler.
- `tao-0.35.3/src/platform_impl/macos/event_loop.rs:233` — `AppState::set_callback` runs *before* `[NSApp run]`, so an Apple Event delivered during startup still reaches the callback. This is why a cold launch can be queued rather than lost.

No Finder check can be replaced by argv handling: macOS does not put the document
path in `argv`, so F1 and F2 are the only proof that the Apple Event path works.

## 5. What was verified without macOS

| Check | Command | Result |
| --- | --- | --- |
| Rust unit + contract tests | `cargo test` (`CARGO_TARGET_DIR` set to a fresh directory) | 59 passed / 0 failed, including launch-queue ordering, launch-path canonicalisation, the Apple Event payload policy (filtering, order, duplicate removal), the `Info.plist` contract assertions (extension list, `Viewer` role, `Default` rank, `net.daringfireball.markdown`) and the filesystem and watcher checks listed in `docs/MACOS-DOCUMENT-PIPELINE.md` |
| macOS compile check | `rustup target add aarch64-apple-darwin && cargo check --target aarch64-apple-darwin` | **Not possible here**: it fails in `fsevent-sys` (`notify`'s macOS backend), which needs a C compiler for the darwin target. The `#[cfg(target_os = "macos")]` arms are therefore still compiled for the first time on a Mac |
| Frontend tests | `npm test` | 84 passed across 14 files, including the launch drainer (order, coalescing, stale sequence, dispose, recovery), the controller (overlapping opens, queued launch, watcher change/missing/recovered/watch-failure) and refresh continuity (search query, theme, zoom) |
| Types and lint | `npm run typecheck`, `npm run lint` | Exit 0 |
| Bundle config for macOS | `TAURI_ENV_PLATFORM=darwin npx vite build` | Exit 0 (renderer targets `safari17` only for a macOS build) |
| `Info.plist` content | — | **Not verified**: written by the macOS bundler only. P1 is the check that must be run. |

## 6. Known gaps to record during the run

- A non-Markdown file dragged onto the dock icon is ignored silently: the dock
  drop delivers any file, and the enqueue path refuses anything that is not
  `.md`/`.markdown`. If that reads as an unexplained no-op, it needs copy.
- Signing and notarization are not implemented. Without them Gatekeeper
  quarantines a downloaded `.dmg`; a locally built `.app` is unaffected.
- `LSItemContentTypes` relies on Apple's own declaration of
  `net.daringfireball.markdown`. If P3/P4 show `dyn.*` on the test machine, the
  extension association is still what makes F1/F2 work and the UTI line should
  be reported as inconclusive rather than failing the flow.
