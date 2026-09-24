/**
 * Code block behaviour.
 *
 * F3 requires that Copy yields the exact code and that the language label and
 * Copy control are chrome rather than document content.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CodeBlock } from '../src/components/CodeBlock';

const CODE = 'function add(a, b) {\n  return a + b;\n}';

function mockClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe('code block', () => {
  it('copies the exact code with no markup or added whitespace', async () => {
    const writeText = mockClipboard();
    render(<CodeBlock code={CODE} language="javascript" theme="light" />);

    await userEvent.click(screen.getByRole('button', { name: /copy javascript code/i }));

    expect(writeText).toHaveBeenCalledWith(CODE);
  });

  it('confirms the copy and then returns to its resting label', async () => {
    mockClipboard();
    render(<CodeBlock code="x" language="ts" theme="light" />);

    await userEvent.click(screen.getByRole('button', { name: /copy ts code/i }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /code copied to clipboard/i })).toBeInTheDocument();
  });

  it('shows the language label and excludes chrome from text search', () => {
    const { container } = render(<CodeBlock code="x" language="python" theme="dark" />);

    expect(screen.getByText('python')).toBeInTheDocument();
    // The language label and Copy button are chrome, not document content.
    expect(container.querySelector('.code-block-header')).toHaveAttribute(
      'data-search-exclude',
      'true',
    );
  });

  it('renders plain text when the language has no grammar', async () => {
    const { container } = render(<CodeBlock code={CODE} language="notalanguage" theme="light" />);

    await waitFor(() => {
      expect(container.querySelector('.code-block')).toHaveAttribute('data-plain', 'true');
    });
    expect(container.textContent).toContain('function add(a, b) {');
  });
});
