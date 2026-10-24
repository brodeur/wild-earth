import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uniforms as atmo } from './atmosphere.js';

// Procedural low-poly animals for the ambient population (animals.js). Each species is one merged,
// non-indexed geometry built from scaled spheres, boxes and cones, flat shaded, coloured per vertex.
// Every vertex carries the part it belongs to (aPart) and that part's pivot (aPivot); the vertex shader
// rotates each part about its pivot from one per-instance vec4, aAnim = (phase, gait, pose, flick):
//   legs     swing with sin(phase [+ pi for the B pair]) * gait, and squash toward the body with pose
//   tail     lifts with flick (a flick or a raise) and with pose (sitting squirrel, bedded deer)
//   head     dips with flick (pecking, grazing) and with pose
//   wings    flap with sin(phase) * gait and fold back along the body with pose (perched)
// Space: metres, +z forward, +y up, +x the animal's left; the origin is where it stands or perches.
// No skeleton and no animation clips: one draw call per species, all motion from four floats.

export const PART = { BODY: 0, LEG_A: 1, LEG_B: 2, TAIL: 3, WING_L: 4, WING_R: 5, HEAD: 6 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// One piece: a unit primitive scaled, rotated and placed, tagged with a part, a pivot and a colour.
function piece(geo, { color, part = PART.BODY, pivot = [0, 0, 0], pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  geo.dispose?.();
  g.deleteAttribute('uv');
  _m.compose(_v.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...scale));
  g.applyMatrix4(_m);
  g.computeVertexNormals();
  const n = g.attributes.position.count, c = new THREE.Color(color);
  const col = new Float32Array(n * 3), pa = new Float32Array(n), pv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; pa[i] = part; pv[i * 3] = pivot[0]; pv[i * 3 + 1] = pivot[1]; pv[i * 3 + 2] = pivot[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(pa, 1));
  g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
  return g;
}
const ball = (o, w = 6, h = 4) => piece(new THREE.SphereGeometry(1, w, h), o);       // 6x4: 36 triangles
const box = o => piece(new THREE.BoxGeometry(1, 1, 1), o);                           // 12 triangles
const cone = o => piece(new THREE.ConeGeometry(1, 1, 5, 1, true), o);               // 10 triangles, apex +y
const FWD = [Math.PI / 2, 0, 0];   // rotate a +y cone to point along +z

function finish(pieces, anim) {
  const geometry = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  return { geometry, tris: geometry.attributes.position.count / 3, ...anim };
}
const mirror = (fn) => [fn(1), fn(-1)];   // left (+x) and right (-x) copies

// Western gray squirrel, ~0.5 m nose to tail tip: grey back, white belly, a long plume of a tail that
// streams behind when running and curls up over the back when sitting (pose). Bounding gait: front
// pair (A) and hind pair (B) half a cycle apart.
export function buildSquirrel() {
  const grey = 0x5b5f66, frost = 0x767a81, belly = 0xcdc7ba, dark = 0x3e4045;
  const tail = { part: PART.TAIL, pivot: [0, 0.11, -0.11] };
  const p = [
    ball({ color: grey, pos: [0, 0.1, 0], scale: [0.058, 0.064, 0.125] }),
    ball({ color: belly, pos: [0, 0.074, 0.012], scale: [0.044, 0.04, 0.1] }),
    ball({ color: grey, part: PART.HEAD, pivot: [0, 0.12, 0.09], pos: [0, 0.142, 0.135], scale: [0.041, 0.042, 0.055] }),
    ...mirror(s => cone({ color: dark, part: PART.HEAD, pivot: [0, 0.12, 0.09], pos: [s * 0.022, 0.185, 0.122], scale: [0.012, 0.032, 0.012] })),
    // tail: one plume of three overlapping puffs, streaming back and a little up from the rump
    ball({ color: grey, ...tail, pos: [0, 0.125, -0.18], rot: [-0.4, 0, 0], scale: [0.05, 0.058, 0.105] }),
    ball({ color: frost, ...tail, pos: [0, 0.165, -0.27], rot: [-0.25, 0, 0], scale: [0.068, 0.08, 0.115] }, 7, 4),
    ball({ color: frost, ...tail, pos: [0, 0.2, -0.355], rot: [0.2, 0, 0], scale: [0.058, 0.068, 0.085] }),
    // legs: front (A), haunches (B)
    ...mirror(s => box({ color: grey, part: PART.LEG_A, pivot: [s * 0.03, 0.085, 0.075], pos: [s * 0.03, 0.05, 0.08], scale: [0.022, 0.075, 0.026] })),
    ...mirror(s => box({ color: grey, part: PART.LEG_B, pivot: [s * 0.038, 0.09, -0.06], pos: [s * 0.038, 0.048, -0.066], scale: [0.026, 0.085, 0.05] })),
  ];
  // amp: leg swing, tail flick, head dip, wing flap (rad). pose: leg squash factor, tail, head, wing fold.
  return finish(p, { amp: [0.9, 0.5, 0.35, 0], pose: [0.6, 1.15, -0.2, 0] });
}

// Acorn woodpecker, ~0.22 m: glossy black back, white belly, cream face, red cap, white wing patches
// that show only with the wings open. Origin at the feet, so a bird pitched nose-up clings by them.
export function buildWoodpecker() {
  const black = 0x131317, white = 0xebe7da, cream = 0xf0e3b2, red = 0xc41f2a;
  const head = { part: PART.HEAD, pivot: [0, 0.062, 0.05] };
  const p = [
    ball({ color: black, pos: [0, 0.045, 0], scale: [0.034, 0.036, 0.075] }),
    ball({ color: white, pos: [0, 0.03, 0.012], scale: [0.028, 0.029, 0.058] }),
    ball({ color: black, ...head, pos: [0, 0.075, 0.07], scale: [0.028, 0.03, 0.032] }),
    ball({ color: cream, ...head, pos: [0, 0.071, 0.093], scale: [0.021, 0.016, 0.014] }, 5, 3),
    ball({ color: red, ...head, pos: [0, 0.099, 0.064], scale: [0.02, 0.012, 0.026] }, 5, 3),
    cone({ color: 0x2c2c2c, ...head, pos: [0, 0.072, 0.115], rot: FWD, scale: [0.006, 0.03, 0.006] }),
    box({ color: black, part: PART.TAIL, pivot: [0, 0.04, -0.06], pos: [0, 0.033, -0.1], rot: [0.25, 0, 0], scale: [0.03, 0.006, 0.075] }),
    ...mirror(s => box({ color: black, part: s > 0 ? PART.WING_L : PART.WING_R, pivot: [s * 0.03, 0.06, 0], pos: [s * 0.115, 0.06, 0], scale: [0.17, 0.006, 0.06] })),
    ...mirror(s => box({ color: white, part: s > 0 ? PART.WING_L : PART.WING_R, pivot: [s * 0.03, 0.06, 0], pos: [s * 0.15, 0.0605, 0.002], scale: [0.04, 0.008, 0.045] })),
  ];
  return finish(p, { amp: [0, 0.25, 0.45, 1.1], pose: [1, 0, 0, 1.5] });
}

// Common raven, ~0.6 m, 1.25 m span: black throughout, heavy beak, wedge tail, long fingered wings
// (two slabs per wing). Soars with wings flat and flaps in short bursts; folds them when perched.
export function buildRaven() {
  const black = 0x121319, sheen = 0x1b1d26;
  const head = { part: PART.HEAD, pivot: [0, 0.11, 0.14] };
  const wing = s => ({ part: s > 0 ? PART.WING_L : PART.WING_R, pivot: [s * 0.06, 0.1, 0.02] });
  const p = [
    ball({ color: black, pos: [0, 0.09, 0], scale: [0.075, 0.075, 0.2] }),
    ball({ color: black, ...head, pos: [0, 0.13, 0.2], scale: [0.05, 0.052, 0.065] }),
    cone({ color: 0x1a1a1e, ...head, pos: [0, 0.124, 0.29], rot: FWD, scale: [0.018, 0.075, 0.016] }),
    box({ color: sheen, part: PART.TAIL, pivot: [0, 0.085, -0.17], pos: [0, 0.08, -0.27], scale: [0.11, 0.01, 0.2] }),
    ...mirror(s => box({ color: sheen, ...wing(s), pos: [s * 0.2, 0.1, 0], scale: [0.28, 0.014, 0.24] })),
    ...mirror(s => box({ color: black, ...wing(s), pos: [s * 0.48, 0.1, -0.025], scale: [0.29, 0.01, 0.17] })),
    ...mirror(s => box({ color: 0x202024, pos: [s * 0.03, 0.02, 0.02], scale: [0.014, 0.05, 0.014] })),
  ];
  return finish(p, { amp: [0, 0.2, 0.4, 0.75], pose: [1, -0.25, 0, 1.45] });
}

// Black-tailed deer, ~1 m at the shoulder: tan-grey coat, paler belly and rump, the black tail that
// names it, big ears. Diagonal walk: left fore and right hind (A) against right fore and left hind (B).
// pose beds it down (legs squashed into the body; animals.js lowers the body), flick lowers the head to browse.
export function buildDeer() {
  const coat = 0x86694b, pale = 0xbfa98a, rump = 0xddd2bb, leg = 0x6f5640, dark = 0x241a14;
  const head = { part: PART.HEAD, pivot: [0, 1.08, 0.42] };
  const p = [
    ball({ color: coat, pos: [0, 0.98, 0], scale: [0.21, 0.24, 0.55] }),
    ball({ color: pale, pos: [0, 0.86, 0.02], scale: [0.17, 0.15, 0.42] }),
    ball({ color: rump, pos: [0, 1.0, -0.5], scale: [0.13, 0.15, 0.07] }, 5, 3),
    box({ color: dark, part: PART.TAIL, pivot: [0, 1.08, -0.54], pos: [0, 0.99, -0.58], rot: [0.25, 0, 0], scale: [0.07, 0.18, 0.05] }),
    box({ color: coat, ...head, pos: [0, 1.25, 0.5], rot: [0.5, 0, 0], scale: [0.13, 0.42, 0.16] }),
    ball({ color: coat, ...head, pos: [0, 1.47, 0.67], rot: [0.5, 0, 0], scale: [0.085, 0.095, 0.15] }),
    box({ color: dark, ...head, pos: [0, 1.395, 0.79], scale: [0.05, 0.05, 0.06] }),
    ...mirror(s => box({ color: coat, ...head, pos: [s * 0.1, 1.58, 0.62], rot: [0, 0, s * 0.7], scale: [0.03, 0.15, 0.085] })),
    ...mirror(s => box({ color: leg, part: s > 0 ? PART.LEG_A : PART.LEG_B, pivot: [s * 0.11, 0.85, 0.38], pos: [s * 0.11, 0.425, 0.38], scale: [0.06, 0.85, 0.07] })),
    ...mirror(s => box({ color: leg, part: s > 0 ? PART.LEG_B : PART.LEG_A, pivot: [s * 0.12, 0.85, -0.38], pos: [s * 0.12, 0.425, -0.38], scale: [0.065, 0.85, 0.08] })),
  ];
  return finish(p, { amp: [0.3, 0.6, 1.5, 0], pose: [0.12, 0, -0.15, 0] });
}

// A wing slab hinged at `pivot` on side s (+1 left, -1 right), raised by `dihedral` (rad) about the
// body axis: its centre sits `dx` out along the raised span and `dz` fore (+) or aft (-) of the pivot.
// `under`: a second, slightly lower slab in another colour, so the wing reads one way from above
// (the raven's view) and another from below (the player looking up).
function wingSlab(s, pivot, { dx, dz = 0, len, chord, thick = 0.012, dihedral = 0, color, under = null }) {
  const part = s > 0 ? PART.WING_L : PART.WING_R, c = Math.cos(dihedral), sn = Math.sin(dihedral);
  const at = dy => [pivot[0] + s * dx * c - s * dy * sn, pivot[1] + dx * sn + dy * c, pivot[2] + dz];
  const out = [box({ color, part, pivot, pos: at(thick * 0.5), rot: [0, 0, s * dihedral], scale: [len, thick, chord] })];
  if (under) out.push(box({ color: under, part, pivot, pos: at(-thick * 0.5), rot: [0, 0, s * dihedral], scale: [len * 0.98, thick, chord * 0.98] }));
  return out;
}

// California quail, ~0.25 m: plump, blue-grey breast and brown back, scaled buff belly, black face
// and the forward-curling black topknot. Runs on quick legs; bursts off the ground on short round
// wings beating ~20 times a second, then sets them and glides in.
export function buildQuail() {
  const back = 0x6f604f, breast = 0x5f6874, belly = 0xb79c74, face = 0x18181a, wingc = 0x7a6853, cap = 0x6b4a32;
  const head = { part: PART.HEAD, pivot: [0, 0.11, 0.06] };
  const wp = s => [s * 0.04, 0.1, 0.0];
  const p = [
    ball({ color: back, pos: [0, 0.085, -0.005], scale: [0.062, 0.058, 0.1] }),
    ball({ color: breast, pos: [0, 0.08, 0.04], scale: [0.054, 0.055, 0.06] }),
    ball({ color: belly, pos: [0, 0.062, 0.0], scale: [0.05, 0.04, 0.075] }, 5, 3),
    ball({ color: cap, ...head, pos: [0, 0.135, 0.075], scale: [0.03, 0.03, 0.034] }, 5, 3),
    ball({ color: face, ...head, pos: [0, 0.128, 0.095], scale: [0.024, 0.02, 0.016] }, 5, 3),
    cone({ color: face, ...head, pos: [0, 0.185, 0.09], rot: [0.55, 0, 0], scale: [0.012, 0.05, 0.016] }),   // topknot
    cone({ color: 0x2a2a2a, ...head, pos: [0, 0.128, 0.112], rot: FWD, scale: [0.007, 0.016, 0.006] }),
    box({ color: back, part: PART.TAIL, pivot: [0, 0.09, -0.08], pos: [0, 0.09, -0.11], rot: [0.2, 0, 0], scale: [0.045, 0.01, 0.06] }),
    ...mirror(s => box({ color: 0x8a7560, part: s > 0 ? PART.LEG_A : PART.LEG_B, pivot: [s * 0.022, 0.05, 0.005], pos: [s * 0.022, 0.025, 0.005], scale: [0.01, 0.05, 0.012] })),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.085, len: 0.17, chord: 0.085, thick: 0.008, dihedral: 0.05, color: wingc, under: 0xb7a58b })).flat(),
  ];
  // wings fold hard (pose 1.5) on the ground, where they read as part of the body
  return finish(p, { amp: [0.9, 0.25, 0.5, 1.0], pose: [0.5, 0, 0, 1.5] });
}

