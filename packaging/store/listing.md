# Inkfin — Microsoft Store listing draft

Status: prepared from source at 367cb75. Not submitted; Store identity is reserved; installed-MSIX validation is outstanding. Review all fields in Partner Center before submission.

## Listing fields

| Field | Value |
| --- | --- |
| Name | Inkfin Markdown Viewer |
| Language | English (United States), en-US |
| Category | Productivity |
| Short description | Read local Markdown files with syntax highlighting, search, themes and live refresh. |
| Website | https://inkfin.maurya.ie/ |
| Privacy policy | https://inkfin.maurya.ie/privacy/ — publish and verify before submission |
| Support | https://inkfin.maurya.ie/support/ — publish and verify before submission |
| Suggested keywords | Markdown; Markdown viewer; GFM; README; document reader; syntax highlighting; offline |
| Suggested price | Free, consistent with the current website; confirm in Partner Center |
| Store package hardware/OS | x64 Windows 11, Microsoft Edge WebView2 required |

## Description

Read Markdown without opening an editor.

Inkfin turns a local .md or .markdown file into a clean, readable document. Open a README, technical note or instruction file, then search its visible text, adjust the reading size and choose a light, dark or system theme.

• GitHub Flavoured Markdown: tables, lists, task boxes, links and fenced code.
• Syntax highlighting with a copy button for code blocks.
• Find in document with match counts and keyboard navigation.
• Document zoom from 75% to 200%.
• Automatic refresh when another application saves the file.
• Open from the toolbar, drag and drop, or Windows Open with.

Your files stay local. Inkfin is read-only, has no developer-operated analytics, accounts or advertising, and blocks remote images. Links you choose open in your default browser.

Inkfin displays one document at a time. It does not edit Markdown, sync documents to the cloud, or provide print/PDF export. Documents must be UTF-8 and no larger than 10 MiB. Microsoft Edge WebView2 is required.

## Feature fields

1. Read local .md and .markdown documents.
2. Render GitHub Flavoured Markdown with syntax-highlighted code.
3. Search visible document text with keyboard navigation.
4. Choose light, dark or system appearance.
5. Adjust document zoom from 75% to 200%.
6. Refresh the preview when the file changes on disk.
7. Read-only local processing, without an Inkfin account.

## Release notes

Initial Microsoft Store submission of Inkfin 0.1.2. Local Markdown reading with syntax highlighting, visible-text search, themes, document zoom and live refresh.

## Certification notes — paste only after the MSIX test passes

Inkfin is a full-trust Tauri/Rust desktop Markdown viewer. The runFullTrust capability is needed for native file-picker/drag-and-drop handling, read access to user-selected documents and local referenced images, watching the selected document's directory for changes, and opening user-selected HTTP(S) links in the default browser. It does not request administrator privileges or install a service or driver. It does not change user documents or download remote Markdown images.

No sign-in or test account is required. Launch Inkfin, press Ctrl+O and select a UTF-8 .md file. The acceptance fixture is available in the public repository at docs/acceptance/fixture.md, with its linked files and image in the same directory. Test .md and .markdown via Open with, then open a second document while the app is running. Check Ctrl+F, Ctrl++/Ctrl+-, Ctrl+0 and light/dark themes. Save the file in an external editor to verify refresh. Microsoft Edge WebView2 must be available.

## Age ratings and declarations

Complete the actual Partner Center/IARC questionnaire. Do not invent an official rating. The source has no built-in chat, accounts, ads, purchases, gambling, or curated media catalogue; users can open their own local documents and follow their links. Read each question carefully, especially what counts as user-generated content or internet access. The app can open external links in a browser even though it does not fetch remote document content.

Check current Partner Center questions on encryption/export compliance, accessibility, markets and trader/contact disclosures against the actual product and publisher. No compliance or accessibility certification is claimed by this draft. The public repository currently contains no license file; confirm rights to all bundled code, icons and dependencies before release.

## Image assets

- `listing-assets/store-icon-300.png`: derived from the app's existing icon, not a new logo.
- Existing captures: `app-screenshots/`. These show an earlier build and some contain local file paths; verify that each matches the built Store version before uploading.
- Capture at least one current PNG screenshot on a Windows desktop at 1366×768 or larger (1920×1080 recommended). All six existing captures are below the required width. Recommended captures: dark document with code; light document with table; search with a real match.
- Do not replace real app captures with AI-generated UI or claim screenshots of the Store package before it runs.

Reserved Microsoft Store ID: `9PNSW2RFF41M`. Publisher display name: **Crispr Labs**. The assigned Store URL is https://apps.microsoft.com/detail/9PNSW2RFF41M; the listing is not live until certification and publication.
