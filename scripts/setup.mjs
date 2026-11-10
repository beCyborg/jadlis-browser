#!/usr/bin/env node
// setup.mjs — install or refresh what jadlis-browser puts outside the plugin cache (Node.js 22+):
//   ~/.claude/scripts/agent-chrome.sh + agent-chrome-cdp.mjs + agent-ext.mjs (+ .jadlis-browser-version stamp),
//   ~/.local/share/jadlis-browser/patchright-<version>/ — the Patchright MCP runtime (exact pin, package-lock.json kept),
//   ~/.claude/agents/browser-operator.md rendered from assets/browser-operator.md.template — one pw-<name> server
//   per profile in ~/.config/jadlis/agent-chrome.conf (created from the example when missing, never overwritten),
//   ~/Library/LaunchAgents/com.jadlis.agent-chrome.plist running `agent-chrome.sh watch` every 2 min.
// Driver of the CDP profiles: BROWSER_DRIVER in ~/.config/jadlis/agent.conf — "patchright" (default) or "playwright"
// (@playwright/mcp, the driver before 4.0.0). The bridge server `pw` (the user's own Chrome) always runs @playwright/mcp.
// If the Patchright runtime cannot be installed, the CDP servers fall back to @playwright/mcp and setup says so.
// Settings live in agent-chrome.conf and agent.conf; setup only reads them (--adblock adds ext= to profile lines).
// A changed agent file, script or config is backed up next to itself as <name>.bak-<timestamp> before it is replaced.
// Usage: setup.mjs [--no-launchd] [--dry-run] [--print-agent] [--adblock[=<profile>,…]]
//        --print-agent   print the rendered agent file to stdout; writes and installs nothing
//        --adblock       opt-in: uBlock Origin Lite (pinned official release, sha256 checked) + the cookie-refusal
//                        extension (scripts/adblock/build.sh), then ` ext=` on every profile line (or the listed ones)
//        setup.mjs --auto   SessionStart hook: runs only when agent.conf has BROWSER_AUTO_SETUP="yes" and the
//                           installed stamp differs from this plugin version; prints one line when it updated.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The one place for each pinned version.
const PATCHRIGHT_VERSION = '1.64.3';      // patchright-core: Patchright MCP for the CDP profiles (default driver)
const PLAYWRIGHT_MCP_VERSION = '0.0.84';  // @playwright/mcp: the bridge `pw`, and the CDP profiles with BROWSER_DRIVER=playwright
const UBOL = {                            // --adblock: official chromium zip of github.com/uBlockOrigin/uBOL-home
  version: '2026.1103.1743',
  sha256: '79236476535b63706749e088e0ce99bb31d3d2ff15fabb4d7e990be23d6e4613', // = the release asset's GitHub digest
};
// The autoconsent version lives in scripts/adblock/package.json + package-lock.json.

const argv = process.argv.slice(2);
const args = new Set(argv);
const PRINT = args.has('--print-agent');
const AUTO = args.has('--auto'), DRY = args.has('--dry-run') || PRINT, NO_LAUNCHD = args.has('--no-launchd') || PRINT;
const ADBLOCK_ARG = argv.find(a => a === '--adblock' || a.startsWith('--adblock='));
const ADBLOCK = !AUTO && !!ADBLOCK_ARG;
const ADBLOCK_ONLY = ADBLOCK_ARG && ADBLOCK_ARG.includes('=') ? ADBLOCK_ARG.split('=')[1].split(',').filter(Boolean) : null;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const SCRIPTS = path.join(HOME, '.claude', 'scripts');
const AGENT = path.join(HOME, '.claude', 'agents', 'browser-operator.md');
const DATA = path.join(HOME, '.local', 'share', 'jadlis-browser');
const CONF = process.env.AGENT_CHROME_CONF || path.join(HOME, '.config', 'jadlis', 'agent-chrome.conf');
const AGENT_CONF = process.env.JADLIS_AGENT_CONF || path.join(HOME, '.config', 'jadlis', 'agent.conf');
const LABEL = 'com.jadlis.agent-chrome';
const PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const STAMP = path.join(SCRIPTS, '.jadlis-browser-version');
const MARK = '# Rendered by jadlis-browser setup.mjs';
const RUNTIME = path.join(DATA, `patchright-${PATCHRIGHT_VERSION}`);
const ENTRY = path.join(RUNTIME, 'node_modules', 'patchright-core', 'lib', 'entry', 'mcp.js');

