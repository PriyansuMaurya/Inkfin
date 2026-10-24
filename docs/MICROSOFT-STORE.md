# Publish Inkfin to Microsoft Store

Prepared 24 October 2026 from main commit `367cb75e6c74cb7e7f59be7aa742ef85f2b4a8a0`. This is an implementation and handoff, not a completed Store submission.

## Current state

- The existing `v0.1.2` release contains the unsigned NSIS Windows installer.
- The publishing branch now contains a separate MakeAppx MSIX path. The Tauri application is built with `--no-bundle`; the NSIS installer and its registry hooks are not wrapped inside the MSIX.
- Microsoft signs MSIX packages submitted to the Store; a purchased code-signing certificate is unnecessary for this route. The traditional EXE route still needs trusted Authenticode signing and an offline installer, so the existing unsigned/bootstrapper EXE is not a substitute.
- The Store manifest initially targets x64 Windows 11 (`10.0.22000.0`). This narrows only the new Store distribution, to use the system WebView2 runtime. The standalone EXE configuration remains as it was. Do not lower the manifest floor or advertise Windows 10 Store support without deciding and validating runtime provisioning on clean Windows 10. The MSIX does not install WebView2.
- Windows MSIX build and MakeAppx validation **passed** in GitHub Actions run 40123888589. Windows installation, WACK and Store certification have **not** been run. Build success does not establish MSIX runtime readiness.

## 1. Microsoft account and reserved identity

Completed in Partner Center on 24 October 2026: reserved **Inkfin Markdown Viewer** as an **MSIX/PWA app**, Store ID **9PNSW2RFF41M**, publisher **Crispr Labs**. The earlier `inkfin` EXE/MSI draft remains untouched. Exact assigned values are saved in `packaging/store/identity.json`; these are public package metadata, not credentials.

| Identity field | Assigned value |
| --- | --- |
| Name | `CrisprLabs.InkfinMarkdownViewer` |
| Publisher | `CN=3E3BFB6E-6C9B-46C6-BFE3-23DEFC167689` |
| Publisher display name | `Crispr Labs` |

The following general setup steps are retained as reference; do not create another product for this submission.

1. Open https://storedeveloper.microsoft.com/ and sign in with your intended publishing account.
2. If not already enrolled, choose the appropriate account type and complete verification. An individual account requires a personal Microsoft account. Identity documents/selfie and acceptance of agreements need your direct participation.
3. In Partner Center, create an **MSIX/PWA app** (not EXE/MSI) and reserve **Inkfin** if available. If it is unavailable, decide the public name before generating the manifest.
4. Open **Product management → Product identity** and copy the exact values:

| Partner Center value | Field in packaging/store/identity.json |
| --- | --- |
| Package/Identity/Name | `identityName` |
| Package/Identity/Publisher | `publisher` |
| Package/Properties/PublisherDisplayName | `publisherDisplayName` |

These are app identity metadata, not passwords. Do not substitute the Tauri identifier `com.inkfin.viewer`, guess the CN, or use an email address as the Publisher value. Match the reserved app display name and publisher exactly. Do not send login credentials, identity documents or tokens in chat.

## 2. Build on GitHub Actions

After these changes have been pushed to the chosen branch:

1. Review the committed `packaging/store/identity.json` against the values above. No repository secret or code-signing certificate is needed.
2. In **Actions → Build Microsoft Store MSIX**, select the branch containing this workflow and choose **Run workflow**.
3. The workflow runs frontend and Rust checks, builds `inkfin.exe` for x64 Windows, calls `tools/windows/package-store.ps1`, and uploads the artifact **inkfin-microsoft-store-x64**.
4. Download and extract the artifact. It contains `Inkfin_0.1.2.0_x64.msix`, its SHA-256, the resolved manifest, and a build evidence record. The MSIX is deliberately unsigned for Store upload.
5. A green build means packaging succeeded. It does **not** mean installation, file activation, WACK or Microsoft certification passed.

Local Windows alternative, with Node 24, Rust and Visual C++ Build Tools plus the Windows SDK installed:

