/**
 * Document controller.
 *
 * Owns the single open document: which file is showing, when it is replaced, and
 * how an automatic refresh is applied. Three invariants keep it correct:
 *
 *  - **One request wins.** Every open attempt takes a request id; a response
 *    issued for an older id is dropped, so rapidly switching files can never
 *    leave the wrong document on screen.
 *  - **A failure never erases a readable document.** When something is already
 *    on screen, a failed open becomes an inline notice and the reader keeps
 *    reading. Only a failure with nothing to fall back on becomes an error view.
 *  - **Stale work is silent.** Responses and events from a replaced document
 *    are discarded rather than reported as failures.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { open as openFileDialog } from '@tauri-apps/plugin-dialog';

import {
  onDocumentChanged,
  onDocumentMissing,
  onDocumentUnavailable,
  onLaunchRequested,
  type DocumentUnavailableEvent,
} from '../../bridge/events';
import {
  activeDocument,
  openDocument,
  openLinkedDocument,
  reloadDocument,
  shouldKeepLastPreview,
  takePendingLaunch,
  toNativeError,
  type DocumentSnapshot,
  type NativeError,
} from '../../bridge/native';
import { DocumentAssets } from './assets';
import {
  readableDocument,
  type DocumentNotice,
  type DocumentState,
} from './documentTypes';

export type DocumentController = {
  state: DocumentState;
  /** The readable document, if there is one. */
  document: DocumentSnapshot | null;
  /** Generation of the readable document, used by the asset cache and search. */
  generation: number | null;
  notice: DocumentNotice | null;
  /** Object-URL cache for the current document's images. */
  assets: DocumentAssets;
  open: (path: string) => void;
  openFromDialog: () => Promise<void>;
  /** Follow a relative Markdown link; resolves to a fragment to scroll to. */
  openLink: (link: string) => Promise<string | null>;
  /** Explicit reload (Ctrl+R). */
  reload: () => void;
  /** Re-run the operation that produced the current notice. */
  retry: () => void;
  dismissNotice: () => void;
  showNotice: (notice: DocumentNotice) => void;
};

type State = {
  document: DocumentState;
  notice: DocumentNotice | null;
  /** Id of the newest open attempt. Older responses are ignored. */
  requestId: number;
};

type Action =
  | { type: 'started' }
  | { type: 'opened'; requestId: number; document: DocumentSnapshot }
  | { type: 'failed'; requestId: number; error: NativeError; retryable: boolean }
  | { type: 'refreshed'; generation: number; document: DocumentSnapshot }
  | { type: 'notice'; notice: DocumentNotice | null };

const INITIAL_STATE: State = {
  document: { status: 'empty' },
  notice: null,
  requestId: 0,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'started':
      return {
        document: { status: 'loading', previous: readableDocument(state.document) },
        // A new open supersedes whatever the last one complained about.
        notice: null,
        requestId: state.requestId + 1,
      };

    case 'opened':
      if (action.requestId !== state.requestId) return state;
      return {
        document: { status: 'ready', document: action.document },
        notice: null,
        requestId: state.requestId,
      };

    case 'failed': {
      if (action.requestId !== state.requestId) return state;

      const previous =
        state.document.status === 'loading'
          ? state.document.previous
          : readableDocument(state.document);

      if (previous) {
        // Keep the reader's document; report the failure beside it.
        return {
          document: { status: 'ready', document: previous },
          notice: {
            message: action.error.message,
            detail: 'The document already open is unchanged.',
            failed: true,
            ...(action.retryable ? { retryable: true } : {}),
          },
          requestId: state.requestId,
        };
      }

      return {
        document: { status: 'error', error: action.error },
        notice: null,
        requestId: state.requestId,
      };
    }

    case 'refreshed': {
      // A refresh only ever applies to the document it was started for.
      if (state.document.status !== 'ready') return state;
      if (state.document.document.generation !== action.generation) return state;
      return {
        document: { status: 'ready', document: action.document },
        // The file demonstrably came back, so a stale "missing" warning is wrong.
        notice: null,
        requestId: state.requestId,
      };
    }

    case 'notice':
      return { ...state, notice: action.notice };
  }
}

