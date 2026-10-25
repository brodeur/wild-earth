// Place names: the nearest named present-day feature (road, stream, waterbody, and points of
// interest when the tile has them) to a point, for the HUD's "today" row and the mini-map label.
// features.json holds thousands of vertices, so every named segment is binned once into a coarse
// grid and a query only walks the rings of cells around the point until nothing nearer can exist.
// Coordinates are tile-local metres [x east, north from the south edge], as in features.json.

const CELL_M = 250;          // grid cell; a query at most ~(R / CELL)^2 cells
const MAX_R = 1500;          // beyond this nothing is "near"
const OVER_M = 35;           // closer than this to a road or stream line counts as over it
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class PlaceNames {
  constructor(features, sizeM) {
    this.size = sizeM; this.n = Math.ceil(sizeM / CELL_M);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.names = []; this.kinds = [];
    const seg = [];           // ax, an, bx, bn per segment
    this.segFeat = [];        // feature index per segment
    const add = (name, kind) => { this.names.push(name); this.kinds.push(kind); return this.names.length - 1; };
    const addPath = (path, f, closed) => {
      const m = path.length, last = closed ? m : m - 1;
      for (let k = 0; k < last; k++) {
        const a = path[k], b = path[(k + 1) % m];
        const s = this.segFeat.length; this.segFeat.push(f); seg.push(a[0], a[1], b[0], b[1]);
        this.bin(s, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
      }
      if (m === 1) {   // a point feature: a zero-length segment
        const s = this.segFeat.length; this.segFeat.push(f); seg.push(path[0][0], path[0][1], path[0][0], path[0][1]);
        this.bin(s, path[0][0], path[0][1], path[0][0], path[0][1]);
      }
    };
    for (const r of features?.roads || []) if (r.name) addPath(r.path, add(r.name, 'road'), false);
    for (const s of features?.streams || []) if (s.name) addPath(s.path, add(s.name, 'stream'), false);
    this.water = [];          // named waterbodies, for the inside test: { f, ring, bbox }
    for (const w of features?.waterbodies || []) {
      if (!w.name || !w.ring?.length) continue;
      // A reservoir or stock pond the pipeline rewilded (tilepackage markRewilded) is a meadow now; the
      // name stays, as locals still use it, but the caption says what it is: "over the old bed of Patterson Lake".
      const f = add(w.rewilded ? `the old bed of ${w.name}` : w.name, 'water'); addPath(w.ring, f, true);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of w.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      this.water.push({ f, ring: w.ring, bbox: [x0, y0, x1, y1] });
    }
    // Points of interest, when the pipeline provides them: { name, x, n } or { name, at: [x, n] } or { name, path }.
    for (const p of features?.pois || features?.places || []) {
      if (!p.name) continue;
      const at = p.at || (p.x != null ? [p.x, p.n ?? p.north ?? p.y] : null);
      if (at) addPath([at], add(p.name, 'poi'), false); else if (p.path) addPath(p.path, add(p.name, 'poi'), false);
    }
    this.seg = new Float32Array(seg);
    this.stamp = new Uint32Array(this.segFeat.length); this.tick = 0;
    this.count = this.names.length;
  }

  clampCell(v) { return Math.min(Math.max(Math.floor(v / CELL_M), 0), this.n - 1); }
  bin(s, x0, y0, x1, y1) {
    const i0 = this.clampCell(x0), i1 = this.clampCell(x1), j0 = this.clampCell(y0), j1 = this.clampCell(y1);
    // Segments just outside the tile go into the clamped edge cells (they are only further than the
    // cell, so the ring bound in nearest() still holds); anything beyond MAX_R of the tile is dropped.
    if (x1 < -MAX_R || y1 < -MAX_R || x0 > this.size + MAX_R || y0 > this.size + MAX_R) return;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.n + i].push(s);
  }

  // Nearest named feature to (x, north): { name, kind, d (m), bearing (deg, from the point to it), over } or null.
  nearest(x, north, maxR = MAX_R) {
    for (const w of this.water) {   // inside a named lake or pond: over it
      const [x0, y0, x1, y1] = w.bbox;
      if (x >= x0 && x <= x1 && north >= y0 && north <= y1 && inside(w.ring, x, north))
        return { name: this.names[w.f], kind: 'water', d: 0, bearing: 0, over: true };
    }
    const ci = this.clampCell(x), cj = this.clampCell(north), S = this.seg, stamp = this.stamp, t = ++this.tick;
    let best = Infinity, bs = -1, bx = 0, by = 0;
    const rings = Math.ceil(maxR / CELL_M) + 1;
    for (let k = 0; k <= rings; k++) {
      if (best <= (k - 1) * CELL_M) break;   // ring k is at least (k-1) cells away
      for (let j = cj - k; j <= cj + k; j++) {
        if (j < 0 || j >= this.n) continue;
        const edge = j === cj - k || j === cj + k;
        for (let i = ci - k; i <= ci + k; i += edge ? 1 : 2 * k || 1) {
          if (i < 0 || i >= this.n) continue;
          for (const s of this.cells[j * this.n + i]) {
            if (stamp[s] === t) continue; stamp[s] = t;
            const o = s * 4, ax = S[o], ay = S[o + 1], dx = S[o + 2] - ax, dy = S[o + 3] - ay;
            const l2 = dx * dx + dy * dy;
            const u = l2 > 0 ? Math.min(Math.max(((x - ax) * dx + (north - ay) * dy) / l2, 0), 1) : 0;
            const px = ax + dx * u, py = ay + dy * u, d = Math.hypot(x - px, north - py);
            if (d < best) { best = d; bs = s; bx = px; by = py; }
          }
        }
      }
    }
    if (bs < 0 || best > maxR) return null;
    const f = this.segFeat[bs], kind = this.kinds[f];
    const bearing = (Math.atan2(bx - x, by - north) * 180 / Math.PI + 360) % 360;
    return { name: this.names[f], kind, d: best, bearing, over: kind !== 'poi' && best < OVER_M };
  }

  // HUD text: "over Greenstone Road", "near Weber Creek · 340 m NE", or "–"
  describe(x, north) {
    const p = this.nearest(x, north);
    if (!p) return { text: this.count ? 'nothing named within 1.5 km' : '–', place: null };
    if (p.over) return { text: `over ${p.name}`, place: p.name };
    const d = p.d < 100 ? Math.round(p.d / 10) * 10 : Math.round(p.d / 50) * 50;
    return { text: `near ${p.name} · ${d} m ${COMPASS[Math.round(p.bearing / 45) % 8]}`, place: p.name };
  }
}

function inside(ring, x, y) {   // even-odd point in polygon
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
