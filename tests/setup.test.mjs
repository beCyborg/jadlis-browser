// Tests for scripts/setup.mjs (driver switch, rendered mcpServers, Patchright runtime install with a stub npm, fallback,
// --adblock config edit) and scripts/agent-ext.mjs (profile resolution). Every run uses a scratch HOME: no Chrome, no
// network, no launchd. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP = path.join(ROOT, 'scripts/setup.mjs');
const EXTJS = path.join(ROOT, 'scripts/agent-ext.mjs');
const SRC = fs.readFileSync(SETUP, 'utf8');
const pin = name => SRC.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const PATCHRIGHT = pin('PATCHRIGHT_VERSION'), PWMCP = pin('PLAYWRIGHT_MCP_VERSION');
const UBOL_VERSION = SRC.match(/version: '([\d.]+)'/)[1];
const AUTOCONSENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/adblock/package.json'), 'utf8')).dependencies['@duckduckgo/autoconsent'];

// A scratch HOME with agent-chrome.conf and agent.conf.
function home(conf, agentConf = '') {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'jb-setup-'));
  fs.mkdirSync(path.join(h, '.config/jadlis'), { recursive: true });
  if (conf !== null) fs.writeFileSync(path.join(h, '.config/jadlis/agent-chrome.conf'), conf);
  fs.writeFileSync(path.join(h, '.config/jadlis/agent.conf'), agentConf);
  return h;
}
const envFor = (h, extra = {}) => {
  const e = { ...process.env, HOME: h, ...extra };
  delete e.AGENT_CHROME_CONF; delete e.JADLIS_AGENT_CONF; delete e.JADLIS_BROWSER_NPM; delete e.JADLIS_BROWSER_UBOL_ZIP;
  return { ...e, ...extra };
};
async function setup(h, args, extra) {
  try { const r = await run(process.execPath, [SETUP, ...args], { env: envFor(h, extra) }); return { code: 0, out: r.stdout }; }
  catch (e) { return { code: e.code, out: e.stdout, err: e.stderr }; }
}
const printAgent = async (h, extra) => (await setup(h, ['--print-agent'], extra)).out;
const servers = agent => agent.slice(agent.indexOf('mcpServers:'), agent.indexOf('\nskills:'));
// A stub npm: records its arguments and lays out the files a real `npm install patchright-core@<v>` leaves.
function stubNpm(h, { fail = false } = {}) {
  const f = path.join(h, fail ? 'npm-fail.sh' : 'npm-ok.sh');
  fs.writeFileSync(f, fail ? '#!/bin/bash\necho "npm error network down" >&2\nexit 1\n' : `#!/bin/bash
echo "$@" >> "${h}/npm-args.txt"
mkdir -p node_modules/patchright-core/lib/entry
echo '{"name":"patchright-core","version":"${PATCHRIGHT}"}' > node_modules/patchright-core/package.json
echo '// stub' > node_modules/patchright-core/lib/entry/mcp.js
echo '{"lockfileVersion":3}' > package-lock.json
`, { mode: 0o755 });
  return f;
}
const TWO = 'k02=9333 app=Google Chrome Beta\njadlis=9334 app=Google Chrome Beta\n';

