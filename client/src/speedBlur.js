import * as THREE from 'three';

// The dive's speed streaks (owner, 2026-11-11: "Every bird should have a "dive" ability - when used, they angle downwards
// and tuck their wings and "speed blurs" ripple across the edges of the viewport").
//
// A 2D canvas over the world (#speedBlur, made the first time a bird dives, under the HUD; index.html has its style),
// not a pass of the renderer: the world's shaders are at the 16 texture units and 16 vertex attributes of ANGLE on Metal,
// and this adds no sampler, no attribute and no render target to them. While no bird dives update() returns on its first
// line and the canvas is not displayed, so the effect costs nothing; while one does, it clears and redraws one gradient
// and at most N copies of one small soft sprite a frame, at one canvas pixel per CSS pixel whatever the display's density
// (the streaks are soft by nature).
//
// What is drawn, from dive.js blur() (k: the strength 0..1, from the speed between the species' cruise and its dive top,
// faded in at the start and out through the pull-out; v: the speed, m/s):
//   - streaks: soft tapered lines (one sprite, turned and stretched) that point away from the heading's point on the screen (where the bird is going: its flight
//     direction projected, eased, kept within the middle of the frame), each on its own bearing round that point,
//     travelling outward through a band at the frame's edges and fading in and out at the band's ends; faster, longer,
//     wider and more of them with speed. The band's inner edge is an ellipse of the viewport's shape, R_IN of the way out
//     at the weakest and at the strongest, so the middle of the frame is always clear: the ground ahead and the prey
//     stay readable.
//   - the ripple: the streaks' brightness is a wave that runs round the frame (RIPPLE lobes, turning with time), so they
//     come in gusts along the edges instead of as an even ring.
//   - a faint dark vignette under them at the same edges, which gives pale streaks something to show against over sky.
// prefers-reduced-motion: no streaks and no ripple; only the vignette, which does not move (it deepens with the speed).
const N = 260;                       // streaks at full strength
const R_IN = [0.74, 0.5];            // the band's inner edge at the weakest and the strongest (1 = the ellipse inscribed in the viewport)
const R_OUT = 1.5;                   // its outer edge (the corners are at sqrt 2)
const RIPPLE = 3, RIPPLE_HZ = 0.9;   // the brightness wave: lobes round the frame, turns a second
const ALPHA = 1, SHADE = 0.55, SHADE_STILL = 0.5;   // the brightest streak; the vignette's edge at full strength, and with reduced motion
const POINT_IN = [0.3, 0.7];         // the heading's point is kept within this share of the frame each way
const SPR_W = 192, SPR_H = 16;       // the streak's sprite, px: its length and its width (drawn stretched)
const TAU = Math.PI * 2;

