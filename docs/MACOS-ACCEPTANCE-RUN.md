# macOS acceptance run (must execute on a Mac)

**Status: NOT RUN.** No macOS host, no macOS artifact and no signing credentials exist in this
workspace. This machine is Windows, so every row below is a procedure with an expected result, not
a result. Until a runner fills in §4, no macOS behaviour in this repository is verified and nothing
may be described as a tested macOS application.

This is the consolidated run sheet. Deeper variants live in:

- [MACOS-FINDER-CHECKS.md](MACOS-FINDER-CHECKS.md) — every Finder/Apple Event entry point (F1–F14)
- [MACOS-DOCUMENT-PIPELINE.md](MACOS-DOCUMENT-PIPELINE.md) §6 — editors, TCC folders, iCloud, exFAT, SMB (W1–W18)
- [MACOS-UI-ADAPTATION.md](MACOS-UI-ADAPTATION.md) §6 — WKWebView-specific UI checks (M1–M12)
- [MACOS-PACKAGING.md](MACOS-PACKAGING.md) §7 — distribution gate (M1–M6)

A row marked `PASS` here is evidence only for the exact artifact and macOS version recorded in §3.

## 1. What to test

| Item | Where |
| --- | --- |
| Install the `.dmg`, launch, second launch | A1–A4 |
| Open via picker, Finder, Open With, drag and drop, dock, `open -a`, keyboard shortcuts | B1–B8 |
| Associations for `.md` and `.markdown` | B2, B3, P1–P5 in the Finder sheet |
| Relative images, external links, blocked schemes | C2, C3 |
| GitHub Flavoured Markdown, syntax highlighting, code copy | C4–C6 |
| Light, dark, system themes (including live OS change) | D1–D4 |
| Search and match navigation | E1–E4 |
| Zoom boundaries, shortcuts, persistence, layout | F1–F4 |
| Ordinary and atomic saves | G1–G3 |
| Deletion and recreation | H1–H2 |
| Invalid files and refused paths | I1–I5 |
| Offline use | J1 |
| Apple silicon and Intel execution | K1–K3 |

## 2. Produce an artifact

There is no macOS artifact in this repository, and the macOS workflow has never run. Build one on a
Mac, or run [.github/workflows/macos-release.yml](../.github/workflows/macos-release.yml) by
`workflow_dispatch`.

```bash
# On the Mac, from the repository root:
node --version          # 20 or newer
rustc --version         # 1.82 or newer
npm ci
npx tauri build --target universal-apple-darwin --no-sign
```

- `--no-sign` is deliberate for a test bundle: without a Developer ID certificate, signing fails
  rather than producing an installable app. The resulting artifact is **not** a release and must be
  labelled `unsigned` in every result.
- Default output: `src-tauri/target/universal-apple-darwin/release/bundle/macos/Inkfin.app` and
  `.../bundle/dmg/Inkfin_<version>_universal.dmg`.
- A CI build with no secrets produces the same unsigned bundle and labels it `unsigned` on the
  artifact and in the job summary.

Install and re-register so Finder uses this copy, not a previously registered one:

```bash
cp -R src-tauri/target/universal-apple-darwin/release/bundle/macos/Inkfin.app /Applications/
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f /Applications/Inkfin.app
```

`tauri dev` is not a substitute for A1–B8: it has no `Info.plist`, so it cannot be targeted by
double-click, Open With or Apple Events.

## 3. Environment record (fill before testing)

Run `tools/macos/acceptance-env.sh <artifact path>` and paste its output here, or fill the table by
hand. Record one table per machine/artifact combination.

| Field | Value |
| --- | --- |
| Date and tester | |
| macOS version (`sw_vers -productVersion`) | |
| Build (`sw_vers -buildVersion`) | |
| Architecture (`uname -m`) | |
| Hardware (`sysctl -n hw.model`) | |
| Artifact filename | |
| Artifact `sha256` | |
| Distribution label (`unsigned` / `signed-unnotarized` / `release`) | |
| `lipo -archs` of `Inkfin.app/Contents/MacOS/Inkfin` | |
| Gatekeeper status (`spctl -a -vvv` output) | |
| Quarantine attribute present? (`xattr -p com.apple.quarantine`) | |

To exercise the Intel slice on its intended hardware, either run the universal bundle on an Intel
Mac, or force Rosetta on Apple silicon:

```bash
arch -x86_64 /Applications/Inkfin.app/Contents/MacOS/Inkfin
```

A Rosetta run is **not** equivalent to an Intel Mac run for Gatekeeper, launch registration or
hardware-specific rendering; record it as `PASS (Rosetta)` and leave K3 open if no Intel Mac is
available.

## 4. Execution matrix

Result values: `PASS`, `FAIL`, `BLOCKED` (cannot be executed, with reason), `NOT RUN`.
Every `FAIL` needs a defect id from §6. Every `PASS` in C–F needs a screenshot (§5).