test('default driver: every CDP profile runs Patchright MCP by absolute node + entry, the bridge stays on @playwright/mcp', async () => {
  const h = home(TWO);
  const a = await printAgent(h);
  const entry = path.join(h, `.local/share/jadlis-browser/patchright-${PATCHRIGHT}/node_modules/patchright-core/lib/entry/mcp.js`);
  for (const [n, p] of [['k02', 9333], ['jadlis', 9334]]) {
    const m = servers(a).match(new RegExp(`- pw-${n}:\\n\\s+type: stdio\\n\\s+command: (\\S+)\\n\\s+args: \\[(.*)\\]`));
    assert.ok(m, `pw-${n} block`);
    assert.ok(path.isAbsolute(m[1]) && /\/node$/.test(m[1]), `absolute node: ${m[1]}`);
    const args = JSON.parse(`[${m[2]}]`);
    assert.equal(args[0], entry);
    assert.deepEqual(args.slice(1, 3), ['--cdp-endpoint', `http://127.0.0.1:${p}`]);
  }
  assert.match(servers(a), new RegExp(`- pw:\\n\\s+type: stdio\\n\\s+command: npx\\n\\s+args: \\["@playwright/mcp@${PWMCP}", "--extension"`));
  assert.match(a, /^tools: mcp__pw-k02__\*, mcp__pw-jadlis__\*, mcp__pw__\*/m);
  assert.match(a, /driven by Patchright MCP/);
  assert.doesNotMatch(a, /\{\{/, 'no placeholder left');
  assert.ok(!fs.existsSync(path.join(h, '.claude')), '--print-agent writes nothing');
});

test('BROWSER_DRIVER=playwright: CDP profiles run npx @playwright/mcp, no Patchright path anywhere', async () => {
  const h = home(TWO, 'BROWSER_DRIVER="playwright"\n');
  const a = await printAgent(h);
  for (const n of ['k02', 'jadlis']) assert.match(servers(a), new RegExp(`- pw-${n}:\\n\\s+type: stdio\\n\\s+command: npx\\n\\s+args: \\["@playwright/mcp@${PWMCP}", "--cdp-endpoint"`));
  assert.doesNotMatch(a, /patchright-core\/lib\/entry/);
  assert.match(a, /driven by Playwright MCP/);
  assert.doesNotMatch(a, /\{\{/);
});

test('unknown BROWSER_DRIVER → warning, Patchright', async () => {
  const h = home(TWO, 'BROWSER_DRIVER=selenium\n');
  const r = JSON.parse((await setup(h, ['--dry-run', '--no-launchd'])).out);
  assert.match(r.driver, /^Patchright MCP/);
  assert.match(r.warnings.join(' '), /BROWSER_DRIVER="selenium" is unknown/);
});

test('profile lines: ext= before app= is kept, a line with junk after the port is not a profile', async () => {
  const h = home('# c\na=9335 ext=/x app=Google Chrome Beta\nb=9336 app=Google Chrome Beta ext=/x\n  d = 9338  \nc=9337 foo\nbad line\n', 'BROWSER_DRIVER=playwright\n');
  const s = servers(await printAgent(h));
  assert.deepEqual([...s.matchAll(/- (pw(?:-[a-z0-9_-]+)?):/g)].map(m => m[1]), ['pw-a', 'pw-b', 'pw-d', 'pw']);
});

test('install: stub npm gets an exact pin without scripts; the re-run changes nothing', async () => {
  const h = home(TWO);
  const npm = stubNpm(h);
  const first = await setup(h, ['--no-launchd'], { JADLIS_BROWSER_NPM: npm });
  assert.equal(first.code, 0, first.err);
  const r = JSON.parse(first.out);
  assert.equal(r.ok, true);
  assert.match(r.runtime, /^installed: /);
  assert.match(r.driver, new RegExp(`patchright-core ${PATCHRIGHT.replace(/\./g, '\\.')}`));
  const npmArgs = fs.readFileSync(path.join(h, 'npm-args.txt'), 'utf8');
  for (const a of ['install', '--save-exact', '--ignore-scripts', `patchright-core@${PATCHRIGHT}`]) assert.ok(npmArgs.split(/\s+/).includes(a), `npm got ${a}`);
  const rt = path.join(h, `.local/share/jadlis-browser/patchright-${PATCHRIGHT}`);
  assert.ok(fs.existsSync(path.join(rt, 'package-lock.json')), 'lock file kept');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rt, 'package.json'), 'utf8')).private, true);
  for (const f of ['agent-chrome.sh', 'agent-chrome-cdp.mjs', 'agent-ext.mjs']) assert.ok(fs.existsSync(path.join(h, '.claude/scripts', f)), f);
  const agent = fs.readFileSync(path.join(h, '.claude/agents/browser-operator.md'), 'utf8');
  assert.ok(agent.includes(path.join(rt, 'node_modules/patchright-core/lib/entry/mcp.js')));
  const again = JSON.parse((await setup(h, ['--no-launchd'], { JADLIS_BROWSER_NPM: npm })).out);
  assert.match(again.runtime, /^present: /);
  assert.deepEqual(again.changed, []);
  assert.equal(fs.readFileSync(path.join(h, 'npm-args.txt'), 'utf8'), npmArgs, 'npm not called again');
});

test('install fails → clear warning, CDP profiles fall back to @playwright/mcp, the file is not broken', async () => {
  const h = home(TWO);
  const res = await setup(h, ['--no-launchd'], { JADLIS_BROWSER_NPM: stubNpm(h, { fail: true }) });
  assert.equal(res.code, 0);
  const r = JSON.parse(res.out);
  assert.equal(r.ok, true);
  assert.match(r.runtime, /^FAILED: npm install failed: npm error network down/);
  assert.match(r.warnings.join(' '), /fall back to @playwright\/mcp@/);
  const s = servers(fs.readFileSync(path.join(h, '.claude/agents/browser-operator.md'), 'utf8'));
  assert.match(s, new RegExp(`- pw-k02:\\n\\s+type: stdio\\n\\s+command: npx\\n\\s+args: \\["@playwright/mcp@${PWMCP}"`));
  assert.doesNotMatch(s, /patchright-core/);
});

// --adblock with both extension folders already in place: only the config edit and the build-folder copy run.
function readyExtensions(h) {
  const d = path.join(h, '.local/share/jadlis-browser');
  fs.mkdirSync(path.join(d, 'ubol/current'), { recursive: true });
  fs.writeFileSync(path.join(d, 'ubol/current/manifest.json'), JSON.stringify({ version: UBOL_VERSION }));
  fs.mkdirSync(path.join(d, 'autoconsent-ext'), { recursive: true });
  fs.writeFileSync(path.join(d, 'autoconsent-ext/manifest.json'), JSON.stringify({ version: AUTOCONSENT }));
  return { ubol: path.join(d, 'ubol/current'), cookie: path.join(d, 'autoconsent-ext'), data: d };
}

