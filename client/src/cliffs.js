import * as THREE from 'three';
import { uniforms as atmo, ATMOSPHERE_GLSL } from './atmosphere.js';
import { detailUniforms, DETAIL_GLSL, CLIFF_PATTERN } from './groundDetail.js';
import { groundUniforms, cliffUniforms, CLIFF_GLSL, NOISE_GLSL } from './terrain.js';
import { addCaster } from './shadows.js';
import { mulberry32 } from './trees.js';

// Sharp geometry on the cliffs (2026-11-02, Yosemite's walls; docs/decisions.md "cliffs with sharp geometry"). The
// terrain is a 10 m mesh (a 2 m one near the player) of a DEM whose cliffs are smoothed, so a 900 m wall is a smooth
// slope: no edge, ledge, roof or joint to break its silhouette or catch the light. Over every face steeper than about
// 50 degrees this lays slabs and wedges as instanced meshes, flat-shaded with hard edges, standing off the face by up
// to a few metres, so the silhouette steps and the sun throws sharp shadows. They are drawn with the terrain's own
// cliff material (terrain.js CLIFF_GLSL), so a slab's face continues the wall behind it in colour and pattern.
//
// Per 30 m cell (the geology grid), from the heights alone, the same on every client: a 15 m lattice of points in the
// cell, jittered by the cell's hash over the whole lattice step; at 55% of the points steeper than CLIFF_DEG (the 1 m
// ground's gradient over +-4 m, so its roughness is not a cliff; and none on wooded ground below 62 degrees) a group
// of slabs whose shape follows the rock's pattern (groundDetail.js CLIFF_PATTERN, from tile.geology's rock class):
//   1 sheeted (granite)  big facets: sheets and buttresses 8-25 m along the face and 12-40 m up it, 2-6 m thick (the
//                        sizes heavy-tailed), their edges off the vertical joints by up to 8 degrees, one in eight on
//                        the diagonal set (a dihedral's ramp); a roof (a wedge: its slanted underside faces down and
//                        out) one in five; a smaller sheet standing further out over a third of them
//   2 bedded (slate, schist, sandstone)  2-4 thin beds, 2-6 m long, 0.5-1.5 m tall, tilted 20-35 degrees in the face
//   3 blocky (greenstone, serpentinite, volcanic rock, the rest)  1-3 cubes of 1-3.5 m, turned at random in the face
// (The first pass laid a slab group at 5 m spacing, 30 a cell of 2-10 m sheets: from below the faces read as paving,
// every slab a dash of shadow. Few big facets read as a wall's own geometry; the texture carries the metre scale.)
// Each slab is seated so its back face is behind the ground: the ground's signed distance (vertical gap times the
// normal's y, exact for a plane) at nine points of its back face, and the slab pushed back along the normal until all
// nine are 0.25 m inside; a slab whose front then stands under 0.4 m out (a hollow) or over 7 m (a convex rim) is
// dropped. So no gap can show between a slab and the ground under it, and the heightfield is not edited.
// A slab's own tone: a hash of its place, most a little darker or paler than the wall, one in six the fresh pale rock
// of a recent fall.
//
// Plans are cached by cell. Around the camera (rebuilt when it strays REBUILD m) every cell within FAR_R with a steep
// sample (the cell's maximum slope on the 5 m DEM, a byte per cell made once) is planned; within NEAR_R every slab is
// drawn, beyond only the big ones (an area over BIG_AREA m2): the far faces carry the big sheets. A small slab fades
// out between NEAR_R and NEAR_R * 1.3 by its own hash in the vertex shader, so the thinning is never a ring. The
// rebuild runs in update() a time budget at a time into staging arrays, and is swapped in whole; nothing is allocated
// per frame.
const CELL = 30, LATTICE = 15, CLIFF_DEG = 55, NEAR_R = 800, FAR_R = 2200, REBUILD = 150, BIG_AREA = 60, BUDGET_MS = 2.5;
const CAP_BOX = 60000, CAP_WEDGE = 12000;
const SALT = 0x5c1f;

