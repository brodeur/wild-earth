import * as THREE from 'three';

// Off-screen herd members (owner, 2026-10-27): in a herd, covey or flock (groundControl.js herd), each member that is
// not on screen is shown as a small avatar in a circle at the edge of the screen nearest to it (the start screen's
// still of the species, assets/opening), so the player always knows where the group is. Members on screen have no
// marker. The markers are elements in #herdMarks (index.html), one per member, placed every frame from the camera's
// projection; a member behind the camera is marked on the edge toward where it would be if the view turned round.
const STILLS = new URL('../assets/opening/', import.meta.url);
const INSET = 26;   // px from the screen's edge to the circle's centre

export class HerdMarks {
  constructor({ el, camera, animals }) {
    this.el = el; this.camera = camera; this.animals = animals; this.marks = new Map(); this.index = null;
    this.v = new THREE.Vector3(); this.cv = new THREE.Vector3();
    fetch(new URL('index.json', STILLS)).then(r => r.json()).then(j => { this.index = j.species || {}; }).catch(() => { this.index = {}; });
  }
  // group: the player's group (null: none); me: the player's own animal (skipped); h: the body's height (the marker aims at its middle)
  update(group, me, h = 0.5) {
    const keep = new Set();
    if (group && this.index && this.el) {
      const cam = this.camera, W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, inv = cam.matrixWorldInverse;
      for (const a of this.animals.list) {
        if (a.group !== group || a === me || a.culled) continue;
        const behind = this.cv.set(a.x, a.y + h, a.z).applyMatrix4(inv).z > 0;   // camera space: ahead is -z
        this.v.set(a.x, a.y + h, a.z).project(cam);
        let nx = this.v.x, ny = this.v.y;
        if (behind) { nx = -nx; ny = -ny; }
        if (!behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) continue;   // on screen
        let dx = nx, dy = -ny; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const t = Math.min((cx - INSET) / Math.max(Math.abs(dx), 1e-6), (cy - INSET) / Math.max(Math.abs(dy), 1e-6));
        let m = this.marks.get(a.id);
        if (!m) { m = this.make(a); this.marks.set(a.id, m); }
        m.style.transform = `translate(${(cx + dx * t).toFixed(0)}px, ${(cy + dy * t).toFixed(0)}px)`;
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
