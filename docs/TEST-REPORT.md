# Inkfin test report — 0.1.2

Date: 17 October 2026. App version 0.1.2, commit `25782cc` plus the working-tree
change described in §7.

Row IDs below are from [TEST-MATRIX.md](TEST-MATRIX.md). Every row states its
environment, its result and where the evidence lives.

## 1. Verdict

**Not release-ready.** The blocking acceptance criteria in
[TEST-MATRIX.md](TEST-MATRIX.md) are not met:

- Windows packaging rows are only partially verified: the packaged binary was
  exercised on this development machine, but **not installed on a clean machine**,
  so file associations, an installer-driven first launch and offline operation
  remain `UNVERIFIED` (GATE-W1, GATE-W2, GATE-W6).
- Every macOS runtime row is `UNVERIFIED`: there is no macOS host here. macOS
  evidence is limited to a CI build and `lipo` output (GATE-M1, GATE-M3).
- Both distributed installers are **unsigned**. SmartScreen warns on Windows and
  Gatekeeper blocks the first launch on macOS (GATE-S1, GATE-S2, rows H4, H5).

One real defect was found and fixed during this audit (§7). Its fix is verified in
the packaged binary.

## 2. Environment

Clean-environment options were checked on this host before the remaining blocking
tests were attempted (`docs/TEST-MATRIX.md` §Known gaps):

| Option | Availability | Consequence |
| --- | --- | --- |
| Windows Sandbox | **Unavailable** — Windows 11 **Home** Single Language; the feature needs Pro or Enterprise | cannot install the package in a disposable Windows |
| Hyper-V / VirtualMachinePlatform | state requires elevation; Sandbox is not installable on Home regardless | no local VM for a clean Windows image |
| Docker | not installed | no Windows container to install into |
| WSL2 (Ubuntu 22.04) | installed, but **no `cargo`, `rustc` or `node`** inside it | POSIX-only Rust tests cannot run there without provisioning a toolchain |
| A real Mac | not available | every macOS runtime row stays `UNVERIFIED` |

| Item | Value |
| --- | --- |
| Windows host | Microsoft Windows 11 Home Single Language, build 10.0.26300 |
| CPU | 13th Gen Intel Core i7-13620H, 10 cores / 16 threads |
| Memory | 15.7 GB |
| WebView2 runtime | 155.0.4283.60 |
| Node | v24.14.1 |
| Rust | cargo 1.98.1 (2026-08-05) |
| TypeScript | 6.0.3 |
| macOS build (CI only) | `macos-15-arm64`, image `20260907.0337` |
| macOS host, clean Windows host | **not available** |

Artifacts preserved under `artifacts/` (git-ignored):

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `windows/Inkfin_0.1.2_x64-setup-released.exe` (downloaded from the release) | 3,700,009 | `f35016d98448332ba2cb75fcde32c36522cb1ddf29c2607ba651dcd14bc4faa7` |
| `windows/Inkfin_0.1.2_x64-setup-local.exe` (built here, before the fix) | 3,676,840 | `9d9b1b18e2310eb61a5bd7a2c099230a43444a94d3c720ad221b418ea84e8c1a` |
| `windows/Inkfin_0.1.2_x64-setup-local-fixed.exe` (built here, after the fix) | 3,678,286 | `c022315749a7b9bb9a1e75434b9bbb330c951de879384bda32697ebe072e701a` |
| `windows/inkfin-0.1.2-x64-release-fixed.exe` (packaged binary tested below) | 4,084,224 | `43bc3fa5cdaca074181a97e1482591681eccbe5151474457fb70ab0d54aad4ec` |
| `macos/Inkfin-0.1.2-universal-unsigned.dmg` (from the release) | 7,788,508 | `8761ff41c7f0f90d05df9c1db5d2fd3cbc3e65956274327d9733eee402642968` |

The local installer and the CI installer differ in bytes: each build regenerates
hashed frontend asset names, and the NSIS header carries a build timestamp. Both
report version 0.1.2.

The downloaded macOS image was structurally checked: it carries a real UDIF
trailer (`koly` in the last 512 bytes), so the file is a disk image and not a
truncated download. That is the strongest check possible without macOS.

## 3. Automated suites

All run in this repository on the Windows host above.

