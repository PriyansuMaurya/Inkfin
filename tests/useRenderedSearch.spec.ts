/**
 * Reveal behaviour of the search controller.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *  - a deliberate move (typing, Enter, opening another file) must actually show
 *    the reader where the match is;
 *  - re-deriving the index, whether from an automatic refresh, a theme change or
 *    a code block finishing highlighting, must never move the page under them.
 *
 * These are asserted through `scrollIntoView`, which is the only thing the hook
 * does that a reader can see move.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { useRenderedSearch } from '../src/features/search/useRenderedSearch';

/** Roots mounted by this file, so only they are removed afterwards. */
const mounted: HTMLElement[] = [];

function mountDocument(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  mounted.push(root);
  return root;
}

type Signals = { revision: string; documentKey: string };

afterEach(() => {
  // Only this file's own roots are removed. Clearing `document.body` wholesale
  // would detach the container Testing Library is about to unmount.
  for (const root of mounted.splice(0)) root.remove();
});

describe('search reveal', () => {
  let scrollIntoView: MockInstance<Element['scrollIntoView']>;

  beforeEach(() => {
    // Created per test because `restoreMocks` strips spies between them.
    scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
  });

  function mount(html: string, initial: Signals) {
    const root = mountDocument(html);
    const rootRef = { current: root };
    const view = renderHook(
      (signals: Signals) =>
        useRenderedSearch(rootRef, signals.revision, 0, 0, signals.documentKey),
      { initialProps: initial },
    );
    return { root, ...view };
  }

  it('reveals the active match when the reader searches', () => {
    const { result } = mount('<p>alpha beta alpha</p>', {
      revision: 'r1',
      documentKey: 'a.md',
    });

    act(() => result.current.openSearch());
    act(() => result.current.setQuery('alpha'));

    expect(result.current.matchCount).toBe(2);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('does not move the page when the index is merely re-derived', () => {
    const { result, rerender } = mount('<p>alpha beta alpha</p>', {
      revision: 'r1',
      documentKey: 'a.md',
    });

    act(() => result.current.openSearch());
    act(() => result.current.setQuery('alpha'));
    scrollIntoView.mockClear();

    // An automatic refresh: same file, new revision, same visible text.
    rerender({ revision: 'r2', documentKey: 'a.md' });

    expect(result.current.matchCount).toBe(2);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // A deliberate step still reveals.
    act(() => result.current.next());
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('reveals again when a different file is opened', () => {
    const { result, rerender } = mount('<p>alpha beta alpha</p>', {
      revision: 'r1',
      documentKey: 'a.md',
    });

    act(() => result.current.openSearch());
    act(() => result.current.setQuery('alpha'));
    scrollIntoView.mockClear();

    rerender({ revision: 'r2', documentKey: 'b.md' });

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('does not fire a reveal that was requested while nothing matched', () => {
    const { root, result, rerender } = mount('<p>alpha</p>', {
      revision: 'r1',
      documentKey: 'a.md',
    });

    act(() => result.current.openSearch());
    act(() => result.current.setQuery('zzz'));
    expect(result.current.matchCount).toBe(0);
    scrollIntoView.mockClear();

    // The file now happens to contain the query. The reader asked to see
    // matches that did not exist, so a later refresh must not jump them.
    root.innerHTML = '<p>zzz arrived</p>';
    rerender({ revision: 'r2', documentKey: 'a.md' });

    expect(result.current.matchCount).toBe(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not arm a reveal when navigation is pressed with no matches', () => {
    const { root, result, rerender } = mount('<p>alpha</p>', {
      revision: 'r1',
      documentKey: 'a.md',
    });

    act(() => result.current.openSearch());
    act(() => result.current.setQuery('zzz'));
    expect(result.current.matchCount).toBe(0);

    // Enter and Shift+Enter are not disabled while there are no matches, so the
    // navigation has to be the thing that refuses the request.
    act(() => result.current.next());
    act(() => result.current.previous());
    scrollIntoView.mockClear();

    // The refreshed file does contain the query, which is the only way an armed
    // flag could produce a visible jump. Writing to this root is safe only
    // because no React tree renders into it; a fixture owned by a component
    // must be changed through the component instead, or nothing actually moves.
    root.innerHTML = '<p>zzz arrived</p>';
    rerender({ revision: 'r2', documentKey: 'a.md' });

    expect(result.current.matchCount).toBe(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
