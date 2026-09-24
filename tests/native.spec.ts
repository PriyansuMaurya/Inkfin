import { describe, expect, it } from 'vitest';

import { shouldKeepLastPreview, toNativeError } from '../src/bridge/native';

describe('native error normalisation', () => {
  it('keeps the kind and actionable message from a serialised error', () => {
    const error = toNativeError({
      kind: 'too_large',
      message: 'The file is 12 MiB, which is larger than the 10 MiB limit.',
      size: 12 * 1024 * 1024,
      limit: 10 * 1024 * 1024,
    });

    expect(error.kind).toBe('too_large');
    expect(error.size).toBe(12 * 1024 * 1024);
    expect(error.limit).toBe(10 * 1024 * 1024);
    expect(error.message).toContain('10 MiB');
  });

  it('treats an unknown kind as unknown rather than trusting it', () => {
    expect(toNativeError({ kind: 'explode', message: 'boom' }).kind).toBe('unknown');
  });

  it('never surfaces a raw thrown string as a kind', () => {
    expect(toNativeError('os error 5').kind).toBe('unknown');
    expect(toNativeError(new Error('plain failure')).message).toBe('plain failure');
  });

  it('produces a usable message for anything unrecognisable', () => {
    const error = toNativeError(undefined);
    expect(error.kind).toBe('unknown');
    expect(error.message.length).toBeGreaterThan(0);
  });
});

describe('last-good preview policy', () => {
  it('keeps the readable preview through every failure that has a cause on disk', () => {
    expect(shouldKeepLastPreview('not_found')).toBe(true);
    expect(shouldKeepLastPreview('invalid_utf8')).toBe(true);
    expect(shouldKeepLastPreview('too_large')).toBe(true);
    expect(shouldKeepLastPreview('denied')).toBe(true);
    expect(shouldKeepLastPreview('io')).toBe(true);
  });

  it('does not treat superseded work as a failure to report', () => {
    expect(shouldKeepLastPreview('stale_revision')).toBe(false);
    expect(shouldKeepLastPreview('no_active_document')).toBe(false);
  });
});