function hash3(i, j, s) { let h = Math.imul(i + 0x9e37, 374761393) ^ Math.imul(j + 0x7f4a, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }

// A unit box and a unit wedge (x along, y up the face, z out of it), centred, flat-shaded: every face its own vertices.
function wedgeGeometry() {
  // cross-section in (y, z): top edge (0.5, -0.5) to (0.5, 0.5), back (0.5, -0.5) to (-0.5, -0.5), the underside the
  // hypotenuse from (-0.5, -0.5) up and out to (0.5, 0.5): a roof that overhangs
  const P = [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, -0.5]];
  const tris = [[0, 1, 2], [3, 5, 4], [0, 3, 4], [0, 4, 1], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2]];
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, k) => t.forEach((v, q) => pos.set(P[v], k * 9 + q * 3)));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // the computed normals of a non-indexed geometry are the faces': check the winding faces out
  const n = g.attributes.normal, p = g.attributes.position;
  for (let k = 0; k < tris.length; k++) {
    const i = k * 3, cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (cx * n.getX(i) + cy * n.getY(i) + cz * n.getZ(i) < 0) { const a = pos.slice(i * 3 + 3, i * 3 + 6); pos.copyWithin(i * 3 + 3, i * 3 + 6, i * 3 + 9); pos.set(a, i * 3 + 6); }
  }
  g.computeVertexNormals();
  return g;
}

