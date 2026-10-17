/**
 * Interaction probe for the Windows build.
 *
 * Covers the rows the installed-package audit does not: launching with no
 * document at all, the zoom control at its bounds and at the 480 x 360 minimum,
 * switching the theme, and the reduced-motion preference. It drives the release
 * binary directly (nothing is installed) over the DevTools protocol.
 *
 * Usage:
 *   node tools/windows/interaction-probe.mjs <inkfin.exe> [outJson]
 */

import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const exe = path.resolve(process.argv[2] ?? 'src-tauri/target/release/inkfin.exe');
const outFile = process.argv[3] ?? 'artifacts/windows/interaction-probe.json';
const port = 9413;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = { exe, exeSha256: null, checks: {}, failures: [] };
const fail = (message) => results.failures.push(message);

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
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

  send(method, params = {}) {
    const id = this.#nextId++;
    const reply = new Promise((resolve) => this.#pending.set(id, resolve));
    this.#socket.send(JSON.stringify({ id, method, params }));
    return reply;
  }

  async evaluate(expression) {
    const message = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (message.result?.exceptionDetails) throw new Error(message.result.exceptionDetails.text);
    return message.result?.result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

async function waitFor(cdp, expression, timeoutMs, intervalMs = 50) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await cdp.evaluate(expression)) return { ok: true, milliseconds: Date.now() - started };
    } catch {
      // Still starting.
    }
    await sleep(intervalMs);
  }
  return { ok: false, milliseconds: Date.now() - started };
}

async function findTarget(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Port not open yet.
    }
    await sleep(200);
  }
  return null;
}