```powershell
npm ci
npx tauri build --target x86_64-pc-windows-msvc --no-bundle --ci
pwsh -File tools/windows/package-store.ps1 -IdentityFile packaging/store/identity.json
```

Create `artifacts/` first if it does not exist. Keep the fourth version component at zero for Store packages and increase versions for future submissions; the first three components must match the Tauri app version.

## 3. Test the actual MSIX — Windows required

Use a disposable Windows 11 VM or test machine. For sideload testing only, sign a **copy** of the unsigned MSIX with a development certificate whose subject exactly matches its Publisher, and trust that certificate only in the test environment. Keep the unsigned original for Store upload. Do not distribute the development certificate/private key or ask customers to trust it. Visual Studio/Windows SDK signing tools can perform this step.

Record OS build, WebView2 version, source commit, MSIX SHA-256 and pass/fail evidence:

| Gate | Required observation | Status |
| --- | --- | --- |
| Installation | MSIX installs and Start menu launches Inkfin without admin access | NOT RUN |
| File activation | Open with works for .md and .markdown, including spaces/non-ASCII paths | NOT RUN |
| Second launch | Opening another file replaces the document with one running instance | NOT RUN |
| Rendering | Fixture GFM/code/local images render; raw HTML and remote images stay blocked | NOT RUN |
| Reading controls | Search, zoom 75–200%, theme selection and persisted preferences work | NOT RUN |
| Watching | Ordinary and atomic saves refresh; last preview survives deletion | NOT RUN |
| Offline | Rendering/search/refresh work offline with WebView2 installed | NOT RUN |
| Coexistence | Standalone + MSIX installation does not cause stale file activation or data loss | NOT RUN |
| Update/removal | Package update, uninstall and default-app behaviour are correct | NOT RUN |
| WACK | Windows App Certification Kit passes, or findings are investigated/resolved | NOT RUN |

Use `docs/acceptance/` fixtures and existing Windows probes where applicable, but note that the NSIS install/uninstall probes are not MSIX installation tests. Record any single-instance collision with a standalone Inkfin process; no automatic migration is implemented.

## 4. Cloudflare and maurya.ie

The existing site is already configured for **https://inkfin.maurya.ie/** and returned HTTP 200 during preparation. Keep the existing Cloudflare project if it serves this hostname. Do not change the root `maurya.ie`/`www` DNS records or nameservers.

### If the current project is Cloudflare Pages

Use its existing Git integration. Project root directory: `website`; build command: `npm run build` (or `npm ci && npm run build` if dependency installation is not automatic); output directory: `dist`. Deploy the branch you intend to publish and keep the existing `inkfin.maurya.ie` custom-domain association. The new files in `website/public` are copied into `dist`, including `/privacy/` and `/support/`.

### If the current project is a Cloudflare Worker

Use the existing Worker's name/account and custom-domain binding. `website/wrangler.jsonc` is prepared for a Worker called `inkfin-site`; **inspect the dashboard and match its name before deploying**, rather than creating a second project for an already-bound hostname. If no project currently owns the hostname, this config can be used for a static-assets Worker after verifying account/zone ownership.

```powershell
cd website
npm ci
npx wrangler login
# Review wrangler.jsonc against the existing Worker before this command.
npm run deploy
```

The config binds only `inkfin.maurya.ie`. Cloudflare provisions DNS and TLS for the custom-domain Worker; if the name is already attached to a Pages project/Worker, use that existing project instead of deleting its records blindly. `npm run deploy:preview` performs a packaging dry run, not a public deployment.

Verify after deployment:

- `https://inkfin.maurya.ie/` — home page and Windows download still work.
- `https://inkfin.maurya.ie/privacy/` — the actual privacy policy, HTTP 200.
- `https://inkfin.maurya.ie/support/` — actual support page, HTTP 200.
- A nonexistent URL returns a genuine 404, not the home page.

For the MSIX route, Microsoft hosts the Store package. Cloudflare hosts the app website, privacy and support links; it does not need to host a Store installer URL. Do not place the unsigned MSIX on a public install button.

## 5. Complete and submit the listing

