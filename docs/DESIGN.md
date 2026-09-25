# Markdown Preview - Visual System

**Direction:** Minimal native-feeling document preview. Content carries the hierarchy; controls are quiet and always discoverable. Windows system window chrome remains native in the MVP.

## Colour tokens

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Primary | `#2563EB` | `#60A5FA` | Interactive links, active search border |
| Secondary | `#475569` | `#94A3B8` | Supporting text and icons |
| Background | `#FAFAFA` | `#171A20` | Window surface |
| Document | `#FFFFFF` | `#1E222A` | Reading canvas |
| Text | `#17202E` | `#F1F5F9` | Main copy |
| Muted | `#64748B` | `#A8B3C4` | Status/metadata |
| Border | `#E2E8F0` | `#363E4B` | Separators |
| Accent | `#E7F0FF` | `#233956` | Quiet hover/selection |
| Code surface | `#F1F5F9` | `#242B36` | Code blocks |
| Warning | `#92400E` | `#FBBF24` | Missing-file notice |
| Search match | `#FDE68A` | `#775C1B` | Non-active matches |

Use semantic CSS custom properties, not arbitrary component colours. Choose Shiki themes that maintain contrast with their code surfaces. Never communicate a warning through colour alone. Confirm text, controls and focus contrast against WCAG AA targets in both palettes.

## Typography
- UI: `Segoe UI Variable`, `Segoe UI`, system sans-serif; document: `Inter` if bundled locally, otherwise system sans-serif. Avoid remote font requests. Code: `Cascadia Code`, `Consolas`, monospace.
- UI title: 14 px / 20 px, semibold. Toolbar labels: 13 px / 18 px. Status: 12 px / 16 px.
- Document body: 16 px / 26 px at 100%; H1 32/40 semibold; H2 24/32 semibold; H3 20/28 semibold; H4–H6 16–18/26 semibold. Code 13/20.
- At zoom 75–200%, scale document typography and media proportionally; preserve toolbar typography. Let long words wrap when safe; constrain code/tables to their own horizontal scroll region.

## Layout and spacing
- Initial window 900 × 650 px; minimum 480 × 360 px. Toolbar 52 px; status strip 28 px; document width max 760 px; document horizontal padding 40 px desktop and 20 px narrow; top padding 44 px.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Paragraph gap 16 px; heading top gap 32 px, bottom gap 12 px; list indentation 24 px.
- Surfaces: toolbar and status use subtle 1 px separators. No permanent sidebar, card grid or strong drop shadows. A focused document can use a very soft shadow `0 2px 12px rgba(16,24,40,.05)` in light mode only; remove it at narrow widths.

## Components and states
- **Open button:** filled primary or neutral high-contrast action in empty state; minimum 40 px height, radius 8 px. Hover, focus, pressed and disabled states distinct.
- **Toolbar icon buttons:** 36 × 36 px minimum hit target with 8 px radius, accessible name and `title`; group zoom − / percentage / +. The native title bar is separate.
- **Search field:** appears below toolbar without covering body; 36 px height, 8 px radius, visible match count and previous/next/close controls. `0 results` must be explicit.
- **Notices:** brief inline notice beneath toolbar for missing file, blocked image or multi-drop; never modal for routine errors. Include retry/open action for unrecoverable document read failures.
- **Document:** consistent Markdown rhythm; tables with subtle row rules and scoped overflow; checkboxes are read-only; links visibly underlined on hover/focus and distinguishable without colour alone; blockquotes show a quiet left rule.
- **Code block:** top strip with language and Copy button; 8 px radius; text selection retained; overflow limited to block; Copy shows brief success feedback.
- **Images:** fit content width while preserving aspect ratio; alt text plus missing indicator if unavailable. Never fetch remote media silently.
- **Empty state:** centred file icon, heading “Open a Markdown file”, short drop instruction and Open file action. Avoid onboarding, recent file tiles and marketing copy.

## Accessibility and responsive checks
Focus ring 2 px primary with 2 px offset; keyboard order matches visual order. Avoid animation beyond 150 ms and honour reduced-motion preference. At 480 × 360 px, toolbar actions remain reachable via compact overflow menu if necessary; open/search/zoom/theme cannot disappear entirely. Check 480, 900 and 1440 px widths at 75%, 100% and 200% document zoom in both themes. Screen readers should announce filename changes, search count and warnings without repeated refresh spam.