const VERT = /* glsl */`
  attribute float aPat; attribute float aSmall;
  varying vec3 vPosW; varying vec3 vNormalW; varying float vPat; varying float vTone;
  uniform float cliffNearR;
  void main(){
    mat4 m = modelMatrix * instanceMatrix;
    vec3 o = m[3].xyz;
    vTone = fract(sin(dot(floor(o.xz * 3.0), vec2(39.3468, 11.1351))) * 24634.6345);   // the slab's own tone (a hash of its place)
    // a small slab thins out between NEAR_R and 1.3 NEAR_R by its own hash (its position), so the edge is no ring
    if (aSmall > 0.5) {
      float h = fract(sin(dot(floor(o.xz), vec2(12.9898, 78.233))) * 43758.5453);
      if (distance(o, cameraPosition) > cliffNearR * (1.0 + 0.3 * h)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    }
    vec4 wp = m * vec4(position, 1.0); vPosW = wp.xyz;
    vNormalW = normalize(transpose(inverse(mat3(m))) * normal);
    vPat = aPat;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRAG = /* glsl */`
  varying vec3 vPosW; varying vec3 vNormalW; varying float vPat; varying float vTone;
  ${ATMOSPHERE_GLSL}
  uniform sampler2D map; uniform float tileSize;
  const vec3 G_LUMA = vec3(0.299, 0.587, 0.114);
  ${NOISE_GLSL}
  ${DETAIL_GLSL}
  ${CLIFF_GLSL}
  void main(){
    vec3 n = normalize(vNormalW), dpx = dFdx(vPosW), dpy = dFdy(vPosW);
    float foot = sqrt(length(dpx) * length(dpy));
    float lum = dot(texture2D(map, vec2(vPosW.x, -vPosW.z) / tileSize).rgb, G_LUMA);
    vec3 nL; vec3 c = cliffShade(vPosW, n, dpx, dpy, int(vPat + 0.5), lum, foot, nL);
    // a sheet's own tone: most a little darker or paler than the wall, one in six the fresh pale rock of a recent fall
    c *= vTone > 0.83 ? vec3(1.22, 1.17, 1.08) : vec3(0.9 + 0.16 * vTone);
    // as the terrain lights (terrain.js FRAG): the bumped sun term over the geometric one, the cast shadow, sky light
    float geo = max(dot(n, sunDir), 0.0);
    float bump = max(dot(nL, sunDir), 0.0) / max(dot(nL, n), 0.6);
    float diff = geo > 0.0 ? mix(geo, bump, smoothstep(0.0, 0.12, geo)) : 0.0;
    float sunVis = geo > 0.0 ? csmShadow(vPosW, n, 1.0, 1.0, 1.0) : 1.0;
    vec3 light = sunLight * diff * cloudOnly(vPosW) * sunVis + mix(ambientGround, ambientSky, 0.5 + 0.5 * n.y);
    gl_FragColor = vec4(atmosphereApply(c * light * 0.3183099, vPosW, cameraPosition), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Cliffs {
  constructor(tile, scene) {
    this.tile = tile; this.H = tile.heights; this.size = tile.size;
    this.group = new THREE.Group(); this.group.name = 'cliffs'; scene.add(this.group);
    this.n = Math.ceil(this.size / CELL);
    this.plans = new Map(); this.centre = null; this.job = null; this.on = true;
    this.stats = { cells: 0, steepCells: 0, slabs: 0, wedges: 0, lastMs: 0, lastFrames: 0, maxSliceMs: 0, maskMs: 0, builds: 0 };
    const g = tile.geology, classes = tile.groundClasses?.rock_classes || Object.keys(CLIFF_PATTERN);
    this.patternAt = (x, north) => {
      if (!g) return 1;
      const ci = g.channel(Math.min(Math.floor(x / g.res), g.img.width - 1), Math.min(Math.floor((this.size - north) / g.res), g.img.height - 1), 1);
      const p = ci ? (CLIFF_PATTERN[classes[ci - 1]] ?? 3) : 3;
      return p || 3;   // a cliff in alluvium or till is a cut through it: blocky
    };
    const cv = tile.canopy;   // tree cover %, the 30 m grid (tilepackage Grid8 channel 0)
    this.treeAt = (x, north) => cv ? Math.min(cv.at(x, north, 0) / 100, 1) : 0;
    this.uniforms = { ...atmo, ...detailUniforms, ...cliffUniforms, map: groundUniforms.map, tileSize: groundUniforms.tileSize, cliffNearR: { value: NEAR_R } };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    const make = (geo, cap, name) => {
      geo.setAttribute('aPat', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      geo.setAttribute('aSmall', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      const m = new THREE.InstancedMesh(geo, this.material, cap); m.count = 0; m.frustumCulled = false; m.name = name;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m); return m;
    };
    this.box = make(new THREE.BoxGeometry(1, 1, 1), CAP_BOX, 'cliffSlabs');
    this.wedge = make(wedgeGeometry(), CAP_WEDGE, 'cliffWedges');
    // staging: the rebuild writes here, the swap copies into the meshes' buffers in one frame
    this.stage = { box: { m: new Float32Array(CAP_BOX * 16), p: new Float32Array(CAP_BOX), s: new Float32Array(CAP_BOX), n: 0 },
      wedge: { m: new Float32Array(CAP_WEDGE * 16), p: new Float32Array(CAP_WEDGE), s: new Float32Array(CAP_WEDGE), n: 0 } };
    // the shadow: back faces only (a lit face never shadows itself), every cascade
    this.depth = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide });
    addCaster(this.group, { cascades: [0, 1, 2], material: this.depth });
    this._v = { n: new THREE.Vector3(), u: new THREE.Vector3(), a: new THREE.Vector3(), a2: new THREE.Vector3(), u2: new THREE.Vector3(), M: new THREE.Matrix4() };
  }

  // The cliff mask: each cell's maximum slope (degrees) on the 5 m DEM, a byte per cell, in slices.
  *maskSteps() {
    if (this.mask) return;
    const t0 = performance.now(), H = this.H, n = this.n, mask = new Uint8Array(n * n), r = H.res, W = H.w, z = H.z;
    for (let j = 0; j < n; j++) {   // j: cell row from the south
      if ((j & 7) === 0) yield;
      for (let i = 0; i < n; i++) {
        let mx = 0;
        const c0 = Math.max(1, Math.floor(i * CELL / r)), c1 = Math.min(W - 2, Math.floor(((i + 1) * CELL) / r));
        const r0 = Math.max(1, Math.floor((this.size - (j + 1) * CELL) / r)), r1 = Math.min(H.h - 2, Math.floor((this.size - j * CELL) / r));
        for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
          const k = rr * W + cc, gx = (z[k + 1] - z[k - 1]) / (2 * r), gy = (z[k + W] - z[k - W]) / (2 * r), s = gx * gx + gy * gy;
          if (s > mx) mx = s;
        }
        mask[j * n + i] = Math.round(Math.atan(Math.sqrt(mx)) * 180 / Math.PI);
      }
    }
    this.mask = mask; this.stats.maskMs = Math.round(performance.now() - t0);
    let steep = 0; for (const v of mask) if (v > CLIFF_DEG) steep++;
    this.stats.steepCells = steep;
  }

  // The slabs of one cell: a Float32Array of records [16 matrix floats, pattern, wedge, area] (19 floats), or null.
  plan(i, j) {
    const id = j * this.n + i;
    if (this.plans.has(id)) return this.plans.get(id);
    let out = null;
    if (this.mask[id] > CLIFF_DEG) {
      const H = this.H, rnd = mulberry32(hash3(i, j, SALT)), recs = [], V = this._v, pDensity = 0.55;   // a slab group at 55% of the steep lattice points
      const at = (x, north) => H.at(x, north);
      for (let gy = 0; gy < CELL / LATTICE; gy++) for (let gx = 0; gx < CELL / LATTICE; gx++) {
        const x = i * CELL + (gx + 0.5) * LATTICE + (rnd() - 0.5) * LATTICE, north = j * CELL + (gy + 0.5) * LATTICE + (rnd() - 0.5) * LATTICE;
        const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd(), r6 = rnd(), r7 = rnd();   // drawn first: a skip moves nothing else
        if (x < 3 || north < 3 || x > this.size - 3 || north > this.size - 3) continue;
        const ge = (at(x + 4, north) - at(x - 4, north)) / 8, gn = (at(x, north + 4) - at(x, north - 4)) / 8;   // over +-4 m: the 1 m ground's roughness is not a cliff
        const slope = Math.atan(Math.hypot(ge, gn)) * 180 / Math.PI;
        if (slope < CLIFF_DEG + 2 * (r1 - 0.5) * 4 || r2 > pDensity) continue;
        if (slope < 62 && this.treeAt(x, north) > 0.45) continue;   // a wooded steep slope is soil, as the terrain's cliff material holds off it
        const pat = this.patternAt(x, north), y = at(x, north);
        V.n.set(-ge, 1, gn).normalize();
        V.u.set(0, 1, 0).addScaledVector(V.n, -V.n.y).normalize();   // up the face
        V.a.crossVectors(V.u, V.n);                                   // along it, horizontal
        const P = [x, y, -north];
        if (pat === 1) {
          // sizes heavy-tailed (most sheets a few metres, some 15-20 m), edges off the vertical joints by up to 8 degrees,
          // a quarter on the diagonal set (35 degrees: dihedrals and ramps), roofs one in four
          // big facets: sheets and buttresses 8-25 m along the face and 12-40 m up it, 2-6 m thick, their edges off the
          // vertical joints by up to 8 degrees, one in eight on the diagonal set (35 degrees: a dihedral's ramp); roofs
          // one in five; a smaller sheet on a third of them, standing further out
          const phi = (r3 < 0.125 ? (r3 < 0.0625 ? 1 : -1) * 0.6 : 0) + (r4 - 0.5) * 0.28;
          this.slab(recs, P, V, phi, 8 + 17 * r5 * r5, 12 + 28 * r6 * r6, 2 + 4 * r4, 0, pat, r7 < 0.2);
          if (r7 > 0.66) this.slab(recs, [P[0] + V.u.x * 6 * (r3 - 0.5), P[1] + V.u.y * 6 * (r3 - 0.5), P[2] + V.u.z * 6 * (r3 - 0.5)], V, phi + (r5 - 0.5) * 0.2, 3 + 7 * r6, 5 + 10 * r4, 1 + 1.5 * r3, 1 + 2 * r4, pat, false);
        } else if (pat === 2) {
          const tilt = (r3 < 0.5 ? 1 : -1) * (0.35 + 0.26 * r4), nb = 2 + Math.floor(r5 * 3);
          for (let b = 0; b < nb; b++) {
            const off = (b - (nb - 1) / 2) * (1.1 + 0.6 * r6);
            this.slab(recs, [P[0] + V.u.x * off, P[1] + V.u.y * off, P[2] + V.u.z * off], V, tilt + 0.05 * (r7 - 0.5), 2 + 4 * ((r7 + b * 0.37) % 1), 0.5 + 1.0 * ((r6 + b * 0.61) % 1), 0.4 + 0.8 * ((r4 + b * 0.29) % 1), 0, pat, false);
          }
        } else {
          const nc = 1 + Math.floor(r5 * 3);
          for (let b = 0; b < nc; b++) {
            const s = 1 + 2.5 * ((r6 + b * 0.43) % 1), da = (((r3 + b * 0.71) % 1) - 0.5) * 4, du = (((r4 + b * 0.37) % 1) - 0.5) * 4;
            this.slab(recs, [P[0] + V.a.x * da + V.u.x * du, P[1] + V.u.y * du, P[2] + V.a.z * da + V.u.z * du], V, ((r7 + b * 0.53) % 1) * Math.PI, s, s * (0.7 + 0.5 * r5), s * (0.6 + 0.6 * r3), 0, pat, false);
          }
        }
      }
      if (recs.length) out = Float32Array.from(recs);
    }
    this.plans.set(id, out);
    return out;
  }
  // One slab at surface point P on the face (V: its normal n, up u, along a), turned phi in the face, w along, h up, t
  // thick, extra standoff `lift` (a sheet over another), seated so its back is inside the ground (see the header).
  slab(recs, P, V, phi, w, h, t, lift, pat, wedge) {
    const c = Math.cos(phi), s = Math.sin(phi), a2 = V.a2.copy(V.a).multiplyScalar(c).addScaledVector(V.u, s), u2 = V.u2.copy(V.u).multiplyScalar(c).addScaledVector(V.a, -s), n = V.n, H = this.H;
    let worst = -Infinity;
    for (let q = 0; q < 9; q++) {
      const fa = ((q % 3) - 1) * 0.5 * w, fu = (Math.floor(q / 3) - 1) * 0.5 * h;
      const qx = P[0] + a2.x * fa + u2.x * fu, qy = P[1] + a2.y * fa + u2.y * fu, qz = P[2] + a2.z * fa + u2.z * fu;
      const d = (qy - H.at(qx, -qz)) * n.y;   // the ground's signed distance (a plane's exactly)
      if (d > worst) worst = d;
    }
    const back = -worst - 0.25, front = back + t + lift;   // the back face's offset along n; the front's
    if (front < 0.4 || front > 7) return;
    const mid = back + t / 2 + lift, cx = P[0] + n.x * mid, cy = P[1] + n.y * mid, cz = P[2] + n.z * mid;
    recs.push(a2.x * w, a2.y * w, a2.z * w, 0, u2.x * h, u2.y * h, u2.z * h, 0, n.x * t, n.y * t, n.z * t, 0, cx, cy, cz, 1, pat, wedge ? 1 : 0, w * h);
  }

  // Warm the cells around the start (main.js steps this in slices before the first frame).
  *warm(x, z) {
    yield* this.maskSteps();
    const J = this.start(x, -z);
    while (!this.run(J, 8)) yield;
    this.commit(J);
  }
  start(x, north) {
    const n = this.n, ci = Math.floor(x / CELL), cj = Math.floor(north / CELL), R = Math.ceil(FAR_R / CELL), cells = [];
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const d = Math.hypot(di, dj) * CELL; if (d > FAR_R) continue;
      if (this.mask[j * n + i] > CLIFF_DEG) cells.push(j * n + i);
    }
    this.stage.box.n = this.stage.wedge.n = 0;
    return { x, north, cells, k: 0, ms: 0, frames: 0 };
  }
  run(J, budget) {
    const t0 = performance.now(), n = this.n, S = this.stage;
    J.frames++;
    while (J.k < J.cells.length) {
      const id = J.cells[J.k++], i = id % n, j = (id - i) / n, recs = this.plan(i, j);
      if (recs) {
        const far = Math.hypot((i + 0.5) * CELL - J.x, (j + 0.5) * CELL - J.north) > NEAR_R * 1.3 + CELL;
        for (let r = 0; r < recs.length; r += 19) {
          const area = recs[r + 18], small = area < BIG_AREA;
          if (far && small) continue;
          const T = recs[r + 17] ? S.wedge : S.box, cap = T.p.length;
          if (T.n >= cap) continue;
          T.m.set(recs.subarray(r, r + 16), T.n * 16); T.p[T.n] = recs[r + 16]; T.s[T.n] = small ? 1 : 0; T.n++;
        }
      }
      if (performance.now() - t0 > budget) { J.ms += performance.now() - t0; return false; }
    }
    J.ms += performance.now() - t0;
    return true;
  }
  commit(J) {
    for (const [mesh, T] of [[this.box, this.stage.box], [this.wedge, this.stage.wedge]]) {
      mesh.instanceMatrix.array.set(T.m.subarray(0, T.n * 16)); mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.needsUpdate = true;
      const ap = mesh.geometry.attributes.aPat, as = mesh.geometry.attributes.aSmall;
      ap.array.set(T.p.subarray(0, T.n)); ap.needsUpdate = true; as.array.set(T.s.subarray(0, T.n)); as.needsUpdate = true;
      mesh.count = T.n;
    }
    this.centre = { x: J.x, north: J.north };
    const st = this.stats; st.builds++; st.cells = J.cells.length; st.slabs = this.stage.box.n; st.wedges = this.stage.wedge.n;
    st.lastMs = Math.round(J.ms * 10) / 10; st.lastFrames = J.frames; st.plans = this.plans.size;
  }
  // Each frame, with the camera: a rebuild when it has strayed REBUILD m from the last centre, a budget at a time.
  update(camera) {
    if (!this.mask || !this.on) return;
    const x = camera.position.x, north = -camera.position.z, c = this.centre;
    if (!this.job && (!c || Math.hypot(x - c.x, north - c.north) > REBUILD)) this.job = this.start(x, north);
    if (this.job) {
      const t0 = performance.now();
      if (this.run(this.job, BUDGET_MS)) { this.commit(this.job); this.job = null; }
      this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, performance.now() - t0);
    }
  }
  // A/B: off hides the slabs (and their shadows follow the group's visibility)
  set(on) { this.on = on; this.group.visible = on; }
}
