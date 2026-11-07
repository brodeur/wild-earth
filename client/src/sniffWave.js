import * as THREE from 'three';
import { rarityColor } from './animals.js';
import { soulLook, SOUL_BUBBLE, SOUL_BUBBLE_A, SOUL_BEACONS } from './spirit.js';
import { desireOf } from './desire.js';

// The sniff's shockwave (owner, 2026-11-06: "When an animal sniffs the air, everything around it that is edible glows
// briefly in a shockwave out from the player. The closest things pulse first, then the more distant things and so on...
// The most preferable stuff pulses the same way a mountain lion would while in spirit mode, the least preferable pulses
// like a common vole.").
//
// When the sniff starts (scent.js sniffing turns on: L, its slot, or the canids' and the lion's E), a ring runs out from
// the body over WAVE_T s to the body's smell reach (scent.js reach, at most WAVE_MAX m), drawn faintly on the ground (a
// line loop laid on the heights, RING_SEGS points), and every edible thing it passes pulses once as it reaches it, so the
// nearest first: the food plants (the near set's food trees, TREE_H m and over: an oak's acorns under it; forage.js
// candidates: the staged herbs, the near and impostor shrubs, the sward where its grass is food) and, for a hunter, its prey animals (games.json relations.predation: animals.js preySlots), each pulse
// FLASH_T s, rising and falling, then gone (the forage glow carries on as before).
//
// The pulses are smelled, not seen: drawn over the scene (no depth test), so a rabbit under a shrub or an oak's acorns
// under its crown show. Each pulse is a soul (spirit.js: the same quad, core and faint bubble, the same growth with the eye's distance) whose
// look is the food's desirability for this body this season (desire.js, pipeline/games.py): 0 pulses as the tile's vole
// soul does (its rarity colour, brightness and size), 1 as the mountain lion's (its rarity colour, and the beacon's
// brightness and size), and a food between is placed between them on the same scale (the rarity for the colour, and the
// brightness and size mixed). A food the tile gives no desirability takes DESIRE_UNKNOWN. main.js calls update(dt) every
// frame while the player is in a body; __we.sniffWave for tests (fire(), last: the wave's count of pulses).
const WAVE_T = 2.2, WAVE_MAX = 160, FLASH_T = 0.7, CAP = 384, RING_SEGS = 96, RING_LUM = 0.3, DESIRE_UNKNOWN = 0.5, TREE_H = 6;
const LOW = 'microtus_californicus', HIGH = 'puma_concolor';   // the common vole and the mountain lion: the scale's two ends

