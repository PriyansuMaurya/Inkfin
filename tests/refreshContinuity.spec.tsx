/**
 * What has to stay put when the file is saved underneath the reader.
 *
 * An automatic refresh replaces the whole rendered document. Everything the
 * reader set up around it — the search query they typed, the theme they chose,
 * the document zoom, and the scroll position — belongs to the reader, not to
 * the revision, so it must survive the replacement. Scroll restoration is
 * asserted directly in `scrollAnchor.spec.ts` because jsdom has no layout; this
 * test covers the rest end to end through the app shell.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentSnapshot } from '../src/bridge/native';

const original: DocumentSnapshot = {
  generation: 1,
  canonicalPath: '/docs/notes.md',
  name: 'notes.md',
  content: '# Notes\n\nalpha beta\n',
  revision: 'revision-1',
  baseDirectory: '/docs',
};

const edited: DocumentSnapshot = {
  ...original,
  content: '# Notes\n\nalpha beta\n\nedited on disk\n',
  revision: 'revision-2',
};

const watchers: {
  changed?: (event: { generation: number; path: string; revision: string }) => void;
} = {};

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn(async () => {}),
    setTheme: vi.fn(async () => {}),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));

// The stored preferences are what the reader last chose: dark at 125 %.
vi.mock('@tauri-apps/plugin-store', () => {
  const stored = { version: 1, theme: 'dark', zoom: 1.25 };
  const store = {
    get: vi.fn(async () => stored),
    set: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  };
  return { load: vi.fn(async () => store) };
});

vi.mock('../src/bridge/events', () => ({
  onDocumentChanged: vi.fn(async (handler: (event: never) => void) => {
    watchers.changed = handler as (event: {
      generation: number;
      path: string;
      revision: string;
    }) => void;
    return () => {};
  }),
  onDocumentMissing: vi.fn(async () => () => {}),
  onDocumentUnavailable: vi.fn(async () => () => {}),
  onDocumentRecovered: vi.fn(async () => () => {}),
  onDocumentWatchFailed: vi.fn(async () => () => {}),
  onLaunchRequested: vi.fn(async () => () => {}),
  onFileDrop: vi.fn(async () => () => {}),
}));

vi.mock('../src/bridge/native', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/bridge/native');
  return {
    ...actual,
    activeDocument: vi.fn(async () => original),
    openDocument: vi.fn(async () => original),
    reloadDocument: vi.fn(async () => ({ changed: true, snapshot: edited })),
    takePendingLaunch: vi.fn(async () => null),
  };
});

import { App } from '../src/App';

beforeEach(() => {
  delete watchers.changed;
});

describe('an automatic refresh', () => {
  it('keeps the search query, theme and zoom while showing the new content', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText('alpha beta')).toBeInTheDocument());
    // Preferences were applied from the store before the first paint settled.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(document.documentElement.style.getPropertyValue('--k-zoom')).toBe('1.25');

    // The app-level shortcut listener, exercised the way the webview delivers
    // it. Control is the primary modifier here because the test host is not a
    // Mac; the platform module decides that, and it has its own tests.
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    const field = await screen.findByRole('textbox', { name: 'Find in document' });
    const user = userEvent.setup();
    await user.type(field, 'beta');
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeInTheDocument());

    // The file is saved in another window.
    act(() => {
      watchers.changed?.({
        generation: 1,
        path: '/docs/notes.md',
        revision: 'revision-2',
      });
    });

    await waitFor(() => expect(screen.getByText('edited on disk')).toBeInTheDocument());

    expect(screen.getByRole('textbox', { name: 'Find in document' })).toHaveValue('beta');
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--k-zoom')).toBe('1.25');
  });
});
