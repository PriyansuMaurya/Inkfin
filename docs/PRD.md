# Markdown Preview — Product Requirements Document

**Status:** Proposed MVP specification · **Platform:** Windows desktop first · **Date:** 23 September 2026

## Executive summary
Markdown Preview is a small, local desktop viewer for opening a single `.md` or `.markdown` file and reading it as a polished document. The primary workflow is double-click, read, close. It also works as a live preview beside an editor: when another application saves the file, the rendered view updates. No editing, account, network connection, document library or workspace is required.

## Problem and audience
Raw Markdown is hard to scan in a text editor; opening a repository or web service just to read one file adds friction. The initial audience is Windows users who frequently inspect READMEs, technical notes, instructions and generated Markdown files. Success depends on reliably opening local files, displaying common Markdown, and retaining a simple native-feeling reading surface.

## MVP user stories and acceptance criteria

| ID | User story | Acceptance criteria |
| --- | --- | --- |
| F1 Open | As a reader, I can open one local Markdown file with Open, drag and drop, Explorer Open With or a configured file association. | `.md` and `.markdown` work; another file replaces the document; multiple dropped files show a notice and open the first valid one; unreadable/oversized files show a recoverable error; no content is written to disk. |
| F2 Render | As a reader, I can read GitHub Flavoured Markdown as a document. | Headings, lists, task boxes, tables, links, blockquotes, images, inline and fenced code, strikethrough and footnotes render; relative images use the document directory; unsupported/unsafe resource URLs are blocked; raw HTML is never executed. |
| F3 Code | As a reader, I can inspect and copy fenced code. | Known languages highlight in both themes; unknown languages display plain text; copy copies exact code; code blocks scroll horizontally inside their own area. |
| F4 Themes | As a reader, I can choose Light, Dark or System. | Choice persists locally; System tracks OS changes without restart; text, focus rings and code tokens remain legible. |
| F5 Search | As a reader, I can find words displayed in the document. | Ctrl+F focuses search; visible rendered text is matched case-insensitively; count and active result are shown; Enter/Shift+Enter navigate; Escape closes; search remains after refresh and never changes source content. |
| F6 Zoom | As a reader, I can resize the document. | Buttons and shortcuts change only document content from 75% to 200%; Ctrl+0 resets to 100%; setting persists; narrow windows do not develop page-wide horizontal overflow. |
| F7 Refresh | As a reader, I see external edits automatically. | Refresh reacts to ordinary and atomic saves; coalesces rapid events; preserves approximate reading position and search query; unchanged content does not rerender; deleted file retains last good preview with a warning. |

## Product behaviour
- Default window: approximately 900 × 650 px; minimum: 480 × 360 px. Center the document in a reading column capped at 760 px. Native window chrome is preferred.
- Empty state: concise prompt, Open file button, drop target. Reading state: filename and compact controls above the document, zoom status below. No persistent sidebar.
- Primary keys: Ctrl+O open; Ctrl+F find; Ctrl++/Ctrl+- zoom; Ctrl+0 reset; Ctrl+R reload; Escape dismiss search or notice. Follow standard platform focus behaviour.
- External HTTP(S) links open in the default browser after explicit scheme validation. Local `.md`/`.markdown` links may replace the current document after validation; fragment anchors scroll within the current document. Other local link targets are not executed.
- Empty files show a quiet empty-document message. Missing images show alt text and a subtle indicator. Failed refresh leaves the last readable document on screen.

## Non-functional requirements
- **Privacy:** Read and render locally. No analytics, uploads, network fetches, accounts or telemetry in the MVP. Remote images are blocked in the MVP to make that promise concrete.
- **Security:** Treat Markdown and path input as untrusted. No raw HTML plugin, injected HTML, `javascript:`, arbitrary shell commands or broad filesystem access in the webview. Read-only Rust commands validate and canonicalise access.
- **Accessibility:** Operable by keyboard; labelled controls; visible focus; accessible search feedback; respect reduced motion; WCAG AA contrast as a design target.
- **Performance targets:** Start in under 1 s on a typical modern Windows PC; respond to a completed save in under 500 ms for ordinary files. These are targets to measure on packaged builds, not guarantees. Reject documents over 10 MiB before loading; avoid UI freezes and profile realistic long files.
- **Reliability:** Handles ordinary saves, temp-file rename saves, missing files, invalid UTF-8 and rapid file switching. Neither open nor refresh ever writes to the document.
- **Packaging:** Windows installer with both extensions registered; verify launch cold and while an instance is running on a clean Windows environment.

## Explicit exclusions
Editing, source view, tabs, folder browsing, recent documents, PDF/print, outline, Mermaid, LaTeX, raw HTML, remote file opening, cloud sync, auth and AI are post-MVP or unplanned. Single-window handling of a second launch needs an explicit integration test; it must not silently discard the requested path.

## Release gates
1. A clean Windows install opens `.md` and `.markdown` by double-click and Open With.
2. A fixture README exercises all supported elements, local images, links, missing assets and long code in both themes.
3. Search, zoom and keyboard navigation work at the minimum window size.
4. Ordinary and atomic saves refresh without resetting the reader to the top.
5. Malicious links, HTML, symlink escapes and denied paths do not run code or expose arbitrary files.
6. The packaged build works offline and does not alter the source file.

## Post-MVP candidates
Optional outline, print/PDF, platform ports, signed release/update channel and richer syntax/diagram support. Validate demand before committing scope.
