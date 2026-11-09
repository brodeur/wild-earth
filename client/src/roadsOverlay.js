import * as THREE from 'three';
import { releaseGeometry } from './gpuRelease.js';

// Ghost roads: the present-day road network as "a very simple polygonal hologram of the road system" (Aaron,
// 2026-11-08), with names on major roads, for orientation in the rewilded world. G toggles it; hidden by default.
// Each road is a flat ribbon at its paved width, draped on the ground and lifted a little, built once at load into a
// single mesh (one draw call: forceSinglePass, or three draws a transparent double-sided material twice) with one unlit
// ShaderMaterial: a translucent cyan-teal fill, a hairline at each edge, a faint pulse running along each road, and a
// little brighter the farther it is, so the network reads from the air and stays faint underfoot. Major roads are greener and brighter. Normal blending, not additive: over the
// pale sky and haze an additive cyan washed out to white. Labels are sprites, as before.
//
// Two vertex attributes: position, and aRib = (across -1..1, metres along the road plus a per-road phase, major 0/1).
// Each vertex is pulled toward the camera along its own view ray by a small fraction of its distance (its place on
// screen unchanged), so from the air the ribbon is not lost under the coarse far terrain or a canopy.

// The paved half-widths (m), copied from pipeline/unroad.py HALF_WIDTH (the pavement a road actually has).
const HALF_WIDTH = { motorway: 8, motorway_link: 4, trunk: 7, trunk_link: 4, primary: 6, primary_link: 3.5,
  secondary: 5, secondary_link: 3, tertiary: 4.5, residential: 3.5, unclassified: 3.5, living_street: 3, service: 2.5,
  track: 2 };
const HALF_WIDTH_DEFAULT = 2.5;

const STEP_M = 15, MIN_STEP_M = 2, BEND_TOL_M = 0.25, LIFT_M = 0.7, MITRE_MAX = 2;
const LABEL_W_M = 120, LABEL_LIFT_M = 25;

const VERT = /* glsl */`
attribute vec3 aRib;
varying vec3 vRib;
varying float vFar;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 toCam = cameraPosition - wp.xyz;
  float d = length(toCam);
  wp.xyz += toCam / max(d, 1e-3) * min(d * 0.015, 60.0);
  vRib = aRib;
  vFar = smoothstep(40.0, 2500.0, d);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform float uTime;
varying vec3 vRib;
varying float vFar;
void main() {
  float e = abs(vRib.x);
  float rim = 1.0 - smoothstep(0.0, 1.5 * fwidth(vRib.x), 1.0 - e);
  float glow = e * e * e;
  float pulse = pow(fract((vRib.y - uTime * 30.0) / 300.0), 12.0);
  float major = vRib.z;
  vec3 col = mix(vec3(0.12, 0.85, 0.95), vec3(0.40, 1.0, 0.62), major);
  float a = (0.08 + 0.16 * glow + 0.55 * rim + 0.30 * pulse) * mix(0.35, 1.0, vFar) * mix(1.0, 1.35, major);
  gl_FragColor = vec4(min(col * (1.0 + 0.4 * rim), 1.0), min(a, 0.95));
}`;

