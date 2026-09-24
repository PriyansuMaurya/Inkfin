/**
 * Local preferences.
 *
 * Only appearance metadata is stored: theme and document zoom. Document paths
 * and contents are never persisted. Parsing is deliberately forgiving so a
 * corrupt or hand-edited settings file degrades to defaults field by field
 * rather than breaking startup.
 */

import { isRecord, readNumber, readString } from '../../bridge/parse';

export const PREFERENCES_VERSION = 1;

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export type Preferences = {
  version: typeof PREFERENCES_VERSION;
  theme: ThemePreference;
  zoom: number;
};

const THEMES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Document zoom bounds, per the product requirement of 75 % to 200 %. */
export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 2;
export const RESET_ZOOM = 1;

/** Discrete zoom steps. Buttons and shortcuts move between these. */
export const ZOOM_STEPS: readonly number[] = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const DEFAULT_PREFERENCES: Preferences = {
  version: PREFERENCES_VERSION,
  theme: 'system',
  zoom: RESET_ZOOM,
};

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return RESET_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Parse an unknown value from disk into usable preferences. */
export function parsePreferences(value: unknown): Preferences {
  if (!isRecord(value)) {
    return { ...DEFAULT_PREFERENCES };
  }

  const version = readNumber(value, 'version');
  if (version !== PREFERENCES_VERSION) {
    // A future or unknown version is not guessed at; start clean.
    return { ...DEFAULT_PREFERENCES };
  }

  const rawTheme = readString(value, 'theme');
  const theme = THEMES.find((candidate) => candidate === rawTheme) ?? DEFAULT_PREFERENCES.theme;

  const rawZoom = readNumber(value, 'zoom');
  const zoom = rawZoom === null ? DEFAULT_PREFERENCES.zoom : clampZoom(rawZoom);

  return { version: PREFERENCES_VERSION, theme, zoom };
}

export function resolveTheme(theme: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return theme;
}

/** Step to the next or previous zoom level, snapping into the step list. */
export function nextZoomStep(current: number, direction: 1 | -1): number {
  const clamped = clampZoom(current);

  if (direction === 1) {
    const next = ZOOM_STEPS.find((step) => step > clamped + 1e-6);
    return next ?? MAX_ZOOM;
  }

  const previous = [...ZOOM_STEPS].reverse().find((step) => step < clamped - 1e-6);
  return previous ?? MIN_ZOOM;
}

export function canZoomIn(zoom: number): boolean {
  return clampZoom(zoom) < MAX_ZOOM;
}

export function canZoomOut(zoom: number): boolean {
  return clampZoom(zoom) > MIN_ZOOM;
}

/** Zoom rendered as a percentage, e.g. `100%`. */
export function formatZoom(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}
