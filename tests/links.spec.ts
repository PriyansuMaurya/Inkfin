import { describe, expect, it } from 'vitest';

import { classifyLink, safeUrlTransform, slugifyHeading } from '../src/features/document/links';

describe('link classification', () => {
  it('accepts http and https destinations', () => {
    expect(classifyLink('https://example.com/docs')).toEqual({
      kind: 'external',
      url: 'https://example.com/docs',
    });
    expect(classifyLink('http://example.com')).toEqual({
      kind: 'external',
      url: 'http://example.com/',
    });
  });

  it('treats a bare anchor as a same-document fragment', () => {
    expect(classifyLink('#installing')).toEqual({ kind: 'fragment', id: 'installing' });
    expect(classifyLink('#Getting%20Started')).toEqual({
      kind: 'fragment',
      id: 'Getting Started',
    });
  });

  it('accepts a relative Markdown document, with or without a fragment', () => {
    expect(classifyLink('docs/other.md')).toEqual({ kind: 'markdown', path: 'docs/other.md' });
    expect(classifyLink('./guide.markdown#setup')).toEqual({
      kind: 'markdown',
      path: './guide.markdown',
      fragment: 'setup',
    });
    expect(classifyLink('sub\\windows.md')).toEqual({
      kind: 'markdown',
      path: 'sub/windows.md',
    });
  });

  it('refuses every scheme that must never be executed or opened', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///C:/Windows/System32/calc.exe',
      'mailto:someone@example.com',
      'ms-settings:privacy',
      'vbscript:msgbox(1)',
      '//evil.example.com/x.md',
      '',
      '   ',
    ]) {
      const target = classifyLink(href);
      expect(target.kind, `${href} must be refused`).toBe('blocked');
    }
  });

  it('refuses paths that leave the document folder or name a non-Markdown file', () => {
    expect(classifyLink('../secrets.md').kind).toBe('blocked');
    expect(classifyLink('docs/../../secrets.md').kind).toBe('blocked');
    expect(classifyLink('/etc/passwd').kind).toBe('blocked');
    expect(classifyLink('C:/Windows/notepad.exe').kind).toBe('blocked');
    expect(classifyLink('notes.txt').kind).toBe('blocked');
    expect(classifyLink('image.png').kind).toBe('blocked');
    expect(classifyLink('script.exe').kind).toBe('blocked');
  });
});

describe('URL transform', () => {
  it('keeps only web schemes and relative references', () => {
    expect(safeUrlTransform('https://example.com')).toBe('https://example.com');
    expect(safeUrlTransform('images/logo.png')).toBe('images/logo.png');
    expect(safeUrlTransform('')).toBe('');
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///c:/a']) {
      expect(safeUrlTransform(url), url).toBe('');
    }
  });
});

describe('heading anchors', () => {
  it('produces the slug a reader would expect from the heading text', () => {
    expect(slugifyHeading('Getting Started')).toBe('getting-started');
    expect(slugifyHeading('  Install: Windows & Linux  ')).toBe('install-windows-linux');
    expect(slugifyHeading('C++ Notes')).toBe('c-notes');
  });
});
