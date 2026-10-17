# Inkfin test report — 0.1.2

Date: 17 October 2026. App version 0.1.2, commits `8aabb7c`–`1df6aa2` on `main`.

Row IDs below are from [TEST-MATRIX.md](TEST-MATRIX.md). Every row states its
environment, its result and where the evidence lives.

## 1. Verdict

**Still not release-ready, for reasons that are not code defects.** The packaging
itself now has real evidence on both platforms: the Windows package passes
install, associations, uninstall, keyboard, accessibility tree, narrow window and
an offline-simulated session on this host, and the universal macOS DMG installed
and ran on three real Macs. What blocks release is distribution and the rows only
a person can check:

- Both installers are **unsigned**. SmartScreen warns on Windows, and Gatekeeper
  refused the macOS bundle on all three Macs, exactly as an unsigned build should
  (GATE-S1, GATE-S2, rows H4, H5). No certificate and no Apple credentials exist
  in this repository.
- The Windows gates are `PARTIAL` (GATE-W1–W6, H6, H7): verified end to end on
  this Windows 11 host, but that host is not a clean machine, so a disposable
  image remains outstanding.
- macOS row coverage is `PARTIAL` (GATE-M3): a runner is a real Mac but headless.
  Finder double-click, drag and drop, TCC folders, screen-reader output and the
  480 × 360 pointer rows still need a person at a Mac.

Two real defects were found by driving the packaged product and fixed during this
audit; both fixes are verified, the second in a fresh package (§7).

## 2. Environment

Clean-environment options were checked on this host before the manager-level
install was attempted:

| Option | Availability | Consequence |
| --- | --- | --- |
| Windows Sandbox | **Unavailable** — Windows 11 **Home** Single Language; the feature needs Pro or Enterprise | cannot install the package in a disposable Windows |
| Hyper-V / VirtualMachinePlatform | state requires elevation; Sandbox is not installable on Home regardless | no local VM for a clean Windows image |
| Docker | not installed | no Windows container to install into |
| WSL2 (Ubuntu 22.04) | installed, but **no `cargo`, `rustc` or `node`** inside it | POSIX-only Rust tests cannot run there without provisioning a toolchain |
| A real Mac in this room | not available | macOS rows run on GitHub macOS runners instead (`CI-MAC`) |

The install/uninstall audit therefore ran on **this development host**, with the
owner's consent, and this report labels every result accordingly. The audit
snapshots the two registry extension keys before it installs and puts them back
exactly afterwards (`tools/windows/assoc-state.ps1`), so the host is left as it
was found — confirmed after every run.

| Item | Value |
| --- | --- |
| Windows host | Microsoft Windows 11 Home Single Language, build 10.0.26300 |
| CPU | 13th Gen Intel Core i7-13620H, 10 cores / 16 threads |
| Memory | 15.7 GB |
| WebView2 runtime | 155.0.4283.60 |
| Node | v24.14.1 |
| Rust | cargo 1.98.1 (2026-08-05) |
| TypeScript | 6.0.3 |
| macOS runners | `macos-14` (Apple silicon) and `macos-15-intel` (Intel) via `CI-MAC` |
| Clean Windows host | **not available** |

Artifacts preserved under `artifacts/` (git-ignored):

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `windows/Inkfin_0.1.2_x64-setup-released.exe` (downloaded from the release) | 3,700,009 | `f35016d98448332ba2cb75fcde32c36522cb1ddf29c2607ba651dcd14bc4faa7` |
| `windows/Inkfin_0.1.2_x64-setup-local-fixed.exe` (image fix, before the association fix) | 3,678,286 | `c022315749a7b9bb9a1e75434b9bbb330c951de879384bda32697ebe072e701a` |
| `windows/Inkfin_0.1.2_x64-setup-assoc-fix.exe` (both fixes; installed in §4) | 3,677,416 | `d1d9fc88e58cbcc3679878b49c92f30cafdfcb65db8623c3c38fffac5dbed424` |
| `windows/inkfin-0.1.2-x64-release-assoc-fix.exe` (packaged binary, both fixes) | 4,084,224 | `7aaaf471a7aeef50ffa1e7460abae97a32488f807b8aa2316bb669b91aa466a2` |
| `windows/installed-audit.json`, `windows/installed-audit.log` | — | the §4 evidence |
| `windows/reinstall-cycle-before-fix.json`, `windows/reinstall-cycle-after-fix.json` | — | the §7 association evidence |
| `macos/acceptance-{macos-14,macos-26,macos-15-intel}.json` | — | the §5 evidence from `CI-MAC` |

