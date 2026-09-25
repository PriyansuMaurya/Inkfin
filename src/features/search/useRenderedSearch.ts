/**
 * Search controller for the reading surface.
 *
 * State is owned here rather than in the search field so a query and the active
 * match survive an automatic refresh, a theme change and a zoom change.
 *
 * One effect does all of the work in a single pass: read the visible text, find
 * the matches, paint the ranges, and reveal the active one only when the reader
 * asked for it. A single pass is what makes asynchronous syntax highlighting safe.
 * `CodeBlock` starts plain and swaps in token spans a tick later, so ranges must
 * be derived from the DOM as it is now rather than from an earlier snapshot.
 * Splitting this into "find matches" then "paint them" would also make the
 * reveal depend on which effect happened to run first, which is not a contract
 * worth relying on.
 *
 * Revealing is deliberately separate from rebuilding. An automatic refresh, a
 * theme change and a code block settling all replace nodes and must repaint the
 * highlights, but none of them is a reason to move the page under someone who is
 * reading a long document.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  applyHighlights,
  buildTextIndex,
  clearHighlights,
  findMatches,
  highlightsSupported,
  matchToRanges,
  scrollRangeIntoView,
} from './searchDom';

export type SearchController = {
  open: boolean;
  query: string;
  /** Total matches for the current query. `0` is shown explicitly. */
  matchCount: number;
  /** 1-based position of the active match, or 0 when there are none. */
  activePosition: number;
  /** False when the webview cannot paint highlights, so the UI can say so. */
  highlightsAvailable: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (value: string) => void;
  next: () => void;
  previous: () => void;
};

/**
 * @param rootRef  The rendered document root. Matches are found only inside it.
 * @param revision Content revision, used to rebuild the index after a refresh.
 * @param rootEpoch Bumped when the rendered root node appears or is replaced.
 *   A ref assignment does not re-render, so the index needs an explicit signal
 *   that the tree it indexes has changed identity.
 * @param renderEpoch Bumped when the document's nodes are replaced without a
 *   revision change, which happens when a code fence finishes highlighting or
 *   re-highlights for a new theme. Ranges hold text-node references, so the
 *   index must be re-derived once the swap has landed.
 * @param documentKey Identity of the open file. Opening another document is
 *   somewhere new, so the active match is revealed again rather than assumed to
 *   still be where the reader left it.
 */
export function useRenderedSearch(
  rootRef: RefObject<HTMLElement | null>,
  revision: string | null,
  rootEpoch: number,
  renderEpoch: number,
  documentKey: string,
): SearchController {
  const [open, setOpen] = useState(false);
  const [query, setQueryValue] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Probed once: the webview cannot gain the API part way through a session.
  const highlightsAvailable = useRef(highlightsSupported()).current;
  // Set only by something the reader did: typing, pressing next or previous, or
  // opening another file.
  const revealRef = useRef(false);
  const lastDocumentRef = useRef<string | null>(null);

  useEffect(() => {
    // Read and cleared before anything else, so a request made while there was
    // nothing to reveal cannot surface later against a document that matches.
    const reveal = revealRef.current || lastDocumentRef.current !== documentKey;
    revealRef.current = false;
    lastDocumentRef.current = documentKey;

    const root = rootRef.current;
    if (!open || !root) {
      setMatchCount(0);
      setActiveIndex(0);
      clearHighlights();
      return;
    }

    const index = buildTextIndex(root);
    const found = findMatches(index.text, query);
    setMatchCount(found.length);

    if (found.length === 0) {
      setActiveIndex(0);
      clearHighlights();
      return;
    }

    // Keep the reader on the same match across a refresh where possible; the
    // re-render this may cause is bounded, because the second pass finds the
    // index already clamped.
    const current = Math.min(activeIndex, found.length - 1);
    if (current !== activeIndex) setActiveIndex(current);

    const rangesPerMatch = found.map((match) => matchToRanges(index, match));
    applyHighlights(rangesPerMatch, current);

    if (reveal) {
      const active = rangesPerMatch[current];
      if (active?.[0]) scrollRangeIntoView(active[0]);
    }

    return () => {
      clearHighlights();
    };
  }, [open, query, activeIndex, documentKey, revision, rootRef, rootEpoch, renderEpoch]);

  const openSearch = useCallback(() => {
    setOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQueryValue('');
  }, []);

  const setQuery = useCallback((value: string) => {
    revealRef.current = true;
    setQueryValue(value);
  }, []);

  // With no matches there is nothing to move to, so the request is dropped here
  // rather than left armed: an unconsumed flag would fire on the next rebuild,
  // which could be an automatic refresh of a different document.
  const next = useCallback(() => {
    if (matchCount === 0) {
      revealRef.current = false;
      return;
    }
    revealRef.current = true;
    setActiveIndex((current) => (current + 1) % matchCount);
  }, [matchCount]);

  const previous = useCallback(() => {
    if (matchCount === 0) {
      revealRef.current = false;
      return;
    }
    revealRef.current = true;
    setActiveIndex((current) => (current - 1 + matchCount) % matchCount);
  }, [matchCount]);

  // Focus the field as soon as it appears, without stealing focus later.
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open]);

  return {
    open,
    query,
    matchCount,
    activePosition: matchCount === 0 ? 0 : activeIndex + 1,
    highlightsAvailable,
    inputRef,
    openSearch,
    closeSearch,
    setQuery,
    next,
    previous,
  };
}
