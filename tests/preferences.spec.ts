import { describe, expect, it } from 'vitest';

import {
  canZoomIn,
  canZoomOut,
  clampZoom,
  DEFAULT_PREFERENCES,
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStep,
  parsePreferences,
  RESET_ZOOM,
  resolveTheme,
} from '../src/features/preferences/preferences';

describe('preference parsing', () => {
  it('accepts a well-formed record', () => {
    expect(parsePreferences({ version: 1, theme: 'dark', zoom: 1.5 })).toEqual({
      version: 1,
      theme: 'dark',
      zoom: 1.5,
    });
  });

  it('falls back to defaults for a corrupt or unknown version', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('nonsense')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ version: 99, theme: 'dark', zoom: 2 })).toEqual(DEFAULT_PREFERENCES);
  });

  it('repairs individual fields rather than discarding the whole record', () => {
    expect(parsePreferences({ version: 1, theme: 'neon', zoom: 'big' })).toEqual({
      version: 1,
      theme: DEFAULT_PREFERENCES.theme,
      zoom: DEFAULT_PREFERENCES.zoom,
    });
  });

  it('clamps zoom into the supported range', () => {
    expect(parsePreferences({ version: 1, theme: 'light', zoom: 12 }).zoom).toBe(MAX_ZOOM);
    expect(parsePreferences({ version: 1, theme: 'light', zoom: 0.1 }).zoom).toBe(MIN_ZOOM);
    expect(parsePreferences({ version: 1, theme: 'light', zoom: Number.NaN }).zoom).toBe(RESET_ZOOM);
  });
});

describe('zoom stepping', () => {
  it('moves between discrete steps in both directions', () => {
    expect(nextZoomStep(1, 1)).toBeGreaterThan(1);
    expect(nextZoomStep(1, -1)).toBeLessThan(1);
  });

  it('stops at the documented bounds', () => {
    expect(nextZoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomIn(1)).toBe(true);
    expect(canZoomOut(1)).toBe(true);
  });

  it('clamps an out-of-range value before stepping', () => {
    expect(clampZoom(500)).toBe(MAX_ZOOM);
    expect(clampZoom(-4)).toBe(MIN_ZOOM);
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.75)).toBe('75%');
    expect(formatZoom(2)).toBe('200%');
  });
});

describe('theme resolution', () => {
  it('follows the OS only when the preference is System', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
