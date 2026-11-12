import * as THREE from 'three';
import { NF, F, FL_AIR, FL_GM, FL_BURIED } from './animalNet.js';

// The player's own body as the shared animals' stream has an animal (animalNet.js FIELDS), for the group members who
// draw it (docs/multiplayer.md "Players as their animals"; multiplayer.js sendPos puts it in the hub's `pos` at 5 Hz;
// players.js draws it in a slot of the species' pool, through the same instanced draw, gait engine and far tier as the
// AI's animals). What the AI's draw recomputes itself (the turn's lag, the legs' stride, the deer's clips) is sent as
// the AI keeps it: the control's yaw (not the lagged drawn one), the gait's speed and turn rate, the pose. The rest is
// read off the body's own drawn mesh where it shares the AI's conventions: its instance matrix (the position and the
// YXZ angles of the model, forward +z) and aAnim (phase, amp, pose, flick), aAnim2 (e0..e3). The raven, drawn by
// raven.js and not instanced, is put together from the flight. Returns the species slot (animals.js SPECIES index) or
// -1 in spirit form; fills out (NF numbers) and cst ([size, variant, male, young, u1, u2, u3, slot]). No allocation.
const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const R_PERCH = 22, R_WALK = 25, RAVEN_BEAT = 2.6, RAVEN_TUCK = 0.8;   // animals.js: the raven's states on the ground, its wing beat (Hz)
const last = { phase: 0, t: 0, wing: 0 };

function fromMesh(mesh, out) {
  _m.fromArray(mesh.instanceMatrix.array, 0); _m.decompose(_p, _q, _s); _e.setFromQuaternion(_q, 'YXZ');
  out[F.x] = _p.x; out[F.y] = _p.y; out[F.z] = _p.z; out[F.yaw] = _e.y; out[F.pitch] = _e.x; out[F.roll] = _e.z;
  const an = mesh.geometry.attributes.aAnim?.array, a2 = mesh.geometry.attributes.aAnim2?.array;
  if (an) { out[F.phase] = an[0]; out[F.amp] = an[1]; out[F.pose] = an[2]; out[F.flick] = an[3]; }
  if (a2) { out[F.e0] = a2[0]; out[F.e1] = a2[1]; out[F.e2] = a2[2]; out[F.e3] = a2[3]; }
}

export function bodySample(we, out, cst, now = performance.now()) {
  const sp = we.spirit, A = we.animals, f = we.flight;
  if (!sp?.body || sp.on) return -1;
  const held = A.held?.get(sp.body.id); if (!held) return -1;
  out.fill(0); out[F.vis] = 1;
  const g = we.ground, fl = we.flier, sq = we.squirrel, wp = we.woodpecker;
  if (g?.on && g.body) {
    fromMesh(g.body.mesh, out);
    out[F.yaw] = f.yaw + Math.PI;                       // the control's yaw: the drawing lags it as the AI's does
    out[F.spd] = g.spd || 0; out[F.wr] = g.cs?.wr || 0; out[F.lift] = g.pose.lift || 0;
    out[F.fl] = g.mode === 'fly' || g.mode === 'air' ? FL_AIR : g.mode === 'tunnel' ? FL_BURIED : 0;   // underground (dig.js): a glow in the others' underground view, no one's prey
    g.snakeSample?.(out);   // a snake: drawn along its own path here, sent on the AI's channels (snake.js sample: its mean point and heading, the wave, the coil)
  } else if (fl?.on && fl.body) {
    fromMesh(fl.body.mesh, out);
    out[F.fl] = f.landed ? 0 : FL_AIR; out[F.spd] = f.speed || 0;
  } else if (sq?.on && sq.mesh) {
    fromMesh(sq.mesh, out); out[F.spd] = Math.abs(sq.v || 0);
  } else if (wp?.on && wp.mesh) {
    fromMesh(wp.mesh, out); out[F.fl] = wp.mode === 'fly' ? FL_AIR : 0;
  } else {   // the raven (raven.js draws the player's own): on the ground the ground model's pose, in the air the wings' beat
    const G = f.gnd, rv = we.raven?.g, landed = !!f.landed;
    _q.copy(f.body.quaternion).multiply(_qy); _e.setFromQuaternion(_q, 'YXZ');
    out[F.x] = f.pos.x; out[F.z] = f.pos.z;
    if (landed) {
      out[F.y] = G.feet ?? f.pos.y; out[F.yaw] = G.yaw + Math.PI; out[F.pitch] = 0; out[F.roll] = 0;
      out[F.phase] = G.phase || 0; out[F.amp] = G.amp || 0; out[F.pose] = 1; out[F.flick] = rv?.flick || 0;
      out[F.e0] = rv?.e0 || 0; out[F.e1] = rv?.look || 0; out[F.e2] = rv?.hop || 0;
      out[F.state] = (G.amp || 0) > 0.05 ? R_WALK : R_PERCH; out[F.fl] = FL_GM;
    } else {
      const dt = last.t ? Math.min(0.5, (now - last.t) / 1000) : 0;
      last.wing += (((f.flapping ? 1 : 0) - last.wing) * Math.min(1, dt * 6));
      if (f.flapping) last.phase += dt * TAU * RAVEN_BEAT; else last.phase += (Math.round(last.phase / Math.PI) * Math.PI - last.phase) * Math.min(1, dt * 3);
      out[F.y] = f.pos.y; out[F.yaw] = _e.y; out[F.pitch] = _e.x; out[F.roll] = _e.z;
      out[F.phase] = last.phase % TAU; out[F.amp] = last.wing; out[F.phz] = f.flapping ? TAU * RAVEN_BEAT : 0;
      out[F.pose] = RAVEN_TUCK * (we.raven?.tuck || 0);   // a dive's tuck (dive.js): the mirror's raven folds its wings by its pose
      out[F.fl] = FL_AIR; out[F.spd] = f.speed || 0;
    }
    last.t = now;
  }
  // the beat's or the gait's rate, from the phase (a mirror advances the phase by it between samples)
  if (!out[F.phz]) { const ph = out[F.phase], dt = last.tp ? (now - last.tp) / 1000 : 0; if (dt > 0.05 && dt < 1) { let d = ph - (last.pp || 0); d -= Math.round(d / TAU) * TAU; out[F.phz] = d / dt; } last.pp = ph; last.tp = now; }
  out[F.phase] = ((out[F.phase] % TAU) + TAU) % TAU;
  cst[0] = held.size || 1; cst[1] = held.variant || 0; cst[2] = held.male || 0; cst[3] = held.young || 0;
  cst[4] = held.u1 ?? 0.5; cst[5] = held.u2 ?? 0.5; cst[6] = held.u3 ?? 0.5; cst[7] = held.sp;
  return held.sp;
}
export { NF };
