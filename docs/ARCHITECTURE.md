# Markdown Preview — Technical Architecture

**Status:** Proposed implementation blueprint. Lock exact dependency versions when scaffolding and record them in the lockfile.

## Stack and deployment

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Shell/native | Tauri 2 + Rust | Window, launch arguments, native picker/drop events, validated read-only file access, file watching, packaging |
| Frontend | React + strict TypeScript + Vite | Presentation and keyboard interactions |
| Styling | Tailwind CSS + CSS variables | Reading surface and theme tokens |
| Markdown | react-markdown + remark-gfm | CommonMark/GFM component tree; raw HTML disabled |
| Highlighting | Shiki | Lazy grammar/theme loading; escaped token rendering |
| Icons | Lucide React | Accessible toolbar icons |
| Local preferences | Small versioned JSON settings file or Tauri store plugin | Theme, zoom, optional window size; never document contents |
| Backend/API/database/auth/hosting | None | Entire product runs locally; distribution via Windows installer |

Use a Rust bridge rather than exposing generic frontend filesystem and shell operations. Bundle only the capabilities actually invoked. A browser-exposed asset protocol with wide directory globs is a risk: serve relative images through an explicitly validated native read operation and safe object URLs; revoke URLs on document change. Restrict to local image formats you can decode safely, set MIME explicitly, cap individual asset size and total asset count, reject remote URLs and path traversal. Symlink resolution must stay within the opened document's canonical parent directory. If the team chooses a different asset strategy, document and test equivalent boundaries first.

## Proposed repository structure

```text
markdown-preview/
├── PRD.md
├── ARCHITECTURE.md
├── RULES.md
├── DESIGN.md
├── TASK.md
├── MEMORY.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── EmptyState.tsx
│   │   ├── Toolbar.tsx
│   │   ├── DocumentView.tsx
│   │   ├── CodeBlock.tsx
│   │   ├── SearchBar.tsx
│   │   └── Notice.tsx
│   ├── features/
│   │   ├── document/{documentController.ts,documentTypes.ts,links.ts,assets.ts}
│   │   ├── search/{useRenderedSearch.ts,searchDom.ts}
│   │   └── preferences/{usePreferences.ts,preferences.ts}
│   ├── bridge/{native.ts,events.ts}
│   ├── styles/{tokens.css,document.css,app.css}
│   └── test/fixtures/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands/{document.rs,assets.rs}
│       ├── services/{paths.rs,watch.rs,launch.rs,preferences.rs}
│       └── errors.rs
└── tests/{document.spec.ts,search.spec.ts,security.spec.ts}
```

Tree is an implementation proposal, not a claim that files already exist. Keep individual modules small, and reorganise if a simpler implementation passes the same boundaries.

## State and contracts

```ts
type DocumentSnapshot = {
  canonicalPath: string;
  name: string;
  content: string;
  revision: string; // hash or monotonically increasing native revision
  baseDirectory: string;
};
type DocumentState =
  | { status: 'empty' }
  | { status: 'loading'; requestId: number; previous?: DocumentSnapshot }
  | { status: 'ready'; document: DocumentSnapshot; warning?: string }
  | { status: 'error'; message: string; previous?: DocumentSnapshot };
type Preferences = { version: 1; theme: 'light' | 'dark' | 'system'; zoom: number };
```

The native bridge exposes named, read-only IPC commands rather than HTTP endpoints:

| IPC command/event | Input | Result/behaviour |
| --- | --- | --- |
| `open_document` | selected path | Validate extension/type, canonical path, UTF-8 and 10 MiB limit; return snapshot; atomically replace active watch |
| `read_relative_image` | active document revision + relative asset path | Canonicalise under active parent, validate size/MIME; return bounded bytes/transfer handle |
| `reload_document` | active document revision | Return new snapshot only on changed contents; keep last good state on errors |
| `get_pending_launch` | none | Consume queued Explorer launch path after UI listener is ready |
| `document_changed` event | revision/path/sequence | Signal frontend to request reload; never push unvalidated arbitrary file content |
| `document_missing` event | revision/path | Show warning after retry; retain last snapshot |
| `open_external_link` | validated HTTP(S) URL | Open in OS browser via constrained native API |

Validate all command inputs on the Rust side even when UI validates them. The asset command is bound to the current opened document; the frontend cannot use it to enumerate arbitrary directories. A new open increments a generation ID; the UI ignores stale responses and old watch events. Stop old watchers and revoke old image object URLs. On file change, debounce roughly 200 ms, retry transient read failures with a short bounded backoff, compare content hash, then update while retaining a scroll anchor (nearest visible heading/element plus relative offset, with scroll ratio fallback). Watch the parent directory to catch rename-over-original saves; filter events to the target basename and canonical path.

## End-to-end data flow
1. Picker, OS launch or drag event gives a path to Rust; a second-launch event is queued until React can receive it.
2. Rust validates and reads the document, creates a generation-scoped watcher and returns the snapshot.
3. React renders with `react-markdown` and `remark-gfm`. Custom components enforce safe URL policy. Inline HTML is escaped or skipped; never enable `rehype-raw`.
4. Relative image requests go through the bounded native asset command and are rendered using revoked-on-close object URLs; remote images are blocked.
5. Text search indexes rendered DOM text nodes, excluding toolbar and hidden content. Highlight with DOM ranges or safe wrappers; never replace `innerHTML`. Refresh rebuilds the index and preserves the query.
6. The watcher emits a change signal; React reloads only the active generation, keeps last good content on failure and restores the scroll anchor.

## Security decisions
- Permit only `http:` and `https:` external links, plus explicitly handled same-document fragments and local Markdown links. Do not open `file:`, `data:`, `javascript:`, custom protocols or executables from Markdown.
- Resolve local linked Markdown inside the opened document tree, reject directory traversal and symlink escapes. An explicitly selected file may establish a new root; clicking untrusted Markdown may not silently broaden the root.
- Do not permit arbitrary shell execution, generic filesystem plugin read permissions, remote content access or unsafe HTML injection.
- Persist only appearance/zoom/window metadata. No path history or content caching in MVP.
- Prefer a restrictive content security policy and local bundled assets. Audit generated Tauri capabilities and installer associations before release.

## Verification strategy
Unit tests cover path policy, MIME/size restrictions, search navigation and preference validation. Integration tests cover switch-during-load, ordinary/atomic saves and repeated watcher replacement. Package-level Windows tests cover double-click, Open With, second instance, offline rendering and both extensions. Measure cold startup and refresh on a release build with a representative document.

## Official references to consult during implementation
- Tauri v2 [filesystem scope](https://v2.tauri.app/plugin/file-system/), [capabilities](https://v2.tauri.app/learn/security/using-plugin-permissions/) and [configuration](https://v2.tauri.app/reference/config/).
- [react-markdown security guidance](https://github.com/remarkjs/react-markdown#security) and [remark-gfm](https://github.com/remarkjs/remark-gfm).
