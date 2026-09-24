/**
 * The state shown before anything is open.
 *
 * Deliberately sparse: a file icon, one instruction, one action. No recent-file
 * tiles, no onboarding and no marketing copy, because the primary workflow is
 * double-click, read, close.
 */

import { FileText, FolderOpen } from 'lucide-react';

type EmptyStateProps = {
  onOpen: () => void;
  busy: boolean;
};

export function EmptyState({ onOpen, busy }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <FileText size={44} strokeWidth={1.25} aria-hidden="true" />
      </span>

      <h1 className="empty-state-title">Open a Markdown file</h1>

      <p className="empty-state-copy">
        Drag a <code>.md</code> or <code>.markdown</code> file anywhere onto this window, or choose
        one from your computer.
      </p>

      <button
        type="button"
        className="btn btn-primary btn-large"
        onClick={onOpen}
        disabled={busy}
      >
        <FolderOpen size={16} aria-hidden="true" />
        <span>Open file</span>
      </button>

      <p className="empty-state-hint">Read-only. Nothing is written to your files.</p>
    </div>
  );
}
