/**
 * Brief inline notice beneath the toolbar.
 *
 * Notices report routine, recoverable problems — a missing file, a blocked
 * image, a dropped bundle — without a modal and without displacing the document.
 * They are announced politely so a screen reader hears them once, and they never
 * carry raw OS text.
 */

import { Info, RotateCw, TriangleAlert, X } from 'lucide-react';

import type { DocumentNotice } from '../features/document/documentTypes';

type NoticeProps = {
  notice: DocumentNotice;
  onRetry: () => void;
  onDismiss: () => void;
};

export function Notice({ notice, onRetry, onDismiss }: NoticeProps) {
  return (
    <div
      className="notice"
      // `polite` keeps the reading position: an automatic refresh must not
      // interrupt whatever the screen reader is currently saying.
      role="status"
      aria-live="polite"
    >
      <span className="notice-icon">
        {notice.failed ? (
          <TriangleAlert size={16} aria-hidden="true" />
        ) : (
          <Info size={16} aria-hidden="true" />
        )}
      </span>

      <div className="notice-body">
        <span className="notice-message">{notice.message}</span>
        {notice.detail !== undefined && <span className="notice-detail">{notice.detail}</span>}
      </div>

      <div className="notice-actions">
        {notice.retryable && (
          <button type="button" className="btn" onClick={onRetry}>
            <RotateCw size={13} aria-hidden="true" />
            <span>Try again</span>
          </button>
        )}
        <button
          type="button"
          className="btn btn-icon"
          onClick={onDismiss}
          aria-label="Dismiss notice"
          title="Dismiss"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
