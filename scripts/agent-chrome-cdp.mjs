#!/usr/bin/env node
// CDP helper for agent-chrome.sh (jadlis-browser). Node.js 22+.
// Usage: agent-chrome-cdp.mjs <port> <heal [--boot] [--ext <dir[:dir…]>]|tabs|window [url]|front [targetId]|close>
// heal: find page targets that do not answer Runtime.evaluate (discarded or crashed tabs — they hang
// connectOverCDP in @playwright/mcp 0.0.83, playwright-mcp#1757), reload them in place, close the
// ones that stay dead. Never uses Target.activateTarget there: it brings the window to the front.
// --boot (right after a start with --no-startup-window): open the first window in the background; that also runs
// Chrome's session restore («Continue where you left off»). The blank page is closed again when tabs came back.
// --ext: load each unpacked extension folder the profile does not have yet (Extensions.loadUnpacked; Chrome drops
// such an extension on restart, its storage survives because the id follows the folder path). A missing folder or a
// failed load is a warning in "ext", never a failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [port, cmd, ...rest] = process.argv.slice(2);
const arg = rest[0];
const flag = name => rest.includes(name);
const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? '' : undefined; };
if (!/^\d+$/.test(port || '') || !cmd) {
  console.error('usage: agent-chrome-cdp.mjs <port> <heal [--boot] [--ext <dir[:dir…]>]|tabs|window [url]|front [targetId]|close>');
  process.exit(port === '--help' || port === '-h' ? 0 : 64);
}
const base = `http://127.0.0.1:${port}`;
const out = o => console.log(JSON.stringify(o));

let ver;
try { ver = await (await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(3000) })).json(); }
catch { out({ ok: false, error: `port ${port} does not answer` }); process.exit(2); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}, sessionId, timeout = 5000) => new Promise(res => {
  const id = ++seq;
  const t = setTimeout(() => { pending.delete(id); res({ timeout: true }); }, timeout);
  pending.set(id, m => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const pages = async () => ((await send('Target.getTargets')).result?.targetInfos || []).filter(t => t.type === 'page');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const blankWindow = async () => (await send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true })).result?.targetId;

// First window after a windowless start. Restored tabs arrive after the window opens (the session file is read
// asynchronously): wait at least 1 s, then until the page count holds for 1 s, at most 10 s.
async function boot() {
  if ((await pages()).length) return { restored: 0, note: 'pages already open' };
  const blank = await blankWindow();
  let n = -1, still = 0;
  for (let i = 0; i < 40 && !(i >= 4 && still >= 4); i++) {
    await sleep(250);
    const m = (await pages()).length;
    still = m === n ? still + 1 : 0; n = m;
  }
  const others = (await pages()).filter(p => p.targetId !== blank);
  if (blank && others.length) await send('Target.closeTarget', { targetId: blank });
  return { restored: others.length };
}

// Unpacked extensions named by the profile's `ext=`; presence is read from Extensions.getExtensions by folder path.
async function loadExtensions(spec) {
  const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
  const dirs = spec.split(':').map(d => d.trim()).filter(Boolean).map(d => (d.startsWith('~/') ? os.homedir() + d.slice(1) : d));
  const have = (await send('Extensions.getExtensions', {}, undefined, 5000)).result?.extensions;
  const res = [];
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) { res.push({ dir, loaded: false, warning: 'not an absolute path' }); continue; }
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) { res.push({ dir, loaded: false, warning: 'no manifest.json in this folder' }); continue; }
    if (!have) { res.push({ dir, loaded: false, warning: 'Extensions.getExtensions failed' }); continue; }
    const hit = have.find(e => real(e.path) === real(dir));
    if (hit) { res.push({ id: hit.id, dir, loaded: true, enabled: hit.enabled }); continue; }
    const r = await send('Extensions.loadUnpacked', { path: real(dir) }, undefined, 15000);
    if (r.result?.id) res.push({ id: r.result.id, dir, loaded: true, new: true });
    else res.push({ dir, loaded: false, warning: r.error?.message || 'Extensions.loadUnpacked timed out' });
  }
  return res;
}

async function probe(targetId) {
  const a = await send('Target.attachToTarget', { targetId, flatten: true }, undefined, 3000);
  const sessionId = a.result?.sessionId;
  if (!sessionId) return { alive: false, sessionId: null };
  const r = await send('Runtime.evaluate', { expression: '1', returnByValue: true }, sessionId, 3000);
  return { alive: r.result?.result?.value === 1, sessionId };
}
const detach = sessionId => sessionId && send('Target.detachFromTarget', { sessionId }, undefined, 2000);

async function heal() {
  const report = { ok: true, version: ver.Browser };
  if (flag('--boot')) report.boot = await boot();
  // A profile with no page makes Playwright open one with context.newPage(), which raises the window.
  if (!(await pages()).length) { await blankWindow(); report.opened = 'about:blank'; }
  const list = await pages();
  Object.assign(report, { tabs: list.length, reloaded: [], closed: [] });
  for (const p of list) {
    let { alive, sessionId } = await probe(p.targetId);
    if (alive) { await detach(sessionId); continue; }
    if (sessionId) {
      await send('Page.reload', {}, sessionId, 5000);
      await detach(sessionId);
      await new Promise(r => setTimeout(r, 1500));
      ({ alive, sessionId } = await probe(p.targetId));
      await detach(sessionId);
      if (alive) { report.reloaded.push(p.url.slice(0, 80)); continue; }
    }
    // Keep at least one page so the browser stays attachable.
    if ((await pages()).length <= 1) await send('Target.createTarget', { url: 'about:blank', background: true });
    await send('Target.closeTarget', { targetId: p.targetId });
    report.closed.push(p.url.slice(0, 80));
  }
  report.tabs = (await pages()).length;
  const ext = opt('--ext');
  if (ext) report.ext = await loadExtensions(ext);
  return report;
}

let result;
switch (cmd) {
  case 'heal': result = await heal(); break;
  case 'tabs': result = { ok: true, version: ver.Browser, tabs: (await pages()).map(p => ({ id: p.targetId, url: p.url.slice(0, 100) })) }; break;
  case 'window': {
    const r = await send('Target.createTarget', { url: arg || 'about:blank', newWindow: true, background: true });
    result = r.result ? { ok: true, targetId: r.result.targetId } : { ok: false, error: JSON.stringify(r.error || r) };
    break;
  }
  case 'front': {
    const all = await pages();
    const p = (arg && all.find(x => x.targetId === arg)) || all[0] || { targetId: (await send('Target.createTarget', { url: 'about:blank', newWindow: true })).result?.targetId };
    await send('Target.activateTarget', { targetId: p.targetId });
    result = { ok: true, targetId: p.targetId };
    break;
  }
  case 'close': { const r = await send('Browser.close', {}, undefined, 8000); result = { ok: !r.error, sent: true }; break; }
  default: result = { ok: false, error: `unknown command ${cmd}` };
}
out(result);
try { ws.close(); } catch {}
process.exit(result.ok ? 0 : 1);
