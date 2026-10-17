# Inkfin - Technical Architecture

**Status:** Implemented on Windows. A macOS build foundation exists in this tree but has not been built or run on macOS. Platform-specific claims below are marked accordingly.

## Stack and deployment

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Shell/native | Tauri 2 + Rust | Window, launch events, validated read-only file access, file watching, packaging |
| Frontend | React 19 + strict TypeScript + Vite | Presentation and keyboard interactions |
| Styling | Tailwind CSS 4 + CSS variables | Reading surface and theme tokens |
| Markdown | react-markdown + remark-gfm | CommonMark/GFM component tree; raw HTML disabled |
| Highlighting | Shiki | Lazy grammar/theme loading; escaped token rendering |
| Icons | Lucide React | Accessible toolbar icons |
| Preferences | `tauri-plugin-store` | Theme and zoom only; never document contents |
| Backend/API/database/auth | None | The product runs entirely locally |

The renderer is shared by both platforms. Rendering, search, zoom, preferences and document state have no platform branches.

## Process and entry points

- `src-tauri/src/main.rs` calls `markdown_preview_lib::run()`.
- `src-tauri/src/lib.rs` builds the Tauri app: single-instance, dialog and store plugins, `AppState`, seven commands, the window-event hook and the run-event loop.
- `src/main.tsx` mounts `<App />`; `src/App.tsx` composes preferences, the document controller, search, drag/drop and the keyboard map.
- `src/bridge/{native,events,parse}.ts` is the only renderer access to native commands and events. Every IPC payload is parsed field by field.

## Native interface seams

Platform differences are deliberately small and live behind these modules:

| Concern | Shared interface | Windows | macOS |
| --- | --- | --- | --- |
| Launch | `services/launch.rs`: `markdown_arg`, `markdown_path_from_url`, `resolve_launch_path`; all feed `AppState::queue_launch` | argv from Explorer/Open With and from a second process | `RunEvent::Opened` file URLs; `RunEvent::Reopen` for the dock; drag/drop stays a webview event |
| File associations | One `fileAssociations` entry in the base config | NSIS registers the ProgID | Tauri maps the same entry to `CFBundleDocumentTypes` (not yet verified in a built app) |
| Paths | `services/paths.rs` is the only filesystem gate | Drive prefixes, reserved device names, `:` in a segment and case-insensitive component comparison | POSIX paths, exact component comparison, colon names allowed |
| Window | `services/window.rs`: `focus_main`, `on_window_event` | Closing the window keeps the existing close-to-exit behaviour | Closing the main window hides it; dock `Reopen` shows it again |
| Packaging | `tauri.conf.json` is the Windows base | NSIS installer, WebView2 bootstrapper, `.ico` | `tauri.macos.conf.json` overrides targets, ICNS icon and minimum macOS version |

No renderer component checks `navigator.platform` for window or file behaviour. The one platform decision the renderer makes is the shortcut modifier, isolated in `src/features/platform/platform.ts`.

## State and IPC contract

`AppState` (`src-tauri/src/state.rs`) owns the active document, the live watcher, the launch queue and a monotonic generation counter. A snapshot is:

```ts
type DocumentSnapshot = {
  generation: number;
  canonicalPath: string;
  name: string;
  content: string;
  revision: string; // first 16 bytes of SHA-256, hex
  baseDirectory: string;
};
```

The bridge exposes named, read-only commands rather than a filesystem API:

| Command | Input | Result/behaviour |
| --- | --- | --- |
| `open_document` | `path` | Validate extension, canonicalise, regular file, 10 MiB, UTF-8; return a snapshot and replace the watcher |
| `open_linked_document` | `generation`, `link` | Resolve a relative Markdown link inside the active folder after symlinks |
| `reload_document` | `generation`, `expectedRevision` | Re-read and report whether the hash changed |
| `active_document` | — | Restore the snapshot after a webview reload |
| `get_pending_launch` | — | Consume the newest queued launch request (`{ sequence, path }`) |
| `open_external_link` | `url` | Allow only `http:`/`https:` with a host |
| `read_relative_image` | `generation`, `reference` | Bounded, contained image bytes with a native MIME decision |

Events are `document_changed`, `document_missing`, `document_unavailable`, `document_recovered`, `document_watch_failed` and `launch_requested`. Drag/drop is a webview event. Events carry identity only, never file content. `document_recovered` exists because a file that returns with unchanged content produces no `document_changed`, and `document_watch_failed` reports a document whose folder could not be watched, so a stale preview is never silent.

## Opening a file

1. **Picker:** `@tauri-apps/plugin-dialog` returns a path; `open_document` validates it.
2. **Drag/drop:** Tauri's webview drag/drop event supplies real paths; the first Markdown file wins and extra files produce a notice.
3. **Windows launch:** Explorer starts the process with the path in `argv`, or a second process forwards `argv` through the single-instance plugin. Both push onto the pending queue.
4. **macOS launch:** Finder/Open With delivers a `file://` URL through `RunEvent::Opened`; `markdown_path_from_url` decodes and filters it, then queues it exactly like an argv launch. A CLI second process still uses the single-instance Unix socket.
5. **Relative links:** `open_linked_document` validates containment before replacing the document.
6. **Webview reload:** `active_document` restores the current snapshot.

