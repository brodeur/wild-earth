import * as THREE from 'three';

// Ghost roads: the present-day road network drawn as faint lines just above the terrain, with
// names on major roads, for orientation in the rewilded world. G toggles it; hidden by default.
// Built once at load into two LineSegments (major, minor) and a handful of sprites; not tone mapped, it is UI.

const STEP_M = 20, LIFT_M = 1.5, LABEL_W_M = 120, LABEL_LIFT_M = 25;

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

export class RoadsOverlay {
  constructor(tile, scene) {
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    const roads = tile.features?.roads || [], heights = tile.heights, size = tile.size;
    const verts = { major: [], minor: [] };
    const longest = new Map();   // name -> {len, path} of its longest way, for the label
    for (const r of roads) {
      const out = verts[r.major ? 'major' : 'minor'];
      let len = 0;
      for (let k = 1; k < r.path.length; k++) {
        const [x0, n0] = r.path[k - 1], [x1, n1] = r.path[k], d = Math.hypot(x1 - x0, n1 - n0);
        len += d;
        const steps = Math.max(1, Math.ceil(d / STEP_M));
        for (let s = 0; s < steps; s++) {
          const a = s / steps, b = (s + 1) / steps;
          const xa = x0 + (x1 - x0) * a, na = n0 + (n1 - n0) * a, xb = x0 + (x1 - x0) * b, nb = n0 + (n1 - n0) * b;
          out.push(xa, heights.at(xa, na) + LIFT_M, -na, xb, heights.at(xb, nb) + LIFT_M, -nb);
        }
      }
      if (r.major && r.name && len > (longest.get(r.name)?.len || 0)) longest.set(r.name, { len, path: r.path });
    }
    for (const [kind, color, opacity] of [['minor', 0xf3e6d0, 0.5], ['major', 0xff9a3c, 0.85]]) {
      if (!verts[kind].length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts[kind], 3));
      const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: false, fog: false, toneMapped: false }));
      line.frustumCulled = false; this.group.add(line);
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
