/**
 * Reading-position tests.
 *
 * The important property is that an automatic refresh puts the reader back
 * where they were, while opening a different file starts at the top. The plan is
 * asserted directly rather than through the DOM because jsdom performs no
 * layout, so a scroll assertion there would pass vacuously.
 */

import { describe, expect, it } from 'vitest';

import { planScroll } from '../src/features/document/scrollAnchor';

describe('reading position plan', () => {
  it('starts at the top for the first paint', () => {
    expect(planScroll(null, { documentKey: 'a.md', revision: 'r1' })).toBe('top');
  });

  it('starts at the top when a different file is opened', () => {
    // The anchor was captured from another document and means nothing here.
    expect(planScroll({ documentKey: 'a.md', revision: 'r1' }, { documentKey: 'b.md', revision: 'r2' })).toBe(
      'top',
    );
  });

  it('restores the position for an automatic refresh of the same file', () => {
    expect(planScroll({ documentKey: 'a.md', revision: 'r1' }, { documentKey: 'a.md', revision: 'r2' })).toBe(
      'restore',
    );
  });

  it('leaves the position alone when nothing about the document changed', () => {
    // Re-rendering for a theme change or search must never move the page.
    expect(planScroll({ documentKey: 'a.md', revision: 'r1' }, { documentKey: 'a.md', revision: 'r1' })).toBe(
      'keep',
    );
  });
});