// California scrub-jay, ~0.29 m: blue head, wings and long tail, grey-brown back, whitish below.
// Rowing flight on rounded wings with glides between beats and a swoop up to the perch.
export function buildJay() {
  const blue = 0x2f5fae, deep = 0x24498a, back = 0x8a8074, white = 0xd9d6cf;
  const head = { part: PART.HEAD, pivot: [0, 0.07, 0.06] };
  const wp = s => [s * 0.03, 0.07, 0.01];
  const p = [
    ball({ color: white, pos: [0, 0.055, 0], scale: [0.038, 0.04, 0.085] }),
    ball({ color: back, pos: [0, 0.07, -0.005], scale: [0.034, 0.025, 0.07] }, 5, 3),
    ball({ color: blue, ...head, pos: [0, 0.085, 0.08], scale: [0.03, 0.03, 0.035] }),
    cone({ color: 0x1b1b1f, ...head, pos: [0, 0.083, 0.12], rot: FWD, scale: [0.008, 0.03, 0.007] }),
    box({ color: deep, part: PART.TAIL, pivot: [0, 0.06, -0.07], pos: [0, 0.058, -0.14], rot: [0.12, 0, 0], scale: [0.045, 0.008, 0.14] }),
    ...mirror(s => box({ color: 0x2b2b2e, part: s > 0 ? PART.LEG_A : PART.LEG_B, pivot: [s * 0.016, 0.03, 0], pos: [s * 0.016, 0.015, 0], scale: [0.007, 0.03, 0.008] })),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.08, len: 0.16, chord: 0.075, thick: 0.007, dihedral: 0.04, color: blue, under: 0x8a8f99 })).flat(),
  ];
  return finish(p, { amp: [0.5, 0.35, 0.4, 1.0], pose: [0.6, 0.15, 0, 1.45] });
}

