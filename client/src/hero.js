import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { animalMaterial } from './animalModels.js';
import { skeletonOf } from './gait.js';

// The hero tier (tools/hero_model.py; client/assets/hero/index.json lists the species that have one): the generated
// source's surface and textures on a clean mesh carrying the game's own skeleton, so the leg engine poses it unchanged.
//   the shared pool (animals.js buildTiers -> heroPool): hero lod1 as the pool's lod0 and hero lod2 as its lod1, the old
//     vertex-coloured mesh staying as lod2; maps at POOL_PX (the colour downscaled on load; the normal and occlusion maps
//     are made at 1024 and shared with the player's body); smooth shaded, normal and occlusion mapped, the coat's rim.
//   the player's own body (groundControl.js meshFor -> heroPlayer): hero lod0 with the colour at full size, and the fur's
//     shells: the body drawn again `shells` times in one instanced draw (gl_InstanceID the shell), each pushed out along
//     the skinned normal by its share of the hair length (TEXCOORD_1.x times the species' length in metres), strands from a
//     hash of the UV that fade to their mean coverage where a strand is under a pixel (no crawl), thinning to the tips.
// Everything loads lazily after the old tiers draw and swaps in on a frame once its program is compiled and its textures
// are uploaded; what it replaces is disposed. A species with no entry is untouched.
// Switches: ?hero=0 (none of it), ?fur=<shells> (0 no shells; default SHELLS), ?rim=0; live: __weHero.shells, .rim.value.
// The skeleton (the coordinator's note, 2026-11-11): the hero GLB's extras.skin is the species' skeleton when its joint
// count matches the clip texture's; a hero skeleton with more joints than the clips (Ear.L, Ear.R as 20 and 21) draws on
// the first ones, the extra joints' weights given to their parent (the head) until the clips are baked that wide.

const BASE = new URL('../assets/hero/', import.meta.url);
const Q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
export const HERO_ON = Q.get('hero') !== '0';
export const POOL_PX = 1024;
export const SHELLS_MAX = 32;
const SHELLS = 8;   // the default: 16 looks the same at a third of the screen and costs twice (measured 2026-11-11)
export const heroSettings = {
  shells: Math.max(0, Math.min(SHELLS_MAX, Q.has('fur') ? Math.round(+Q.get('fur') || 0) : SHELLS)),
  rim: { value: Q.get('rim') === '0' ? 0 : 1 },
  density: { value: 1600 },   // strands per UV unit (the UV square spans the whole body: about 1 mm apart on a wolf's flank)
  bytes: {}, log: [],
};
if (typeof globalThis !== 'undefined') globalThis.__weHero = heroSettings;

let indexP = null;
export function heroIndex() {
  return indexP ||= fetch(new URL('index.json', BASE)).then(r => r.ok ? r.json() : null).catch(() => null);
}
export async function heroEntry(code) {
  if (!HERO_ON || !code) return null;
  const idx = await heroIndex();
  return idx?.species?.[code] || null;
}

// The hero GLB's own skin (extras.skin) when it has exactly n joints (loadTiers: a clip set baked wider than the fauna
// GLB's skeleton): the JSON chunk alone is parsed.
export async function heroSkinFor(code, n) {
  const e = code ? (await heroIndex())?.species?.[code] : null;   // (not gated by ?hero=0: the skeleton must match the clip texture whatever is drawn)
  if (!e || (e.joints && e.joints !== n)) return null;
  const buf = await (await fetch(new URL(e.glb || `${code}.glb`, BASE))).arrayBuffer(), dv = new DataView(buf);
  const js = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, dv.getUint32(12, true))));
  const sk = js.extras?.skin;
  return sk && sk.joints?.length === n ? sk : null;
}

