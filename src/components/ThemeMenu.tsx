/**
 * Light / Dark / System selector.
 *
 * A small popover rather than a cycling button, so the current choice is always
 * readable. It behaves like a native menu on both platforms: opening puts focus
 * on the current choice, Arrow/Home/End move between the three options, Space or
 * Enter selects, and Escape or Tab closes it and hands focus back to the trigger
 * so keyboard position is never lost. An outside click still dismisses it.
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Check, Monitor, Moon, Sun } from 'lucide-react';

import type { ResolvedTheme, ThemePreference } from '../features/preferences/preferences';

type ThemeMenuProps = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChange: (theme: ThemePreference) => void;
};

type ThemeOption = { value: ThemePreference; label: string; Icon: typeof Sun };

const SYSTEM_OPTION: ThemeOption = { value: 'system', label: 'System', Icon: Monitor };

const OPTIONS: readonly ThemeOption[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  SYSTEM_OPTION,
];

export function ThemeMenu({ theme, resolvedTheme, onChange }: ThemeMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /** Close and put focus back where it came from. */
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    // Opening as a menu always lands on a real item: without this, the first
    // Tab or Arrow key would move focus through the trigger and the page
    // behind the popover instead of through its options.
    const selected = OPTIONS.findIndex((option) => option.value === theme);
    (itemRefs.current[selected] ?? itemRefs.current[0])?.focus();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, theme]);

  /**
   * Roving focus inside the popover.
   *
   * Tab is intercepted deliberately: the menu is closed either way, but letting
   * the browser move on from an item that is about to be unmounted would drop
   * focus on the body. Closing first and returning to the trigger means the next
   * Tab step continues from the toolbar.
   */
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (items.length === 0) return;
    const index = items.findIndex((item) => item === document.activeElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Tab':
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  };

  const current = OPTIONS.find((option) => option.value === theme) ?? SYSTEM_OPTION;
  const CurrentIcon = current.Icon;

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-icon"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${current.label}`}
        title={`Theme: ${current.label}`}
      >
        <CurrentIcon size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className="menu" role="menu" aria-label="Theme" onKeyDown={onMenuKeyDown}>
          <span className="menu-heading">Theme</span>
          {OPTIONS.map(({ value, label, Icon }, index) => (
            <button
              key={value}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              className="menu-item"
              role="menuitemradio"
              aria-checked={theme === value}
              onClick={() => {
                onChange(value);
                // Closing through the trigger keeps the keyboard on the control
                // that opened the menu, whether the choice came from a click or
                // from Space on a focused option.
                close();
              }}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="menu-item-label">{label}</span>
              {theme === value && <Check size={14} className="menu-check" aria-hidden="true" />}
            </button>
          ))}
          {theme === 'system' && (
            <span className="menu-note">Following the system: currently {resolvedTheme}</span>
          )}
        </div>
      )}
    </div>
  );
}