// Red-tailed hawk, ~0.55 m, 1.25 m span: dark brown above with paler mottled scapulars and the
// brick-red tail that names it; pale below with a dark belly band and dark leading edges.
// Soars on broad flat wings with a slight dihedral, folds them back to stoop.
export function buildHawk() {
  const brown = 0x5a3f2a, mottle = 0x8a6a4c, rufous = 0xb4502b, cream = 0xe3d7bf, band = 0x6a4c34;
  const head = { part: PART.HEAD, pivot: [0, 0.11, 0.15] };
  const wp = s => [s * 0.06, 0.11, 0.02];
  const p = [
    ball({ color: cream, pos: [0, 0.085, 0.01], scale: [0.078, 0.07, 0.19] }),
    ball({ color: brown, pos: [0, 0.11, -0.01], scale: [0.085, 0.065, 0.2] }),
    ball({ color: band, pos: [0, 0.07, 0.03], scale: [0.07, 0.035, 0.07] }, 5, 3),
    ball({ color: brown, ...head, pos: [0, 0.125, 0.19], scale: [0.05, 0.05, 0.06] }),
    cone({ color: 0x2a2622, ...head, pos: [0, 0.115, 0.255], rot: FWD, scale: [0.016, 0.04, 0.016] }),
    box({ color: rufous, part: PART.TAIL, pivot: [0, 0.1, -0.16], pos: [0, 0.1, -0.26], scale: [0.15, 0.012, 0.2] }),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.17, dz: 0.0, len: 0.3, chord: 0.3, thick: 0.014, dihedral: 0.07, color: mottle, under: cream })).flat(),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.47, dz: -0.01, len: 0.32, chord: 0.24, thick: 0.012, dihedral: 0.07, color: brown, under: 0xd8ccb6 })).flat(),
    ...mirror(s => box({ color: 0xc9b25a, pos: [s * 0.035, 0.03, 0.02], scale: [0.016, 0.05, 0.016] })),
  ];
  return finish(p, { amp: [0, 0.15, 0.3, 0.6], pose: [1, -0.2, 0, 1.4] });
}