export class SpeedBlur {
  constructor({ camera, flight }) {
    this.camera = camera; this.flight = flight;
    this.el = null; this.ctx = null; this.w = 0; this.h = 0; this.grad = null;
    this.k = 0; this.t = 0; this.cx = 0.5; this.cy = 0.5;
    this.on = true;       // (off: nothing is drawn, for the frame time with and without)
    this.ms = 0;          // the last draw's time on the main thread, ms (the docs' measurement)
    const mq = this.mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.reduced = !!mq?.matches;
    this.onMq = e => { this.reduced = !!e.matches; };
    mq?.addEventListener?.('change', this.onMq);
    // each streak: its bearing, its phase along the band, its pace, its length and its width (fixed: no allocation in a frame)
    let seed = 0x5eedb1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const S = this.S = new Float32Array(N * 5);
    for (let i = 0; i < N; i++) { S[i * 5] = (i + rnd()) / N * TAU; S[i * 5 + 1] = rnd(); S[i * 5 + 2] = 0.7 + 0.6 * rnd(); S[i * 5 + 3] = 0.6 + 0.8 * rnd(); S[i * 5 + 4] = 0.6 + 0.8 * rnd(); }
    // drawn in a shuffled order, so a weak dive's few streaks are spread round the frame
    const O = this.order = new Uint16Array(N); for (let i = 0; i < N; i++) O[i] = i;
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), s = O[i]; O[i] = O[j]; O[j] = s; }
    this._v = new THREE.Vector3();
  }
  ensure() {
    if (this.el) return;
    const c = this.el = document.createElement('canvas');
    c.id = 'speedBlur'; c.setAttribute('aria-hidden', 'true'); c.style.display = 'none';
    document.body.append(c);
    this.ctx = c.getContext('2d');
    // the streak: pale, thin at its inner end, brightest two thirds of the way out, soft at its sides and its far end
    const s = this.sprite = document.createElement('canvas'); s.width = SPR_W; s.height = SPR_H;
    const g = s.getContext('2d'), im = g.createImageData(SPR_W, SPR_H), d = im.data;
    for (let y = 0; y < SPR_H; y++) for (let x = 0; x < SPR_W; x++) {
      const u = (x + 0.5) / SPR_W, w = ((y + 0.5) / SPR_H - 0.5) * 2, half = 0.25 + 0.75 * u;   // the streak widens outward
      const along = Math.pow(Math.min(1, u / 0.66), 1.6) * Math.min(1, (1 - u) / 0.34), across = Math.exp(-((w / half) ** 2) * 3.2);
      const o = (y * SPR_W + x) * 4; d[o] = 238; d[o + 1] = 245; d[o + 2] = 255; d[o + 3] = Math.round(255 * along * across);
    }
    g.putImageData(im, 0, 0);
  }
  // Every frame (main.js). want: dive.js blur() ({ k, v }), or null.
  update(dt, want) {
    const kT = this.on && want ? want.k : 0;
    if (kT <= 0 && this.k <= 0) return;   // no dive: nothing to do
    this.k += (kT - this.k) * Math.min(1, dt * (kT > this.k ? 6 : 5));
    if (kT <= 0 && this.k < 0.01) { this.k = 0; if (this.el) this.el.style.display = 'none'; return; }
    const t0 = performance.now();
    this.ensure();
    const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight), c = this.el;
    if (W !== this.w || H !== this.h) { this.w = c.width = W; this.h = c.height = H; this.grad = null; }
    if (c.style.display !== 'block') c.style.display = 'block';
    this.draw(dt, want?.v || 0);
    this.ms = performance.now() - t0;
  }
  // where the bird is heading on the screen (0..1 each way), eased and kept in the middle of the frame
  point(dt) {
    const f = this.flight, cp = Math.cos(f.pitch), v = this._v.set(-Math.sin(f.yaw) * cp, Math.sin(f.pitch), -Math.cos(f.yaw) * cp).multiplyScalar(200).add(f.pos);
    v.project(this.camera);
    const ok = Number.isFinite(v.x) && Number.isFinite(v.y) && v.z < 1 && v.z > -1;
    const clamp = u => Math.min(POINT_IN[1], Math.max(POINT_IN[0], u));
    const tx = ok ? clamp(0.5 + 0.5 * v.x) : 0.5, ty = ok ? clamp(0.5 - 0.5 * v.y) : 0.5, e = Math.min(1, dt * 4);
    this.cx += (tx - this.cx) * e; this.cy += (ty - this.cy) * e;
  }
  draw(dt, v) {
    const c = this.ctx, W = this.w, H = this.h, k = this.k, still = this.reduced;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.clearRect(0, 0, W, H);
    // the vignette: clear inside the band's inner edge, darkest at the corners (an ellipse of the viewport's shape)
    if (!this.grad) {
      const g = this.grad = c.createRadialGradient(0, 0, R_IN[1] * H / 2, 0, 0, Math.SQRT2 * H / 2);
      g.addColorStop(0, 'rgba(5,9,13,0)'); g.addColorStop(0.55, 'rgba(5,9,13,0.45)'); g.addColorStop(1, 'rgba(5,9,13,1)');
    }
    c.globalAlpha = (still ? SHADE_STILL : SHADE) * k;
    c.setTransform(W / H, 0, 0, 1, W / 2, H / 2); c.fillStyle = this.grad; c.fillRect(-H / 2, -H / 2, H, H);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (still) return;   // reduced motion: the still vignette alone
    this.point(dt);
    this.t += dt * (0.25 + v / 30);   // the streaks' travel through the band quickens with the speed
    const S = this.S, O = this.order, n = Math.round(N * (0.45 + 0.55 * k)), ka = Math.sqrt(k), rin = R_IN[0] + (R_IN[1] - R_IN[0]) * k;
    const px = this.cx * W, py = this.cy * H, hw = W / 2, hh = H / 2, wave = performance.now() * 0.001 * RIPPLE_HZ * TAU;
    const spr = this.sprite;
    for (let q = 0; q < n; q++) {
      const i = O[q] * 5, a = S[i] + 0.012 * Math.sin(this.t * 7 + q);
      const u = (S[i + 1] + this.t * S[i + 2] * 0.55) % 1, rho = rin + u * (R_OUT - rin);
      const ex = Math.cos(a) * hw, ey = Math.sin(a) * hh, el = Math.hypot(ex, ey) || 1, dx = ex / el, dy = ey / el;
      const x0 = px + ex * rho, y0 = py + ey * rho;
      if (x0 < -40 || x0 > W + 40 || y0 < -40 || y0 > H + 40) continue;   // past the frame
      const ripple = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a * RIPPLE - wave + 1.7 * Math.sin(a * 2 + wave * 0.31)));
      const al = ALPHA * ka * ripple * Math.pow(Math.sin(Math.PI * u), 0.7);
      if (al < 0.012) continue;
      const len = (0.1 + 0.26 * k) * S[i + 3] * H * (0.6 + u), wd = (4 + 9 * k) * S[i + 4] * (0.5 + u);
      const sx = len / SPR_W, sy = wd / SPR_H;
      c.globalAlpha = al;
      c.setTransform(dx * sx, dy * sx, -dy * sy, dx * sy, x0, y0); c.drawImage(spr, 0, -SPR_H / 2);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
  }
  dispose() {
    this.mq?.removeEventListener?.('change', this.onMq);
    this.el?.remove(); this.el = null; this.ctx = null; this.k = 0;
  }
}
