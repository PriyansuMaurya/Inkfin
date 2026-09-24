/**
 * The reading surface.
 *
 * Markdown is rendered with `react-markdown` and `remark-gfm`, which produce a
 * React element tree rather than an HTML string. Raw HTML in the source is never
 * parsed as HTML, `rehype-raw` is not used, and every attribute that reaches the
 * DOM is produced by a React element here — so no Markdown file can inject
 * markup, a script or an event handler.
 *
 * A module-level context supplies the renderers instead of a `components` object
 * rebuilt on each render. That keeps the renderer identities stable, so a
 * refresh does not unmount and remount the whole document.
 */

import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { DocumentAssets } from '../features/document/assets';
import type { HighlightTheme } from '../features/highlight/highlighter';
import { classifyLink, safeUrlTransform, slugifyHeading } from '../features/document/links';
import {
  captureScrollAnchor,
  planScroll,
  restoreScrollAnchor,
  type ScrollAnchor,
} from '../features/document/scrollAnchor';
import { CodeBlock } from './CodeBlock';
import { MarkdownImage } from './MarkdownImage';

type RenderContextValue = {
  assets: DocumentAssets;
  theme: HighlightTheme;
  revision: string;
  onOpenLink: (link: string) => Promise<string | null>;
  onExternalLink: (url: string) => void;
  onBlockedLink: (reason: string) => void;
  scrollToFragment: (fragment: string) => void;
  /** Reported by a code block once its text nodes have been replaced. */
  onRenderSettled: () => void;
};

const RenderContext = createContext<RenderContextValue | null>(null);

function useRenderContext(): RenderContextValue {
  const value = useContext(RenderContext);
  if (!value) {
    throw new Error('document renderers must be used inside the reading surface');
  }
  return value;
}

/** Flatten React children to their text, for heading anchors and code bodies. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

// ---------------------------------------------------------------- renderers

function Anchor({ href, children }: ComponentPropsWithoutRef<'a'>) {
  const { onOpenLink, onExternalLink, onBlockedLink, scrollToFragment } = useRenderContext();
  const target = classifyLink(href);

  if (target.kind === 'blocked') {
    // The text stays so the reader can see what the document claimed; only the
    // destination is refused. A button keeps it reachable by keyboard so the
    // reason can be explained on activation.
    return (
      <button
        type="button"
        className="md-link-blocked"
        title={target.reason}
        onClick={() => {
          onBlockedLink(target.reason);
        }}
      >
        {children}
      </button>
    );
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    switch (target.kind) {
      case 'external':
        onExternalLink(target.url);
        break;
      case 'fragment':
        scrollToFragment(target.id);
        break;
      case 'markdown': {
        const link =
          target.fragment === undefined
            ? target.path
            : `${target.path}#${encodeURIComponent(target.fragment)}`;
        void onOpenLink(link).then((fragment) => {
          if (fragment !== null && fragment !== '') scrollToFragment(fragment);
        });
        break;
      }
      default:
        break;
    }
  };

  return (
    <a
      href={target.kind === 'external' ? target.url : href}
      onClick={handleClick}
      rel="noreferrer noopener"
    >
      {children}
    </a>
  );
}

function Image({ src, alt }: ComponentPropsWithoutRef<'img'>) {
  const { assets, revision } = useRenderContext();
  return (
    <MarkdownImage
      reference={src ?? ''}
      alt={alt ?? ''}
      assets={assets}
      revision={revision}
    />
  );
}

/** Fenced code is handled at the `pre` level so the whole block is one card. */
function Pre({ children }: ComponentPropsWithoutRef<'pre'>) {
  const { theme, onRenderSettled } = useRenderContext();
  const first = Array.isArray(children) ? children[0] : children;

  if (!isValidElement<{ className?: string; children?: ReactNode }>(first)) {
    return <pre>{children}</pre>;
  }

  const className = first.props.className ?? '';
  const match = /language-([^\s]+)/.exec(className);
  const language = match?.[1] ?? '';

  return (
    <CodeBlock
      code={textOf(first.props.children)}
      language={language}
      theme={theme}
      onSettle={onRenderSettled}
    />
  );
}

function Table({ children }: ComponentPropsWithoutRef<'table'>) {
  // A wide table scrolls inside its own region, never the whole page.
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
      <table>{children}</table>
    </div>
  );
}

function Input(props: ComponentPropsWithoutRef<'input'>) {
  if (props.type !== 'checkbox') {
    // remark-gfm only ever emits checkboxes; anything else is passed through
    // rather than silently dropped.
    return <input {...props} />;
  }
  // Task boxes are a record of the document, never something the reader toggles.
  return <input type="checkbox" checked={Boolean(props.checked)} disabled readOnly />;
}

