/**
 * Find bar for the rendered document.
 *
 * Sits below the toolbar without covering the document, reports the match count
 * explicitly (including `0 results`), and supports Enter / Shift+Enter and the
 * platform find shortcut. The count is announced politely so a screen reader
 * hears an update once per change rather than on every keystroke burst.
 */

import { useEffect, useState } from 'react';

import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

import type { SearchController } from '../features/search/useRenderedSearch';

type SearchBarProps = {
  search: SearchController;
};

export function SearchBar({ search }: SearchBarProps) {
  const [announcement, setAnnouncement] = useState('');

  // One announcement source. Opening search speaks immediately, typing is
  // debounced so a burst of keystrokes is not read out match by match.
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        if (search.query === '') {
          setAnnouncement('Find in document. Type to search.');
          return;
        }
        if (search.matchCount === 0) {
          setAnnouncement('0 results');
          return;
        }
        setAnnouncement(`${search.matchCount} results, showing ${search.activePosition}`);
      },
      search.query === '' ? 0 : 250,
    );
    return () => window.clearTimeout(timer);
  }, [search.query, search.matchCount, search.activePosition]);

  const hasQuery = search.query !== '';
  const none = hasQuery && search.matchCount === 0;

  return (
    <div className="search-bar" data-search-exclude="true">
      <div className="search-field">
        <span className="search-field-icon">
          <Search size={15} aria-hidden="true" />
        </span>
        <input
          ref={search.inputRef}
          className="search-input"
          type="text"
          value={search.query}
          placeholder="Find in document"
          aria-label="Find in document"
          aria-describedby="search-count"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) {
                search.previous();
              } else {
                search.next();
              }
            }
          }}
        />
      </div>

      {/* Not a live region: the debounced announcement below is the only
          spoken feedback, so a typing burst is never read out match by match. */}
      <span
        className="search-count"
        id="search-count"
        data-empty={none ? 'true' : undefined}
      >
        {hasQuery
          ? none
            ? '0 results'
            : `${search.activePosition} of ${search.matchCount}`
          : ''}
      </span>

      <button
        type="button"
        className="btn btn-icon"
        onClick={search.previous}
        disabled={search.matchCount === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-icon"
        onClick={search.next}
        disabled={search.matchCount === 0}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-icon"
        onClick={search.closeSearch}
        aria-label="Close search"
        title="Close (Escape)"
      >
        <X size={16} aria-hidden="true" />
      </button>

      {/* Spoken feedback; `role="status"` already implies a polite live region. */}
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
    </div>
  );
}
