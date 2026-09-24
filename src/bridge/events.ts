/**
 * Native event subscriptions.
 *
 * Every payload is validated before use. Events only ever carry identity
 * information (a generation, a path, a revision) — never file content, which is
 * requested explicitly through a command so it can be validated on the way in.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { isRecord, readNumber, readString, readStringArray } from './parse';

export type DocumentChangedEvent = {
  generation: number;
  path: string;
  revision: string;
};

export type DocumentUnavailableEvent = {
  generation: number;
  path: string;
  reason: string;
};

const DOCUMENT_CHANGED = 'document_changed';
const DOCUMENT_MISSING = 'document_missing';
const DOCUMENT_UNAVAILABLE = 'document_unavailable';
const LAUNCH_REQUESTED = 'launch_requested';

function parseChanged(payload: unknown): DocumentChangedEvent | null {
  if (!isRecord(payload)) return null;
  const generation = readNumber(payload, 'generation');
  const path = readString(payload, 'path');
  const revision = readString(payload, 'revision');
  if (generation === null || path === null || revision === null) return null;
  return { generation, path, revision };
}

function parseUnavailable(payload: unknown): DocumentUnavailableEvent | null {
  if (!isRecord(payload)) return null;
  const generation = readNumber(payload, 'generation');
  const path = readString(payload, 'path');
  const reason = readString(payload, 'reason');
  if (generation === null || path === null || reason === null) return null;
  return { generation, path, reason };
}

/** Fires when the file on disk differs from the revision on screen. */
export function onDocumentChanged(handler: (event: DocumentChangedEvent) => void): Promise<UnlistenFn> {
  return listen<unknown>(DOCUMENT_CHANGED, (event) => {
    const parsed = parseChanged(event.payload);
    if (parsed) handler(parsed);
  });
}

/** Fires when the file is deleted while a preview is on screen. */
export function onDocumentMissing(
  handler: (event: DocumentUnavailableEvent) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(DOCUMENT_MISSING, (event) => {
    const parsed = parseUnavailable(event.payload);
    if (parsed) handler(parsed);
  });
}

/** Fires when the file exists but cannot be read (encoding, size, access). */
export function onDocumentUnavailable(
  handler: (event: DocumentUnavailableEvent) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(DOCUMENT_UNAVAILABLE, (event) => {
    const parsed = parseUnavailable(event.payload);
    if (parsed) handler(parsed);
  });
}

/** Fires when Explorer or a second launch asks for a different file. */
export function onLaunchRequested(handler: () => void): Promise<UnlistenFn> {
  return listen(LAUNCH_REQUESTED, () => handler());
}

export type DragDropHandlers = {
  onDragActive: () => void;
  onDragEnded: () => void;
  onDrop: (paths: string[]) => void;
};

/**
 * File drops are delivered by the OS, not the DOM, so the webview can hand over
 * real paths without exposing a filesystem API to page JavaScript.
 */
export function onFileDrop(handlers: DragDropHandlers): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload: unknown = event.payload;
    if (!isRecord(payload)) return;

    switch (readString(payload, 'type')) {
      case 'enter':
      case 'over':
        handlers.onDragActive();
        break;
      case 'leave':
        handlers.onDragEnded();
        break;
      case 'drop':
        handlers.onDragEnded();
        handlers.onDrop(readStringArray(payload, 'paths') ?? []);
        break;
      default:
        break;
    }
  });
}
