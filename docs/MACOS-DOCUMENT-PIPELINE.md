# macOS document-pipeline audit

**Status:** audited and tested on Windows 11. **No macOS host was used for this
pass.** Every macOS-specific row below is a procedure with an expected result,
not an observation — the run sheet in §6 exists so the first Mac run produces a
record instead of a re-audit. The editors and macOS version used for that run go
in the columns provided there; they are empty because the run has not happened.

Scope: reading, validating and watching local documents — not rendering or
chrome. The shell is covered by [MACOS-UI-ADAPTATION.md](MACOS-UI-ADAPTATION.md)
and the open flow by [MACOS-FINDER-CHECKS.md](MACOS-FINDER-CHECKS.md).

## 0. Environment actually used

| Component | Version |
| --- | --- |
| OS | Windows 11, 10.0.26300.9711 |
| rustc / cargo | 1.98.1 |
| Node.js | 24.14.1 |
| notify (watcher crate) | 8.2.0 — `ReadDirectoryChangesWatcher` here, `FsEventWatcher` on macOS (`notify-8.2.0/src/lib.rs:405-411`) |
| Vitest / jsdom | 5.0.1 / 29.1.1 |
| Rust tests | 59 passed, 0 failed |
| Frontend tests | 84 passed across 14 files |
| Rust lint/format | `cargo clippy --all-targets -- -D warnings` clean, `cargo fmt --check` clean |
| TypeScript/ESLint | `tsc --noEmit` and `eslint .` exit 0 |

Commands:

```bash
CARGO_TARGET_DIR="$TEMP/inkfin-target" cargo test --manifest-path src-tauri/Cargo.toml
CARGO_TARGET_DIR="$TEMP/inkfin-target" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm test && npm run typecheck && npm run lint
```

`src-tauri/target` in this checkout contains build artefacts from a different
project and its build script fails before compiling, so the Rust checks ran
against a fresh `CARGO_TARGET_DIR` outside the repository.

## 1. Pipeline map

| Stage | Code | Filesystem behaviour it must survive |
| --- | --- | --- |
| Path policy | `services/paths.rs` | extension, canonicalisation, symlinks, containment, non-UTF-8 names |
| Open/read | `commands/document.rs`, `paths::read_document` | UTF-8, BOM, 10 MiB limit, missing file, directory, permissions |
| Relative images | `commands/assets.rs`, `paths::load_asset` | traversal, symlink escape, MIME allow-list, 8 MiB limit, 128 assets |
| Markdown links | `commands/document.rs`, `resolve_linked_document` | folder containment, symlink escape, format policy |
| Watch | `services/watch.rs` | in-place saves, rename-over-original, duplicate events, replaced documents, deletion, recovery |
| Refresh in the renderer | `features/document/documentController.ts`, `DocumentView.tsx`, `useRenderedSearch.ts` | scroll anchor, search query, theme, zoom |

## 2. Findings and what changed

Every finding below was reproduced by a test that failed before the change.

### P1 — a symlink could lend `.md` to any file (security)

`validate_document_path` checked the extension on the path as typed, then
canonicalised. A symlink named `innocent.md` pointing at `payload.txt` passed the
policy, and the reader opened a format it claims to refuse. macOS makes this
easy to construct (`ln -s`), and Finder shows only the link's name.

Fixed in `services/paths.rs`: the extension policy is applied again to the
resolved path. The same rule already existed for links; it now covers the
document itself. Tests: `a_symlink_cannot_lend_a_markdown_extension_to_another_format`
(unix and Windows) and `links_through_symlinks_keep_the_folder_and_format_policy`.

### P2 — a non-UTF-8 file name was invisible to the watcher

`event_touches` decoded the event's file name with `to_str()`, which returns
`None` for non-UTF-8 names, so no event ever matched and such a document could
never refresh. macOS file names are arbitrary bytes.

Fixed: names are compared as `OsStr`, with an ASCII case-insensitive fallback for
NTFS and default APFS. `is_markdown` was changed the same way, so a `.md` suffix
is recognised on a non-UTF-8 name instead of being reported as "no extension".
Tests: `a_non_utf8_name_with_a_markdown_suffix_is_still_markdown`,
`a_non_utf8_document_name_still_matches_its_events` (both `#[cfg(unix)]`).

### P3 — a deleted file that came back unchanged kept its "missing" warning

The watcher only emitted `document_changed`, and only when the content hash
differed. Restoring the same bytes produced no event at all, so the renderer's
"no longer on disk" notice stayed on screen forever while the document was
plainly there.

Fixed: the watch loop now remembers that it reported the file unavailable and
emits `document_recovered` when a read succeeds with the revision already on
screen. The controller withdraws only notices it marked `source: 'watch'`, so an
unrelated notice is never cleared by it.
Tests: `a_document_that_returns_unchanged_clears_the_warning` (real filesystem),
`withdraws the missing warning when the file comes back unchanged`,
`leaves an unrelated notice alone when the watch recovers`.

