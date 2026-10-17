/**
 * Render, refresh and long-document probe for the packaged Windows build.
 *
 * Drives the real webview over the Chromium DevTools Protocol (WebView2 honours
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS), so the assertions run against what the
 * packaged app actually painted rather than against jsdom.
 *
 * What it measures:
 *   * rendered constructs from docs/acceptance/fixture.md (headings, table,
 *     footnote, lists) — matrix rows B1-B3;
 *   * raw HTML stays inert and remote images never resolve — B6, B9;
 *   * a relative image is served — B4;
 *   * refresh latency after an ordinary save — D1, G3;
 *   * open-and-render time for a ~5,000-line document — B14, G4;
 *   * that the document is byte-identical afterwards — F8.
 *
 * Usage:
 *   node tools/windows/render-probe.mjs <path-to-inkfin.exe> [outJson]
 */

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exePath = path.resolve(process.argv[2] ?? 'src-tauri/target/release/inkfin.exe');
const outFile = process.argv[3] ?? 'artifacts/windows/render-probe.json';
const port = 9411;
const repoRoot = process.cwd();

const fixtureDir = path.join(repoRoot, 'docs', 'acceptance');
const work = mkdtempSync(path.join(tmpdir(), 'inkfin-probe-'));
const document = path.join(work, 'fixture.md');
const longDocument = path.join(work, 'long.md');
copyFileSync(path.join(fixtureDir, 'fixture.md'), document);
copyFileSync(path.join(fixtureDir, 'diagram.png'), path.join(work, 'diagram.png'));

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const copiedHash = sha256(document);

const results = {
  exe: exePath,
  exeSha256: sha256(exePath),
  webview2RemoteDebuggingPort: port,
  rendered: {},
  refresh: {},
  longDocument: {},
  security: {},
  documentUnchanged: null,
  failures: [],
};
const fail = (message) => results.failures.push(message);

const launch = (file) =>
  spawn(exePath, [file], {
    detached: false,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });

const app = launch(document);

/** Resolve the page target the app exposes over CDP. */
async function findTarget(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // The port is not open yet.
    }
    await sleep(200);
  }
  return null;
}

class Cdp {
  #socket;
  #nextId = 1;
  #pending = new Map();

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener('open', resolve, { once: true });
      cdp.#socket.addEventListener('error', reject, { once: true });
    });
    cdp.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const entry = cdp.#pending.get(message.id);
      if (entry) {
        cdp.#pending.delete(message.id);
        entry(message);
      }
    });
    return cdp;
  }

  async evaluate(expression) {
    const id = this.#nextId++;
    const reply = new Promise((resolve) => this.#pending.set(id, resolve));
    this.#socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
    const message = await reply;
    if (message.error) throw new Error(message.error.message);
    const result = message.result?.result;
    if (message.result?.exceptionDetails) {
      throw new Error(message.result.exceptionDetails.text ?? 'evaluation failed');
    }
    return result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

/** Poll an expression until it returns a truthy value, and report how long that took. */
async function waitFor(cdp, expression, timeoutMs, intervalMs = 50) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await cdp.evaluate(expression);
      if (value) return { ok: true, milliseconds: Date.now() - started };
    } catch {
      // The page may still be navigating.
    }
    await sleep(intervalMs);
  }
  return { ok: false, milliseconds: Date.now() - started };
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
}

