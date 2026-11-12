import * as THREE from 'three';
import { liveRowOf, playerLiveRow } from './animalModels.js';
import { gaitParams, makeGait, gaitStep, writeRow, farTable, makeFar, farDrive, liveClip, footPoints, individualParams, seedOf, strideRate, mirrorClock, normSc, h32, SC_WRAP } from './gait.js';
import { F as NET } from './animalNet.js';   // the stream's fields: a mirror's `sc` is the host's stride clock

// The leg engine's bookkeeping for a drawn species (animals.js) or a player's body (groundControl.js): the pose texture
// rows, which instances run live and which take the baked cycles, the row writes and the upload, and the debug markers
// at the feet's plant points (?feet=1). The engine itself is gait.js (docs/movement.md "The legs").
//
// The live rows are the rows after the clips' frames in the species' clip texture (animalModels.js loadClips LIVE_ROWS;
// model.live): the pool takes rows 0 .. rows - 2 for the AI's instances, the player's body the last (playerLiveRow).
// LegsPool(model, rows, locoRow, { liveR, marks }): one per species. Each frame, per instance: row(a, d2) says whether
// the instance runs live (within liveR m of the eye, a row free; rows stick to an instance until it leaves) and
// write(...) poses it (the engine into its row, or the far drive into aClip); end() uploads the texture once.
// Each instance is its own individual (gait.js individualParams, from its id's seed and its drawn size: a.gp) and carries
// a stride clock a.sc (gait.js "Strides that are never the same"): the engine's on a live row, advanced at the stride's
// rate on the far tier, so a row newly taken goes on from it. The host streams it (animalNet.js FIELDS `sc`); on a
// mirror the engine locks to the host's, carried to this frame of the run between samples (mirrorClock), and the far
// tier takes it as it is. So a host and its mirrors draw the same strides.
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
    this.rel = this.skel.h / this.P.h;   // the model's withers against the species' hip height (an elk cow's model stands lower than the species' row): the individual's size is its drawn size times this
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
    const P = a.gp || (a.gp = individualParams(this.P, seedOf(a.id ?? 'body'), (a.size > 0 ? a.size : 1) * this.rel));
    const host = a.mirror && a.m1 ? mirrorClock(a.m1[NET.sc], a.mt, a.mdur, a.scRate || 0) : 0;   // the host's stride clock now (a mirror)
    if (row >= 0) {
      const st = a.gs ||= makeGait();
      if (!st.feet[0].has && a.sc >= 1) st.sc = a.sc;   // a row newly taken: the clock goes on from the far tier's
      inp.sc = host;
      gaitStep(this.skel, P, st, inp, dt);
      a.sc = st.sc; a.scRate = st.moving ? st.rate : 0;
      writeRow(this.skel, st, this.live.data, liveRowOf(this.model, row)); this.dirty = true;
      liveClip(liveRowOf(this.model, row), clipOut, o);
      if (this.marks) this.marks.set(row, st, inp.size || 1);
    } else {
      if (!(a.sc >= 1)) a.sc = 1 + h32(P.ind.seed, 0x5c, 0) * SC_WRAP;
      a.scRate = strideRate(P, a.sc, inp.v);
      a.sc = host >= 1 ? host : normSc(a.sc + a.scRate * dt);
      farDrive(a.far ||= makeFar(P), this.F, inp.v, inp.pose, dt, clipOut, o, inp.flick);
    }
    if (bendOut) { bendOut[o * 4] = 0; bendOut[o * 4 + 1] = 0; bendOut[o * 4 + 2] = 0; bendOut[o * 4 + 3] = 0; }
  }
  end() { if (this.dirty) { this.live.tex.needsUpdate = true; this.dirty = false; } }
}

// A single body on the engine (the player): the last live row of the species' clip texture.
export class LegsBody {
  constructor(model, locoRow, marks = null, seed = seedOf('body')) {   // seed: the body's individual (gait.js individualParams)
    this.model = model; this.skel = model.legs; const P0 = gaitParams(locoRow, this.skel); this.P = individualParams(P0, seed, this.skel.h / P0.h);
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
