/**
 * A fenced code block.
 *
 * Highlighting is asynchronous and entirely optional: the plain text is rendered
 * immediately and replaced by token spans only if Shiki produced them. A block
 * with an unknown language, an oversized body or a grammar that fails to load
 * therefore stays perfectly readable instead of showing an error.
 *
 * Tokens are rendered as React elements, never as an HTML string, so there is no
 * `dangerouslySetInnerHTML` anywhere in the product.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Check, Copy } from 'lucide-react';

import {
  highlightCode,
  type HighlightedLine,
  type HighlightedToken,
  type HighlightTheme,
} from '../features/highlight/highlighter';

type CodeBlockProps = {
  code: string;
  /** Fence label exactly as authored, e.g. `ts`, `python`, or `''`. */
  language: string;
  theme: HighlightTheme;
  /**
   * Called whenever this block's text nodes are replaced. Search holds ranges
   * that point at those nodes, so it needs to know the tree changed under it.
   */
  onSettle?: () => void;
};

/** How long the Copy button confirms success before returning to its label. */
const COPY_FEEDBACK_MS = 1600;

function tokenStyle(token: HighlightedToken): CSSProperties {
  const style: CSSProperties = {};
  if (token.color !== undefined) style.color = token.color;
  if (token.italic) style.fontStyle = 'italic';
  if (token.bold) style.fontWeight = 600;
  if (token.underline) style.textDecoration = 'underline';
  return style;
}

export function CodeBlock({ code, language, theme, onSettle }: CodeBlockProps) {
  const [lines, setLines] = useState<HighlightedLine[] | null>(null);
  const [copied, setCopied] = useState(false);
  const lastSettled = useRef<HighlightedLine[] | null>(null);

  useEffect(() => {
    let active = true;
    setLines(null);

    void highlightCode(code, language, theme).then((result) => {
      if (!active) return;
      setLines(result.status === 'highlighted' ? result.lines : null);
    });

    return () => {
      active = false;
    };
  }, [code, language, theme]);

  useEffect(() => {
    // Only when the rendered text actually changed, so a repaint loop is
    // impossible: this fires on plain -> highlighted and highlighted -> plain.
    if (lastSettled.current === lines) return;
    lastSettled.current = lines;
    onSettle?.();
  }, [lines, onSettle]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      // The exact code, with no highlighting markup and no trailing newline.
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard permission can be refused; the code stays selectable.
    }
  };

  const label = language.trim() === '' ? 'text' : language.trim();

  return (
    <div className="code-block" data-plain={lines === null ? 'true' : undefined}>
      {/* Language and Copy are chrome, so they are excluded from text search. */}
      <div className="code-block-header" data-search-exclude="true">
        <span className="code-block-language">{label}</span>
        <button
          type="button"
          className="btn code-copy"
          data-copied={copied ? 'true' : undefined}
          onClick={() => {
            void copy();
          }}
          aria-label={copied ? 'Code copied to clipboard' : `Copy ${label} code`}
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <pre>
        <code>
          {lines === null
            ? <span className="code-line">{code}</span>
            : lines.map((line, lineIndex) => (
                <span className="code-line" key={lineIndex}>
                  {line.map((token, tokenIndex) => (
                    <span key={tokenIndex} style={tokenStyle(token)}>
                      {token.content}
                    </span>
                  ))}
                </span>
              ))}
        </code>
      </pre>
    </div>
  );
}
