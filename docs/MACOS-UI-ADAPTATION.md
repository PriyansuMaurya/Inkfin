# macOS interface adaptation

**Status:** source changes measured in the shared renderer; **no macOS build exists**, so nothing
here has been seen in WKWebView. The captures in `docs/screenshots/` are Chromium on Windows — see
§5 for what they can and cannot show, and §6 for the checks that must run on a Mac.

Scope: the window shell only — toolbar, theme popover, base tokens, code-block header. The seven
core features (open, render GFM, highlight, themes, search, zoom, live refresh) and the
one-document-per-window model are untouched: no screen was rebuilt, no component removed and no
colour, size or spacing token was redefined.

## 1. What was inspected

The shipped interface, not the older spec:

- `src/styles/tokens.css` is the live palette: violet brand (`--k-primary: #6750d8`), the manta
  gradient CTA, `--k-*` semantic tokens, Inter/`Segoe UI` stacks.
- `docs/DESIGN.md` describes a **different** system — blue `#2563EB`, `Segoe UI…` UI stack, no
  gradient. It is treated here as the earlier concept, not as the target: rebuilding to it would
  repaint the product. Only facts it still owns (52 px toolbar, 28 px status, 760 px column,
  480×360 minimum, 36 px toolbar targets, focus ring 2 px + 2 px offset, 40/20 px document
  padding) were used as checks, and all of them hold in the shipped build (§4).
- Window chrome is native: `decorations: true`, no `data-tauri-drag-region` anywhere, no custom
  title bar component. The only chrome React draws is the toolbar row and the status strip.

## 2. Decisions and changes