const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const VERSION = JSON.parse(read(path.join(ROOT, '.claude-plugin', 'plugin.json'))).version;
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const changed = [], warnings = [];
const firstLine = e => String((e && (e.stderr || e.message)) || e).split('\n').map(s => s.trim()).filter(Boolean).slice(-1)[0] || 'unknown error';

function confValue(key) {
  const m = (read(AGENT_CONF) || '').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].replace(/#.*$/, '').replace(/["']/g, '').trim() : '';
}

if (AUTO) {
  if (confValue('BROWSER_AUTO_SETUP').toLowerCase() !== 'yes') process.exit(0);
  if ((read(STAMP) || '').trim() === VERSION) process.exit(0);
  const lock = path.join(SCRIPTS, '.jadlis-browser-setup.lock');
  try {
    const st = fs.statSync(lock);
    if (Date.now() - st.mtimeMs < 300000) process.exit(0);        // another session is installing
    fs.rmSync(lock, { recursive: true, force: true });
  } catch {}
  try { fs.mkdirSync(SCRIPTS, { recursive: true }); fs.mkdirSync(lock); } catch { process.exit(0); }
  process.on('exit', () => { try { fs.rmSync(lock, { recursive: true, force: true }); } catch {} });
}

function write(dest, content, mode) {
  const old = read(dest);
  if (old === content) { if (mode && !DRY) fs.chmodSync(dest, mode); return false; }
  if (DRY) { changed.push(dest); return true; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (old !== null) fs.writeFileSync(`${dest}.bak-${ts}`, old);
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, dest);
  changed.push(dest);
  return true;
}