The queue is the source of truth. `launch_requested` only nudges the webview, so a launch that arrives before React subscribes is not lost. The queue holds the newest request only: with one document on screen, an undrained earlier request is superseded rather than opened first. Each request carries a monotonic `sequence`, and `features/document/launchQueue.ts` applies only a sequence newer than the last one it opened, which keeps an out-of-order event from replacing the document the reader already has.

## File access and assets

`services/paths.rs`:

- Validates `.md`/`.markdown`, canonicalises with `dunce::canonicalize`, checks regular file, 10 MiB and UTF-8, and strips one BOM.
- `is_within` compares canonical components. It is ASCII-case-insensitive only on Windows; POSIX comparison is exact.
- `safe_relative_path` rejects remote schemes, absolute paths, traversal, NUL, and on Windows drive prefixes, alternate data streams and reserved device names.
- Images are limited to PNG/JPEG/GIF/WebP/BMP, 8 MiB each and 128 distinct files per document. SVG is excluded because it is scriptable.
- Image bytes cross IPC as base64, become a Blob/object URL, and are revoked when the generation changes. Remote images never reach the native layer.

## Rendering and search

- `DocumentView.tsx` renders react-markdown with remark-gfm. Raw HTML is never parsed, `rehype-raw` is absent, and no code path uses `dangerouslySetInnerHTML`.
- Custom renderers cover links, images, task checkboxes, fenced code, tables and headings. Links are classified before any native call.
- Shiki uses its JavaScript regex engine, dynamically imported grammars and React token spans. Unknown, oversized or failed highlights fall back to plain text.
- Search indexes the rendered DOM, not Markdown source. Block boundaries are the only newlines; chrome is excluded; matches are painted with CSS Custom Highlight ranges so selection and copy are untouched. The index rebuilds after refresh and after asynchronous highlighting settles.

## Themes, zoom and settings

- Theme is `light | dark | system`. `matchMedia` tracks the OS, `data-theme` drives tokens, and the native window theme follows (with `null` for system).
- Zoom is 75–200% in discrete steps, applied through `--k-zoom` to document typography only, and persisted.
- Preferences are versioned JSON (`version: 1`, `theme`, `zoom`) in the store plugin. Unknown versions fall back to defaults. The app identifier is `com.inkfin.viewer` and the store key/file name are unchanged across platforms, so settings migrate normally.

## Watching

`services/watch.rs` watches the document's parent directory non-recursively, filters to the target basename (compared as `OsStr`, so non-UTF-8 macOS names work), debounces for 200 ms, retries transient reads up to four times, and compares content hashes before emitting an event. Replacing the document replaces the watcher; stale generations are ignored. A missing or unreadable file keeps the last readable preview, and a file that comes back unchanged is reported as recovered. The loop is written against a `WatchHost` trait, so the same code is driven by `AppHandle` in production and by a recording host in the tests that run against real files.

## Packaging and capabilities

- `src-tauri/tauri.conf.json` remains the Windows base: NSIS target, WebView2 bootstrapper, `.ico`, and one association for `.md` and `.markdown`.
- `src-tauri/tauri.macos.conf.json` adds only macOS concerns: `app`/`dmg` targets, `icon.icns` and `minimumSystemVersion: 14.2`.
- `src-tauri/capabilities/default.json` grants only `core:default`, window theme/title, `dialog:allow-open` and `store:default`, scoped to the `main` window on Windows, macOS and Linux. No filesystem or shell plugin is exposed to the webview.
- The window is fully native (`decorations: true`); there is no custom titlebar or drag region.

Minimum macOS 14.2 is deliberate: the CSS Custom Highlight API used by search shipped in Safari/WKWebView 17.2, which macOS 14.2 includes.

## Verification strategy

- Frontend: Vitest covers link policy, search, highlighting fallbacks, scroll anchoring, preferences, document rendering, platform shortcuts and IPC parsing.
- Rust: unit tests cover path containment, traversal, Windows-only device/colon rules, POSIX case sensitivity, symlink escape (including extension borrowing), size/encoding boundaries, launch arguments, URL launches, asset and link resolution, and the watch loop against real files (ordinary and atomic saves, duplicate events, replaced documents, deletion, recovery). `docs/MACOS-DOCUMENT-PIPELINE.md` records the coverage and the Mac-only run sheet.
- Packaging: Windows installer checks and the macOS acceptance criteria live in `docs/MACOS-PORT-ANALYSIS.md` and `docs/TASK.md`.
- The macOS build, Finder events, close/reopen, WKWebView rendering and FSEvents saves remain unverified until a macOS build is run.
