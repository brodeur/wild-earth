import * as THREE from 'three';
import { uniforms as atmo } from './atmosphere.js';
import { groundUniforms } from './terrain.js';
import { NEAR_R, VARIANTS, handover } from './vegetation.js';
import { WIND_GLSL, windUniforms } from './wind.js';
import { LEAF_WAVE_GLSL, CROWN_SWAY, CROWN_FLEX } from './treegen.js';

// Cascaded sun shadows, hand-rolled. Three depth maps (hardware-compare depth textures) are
// rendered from a shadow scene of proxies: meshes that share the real ones' geometry and instance
// buffers but draw depth only, so the caster set can differ per cascade and the lit materials keep
// a single sun. Receivers read the maps through csmShadow() in atmosphere.js: the terrain and the
// lambert trees and raven with four PCF taps and a normal offset, and everything that shades by the
// sun per vertex (grass, shrub field, impostors) with one tap inside cloudShadow().
//
// Cascades are square boxes around a ground point a little ahead of the camera, in a light space
// whose axes depend only on the sun, so turning the camera never moves a texel; the box centre is
// snapped to the texel grid (cascade 0) or to a coarser grid (1, 2) so the far maps re-render only
// every ~20 m and ~80 m of travel. Cascade 0 re-renders every frame while it is on (the raven
// moves and flaps); it is off when the camera is too high above the ground for any of it to be
// within its range.
//
// Casters per cascade:
//   0 (+-120 m, 2048): terrain (back faces), every near-set plant's leaf cards (the near tier's,
//      also inside the close tier's range: same spray texture, half the triangles of the close
//      cards) and trunk (the mid tier's trunk mesh on the near matrices: same skeleton, a tenth of
//      the triangles), the raven, and whatever was registered with addCaster (the animals)
//   1 (+-600 m, 2048): terrain; within NEAR_R of the bird the near trees as in cascade 0, beyond
//      it a depth-only ellipsoid per crown on the mid-tier matrices. This is the map the start view
//      (150 m up) sees everything through, so it gets 0.6 m texels and real crowns where they are
//      big on screen; it re-renders every ~19 m of travel.
//   2 (+-2500 m, 1024): terrain, the ellipsoids for every mid-set plant within the far hand-over
//      radius (vegetation.js handover), and beyond it a sun-facing ellipse of the same crown per far
//      impostor, grown and thinned as the impostor is (impostors.js casterMaterial), so the forest
//      beyond the real trees shades its ground and itself (4.9 m texels: crowns as soft dapple, ridges
//      as long dusk shadows). The ellipses are their own instance buffer (half the impostors within
//      4.5 km, each twice the area); they cost only when this map re-renders (about every 80 m).
// The ellipsoids carry a thin post for the bare trunk under a high crown, so a pine's shadow stays
// joined to its base. The clump fields (shrubfield.js: chaparral shrubs and grass tussocks, camera-
// facing impostors) cast into cascades 0 and 1 as sun-facing ellipses from the same instance data,
// so the chaparral carpet and the grassland get contact shadows (only clumps the field submitted,
// i.e. those in view).
// The terrain draws only its back faces from the sun: the ridge silhouettes that cast are kept,
// and a sunlit slope has nothing of its own in the map to self-shadow against.
//
// Moving casters from other modules: addCaster(object3d, { cascades, simple, material }) gives every
// mesh under object3d a depth proxy in the shadow scene that shares its geometry (and, for an
// InstancedMesh, its instance buffer: the proxy draws the source's live count) and copies its world
// matrix, visibility and skin every frame; removeCaster(object3d) takes them out. simple: a plain
// depth material (the rigid shape, skinning included); otherwise `material`, else the source's
// customDepthMaterial, so a vertex-shader pose (a wingbeat) is in the shadow too. Cascade 0 is
// re-rendered every frame, so casters there move with their objects; in cascades 1 and 2 a caster
// moves only when that map re-renders for its own reasons. The module-level addCaster/removeCaster
// below route to the live Shadows (and queue until one exists), so a module that is not handed the
// Shadows instance can still register: animals.js does.

