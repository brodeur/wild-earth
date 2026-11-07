import * as THREE from 'three';
import { Wisp } from './spirit.js';
import { avatarSeed, avatarFor } from './social.js';
import { edgePlace, setEdgeBottom } from './herdMarks.js';
import { NF } from './animalNet.js';

// The other players of the group, seen (docs/multiplayer.md, "Seeing the others"; Aaron, 2026-11-02: "I can't see the
// other player's spirit. The players should show up on the map and ... if the other player is not visible on the screen
// their avatar should be shown at the edge of the screen closest to them."). The hub relays each group member's `pos`
// (x, y, z, yaw, form, 5 Hz) while they are in the same tile's room (multiplayer.js gotPos feeds sample()); this draws
// them, in every form the player is in:
//   - in a body (form not 'spirit', and the `pos` carrying the body's sample `b` and constants `c`: bodySample.js), the
//     member as their animal (docs/multiplayer.md "Players as their animals", 2026-11-02): a record in the species' pool
//     of animals.js, kept a slot there (layoutSlots puts the remote bodies first), mirrored from the 5 Hz samples as the
//     host's animals are (remoteSample: two samples eased between, a gap snapped) and drawn by the same instanced draw,
//     gait engine and far tier; no wisp over it, the name over the body. Back in spirit form, or gone, the body goes.
//   - in the world, a spirit wisp like the player's own (spirit.js Wisp) at the relayed position and yaw, in the
//     member's avatar colours (social.js avatarSeed: the two hues the avatar is drawn with, so the wisp and the avatar
//     match), gliding between the 5 Hz samples: each sample starts a run from where the wisp is drawn to the sample over
//     the samples' measured spacing, so it never jumps; past a run's end it carries on at the run's speed for EXTRA_S,
//     then holds; after STALE_S with no sample it fades over FADE_S and the slot is freed. Grown with the eye's distance
//     as the souls are (FAR), so a friend 300 m off is still a glow. A member in a body (form not 'spirit') is drawn as a
//     small wisp BODY_UP m over the body's position for now: the bodies of other players are a later step.
//   - the name (nameOf, the display name) over the wisp within NAME_M m while it is on screen, a label as the smell
//     sense's (#playerLabels, index.html).
//   - off screen (behind the camera or past the sides), the member's avatar (avatarFor) in a circle at the screen's edge
//     nearest them, placed as the herd marks are (herdMarks.js edgePlace, shared), with the distance in metres under it
//     (over it along the bottom edge), sliding along the edge as the camera turns and gone once they are in view.
//   - on the mini-map (minimap.js), a dot in the avatar's hue, pinned at the map's rim in their direction when outside
//     its 800 m, the name on hover: `others` here is read by the map each frame.
//   - voice and video (voice.js, lane 5, through `media`: user id -> {video: MediaStream | null, speaking}): while a
//     member speaks, a pulsing dot before their name (the name then shown on screen out to VIDEO_M, not only NAME_M) and
//     a ring round their edge avatar; while their camera is on, a small rounded tile of it over them in the world,
//     scaled with the eye's distance (VID_K / d, clamped), the name under it, and off screen the video fills their edge
//     avatar's circle. posOf(id) is where each is drawn, for the voice's panner.
// SLOTS wisps are built once, sharing the player's wisp's textures (no new texture units), on camera layer 2 with the
// souls (SpiritLook.render draws that layer after the spirit's post pass, in any form, so the colours stand), and reused;
// nothing is allocated per frame or per sample. Positions live only here and in multiplayer.js's `poses`, in memory,
// cleared when the room is left; nothing is written or logged.
// Who is drawn (docs/multiplayer.md "Who sees whom", Aaron 2026-11-06: "Players should be able to see other players in
// spirit mode. When in a group, users can see eachother regardless of form. Each user sees the other in the form that they
// are currently inhabiting"): the hub relays a player's `pos` within their world (the tile's room in the same season) to
// their group in any form and to everyone else while they are a spirit, so what comes here is what may be drawn:
//   - a group member (isMate), in any form, as above: the wisp or the animal, the name within NAME_M, the edge avatar
//     and the map's dot.
//   - anyone else, only ever as a spirit: the wisp in their avatar's colours, the name within STRANGER_NAME_M (smaller and
//     paler: the tile's chat already shows a speaker's name to everyone in the tile, so the label tells nothing more, and
//     it gives a wisp drifting by a name to greet), and no edge avatar, distance or map dot (those find friends across the
//     tile; for a stranger they would track them).
// The forms change in view: going into a body, the wisp dives into the animal over TR_IN and is gone in it; leaving a body,
// the wisp grows out of it with a burst of motes (Wisp.burst). `gone {user}` from the hub (they left the world, or a
// stranger's spirit went into a body the player is not shown) shrinks the wisp away over TR_OUT where it was.

