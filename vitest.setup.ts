import '@testing-library/jest-dom/vitest';

/**
 * jsdom implements neither the CSS Custom Highlight API nor `Range`-based
 * highlight registration, both of which search relies on. The stubs below keep
 * the registry observable so tests can assert what was highlighted without
 * pretending to render it.
 */
class HighlightRegistryStub {
  readonly registry = new Map<string, unknown>();

  set(name: string, highlight: unknown): void {
    this.registry.set(name, highlight);
  }

  get(name: string): unknown {
    return this.registry.get(name);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  delete(name: string): boolean {
    return this.registry.delete(name);
  }

  clear(): void {
    this.registry.clear();
  }

  keys(): IterableIterator<string> {
    return this.registry.keys();
  }

  values(): IterableIterator<unknown> {
    return this.registry.values();
  }

  entries(): IterableIterator<[string, unknown]> {
    return this.registry.entries();
  }
}

class HighlightStub {
  readonly ranges: AbstractRange[];

  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges;
  }

  get size(): number {
    return this.ranges.length;
  }
}

// Cast through `unknown`: the stubs deliberately implement only the slice of
// the real interfaces that search uses, so they cannot satisfy the lib types.
const globalWithCss = globalThis as unknown as {
  CSS: Record<string, unknown>;
  Highlight: unknown;
};

globalWithCss.Highlight = HighlightStub;
globalWithCss.CSS = { highlights: new HighlightRegistryStub() };

/**
 * jsdom performs no layout and does not implement scrolling. A no-op stub keeps
 * `scrollIntoView` callable so tests can assert *what was revealed* — the
 * behaviour they actually care about — instead of a pixel offset.
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}
