// Tests for scripts/agent-chrome.sh (config parser, JSON of `status`) and scripts/agent-chrome-cdp.mjs (heal --boot,
// heal --ext) against a fake DevTools port — no Chrome is started. setup.mjs and agent-ext.mjs: tests/setup.test.mjs.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFake } from './fake-cdp.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = path.join(ROOT, 'scripts/agent-chrome.sh');
const HELPER = path.join(ROOT, 'scripts/agent-chrome-cdp.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chrome-test-'));
const write = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); return f; };
// A folder that looks like an unpacked extension.
const extDir = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'manifest.json'), '{"manifest_version":3}'); return d; };

// conf_lines of the script itself, run in bash against a config file.
async function confLines(text) {
  const conf = text === null ? path.join(tmp, 'missing.conf') : write(`c${Math.random()}.conf`, text);
  const src = `CONF='${conf}'; eval "$(sed -n '/^conf_lines() {/,/^}/p' '${SH}')"; conf_lines`;
  const { stdout } = await run('/bin/bash', ['-c', src]);
  return stdout.split('\n').filter(Boolean).map(l => l.split('\t'));
}
const helper = async (port, ...args) => {
  try { const { stdout } = await run(process.execPath, [HELPER, String(port), ...args]); return JSON.parse(stdout); }
  catch (e) { if (e.stdout) return JSON.parse(e.stdout); throw e; }
};

test('config: name=port with optional app= and ext= in any order', async () => {
  const rows = await confLines([
    '# comment',
    'agent=9333',
    'work=9334 app=Google Chrome Beta',
    'a=9335 app=Google Chrome Beta ext=/x/ubol:/Users/me/Application Support/ext two',
    'b=9336 ext=/x/ubol app=Google Chrome Beta',
    'c=9337 ext=/one ext=/two',
    '  d = 9338  ',
    'bad line',
    '',
  ].join('\n'));
  assert.deepEqual(rows, [
    ['agent=9333', '', ''],
    ['work=9334', 'Google Chrome Beta', ''],
    ['a=9335', 'Google Chrome Beta', '/x/ubol:/Users/me/Application Support/ext two'],
    ['b=9336', 'Google Chrome Beta', '/x/ubol'],
    ['c=9337', '', '/one:/two'],
    ['d=9338', '', ''],
  ]);
});

test('config: no file → built-in agent=9333 without app and ext', async () => {
  assert.deepEqual(await confLines(null), [['agent=9333', '', '']]);
});

test('profiles command ignores app= and ext=', async () => {
  const conf = write('p.conf', 'a=9335 ext=/x app=Google Chrome Beta\nb=9336 app=Google Chrome\n');
  const { stdout } = await run(SH, ['profiles'], { env: { ...process.env, AGENT_CHROME_CONF: conf } });
  assert.equal(stdout, 'a=9335\nb=9336\n');
});

test('heal --boot: first window runs session restore, the blank page is closed again', async () => {
  const fake = await startFake({ restoreOnFirstWindow: ['https://a.example/', 'https://b.example/'] });
  try {
    const r = await helper(fake.port, 'heal', '--boot');
    assert.equal(r.ok, true);
    assert.deepEqual(r.boot, { restored: 2 });
    assert.equal(r.tabs, 2);
    assert.deepEqual(fake.state.pages.map(p => p.url), ['https://a.example/', 'https://b.example/']);
    assert.equal(r.ext, undefined, 'no --ext → no "ext" key');
  } finally { await fake.close(); }
});

test('heal --boot without a saved session keeps one blank page', async () => {
  const fake = await startFake();
  try {
    const r = await helper(fake.port, 'heal', '--boot');
    assert.deepEqual(r.boot, { restored: 0 });
    assert.equal(r.tabs, 1);
    assert.deepEqual(fake.state.pages.map(p => p.url), ['about:blank']);
  } finally { await fake.close(); }
});

test('heal --boot when Chrome already has a page opens nothing', async () => {
  const fake = await startFake({ pages: ['https://kept.example/'] });
  try {
    const r = await helper(fake.port, 'heal', '--boot');
    assert.equal(r.boot.restored, 0);
    assert.equal(r.tabs, 1);
    assert.ok(!fake.state.calls.includes('Target.createTarget'));
  } finally { await fake.close(); }
});

test('heal on a running profile with no page opens a background blank window', async () => {
  const fake = await startFake();
  try {
    const r = await helper(fake.port, 'heal');
    assert.equal(r.opened, 'about:blank');
    assert.equal(r.tabs, 1);
  } finally { await fake.close(); }
});

test('heal --ext: loads a missing extension, reports a present one, warns on a bad folder', async () => {
  const have = extDir('have'), want = extDir('want');
  const fake = await startFake({ pages: ['https://x.example/'], extensions: [{ id: 'present1', path: have }] });
  try {
    const r = await helper(fake.port, 'heal', '--ext', `${have}:${want}:${path.join(tmp, 'nope')}:relative/dir`);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ext, [
      { id: 'present1', dir: have, loaded: true, enabled: true },
      { id: 'ext2', dir: want, loaded: true, new: true },
      { dir: path.join(tmp, 'nope'), loaded: false, warning: 'no manifest.json in this folder' },
      { dir: 'relative/dir', loaded: false, warning: 'not an absolute path' },
    ]);
    const again = await helper(fake.port, 'heal', '--ext', want);
    assert.deepEqual(again.ext, [{ id: 'ext2', dir: want, loaded: true, enabled: true }], 'second call does not load twice');
  } finally { await fake.close(); }
});

test('heal --ext: a failed load is a warning, not a failure', async () => {
  const want = extDir('want2');
  const fake = await startFake({ pages: ['https://x.example/'], loadFails: true });
  try {
    const r = await helper(fake.port, 'heal', '--ext', want);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ext, [{ dir: want, loaded: false, warning: 'load failed (fake)' }]);
  } finally { await fake.close(); }
});

test('status: JSON carries profile fields and "ext" from the config line', async () => {
  const want = extDir('want3');
  const fake = await startFake({ pages: ['https://x.example/'] });
  try {
    const conf = write('s.conf', `zztest=${fake.port} app=Google Chrome Beta ext=${want}\nzzplain=${fake.port}\n`);
    const env = { ...process.env, AGENT_CHROME_CONF: conf };
    const { stdout } = await run(SH, ['status', 'zztest'], { env });
    const r = JSON.parse(stdout);
    assert.equal(r.profile, 'zztest');
    assert.equal(r.running, true);
    assert.equal(r.app, 'Google Chrome Beta');
    assert.equal(r.port, fake.port);
    assert.deepEqual(r.ext, [{ id: 'ext1', dir: want, loaded: true, new: true }]);
    const plain = JSON.parse((await run(SH, ['status', 'zzplain'], { env })).stdout);
    assert.equal(plain.app, 'Google Chrome');
    assert.equal(plain.ext, undefined, 'no ext= → no "ext" key');
  } finally { await fake.close(); }
});

test('start line has --no-startup-window and no foreground flags', () => {
  const src = fs.readFileSync(SH, 'utf8');
  const start = src.slice(src.indexOf('start() {'), src.indexOf('case "$CMD" in\n  ensure)'));
  assert.match(start, /\$OPEN -g -n -a "\$APP" --args/);
  assert.match(start, /--no-startup-window/);
  assert.doesNotMatch(start, /activate|osascript/);
});