const SLOTS = 12, LAYER = 2;
const RUN_MIN = 0.1, RUN_MAX = 0.5;        // s: a run from one sample to the next (the spacing measured, clamped)
const EXTRA_S = 0.4;                       // s: carried on past a run's end at its speed, waiting for the next sample
const STALE_S = 3, FADE_S = 1.5;           // s: with no sample, when the fade starts and how long it takes
const GROW_S = 0.6;                        // s: a new wisp forms
const NAME_M = 60;                         // m: a group member's name is drawn within this
const STRANGER_NAME_M = 30;                // m: a stranger's (a spirit not of the group) within this
const TR_IN = 0.7, TR_OUT = 0.6;           // s: the wisp diving into a body; shrinking away when gone
const FAR = [8, 300, 8];                   // grown x1 within FAR[0] m to x FAR[2] at FAR[1] m and beyond (the souls' rule, from nearer)
const SCALE_SPIRIT = 0.62, SCALE_BODY = 0.34, BODY_UP = 0.7, LUM = 0.9;   // a little over the player's own resting wisp (REST_SCALE 0.5, REST_LUM 0.6): seen from further
const LABEL_UP = 0.6;                      // m over the wisp for the name
const HALF_M = 60, HUD_EVERY = 30;         // past HALF_M m a wisp's form is updated on alternate frames (sub-pixel detail); the HUD's bottom rows measured every HUD_EVERY frames
const HUD_IDS = ['abilities', 'help', 'nearBar', 'chat'];
const VIDEO_M = 400;                       // m: a member's video tile (and a speaking name) is drawn on screen within this
const VID_K = 2600, VID_MIN = 0.36, VID_MAX = 1;   // the tile's scale: VID_K / d px wide over its 176 px, clamped
const VID_UP = 16;                         // px: the tile's foot over the name's point   // the body's or the spirit's row with the key line, the raven's key line, the nearby bar, the chat
const WHITE = new THREE.Color(0.9, 0.95, 1.0);
const smooth = u => u * u * (3 - 2 * u);
const TAU = Math.PI * 2;

