# Markdown Preview - Project Memory and Handoff

**Last updated:** 24 September 2026 · **Status:** Implemented; Windows installer built; release gates not yet executed in an installed build.

## Stable context
Product: Windows-first local Markdown file viewer. Main workflow: open one `.md`/`.markdown`, read, optionally search/zoom, see external saves update. Visual direction: minimal preview with native-feeling window and a centred document. Exactly seven MVP features: open local files, render GFM, syntax highlighting, light/dark/system themes, visible-text search, document zoom and automatic refresh. No editor, auth, database, cloud, network fetch or telemetry.

## Decisions and rationale
| ID | Decision | Rationale / verification still needed |
| --- | --- | --- |
| ADR-001 | Tauri 2 + Rust, React/TypeScript/Vite | Native Windows integration with a small local renderer. Installer now builds and runs `cargo clippy --all-targets -- -D warnings` and `cargo test` clean; packaged startup still to be smoke-tested. |
| ADR-002 | Single document per window; new open replaces current | Supports quick-preview workflow. Generation comparison in `state.rs` orders concurrent opens; a later-issued generation always wins, so rapid switching cannot leave the older document on screen. |
| ADR-003 | Rust owns validated read-only file and image access | Keeps generic filesystem powers away from untrusted Markdown rendering. Containment, symlink-escape and executable-link cases have unit tests; capabilities are scoped to the window, dialog and store plugins. |
| ADR-004 | react-markdown + remark-gfm; no raw HTML | GFM coverage with a safer default rendering path. No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in `src/`; a test asserts injected HTML stays inert text. |
| ADR-005 | Watch parent directory, debounce and compare contents | Editors often replace files atomically. Watcher holds the parent directory so temp-file rename saves are observed; retryable (transient) failures are separated from failures that must report immediately. |
| ADR-006 | Block remote images and unsupported link schemes | Maintains a concrete offline/local privacy boundary. Remote images render a placeholder; `javascript:` and `file:` links become inert buttons that explain the refusal. |
| ADR-007 | No auth milestone | No accounts exist in this product; phases follow actual work. |
| ADR-008 | Search reads the rendered DOM, not the Markdown source | A reader searches for words they can see. Line breaks are recorded only at block boundaries, so the index is identical whether a code fence is plain or tokenised, and a match can span inline elements without matching across two lines. |
| ADR-009 | Highlight painting never mutates the rendered tree | Uses the CSS Custom Highlight API with ranges, so selection, copy and the rendered tree are untouched. Falls back to reporting that highlighting is unavailable rather than rewriting text nodes. |
| ADR-010 | Zoom scales typography, not the column or image fit | A reading column stays capped at 760 px by design; zoom is a legibility control, so changing it must not reflow the layout width. Implemented as `font-size: calc(var(--k-font-size-document) * var(--k-zoom))` on `.document-column` in `src/styles/document.css`, with all document typography in `em`. Recorded because the alternative is a plausible misreading of F6. |

## Deviations from the specification set
| Deviation | Reason |
| --- | --- |
| Two watcher events, `document_unavailable` and `document_missing`, are emitted in addition to the single `document_missing` named in ARCHITECTURE.md. | "Currently unreadable" (transient, preview preserved) and "deleted" are different reader situations needing different copy. |
| `bundle.windows.webviewInstallMode` set to `embedBootstrapper`. | PRD gate 6 asks for an offline install; the default `downloadBootstrapper` fetches on install. Note this embeds the *bootstrapper*, which still reaches the network if WebView2 is absent; on Windows 10/11 the runtime ships with the OS. |
| Colour tokens were extended with derived `--k-*` surface tokens beyond the literal values in DESIGN.md. | DESIGN.md does not list every hover/pressed/border surface the mockups show; the derived tokens keep the palette consistent instead of scattering ad-hoc hex values. |
| Preferences use the Tauri store plugin rather than an ARCHITECTURE-proposed `services/preferences.rs`. | Removes a hand-rolled JSON file plus its corrupt-file recovery path; stored values are still validated on read, and invalid ones fall back to defaults. |
| One `fileAssociations` entry with `"ext": ["md", "markdown"]` rather than two entries. | Two entries shared a ProgID name, which the NSIS template dedupes, so `.markdown` could end up unregistered. Release gate 1 still needs an installed-build check. |
| `tools/dev-setup/` holds the Rust/VS Build Tools bootstrap scripts; throwaway reverse-engineering scripts were removed. | They are environment setup, not product code, and the removed scripts had hardcoded absolute paths. `tools/analysis.txt` and `tools/controls.txt` remain as the measurement record behind the DESIGN.md numbers, but their generator scripts are gone. |

## Current status
- Full application implemented: Rust/Tauri backend, React renderer, styles, tests, icon set, NSIS installer.
- Verification run: `npx tsc --noEmit` clean, `npx eslint .` clean, `npx vitest run` 56/56 passing across 9 files, `npx vite build` succeeding, `cargo test` 17 passed / 0 failed, and `cargo fmt --check` clean. `npx prettier --check .` fails in 22 files (BUG-003).
- Installer built: `src-tauri/target/release/bundle/nsis/Markdown Preview_0.1.0_x64-setup.exe` (about 3.4 MB), alongside `src-tauri/target/release/markdown-preview.exe` (FileVersion 0.1.0, ProductName "Markdown Preview"). The first cold build's Rust step took 3m59s and a later build through the wrapper took 1m56s for the same step; neither build's total was timed, because cargo reports only its own compile line. Exact byte counts are not quoted because each build regenerates hashed frontend assets.
- PRD release gates 1–6 have **not** been executed against the installed package. Nothing in this file claims they pass.
- `npx tauri build` needs `~/.cargo/bin` on PATH; without it the CLI reports `program not found` for `cargo metadata`. `tools/dev-setup/build.ps1` wraps this so the path is set automatically and the installer location is printed.
- The installer embeds the WebView2 **bootstrapper**, which still reaches the network to fetch the runtime if WebView2 is absent. Windows 10/11 ship it, so an ordinary install is offline; a machine without it is not. PRD gate 6 should be read with that caveat.
- `npm run format:check` fails today (BUG-003); typecheck, lint and all tests pass.

