import { describe, expect, it } from 'vitest';

import {
  applyPlatform,
  detectPlatform,
  formatShortcut,
  hasPrimaryModifier,
  type Platform,
} from '../src/features/platform/platform';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';

function modifiers(overrides: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>>) {
  return { ctrlKey: false, metaKey: false, altKey: false, ...overrides };
}

describe('platform detection', () => {
  it('recognises macOS, Windows and everything else', () => {
    expect(detectPlatform(MAC_UA)).toBe('macos');
    expect(detectPlatform(WINDOWS_UA)).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });
});

describe('primary shortcut modifier', () => {
  it('uses Command on macOS and rejects Control', () => {
    expect(hasPrimaryModifier(modifiers({ metaKey: true }), 'macos')).toBe(true);
    expect(hasPrimaryModifier(modifiers({ ctrlKey: true }), 'macos')).toBe(false);
    expect(hasPrimaryModifier(modifiers({ ctrlKey: true, metaKey: true }), 'macos')).toBe(false);
  });

  it('uses Control on Windows and Linux and rejects Meta', () => {
    for (const platform of ['windows', 'linux'] as const) {
      expect(hasPrimaryModifier(modifiers({ ctrlKey: true }), platform)).toBe(true);
      expect(hasPrimaryModifier(modifiers({ metaKey: true }), platform)).toBe(false);
      expect(hasPrimaryModifier(modifiers({ ctrlKey: true, metaKey: true }), platform)).toBe(false);
    }
  });

  it('never treats Alt combinations as app shortcuts', () => {
    const platforms: Platform[] = ['macos', 'windows', 'linux'];
    for (const platform of platforms) {
      expect(hasPrimaryModifier(modifiers({ metaKey: true, altKey: true }), platform)).toBe(false);
      expect(hasPrimaryModifier(modifiers({ ctrlKey: true, altKey: true }), platform)).toBe(false);
    }
  });
});

describe('shortcut labels', () => {
  it('uses the platform convention', () => {
    expect(formatShortcut('O', 'macos')).toBe('⌘O');
    expect(formatShortcut('O', 'windows')).toBe('Ctrl+O');
    expect(formatShortcut('O', 'linux')).toBe('Ctrl+O');
  });
});

describe('platform attribute', () => {
  it('publishes the host on the document root for the stylesheet', () => {
    const root = document.createElement('html');

    expect(applyPlatform('macos', root)).toBe('macos');
    expect(root.dataset.platform).toBe('macos');

    applyPlatform('windows', root);
    expect(root.dataset.platform).toBe('windows');
  });
});