// ---- the asset ----------------------------------------------------------------------------------------------------
const assets = new Map();
const texBytes = (img, px = 4) => { let w = img.width, h = img.height, b = 0; for (;;) { b += w * h * px; if (w === 1 && h === 1) break; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); } return b; };
function copyTex(src, image) {
  const t = new THREE.Texture(image);
  for (const k of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'channel']) t[k] = src[k];
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
export function loadHero(code) {
  if (!assets.has(code)) assets.set(code, (async () => {
    const e = await heroEntry(code); if (!e) return null;
    const url = new URL(e.glb || `${code}.glb`, BASE);
    const gltf = await new GLTFLoader().loadAsync(url.href);
    const objs = ['lod0', 'lod1', 'lod2'].map(n => gltf.scene.getObjectByName(n));
    if (objs.some(o => !o?.geometry)) throw new Error(`${url.pathname}: no lod0-lod2`);
    const geos = objs.map(o => o.geometry);
    for (const g of geos) if (!g.getAttribute('normal')) g.computeVertexNormals();
    const src = objs[0].material, color = src.map, normal = src.normalMap, ao = src.aoMap;
    if (!color) throw new Error(`${url.pathname}: no base colour map`);
    for (const t of [color, normal, ao]) if (t) t.anisotropy = 4;
    if (ao) ao.format = THREE.RedFormat;   // the occlusion is one channel (R8: a quarter of the bytes)
    // the pool's colour at POOL_PX, downscaled off the main thread; the normal and occlusion maps shared when already that size
    const small = async (t) => t && t.image.width > POOL_PX ? copyTex(t, await createImageBitmap(t.image, { resizeWidth: POOL_PX, resizeHeight: Math.round(POOL_PX * t.image.height / t.image.width), resizeQuality: 'high' })) : t;
    const [color1k, normal1k, ao1k] = await Promise.all([small(color), small(normal), small(ao)]);
    if (ao1k && ao1k !== ao) ao1k.format = THREE.RedFormat;
    for (const o of objs) if (o.material && o.material !== src) o.material.dispose();
    src.dispose();
    const extras = gltf.parser.json.extras || {};
    geos[0].computeBoundingBox();
    const bb = geos[0].boundingBox, height = bb.max.y - bb.min.y;
    // the longest hair (TEXCOORD_1.x = 1) in metres: extras.hero.hair_m, else by size (a wolf's 0.8 m at the withers: 3.5
    // cm, so 2.5 cm on its flank at a factor of 0.7)
    const hairM = +extras.hero?.hair_m > 0 ? +extras.hero.hair_m : 0.035 * Math.sqrt(Math.max(0.2, height) / 0.95);
    const used = new Set([color, color1k, normal, normal1k, ao, ao1k].filter(Boolean));
    const bytes = { player: 0, pool: 0, total: 0 };
    for (const t of used) {
      const b = texBytes(t.image, t.format === THREE.RedFormat ? 1 : 4);
      bytes.total += b;
      if (t === color || t === normal || t === ao) bytes.player += b;
      if (t === color1k || t === normal1k || t === ao1k) bytes.pool += b;
    }
    heroSettings.bytes[code] = bytes;
    return { code, url, extras, skin: extras.skin || null, geos, hairM,
      player: { map: color, normalMap: normal, aoMap: ao }, pool: { map: color1k, normalMap: normal1k, aoMap: ao1k } };
  })().catch(err => { console.warn(`hero ${code}: failed to load; the old tiers stay`, err); return null; }));
  return assets.get(code);
}

