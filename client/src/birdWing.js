import * as THREE from 'three';

// Segmented bird wings and the one wing rig every bird is drawn with (Aaron, 2026-11-07: "Right now on basic models for
// birds, the wings are one card. They should really be two or three cards because that is how a wing is structured. Just
// that basic change + wing rigging that applies to all birds would dramatically improve their readability.")
//
// The wing: three cards hinged in a chain, the shape of a real wing, from the bird's body plan:
//   arm   (WING_L/R, 4/5)   the inner wing, the secondaries and their coverts, from the shoulder to the wrist;
//   hand  (HAND_L/R, 9/10)  the inner primaries, from the wrist out, the leading edge swept back;
//   tip   (TIP_L/R, 11/12)  the outer primaries, from the fingertip joint to the tip: one tapering card that closes to a
//                           rounded or a pointed tip, or, on a slotted wing, a fan of separate fingers with gaps between.
// The shape comes from three numbers and nothing per species: the semi-span and root chord the bird's old wing had (its
// cards or slabs, drawn to field-guide spans), and AVONET's Hand-Wing Index (Kipp's distance over wing length x 100;
// Tobias et al. 2022, CC BY 4.0; the fauna slot's hand_wing_index, else HWI below for the hand-built cast), which sets
// how pointed the wing is: the hand's share of the span, the leading edge's sweep, where the tip sits on the chord and the
// chord itself (a high index, a long narrow pointed wing: a falcon, a gull, a duck; a low one, a short round wing: a jay,
// a wren). A heavy bird's low-index wing is slotted (SLOT_KG, SLOT_HWI: the buteos, eagles, vultures, crows, owls,
// herons, cranes, pelicans, turkeys), its finger count rising with mass.
//
// The rig (WING_BODY below, in every animal program that has model.wing): the shoulder, the wrist and the fingertip joint,
// each a pivot (constants: the left side, mirrored), the tip a child of the hand and the hand a child of the arm. From the
// part rig's drive values alone (aAnim = phase, gait, pose; aAnim2.x the glide's bow where the template has it), so
// animals.js and the controls change nothing:
//   stroke   the arm beats sin(phase) * gait * amp.w; the hand follows a little behind (handLag) and further (handAmp), the
//            tip behind the hand again: the wave runs out along the wing.
//   upstroke (the beat rising) the wrist bends: the hand and tip sweep back in the wing's plane and the arm a little, so
//            the wing comes up half folded; on the downstroke it is spread full and the tip's primaries open forward.
//   glide    (gait 0, pose 0) a slight dihedral at the shoulder, the hands bowed by aAnim2.x.
//   fold     (pose to 1: perched, on the ground, swimming) a Z-fold against the body: the arm rolls its trailing edge down
//            and turns to hang from the shoulder, the hand doubles back at the wrist to lie along the flank toward the
//            tail, the upper sides outward; the folded cards lie at the body's side (a procedural body, which has no
//            folded wing of its own) or just inside it (a drawn mesh, whose own folded wing is then what shows). Nothing
//            shrinks: the same three cards, turned at their joints.
//   stoop    the soarers (flight meshes: their wings are the mesh's, spread for good) fold the other way: pose sweeps the
//            arm back at the shoulder and the hand further at the wrist (the old RIG_ARM's stoop).
// Every pose is a rotation at a joint, so the depth and planar shadow programs (the same body) follow the parts.

export const WING_PART = { ARM_L: 4, ARM_R: 5, HAND_L: 9, HAND_R: 10, TIP_L: 11, TIP_R: 12 };
const ALL_WING = new Set([4, 5, 9, 10, 11, 12]);