const DEG = Math.PI / 180;
// grid: snap step for the box centre, in texels. double: cascade 0 re-renders every frame, so it is
// double buffered: each frame renders into the back map while the main pass samples the one
// rendered a frame earlier. A pass the main pass does not depend on overlaps with it on the GPU;
// sampling a map rendered the same frame serialises the two and cost ~2.4 ms more at 20 m in the
// oak woodland (M-series, ANGLE/Metal). The price is one frame of latency on the raven's shadow.
export const CASCADES = [
  { range: 120, size: 2048, grid: 1, double: true },
  { range: 600, size: 2048, grid: 32, double: false },
  { range: 2500, size: 1024, grid: 16, double: false },
];
const L0 = 1 << 1, L1 = 1 << 2, L2 = 1 << 3;   // layer bits per cascade (layer 0 unused)

// The near casters move with the wind as the lit meshes do (2026-10-29, Aaron: the shadows should sway and flex with
// the crowns): the near cards take the crown's wave, their jitter and the limbs' flex, the near trunks the flex
// (treegen.js LEAF_WAVE_GLSL, the same functions and uniforms, so a leaf's shadow is where the leaf is). Cascade 0
// re-renders every frame, so the shadows within 120 m move; cascade 1 keeps the pose it last rendered.
const DEPTH_VERT = /* glsl */`
  uniform vec3 lodEye; uniform float lodR; uniform vec2 farR;
  #if defined(CANOPY) || defined(TRUNK)
    ${WIND_GLSL}
    ${LEAF_WAVE_GLSL}
  #endif
  #ifdef CANOPY
    attribute float leafRank; varying float vRank;
  #endif
  #ifdef ALPHA
    varying vec2 vUv;
  #endif
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = m * instanceMatrix;
    #endif
    #ifdef CANOPY
      vRank = leafRank;
    #endif
    #ifdef ALPHA
      vUv = uv;
    #endif
    vec3 base = m[3].xyz;
    bool drop = false;
    #ifdef LOD_NEAR
      drop = drop || distance(base.xz, lodEye.xz) > lodR;
    #endif
    #ifdef LOD_MID   // the near trees inside lodR, the far impostors' casters beyond the far hand-over
      float dm = distance(base.xz, lodEye.xz);
      drop = drop || dm < lodR || dm > farR.x;
    #endif
    vec3 pos = position;
    #if defined(USE_INSTANCING) && (defined(CANOPY) || defined(TRUNK))
    if (!drop) {   // the wind: as the lit near cards and trunks (treegen.js shimmerVertex, trunkFlex)
      vec3 wp = (m * vec4(position, 1.0)).xyz, rel = wp - base;
      float slow = smoothstep(0.15, 0.75, wNoise((wp.xz - windDir * time * 4.0) * 0.045)), ph = fract(dot(base.xz, vec2(0.1031, 0.1173)));
      #ifdef CANOPY
        pos += crownLocal(m, crownSwayW(rel, crownMicro(rel, leafRank), slow, leafRank, 1.0) + crownFlexW(rel, slow, ph));
      #else
        pos += crownLocal(m, crownFlexW(rel, slow, ph));
      #endif
    }
    #endif
    gl_Position = drop ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * (m * vec4(pos, 1.0));
  }`;
const DEPTH_FRAG = /* glsl */`
  uniform sampler2D map; uniform float leafOn;
  #ifdef CANOPY
    varying float vRank;
  #endif
  #ifdef ALPHA
    varying vec2 vUv;
  #endif
  void main() {
    #ifdef CANOPY
      if (vRank >= leafOn) discard;
    #endif
    #ifdef ALPHA
      if (texture2D(map, vUv).a < 0.5) discard;
    #endif
    gl_FragColor = vec4(1.0);
  }`;