| Check | Command | Result | Evidence |
| --- | --- | --- | --- |
| Types | `npx tsc --noEmit` | clean, exit 0 | this report |
| Lint | `npx eslint .` | clean, exit 0 | this report |
| Frontend tests | `npx vitest run` | **16 files, 95 tests passed**, 0 failed, 10.3 s | `tests/` |
| Rust tests | `cargo test` (in `src-tauri/`) | **59 passed**, 0 failed, 1.17 s | `src-tauri/src` |
| Rust lints | `cargo clippy --all-targets -- -D warnings` | clean, exit 0, 2 m 44 s | this report |
| Rust format | `cargo fmt --check` | clean, exit 0 | this report |
| Windows package | `npx tauri build` | exit 0; frontend 3.82 s; release compile 8 m 53 s; NSIS bundle produced | `artifacts/tauri-build.log` |
| Windows package after fix | `npx tauri build` | exit 0; frontend 1.78 s; bundle produced | `artifacts/tauri-build-after-fix.log` |

Test count grew from 84 to 95: `tests/fileStates.spec.tsx` (5) covers empty,
oversized, non-UTF-8, denied and vanished files through the real app shell, and
`tests/markdownImage.spec.tsx` (6) covers the defect in §7.

## 4. Packaged Windows binary (not installed)

Two probes drove the real packaged `inkfin.exe` (4,084,224 bytes, hash above).
Neither installs anything; both open the fixtures in `docs/acceptance/`.

`tools/windows/smoke-test.ps1` → `artifacts/windows/smoke-result-after-fix.json`:

| Matrix | What was measured | Result |
| --- | --- | --- |
| G1 (partial) | Process start to the window showing `fixture.md - Inkfin` | **772 ms** |
| G2 (partial) | Working set / private bytes with the document open | **27,873,280 B (26.6 MiB) / 5,804,032 B** |
| A5, GATE-W2 (partial) | Second launch with `linked-note.md` while running | title became `linked-note.md - Inkfin`; **process count 1** |
| F8 | Fixture hashes before and after | **unchanged** |
| — | Window screenshot | `artifacts/windows/smoke-window-after-fix.png`, 916 × 689, non-blank |

