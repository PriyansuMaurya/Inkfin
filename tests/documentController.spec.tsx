/**
 * Rapid switching through the document controller.
 *
 * The controller is the only place that decides which document is on screen, so
 * these tests cover the two orderings that can otherwise put the wrong file in
 * front of the reader: two overlapping opens resolving out of order, and a
 * launch the OS queued before the window existed.
 *
 * They also drive the watcher events the native side emits — change, missing,
 * recovered and watch failure — because each one decides whether the reading
 * surface is replaced, kept, or merely annotated.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentSnapshot, PendingLaunch } from '../src/bridge/native';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));

type ChangedEvent = { generation: number; path: string; revision: string };
type UnavailableEvent = { generation: number; path: string; reason: string };
type RecoveredEvent = { generation: number; path: string };

/** Handlers captured from the controller's subscriptions, per test. */
const handlers: {
  changed?: (event: ChangedEvent) => void;
  missing?: (event: UnavailableEvent) => void;
  unavailable?: (event: UnavailableEvent) => void;
  recovered?: (event: RecoveredEvent) => void;
  watchFailed?: (event: UnavailableEvent) => void;
} = {};

function record<T>(slot: keyof typeof handlers) {
  return vi.fn(async (handler: (event: T) => void) => {
    (handlers[slot] as unknown as (event: T) => void) = handler;
    return () => {};
  });
}

vi.mock('../src/bridge/events', () => ({
  onDocumentChanged: record('changed'),
  onDocumentMissing: record('missing'),
  onDocumentUnavailable: record('unavailable'),
  onDocumentRecovered: record('recovered'),
  onDocumentWatchFailed: record('watchFailed'),
  onLaunchRequested: vi.fn(async () => () => {}),
}));

vi.mock('../src/bridge/native', async () => {
  // The real parsing helpers stay in place; only the commands the controller
  // calls are replaced, so the mock cannot drift from the bridge contract.
  const actual = await vi.importActual<Record<string, unknown>>('../src/bridge/native');
  return {
    ...actual,
    activeDocument: vi.fn(async () => null),
    openDocument: vi.fn(),
    openLinkedDocument: vi.fn(),
    readRelativeImage: vi.fn(),
    reloadDocument: vi.fn(),
    takePendingLaunch: vi.fn(async () => null),
  };
});

import { openDocument, reloadDocument, takePendingLaunch } from '../src/bridge/native';
import { useDocumentController } from '../src/features/document/documentController';

