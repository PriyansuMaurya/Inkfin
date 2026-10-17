/**
 * Theme switching from the keyboard.
 *
 * The theme control is the one toolbar popover, and on macOS it sits next to a
 * native menu bar full of working menu keys. These tests pin the behaviour a
 * keyboard user needs: the menu opens on a real option, the arrow keys move
 * between the three choices, Space applies one, and Escape or Tab closes it
 * without stranding focus on an element that no longer exists.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemeMenu } from '../src/components/ThemeMenu';

function renderMenu(theme: 'light' | 'dark' | 'system' = 'light') {
  const onChange = vi.fn();
  render(<ThemeMenu theme={theme} resolvedTheme="light" onChange={onChange} />);
  return { onChange, trigger: screen.getByRole('button', { name: /^Theme: / }) };
}

describe('theme menu keyboard support', () => {
  it('opens on the current choice and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu('light');

    await user.click(trigger);

    expect(screen.getByRole('menu', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus();

    await user.keyboard('{ArrowUp}{ArrowUp}');
    // Wraps rather than stopping at the first option.
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
  });

  it('applies a theme with the keyboard and closes the menu', async () => {
    const user = userEvent.setup();
    const { onChange, trigger } = renderMenu('light');

    await user.click(trigger);
    await user.keyboard('{ArrowDown} ');

    expect(onChange).toHaveBeenCalledWith('dark');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu('dark');

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Tab instead of leaving the menu behind the page', async () => {
    const user = userEvent.setup();
    const { onChange, trigger } = renderMenu('light');

    await user.click(trigger);
    await user.tab();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