function workingSetBytes(pid) {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${pid}).WorkingSet64`,
    ]);
    const value = Number.parseInt(output.toString().trim(), 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

try {
  const target = await findTarget();
  if (!target) {
    fail('the webview never exposed a CDP target; render checks could not run');
  } else {
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);

    // ---- rendered constructs (B1-B4) --------------------------------------
    const appeared = await waitFor(cdp, 'document.body.innerText.includes("Acceptance fixture")', 30000);
    if (!appeared.ok) fail('the fixture never rendered in the packaged window');

    const inspect = async (expression) => cdp.evaluate(expression);

    results.rendered.headingPresent = await inspect(
      'document.querySelector(".document-column h1, .markdown-body h1, h1") !== null',
    );
    results.rendered.listItemCount = await inspect('document.querySelectorAll("li").length');
    results.rendered.tableCellCount = await inspect('document.querySelectorAll("td, th").length');
    results.rendered.footnoteTextPresent = await inspect(
      'document.body.innerText.includes("Footnotes are part of the GFM set")',
    );
    results.rendered.blockquoteCount = await inspect('document.querySelectorAll("blockquote").length');
    results.rendered.highlightedTokenCount = await inspect(
      'document.querySelectorAll("code span, .line span, pre span").length',
    );
    results.rendered.copyButtonCount = await inspect(
      'document.querySelectorAll("button").length',
    );
    // Images resolve asynchronously through the native bridge, so give them a
    // window of their own instead of scoring the first paint.
    const imageReady = await waitFor(cdp, 'document.querySelectorAll("img.md-image").length > 0', 10000, 100);
    results.rendered.imageResolvedMilliseconds = imageReady.milliseconds;
    results.rendered.relativeImageRendered = imageReady.ok;
    results.rendered.images = await inspect(
      `[...document.images].map((image) => ({
         alt: image.alt,
         scheme: (image.currentSrc || image.src || '').split(':')[0],
         complete: image.complete,
         naturalWidth: image.naturalWidth,
       }))`,
    );
    results.rendered.imagePlaceholders = await inspect(
      `[...document.querySelectorAll('.md-image-placeholder')].map((node) => ({
         state: node.dataset.state,
         label: node.getAttribute('aria-label'),
       }))`,
    );

    // ---- security (B6, B9, F1) -------------------------------------------
    results.security.remoteImageRequests = await inspect(
      '[...document.images].filter((image) => /^https?:/.test(image.currentSrc || image.src)).length',
    );
    results.security.rawHtmlExecuted = await inspect('typeof window.__inkfinXss !== "undefined"');
    results.security.inertScriptText = await inspect(
      'document.body.innerText.includes("window.__inkfinXss")',
    );
    results.security.liveJavascriptHrefs = await inspect(
      '[...document.querySelectorAll("a")].filter((anchor) => /^javascript:/i.test(anchor.getAttribute("href") || "")).length',
    );

    // ---- refresh latency after an ordinary save (D1, G3) ------------------
    // Read-only check (F8): the app must not have touched the file it opened.
    results.documentUnchanged = sha256(document) === copiedHash;
    if (!results.documentUnchanged) fail('the app modified the document it opened');

    const marker = `refresh-marker-${Date.now()}`;
    const saved = readFileSync(document, 'utf8') + `\n\n${marker}\n`;
    writeFileSync(document, saved);
    const refreshed = await waitFor(
      cdp,
      `document.body.innerText.includes(${JSON.stringify(marker)})`,
      15000,
      25,
    );
    results.refresh.ordinarySaveVisible = refreshed.ok;
    results.refresh.ordinarySaveMilliseconds = refreshed.milliseconds;
    results.refresh.pollIntervalMilliseconds = 25;
    if (!refreshed.ok) fail('an ordinary save never appeared in the packaged window');

    // ---- long document (B14, G4) -----------------------------------------
    const lines = ['# Long document', ''];
    for (let index = 0; index < 5000; index += 1) {
      lines.push(`Paragraph ${index}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`);
      if (index % 250 === 0) lines.push('', '## Section', '');
      if (index % 500 === 0) lines.push('', '```ts', 'const value = 1;', '```', '');
    }
    lines.push('', 'LONG-DOCUMENT-END');
    const longSource = lines.join('\n');
    writeFileSync(longDocument, longSource);
    const longBytes = Buffer.byteLength(longSource);

    const second = launch(longDocument);
    const longStarted = Date.now();
    const longShown = await waitFor(
      cdp,
      'document.body.innerText.includes("LONG-DOCUMENT-END")',
      60000,
      100,
    );
    results.longDocument.bytes = longBytes;
    results.longDocument.rendered = longShown.ok;
    results.longDocument.openAndRenderMilliseconds = longShown.milliseconds;
    results.longDocument.dom = await inspect(
      `({
         bodyTextLength: document.body.innerText.length,
         headingCount: document.querySelectorAll("h1").length,
         sectionCount: document.querySelectorAll("h2").length,
         paragraphCount: document.querySelectorAll("p").length,
         codeBlockCount: document.querySelectorAll("pre").length,
         firstParagraph: (document.querySelector("p") || {}).textContent,
         lastParagraph: ([...document.querySelectorAll("p")].pop() || {}).textContent,
       })`,
    );
    if (!longShown.ok) fail('the ~5,000-line document never finished rendering');
    // Consecutive lines form one Markdown paragraph, so the paragraph count is
    // small by design; the source lines are what must all be present.
    const paragraphsSeen = await inspect(
      '(document.body.innerText.match(/Paragraph \\d+:/g) || []).length',
    );
    results.longDocument.sourceLinesPresent = paragraphsSeen;
    if (paragraphsSeen < 5000) {
      fail(`the long document rendered only ${paragraphsSeen} of 5000 source lines`);
    }
    if (!String(results.longDocument.dom?.lastParagraph ?? '').includes('LONG-DOCUMENT-END')) {
      fail('the end of the long document is missing from the rendered output');
    }

    results.memory = {
      workingSetBytes: workingSetBytes(app.pid),
      withDocumentOpen: 'long document',
      millisecondsSinceLongDocumentLaunch: Date.now() - longStarted,
    };

    cdp.close();
    killTree(second.pid);
  }
} catch (error) {
  fail(`probe error: ${error.message}`);
} finally {
  killTree(app.pid);
  rmSync(work, { recursive: true, force: true });
}

results.passed = results.failures.length === 0;
writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
process.exit(results.passed ? 0 : 1);