function snapshot(name: string, generation: number, content = `# ${name}`): DocumentSnapshot {
  return {
    generation,
    canonicalPath: `/docs/${name}`,
    name,
    content,
    revision: `revision-${generation}`,
    baseDirectory: '/docs',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const openDocumentMock = vi.mocked(openDocument);
const reloadDocumentMock = vi.mocked(reloadDocument);
const takePendingLaunchMock = vi.mocked(takePendingLaunch);

beforeEach(() => {
  openDocumentMock.mockReset();
  reloadDocumentMock.mockReset();
  takePendingLaunchMock.mockReset();
  takePendingLaunchMock.mockResolvedValue(null);
  for (const key of Object.keys(handlers) as (keyof typeof handlers)[]) {
    delete handlers[key];
  }
});

/** Render the controller with one document already on screen. */
async function withDocument(name = 'first.md') {
  openDocumentMock.mockResolvedValueOnce(snapshot(name, 1));
  const view = renderHook(() => useDocumentController());
  act(() => view.result.current.open(`/docs/${name}`));
  await waitFor(() => expect(view.result.current.document?.name).toBe(name));
  return view;
}

describe('overlapping opens', () => {
  it('shows the newest document even when the older open resolves last', async () => {
    const slow = deferred<DocumentSnapshot>();
    const fast = deferred<DocumentSnapshot>();
    openDocumentMock.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const { result } = renderHook(() => useDocumentController());

    act(() => {
      result.current.open('/docs/first.md');
      result.current.open('/docs/second.md');
    });

    fast.resolve(snapshot('second.md', 2));
    await waitFor(() => expect(result.current.document?.name).toBe('second.md'));

    slow.resolve(snapshot('first.md', 1));
    // The superseded response must not replace the document on screen.
    await waitFor(() => expect(result.current.document?.name).toBe('second.md'));
  });

  it('keeps the document on screen when a later open fails', async () => {
    openDocumentMock
      .mockResolvedValueOnce(snapshot('first.md', 1))
      .mockRejectedValueOnce({ kind: 'not_found', message: 'That file is gone.' });

    const { result } = renderHook(() => useDocumentController());

    act(() => result.current.open('/docs/first.md'));
    await waitFor(() => expect(result.current.document?.name).toBe('first.md'));

    act(() => result.current.open('/docs/missing.md'));
    await waitFor(() => expect(result.current.notice?.failed).toBe(true));
    expect(result.current.document?.name).toBe('first.md');
  });
});

describe('launches queued before the window existed', () => {
  it('opens the queued document once the surface mounts', async () => {
    const pending: PendingLaunch = { sequence: 1, path: '/docs/from-finder.md' };
    takePendingLaunchMock.mockResolvedValueOnce(pending).mockResolvedValue(null);
    openDocumentMock.mockResolvedValue(snapshot('from-finder.md', 1));

    const { result } = renderHook(() => useDocumentController());

    await waitFor(() => expect(result.current.document?.name).toBe('from-finder.md'));
    expect(openDocumentMock).toHaveBeenCalledWith('/docs/from-finder.md');
  });
});

describe('watcher events', () => {
  it('re-reads the document when the watcher reports a change', async () => {
    const { result } = await withDocument();
    reloadDocumentMock.mockResolvedValueOnce({
      changed: true,
      snapshot: snapshot('first.md', 1, '# Edited on disk'),
    });

    act(() => {
      handlers.changed?.({
        generation: 1,
        path: '/docs/first.md',
        revision: 'revision-edited',
      });
    });

    await waitFor(() => expect(result.current.document?.content).toBe('# Edited on disk'));
    expect(reloadDocumentMock).toHaveBeenCalledWith(1, 'revision-1');
  });

  it('keeps the last readable preview when the file is deleted', async () => {
    const { result } = await withDocument();

    act(() => {
      handlers.missing?.({ generation: 1, path: '/docs/first.md', reason: 'not_found' });
    });

    expect(result.current.document?.content).toBe('# first.md');
    expect(result.current.notice?.message).toContain('no longer on disk');
    expect(result.current.notice?.source).toBe('watch');
  });

  it('withdraws the missing warning when the file comes back unchanged', async () => {
    const { result } = await withDocument();

    act(() => {
      handlers.missing?.({ generation: 1, path: '/docs/first.md', reason: 'not_found' });
    });
    expect(result.current.notice).not.toBeNull();

    act(() => {
      handlers.recovered?.({ generation: 1, path: '/docs/first.md' });
    });
    expect(result.current.notice).toBeNull();
    expect(result.current.document?.content).toBe('# first.md');
  });

  it('leaves an unrelated notice alone when the watch recovers', async () => {
    const { result } = await withDocument();

    act(() => {
      result.current.showNotice({ message: 'That link was not opened.', failed: false });
    });
    act(() => {
      handlers.recovered?.({ generation: 1, path: '/docs/first.md' });
    });

    expect(result.current.notice?.message).toBe('That link was not opened.');
  });

  it('says live refresh is off when the folder cannot be watched', async () => {
    const { result } = await withDocument();

    act(() => {
      handlers.watchFailed?.({
        generation: 1,
        path: '/docs/first.md',
        reason: 'denied',
      });
    });

    expect(result.current.document?.content).toBe('# first.md');
    expect(result.current.notice?.message).toBe('Live refresh is off for this document.');
    expect(result.current.notice?.failed).toBe(false);
  });

  it('ignores events that belong to a replaced document', async () => {
    const { result } = await withDocument();

    act(() => {
      handlers.missing?.({ generation: 99, path: '/docs/other.md', reason: 'not_found' });
      handlers.watchFailed?.({ generation: 99, path: '/docs/other.md', reason: 'io' });
      handlers.recovered?.({ generation: 99, path: '/docs/other.md' });
    });

    expect(result.current.notice).toBeNull();
    expect(result.current.document?.name).toBe('first.md');
  });
});