### P4 — losing the watch was silent

If the parent folder could not be watched, `install` cleared the watcher and said
nothing. The document stayed readable but quietly stopped refreshing, which is
indistinguishable from "the save did not land". This is the realistic macOS
failure mode for a file chosen inside a protected folder (Desktop, Documents,
Downloads, iCloud Drive): TCC grants the chosen file, not necessarily its folder.

Fixed: `document_watch_failed` is emitted once, and the renderer shows
"Live refresh is off for this document." with a pointer to Reload.
Caveat, stated plainly: this covers only a `spawn` failure. An FSEvents stream
that registers but delivers nothing (a possible TCC outcome) cannot be detected
this way — that is why §6 W9 must be run on a Mac.

### P5 — asset and link policy had no direct tests

Relative images and Markdown links were only covered through the frontend and
through `safe_relative_path`; the commands themselves were untested, including
the symlink-resolution step that makes the security rule true.

Fixed: the policy was extracted into `paths::load_asset` and
`resolve_linked_document`, which take a canonical root and no application handle,
and are now tested directly for spaces, Unicode, percent-encoding, traversal,
absolute and remote references, SVG/executable refusal, size limits, directories
and symlink escape.

## 3. Automated coverage added

| Area | Test | Result |
| --- | --- | --- |
| UTF-8 reads | BOM stripped, BOM-only file, CRLF and astral characters preserved byte for byte, invalid UTF-8 refused | pass |
| Size limits | 10 MiB accepted, 10 MiB + 1 refused before reading; 8 MiB image accepted, +1 refused before base64 | pass |
| Relative images | in-folder load, nested folders, upper-case extension, percent-encoded and literal spaces, Unicode name | pass |
| Image refusals | `..`, encoded `..`, absolute, `https:`, `file:`, `//host`, SVG, `.exe`, `.txt`, missing file, folder named `*.png`, symlink out | pass |
| Markdown links | spaces, Unicode, percent-encoding, nested folders, `.markdown` | pass |
| Link refusals | `..`, absolute, `https:`, `javascript:`, `file:`, `.txt`, missing, symlink out, symlink to `.txt` | pass |
| Names | spaces, em dash, accents; non-UTF-8 `.md`; a folder named `*.md` | pass |
| Permissions | unix `chmod 000` maps to `denied`, and is not retried (skipped automatically when run as root) | **not run here**: `#[cfg(unix)]`, so it compiles and runs for the first time on the Mac |
| Event payloads | `document_changed`, `document_missing`/`unavailable`, `document_recovered`, `document_watch_failed` serialise the fields the bridge parser requires | pass |
| Ordinary save | in-place write produces exactly one `document_changed` | pass |
| Atomic save | write to a sibling `.swp`, rename over the document, one refresh | pass |
| Duplicate events | six writes 25 ms apart produce one refresh of the final content | pass |
| Unrelated files | writing `other.md` in the same folder never refreshes | pass |
| Replaced document | events for generation 1 are dropped once generation 2 is current | pass |
| Deletion | `document_missing`/`not_found`, no re-render, last revision retained | pass |
| Replaced by a folder | `not_a_file` reported immediately, preview retained | pass |
| Half-written file | invalid UTF-8 retried four times, then `invalid_utf8`, preview retained | pass |
| Recovery | same content → `document_recovered`; new content → `document_changed` | pass |
| Refresh continuity | search query, match count, theme and zoom survive a refresh; new content shown | pass |

The watcher scenarios run the real platform watcher against real files in a
temporary folder, not a simulated event queue: `spawn_with` takes a
`WatchHost`, the application implements it with `AppHandle`, and the tests
implement it with a recorder. The production loop is the one under test.

## 4. Security rule re-checked

| Vector | Expected | Evidence |
| --- | --- | --- |
| Link to a local file (`file:`) | refused before the OS is called | `only_http_and_https_links_can_reach_the_operating_system` |
| Executable / custom scheme (`ms-settings:`, `javascript:`) | refused | same |
| Link to another format, including via symlink | refused as `unsupported_extension` | link tests |
| Image outside the folder, directly or via symlink | `blocked_asset` | asset tests |
| SVG image (scriptable) | `blocked_asset` | asset tests |
| Document that is really another format via symlink | refused before reading | P1 tests |
| Raw HTML in Markdown | rendered as text | pre-existing `documentView.spec.tsx` |
| Opening the wrong scheme from the renderer | `openExternalLink` rejects | pre-existing `links.spec.ts` |

## 5. Refresh continuity

- **Scroll:** `planScroll` restores the block anchor for the same file at a new
  revision and returns to the top only for a different file; `restoreScrollAnchor`
  falls back to the scroll ratio when the block disappeared (`scrollAnchor.spec.ts`).
  jsdom has no layout, so the pixel result is not asserted in the app-level test.
- **Search:** query, match count and active position are re-derived from the new
  DOM without scrolling; the app-level test types `beta`, refreshes, and checks
  the field still contains `beta` and `1 of 1` is still shown.
