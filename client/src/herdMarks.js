import * as THREE from 'three';

// Off-screen herd members (owner, 2026-10-27): in a herd, covey or flock (groundControl.js herd), each member that is
// not on screen is shown as a small avatar in a circle at the edge of the screen nearest to it (the start screen's
// still of the species, assets/opening), so the player always knows where the group is. Members on screen have no
// marker. The markers are elements in #herdMarks (index.html), one per member, placed every frame from the camera's
// projection; a member behind the camera is marked on the edge toward where it would be if the view turned round.
const STILLS = new URL('../assets/opening/', import.meta.url);
const INSET = 26;   // px from the screen's edge to the circle's centre
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _edge = { x: 0, y: 0 };
let _insetB = INSET;   // the bottom edge's inset: over the HUD's bottom rows (setEdgeBottom; players.js measures them)

// The bottom edge's inset in px (the key line, the body's row and the chat stand along the bottom: a mark is placed over
// them, not under them), for every mark placed here.
export function setEdgeBottom(px) { _insetB = Math.max(INSET, px || 0); }

// Where a world point out of view is marked: the screen's edge nearest it, INSET px in, as CSS px from the top left
// ({x, y}, one shared object: copy what is kept), or null while the point is on screen. A point behind the camera is
// marked on the edge toward where it would be if the view turned round. Shared with the other players' marks
// (players.js), so a friend and a herd member out of view are placed by the same rule.
export function edgePlace(camera, x, y, z, W = innerWidth, H = innerHeight) {
  const cx = W / 2, cy = H / 2;
  const behind = _c.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).z > 0;   // camera space: ahead is -z
  _v.set(x, y, z).project(camera);
  let nx = _v.x, ny = _v.y;
  if (behind) { nx = -nx; ny = -ny; }
  if (!behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) return null;   // on screen
  let dx = nx, dy = -ny; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const t = Math.min((cx - INSET) / Math.max(Math.abs(dx), 1e-6), (cy - (dy > 0 ? _insetB : INSET)) / Math.max(Math.abs(dy), 1e-6));
  _edge.x = cx + dx * t; _edge.y = cy + dy * t;
  return _edge;
}

export class HerdMarks {
  constructor({ el, camera, animals }) {
    this.el = el; this.camera = camera; this.animals = animals; this.marks = new Map(); this.index = null;
    fetch(new URL('index.json', STILLS)).then(r => r.json()).then(j => { this.index = j.species || {}; }).catch(() => { this.index = {}; });
  }
  // group: the player's group (null: none); me: the player's own animal (skipped); h: the body's height (the marker aims at its middle)
  update(group, me, h = 0.5) {
    const keep = new Set();
    if (group && this.index && this.el) {
      const cam = this.camera, W = innerWidth, H = innerHeight;
      for (const a of this.animals.list) {
        if (a.group !== group || a === me || a.culled) continue;
        const e = edgePlace(cam, a.x, a.y + h, a.z, W, H);
        if (!e) continue;   // on screen
        let m = this.marks.get(a.id);
        if (!m) { m = this.make(a); this.marks.set(a.id, m); }
        m.style.transform = `translate(${e.x.toFixed(0)}px, ${e.y.toFixed(0)}px)`;
        keep.add(a.id);
      }
    }
    for (const [id, m] of this.marks) if (!keep.has(id)) { m.remove(); this.marks.delete(id); }
  }
  make(a) {
    const sp = this.animals.speciesList()[a.sp], st = this.index[sp.code] || this.index[sp.code.split(':')[0]];
    const m = document.createElement('div'); m.className = 'hm'; m.title = sp.common || sp.one;
    const img = document.createElement('img'); img.alt = sp.one; img.decoding = 'async';
    if (st) img.src = new URL(st.file, STILLS).href;
    m.append(img); this.el.append(m);
    return m;
  }
  clear() { this.update(null, null); }
}
