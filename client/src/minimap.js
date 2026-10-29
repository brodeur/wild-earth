// Mini-map: the present-day tile (NAIP imagery, OSM roads, NHD streams and waterbodies) with the
// player on it. It shows the real world on purpose, so the player can see where they are in the
// rewilded one relative to roads and towns that are no longer there.
// The static base (the whole tile, roads white and half transparent, their names) is drawn once to an
// offscreen canvas at the mini-map's scale; each frame the small map blits the VIEW_M window round the
// player, north up, and draws the trail, the player and the nearest place name over it. A click on it
// (or M) opens the full map: the whole tile over the view, where a click flies there (owner, 2026-10-29:
// "smaller relative to the viewport and show a much more zoomed in view. Clicking on it should open a
// fullscreen map. The roads markers should be white and semi-transparent").
// During the present-day peek (P) the roles swap: the main view shows the real photo and the
// map shows the rewilded texture instead (drawn once, on first peek).

const VIEW_PX = 150;           // the mini-map, CSS px square
const VIEW_M = 800;            // metres across it
const BASE_MAX_PX = 2400;      // the base canvas's side at most (the tile at the mini-map's scale, dpr applied)
const FULL_MARGIN = 48;        // the full map's margin to the viewport's shorter side
const TRAIL_MAX = 200;
const TRAIL_STEP_M = 20;       // record a trail point every 20 m moved (~4 km of trail)
const TRAIL_BREAK_M = 500;     // a jump this long starts a new trail
const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

export class MiniMap {
  constructor({ container, sizeM, imagery, features, flight, rewildImage = null }) {
    this.sizeM = sizeM; this.flight = flight; this.features = features; this.rewildImage = rewildImage;
    this.place = null;   // nearest present-day place name, drawn beside the player (set by main)
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    // the base: the tile at the mini-map's scale (VIEW_PX / VIEW_M CSS px per m), capped
    this.baseCss = Math.min(sizeM * VIEW_PX / VIEW_M, BASE_MAX_PX / this.dpr);
    this.basePx = Math.round(this.baseCss * this.dpr);
    this.baseScale = this.basePx / this.baseCss;   // base px per CSS px of the base
    const px = Math.round(VIEW_PX * this.dpr);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = px;
    this.canvas.style.width = this.canvas.style.height = VIEW_PX + 'px';
    this.canvas.title = 'present-day map · click for the full map';
    container.appendChild(this.canvas);
    this.container = container;
    this.ctx = this.canvas.getContext('2d');
    this.trail = [];
    this.pos = null; this.heading = 0;
    this.base = this.presentBase = this.drawBase(imagery, features);
    this.label = 'today';
    this.canvas.addEventListener('click', () => this.openFull());
    addEventListener('keydown', e => {
      if (e.code === 'KeyM' && !e.repeat) this.fullOpen ? this.closeFull() : this.openFull();
      else if (e.code === 'Escape' && this.fullOpen) this.closeFull();
    });
    // the full map: the whole tile over the view; a click flies there
    const full = this.full = document.createElement('div'); full.id = 'mapFull'; full.hidden = true;
    this.fullCanvas = document.createElement('canvas'); this.fullCtx = this.fullCanvas.getContext('2d');
    const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'click to fly there · M or Esc to close';
    full.append(this.fullCanvas, hint);
    full.addEventListener('click', e => { if (e.target === this.fullCanvas) this.jump(e); else this.closeFull(); });
    document.body.appendChild(full);
    this.fullOpen = false;
  }

  // peek on: show the rewilded texture (streams and water kept, roads gone); off: the present day
  setPeek(on) {
    if (on && !this.rewildBase && this.rewildImage) this.rewildBase = this.drawBase(this.rewildImage, this.features, { roads: false, dim: 0.1 });
    this.base = on && this.rewildBase ? this.rewildBase : this.presentBase;
    this.label = on ? 'rewilded' : 'today';
    this.canvas.title = on ? 'rewilded map · click for the full map' : 'present-day map · click for the full map';
  }

  get visible() { return this.container.style.display !== 'none'; }
  toggle() { this.container.style.display = this.visible ? 'none' : ''; }

  openFull() {
    const side = Math.max(200, Math.floor(Math.min(innerWidth, innerHeight) - FULL_MARGIN));
    this.fullCss = side; this.fullCanvas.width = this.fullCanvas.height = Math.round(side * this.dpr);
    this.fullCanvas.style.width = this.fullCanvas.style.height = side + 'px';
    this.full.hidden = false; this.fullOpen = true;
    if (this.pos) this.drawFull();
  }
  closeFull() { this.full.hidden = true; this.fullOpen = false; }