- **Theme and zoom:** stored preferences are independent of the document
  revision; the app-level test asserts `data-theme="dark"` and `--k-zoom: 1.25`
  before and after a refresh.

## 6. macOS run sheet

Build first (`npm run tauri build`); record the exact macOS version, and the
editor name and version for every row, in the last three columns. Expected
results are the contract; a blank row is an unrun check, never a pass.

Fixtures: a folder with a space and an accent (`~/Documents/Notes éclair/`), a
document with accents and an emoji in its name, an image with a space in its
name, and the same folder copied to iCloud Drive and to Dropbox or OneDrive.

| # | Check | Expected | macOS | Editor + version | Result |
| --- | --- | --- | --- | --- | --- |
| W1 | Finder **Duplicate**/replace save from **TextEdit** | one refresh, reading position kept | | | |
| W2 | Save from **VS Code** (default `files.atomicSave`) | one refresh; no "file missing" flash | | | |
| W3 | Save from **vim**/`nvim` (`:w`, backup+rename) | one refresh, no flash, position kept | | | |
| W4 | Save from **Obsidian** or another in-place writer | one refresh | | | |
| W5 | Hold ⌘S repeatedly for ~2 s | one refresh after the burst, not one per save | | | |
| W6 | Delete the open file in Finder | preview stays, notice says it is no longer on disk | | | |
| W7 | Restore the same bytes (⌘Z in Finder, or copy back) | notice disappears, no re-render jump | | | |
| W8 | Replace the file with a folder of the same name | "could not be read" notice, preview stays | | | |
| W9 | Open from `~/Documents`, `~/Desktop` and `~/Downloads`, denying then allowing the TCC prompt; save after allowing | allowed: refreshes; denied: document opens and either refreshes or says "Live refresh is off" — never a silent stale preview | | | |
| W10 | Open a document in iCloud Drive that is not downloaded yet (cloud icon in Finder) | size check passes, read waits for materialisation or reports a clear failure; no hang past ~5 s | | | |
| W11 | Save the same iCloud document from another Mac or iPhone | refresh arrives within ~2 s of the sync completing | | | |
| W12 | Open from an exFAT USB stick, eject it while open | "no longer on disk" notice, preview stays; no crash; no spin | | | |
| W13 | Mount an SMB share, open a document, save from the Mac | one refresh; reconnect behaviour is recorded | | | |
| W14 | APFS case-sensitive volume: open `Notes.md` with `notes.md` also present | only the exact file opens; the sibling is not picked up by the watcher | | | |
| W15 | Image reference typed as NFC while the file on disk is NFD (`Café.png` vs `Cafe\u0301.png`) | image loads (APFS/HFS+ are normalization-insensitive) | | | |
| W16 | Document and image in a folder whose name contains `/`-free Unicode and a space | both open; status bar shows the canonical path | | | |
| W17 | `chmod 000 notes.md` in Terminal, then open it | "Access denied: the system refused read access." | | | |
| W18 | Open `notes.md` → symlink to `payload.txt` | refused as a non-Markdown file | | | |

W1–W8 are the behaviours the Windows tests already pin; the Mac run is what
proves the `FsEventWatcher` backend (FSEvents, coalesced per run loop) behaves
like `ReadDirectoryChangesWatcher`. W9–W13 have no Windows equivalent and are the
reason this sheet exists.

## 7. Limitations

- No macOS machine was available, so no row in §6 has a result. `cargo check
  --target aarch64-apple-darwin` also remains blocked in `fsevent-sys`, which
  needs a C toolchain for the darwin target.
- FSEvents coalesces events per run loop and is inherently recursive. The loop
  filters by file name and generation, so extra descendant events cost a read
  but cannot refresh the wrong document; the latency budget (~200 ms debounce)
  is unmeasured on macOS.
- An FSEvents stream that registers but stays silent (possible under TCC) cannot
  be detected by the process, so W9 is the only way to know.
- Hard links inside the document folder still resolve inside it. They require
  write access to create, so an attacker who can place one can already read the
  file; the containment rule is not weakened for a realistic local threat.
- Network and removable volumes were not exercised; W12 and W13 cover them.
- The permission-failure test is unix-only and therefore did not run on this Windows host; it is exercised by the first `cargo test` on a Mac, before any of W1–W18.
- `document.css` and two renderer files still fail Prettier for pre-existing
  reasons (BUG-003). New and edited lines are formatted.

## 8. Recording the first Mac run

```text
macOS version:            (Apple menu → About This Mac)
Chip:                     Apple silicon / Intel
Inkfin build:             .app date and commit
Editors used:             TextEdit <version>, VS Code <version>, vim <version>, ...
Rows run:                 W1-W18, with the Result column filled
Failing rows:             quote the notice text and the Console.app line if any
```

Copy the filled table back into this file. Until then, the document pipeline is
verified on Windows only.