function labelSprite(text) {
  const dpr = 2, font = `600 ${14 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = font;
  const pad = 10 * dpr, h = 24 * dpr, w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = w; c.height = h;
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = 'rgba(15,21,18,0.72)';
  g.beginPath(); g.roundRect(0, 0, w, h, h / 2); g.fill();
  g.fillStyle = '#ffd9a8'; g.fillText(text, w / 2, h / 2 + dpr);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(LABEL_W_M * w / (200 * dpr), LABEL_W_M * h / (200 * dpr), 1);   // 200 canvas px = 120 m
  return s;
}

// The centreline of one road as runs of [x, north] samples inside the tile: every STEP_M along each way segment, and
// halved where the ground between two samples (at the centre or either edge) strays more than BEND_TOL_M from the
// straight line between them, so the ribbon follows a hill's crown and a gully's floor instead of cutting through.
function centreline(path, hw, heights, size) {
  const runs = []; let run = [];
  const inside = (x, n) => x >= 0 && n >= 0 && x <= size && n <= size;
  const push = (x, n) => {
    if (!inside(x, n)) { if (run.length > 1) runs.push(run); run = []; return; }
    const last = run[run.length - 1];
    if (!last || last[0] !== x || last[1] !== n) run.push([x, n]);
  };
  const strays = (x0, n0, x1, n1) => {
    const d = Math.hypot(x1 - x0, n1 - n0), ox = -(n1 - n0) / d * hw, on = (x1 - x0) / d * hw;
    const xm = (x0 + x1) / 2, nm = (n0 + n1) / 2;
    for (const k of [0, 1, -1]) {
      const h0 = heights.at(x0 + ox * k, n0 + on * k), h1 = heights.at(x1 + ox * k, n1 + on * k);
      if (Math.abs(heights.at(xm + ox * k, nm + on * k) - (h0 + h1) / 2) > BEND_TOL_M) return true;
    }
    return false;
  };
  const refine = (x0, n0, x1, n1) => {   // pushes the samples after (x0, n0) up to and including (x1, n1)
    if (Math.hypot(x1 - x0, n1 - n0) > MIN_STEP_M * 2 && strays(x0, n0, x1, n1)) {
      const xm = (x0 + x1) / 2, nm = (n0 + n1) / 2;
      refine(x0, n0, xm, nm); refine(xm, nm, x1, n1);
    } else push(x1, n1);
  };
  push(path[0][0], path[0][1]);
  for (let k = 1; k < path.length; k++) {
    const [x0, n0] = path[k - 1], [x1, n1] = path[k], d = Math.hypot(x1 - x0, n1 - n0);
    if (!d) continue;
    const steps = Math.max(1, Math.ceil(d / STEP_M));
    for (let s = 0; s < steps; s++) {
      const a = s / steps, b = (s + 1) / steps;
      refine(x0 + (x1 - x0) * a, n0 + (n1 - n0) * a, x0 + (x1 - x0) * b, n0 + (n1 - n0) * b);
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export class RoadsOverlay {
  constructor(tile, scene) {
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    const roads = tile.features?.roads || [], heights = tile.heights, size = tile.size;
    const pos = [], rib = [], index = [];
    const longest = new Map();   // name -> {len, path} of its longest way, for the label
    roads.forEach((r, ri) => {
      let len = 0;
      for (let k = 1; k < r.path.length; k++) len += Math.hypot(r.path[k][0] - r.path[k - 1][0], r.path[k][1] - r.path[k - 1][1]);
      if (r.major && r.name && len > (longest.get(r.name)?.len || 0)) longest.set(r.name, { len, path: r.path });
      if (r.path.length < 2) return;
      const hw = HALF_WIDTH[r.kind] ?? HALF_WIDTH_DEFAULT, major = r.major ? 1 : 0;
      let along = ((ri * 2654435761) >>> 0) % 997;   // a phase per road, so the pulses do not march in step
      for (const run of centreline(r.path, hw, heights, size)) {
        const m = run.length, base = pos.length / 3;
        const dirs = [];   // unit direction of each segment
        for (let k = 1; k < m; k++) {
          const dx = run[k][0] - run[k - 1][0], dn = run[k][1] - run[k - 1][1], d = Math.hypot(dx, dn);
          dirs.push([dx / d, dn / d, d]);
        }
        for (let k = 0; k < m; k++) {
          // The joint's normal is the mitre: the perpendicular of the mean direction, lengthened so each edge keeps
          // its offset from both segments (at most MITRE_MAX times, so a hairpin does not throw out a spike).
          const a = dirs[Math.max(0, k - 1)], b = dirs[Math.min(m - 2, k)];
          let tx = a[0] + b[0], tn = a[1] + b[1], tl = Math.hypot(tx, tn);
          if (tl < 1e-6) { tx = a[0]; tn = a[1]; tl = 1; }
          tx /= tl; tn /= tl;
          const nx = -tn, nn = tx, scale = hw / Math.max(nx * -a[1] + nn * a[0], 1 / MITRE_MAX);
          if (k > 0) along += dirs[k - 1][2];
          const [x, n] = run[k];
          for (const side of [-1, 1]) {
            const ex = x + nx * scale * side, en = n + nn * scale * side;
            pos.push(ex, heights.at(ex, en) + LIFT_M, -en);
            rib.push(side, along, major);
          }
          if (k > 0) { const i = base + 2 * k; index.push(i - 2, i - 1, i, i - 1, i + 1, i); }
        }
      }
    });
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 3));
      g.setIndex(index);
      releaseGeometry(g);   // its arrays go once uploaded (gpuRelease.js)
      const uniforms = { uTime: { value: 0 } };
      const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true,
        depthTest: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide, forceSinglePass: true, fog: false, toneMapped: false });
      const mesh = new THREE.Mesh(g, mat);
      mesh.onBeforeRender = () => { uniforms.uTime.value = (performance.now() / 1000) % 10000; };
      this.group.add(mesh); this.mesh = mesh;
      this.vertices = pos.length / 3;
    }
    // One label per named major road, at the midpoint (by length) of its longest way inside the tile.
    for (const [name, { path }] of longest) {
      const inside = path.filter(([x, n]) => x >= 0 && n >= 0 && x <= size && n <= size);
      if (inside.length < 2) continue;
      let total = 0; for (let k = 1; k < inside.length; k++) total += Math.hypot(inside[k][0] - inside[k - 1][0], inside[k][1] - inside[k - 1][1]);
      let acc = 0, x = inside[0][0], n = inside[0][1];
      for (let k = 1; k < inside.length; k++) {
        const d = Math.hypot(inside[k][0] - inside[k - 1][0], inside[k][1] - inside[k - 1][1]);
        if (acc + d >= total / 2) { const a = d ? (total / 2 - acc) / d : 0; x = inside[k - 1][0] + (inside[k][0] - inside[k - 1][0]) * a; n = inside[k - 1][1] + (inside[k][1] - inside[k - 1][1]) * a; break; }
        acc += d;
      }
      const s = labelSprite(name); s.position.set(x, heights.at(x, n) + LABEL_LIFT_M, -n); this.group.add(s);
    }
    this.labels = longest.size;
    addEventListener('keydown', e => {
      if (e.code === 'KeyG' && !e.repeat && !(e.target instanceof HTMLInputElement)) this.group.visible = !this.group.visible;
    });
  }
}
