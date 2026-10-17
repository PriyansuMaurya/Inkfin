# Inkfin test matrix

Risk-based matrix for the desktop app on Windows and macOS, version 0.1.2.

Scope: local opening (picker, drag and drop, associations, second launch), Markdown
rendering (tables, footnotes, links, relative images, highlighting, copy), search, zoom,
themes, shortcuts and accessibility, automatic refresh after ordinary and atomic saves,
hostile input (empty, oversized, invalid, deleted, permission-denied, Unicode paths,
symlinks, traversal, unsafe links, rapid switching, long documents), keyboard use, narrow
windows, offline operation, startup time, memory use, refresh latency, packaged install,
and signing/notarisation.

## How to read this

- **Risk** — how bad a failure is for a reader. `Critical` breaches privacy or security,
  or loses/corrupts data; `High` blocks the primary workflow (open and read a file);
  `Medium` degrades reading; `Low` is cosmetic or a convenience.
- **Status** — `PASS` (automated, reproducible here), `FAIL` (reproducible defect, logged
  in [TEST-REPORT.md](TEST-REPORT.md)), `UNVERIFIED` (**not** exercised in the environment
  named in the last column), `BLOCKED` (cannot be reached without hardware or credentials
  this repository does not have).
- **Evidence** — the test that decides the row. `FE` = `npx vitest run`, `RS` =
  `cargo test --manifest-path src-tauri/Cargo.toml`, `PKG` = the packaged Windows binary,
  `CI` = GitHub Actions run 39041541760. A row may be `PASS` at unit level and
  `UNVERIFIED` at package level; both cells are filled in that case.
- Rows are stable IDs. Report rows are keyed to them, so a *fix* changes a verdict, not a
  name.

**A row is only `PASS` for the environment it names.** Unit-level green never promotes a
packaging or native-hardware row.

## Blocking acceptance criteria

The app may be described as release-ready only when these pass on the named environment.
None of them is satisfied by unit tests alone.

| ID | Criterion | Environment |
| --- | --- | --- |
| GATE-W1 | Install the NSIS package, double-click a `.md` and a `.markdown`, both render | Clean Windows 10/11 x64 |
| GATE-W2 | Open With works while an instance is already running; the second path replaces the document | Clean Windows 10/11 x64 |
| GATE-W3 | Search, zoom and keyboard navigation hold at 480 × 360 in the package | Clean Windows 10/11 x64 |
| GATE-W4 | Ordinary and atomic saves refresh without jumping to the top, in the package | Clean Windows 10/11 x64 |
| GATE-W5 | Hostile links, raw HTML, symlink escapes and denied paths expose nothing | Clean Windows 10/11 x64 |
| GATE-W6 | The package works offline and never writes to the document | Clean Windows 10/11 x64 |
| GATE-M1 | Install the DMG and launch from `/Applications` on macOS 14.2+ and on the newest macOS | Clean macOS, Apple silicon and Intel |
| GATE-M2 | Gatekeeper accepts the download; the ticket is stapled | Clean macOS, signed build |
| GATE-M3 | macOS acceptance matrix A1–K3 in [MACOS-ACCEPTANCE-RUN.md](MACOS-ACCEPTANCE-RUN.md) | Clean macOS |
| GATE-S1 | The distributed Windows installer is code-signed | Signing certificate |
| GATE-S2 | The distributed macOS DMG is Developer ID signed and notarised | Apple credentials |

## A. Opening and launching