// Hand-Wing Index for the cast the client draws by hand (AVONET1_BirdLife, species level; pipeline/avonet.py). The fauna
// slots carry their own (fauna.json hand_wing_index).
export const HWI = {
  callipepla_californica: 26.2, oreortyx_pictus: 31.6, aphelocoma_californica: 14.1, cyanocitta_stelleri: 13.6,
  buteo_jamaicensis: 34.1, cathartes_aura: 26.9, corvus_corax: 39.8, melanerpes_formicivorus: 28.0, meleagris_gallopavo: 26.0,
  troglodytes_pacificus: 19.0, perisoreus_canadensis: 18.1, poecile_rufescens: 17.8, strix_varia: 29.6, megaceryle_alcyon: 33.6,
  haliaeetus_leucocephalus: 41.4, corvus_brachyrhynchos: 35.3, ardea_herodias: 36.6, mergus_merganser: 46.0, turdus_migratorius: 29.0,
  sturnus_vulgaris: 38.4, ixoreus_naevius: 33.4, junco_hyemalis: 21.9, regulus_satrapa: 23.6, empidonax_difficilis: 21.8,
  megascops_kennicottii: 27.1, aegolius_acadicus: 29.8, leuconotopicus_villosus: 25.3, pandion_haliaetus: 44.9,
  accipiter_striatus: 30.7, falco_columbarius: 48.9, larus_glaucescens: 53.0, larus_californicus: 58.4, larus_occidentalis: 51.0,
  anas_platyrhynchos: 50.7, dendragapus_fuliginosus: 39.9,
};
// and body mass (kg; AVONET Mass) for the slot rule
export const MASS = {
  callipepla_californica: 0.166, oreortyx_pictus: 0.233, aphelocoma_californica: 0.086, cyanocitta_stelleri: 0.128,
  buteo_jamaicensis: 1.1, cathartes_aura: 1.52, corvus_corax: 0.93, melanerpes_formicivorus: 0.08, meleagris_gallopavo: 5.8,
  troglodytes_pacificus: 0.009, perisoreus_canadensis: 0.072, poecile_rufescens: 0.009, strix_varia: 0.71, megaceryle_alcyon: 0.148,
  haliaeetus_leucocephalus: 4.7, corvus_brachyrhynchos: 0.45, ardea_herodias: 2.52, mergus_merganser: 1.45, turdus_migratorius: 0.079,
  sturnus_vulgaris: 0.077, ixoreus_naevius: 0.078, junco_hyemalis: 0.02, regulus_satrapa: 0.006, empidonax_difficilis: 0.011,
  megascops_kennicottii: 0.142, aegolius_acadicus: 0.1, leuconotopicus_villosus: 0.063, pandion_haliaetus: 1.48,
  accipiter_striatus: 0.131, falco_columbarius: 0.189, larus_glaucescens: 1.06, larus_californicus: 0.68, larus_occidentalis: 0.92,
  anas_platyrhynchos: 0.84, dendragapus_fuliginosus: 1.05,
};
// slotted: heavier than SLOT_KG with an index under SLOT_HWI, except the families whose wings are never fingered however
// they measure (the ducks and geese fly fast on pointed wings at 46-51; the rails and coots on short round ones)
const SLOT_KG = 0.33, SLOT_HWI = 47, NO_SLOT = new Set(['Anatidae', 'Rallidae']);
export const FAMILY = { mergus_merganser: 'Anatidae', anas_platyrhynchos: 'Anatidae' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pointedness = hwi => clamp(((Number.isFinite(hwi) ? hwi : 28) - 14) / 40, 0, 1);
const chordK = t => 1.12 - 0.36 * t;   // the chord's share of the span falls as the wing gets pointed (aspect ratio rises)

// The rig's constants by wing kind: the beat's wave and the wrist's flex; the fold's joint angles (radians: the arm's turn
// about the vertical and its roll, its in-plane turn, the hand's and the tip's in-plane turn at their joints)
const K_FLAP = { handLag: 0.65, handAmp: 1.2, tipLag: 0.5, tipAmp: 1.3, flex: 0.95, armFlex: 0.22, spread: 0.18, dihedral: 0.08, bowK: 1.0 };
const K_SOAR = { handLag: 0.5, handAmp: 1.15, tipLag: 0.4, tipAmp: 1.2, flex: 0.5, armFlex: 0.12, spread: 0.12, dihedral: 0.0, bowK: 1.0 };
// The Z-fold: the arm turned and rolled into the vertical plane at the body's side (its upper side outward), then in that
// plane the arm hangs from the shoulder a little behind the vertical (FOLD_Z[2], from forward toward down) and the hand
// doubles back at the wrist to point back along the flank, a little down (FOLD_Z[2] + FOLD_Z[3] from forward); the tip
// closes a little more. SQUEEZE: the arm's span at full fold (the secondaries stack as the forearm folds onto the
// humerus), so the wrist sits on the flank, not under the belly.
const FOLD_Z = [-Math.PI / 2, -Math.PI / 2, 1.75, 1.36, 0.05];
const SQUEEZE = 0.4;
const FOLD_STOOP = [1, 0, 0, 0.35, 0.2];                        // the soarers' stoop: [0] is replaced by the model's pose.w

// ---- reading the old wing ----------------------------------------------------------------------------------------
// From a geometry's wing parts (4, 5, 9, 10, 11, 12) on the left (x > 0): the semi-span from the shoulder, the root chord
// (the chord over the inner third), the leading edge's z at the root, and the colours: the upper side's commonest colour
// on the inner half (coverts) and outer part (flight feathers), and the under side's.
function readWing(geo, sh) {
  const pos = geo.getAttribute('position'), pa = geo.getAttribute('aPart'), col = geo.getAttribute('color');
  const idx = geo.index ? geo.index.array : null, nt = (idx ? idx.length : pos.count) / 3;
  let xmax = -Infinity;
  const tris = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < nt; t++) {
    const i0 = idx ? idx[3 * t] : 3 * t, i1 = idx ? idx[3 * t + 1] : 3 * t + 1, i2 = idx ? idx[3 * t + 2] : 3 * t + 2;
    if (!ALL_WING.has(Math.round(pa.getX(i0)))) continue;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    if (a.x + b.x + c.x <= 0) continue;
    n.subVectors(b, a).cross(c.clone().sub(a));
    const area = n.length() / 2; if (!(area > 0)) continue;
    n.normalize();
    xmax = Math.max(xmax, a.x, b.x, c.x);
    tris.push({ x: (a.x + b.x + c.x) / 3, ys: (a.y + b.y + c.y) / 3, zs: [a.z, b.z, c.z], ny: n.y, area, col: col ? [col.getX(i0), col.getY(i0), col.getZ(i0)] : [0.4, 0.35, 0.3] });
  }
  if (!tris.length) return null;
  const semi = xmax - sh[0];
  let zlo = Infinity, zhi = -Infinity;
  for (const t of tris) if (t.x < sh[0] + 0.4 * semi) for (const z of t.zs) { zlo = Math.min(zlo, z); zhi = Math.max(zhi, z); }
  if (!(zhi > zlo)) for (const t of tris) for (const z of t.zs) { zlo = Math.min(zlo, z); zhi = Math.max(zhi, z); }
  // the colours: per span bin, the outermost layer on each side (a procedural wing is two slabs, the upper colour over
  // the under colour; the upper slab's own bottom is hidden), then the commonest of those by area
  const NB = 10, top = new Array(NB).fill(null), bot = new Array(NB).fill(null);
  const bin = t => clamp(Math.floor((t.x - sh[0]) / semi * NB), 0, NB - 1);
  for (const t of tris) {
    t.y = t.ys; const k = bin(t);
    if (t.ny > 0.3) { if (!top[k] || t.y > top[k] + 1e-6) top[k] = t.y; }
    else if (t.ny < -0.3) { if (bot[k] === null || t.y < bot[k] - 1e-6) bot[k] = t.y; }
  }
  const tol = Math.max(1e-4, 0.002 * semi);
  const mode = sel => {
    const bins = new Map();
    for (const t of tris) if (sel(t)) { const k = t.col.map(v => Math.round(v * 40)).join(','); const e = bins.get(k) || { w: 0, c: t.col }; e.w += t.area; bins.set(k, e); }
    let best = null; for (const e of bins.values()) if (!best || e.w > best.w) best = e;
    return best ? best.c.slice() : null;
  };
  // within a third of the bin's thickness of its outer face: a raised patch (the woodpeckers' white) still counts as the
  // upper side with the feathers around it, the hidden face of a two-slab wing does not
  const tolK = k => (top[k] !== null && bot[k] !== null) ? Math.max(tol, 0.3 * (top[k] - bot[k])) : tol;
  const isTop = t => t.ny > 0.3 && t.y > top[bin(t)] - tolK(bin(t)), isBot = t => t.ny < -0.3 && t.y < bot[bin(t)] + tolK(bin(t));
  const cov = mode(t => isTop(t) && t.x < sh[0] + 0.5 * semi) || mode(isTop);
  const fl = mode(t => isTop(t) && t.x > sh[0] + 0.6 * semi) || cov;
  const und = mode(isBot) || cov;
  return { semi, chord: zhi - zlo, lead: zhi - sh[2], cov, fl, und };
}
// The body's half width about the shoulder (the folded wing lies against it): the widest non-wing vertex within a
// chord fore and aft of the shoulder and above the belly.
function bodyHalfWidth(geo, sh, chord) {
  const pos = geo.getAttribute('position'), pa = geo.getAttribute('aPart');
  let w = 0;
  for (let i = 0; i < pos.count; i++) {
    const p = Math.round(pa.getX(i)); if (ALL_WING.has(p) || p === 1 || p === 2 || p === 3 || p === 6) continue;
    const z = pos.getZ(i), y = pos.getY(i);
    if (Math.abs(z - sh[2]) < chord && y > sh[1] - 1.5 * chord) w = Math.max(w, Math.abs(pos.getX(i)));
  }
  return w || sh[0] * 1.3;
}

