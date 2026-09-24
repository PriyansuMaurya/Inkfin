/**
 * Typed access to the native bridge.
 *
 * Every command is read-only. Nothing here can write to the document, browse a
 * directory or run a shell command; the Rust side decides what is allowed and
 * this module only validates what comes back.
 */

import { invoke } from '@tauri-apps/api/core';

import { isRecord, optionalNumber, optionalString, readNumber, readString } from './parse';

export type DocumentSnapshot = {
  /**
   * Monotonic id of the open that produced this document.
   *
   * Every follow-up command passes it back so the native side can reject work
   * that belongs to a document which has since been replaced.
   */
  generation: number;
  /** Canonical path of the open document. */
  canonicalPath: string;
  /** Base name shown in the toolbar and window title. */
  name: string;
  /** Raw Markdown source, never the rendered HTML. */
  content: string;
  /** Content hash used to decide whether a reload needs to re-render. */
  revision: string;
  /** Folder that relative links and images resolve against. */
  baseDirectory: string;
};

export type NativeErrorKind =
  | 'unsupported_extension'
  | 'not_a_file'
  | 'not_found'
  | 'too_large'
  | 'invalid_utf8'
  | 'denied'
  | 'blocked_asset'
  | 'no_active_document'
  | 'stale_revision'
  | 'io'
  | 'unknown';

export type NativeError = {
  kind: NativeErrorKind;
  /** Actionable wording produced by the Rust side. */
  message: string;
  extension?: string;
  reason?: string;
  size?: number;
  limit?: number;
  detail?: string;
};

export type ReloadResult = {
  changed: boolean;
  snapshot: DocumentSnapshot;
};

export type LinkedDocument = {
  snapshot: DocumentSnapshot;
  fragment?: string;
};

export type AssetPayload = {
  mime: string;
  revision: string;
  bytes: number;
  dataBase64: string;
};

const ERROR_KINDS: readonly NativeErrorKind[] = [
  'unsupported_extension',
  'not_a_file',
  'not_found',
  'too_large',
  'invalid_utf8',
  'denied',
  'blocked_asset',
  'no_active_document',
  'stale_revision',
  'io',
];

function parseSnapshot(value: unknown): DocumentSnapshot {
  if (!isRecord(value)) {
    throw new Error('the native bridge returned a malformed document');
  }
  const generation = readNumber(value, 'generation');
  const canonicalPath = readString(value, 'canonicalPath');
  const name = readString(value, 'name');
  const content = readString(value, 'content');
  const revision = readString(value, 'revision');
  const baseDirectory = readString(value, 'baseDirectory');

  if (
    generation === null ||
    canonicalPath === null ||
    name === null ||
    content === null ||
    revision === null ||
    baseDirectory === null
  ) {
    throw new Error('the native bridge returned an incomplete document');
  }

  return { generation, canonicalPath, name, content, revision, baseDirectory };
}

function parseReloadResult(value: unknown): ReloadResult {
  if (!isRecord(value)) {
    throw new Error('the native bridge returned a malformed reload result');
  }
  const changed = value.changed;
  if (typeof changed !== 'boolean') {
    throw new Error('the native bridge returned a malformed reload result');
  }
  return { changed, snapshot: parseSnapshot(value.snapshot) };
}

function parseLinkedDocument(value: unknown): LinkedDocument {
  if (!isRecord(value)) {
    throw new Error('the native bridge returned a malformed linked document');
  }
  const fragment = optionalString(value, 'fragment');
  return fragment === undefined
    ? { snapshot: parseSnapshot(value.snapshot) }
    : { snapshot: parseSnapshot(value.snapshot), fragment };
}

function parseAsset(value: unknown): AssetPayload {
  if (!isRecord(value)) {
    throw new Error('the native bridge returned a malformed asset');
  }
  const mime = readString(value, 'mime');
  const revision = readString(value, 'revision');
  const bytes = readNumber(value, 'bytes');
  const dataBase64 = readString(value, 'dataBase64');

  if (mime === null || revision === null || bytes === null || dataBase64 === null) {
    throw new Error('the native bridge returned an incomplete asset');
  }

  return { mime, revision, bytes, dataBase64 };
}

/**
 * Normalise anything the bridge rejected into a `NativeError`.
 *
 * A rejected Tauri command arrives as the serialised `DocumentError`; a thrown
 * validation error or an unexpected shape still produces a usable message.
 */
export function toNativeError(error: unknown): NativeError {
  if (isRecord(error)) {
    const rawKind = readString(error, 'kind');
    const kind = ERROR_KINDS.find((candidate) => candidate === rawKind) ?? 'unknown';
    const message = readString(error, 'message');

    const normalised: NativeError = {
      kind,
      message: message ?? 'The file could not be opened.',
    };

    const extension = optionalString(error, 'extension');
    const reason = optionalString(error, 'reason');
    const detail = optionalString(error, 'detail');
    const size = optionalNumber(error, 'size');
    const limit = optionalNumber(error, 'limit');

    if (extension !== undefined) normalised.extension = extension;
    if (reason !== undefined) normalised.reason = reason;
    if (detail !== undefined) normalised.detail = detail;
    if (size !== undefined) normalised.size = size;
    if (limit !== undefined) normalised.limit = limit;

    return normalised;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return { kind: 'unknown', message: error };
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return { kind: 'unknown', message: error.message };
  }
  return { kind: 'unknown', message: 'The file could not be opened.' };
}

/** True when the reader should hold on to the last readable document. */
export function shouldKeepLastPreview(kind: NativeErrorKind): boolean {
  return kind !== 'stale_revision' && kind !== 'no_active_document';
}

export async function openDocument(path: string): Promise<DocumentSnapshot> {
  return parseSnapshot(await invoke<unknown>('open_document', { path }));
}

export async function openLinkedDocument(
  generation: number,
  link: string,
): Promise<LinkedDocument> {
  return parseLinkedDocument(await invoke<unknown>('open_linked_document', { generation, link }));
}

export async function reloadDocument(
  generation: number,
  expectedRevision: string,
): Promise<ReloadResult> {
  return parseReloadResult(
    await invoke<unknown>('reload_document', { generation, expectedRevision }),
  );
}

export async function readRelativeImage(
  generation: number,
  reference: string,
): Promise<AssetPayload> {
  return parseAsset(await invoke<unknown>('read_relative_image', { generation, reference }));
}

export async function activeDocument(): Promise<DocumentSnapshot | null> {
  const value = await invoke<unknown>('active_document');
  return value === null || value === undefined ? null : parseSnapshot(value);
}

export async function takePendingLaunch(): Promise<string | null> {
  const value = await invoke<unknown>('get_pending_launch');
  return typeof value === 'string' ? value : null;
}

export async function openExternalLink(url: string): Promise<void> {
  await invoke('open_external_link', { url });
}
