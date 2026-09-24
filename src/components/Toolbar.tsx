/**
 * The single row of controls above the document.
 *
 * Layout follows the design contract: the filename on the left, then the quiet
 * actions, with search, zoom and theme grouped at the right. The window chrome itself
 * stays native, so there is no title bar to reproduce here. At narrow widths the
 * textual labels drop away but no action ever disappears.
 */

import { FileText, FolderOpen, Minus, Plus, RotateCw, Search } from 'lucide-react';

import type { ResolvedTheme, ThemePreference } from '../features/preferences/preferences';
import { formatZoom } from '../features/preferences/preferences';
import { ThemeMenu } from './ThemeMenu';

type ToolbarProps = {
  /** Base name of the open document, or null before anything is open. */
  fileName: string | null;
  /** Folder the document came from, shown as quiet context. */
  directory: string | null;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  searchOpen: boolean;
  busy: boolean;
  onOpen: () => void;
  onReload: () => void;
  onSearch: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onThemeChange: (theme: ThemePreference) => void;
};

export function Toolbar({
  fileName,
  directory,
  zoom,
  canZoomIn,
  canZoomOut,
  theme,
  resolvedTheme,
  searchOpen,
  busy,
  onOpen,
  onReload,
  onSearch,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onThemeChange,
}: ToolbarProps) {
  const hasDocument = fileName !== null;

  return (
    <header className="toolbar">
      <button
        type="button"
        className="btn btn-open-file"
        onClick={onOpen}
        disabled={busy}
        title="Open a Markdown file (Ctrl+O)"
      >
        <FolderOpen size={16} aria-hidden="true" />
        <span className="btn-label">Open</span>
      </button>

      {hasDocument && (
        <>
          <span className="toolbar-divider" aria-hidden="true" />

          <div className="toolbar-filename" title={directory ?? undefined}>
            <FileText size={15} className="toolbar-filename-icon" aria-hidden="true" />
            <span className="toolbar-filename-text">{fileName}</span>
            {directory !== null && (
              <span className="toolbar-filename-path" aria-hidden="true">
                {directory}
              </span>
            )}
          </div>

          <button
            type="button"
            className="btn btn-icon"
            onClick={onReload}
            title="Reload from disk (Ctrl+R)"
            aria-label="Reload from disk"
          >
            <RotateCw size={16} aria-hidden="true" />
          </button>

        </>
      )}

      <span className="toolbar-spacer" />

      {hasDocument && (
        <button
          type="button"
          className="btn btn-icon"
          onClick={onSearch}
          aria-pressed={searchOpen}
          title="Find in document (Ctrl+F)"
          aria-label="Find in document"
        >
          <Search size={16} aria-hidden="true" />
        </button>
      )}

      <div className="zoom-group" role="group" aria-label="Document zoom">
        <button
          type="button"
          className="btn btn-icon"
          onClick={onZoomOut}
          disabled={!canZoomOut}
          title="Zoom out (Ctrl+-)"
          aria-label="Zoom out"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn zoom-value"
          onClick={onResetZoom}
          title="Reset zoom to 100% (Ctrl+0)"
          aria-label={`Document zoom ${formatZoom(zoom)}. Reset to 100%`}
        >
          {formatZoom(zoom)}
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onZoomIn}
          disabled={!canZoomIn}
          title="Zoom in (Ctrl++)"
          aria-label="Zoom in"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>

      <span className="toolbar-divider" aria-hidden="true" />

      <ThemeMenu theme={theme} resolvedTheme={resolvedTheme} onChange={onThemeChange} />
    </header>
  );
}