export function useDocumentController(): DocumentController {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // One cache for the whole session; it is re-pointed at each new generation.
  const assets = useMemo(() => new DocumentAssets(), []);

  const requestCounter = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);
  const documentRef = useRef<DocumentSnapshot | null>(null);

  const document = readableDocument(state.document);
  const generation = document?.generation ?? null;

  // Keep the latest document available to event handlers without making those
  // handlers re-subscribe on every render.
  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  // Re-point the asset cache whenever the generation changes so the previous
  // document's object URLs are revoked as soon as it is replaced.
  useEffect(() => {
    assets.setGeneration(generation);
  }, [assets, generation]);

  const run = useCallback(
    (
      operation: () => Promise<DocumentSnapshot>,
      options: { retryable: boolean; remember?: () => void },
    ) => {
      if (options.remember) retryRef.current = options.remember;
      requestCounter.current += 1;
      const requestId = requestCounter.current;
      dispatch({ type: 'started' });

      void (async () => {
        try {
          const opened = await operation();
          dispatch({ type: 'opened', requestId, document: opened });
        } catch (error) {
          const native = toNativeError(error);
          // Superseded work is not a failure the reader needs to hear about.
          if (native.kind === 'stale_revision') return;
          dispatch({ type: 'failed', requestId, error: native, retryable: options.retryable });
        }
      })();
    },
    [],
  );

  const open = useCallback(
    (path: string) => {
      run(() => openDocument(path), {
        retryable: true,
        remember: () => open(path),
      });
    },
    [run],
  );

  const openFromDialog = useCallback(async () => {
    let selection: string | string[] | null;
    try {
      selection = await openFileDialog({
        multiple: false,
        directory: false,
        title: 'Open Markdown file',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
    } catch {
      // Assign the retry before dispatching, so the Try again button can never
      // render pointing at the previous operation.
      retryRef.current = () => {
        void openFromDialog();
      };
      dispatch({
        type: 'notice',
        notice: {
          message: 'The file picker could not be opened.',
          detail: 'Use drag and drop, or try again.',
          failed: true,
          retryable: true,
        },
      });
      return;
    }

    const path = Array.isArray(selection) ? selection[0] : selection;
    if (typeof path === 'string' && path !== '') {
      open(path);
    }
  }, [open]);

  /**
   * Follow a relative Markdown link.
   *
   * The fragment is returned rather than scrolled here, because only the view
   * knows the rendered DOM. A refusal becomes a notice instead of a failure:
   * clicking an untrusted link must never disturb the open document.
   */
  const openLink = useCallback(
    async (link: string): Promise<string | null> => {
      const generation = documentRef.current?.generation;
      if (generation === undefined) return null;

      retryRef.current = () => {
        void openLink(link);
      };
      requestCounter.current += 1;
      const requestId = requestCounter.current;
      dispatch({ type: 'started' });

      try {
        const result = await openLinkedDocument(generation, link);
        dispatch({ type: 'opened', requestId, document: result.snapshot });
        return result.fragment ?? null;
      } catch (error) {
        const native = toNativeError(error);
        if (native.kind === 'stale_revision') return null;
        dispatch({ type: 'failed', requestId, error: native, retryable: false });
        return null;
      }
    },
    [],
  );

  /**
   * Apply a refresh that the watcher signalled.
   *
   * The native side has already compared content hashes, so `changed: false`
   * means the rendered document is up to date and nothing needs to re-render.
   */
  const refresh = useCallback(async (generationToRefresh: number) => {
    const current = documentRef.current;
    if (!current || current.generation !== generationToRefresh) return;

    try {
      const result = await reloadDocument(generationToRefresh, current.revision);
      if (!result.changed) return;
      dispatch({ type: 'refreshed', generation: generationToRefresh, document: result.snapshot });
    } catch (error) {
      const native = toNativeError(error);
      // Nothing to do: the file has come back and the watcher will fire again.
      if (!shouldKeepLastPreview(native.kind)) return;
      dispatch({
        type: 'notice',
        notice: { message: native.message, failed: true },
      });
    }
  }, []);

  const reload = useCallback(() => {
    const current = documentRef.current;
    if (!current) return;
    void refresh(current.generation);
  }, [refresh]);

  const retry = useCallback(() => {
    retryRef.current?.();
  }, []);

  const dismissNotice = useCallback(() => {
    dispatch({ type: 'notice', notice: null });
  }, []);

  const showNotice = useCallback((notice: DocumentNotice) => {
    dispatch({ type: 'notice', notice });
  }, []);

  // ---- native events -------------------------------------------------------

  // The document was edited on disk.
  useEffect(() => {
    const listener = onDocumentChanged((event) => {
      void refresh(event.generation);
    });
    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, [refresh]);

  // The document was deleted: keep the last readable preview and say so.
  useEffect(() => {
    const handleUnavailable = (event: DocumentUnavailableEvent) => {
      if (event.generation !== documentRef.current?.generation) return;
      dispatch({
        type: 'notice',
        notice: {
          message:
            event.reason === 'not_found'
              ? `“${event.path}” is no longer on disk.`
              : 'The file could not be read, so the last readable version is shown.',
          detail: 'The preview updates automatically if the file comes back.',
          failed: true,
        },
      });
    };

    const missing = onDocumentMissing(handleUnavailable);
    const unavailable = onDocumentUnavailable(handleUnavailable);
    return () => {
      void missing.then((unlisten) => unlisten());
      void unavailable.then((unlisten) => unlisten());
    };
  }, []);

  // Explorer, a drop or a second launch asked for a different file.
  useEffect(() => {
    let active = true;

    const drain = async () => {
      const pending = await takePendingLaunch();
      if (!active || pending === null) return;
      open(pending);
    };

    const listener = onLaunchRequested(() => {
      void drain();
    });

    // A cold start has no event to wait for: the path is already queued.
    void drain();

    return () => {
      active = false;
      void listener.then((unlisten) => unlisten());
    };
  }, [open]);

  // Restore a document that survived a webview reload.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const existing = await activeDocument();
        if (active && existing) {
          dispatch({
            type: 'opened',
            requestId: requestCounter.current,
            document: existing,
          });
        }
      } catch {
        // A missing active document is the normal first-run case.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Release every object URL the session created when the surface goes away.
  useEffect(() => {
    return () => {
      assets.dispose();
    };
  }, [assets]);

  return {
    state: state.document,
    document,
    generation,
    notice: state.notice,
    assets,
    open,
    openFromDialog,
    openLink,
    reload,
    retry,
    dismissNotice,
    showNotice,
  };
}
