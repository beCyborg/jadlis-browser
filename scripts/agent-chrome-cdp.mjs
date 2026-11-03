#!/usr/bin/env node
// CDP helper for agent-chrome.sh (jadlis-browser). Node.js 22+. Usage: agent-chrome-cdp.mjs <port> <heal|tabs|window [url]|front|close>
// heal: find page targets that do not answer Runtime.evaluate (discarded or crashed tabs — they hang
// connectOverCDP in @playwright/mcp 0.0.83, playwright-mcp#1757), reload them in place, close the
// ones that stay dead. Never uses Target.activateTarget there: it brings the window to the front.
const [port, cmd, arg] = process.argv.slice(2);
if (!/^\d+$/.test(port || '') || !cmd) {
  console.error('usage: agent-chrome-cdp.mjs <port> <heal|tabs|window [url]|front|close>');
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

async function probe(targetId) {
  const a = await send('Target.attachToTarget', { targetId, flatten: true }, undefined, 3000);
  const sessionId = a.result?.sessionId;
  if (!sessionId) return { alive: false, sessionId: null };
  const r = await send('Runtime.evaluate', { expression: '1', returnByValue: true }, sessionId, 3000);
  return { alive: r.result?.result?.value === 1, sessionId };
}
const detach = sessionId => sessionId && send('Target.detachFromTarget', { sessionId }, undefined, 2000);

async function heal() {
  const list = await pages();
  const report = { ok: true, version: ver.Browser, tabs: list.length, reloaded: [], closed: [] };
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
    const p = (await pages())[0] || { targetId: (await send('Target.createTarget', { url: 'about:blank', newWindow: true })).result?.targetId };
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
