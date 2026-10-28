import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
//
// Rig templates (the drawn meshes, built by tools/build_<species>.py; see RIG below). They extend PART and add a
// one-level parent chain and a second per-instance vec4, aAnim2, without changing what parts 0-6 do for the deer
// and the procedural models:
//   bird    BODY, LEG_A/B, TAIL, HEAD (head and neck, pivot at the base of the neck), WING_L/R (the arm, pivot
//           at the shoulder) and HAND_L/R (pivot at the wrist; child of the wing). Folded wings stay body geometry;
//           the flight wings are cards that collapse into the shoulder as pose goes to 1 (perched or on the ground).
//           The hand lags the arm through the stroke. aAnim2 = (wing bow, tail spread, -, colour variant).
//           The ground raven (RIG_GROUND; loadRavenGroundMesh) is the template on a standing mesh: its folded wings
//           are WING/HAND parts that never collapse, and aAnim2 = (wing flick, head yaw, hop, -): the flick lifts and
//           opens the folded wing at the shoulder with the hand following at the wrist, the head turns about the
//           base of the neck, and hop swings both legs together (0 alternates them: a walk).
//           The soarers (red-tailed hawk, turkey vulture) use the same template on a flight mesh: the wings are mesh,
//           spread for good (collapse 0), the arm turning at the shoulder and the hand at the wrist.
//   rodent  BODY (hindquarters), CHEST (pivot at the lumbar; flexes with the bound, rises to sit up), HEAD and
//           LEG_A (fore pair), both children of the chest, LEG_B (hind pair), TAIL and TAIL_TIP (child of the
//           tail; lags it for a wave, curls further on pose). aAnim2 = (leg splay for climbing, tail-tip lag, -, -).
//   quadruped  the deer's parts (BODY, LEG_A left fore + right hind, LEG_B, TAIL, HEAD), drawn by the plain path
//           (doe, buck, gray fox, coyote) or the rig path when it has a TAIL_TIP (mountain lion: the outer tail, child
//           of the tail). aAnim2.w is the gait selector (0 diagonal pairs: walk, trot; 1 fore pair against the hind
//           pair: bound, gallop), from the sign of each leg's pivot z. The buck adds its antlers (ANIM_ANTLER below):
//           aAnim2 = (antler growth, velvet, young forked-horn, gait).
// Every model also carries `drop`: how far animals.js lowers the body at pose 1 (bedded) so the folded legs meet the
// ground, and `poseMax` where the squash stops reading (the lion).
//
// The skin path (2026-10-27; the black-tailed deer, doe and buck). A model whose GLB keeps the source's skin
// (JOINTS_0 / WEIGHTS_0 and extras.skin, from tools/build_deer.py) and has a baked clip set beside it
// (<name>_clips.json + .bin from tools/bake_clips.py: one texture row per frame, three RGBA texels per joint, the 3x4
// matrix that carries a rest-pose vertex to its posed place) is drawn skinned instead of by the part rig: the vertex
// shader fetches its four joints' matrices at the instance's clip and frame (texelFetch, two frames blended) and, for a
// transition, a second clip's, from a third per-instance vec4, aClip = (clip, phase 0..1, blend-to clip + its phase in
// the fraction, blend weight). Still one InstancedMesh per species and one draw call; the lighting, self-lit and shadow
// paths are the part rig's (the same material code with the body swapped; the skin path declares only its own
// attributes, since the part rig's five plus the skin's three plus the instance matrix's four overran the 16 vertex
// attribute slots on Metal). The part rig's drive values (aAnim: phase,
// gait, pose, flick; aAnim2.w the gait selector) are turned into clips by driveClips below, on the CPU, so animals.js
// and groundControl.js change nothing in how they think; the model's drop is 0 (the bedded clip carries its own).

export const PART = { BODY: 0, LEG_A: 1, LEG_B: 2, TAIL: 3, WING_L: 4, WING_R: 5, HEAD: 6, CHEST: 7, TAIL_TIP: 8, HAND_L: 9, HAND_R: 10 };

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

