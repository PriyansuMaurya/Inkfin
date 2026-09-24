/**
 * Highlighting acceptance criteria.
 *
 * F3 requires known languages to highlight, unknown languages to display as
 * plain text, and a copy that yields the exact code. The fallbacks matter more
 * than the happy path: a grammar that is missing or a fence that is too large
 * must never break the document.
 */

import { describe, expect, it } from 'vitest';

import { canonicalLanguage, highlightCode } from '../src/features/highlight/highlighter';

describe('language resolution', () => {
  it('resolves a canonical name and its common aliases', () => {
    expect(canonicalLanguage('typescript')).toBe('typescript');
    expect(canonicalLanguage('ts')).toBe('typescript');
    expect(canonicalLanguage('TS')).toBe('typescript');
    expect(canonicalLanguage('  Python  ')).toBe('python');
    expect(canonicalLanguage('c#')).toBe('csharp');
    expect(canonicalLanguage('c++')).toBe('cpp');
    expect(canonicalLanguage('sh')).toBe('bash');
    expect(canonicalLanguage('shell-session')).toBe('bash');
    expect(canonicalLanguage('yml')).toBe('yaml');
  });

  it('returns null for a language that has no grammar', () => {
    for (const label of ['', '   ', 'text', 'plaintext', 'notalanguage', 'brainfuck']) {
      expect(canonicalLanguage(label), label).toBeNull();
    }
  });
});

describe('highlighting', () => {
  it('returns tokens for a known language', async () => {
    const result = await highlightCode('const value: number = 1;', 'ts', 'light');
    expect(result.status).toBe('highlighted');
    if (result.status === 'highlighted') {
      const text = result.lines.flat().map((token) => token.content).join('');
      expect(text).toBe('const value: number = 1;');
      expect(result.lines.length).toBeGreaterThan(0);
    }
  });

  it('falls back to plain text for an unknown language', async () => {
    expect(await highlightCode('some text', 'notalanguage', 'light')).toEqual({ status: 'plain' });
    expect(await highlightCode('some text', '', 'light')).toEqual({ status: 'plain' });
  });

  it('falls back to plain text for an oversized fence instead of freezing', async () => {
    const huge = 'x'.repeat(400_001);
    expect(await highlightCode(huge, 'ts', 'light')).toEqual({ status: 'plain' });
  });

  it('never reports an error for a block it cannot highlight', async () => {
    // A label that resolves, with content that is pathological for the engine.
    await expect(highlightCode('\u0000\uFFFD', 'rust', 'dark')).resolves.toBeDefined();
  });
});