// Fit the hero to the model's clip texture (once per model): joints past the texture's width are given to their parent (the
// ears to the head), and the engine's skeleton takes the hero's rest positions (its corrected tail) when the joints are the
// same ones. Returns false when the hero cannot be drawn on this model's skin.
function fitSkin(model, asset) {
  const n = model.skin?.joints?.length || model.skin?.index?.joints?.length;
  if (!n || !asset.skin?.joints) return !!n;
  const hs = asset.skin, names = hs.joints;
  if (model.skin.joints && names.slice(0, Math.min(n, names.length)).some((nm, i) => nm !== model.skin.joints[i])) {
    console.warn(`hero ${asset.code}: its joints are not the clip set's; the old tiers stay`); return false;
  }
  if (names.length > n && !asset.remapped) {
    const head = names.indexOf('Head'), parent = j => (/^Ear/.test(names[j]) && head >= 0 && head < n ? head : 0);
    for (const g of asset.geos) {
      const si = g.getAttribute('skinIndex'); if (!si) continue;
      for (let i = 0; i < si.array.length; i++) if (si.array[i] >= n) si.array[i] = parent(si.array[i]);
      si.needsUpdate = true;
    }
    asset.remapped = true;
  }
  if (model.legs && !model.heroSkel && model.legs.n === Math.min(n, names.length) && model.legs.names.every((nm, i) => nm === names[i])) {
    const sk = names.length > n ? { ...hs, joints: names.slice(0, n), joint_rest: hs.joint_rest.slice(0, n), ears: undefined } : hs;
    try { Object.assign(model.legs, skeletonOf(sk)); model.heroSkel = true; } catch (err) { console.warn(`hero ${asset.code}: skeleton not taken`, err); }
  }
  return true;
}

// ---- swapping a mesh's geometry and material ------------------------------------------------------------------------
const INST = ['aAnim', 'aAnim2', 'aClip', 'aBend'];
const frame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 120); });
const ctx = () => { const w = globalThis.__we; return w?.renderer && w.scene && w.camera ? w : null; };
// compile the materials and upload the textures before the swap (each on its own frame), so the swap does not hitch
async function warm(meshes, textures, c = ctx()) {
  if (!c) return;
  try {
    for (const t of textures) { if (t) { c.renderer.initTexture(t); await frame(); } }
    for (const m of meshes) await c.renderer.compileAsync(m, c.camera, c.scene);
  } catch (err) { console.warn('hero: warm-up failed (the swap compiles on first draw)', err); }
}
// mesh takes geo (its instance attributes carried over) and mat; the old ones are disposed unless keep
function swap(mesh, geo, mat, { keepGeo = false } = {}) {
  const old = mesh.geometry, oldMat = mesh.material;
  for (const n of INST) { const a = old.getAttribute(n); if (a) { geo.setAttribute(n, a); old.deleteAttribute(n); } }
  for (const k of ['stencilWrite', 'stencilRef', 'stencilFunc', 'stencilZPass']) mat[k] = oldMat[k];   // a herd's stencil mark (herdSilhouette.js)
  mesh.geometry = geo; mesh.material = mat;
  if (!keepGeo) old.dispose();
  if (oldMat !== mat) oldMat.dispose();
}
const pending = (geo, src) => { for (const n of INST) { const a = src.getAttribute(n); if (a) geo.setAttribute(n, a); } return geo; };

// The species' shared pool: st.tiers[0] and [1] (InstancedMeshes) take hero lod1 and lod2. decorate: animals.js's
// selfLit for a playable species.
export async function heroPool(code, st, model, { atmosphere, decorate = null } = {}) {
  if (!HERO_ON || !st?.tiers || st.tiers.length < 3 || !model.skin) return false;
  const asset = await loadHero(code); if (!asset || !fitSkin(model, asset)) return false;
  const P = asset.pool, mats = [], geos = [asset.geos[1], asset.geos[2]];
  for (let t = 0; t < 2; t++) {
    const m = animalMaterial(atmosphere, model, { map: P.map, hero: { normalMap: P.normalMap, aoMap: P.aoMap, rim: heroSettings.rim } });
    mats.push(decorate ? decorate(m) : m);
  }
  // warm on stand-ins carrying the live instance attributes (nothing is drawn from them)
  const probes = geos.map((g, t) => { const p = new THREE.InstancedMesh(pending(g, st.tiers[t].geometry), mats[t], 1); p.frustumCulled = false; return p; });
  await warm(probes, [P.map, P.normalMap, P.aoMap]);
  for (let t = 0; t < 2; t++) {
    swap(st.tiers[t], geos[t], mats[t]);
    if (st.planar?.[t]) st.planar[t].geometry = geos[t];
    if (model.maps) model.maps[t] = P.map;   // anything else made from these tiers (animals.js skeinMesh) draws them textured
  }
  heroSettings.log.push(`${code}: pool on hero lod1/lod2`);
  return true;
}

