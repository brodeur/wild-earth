import * as THREE from 'three';
import { animalMaterial, animalDepthMaterial, hasAnim2 } from './animalModels.js';
import { addCaster } from './shadows.js';

// The playable fliers (owner's request 2026-10-26): the red-tailed hawk, the turkey vulture, the California scrub-jay
// and the Steller's jay, flown by the raven's own flight (flight.js RavenFlight) with the species' numbers
// (flight.setSpecies: FLIERS below), as the spirit flies it with its `spirit` flag: the same keys, the same landing by
// contact on the ground or a limb (perch.js; the hawk only on a snag or a pine, thick wood 5 m or more up; the vulture
// high in a big tree; the jays anywhere a raven stands), the same hops and pecks on foot, the chase camera scaled to
// the wingspan. H soars for the hawk and the vulture: a slow circle at their soaring speed that holds its height (and
// climbs a little), A / D tightening or opening it; for the jays it hovers as the raven's does. The raven (raven.js)
// is hidden; the bird drawn is the AI's model (animals.playerModel: the drawn lod0, else the procedural one) as one
// extra instance at the flight body, posed from the flight: wingbeats while it works (at the species' rate), set and
// bowed wings in a glide, the jays' tail fanned to land, the red-tail's wings swept back and tail closed in a steep
// fast dive, folded (the jays) or swept back (the soarers, whose wings are never folded) on a perch, the legs with a
// hop, the head down with a peck. The raven itself stays on RavenFlight as it was.

const TAU = Math.PI * 2;
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const conifer = rec => /^pinus_|^pseudotsuga|^calocedrus|^abies/.test(rec.species);

// Per species. flight: RavenFlight's sp (flight.js RAVEN_SP: cruise, vmax, sink, flap, climb, turn, attachV,
// contactG, landH, hop*, cam, perch, soar). beat: wingbeats (Hz) while it works; span: wingspan (m); near: the camera's
// near plane on the ground (m); feet: whether the model's origin is at its feet (the jays) or its body (the soarers'
// flight meshes, feet off: drawn at the flight body standing too).
export const FLIERS = {
  aphelocoma_californica: { short: 'scrubjay', common: 'California scrub-jay', model: 'scrub-jay', jay: true, feet: true, span: 0.39, beat: 11, near: 0.12,
    flight: { cruise: 7, vmax: 16, sink: 1.0, flap: 5, climb: 5, turn: 2.4, attachV: 6, contactG: 0.15, landH: 0.07,
      hopLen: 0.3, hopBack: 0.2, hopT: 0.16, hopH: 0.05, cam: 0.42 } },
  cyanocitta_stelleri: { short: 'stellers', common: "Steller's jay", model: 'stellers-jay', jay: true, feet: true, span: 0.45, beat: 10, near: 0.12,
    flight: { cruise: 8, vmax: 17, sink: 0.9, flap: 5, climb: 5, turn: 2.3, attachV: 6, contactG: 0.16, landH: 0.08,
      hopLen: 0.32, hopBack: 0.2, hopT: 0.17, hopH: 0.06, cam: 0.46 } },
  buteo_jamaicensis: { short: 'hawk', common: 'red-tailed hawk', model: 'hawk', span: 1.25, beat: 2.6, near: 0.3,
    flight: { cruise: 11, vmax: 45, sink: 0.45, flap: 5, climb: 5, turn: 1.25, attachV: 8, contactG: 0.4, landH: 0.25,
      hopLen: 0.45, hopBack: 0.3, hopT: 0.4, hopH: 0.12, cam: 1.05,
      perch: { r: 0.05, h: 5, rec: rec => rec.snag || conifer(rec) }, soar: { v: 9, r: 45, lift: 0.5 } } },
  cathartes_aura: { short: 'vulture', common: 'turkey vulture', model: 'vulture', span: 1.75, beat: 2.0, near: 0.35,
    flight: { cruise: 10, vmax: 26, sink: 0.3, flap: 4, climb: 4, turn: 1.0, attachV: 7, contactG: 0.45, landH: 0.3,
      hopLen: 0.45, hopBack: 0.3, hopT: 0.45, hopH: 0.12, cam: 1.35,
      perch: { r: 0.05, h: 4, rec: rec => rec.snag || conifer(rec) || rec.scale > 0.9 }, soar: { v: 9, r: 60, lift: 0.4, teeter: true } } },
};

