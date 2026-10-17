/**
 * Relative images, resolved against the open document.
 *
 * Regression test for a first-paint race found in the packaged Windows build:
 * a child effect runs before its parent's, so every image in the first render
 * asked the asset cache for bytes while no document generation had been
 * published yet. The cache answered "No document is open." and the image stayed
 * broken for the lifetime of the document, because nothing changed its
 * reference afterwards.
 *
 * The cache must therefore wait for the generation that is coming, not report a
 * missing image.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge/native', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/bridge/native');
  return { ...actual, readRelativeImage: vi.fn() };
});

import { readRelativeImage } from '../src/bridge/native';
import { DocumentAssets } from '../src/features/document/assets';
import { MarkdownImage } from '../src/components/MarkdownImage';

const readRelativeImageMock = vi.mocked(readRelativeImage);

beforeEach(() => {
  readRelativeImageMock.mockReset();
  readRelativeImageMock.mockResolvedValue({
    mime: 'image/png',
    revision: 'revision-1',
    bytes: 4,
    dataBase64: 'iVBORw0KGgo=',
  });
  // jsdom has no object-URL implementation for blobs.
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:inkfin/asset'),
    revokeObjectURL: vi.fn(),
  });
});

function renderImage(assets: DocumentAssets, reference = 'diagram.png', alt = 'Relative diagram') {
  return render(
    <MarkdownImage reference={reference} alt={alt} assets={assets} revision="revision-1" />,
  );
}

describe('a relative image', () => {
  it('loads once the document generation is published, even though it mounted first', async () => {
    const assets = new DocumentAssets();
    const { container } = renderImage(assets);

    // The document arrives after the first paint, exactly as the controller does it.
    expect(container.querySelector('img')).toBeNull();
    assets.setGeneration(7);

    await waitFor(() => expect(container.querySelector('img.md-image')).not.toBeNull());
    expect(container.querySelector('img.md-image')?.getAttribute('src')).toBe('blob:inkfin/asset');
    expect(readRelativeImageMock).toHaveBeenCalledWith(7, 'diagram.png');
  });

  it('loads immediately when the generation is already known', async () => {
    const assets = new DocumentAssets();
    assets.setGeneration(3);

    const { container } = renderImage(assets);

    await waitFor(() => expect(container.querySelector('img.md-image')).not.toBeNull());
  });

  it('reports a missing image once the document is known and the read fails', async () => {
    readRelativeImageMock.mockRejectedValue({
      kind: 'not_found',
      message: 'The file could not be found.',
    });
    const assets = new DocumentAssets();
    assets.setGeneration(4);

    renderImage(assets, 'missing-diagram.png', 'Missing diagram');

    const placeholder = await screen.findByRole('img', { name: /Missing diagram/i });
    expect(placeholder.getAttribute('data-state')).toBe('missing');
  });

  it('keeps a policy refusal distinct from a missing file', async () => {
    const assets = new DocumentAssets();
    assets.setGeneration(5);

    renderImage(assets, 'https://example.com/tracker.png', 'Remote diagram');

    const placeholder = await screen.findByRole('img', { name: /Remote diagram/i });
    expect(placeholder.getAttribute('data-state')).toBe('blocked');
    expect(readRelativeImageMock).not.toHaveBeenCalled();
  });

  it('does not hang for a request that was waiting when the cache was disposed', async () => {
    const assets = new DocumentAssets();
    const pending = assets.resolve('diagram.png');

    assets.dispose();

    await expect(pending).resolves.toEqual({ status: 'missing', message: 'No document is open.' });
  });

  it('re-reads the reference for a new generation instead of reusing the old bytes', async () => {
    const assets = new DocumentAssets();
    assets.setGeneration(1);
    const first = await assets.resolve('diagram.png');
    expect(first.status).toBe('ready');

    assets.setGeneration(2);
    await assets.resolve('diagram.png');

    expect(readRelativeImageMock).toHaveBeenCalledTimes(2);
    expect(readRelativeImageMock).toHaveBeenLastCalledWith(2, 'diagram.png');
  });
});
