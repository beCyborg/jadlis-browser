// fake-cdp.mjs — a tiny stand-in for Chrome's DevTools port: /json/version over HTTP and a browser WebSocket that
// answers the Target/Runtime/Extensions calls agent-chrome-cdp.mjs makes. No Chrome needed for the tests.
//   const fake = await startFake({ pages: [...], restoreOnFirstWindow: ['https://a/'], extensions: [{ id, path }] });
//   fake.port, fake.state (pages, extensions, calls), await fake.close()
import http from 'node:http';
import { createHash } from 'node:crypto';

export async function startFake({ pages = [], restoreOnFirstWindow = [], extensions = [], loadFails = false } = {}) {
  let n = 0;
  const id = () => `T${++n}`;
  const state = { pages: pages.map(url => ({ targetId: id(), type: 'page', url })), extensions: [...extensions], calls: [] };
  let firstWindow = true;
  const sockets = new Set();

  const handle = msg => {
    const { method, params = {} } = msg;
    state.calls.push(method);
    switch (method) {
      case 'Target.getTargets': return { targetInfos: state.pages.map(p => ({ ...p })) };
      case 'Target.createTarget': {
        const p = { targetId: id(), type: 'page', url: params.url };
        state.pages.push(p);
        // Chrome runs session restore when the first window of a windowless start opens; tabs arrive a bit later.
        if (params.newWindow && firstWindow && restoreOnFirstWindow.length) {
          setTimeout(() => restoreOnFirstWindow.forEach(url => state.pages.push({ targetId: id(), type: 'page', url })), 300);
        }
        if (params.newWindow) firstWindow = false;
        return { targetId: p.targetId };
      }
      case 'Target.closeTarget': state.pages = state.pages.filter(p => p.targetId !== params.targetId); return { success: true };
      case 'Target.attachToTarget': return { sessionId: `S-${params.targetId}` };
      case 'Target.detachFromTarget': return {};
      case 'Runtime.evaluate': return { result: { type: 'number', value: 1 } };
      case 'Extensions.getExtensions': return { extensions: state.extensions.map(e => ({ name: 'x', version: '1', enabled: true, ...e })) };
      case 'Extensions.loadUnpacked': {
        if (loadFails) return { error: { code: -32000, message: 'load failed (fake)' } };
        const e = { id: `ext${state.extensions.length + 1}`, path: params.path };
        state.extensions.push(e);
        return { id: e.id };
      }
      case 'Browser.close': return {};
      default: return { error: { code: -32601, message: `'${method}' wasn't found` } };
    }
  };

  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Browser: 'Chrome/999.0 (fake)', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/browser/fake` }));
    } else if (req.url === '/json/list') {
      res.end(JSON.stringify(state.pages.map(p => ({ id: p.targetId, type: p.type, url: p.url }))));
    } else { res.statusCode = 404; res.end(); }
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f, masked = buf[1] & 0x80;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const need = off + (masked ? 4 : 0) + len;
        if (buf.length < need) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const data = Buffer.from(buf.subarray(off + (masked ? 4 : 0), need));
        if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        buf = buf.subarray(need);
        if (op === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (op !== 1) continue;
        const msg = JSON.parse(data.toString());
        const r = handle(msg);
        const reply = r && r.error ? { id: msg.id, error: r.error } : { id: msg.id, result: r };
        if (msg.sessionId) reply.sessionId = msg.sessionId;
        send(socket, JSON.stringify(reply));
      }
    });
  });
  const send = (socket, text) => {
    const p = Buffer.from(text);
    const head = p.length < 126 ? Buffer.from([0x81, p.length])
      : p.length < 65536 ? Buffer.from([0x81, 126, p.length >> 8, p.length & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); return h; })();
    socket.write(Buffer.concat([head, p]));
  };
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    state,
    close: () => new Promise(r => { sockets.forEach(s => s.destroy()); server.close(r); }),
  };
}