export class FlierControl {
  constructor({ scene, camera, flight, raven, animals, atmosphere, say = null }) {
    Object.assign(this, { scene, camera, flight, raven, animals, atmosphere });
    this.on = false; this.code = null; this.S = null; this.body = null; this.size = 1;
    this.say = say;   // the ground control's toast (main.js)
    this.pose = { phase: 0, amp: 0, pose: 0, flick: 0, e0: 0, e1: 0 };
    this.meshes = new Map();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  // One instance of the AI's model per species (animals.playerModel), built once.
  meshFor(name) {
    let p = this.meshes.get(name);
    if (!p) {
      p = this.animals.playerModel(name).then(({ model, geometry }) => {
        const geo = geometry.clone(), rig = hasAnim2(model);
        geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        if (rig) geo.setAttribute('aAnim2', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        const mesh = new THREE.InstancedMesh(geo, animalMaterial(this.atmosphere, model, { map: model.maps?.[0] || null, head: this.flight.headYaw }), 1);   // head: the look (flight.js)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; mesh.name = `player ${name}`;
        mesh.customDepthMaterial = animalDepthMaterial(model);
        mesh.visible = false; this.scene.add(mesh);
        addCaster(mesh, { cascades: [0], simple: false });
        return { mesh, model, rig };
      }).catch(e => { console.warn(`flierControl: no player model for ${name}`, e); return null; });
      this.meshes.set(name, p);
    }
    return p;
  }
  useSpecies(code) {
    const S = FLIERS[code]; if (!S) return false;
    this.code = code; this.S = S; this.body = null;
    for (const [n, p] of this.meshes) if (n !== S.model) p.then(b => { if (b) b.mesh.visible = false; });
    this.meshFor(S.model).then(b => { if (this.S !== S) return; this.body = b; if (b) b.mesh.visible = this.on; });
    if (this.on) this.flight.setSpecies(S.flight);
    return true;
  }

  // On as `code` (a FLIERS key), or off (back to the spirit, which places itself).
  setOn(on, code = null) {
    this.flight.look = 0; this.flight.headYaw.value = 0;   // the look (flight.js) starts straight; its limit is the raven's
    on = !!on;
    if (on && code && code !== this.code) this.useSpecies(code);
    if (on && !this.S) this.useSpecies('buteo_jamaicensis');
    if (on === this.on) return;
    this.on = on;
    const f = this.flight;
    f.setSpecies(on ? this.S.flight : null);
    this.raven.setHidden(on);
    f.body.visible = !on && f.view === 'chase';
    if (this.body) this.body.mesh.visible = on;
    if (!on) { for (const p of this.meshes.values()) p.then(b => { if (b) b.mesh.visible = false; }); f.hover = false; }
    if (on) this.nearWas = this.camera.near;
    this.camera.near = on ? this.S.near : this.nearWas || 0.5; this.camera.updateProjectionMatrix();
    this.hud(on);
  }
  hud(on) {
    const $ = id => document.getElementById(id), h1 = $('hud')?.querySelector('h1'), help = $('help'), S = this.S;
    if (!this.hudWas) this.hudWas = { h1: h1?.firstChild?.nodeValue, help: help?.innerHTML };
    const W = this.hudWas, k = s => `<kbd>${s}</kbd>`;
    if (h1?.firstChild) h1.firstChild.nodeValue = on ? `${S.common} ` : W.h1;
    if (help) help.innerHTML = on ? `${k('↑')}${k('↓')} pitch · ${k('←')}${k('→')} turn · ${k('W')}${k('S')} speed (${k('shift')} boost) · ${k('space')} flap · `
      + `${k('X')}${k('Z')} climb / descend · ${k('H')} ${S.flight.soar ? 'soar in a circle' : 'hover'} · fly slowly into a limb${S.flight.perch ? ' (a snag or a pine, high up)' : ''} or the ground to land · `
      + `on foot: ${k('W')}${k('S')} hop · ${k('A')}${k('D')} turn · ${k('space')} take off · ${k('E')} peck · `
      + `${k('V')} view · ${k('M')} map · ${k('P')} present day · ${k('T')} tags · ${k('N')} mute · ${k('B')} back to spirit form · click a tree to identify · drag mouse to look` : W.help;
  }

  // The spirit (spirit.js) comes into an AI bird (animals.js info o): in the air at its speed; or standing where it
  // stood, on a limb it can hold (perch.js with its rule), on the ground, or hovering there (a jay in a crown).
  enterAt(o) {
    const f = this.flight, a = this.animals.held?.get(o.id) || this.animals.byId?.get(o.id) || null;
    this.useSpecies(o.code);
    f.setSpecies(this.S.flight);
    this.size = a?.size ?? 1;
    const ps = this.pose; ps.phase = a?.phase ?? 0; ps.amp = a?.amp ?? 0; ps.pose = a?.pose ?? 0; ps.flick = 0; ps.e0 = a?.e0 ?? 0; ps.e1 = a?.e1 ?? 0;
    f.yaw = o.yaw; f.roll = 0; f.hover = false;
    if (o.where === 'air') {
      f.pos.set(o.x, o.y, o.z); f.pitch = THREE.MathUtils.clamp(o.pitch || 0, -0.6, 0.5);
      f.speed = Math.max(this.S.flight.cruise * 0.8, o.speed || 0); f.noLand = 0.6; f.cut = true;
      if (this.S.flight.soar && o.soaring) { f.roll = 0.3 * (Math.random() < 0.5 ? -1 : 1); f.setHover(true); }   // taken in its circle: soars on
    } else {
      const perch = o.where === 'top' ? f.perchNear(o.x, o.y + 0.1, o.z, 1.0) : null;
      f.pitch = 0; f.pos.set(o.x, o.y + 0.2, o.z);
      if (perch || o.where === 'ground') f.settleOn(perch, o.where === 'ground' ? f.footing(o.x, o.z, o.y + 1).y : o.y);
      else { f.speed = 0; f.hover = true; f.cut = true; }
    }
    f.camSettled = false;
    this.hud(this.on);
  }
  // Where the player leaves this bird (spirit.js), for the AI to carry on from (animals.js release): as info.
  leaveInfo() {
    const f = this.flight, G = f.gnd;
    if (f.landed) return { x: f.pos.x, y: G.feet, z: f.pos.z, yaw: G.yaw, where: G.perch ? 'top' : 'ground', speed: 0, tree: null, face: 0, h: 0 };
    return { x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw, where: 'air', speed: f.speed, soaring: !!(this.S.flight.soar && f.hover), tree: null, face: 0, h: 0 };
  }

  // The frame (main.js, in place of flight.update): the flight with the species' numbers, then the bird drawn.
  update(dt) {
    const r = this.flight.update(dt);
    if (this.on && this.animals?.catchNear && (this.catchT = (this.catchT || 0) - dt) <= 0) {   // a hunter's strike: prey within reach in flight (animals.js CARRION)
      this.catchT = 0.1; const P = this.flight.pos;
      const c = this.animals.catchNear(P.x, P.y, P.z); if (c) this.say?.(`took a ${this.animals.speciesList()[c.sp]?.one || 'prey'}`);   // in flight or on the ground beside it
    }
    this.draw(dt);
    return r;
  }
  draw(dt) {
    const b = this.body, f = this.flight, ps = this.pose, S = this.S; if (!b) return;
    const m = b.mesh, G = f.gnd, landed = f.landed;
    m.visible = f.view === 'chase';
    // wings: working (beats at the species' rate), else set (the phase eased to level); folded or swept on a perch
    const work = !landed && f.flapping, stoop = S.short === 'hawk' && !landed && f.pitch < -0.5 && f.speed > 20;
    if (landed) { ps.phase = G.phase; ps.amp = G.amp * 0.6; }
    else {
      ps.amp = damp(ps.amp, work ? 1 : 0, 6, dt);
      if (work) ps.phase += dt * TAU * S.beat * (f.flap > 0.5 ? 1.25 : 1);
      else ps.phase = damp(ps.phase, Math.round(ps.phase / Math.PI) * Math.PI, 3, dt);
    }
    ps.pose = damp(ps.pose, landed ? 1 : stoop ? 0.75 : 0, landed ? 8 : 4, dt);
    ps.flick = landed && G.peck > 0 ? Math.sin(Math.PI * (1 - G.peck)) : damp(ps.flick, landed ? -Math.max(-1, Math.min(0.6, f.pitch)) * 0.5 : 0, 6, dt);
    if (S.jay) {
      ps.e0 = damp(ps.e0, !landed && !work ? 0.4 : 0, 6, dt);                                  // wings bowed in a glide
      ps.e1 = damp(ps.e1, landed ? 0 : f.speed < 5 || f.hover ? 1 : 0.35, 8, dt);              // tail fanned to land
    } else if (S.short === 'hawk') {
      ps.e0 = damp(ps.e0, stoop ? ps.pose : 0, 4, dt);                                          // hands droop as the wings tuck
      ps.e1 = damp(ps.e1, stoop ? -ps.pose : f.speed < 6 && !landed ? 0.6 : 0, 4, dt);         // tail closed in the dive, fanned slow
    } else { ps.e0 = damp(ps.e0, 0, 4, dt); ps.e1 = damp(ps.e1, f.speed < 6 && !landed ? 0.5 : 0, 4, dt); }
    // the body's attitude (flight.body: forward -z) turned to the model's (forward +z); the feet on the perch standing
    this._q.copy(f.body.quaternion).multiply(this._qy);
    const lower = S.feet ? f.sp.landH * Math.min(1, f.camK * 1.2) : 0;
    this._p.set(f.pos.x, f.pos.y - lower, f.pos.z); this._s.setScalar(this.size);
    this._m.compose(this._p, this._q, this._s);
    this._m.toArray(m.instanceMatrix.array, 0); m.instanceMatrix.needsUpdate = true;
    const an = m.geometry.attributes.aAnim; an.array[0] = ps.phase % TAU; an.array[1] = ps.amp; an.array[2] = ps.pose; an.array[3] = ps.flick; an.needsUpdate = true;
    if (b.rig) { const a2 = m.geometry.attributes.aAnim2; a2.array[0] = ps.e0; a2.array[1] = ps.e1; a2.array[2] = 0; a2.array[3] = 0; a2.needsUpdate = true; }
    if (ps.phase > 1e4) ps.phase -= TAU * 1000;
  }
}
