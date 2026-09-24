/**
 * Search over rendered document text.
 *
 * Search reads the *rendered* DOM rather than the Markdown source: a reader
 * looks for words they can see, and a match must never be reported for text that
 * is not on screen. Nothing here mutates the document — matches are handed to
 * the CSS Custom Highlight API as ranges, so selections, copy and the rendered
 * tree are all left untouched.
 *
 * Two properties make this robust against re-rendering:
 *
 *  - **The indexed text depends only on what the reader sees.** A line break is
 *    recorded at block boundaries and nowhere else, so inline elements are never
 *    glued together and the index is identical whether a code block is plain or
 *    syntax-highlighted. That matters because `CodeBlock` swaps one text node
 *    for many token spans asynchronously: the *offsets* stay valid while the
 *    nodes holding them change.
 *  - **A match may cover several text nodes.** Since no separator is inserted
 *    between inline nodes, a match can span them, so each match resolves to a
 *    list of ranges rather than exactly one.
 */

/** Marks subtrees that are chrome rather than document content. */
const EXCLUDED_SELECTOR = '[data-search-exclude="true"]';

/**
 * Line separator.
 *
 * A newline cannot be typed into a single-line search field, so a match can
 * never span two blocks. That removes false positives across paragraphs and code
 * lines without removing any match a reader could see on one line.
 */
const SEPARATOR = '\n';

/**
 * Elements that start and end a line of visible text.
 *
 * Deliberately excludes inline elements (`strong`, `em`, `code`, `a`), whose
 * text runs on from its neighbours exactly as it does on screen.
 */
const BOUNDARY_TAGS = new Set([
  'ARTICLE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
]);

type Segment = { node: Text; start: number; end: number };

export type TextIndex = {
  /** Concatenated visible text, used for matching. */
  text: string;
  /** Text nodes in document order, with the offset range each one owns. */
  segments: Segment[];
};

export type Match = { start: number; end: number };

function isBoundary(element: Element): boolean {
  // A rendered code line is a line even though it carries no block tag of its
  // own, which keeps plain and highlighted fences indexable identically.
  if (element.classList.contains('code-line')) return true;
  return BOUNDARY_TAGS.has(element.tagName);
}

/** Build a searchable index of the visible text under `root`. */
export function buildTextIndex(root: HTMLElement): TextIndex {
  const segments: Segment[] = [];
  let text = '';

  const push = (node: Text, value: string) => {
    const start = text.length;
    text += value;
    segments.push({ node, start, end: text.length });
  };

  const breakLine = () => {
    // Collapse runs of boundaries so nesting never produces blank lines.
    if (text !== '' && !text.endsWith(SEPARATOR)) text += SEPARATOR;
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue;
      if (value === null || value.trim() === '') return;
      push(node as Text, value);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    if (element.matches(EXCLUDED_SELECTOR)) return;

    const boundary = isBoundary(element);
    if (boundary) breakLine();

    for (const child of Array.from(element.childNodes)) {
      walk(child);
    }

    if (boundary) breakLine();
  };

  walk(root);

  return { text, segments };
}

/**
 * Every non-overlapping, case-insensitive occurrence of `query`.
 *
 * Non-overlapping matches follow what readers expect from a find bar: the count
 * reflects distinct places, not every offset a query could start at.
 */
export function findMatches(text: string, query: string): Match[] {
  const needle = query.toLowerCase();
  if (needle === '') return [];

  const haystack = text.toLowerCase();
  const matches: Match[] = [];
  let from = 0;

  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    matches.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }

  return matches;
}

/**
 * Turn an index offset range into the DOM ranges that cover it.
 *
 * A match inside one text node yields one range; a match spanning inline
 * elements yields one range per node it covers. Segments that no longer match
 * the index contribute nothing rather than throwing.
 */
export function matchToRanges(index: TextIndex, match: Match): Range[] {
  const ranges: Range[] = [];

  for (const segment of index.segments) {
    const start = Math.max(match.start, segment.start);
    const end = Math.min(match.end, segment.end);
    if (start >= end) continue;

    const range = document.createRange();
    range.setStart(segment.node, start - segment.start);
    range.setEnd(segment.node, end - segment.start);
    ranges.push(range);
  }

  return ranges;
}

const MATCH_HIGHLIGHT = 'k-search-match';
const ACTIVE_HIGHLIGHT = 'k-search-active';

type HighlightRegistryLike = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

type HighlightCtor = new (...ranges: AbstractRange[]) => unknown;

function registry(): HighlightRegistryLike | null {
  const css = (globalThis as { CSS?: { highlights?: unknown } }).CSS;
  const candidate = css?.highlights as HighlightRegistryLike | undefined;
  return candidate && typeof candidate.set === 'function' ? candidate : null;
}

function highlightCtor(): HighlightCtor | null {
  const candidate = (globalThis as { Highlight?: unknown }).Highlight;
  return typeof candidate === 'function' ? (candidate as HighlightCtor) : null;
}

/** Whether this webview can paint search highlights at all. */
export function highlightsSupported(): boolean {
  return registry() !== null && highlightCtor() !== null;
}

/** Remove every search highlight. Safe to call repeatedly. */
export function clearHighlights(): void {
  const active = registry();
  if (!active) return;
  active.delete(MATCH_HIGHLIGHT);
  active.delete(ACTIVE_HIGHLIGHT);
}

/**
 * Paint all matches, with the active one on its own higher-priority highlight so
 * it is visually distinct from the rest.
 *
 * @param rangesPerMatch One entry per match; each entry is the ranges that match
 *   covers. The active match is excluded from the base highlight so the two
 *   never overlap.
 */
export function applyHighlights(rangesPerMatch: readonly (readonly Range[])[], activeIndex: number): void {
  const active = registry();
  const Highlight = highlightCtor();
  if (!active || !Highlight) return;

  const others = rangesPerMatch.filter((_, index) => index !== activeIndex).flat();
  if (others.length > 0) {
    active.set(MATCH_HIGHLIGHT, new Highlight(...others));
  } else {
    active.delete(MATCH_HIGHLIGHT);
  }

  const current = rangesPerMatch[activeIndex];
  if (current && current.length > 0) {
    active.set(ACTIVE_HIGHLIGHT, new Highlight(...current));
  } else {
    active.delete(ACTIVE_HIGHLIGHT);
  }
}

/** Bring a match into view without touching focus or selection. */
export function scrollRangeIntoView(range: Range): void {
  const container = range.startContainer;
  const element =
    container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  element?.scrollIntoView({ block: 'center', behavior: 'auto' });
}