// ---- the wing's outline ------------------------------------------------------------------------------------------
// In the left wing's frame: x out along the span from the shoulder, z forward (the root's leading edge at +lead). Each
// part a list of strips [leading point, trailing point] (x, z pairs) from root to tip, triangulated strip by strip.
export function wingOutline({ semi, chord, lead = 0.25 * chord, hwi, mass = 0.1, family = null, slotted = null, detail = 1 }) {
  const t = pointedness(hwi);
  const slot = slotted ?? (mass > SLOT_KG && (Number.isFinite(hwi) ? hwi : 28) < SLOT_HWI && !NO_SLOT.has(family));
  const fingers = slot ? Math.round(4 + 2 * clamp(Math.log10(mass / SLOT_KG) / 1.1, 0, 1)) : 0;
  const armF = 0.5 - 0.12 * t, armL = armF * semi, handL = semi - armL;
  const tipU = slot ? 0.42 : 0.55 + 0.1 * t;          // where the tip part (the fingertip joint) begins along the hand
  const le0 = lead, te0 = lead - chord;
  const leW = le0 + 0.04 * chord, teW = te0 + 0.1 * chord, cw = leW - teW;   // the wrist: the secondaries shorten outward
  const sweep = cw * (0.12 + 0.6 * t);                // the hand's leading edge sweeps back, more on a pointed wing
  const w1 = 0.7 - 0.4 * t;                           // the hand's chord near the tip over the wrist's, before the rounding
  const mid = 0.55 * (1 - t) + 0.08 * t;              // where on the chord the tip sits (0 the leading edge)
  const uc = 0.5 + 0.3 * t;                           // where the rounding of the tip begins
  const leH = u => leW - sweep * Math.pow(u, 1.5);
  const fullH = u => cw * (1 - u * (1 - w1));
  const hand = u => {   // [le, te] at u along the hand
    const le = leH(u), full = fullH(u), m = le - full * mid;
    const f = u <= uc ? 1 : Math.sqrt(Math.max(0, 1 - ((u - uc) / (1 - uc)) ** 2));
    return [m + (le - m) * f, m - (m - (le - full)) * f];
  };
  const xs = u => armL + u * handL;
  const out = { arm: [], hand: [], tip: [], fingers, pivots: null, t, armL, handL };
  const na = detail > 1 ? 1 : 2;
  for (let k = 0; k <= na; k++) { const u = k / na; out.arm.push([[u * armL, le0 + (leW - le0) * u], [u * armL, te0 + (teW - te0) * u]]); }
  const nh = detail > 1 ? 1 : 3;
  for (let k = 0; k <= nh; k++) { const u = (k / nh) * tipU; const [le, te] = hand(u); out.hand.push([[xs(u), le], [xs(u), te]]); }
  const [leT, teT] = hand(tipU);
  if (!fingers) {
    const nt = detail > 1 ? 2 : 5;
    for (let k = 0; k <= nt; k++) { const u = tipU + (k / nt) * (1 - tipU); const [le, te] = hand(u); out.tip.push([[xs(u), le], [xs(u), te]]); }
  } else {
    // a slotted tip: the fingers fan out from the tip root's chord, each tapering to a blunt point; the middle ones longest
    const x0 = xs(tipU), L = (1 - tipU) * handL;
    out.tip = null; out.fan = [];
    for (let i = 0; i < fingers; i++) {
      const f0 = i / fingers, f1 = (i + 1) / fingers, fm = (f0 + f1) / 2;
      const zA = leT - (leT - teT) * f0, zB = leT - (leT - teT) * f1;
      const ang = 0.1 - 0.75 * fm;                            // fanned: the leading finger forward, the trailing ones swept back
      const len = L * (0.82 + 0.3 * Math.sin(Math.PI * Math.min(1, fm * 1.25)));
      const dx = Math.cos(ang) * len, dz = Math.sin(ang) * len, w = (zA - zB) * 0.38;
      const zm = (zA + zB) / 2;
      out.fan.push([[x0, zA - (zA - zB) * 0.08], [x0, zB + (zA - zB) * 0.08], [x0 + dx * 0.55, zm + dz * 0.55 - w * 0.75], [x0 + dx, zm + dz], [x0 + dx * 0.55, zm + dz * 0.55 + w * 0.75]]);
    }
  }
  out.pivots = { wrist: [armL, 0], tip: [xs(tipU), (leT + teT) / 2 + 0.25 * (leT - teT)] };
  out.covSplit = 0.42;   // the coverts' share of the arm's chord from the leading edge (the upper side's two rows)
  return out;
}

