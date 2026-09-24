/**
 * Syntax highlighting.
 *
 * Shiki is used in its fine-grained form: the JavaScript regular-expression
 * engine (no WebAssembly, so no CSP relaxation) with grammars and themes pulled
 * in by dynamic import, so only the languages a document actually uses are
 * downloaded.
 *
 * Tokens are returned as data and rendered as React elements. Shiki's HTML
 * string output is never used, which keeps `dangerouslySetInnerHTML` out of the
 * codebase entirely.
 */

import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

export type HighlightTheme = 'light' | 'dark';

/** Highlighting is skipped above this size so a huge fence cannot freeze the UI. */
const MAX_HIGHLIGHT_CHARS = 400_000;

const THEME_NAMES: Record<HighlightTheme, string> = {
  light: 'github-light',
  dark: 'github-dark',
};

/**
 * A lazily imported grammar module.
 *
 * Typed as the dynamic-import shape rather than as a resolved registration:
 * Shiki validates the imported module at runtime, so the one place that trusts
 * it is the boundary cast in `ensureLanguage`.
 */
type LanguageLoader = () => Promise<{ default: unknown }>;

/**
 * Grammars are loaded on demand. Aliases resolve to a canonical entry so
 * `sh`, `bash` and `console` share one grammar.
 */
const LANGUAGE_MODULES: Record<string, LanguageLoader> = {
  bash: () => import('shiki/langs/shellscript.mjs'),
  bat: () => import('shiki/langs/bat.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cmake: () => import('shiki/langs/cmake.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  http: () => import('shiki/langs/http.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  nginx: () => import('shiki/langs/nginx.mjs'),
  objectivec: () => import('shiki/langs/objective-c.mjs'),
  perl: () => import('shiki/langs/perl.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  protobuf: () => import('shiki/langs/protobuf.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sass: () => import('shiki/langs/sass.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  terraform: () => import('shiki/langs/terraform.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  zig: () => import('shiki/langs/zig.mjs'),
};

const LANGUAGE_ALIASES: Record<string, string> = {
  'c#': 'csharp',
  'c++': 'cpp',
  adoc: 'markdown',
  asciidoc: 'markdown',
  cjs: 'javascript',
  console: 'bash',
  cs: 'csharp',
  cts: 'typescript',
  docker: 'dockerfile',
  golang: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  hcl: 'terraform',
  js: 'javascript',
  json5: 'jsonc',
  kt: 'kotlin',
  kts: 'kotlin',
  md: 'markdown',
  mdown: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  node: 'javascript',
  objc: 'objectivec',
  'objective-c': 'objectivec',
  patch: 'diff',
  ps1: 'powershell',
  psql: 'sql',
  pwsh: 'powershell',
  py: 'python',
  python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  'shell-session': 'bash',
  shellscript: 'bash',
  tf: 'terraform',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
};

export type HighlightedToken = {
  content: string;
  color?: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
};

export type HighlightedLine = HighlightedToken[];

export type HighlightResult =
  | { status: 'highlighted'; lines: HighlightedLine[] }
  | { status: 'plain' };

let corePromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();

function getCore(): Promise<HighlighterCore> {
  corePromise ??= createHighlighterCore({
    themes: [
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return corePromise;
}

/** Canonical grammar name for a fence label, or null when nothing matches. */
export function canonicalLanguage(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key === '' || key === 'text' || key === 'txt' || key === 'plaintext' || key === 'plain') {
    return null;
  }
  const resolved = LANGUAGE_ALIASES[key] ?? key;
  return resolved in LANGUAGE_MODULES ? resolved : null;
}

async function ensureLanguage(canonical: string): Promise<boolean> {
  if (loadedLanguages.has(canonical)) return true;
  const loader = LANGUAGE_MODULES[canonical];
  if (!loader) return false;

  const core = await getCore();
  const module = await loader();
  // A dynamically imported module is the trust boundary here; Shiki checks the
  // registration's shape itself and rejects anything it cannot use.
  await core.loadLanguage(module.default as Parameters<HighlighterCore['loadLanguage']>[0]);
  loadedLanguages.add(canonical);
  return true;
}

function toToken(token: ThemedToken): HighlightedToken {
  const style = typeof token.fontStyle === 'number' ? token.fontStyle : 0;
  const result: HighlightedToken = {
    content: token.content,
    // `style > 0` guards the FontStyle.NotSet sentinel (-1).
    italic: style > 0 && (style & 1) === 1,
    bold: style > 0 && (style & 2) === 2,
    underline: style > 0 && (style & 4) === 4,
  };
  if (typeof token.color === 'string' && token.color !== '') {
    result.color = token.color;
  }
  return result;
}

/**
 * Highlight a fence.
 *
 * Returns `plain` for unknown languages, empty languages, oversized blocks or
 * any engine rejection, so the caller can always fall back to readable text.
 */
export async function highlightCode(
  code: string,
  language: string,
  theme: HighlightTheme,
): Promise<HighlightResult> {
  if (code.length > MAX_HIGHLIGHT_CHARS) return { status: 'plain' };

  const canonical = canonicalLanguage(language);
  if (canonical === null) return { status: 'plain' };

  try {
    if (!(await ensureLanguage(canonical))) return { status: 'plain' };
    const core = await getCore();
    const result = core.codeToTokens(code, {
      lang: canonical,
      theme: THEME_NAMES[theme],
    });
    return { status: 'highlighted', lines: result.tokens.map((line) => line.map(toToken)) };
  } catch {
    // A grammar that fails to load or tokenise must never break the document.
    return { status: 'plain' };
  }
}