## Known issues / bugs
| ID | Severity | Reproduction / environment | Expected vs actual | Owner | Status | Fix / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| BUG-001 | Low | `npx tauri build` on a shell without `~/.cargo/bin` on PATH | Expected: build runs. Actual: `failed to run 'cargo metadata' … program not found` | Unassigned | Open (workaround delivered and verified) | Worked around by `tools/dev-setup/build.ps1`, verified by running it to completion: it built the bundle and printed the installer path. The row stays open because a plain `npx tauri build` still fails in a shell without cargo on PATH |
| BUG-002 | Low | Derived by reading the effect, never observed in a run: search with an active query, then a refresh that shrinks the match set | Expected: the reported position always matches the painted match. Actual: `activePosition` is derived from the pre-clamp index for one render, because the clamp is applied inside the effect after commit | Unassigned | Open | Needs a reproduction before being called observed. Fix would be to report the position from the same clamped value the effect paints |
| BUG-003 | Low | `npx prettier --check .` in this directory | Expected: `npm run format:check` exits 0, as package.json implies. Actual: it fails, reporting differences in 22 files from the pinned style (`.prettierrc.json`: `printWidth` 100, `singleQuote`) | Unassigned | Open | Config added during implementation; the tree was deliberately not reformatted to it. Run `npx prettier --write .` and re-run typecheck and tests to close. `docs/` is excluded on purpose |

## Open questions before release
- Release gate 1: are both `.md` and `.markdown` actually registered by the built installer, and does a second launch replace the open document rather than silently dropping the path?
- Release gate 3: does search, zoom and keyboard navigation hold at the 480 × 360 minimum window size in the packaged build?
- Release gate 4: do ordinary and atomic saves refresh in the packaged build without resetting the reader to the top?
- Release gate 6: what exactly does "works offline" mean given `embedBootstrapper`: verify on a machine without WebView2, or narrow the claim.
- Installer signing: the NSIS package is unsigned, so SmartScreen is expected to warn on first run (More info → Run anyway). Signing is post-MVP, but the warning is the first thing a new user meets.
- Performance targets (start under 1 s, save response under 500 ms) are unmeasured on the packaged build.

## Change log template
| Date | Change | Reason | Evidence / links | Decision owner |
| --- | --- | --- | --- | --- |
| 2026-09-23 | Initial spec set | Defined MVP and boundaries | PRD.md–TASK.md | Project owner |
| 2026-09-24 | Implementation, tests, icon set and NSIS installer | Deliver the seven MVP features and an installable package | TASK.md evidence key; `INSTALLER` artifact paths above | Project owner |

## Future AI handoff - fill in at the end of each work session
- Branch / commit / build ID: no VCS repository initialised in this directory; build ID is the NSIS installer above, app version 0.1.0.
- Completed TASK.md items and evidence: see `docs/TASK.md`; every checked box names its evidence key (`STATIC`, `FE-TESTS`, `RUST-TESTS`, `INSTALLER`).
- Files modified: `src/` (renderer, styles, features, tests), `src-tauri/src/` (commands, services, state, errors), `src-tauri/{tauri.conf.json,capabilities/default.json,Cargo.toml}`, `src-tauri/icons/`, `tests/`, `vite.config.ts`, `vitest.setup.ts`, `eslint.config.js`, `.prettierrc.json` (new), `.prettierignore` (new), `tools/make-icons.py`, `tools/dev-setup/{build.ps1 (new),install-rust.sh,install-vsbuildtools.ps1}`, `tools/{analysis.txt,controls.txt}`, `docs/{TASK.md,MEMORY.md}`, `index.html`.
- Commands/tests run and exact outcomes: `npx tsc --noEmit` clean; `npx eslint .` clean; `npx vitest run` 9 files / 56 tests passed; `npx vite build` succeeded (largest chunks: `index-*.js` 586 kB, per-language Shiki chunks loaded on demand); `cargo test` 17 passed; `cargo clippy --all-targets -- -D warnings` clean; `cargo fmt --check` clean; `npx prettier --check .` failed in 22 files (BUG-003); the direct `npx tauri build` produced the installer, its release compile step taking 3m59s; `tools/dev-setup/build.ps1` was then run to completion and produced the installer at the same path, so the cargo PATH workaround is verified rather than assumed.
- Behaviour seen in packaged Windows build: **not yet observed.** Only the build itself has been verified; the installer has not been run on a clean machine.
- Current blockers, bugs and reproduction steps: BUG-001 (worked around by `tools/dev-setup/build.ps1`), BUG-002 (theoretical, unverified) and BUG-003 (formatter not applied) above. The blocking gap is the unexecuted release gates, not a known defect.
- Security or scope decisions made; PRD/ARCHITECTURE changes: ADR-008 to ADR-010 and the deviations table above. No PRD or ARCHITECTURE behaviour was widened; the two added watcher events and the preferences plugin are implementation-level deviations recorded here.
- Next smallest unchecked task: install the built `.exe` on a clean Windows machine and execute PRD release gate 1 (double-click `.md` and `.markdown`, then Open With).

**Handoff instruction:** Read PRD.md, ARCHITECTURE.md and RULES.md first, then inspect TASK.md and this file. Verify existing code before changing it. Never assume unchecked release gates passed.