// ---- building it into a model ------------------------------------------------------------------------------------
const mixc = (a, b, f) => a.map((v, i) => v * (1 - f) + b[i] * f);
// The triangles of one side's wing as flat arrays: positions (model space), colours, part, pivot.
function wingTris(s, sh, o, cols, thick, P) {
  const out = { pos: [], col: [], part: [], piv: [] };
  const at = (x, z, y) => [s * (sh[0] + x), sh[1] + y, sh[2] + z];
  const tri = (A, B, C, col, part, piv) => {
    for (const q of (s > 0 ? [A, B, C] : [A, C, B])) { out.pos.push(...q); out.col.push(...col); out.part.push(part); out.piv.push(s * piv[0], piv[1], piv[2]); }
  };
  const shL = [sh[0], sh[1], sh[2]], wrL = [sh[0] + o.pivots.wrist[0], sh[1], sh[2] + o.pivots.wrist[1]], tpL = [sh[0] + o.pivots.tip[0], sh[1], sh[2] + o.pivots.tip[1]];
  const quad = (a0, b0, a1, b1, top, und, part, piv) => {   // a: leading, b: trailing; 0 inner, 1 outer
    const h = thick / 2;
    const A0 = at(a0[0], a0[1], h), B0 = at(b0[0], b0[1], h), A1 = at(a1[0], a1[1], h), B1 = at(b1[0], b1[1], h);
    tri(A0, B1, B0, top, part, piv); tri(A0, A1, B1, top, part, piv);
    const a0u = at(a0[0], a0[1], -h), b0u = at(b0[0], b0[1], -h), a1u = at(a1[0], a1[1], -h), b1u = at(b1[0], b1[1], -h);
    tri(a0u, b0u, b1u, und, part, piv); tri(a0u, b1u, a1u, und, part, piv);
  };
  const strips = (S, part, piv, topF, und, split = 0) => {
    for (let k = 0; k + 1 < S.length; k++) {
      const [a0, b0] = S[k], [a1, b1] = S[k + 1];
      if (split > 0) {   // two rows on the upper side: the coverts in front, the flight feathers behind
        const m0 = [a0[0] + (b0[0] - a0[0]) * split, a0[1] + (b0[1] - a0[1]) * split], m1 = [a1[0] + (b1[0] - a1[0]) * split, a1[1] + (b1[1] - a1[1]) * split];
        quad(a0, m0, a1, m1, cols.cov, und, part, piv); quad(m0, b0, m1, b1, topF, und, part, piv);
      } else quad(a0, b0, a1, b1, topF, und, part, piv);
    }
  };
  const armP = s > 0 ? P.ARM_L : P.ARM_R, handP = s > 0 ? P.HAND_L : P.HAND_R, tipP = s > 0 ? P.TIP_L : P.TIP_R;
  strips(o.arm, armP, shL, cols.sec, cols.und, o.covSplit);
  strips(o.hand, handP, wrL, cols.fl, cols.undF, 0.3);
  if (o.tip) strips(o.tip, tipP, tpL, cols.flT, cols.undF);
  if (o.fan) for (const F of o.fan) {   // a finger: a pentagon fanned from its root, two quads and a point
    const [r0, r1, m1, tip, m0] = F, h = thick / 2;
    const T = (p, y) => at(p[0], p[1], y);
    for (const [y, c, flip] of [[h, cols.flT, true], [-h, cols.undF, false]]) {
      const v = [T(r0, y), T(r1, y), T(m1, y), T(tip, y), T(m0, y)];
      const add = (A, B, C) => flip ? tri(A, C, B, c, tipP, tpL) : tri(A, B, C, c, tipP, tpL);
      add(v[0], v[1], v[2]); add(v[0], v[2], v[4]); add(v[4], v[2], v[3]);
    }
  }
  return out;
}

