/**
 * A single image reference inside the document.
 *
 * The reference comes from untrusted Markdown, so it is never turned into a URL
 * directly: it is classified first, then resolved to a bounded, validated byte
 * read through the native bridge. Remote references are refused outright, which
 * is what makes "no network fetches" a property of the product rather than a
 * promise.
 */

import { useEffect, useState } from 'react';

import { ImageOff } from 'lucide-react';

import type { AssetResult, DocumentAssets } from '../features/document/assets';
import { isLocalReference } from '../features/document/assets';

type MarkdownImageProps = {
  reference: string;
  alt: string;
  assets: DocumentAssets;
  revision: string;
};

type ImageState = AssetResult | { status: 'loading' };

export function MarkdownImage({ reference, alt, assets, revision }: MarkdownImageProps) {
  const [state, setState] = useState<ImageState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    if (!isLocalReference(reference)) {
      setState({
        status: 'blocked',
        message: 'Remote and non-file images are not loaded by this reader.',
      });
      return;
    }

    setState({ status: 'loading' });
    void assets.resolve(reference).then((result) => {
      if (active) setState(result);
    });

    return () => {
      active = false;
    };
    // `revision` re-resolves the reference after the document is refreshed, so an
    // image that appears in a save also appears in the preview.
  }, [reference, assets, revision]);

  if (state.status === 'ready') {
    return <img className="md-image" src={state.url} alt={alt} decoding="async" />;
  }

  const label = alt.trim() === '' ? reference : alt;
  const blocked = state.status === 'blocked';
  const message = state.status === 'loading' ? 'Loading image…' : state.message;

  return (
    <span
      className="md-image-placeholder"
      data-state={blocked ? 'blocked' : 'missing'}
      // The placeholder replaces the image, so the alt text and the reason are
      // what a screen reader needs to hear.
      role="img"
      aria-label={`${label}: ${message}`}
      title={message}
    >
      <ImageOff size={13} aria-hidden="true" />
      <span className="md-image-placeholder-text">{label}</span>
    </span>
  );
}
