# macOS packaging, signing and notarisation

**Status:** the macOS build is configured and has a CI workflow, but **no macOS
artifact has been produced or run**. This machine is Windows; a workflow file is
not a tested application. The public release gate therefore stays open, and the
first Mac run must fill the record in §7.

The Windows release path is unchanged: `.github/workflows/release.yml` and the
`nsis` bundle targets still publish the Windows installer.

As of 17 October 2026 the macOS workflow exists only in the working tree — it is
not on the default branch, so GitHub cannot queue it — and no Apple signing or
notarisation secrets are configured. No macOS job has ever run, and the
`v0.1.1` release contains only `Inkfin_0.1.1_x64-setup.exe`.

## 1. Values and where they come from

| Setting | Value | Source | Why |
| --- | --- | --- | --- |
| App name | `Inkfin` | `tauri.conf.json` → `productName` | One declaration for both platforms; the macOS override must not restate it (contract test) |
| Identifier | `com.inkfin.viewer` | `tauri.conf.json` → `identifier` | Already public on Windows; changing it breaks the store file location and the document association |
| Icons | `icon.icns` plus the PNG set | `tauri.macos.conf.json` → `bundle.icon` | `icon.icns` carries the 16–512 px representations macOS needs |
| File associations | `.md`, `.markdown`; role `Viewer`; rank `Default`; UTI `net.daringfireball.markdown` | `tauri.conf.json` → `bundle.fileAssociations` | Shared entry; Tauri maps it to `CFBundleDocumentTypes` |
| Category | `Utility` | `tauri.conf.json` → `bundle.category` | Shown in Finder/Launchpad grouping |
| Minimum macOS | `14.2` | `tauri.macos.conf.json` → `bundle.macOS.minimumSystemVersion` | Search relies on the CSS Custom Highlight API, which Safari ships from 17.2; macOS 14.2 is the oldest OS with it. Older systems would open documents with broken find-in-page |
| Hardened runtime | `true` | same file | Required for notarisation |
| Architectures | `arm64` + `x86_64`, lipo'd into one binary | workflow `--target universal-apple-darwin` | See §2 |
| Sandbox / entitlements | none | — | The app is not sandboxed and needs no special entitlements: WKWebView runs out of process (no JIT entitlement), nothing listens on a socket, and file access is user-initiated. An App Store build would need a sandbox entitlement and a new review of these choices |

Tauri version: CLI `2.11.5`, runtime crate `2.11.6`. The macOS override is merged
over the base config automatically by the CLI; it deliberately contains only
keys that differ.

## 2. Universal build versus separate Apple silicon and Intel builds

**Decision: one universal build.** `tauri build --target universal-apple-darwin`
compiles both slices and lipo's them into `Inkfin.app`; the DMG carries that one
app.