// Replace a model's wing parts in a geometry with the segmented wing: the old wing's triangles out (all of parts 4, 5,
// 9, 10, 11, 12), the new cards appended, every other attribute carried (aPartW 1, aColorB the colour, the rest 0).
// Returns a new non-indexed geometry.
function rebuild(geo, sh, o, cols, thick) {
  const L = wingTris(1, sh, o, cols, thick, WING_PART), R = wingTris(-1, sh, o, cols, thick, WING_PART);
  const pa = geo.getAttribute('aPart'), idx = geo.index ? geo.index.array : null;
  const n0 = idx ? idx.length : geo.getAttribute('position').count;
  const keep = [];
  for (let t = 0; t < n0; t += 3) {
    const i0 = idx ? idx[t] : t;
    if (ALL_WING.has(Math.round(pa.getX(i0)))) continue;
    keep.push(idx ? idx[t] : t, idx ? idx[t + 1] : t + 1, idx ? idx[t + 2] : t + 2);
  }
  const nNew = (L.pos.length + R.pos.length) / 3, N = keep.length + nNew;
  const g = new THREE.BufferGeometry();
  for (const [name, at] of Object.entries(geo.attributes)) {
    if (name === 'normal') continue;
    const k = at.itemSize, A = new Float32Array(N * k);
    const get = [at.getX, at.getY, at.getZ, at.getW];
    for (let i = 0; i < keep.length; i++) for (let c = 0; c < k; c++) A[i * k + c] = get[c].call(at, keep[i]);
    const put = (W, base) => {
      const m = W.pos.length / 3;
      for (let j = 0; j < m; j++) {
        const o2 = (base + j) * k;
        if (name === 'position') { A[o2] = W.pos[3 * j]; A[o2 + 1] = W.pos[3 * j + 1]; A[o2 + 2] = W.pos[3 * j + 2]; }
        else if (name === 'color' || name === 'aColorB') { A[o2] = W.col[3 * j]; A[o2 + 1] = W.col[3 * j + 1]; A[o2 + 2] = W.col[3 * j + 2]; if (k === 4) A[o2 + 3] = 1; }
        else if (name === 'aPart') A[o2] = W.part[j];
        else if (name === 'aPivot') { A[o2] = W.piv[3 * j]; A[o2 + 1] = W.piv[3 * j + 1]; A[o2 + 2] = W.piv[3 * j + 2]; }
        else if (name === 'aPartW') A[o2] = 1;
      }
    };
    put(L, keep.length); put(R, keep.length + L.pos.length / 3);
    g.setAttribute(name, new THREE.BufferAttribute(A, k));
  }
  g.computeVertexNormals();
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// The plan's colours: the old wing's, with the flight feathers a shade apart from the coverts so the rows read
function colours(w) {
  const cov = w.cov, fl = w.fl;
  const same = Math.abs(cov[0] - fl[0]) + Math.abs(cov[1] - fl[1]) + Math.abs(cov[2] - fl[2]) < 0.04;
  const flD = same ? fl.map(v => v * 0.72) : fl;
  return { cov, sec: mixc(cov, flD, 0.6), fl: flD, flT: flD.map(v => v * 0.88), und: w.und, undF: mixc(w.und, flD, 0.3) };
}

// Give a model the segmented wing and the wing rig. model: a procedural model ({ geometry }) or a drawn one ({ tiers }).
// opts: sh (the left shoulder, [x, y, z]; else the old arm's pivot), hwi, mass, mode 'fold' (a bird that perches: the Z-fold)
// or 'stoop' (a soarer's flight mesh: its own wings kept, only the rig), ownFold (a drawn mesh with its own folded wing:
// the folded cards tuck inside the body), plan (a model already winged, being re-winged: a stand-in's own index).
export function segmentWings(model, { sh = null, hwi = null, mass = null, family = null, mode = 'fold', keep = false, ownFold = false, wristAt = null, poseW = 1.4 } = {}) {
  const g0 = model.geometry || model.tiers?.[0]; if (!g0) return model;
  const pa = g0.getAttribute('aPart'), pv = g0.getAttribute('aPivot'); if (!pa) return model;
  if (model.wingPlan) { sh = model.wingPlan.sh; ownFold = model.wingPlan.ownFold; mode = model.wing?.mode || mode; poseW = model.wing?.fold?.[0] ?? poseW; }
  if (!sh) {   // the old arm's pivot (a procedural wing slab's hinge)
    for (let i = 0; i < pa.count; i++) { const p = Math.round(pa.getX(i)); if (p === 4 && pv) { sh = [pv.getX(i), pv.getY(i), pv.getZ(i)]; break; } }
    if (!sh) return model;
  }
  sh = sh.map(Number);
  if (keep) {   // a flight mesh: the rig on its own parts; the wrist from the file, the tip joint 70% of the way out
    const w = readWing(g0, sh); if (!w) return model;
    const wr = wristAt || [sh[0] + 0.45 * w.semi, sh[1], sh[2]];
    const tp = [wr[0] + 0.55 * (sh[0] + w.semi - wr[0]), wr[1], wr[2] - 0.15 * w.chord];
    model.wing = { mode, sh, wr, tp, k: { ...K_SOAR }, fold: [poseW, ...FOLD_STOOP.slice(1)], out: 0, key: '' };
    model.wing.key = wingKey(model.wing);
    return model;
  }
  let w = model.wingPlan;
  if (!w) {
    const r = readWing(g0, sh); if (!r) return model;
    w = model.wingPlan = { ...r, sh, hwiRef: hwi, ownFold };
  }
  const H = Number.isFinite(hwi) ? hwi : w.hwiRef;
  const t0 = pointedness(w.hwiRef), t1 = pointedness(H);
  const chord = w.chord * chordK(t1) / chordK(t0);
  const lead = w.lead * chord / w.chord;
  const M = Number.isFinite(mass) ? mass : 0.1;
  const thick = Math.max(0.0015, 0.035 * chord);
  const cols = colours(w);
  const build = detail => wingOutline({ semi: w.semi, chord, lead, hwi: H, mass: M, family, detail });
  const o = build(1);
  if (model.tiers) model.tiers = model.tiers.map((g, i) => rebuild(g, sh, i >= 2 ? build(2) : o, cols, thick));
  else { const g = rebuild(model.geometry, sh, o, cols, thick); model.geometry.dispose?.(); model.geometry = g; model.tris = g.attributes.position.count / 3; }
  if (model.tiers) model.tris = model.tiers.map(g => g.attributes.position.count / 3);
  const hw = bodyHalfWidth(model.geometry || model.tiers[0], sh, chord);
  const xFold = ownFold ? 0.8 * hw : hw + thick;
  const wr = [sh[0] + o.pivots.wrist[0], sh[1], sh[2] + o.pivots.wrist[1]];
  const tp = [sh[0] + o.pivots.tip[0], sh[1], sh[2] + o.pivots.tip[1]];
  model.wing = mode === 'stoop' ? { mode, sh, wr, tp, k: { ...K_SOAR }, fold: [poseW, ...FOLD_STOOP.slice(1)], out: 0, key: '', hwi: H, fingers: o.fingers }
    : { mode, sh, wr, tp, k: { ...K_FLAP }, fold: FOLD_Z.slice(), squeeze: SQUEEZE, out: xFold - sh[0], key: '', hwi: H, fingers: o.fingers,
        hide: !!ownFold, hc: [0, sh[1] - 0.4 * chord, sh[2] - 0.6 * chord] };
  model.wing.key = wingKey(model.wing);
  return model;
}
// A model scaled (animalModels.js scaledModel): its wing's lengths with it
export function scaleWing(m, s) {
  if (!m.wing && !m.wingPlan) return;
  if (m.wing) { const W = m.wing; m.wing = { ...W, sh: W.sh.map(v => v * s), wr: W.wr.map(v => v * s), tp: W.tp.map(v => v * s), out: W.out * s, hc: W.hc?.map(v => v * s) }; m.wing.key = wingKey(m.wing); }
  if (m.wingPlan) { const P = m.wingPlan; m.wingPlan = { ...P, semi: P.semi * s, chord: P.chord * s, lead: P.lead * s, sh: P.sh.map(v => v * s) }; }
}
const f4 = x => (+x || 0).toFixed(4), v3 = a => `vec3(${a.map(f4).join(', ')})`;
function wingKey(W) { return `wg${W.mode}${W.hide ? 'h' : ''}${[...W.sh, ...W.wr, ...W.tp, W.out, ...W.fold, ...(W.hc || [])].map(x => (+x).toFixed(4)).join(',')}`; }

// ---- the shader ----------------------------------------------------------------------------------------------------
// Declarations (after animRX/RY/RZ): the constants and wingRig(). bow: the glide's bow (aAnim2.x where declared).
export function wingDecl(model, { bow = false } = {}) {
  const W = model.wing; if (!W) return '';
  const k = W.k, F = W.fold;
  return `#define WING_RIG
const vec3 wing_sh = ${v3(W.sh)};
const vec3 wing_wr = ${v3(W.wr)};
const vec3 wing_tp = ${v3(W.tp)};
const vec4 wing_k0 = vec4(${[k.handLag, k.handAmp, k.tipLag, k.tipAmp].map(f4).join(', ')});
const vec4 wing_k1 = vec4(${[k.flex, k.armFlex, k.spread, k.dihedral].map(f4).join(', ')});
const vec4 wing_f0 = vec4(${[F[0], F[1], F[2], F[3]].map(f4).join(', ')});
const float wing_fTip = ${f4(F[4])};
const float wing_out = ${f4(W.out)};
const float wing_bowK = ${f4(k.bowK)};
const float wing_squeeze = ${f4(W.squeeze ?? 1)};
const vec4 wing_hide = vec4(${[...(W.hc || [0, 0, 0]), W.hide ? 1 : 0].map(f4).join(', ')});
${W.mode === 'stoop' ? '#define WING_STOOP\n' : ''}
// the wing's pose: part 4/5 the arm, 9/10 the hand, 11/12 the tip (left the first of each pair); R the rotation applied
vec3 wingRig(vec3 p, int part, float ampW, float poseW, out mat3 R) {
  float s = (part == 4 || part == 9 || part == 11) ? 1.0 : -1.0;
  vec3 sh = vec3(s * wing_sh.x, wing_sh.yz), wr = vec3(s * wing_wr.x, wing_wr.yz), tp = vec3(s * wing_tp.x, wing_tp.yz);
  float ph = aAnim.x, g = aAnim.y;
  float bow = ${bow ? 'aAnim2.x' : '0.0'} * wing_bowK;
#ifdef WING_STOOP
  float pf = aAnim.z, pz = 0.0;            // the stoop: pose sweeps back (may pass 1)
#else
  float pf = clamp(aAnim.z, 0.0, 1.0), pz = pf;
#endif
  float fl = 1.0 - pz;                     // flight's share (the Z-fold takes over as it folds)
  float A = ampW * g, cu = cos(ph);
  float up = g * max(cu, 0.0), dn = g * max(-cu, 0.0);
  float armE = (sin(ph) * A + wing_k1.w * (1.0 - g) - 0.4 * bow) * fl;
  float handE = ((sin(ph - wing_k0.x) * wing_k0.y - sin(ph)) * A - bow) * fl;
  float tipE = ((sin(ph - wing_k0.x - wing_k0.z) * wing_k0.w - sin(ph - wing_k0.x) * wing_k0.y) * A - 0.5 * bow) * fl;
#ifdef WING_STOOP
  mat3 Ra = animRY(s * pf * poseW) * animRZ(s * armE) * animRY(s * wing_k1.y * up);
  mat3 Rh = animRZ(s * handE) * animRY(s * (wing_k1.x * up + wing_f0.w * pf));
  mat3 Rt = animRZ(s * tipE) * animRY(s * (0.35 * wing_k1.x * up - wing_k1.z * dn + wing_fTip * pf));
#else
  mat3 Ra = animRY(s * wing_f0.x * pz) * animRX(wing_f0.y * pz) * animRZ(s * armE) * animRY(s * (wing_f0.z * pz + wing_k1.y * up * fl));
  mat3 Rh = animRZ(s * handE) * animRY(s * (wing_k1.x * up * fl + wing_f0.w * pz));
  mat3 Rt = animRZ(s * tipE) * animRY(s * ((0.35 * wing_k1.x * up - wing_k1.z * dn) * fl + wing_fTip * pz));
#endif
  R = Ra;
  if (part >= 11) {   // the primaries close up (toward the tip joint's chord line) folded, and a little on the upstroke
    p.z = tp.z + (p.z - tp.z) * (1.0 - 0.6 * pz - 0.15 * up * fl);
    p = tp + Rt * (p - tp); R = Ra * Rh * Rt;
  }
  if (part >= 9) { p = wr + Rh * (p - wr); if (part < 11) R = Ra * Rh; }
  float sq = mix(1.0, wing_squeeze, pz);   // the folded arm's secondaries stacked (the hand and tip ride in with the wrist)
  if (part >= 9) p.x -= s * (1.0 - sq) * (wing_wr.x - wing_sh.x);
  else p.x = sh.x + (p.x - sh.x) * sq;
  p = sh + Ra * (p - sh);
  p.x += s * wing_out * pz;
  // a drawn mesh's own folded wing: over the fold's last part the cards tuck into the body behind it
  float hk = wing_hide.w * smoothstep(0.6, 1.0, pz);
  if (hk > 0.0) p = mix(p, wing_hide.xyz + (p - wing_hide.xyz) * 0.25, hk);
  return p;
}
`;
}
// The body's override, after the generic part transform (ANIM_BODY): every wing vertex posed by wingRig
export const WING_BODY = `
#ifdef WING_RIG
if (animPart == 4 || animPart == 5 || (animPart >= 9 && animPart <= 12)) {
  transformed = wingRig(animPos, animPart, uAmp.w, uPose.w, animR);
  #ifdef ANIM_WEIGHTED
  transformed = mix(animPos, transformed, aPartW);
  #endif
}
#endif`;
