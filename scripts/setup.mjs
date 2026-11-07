#!/usr/bin/env node
// setup.mjs — install or refresh what jadlis-browser puts outside the plugin cache (Node.js 22+):
//   ~/.claude/scripts/agent-chrome.sh + agent-chrome-cdp.mjs (+ .jadlis-browser-version stamp),
//   ~/.claude/agents/browser-operator.md rendered from assets/browser-operator.md.template — one pw-<name> server
//   per profile in ~/.config/jadlis/agent-chrome.conf (created from the example when missing, never overwritten),
//   ~/Library/LaunchAgents/com.jadlis.agent-chrome.plist running `agent-chrome.sh watch` every 2 min.
// Settings live in agent-chrome.conf and agent.conf; setup only reads them. A changed agent file or script is
// backed up next to itself as <name>.bak-<timestamp> before it is replaced.
// Usage: setup.mjs [--no-launchd] [--dry-run]
//        setup.mjs --auto   SessionStart hook: runs only when agent.conf has BROWSER_AUTO_SETUP="yes" and the
//                           installed stamp differs from this plugin version; prints one line when it updated.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const AUTO = args.has('--auto'), DRY = args.has('--dry-run'), NO_LAUNCHD = args.has('--no-launchd');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const SCRIPTS = path.join(HOME, '.claude', 'scripts');
const AGENT = path.join(HOME, '.claude', 'agents', 'browser-operator.md');
const CONF = process.env.AGENT_CHROME_CONF || path.join(HOME, '.config', 'jadlis', 'agent-chrome.conf');
const AGENT_CONF = process.env.JADLIS_AGENT_CONF || path.join(HOME, '.config', 'jadlis', 'agent.conf');
const LABEL = 'com.jadlis.agent-chrome';
const PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const STAMP = path.join(SCRIPTS, '.jadlis-browser-version');
const MARK = '# Rendered by jadlis-browser setup.mjs';

const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const VERSION = JSON.parse(read(path.join(ROOT, '.claude-plugin', 'plugin.json'))).version;
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const changed = [];

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
    if (Date.now() - st.mtimeMs < 120000) process.exit(0);        // another session is installing
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

// 1. Scripts and the version stamp.
for (const f of ['agent-chrome.sh', 'agent-chrome-cdp.mjs']) write(path.join(SCRIPTS, f), read(path.join(ROOT, 'scripts', f)), 0o755);

// 2. Profile list: created from the example only when missing.
if (read(CONF) === null) write(CONF, read(path.join(ROOT, 'scripts', 'agent-chrome.conf.example')));
const profiles = (read(CONF) ?? 'agent=9333').split('\n')
  .filter(l => !/^\s*#/.test(l) && l.split('=').length === 2)
  .map(l => l.replace(/\s/g, '').split('='))
  .filter(([n, p]) => /^[a-z0-9_-]+$/.test(n) && /^\d+$/.test(p));
if (!profiles.length) profiles.push(['agent', '9333']);

// 3. Agent file: the template's pw-agent block repeated once per profile.
const tpl = read(path.join(ROOT, 'assets', 'browser-operator.md.template'));
const lines = tpl.split('\n');
const start = lines.findIndex(l => l.trim() === '- pw-agent:');
let end = start + 1;
while (end < lines.length && !/^\s*- \S/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
const block = lines.slice(start, end).join('\n');
const blocks = profiles.map(([n, p]) => block.replace('- pw-agent:', `- pw-${n}:`).replace('http://127.0.0.1:9333', `http://127.0.0.1:${p}`));
let agent = [...lines.slice(0, start), ...blocks, ...lines.slice(end)].join('\n')
  .replace('mcp__pw-agent__*', profiles.map(([n]) => `mcp__pw-${n}__*`).join(', '))
  .replace(/\{\{HOME\}\}/g, HOME)
  .replace(/\{\{VERSION\}\}/g, VERSION)
  .replace(/^mcpServers:$/m, `mcpServers:\n  ${MARK} ${VERSION} — edit agent-chrome.conf and re-run setup, not this file.`);
write(AGENT, agent);

// 4. launchd: `watch` keeps BROWSER_KEEPALIVE profiles up and idle-stops the rest.
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

// 5. Stamp last, then read back what is really installed.
if (!DRY) write(STAMP, `${VERSION}\n`);
let installed = 'unknown';
try { installed = execFileSync('/bin/bash', [path.join(SCRIPTS, 'agent-chrome.sh'), 'version'], { encoding: 'utf8' }).trim(); } catch {}
const agentNow = read(AGENT) || '';
const pw = (agentNow.match(/@playwright\/mcp@[\d.]+/) || ['none'])[0];
const ok = DRY || (installed === VERSION && agentNow.includes(`${MARK} ${VERSION}`) && launchd !== 'FAILED');
const report = { ok, version: VERSION, installed, playwright: pw, profiles: profiles.map(([n, p]) => `${n}=${p}`),
  keepalive: confValue('BROWSER_KEEPALIVE') || null, launchd, changed, dry_run: DRY || undefined };
if (AUTO) {
  console.log(ok ? `jadlis-browser ${VERSION}: browser-operator, agent-chrome scripts and launchd watch re-installed (${pw}).`
                 : `jadlis-browser ${VERSION}: auto setup FAILED — run node "${path.join(ROOT, 'scripts', 'setup.mjs')}" by hand.`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
process.exit(ok ? 0 : 1);