function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const;
  return function Heading({ children }: ComponentPropsWithoutRef<'h1'>) {
    const id = slugifyHeading(textOf(children));
    return <Tag id={id === '' ? undefined : id}>{children}</Tag>;
  };
}

const COMPONENTS: Components = {
  a: Anchor,
  img: Image,
  input: Input,
  pre: Pre,
  table: Table,
  h1: createHeading(1),
  h2: createHeading(2),
  h3: createHeading(3),
  h4: createHeading(4),
  h5: createHeading(5),
  h6: createHeading(6),
};

// ------------------------------------------------------------------- view

export type DocumentViewProps = {
  content: string;
  revision: string;
  theme: HighlightTheme;
  assets: DocumentAssets;
  /** Stable ref to the rendered document, shared with the search index. */
  rootRef: RefObject<HTMLElement | null>;
  /**
   * Writes the rendered document into `rootRef` and signals that it changed.
   * A callback ref, rather than an inline arrow, so React invokes it only when
   * the node actually mounts or unmounts.
   */
  attachRoot: (element: HTMLElement | null) => void;
  onOpenLink: (link: string) => Promise<string | null>;
  onExternalLink: (url: string) => void;
  onBlockedLink: (reason: string) => void;
  /**
   * Identity of the open file. A changed key means a different document, which
   * starts at the top rather than at the previous document's reading position.
   */
  documentKey: string;
  /** Signalled when a code block replaces its text nodes, for the search index. */
  onRenderSettled: () => void;
};

export function DocumentView({
  content,
  revision,
  theme,
  assets,
  rootRef,
  attachRoot,
  onOpenLink,
  onExternalLink,
  onBlockedLink,
  documentKey,
  onRenderSettled,
}: DocumentViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<ScrollAnchor | null>(null);
  // Which document, at which revision, the captured anchor belongs to.
  const positionRef = useRef<{ documentKey: string; revision: string } | null>(null);

  /** Scroll a heading or footnote into view without changing focus. */
  const scrollToFragment = useCallback(
    (fragment: string) => {
      const root = rootRef.current;
      if (!root) return;

      // Scoped to the rendered document, so the lookup cannot resolve to chrome.
      const byId = root.querySelector(`#${CSS.escape(fragment)}`);
      if (byId) {
        byId.scrollIntoView({ block: 'start', behavior: 'auto' });
        return;
      }

      // GitHub rewrites anchors to a slug, so match on the rendered text too.
      const wanted = slugifyHeading(fragment);
      for (const heading of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
        if (slugifyHeading(heading.textContent ?? '') === wanted) {
          heading.scrollIntoView({ block: 'start', behavior: 'auto' });
          return;
        }
      }
    },
    [rootRef],
  );

  const contextValue = useMemo<RenderContextValue>(
    () => ({
      assets,
      theme,
      revision,
      onOpenLink,
      onExternalLink,
      onBlockedLink,
      scrollToFragment,
      onRenderSettled,
    }),
    [
      assets,
      theme,
      revision,
      onOpenLink,
      onExternalLink,
      onBlockedLink,
      scrollToFragment,
      onRenderSettled,
    ],
  );

  // Keep a running note of where the reader is looking, so an automatic refresh
  // can put them back rather than jumping to the top.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      const root = rootRef.current;
      if (root) anchorRef.current = captureScrollAnchor(scroller, root);
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [rootRef]);

  // Order matters: the plan is computed before the position is remembered, so
  // a document switch cannot compare against a key it just overwrote.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const root = rootRef.current;
    if (!scroller || !root) return;

    const plan = planScroll(positionRef.current, { documentKey, revision });
    positionRef.current = { documentKey, revision };

    if (plan === 'top') {
      anchorRef.current = null;
      scroller.scrollTop = 0;
    } else if (plan === 'restore' && anchorRef.current) {
      restoreScrollAnchor(scroller, root, anchorRef.current);
    }

    anchorRef.current = captureScrollAnchor(scroller, root);
  }, [revision, documentKey, rootRef]);

  const empty = content.trim() === '';

  return (
    <div className="reader" ref={scrollerRef} id="reading-surface">
      <article className="document-column">
        <div className="document" ref={attachRoot}>
          {empty ? (
            <p className="document-empty">This document is empty.</p>
          ) : (
            <RenderContext.Provider value={contextValue}>
              <Markdown
                remarkPlugins={[remarkGfm]}
                urlTransform={safeUrlTransform}
                components={COMPONENTS}
              >
                {content}
              </Markdown>
            </RenderContext.Provider>
          )}
        </div>
      </article>
    </div>
  );
}