| | Universal (chosen) | Separate arm64 + x64 |
| --- | --- | --- |
| Downloads | One file; no architecture choice for the user | Two files; the wrong one still runs, but under Rosetta or not at all on older Intel Macs |
| Size | Roughly the sum of both slices (each architecture's Rust code is present). For scale, the Windows x64 binary is 3.90 MiB and its installer 3.51 MiB, so a universal macOS DMG should still be single-digit MB — measured after M1 | Each download is roughly half the universal size |
| CI cost | One job compiles both slices; one notarisation submission | Two jobs (or a matrix), two notarisation submissions, two signature verifications |
| Signing | One bundle, one identity, one staple | Two bundles to sign, staple and verify |
| Failure modes | Bigger download | Users picking the wrong asset; release notes must explain the choice |

For a single-binary document viewer the size difference is a few megabytes and
the UX difference is a support question, so universal is the better trade. If
the DMG grows past roughly 50 MB, split the architectures and publish clearly
labelled `-arm64` / `-x64` assets instead — the workflow is the only thing that
changes, not the app.

Building universal needs both targets installed:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

## 3. What the workflow does

`.github/workflows/release.yml` is the only release workflow. It runs on a
`v*.*.*` tag and on manual dispatch, and publishes the installable files for both
platforms to one GitHub release:

1. A `resolve` job reads the version from `src-tauri/tauri.conf.json`, derives
the tag (`v<version>` for a manual run), refuses to continue if a pushed tag and
the app version disagree or if a run from a newer commit would overwrite an
older tag's assets, and decides the macOS distribution level **from the secrets
that exist** — it never assumes they do:
   | Secrets present | Artifact suffix | Meaning |
   | --- | --- | --- |
   | certificate + Apple ID trio, or certificate + API key pair | none | Signed, notarised, stapled; the release-quality download |
   | certificate only | `-signed-unnotarized` | Gatekeeper will warn on first open; not a release |
   | none | `-unsigned` | Installable test build only; not a release |
2. `build-windows` runs on `windows-latest`, builds the NSIS installer and fails
if no `*-setup.exe` was produced.
3. `build-macos` runs on `macos-15` (Apple silicon; both slices are
cross-compiled there). It installs Node 22, the two Rust targets and the cargo
cache, imports the `.p12` into a throwaway keychain, writes the App Store Connect
`.p8` when the API-key route is used, and builds with `--no-sign` when no
certificate exists so the absence is explicit rather than accidental.
4. It verifies the artifact before uploading it:
   - `lipo -archs` on the binary must list both `arm64` and `x86_64`;
   - the `.app` bundle and binary must exist, and a `.dmg` must have been produced;
   - when notarised: `codesign --verify --deep --strict` and `spctl --assess`
     on the app, `xcrun stapler validate` on the app, and `codesign --verify` on
     the disk image. Gatekeeper's verdict on the image itself is reported but
     does not fail the job: Tauri notarises and staples the app inside the DMG,
     and the app assessment is the one that decides whether it launches.
5. The verified DMG is copied to `Inkfin_<version>_universal<suffix>.dmg`, where
the suffix comes from the table in step 1, and both installers are uploaded as
workflow artifacts.
6. `publish` waits for both build jobs, downloads the two installers, and creates
the release — or replaces the assets of an existing one. The release body marks
an un-notarised macOS build as such. Because the job needs both builds, a failure
on either platform leaves the previous release untouched rather than half-built.

## 4. Secrets for public distribution

Add these in **Settings → Secrets and variables → Actions**. All are optional for
a test build; the workflow degrades to a labelled unsigned bundle.

| Secret | Required for | Notes |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | Signing | Base64 of a password-protected `.p12` containing a **Developer ID Application** certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Signing | The `.p12` export password |
| `MACOS_KEYCHAIN_PASSWORD` | Signing | Arbitrary password for the temporary keychain; the job fails with a clear error if it is missing while a certificate is set |
| `APPLE_SIGNING_IDENTITY` | Signing | e.g. `Developer ID Application: Your Name (TEAMID)`; pins the identity when the keychain holds more than one |
| `APPLE_ID` | Notarisation | Apple ID email |
| `APPLE_PASSWORD` | Notarisation | App-specific password, not the account password |
| `APPLE_TEAM_ID` | Notarisation | Ten-character team ID |
| `APPLE_API_KEY` | Notarisation (alternative) | App Store Connect key ID |
| `APPLE_API_ISSUER` | Notarisation (alternative) | Issuer UUID |
| `APPLE_API_KEY_P8` | Notarisation (alternative) | Contents of `AuthKey_<KEYID>.p8`; the job writes it to a private file and passes the path |

Create the certificate locally (Keychain Access → Certificate Assistant, or the
Apple Developer portal), export the certificate **and private key** as `.p12`,
then base64 it:

```bash
base64 -i DeveloperID.p12 -o developerid.p12.b64
```

Tauri's documented behaviour, relied on here: with notarisation credentials
present, `tauri build` submits the app, waits for the result and staples the
ticket, so no separate `notarytool` call is needed. `--skip-stapling` exists for
the first notarisation when Apple's queue is long; the workflow does not use it,
so an artifact labelled `release` always carries a stapled ticket.

## 5. Local test build on a Mac

Without credentials, produce a clearly unsigned bundle:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run tauri build -- --target universal-apple-darwin --no-sign
```

Artifacts, under `src-tauri/target/universal-apple-darwin/release/bundle/`:

- `macos/Inkfin.app`
- `dmg/Inkfin_<version>_universal.dmg`

That bundle is useful for launching the app on the build machine and running the
functional check lists. It is **not** evidence that the distributed build works:
an unsigned, un-notarised app behaves differently through Gatekeeper (download,
quarantine, first-open prompt), and it proves nothing about signing.

## 6. Windows release path

Unchanged and still primary:

- `.github/workflows/release.yml` builds the NSIS installer on `windows-latest`
  and uploads it from the `publish` job of the same workflow.
- `tauri.conf.json` keeps `"targets": ["nsis"]`, the current-user install mode
  and the embedded WebView2 bootstrapper.
- `tools/dev-setup/build.ps1` still builds locally when `cargo` is not on PATH.

Two contract tests (`services::contract_tests`) now guard this: the macOS
override must not restate the identity, and the Windows bundle configuration must
stay as it is.

## 7. Release gate (open)

The public macOS release may be announced only when **all** of these hold.
Attaching an `-unsigned` or `-signed-unnotarized` DMG to a release is allowed — it
is an installable test build and is labelled as one — but it does not satisfy
M3–M6, so no page may present it as the release.

| # | Gate | Status |
| --- | --- | --- |
| M1 | The workflow is on the default branch and has run on a macOS runner, producing both artifacts | **Passed** 17 October 2026, run [39041541760](https://github.com/PriyansuMaurya/Inkfin/actions/runs/39041541760) on tag `v0.1.2` |
| M2 | `lipo -archs` shows `arm64` and `x86_64` (the workflow asserts this) | **Passed**; the job printed `Architectures: x86_64 arm64` |
| M3 | The artifact is labelled `release` (certificate + notarisation secrets present) | Open; no credential configured, so the published DMG is `-unsigned` |
| M4 | `spctl --assess` passes on a machine that downloaded the DMG through a browser, with quarantine applied | Blocked on M3 |
| M5 | The app launches from `/Applications` on macOS 14.2 (oldest supported) and on the newest release | Not run; no Mac |
| M6 | The functional checks in `MACOS-FINDER-CHECKS.md` and `MACOS-DOCUMENT-PIPELINE.md` pass on that build | Not run; no Mac |
| M7 | Windows packaging still produces an installer (verified on every release) | **Passed** in the same run; `Inkfin_0.1.2_x64-setup.exe`, 3,700,009 bytes |

Record of the first run:

```text
Workflow run:        https://github.com/PriyansuMaurya/Inkfin/actions/runs/39041541760
Runner image:        macos-15-arm64 (20260907.0337) / windows-latest
Artifact label:      unsigned
DMG size:            7,788,508 bytes (7.4 MB)
lipo -archs:         x86_64 arm64
codesign:            not run (no certificate)
spctl:               not run (not notarised)
Stapled ticket:      no
macOS tested on:     none
```

## 8. What has been verified without a Mac

- The workflow has now run end to end on tag `v0.1.2`: both platform builds and
  the `publish` job succeeded, the DMG and the NSIS installer were attached to
  the release, and both download URLs return HTTP 200. The macOS artifact is
  `unsigned`, so no signing, notarisation or stapling command exercised yet.
- The macOS override parses and only adds macOS keys; `hardenedRuntime` is true
  and `minimumSystemVersion` is `14.2` (`cargo test`, contract tests).
- The base config still names the app, identifier, icons, associations and
  `nsis` target, and the Windows-specific options are untouched (contract tests).
- The workflow file parses as YAML, and the base + macOS override, deep-merged
the way the CLI merges them, validates against the shipped
  `@tauri-apps/cli/config.schema.json` (Ajv).
- The tag/version resolution, distribution labelling and asset naming were run
  locally against the real config for both trigger styles (tag and manual).
- The distribution-label step was run locally against five secret combinations:
  none → `unsigned`, certificate only → `signed-unnotarized`, certificate plus
  the Apple ID trio → `release`, certificate plus the API key pair → `release`,
  and a partial Apple ID set → `signed-unnotarized` (it does not claim a release
  it cannot notarise).
- The workflow has **not** executed on a runner, so its signing, `spctl` and
  `stapler` commands are unproven in CI.
- A local Windows `tauri build` still produces the NSIS installer, which is the check that this configuration change did not disturb the shipped platform. Re-run on 17 October 2026 with `CARGO_TARGET_DIR` outside the repository: release compile 5 m 07 s, `inkfin.exe` 4,084,224 bytes, `Inkfin_0.1.1_x64-setup.exe` 3,677,220 bytes, bundle target `nsis`, `makensis` completed, exit 0. The frontend build ran first as `beforeBuildCommand` (`tsc --noEmit && vite build`).
- `cargo check --target aarch64-apple-darwin` remains blocked on Windows in
  `fsevent-sys` (the macOS watcher backend needs a darwin C toolchain), so even
  the Rust compilation of the macOS arms happens first on the runner.