// Acorn woodpecker, ~0.22 m, painted by region from the mesh brief (library/animals/drafts/melanerpes_formicivorus.md):
// glossy blue-black back, wings, tail and breast band; white belly, rump and wing patches; the clown face: a black
// mask round the bill base, lores and chin, ringed by the white forehead band that runs down in front of each eye
// into the pale yellow-cream throat; black sides of the head with the pale cream iris staring out of them; the red
// cap. The male's red reaches the white forehead; the female (female = true) has a black band between the forehead
// and a smaller red patch at the back of the crown. Seen at 3-10 m at the granaries, so the head is a third of the
// triangles. Origin at the feet, so a bird pitched nose-up clings by them.
export function buildWoodpecker(female = false) {
  const black = 0x15161c, sheen = 0x1d2230, white = 0xf2f0e8, cream = 0xefe2a6, red = 0xc8102e, iris = 0xf3efd8, bill = 0x111114;
  const head = { part: PART.HEAD, pivot: [0, 0.062, 0.05] };
  const p = [
    // body: black back and breast band, white belly, white rump above the tail
    ball({ color: black, pos: [0, 0.045, 0], scale: [0.034, 0.036, 0.075] }, 7, 5),
    ball({ color: white, pos: [0, 0.03, 0.006], scale: [0.029, 0.029, 0.06] }, 7, 4),
    ball({ color: black, pos: [0, 0.047, 0.05], scale: [0.027, 0.024, 0.022] }, 6, 4),   // breast band, under the throat
    ball({ color: white, pos: [0, 0.073, -0.052], scale: [0.019, 0.008, 0.021] }, 6, 3),  // rump
    // head: black sides and nape
    ball({ color: black, ...head, pos: [0, 0.075, 0.068], scale: [0.028, 0.03, 0.033] }, 9, 7),
    // red cap on the crown (the female's sits back, behind a black band)
    female
      ? ball({ color: red, ...head, pos: [0, 0.094, 0.05], scale: [0.019, 0.014, 0.02] }, 7, 4)
      : ball({ color: red, ...head, pos: [0, 0.093, 0.062], scale: [0.022, 0.016, 0.03] }, 8, 5),
    ...(female ? [ball({ color: black, ...head, pos: [0, 0.0975, 0.074], scale: [0.0205, 0.0128, 0.0115] }, 7, 4)] : []),
    // white forehead band above the bill, running down in front of each eye
    ball({ color: white, ...head, pos: [0, 0.0885, 0.088], scale: [0.019, 0.0098, 0.0115] }, 7, 4),
    ...mirror(s => ball({ color: white, ...head, pos: [s * 0.0165, 0.077, 0.09], rot: [0, 0, s * 0.15], scale: [0.0065, 0.016, 0.0085] }, 5, 4)),
    // pale yellow-cream throat and foreneck, joining the bands below the eyes
    ball({ color: cream, ...head, pos: [0, 0.06, 0.082], scale: [0.021, 0.015, 0.018] }, 7, 4),
    ...mirror(s => ball({ color: cream, ...head, pos: [s * 0.014, 0.066, 0.09], scale: [0.0075, 0.009, 0.008] }, 5, 3)),
    // black mask round the bill base, lores and chin
    ball({ color: bill, ...head, pos: [0, 0.071, 0.097], scale: [0.0125, 0.012, 0.01] }, 6, 4),
    ball({ color: bill, ...head, pos: [0, 0.062, 0.095], scale: [0.009, 0.0065, 0.008] }, 5, 3),
    // eyes: the cream iris round a black pupil, in the black of the face
    ...mirror(s => ball({ color: iris, ...head, pos: [s * 0.0252, 0.08, 0.077], scale: [0.0048, 0.0048, 0.0048] }, 6, 4)),
    ...mirror(s => ball({ color: bill, ...head, pos: [s * 0.0293, 0.08, 0.0775], scale: [0.0022, 0.0022, 0.0022] }, 5, 3)),
    // the straight chisel bill, about as long as the head
    cone({ color: bill, ...head, pos: [0, 0.071, 0.114], rot: FWD, scale: [0.0062, 0.032, 0.0058] }),
    box({ color: black, part: PART.TAIL, pivot: [0, 0.04, -0.06], pos: [0, 0.033, -0.1], rot: [0.25, 0, 0], scale: [0.03, 0.006, 0.075] }),
    // wings: blue-black with the white patch at the base of the primaries, on the upper and the under side
    ...mirror(s => box({ color: sheen, part: s > 0 ? PART.WING_L : PART.WING_R, pivot: [s * 0.03, 0.06, 0], pos: [s * 0.115, 0.06, 0], scale: [0.17, 0.006, 0.06] })),
    ...mirror(s => box({ color: white, part: s > 0 ? PART.WING_L : PART.WING_R, pivot: [s * 0.03, 0.06, 0], pos: [s * 0.15, 0.06, 0.002], scale: [0.04, 0.0085, 0.045] })),
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
  return finish(p, { amp: [0.3, 0.6, 1.5, 0], pose: [0.12, 0, -0.15, 0], drop: 0.6 });
}

// Black-tailed buck, the fallback for deer_buck.glb: buildDeer 5% larger with a darker forehead and a forked rack
// of cones on the head (the season does not change it; the drawn buck's antlers follow it).
export function buildDeerBuck() {
  const m = buildDeer(), g = m.geometry, k = 1.05;
  g.scale(k, k, k);
  const pv = g.attributes.aPivot; for (let i = 0; i < pv.count; i++) pv.setXYZ(i, pv.getX(i) * k, pv.getY(i) * k, pv.getZ(i) * k);
  const head = { part: PART.HEAD, pivot: [0, 1.08 * k, 0.42 * k] }, ant = 0x8a7a63;
  const rack = [
    box({ color: 0x3b2c22, ...head, pos: [0, 1.6, 0.74], rot: [0.5, 0, 0], scale: [0.1, 0.04, 0.12] }),
    ...mirror(s => cone({ color: ant, ...head, pos: [s * 0.1, 1.79, 0.66], rot: [-0.35, 0, -s * 0.45], scale: [0.018, 0.34, 0.018] })),
    ...mirror(s => cone({ color: ant, ...head, pos: [s * 0.19, 1.95, 0.6], rot: [0.2, 0, -s * 0.25], scale: [0.014, 0.2, 0.014] })),
    ...mirror(s => cone({ color: ant, ...head, pos: [s * 0.2, 1.93, 0.5], rot: [-0.7, 0, -s * 0.3], scale: [0.014, 0.2, 0.014] })),
  ];
  const geometry = mergeGeometries([g, ...rack]);
  g.dispose(); for (const r of rack) r.dispose();
  return { ...m, geometry, tris: geometry.attributes.position.count / 3, drop: 0.6 * k };
}

// A generic low-poly quadruped for the fallbacks of the drawn canids and the lion (no hole when a GLB fails to load,
// and ?fox=proc etc. for A/B): body, chest and rump, belly, neck and head with ears and muzzle (HEAD, pivot at the
// withers), a tail (TAIL, pivot at the rump), four legs in the diagonal pairs. W withers, L head and body (nose to
// tail root), leg the leg pivots' height (the leg length), bw and bh the body's half width and depth, tail length,
// tailR its radius, tailDown its droop (rad), head length, ear height, c colours (back, flank, belly, leg, dark, tip).
function quadruped({ W, L, leg, bw, bh, tail, tailR, tailDown, head, ear, earW = 0.6, muzzle = 0.5, c, anim }) {
  const yb = W - bh, zf = L * 0.27, zh = -L * 0.26;
  const hp = { part: PART.HEAD, pivot: [0, yb + bh * 0.3, zf + L * 0.06] };
  const hy = W + head * 0.35, hz = zf + L * 0.2;
  const tp = { part: PART.TAIL, pivot: [0, yb + bh * 0.45, -L * 0.42] };
  const tdz = -Math.cos(tailDown) * tail, tdy = -Math.sin(tailDown) * tail;
  const p = [
    ball({ color: c.flank, pos: [0, yb, 0], scale: [bw, bh, L * 0.33] }),
    ball({ color: c.back, pos: [0, yb + bh * 0.25, -0.01 * L], scale: [bw * 0.85, bh * 0.8, L * 0.31] }),
    ball({ color: c.flank, pos: [0, yb + bh * 0.05, zf * 0.85], scale: [bw * 1.05, bh * 1.05, L * 0.17] }),
    ball({ color: c.back, pos: [0, yb + bh * 0.05, zh * 0.95], scale: [bw, bh, L * 0.16] }),
    ball({ color: c.belly, pos: [0, yb - bh * 0.45, 0.02 * L], scale: [bw * 0.75, bh * 0.55, L * 0.26] }, 5, 3),
    // neck and head
    box({ color: c.flank, ...hp, pos: [0, (yb + hy) / 2, (zf + hz) / 2], rot: [0.75, 0, 0], scale: [bw * 1.1, Math.hypot(hy - yb, hz - zf) * 1.1, bw * 1.2] }),
    ball({ color: c.back, ...hp, pos: [0, hy, hz], scale: [bw * 0.75, head * 0.32, head * 0.42] }),
    box({ color: c.belly, ...hp, pos: [0, hy - head * 0.1, hz + head * (0.3 + muzzle * 0.3)], scale: [bw * 0.45, head * 0.24, head * muzzle] }),
    box({ color: c.dark, ...hp, pos: [0, hy - head * 0.02, hz + head * (0.3 + muzzle * 0.8)], scale: [bw * 0.25, head * 0.12, head * 0.08] }),
    ...mirror(s => cone({ color: c.dark, ...hp, pos: [s * bw * 0.45, hy + head * 0.25 + ear * 0.5, hz - head * 0.1], rot: [-0.15, 0, -s * 0.25], scale: [ear * 0.3 * earW, ear, ear * 0.18] })),
    // tail: two pieces, the tip darker
    box({ color: c.back, ...tp, pos: [0, tp.pivot[1] + tdy * 0.35, tp.pivot[2] + tdz * 0.35], rot: [-(Math.PI / 2 + tailDown), 0, 0], scale: [tailR * 2, tail * 0.7, tailR * 2] }),
    box({ color: c.tip, ...tp, pos: [0, tp.pivot[1] + tdy * 0.85, tp.pivot[2] + tdz * 0.85], rot: [-(Math.PI / 2 + tailDown), 0, 0], scale: [tailR * 1.6, tail * 0.32, tailR * 1.6] }),
    // legs: left fore + right hind (A), right fore + left hind (B)
    // (each reaches up into the body to the leg pivot plus half the body's depth, so no gap shows under the belly)
    ...mirror(s => box({ color: c.leg, part: s > 0 ? PART.LEG_A : PART.LEG_B, pivot: [s * bw * 0.6, leg, zf], pos: [s * bw * 0.6, (leg + bh) / 2, zf], scale: [bw * 0.32, leg + bh, bw * 0.36] })),
    ...mirror(s => box({ color: c.leg, part: s > 0 ? PART.LEG_B : PART.LEG_A, pivot: [s * bw * 0.6, leg, zh], pos: [s * bw * 0.6, (leg + bh) / 2, zh], scale: [bw * 0.36, leg + bh, bw * 0.42] })),
  ];
  return finish(p, { ...anim, drop: anim.drop ?? leg * 0.9 });   // bedded: the belly on the ground (the squashed legs sink)
}
// Gray fox, 0.37 m at the shoulder, 0.6 m head and body, 0.36 m tail: grizzled grey back, rust flanks and legs,
// white throat and belly, the black-tipped tail (brief palette).
export const buildFox = () => quadruped({ W: 0.37, L: 0.6, leg: 0.22, bw: 0.065, bh: 0.075, tail: 0.36, tailR: 0.04, tailDown: 0.55, head: 0.15, ear: 0.07,
  c: { back: 0x7c7d7f, flank: 0x8e7a66, belly: 0xe8e2d6, leg: 0xa2683e, dark: 0x1a1817, tip: 0x1d1b1a },
  anim: { amp: [0.5, 0.35, 1.0, 0], pose: [0.3, -0.25, 0.2, 0] } });
// Coyote, 0.58 m at the shoulder, 0.85 m head and body, 0.4 m tail hung low: grizzled tan back, buff flanks, rufous
// legs, pale belly, black tail tip.
export const buildCoyote = () => quadruped({ W: 0.58, L: 0.85, leg: 0.36, bw: 0.085, bh: 0.11, tail: 0.4, tailR: 0.045, tailDown: 1.0, head: 0.21, ear: 0.1,
  c: { back: 0x7e6650, flank: 0xa48563, belly: 0xe2d9c9, leg: 0xb27c4e, dark: 0x4b3b2e, tip: 0x1f1a17 },
  anim: { amp: [0.45, 0.3, 1.1, 0], pose: [0.3, -0.35, 0.2, 0] } });
// Mountain lion, 0.72 m at the shoulder, 1.07 m head and body, a long tail hanging in a J with a dark tip: plain
// tawny coat, darker back, cream belly; small round head.
export const buildCougar = () => quadruped({ W: 0.72, L: 1.07, leg: 0.3, bw: 0.13, bh: 0.19, tail: 0.75, tailR: 0.04, tailDown: 1.2, head: 0.2, ear: 0.05, earW: 1.2, muzzle: 0.3,
  c: { back: 0x8b6a4b, flank: 0xa37e58, belly: 0xe4dccd, leg: 0xa37e58, dark: 0x2a221d, tip: 0x2a221d },
  anim: { amp: [0.35, 0.3, 0.6, 0], pose: [0.35, 0.6, 0.3, 0], poseMax: 0.6 } });

// Brush rabbit, 0.33 m head and body, crouched 0.17 m at the back: grey-brown, short dark-rimmed ears, a small tail
// pale beneath. Bounds fore pair (A) against the hind pair (B); pose raises the head and ears (sitting up).
export function buildRabbit() {
  const back = 0x7a6553, flank = 0x8a7663, nape = 0x7b5a40, belly = 0xc6bfb2, feet = 0x9a856c, rim = 0x3a2e25;
  const head = { part: PART.HEAD, pivot: [0, 0.12, 0.06] };
  const p = [
    ball({ color: back, pos: [0, 0.1, -0.02], scale: [0.065, 0.07, 0.12] }),
    ball({ color: flank, pos: [0, 0.085, -0.05], scale: [0.07, 0.065, 0.08] }),
    ball({ color: belly, pos: [0, 0.06, 0.01], scale: [0.045, 0.035, 0.08] }, 5, 3),
    ball({ color: nape, ...head, pos: [0, 0.15, 0.1], scale: [0.04, 0.042, 0.055] }),
    ...mirror(s => box({ color: nape, ...head, pos: [s * 0.018, 0.21, 0.08], rot: [-0.3, 0, -s * 0.15], scale: [0.016, 0.06, 0.008] })),
    ...mirror(s => box({ color: rim, ...head, pos: [s * 0.018, 0.24, 0.07], rot: [-0.3, 0, -s * 0.15], scale: [0.014, 0.012, 0.009] })),
    ball({ color: belly, part: PART.TAIL, pivot: [0, 0.09, -0.12], pos: [0, 0.095, -0.14], scale: [0.018, 0.018, 0.015] }, 5, 3),
    ...mirror(s => box({ color: feet, part: PART.LEG_A, pivot: [s * 0.025, 0.06, 0.06], pos: [s * 0.025, 0.03, 0.065], scale: [0.014, 0.06, 0.016] })),
    ...mirror(s => box({ color: feet, part: PART.LEG_B, pivot: [s * 0.045, 0.07, -0.06], pos: [s * 0.045, 0.012, -0.03], scale: [0.02, 0.024, 0.08] })),
  ];
  return finish(p, { amp: [0.8, 0.6, 0.35, 0], pose: [1, 0.3, -0.35, 0] });
}
// Black-tailed jackrabbit, 0.55 m head and body, sitting 0.29 m at the back and 0.43 m to the ear tips: a lean
// grizzled grey-buff hare on long legs, very long ears with black tips, a black-topped tail, creamy belly. The fallback
// for jackrabbit.glb (?jackrabbit=proc); bounds fore pair (A) against hind pair (B), pose sits it up (alert).
export function buildJackrabbit() {
  const back = 0x8a7d6b, flank = 0x9d907d, nape = 0x9c8160, belly = 0xe0d9cb, leg = 0xc6b79d, ear = 0x8f8576, tip = 0x1c1814;
  const head = { part: PART.HEAD, pivot: [0, 0.26, 0.06] };
  const p = [
    ball({ color: back, pos: [0, 0.19, -0.04], scale: [0.072, 0.1, 0.15] }),
    ball({ color: flank, pos: [0, 0.13, -0.1], scale: [0.085, 0.09, 0.1] }),
    ball({ color: belly, pos: [0, 0.14, 0.03], scale: [0.05, 0.06, 0.09] }, 5, 3),
    ball({ color: nape, pos: [0, 0.21, 0.06], scale: [0.055, 0.075, 0.065] }),
    ball({ color: nape, ...head, pos: [0, 0.28, 0.1], scale: [0.045, 0.05, 0.07] }),
    ...mirror(s => box({ color: ear, ...head, pos: [s * 0.022, 0.37, 0.07], rot: [-0.2, 0, -s * 0.12], scale: [0.03, 0.12, 0.008] })),
    ...mirror(s => box({ color: tip, ...head, pos: [s * 0.029, 0.43, 0.058], rot: [-0.2, 0, -s * 0.12], scale: [0.026, 0.03, 0.009] })),
    box({ color: tip, part: PART.TAIL, pivot: [0, 0.13, -0.18], pos: [0, 0.14, -0.2], rot: [0.5, 0, 0], scale: [0.03, 0.03, 0.06] }),
    ...mirror(s => box({ color: leg, part: PART.LEG_A, pivot: [s * 0.03, 0.15, 0.08], pos: [s * 0.03, 0.075, 0.085], scale: [0.016, 0.15, 0.018] })),
    ...mirror(s => box({ color: leg, part: PART.LEG_B, pivot: [s * 0.06, 0.11, -0.08], pos: [s * 0.06, 0.012, -0.05], scale: [0.026, 0.024, 0.13] })),
  ];
  return finish(p, { amp: [0.95, 0.4, 0.8, 0], pose: [1, 0.2, -0.35, 0] });
}
// California vole, 0.17 m with the tail: a stocky cylinder of grizzled brown, blue-grey belly, a short dark tail.
export function buildVole() {
  const back = 0x6b5a48, belly = 0x8f8b86, feet = 0xa39b91, tail = 0x3d342d;
  const head = { part: PART.HEAD, pivot: [0, 0.03, 0.03] };
  const p = [
    ball({ color: back, pos: [0, 0.027, -0.01], scale: [0.026, 0.026, 0.055] }),
    ball({ color: belly, pos: [0, 0.018, -0.005], scale: [0.02, 0.014, 0.045] }, 5, 3),
    ball({ color: back, ...head, pos: [0, 0.03, 0.05], scale: [0.021, 0.02, 0.028] }),
    box({ color: tail, pos: [0, 0.02, -0.085], rot: [0.15, 0, 0], scale: [0.006, 0.006, 0.045] }),
    ...mirror(s => box({ color: feet, part: PART.LEG_A, pivot: [s * 0.012, 0.012, 0.025], pos: [s * 0.012, 0.006, 0.027], scale: [0.006, 0.012, 0.008] })),
    ...mirror(s => box({ color: feet, part: PART.LEG_B, pivot: [s * 0.015, 0.012, -0.035], pos: [s * 0.015, 0.006, -0.03], scale: [0.007, 0.012, 0.014] })),
  ];
  return finish(p, { amp: [0.9, 0, 0.35, 0], pose: [1, 0, -0.3, 0] });
}

// Wild turkey, the fallback for turkey.glb (?turkey=proc): a tom 1.1 m bill to tail, 0.95 m to the top of the head,
// dark bronze body on long pink-grey legs, the folded wedge tail, a thin upright neck to a small bare blue head with
// a red wattle, and broad wing slabs (barred) that fold away on the ground (pose) and open for the heavy flush.
export function buildTurkey() {
  const bronze = 0x3b2a1c, sheen = 0x4a3524, rump = 0x2a1e15, tail = 0x4f3a27, leg = 0x9c8580, skin = 0x8fa7c4, red = 0xb02a22, bar = 0xcfc6b4;
  const head = { part: PART.HEAD, pivot: [0, 0.66, 0.16] };
  const wp = s => [s * 0.08, 0.63, 0.13];
  const p = [
    ball({ color: bronze, pos: [0, 0.53, 0], scale: [0.17, 0.17, 0.3] }, 8, 5),
    ball({ color: sheen, pos: [0, 0.6, -0.04], scale: [0.15, 0.1, 0.26] }, 7, 4),
    ball({ color: rump, pos: [0, 0.5, -0.24], scale: [0.11, 0.1, 0.1] }, 6, 4),
    ball({ color: bar, pos: [0, 0.56, -0.02], scale: [0.172, 0.05, 0.12] }, 6, 3),   // the barred secondaries on the folded wing
    box({ color: tail, part: PART.TAIL, pivot: [0, 0.48, -0.25], pos: [0, 0.44, -0.4], rot: [0.35, 0, 0], scale: [0.16, 0.025, 0.3] }),
    // neck and head
    box({ color: bronze, ...head, pos: [0, 0.74, 0.21], rot: [-0.25, 0, 0], scale: [0.06, 0.2, 0.06] }),
    ball({ color: skin, ...head, pos: [0, 0.86, 0.25], scale: [0.04, 0.045, 0.055] }, 6, 4),
    ball({ color: red, ...head, pos: [0, 0.81, 0.27], scale: [0.025, 0.04, 0.025] }, 5, 3),
    cone({ color: 0xc9b99a, ...head, pos: [0, 0.855, 0.31], rot: FWD, scale: [0.014, 0.04, 0.012] }),
    box({ color: 0x15110d, pos: [0, 0.48, 0.2], rot: [0.3, 0, 0], scale: [0.015, 0.14, 0.015] }),   // beard
    ...mirror(s => box({ color: leg, part: s > 0 ? PART.LEG_A : PART.LEG_B, pivot: [s * 0.07, 0.37, 0], pos: [s * 0.07, 0.185, 0.01], scale: [0.025, 0.37, 0.03] })),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.32, len: 0.55, chord: 0.3, thick: 0.02, dihedral: 0.05, color: sheen, under: bar })).flat(),
  ];
  // wings fold hard on the ground (pose 1.5); the head dips far to peck (amp.z) on the long neck
  return finish(p, { amp: [0.55, 0.25, 0.9, 1.0], pose: [1, 0, 0, 1.5] });
}
// California ground squirrel, the fallback for ground_squirrel.glb (?gsquirrel=proc): 0.26 m head and body on short
// legs, mottled grey-brown with a pale mantle and a buff belly, a flattened tail two thirds of the body held out
// behind. pose sits it bolt upright (the sentinel): legs squashed, tail laid back, head kept level.
export function buildGroundSquirrel() {
  const back = 0x6e5e4c, mantle = 0x9a948a, belly = 0xb9a582, tail = 0x7a6b5a, fringe = 0xa9a092, dark = 0x2d241c;
  const head = { part: PART.HEAD, pivot: [0, 0.075, 0.08] }, tp = { part: PART.TAIL, pivot: [0, 0.066, -0.095] };
  const p = [
    ball({ color: back, pos: [0, 0.075, -0.01], scale: [0.052, 0.05, 0.12] }),
    ball({ color: mantle, pos: [0, 0.085, 0.05], scale: [0.048, 0.042, 0.05] }),
    ball({ color: belly, pos: [0, 0.052, 0.0], scale: [0.04, 0.03, 0.09] }, 5, 3),
    ball({ color: back, ...head, pos: [0, 0.09, 0.115], scale: [0.032, 0.032, 0.042] }),
    ball({ color: 0xd8d0c0, ...head, pos: [0, 0.098, 0.13], scale: [0.03, 0.012, 0.022] }, 5, 3),   // the pale eye ring
    ...mirror(s => box({ color: dark, ...head, pos: [s * 0.016, 0.122, 0.1], scale: [0.012, 0.014, 0.006] })),
    ball({ color: tail, ...tp, pos: [0, 0.085, -0.17], rot: [-0.3, 0, 0], scale: [0.03, 0.02, 0.085] }),
    ball({ color: fringe, ...tp, pos: [0, 0.083, -0.18], rot: [-0.3, 0, 0], scale: [0.036, 0.012, 0.08] }, 5, 3),
    ...mirror(s => box({ color: back, part: PART.LEG_A, pivot: [s * 0.023, 0.035, 0.05], pos: [s * 0.023, 0.018, 0.052], scale: [0.014, 0.036, 0.016] })),
    ...mirror(s => box({ color: back, part: PART.LEG_B, pivot: [s * 0.03, 0.03, -0.07], pos: [s * 0.03, 0.012, -0.055], scale: [0.018, 0.024, 0.05] })),
  ];
  return finish(p, { amp: [0.9, 0.5, 0.35, 0], pose: [0.4, -0.3, -0.3, 0] });
}
// Western fence lizard, the fallback for fence_lizard.glb (?lizard=proc): 0.18 m snout to tail tip, grey-brown with
// dark blotches, the blue belly patches, legs splayed. The plain path: legs swing, pose lifts the head (a push-up)
// or lowers it (basking); the reptile template's wave and push-up need the drawn mesh.
export function buildLizard() {
  const back = 0x5e5245, blotch = 0x2c2620, belly = 0x8a8a84, blue = 0x2a4fa0, leg = 0x6a5c4c;
  const head = { part: PART.HEAD, pivot: [0, 0.022, 0.024] }, tp = { part: PART.TAIL, pivot: [0, 0.015, -0.024] };
  const p = [
    ball({ color: back, pos: [0, 0.017, 0.0], scale: [0.011, 0.008, 0.03] }),
    ball({ color: blotch, pos: [0, 0.022, -0.004], scale: [0.006, 0.004, 0.022] }, 5, 3),
    ...mirror(s => ball({ color: blue, pos: [s * 0.008, 0.012, 0.0], scale: [0.004, 0.004, 0.016] }, 5, 3)),
    ball({ color: belly, pos: [0, 0.011, 0.0], scale: [0.009, 0.004, 0.024] }, 5, 3),
    ball({ color: back, ...head, pos: [0, 0.02, 0.038], scale: [0.0085, 0.006, 0.013] }),
    cone({ color: back, ...tp, pos: [0, 0.008, -0.08], rot: [-Math.PI / 2 - 0.08, 0, 0], scale: [0.006, 0.11, 0.006] }),
    ...mirror(s => box({ color: leg, part: s > 0 ? PART.LEG_A : PART.LEG_B, pivot: [s * 0.009, 0.014, 0.017], pos: [s * 0.017, 0.007, 0.019], rot: [0, 0, s * 0.9], scale: [0.004, 0.02, 0.004] })),
    ...mirror(s => box({ color: leg, part: s > 0 ? PART.LEG_B : PART.LEG_A, pivot: [s * 0.01, 0.012, -0.017], pos: [s * 0.019, 0.006, -0.02], rot: [0, 0, s * 0.9], scale: [0.0045, 0.022, 0.0045] })),
  ];
  return finish(p, { amp: [0.6, 0.35, 0.4, 0], pose: [1, 0, -0.3, 0] });
}