// The player's body (groundControl.js meshFor): hero lod0, the full maps, and the shells. Returns the handle or null.
export async function heroPlayer(code, mesh, model, { atmosphere, head = null, warmCtx } = {}) {
  if (!HERO_ON || !model.skin) return null;
  const asset = await loadHero(code); if (!asset || !fitSkin(model, asset)) return null;
  const P = asset.player, geo = asset.geos[0].clone();
  const mat = animalMaterial(atmosphere, model, { map: P.map, head, hero: { normalMap: P.normalMap, aoMap: P.aoMap, rim: heroSettings.rim } });
  const fur = { shells: { value: Math.max(1, heroSettings.shells) }, len: { value: asset.hairM }, density: heroSettings.density };
  const shellMat = animalMaterial(atmosphere, model, { map: P.map, head, hero: { normalMap: P.normalMap, aoMap: P.aoMap, rim: heroSettings.rim, shells: fur } });
  const probe = new THREE.InstancedMesh(pending(geo, mesh.geometry), mat, 1); probe.frustumCulled = false;
  const shellProbe = new THREE.InstancedMesh(geo, shellMat, 1); shellProbe.frustumCulled = false;
  await warm([probe, shellProbe], [P.map, P.normalMap, P.aoMap], warmCtx || ctx());
  swap(mesh, geo, mat);
  // the shells: a child of the body (its visibility and frame), sharing the body's vertex buffers; its instance attributes
  // views of the body's arrays read once for all the shells (meshPerAttribute), re-uploaded each frame
  const sg = new THREE.BufferGeometry();
  sg.setIndex(geo.index);
  for (const [n, a] of Object.entries(geo.attributes)) if (!a.isInstancedBufferAttribute) sg.setAttribute(n, a);
  const views = [];
  for (const n of INST) { const a = geo.getAttribute(n); if (a) { const v = new THREE.InstancedBufferAttribute(a.array, a.itemSize, false, SHELLS_MAX); sg.setAttribute(n, v); views.push(v); } }
  const shell = new THREE.InstancedMesh(sg, shellMat, SHELLS_MAX);
  shell.instanceMatrix = new THREE.InstancedBufferAttribute(mesh.instanceMatrix.array, 16, false, SHELLS_MAX);
  views.push(shell.instanceMatrix);
  shell.frustumCulled = false; shell.castShadow = false; shell.receiveShadow = false; shell.name = `${mesh.name} fur`; shell.renderOrder = 2;
  shell.count = heroSettings.shells;
  shell.onBeforeRender = () => {
    for (const v of views) v.needsUpdate = true;
    const n = heroSettings.shells; shell.count = n; fur.shells.value = Math.max(1, n);
  };
  shell.visible = heroSettings.shells > 0;
  mesh.add(shell);
  const h = { code, shell, fur, geo, asset, setShells(n) { heroSettings.shells = Math.max(0, Math.min(SHELLS_MAX, n | 0)); shell.visible = heroSettings.shells > 0; } };
  (heroSettings.players ||= []).push(h);
  heroSettings.log.push(`${code}: player body on hero lod0, ${heroSettings.shells} shells, hair ${(asset.hairM * 100).toFixed(1)} cm`);
  return h;
}
Object.defineProperty(heroSettings, 'setShells', { value: n => { heroSettings.shells = Math.max(0, Math.min(SHELLS_MAX, n | 0)); for (const h of heroSettings.players || []) h.shell.visible = heroSettings.shells > 0; } });