// An executable on PATH, as PATH spells it (Homebrew's /opt/homebrew/bin/node survives `brew upgrade`; the realpath
// process.execPath points into a versioned Cellar folder that does not).
function onPath(name) {
  for (const d of [...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin']) {
    if (!d || !path.isAbsolute(d)) continue;
    const f = path.join(d, name);
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

// One profile line: `name=port`, then ` app=…` / ` ext=…` in any order; a value runs to the next key or the line end
// (same rules as agent-chrome.sh conf_lines and agent-ext.mjs).
function parseLine(line) {
  if (/^\s*(#|$)/.test(line)) return null;
  const m = line.match(/^\s*([a-z0-9_-]+)\s*=\s*(\d+)((?:\s+(?:app|ext)=.*)?)\s*$/);
  if (!m) return null;
  const ext = [];
  for (const k of m[3].matchAll(/\s(app|ext)=(.*?)(?=\s+(?:app|ext)=|\s*$)/g)) if (k[1] === 'ext') ext.push(...k[2].split(':').filter(Boolean));
  return { name: m[1], port: m[2], ext };
}

// 1. Scripts and the version stamp.
for (const f of ['agent-chrome.sh', 'agent-chrome-cdp.mjs', 'agent-ext.mjs']) write(path.join(SCRIPTS, f), read(path.join(ROOT, 'scripts', f)), 0o755);

// 2. Profile list: created from the example only when missing.
if (read(CONF) === null) write(CONF, read(path.join(ROOT, 'scripts', 'agent-chrome.conf.example')));
const confText = () => read(CONF) ?? 'agent=9333\n';
const profiles = confText().split('\n').map(parseLine).filter(Boolean).map(p => [p.name, p.port]);
if (!profiles.length) profiles.push(['agent', '9333']);

// 3. Driver of the CDP profiles.
function ensurePatchright() {
  const have = () => { try { return JSON.parse(read(path.join(RUNTIME, 'node_modules', 'patchright-core', 'package.json'))).version; } catch { return null; } };
  if (have() === PATCHRIGHT_VERSION && fs.existsSync(ENTRY)) return { ok: true, state: 'present' };
  if (DRY) return { ok: true, state: 'would install' };
  const npm = process.env.JADLIS_BROWSER_NPM || onPath('npm');      // JADLIS_BROWSER_NPM: tests stub the install
  if (!npm) return { ok: false, error: 'npm not found on PATH' };
  try {
    fs.mkdirSync(RUNTIME, { recursive: true });
    const pkg = path.join(RUNTIME, 'package.json');
    if (read(pkg) === null) fs.writeFileSync(pkg, JSON.stringify({ name: `patchright-${PATCHRIGHT_VERSION}`, private: true,
      description: 'Patchright MCP runtime for jadlis-browser (installed by setup.mjs; exact pin, lock file kept)' }, null, 2) + '\n');
    const node = onPath('node');
    execFileSync(npm, ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', `patchright-core@${PATCHRIGHT_VERSION}`], {
      cwd: RUNTIME, stdio: ['ignore', 'pipe', 'pipe'], timeout: AUTO ? 90000 : 300000,
      env: node ? { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH || ''}` } : process.env,
    });
  } catch (e) { return { ok: false, error: `npm install failed: ${firstLine(e)}` }; }
  if (have() !== PATCHRIGHT_VERSION || !fs.existsSync(ENTRY)) return { ok: false, error: `npm finished, but ${ENTRY} is missing` };
  changed.push(RUNTIME);
  return { ok: true, state: 'installed' };
}

let driver = (confValue('BROWSER_DRIVER') || 'patchright').toLowerCase();
if (!['patchright', 'playwright'].includes(driver)) { warnings.push(`BROWSER_DRIVER="${driver}" is unknown (patchright | playwright) — using patchright`); driver = 'patchright'; }
let runtime = null, node = null;
if (driver === 'patchright') {
  runtime = ensurePatchright();
  node = onPath('node');
  if (runtime.ok && !node) runtime = { ok: false, error: 'node not found on PATH' };
  if (!runtime.ok) {
    warnings.push(`Patchright runtime ${PATCHRIGHT_VERSION} is not usable (${runtime.error}) — the CDP profiles fall back to @playwright/mcp@${PLAYWRIGHT_MCP_VERSION}. Fix it and re-run setup.mjs by hand.`);
    driver = 'playwright';
  }
}
const PW = `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`;
const cdp = driver === 'patchright'
  ? { command: node, entry: JSON.stringify(ENTRY), name: `Patchright MCP (patchright-core ${PATCHRIGHT_VERSION})`,
      note: [`Driver of the CDP profiles: Patchright MCP from patchright-core ${PATCHRIGHT_VERSION}, exact pin + package-lock.json in`,
        `${RUNTIME}/. Absolute node and entry: agent inline servers start with a minimal PATH.`,
        `Back to @playwright/mcp: BROWSER_DRIVER="playwright" in ~/.config/jadlis/agent.conf, then re-run setup.`] }
  : { command: 'npx', entry: JSON.stringify(PW), name: `Playwright MCP (${PW})`,
      note: [`Driver of the CDP profiles: ${PW} — BROWSER_DRIVER="playwright", or the Patchright runtime could not be installed`,
        `(setup printed why). Default since 4.0.0 is Patchright MCP.`] };

// 4. Optional: ad blocker + cookie refusal as unpacked extensions loaded at every profile start (ext=).
const manifestVersion = dir => { try { return JSON.parse(read(path.join(dir, 'manifest.json'))).version; } catch { return null; } };
async function installUbol() {
  const dir = path.join(DATA, 'ubol', 'current');                    // stable path: the extension id follows it
  if (manifestVersion(dir) === UBOL.version) return { ok: true, dir, state: 'present', version: UBOL.version };
  if (DRY) return { ok: true, dir, state: 'would install', version: UBOL.version };
  const name = `uBOLite_${UBOL.version}.chromium.zip`;
  const zip = process.env.JADLIS_BROWSER_UBOL_ZIP || path.join(DATA, 'ubol', 'dl', name);  // tests: a local zip, no network
  try {
    if (!fs.existsSync(zip)) {
      const url = `https://github.com/uBlockOrigin/uBOL-home/releases/download/${UBOL.version}/${name}`;
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`download ${url}: HTTP ${r.status}`);
      fs.mkdirSync(path.dirname(zip), { recursive: true });
      fs.writeFileSync(`${zip}.part`, Buffer.from(await r.arrayBuffer()));
      fs.renameSync(`${zip}.part`, zip);
    }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if (sha !== UBOL.sha256) throw new Error(`sha256 of ${zip} is ${sha}, expected ${UBOL.sha256} — not unpacked`);
    const tmp = path.join(DATA, 'ubol', `.unpack-${process.pid}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    execFileSync('/usr/bin/unzip', ['-q', zip, '-d', tmp], { stdio: 'ignore' });
    if (manifestVersion(tmp) !== UBOL.version) throw new Error('unpacked zip has no matching manifest.json');
    if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.bak-${ts}`);
    fs.renameSync(tmp, dir);
    changed.push(dir);
    return { ok: true, dir, state: 'installed', version: UBOL.version, sha256: sha };
  } catch (e) { return { ok: false, dir, error: firstLine(e) }; }
}
function buildCookieExt() {
  const dir = path.join(DATA, 'autoconsent-ext'), work = path.join(DATA, 'adblock-build');
  const src = path.join(ROOT, 'scripts', 'adblock');
  const want = JSON.parse(read(path.join(src, 'package.json'))).dependencies['@duckduckgo/autoconsent'];
  for (const f of ['package.json', 'package-lock.json', 'skip-hosts.default.txt', 'build.sh', path.join('src', 'entry.ts')])
    write(path.join(work, f), read(path.join(src, f)), f === 'build.sh' ? 0o755 : undefined);
  if (manifestVersion(dir) === want) return { ok: true, dir, state: 'present', version: want };
  if (DRY) return { ok: true, dir, state: 'would build', version: want };
  try {
    const node = onPath('node');
    const res = execFileSync('/bin/bash', [path.join(work, 'build.sh'), '--out', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000,
      env: node ? { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH || ''}` } : process.env });
    const r = JSON.parse(res.trim().split('\n').pop());
    changed.push(dir);
    return { ok: true, dir, state: 'built', version: r.version, sha256: r.sha256, skip_file: r.skip_file };
  } catch (e) { return { ok: false, dir, error: `build.sh failed: ${firstLine(e)}` }; }
}
// Append ` ext=<dir>` to each target profile line that lacks it; comments and other lines stay byte for byte.
function addExt(text, dirs, only) {
  const added = [];
  const lines = text.split('\n').map(l => {
    const p = parseLine(l);
    if (!p || (only && !only.includes(p.name))) return l;
    const miss = dirs.filter(d => !p.ext.includes(d));
    if (!miss.length) return l;
    added.push(`${p.name}: ${miss.join(', ')}`);
    return l.replace(/\s+$/, '') + miss.map(d => ` ext=${d}`).join('');
  });
  return { text: lines.join('\n'), added };
}
let adblock;
if (ADBLOCK) {
  const unknown = (ADBLOCK_ONLY || []).filter(n => !profiles.some(([p]) => p === n));
  if (unknown.length) warnings.push(`--adblock: no profile ${unknown.join(', ')} in ${CONF}`);
  const ubol = await installUbol(), cookie = buildCookieExt();
  const dirs = [ubol, cookie].filter(x => x.ok).map(x => x.dir);
  for (const x of [ubol, cookie]) if (!x.ok) warnings.push(`--adblock: ${x.dir} not ready (${x.error}) — not added to the profiles`);
  const { text, added } = addExt(confText(), dirs, ADBLOCK_ONLY);
  if (added.length) write(CONF, text);
  adblock = { ubol, cookie_refusal: cookie, added: added.length ? added : 'nothing — every target profile already lists them',
    next: 'running profiles load the folders at the next `agent-chrome.sh ensure|status <profile>`' };
}

// 5. Agent file: the template's pw-agent block repeated once per profile.
const tpl = read(path.join(ROOT, 'assets', 'browser-operator.md.template'));
const lines = tpl.split('\n');
const start = lines.findIndex(l => l.trim() === '- pw-agent:');
let end = start + 1;
while (end < lines.length && !/^\s*- \S/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
const block = lines.slice(start, end).join('\n');
const blocks = profiles.map(([n, p]) => block.replace('- pw-agent:', `- pw-${n}:`).replace('http://127.0.0.1:9333', `http://127.0.0.1:${p}`));
const agent = [...lines.slice(0, start), ...blocks, ...lines.slice(end)].join('\n')
  .replace('mcp__pw-agent__*', profiles.map(([n]) => `mcp__pw-${n}__*`).join(', '))
  .replace(/\{\{CDP_COMMAND\}\}/g, () => cdp.command)
  .replace(/\{\{CDP_ENTRY\}\}/g, () => cdp.entry)
  .replace(/\{\{DRIVER_NOTE\}\}/g, () => cdp.note.join('\n  # '))
  .replace(/\{\{DRIVER_NAME\}\}/g, () => cdp.name)
  .replace(/\{\{PLAYWRIGHT_MCP\}\}/g, () => PW)
  .replace(/\{\{HOME\}\}/g, () => HOME)
  .replace(/\{\{VERSION\}\}/g, () => VERSION)
  .replace(/^mcpServers:$/m, `mcpServers:\n  ${MARK} ${VERSION} — edit agent-chrome.conf / agent.conf and re-run setup, not this file.`);
if (PRINT) { process.stdout.write(agent); process.exit(0); }
write(AGENT, agent);

// 6. launchd: `watch` keeps BROWSER_KEEPALIVE profiles up and idle-stops the rest.
let launchd = 'skipped';
if (!NO_LAUNCHD) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCRIPTS}/agent-chrome.sh</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>${HOME}/.claude/logs/agent-chrome.launchd.log</string>
  <key>StandardErrorPath</key><string>${HOME}/.claude/logs/agent-chrome.launchd.log</string>
</dict>
</plist>
`;
  write(PLIST, plist);
  if (!DRY) {
    fs.mkdirSync(path.join(HOME, '.claude', 'logs'), { recursive: true });
    const dom = `gui/${process.getuid()}`;
    try { execFileSync('/bin/launchctl', ['bootout', `${dom}/${LABEL}`], { stdio: 'ignore' }); } catch {}
    try { execFileSync('/bin/launchctl', ['bootstrap', dom, PLIST], { stdio: 'ignore' }); } catch {}
    try { execFileSync('/bin/launchctl', ['print', `${dom}/${LABEL}`], { stdio: 'ignore' }); launchd = 'loaded'; }
    catch { launchd = 'FAILED'; }
  }
}

// 7. Stamp last, then read back what is really installed.
if (!DRY) write(STAMP, `${VERSION}\n`);
let installed = 'unknown';
try { installed = execFileSync('/bin/bash', [path.join(SCRIPTS, 'agent-chrome.sh'), 'version'], { encoding: 'utf8' }).trim(); } catch {}
const agentNow = read(AGENT) || '';
const ok = DRY || (installed === VERSION && agentNow.includes(`${MARK} ${VERSION}`) && launchd !== 'FAILED');
const report = { ok, version: VERSION, installed, driver: cdp.name, runtime: runtime && (runtime.ok ? `${runtime.state}: ${RUNTIME}` : `FAILED: ${runtime.error}`),
  bridge: PW, profiles: profiles.map(([n, p]) => `${n}=${p}`), keepalive: confValue('BROWSER_KEEPALIVE') || null, launchd,
  adblock, changed, warnings: warnings.length ? warnings : undefined, dry_run: DRY || undefined };
if (AUTO) {
  console.log(ok ? `jadlis-browser ${VERSION}: browser-operator, agent-chrome scripts and launchd watch re-installed (CDP profiles: ${cdp.name}; bridge: ${PW}).${warnings.length ? ' WARNING: ' + warnings.join(' ') : ''}`
                 : `jadlis-browser ${VERSION}: auto setup FAILED — run node "${path.join(ROOT, 'scripts', 'setup.mjs')}" by hand.`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
process.exit(ok ? 0 : 1);