export class RemotePlayers {
  // marks: the #herdMarks element (the circles share its layer and style); labels: #playerLabels; minimap: MiniMap
  // (its `others`); maps: the player's wisp's textures (spirit.wisp.maps); nameOf(id): the display name (set by
  // multiplayer.js once signed in; 'someone' until then).
  // isMate(id): whether the player shares a group with them (multiplayer.js; a group member until it is set).
  constructor({ scene, renderer, camera, flight, animals = null, minimap = null, maps = null, marks = null, labels = null, nameOf = null, isMate = null }) {
    this.camera = camera; this.flight = flight; this.animals = animals; this.minimap = minimap; this.marksEl = marks; this.labelsEl = labels;
    this.nameOf = nameOf || (() => 'someone'); this.isMate = isMate || (() => true);
    this.n = 0;   // live slots (SpiritLook.render draws the layer while > 0)
    this.slots = [];
    for (let i = 0; i < SLOTS; i++) {
      const w = new Wisp({ renderer, camera, scene, layer: LAYER, maps: maps || this.slots[0]?.wisp.maps || null });
      w.group.name = 'player ' + i;
      this.slots.push({ i, id: null, wisp: w, name: '', hue: 0, form: 'spirit', at: 0, t: 0, dur: 0, age: 0, n: 0, rec: null, tagH: 0,
        p0: new THREE.Vector3(), p1: new THREE.Vector3(), v: new THREE.Vector3(), P: new THREE.Vector3(), yaw0: 0, yaw1: 0, yaw: 0,
        held: 0, label: null, mark: null, markD: null, dText: '', shown: false, labelOn: false, markOn: false, markUp: false,
        D: new THREE.Vector3(), drawn: false, vid: null, vidEl: null, markVid: null, vidOn: false, stream: null, speaking: false,
        mate: true, tr: null, trT: 0, trFrom: new THREE.Vector3(), burst: false });
    }
    this.others = Array.from({ length: SLOTS }, () => ({ on: false, x: 0, north: 0, hue: 0, name: '' }));   // the map's view of them (minimap.js)
    if (minimap) minimap.others = this.others;
    this._p = new THREE.Vector3(); this._c = new THREE.Color(); this.frame = 0;
    this.media = new Map();   // user id -> {video, speaking} (voice.js)
  }
  // Where the member is drawn (their wisp, or their animal's head height), or null: the voice's panner follows it.
  posOf(id) { const s = this.slotOf(id); return s && s.drawn ? s.D : null; }
  // The HUD's bottom rows (the key line, the body's row, the nearby bar, the chat): the edge marks stand over them.
  measureHud(H) {
    let top = H;
    for (const id of HUD_IDS) {
      const el = document.getElementById(id); if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect(); if (r.height && r.top < top && r.bottom > H - 160) top = r.top;
    }
    setEdgeBottom(H - top + 24);
  }

