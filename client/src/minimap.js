// Mini-map: the present-day tile (NAIP imagery, OSM roads, NHD streams and waterbodies) with the
// raven on it. It shows the real world on purpose, so the player can see where they are in the
// rewilded one relative to roads and towns that are no longer there.
// The static base is drawn once to an offscreen canvas; each frame only blits it and draws the raven.

const CSS_SIZE = 240;
const TRAIL_MAX = 200;
const TRAIL_STEP_M = 20;       // record a trail point every 20 m flown (~4 km of trail)
const TRAIL_BREAK_M = 500;     // a jump this long starts a new trail

export class MiniMap {
  constructor({ container, sizeM, imagery, features, flight }) {
    this.sizeM = sizeM; this.flight = flight;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    const px = Math.round(CSS_SIZE * this.dpr);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = px;
    this.canvas.style.width = this.canvas.style.height = CSS_SIZE + 'px';
    this.canvas.title = 'present-day map · click to fly there';
    container.appendChild(this.canvas);
    this.container = container;
    this.ctx = this.canvas.getContext('2d');
    this.trail = [];
    this.base = this.drawBase(px, imagery, features);
    this.canvas.addEventListener('click', e => this.jump(e));
    addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) this.toggle(); });
  }

  get visible() { return this.container.style.display !== 'none'; }
  toggle() { this.container.style.display = this.visible ? 'none' : ''; }

  // tile-local metres -> CSS pixels on the map (north up)
  toMap(x, north) { const s = CSS_SIZE / this.sizeM; return [x * s, (this.sizeM - north) * s]; }

  drawBase(px, imagery, features) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#1a221d'; g.fillRect(0, 0, CSS_SIZE, CSS_SIZE);
    if (imagery) {
      g.imageSmoothingQuality = 'high';
      g.drawImage(imagery, 0, 0, CSS_SIZE, CSS_SIZE);
      g.fillStyle = 'rgba(10,15,12,0.25)'; g.fillRect(0, 0, CSS_SIZE, CSS_SIZE);   // dim so lines read on bright fields
    }
    g.save();
    g.beginPath(); g.rect(0, 0, CSS_SIZE, CSS_SIZE); g.clip();
    g.lineJoin = 'round'; g.lineCap = 'round';
    const trace = path => {
      g.beginPath();
      path.forEach(([x, n], i) => { const [u, v] = this.toMap(x, n); i ? g.lineTo(u, v) : g.moveTo(u, v); });
    };
    if (features) {
      g.fillStyle = 'rgba(64,140,230,0.85)';
      for (const w of features.waterbodies || []) { trace(w.ring); g.closePath(); g.fill(); }
      g.strokeStyle = 'rgba(150,210,255,0.85)'; g.lineWidth = 0.9;
      for (const s of features.streams || []) { trace(s.path); g.stroke(); }
      const roads = features.roads || [];
      g.strokeStyle = 'rgba(255,240,220,0.45)'; g.lineWidth = 0.6;
      for (const r of roads) if (!r.major) { trace(r.path); g.stroke(); }
      g.strokeStyle = 'rgba(40,20,0,0.6)'; g.lineWidth = 3.2;           // dark casing under major roads
      for (const r of roads) if (r.major) { trace(r.path); g.stroke(); }
      g.strokeStyle = '#ff9a3c'; g.lineWidth = 2;
      for (const r of roads) if (r.major) { trace(r.path); g.stroke(); }
    }
    g.restore();
    if (features) this.drawLabels(g, features.roads || []);
    // border and north marker
    g.strokeStyle = 'rgba(230,237,231,0.6)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, CSS_SIZE - 1, CSS_SIZE - 1);
    g.font = '600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.lineWidth = 3; g.strokeStyle = 'rgba(10,15,12,0.85)'; g.strokeText('N', CSS_SIZE / 2, 4);
    g.fillStyle = '#e6ede7'; g.fillText('N', CSS_SIZE / 2, 4);
    return c;
  }

  // Label each named major road once, at the middle of its longest stretch inside the tile.
  drawLabels(g, roads) {
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
    g.font = '10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const placed = [{ x0: CSS_SIZE / 2 - 8, y0: 0, x1: CSS_SIZE / 2 + 8, y1: 18 }];   // keep clear of the N
    const hits = a => placed.some(b => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
    const minLen = this.sizeM * 0.04;   // skip stubs of a few hundred metres
    for (const [name, { run, len }] of [...best].sort((a, b) => b[1].len - a[1].len)) {
      if (len < minLen) continue;
      const w = g.measureText(name).width + 4, h = 12;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        let [u, v] = this.toMap(...at(run, len, t));
        u = Math.min(Math.max(u, w / 2 + 2), CSS_SIZE - w / 2 - 2);
        v = Math.min(Math.max(v, h / 2 + 2), CSS_SIZE - h / 2 - 2);
        const box = { x0: u - w / 2, y0: v - h / 2, x1: u + w / 2, y1: v + h / 2 };
        if (hits(box)) continue;
        placed.push(box);
        g.lineWidth = 3; g.strokeStyle = 'rgba(10,15,12,0.85)'; g.strokeText(name, u, v);
        g.fillStyle = '#ffe2c4'; g.fillText(name, u, v);
        break;
      }
    }
  }

  jump(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * this.sizeM;
    const north = this.sizeM - (e.clientY - r.top) / r.height * this.sizeM;
    const yaw = this.flight.yaw;
    this.flight.reset(x, -north, 150);
    this.flight.yaw = yaw;   // keep the heading
    this.trail.length = 0;
  }

  // pos: flight.pos (x, y, z with z = -north); heading in degrees, 0 = north, clockwise
  update(pos, heading) {
    const north = -pos.z, last = this.trail[this.trail.length - 1];
    const d = last ? Math.hypot(pos.x - last[0], north - last[1]) : Infinity;
    if (d > TRAIL_BREAK_M) this.trail.length = 0;
    if (d >= TRAIL_STEP_M) { this.trail.push([pos.x, north]); if (this.trail.length > TRAIL_MAX) this.trail.shift(); }
    if (!this.visible) return;

    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [u, v] = this.toMap(pos.x, north);
    const n = this.trail.length;
    if (n > 1) {
      g.lineWidth = 1.5; g.lineCap = 'round';
      for (let i = 1; i < n; i++) {   // fades toward the oldest point
        const [a, b] = this.toMap(...this.trail[i - 1]), [c, d2] = this.toMap(...this.trail[i]);
        g.strokeStyle = `rgba(255,255,255,${(0.08 + 0.5 * i / n).toFixed(3)})`;
        g.beginPath(); g.moveTo(a, b); g.lineTo(c, d2); g.stroke();
      }
      const [a, b] = this.toMap(...this.trail[n - 1]);
      g.strokeStyle = 'rgba(255,255,255,0.58)'; g.beginPath(); g.moveTo(a, b); g.lineTo(u, v); g.stroke();
    }
    g.save();
    g.translate(u, v); g.rotate(heading * Math.PI / 180);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath();
    g.fillStyle = '#ffe14d'; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = '#111'; g.stroke();
    g.restore();
  }
}