/** Resize the app window by pid; there is no document title to match on. */
function resizeWindowOf(pid, width, height) {
  return ps(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class InkfinResizeProbe {
  private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  public static IntPtr Find(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner == (uint)pid && IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0) {
        found = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$h = [InkfinResizeProbe]::Find(${pid})
if ($h -eq [IntPtr]::Zero) { '0' } else { [InkfinResizeProbe]::MoveWindow($h, 40, 40, ${width}, ${height}, $true) | Out-Null; 'ok' }
`);
}

async function pressKey(cdp, { key, code, vk, modifiers = 0 }) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
  });
}

const zoom = (cdp) => cdp.evaluate("document.documentElement.style.getPropertyValue('--k-zoom')");

let app = null;
let cdp = null;
try {
  results.exeSha256 = ps(
    `(Get-FileHash -Algorithm SHA256 -LiteralPath '${exe}').Hash`,
  ).toLowerCase();

  // No document on the command line at all.
  app = spawn(exe, [], {
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-features=Translate`,
    },
  });
  const target = await findTarget();
  if (!target) throw new Error('the app never exposed a CDP target');
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await sleep(1500);

  // ---- A7: launch with no argument ---------------------------------------
  results.checks.emptyState = await cdp.evaluate(
    `(() => {
      const text = document.body.innerText;
      const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
      return { text: text.slice(0, 200), buttons, hasOpenButton: buttons.some((label) => /open/i.test(label)) };
    })()`,
  );
  if (!results.checks.emptyState.hasOpenButton) {
    fail('a launch with no argument does not offer an Open control');
  }

  // ---- C5: theme switch at runtime ---------------------------------------
  const openThemeMenu = () =>
    cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => /theme/i.test(b.getAttribute('aria-label') || b.textContent || ''));
      if (!button) return false;
      button.click();
      return true;
    })()`);
  const chooseTheme = (wanted) =>
    cdp.evaluate(`(() => {
      const options = [...document.querySelectorAll('[role="menuitemradio"]')];
      const labels = options.map((o) => (o.textContent || '').trim());
      const option = options.find((o, index) =>
        new RegExp(${JSON.stringify(wanted)}, 'i').test(labels[index]),
      );
      if (!option) return 'no option in [' + labels.join(', ') + ']';
      option.click();
      return 'clicked';
    })()`);

  const themeBefore = await cdp.evaluate('document.documentElement.dataset.theme');
  const other = themeBefore === 'dark' ? 'light' : 'dark';
  const opened = await openThemeMenu();
  const menuShown = await waitFor(
    cdp,
    'document.querySelectorAll("[role=menuitemradio]").length > 0',
    3000,
  );
  results.checks.themeMenuItems = await cdp.evaluate(
    '[...document.querySelectorAll("[role=menuitemradio]")].map((o) => (o.textContent || "").trim())',
  );
  const chose = menuShown.ok ? await chooseTheme(other) : 'menu never opened';
  await sleep(400);
  const themeAfter = await cdp.evaluate('document.documentElement.dataset.theme');
  results.checks.theme = { themeBefore, other, opened, chose, themeAfter };
  if (!opened || !chose.startsWith('clicked') || themeAfter !== other) {
    fail(`the theme menu did not apply ${other}: ${JSON.stringify(results.checks.theme)}`);
  }
  // Put the reader's own choice back.
  await openThemeMenu();
  await sleep(250);
  await chooseTheme(themeBefore);
  await sleep(300);
  results.checks.theme.restored = await cdp.evaluate('document.documentElement.dataset.theme');

  // ---- C4: zoom bounds and the reset -------------------------------------
  const zoomSteps = { initial: await zoom(cdp) };
  for (let i = 0; i < 8; i += 1) {
    await pressKey(cdp, { key: '+', code: 'Equal', vk: 187, modifiers: 2 });
    await sleep(120);
  }
  zoomSteps.afterZoomIn = await zoom(cdp);
  for (let i = 0; i < 12; i += 1) {
    await pressKey(cdp, { key: '-', code: 'Minus', vk: 189, modifiers: 2 });
    await sleep(120);
  }
  zoomSteps.afterZoomOut = await zoom(cdp);
  await pressKey(cdp, { key: '0', code: 'Digit0', vk: 48, modifiers: 2 });
  await sleep(200);
  zoomSteps.afterReset = await zoom(cdp);
  results.checks.zoom = zoomSteps;
  const numbers = Object.values(zoomSteps)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  if (numbers.length === 0) fail('zoom never reported a scale');
  if (Math.max(...numbers) > 2.0001) fail(`zoom passed its 200 % ceiling: ${Math.max(...numbers)}`);
  if (Math.min(...numbers) < 0.7499) fail(`zoom passed its 75 % floor: ${Math.min(...numbers)}`);
  if (Math.abs(Number(zoomSteps.afterReset) - 1) > 0.0001) {
    fail(`Ctrl+0 did not reset zoom to 100 %: ${zoomSteps.afterReset}`);
  }

  // ---- GATE-W3: zoom at the 480 x 360 minimum -----------------------------
  const resized = resizeWindowOf(app.pid, 480, 360);
  await sleep(800);
  await pressKey(cdp, { key: '+', code: 'Equal', vk: 187, modifiers: 2 });
  await pressKey(cdp, { key: '+', code: 'Equal', vk: 187, modifiers: 2 });
  await sleep(400);
  results.checks.minimumWindowZoom = await cdp.evaluate(
    `({ zoom: document.documentElement.style.getPropertyValue('--k-zoom'),
        size: { width: innerWidth, height: innerHeight },
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 })`,
  );
  results.checks.minimumWindowResize = resized;
  if (results.checks.minimumWindowZoom.overflow) {
    fail('zooming at the minimum window size overflows the page horizontally');
  }

  // ---- C11: reduced motion ------------------------------------------------
  // Compare the durations the page computes for the same elements with and
  // without the preference, so the row is decided by a difference rather than by
  // a value that is zero either way.
  const durations = () =>
    cdp.evaluate(`(() => {
      const selectors = ['.toolbar button', '.notice', '.document-column a', '.theme-menu', '.search-bar input'];
      const entries = selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, missing: true };
        const style = getComputedStyle(element);
        return {
          selector,
          transition: parseFloat(style.transitionDuration) || 0,
          animation: parseFloat(style.animationDuration) || 0,
        };
      });
      return { matches: matchMedia('(prefers-reduced-motion: reduce)').matches, entries };
    })()`);

  const motionAllowed = await durations();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await sleep(400);
  const motionReduced = await durations();
  const animated = motionAllowed.entries.filter(
    (entry) => !entry.missing && (entry.transition > 0 || entry.animation > 0),
  );
  const stillAnimated = motionReduced.entries.filter(
    (entry) => !entry.missing && (entry.transition > 0 || entry.animation > 0),
  );
  results.checks.reducedMotion = {
    emulationApplied: motionReduced.matches,
    animatedSelectorsNormally: animated.map((entry) => entry.selector),
    animatedSelectorsUnderReducedMotion: stillAnimated.map((entry) => entry.selector),
  };
  // Leave the reader's own zoom where it was found.
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await pressKey(cdp, { key: '0', code: 'Digit0', vk: 48, modifiers: 2 });
  await sleep(200);
  results.checks.zoomAfterCleanup = await zoom(cdp);

  if (!motionReduced.matches) {
    fail('the reduced-motion preference was not applied to the page');
  } else if (animated.length === 0) {
    note(
      'C11',
      'no probed element declares a transition under normal motion, so this row is unverified',
    );
  } else if (stillAnimated.length > 0) {
    fail(
      `reduced motion still animates: ${stillAnimated.map((entry) => entry.selector).join(', ')}`,
    );
  }
} catch (error) {
  fail(`probe error: ${error.message}`);
} finally {
  cdp?.close();
  if (app) {
    try {
      execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone.
    }
  }
}

function note(row, message) {
  results.observations = results.observations ?? [];
  results.observations.push({ row, message });
}

writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
process.exit(results.failures.length === 0 ? 0 : 1);
