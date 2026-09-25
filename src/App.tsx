/**
 * Application shell.
 *
 * Composes the controller, preferences and search into the window: toolbar,
 * optional search bar, optional notice, the reading surface and the status
 * strip. Native side effects are confined to effects here; rendering stays pure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { FileWarning, FolderOpen, RotateCw } from 'lucide-react';

import { onFileDrop } from './bridge/events';
import { openExternalLink } from './bridge/native';
import { DocumentView } from './components/DocumentView';
import { EmptyState } from './components/EmptyState';
import { Notice } from './components/Notice';
import { SearchBar } from './components/SearchBar';
import { Toolbar } from './components/Toolbar';
import { useDocumentController } from './features/document/documentController';
import { formatZoom } from './features/preferences/preferences';
import { usePreferences } from './features/preferences/usePreferences';
import { useRenderedSearch } from './features/search/useRenderedSearch';

const MARKDOWN_PATTERN = /\.(md|markdown)$/i;

/** Window in which code blocks finishing at different times count as one change. */
const SETTLE_COALESCE_MS = 60;

export function App() {
  const preferences = usePreferences();
  const controller = useDocumentController();
  const [dragging, setDragging] = useState(false);

  // One stable ref for the rendered document, shared with the search index. The
  // epoch exists because a ref assignment does not re-render: search needs to
  // know when the element it indexes has actually appeared or been replaced.
  const rootRef = useRef<HTMLElement | null>(null);
  const [rootEpoch, setRootEpoch] = useState(0);
  const attachRoot = useCallback((element: HTMLElement | null) => {
    rootRef.current = element;
    setRootEpoch((value) => value + 1);
  }, []);

  // Bumped whenever a code fence swaps its text nodes for token spans (initial
  // highlight, theme change, or a failed highlight falling back to plain text).
  // Search ranges hold those nodes, so the index has to be re-derived after.
  //
  // Coalesced: a refresh settles every fence on the page, and each one would
  // otherwise cost a full re-index of the document. One bump per quiet burst
  // keeps that to a single pass, and the delay is below what a reader notices.
  const [renderEpoch, setRenderEpoch] = useState(0);
  const settleTimerRef = useRef<number | null>(null);
  const onRenderSettled = useCallback(() => {
    if (settleTimerRef.current !== null) return;
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setRenderEpoch((value) => value + 1);
    }, SETTLE_COALESCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  const document = controller.document;
  const documentKey = document?.canonicalPath ?? '';
  const search = useRenderedSearch(
    rootRef,
    document?.revision ?? null,
    rootEpoch,
    renderEpoch,
    documentKey,
  );

  // ---- window title --------------------------------------------------------

  // The filename is the only thing distinguishing two open windows, so it is
  // mirrored into the native title bar rather than only drawn in the toolbar.
  useEffect(() => {
    const title = document ? `${document.name} - Inkfin` : 'Inkfin';
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {
        // Cosmetic only; never surface a failure to set the title.
      });
  }, [document]);

  // ---- notices -------------------------------------------------------------

  const reportBlockedLink = useCallback(
    (reason: string) => {
      controller.showNotice({
        message: 'That link was not opened.',
        detail: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`,
        failed: false,
      });
    },
    [controller],
  );

  const openExternal = useCallback(
    (url: string) => {
      void openExternalLink(url).catch(() => {
        controller.showNotice({
          message: 'The browser could not be opened.',
          detail: 'The link was validated but Windows refused to launch it.',
          failed: true,
        });
      });
    },
    [controller],
  );

  // ---- drag and drop -------------------------------------------------------

  useEffect(() => {
    const listener = onFileDrop({
      onDragActive: () => setDragging(true),
      onDragEnded: () => setDragging(false),
      onDrop: (paths) => {
        setDragging(false);
        if (paths.length === 0) return;

        // Only one document can be on screen, so the first Markdown file wins.
        const target = paths.find((path) => MARKDOWN_PATTERN.test(path)) ?? paths[0];
        if (target === undefined) return;

        if (paths.length > 1) {
          controller.showNotice({
            message: `Opening ${baseName(target)}.`,
            detail: `This reader shows one document at a time, so the other ${
              paths.length - 1
            } dropped file${paths.length - 1 === 1 ? '' : 's'} were ignored.`,
            failed: false,
          });
        }

        controller.open(target);
      },
    });

    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, [controller]);

  // ---- keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (search.open) {
          event.preventDefault();
          search.closeSearch();
          return;
        }
        if (controller.notice) {
          event.preventDefault();
          controller.dismissNotice();
        }
        return;
      }

      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      switch (event.key) {
        case 'o':
        case 'O':
          event.preventDefault();
          void controller.openFromDialog();
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          search.openSearch();
          break;
        case 'r':
        case 'R':
          // Keep the webview from reloading itself and losing the session.
          event.preventDefault();
          controller.reload();
          break;
        case '=':
        case '+':
          event.preventDefault();
          preferences.zoomIn();
          break;
        case '-':
        case '_':
          event.preventDefault();
          preferences.zoomOut();
          break;
        case '0':
          event.preventDefault();
          preferences.resetZoom();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, preferences, search]);

  // ---- derived view state --------------------------------------------------

  const view = useMemo(() => {
    if (document) {
      return {
        kind: 'document' as const,
        content: document.content,
        revision: document.revision,
      };
    }
    if (controller.state.status === 'error') {
      return { kind: 'error' as const, error: controller.state.error };
    }
    if (controller.state.status === 'loading') {
      return { kind: 'loading' as const };
    }
    return { kind: 'empty' as const };
  }, [controller.state, document]);

  const directory = document ? parentDirectory(document.canonicalPath) : null;
  const emptyDocument = document !== null && document.content.trim() === '';

  return (
    <div className="app">
      <Toolbar
        fileName={document?.name ?? null}
        directory={directory}
        zoom={preferences.zoom}
        canZoomIn={preferences.canZoomIn}
        canZoomOut={preferences.canZoomOut}
        theme={preferences.theme}
        resolvedTheme={preferences.resolvedTheme}
        searchOpen={search.open}
        busy={!preferences.ready}
        onOpen={() => {
          void controller.openFromDialog();
        }}
        onReload={controller.reload}
        onSearch={search.openSearch}
        onZoomIn={preferences.zoomIn}
        onZoomOut={preferences.zoomOut}
        onResetZoom={preferences.resetZoom}
        onThemeChange={preferences.setTheme}
      />

      {search.open && document && <SearchBar search={search} />}

      {controller.notice && (
        <Notice
          notice={controller.notice}
          onRetry={controller.retry}
          onDismiss={controller.dismissNotice}
        />
      )}

      {view.kind === 'document' && (
        <DocumentView
          content={view.content}
          revision={view.revision}
          theme={preferences.resolvedTheme}
          assets={controller.assets}
          rootRef={rootRef}
          attachRoot={attachRoot}
          onOpenLink={controller.openLink}
          onExternalLink={openExternal}
          onBlockedLink={reportBlockedLink}
          documentKey={documentKey}
          onRenderSettled={onRenderSettled}
        />
      )}

      {view.kind === 'empty' && (
        <EmptyState
          busy={!preferences.ready}
          onOpen={() => {
            void controller.openFromDialog();
          }}
        />
      )}

      {view.kind === 'loading' && (
        <div className="reader">
          <div className="document-column">
            <p className="document-empty" role="status">
              Opening document…
            </p>
          </div>
        </div>
      )}

      {view.kind === 'error' && (
        <div className="error-state">
          <span className="empty-state-icon">
            <FileWarning size={40} strokeWidth={1.25} aria-hidden="true" />
          </span>
          <h1 className="empty-state-title">That file could not be opened</h1>
          <p className="empty-state-copy" role="alert">
            {view.error.message}
          </p>
          <div className="error-state-actions">
            <button type="button" className="btn btn-primary" onClick={controller.retry}>
              <RotateCw size={15} aria-hidden="true" />
              <span>Try again</span>
            </button>
            <button
              type="button"
              className="btn btn-large"
              onClick={() => {
                void controller.openFromDialog();
              }}
            >
              <FolderOpen size={15} aria-hidden="true" />
              <span>Open another file</span>
            </button>
          </div>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <span>Drop a Markdown file to open it</span>
        </div>
      )}

      <footer className="status">
        <span className="status-item status-item-grow">
          {document ? document.canonicalPath : 'No document open'}
        </span>
        {emptyDocument && <span className="status-item status-warning">Empty document</span>}
        <span className="status-item status-item-fixed">Zoom {formatZoom(preferences.zoom)}</span>
      </footer>
    </div>
  );
}

/** Directory portion of a canonical path, for the toolbar's quiet context. */
function parentDirectory(path: string): string | null {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index > 0 ? path.slice(0, index) : null;
}

function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index === -1 ? path : path.slice(index + 1);
}
