/**
 * Link policy for rendered Markdown.
 *
 * Markdown is untrusted, so every destination is classified before anything is
 * done with it. Three outcomes are possible and each has a distinct behaviour:
 *  - `external`: a validated `http:`/`https:` URL, handed to the OS browser.
 *  - `markdown`: a relative `.md`/`.markdown` path inside the document folder.
 *  - `fragment`: a `#anchor` that scrolls within the document already on screen.
 *  - `blocked`: anything else, including `javascript:`, `data:`, `file:`,
 *    absolute and traversal paths, executables and mail clients.
 */

export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'markdown'; path: string; fragment?: string }
  | { kind: 'fragment'; id: string }
  | { kind: 'blocked'; reason: string };

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape sequence is not a reason to change the destination;
    // keep the literal text so the classifier can still reject it.
    return value;
  }
}

/** Classify the `href` of a rendered link. */
export function classifyLink(href: string | undefined): LinkTarget {
  const raw = (href ?? '').trim();
  if (raw === '') {
    return { kind: 'blocked', reason: 'the link has no destination' };
  }

  // A bare fragment scrolls inside the current document.
  if (raw.startsWith('#')) {
    const id = decode(raw.slice(1)).trim();
    return id === '' ? { kind: 'blocked', reason: 'the anchor is empty' } : { kind: 'fragment', id };
  }

  // Protocol-relative links resolve to an external host but hide their scheme.
  if (raw.startsWith('//')) {
    return { kind: 'blocked', reason: 'protocol-relative links are not opened' };
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme) {
    const name = (scheme[1] ?? '').toLowerCase();
    if (name !== 'http' && name !== 'https') {
      return { kind: 'blocked', reason: `${name}: links are not opened` };
    }
    try {
      const parsed = new URL(raw);
      if (parsed.hostname === '') {
        return { kind: 'blocked', reason: 'the web address has no host name' };
      }
      return { kind: 'external', url: parsed.href };
    } catch {
      return { kind: 'blocked', reason: 'the web address could not be read' };
    }
  }

  // Everything left is a relative reference. Windows drive paths and absolute
  // paths are refused even though they look relative to a browser.
  if (raw.startsWith('/') || raw.startsWith('\\')) {
    return { kind: 'blocked', reason: 'absolute paths are not opened' };
  }
  if (/^[a-z]:/i.test(raw) || raw.includes(':')) {
    return { kind: 'blocked', reason: 'absolute paths are not opened' };
  }

  const [pathPart = '', fragmentPart] = splitOnce(decode(raw), '#');
  const path = pathPart.replace(/\\/g, '/').trim();

  if (path === '') {
    return { kind: 'blocked', reason: 'the link has no destination' };
  }
  if (path.split('/').some((segment) => segment === '..')) {
    return { kind: 'blocked', reason: 'the link tries to leave the document folder' };
  }

  const lowered = path.toLowerCase();
  const isMarkdown = MARKDOWN_EXTENSIONS.some((extension) => lowered.endsWith(extension));
  if (!isMarkdown) {
    // Only Markdown documents may replace the document on screen. Anything else
    // would need a native handler, which the MVP deliberately does not expose.
    return { kind: 'blocked', reason: 'only Markdown links open inside the reader' };
  }

  return fragmentPart === undefined
    ? { kind: 'markdown', path }
    : { kind: 'markdown', path, fragment: decode(fragmentPart) };
}

function splitOnce(value: string, separator: string): [string, string?] {
  const index = value.indexOf(separator);
  if (index === -1) return [value];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

/**
 * URL transform handed to react-markdown.
 *
 * This is defence in depth: the renderer classifies destinations anyway, but
 * keeping a disallowed scheme out of the attribute means it can never reach the
 * DOM even if a future component forgets to classify.
 */
export function safeUrlTransform(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!scheme) {
    // Relative and fragment references keep their value; the renderer decides
    // whether they are usable.
    return trimmed;
  }
  const name = (scheme[1] ?? '').toLowerCase();
  return name === 'http' || name === 'https' ? trimmed : '';
}

/**
 * Turn heading text into the anchor id GitHub produces, so `[x](#some-heading)`
 * links resolve against rendered headings.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}