// The drawn black-tailed deer (animals.js; buildDeer above is the fallback): "Deer" by Quaternius
// (Ultimate Animated Animal Pack, poly.pizza/m/T6Cs7tmMHJ), CC0, rebuilt by tools/build_deer.py (source,
// licence and the Blender command are in its header): rest pose baked, 0.95 m at the withers, ears 1.3x,
// recoloured with buildDeer's palette (darker brow, small dark eye, tail black on top and at the tip,
// white rump patch), three tiers (lod0 2096, lod1 1000, lod2 ~300 triangles). Each vertex carries the
// procedural rig's part, its pivot (the joint) and the skin weight of that part (aPartW), so the shader
// poses it like buildDeer with the same amp and pose.
// drop 0.49: the doe stands 0.95 m at the withers (belly 0.525 m, leg pivots 0.56-0.60 m), so the procedural deer's
// 0.6 m sank the belly 5-8 cm; 0.49 sets the squashed legs on the ground with the belly just above it.
const DEER = { amp: [0.3, 0.6, 1.5, 0], pose: [0.12, 0, -0.15, 0] };
export async function loadDeerMesh() {
  return loadTiers(new URL('../assets/deer.glb', import.meta.url), { ...DEER, drop: 0.49, gait: true }, { skin: true });
}
// The buck (tools/build_deer.py --buck): the doe 5% larger with a thicker neck and procedural antlers (per-vertex
// _ANTLER 0 off the antler, else 0.05 + 0.95 x the way from burr to tip; _TINE 0 beam, 1 the rear second fork,
// 2 brow tine, 3 burr ring; extras.antler_burr the left burr, the right mirrors in x). The shader (ANIM_ANTLER)
// grows, thickens (velvet) and hides them per instance from aAnim2 (growth, velvet, young); animals.js antlers()
// sets those from the date. The base of the rear second fork (hidden on a young forked-horn) is found here.
export async function loadDeerBuckMesh() {
  const m = await loadTiers(new URL('../assets/deer_buck.glb', import.meta.url), { ...DEER, drop: 0.515, gait: true }, { skin: true });
  const g = m.tiers[0], P = g.attributes.position, A = g.getAttribute('aAntler'), T = g.getAttribute('aTine');
  if (A && T && m.extras.antler_burr) {
    let best = Infinity, fork = null;
    for (let i = 0; i < P.count; i++) if (Math.round(T.getX(i)) === 1 && P.getX(i) > 0 && A.getX(i) < best) { best = A.getX(i); fork = [P.getX(i), P.getY(i), P.getZ(i)]; }
    m.antler = { burr: m.extras.antler_burr, fork: fork || m.extras.antler_burr };
  }
  return m;
}
// Antler calendar (month as a float, 1 = 1 January; brief odocoileus_hemionus_buck.md): each buck casts between
// 1 January and 1 March (u1), regrows in velvet from late April (u2; full length by July) and sheds the velvet late
// August to early September (u3); hard from then to the next cast. So hard in fall and early winter, antlerless in
// late winter and spring, velvet in summer. Returns aAnim2.x and .y for the buck: { growth, velvet }.
export const SEASON_MONTH = { winter: 1.5, spring: 4.5, summer: 7.5, fall: 10.5 };
export function antlerState(month, u1 = 0.5, u2 = 0.5, u3 = 0.5) {
  const cast = 1 + 2 * u1, grow = 4.6 + 0.4 * u2, full = grow + 2.6, strip = 8.6 + 0.4 * u3;
  if (month >= strip || month < cast) return { growth: 1, velvet: 0 };
  if (month < grow) return { growth: 0, velvet: 0 };
  return { growth: 0.15 + 0.85 * Math.min(1, Math.max(0, (month - grow) / (full - grow))), velvet: 1 };
}