| ID | Risk | Scenario | Expected | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | High | Open a file through the native picker | `.md`/`.markdown` filter; chosen file replaces the document | FE `native.spec.ts` (dialog mocked) | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows |
| A2 | High | Drag one Markdown file onto the window | Document opens; overlay shown during drag | FE `App` drop path; overlay copy in `App.tsx` | UNVERIFIED (pkg) | clean Windows, clean macOS |
| A3 | High | Drag several files | First valid Markdown opens, notice for the rest | FE drop handling | UNVERIFIED (pkg) | clean Windows, clean macOS |
| A4 | Critical | Double-click a `.md` / `.markdown` in Explorer or Finder | App starts with that document | RS `services::mod::file_associations_cover_the_document_extension_policy`, `services::launch::tests::finds_a_markdown_argument_and_ignores_the_executable` | PASS (config) / UNVERIFIED (shell) | clean Windows, clean macOS |
| A5 | High | Second launch while running (`Open With`, `open -a`, dock drop) | Existing window focuses and replaces the document; no silent drop | RS `services::launch::tests` (7 cases), FE `launchQueue.spec.ts` (8 cases) | PASS (unit) / UNVERIFIED (pkg) | clean Windows, clean macOS |
| A6 | Medium | Cold start via macOS `RunEvent::Opened` | Path queued before the window exists, then opened | RS `services::launch::tests`, FE `documentController.spec.tsx::opens the queued document once the surface mounts` | PASS (unit) / UNVERIFIED (macOS) | clean macOS |
| A7 | Low | Launch with no argument | Empty state with Open button | FE `App` empty view | UNVERIFIED (pkg) | clean Windows, clean macOS |
| A8 | Medium | macOS dock reopen after closing the window | Window returns with the same document | RS `services::window.rs`; [MACOS-FINDER-CHECKS.md](MACOS-FINDER-CHECKS.md) | UNVERIFIED | clean macOS |

## B. Rendering