  slotOf(id) { for (const s of this.slots) if (s.id === id) return s; return null; }
  // A `pos` from the hub ({user, x, y, z, yaw, form}; multiplayer.js): the member's run to it begins.
  sample(d) {
    if (!d || typeof d.user !== 'string' || !Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.z)) return;
    let s = this.slotOf(d.user);
    if (!s) {
      for (const o of this.slots) if (!o.id && (!s || o.at > s.at)) s = o;                   // a free slot
      if (!s) for (const o of this.slots) if (!s || o.at > s.at) s = o;                      // else the one longest unheard from
      this.free(s);
      s.id = d.user; s.name = this.who(d); s.age = 0; s.n = 0; s.at = 0; s.held = 0; s.dText = '';
      const seed = avatarSeed(d.user); s.hue = seed.hue;
      const w = s.wisp; w.warm.setHSL(seed.hue / 360, 0.85, 0.68); w.cool.setHSL(seed.hue2 / 360, 0.85, 0.52); w.white.copy(w.warm).lerp(WHITE, 0.6);
      s.P.set(d.x, d.y, d.z); s.p0.copy(s.P); s.p1.copy(s.P); s.v.set(0, 0, 0); s.yaw = s.yaw0 = s.yaw1 = +d.yaw || 0; s.dur = 0; s.t = 0;
      if (this.labelsEl) { const l = s.label = document.createElement('div'); l.className = 'pl'; l.style.setProperty('--hue', String(seed.hue)); l.textContent = s.name; l.hidden = true; this.labelsEl.append(l); }
      s.mate = null;   // set below: the mark is made for a group member only
      const o = this.others[s.i]; o.hue = seed.hue; o.name = s.name;
    } else {
      if (s.tr === 'out') { s.tr = null; s.age = 0; }   // seen again after a gone (back in the world, or out of the body): formed anew
      // the next run: from where the wisp is drawn now to the sample, over the samples' spacing
      s.p0.copy(s.P); s.yaw0 = s.yaw;
      s.p1.set(d.x, d.y, d.z); s.yaw1 = +d.yaw || 0;
      s.dur = Math.min(RUN_MAX, Math.max(RUN_MIN, s.at)); s.t = 0;
      s.v.subVectors(s.p1, s.p0).divideScalar(s.dur);
      if (s.v.lengthSq() > 300 * 300) { s.P.copy(s.p1); s.p0.copy(s.p1); s.v.set(0, 0, 0); s.yaw = s.yaw0 = s.yaw1; }   // teleported (a jump, a reset): no run
      s.at = 0;
    }
    const mate = !!this.isMate(d.user);
    if (mate !== s.mate) this.setMate(s, mate);
    if (s.name === 'someone' && d.name) { s.name = this.who(d); if (s.label) s.label.textContent = s.name; if (s.mark) s.mark.title = s.name; this.others[s.i].name = s.name; }
    s.form = typeof d.form === 'string' ? d.form : 'spirit';
    // in a body: the member's animal (animals.js remoteSample), drawn in its species' pool; back to spirit form: gone
    const A = this.animals, body = s.form !== 'spirit' && Array.isArray(d.b) && d.b.length >= NF && A?.remoteSample, had = !!s.rec;
    if (body) {
      const c = Array.isArray(d.c) ? d.c : null, k = c && Number.isInteger(c[7]) ? c[7] : -1;
      const cst = this._c2 ||= { size: 1, variant: 0, male: 0, young: 0, u1: 0.5, u2: 0.5, u3: 0.5, slot: -1 };
      if (c) { cst.size = +c[0] || 1; cst.variant = +c[1] || 0; cst.male = +c[2] || 0; cst.young = +c[3] || 0; cst.u1 = +c[4]; cst.u2 = +c[5]; cst.u3 = +c[6]; cst.slot = k; }
      s.rec = A.remoteSample(d.user, s.form, d.b, c ? cst : null, performance.now());
      if (s.rec) s.tagH = A.tagHeight?.(s.rec) ?? 1;
      if (s.rec && !had && s.shown && s.n) { s.tr = 'in'; s.trT = 0; s.trFrom.copy(s.P); }   // went into the body in view: the wisp dives into it
    } else if (s.rec) {   // out of the body: the wisp grows out of where the animal stands, with a burst of motes
      A?.remoteDrop(d.user); s.rec = null; s.tr = null; s.age = 0; s.burst = true;
    }
    s.n++;
  }
  // The name over them: the social list's (friends, the group), else the display name the hub relays with the position.
  who(d) { const n = this.nameOf(d.user); return n && n !== 'someone' ? n : typeof d.name === 'string' && d.name ? d.name.slice(0, 32) : 'someone'; }
  // A group member's edge avatar (and map dot) exist; a stranger's spirit has neither, and a smaller, paler name.
  setMate(s, mate) {
    s.mate = mate;
    s.label?.classList.toggle('stranger', !mate);
    if (mate && !s.mark && this.marksEl) {
      const m = s.mark = document.createElement('div'); m.className = 'hm pm'; m.style.setProperty('--hue', String(s.hue)); m.title = s.name; m.hidden = true;
      m.append(avatarFor(s.id, 26)); s.markD = document.createElement('b'); m.append(s.markD); this.marksEl.append(m); s.markOn = false; s.dText = '';
      if (s.stream) { const st = s.stream; s.stream = null; this.video(s, st); }
    } else if (!mate && s.mark) { this.video(s, null); s.mark.remove(); s.mark = s.markD = null; s.markOn = false; this.others[s.i].on = false; }
  }
  // A member known to be gone (offline, or in another tile): off at once.
  drop(id) { const s = this.slotOf(id); if (s) this.free(s); }
  // The hub's `gone`: they left the world, or a stranger's spirit went into a body: the wisp shrinks away where it is.
  gone(id) {
    const s = this.slotOf(id); if (!s) return;
    if (!s.shown || s.rec) { this.free(s); return; }
    s.tr = 'out'; s.trT = 0; s.trFrom.copy(s.P);
  }
  clear() { for (const s of this.slots) this.free(s); }
  free(s) {
    if (!s.id) return;
    if (s.rec) { this.animals?.remoteDrop(s.id); s.rec = null; }
    s.id = null; s.at = Infinity; s.n = 0; s.tr = null; s.burst = false;
    if (s.shown) { s.wisp.update(0, s.P, 0, false, 1, 1); s.shown = false; }
    s.label?.remove(); s.mark?.remove(); s.label = s.mark = s.markD = null; s.labelOn = s.markOn = false;
    this.video(s, null); s.drawn = false; s.speaking = false;
    this.others[s.i].on = false;
  }

  // Every frame (main.js, after the spirit's draw): the runs, the wisps, the names, the edge marks and the map's dots.
  update(dt) {
    let n = 0; const cam = this.camera, camP = cam.position, W = innerWidth, H = innerHeight, p = this._p;
    const fr = this.frame++;
    if (this.n && fr % HUD_EVERY === 0) this.measureHud(H);
    for (const s of this.slots) {
      if (!s.id) continue;
      s.at += dt; s.age += dt; s.held += dt;
      if (s.at > STALE_S + FADE_S) { this.free(s); continue; }
      let tu = 0;   // the transition's progress, 0..1
      if (s.tr) { s.trT += dt; tu = Math.min(1, s.trT / (s.tr === 'in' ? TR_IN : TR_OUT)); if (tu >= 1 && s.tr === 'out') { this.free(s); continue; } }
      // the run
      if (s.dur > 0) {
        s.t += dt;
        const u = s.t / s.dur;
        if (u <= 1) { s.P.lerpVectors(s.p0, s.p1, u); s.yaw = lerpYaw(s.yaw0, s.yaw1, u); }
        else { s.P.copy(s.p1).addScaledVector(s.v, Math.min(s.t - s.dur, EXTRA_S)); s.yaw = s.yaw1; }
      }
      const body = s.form !== 'spirit', rec = s.rec;
      if (rec) { p.set(rec.x, rec.y + s.tagH - LABEL_UP, rec.z); s.P.set(rec.x, rec.y, rec.z); }   // drawn as their animal (animals.js): the name over it
      else { p.copy(s.P); if (body) p.y += BODY_UP; }
      if (s.tr === 'out') p.copy(s.trFrom).y -= 0.6 * smooth(tu);
      s.D.copy(p); s.drawn = true;
      const md = this.media.get(s.id) || null;
      if ((md?.video || null) !== s.stream) this.video(s, md?.video || null);
      const speaking = !!md?.speaking;
      if (speaking !== s.speaking) { s.speaking = speaking; s.label?.classList.toggle('speaking', speaking); s.mark?.classList.toggle('speaking', speaking); s.vid?.classList.toggle('speaking', speaking); }
      const dc = p.distanceTo(camP), far = 1 + (FAR[2] - 1) * Math.min(1, Math.max(0, (dc - FAR[0]) / (FAR[1] - FAR[0])));
      let fade = s.at > STALE_S ? 1 - (s.at - STALE_S) / FADE_S : 1, grow = smooth(Math.min(1, s.age / GROW_S));
      if (s.tr === 'out') { grow *= 1 - smooth(tu); fade *= 1 - tu; }
      if (rec && s.tr === 'in') {   // diving into the body: from where the wisp was to the animal's chest, shrinking, a flare at the end
        const k = smooth(tu), q = this._q || (this._q = new THREE.Vector3());
        q.set(rec.x, rec.y + s.tagH * 0.45, rec.z); q.lerpVectors(s.trFrom, q, k);
        s.wisp.update(dt, q, s.yaw, true, 1 - 0.85 * k, 1, SCALE_SPIRIT * far, LUM * (1 + 0.8 * Math.sin(Math.PI * k)), 1 + 2 * k); s.shown = true; n++;
        if (tu >= 1) { s.tr = null; s.wisp.update(0, q, 0, false, 1, 1); s.shown = false; }
      } else if (rec) { if (s.shown) { s.wisp.update(0, p, 0, false, 1, 1); s.shown = false; } }
      else {
        if (dc <= HALF_M || (fr + s.i) % 2 === 0 || !s.shown || s.tr) { s.wisp.update(s.held, p, s.yaw, true, grow, 1, (body ? SCALE_BODY : SCALE_SPIRIT) * far, LUM * fade, 1); s.held = 0; }
        s.shown = true; n++;
        if (s.burst) { s.burst = false; s.wisp.burst(p); }
      }
      // the name, while near and on screen; else the mark at the edge
      const edge = edgePlace(cam, p.x, p.y, p.z, W, H);
      const vidOn = !!s.vid && !edge && dc <= VIDEO_M;
      if (s.label) {
        const on = !edge && s.tr !== 'in' && (dc <= (s.mate ? NAME_M : STRANGER_NAME_M) || ((s.speaking || vidOn) && dc <= VIDEO_M));
        if (on || vidOn) {
          p.y += LABEL_UP; p.project(cam);
          const x = (p.x + 1) * W / 2, y = (1 - p.y) * H / 2;
          if (on) { s.label.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`; s.label.style.opacity = fade.toFixed(2); }
          if (vidOn) {
            const k = Math.min(VID_MAX, Math.max(VID_MIN, VID_K / Math.max(dc, 1) / 176));
            s.vid.style.transform = `translate(${(x - 88).toFixed(0)}px, ${(y - VID_UP - 132).toFixed(0)}px) scale(${k.toFixed(3)})`;
            s.vid.style.opacity = fade.toFixed(2);
          }
        }
        if (on !== s.labelOn) { s.labelOn = on; s.label.hidden = !on; }
      }
      if (s.vid && vidOn !== s.vidOn) { s.vidOn = vidOn; s.vid.hidden = !vidOn; }
      if (s.mark) {
        const on = !!edge;
        if (on) {
          s.mark.style.transform = `translate(${edge.x.toFixed(0)}px, ${edge.y.toFixed(0)}px)`;
          s.mark.style.opacity = fade.toFixed(2);
          const up = edge.y > H - 70; if (up !== s.markUp) { s.markUp = up; s.mark.classList.toggle('up', up); }
          const txt = dc < 1000 ? `${Math.round(dc)} m` : `${(dc / 1000).toFixed(1)} km`;
          if (txt !== s.dText) { s.dText = txt; s.markD.textContent = txt; }
        }
        if (on !== s.markOn) { s.markOn = on; s.mark.hidden = !on; }
      }
      const o = this.others[s.i]; o.on = s.mate; o.x = s.P.x; o.north = -s.P.z;
    }
    this.n = n;
  }
  // A member's camera on (a MediaStream) or off (null): the tile in the world and the video in the edge avatar. Two
  // elements on the one stream (the decoder is shared), so neither is moved between parents.
  video(s, stream) {
    s.stream = stream;
    if (!stream) {
      if (s.vid) { s.vidEl.srcObject = null; s.vid.remove(); }
      if (s.markVid) { s.markVid.srcObject = null; s.markVid.remove(); }
      s.vid = s.vidEl = s.markVid = null; s.vidOn = false; s.mark?.classList.remove('vid');
      return;
    }
    const mk = () => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = stream; v.play().catch(() => {}); return v; };
    if (!s.vid && this.labelsEl) {
      const t = s.vid = document.createElement('div'); t.className = 'pv'; t.hidden = true; t.style.setProperty('--hue', String(s.hue));
      t.classList.toggle('speaking', s.speaking);
      s.vidEl = mk(); t.append(s.vidEl); this.labelsEl.append(t);
    } else if (s.vidEl) { s.vidEl.srcObject = stream; s.vidEl.play().catch(() => {}); }
    if (s.mark) {
      if (!s.markVid) { s.markVid = mk(); s.mark.prepend(s.markVid); }
      else { s.markVid.srcObject = stream; s.markVid.play().catch(() => {}); }
      s.mark.classList.add('vid');
    }
  }
  dispose() {
    this.clear();
    for (const s of this.slots) s.wisp.dispose();
    if (this.minimap && this.minimap.others === this.others) this.minimap.others = null;
  }
}

// the shorter way round between two yaws (rad)
function lerpYaw(a, b, u) {
  let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return a + d * u;
}