The local installer and the CI installer differ in bytes: each build regenerates
hashed frontend asset names, and the NSIS header carries a build timestamp. All
report version 0.1.2.

## 3. Automated suites

All run in this repository on the Windows host above.

| Check | Command | Result | Evidence |
| --- | --- | --- | --- |
| Types | `npx tsc --noEmit` | clean, exit 0 | this report |
| Lint | `npx eslint .` | clean, exit 0 | this report |
| Frontend tests | `npx vitest run` | **16 files, 95 tests passed**, 0 failed | `tests/` |
| Rust tests | `cargo test` (in `src-tauri/`) | **59 passed**, 0 failed | `src-tauri/src` |
| Rust lints | `cargo clippy --all-targets -- -D warnings` | clean, exit 0 | this report |
| Rust format | `cargo fmt --check` | clean, exit 0 | this report |
| Windows package | `npx tauri build` | exit 0; release profile compiled in 3 m 55 s; NSIS bundle produced with the new hooks | `artifacts/windows/nsis-hooks-build.log` |
| Format | `npx prettier --check .` | **26 files unformatted, all pre-existing** (nothing changed by this audit); the script is not wired into CI | this report |

`npx prettier --check .` was already failing on 26 committed files (`src/`,
`tests/`, `website/`) before this audit and is not a CI gate; no file changed here
is among them.

## 4. Installed Windows package

`tools/windows/installed-audit.mjs` installs the NSIS package silently, drives the
**installed** executable over the DevTools protocol, reads what the installer wrote
to the registry, and uninstalls again in a `finally` block. The run below used
`windows/Inkfin_0.1.2_x64-setup-assoc-fix.exe`
(`d1d9fc88…`, 3,677,416 bytes): **exit 0, no failures**.

Every figure is from the installed app, and the whole session ran with
`--host-resolver-rules=MAP * 0.0.0.0`, so nothing in it could reach the network —
the render and interaction rows below are therefore also offline evidence (C12).

| Matrix | What was measured | Result |
| --- | --- | --- |
| H6, GATE-W1 | Silent install, then the executable in `%LOCALAPPDATA%\Inkfin` | `inkfin.exe` found; document rendered |
| H7, A4 | Registry after install | `.md` and `.markdown` both → ProgID `Markdown Document`, `shell\open\command` = `…\Inkfin\inkfin.exe "%1"` |
| A4, A5, GATE-W2 | `cmd /c start` on a `.md` and a `.markdown` file | both reached the running instance (`.md` 146 ms, `.markdown` 115 ms), `openedBy: inkfin`, process count 1 → 1 |
| C12, B6 | Resources loaded during the session | none outside `tauri.localhost`/`ipc.localhost`; 0 off-scheme requests |
| C1, C2 | Ctrl+F, typed `alpha`, then Escape | search box opened, `1 of 2` matched, Escape closed it |
| C8 | 11 Tab presses in the installed app | every stop has a visible focus ring, reaching links, copy buttons, code scroll regions and the toolbar |
| C9 | Accessibility tree of the installed webview | 411 nodes; textbox named `Find in document`; named buttons `Open`, `Reload from disk`, `Find in document`, `Zoom out`, `Document zoom 100%. Reset to 100%`, `Zoom in`, `Theme: Dark`, copy buttons; document heading exposed |
| C10, GATE-W3 | Window resized to 480 × 360 | client 464 × 321; `scrollWidth` == `clientWidth` (no page overflow); toolbar visible |
| D2, GATE-W4 | Rename a staged file over the open document | new content visible in **237 ms**; the document folder held no leftover file |
| E5, E6, D7, GATE-W5 | `icacls /deny` on a file, then open it | notice `Access denied: the system refused read access.`; the document already on screen stayed there |
| H10 | After uninstall | `.md` restored to `Markdown` (its value before the install), `.markdown` back to none, no `Markdown Document_backup` residue, no installed files, no uninstall entry, no `Inkfin` ProgID — **host byte-identical to its pre-install state** |

## 5. macOS