// Clump fields: the impostor's own size, density LOD and wind lean (shrubfield.js VERT), but the
// quad faces the sun and the LOD distance is from the eye, not the shadow camera.
const CLUMP_VERT = /* glsl */`
  ${WIND_GLSL}
  uniform vec2 kParams; uniform vec4 band; uniform float heightScale; uniform vec3 viewEye; uniform vec3 sunDir;
  attribute vec4 iPos; attribute vec4 iVar;
  varying vec2 vQ;
  void main() {
    float R = iPos.w, H = iVar.x, kind = iVar.z, rank = iVar.w;
    bool grass = kind > 1.5;
    float d = distance(viewEye, iPos.xyz);
    float keep = clamp(kParams.x * kParams.x / max(d * d, 1.0), kParams.y, 1.0);
    float s = smoothstep(0.0, 0.05, keep - rank) * smoothstep(band.x, band.y, d) * (1.0 - smoothstep(band.z, band.w, d));
    if (s < 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float grow = inversesqrt(keep);
    if (grass) H *= heightScale;
    R *= grow * s; H *= sqrt(grow) * s;
    vec3 C = iPos.xyz + vec3(0.0, H * 0.5, 0.0);
    C.xz += windDir * windStrength * gust(iPos.xz) * (grass ? 0.35 : 0.06) * H;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), sunDir) + vec3(1e-4, 0.0, 0.0));
    vec3 up = cross(sunDir, right);
    float ce = up.y, se = sqrt(max(1.0 - ce * ce, 0.0));
    float ev = sqrt(H * H * 0.25 * ce * ce + R * R * se * se);
    vQ = position.xy;
    vec3 p = C + (right * position.x * R + up * position.y * ev) * 0.9;   // a little inside the lobed outline
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const CLUMP_FRAG = /* glsl */`
  varying vec2 vQ;
  void main() { if (dot(vQ, vQ) > 1.0) discard; gl_FragColor = vec4(1.0); }`;

// Unit octahedron (32 triangles) scaled to a crown's bounds, plus a 0.5 m post from the ground to
// the crown base when that is more than a metre up. Positions only: the depth pass needs nothing else.
function crownCaster(box, unit) {
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const ell = unit.clone().scale(size.x * 0.85, size.y * 0.9, size.z * 0.85).translate(c.x, c.y, c.z);
  const parts = [ell.attributes.position.array];
  const base = c.y - size.y * 0.45;
  if (base > 1) parts.push(new THREE.BoxGeometry(0.5, base, 0.5).translate(0, base / 2, 0).toNonIndexed().attributes.position.array);
  const pos = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of parts) { pos.set(a, o); o += a.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

// Contact AO: one soft disc per near-set plant, crown-sized, max-blended into a top-down map.
const AO_VERT = /* glsl */`
  varying vec2 vQ;
  void main() {
    vQ = uv * 2.0 - 1.0;
    mat4 m = modelMatrix * instanceMatrix;
    gl_Position = projectionMatrix * viewMatrix * vec4(m[3].xyz + mat3(m) * vec3(position.x, 0.0, -position.y), 1.0);
  }`;
const AO_FRAG = /* glsl */`
  uniform float aoStrength;
  varying vec2 vQ;
  void main() {
    float d = length(vQ);
    gl_FragColor = vec4(aoStrength * pow(max(1.0 - d, 0.0), 1.6), 0.0, 0.0, 1.0);   // darkest at the trunk, gone at the crown edge
  }`;
const AO_RANGE = 128, AO_SIZE = 512, AO_MOVE = 48;

let current = null;            // the live Shadows, for the module-level addCaster / removeCaster
// object3d (held weakly: a torn-down world's late registrations must not keep it alive) -> options, registered before a
// Shadows existed
const queued = new Map();      // WeakRef(object3d) -> options
export function addCaster(object3d, opts) { if (current) current.addCaster(object3d, opts); else { unqueue(object3d); queued.set(new WeakRef(object3d), opts); } return object3d; }
export function removeCaster(object3d) { unqueue(object3d); current?.removeCaster(object3d); }
function unqueue(object3d) { for (const r of queued.keys()) { const o = r.deref(); if (!o || o === object3d) queued.delete(r); } }
// A world torn down before its Shadows was made (main.js): the casters it queued go with it.
export function forgetQueuedCasters() { queued.clear(); }

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const OUTSIDE = new THREE.Matrix4().set(0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1);

export class Shadows {
  constructor({ renderer, scene, tile, terrain, veg, raven, grass = null, far = null }) {
    this.renderer = renderer; this.mainScene = scene; this.tile = tile; this.veg = veg; this.raven = raven;
    this.scene = new THREE.Scene(); this.scene.matrixWorldAutoUpdate = false;
    this.U = { lodEye: { value: new THREE.Vector3() }, lodR: { value: NEAR_R }, farR: handover.r };   // near / ellipsoid / far hand-overs (vegetation.js)
    this.enabled = true; this.force = false;   // force: re-render every cascade every frame (worst-case timing)
    this.stats = { renders: [0, 0, 0] };
    const target = size => {
      const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
      depth.minFilter = depth.magFilter = THREE.LinearFilter; depth.compareFunction = THREE.LessEqualCompare;
      return new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, depthBuffer: true, depthTexture: depth, generateMipmaps: false });
    };
    this.cascades = CASCADES.map((c, i) => {
      const rts = c.double ? [target(c.size), target(c.size)] : [target(c.size)];
      const cam = new THREE.OrthographicCamera(-c.range, c.range, c.range, -c.range, -1000, 1000);
      cam.layers.set(i + 1);
      atmo[`csmMap${i}`].value = rts[0].depthTexture;
      atmo.csmTexel.value.setComponent(i, 2 * c.range / c.size);
      atmo.csmInvSize.value.setComponent(i, 1 / c.size);
      atmo.csmMatrix.value[i].copy(OUTSIDE);
      // back: index of the map to render into next; pending: a map rendered last frame, not yet shown
      return { ...c, rts, back: rts.length - 1, pending: null, cam, texel: 2 * c.range / c.size, key: '', on: false };
    });
    // Allocate and clear every map now: a shadow sampler bound to a texture that was never
    // allocated makes WebGL reject the draw, and cascade 0 may stay off for a long time.
    const prev = renderer.getRenderTarget();
    for (const c of this.cascades) for (const rt of c.rts) { renderer.setRenderTarget(rt); renderer.clear(true, true, false); }
    renderer.setRenderTarget(prev);
    this.lastSun = new THREE.Vector3(); this.sigNear = this.sigMid = '';
    this.hTop = tile.heights.max + 45; this.hBot = tile.heights.min - 5;
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._f = new THREE.Vector3();

    // Terrain: every chunk, back faces only, frustum-culled per cascade.
    const terrainMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide });
    for (const chunk of terrain.group.children) {
      const p = new THREE.Mesh(chunk.geometry, terrainMat);
      this.add(p, chunk, L0 | L1 | L2); p.frustumCulled = true;
    }
    // Vegetation proxies (built once; counts and visibility follow the real meshes every frame).
    this.vegProxies = [];
    const mat = (defines, src, side = src.side) => new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, defines, side, colorWrite: false,
      uniforms: { ...this.U, map: { value: src.map || null }, leafOn: src.userData.leafOn || { value: 1 },
        time: windUniforms.time, windDir: windUniforms.windDir, windStrength: windUniforms.windStrength, crownSway: CROWN_SWAY, crownFlex: CROWN_FLEX },
      // leaf cards are double sided and alpha tested: a little slope-scaled offset keeps the lit
      // side of a crown from shadowing itself in stripes
      polygonOffset: !!src.map, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
    });
    const trunkDepth = mat({ LOD_NEAR: '', TRUNK: '' }, veg.trunkMat.near, THREE.BackSide);
    const ellipsoidDepth = mat({ LOD_MID: '' }, { userData: {}, side: THREE.FrontSide }, THREE.BackSide);
    const unit = new THREE.OctahedronGeometry(0.5, 1);   // 32 triangles: the crown's mass, not its lace
    for (const [id, arr] of Object.entries(veg.meshes)) {
      const cm = veg.canopyMat[id];
      const nearDepth = mat({ LOD_NEAR: '', CANOPY: '', ...(cm.near.map ? { ALPHA: '' } : {}) }, cm.near);
      for (const e of arr) {
        this.addVeg(e.near.trunk, trunkDepth, L0 | L1, e.mid.trunk.geometry);
        this.addVeg(e.near.canopy, nearDepth, L0 | L1);
        // Mid tier: an ellipsoid the size of the crown's bounds, on the mid instance matrices.
        const g = e.mid.canopy.geometry; if (!g.boundingBox) g.computeBoundingBox();
        this.addVeg(e.mid.canopy, ellipsoidDepth, L1 | L2, crownCaster(g.boundingBox, unit), e.mid.trunk);
      }
    }
    // Far impostors (impostors.js): a crown ellipse per tree beyond the far hand-over, in cascade 2. The
    // crown of each baked tree is its mid canopy's bounds, as the ellipsoids above take it.
    this.far = far; this.farProxies = [];
    if (far) {
      const crowns = far.bake.frames.map(() => new THREE.Vector4(0, 0, 0, 0));
      far.bakeList.forEach(({ id, seed }, k) => {
        const e = veg.slots[id]?.[k % VARIANTS]; if (!e || e.seed !== seed) return;
        const g = e.mid.canopy.geometry; if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox, sz = b.getSize(this._v);
        crowns[far.bake.index[k]].set((b.min.y + b.max.y) / 2, sz.y * 0.45, (sz.x + sz.z) / 4 * 0.85, 0);
      });
      this.farProxies.push(this.add(new THREE.Mesh(far.casterMesh.geometry, far.casterMaterial(crowns)), far.casterMesh, L2));
    }
    // Clump fields (shrubfield.js), sharing their instanced geometry and uniforms.
    this.viewEye = { value: new THREE.Vector3() };
    this.clumpProxies = [];
    for (const f of [grass?.shrubs, grass?.clumps]) {
      if (!f?.mesh) continue;
      const m = new THREE.ShaderMaterial({ vertexShader: CLUMP_VERT, fragmentShader: CLUMP_FRAG, colorWrite: false, side: THREE.DoubleSide,
        uniforms: { ...f.uniforms, sunDir: atmo.sunDir, viewEye: this.viewEye } });
      const p = this.add(new THREE.Mesh(f.mesh.geometry, m), f.mesh, L0 | L1);
      this.clumpProxies.push(p);
    }
    // Contact AO map (see AO_VERT): every near trunk instance, a disc of its variant's crown radius.
    this.ao = {
      rt: new THREE.WebGLRenderTarget(AO_SIZE, AO_SIZE, { format: THREE.RedFormat, depthBuffer: false, generateMipmaps: false }),
      cam: new THREE.OrthographicCamera(-AO_RANGE, AO_RANGE, AO_RANGE, -AO_RANGE, -5000, 5000),
      scene: new THREE.Scene(), proxies: [], centre: null, version: -1,
    };
    this.ao.rt.texture.minFilter = this.ao.rt.texture.magFilter = THREE.LinearFilter;
    this.ao.scene.matrixWorldAutoUpdate = false;
    this.ao.cam.up.set(0, 0, -1);
    const aoMat = new THREE.ShaderMaterial({ vertexShader: AO_VERT, fragmentShader: AO_FRAG, uniforms: { aoStrength: { value: 0.45 } },
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false });
    for (const arr of Object.values(veg.meshes)) for (const e of arr) {
      const g = e.near.canopy.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const r = Math.max(1, 0.5 * Math.max(g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.z - g.boundingBox.min.z));
      const p = new THREE.InstancedMesh(new THREE.PlaneGeometry(2 * r, 2 * r), aoMat, 1);
      p.instanceMatrix = e.near.trunk.instanceMatrix; p.frustumCulled = false; p.matrixAutoUpdate = false;
      p.userData.src = e.near.trunk;
      this.ao.scene.add(p); this.ao.proxies.push(p);
    }
    renderer.setRenderTarget(this.ao.rt); renderer.clear(true, false, false); renderer.setRenderTarget(prev);
    groundUniforms.contactAO.value = this.ao.rt.texture;
    this.ravenCaster = false;   // the model loads asynchronously (sync() registers it)
    // addCaster registry: object3d -> proxies; casterVersion joins the caster signatures
    this.casters = new Map(); this.casterVersion = 0;
    this.simpleDepth = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    current = this;
    // casters queued before this Shadows existed: this world's (in its scene) only; a torn-down world's late loads
    // (its raven or an animal model arriving after main.js disposed it) are dropped, not adopted
    const inScene = o => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };
    for (const [r, opts] of queued) { const o = r.deref(); if (o && inScene(o)) this.addCaster(o, opts); }
    queued.clear();
    window.__shadows = this;    // alias for debugging only: register casters with addCaster
  }
  // Shader programs for the caster and contact-AO passes, compiled ahead of the first frame (main.js, behind the opening
  // screen): each proxy through renderer.compileAsync with the pass's own render target bound (its programs differ from
  // the screen's), so the GPU driver compiles them in parallel (KHR_parallel_shader_compile) instead of the first
  // shadow render stalling on them. Yields to the caller's slicer between proxies. Returns the compile promises.
  // known (a WeakSet, optional): proxies already compiled are skipped and the new ones added, so main.js can call this
  // again for casters registered later (rocks, animals) while the opening screen is up.
  async precompile(tick = null, known = null) {
    const r = this.renderer, prev = r.getRenderTarget(), out = [];
    const pass = async (scene, cam, rt) => {
      const objs = []; scene.traverse(o => { if (o.isMesh && !known?.has(o)) { known?.add(o); objs.push(o); } });
      for (const o of objs) {
        r.setRenderTarget(rt); out.push(r.compileAsync(o, cam, scene)); r.setRenderTarget(prev);
        if (tick?.due()) await tick.yield();
      }
    };
    await pass(this.scene, this.cascades[0].cam, this.cascades[0].rts[0]);
    await pass(this.ao.scene, this.ao.cam, this.ao.rt);
    return out;
  }
  // The world is being torn down (main.js disposes the proxies' materials and geometries with its scenes): the maps'
  // render targets go, the shared atmosphere uniforms let go of them, and the module stops routing casters here.
  dispose() {
    for (const c of this.cascades) for (const rt of c.rts) { rt.depthTexture?.dispose(); rt.dispose(); }
    this.ao.rt.dispose();
    this.cascades.forEach((c, i) => { atmo[`csmMap${i}`].value = null; });
    if (current === this) current = null;
    queued.clear();
    if (window.__shadows === this) delete window.__shadows;
  }
  // The same for proxies not in `known` yet, at once: the compile promises (empty when there are none).
  compileNew(known) {
    const r = this.renderer, prev = r.getRenderTarget(), out = [];
    for (const [scene, cam, rt] of [[this.scene, this.cascades[0].cam, this.cascades[0].rts[0]], [this.ao.scene, this.ao.cam, this.ao.rt]])
      scene.traverse(o => { if (o.isMesh && !known.has(o)) { known.add(o); r.setRenderTarget(rt); out.push(r.compileAsync(o, cam, scene)); r.setRenderTarget(prev); } });
    return out;
  }
  // See the header. cascades: indices into CASCADES (default [0]). Returns object3d.
  addCaster(object3d, { cascades = [0], simple = false, material = null } = {}) {
    if (this.casters.has(object3d)) this.removeCaster(object3d);
    let layers = 0; for (const i of cascades) layers |= 1 << (i + 1);
    const proxies = [];
    object3d.traverse(src => {
      if (!src.isMesh) return;
      const m = simple ? this.simpleDepth : material || src.customDepthMaterial || this.simpleDepth;
      let p;
      if (src.isInstancedMesh) { p = new THREE.InstancedMesh(src.geometry, m, 1); p.instanceMatrix = src.instanceMatrix; p.count = 0; }
      else if (src.isSkinnedMesh) { p = new THREE.SkinnedMesh(src.geometry, m); p.bind(src.skeleton, src.bindMatrix); p.bindMode = src.bindMode; }
      else p = new THREE.Mesh(src.geometry, m);
      p.name = (src.name || 'mesh') + ' caster';
      proxies.push(this.add(p, src, layers));
    });
    this.casters.set(object3d, proxies); this.casterVersion++;
    return object3d;
  }
  removeCaster(object3d) {
    const proxies = this.casters.get(object3d); if (!proxies) return;
    for (const p of proxies) this.scene.remove(p);   // geometry and materials belong to the source
    this.casters.delete(object3d); this.casterVersion++;
  }
  add(proxy, src, layers) {
    proxy.matrixAutoUpdate = false; proxy.matrixWorld.copy(src.matrixWorld); proxy.frustumCulled = false;
    proxy.layers.mask = layers; proxy.userData.src = src;
    this.scene.add(proxy);
    return proxy;
  }
  // countSrc: the mesh whose count to follow when it is not src (mid canopies keep a stale count
  // while hidden; the trunk's is always current)
  addVeg(src, material, layers, geometry = src.geometry, countSrc = src) {
    const p = new THREE.InstancedMesh(geometry, material, 1);
    p.instanceMatrix = src.instanceMatrix;   // the same buffer object: uploaded once, shared
    p.userData.countSrc = countSrc;
    this.vegProxies.push(this.add(p, src, layers));
  }
  buildRaven() {
    let n = 0; this.raven.group.traverse(o => { if (o.isMesh) n++; });
    if (!n) return;
    this.addCaster(this.raven.group, { cascades: [0], simple: true });
    this.ravenCaster = true;
  }
  // Mirror counts, visibility and transforms of the real meshes. Returns signatures of the caster
  // sets: [near tier (cascades 0, 1), mid tier (cascades 1, 2)].
  sync() {
    const vegOn = this.veg.group.visible && this.veg.group.parent !== null;
    let hn = 0, hm = 0;
    for (let i = 0; i < this.vegProxies.length; i++) {
      const p = this.vegProxies[i], s = p.userData.src;
      const n = p.userData.countSrc.count;
      p.count = n; p.visible = vegOn && s.visible && n > 0;
      if (!p.visible) continue;
      if (p.layers.mask & L2) hm = (hm * 31 + n * 7 + i) | 0; else hn = (hn * 31 + n * 7 + i) | 0;
    }
    if (!this.ravenCaster && this.raven.mixer) this.buildRaven();
    const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    for (const proxies of this.casters.values()) for (const p of proxies) {
      const s = p.userData.src;
      if (s.isInstancedMesh) { p.instanceMatrix = s.instanceMatrix; p.count = s.count; p.visible = s.count > 0 && shown(s); }
      else p.visible = shown(s);
      if (!p.visible) continue;
      p.matrixWorld.copy(s.matrixWorld);
      if (p.isSkinnedMesh) p.bindMatrixInverse.copy(s.bindMatrixInverse);
    }
    for (const p of this.clumpProxies) p.visible = shown(p.userData.src) && p.geometry.instanceCount > 0;
    for (const p of this.farProxies) { const s = p.userData.src; p.geometry = s.geometry; p.visible = shown(s) && s.geometry.instanceCount > 0; }
    return [`${hn}|${this.veg.nearVersion}|${this.casterVersion}`, `${hm}|${this.veg.version}|${this.casterVersion}`];
  }
  // Contact AO around the camera: re-rendered when the near set changes or the camera has moved AO_MOVE m.
  updateAO(camera) {
    const ao = this.ao, cp = camera.position, vegOn = this.veg.group.visible;
    const moved = !ao.centre || Math.hypot(cp.x - ao.centre.x, cp.z - ao.centre.z) > AO_MOVE;
    const sig = vegOn ? this.veg.nearVersion : -1;
    if (!moved && sig === ao.version) return;
    ao.version = sig;
    if (moved) ao.centre = new THREE.Vector3(cp.x, 0, cp.z);
    for (const p of ao.proxies) { p.count = p.userData.src.count; p.visible = vegOn && p.count > 0; }
    const cam = ao.cam;
    cam.position.set(ao.centre.x, 0, ao.centre.z); cam.lookAt(ao.centre.x, -1, ao.centre.z); cam.updateMatrixWorld();
    const r = this.renderer, prev = r.getRenderTarget(), clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0); r.setRenderTarget(ao.rt); r.render(ao.scene, cam);
    r.setRenderTarget(prev); r.setClearColor(clear, alpha);
    groundUniforms.contactAOMatrix.value.multiplyMatrices(BIAS, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }
  update(camera) {
    this.updateAO(camera);
    const sun = atmo.sunDir.value, elDeg = Math.asin(THREE.MathUtils.clamp(sun.y, -1, 1)) / DEG;
    // Long shadows of a sun within a few degrees of the horizon streak across whole hillsides at a
    // grazing angle: fade them out between 6 and 2 degrees.
    const strength = this.enabled ? THREE.MathUtils.smoothstep(elDeg, 2, 6) : 0;
    atmo.csmStrength.value = strength;
    // Show what the double-buffered cascades rendered last frame (map and matrix together).
    for (let i = 0; i < this.cascades.length; i++) {
      const c = this.cascades[i];
      if (!c.pending) continue;
      atmo[`csmMap${i}`].value = c.rts[c.pending.index].depthTexture;
      atmo.csmMatrix.value[i].copy(c.pending.matrix);
      c.pending = null;
    }
    if (strength <= 0) { this.sigNear = this.sigMid = ''; return; }
    this.mainScene.updateMatrixWorld();   // the raven's bones this frame (render() repeats it, cheaply)
    camera.updateMatrixWorld();
    const [sigNear, sigMid] = this.sync(), nearChanged = sigNear !== this.sigNear, midChanged = sigMid !== this.sigMid;
    this.sigNear = sigNear; this.sigMid = sigMid;
    const sunChanged = this.lastSun.dot(sun) < 0.9999995; if (sunChanged) this.lastSun.copy(sun);

    // Light space: z toward the sun, x horizontal, y = z cross x (up the slope of the light).
    const z = this._z.copy(sun), x = this._x.set(0, 1, 0).cross(z);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
    const y = this._y.crossVectors(z, x);
    this._m.makeBasis(x, y, z);
    const heights = this.tile.heights, cp = camera.position;
    const agl = cp.y - heights.atXZ(cp.x, cp.z);
    const fwd = camera.getWorldDirection(this._f); fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    const lod = this.veg.lodU;
    const r = this.renderer, prevTarget = r.getRenderTarget();
    for (let i = 0; i < this.cascades.length; i++) {
      const c = this.cascades[i];
      if (i === 0 && agl > c.range - 10) {   // nothing within reach: let cascade 1 take everything
        if (c.on) { c.on = false; c.key = ''; c.pending = null; atmo.csmMatrix.value[0].copy(OUTSIDE); }
        continue;
      }
      // Box centre: a ground point 0.3 ranges ahead, snapped in light space.
      const fx = cp.x + fwd.x * 0.3 * c.range, fz = cp.z + fwd.z * 0.3 * c.range;
      const f = this._v.set(fx, heights.atXZ(fx, fz), fz);
      const step = c.texel * c.grid;
      const u = Math.round(f.dot(x) / step) * step, v = Math.round(f.dot(y) / step) * step, w = Math.round(f.dot(z) / 50) * 50;
      const key = `${u},${v},${w}`;
      const casters = (i < 2 && nearChanged) || (i > 0 && midChanged);
      if (!(i === 0 || this.force || sunChanged || casters || key !== c.key || !c.on)) continue;
      c.key = key; c.on = true;
      const C = f.set(0, 0, 0).addScaledVector(x, u).addScaledVector(y, v).addScaledVector(z, w);
      // Depth range: every caster or receiver between the tile's lowest ground and its highest
      // tree top (or the bird), anywhere across the box. A low sun makes it long; 24-bit depth
      // over 18 km is still a millimetre.
      const zy = Math.max(z.y, 0.05), top = Math.max(this.hTop, cp.y + 5);
      const tMax = Math.min((top - C.y + c.range * y.y) / zy, 9000), tMin = Math.max((this.hBot - C.y - c.range * y.y) / zy, -9000);
      const cam = c.cam;
      cam.position.copy(C); cam.quaternion.setFromRotationMatrix(this._m);
      cam.near = -tMax; cam.far = -tMin; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      // LOD hand-overs for this cascade's casters (see the table at the top).
      this.U.lodEye.value.copy(lod.lodEye.value); this.viewEye.value.copy(cp);
      this.U.lodR.value = i === 0 ? 1e9 : i === 1 ? NEAR_R : 0;   // the near / ellipsoid hand-over is in cascade 1 only
      const matrix = (c.matrix ||= new THREE.Matrix4()).multiplyMatrices(BIAS, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      r.setRenderTarget(c.rts[c.back]); r.render(this.scene, cam);
      if (c.double) { c.pending = { index: c.back, matrix }; c.back = 1 - c.back; }
      else atmo.csmMatrix.value[i].copy(matrix);
      this.stats.renders[i]++;
    }
    r.setRenderTarget(prevTarget);
  }
}