// Turkey vulture, ~0.7 m, 1.75 m span: blackish-brown above with browner flight feathers, the
// two-toned underwing (black lining, silver flight feathers) and a small bare red head. Holds its
// long wings in a raised V (dihedral ~17 degrees) and teeters from side to side; almost never flaps.
export function buildVulture() {
  const black = 0x231d19, flight = 0x3f352d, silver = 0xa7a7a2, red = 0xb2392c;
  const head = { part: PART.HEAD, pivot: [0, 0.11, 0.16] };
  const wp = s => [s * 0.07, 0.11, 0.02], D = 0.3;
  const p = [
    ball({ color: black, pos: [0, 0.1, 0], scale: [0.09, 0.08, 0.26] }),
    ball({ color: red, ...head, pos: [0, 0.115, 0.27], scale: [0.032, 0.032, 0.05] }, 5, 3),
    cone({ color: 0xe8dccb, ...head, pos: [0, 0.11, 0.325], rot: FWD, scale: [0.012, 0.03, 0.012] }),
    box({ color: black, part: PART.TAIL, pivot: [0, 0.1, -0.2], pos: [0, 0.1, -0.33], scale: [0.15, 0.012, 0.28] }),
    // inner wing: black lining in front, flight feathers behind (silver underneath)
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.2, dz: 0.06, len: 0.36, chord: 0.14, thick: 0.014, dihedral: D, color: black, under: black })).flat(),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.2, dz: -0.09, len: 0.36, chord: 0.17, thick: 0.012, dihedral: D, color: flight, under: silver })).flat(),
    // outer wing and fingered tip
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.56, dz: -0.02, len: 0.38, chord: 0.26, thick: 0.012, dihedral: D, color: flight, under: silver })).flat(),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.82, dz: -0.04, len: 0.16, chord: 0.15, thick: 0.01, dihedral: D + 0.08, color: black, under: 0x8d8d88 })).flat(),
  ];
  return finish(p, { amp: [0, 0.15, 0.25, 0.45], pose: [1, 0, 0, 1.3] });
}