`tools/windows/render-probe.mjs` drives the same binary over the Chromium DevTools
Protocol (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`), so
these results come from what the packaged webview actually painted →
`artifacts/windows/render-probe-after-fix.json`:

| Matrix | What was measured | Result |
| --- | --- | --- |
| B1 | Heading, list items, blockquote rendered | heading present; 11 `li`; 1 `blockquote` |
| B2 | Table rendered | 12 cells |
| B3 | Footnote definition text present | true |
| B4 | Relative image beside the document | **resolved in 1 ms** as a `blob:` image, `naturalWidth` 320 |
| B5 | Missing image | placeholder, `data-state="missing"`, "The file could not be found." |
| B6, C12 (partial) | Remote image | placeholder, `data-state="blocked"`; **0** `http(s)` image sources |
| B9 | Raw HTML in Markdown | `window.__inkfinXss` undefined; the script tag renders as inert text |
| B10 | Highlighting | 54 token spans in the fixture's code blocks |
| D1, G3 | Ordinary save → visible refresh | **226 ms** (poll interval 25 ms) |
| B14, G4 | ~5,000-line, 364,475-byte document: open and render | **183 ms**; all 5,000 source lines present; last line rendered |
| F1 | `javascript:` destinations | 0 live `javascript:` hrefs |
| F8 | Document hash after the session | unchanged |

Not measured in the package: atomic-save refresh (D2, Rust-tested only), the
480 × 360 window (C10), screen-reader output (C9), reduced motion (C11), and
installer behaviour.

## 5. macOS

| Matrix | Evidence | Result |
| --- | --- | --- |
| H2 | CI run [39041541760](https://github.com/PriyansuMaurya/Inkfin/actions/runs/39041541760), `macos-15-arm64` | `lipo` reported `x86_64 arm64`; DMG produced |
| H3 | `publish` job, asset URLs | DMG and installer attached; both URLs return HTTP 200 |
| H5 | Derivation in the workflow | artifact is `-unsigned`; `codesign`, `spctl` and `stapler` steps were skipped because no Apple credentials exist |
| H6, GATE-M1, GATE-M3 | — | `UNVERIFIED`: no Mac, so nothing was installed, launched, or run through Gatekeeper |

No macOS runtime claim is made anywhere in this report.

## 6. Signing and notarisation

| Matrix | Artifact | Check | Result |
| --- | --- | --- | --- |
| H4 | `Inkfin_0.1.2_x64-setup-released.exe` | `Get-AuthenticodeSignature` | `Status=NotSigned`, no signer |
| H5 | `Inkfin-0.1.2-universal-unsigned.dmg` | CI log | no signing identity configured; name carries `-unsigned` |

Both are deliberate distribution facts recorded in
[MACOS-PACKAGING.md](MACOS-PACKAGING.md) §7, not regressions. They stay `FAIL`
until a Windows certificate and Apple Developer ID credentials exist.

## 7. Defect found and fixed

**Relative images never loaded in the packaged app.** Matrix row B4.

Reproduction (before the fix): open `docs/acceptance/fixture.md` in the packaged
build; the relative `![Relative diagram](diagram.png)` shows the "missing" placeholder
whose tooltip reads `No document is open.`, while the Rust asset command and its
seven unit tests pass. The remote image and the missing image behave correctly, so
the failure is specific to a resolvable local image.

Root cause: `DocumentAssets.resolve()` returned `{status: 'missing', message: 'No
document is open.'}` whenever no generation was set yet. React runs a child's
effect before its parent's, so `MarkdownImage` resolved on the first paint at a
moment when the controller had not yet called `assets.setGeneration(...)`. The
reference never changed afterwards, so nothing ever retried: the image stayed
broken for the lifetime of the document.

Fix: `src/features/document/assets.ts` now queues requests that arrive before a
generation exists and releases them when `setGeneration` publishes one; `dispose()`
releases them as well, so a torn-down surface cannot hang a pending image. No
retry loop, no timer, and the cache still revokes object URLs per generation.

Verification after the fix, all re-run on the rebuilt binary:

| Check | Before | After |
| --- | --- | --- |
| `tests/markdownImage.spec.tsx` (new, 6 tests) | n/a | `6 passed` |
| Full frontend suite | 89 passed | **95 passed** |
| Packaged probe: relative image | `relativeImageRendered: false`, 0 `img` | `true`, `blob:` image, `naturalWidth` 320, resolved in 1 ms |
| Packaged smoke test | `SMOKE_OK` | `SMOKE_OK` |

The regression test mounts the image before the generation exists and asserts the
`<img>` appears afterwards, which is the ordering that failed in production.

## 8. Unverified or blocked

Nothing below is claimed as working. Each needs hardware or credentials this
repository does not have.

- Installer-driven first launch, file associations, Open With on a clean machine
  (GATE-W1, GATE-W2, H6, H7). No clean Windows host exists here: Windows Sandbox
  is unavailable on Windows 11 Home, there is no Docker or VM tooling, and the
  WSL2 distro has no Rust or Node toolchain. Installing on this development
  machine was deliberately not done, because that machine is not clean and the
  install would change this host's file associations.
- Offline use in a packaged build (GATE-W6, C12, H8).
- The 480 × 360 minimum window and its layout (C10, GATE-W3).
- Screen-reader output and reduced motion (C9, C11).
- Atomic saves and rapid saves in the packaged build (D2, D3 — Rust-tested only).
- Refresh latency and start-up time on a clean machine (this host is a warm
  development machine, so 772 ms and 226 ms are best cases, not guarantees).
- Every macOS runtime row, including Gatekeeper acceptance, dock reopen, Finder
  cold start and the A1–K3 acceptance matrix (GATE-M1, GATE-M3, A6, A8, F7).
- Windows ACL-based permission denial (E6: covered on POSIX unit tests only).
- Synced and network folders (E12).

## 9. Reproducing this report

```bash
npx tsc --noEmit && npx eslint . && npx vitest run
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check
cd .. && npx tauri build
powershell -ExecutionPolicy Bypass -File tools/windows/smoke-test.ps1 \
  -Exe src-tauri/target/release/inkfin.exe -FixtureDirectory docs/acceptance
node tools/windows/render-probe.mjs src-tauri/target/release/inkfin.exe
```

Clean-machine rows need a disposable Windows host (Windows 11 Pro/Enterprise with
Windows Sandbox, or a VM with a fresh image):

```powershell
# inside that host, with the preserved installer copied in
Start-Process -Wait .\Inkfin_0.1.2_x64-setup-local-fixed.exe -ArgumentList '/S'
# then: double-click a .md and a .markdown, Open With while running, 480x360, offline
```

The probe needs Node 22 or newer (for the global `WebSocket`) and a WebView2
runtime that honours `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. It opens loopback
port 9411 only, and it launches the app twice.