The macOS rows ran on three real Macs through
[.github/workflows/macos-acceptance.yml](../.github/workflows/macos-acceptance.yml)
(run [39048972496](https://github.com/PriyansuMaurya/Inkfin/actions/runs/39048972496)),
driving `tools/macos/acceptance.sh` against the universal DMG built from commit
`25b4685` (`c96ce9ea…`, 7,789,949 bytes — the same image on all three, unsigned).

| Host | macOS | Architecture | Hardware |
| --- | --- | --- | --- |
| `macos-14` | 14.8.9 (23J631) | arm64 | Apple M1 (Virtual), `VirtualMac2,1` |
| `macos-26` | 26.6.2 (25G83) | arm64 | Apple M1 (Virtual), `VirtualMac2,1` |
| `macos-15-intel` | 15.7.9 (24G830) | x86_64 | Intel Core i7-8700B, `Macmini6,2` |

| Matrix | Check | Result on all three Macs |
| --- | --- | --- |
| H6, GATE-M1 | `hdiutil attach` of the DMG, then `Inkfin.app` inside it | mounted; app bundle present |
| H2, K2 | `lipo -archs` of the installed executable | `x86_64 arm64` — one genuine universal binary |
| H7 | `CFBundleDocumentTypes` in the installed `Info.plist` | declares both `md` and `markdown` |
| H6 | `cp -R` to `/Applications` | copied, 9.4 MB installed |
| GATE-M1, K1–K3 | `open -a` and a liveness check six seconds later | **the app is running** on Apple silicon and on Intel |
| A5 | `open -a Inkfin fixture.md` while the app was running | process count 1 → 1 — the running instance took the document |
| A4, B4–B6 | window title after the document was opened | `fixture.md - Inkfin` on every Mac: the fixture was read and applied |
| H6 | `~/Library/Logs/DiagnosticReports` | no crash reports |
| H6 | `osascript` quit | the app quit and left no process |
| H5 | `codesign -dv` / `spctl -a -t execute` | arm64 slices carry only an ad-hoc linker signature, the Intel slice none, and Gatekeeper **rejects** the bundle (`source=no usable signature`) — the expected unsigned state |

What this does **not** cover: a runner is headless, so nothing was seen on screen;
WKWebView's DOM cannot be inspected the way the Windows webview can, so macOS
rendering is inferred from the document being applied (the window title only
changes after that) rather than observed; LaunchServices dispatch was app-directed
(`open -a`) rather than a Finder double-click as the default handler; and drag and
drop, TCC-protected folders, the pointer rows and spoken screen-reader output were
not exercised at all. Those stay in [MACOS-ACCEPTANCE-RUN.md](MACOS-ACCEPTANCE-RUN.md).

The first attempt (run 39047992157) reported "the app exited during its first
launch" on both architectures. That was this script's fault, not the app's: the
liveness check matched the process name exactly, and the macOS process does not
carry the capitalised bundle name. The re-run above uses a case-insensitive match;
the diagnostic capture added while investigating is still in the script, so a real
launch failure will produce its output, bundle listing, signature state, extended
attributes and unified log rather than a bare failure.

## 6. Packaged Windows binary probes

`tools/windows/smoke-test.ps1` and `tools/windows/render-probe.mjs` drive the
release binary outside the installer
(`7aaaf471…`, 4,084,224 bytes) → `artifacts/windows/smoke-result-assoc-fix.json`,
`artifacts/windows/render-probe-assoc-fix.json`.

| Matrix | What was measured | Result |
| --- | --- | --- |
| G1 | Process start to the window showing `fixture.md - Inkfin` | 1129 ms on this warm host (an earlier build measured 772 ms); a range, not a guarantee |
| G2 | Working set / private bytes with the document open | 28,278,784 B (26.96 MiB) / 5,734,400 B |
| A5 | Second launch with `linked-note.md` while running | title became `linked-note.md - Inkfin`; process count 1; fixtures unchanged |
| B1, B2, B3 | Heading, list items, table, footnote, blockquote | heading present; 11 `li`; 12 table cells; footnote text present; 1 `blockquote` |
| B4 | Relative image beside the document | `blob:` image, `naturalWidth` 320, resolved in 1 ms |
| B5, B6 | Missing and remote images | `data-state="missing"` and `data-state="blocked"` placeholders; 0 `http(s)` image sources |
| B9, F1 | Raw HTML and link schemes | `window.__inkfinXss` undefined; script tag inert; 0 live `javascript:` hrefs |
| B10, B12 | Highlighting and copy controls | 54 token spans; 12 copy buttons |
| D1, G3 | Ordinary save → visible refresh | 234 ms (poll interval 25 ms) |
| B14, G4 | 364,475-byte, 5,000-line document: open and render | 185 ms; all 5,000 source lines present; last line rendered |
| F8 | Document hash after the session | unchanged |

`tools/windows/interaction-probe.mjs` covers the rows neither probe above reaches
(`artifacts/windows/interaction-probe.json`):

| Matrix | What was measured | Result |
| --- | --- | --- |
| A7 | Launch with no document on the command line | `Open a Markdown file`, an `Open file` control, `No document open` status |
| C5 | Theme menu opened, dark → light → dark | items `Light`, `Dark`, `System`; each switch applied without a restart |
| C4 | Ctrl+= × 8, Ctrl+- × 12, Ctrl+0 | stopped at **2.0** and **0.75**, reset to **1.0** |
| GATE-W3 | Window at 480 × 360, zoomed to 125 % | client 464 × 321, `scrollWidth` == `clientWidth`, no overflow |
| C11 | `prefers-reduced-motion: reduce` emulated | `.toolbar button` transitions normally and does not under `reduce` |

The probe writes the app's own preference store, as a reader would, and resets zoom
to 100 % before it exits; the theme is put back to the value it found.

## 7. Defects found and fixed

### 7.1 Relative images never loaded in the packaged app — fixed, verified

Matrix row B4.

Reproduction (before the fix): open `docs/acceptance/fixture.md` in the packaged
build; the relative `![Relative diagram](diagram.png)` shows the "missing"
placeholder whose tooltip reads `No document is open.`, while the Rust asset
command and its seven unit tests pass. The remote image and the missing image
behave correctly, so the failure is specific to a resolvable local image.

Root cause: `DocumentAssets.resolve()` returned
`{status: 'missing', message: 'No document is open.'}` whenever no generation was
set yet. React runs a child's effect before its parent's, so `MarkdownImage`
resolved on the first paint at a moment when the controller had not yet called
`assets.setGeneration(...)`. The reference never changed afterwards, so nothing
ever retried: the image stayed broken for the lifetime of the document.

Fix: `src/features/document/assets.ts` queues requests that arrive before a
generation exists and releases them when `setGeneration` publishes one;
`dispose()` releases them as well, so a torn-down surface cannot hang a pending
image. No retry loop, no timer, and the cache still revokes object URLs per
generation.

Verification after the fix:

| Check | Before | After |
| --- | --- | --- |
| `tests/markdownImage.spec.tsx` (new, 6 tests) | n/a | 6 passed |
| Full frontend suite | 89 passed | **95 passed** |
| Packaged probe: relative image | `false`, 0 `img` | `blob:` image, `naturalWidth` 320, 1 ms |
| Packaged probe on the current binary | — | reproduced again: `relativeImageRendered: true` |

### 7.2 Uninstalling after a reinstall left dead Markdown associations — fixed, verified

Matrix row H10, gates GATE-W1/GATE-W2.

Reproduction (`tools/windows/reinstall-cycle.mjs`, install → install over the top
→ uninstall):

| Step | `.md` | `.markdown` | `Markdown Document` ProgID |
| --- | --- | --- | --- |
| before | `Markdown` | none | absent |
| after first install | `Markdown Document` | `Markdown Document` | present |
| after reinstall | `Markdown Document` | `Markdown Document` | present |
| after uninstall | **`Markdown Document`** | **`Markdown Document`** | **deleted** |

Both extensions are left pointing at a ProgID the uninstaller has just deleted, so
every `.md` and `.markdown` file afterwards asks which app to open it with — and
the reader's real handler is not restored either.

Root cause: Tauri's NSIS template registers both extensions under one ProgID and
remembers each extension's previous default in a `Markdown Document_backup` value.
Installing over an existing installation makes that value Inkfin's **own** ProgID,
so the uninstall that follows restores the extension to a ProgID it has just
removed. The backup value is never deleted, so the mistake is also sticky across
later cycles.

Fix: `src-tauri/nsis-hooks.nsh`, wired through `bundle.windows.nsis.installerHooks`.

- `NSIS_HOOK_PREINSTALL` — if an extension still names `Markdown Document` and a
  non-empty previous value is on record, that value is written back **before** the
  installer overwrites it, so the reinstall remembers the reader's real default
  instead of Inkfin's own.
- `NSIS_HOOK_POSTUNINSTALL` — after the uninstaller has removed its keys, any
  extension still naming the dead ProgID is cleared and the `_backup` values are
  deleted.

Verification, same cycle, same host, new package (`d1d9fc88…`):

| Check | Before the fix | After the fix |
| --- | --- | --- |
| `tools/windows/reinstall-cycle.mjs` | exit 1, both extensions dangling | **exit 0**, no failures |
| `.md` after uninstall | `Markdown Document` (dead) | `Markdown` — the value the first install found |
| `.markdown` after uninstall | `Markdown Document` (dead) | none — as before the install |
| `Markdown Document_backup` residue | left on both extensions | removed from both |
| Full installed audit on the new package | — | exit 0, no failures (all of §4) |

## 8. Signing and notarisation

| Matrix | Artifact | Check | Result |
| --- | --- | --- | --- |
| H4 | `Inkfin_0.1.2_x64-setup-released.exe` | `Get-AuthenticodeSignature` | `Status=NotSigned`, no signer |
| H5 | `Inkfin-0.1.2-universal-unsigned.dmg` | CI log; `CI-MAC` `spctl` | no signing identity configured; name carries `-unsigned`; Gatekeeper refuses the bundle |

Both are deliberate distribution facts recorded in
[MACOS-PACKAGING.md](MACOS-PACKAGING.md) §7, not regressions. They stay `FAIL`
until a Windows certificate and Apple Developer ID credentials exist. Every
artifact above is an **unsigned test build** and is labelled as one.

## 9. Unverified or blocked

Nothing below is claimed as working.

- A **clean-machine** run of the Windows package: install, associations, Open With,
  480 × 360 and offline (GATE-W1–W6, H6, H7, H8's install half). The evidence in
  §4 comes from a development host with other applications installed.
- The offline claim is `PARTIAL`: the session ran with name resolution poisoned for
  the app, not on a machine with its interface down (C12, H8).
- Drag and drop (A2, A3), the native picker (A1), a launch with no argument (A7),
  spoken screen-reader output (C9), reduced motion (C11), and Windows ACL denial
  outside the installed app (E6, now covered in the package).
- Scroll-anchored refresh and continuity through a real refresh (D4, D5) — the
  refresh itself is measured, the anchor behaviour is unit-tested only.
- Startup time and memory on a clean machine (G1, G2); this host is warm.
- Synced and network folders (E12).
- macOS rows that need a reader at the machine: Finder double-click as the default
  handler, drag and drop, TCC-protected folders, the 480 × 360 pointer layout,
  screen-reader output and the rest of the A1–K3 sheet in
  [MACOS-ACCEPTANCE-RUN.md](MACOS-ACCEPTANCE-RUN.md). The rows a headless Mac could
decide are in §5.
- macOS rendering itself: the webview's DOM is not reachable the way WebView2's is,
  so B1–B14 stay `PASS` on Windows and `UNVERIFIED` on macOS.
- macOS uninstall (dragging the app to the Trash, and what remains in `~/Library`).
- macOS signing and notarisation (H5, GATE-M2), which need Apple credentials.

## 10. Reproducing this report

```bash
npx tsc --noEmit && npx eslint . && npx vitest run
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check
cd .. && npx tauri build

# packaged binary, outside the installer
powershell -ExecutionPolicy Bypass -File tools/windows/smoke-test.ps1 \
  -Exe src-tauri/target/release/inkfin.exe -FixtureDirectory docs/acceptance
node tools/windows/render-probe.mjs src-tauri/target/release/inkfin.exe
node tools/windows/interaction-probe.mjs src-tauri/target/release/inkfin.exe

# installed package: install, drive, uninstall, and restore the registry
node tools/windows/installed-audit.mjs \
  artifacts/windows/Inkfin_0.1.2_x64-setup-assoc-fix.exe

# the association defect of §7.2, and its fix
node tools/windows/reinstall-cycle.mjs \
  artifacts/windows/Inkfin_0.1.2_x64-setup-assoc-fix.exe

# what the extensions point at right now (read-only; -Reset clears leftovers)
powershell -ExecutionPolicy Bypass -File tools/windows/assoc-state.ps1
```

The audit helper scripts write only to `artifacts/` (git-ignored) and to a
temporary folder, and they restore the registry values they snapshot. The installed
audit needs a machine where installing Inkfin is acceptable; it uninstalls again in
a `finally` block. The probes need Node 22 or newer (for the global `WebSocket`)
and a WebView2 runtime that honours `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`; they
open loopback ports 9411 and 9412 only.

macOS rows run on real Macs through GitHub Actions:

```bash
gh workflow run macos-acceptance.yml
# or re-test an earlier run's DMG without rebuilding it:
gh workflow run macos-acceptance.yml -f build_run_id=<run id>
```

The same script runs on any Mac with a DMG to hand:

```bash
tools/macos/acceptance.sh ~/Downloads/Inkfin-0.1.2-universal-unsigned.dmg
```