Use `packaging/store/listing.md` for listing text, features, certification notes and proposed metadata. Upload the unsigned MSIX, a 300×300 Store icon and current real screenshots. Set price/markets and complete the real age-rating and product-declaration questions. Review any trader/contact declarations using your true account details. Do not guess an IARC rating or legal status.

Check that the live policy matches the app, all URLs are reachable, the reserved name is correct and the test matrix above has evidence. Submit for certification using Partner Center. If a form asks you to accept a legal agreement, the owner must review and accept it. Microsoft decides certification and may request changes; a submission is not a published listing.

After certification succeeds and the listing is public, copy the **actual** product ID and add the official Store link/badge to the website. Do not fabricate a product ID or display a Store badge before the listing exists.

## Owner actions still needed

1. Review any remaining Microsoft legal/publisher declarations when requested by the submission form.
2. The app name and exact package identity are already reserved; no further name reservation is needed.
3. Complete Cloudflare sign-in, or deploy these website files yourself through the existing project.
4. Run/review actual Windows MSIX acceptance and WACK, plus current screenshots.
5. Complete publisher-specific declarations and respond to certification findings.

## Official references

- Microsoft publishing overview: https://learn.microsoft.com/en-us/windows/apps/publish/
- Developer onboarding: https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account
- Signing options: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Package identity/requirements: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements
- File activation extensions: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/desktop-to-uwp-extensions
- Tauri Store guide (EXE/MSI route): https://v2.tauri.app/distribute/microsoft-store/
- Cloudflare custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## Session progress

- Reserved MSIX product: **Inkfin Markdown Viewer**, Store ID **9PNSW2RFF41M**.
- Submission 1 exists. Properties are saved as Complete (Productivity, website/support/privacy URLs). The policy/support files still need live deployment.
- Publishing source: https://github.com/PriyansuMaurya/Inkfin/tree/publish/microsoft-store
- Windows MSIX build: https://github.com/PriyansuMaurya/Inkfin/actions/runs/40123888589
- The preparation workflow successfully applied the source changes and has been removed (commit 47c8676).
- Cloudflare sign-in completed. This account shows no Workers or Pages projects. The existing domain binding still needs inspection; do not change apex/www DNS. Browser page controls became unresponsive during that inspection.
- Age ratings, pricing/availability, listing images, Windows installation/WACK and certification are not complete.

Final observed result: Windows MSIX workflow 40123888589 **PASS**; artifact inkfin-microsoft-store-x64 (2,160,684-byte ZIP). Download while signed into GitHub. Windows installation/WACK, live privacy/support deployment and certification are still outstanding.

## Downloaded package verification

The downloaded artifact contains Inkfin_0.1.2.0_x64.msix (2,160,836 bytes). SHA-256: `1e82ac006b5750a83074075e994a3b7d2bd855cf61d47de7d7d8cd8ce3072d97`. The SHA file, ZIP CRC, each block-map digest (five payload files), PE x64 machine type, exact Store identity and absence of a production signature were verified locally. The original unsigned bytes are retained for Partner Center.

The separate **Validate installed Store MSIX** workflow signs a copy with an ephemeral certificate, installs it on a disposable Windows Server runner, exercises rendering/refresh using the installed executable, and removes the package and certificate. Its scope and environment are recorded explicitly; it does not replace a Windows 11 desktop acceptance pass. It probes for WACK and records unavailability or Session 0 rather than claiming a certification result.

## Installed-package findings (run 40126371747)

On Windows Server 2025, installation, first document window, second-document single-instance handling, unchanged source documents, uninstallation and unchanged original MSIX all passed. A native screenshot shows the installed app rendering the fixture. This is an additional CI environment, not Windows 11 desktop acceptance.

The CDP rendering suite remains blocked because WebView2 did not expose a debugging target, although version 155.0.4283.62 was installed. WACK returned FAIL/exit -1, reporting missing manifest/platform metadata and empty app identity fields. A clean Windows 11 WACK run is still required; do not submit the CI report as a certification pass. Evidence: https://github.com/PriyansuMaurya/Inkfin/actions/runs/40126371747. PR #1 remains a draft.
