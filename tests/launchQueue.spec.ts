/**
 * Ordering rules for OS launch requests.
 *
 * A Finder double-click, "Open With" and a dock drop all arrive as nudges that
 * can overlap while the previous document is still loading. These tests pin the
 * three properties the reader depends on: the last request wins, a request that
 * arrives mid-drain is not lost, and an out-of-order older request never
 * replaces the document already on screen.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PendingLaunch } from '../src/bridge/native';
import { createLaunchDrainer, type LaunchSource } from '../src/features/document/launchQueue';

function request(sequence: number, path: string): PendingLaunch {
  return { sequence, path };
}

/** A source that hands out the given requests, then reports an empty queue. */
function queued(...requests: PendingLaunch[]): LaunchSource {
  const remaining = [...requests];
  return async () => remaining.shift() ?? null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('launch draining', () => {
  it('applies queued launches in sequence order and ends on the last one', async () => {
    const opened: string[] = [];
    const drainer = createLaunchDrainer(
      queued(request(1, 'first.md'), request(2, 'second.md'), request(3, 'third.md')),
      (path) => opened.push(path),
    );

    await drainer.drain();

    expect(opened).toEqual(['first.md', 'second.md', 'third.md']);
  });

  it('keeps a nudge that arrives while a read is still in flight', async () => {
    const first = deferred<PendingLaunch | null>();
    const take = vi
      .fn<LaunchSource>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(request(2, 'newer.md'))
      .mockResolvedValueOnce(null);
    const opened: string[] = [];
    const drainer = createLaunchDrainer(take, (path) => opened.push(path));

    void drainer.drain();
    // Both nudges belong to one serialised loop.
    void drainer.drain();
    void drainer.drain();
    expect(take).toHaveBeenCalledTimes(1);

    first.resolve(request(1, 'older.md'));
    await vi.waitFor(() => expect(opened).toEqual(['older.md', 'newer.md']));
    expect(take).toHaveBeenCalledTimes(3);
  });

  it('drains a launch that lands after an earlier drain found an empty queue', async () => {
    const take = vi
      .fn<LaunchSource>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(request(4, 'later.md'))
      .mockResolvedValueOnce(null);
    const opened: string[] = [];
    const drainer = createLaunchDrainer(take, (path) => opened.push(path));

    await drainer.drain();
    expect(opened).toEqual([]);

    await drainer.drain();
    expect(opened).toEqual(['later.md']);
  });

  it('ignores a request older than one already applied', async () => {
    const opened: string[] = [];
    const drainer = createLaunchDrainer(
      queued(request(5, 'current.md'), request(4, 'stale.md'), request(6, 'next.md')),
      (path) => opened.push(path),
    );

    await drainer.drain();

    expect(opened).toEqual(['current.md', 'next.md']);
  });

  it('does not start a read after being disposed', async () => {
    const take = vi.fn<LaunchSource>();
    take.mockResolvedValue(request(1, 'late.md'));
    const opened: string[] = [];
    const drainer = createLaunchDrainer(take, (path) => opened.push(path));

    drainer.dispose();
    await drainer.drain();

    expect(take).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  /**
   * The React StrictMode remount, which is mount → cleanup → mount in
   * development. The first drainer has already asked the native queue for the
   * cold-start document when it is disposed; the second mount finds the queue
   * empty. Dropping the read request there would lose the file the user opened
   * from Finder.
   */
  it('applies a launch already read when the surface is torn down mid-read', async () => {
    const gate = deferred<PendingLaunch | null>();
    const take = vi.fn<LaunchSource>().mockReturnValueOnce(gate.promise).mockResolvedValue(null);
    const opened: string[] = [];

    const first = createLaunchDrainer(take, (path) => opened.push(path));
    const pendingDrain = first.drain();
    first.dispose();

    const second = createLaunchDrainer(take, (path) => opened.push(path));
    await second.drain();

    gate.resolve(request(1, 'from-finder.md'));
    await pendingDrain;

    expect(opened).toEqual(['from-finder.md']);
    // One read by the disposed drainer, one by its replacement, and no more.
    expect(take).toHaveBeenCalledTimes(2);
  });

  it('recovers when reading the queue fails once', async () => {
    const take = vi
      .fn<LaunchSource>()
      .mockRejectedValueOnce(new Error('ipc closed'))
      .mockResolvedValueOnce(request(1, 'after-failure.md'))
      .mockResolvedValueOnce(null);
    const opened: string[] = [];
    const drainer = createLaunchDrainer(take, (path) => opened.push(path));

    await drainer.drain();
    expect(opened).toEqual([]);

    await drainer.drain();
    expect(opened).toEqual(['after-failure.md']);
  });
});

describe('rapid document switching', () => {
  it('opens in request order so the newest document is the one on screen', async () => {
    const opened: string[] = [];
    const drainer = createLaunchDrainer(
      queued(request(1, 'a.md'), request(2, 'b.md'), request(3, 'c.md')),
      (path) => opened.push(path),
    );

    await Promise.all([drainer.drain(), drainer.drain()]);

    expect(opened.at(-1)).toBe('c.md');
  });
});
