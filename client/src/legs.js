import * as THREE from 'three';
import { liveRowOf, playerLiveRow } from './animalModels.js';
import { gaitParams, makeGait, gaitStep, writeRow, farTable, makeFar, farDrive, liveClip, footPoints } from './gait.js';

// The leg engine's bookkeeping for a drawn species (animals.js) or a player's body (groundControl.js): the pose texture
// rows, which instances run live and which take the baked cycles, the row writes and the upload, and the debug markers
// at the feet's plant points (?feet=1). The engine itself is gait.js (docs/movement.md "The legs").
//
// The live rows are the rows after the clips' frames in the species' clip texture (animalModels.js loadClips LIVE_ROWS;
// model.live): the pool takes rows 0 .. rows - 2 for the AI's instances, the player's body the last (playerLiveRow).
// LegsPool(model, rows, locoRow, { liveR, marks }): one per species. Each frame, per instance: row(a, d2) says whether
// the instance runs live (within liveR m of the eye, a row free; rows stick to an instance until it leaves) and
// write(...) poses it (the engine into its row, or the far drive into aClip); end() uploads the texture once.
const FOOT_COL = [0xd94a2a, 0xd94a2a, 0x2a6ad9, 0x2a6ad9];
export class FootMarks {
  constructor(parent, n, r = 0.025) {
    this.n = n; this.meshes = [];
    for (let i = 0; i < n * 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: FOOT_COL[i % 4], depthTest: false }));
      m.renderOrder = 30; m.visible = false; parent.add(m); this.meshes.push(m);
    }
  }
  set(k, st, size = 1) {
    const pts = footPoints(st);
    for (let i = 0; i < 4; i++) { const m = this.meshes[k * 4 + i]; if (!m) return; const f = pts[i]; m.position.set(f[0], f[1] + 0.01, f[2]); m.scale.setScalar(size * (f[3] ? 1 : 0.5)); m.visible = true; }
  }
  hide(k) { for (let i = 0; i < 4; i++) { const m = this.meshes[k * 4 + i]; if (m) m.visible = false; } }
}

export class LegsPool {
  constructor(model, rows, locoRow, { liveR = 60, marks = null } = {}) {
    this.model = model; this.skel = model.legs; this.live = model.live; rows = Math.min(rows, this.live.rows - 1); this.rows = rows;
    this.P = gaitParams(locoRow, this.skel);
    this.F = farTable(model.skin, this.P);
    this.liveR2 = liveR * liveR;
    this.owner = new Array(rows).fill(null); this.free = []; for (let r = rows - 1; r >= 0; r--) this.free.push(r);
    this.dirty = false; this.used = 0;
    this.marks = marks ? new FootMarks(marks, rows, 0.02 * Math.max(0.6, this.skel.h)) : null;
  }
  // the instance's live row this frame (-1: the far tier)
  row(a, d2, visible = true) {
    const want = visible && d2 < this.liveR2;
    let r = a.legRow ?? -1;
    if (want && r < 0 && this.free.length) { r = this.free.pop(); this.owner[r] = a; a.legRow = r; }
    else if (!want && r >= 0) { this.release(a); r = -1; }
    return r;
  }
  release(a) {
    const r = a.legRow ?? -1; if (r < 0) return;
    this.owner[r] = null; this.free.push(r); a.legRow = -1; if (this.marks) this.marks.hide(r);
    if (a.gs) { for (const F of a.gs.feet) F.has = false; }
  }
  // pose one instance: live (inp as gaitStep's) into its row, or the far drive; writes aClip at slot o and clears aBend
  write(a, o, dt, row, inp, clipOut, bendOut) {
    if (row >= 0) {
      const st = a.gs ||= makeGait();
      gaitStep(this.skel, this.P, st, inp, dt);
      writeRow(this.skel, st, this.live.data, liveRowOf(this.model, row)); this.dirty = true;
      liveClip(liveRowOf(this.model, row), clipOut, o);
      if (this.marks) this.marks.set(row, st, inp.size || 1);
    } else farDrive(a.far ||= makeFar(), this.F, inp.v, inp.pose, dt, clipOut, o);
    if (bendOut) { bendOut[o * 4] = 0; bendOut[o * 4 + 1] = 0; bendOut[o * 4 + 2] = 0; bendOut[o * 4 + 3] = 0; }
  }
  end() { if (this.dirty) { this.live.tex.needsUpdate = true; this.dirty = false; } }
}

// A single body on the engine (the player): the last live row of the species' clip texture.
export class LegsBody {
  constructor(model, locoRow, marks = null) {
    this.model = model; this.skel = model.legs; this.P = gaitParams(locoRow, this.skel);
    this.live = model.live; this.row = playerLiveRow(model); this.st = makeGait();
    this.marks = marks ? new FootMarks(marks, 1, 0.02 * Math.max(0.6, this.skel.h)) : null;
  }
  reset() { this.st = makeGait(); }
  write(inp, dt, clipOut, bendOut) {
    gaitStep(this.skel, this.P, this.st, inp, dt);
    writeRow(this.skel, this.st, this.live.data, this.row); this.live.tex.needsUpdate = true;
    liveClip(this.row, clipOut, 0);
    if (bendOut) bendOut.fill(0);
    if (this.marks) this.marks.set(0, this.st, inp.size || 1);
  }
}
