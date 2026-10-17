/**
 * Installed-package audit for Windows.
 *
 * Installs the NSIS package with its own uninstaller, drives the installed
 * executable over the DevTools protocol, records what the installer wrote to the
 * registry, and uninstalls again in a `finally` block.
 *
 * This host is not a clean machine, so every result is reported with
 * `cleanHost: false`; it is evidence for the installer, associations and runtime
 * behaviour, not a substitute for the clean-machine gate.
 *
 * Usage:
 *   node tools/windows/installed-audit.mjs <setup.exe> [outJson]
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const installer = path.resolve(
  process.argv[2] ?? 'artifacts/windows/Inkfin_0.1.2_x64-setup-local-fixed.exe',
);
const outFile = process.argv[3] ?? 'artifacts/windows/installed-audit.json';
const port = 9412;
const fixtureSource = path.resolve('docs/acceptance/fixture.md');
const diagramSource = path.resolve('docs/acceptance/diagram.png');

const work = mkdtempSync(path.join(tmpdir(), 'inkfin-installed-'));
const fixture = path.join(work, 'fixture.md');
const denied = path.join(work, 'denied.md');
writeFileSync(fixture, readFileSync(fixtureSource, 'utf8'));
writeFileSync(denied, '# Denied file\n\nThis file should never be readable.\n');
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Copy-Item -LiteralPath '${diagramSource}' -Destination '${path.join(work, 'diagram.png')}'`,
]);

const results = {
  installer,
  installerSha256: null,
  requests: [],
  cleanHost: false,
  installedAt: null,
  installDirectory: null,
  associations: {},
  keyboard: {},
  accessibility: {},
  minimumWindow: {},
  atomicSave: {},
  deniedFile: {},
  uninstalled: null,
  failures: [],
};
const fail = (message) => results.failures.push(message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** The NSIS InstallLocation value is quoted on disk; shell use needs it bare. */
function unquote(value) {
  return value.replace(/^"+|"+$/g, '').trim();
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
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
    if (message.result?.exceptionDetails) {
      throw new Error(message.result.exceptionDetails.text ?? 'evaluation failed');
    }
    return message.result?.result?.value;
  }

  close() {
    this.#socket?.close();
  }
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

async function waitFor(cdp, expression, timeoutMs, intervalMs = 50) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(expression)) return { ok: true, milliseconds: Date.now() - started };
    } catch {
      // Navigating.
    }
    await sleep(intervalMs);
  }
  return { ok: false, milliseconds: Date.now() - started };
}

/**
 * Top-level window of the installed process, found by enumerating windows rather
 * than by title, because the single-instance helper window also belongs to the
 * process and FindWindow rarely matches the document title exactly.
 */