// Gray fox and coyote (tools/build_fox.py, build_coyote.py; Quaternius CC0): the quadruped template on the plain
// path like the doe. drop: leg pivots x (1 - pose.x), the squashed legs on the ground (fox belly 0.21 m, coyote 0.31 m).
export const loadFoxMesh = () => loadTiers(new URL('../assets/fox.glb', import.meta.url),
  { amp: [0.5, 0.35, 1.0, 0], pose: [0.3, -0.25, 0.2, 0], drop: 0.17, gait: true });
export const loadCoyoteMesh = () => loadTiers(new URL('../assets/coyote.glb', import.meta.url),
  { amp: [0.45, 0.3, 1.1, 0], pose: [0.3, -0.35, 0.2, 0], drop: 0.26, gait: true });

// A built GLB (tools/build_*.py): meshes lod0-lod2 with COLOR_0 and the custom attributes _PART, _PARTW, _PIVOT
// (and _COLORB, a second colour set for a variant), the rig's parent pivots in the file's extras.rig.
// keepNormals: keep the file's normals (a textured tier drawn smooth); maps: each tier's base-colour texture or null.
// skin: load the clip set named by extras.skin.clips (a sibling <clips>.json and .bin) and draw the model skinned (see the
// header); a missing or failed clip set leaves the part rig in charge, with a warning.
async function loadTiers(url, model, { keepNormals = false, skin = false } = {}) {
  const gltf = await new GLTFLoader().loadAsync(url.href);
  const rename = { _part: 'aPart', _partw: 'aPartW', _pivot: 'aPivot', _colorb: 'aColorB', _antler: 'aAntler', _tine: 'aTine', _blue: 'aBlue' };
  const maps = [];
  const tiers = ['lod0', 'lod1', 'lod2'].map(n => {
    const o = gltf.scene.getObjectByName(n), g = o.geometry;
    for (const [a, b] of Object.entries(rename)) { const at = g.getAttribute(a); if (at) { g.setAttribute(b, at); g.deleteAttribute(a); } }
    if (!keepNormals || !g.getAttribute('normal')) g.computeVertexNormals();
    maps.push(o.material?.map || null);
    return g;
  });
  const extras = gltf.parser.json.extras || {};
  const out = { tiers, maps, tris: tiers.map(g => g.index.count / 3), weighted: true, extras, ...model };
  if (skin && extras.skin?.clips && tiers.every(g => g.getAttribute('skinIndex') && g.getAttribute('skinWeight'))) {
    try { out.skin = await loadClips(new URL(`${extras.skin.clips}`, url), extras.skin); out.drop = 0; }
    catch (e) { console.warn(`${url.pathname}: clip set ${extras.skin.clips} failed to load; the part rig draws it`, e); }
  }
  return out;
}
// The clip set (tools/bake_clips.py): the index and the texture, shared by every model of the skeleton (the buck reuses the
// doe's; its translation column is scaled by its own extras.skin.scale over the texture's). The index's clips become a GLSL
// constant table (first frame, frame count, loop) in clip order; `clip` maps names to indices for the drive.
const clipCache = new Map();
async function loadClips(base, skinExtras) {
  const key = base.href;
  if (!clipCache.has(key)) clipCache.set(key, (async () => {
    const [index, bin] = await Promise.all([fetch(`${base.href}.json`).then(r => { if (!r.ok) throw new Error(`${r.status} ${base.href}.json`); return r.json(); }),
      fetch(`${base.href}.bin`).then(r => { if (!r.ok) throw new Error(`${r.status} ${base.href}.bin`); return r.arrayBuffer(); })]);
    const half = index.format !== 'rgba32f';
    const data = half ? new Uint16Array(bin) : new Float32Array(bin);
    if (data.length !== index.width * index.height * 4) throw new Error(`clip texture ${base.href}.bin: ${data.length} values for ${index.width}x${index.height}`);
    const tex = new THREE.DataTexture(data, index.width, index.height, THREE.RGBAFormat, half ? THREE.HalfFloatType : THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true; tex.name = `${base.pathname} bones`;
    const names = Object.keys(index.clips), clip = Object.fromEntries(names.map((n, i) => [n, i]));
    const table = names.map(n => index.clips[n]);
    // the head chain (neck, head, ears: contiguous in the skin order) and the neck base, for the player's look (PLAYER_HEAD)
    const headIdx = index.joints.map((n, i) => /^(Neck|Head|Ear)/.test(n) ? i : -1).filter(i => i >= 0);
    const head = headIdx.length ? { first: headIdx[0], last: headIdx[headIdx.length - 1], pivot: index.joint_rest?.[headIdx[0]] || [0, 0, 0] } : null;
    return { index, tex, names, clip, table, joints: index.joints, head, texScale: index.scale, key: `${index.width}x${index.height}|${table.map(c => `${c.first},${c.count},${c.loop ? 1 : 0}`).join(';')}` };
  })());
  const shared = await clipCache.get(key);
  return { ...shared, ratio: (skinExtras.scale || shared.texScale) / shared.texScale };
}

// Rig constants per drawn species (radians unless noted). Pivots come from the GLB (extras.rig) so a rebuild
// that moves a joint needs no change here. Keys (GLSL const float rig_<key>):
//   spine, spinePhase  chest flex with the bound (amplitude, phase against the fore legs)
//   sit                chest pitch up as pose goes to 1;  foreFold  fore legs folding to the chest on pose
//   tipLag, tipWave, tipCurl   tail tip: lagged flick (aAnim2.y), wave with the gait, extra curl on pose
//   abduct             legs splayed sideways by aAnim2.x (climbing)
//   bob                head nod with each step (twice per stride)
//   handLag, handAmp   hand phase lag behind the arm and its stroke relative to the arm's;  bow  hands and arms
//                      droop by aAnim2.x (a set-wing glide);  spread  tail fans out by aAnim2.y (x scale)
//   collapse           1: the wing cards shrink into the shoulder as pose goes to 1
//   ground             1: RIG_GROUND (the ground raven): aAnim2 = (wing flick, head yaw, hop, -);  flickLift,
//                      flickOpen  the folded wing's lift (about the body axis) and swing out (about the vertical)
//                      at the shoulder for a flick of 1 (the hand follows by bow, negative: further than the arm)
const RIG = {
  // California scrub-jay (tools/build_scrubjay.py): hops on the ground, perches, short rowing flights
  jay: { amp: [0.35, 0.35, 0.4, 1.0], pose: [1, 0.15, 0, 0.2],
    k: { handLag: 0.7, handAmp: 0.8, bow: 0.25, spread: 0.6, collapse: 1, bob: 0 } },
  // California quail (tools/build_quail.py): walks with a nod, whirrs up and glides on bowed wings
  quail: { amp: [0.9, 0.25, 0.5, 1.0], pose: [1, 0, 0, 0.2],
    k: { handLag: 0.6, handAmp: 0.7, bow: 0.35, spread: 0.5, collapse: 1, bob: 0.12 } },
  // Western gray squirrel (tools/build_squirrel.py): bounds, sits up, flicks and curls the plume, climbs
  squirrel: { amp: [0.9, 0.5, 0.35, 0], pose: [1, 0.95, 0.75, 0],
    k: { spine: 0.28, spinePhase: 1.2, sit: 0.7, foreFold: 1.1, tipLag: 0.7, tipWave: 0.25, tipCurl: 1.1, abduct: 0.9 } },
  // Steller's jay (tools/build_stellersjay.py): the scrub-jay's hops, perches and rowing flights, in the conifers
  stjay: { amp: [0.35, 0.35, 0.4, 1.0], pose: [1, 0.15, 0, 0.2],
    k: { handLag: 0.7, handAmp: 0.8, bow: 0.25, spread: 0.6, collapse: 1, bob: 0 } },
  // The soarers are flight meshes, wings spread and never folded (collapse 0); amp and pose as buildHawk and
  // buildVulture, so the client's soaring, flapping and stooping drive them unchanged. The arm turns at the
  // shoulder, the hand at the wrist a little behind it (handLag) and a little further (handAmp); aAnim2.x bows
  // both (the red-tail's hands droop as it tucks into a stoop), aAnim2.y closes (negative) or fans the tail.
  // Red-tailed hawk (tools/build_redtail.py): soars on broad flat wings, flaps in short bursts, sweeps them back to stoop
  hawk: { amp: [0, 0.15, 0.3, 0.6], pose: [1, -0.2, 0, 1.4],
    k: { handLag: 0.5, handAmp: 1.15, bow: 0.6, spread: 0.6, collapse: 0, bob: 0 } },
  // Turkey vulture (tools/build_vulture.py): circles and glides on its raised V, teeters, hardly ever flaps
  vulture: { amp: [0, 0.15, 0.25, 0.45], pose: [1, 0, 0, 1.3],
    k: { handLag: 0.5, handAmp: 1.15, bow: 0.4, spread: 0.5, collapse: 0, bob: 0 } },
  // Mountain lion (tools/build_cougar.py): the quadruped template with the outer tail as TAIL_TIP (child of the tail),
  // so it takes the rig path. aAnim2.y twitches the tip (stalking, crouched), the tip waves a little with the stride
  // and curls up on pose. pose squashes the legs for the stalk and the crouch; past ~0.6 the elbows sink, so
  // animals.js keeps it there (poseMax). drop: leg pivots 0.29 m x (1 - 0.35). The brief's tail pose (-0.2) is +0.6
  // here: the J of the tail reaches the ground standing, so as the body drops the tail swings back and the tip curls
  // up (tipCurl) to keep it out of the ground.
  lion: { amp: [0.35, 0.3, 0.6, 0], pose: [0.35, 0.6, 0.3, 0], drop: 0.19, poseMax: 0.6, gait: true,
    k: { tipLag: 0.55, tipWave: 0.25, tipCurl: 0.6, bob: 0.04, foreFold: 0, abduct: 0, spine: 0, sit: 0 } },
  // Brush rabbit (tools/build_rabbit.py): template R with a chest and a stub tail (no tip). Bounds fore pair against
  // hind pair, the chest flexing; pose sits it up on its haunches (alert), the head kept about level; flick nibbles
  // and flashes the white tail.
  rabbit: { amp: [0.8, 0.6, 0.35, 0], pose: [1, 0.3, 0.4, 0],
    k: { spine: 0.16, spinePhase: 1.2, sit: 0.55, foreFold: 0.5, tipLag: 0, tipWave: 0, tipCurl: 0, abduct: 0 } },
  // Black-tailed jackrabbit (tools/build_jackrabbit.py): the brush rabbit's template on a hare (chest, no tail tip),
  // with a longer reach in the bound (amp.x) and more chest flex; flick dips the head much further (amp.z: the nose
  // to the grass from the raised fore body when feeding).
  // animals.js also drives pose below 0 for the day rest: the chest pitched down, the forelegs reaching forward and
  // the head tilted back up, a low hunch with the ears still up (there is no ears part to lay them flat).
  jackrabbit: { amp: [0.95, 0.4, 0.85, 0], pose: [1, 0.2, 0.4, 0],
    k: { spine: 0.26, spinePhase: 1.2, sit: 0.5, foreFold: 0.5, tipLag: 0, tipWave: 0, tipCurl: 0, abduct: 0 } },
  // California vole (tools/build_vole.py): template R without a tail part (too short; it stays with the body).
  // Scurries in quick small steps; pose lifts the chest to sit up and eat; flick dips the head to clip grass.
  vole: { amp: [0.9, 0, 0.35, 0], pose: [1, 0, 0.45, 0],
    k: { spine: 0.15, spinePhase: 1.2, sit: 0.6, foreFold: 0.8, tipLag: 0, tipWave: 0, tipCurl: 0, abduct: 0 } },
  // Common raven on the ground (tools/build_raven_ground.py): walks (legs alternate) and hops (together, aAnim2.z),
  // pecks and caches (flick dips the head, the tail lifts a little), turns its head (aAnim2.y) and flicks its folded
  // wings (aAnim2.x). The folded wings never collapse (collapse 0) and gait never flaps them (amp.w 0); pose does
  // nothing (the ambient ravens keep pose 1 on the ground for the flying model's folded wings).
  ravenGround: { amp: [0.55, 0.3, 0.6, 0], pose: [1, 0, 0, 0],
    k: { handLag: 0, handAmp: 0, bow: -0.6, spread: 0, collapse: 0, bob: 0.1, ground: 1, flickLift: 0.42, flickOpen: 0.38 } },
  // Wild turkey (tools/build_turkey.py): the quail's template and constants on a bird ten times its weight. Walks with
  // the head nodding (bob) on the long neck, pecks far down (amp.z), scratches (a leg kicked back); the flush is a
  // short heavy flight on the wing cards, which collapse into the shoulder on the ground (collapse 1). aAnim2 = (wing
  // bow, tail spread, -, hen): the hen's colour set (_COLORB) at 0.8 scale (animals.js).
  turkey: { amp: [0.55, 0.25, 0.9, 1.0], pose: [1, 0, 0, 0.2],
    k: { handLag: 0.6, handAmp: 0.7, bow: 0.35, spread: 0.5, collapse: 1, bob: 0.12 } },
  // California ground squirrel (tools/build_ground_squirrel.py): the rodent template with the build lane's sit-up
  // constants (the entry's rig_notes): pose 1 is the sentinel bolt upright (sit 1.25 rad, the fore legs folded to the
  // chest, the tail laid out behind on the ground, the head pitched back to level), the rump down by drop.
  groundSquirrel: { amp: [0.9, 0.5, 0.35, 0], pose: [0.4, -0.3, 1.05, 0], drop: 0.016,
    k: { spine: 0.2, spinePhase: 1.2, sit: 1.25, foreFold: 2.2, tipLag: 0.6, tipWave: 0.25, tipCurl: 0.2, abduct: 0 } },
  // Western fence lizard (tools/build_fence_lizard.py): the reptile template (RIG_REPTILE below). amp.x the legs'
  // swing; k: wave (m of lateral offset at the tail tip at a sprint), waveK (rad of phase along the body), envS (the
  // wave's envelope at the snout), pushPitch (rad, the fore body about the hips at the top of a push-up), baskAbduct
  // (rad, legs splayed further when flat), squash (the back toward the belly when flat), legLift (rad, the foot
  // raised on the forward swing), hindK (hind legs' swing against the fore's), bend (m at the tail tip for a C-bend
  // of 1), flickYaw (rad of head turn for a flick of 1), tipLag (rad of tail-tip whip for aAnim2.y 1). The basking drop
  // is the file's (extras.rig.drop) and is done in the shader, so animals.js lowers nothing (drop 0).
  lizard: { amp: [0.8, 0.35, 0.4, 0], pose: [1, 0, 0, 0],
    k: { wave: 0.024, waveK: 5.03, envS: 0.2, pushPitch: 0.35, baskAbduct: 0.5, squash: 0.25, legLift: 0.4, hindK: 1.3, bend: 0.05,
      flickYaw: 0.5, tipLag: 0.6 } },
};
const urls = { jay: '../assets/scrubjay.glb', quail: '../assets/quail.glb', squirrel: '../assets/squirrel.glb',
  stjay: '../assets/stellersjay.glb', hawk: '../assets/redtail.glb', vulture: '../assets/vulture.glb',
  lion: '../assets/cougar.glb', rabbit: '../assets/rabbit.glb', jackrabbit: '../assets/jackrabbit.glb', vole: '../assets/vole.glb', ravenGround: '../assets/raven_ground.glb',
  turkey: '../assets/turkey.glb', groundSquirrel: '../assets/ground_squirrel.glb', lizard: '../assets/fence_lizard.glb' };
function rigModel(name, opts) {
  const r = RIG[name];
  return loadTiers(new URL(urls[name], import.meta.url), { amp: r.amp, pose: r.pose, drop: r.drop || 0, poseMax: r.poseMax || 1, gait: !!r.gait, rig: { name, k: r.k } }, opts)
    .then(m => { m.rig.piv = m.extras.rig || {}; m.rig.kind = m.rig.piv.kind; m.variant = m.tiers[0].hasAttribute('aColorB'); return m; });
}
export const loadJayMesh = () => rigModel('jay');
export const loadQuailMesh = () => rigModel('quail');
export const loadSquirrelMesh = () => rigModel('squirrel');
export const loadStellersJayMesh = () => rigModel('stjay');
export const loadRedtailMesh = () => rigModel('hawk');
export const loadVultureMesh = () => rigModel('vulture');
export const loadCougarMesh = () => rigModel('lion');
export const loadRabbitMesh = () => rigModel('rabbit');
export const loadJackrabbitMesh = () => rigModel('jackrabbit');
export const loadVoleMesh = () => rigModel('vole');
export const loadTurkeyMesh = () => rigModel('turkey');
export const loadGroundSquirrelMesh = () => rigModel('groundSquirrel');
export const loadLizardMesh = () => rigModel('lizard');
// The common raven on the ground (client/assets/raven_ground.glb, tools/build_raven_ground.py; generated with Meshy,
// meshy.ai, CC BY-SA 4.0): 0.62 m, origin on the ground between the feet, bill toward +z; lod0 1,496 triangles drawn
// with its 1K texture (vertex colours off, the file's smooth normals), lod1 496 and lod2 150 with vertex colours. One
// load for the page: the ambient ravens (animals.js) and the player's (raven.js) share the tiers, so a caller that
// sets per-instance attributes on a tier clones it first (animals.js owns the originals). GROUND_BODY_Y: the body's
// centre above the feet (the flying models hang from their body: the procedural raven's is 0.09 m above its origin,
// raven_player.glb's at its origin), so a swap keeps the body where it was.
let ravenGround = null;
export const loadRavenGroundMesh = () => ravenGround ||= rigModel('ravenGround', { keepNormals: true });
export const RAVEN_GROUND = { bodyY: 0.21, head: [0, 0.238, 0.16], bill: [0, 0.227, 0.327] };

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

// Steller's jay, ~0.31 m: the fallback for the drawn mesh (tools/build_stellersjay.py), buildJay a size up with
// the Sierra palette (sooty black head and crest, sooty grey-brown breast and mantle, cobalt body, wings and tail)
// and a spiky crest swept back from the crown.
export function buildStellersJay() {
  const blue = 0x2a4fa0, body = 0x2c4f8a, sooty = 0x3e3e44, black = 0x1c1c22;
  const head = { part: PART.HEAD, pivot: [0, 0.076, 0.065] };
  const wp = s => [s * 0.032, 0.076, 0.01];
  const p = [
    ball({ color: body, pos: [0, 0.058, -0.005], scale: [0.041, 0.042, 0.09] }),
    ball({ color: sooty, pos: [0, 0.066, 0.03], scale: [0.038, 0.04, 0.05] }, 5, 3),
    ball({ color: black, ...head, pos: [0, 0.092, 0.085], scale: [0.031, 0.032, 0.036] }),
    cone({ color: black, ...head, pos: [0, 0.128, 0.068], rot: [-0.75, 0, 0], scale: [0.01, 0.05, 0.008] }),   // crest
    cone({ color: 0x141416, ...head, pos: [0, 0.09, 0.126], rot: FWD, scale: [0.009, 0.03, 0.008] }),
    box({ color: blue, part: PART.TAIL, pivot: [0, 0.064, -0.075], pos: [0, 0.06, -0.15], rot: [0.1, 0, 0], scale: [0.05, 0.008, 0.15] }),
    ...mirror(s => box({ color: 0x141416, part: s > 0 ? PART.LEG_A : PART.LEG_B, pivot: [s * 0.017, 0.033, 0], pos: [s * 0.017, 0.016, 0], scale: [0.007, 0.033, 0.008] })),
    ...mirror(s => wingSlab(s, wp(s), { dx: 0.09, len: 0.18, chord: 0.08, thick: 0.007, dihedral: 0.04, color: blue, under: 0x4a5f80 })).flat(),
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
const ANIM_DECL_BASE = `
attribute float aPart; attribute vec3 aPivot; attribute vec4 aAnim;
mat3 animRX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 animRY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 animRZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }`;
const ANIM_BODY = `
vec3 animPos = position;
#ifdef ANIM_ANTLER
  // The buck's antlers, before any part rotation (they ride with the head): aAnim2 = (growth, velvet, young).
  // growth 0 draws them cast (all but the burr ring folded into the burr, a pedicel knob), 1 full; velvet
  // thickens them out along the normal (most at the base) and greys them (color_vertex); young folds the rear
  // branch's second fork into its base (a forked-horn). The right antler mirrors the left in x.
  if (aAntler > 0.0) {
    float antSide = position.x >= 0.0 ? 1.0 : -1.0;
    int antTine = int(aTine + 0.5);
    vec3 antBurr = vec3(antSide * antler_burr.x, antler_burr.yz);
    animPos += normal * (0.0045 * (1.0 - 0.55 * aAntler) * aAnim2.y);
    if (antTine == 1) animPos = mix(animPos, vec3(antSide * antler_fork.x, antler_fork.yz), aAnim2.z);
    if (antTine != 3) animPos = antBurr + (animPos - antBurr) * aAnim2.x;
  }
#endif
vec3 animP = animPos - aPivot;
mat3 animR = mat3(1.0);
int animPart = int(aPart + 0.5);
float animPose = aAnim.z;
#ifdef ANIM_RIG
  float rigSide = aPivot.x >= 0.0 ? 1.0 : -1.0;
  // the parents' rotations, shared by their own vertices and their children's
  mat3 rigChestR = animRX(-(sin(aAnim.x + rig_spinePhase) * aAnim.y * rig_spine + animPose * rig_sit));
  mat3 rigTailR = animRX(aAnim.w * uAmp.y + animPose * uPose.y);
  #ifdef RIG_GROUND
  // the folded wing flicks: lifted off the body and swung out at the shoulder (the hand follows, below)
  #define RIG_ARM(s) (animRZ(s * aAnim2.x * rig_flickLift) * animRY(-s * aAnim2.x * rig_flickOpen))
  #else
  #define RIG_ARM(s) (animRY(s * animPose * uPose.w) * animRZ(s * (sin(aAnim.x) * aAnim.y * uAmp.w - aAnim2.x * rig_bow * 0.4)))
  #endif
#endif
if (animPart == 1 || animPart == 2) {
  animP.y *= mix(1.0, uPose.x, animPose);
  float legOff = animPart == 2 ? 3.14159 : 0.0;
#ifdef ANIM_GAIT
  legOff = mix(legOff, aPivot.z > 0.0 ? 0.0 : 3.14159, aAnim2.w);   // diagonal pairs -> fore pair against hind pair
#endif
#ifdef RIG_GROUND
  legOff *= 1.0 - aAnim2.z;   // a hop: both legs together
#endif
  animR = animRX(sin(aAnim.x + legOff) * aAnim.y * uAmp.x);
#ifdef ANIM_RIG
  if (animPart == 1) animR = animRX(animPose * rig_foreFold) * animR;
  animR = animRZ(rigSide * aAnim2.x * rig_abduct) * animR;   // splay outward
#endif
} else if (animPart == 3) {
#ifdef ANIM_RIG
  animP.x *= 1.0 + aAnim2.y * rig_spread;
  animR = rigTailR;
#else
  animR = animRX(aAnim.w * uAmp.y + animPose * uPose.y);
#endif
} else if (animPart == 6) {
  animR = animRX(aAnim.w * uAmp.z + animPose * uPose.z);
#ifdef PLAYER_HEAD
  animR = animRY(uHeadYaw) * animR;   // the player's head turned by the look (animalMaterial head; flight.js look)
#endif
#ifdef ANIM_RIG
  animR = animRX(sin(2.0 * aAnim.x + 0.6) * aAnim.y * rig_bob) * animR;
#endif
#ifdef RIG_GROUND
  animR = animRY(aAnim2.y) * animR;   // the head turns about the base of the neck
#endif
} else if (animPart == 4 || animPart == 5) {
  float side = animPart == 4 ? 1.0 : -1.0;
#ifdef ANIM_RIG
  animR = RIG_ARM(side);
#else
  animP.x *= mix(1.0, 0.55, animPose);
  animR = animRY(side * animPose * uPose.w) * animRZ(side * sin(aAnim.x) * aAnim.y * uAmp.w);
#endif
}
#ifdef ANIM_RIG
else if (animPart == 7) animR = rigChestR;
else if (animPart == 8) animR = animRX(aAnim2.y * rig_tipLag + animPose * rig_tipCurl + sin(aAnim.x - 1.0) * aAnim.y * rig_tipWave);
else if (animPart == 9 || animPart == 10) {
  float side = animPart == 9 ? 1.0 : -1.0;
  animR = animRZ(side * (sin(aAnim.x - rig_handLag) * aAnim.y * uAmp.w * rig_handAmp - sin(aAnim.x) * aAnim.y * uAmp.w - aAnim2.x * rig_bow));
}
#endif
vec3 transformed = animR * animP + aPivot;
#ifdef ANIM_WEIGHTED
  transformed = mix(animPos, transformed, aPartW);
#endif
#ifdef ANIM_RIG
  // one-level parent chain: the child's own pose first (above), then its parent's rotation about the parent's pivot
  #ifdef RIG_CHEST
  if (animPart == 1 || animPart == 6) transformed = rigChestR * (transformed - rig_pivChest) + rig_pivChest;
  #endif
  #ifdef RIG_TAILTIP
  if (animPart == 8) transformed = rigTailR * (transformed - rig_pivTail) + rig_pivTail;
  #endif
  #ifdef RIG_WING
  if (animPart == 4 || animPart == 5 || animPart == 9 || animPart == 10) {
    float side = (animPart == 4 || animPart == 9) ? 1.0 : -1.0;
    vec3 wp = vec3(side * rig_pivWing.x, rig_pivWing.yz);
    if (animPart >= 9) transformed = RIG_ARM(side) * (transformed - wp) + wp;
    transformed = mix(transformed, wp, animPose * rig_collapse);   // folded: the cards vanish into the shoulder
  }
  #endif
#endif
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif`;
// The reptile template (the western fence lizard; docs/animal-library.md "Western fence lizard and the reptile template"):
// BODY 0, LEG_A 1 (left fore, right hind) and LEG_B 2 (right fore, left hind) splayed out, pivots at the shoulder and
// hip; HEAD 6 (pivot at the neck); TAIL 3 (inner half, pivot at the vent) and TAIL_TIP 8 (outer half, pivot mid-tail).
// aAnim = (phase, gait, pose, flick):
//   phase  the stride: the diagonal pairs swing about the vertical through their pivots (protraction and retraction;
//          hind legs hindK x the fore) and lift about the long axis on the forward half so the foot clears; and the
//          lateral undulation, a wave travelling down the spine (s = 0 snout to 1 tail tip, from each vertex's z: the
//          rest pose is straight), its envelope envS at the snout growing to 1 at the tail tip. Legs and head are rigid:
//          they take the wave's offset and its tangent at their pivot (the head half of it: it stays on line).
//   gait   0 still to 1 sprint: scales the swing and the wave.
//   pose   below 0 basking: the body settles by the file's drop onto the belly (the tail, already down, stays), wider
//          and flatter, the legs splayed further (the feet stay on the rock), the head down on the rock. Above 0 the
//          push-up: the fore body pitches up about the hip axis (the fore legs stretch to keep the fore feet planted),
//          the head lifts, the trunk is compressed sideways and the blue patches (_BLUE) are pushed down and out so the
//          blue faces the side, and brighten (color_vertex).
//   flick  a head turn about the neck (signed).
// aAnim2 = (C-bend: signed, steering or round a trunk; tail-tip lag and whip; blue flash without the push-up; male 1 /
// female 0: _BLUE mixed to the file's blue_off and throat_off).
const REPTILE_BODY = `
vec3 animPos = position;
vec3 animP = animPos - aPivot;
mat3 animR = mat3(1.0);
int animPart = int(aPart + 0.5);
float animPose = aAnim.z;
vec3 transformed;
{
  float rpBask = max(-animPose, 0.0), rpPush = max(animPose, 0.0), rpGait = aAnim.y, rpPh = aAnim.x;
  float rpSide = aPivot.x >= 0.0 ? 1.0 : -1.0;
  #ifdef ANIM_WEIGHTED
  float rpW = aPartW;
  #else
  float rpW = 1.0;
  #endif
  bool rpRigid = animPart == 1 || animPart == 2 || animPart == 6;
  float rpZ = rpRigid ? mix(position.z, aPivot.z, rpW) : position.z;
  float rpSpan = rep_snoutZ - rep_tailEndZ;
  float rpS = clamp((rep_snoutZ - rpZ) / rpSpan, 0.0, 1.0);
  // the travelling wave and the C-bend: lateral offset at s and its slope (d offset / d s)
  float rpEnv = rig_envS + (1.0 - rig_envS) * rpS * rpS, rpDEnv = 2.0 * (1.0 - rig_envS) * rpS;
  float rpArg = rpPh - rig_waveK * rpS, rpA = rig_wave * rpGait, rpB = aAnim2.x * rig_bend;
  float rpOff = rpA * rpEnv * sin(rpArg) + rpB * (rpS - 0.2) * (rpS - 0.2);
  float rpDOff = rpA * (rpDEnv * sin(rpArg) - rpEnv * rig_waveK * cos(rpArg)) + rpB * 2.0 * (rpS - 0.2);
  float rpYaw = atan(-rpDOff / rpSpan);   // dx/dz along the spine
  float rpPitch = rig_pushPitch * rpPush;
  vec3 rpQ = animP;
  if (animPart == 1 || animPart == 2) {
    bool rpFore = aPivot.z > rep_hipZ;
    float rpLeg = animPart == 2 ? 3.14159 : 0.0;
    float rpSwing = sin(rpPh + rpLeg) * rpGait * uAmp.x * (rpFore ? 1.0 : rig_hindK);
    float rpLift = max(0.0, cos(rpPh + rpLeg)) * rpGait * rig_legLift;
    if (rpFore && rpQ.y < 0.0) {   // the push-up: stretch to keep the fore feet planted as the shoulders rise
      float rpRise = (aPivot.z - rep_hipZ) * sin(rpPitch) + (aPivot.y - rep_hipY) * (cos(rpPitch) - 1.0);
      rpQ.y *= 1.0 + rpRise / max(aPivot.y, 0.004);
    }
    animR = animRY(rpYaw - rpSide * rpSwing) * animRZ(rpSide * (rpLift + rpBask * rig_baskAbduct));
    if (rpFore) animR = animRX(rpPitch) * animR;   // upright again once the fore body has pitched (below)
  } else if (animPart == 6) {
    animR = animRY(0.5 * rpYaw + aAnim.w * rig_flickYaw) * animRX(rpBask * 0.25 - rpPush * 0.2);
  } else if (animPart == 8) {
    animR = animRY(aAnim2.y * rig_tipLag);
  }
  rpQ = mix(rpQ, animR * rpQ, rpW);
  vec3 rpP = rpQ + aPivot;
  if (animPart == 0) {   // the trunk: wider and flatter basking; compressed sideways, the blue pushed down and out, in a push-up
    rpP.x *= 1.0 + 0.15 * rpBask - 0.25 * rpPush * (1.0 - 0.7 * aBlue);
    if (rpP.y > rep_bellyY) rpP.y = rep_bellyY + (rpP.y - rep_bellyY) * (1.0 - rig_squash * rpBask);
    rpP.y -= 0.002 * rpPush * aBlue;
  }
  rpP.y -= rep_drop * rpBask * (rpRigid ? 1.0 : clamp(position.y / rep_bellyY, 0.0, 1.0));   // onto the belly; the tail stays down
  float rpF = smoothstep(rep_hipZ - 0.004, rep_hipZ + 0.008, rpZ);
  if (rpF > 0.0) {   // the push-up: the fore body about the hip axis
    vec3 rpH = vec3(rpP.x, rep_hipY, rep_hipZ);
    rpP = animRX(-rpPitch * rpF) * (rpP - rpH) + rpH;
  }
  rpP.x += rpOff;
  transformed = rpP;
}
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif`;
// The female's colours and the push-up's flash (color_vertex): the patches mixed to the file's off colours (the throat's
// forward of the fore legs), brightened by the push-up or aAnim2.z (the patch itself, not its black edge).
const REPTILE_COLOR = `
#ifdef RIG_REPTILE
{
  float rpBlue = clamp(aBlue, 0.0, 1.0);
  vColor.rgb = mix(vColor.rgb, position.z > rep_throatZ ? rep_throatOff : rep_blueOff, rpBlue * (1.0 - aAnim2.w));
  vColor.rgb *= 1.0 + 0.9 * max(max(aAnim.z, 0.0), aAnim2.z) * aAnim2.w * smoothstep(0.6, 0.9, rpBlue);
}
#endif`;
// The skin path's body (see the header): the antlers first (they ride with the head in rest space), then the four joints'
// matrices from the bone texture at the instance's clip and frame, two frames blended, and a second clip blended in for a
// transition. Matrices are blended linearly (a hair of shrink mid-blend, nothing the eye reads on a 0.3 s transition).
const SKIN_DECL = `
attribute vec4 skinIndex; attribute vec4 skinWeight; attribute vec4 aClip;
uniform highp sampler2D uBones;
mat3 skinRY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat4 skinBone(int frame, int j) {
  vec4 r0 = texelFetch(uBones, ivec2(j * 3, frame), 0), r1 = texelFetch(uBones, ivec2(j * 3 + 1, frame), 0), r2 = texelFetch(uBones, ivec2(j * 3 + 2, frame), 0);
  return mat4(vec4(r0.x, r1.x, r2.x, 0.0), vec4(r0.y, r1.y, r2.y, 0.0), vec4(r0.z, r1.z, r2.z, 0.0), vec4(r0.w, r1.w, r2.w, 0.0) * skin_ratio + vec4(0.0, 0.0, 0.0, 1.0));
}
// the instance's skinning matrix at phase 0..1 of a clip (first frame, frame count, loop): the two frames round the phase
mat4 skinClip(vec4 c, float phase) {
  float fp = c.x + clamp(phase, 0.0, 0.99999) * c.y;
  int f0 = int(floor(fp)), f1 = f0 + 1, last = int(c.x + c.y) - 1;
  if (f1 > last) f1 = c.z > 0.5 ? int(c.x) : last;
  float u = fp - floor(fp);
  ivec4 j = ivec4(skinIndex + 0.5);
  mat4 M = (skinBone(f0, j.x) * (1.0 - u) + skinBone(f1, j.x) * u) * skinWeight.x;
  if (skinWeight.y > 0.0) M += (skinBone(f0, j.y) * (1.0 - u) + skinBone(f1, j.y) * u) * skinWeight.y;
  if (skinWeight.z > 0.0) M += (skinBone(f0, j.z) * (1.0 - u) + skinBone(f1, j.z) * u) * skinWeight.z;
  if (skinWeight.w > 0.0) M += (skinBone(f0, j.w) * (1.0 - u) + skinBone(f1, j.w) * u) * skinWeight.w;
  return M;
}`;
const SKIN_BODY = `
vec3 animPos = position;
#ifdef ANIM_ANTLER
  if (aAntler > 0.0) {
    float antSide = position.x >= 0.0 ? 1.0 : -1.0;
    int antTine = int(aTine + 0.5);
    vec3 antBurr = vec3(antSide * antler_burr.x, antler_burr.yz);
    animPos += normal * (0.0045 * (1.0 - 0.55 * aAntler) * aAnim2.y);
    if (antTine == 1) animPos = mix(animPos, vec3(antSide * antler_fork.x, antler_fork.yz), aAnim2.z);
    if (antTine != 3) animPos = antBurr + (animPos - antBurr) * aAnim2.x;
  }
#endif
mat4 skinM = skinClip(skin_clips[int(aClip.x + 0.5)], aClip.y);
if (aClip.w > 0.001) {
  float clipB = floor(aClip.z);
  skinM = skinM * (1.0 - aClip.w) + skinClip(skin_clips[int(clipB + 0.5)], aClip.z - clipB) * aClip.w;
}
mat3 animR = mat3(skinM);
vec3 transformed = (skinM * vec4(animPos, 1.0)).xyz;
#if defined(PLAYER_HEAD) && defined(SKIN_HEAD)
{   // the player's look: the vertices weighted to the neck and head joints turn about the vertical through the neck base
  vec4 inHead = step(vec4(skin_head.x - 0.5), skinIndex) * step(skinIndex, vec4(skin_head.y + 0.5));
  float headW = dot(inHead, skinWeight);
  if (headW > 0.0) {
    vec3 hp = (skinM * vec4(skin_neck, 1.0)).xyz;
    transformed = mix(transformed, skinRY(uHeadYaw) * (transformed - hp) + hp, headW);
  }
}
#endif
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif`;
function skinDecl(model) {
  const sk = model.skin; if (!sk) return '';
  const f = x => (+x || 0).toFixed(4);
  const rows = sk.table.map(c => `vec4(${c.first.toFixed(1)}, ${c.count.toFixed(1)}, ${c.loop ? '1.0' : '0.0'}, 0.0)`);
  const head = sk.head ? `#define SKIN_HEAD\nconst vec2 skin_head = vec2(${sk.head.first.toFixed(1)}, ${sk.head.last.toFixed(1)});\nconst vec3 skin_neck = vec3(${sk.head.pivot.map(f).join(', ')});\n` : '';
  return `#define ANIM_SKIN\nconst float skin_ratio = ${f(sk.ratio)};\nconst vec4 skin_clips[${rows.length}] = vec4[${rows.length}](${rows.join(', ')});\n${head}${SKIN_DECL}\n`;
}
export const skinUniforms = model => model.skin ? { uBones: { value: model.skin.tex } } : {};
const animBody = model => model.skin ? SKIN_BODY : model.rig?.kind === 'reptile' ? REPTILE_BODY : ANIM_BODY;
const RIG_KEYS = ['spine', 'spinePhase', 'sit', 'foreFold', 'tipLag', 'tipWave', 'tipCurl', 'abduct', 'bob', 'handLag', 'handAmp', 'bow', 'spread', 'collapse', 'flickLift', 'flickOpen',
  'wave', 'waveK', 'envS', 'pushPitch', 'baskAbduct', 'squash', 'legLift', 'hindK', 'bend', 'flickYaw'];
// aAnim2 is declared for the rig templates, the quadrupeds' gait selector and the antlers (the geometry must then
// carry it: a missing instanced attribute reads (0, 0, 0, 1), a bound gait and no antler growth).
const hasAnim2 = model => !!(model.rig || model.gait || model.antler);
function antlerDecl(model) {
  const f = x => (+x || 0).toFixed(4), v3 = a => `vec3(${a.map(f).join(', ')})`;
  return model.antler ? `#define ANIM_ANTLER\nattribute float aAntler; attribute float aTine;\nconst vec3 antler_burr = ${v3(model.antler.burr)};\nconst vec3 antler_fork = ${v3(model.antler.fork)};\n` : '';
}
function extraDecl(model) {
  let d = hasAnim2(model) && !model.rig ? 'attribute vec4 aAnim2;\n' : '';
  if (model.gait) d += '#define ANIM_GAIT\n';
  return d + antlerDecl(model) + rigDecl(model);
}
function rigDecl(model) {
  const r = model.rig; if (!r) return '';
  const f = x => (+x || 0).toFixed(4), v3 = a => `vec3(${a.map(f).join(', ')})`;
  const piv = r.piv || {};
  let d = '#define ANIM_RIG\nattribute vec4 aAnim2;\n';
  if (r.k.ground) d += '#define RIG_GROUND\n';
  for (const k of RIG_KEYS) d += `const float rig_${k} = ${f(r.k[k])};\n`;
  if (piv.chest) d += `#define RIG_CHEST\nconst vec3 rig_pivChest = ${v3(piv.chest)};\n`;
  if (piv.tail_tip) d += `#define RIG_TAILTIP\nconst vec3 rig_pivTail = ${v3(piv.tail)};\n`;
  if (piv.wing) d += `#define RIG_WING\nconst vec3 rig_pivWing = ${v3(piv.wing)};\n`;
  if (model.variant) d += '#define ANIM_VARIANT\nattribute vec3 aColorB;\n';
  if (r.kind === 'reptile') {   // the reptile template's spine and patches (extras.rig; see REPTILE_BODY)
    const L = piv.legs || {}, hip = [L.HL, L.HR].filter(Boolean), hy = hip.length ? hip.reduce((a, h) => a + h[1], 0) / hip.length : (piv.hind?.[1] ?? 0.012);
    const hz = hip.length ? hip.reduce((a, h) => a + h[2], 0) / hip.length : (piv.hind?.[2] ?? -0.017);
    d += `#define RIG_REPTILE\nattribute float aBlue;\nconst float rep_snoutZ = ${f(piv.snout_z ?? 0.048)};\nconst float rep_tailEndZ = ${f(piv.tail_end_z ?? -0.13)};\n`
      + `const float rep_bellyY = ${f(piv.belly_y ?? 0.008)};\nconst float rep_drop = ${f(piv.drop ?? 0.007)};\nconst float rep_hipY = ${f(hy)};\nconst float rep_hipZ = ${f(hz)};\n`
      + `const float rep_throatZ = ${f((piv.fore?.[2] ?? 0.017) + 0.004)};\nconst vec3 rep_blueOff = ${v3(piv.blue_off || [0.45, 0.42, 0.35])};\nconst vec3 rep_throatOff = ${v3(piv.throat_off || [0.48, 0.445, 0.38])};\n`;
  }
  return d;
}
const animDecl = model => model.skin ? (model.antler ? 'attribute vec4 aAnim2;\n' : '') + antlerDecl(model) + skinDecl(model)
  : (model.weighted ? '#define ANIM_WEIGHTED\nattribute float aPartW;' : '') + ANIM_DECL_BASE + '\n' + extraDecl(model);
const programKey = model => `${model.amp.join(',')}|${model.pose.join(',')}|${model.weighted ? 'w' : ''}|${model.rig ? model.rig.name : ''}|${model.gait ? 'g' : ''}|${model.antler ? 'a' : ''}|${model.skin ? `s${model.skin.ratio.toFixed(4)}:${model.skin.key}` : ''}`;
export { hasAnim2 };

// Light through the feathers (UNDERWING): a bird's wing and tail seen with the sun beyond them glow with the light
// coming through, tinted by the feathers (a red-tail's pale lining and translucent primaries, a turkey vulture's
// silver flight feathers against the black lining), which is what identifies them from below. A transmission term
// for the face the viewer sees when it looks away from the sun: the sun's irradiance through the face (the cosine
// on its far side), stronger toward the sun (a forward-scattering lobe), times the face's own colour, times a
// per-vertex thinness from the parts the rig already tags: the hand (fingers and primaries) most, the arm ramping up
// from the leading edge to the thin trailing edge, the tail less, the body and head hardly at all. The vertex colour's
// brightness stands in for how much light the feathers pass, so dark feathers pass almost none (the raven stays
// black, the hawk's patagial bars and the vulture's lining stay dark). Cloud shadow applies; the cascaded shadow does
// not (the wing would shadow its own underside). Fades out from 300 to 420 m. Flying birds only: not the ground
// raven, and gated by pose for the birds that perch (wings folded, pose 1); the soarers (collapse 0) never perch.
// Cost: a few vertex instructions and two dot products a fragment; ground animals compile without it.
export const underwingLight = { value: 1.0 };   // strength (live tuning)
function underwingSpec(model) {
  const r = model.rig;
  const bird = r ? r.kind === 'bird' && !r.k.ground : (model.amp[3] > 0 || model.pose[3] > 0);
  if (!bird) return null;
  const g = model.geometry || model.tiers?.[0], pa = g?.getAttribute('aPart'), pos = g?.getAttribute('position');
  let lead = -Infinity, trail = Infinity;
  if (pa) for (let i = 0; i < pa.count; i++) { const p = Math.round(pa.getX(i)); if (p === PART.WING_L || p === PART.WING_R) { const z = pos.getZ(i); if (z > lead) lead = z; if (z < trail) trail = z; } }
  if (!(lead > trail)) { lead = 0.1; trail = -0.1; }
  return { lead, inv: 1 / (lead - trail), perch: !(r && r.k.collapse === 0) };
}
const UNDERWING_VERT = `
#ifdef ANIM_UNDERWING
{
  int uwPart = int(aPart + 0.5);
  float uwChord = clamp((uw_lead - position.z) * uw_invChord, 0.0, 1.0);   // 0 the leading edge, 1 the trailing edge
  float uwThin = (uwPart == 9 || uwPart == 10) ? mix(0.8, 1.0, uwChord)
    : (uwPart == 4 || uwPart == 5) ? mix(0.35, 1.0, uwChord * uwChord)
    : uwPart == 3 ? 0.7 : 0.08;
  vUnderwing = uwThin * smoothstep(0.02, 0.45, dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
  #ifdef UNDERWING_PERCH
  vUnderwing *= 1.0 - clamp(aAnim.z, 0.0, 1.0);
  #endif
}
#endif`;
const UNDERWING_RE = `
void RE_Direct_Underwing( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Lambert( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float through = saturate( -dot( geometryNormal, directLight.direction ) ), fwd = saturate( -dot( geometryViewDir, directLight.direction ) );
  uwLight += directLight.color * BRDF_Lambert( material.diffuseColor ) * ( vUnderwing * through * ( 0.8 + 1.2 * fwd * fwd ) );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Underwing`;

// map: a textured tier (the ground raven's lod0): the texture instead of the vertex colours, smooth shaded.
// head: a { value } uniform (radians) that turns the HEAD part about the vertical through its pivot: the player's own
// body (groundControl.js and the other controls), whose head follows the camera's look (flight.js look).
export function animalMaterial(atmosphere, model, { map = null, head = null } = {}) {
  const m = map ? new THREE.MeshLambertMaterial({ map, vertexColors: false }) : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  atmosphere.patchLambert(m);
  const prev = m.onBeforeCompile;
  // The species' amplitudes and poses are baked in as constants, with a cache key per species: the
  // materials would otherwise share one program, and with it the first material's uniform values.
  const v4 = a => `vec4(${a.map(x => x.toFixed(4)).join(', ')})`;
  const consts = `\nconst vec4 uAmp = ${v4(model.amp)};\nconst vec4 uPose = ${v4(model.pose)};`;
  const uw = map ? null : underwingSpec(model);
  const key = `atmosphere-lambert|animal|${programKey(model)}${map ? "|map" : ""}${uw ? `|uw${uw.lead.toFixed(4)},${uw.inv.toFixed(3)},${uw.perch ? 1 : 0}` : ''}${head ? '|head' : ''}`;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    if (model.skin) shader.uniforms.uBones = { value: model.skin.tex };
    const uwDecl = uw ? `\n#define ANIM_UNDERWING\n${uw.perch ? '#define UNDERWING_PERCH\n' : ''}const float uw_lead = ${uw.lead.toFixed(4)};\nconst float uw_invChord = ${uw.inv.toFixed(4)};\nvarying float vUnderwing;` : '';
    if (head) shader.uniforms.uHeadYaw = head;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + animDecl(model) + consts + uwDecl + (head ? '\n#define PLAYER_HEAD\nuniform float uHeadYaw;' : ''));
    // Smooth shaded (a textured tier): pose first, where the normal begins, so the normals turn with the parts.
    if (map) shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', animBody(model) + '\nvec3 objectNormal = normal;\n#if defined(ANIM_SKIN)\n  objectNormal = normalize(animR * normal);\n#elif defined(ANIM_WEIGHTED)\n  objectNormal = normalize(mix(normal, animR * normal, aPartW));\n#else\n  objectNormal = animR * normal;\n#endif')
      .replace('#include <begin_vertex>', '');
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', animBody(model))
      // a second colour set (the female quail), picked per instance by aAnim2.w
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef ANIM_VARIANT\n  vColor.rgb = mix(vColor.rgb, aColorB, aAnim2.w);\n#endif'
        // velvet: grey-brown skin over the growing antler (the burr ring keeps its colour)
        + '\n#ifdef ANIM_ANTLER\n  if (aAntler > 0.0 && int(aTine + 0.5) != 3) vColor.rgb = mix(vColor.rgb, vec3(0.13, 0.095, 0.07), aAnim2.y);\n#endif'
        + REPTILE_COLOR + UNDERWING_VERT);
    if (uw) {
      shader.uniforms.underwingK = underwingLight;
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', 'vUnderwing *= 1.0 - smoothstep(300.0, 420.0, length(mvPosition.xyz));\n#include <fog_vertex>');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vUnderwing;\nuniform float underwingK;\nvec3 uwLight = vec3(0.0);')
        .replace('#include <lights_lambert_pars_fragment>', '#include <lights_lambert_pars_fragment>' + UNDERWING_RE)
        .replace('vec3 outgoingLight = reflectedLight.directDiffuse', 'reflectedLight.indirectDiffuse += uwLight * underwingK * cloudOnly(vAtmoPos);\nvec3 outgoingLight = reflectedLight.directDiffuse');
    }
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
    uniforms: skinUniforms(model),
    vertexShader: `${animDecl(model)}
const vec4 uAmp = ${v4(model.amp)};
const vec4 uPose = ${v4(model.pose)};
void main() {
${animBody(model)}
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(transformed, 1.0);
}`,
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    colorWrite: false, side: THREE.DoubleSide,
  });
}

