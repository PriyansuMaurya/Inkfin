/**
 * Reading-surface state.
 *
 * The document the reader sees is never mutated in place: every state is an
 * immutable value produced by a reducer, so an automatic refresh can move
 * between states without the view momentarily rendering a half-updated mix of
 * old and new content.
 */

import type { DocumentSnapshot, NativeError } from '../../bridge/native';

export type { DocumentSnapshot };

export type DocumentState =
  /** Nothing is open yet: the reader shows the empty state. */
  | { status: 'empty' }
  /**
   * A document is being read. `previous` holds the document already on screen,
   * so replacing a file keeps the last readable content visible instead of
   * flashing an empty reading surface while the new one loads.
   */
  | { status: 'loading'; previous: DocumentSnapshot | null }
  /** A readable document. */
  | { status: 'ready'; document: DocumentSnapshot }
  /**
   * The open attempt failed and there is nothing readable to fall back on.
   * A failure that *does* have a fallback is reported through `DocumentNotice`
   * and keeps the previous document on screen instead.
   */
  | { status: 'error'; error: NativeError };

/**
 * A brief, inline notice beneath the toolbar.
 *
 * Notices are the routine-failure surface: a missing file, a blocked image, a
 * dropped bundle. They never replace the document, and only offer an action when
 * one genuinely helps.
 */
export type DocumentNotice = {
  /** Short headline. Always actionable in wording, never a stack trace. */
  message: string;
  /** Optional secondary line, usually a cause or a next step. */
  detail?: string;
  /** Marks the notice as a failure so it can be styled and announced as one. */
  failed: boolean;
  /**
   * Whether re-running the operation that produced this notice could succeed.
   * The action itself lives on the controller, so notices stay plain values.
   */
  retryable?: boolean;
};

/** The document currently on screen, if it is readable. */
export function readableDocument(state: DocumentState): DocumentSnapshot | null {
  switch (state.status) {
    case 'ready':
      return state.document;
    case 'loading':
      return state.previous;
    default:
      return null;
  }
}
