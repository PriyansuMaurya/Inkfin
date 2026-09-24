/**
 * Rendering tests for the reading surface.
 *
 * These assert the security-facing properties of F2: raw HTML in the Markdown is
 * never parsed, disallowed schemes never become live destinations, and a wide
 * table is contained in its own scroll region.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentView } from '../src/components/DocumentView';
import { DocumentAssets } from '../src/features/document/assets';

function renderDocument(content: string) {
  const assets = new DocumentAssets();
  const onOpenLink = vi.fn(async () => null);
  const onExternalLink = vi.fn();
  const onBlockedLink = vi.fn();
  const onRenderSettled = vi.fn();
  const rootRef: { current: HTMLElement | null } = { current: null };

  const result = render(
    <DocumentView
      content={content}
      revision="rev-1"
      theme="light"
      assets={assets}
      rootRef={rootRef}
      attachRoot={(element) => {
        rootRef.current = element;
      }}
      onOpenLink={onOpenLink}
      onExternalLink={onExternalLink}
      onBlockedLink={onBlockedLink}
      documentKey="C:\\docs\\readme.md"
      onRenderSettled={onRenderSettled}
    />,
  );

  return { result, onExternalLink, onBlockedLink, onRenderSettled, assets };
}

describe('GitHub Flavoured Markdown rendering', () => {
  it('renders headings, task lists, tables, strikethrough and fenced code', () => {
    renderDocument(
      [
        '# Title',
        '',
        '- [x] done',
        '- [ ] todo',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '~~struck~~',
        '',
        '```ts',
        'const value = 1;',
        '```',
      ].join('\n'),
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('struck').tagName).toBe('DEL');
    expect(screen.getByText('const value = 1;')).toBeInTheDocument();
    // The language label is chrome, excluded from the search index.
    expect(screen.getByText('ts')).toBeInTheDocument();
  });

  it('gives headings the anchor id their text would slug to', () => {
    renderDocument('## Getting Started');
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'getting-started');
  });

  it('surrounds a table with its own scroll region', () => {
    const { result } = renderDocument('| a |\n| - |\n| 1 |');
    const table = result.container.querySelector('table');
    expect(table?.parentElement?.className).toContain('table-scroll');
  });
});

describe('security posture', () => {
  it('never parses raw HTML from the Markdown source', () => {
    const { result } = renderDocument(
      [
        '<div id="injected">raw html</div>',
        '<script>window.__owned = true</script>',
      ].join('\n\n'),
    );

    expect(result.container.querySelector('#injected')).toBeNull();
    expect(result.container.querySelector('script')).toBeNull();
    expect((window as { __owned?: boolean }).__owned).toBeUndefined();
    // The markup survives as inert literal text, so a future `rehype-raw`
    // addition would fail this test rather than silently re-enable HTML.
    expect(result.container.textContent).toContain('<div id="injected">raw html</div>');
  });

  it('does not create a live destination for a disallowed scheme', () => {
    const { result } = renderDocument('[click me](javascript:alert(1))');

    const anchors = result.container.querySelectorAll('a');
    for (const anchor of Array.from(anchors)) {
      expect(anchor.getAttribute('href') ?? '').not.toContain('javascript:');
    }
    expect(result.container.querySelector('.md-link-blocked')).not.toBeNull();
  });

  it('renders a refused link as text rather than a destination', () => {
    const { result } = renderDocument('[exe](file:///C:/Windows/System32/calc.exe)');
    const blocked = result.container.querySelector('.md-link-blocked');
    expect(blocked?.textContent).toBe('exe');
    expect(result.container.querySelector('a[href^="file:"]')).toBeNull();
  });

  it('does not turn a relative image into a fetch of a remote resource', () => {
    const { result } = renderDocument('![remote](https://example.com/tracker.png)');
    // Remote media is refused, so no live `<img>` is created for it at all.
    expect(result.container.querySelector('img')).toBeNull();
    expect(result.container.querySelector('.md-image-placeholder')).not.toBeNull();
  });
});