| Area | Finding | Change |
| --- | --- | --- |
| Traffic lights / title bar | The OS draws and positions the traffic lights in the native title bar above the 52 px toolbar; there is no custom title bar to inset | **none** — nothing to align, and nothing to add for dragging either |
| Native title vs toolbar filename | macOS shows `Platform Notes.md - Inkfin` in the title bar while the toolbar repeats the name and folder | **none** — deliberately the same as Windows today; removing one would lose information on both platforms |
| Menu bar | Tauri builds the standard macOS menu by default (`Builder::enable_macos_default_menu` defaults to true; `tauri-2.11.6/src/app.rs:2244`, `src/menu/menu.rs:142`): app menu (About/Services/Hide/Hide Others/Quit), **File → Close Window**, **Edit → Undo/Redo/Cut/Copy/Paste/Select All**, View → Enter Full Screen, Window → Minimize/Zoom/Close, Help | **none** — ⌘C/⌘V/⌘A in the search field and the document come from that menu. The app's own shortcuts (⌘O ⌘F ⌘R ⌘± ⌘0) are webview handlers and do not collide with it. A **File → Open** menu item is *not* part of this change (§7) |
| Keyboard labels | Already platform-aware: `formatShortcut` returns `⌘O` on macOS and `Ctrl+O` on Windows, used by every toolbar tooltip | **none** — verified empirically, not just by unit test (§4) |
| Font stacks | Windows-first: `'Segoe UI Variable Text', 'Segoe UI', …`; the document stack starts with `Inter`, which is not bundled anywhere | **new**: `[data-platform='macos']` sets UI and document text to the SF Pro stack (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', …`) and code to `'SF Mono', ui-monospace, Menlo, …` first |
| Font rendering | `-webkit-font-smoothing: antialiased` is in the base stylesheet and takes effect on macOS | **none**; the property is a macOS-facing declaration and the palette is light-on-dark in the dark theme, so the decision is left to the Mac check M5 rather than guessed at here |
| Scrollbars | Custom 10 px `::-webkit-scrollbar` plus `scrollbar-width: thin` on `*` | **new**: scoped to `html:not([data-platform='macos'])`. macOS keeps its native overlay scrollbars, which take no layout width — the custom track would add a permanent 10 px gutter and inset the reading column. Measured effect at 900 px: the 760 px column starts at x=65 with the Windows rule and x=62 without (§4) |
| Focus rings | 2 px primary outline, 2 px offset, `:focus-visible` on every control | **none**. The code **Copy** button was suspected of clipping its ring inside the clipped code header; measured clearance is 5 px at 100 % zoom and exactly 4 px at the 75 % floor — the ring's own size — so an inset-ring override was written, measured and then removed as unnecessary |
| Code Copy target | 26 px tall, below the macOS minimum target | **new**: 28 px (with `min-width`), i.e. Apple's smallest comfortable target; header clearance and ring re-measured afterwards |
| Theme popover keyboard | Opened without moving focus, kept focus on removed elements, no arrow keys, no focus return | **new**: opens focused on the current choice, Arrow/Home/End move between the three options, Space/Enter select, Escape and Tab close and return focus to the trigger |
| Search, zoom, drag | Search bar, three zoom buttons with labels plus ⌘±/⌘0, drop overlay | **none** — all already reachable by mouse and keyboard at 36 px targets; drag is pointer-only by nature and the Open button is its keyboard equivalent |
| Narrow widths | Two breakpoints (640, 520) drop labels and dividers; min window 480×360 | **none** — measured at the floor with every control still inside the viewport (§4) |

Files changed for this pass: [platform.ts](../src/features/platform/platform.ts) (publishes the host
on `<html>`), [main.tsx](../src/main.tsx) (calls it before the first paint),
[tokens.css](../src/styles/tokens.css) (macOS fonts, scrollbar scoping),
[document.css](../src/styles/document.css) (Copy target),
[ThemeMenu.tsx](../src/components/ThemeMenu.tsx) (keyboard), plus
[themeMenu.spec.tsx](../tests/themeMenu.spec.tsx) and two cases in
[platform.spec.ts](../tests/platform.spec.ts).

## 3. How the platform reaches CSS

`applyPlatform()` writes `data-platform` to `<html>` before `createRoot` renders, next to the
existing `data-theme`. CSS keys off the attribute, so no component reads `navigator` during render
and the stylesheet stays declarative. Verified computed values on the same page, flipping only the
attribute:

| | `platform=windows` | `platform=macos` |
| --- | --- | --- |
| Toolbar `font-family` | `"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, …` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, …` |
| Reader `scrollbar-width` | `thin` | `auto` |
| 760 px column x-position at 900 px | 65 | 62 |

## 4. Measurements (Chromium, Windows host)

Taken from the running renderer with `getBoundingClientRect` and `getComputedStyle`.

| Check | 900 × 650 | 480 × 360 (documented minimum) |
| --- | --- | --- |
| Toolbar height (separator drawn inside) | 52 px | 52 px |
| Status strip height | 28 px | 28 px |
| Toolbar overflow (`scrollWidth` vs `clientWidth`) | equal | equal |
| Toolbar controls outside the viewport | 0 | 0 |
| Label / folder-path / divider visibility | labels shown | labels, folder path and both dividers hidden |
| Reading column | 760 px wide, 40 px inline padding | 469 px wide, 20 px inline padding |
| Page-level horizontal overflow | none | none |
| Search bar | present below the toolbar, 52 px band (y 52→103) | same, measured in the narrow capture |
| Code Copy button | 36 × 36 toolbar peers, Copy 100 × 28 | Copy 28 px tall, inside its header |
| Copy button clearance for the focus ring | 5 px (4 px at 75 % zoom, 14 px at 200 %) | — |

Keyboard audit with real Tab presses (page focused first), recording each focused element:

```
Open → Reload from disk → Find in document → Zoom out → Document zoom (%) → Theme: Light
     → table link → documentation link → Copy ts code → code text
```

Every entry matched `:focus-visible` with `2px solid rgb(103, 80, 216)` at `outline-offset: 2px` —
the design's ring, on both the toolbar and the document.

Keyboard labels were checked by making the page report a macOS user agent, then re-rendering
through a real interaction: the toolbar tooltips changed from `Open a Markdown file (Ctrl+O)` /
`Reload from disk (Ctrl+R)` to `(⌘O)` / `(⌘R)`. `detectPlatform()` reported `macos` and
`formatShortcut('O')` returned `⌘O` in the same run.

## 5. Captures

`docs/screenshots/`, produced by headless Chromium at the given window size with the fixture
described below. **These are not macOS captures**: same renderer, different engine and OS.

| File | Shows |
| --- | --- |
| [chromium-windows-900x650-light.png](screenshots/chromium-windows-900x650-light.png) | Normal width, light theme, full document |
| [chromium-windows-480x360-light.png](screenshots/chromium-windows-480x360-light.png) | Minimum window: labels dropped, all controls present |
| [chromium-windows-480x360-search.png](screenshots/chromium-windows-480x360-search.png) | Minimum window with the find bar open below the toolbar |
| [chromium-windows-900x650-dark.png](screenshots/chromium-windows-900x650-dark.png) | Dark theme |
| [chromium-macos-attr-900x650-light.png](screenshots/chromium-macos-attr-900x650-light.png) | Same page with `data-platform="macos"` forced: the macOS font stack and no custom scrollbar gutter (the actual SF Pro faces cannot appear on Windows) |

Recipe, so it can be repeated or replaced with real Mac captures: serve `npm run dev`, add a
temporary `public/__preview-fixture.js` that defines `window.__TAURI_INTERNALS__` (`invoke` returning
a document snapshot for `open_document`, a `{sequence, path}` for the first `get_pending_launch`,
`[{version: 1, theme, zoom}, true]` for `plugin:store|get`, plus `metadata` and a
`__TAURI_EVENT_PLUGIN_INTERNALS__` stub), reference it from `index.html`, then screenshot with
`chrome --headless=new --window-size=W,H`. The document arrives through the real cold-start path
(the queued launch), so the captures exercise the production code, not a mock screen. The fixture and
the `index.html` line were removed afterwards; neither is in the tree.

## 6. Checks that need a Mac

| # | Check | Look for |
| --- | --- | --- |
| M1 | Launch, then drag the window by its title bar | Traffic lights sit in the native title bar above the toolbar with no overlap; the toolbar is not offset, and nothing in it is draggable-but-dead |
| M2 | Open a document | Title bar reads `file.md - Inkfin` while the toolbar shows the same name and folder — duplicated on purpose, matching Windows |
| M3 | Open the menu bar; press ⌘C/⌘V in the search field and select text in the document and copy it | App / File (Close Window) / Edit (Undo, Redo, Cut, Copy, Paste, Select All) / View (Enter Full Screen) / Window / Help, all functional |
| M4 | ⌘O, ⌘F, ⌘R, ⌘+, ⌘-, ⌘0; then the same with Ctrl | ⌘ works; Ctrl does nothing (Ctrl+F must not open the find bar) |
| M5 | Read a document in both themes, then compare against the Windows build | UI and document text render in SF Pro, not a fallback serif; check whether `-webkit-font-smoothing: antialiased` makes text thinner than the Windows build would suggest, and whether the light theme still reads as the same weight |
| M6 | Scroll a long document; watch the scrollbar | Overlay scrollbar appears on scroll and fades, no permanent 10 px gutter, and the 760 px column stays centred in the full window width |
| M7 | Tab through: toolbar, search field, theme items, document links, code Copy | 2 px violet ring with 2 px offset on every one, none clipped by the code header or the code block's rounded clip |
| M8 | Resize to 480×360 and to 900×650 | All toolbar controls remain visible and usable; the find bar fits with its count and three buttons; the status strip keeps the zoom value |
| M9 | Zoom to 75 % and 200 % | Nothing clipped; the code Copy button keeps its 28 px target and a visible ring; toolbar typography is unaffected by zoom |
| M10 | Drag a file over the window | Drop overlay in both themes; Escape and the Open button still work while it is up |
| M11 | Open the theme popover, use Arrow/Home/End/Space/Escape/Tab | Focus lands on the current choice, moves between options, applies with Space, and returns to the trigger on Escape and Tab |
| M12 | Switch the system appearance with the theme set to System; enable Reduce Motion | Theme follows live; transitions are off under Reduce Motion |

## 7. Not done / limits

- No macOS build exists: every visual claim about WKWebView is untested. The captures are Chromium
  on Windows and the `macos` capture only proves the CSS branch is applied, not how SF Pro renders.
- No **File → Open** menu item was added; ⌘O is still the webview handler. That is the natural next
  shell change for a Mac build.
- `docs/DESIGN.md` still describes the older blue palette and Segoe stack. It is now misleading as a
  reference for either platform; reconciling or archiving it is a separate decision.
- Nothing in the document, search, highlight, preference or link modules was touched, so their
  macOS behaviour remains covered by the port analysis and the Finder checks rather than here.
- `src/styles/document.css` still fails `prettier --check` (pre-existing double-quoted attribute
  selectors, unchanged by this pass); `tokens.css` and `app.css` are clean, so the macOS rules added
  here are formatted.