export class SniffWave {
  constructor({ tile, scene, camera, animals, forage, scent, flight, season }) {
    Object.assign(this, { tile, camera, animals, forage, scent, flight, season });
    this.t = 0; this.on = false; this.was = false; this.wave = null; this.items = []; this.last = null;
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2));
    this.pos = new Float32Array(CAP * 3); this.col = new Float32Array(CAP * 4); this.siz = new Float32Array(CAP * 2);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));   // rgb, the soul's brightness
    g.setAttribute('aSz', new THREE.InstancedBufferAttribute(this.siz, 2).setUsage(THREE.DynamicDrawUsage));    // the soul's size, the pulse's start (s)
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFlash: { value: FLASH_T }, uBubble: { value: SOUL_BUBBLE }, uBubbleA: { value: SOUL_BUBBLE_A } },
      vertexShader: /* glsl */`
        attribute vec3 aPos; attribute vec4 aCol; attribute vec2 aSz; uniform float uTime, uFlash, uBubble;
        varying vec2 vUv; varying float vI; varying vec3 vColor;
        void main() {
          float u = (uTime - aSz.y) / uFlash;
          vI = (u > 0.0 && u < 1.0) ? aCol.a * sin(3.14159 * u) : 0.0;     // up and down once as the ring passes
          vColor = aCol.rgb;
          float dc = distance(aPos, cameraPosition);
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          mv.xyz += normalize(-mv.xyz) * min(1.8, dc * 0.4);                // toward the eye (spirit.js's soul)
          mv.xy += position.xy * uBubble * aSz.x * mix(0.6, 4.0, smoothstep(6.0, 200.0, dc));
          vUv = position.xy;
          gl_Position = vI > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uBubble, uBubbleA; varying vec2 vUv; varying float vI; varying vec3 vColor;
        void main() {   // spirit.js's soul: the core and the wide faint bubble
          float r = length(vUv), rc = r * uBubble;
          float core = pow(max(0.0, 1.0 - rc), 1.8) * 0.9 + 0.5 * exp(-rc * rc * 22.0);
          float bubble = uBubbleA * exp(-r * r * 3.0) * (1.0 - smoothstep(0.8, 1.0, r));
          float a = (core + bubble) * vI;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });   // smelled, not seen: through the leaves and the shrubs
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.name = 'sniff pulses'; this.mesh.visible = false;
    scene.add(this.mesh);
    const rg = new THREE.BufferGeometry(); this.rpos = new Float32Array(RING_SEGS * 3);
    rg.setAttribute('position', new THREE.BufferAttribute(this.rpos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ringMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 0.92, 0.75), transparent: true, opacity: RING_LUM, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.ring = new THREE.LineLoop(rg, this.ringMat); this.ring.frustumCulled = false; this.ring.visible = false; this.ring.name = 'sniff ring'; this.ring.renderOrder = 10;
    scene.add(this.ring);
    this._c = new THREE.Color();
  }
  // the scale's two ends on this tile (the vole's soul and the mountain lion's), and a food's look between them
  ends() {
    const A = this.animals, L = A.speciesList(), r = code => { const k = L.findIndex(s => s.code === code); return k >= 0 ? A.rarity[k] : null; };
    const rLow = r(LOW) ?? 0, rHigh = r(HIGH) ?? 1;
    return { rLow, rHigh, low: soulLook(rLow, SOUL_BEACONS.has(LOW)), high: soulLook(rHigh, SOUL_BEACONS.has(HIGH)) };
  }
  look(d, E) {
    const r = E.rLow + (E.rHigh - E.rLow) * d, c = rarityColor(r, this._c);
    return { r: c.r, g: c.g, b: c.b, lum: E.low.lum + (E.high.lum - E.low.lum) * d, size: E.low.size + (E.high.size - E.low.size) * d };
  }
  // the wave from the body now: every edible thing within reach, its pulse timed by its distance
  fire() {
    const A = this.animals, P = this.flight.pos, code = A.observer, season = this.season(), reach = Math.min(WAVE_MAX, this.scent.reach || 0);
    if (!code || code === 'spirit' || !(reach > 0)) return 0;
    const speed = reach / WAVE_T, E = this.ends(), items = [], t0 = this.t;
    const add = (x, y, z, food, ref = null) => {
      if (items.length >= CAP) return;
      const d = Math.hypot(x - P.x, z - P.z); if (d > reach) return;
      const want = desireOf(this.tile, code, food, season);
      items.push({ x, y, z, ref, t0: t0 + d / speed, d: want ?? DESIRE_UNKNOWN, food, dist: d });
    };
    // the food trees of the near set (a deer's or a bear's valley oak: its acorns on the ground under it), then the herbs,
    // shrubs and sward (forage.js candidates)
    const ids = this.forage.ids;
    if (ids?.size) for (const q of this.forage.veg?.nearPlants || []) if (ids.has(q.species) && q.height >= TREE_H) add(q.x, q.y + 0.6, q.z, q.species);
    for (const p of this.forage.candidates?.(P.x, P.z, reach, CAP) || []) add(p.x, p.y + Math.min(0.6, p.r * 0.6), p.z, p.species);
    const k = A.speciesList().findIndex(s => s.code === code), prey = k >= 0 ? A.preySlots?.[k] : null;
    if (prey?.size) for (const a of A.list) if (prey.has(a.sp) && !a.dead && !a.culled && !a.gone && !a.remote) add(a.x, A.scentHeight(a) + 0.3, a.z, A.speciesList()[a.sp].code, a);
    items.sort((p, q) => p.t0 - q.t0);
    const n = items.length;
    for (let i = 0; i < n; i++) {
      const it = items[i], L = this.look(it.d, E);
      this.pos.set([it.x, it.y, it.z], i * 3); this.col.set([L.r, L.g, L.b, L.lum], i * 4); this.siz.set([L.size, it.t0], i * 2);
    }
    const g = this.mesh.geometry; g.instanceCount = n;
    for (const name of ['aPos', 'aCol', 'aSz']) g.attributes[name].needsUpdate = true;
    this.items = items; this.wave = { t0, x: P.x, z: P.z, reach, speed, end: t0 + WAVE_T + FLASH_T };
    this.mesh.visible = n > 0; this.ring.visible = true;
    this.last = { n, plants: items.filter(i => !i.ref).length, prey: items.filter(i => i.ref).length, reach, speed: +speed.toFixed(1) };
    return n;
  }
  update(dt, on = true) {
    this.t += dt; this.mat.uniforms.uTime.value = this.t;
    const sniffing = on && !!this.scent?.sniffing;
    if (sniffing && !this.was) this.fire();   // the sniff starts: a wave
    this.was = sniffing;
    const W = this.wave; if (!W) return;
    if (!on || this.t > W.end) { this.wave = null; this.mesh.visible = false; this.ring.visible = false; return; }
    // the animals move on: their pulses follow them
    let moved = false;
    for (let i = 0; i < this.items.length; i++) { const it = this.items[i], a = it.ref; if (!a) continue; this.pos[i * 3] = a.x; this.pos[i * 3 + 1] = this.animals.scentHeight(a) + 0.3; this.pos[i * 3 + 2] = a.z; moved = true; }
    if (moved) this.mesh.geometry.attributes.aPos.needsUpdate = true;
    // the ring: a faint line on the ground at the wave's front, fading as it runs out
    const r = Math.min(W.reach, (this.t - W.t0) * W.speed), H = this.animals.heights;
    if (r >= W.reach) this.ring.visible = false;
    else {
      for (let i = 0; i < RING_SEGS; i++) { const a = i / RING_SEGS * Math.PI * 2, x = W.x + Math.cos(a) * r, z = W.z + Math.sin(a) * r; this.rpos[i * 3] = x; this.rpos[i * 3 + 1] = H.atXZ(x, z) + 0.4; this.rpos[i * 3 + 2] = z; }
      this.ring.geometry.attributes.position.needsUpdate = true;
      this.ringMat.opacity = RING_LUM * (1 - r / W.reach);
    }
  }
  clear() { this.wave = null; this.was = false; this.mesh.visible = false; this.ring.visible = false; }
  dispose() { this.mesh.removeFromParent(); this.ring.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); this.ring.geometry.dispose(); this.ringMat.dispose(); }
}
