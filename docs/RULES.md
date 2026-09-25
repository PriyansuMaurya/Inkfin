# Markdown Preview - AI and Coding Rules

These rules apply to human and AI contributions. Read PRD.md and ARCHITECTURE.md before changing behaviour; use TASK.md for current work and update MEMORY.md after material decisions. The seven MVP features and explicit exclusions are the source of truth.

## Scope and change control
1. Implement only the smallest task that satisfies its acceptance criteria. Do not add an editor, account, remote fetch, tabs, AI, telemetry or a backend without changing the PRD first.
2. Every feature change states its user-visible effect, relevant threat boundary and verification. Do not claim a Windows installer works until tested on Windows.
3. Keep generated content out of source control except needed lockfiles/assets. Never invent benchmark results or call untested behaviour complete.

## TypeScript, React and Rust
- TypeScript `strict` is mandatory. Avoid `any`, non-null assertions and unchecked casts; parse untrusted IPC values explicitly. Use discriminated unions for document states and typed error results.
- Functional React components and hooks only. Keep rendering pure; isolate native side effects in services/hooks. Give event listeners, observers, object URLs and watchers reliable cleanup.
- Name components `PascalCase.tsx`, hooks `useThing.ts`, utilities `camelCase.ts`, CSS tokens `--kebab-case`, Rust modules/functions `snake_case`, Rust types `PascalCase` and constants `SCREAMING_SNAKE_CASE`.
- Use named exports except entry points where a framework requires otherwise. Run formatter, linter, type check and Rust fmt/clippy before completing a milestone.
- Keep dependency versions pinned through lockfiles. Explain new dependencies and avoid redundant libraries.

## Security rules
- Treat every Markdown file and asset reference as untrusted input. Never use `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `rehype-raw` or Markdown-controlled scripts.
- Validate URL schemes before calling a native opener. No shell command built from a Markdown link or path. No generic frontend filesystem permission merely for convenience.
- Canonicalise every file path on the Rust side. Validate extension, regular-file type, size and UTF-8. For linked files/assets, require containment beneath the active root after resolving symlinks. Handle Windows case/drive/UNC semantics with path APIs, not string-prefix checks.
- Restrict image type and size, block remote image fetches and release temporary object URLs. Do not log document contents or full sensitive paths into production telemetry.
- Native IPC must reject stale generation IDs and paths not authorised by the active document. A missing/failed file read cannot erase the last valid preview.

## Interaction and quality
- All icon-only actions need a label, tooltip where useful, visible focus and keyboard support. Escape closes the topmost temporary control. Do not steal typing focus during automatic refresh.
- Keep toolbar and document zoom independent. Avoid page-wide horizontal scroll, including for wide tables and code.
- Search rendered visible text, not source Markdown; do not mutate content, corrupt selections or expose hidden URL targets. Search index must update after refresh.
- File watcher coalesces duplicate events, retries atomic saves and ignores signals from old documents. Protect async operations with generation IDs.
- Error messages are actionable: invalid format, oversized file, denied read, invalid UTF-8, missing file or blocked asset. Never dump raw stack traces into the UI.

## Tests and completion
- Test behaviour with representative GFM, malicious HTML/link fixtures, nested relative images, symlink escape, invalid UTF-8, 10 MiB boundary, rapid file switch and atomic save.
- Test UI keyboard search, zoom boundaries, system theme updates and minimum window width. Test installer integration on Windows separately.
- A task is done when code passes relevant checks, acceptance criteria are observed, TASK.md is checked off with evidence and MEMORY.md records important deviations or unresolved bugs.