test('--adblock adds ext= to every profile line that lacks it, keeps comments, backs up, then is idempotent', async () => {
  const h = home(null, 'BROWSER_DRIVER=playwright\n');
  const x = readyExtensions(h);
  const conf = path.join(h, '.config/jadlis/agent-chrome.conf');
  fs.writeFileSync(conf, `# my profiles\nk02=9333 app=Google Chrome Beta\njadlis=9334 app=Google Chrome Beta ext=${x.ubol}\n# old=9339\n`);
  const r = JSON.parse((await setup(h, ['--adblock', '--no-launchd'])).out);
  assert.equal(r.adblock.ubol.state, 'present');
  assert.equal(r.adblock.cookie_refusal.state, 'present');
  assert.equal(fs.readFileSync(conf, 'utf8'), `# my profiles\nk02=9333 app=Google Chrome Beta ext=${x.ubol} ext=${x.cookie}\njadlis=9334 app=Google Chrome Beta ext=${x.ubol} ext=${x.cookie}\n# old=9339\n`);
  assert.ok(fs.readdirSync(path.dirname(conf)).some(f => f.startsWith('agent-chrome.conf.bak-')), 'backup next to the config');
  assert.ok(r.changed.includes(conf));
  for (const f of ['build.sh', 'package.json', 'package-lock.json', 'skip-hosts.default.txt', 'src/entry.ts']) assert.ok(fs.existsSync(path.join(x.data, 'adblock-build', f)), f);
  const again = JSON.parse((await setup(h, ['--adblock', '--no-launchd'])).out);
  assert.match(String(again.adblock.added), /^nothing/);
  assert.ok(!again.changed.includes(conf));
});

test('--adblock=<profile> edits only that line; plain setup never touches the config', async () => {
  const h = home(TWO, 'BROWSER_DRIVER=playwright\n');
  const x = readyExtensions(h);
  const conf = path.join(h, '.config/jadlis/agent-chrome.conf');
  await setup(h, ['--no-launchd']);
  assert.equal(fs.readFileSync(conf, 'utf8'), TWO);
  await setup(h, ['--adblock=jadlis', '--no-launchd']);
  assert.equal(fs.readFileSync(conf, 'utf8'), `k02=9333 app=Google Chrome Beta\njadlis=9334 app=Google Chrome Beta ext=${x.ubol} ext=${x.cookie}\n`);
});

test('--adblock: a uBOL zip with a wrong sha256 is not unpacked and not added', async () => {
  const h = home('agent=9333\n', 'BROWSER_DRIVER=playwright\n');
  const x = readyExtensions(h);
  fs.rmSync(path.join(x.ubol, 'manifest.json'));
  const zdir = path.join(h, 'z'); fs.mkdirSync(zdir); fs.writeFileSync(path.join(zdir, 'manifest.json'), JSON.stringify({ version: UBOL_VERSION }));
  await run('/usr/bin/zip', ['-q', '-j', path.join(h, 'fake.zip'), path.join(zdir, 'manifest.json')]);
  const r = JSON.parse((await setup(h, ['--adblock', '--no-launchd'], { JADLIS_BROWSER_UBOL_ZIP: path.join(h, 'fake.zip') })).out);
  assert.equal(r.adblock.ubol.ok, false);
  assert.match(r.adblock.ubol.error, /sha256 of .* expected/);
  assert.match(r.warnings.join(' '), /not added to the profiles/);
  assert.equal(fs.readFileSync(path.join(h, '.config/jadlis/agent-chrome.conf'), 'utf8'), `agent=9333 ext=${x.cookie}\n`);
  assert.ok(!fs.existsSync(path.join(x.ubol, 'manifest.json')));
});

test('agent-ext.mjs resolves a profile name to its port and ext= folders', async () => {
  const h = home('k02=9 app=Google Chrome Beta ext=/x/ubol\nbare=8\n');
  const ext = async (...a) => {
    try { await run(process.execPath, [EXTJS, ...a], { env: envFor(h) }); return { code: 0 }; }
    catch (e) { return { code: e.code, r: JSON.parse(e.stdout) }; }
  };
  assert.deepEqual(await ext('state', 'nope'), { code: 64, r: { ok: false, error: `no profile "nope" in ${path.join(h, '.config/jadlis/agent-chrome.conf')}` } });
  const bare = await ext('load', 'bare');
  assert.equal(bare.code, 64);
  assert.match(bare.r.error, /has no ext= folders/);
  const k = await ext('load', 'k02');
  assert.equal(k.code, 1);
  assert.match(k.r.error, /^no CDP on port 9 \(profile k02/);
});