| ID | Risk | Scenario | Expected | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | High | Headings, lists, task boxes, blockquotes, strikethrough, fenced code | Rendered as a document | FE `documentView.spec.tsx` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| B2 | High | Tables, including wide ones | Rendered; own horizontal scroll region; page never overflows | FE `documentView.spec.tsx::surrounds a table with its own scroll region` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows |
| B3 | Medium | Footnotes | Rendered and navigable | FE render coverage in `documentView.spec.tsx`; fixture `docs/acceptance/fixture.md` | PARTIAL (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| B4 | High | Relative image beside the document | Loaded through the command, MIME from the extension | RS `commands::assets::tests` (7 cases) | PASS (unit) / UNVERIFIED (pkg) | Windows / clean Windows, clean macOS |
| B5 | High | Missing image | Alt text and a subtle indicator, no error state | RS `assets::tests::a_missing_image_or_a_folder_is_refused`, FE `documentView.spec.tsx` | PASS (unit) / UNVERIFIED (pkg) | Windows / clean Windows |
| B6 | Critical | Remote image in Markdown | Blocked, placeholder only, zero network requests | FE `documentView.spec.tsx::does not turn a relative image into a fetch of a remote resource`; CSP | PASS (unit) / UNVERIFIED (pkg, offline check) | jsdom / clean Windows, clean macOS |
| B7 | High | External `http(s)` link | Opens in the default browser | FE `links.spec.ts`, `DocumentView` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| B8 | High | Relative `.md` link, and a fragment link | Validated navigation; fragment scrolls in place | RS `commands::document::tests`, FE `links.spec.ts` | PASS (unit) / UNVERIFIED (pkg) | Windows / clean Windows, clean macOS |
| B9 | Critical | Raw HTML in Markdown | Rendered as inert text, never executed | FE `documentView.spec.tsx::never parses raw HTML from the Markdown source` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| B10 | Medium | Known language in a fence | Highlighted in both themes | FE `highlight.spec.ts`, `codeBlock.spec.tsx` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| B11 | Medium | Unknown language or oversized fence | Plain text, never a freeze | FE `highlight.spec.ts` (2 cases) | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows |
| B12 | Medium | Copy a code block | Exact source, no markup or added whitespace, with feedback | FE `codeBlock.spec.tsx` (2 cases) | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| B13 | Low | Wide code line | Scrolls inside the block, page stays contained | FE `CodeBlock` scroll region; `document.css` | PARTIAL (unit) / UNVERIFIED (pkg) | jsdom / clean Windows |
| B14 | Medium | Long document (about 300 KB, 5,000 lines) | Renders without freezing the UI | none | UNVERIFIED | clean Windows, clean macOS |

## C. Search, zoom, themes, shortcuts, accessibility

| ID | Risk | Scenario | Expected | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Medium | Ctrl/Cmd+F, type a word | Visible document text matched case-insensitively; count and active result shown | FE `search.spec.ts` (9), `useRenderedSearch.spec.ts` (5) | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| C2 | Medium | Enter / Shift+Enter / Escape | Navigate results; Escape closes and restores focus | FE `SearchBar` + `useRenderedSearch.spec.ts` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| C3 | Medium | Search chrome vs document text | Toolbar and code labels are never matched | FE `search.spec.ts::excludes chrome` | PASS (unit) | jsdom |
| C4 | Low–Medium | Zoom buttons, Ctrl+±, Ctrl+0 | 75–200 %, clamps, resets to 100 %, persists | FE `preferences.spec.ts` (6 cases) | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| C5 | Medium | Light / Dark / System, OS change while running | Applies without restart; persists; invalid stored value falls back | FE `preferences.spec.ts`, `themeMenu.spec.tsx` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| C6 | Medium | Theme menu by keyboard | Opens on current choice; Arrow/Home/End; Space/Enter apply; Escape/Tab close and return focus | FE `themeMenu.spec.tsx` (4 cases) | PASS (unit) / UNVERIFIED (pkg) | jsdom |
| C7 | High | Shortcut modifier per platform | ⌘ on macOS, Ctrl elsewhere; Alt never treated as an app shortcut | FE `platform.spec.ts` (5 cases) | PASS (unit) / UNVERIFIED (macOS runtime) | jsdom / clean macOS |
| C8 | Medium | Keyboard-only operation end to end | Every control reachable, visible focus, no traps | FE focus-order assertions in component tests | PARTIAL (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| C9 | Medium | Screen reader semantics | Named controls, `role=status`/`alert` for open progress and errors | FE component tests assert roles | PARTIAL (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| C10 | Medium | Window at 480 × 360 and 480 px wide | Toolbar stable, no page-wide horizontal overflow | [MACOS-UI-ADAPTATION.md](MACOS-UI-ADAPTATION.md) measurements; screenshots | UNVERIFIED (pkg) | clean Windows, clean macOS |
| C11 | Low | Reduced-motion preference | Animations suppressed | `prefers-reduced-motion` rules in CSS | UNVERIFIED (pkg) | clean Windows, clean macOS |
| C12 | Medium | Offline use | Full function with no network; no request attempted | CSP + blocked remote images; B6 | UNVERIFIED (offline pkg) | clean Windows offline, clean macOS offline |

## D. Refresh after external saves

| ID | Risk | Scenario | Expected | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | High | Ordinary save from another editor | Preview updates once | RS `services::watch::tests` (real watcher, real files) | PASS (unit) / UNVERIFIED (pkg) | Windows / clean Windows, clean macOS |
| D2 | High | Atomic save (temp file rename over the original) | Seen, because the parent directory is watched | RS `services::watch::tests` | PASS (unit) / UNVERIFIED (pkg) | Windows / clean Windows, clean macOS |
| D3 | Medium | Burst of saves | Coalesced into one refresh | RS `watch::tests` | PASS (unit) / UNVERIFIED (pkg) | Windows |
| D4 | High | Refresh keeps reading position | Nearest-visible-element anchor, ratio fallback | FE `scrollAnchor.spec.ts` (4 cases) | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| D5 | High | Refresh keeps search query, match count, theme, zoom | Preserved across a real refresh | FE `refreshContinuity.spec.tsx` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| D6 | Medium | Save with unchanged content | No rerender | RS revision compare in `watch.rs` | PASS (unit) | Windows |
| D7 | High | Delete the open file | Last good preview kept with a warning | RS + FE `documentController.spec.tsx::keeps the last readable preview when the file is deleted` | PASS (unit) / UNVERIFIED (pkg) | Windows, jsdom / clean Windows, clean macOS |
| D8 | Medium | File returns unchanged | Warning withdrawn, no flicker | FE `documentController.spec.tsx::withdraws the missing warning when the file comes back unchanged` | PASS (unit) | jsdom |
| D9 | Medium | Folder cannot be watched | Reader told live refresh is off; document still readable | RS `watch::tests`, FE `documentController.spec.tsx` | PASS (unit) | Windows, jsdom |
| D10 | Medium | Half-written file during save | Retried, then reported if still broken | RS `errors::tests::retry_is_limited_to_save_in_progress_states` | PASS (unit) | Windows |
| D11 | Medium | Refresh latency for an ordinary save | Under 500 ms (PRD target) | none | UNVERIFIED | clean Windows, clean macOS |

## E. File edge cases

| ID | Risk | Scenario | Expected | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | Medium | Empty file | Quiet empty-document message, no error | FE status line assertion (new); `App.tsx` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| E2 | High | File over 10 MiB | Refused before loading, with a recoverable, actionable error | RS `services::paths::tests::the_document_size_limit_is_enforced_at_the_boundary`, FE error view | PASS (unit) / UNVERIFIED (pkg) | Windows / clean Windows, clean macOS |
| E3 | High | Invalid UTF-8 | Refused with a specific message, not a crash | RS `paths::tests::extension_encoding_and_byte_order_marks_are_handled` | PASS (unit) / UNVERIFIED (pkg) | Windows |
| E4 | Medium | Byte order mark | Stripped, content otherwise preserved | RS `paths::tests::utf8_content_is_preserved_except_for_the_byte_order_mark` | PASS (unit) | Windows |
| E5 | High | File deleted between pick and read | Actionable error, previous document kept if any | RS + FE `documentController.spec.tsx::keeps the document on screen when a later open fails` | PASS (unit) | Windows, jsdom |
| E6 | High | Permission denied | `denied` error, no raw OS text | RS `paths::tests::a_document_the_system_refuses_to_read_is_reported_as_denied` (POSIX mode bits); FE `native.spec.ts` message mapping | PARTIAL (unit, POSIX only) / UNVERIFIED (Windows ACL) | Linux/macOS unit, Windows |
| E7 | Medium | Directory named `notes.md` | Refused as a document | RS `paths::tests::a_directory_with_a_markdown_name_is_not_a_document` | PASS (unit) | Windows |
| E8 | Medium | File with no Markdown extension | Refused | RS `errors`/`paths` extension policy | PASS (unit) | Windows |
| E9 | Medium | Unicode and spaced file names | Accepted and opened; non-UTF-8 names not lost | RS `paths::tests::file_names_with_spaces_and_unicode_survive_validation`, `assets::tests::spaces_unicode_and_encoded_names_resolve` | PASS (unit) / UNVERIFIED (pkg) | Windows |
| E10 | High | Rapid switching between files | Newest document wins; stale reads discarded; watcher replaced | RS generation guard, FE `documentController.spec.tsx` (6 cases), `launchQueue.spec.ts` | PASS (unit) / UNVERIFIED (pkg) | Windows, jsdom / clean Windows, clean macOS |
| E11 | Medium | Symlinked document and symlinked parent | Canonicalised; escapes refused | RS `paths::tests::symlink_escape_is_rejected` (+ POSIX case), `document::tests::links_through_symlinks_keep_the_folder_and_format_policy` | PASS (unit) / UNVERIFIED (macOS TCC) | Windows, Linux unit / clean macOS |
| E12 | Medium | Document on a synced or network folder picked by the OS | Opens; refresh behaviour in synced folders | [MACOS-DOCUMENT-PIPELINE.md](MACOS-DOCUMENT-PIPELINE.md) W-rows | UNVERIFIED | clean Windows, clean macOS |

## F. Security and hostile input

| ID | Risk | Scenario | Expected | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Critical | `javascript:`, `data:`, `file:` and other schemes in links | Never become live destinations | FE `links.spec.ts::refuses every scheme that must never be executed or opened`, `documentView.spec.tsx` | PASS (unit) / UNVERIFIED (pkg) | jsdom / clean Windows, clean macOS |
| F2 | Critical | Path traversal in an image or link reference (`../../etc/passwd`) | Refused | RS `assets::tests::traversal_absolute_and_remote_references_are_refused`, `paths::tests::relative_paths_reject_traversal_and_remote_references` | PASS (unit) | Windows |
| F3 | Critical | Symlink in the document folder pointing outside it | Refused | RS `assets::tests::a_symlink_out_of_the_document_folder_is_refused`, `document::tests` | PASS (unit) | Windows (+ POSIX case) |
| F4 | High | Executable or non-image file referenced as an image | Never served as an image; SVG excluded | RS `assets::tests::svg_and_non_image_types_are_never_served_as_images`, `paths::tests::image_mime_only_covers_decodable_formats` | PASS (unit) | Windows |
| F5 | High | Oversized image | Refused before encoding | RS `assets::tests::an_oversized_image_is_refused_before_it_is_encoded` | PASS (unit) | Windows |
| F6 | Critical | Arbitrary filesystem or shell access from the webview | No such capability granted | `src-tauri/capabilities/default.json`; RS contract test | PASS (config) | all |
| F7 | High | macOS denied folder (Desktop/Documents/Downloads) | Clear outcome, no silent failure | TCC rows in [MACOS-DOCUMENT-PIPELINE.md](docs/MACOS-DOCUMENT-PIPELINE.md) §6 | UNVERIFIED | clean macOS |
| F8 | Critical | Does the app ever write to the document? | Never; read-only commands | RS commands are read-only; PKG check hashes before/after | PARTIAL (unit) / UNVERIFIED (pkg) | Windows / clean Windows, clean macOS |

## G. Performance and resources

| ID | Risk | Scenario | Target | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Medium | Cold start of the packaged binary | Under 1 s to first paint (PRD target) | measured on the release binary; see report | PARTIAL | Windows (this machine, not clean) |
| G2 | Medium | Memory with one ordinary document open | No runaway growth; steady working set | measured on the release binary; see report | PARTIAL | Windows (this machine, not clean) |
| G3 | Medium | Refresh after a completed save | Under 500 ms (PRD target) | not instrumented in the package | UNVERIFIED | clean Windows, clean macOS |
| G4 | Medium | Very long document | No UI freeze; search stays usable | none | UNVERIFIED | clean Windows, clean macOS |
| G5 | Low | 10 MiB boundary file | Refused quickly, no read of the whole file | RS size check before read | PASS (unit) | Windows |

## H. Packaging, distribution and signing

| ID | Risk | Scenario | Expected | Evidence | Status | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | High | Windows NSIS installer builds from the tag | `Inkfin_0.1.2_x64-setup.exe` produced | CI `build-windows` step + local build | PASS (build) | Windows runner, this machine |
| H2 | High | macOS universal DMG builds from the tag | One DMG, `arm64` + `x86_64` | CI `lipo` output `x86_64 arm64` | PASS (build) | macos-15-arm64 |
| H3 | High | Both installers reach the release page | Assets attached, URLs resolve | CI `publish` job; HTTP 200 on both URLs | PASS | GitHub |
| H4 | Critical | Windows installer signature | Signed by a trusted publisher | `Get-AuthenticodeSignature` on the downloaded installer | FAIL (unsigned by design) | signing certificate absent |
| H5 | Critical | macOS DMG signature and notarisation | Developer ID signed, notarised, stapled; Gatekeeper accepts | file name `-unsigned`; CI skipped `codesign`/`spctl`/`stapler` | FAIL (unsigned by design) | Apple credentials absent |
| H6 | High | Package installs on a clean machine | Installer completes, app launches | none | UNVERIFIED | clean Windows, clean macOS |
| H7 | High | Associations registered by the installer | `.md`/`.markdown` open the app | config contract test only | UNVERIFIED | clean Windows |
| H8 | Medium | Offline install and use | Works with no network | none | UNVERIFIED | clean Windows offline, clean macOS offline |
| H9 | Medium | Auto-update | Not implemented; manual reinstall | none needed | N/A | — |

## Known gaps in this matrix

- No automation for the real window: every `pkg` row needs a human or a UI driver on the
  target OS. Browser-based checks cannot stand in for WKWebView or WebView2.
- Clean-host rows (GATE-W1, GATE-W2, GATE-W6, H6, H7) cannot run on the audit host:
  Windows 11 **Home** has no Windows Sandbox, no Docker or VM tooling is installed, and
  the WSL2 distro carries no Rust or Node toolchain. The packaged binary was exercised
  outside the installer instead; the installer, the associations it writes and an offline
  first run remain `UNVERIFIED` until a disposable Windows image is available.
- No macOS host: every macOS runtime row is `UNVERIFIED`, and macOS wording elsewhere in
  the repository stays "unsigned test build".
- Two `FAIL` rows (H4, H5) are deliberate distribution facts, not regressions: both
  installers are unsigned, so SmartScreen and Gatekeeper warn. They stay `FAIL` until a
  certificate and Apple credentials exist.