function resizeWindowOf(pid, title, width, height) {
  const escaped = title.replace(/'/g, "''");
  return ps(`
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class InkfinResize {
  private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  public static IntPtr Find(int pid, string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner == (uint)pid && IsWindowVisible(hWnd)) {
        int length = GetWindowTextLength(hWnd);
        if (length > 0) {
          var buffer = new StringBuilder(length + 1);
          GetWindowText(hWnd, buffer, buffer.Capacity);
          if (buffer.ToString().Contains(needle)) { found = hWnd; return false; }
        }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$h = [InkfinResize]::Find(${pid}, '${escaped}')
if ($h -eq [IntPtr]::Zero) { '0' } else { [InkfinResize]::MoveWindow($h, 40, 40, ${width}, ${height}, $true) | Out-Null; $h.ToInt64() }
`);
}

const EXTENSIONS = ['.md', '.markdown'];
const BACKUP_VALUE = 'Markdown Document_backup';

/** The ProgID an extension currently resolves to. */
function extensionProgId(extension) {
  return ps(
    `(Get-ItemProperty 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\${extension}' -ErrorAction SilentlyContinue).'(default)'`,
  );
}

/** Snapshot the association values Inkfin is about to change. */
function associationSnapshot() {
  const read = (extension) => ({
    default: extensionProgId(extension),
    backup: ps(
      `(Get-ItemProperty 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\${extension}' -ErrorAction SilentlyContinue).'${BACKUP_VALUE}'`,
    ),
  });
  return Object.fromEntries(EXTENSIONS.map((extension) => [extension, read(extension)]));
}

/**
 * What the extension resolves to right now, and whether that ProgID still
 * exists. An extension left pointing at a deleted ProgID is how "the file has
 * no associated app" reaches a reader after an uninstall.
 */
function extensionState() {
  const state = {};
  for (const extension of EXTENSIONS) {
    const progId = extensionProgId(extension);
    state[extension] = {
      progId,
      progIdExists: progId
        ? ps(
            `if (Test-Path 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\${progId}') { 'yes' } else { 'no' }`,
          ) === 'yes'
        : false,
      backup: ps(
        `(Get-ItemProperty 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\${extension}' -ErrorAction SilentlyContinue).'${BACKUP_VALUE}'`,
      ),
      backupPresent:
        ps(
          `if ((Get-Item 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\${extension}' -ErrorAction SilentlyContinue).GetValueNames() -contains '${BACKUP_VALUE}') { 'yes' } else { 'no' }`,
        ) === 'yes',
      // Windows 11 lets Explorer keep a per-user choice that outranks the
      // ProgID. When another app holds it, a double click does not reach us.
      userChoice: ps(
        `(Get-ItemProperty 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${extension}\\UserChoice' -ErrorAction SilentlyContinue).ProgId`,
      ),
    };
  }
  // cmd's assoc/ftype report the machine-level view, so they are recorded as
  // context for what other apps claim rather than as a gate.
  state.machineView = Object.fromEntries(
    EXTENSIONS.map((extension) => [extension, cmd('assoc', extension).trim()]),
  );
  return state;
}

/**
 * Which program ended up owning a window that shows this file name.
 *
 * The shell decides who opens a file, and on Windows 11 a per-user choice can
 * outrank the ProgID the installer wrote. Looking for the file name in the
 * window titles of every process is how that decision is observed rather than
 * assumed.
 */
function windowOwner(fileName) {
  const escaped = fileName.replace(/'/g, "''");
  return ps(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class InkfinWindows {
  private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  public static int FindPid(string needle) {
    int found = 0;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      int length = GetWindowTextLength(hWnd);
      if (length == 0) return true;
      var buffer = new StringBuilder(length + 1);
      GetWindowText(hWnd, buffer, buffer.Capacity);
      if (buffer.ToString().Contains(needle)) {
        uint owner;
        GetWindowThreadProcessId(hWnd, out owner);
        found = (int)owner;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$owner = [InkfinWindows]::FindPid('${escaped}')
if ($owner -eq 0) { 'none' } else { (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName }
`);
}

function cmd(...args) {
  try {
    return execFileSync('cmd.exe', ['/c', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
}

/**
 * Put the extension values back the way they were found.
 *
 * The registry provider opens keys read-only, so the default value is written
 * through a `RegistryKey` handle opened for writing, the same way the reset
 * script does it.
 */
function restoreAssociations(snapshot) {
  for (const extension of EXTENSIONS) {
    const before = snapshot[extension];
    const writeValue = (name, value) =>
      ps(`
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\${extension}', $true)
if ($key) {
  ${value === '' ? `$key.DeleteValue('${name}', $false)` : `$key.SetValue('${name}', '${value}')`}
  $key.Close()
}
`);
    writeValue('', before.default ?? '');
    writeValue(BACKUP_VALUE, before.backup ?? '');
  }
}

let installed = false;
let app = null;
let cdp = null;

try {
  results.associationsBefore = associationSnapshot();

  results.installerSha256 = execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `(Get-FileHash -Algorithm SHA256 -LiteralPath '${installer}').Hash`,
  ])
    .toString()
    .trim()
    .toLowerCase();

  // ---- install -----------------------------------------------------------
  // Resolve the expected directory first, so the `finally` block can still
  // uninstall if the install step itself fails part-way.
  results.installDirectory = unquote(
    ps(`
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inkfin'
$location = (Get-ItemProperty $key -ErrorAction SilentlyContinue).InstallLocation
if (-not $location) { $location = Join-Path $env:LOCALAPPDATA 'Inkfin' }
$location
`),
  );
  installed = true;
  ps(`Start-Process -FilePath '${installer}' -ArgumentList '/S' -Wait`);
  results.installedAt = new Date().toISOString();

  const installDir = results.installDirectory;
  const exe = ps(
    `$p = Join-Path '${installDir}' 'inkfin.exe'; if (Test-Path $p) { $p } else { '' }`,
  );
  if (!exe) {
    throw new Error(`installed executable not found in ${installDir}`);
  }
  results.installerWroteExecutable = exe;

  // ---- registry associations --------------------------------------------
  const association = (extension) => {
    const progId = ps(
      `(Get-ItemProperty 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\${extension}' -ErrorAction SilentlyContinue).'(default)'`,
    );
    const command = progId
      ? ps(
          `(Get-ItemProperty 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\${progId}\\shell\\open\\command' -ErrorAction SilentlyContinue).'(default)'`,
        )
      : '';
    return { progId, command, pointsAtInstalledExe: Boolean(command && command.includes(exe)) };
  };
  results.associations['.md'] = association('.md');
  results.associations['.markdown'] = association('.markdown');
  for (const extension of EXTENSIONS) {
    const entry = results.associations[extension];
    if (!entry.progId) fail(`${extension} has no registered ProgID after install`);
    if (!entry.pointsAtInstalledExe) fail(`${extension} does not open the installed executable`);
  }
  results.associationsInstalled = extensionState();

  // ---- launch the installed app -----------------------------------------
  // The DNS blackhole stands in for an offline machine: with every host name
  // resolving to 0.0.0.0 nothing in the session can reach the network, so the
  // render checks below are also offline evidence.
  app = spawn(exe, [fixture], {
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --host-resolver-rules=MAP * 0.0.0.0 --disable-features=Translate`,
    },
  });
  const target = await findTarget();
  if (!target) throw new Error('the installed app never exposed a CDP target');
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);

  await cdp.send('Network.enable');
  results.offlineSimulated = true;

  const shown = await waitFor(cdp, 'document.body.innerText.includes("Acceptance fixture")', 30000);
  results.rendered = shown.ok;

  // ---- keyboard search ---------------------------------------------------
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: 2,
    key: 'f',
    code: 'KeyF',
    windowsVirtualKeyCode: 70,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 2,
    key: 'f',
    code: 'KeyF',
    windowsVirtualKeyCode: 70,
  });
  const searchOpen = await waitFor(
    cdp,
    'document.activeElement?.getAttribute("aria-label") === "Find in document"',
    5000,
  );
  results.keyboard.shortcutOpenedSearch = searchOpen.ok;

  if (searchOpen.ok) {
    await cdp.send('Input.insertText', { text: 'alpha' });
    const counted = await waitFor(cdp, '/(\\d+) of (\\d+)/.test(document.body.innerText)', 5000);
    results.keyboard.queryScored = counted.ok;
    results.keyboard.countText = await cdp.evaluate(
      '(document.body.innerText.match(/\\d+ of \\d+/) || [null])[0]',
    );

    // The accessibility tree is dumped while the search box is on screen, so the
    // textbox and its accessible name are present when it is read.
    await cdp.send('Accessibility.enable');
    const openTree = await cdp.send('Accessibility.getFullAXTree');
    const openNodes = openTree.result?.nodes ?? [];
    results.accessibility.searchTextboxName =
      openNodes.find((node) => node.role?.value === 'textbox')?.name?.value ?? null;
    results.accessibility.hasFindTextbox = openNodes.some(
      (node) => node.role?.value === 'textbox' && /find in document/i.test(node.name?.value ?? ''),
    );
    if (!results.accessibility.hasFindTextbox) {
      fail('the search box has no accessible name in the accessibility tree');
    }

    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    const closed = await waitFor(
      cdp,
      'document.activeElement?.getAttribute("aria-label") !== "Find in document"',
      5000,
    );
    results.keyboard.escapeClosed = closed.ok;
    results.keyboard.focusReturned = await cdp.evaluate(
      'document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName',
    );
  }

  // ---- keyboard traversal ------------------------------------------------
  // Tab moves focus natively over the Page domain; the loop records where it
  // lands and whether the landing spot is visible, which is what a keyboard-only
  // reader needs to keep their place.
  const stops = [];
  for (let step = 0; step < 12; step += 1) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    });
    await sleep(60);
    const stop = await cdp.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || '',
        focusRing: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
      };
    })()`);
    if (stop) stops.push(stop);
  }
  results.keyboard.tabStops = stops;
  results.keyboard.focusRingOnEveryStop = stops.length > 0 && stops.every((stop) => stop.focusRing);
  if (!results.keyboard.focusRingOnEveryStop) {
    fail('a keyboard Tab stop has no visible focus ring');
  }

  // ---- accessibility tree ------------------------------------------------
  await cdp.send('Accessibility.enable');
  const tree = await cdp.send('Accessibility.getFullAXTree');
  const nodes = tree.result?.nodes ?? [];
  results.accessibility.nodeCount = nodes.length;
  results.accessibility.namedButtons = nodes
    .filter((node) => node.role?.value === 'button' && node.name?.value)
    .map((node) => node.name.value)
    .slice(0, 20);
  results.accessibility.hasDocumentHeading = nodes.some(
    (node) => node.role?.value === 'heading' && /acceptance fixture/i.test(node.name?.value ?? ''),
  );
  if (!results.accessibility.hasDocumentHeading)
    fail('the document heading is missing from the accessibility tree');

  // ---- minimum window size ----------------------------------------------
  const handle = resizeWindowOf(app.pid, ' - Inkfin', 480, 360);
  results.minimumWindow.handle = handle;
  if (handle && handle !== '0') {
    await sleep(700);
    results.minimumWindow.size = await cdp.evaluate('({ width: innerWidth, height: innerHeight })');
    results.minimumWindow.overflow = await cdp.evaluate(
      '({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 })',
    );
    if (results.minimumWindow.overflow.pageOverflow) {
      fail('the page gains horizontal overflow at the 480 x 360 minimum');
    }
    results.minimumWindow.toolbarVisible = await cdp.evaluate(
      '(() => { const el = document.querySelector(".toolbar"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()',
    );
  } else {
    fail('could not find the installed app window to resize it');
  }

  // ---- atomic save -------------------------------------------------------
  const marker = `atomic-marker-${Date.now()}`;
  const staged = path.join(work, 'staged.md');
  writeFileSync(staged, readFileSync(fixture, 'utf8') + `\n\n${marker}\n`);
  const filesBefore = ps(
    `(Get-ChildItem -LiteralPath '${work}' -File | Select-Object -ExpandProperty Name) -join ','`,
  );
  ps(`Move-Item -LiteralPath '${staged}' -Destination '${fixture}' -Force`);
  const atomic = await waitFor(
    cdp,
    `document.body.innerText.includes(${JSON.stringify(marker)})`,
    15000,
    25,
  );
  results.atomicSave.visible = atomic.ok;
  results.atomicSave.milliseconds = atomic.milliseconds;
  results.atomicSave.filesBefore = filesBefore;
  results.atomicSave.filesAfter = ps(
    `(Get-ChildItem -LiteralPath '${work}' -File | Select-Object -ExpandProperty Name) -join ','`,
  );
  // The staged file is the save; anything else that appeared is a leftover the
  // app should not have written.
  const expected = filesBefore
    .split(',')
    .filter((name) => name && name !== 'staged.md')
    .sort()
    .join(',');
  if (results.atomicSave.filesAfter !== expected) {
    fail(`the save changed the document folder: ${results.atomicSave.filesAfter}`);
  }
  if (!atomic.ok) fail('a rename-over-original save never appeared in the installed app');

  // ---- denied file -------------------------------------------------------
  ps(`icacls '${denied}' /deny "${process.env.USERNAME}:(R)" | Out-Null`);
  spawn(exe, [denied], { stdio: 'ignore' });
  const deniedShown = await waitFor(
    cdp,
    'document.body.innerText.includes("Access denied") || document.body.innerText.includes("could not be read")',
    15000,
    100,
  );
  results.deniedFile.errorShown = deniedShown.ok;
  results.deniedFile.presentedAs = await cdp.evaluate(
    'document.querySelector(".error-state") ? "error state" : (document.querySelector(".notice") ? "notice" : "neither")',
  );
  results.deniedFile.message = await cdp.evaluate(
    '((document.querySelector(".error-state-copy") ?? document.querySelector(".notice-message") ?? document.querySelector("[role=alert]") ?? {}).innerText ?? "").trim()',
  );
  results.deniedFile.documentStillOnScreen = await cdp.evaluate(
    'document.body.innerText.includes("Acceptance fixture")',
  );
  ps(`icacls '${denied}' /remove:d "${process.env.USERNAME}" | Out-Null`);
  if (!deniedShown.ok) fail('a denied file did not produce an error state in the installed app');

  // ---- shell dispatch through the registered associations -----------------
  // This is what a reader's double click does: `start` hands the path to the
  // shell, the shell reads the association, and the already-running instance must
  // take the document over instead of a second process appearing. The `.md` case
  // is recorded rather than asserted, because Windows 11 may let a per-user
  // choice for another app outrank the ProgID Inkfin just wrote.
  results.shellDispatch = {};
  for (const extension of EXTENSIONS) {
    const stamp = Date.now();
    const probe = path.join(work, `association-probe-${stamp}${extension}`);
    const probeMarker = `association-marker-${stamp}`;
    writeFileSync(probe, `# Association probe\n\n${probeMarker}\n`);
    const processesBefore = ps(`@(Get-Process inkfin -ErrorAction SilentlyContinue).Count`);
    cmd('start', '', probe);
    const dispatched = await waitFor(
      cdp,
      `document.body.innerText.includes(${JSON.stringify(probeMarker)})`,
      20000,
      100,
    );
    const record = {
      path: probe,
      reachedInkfin: dispatched.ok,
      milliseconds: dispatched.milliseconds,
      processesBefore,
      processesAfter: ps(`@(Get-Process inkfin -ErrorAction SilentlyContinue).Count`),
      openedBy: windowOwner(path.basename(probe)),
    };
    results.shellDispatch[extension] = record;
    if (record.processesAfter !== record.processesBefore) {
      fail(`opening a ${extension} file started a second installed process`);
    }
    if (extension === '.markdown' && !dispatched.ok) {
      fail('a .markdown file opened through the shell association never reached the app');
    }
  }

  // ---- no network traffic -------------------------------------------------
  // Every resource the page loaded, straight from the renderer. Nothing may
  // address an http(s) origin, with or without the blackhole in place.
  results.requests = await cdp.evaluate(
    "performance.getEntriesByType('resource').map((entry) => entry.name)",
  );
  const external = (results.requests ?? []).filter((url) => /^https?:/i.test(url));
  results.externalRequests = external;
  // Tauri serves the bundled frontend from tauri.localhost and the Rust commands
  // from ipc.localhost; both are loopback scheme handlers, not the network.
  const offScheme = external.filter((url) => !/^https?:\/\/(tauri|ipc)\.localhost\//i.test(url));
  results.offSchemeRequests = offScheme;
  if (offScheme.length > 0) fail(`the app requested an external origin: ${offScheme[0]}`);

  cdp.close();
  cdp = null;
  killTree(app.pid);
  app = null;
} catch (error) {
  fail(`audit error: ${error.message}`);
} finally {
  if (cdp) cdp.close();
  if (app) killTree(app.pid);

  if (installed) {
    try {
      const uninstaller = ps(
        `$u = Join-Path '${results.installDirectory}' 'uninstall.exe'; if (Test-Path $u) { $u } else { '' }`,
      );
      if (uninstaller) {
        ps(`Start-Process -FilePath '${uninstaller}' -ArgumentList '/S' -Wait`);
        await sleep(3000);

        // Read the associations the uninstaller left behind *before* this script
        // puts the host back, otherwise the cleanup would mask them.
        const leftBehind = extensionState();
        restoreAssociations(results.associationsBefore);
        results.associationsAfterUninstall = leftBehind;
        results.associationsAfterRestore = associationSnapshot();
        results.associationsRestored =
          JSON.stringify(results.associationsAfterRestore) ===
          JSON.stringify(results.associationsBefore);
        if (!results.associationsRestored) {
          fail('the extension associations were not restored to their pre-install values');
        }
        for (const extension of EXTENSIONS) {
          const state = leftBehind[extension];
          if (state.progId && !state.progIdExists) {
            fail(
              `the uninstaller left ${extension} pointing at ${state.progId}, a ProgID it deleted`,
            );
          }
          if (state.backupPresent) {
            fail(`the uninstaller left the ${BACKUP_VALUE} value on ${extension}`);
          }
        }
        results.uninstalled = {
          uninstaller,
          executableStillPresent:
            ps(
              `if (Test-Path (Join-Path '${results.installDirectory}' 'inkfin.exe')) { 'yes' } else { 'no' }`,
            ) === 'yes',
          mdProgIdAfterUninstall: leftBehind['.md'].progId,
          markdownProgIdAfterUninstall: leftBehind['.markdown'].progId,
        };
      } else {
        results.uninstalled = { uninstaller: null };
        fail('no uninstall.exe was found in the install directory');
      }
    } catch (error) {
      fail(`uninstall error: ${error.message}`);
    }
  }
  rmSync(work, { recursive: true, force: true });
}

writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
process.exit(results.failures.length === 0 ? 0 : 1);
