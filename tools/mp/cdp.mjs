// A small Chrome DevTools Protocol client for the multiplayer tests (tools/mp/visibility.mjs): one persistent socket per
// page, Runtime.evaluate with awaited promises, screenshots. Node 22+ (the global WebSocket and fetch).
import { writeFileSync } from 'node:fs';

export class Page {
  constructor(port, host = '127.0.0.1') { this.port = port; this.host = host; this.id = 0; this.pend = new Map(); }
  async open() {
    const list = (await (await fetch(`http://${this.host}:${this.port}/json/list`)).json()).filter(t => t.type === 'page');
    let t = list[0];
    if (!t) t = await (await fetch(`http://${this.host}:${this.port}/json/new?about:blank`, { method: 'PUT' })).json();
    this.ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((ok, no) => { this.ws.addEventListener('open', ok); this.ws.addEventListener('error', no); });
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pend.has(m.id)) { this.pend.get(m.id)(m); this.pend.delete(m.id); }
    });
    await this.send('Page.enable');
    return this;
  }
  send(method, params = {}) {
    return new Promise(ok => { const i = ++this.id; this.pend.set(i, ok); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  // The value of an expression in the page (wrapped so top-level names do not collide across calls); throws on an exception.
  async eval(expr, timeout = 120000) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)).slice(0, 1500));
    return r.result?.result?.value;
  }
  async nav(url) { await this.send('Page.navigate', { url }); }
  async reload() { await this.send('Page.reload', { ignoreCache: true }); }
  async shot(path, quality = 72) {
    const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    return path;
  }
  close() { try { this.ws.close(); } catch (e) { /* closed */ } }
}
