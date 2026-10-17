/**
 * Launch-request draining.
 *
 * The operating system can hand the app a document at any moment: a Finder
 * double-click, "Open With", a drop on the dock icon, or a second launch while
 * Inkfin is already running. Three rules keep those requests from fighting each
 * other, and all three live here rather than in the controller so they can be
 * tested without a window:
 *
 *  - **One drain at a time.** Notifications are asynchronous, so a second nudge
 *    can arrive while the first read is still in flight. A second drain loop
 *    would race the first and could open the older of the two documents last.
 *  - **Newest wins.** A request whose sequence is not newer than one already
 *    applied is dropped, which is what makes an event for an earlier document
 *    harmless once a newer open is on screen.
 *  - **Nothing is lost.** A nudge that arrives mid-drain is remembered rather
 *    than ignored, because the native queue may have received the path after
 *    the current read returned. A request that has already been read is applied
 *    even when the surface is torn down while the read is in flight: the native
 *    queue has already handed it over, so dropping it would lose a document the
 *    reader asked for. React's development StrictMode remounts every effect once
 *    (mount → cleanup → mount), which is exactly that sequence, and it must not
 *    cost the cold-start document.
 */

import type { PendingLaunch } from '../../bridge/native';

export type LaunchSource = () => Promise<PendingLaunch | null>;

export type LaunchDrainer = {
  /**
   * Empty the native queue. Safe to call on every nudge: overlapping calls
   * coalesce into one loop instead of racing.
   */
  drain: () => Promise<void>;
  /**
   * Stop starting new reads, for example when the reading surface unmounts. A
   * request already read is still applied; see the guarantee above.
   */
  dispose: () => void;
};

export function createLaunchDrainer(
  take: LaunchSource,
  open: (path: string) => void,
): LaunchDrainer {
  /** Newest sequence already handed to `open`. */
  let applied = 0;
  let running = false;
  let scheduled = false;
  let disposed = false;

  async function run(): Promise<void> {
    scheduled = true;
    if (running || disposed) return;
    running = true;
    try {
      let continueDraining = true;
      while (continueDraining) {
        scheduled = false;
        const pending = await take();
        // An older request can only follow a newer one when notifications are
        // delivered out of order. Re-opening it would replace the document the
        // reader already moved to with a stale one.
        if (pending !== null && pending.sequence > applied) {
          applied = pending.sequence;
          open(pending.path);
        }
        // Keep going while the queue may hold more, or when a nudge arrived
        // while this read was in flight — but never start another read once the
        // surface has gone away.
        continueDraining = (pending !== null || scheduled) && !disposed;
      }
    } catch {
      // A failed read leaves the native queue untouched; the next nudge
      // retries. Reporting it would be noise the reader cannot act on.
    } finally {
      running = false;
    }
  }

  return {
    drain: run,
    dispose() {
      disposed = true;
    },
  };
}