### A. Install and launch

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| A1 | Open the `.dmg`, drag `Inkfin` to `/Applications`, launch it | App opens to the empty state; no crash, no missing-dylib dialog; Dock shows one icon | | |
| A2 | First launch of the unsigned bundle | Gatekeeper refuses the default open; right-click → **Open** → **Open** launches it. Record the exact dialog text | | |
| A3 | With the app running, launch it again from Finder/Spotlight | No second window or Dock icon; the existing window comes forward with its current document | | |
| A4 | ⌘Q from the app menu, then relaunch | Process exits cleanly; relaunch shows the empty state (no session restore is claimed) | | |

### B. Opening documents

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| B1 | ⌘O, choose a `.md` file | Picker opens filtered to Markdown; file renders; title is `<name> - Inkfin`; status bar shows the canonical path | | |
| B2 | Quit, then double-click `notes.md` in Finder | App launches and renders the file — this is the only proof the Apple Event path works | | |
| B3 | Repeat B2 with a `.markdown` file | Same result; both extensions are registered | | |
| B4 | With `a.md` on screen, right-click `b.md` → **Open With** → Inkfin | Same window replaces the document; no second window | | |
| B5 | Drag `notes.md` from Finder onto the window | Drop overlay appears, then the document opens | | |
| B6 | Drag `notes.md` onto the Dock icon | Same as B5 | | |
| B7 | `open -a /Applications/Inkfin.app /path/to/notes.md` twice with different files | Document is replaced; exactly one `Inkfin` process in Activity Monitor | | |
| B8 | With a document open: ⌘O, ⌘F, ⌘R, ⌘+, ⌘−, ⌘0, Escape; then press Ctrl+O | Each Command shortcut does its job (open, find, re-read from disk, zoom in/out/reset, dismiss); ⌘R keeps search and zoom; Ctrl+O does nothing, because Control is not the macOS modifier | | |

Association detail (record once per machine): `plutil -p /Applications/Inkfin.app/Contents/Info.plist`
must show `CFBundleDocumentTypes` with extensions `["md","markdown"]`, role `Viewer`, UTI
`net.daringfireball.markdown`, rank `Default`. Right-click → **Open With** must list Inkfin without
using **Other…**. See [MACOS-FINDER-CHECKS.md](MACOS-FINDER-CHECKS.md) P1–P5.

### C. Rendering, images, links

Use the committed fixture [acceptance/fixture.md](acceptance/fixture.md) and its companion
[acceptance/linked-note.md](acceptance/linked-note.md). It contains every supported construct, a
relative and a missing image, a blocked remote image, a long code line, raw HTML that must stay
inert, a Unicode heading and the two local links used by C3.

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| C1 | Open `acceptance/fixture.md` | Headings, lists, task boxes, tables, blockquotes, strikethrough, footnotes, inline and fenced code render; the `<script>` block is inert and `window.__inkfinXss` stays undefined | | |
| C2 | Fixture with `images/diagram.png` beside it, plus a network image | Relative image renders from the document folder; remote image shows the blocked placeholder | | |
| C3 | In the fixture, click an `https://` link, the `linked-note.md` link, the `diagram.png` link, then (in a scratch copy) a `javascript:` link | HTTPS opens in the default browser; `linked-note.md` replaces the document; the image link is refused; `javascript:` is inert with an explanation and executes nothing | | |
| C4 | Code block in `ts`, one in an unknown language, one very long line | Known language highlights; unknown is plain text; long code scrolls inside its own block without widening the page | | |
| C5 | Themes light and dark, same document | Code tokens remain legible in both; no washed-out token colours | | |
| C6 | Click **Copy** on a fenced block, paste into TextEdit | Pasting yields exact code: no line numbers, no markup, no added trailing whitespace | | |

### D. Themes

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| D1 | Choose **Light**, then **Dark** | Whole surface changes; text, borders and focus rings stay legible | | |
| D2 | Choose **System**, then flip macOS appearance (Apple menu → System Settings → Appearance) | App follows without restart | | |
| D3 | Quit, relaunch | Last choice persists | | |
| D4 | Open the theme popover with the keyboard | Focus starts on the current choice; Arrow/Home/End move; Space/Enter select; Escape returns focus to the trigger | | |

### E. Search

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| E1 | ⌘F, type a word that appears several times (mixed case) | Search takes focus, matches are highlighted, count shows `n / m`, case-insensitive | | |
| E2 | Enter and Shift+Enter | Active match advances / retreats and scrolls into view; position readout matches the highlighted match | | |
| E3 | Escape, then test `⌘F` again and close the bar | Escape dismisses search; reopening works; closing clears highlights | | |
| E4 | With an active query, save the file externally | Query survives the refresh and match indices still point at the new content | | |

### F. Zoom

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| F1 | Press ⌘− until the floor, then again | Stops at 75 %; the control reports the limit and does not go lower | | |
| F2 | Press ⌘+ until the ceiling, then again | Stops at 200 %; no further step | | |
| F3 | ⌘0 | Returns to 100 % | | |
| F4 | At 200 %, resize the window to its 480 × 360 minimum | Document text scales; the column and the page do not acquire page-wide horizontal scroll; long code still scrolls inside its block | | |
| F5 | Quit and relaunch | Zoom persists at the last value | | |

