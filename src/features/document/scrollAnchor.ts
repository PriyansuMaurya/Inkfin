/**
 * Reading-position preservation across an automatic refresh.
 *
 * An editor save replaces the whole rendered tree, which would otherwise throw
 * the reader back to the top. Instead the nearest visible top-level block and
 * the fraction of it already scrolled past are captured before the refresh and
 * restored afterwards.
 *
 * A block-relative anchor is preferred over a raw pixel offset because head
 * text above it can grow or shrink between saves. When no block can be located
 * (for example the document became much shorter), a scroll ratio is used so the
 * reader still lands somewhere sensible rather than at the top.
 */

export type ScrollAnchor =
  | { kind: 'block'; path: number[]; fraction: number }
  | { kind: 'ratio'; ratio: number };

/** What the reading surface should do with the scroll position. */
export type ScrollPlan = 'keep' | 'restore' | 'top';

/**
 * Decide where the reader should be after the rendered document changed.
 *
 * A different file is a different place to be, so it starts at the top; the
 * previous document's position is meaningless there. The same file at a new
 * revision is an in-place refresh, so the reader is put back where they were.
 * Anything else leaves the position alone, so a re-render for a theme change or
 * a code block finishing highlighting never moves the page.
 */
export function planScroll(
  previous: { documentKey: string; revision: string } | null,
  current: { documentKey: string; revision: string },
): ScrollPlan {
  if (!previous) return 'top';
  if (previous.documentKey !== current.documentKey) return 'top';
  if (previous.revision !== current.revision) return 'restore';
  return 'keep';
}

/** Smallest gap, in pixels, that counts as "this block is on screen". */
const VISIBLE_MARGIN = 4;

function childPath(root: Element, element: Element): number[] {
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return path;
}

function resolvePath(root: Element, path: readonly number[]): HTMLElement | null {
  let current: Element = root;
  for (const index of path) {
    const child = current.children.item(index);
    if (!child) return null;
    current = child;
  }
  return current === root ? null : (current as HTMLElement);
}

/**
 * Capture where the reader is looking.
 *
 * `scroller` is the element with the scrollbar; `root` is the document body
 * whose direct children are the candidate blocks.
 */
export function captureScrollAnchor(scroller: HTMLElement, root: HTMLElement): ScrollAnchor {
  const viewportTop = scroller.getBoundingClientRect().top;
  const scrollable = scroller.scrollHeight - scroller.clientHeight;
  const ratio = scrollable > 0 ? scroller.scrollTop / scrollable : 0;

  for (const child of Array.from(root.children)) {
    const rect = child.getBoundingClientRect();
    if (rect.bottom > viewportTop + VISIBLE_MARGIN) {
      const fraction =
        rect.height > 0 ? clamp01((viewportTop - rect.top) / rect.height) : 0;
      return { kind: 'block', path: childPath(root, child), fraction };
    }
  }

  return { kind: 'ratio', ratio: clamp01(ratio) };
}

/** Put the reader back where they were, as closely as the new content allows. */
export function restoreScrollAnchor(scroller: HTMLElement, root: HTMLElement, anchor: ScrollAnchor): void {
  if (anchor.kind === 'ratio') {
    const scrollable = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = scrollable > 0 ? anchor.ratio * scrollable : 0;
    return;
  }

  const element = resolvePath(root, anchor.path);
  if (!element) {
    // The block no longer exists: fall back to the top rather than guessing.
    scroller.scrollTop = 0;
    return;
  }

  const viewportTop = scroller.getBoundingClientRect().top;
  const rect = element.getBoundingClientRect();
  const wantedTop = viewportTop - anchor.fraction * rect.height;
  scroller.scrollTop += rect.top - wantedTop;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
