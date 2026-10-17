/**
 * The states a reader meets before anything is readable.
 *
 * These are the file-level outcomes the matrix calls E1, E2, E3 and E6: an empty
 * file, a file over the size limit, a file that is not UTF-8 text, and a file the
 * system refuses to read. Each one must arrive as a recoverable state with
 * actionable wording rather than a crash, a blank window or raw OS text.
 *
 * The picker is driven through the real app shell, because the wording the
 * reader sees is assembled there from the Rust message.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { NativeError, DocumentSnapshot } from '../src/bridge/native';

const emptyDocument: DocumentSnapshot = {
  generation: 1,
  canonicalPath: '/docs/empty.md',
  name: 'empty.md',
  content: '\n   \n',
  revision: 'revision-empty',
  baseDirectory: '/docs',
};

const pickedPath = '/docs/notes.md';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn(async () => {}),
    setTheme: vi.fn(async () => {}),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => pickedPath),
}));

vi.mock('@tauri-apps/plugin-store', () => {
  const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}), save: vi.fn() };
  return { load: vi.fn(async () => store) };
});

vi.mock('../src/bridge/events', () => ({
  onDocumentChanged: vi.fn(async () => () => {}),
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
    activeDocument: vi.fn(async () => null),
    openDocument: vi.fn(async (): Promise<DocumentSnapshot> => {
      throw { kind: 'unknown', message: 'The file could not be opened.' };
    }),
    reloadDocument: vi.fn(),
    takePendingLaunch: vi.fn(async () => null),
    readRelativeImage: vi.fn(),
  };
});

import { activeDocument, openDocument } from '../src/bridge/native';
import { App } from '../src/App';

const activeDocumentMock = vi.mocked(activeDocument);
const openDocumentMock = vi.mocked(openDocument);

/** Refuse the pick the way the Rust side refuses it. */
function refuseWith(error: NativeError) {
  openDocumentMock.mockReset();
  openDocumentMock.mockRejectedValue(error);
}

async function openThroughThePicker() {
  render(<App />);
  const button = await screen.findByRole('button', { name: /open file/i });
  await userEvent.setup().click(button);
}

describe('file-level states', () => {
  it('tells the reader an open file is empty and still shows the document', async () => {
    // A restore of the surface (a webview reload) hands back the empty file.
    activeDocumentMock.mockResolvedValueOnce(emptyDocument);

    render(<App />);

    await waitFor(() => expect(screen.getByText('Empty document')).toBeInTheDocument());
    expect(screen.getByText('empty.md')).toBeInTheDocument();
    expect(screen.queryByText('That file could not be opened')).not.toBeInTheDocument();
  });

  it('reports an oversized file as a recoverable error with its real limit', async () => {
    refuseWith({
      kind: 'too_large',
      message: 'The file is 24 MiB, which is larger than the 10 MiB limit.',
      size: 24 * 1024 * 1024,
      limit: 10 * 1024 * 1024,
    });

    await openThroughThePicker();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The file is 24 MiB, which is larger than the 10 MiB limit.');
    expect(screen.getByText('That file could not be opened')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open another file/i })).toBeInTheDocument();
  });

  it('reports a non-UTF-8 file without leaking raw OS text', async () => {
    refuseWith({ kind: 'invalid_utf8', message: 'The file is not valid UTF-8 text.' });

    await openThroughThePicker();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The file is not valid UTF-8 text.');
    expect(alert.textContent ?? '').not.toMatch(/os error|\\Windows\\|errno/i);
  });

  it('reports a refused read as denied, with actionable wording', async () => {
    refuseWith({ kind: 'denied', message: 'Access denied: the system refused read access.' });

    await openThroughThePicker();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Access denied: the system refused read access.');
    expect(alert.textContent ?? '').not.toMatch(/os error|errno|EACCES/i);
  });

  it('reports a file that vanished before it could be read', async () => {
    refuseWith({ kind: 'not_found', message: 'The file could not be found.' });

    await openThroughThePicker();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The file could not be found.');
    // A missing file is retryable: the reader may have moved it back.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