// Lambert, flat shaded, vertex coloured, patched by the atmosphere (sun, sky, cloud shadow, haze)
// like the trees and the player's raven, then chained with the part animation.
const ANIM_DECL = `
attribute float aPart; attribute vec3 aPivot; attribute vec4 aAnim;
mat3 animRX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 animRY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 animRZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }`;
const ANIM_BODY = `
vec3 animP = position - aPivot;
mat3 animR = mat3(1.0);
int animPart = int(aPart + 0.5);
float animPose = aAnim.z;
if (animPart == 1 || animPart == 2) {
  animP.y *= mix(1.0, uPose.x, animPose);
  animR = animRX(sin(aAnim.x + (animPart == 2 ? 3.14159 : 0.0)) * aAnim.y * uAmp.x);
} else if (animPart == 3) {
  animR = animRX(aAnim.w * uAmp.y + animPose * uPose.y);
} else if (animPart == 6) {
  animR = animRX(aAnim.w * uAmp.z + animPose * uPose.z);
} else if (animPart == 4 || animPart == 5) {
  float side = animPart == 4 ? 1.0 : -1.0;
  animP.x *= mix(1.0, 0.55, animPose);
  animR = animRY(side * animPose * uPose.w) * animRZ(side * sin(aAnim.x) * aAnim.y * uAmp.w);
}
vec3 transformed = animR * animP + aPivot;
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif`;