  // a view: CSS px per metre and the tile metres at its top left (ox east, oyN north)
  baseView() { return { s: this.baseCss / this.sizeM, ox: 0, oyN: this.sizeM, css: this.baseCss }; }
  miniView(x, north) { return { s: VIEW_PX / VIEW_M, ox: x - VIEW_M / 2, oyN: north + VIEW_M / 2, css: VIEW_PX }; }
  fullView() { return { s: this.fullCss / this.sizeM, ox: 0, oyN: this.sizeM, css: this.fullCss }; }
  // tile-local metres -> CSS pixels in a view (north up)
  toView(V, x, north) { return [(x - V.ox) * V.s, (V.oyN - north) * V.s]; }

  drawBase(imagery, features, { roads: withRoads = true, dim = 0.25 } = {}) {
    const c = document.createElement('canvas'); c.width = c.height = this.basePx;
    const g = c.getContext('2d'), V = this.baseView(), S = V.css;
    g.setTransform(this.baseScale, 0, 0, this.baseScale, 0, 0);
    g.fillStyle = '#1a221d'; g.fillRect(0, 0, S, S);
    if (imagery) {
      g.imageSmoothingQuality = 'high';
      g.drawImage(imagery, 0, 0, S, S);
      g.fillStyle = `rgba(10,15,12,${dim})`; g.fillRect(0, 0, S, S);   // dim so lines read on bright fields
    }
    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    g.lineJoin = 'round'; g.lineCap = 'round';
    const trace = path => {
      g.beginPath();
      path.forEach(([x, n], i) => { const [u, v] = this.toView(V, x, n); i ? g.lineTo(u, v) : g.moveTo(u, v); });
    };
    if (features) {
      g.fillStyle = 'rgba(64,140,230,0.85)';
      for (const w of features.waterbodies || []) { trace(w.ring); g.closePath(); g.fill(); }
      g.strokeStyle = 'rgba(150,210,255,0.85)'; g.lineWidth = 0.9;
      for (const s of features.streams || []) { trace(s.path); g.stroke(); }
      // roads: white, half transparent; the major ones wider over a faint dark casing so they read on pale ground
      const roads = withRoads ? features.roads || [] : [];
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8;
      for (const r of roads) if (!r.major) { trace(r.path); g.stroke(); }
      g.strokeStyle = 'rgba(10,15,12,0.35)'; g.lineWidth = 3.4;
      for (const r of roads) if (r.major) { trace(r.path); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2;
      for (const r of roads) if (r.major) { trace(r.path); g.stroke(); }
    }
    g.restore();
    if (features && withRoads) this.drawLabels(g, V, features.roads || []);
    return c;
  }

  // Label each named major road once, at the middle of its longest stretch inside the tile.
  drawLabels(g, V, roads) {
    const S = V.css;
    const inside = ([x, n]) => x >= 0 && x <= this.sizeM && n >= 0 && n <= this.sizeM;
    const best = new Map();   // name -> { run, len }
    for (const r of roads) {
      if (!r.major || !r.name) continue;
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          let len = 0; for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
          const b = best.get(r.name); if (!b || len > b.len) best.set(r.name, { run, len });
        }
        run = [];
      };
      for (const p of r.path) { if (inside(p)) run.push(p); else flush(); }
      flush();
    }
    const at = (run, len, t) => {    // point at fraction t of the run's length
      let want = len * t;
      for (let i = 1; i < run.length; i++) {
        const [ax, an] = run[i - 1], [bx, bn] = run[i], d = Math.hypot(bx - ax, bn - an);
        if (want <= d && d > 0) return [ax + (bx - ax) * want / d, an + (bn - an) * want / d];
        want -= d;
      }
      return run[run.length - 1];
    };
    g.font = `10px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const placed = [];
    const hits = a => placed.some(b => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
    const minLen = this.sizeM * 0.02;   // skip stubs of a couple of hundred metres
    for (const [name, { run, len }] of [...best].sort((a, b) => b[1].len - a[1].len)) {
      if (len < minLen) continue;
      const w = g.measureText(name).width + 4, h = 12;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        let [u, v] = this.toView(V, ...at(run, len, t));
        u = Math.min(Math.max(u, w / 2 + 2), S - w / 2 - 2);
        v = Math.min(Math.max(v, h / 2 + 2), S - h / 2 - 2);
        const box = { x0: u - w / 2, y0: v - h / 2, x1: u + w / 2, y1: v + h / 2 };
        if (hits(box)) continue;
        placed.push(box);
        g.lineWidth = 3; g.strokeStyle = 'rgba(10,15,12,0.8)'; g.strokeText(name, u, v);
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(name, u, v);
        break;
      }
    }
  }

  // a click on the full map: fly there, keeping the heading
  jump(e) {
    const r = this.fullCanvas.getBoundingClientRect(), V = this.fullView();
    const x = V.ox + (e.clientX - r.left) / r.width * V.css / V.s;
    const north = V.oyN - (e.clientY - r.top) / r.height * V.css / V.s;
    const yaw = this.flight.yaw;
    this.flight.reset(x, -north, 150);
    this.flight.yaw = yaw;   // keep the heading
    this.trail.length = 0;
    this.closeFull();
  }

  // pos: flight.pos (x, y, z with z = -north); heading in degrees, 0 = north, clockwise
  update(pos, heading) {
    const north = -pos.z, last = this.trail[this.trail.length - 1];
    const d = last ? Math.hypot(pos.x - last[0], north - last[1]) : Infinity;
    if (d > TRAIL_BREAK_M) this.trail.length = 0;
    if (d >= TRAIL_STEP_M) { this.trail.push([pos.x, north]); if (this.trail.length > TRAIL_MAX) this.trail.shift(); }
    this.pos = pos; this.heading = heading;
    if (this.fullOpen) this.drawFull();
    if (!this.visible) return;
    const g = this.ctx, V = this.miniView(pos.x, north), B = this.baseView();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1a221d'; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // the window of the base round the player (base px), scaled to the canvas
    const [bu, bv] = this.toView(B, V.ox, V.oyN), bw = VIEW_M * B.s * this.baseScale;
    g.drawImage(this.base, bu * this.baseScale, bv * this.baseScale, bw, bw, 0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOver(g, V, pos, north, heading);
  }

  drawFull() {
    const g = this.fullCtx, V = this.fullView(), pos = this.pos, north = -pos.z;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.base, 0, 0, this.basePx, this.basePx, 0, 0, this.fullCanvas.width, this.fullCanvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOver(g, V, pos, north, this.heading);
  }

  // the trail, the player, the nearest place name, the north mark, the caption and the border, in a view
  drawOver(g, V, pos, north, heading) {
    const S = V.css, [u, v] = this.toView(V, pos.x, north);
    const n = this.trail.length;
    if (n > 1) {
      g.lineWidth = 1.5; g.lineCap = 'round';
      for (let i = 1; i < n; i++) {   // fades toward the oldest point
        const [a, b] = this.toView(V, ...this.trail[i - 1]), [c, d2] = this.toView(V, ...this.trail[i]);
        g.strokeStyle = `rgba(255,255,255,${(0.08 + 0.5 * i / n).toFixed(3)})`;
        g.beginPath(); g.moveTo(a, b); g.lineTo(c, d2); g.stroke();
      }
      const [a, b] = this.toView(V, ...this.trail[n - 1]);
      g.strokeStyle = 'rgba(255,255,255,0.58)'; g.beginPath(); g.moveTo(a, b); g.lineTo(u, v); g.stroke();
    }
    g.save();
    g.translate(u, v); g.rotate(heading * Math.PI / 180);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath();
    g.fillStyle = '#ffe14d'; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = '#111'; g.stroke();
    g.restore();
    g.lineJoin = 'round';
    if (this.place) {   // the nearest place name, under the player (above it near the bottom edge)
      g.font = `600 10px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'center';
      const w = g.measureText(this.place).width;
      const tx = Math.min(Math.max(u, w / 2 + 3), S - w / 2 - 3), ty = v > S - 22 ? v - 14 : v + 14;
      g.lineWidth = 3; g.strokeStyle = 'rgba(10,15,12,0.9)'; g.strokeText(this.place, tx, ty);
      g.fillStyle = '#fff3b0'; g.fillText(this.place, tx, ty);
    }
    // the caption, the north mark and the border
    g.font = `600 10px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.lineWidth = 3; g.strokeStyle = 'rgba(10,15,12,0.85)'; g.strokeText(this.label, 5, S - 4);
    g.fillStyle = '#e6ede7'; g.fillText(this.label, 5, S - 4);
    g.font = `600 11px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.strokeText('N', S / 2, 4); g.fillText('N', S / 2, 4);
    g.strokeStyle = 'rgba(230,237,231,0.6)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}
