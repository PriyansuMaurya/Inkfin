/**
 * Object-URL lifecycle for images referenced by the open document.
 *
 * Images arrive as bounded bytes over a native command that is bound to one
 * document generation. They are turned into object URLs so the renderer never
 * needs a filesystem path (and therefore never needs a filesystem capability).
 *
 * Two rules keep this safe and cheap:
 *  - every URL created here is revoked when the document generation changes, so
 *    a long editing session cannot leak memory or keep serving a stale file;
 *  - a reference is fetched once per generation, so re-rendering for a theme
 *    change or a refresh costs nothing.
 */

import { readRelativeImage, toNativeError } from '../../bridge/native';

export type AssetResult =
  | { status: 'ready'; url: string; mime: string }
  /** The reference was refused by policy: remote, traversal, or wrong type. */
  | { status: 'blocked'; message: string }
  /** The reference was allowed but could not be produced. */
  | { status: 'missing'; message: string };

/**
 * Decode base64 into bytes backed by a plain `ArrayBuffer`.
 *
 * The explicit annotation matters: a `Uint8Array` over an `ArrayBufferLike` is
 * not assignable to `BlobPart`, and a `Blob` needs a real buffer it owns.
 */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export class DocumentAssets {
  #generation: number | null = null;
  #urls: string[] = [];
  #pending = new Map<string, Promise<AssetResult>>();

  /** Point the cache at a new document, revoking everything the old one held. */
  setGeneration(generation: number | null): void {
    if (this.#generation === generation) return;
    this.#revokeAll();
    this.#pending.clear();
    this.#generation = generation;
  }

  /** Resolve a relative reference to a displayable object URL. */
  resolve(reference: string): Promise<AssetResult> {
    const generation = this.#generation;
    if (generation === null) {
      return Promise.resolve({
        status: 'missing',
        message: 'No document is open.',
      });
    }

    const cached = this.#pending.get(reference);
    if (cached) return cached;

    const request = this.#load(generation, reference);
    this.#pending.set(reference, request);
    return request;
  }

  /** Release every URL this cache owns. */
  dispose(): void {
    this.#revokeAll();
    this.#pending.clear();
    this.#generation = null;
  }

  async #load(generation: number, reference: string): Promise<AssetResult> {
    let url: string;
    let mime: string;
    try {
      const payload = await readRelativeImage(generation, reference);

      // The document may have been replaced while the bytes were in flight.
      // Re-resolve against the new generation rather than reporting a missing
      // image for a file that exists perfectly well.
      if (this.#generation !== generation) {
        return this.resolve(reference);
      }

      const blob = new Blob([base64ToBytes(payload.dataBase64)], { type: payload.mime });
      url = URL.createObjectURL(blob);
      mime = payload.mime;
    } catch (error) {
      const native = toNativeError(error);
      if (native.kind === 'blocked_asset' || native.kind === 'denied') {
        return { status: 'blocked', message: native.message };
      }
      return { status: 'missing', message: native.message };
    }

    // A successful load for a superseded generation must not keep its URL.
    if (this.#generation !== generation) {
      URL.revokeObjectURL(url);
      return this.resolve(reference);
    }

    this.#urls.push(url);
    return { status: 'ready', url, mime };
  }

  #revokeAll(): void {
    for (const url of this.#urls) {
      URL.revokeObjectURL(url);
    }
    this.#urls = [];
  }
}

/** True when a reference can only ever be a local file in the document folder. */
export function isLocalReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (trimmed === '') return false;
  // A scheme (including `data:` and `javascript:`) or a protocol-relative or
  // absolute path is not a local, in-folder reference.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
  return true;
}
