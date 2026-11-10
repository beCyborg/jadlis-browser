#!/usr/bin/env node
// agent-ext.mjs — unpacked extensions in the agent's Chrome profiles over the CDP port (Node.js 22+). No focus change:
// every window it opens is a background window and is closed again. <profile> is a name from agent-chrome.conf or a port.
//   node agent-ext.mjs load   <profile> [dir]   load the profile's ext= folders (or dir) that the profile lacks
//   node agent-ext.mjs reload <profile> [dir]   load them again even when present (after the folder's files changed,
//                                               e.g. a rebuilt cookie-refusal extension)
//   node agent-ext.mjs state  <profile> [dir]   uBlock Origin Lite: id, version, default mode, enabled rulesets
//   node agent-ext.mjs mode   <profile> <hostname>                                    the blocker mode of one site
//   node agent-ext.mjs mode   <profile> <hostname> <none|basic|optimal|complete>      set it (none = no filtering)
// Folders come from ` ext=` on the profile's line in ~/.config/jadlis/agent-chrome.conf (AGENT_CHROME_CONF overrides);
// state/mode use the one whose manifest is uBlock Origin Lite, else ~/.local/share/jadlis-browser/ubol/current.
// Chrome drops a CDP-loaded extension on restart (agent-chrome.sh loads ext= folders again at every start); its
// settings survive because the id follows the folder path — keep the path stable. Prints one JSON line.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [cmd, target, a3, a4] = process.argv.slice(2);
const HOME = os.homedir();
const CONF = process.env.AGENT_CHROME_CONF || path.join(HOME, '.config', 'jadlis', 'agent-chrome.conf');
const UBOL_DEFAULT = path.join(HOME, '.local', 'share', 'jadlis-browser', 'ubol', 'current');
const LEVELS = ['none', 'basic', 'optimal', 'complete'];
const out = o => console.log(JSON.stringify(o));
const fail = (m, code = 1) => { out({ ok: false, error: m }); process.exit(code); };
if (!['load', 'reload', 'state', 'mode'].includes(cmd) || !target) fail('usage: agent-ext.mjs load|reload|state|mode <profile|port> …', 64);

// One profile line: `name=port`, then ` app=…` / ` ext=…` in any order; a value runs to the next key or the line end
// (paths may hold spaces); several ext= join, each may list folders split by `:` (same rules as agent-chrome.sh).
function parseLine(line) {
  if (/^\s*(#|$)/.test(line)) return null;
  const m = line.match(/^\s*([a-z0-9_-]+)\s*=\s*(\d+)((?:\s+(?:app|ext)=.*)?)\s*$/);
  if (!m) return null;
  const ext = [];
  for (const k of m[3].matchAll(/\s(app|ext)=(.*?)(?=\s+(?:app|ext)=|\s*$)/g)) if (k[1] === 'ext') ext.push(...k[2].split(':').filter(Boolean));
  return { name: m[1], port: m[2], ext };
}
const profiles = (fs.existsSync(CONF) ? fs.readFileSync(CONF, 'utf8') : 'agent=9333').split('\n').map(parseLine).filter(Boolean);
const prof = /^\d+$/.test(target) ? (profiles.find(p => p.port === target) || { name: null, port: target, ext: [] })
  : profiles.find(p => p.name === target);
if (!prof) fail(`no profile "${target}" in ${CONF}`, 64);
const port = prof.port;
const manifest = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return null; } };
// uBOL's manifest name is a locale key; its folder also carries the blocker's rulesets.
const isUbol = dir => { const m = manifest(dir); return !!m && (/uBlock Origin Lite/i.test(m.name || '') || (m.name === '__MSG_extName__' && fs.existsSync(path.join(dir, 'rulesets')))); };

// Check the arguments before touching the port.
const dirs = cmd === 'load' || cmd === 'reload'
  ? (a3 ? [a3] : prof.ext.length ? prof.ext : fail(`profile ${prof.name || port} has no ext= folders — pass a folder`, 64))
  : [(cmd === 'state' && a3) || prof.ext.find(isUbol) || UBOL_DEFAULT];
if (cmd === 'state' || cmd === 'mode') {
  if (!manifest(dirs[0])) fail(`no manifest.json in ${dirs[0]}`, 66);
  if (cmd === 'mode' && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test((a3 || '').toLowerCase())) fail('hostname expected, e.g. example.com', 64);
  if (cmd === 'mode' && a4 !== undefined && !LEVELS.includes(a4)) fail('mode must be one of: ' + LEVELS.join(', '), 64);
}

