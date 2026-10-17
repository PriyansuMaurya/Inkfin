# Acceptance fixture

Every construct the product claims to render, in one file. Open this file during row C1 of
[MACOS-ACCEPTANCE-RUN.md](../MACOS-ACCEPTANCE-RUN.md) and keep it open for C2–C6, E and F.

## Text and inline elements

Regular text with **bold**, *italic*, ~~strikethrough~~, `inline code`, an autolink
https://example.com and a manual [external link](https://example.org/path?q=1). A footnote
reference sits here.[^1]

[^1]: Footnotes are part of the GFM set the renderer enables.

## Lists

- First item
- Second item
  - Nested item
  - Another nested item
- Third item

1. Ordered one
2. Ordered two
3. Ordered three

- [x] Completed task
- [ ] Open task

## Table

| Column | Meaning | Value |
| --- | --- | --- |
| `alpha` | first | 1 |
| `beta` | second | 2 |
| `gamma` | third | 3 |

## Quote

> A blockquote with **emphasis** and a [link](https://example.com/quoted).
>
> A second paragraph inside the quote.

## Images

Relative image from this folder — should render:

![Relative diagram](diagram.png)

Missing relative image — should show alt text and a subtle indicator:

![Missing diagram](missing-diagram.png)

Remote image — should show the blocked placeholder and make no request:

![Remote diagram](https://example.com/remote-diagram.png)

## Code

Known language:

```ts
type Reader = {
  path: string;
  revision: string;
};

export function open(path: string, revision: string): Reader {
  return { path, revision };
}
```

Unknown language — plain text, no highlighting:

```not-a-real-language
alpha beta gamma
0123456789
```

Long line — should scroll inside the block, not widen the page:

```text
this-is-a-deliberately-long-single-line-of-text-that-should-scroll-horizontally-inside-the-code-block-instead-of-forcing-the-entire-reading-column-or-the-window-to-gain-a-horizontal-scrollbar-and-it-keeps-going-for-a-while-longer-than-the-760-pixel-column
```

Raw HTML — must render as inert text or be omitted, never executed:

<script>window.__inkfinXss = true</script>

## Ünïcode and spaces

A heading with non-ASCII characters, used to check anchor navigation. The status bar should
show the canonical path when the document lives in a folder whose name contains a space and a
non-ASCII character.

## Links to other documents

[Linked note](linked-note.md) should replace this document. A link to a non-Markdown local
file, [diagram](diagram.png), must be refused without executing anything.
