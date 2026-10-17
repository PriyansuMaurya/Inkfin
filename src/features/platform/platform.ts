/**
 * Platform conventions shared by the renderer.
 *
 * The app has one codebase, but keyboard modifiers and shortcut labels are not
 * portable. Keeping the decision in one module means components never branch on
 * `navigator` themselves and the behaviour can be tested without a Tauri window.
 */

export type Platform = 'macos' | 'windows' | 'linux';

/** Classify the webview host from its user agent. */
export function detectPlatform(userAgent: string = navigator.userAgent): Platform {
  if (/Mac OS X|Macintosh|MacIntel/i.test(userAgent)) return 'macos';
  if (/Windows/i.test(userAgent)) return 'windows';
  return 'linux';
}

type ModifierEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>;

/**
 * True when the platform's primary shortcut modifier is held.
 *
 * macOS uses Command and ignores Control; Windows and Linux use Control and
 * ignore Meta. Alt is always excluded so AltGr combinations never trigger an
 * app shortcut.
 */
export function hasPrimaryModifier(
  event: ModifierEvent,
  platform: Platform = detectPlatform(),
): boolean {
  if (event.altKey) return false;
  return platform === 'macos' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Human-readable shortcut hint, e.g. `⌘O` or `Ctrl+O`. */
export function formatShortcut(key: string, platform: Platform = detectPlatform()): string {
  return platform === 'macos' ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * Publish the host platform on the document root.
 *
 * Two shell details are decided in CSS rather than in a component: the font
 * stack (Segoe faces do not exist on macOS) and the scrollbar treatment
 * (macOS uses native overlay scrollbars). Exposing the same answer the shortcut
 * map uses keeps those in one place and lets the stylesheet stay declarative.
 * Returns the platform it published so callers can log or assert it.
 */
export function applyPlatform(
  platform: Platform = detectPlatform(),
  root: HTMLElement = document.documentElement,
): Platform {
  root.dataset.platform = platform;
  return platform;
}