const j = async p => (await fetch(`http://127.0.0.1:${port}${p}`)).json();
const open = u => new Promise((res, rej) => {
  const s = new WebSocket(u); let id = 0; const pend = new Map();
  s.onopen = () => res({
    send: (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })); }),
    close: () => s.close(),
  });
  s.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  s.onerror = () => rej(new Error(`no CDP on port ${port}`));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
// An unpacked extension's id is derived from its folder path; an idle MV3 service worker has no CDP target,
// so presence is tested by opening one of the extension's own pages.
const idOf = dir => [...createHash('sha256').update(fs.realpathSync(dir)).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

let browser;
try { browser = await open((await j('/json/version')).webSocketDebuggerUrl); } catch (e) { fail(`no CDP on port ${port} (profile ${prof.name || '?'} not running? agent-chrome.sh ensure ${prof.name || '<profile>'}): ${e.message || e}`); }

// Run an expression inside one of the extension's own pages (its service worker only answers runtime messages).
// Returns { absent: true } when the profile does not have the extension.
const inPage = async (id, expression, file = 'dashboard.html') => {
  const t = (await browser.send('Target.createTarget', { url: `chrome-extension://${id}/${file}`, newWindow: true, background: true })).result?.targetId;
  if (!t) fail('cannot open a background window');
  try {
    let page; for (let i = 0; i < 20 && !page; i++) { await sleep(250); page = (await j('/json/list')).find(x => x.id === t); }
    if (!page) return { absent: true };
    const p = await open(page.webSocketDebuggerUrl);
    const has = await p.send('Runtime.evaluate', { expression: file === 'manifest.json' ? `location.protocol === 'chrome-extension:' && (document.body?.innerText || '').trim().startsWith('{')` : `location.protocol === 'chrome-extension:' && typeof chrome?.runtime?.sendMessage === 'function'`, returnByValue: true });
    if (has.result?.result?.value !== true) { p.close(); return { absent: true }; }
    const r = await p.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    p.close();
    if (r.result?.exceptionDetails) fail(r.result.exceptionDetails.exception?.description || 'extension call failed');
    return { value: r.result?.result?.value };
  } finally { await browser.send('Target.closeTarget', { targetId: t }); }
};
const ask = async (id, msg) => (await inPage(id, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`)).value;
// Presence of ANY unpacked extension: its manifest.json opens as a document only when the extension is loaded.
const present = async id => !(await inPage(id, '1', 'manifest.json')).absent;

if (cmd === 'load' || cmd === 'reload') {
  const ext = [];
  for (const dir of dirs) {
    if (!path.isAbsolute(dir) || !manifest(dir)) { ext.push({ dir, loaded: false, warning: 'no manifest.json in this folder' }); continue; }
    const id = idOf(dir);
    if (cmd === 'load' && await present(id)) { ext.push({ dir, id, loaded: false, note: 'already present' }); continue; }
    const r = await browser.send('Extensions.loadUnpacked', { path: fs.realpathSync(dir) });
    if (r.error) { ext.push({ dir, loaded: false, warning: r.error.message }); continue; }
    let ok = false; for (let i = 0; i < 12 && !(ok = await present(id)); i++) await sleep(500);
    ext.push({ dir, id: r.result.id, loaded: ok });
  }
  out({ ok: ext.every(e => e.loaded !== false || e.note), profile: prof.name, port, ext });
} else {
  const dir = dirs[0];
  const id = idOf(dir);
  if (!(await present(id))) fail(`uBlock Origin Lite (${dir}) is not loaded in this profile — run: agent-ext.mjs load ${target} ${dir}`, 2);
  if (cmd === 'state') {
    const v = (await inPage(id, `(async () => ({ version: chrome.runtime.getManifest().version, rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(), defaultMode: await chrome.runtime.sendMessage({ what: 'getDefaultFilteringMode' }) }))()`)).value;
    out({ ok: true, id, dir, ...v, defaultMode: LEVELS[v.defaultMode] });
  } else {
    const host = (a3 || '').toLowerCase();
    if (a4 !== undefined) {
      const level = LEVELS.indexOf(a4);
      await ask(id, { what: 'setFilteringMode', hostname: host, level });
    }
    out({ ok: true, hostname: host, mode: LEVELS[await ask(id, { what: 'getFilteringMode', hostname: host })] });
  }
}
browser.close();