// The silhouette twin of animalMaterial (herdSilhouette.js: a hidden herd member seen through foliage): the same part
// animation, a flat glow in `soul` fading from fade.x to fade.y m from the eye, drawn only where the body is behind
// what is already drawn (depthFunc GreaterDepth), additive, no depth write.
export function animalSilhouetteMaterial(model, { soul, fade, gain = 0.85 }) {
  const v4 = a => `vec4(${a.map(x => x.toFixed(4)).join(', ')})`;
  return new THREE.ShaderMaterial({
    uniforms: { uSoul: { value: soul }, uSilFade: { value: fade }, ...skinUniforms(model) },
    vertexShader: `${animDecl(model)}
const vec4 uAmp = ${v4(model.amp)};
const vec4 uPose = ${v4(model.pose)};
varying float vSilD;
void main() {
${animBody(model)}
  vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vSilD = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 uSoul; uniform vec2 uSilFade; varying float vSilD;
void main() { gl_FragColor = vec4(uSoul * ((1.0 - smoothstep(uSilFade.x, uSilFade.y, vSilD)) * ${gain.toFixed(2)}), 1.0); }`,
    // front faces only, pushed a little toward the eye (the polygon offset), so a body's own far side and its parts just
    // behind its nearer parts do not count as hidden; what foliage covers does
    depthFunc: THREE.GreaterDepth, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -16,
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
export function planarShadowMaterial(model, { drop = model.drop || 0, opacity = 0.42, nearFade = false } = {}) {
  const v4 = a => `vec4(${a.map(x => x.toFixed(4)).join(', ')})`;
  return new THREE.ShaderMaterial({
    uniforms: { sunDir: atmo.sunDir, csmStrength: atmo.csmStrength, opacity: { value: opacity }, csm0: { value: atmo.csmMatrix.value[0] }, ...skinUniforms(model) },
    vertexShader: `${animDecl(model)}
const vec4 uAmp = ${v4(model.amp)};
const vec4 uPose = ${v4(model.pose)};
uniform vec3 sunDir; uniform float csmStrength; uniform mat4 csm0;
varying float vFade;
void main() {
${animBody(model)}
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(transformed, 1.0);
  float ground = m[3].y + ${drop > 0 ? `${drop.toFixed(3)} * aAnim.z * length(m[0].xyz) + ` : ''}0.08;   // the drop scales with the instance
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


// ---- the skin path's drive -----------------------------------------------------------------------------------------
// From the part rig's drive values to a clip and a phase, on the CPU, per instance and frame (animals.js update for the
// AI, groundControl.js draw for the player): the state machine below picks a target clip from the speed (m/s), the bedded
// pose (aAnim.z, 0..1) and the head flick (aAnim.w: 1 grazing, below 0 alert), keeps the current clip's phase running,
// and on a change blends from the old clip over `blend` seconds (the old one goes on running in the second slot).
// Gait clips advance by distance: the Walk's stride (tools/bake_clips.py: the planted hoof's ground travel spread over
// the cycle, 0.65 m on the doe) gives planted hooves at any walking speed; the cycle rate is capped so a hurried walk
// (the trot regime, 2.2-3.5 m/s) does not blur, and the Gallop's rate runs between 1.3 and 2.8 Hz about its hand-set
// 3 m stride (an in-place gallop cannot say how far it flies). Idle loops run on the clock from a per-animal seed so a
// herd is not in unison. Clip names are the deer's (library/animals/clips/odocoileus_hemionus.json); another skinned
// species would pass its own table.
export const DEER_DRIVE = {
  idle: ['Idle', 'Idle_2'], relax: 'Idle_Headlow', graze: 'Eating', walk: 'Walk', run: 'Gallop', bed: 'bed', alert: 'Idle',
  runAt: 3.5, walkAt: 2.8, walkMaxHz: 2.6, runHz: [1.3, 2.8], blend: { bed: 1.0, graze: 0.5, gait: 0.3, idle: 0.5 },
};
if (typeof globalThis !== 'undefined') globalThis.__weDeerDrive = DEER_DRIVE;   // debugging: thresholds, rates, force
export function makeClipState() { return { cur: -1, prev: 0, pA: 0, pB: 0, blend: 0, seed: Math.random(), kind: '' }; }
// kind: what the current clip is for (idle, graze, bed, walk, run), for the hysteresis and the blend time
function pickClip(D, st, speed, pose, flick) {
  if (D.force) return D.force;   // debugging: __weDeerDrive.force = 'bed' holds every deer in one clip
  if (pose > 0.5) return 'bed';
  if (speed > D.runAt || (st.kind === 'run' && speed > D.walkAt)) return 'run';
  if (speed > 0.08) return 'walk';
  if (flick > 0.5) return 'graze';
  if (flick < -0.15) return 'alert';
  return 'idle';
}
export function driveClips(skin, D, st, speed, pose, flick, dt, out, o) {
  const kind = pickClip(D, st, speed, pose, flick);
  const C = skin.clip, T = skin.table;
  if (kind !== st.kind) {
    const name = kind === 'idle' ? D.idle[Math.floor(st.seed * D.idle.length) % D.idle.length] : D[kind];
    const next = C[name] ?? 0;
    if (st.cur >= 0 && next !== st.cur) {
      st.prev = st.cur; st.pB = st.pA; st.blend = 1; st.kindB = st.kind;
      // a gait change keeps the left fore hoof where it is in the stride
      const a = T[st.cur], b = T[next];
      st.pA = a.stride_m && b.stride_m ? ((st.pA - (a.touchdown || 0) + (b.touchdown || 0)) % 1 + 1) % 1 : st.seed;
      st.tBlend = D.blend[kind === 'bed' || st.kind === 'bed' ? 'bed' : kind === 'graze' || st.kind === 'graze' ? 'graze' : kind === 'walk' || kind === 'run' ? 'gait' : 'idle'];
    } else if (st.cur < 0) { st.pA = st.seed; st.blend = 0; }
    st.cur = next; st.kind = kind;
  }
  // phases: the current clip's by distance (a gait) or on the clock (a loop); the old one goes on the same way
  const rate = (c, k) => {
    if (c.stride_m) {
      if (k === 'run') return Math.min(D.runHz[1], Math.max(D.runHz[0], speed / c.stride_m));
      return Math.min(D.walkMaxHz, speed / c.stride_m);
    }
    return c.duration > 0 ? 1 / c.duration : 0;
  };
  st.pA = (st.pA + dt * rate(T[st.cur], kind)) % 1;
  if (st.blend > 0) { st.pB = (st.pB + dt * rate(T[st.prev], st.kindB)) % 1; st.blend = Math.max(0, st.blend - dt / (st.tBlend || 0.3)); }
  const w = st.blend * st.blend * (3 - 2 * st.blend);   // eased
  out[o * 4] = st.cur; out[o * 4 + 1] = st.pA; out[o * 4 + 2] = st.prev + Math.min(st.pB, 0.9999); out[o * 4 + 3] = w;
}