export function animalMaterial(atmosphere, model) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  atmosphere.patchLambert(m);
  const prev = m.onBeforeCompile;
  // The species' amplitudes and poses are baked in as constants, with a cache key per species: the
  // materials would otherwise share one program, and with it the first material's uniform values.
  const v4 = a => `vec4(${a.map(x => x.toFixed(4)).join(', ')})`;
  const consts = `\nconst vec4 uAmp = ${v4(model.amp)};\nconst vec4 uPose = ${v4(model.pose)};`;
  const key = `atmosphere-lambert|animal|${model.amp.join(',')}|${model.pose.join(',')}`;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + ANIM_DECL + consts)
      .replace('#include <begin_vertex>', ANIM_BODY);
  };
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
  return m;
}


// Depth-only twin of animalMaterial for the shadow scene (shadows.js renders it with colorWrite off):
// same part animation, so a flapping wing's shadow flaps.
export function animalDepthMaterial(model) {
  const v4 = a => `vec4(${a.map(x => x.toFixed(4)).join(', ')})`;
  return new THREE.ShaderMaterial({
    vertexShader: `${ANIM_DECL}
const vec4 uAmp = ${v4(model.amp)};
const vec4 uPose = ${v4(model.pose)};
void main() {
${ANIM_BODY}
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(transformed, 1.0);
}`,
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    colorWrite: false, side: THREE.DoubleSide,
  });
}

// Planar sun shadow for ground animals: the posed model squashed onto the plane through its feet
// along the sun direction, drawn as one translucent dark shape. Works at any height (the cascaded
// maps only re-render the near cascade per frame, and it switches off above ~110 m). The plane is
// lifted for bedded deer (pose lowers the body by `drop` m). Overlaps of body parts in the merged
// mesh are drawn once each: the stencil-free trick is depthWrite with depthFunc Less on a plane, so
// a second fragment at the same depth fails.
// nearFade: the caster is also in shadows.js cascade 0 (addCaster), so fade the planar shadow out
// where the animal's feet are inside that map (csmMatrix[0] maps them into [0, 1]; it maps everything
// far outside while the cascade is off), handing over across the outer 2-8 % of the box.
export function planarShadowMaterial(model, { drop = 0, opacity = 0.42, nearFade = false } = {}) {
  const v4 = a => `vec4(${a.map(x => x.toFixed(4)).join(', ')})`;
  return new THREE.ShaderMaterial({
    uniforms: { sunDir: atmo.sunDir, csmStrength: atmo.csmStrength, opacity: { value: opacity }, csm0: { value: atmo.csmMatrix.value[0] } },
    vertexShader: `${ANIM_DECL}
const vec4 uAmp = ${v4(model.amp)};
const vec4 uPose = ${v4(model.pose)};
uniform vec3 sunDir; uniform float csmStrength; uniform mat4 csm0;
varying float vFade;
void main() {
${ANIM_BODY}
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(transformed, 1.0);
  float ground = m[3].y + ${drop.toFixed(3)} * aAnim.z + 0.08;
  vec3 L = sunDir; L.y = max(L.y, 0.12);
  w.xyz -= L * (max(w.y - ground, 0.0) / L.y);
  w.y = ground;
  vFade = csmStrength * smoothstep(0.03, 0.15, sunDir.y);
  ${nearFade ? `vec3 c0 = (csm0 * vec4(m[3].xyz, 1.0)).xyz;
  float edge = min(min(c0.x, 1.0 - c0.x), min(min(c0.y, 1.0 - c0.y), min(c0.z, 1.0 - c0.z)));
  vFade *= 1.0 - smoothstep(0.02, 0.08, edge);` : ''}
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: `uniform float opacity; varying float vFade;
void main() { gl_FragColor = vec4(0.02, 0.025, 0.02, opacity * vFade); }`,
    transparent: true, depthWrite: true, depthFunc: THREE.LessDepth, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}
