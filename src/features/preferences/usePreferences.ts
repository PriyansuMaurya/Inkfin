/**
 * Preference controller.
 *
 * Responsibilities are deliberately narrow: load the stored appearance, keep it
 * valid, apply it to the document root, follow the OS when the theme is
 * `system`, and persist changes. Nothing here touches document content.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { load, type Store } from '@tauri-apps/plugin-store';

import {
  canZoomIn as canZoomInFor,
  canZoomOut as canZoomOutFor,
  clampZoom,
  DEFAULT_PREFERENCES,
  nextZoomStep,
  parsePreferences,
  resolveTheme,
  RESET_ZOOM,
  type Preferences,
  type ResolvedTheme,
  type ThemePreference,
} from './preferences';

const STORE_FILE = 'preferences.json';
const STORE_KEY = 'preferences';

export type PreferencesController = {
  /** False until the stored preferences have been read (or defaults adopted). */
  ready: boolean;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  setTheme: (theme: ThemePreference) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
};

export function usePreferences(): PreferencesController {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [prefersDark, setPrefersDark] = useState(false);

  const storeRef = useRef<Store | null>(null);
  const persistedRef = useRef<string | null>(null);

  // Read the stored appearance once, recovering to defaults if it is unreadable.
  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const store = await load(STORE_FILE, { autoSave: false });
        const stored = parsePreferences(await store.get<unknown>(STORE_KEY));
        if (!active) return;
        storeRef.current = store;
        persistedRef.current = JSON.stringify(stored);
        setPreferences(stored);
      } catch {
        if (!active) return;
        // A corrupt or unwritable store must never block reading.
        persistedRef.current = JSON.stringify(DEFAULT_PREFERENCES);
      } finally {
        if (active) setReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Persist only real changes, and only after the initial load settled.
  useEffect(() => {
    if (!ready) return;
    const serialised = JSON.stringify(preferences);
    if (serialised === persistedRef.current) return;

    const store = storeRef.current;
    if (!store) return;

    persistedRef.current = serialised;
    void (async () => {
      try {
        await store.set(STORE_KEY, preferences);
        await store.save();
      } catch {
        // Allow the next change to try again rather than silently diverging.
        persistedRef.current = null;
      }
    })();
  }, [preferences, ready]);

  // Track the OS appearance so `system` reacts without a restart.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveTheme(preferences.theme, prefersDark),
    [preferences.theme, prefersDark],
  );

  // Apply the appearance. `--k-zoom` is a custom property read by the reading
  // column, so changing it rescales document typography without re-rendering.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.setProperty('--k-zoom', String(preferences.zoom));
  }, [resolvedTheme, preferences.zoom]);

  // Keep the native title bar in step. `null` hands control back to Windows.
  useEffect(() => {
    void getCurrentWindow()
      .setTheme(preferences.theme === 'system' ? null : preferences.theme)
      .catch(() => {
        // Purely cosmetic: never surface a failure to match the chrome.
      });
  }, [preferences.theme]);

  const setTheme = useCallback((theme: ThemePreference) => {
    setPreferences((current) => ({ ...current, theme }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    const clamped = clampZoom(zoom);
    setPreferences((current) => (current.zoom === clamped ? current : { ...current, zoom: clamped }));
  }, []);

  const zoomIn = useCallback(() => {
    setPreferences((current) => ({ ...current, zoom: nextZoomStep(current.zoom, 1) }));
  }, []);

  const zoomOut = useCallback(() => {
    setPreferences((current) => ({ ...current, zoom: nextZoomStep(current.zoom, -1) }));
  }, []);

  const resetZoom = useCallback(() => {
    setPreferences((current) =>
      current.zoom === RESET_ZOOM ? current : { ...current, zoom: RESET_ZOOM },
    );
  }, []);

  return {
    ready,
    theme: preferences.theme,
    resolvedTheme,
    zoom: preferences.zoom,
    canZoomIn: canZoomInFor(preferences.zoom),
    canZoomOut: canZoomOutFor(preferences.zoom),
    setTheme,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
