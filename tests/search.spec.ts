import { describe, expect, it } from 'vitest';

import {
  applyHighlights,
  buildTextIndex,
  clearHighlights,
  findMatches,
  highlightsSupported,
  matchToRanges,
} from '../src/features/search/searchDom';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe('text index', () => {
  it('matches visible text case-insensitively', () => {
    const index = buildTextIndex(mount('<p>The Quick brown fox. quick!</p>'));
    expect(findMatches(index.text, 'quick')).toHaveLength(2);
    expect(findMatches(index.text, 'QUICK')).toHaveLength(2);
  });

  it('reads adjacent inline text as the one run the reader sees', () => {
    // Inline elements carry no line break, so the page shows "helloworld"
    // unbroken and a match for that run is a match the reader can see. This is
    // also what lets a match survive a code line being split into token spans.
    const index = buildTextIndex(mount('<p><strong>hello</strong><em>world</em></p>'));
    // The block boundary contributes a trailing separator, never one inside.
    expect(index.text.trimEnd()).toBe('helloworld');
    expect(findMatches(index.text, 'helloworld')).toHaveLength(1);
  });

  it('never matches across a line boundary', () => {
    // Two paragraphs are two lines on screen, and a single-line search field
    // cannot contain the break, so no query can match across them.
    const index = buildTextIndex(mount('<p>hello</p><p>world</p>'));
    expect(findMatches(index.text, 'helloworld')).toHaveLength(0);
    expect(findMatches(index.text, 'hello')).toHaveLength(1);
    expect(findMatches(index.text, 'world')).toHaveLength(1);
  });

  it('excludes chrome marked as not being document content', () => {
    const index = buildTextIndex(
      mount(
        '<div data-search-exclude="true">copied</div><p>copied</p>',
      ),
    );
    expect(findMatches(index.text, 'copied')).toHaveLength(1);
  });

  it('reports every distinct place, not overlapping starts', () => {
    const index = buildTextIndex(mount('<p>aaaa</p>'));
    expect(findMatches(index.text, 'aa')).toHaveLength(2);
  });

  it('finds nothing for an empty query', () => {
    const index = buildTextIndex(mount('<p>anything</p>'));
    expect(findMatches(index.text, '')).toHaveLength(0);
  });

  it('maps a match back to the exact DOM range', () => {
    const root = mount('<p>alpha beta</p>');
    const index = buildTextIndex(root);
    const [first = { start: 0, end: 0 }] = findMatches(index.text, 'beta');
    const ranges = matchToRanges(index, first);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe('beta');
  });

  it('keeps a match valid when inline nodes are split into many spans', () => {
    // What a code fence looks like before and after highlighting: the same
    // visible text, held by a different number of text nodes. Offsets must be
    // identical in both, or search would jump after a block highlights.
    const plain = mount('<p><code>const value = 1;</code></p>');
    const highlighted = mount(
      '<p><code><span>const </span><span>value</span><span> = 1;</span></code></p>',
    );

    const plainIndex = buildTextIndex(plain);
    const highlightedIndex = buildTextIndex(highlighted);
    expect(highlightedIndex.text).toBe(plainIndex.text);

    const [match = { start: 0, end: 0 }] = findMatches(highlightedIndex.text, 'value');
    const ranges = matchToRanges(highlightedIndex, match);
    expect(ranges.map((range) => range.toString())).toEqual(['value']);
  });
});

describe('highlight painting', () => {
  it('registers the active match separately from the other matches', (): void => {
    expect(highlightsSupported()).toBe(true);

    const root = mount('<p>one two one</p>');
    const index = buildTextIndex(root);
    const rangesPerMatch = findMatches(index.text, 'one').map((match) =>
      matchToRanges(index, match),
    );

    applyHighlights(rangesPerMatch, 1);

    const registry = (globalThis as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights;
    expect(registry.has('k-search-match')).toBe(true);
    expect(registry.has('k-search-active')).toBe(true);

    const active = registry.get('k-search-active') as { ranges: Range[] };
    expect(active.ranges).toHaveLength(1);

    clearHighlights();
    expect(registry.has('k-search-match')).toBe(false);
    expect(registry.has('k-search-active')).toBe(false);
  });
});
