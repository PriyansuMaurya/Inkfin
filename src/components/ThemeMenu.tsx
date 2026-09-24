/**
 * Light / Dark / System selector.
 *
 * A small popover rather than a cycling button, so the current choice is always
 * readable and keyboard users can move between exactly three options. Closing on
 * Escape, outside click and selection keeps it out of the way.
 */

import { useEffect, useRef, useState } from 'react';

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

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = OPTIONS.find((option) => option.value === theme) ?? SYSTEM_OPTION;
  const CurrentIcon = current.Icon;

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
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
        <div className="menu" role="menu" aria-label="Theme">
          <span className="menu-heading">Theme</span>
          {OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className="menu-item"
              role="menuitemradio"
              aria-checked={theme === value}
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="menu-item-label">{label}</span>
              {theme === value && <Check size={14} className="menu-check" aria-hidden="true" />}
            </button>
          ))}
          {theme === 'system' && (
            <span className="menu-note">Following Windows: currently {resolvedTheme}</span>
          )}
        </div>
      )}
    </div>
  );
}
