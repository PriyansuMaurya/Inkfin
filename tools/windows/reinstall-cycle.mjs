/**
 * Reinstall-then-uninstall association cycle check for Windows.
 *
 * The installer remembers each extension's previous default in a
 * `Markdown Document_backup` value and restores it on uninstall. When Inkfin is
 * installed over an existing Inkfin installation, that remembered value is
 * Inkfin's own ProgID, so the following uninstall restores an association to a
 * ProgID it has just deleted. Every Markdown file then asks which app to use.
 *
 * The cycle is: install, install again over the top, uninstall, then read the
 * extensions. A dangling default fails the run.
 *
 * Usage:
 *   node tools/windows/reinstall-cycle.mjs <setup.exe> [outJson]
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const installer = path.resolve(
  process.argv[2] ?? 'artifacts/windows/Inkfin_0.1.2_x64-setup-local-fixed.exe',
);
const outFile = process.argv[3] ?? 'artifacts/windows/reinstall-cycle.json';
const EXTENSIONS = ['.md', '.markdown'];
const PROG_ID = 'Markdown Document';
const BACKUP_VALUE = `${PROG_ID}_backup`;
const stateScript = path.resolve('tools/windows/assoc-state.ps1');

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function associationState() {
  const report = JSON.parse(
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stateScript],
      {
        encoding: 'utf8',
      },
    ),
  );
  return report;
}

function install() {
  ps(`Start-Process -FilePath '${installer}' -ArgumentList '/S' -Wait`);
}

function uninstall() {
  const directory = path.join(process.env.LOCALAPPDATA ?? '', 'Inkfin');
  const uninstaller = path.join(directory, 'uninstall.exe');
  ps(`Start-Process -FilePath '${uninstaller}' -ArgumentList '/S' -Wait`);
}

const results = { installer, installerSha256: null, steps: [], failures: [] };
const fail = (message) => results.failures.push(message);

function record(label) {
  const state = associationState();
  const summary = Object.fromEntries(
    state.extensions.map((entry) => [
      entry.extension,
      { default: entry.defaultValue, backupPresent: entry.values.includes(BACKUP_VALUE) },
    ]),
  );
  results.steps.push({ label, associations: summary, progIdExists: state.state[PROG_ID] });
  for (const extension of EXTENSIONS) {
    const entry = summary[extension];
    if (entry.default === PROG_ID && !state.state[PROG_ID]) {
      fail(`after ${label}, ${extension} points at ${PROG_ID}, which does not exist`);
    }
  }
  return summary;
}

try {
  results.installerSha256 = ps(
    `(Get-FileHash -Algorithm SHA256 -LiteralPath '${installer}').Hash`,
  ).toLowerCase();
  const before = record('before');
  install();
  record('after first install');
  install();
  record('after reinstall over the top');
  uninstall();
  const after = record('after uninstall');

  // The stronger expectation: an uninstall must put the extensions back exactly
  // where the first install found them, not merely stop naming a dead ProgID.
  for (const extension of EXTENSIONS) {
    const was = before[extension].default ?? '';
    const is = after[extension].default ?? '';
    if (was !== is) {
      fail(`after uninstall, ${extension} is [${is}] but started as [${was}]`);
    }
    if (after[extension].backupPresent) {
      fail(`after uninstall, ${extension} still carries the ${BACKUP_VALUE} value`);
    }
  }
} catch (error) {
  fail(`cycle error: ${error.message}`);
} finally {
  // Leave the host as it was found, whatever happened above.
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stateScript, '-Reset'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    results.reset = true;
  } catch (error) {
    results.reset = false;
    fail(`reset error: ${error.message}`);
  }
}

writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
process.exit(results.failures.length === 0 ? 0 : 1);