### G. Saves

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| G1 | With the document open, edit and save in an external editor | Preview updates within about 500 ms; reading position is approximately preserved | | |
| G2 | Save with an editor that writes a temp file and renames (e.g. VS Code, vim with `backupcopy=no`, or `printf … > tmp && mv tmp notes.md`) | Preview updates; no "missing" warning flicker that stays | | |
| G3 | Rapidly save several times | UI settles on the final content; no stale render, no error toast | | |
| G4 | Save content identical to what is displayed | No visible rerender or scroll reset | | |

### H. Deletion and recreation

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| H1 | Move the open file to the Trash, or `rm` it | Last good preview stays; a warning explains the file is gone; the app does not go blank | | |
| H2 | Restore the file with identical bytes | Warning is withdrawn and refresh resumes without reopening | | |

### I. Invalid and refused inputs

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| I1 | Open a `.txt`, `.png`, or a directory | Refused with a recoverable notice; the previous document stays on screen | | |
| I2 | Open a file with invalid UTF-8 bytes | Recoverable error, not a crash or a blank window | | |
| I3 | Open a file over 10 MiB | Refused before loading with the size message | | |
| I4 | Open a symlink named `notes.md` pointing at `payload.txt` | Refused as non-Markdown (extension is re-checked after resolution) | | |
| I5 | Open a file in a TCC-protected folder (Desktop/Documents/Downloads under a fresh privacy prompt), allowing and then denying | With permission: renders and auto-refreshes. Denied: actionable error, not a silent failure | | |

### J. Offline

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| J1 | Disable Wi-Fi/Ethernet, relaunch, open a document with local images and code, search and zoom | Everything works; no network requests are attempted for content; remote images stay blocked | | |

### K. Architectures

| # | Steps | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| K1 | `lipo -archs Inkfin.app/Contents/MacOS/Inkfin` | Lists both `arm64` and `x86_64` | | |
| K2 | Run the bundle on an Apple silicon Mac | Native arm64 execution; no Rosetta prompt | | |
| K3 | Run on an Intel Mac (or `arch -x86_64` under Rosetta) | Launches and passes B1–B8; record which of the two was used | | |

## 5. Evidence and screenshots

Store evidence beside the run, not in chat:

```
docs/acceptance/<YYYY-MM-DD>-<macos-version>-<arch>/
  environment.md          # §3 table filled in
  results.md              # §4 filled in
  defects.md              # §6, or "none"
  A1-empty-state.png
  B2-finder-double-click.png
  ...
```

- Capture with ⌘⇧4 (window) or `screencapture -x <file>.png` (whole screen).
- Name files `<row-id>-<slug>.png` so a claim can be traced to its picture.
- Capture the window, not just the document, when the claim involves native chrome, the title or
  the Dock.
- Keep full-resolution PNGs; do not annotate or crop away the menu bar on rows that depend on
  shortcuts.
- Record the artifact checksum in `environment.md`; a screenshot without a recorded artifact cannot
  support a claim about that artifact.

## 6. Defects

| ID | Row | Severity | Steps to reproduce | Expected vs actual | Artifact/macOS | Status | Fix commit | Re-run rows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |

Rules for the run:

1. Reproduce twice before filing. A one-off focus or animation glitch is recorded as an observation,
   not a defect.
2. Fix only reproducible defects in the same change, then re-run the affected rows **and** every row
   sharing the same code path (e.g. a fix in the watcher means G1–H2). Do not re-run passing rows
   whose code did not change.
3. A defect that cannot be fixed on the available hardware is reported as `FAIL` or `BLOCKED`, never
   downgraded to `PASS` by narrowing the assertion.
4. Any row not executed stays `NOT RUN`. A blank row is not a pass.

## 7. What stays unverified until this run happens

- macOS runtime support at all: the `#[cfg(target_os = "macos")]` launch and window arms have never
  been compiled on macOS, and `cargo check --target aarch64-apple-darwin` fails here in
  `fsevent-sys` for want of a darwin C compiler.
- `Info.plist` contents, Launch Services registration, Finder/Apple Event delivery, Dock reopen.
- WKWebView rendering, CSS Custom Highlight support, Shiki chunk loading, Blob image creation.
- FSEvents save behaviour, TCC folders, iCloud materialisation, exFAT/USB and SMB (W1–W18).
- Signing, notarisation, stapling and the Gatekeeper assessment (M1–M6).
- Performance targets (start under 1 s, save response under 500 ms) on macOS.

## 8. Sign-off

| Field | Value |
| --- | --- |
| Rows passed / failed / blocked / not run | |
| Defects opened / fixed | |
| Windows artifact re-checked after fixes | |
| Signing status of the tested artifact | |
| Public-release gate | **OPEN** until a signed, notarised, stapled build passes A1–K3 |
