// The first twenty minutes (docs/first-twenty-minutes.md; Aaron, 2026-11-13: "Yes, build it"): an order and a voice for
// what the world already does, for a person who lives on the tile and has never seen the game. On with ?first=1 (the
// link a tester is sent), or ?first=centre (the brief's own measure: the start at the tile's centre, the mini-map and
// the lights for known places off, "Fly home"). Nothing here is needed to play: every beat can be ignored, the controls
// are live throughout, and an exception in it is caught and ends the guide, never the frame.
//
// The beats: today's photograph over the point of arrival with its name, the date and the weather; the photograph
// dissolved into the rewilded world; the wisp and three bodies under lights (a raven, a gray squirrel, a deer); as the
// raven a known place found from the air, where what stands there today shows for a moment; acorns taken and hidden,
// and the oak they are hidden in marked as the player's own (kept in the browser, never sent); the squirrel's side of
// it, with one hawk's stoop started on purpose; the deer as the quiet path; and a card: the cache, the season's board,
// what to look for outdoors today.
//
// One line of words at a time at the bottom of the screen, gone when its thing is done. Positions stay on the page: the
// player's tree is a key in localStorage, the point of arrival is never stored.
import * as THREE from 'three';

const RAVEN = 'corvus_corax', SQUIRREL = 'sciurus_griseus', DEER = 'odocoileus_hemionus', JAY = 'aphelocoma_californica';
const TODAY_S = 5.5, WILD_S = 9, ROADS_S = 5.5;          // today's photograph held; the line after it; the roads' lines lingering
const OPEN_M = 140, OPEN_PITCH = -0.95, SINK_TO_M = 18, OFFER_FAR_M = 170, OFFER_AGAIN = 3;   // the wisp let down to this over the ground as the world appears; the three bodies put again when all are further than this
const DISSOLVE_MS = 2600, FLICKER_MS = 600, FLICKER_S = 2.4;
const PLACE_R = [500, 3500], ARRIVE_M = 220;            // a known place's light: how far off it may stand; reached within this (horizontal)
const PLACES_MAX_S = 240, OTHER_MAX_S = 90, BURY_MAX_S = 80, QUIET_S = 420, CARD_AT_S = 17 * 60;
const HAWK_WARN_S = 6, SAFE_UP_M = 1.6;
// The catch: the stoop's point follows the squirrel wholly until the last quarter of the fall, then at no more than
// TRACK_MS (a squirrel flat out outruns it; one that stands, digs or walks does not); caught within CAUGHT_M of that
// point on the ground. The stoop ends OVER_M over a squirrel on the ground (the talons' height) and over one up a tree.
const TRACK_MS = 2.5, CAUGHT_M = 1.6, OVER_M = [0.35, 2.5], BLINK_MS = 220;
// The death seen: the eye stays where it was (the squirrel's own view of itself: spirit.js CameraBlend hold), in the
// world's true colours with no spirit's glow, until the player takes the controls or HOLD_MAX_S pass; only then does
// the view go to the wisp's own (under trees that is often among leaves). Meanwhile, over RISE_S, the wisp rises out of
// the body and away from the eye, RISE_UP_M up and RISE_FAR m past the body: clear of the hawk's touch (spirit.js
// TOUCH_R), which is held off while it rises, and the body between the eye and the wisp.
const HOLD_MAX_S = 12, RISE_S = 3, RISE_FAR = [3.2, 4.2], CHASE_M = 5.5, RISE_UP_M = 1.4;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// One thing to look for outdoors, by the tile's season (oak country: the home tile and its neighbours).
const OUTSIDE = {
  fall: 'Find an oak. Look under it for caps with no acorn in them: someone has been there.',
  winter: 'After rain, look in the mud by a creek or a puddle: whose feet were there before yours?',
  spring: 'Stand under an oak at first light and count the different songs. Each is someone holding a place.',
  summer: 'At dusk, sit still near dry grass for five minutes. Listen for what moves when the heat goes.',
};
const SEASON_LINES = {
  fall: ['Acorns are falling, and everything that eats them is busy.', 'The bucks are in rut.', 'The first rains bring the hills from gold to green.'],
  winter: ['What was hidden in fall is being dug up.', 'The creeks are running.', 'Ravens follow the lions to their kills.'],
  spring: ['The oaks are in new leaf and the grass is at its tallest.', 'Nests are being built and fawns hidden.', 'The creeks are still up.'],
  summer: ['The grass has gone to seed and gold.', 'Water is the thing everyone needs: the few pools draw them all.', 'The young of the year are on their own.'],
};

export function firstWanted(params) { const f = params.get('first'); return f === '1' || f === 'centre' ? f : null; }
export function firstTreeKey(tileId, season) { return `wild-earth:first:tree:${tileId}/${season}`; }

const CSS = `
#firstLine { position:fixed; left:50%; bottom:128px; transform:translateX(-50%); z-index:18; max-width:min(720px, 86vw); text-align:center; pointer-events:none;
  font:500 17px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.01em; color:#f4f1e8; text-shadow:0 1px 2px #000c, 0 0 14px #0009;
  opacity:0; transition:opacity .9s ease; }
#firstLine.on { opacity:1; }
#firstLine kbd { font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:2px 6px; margin:0 1px; border:1px solid #f4f1e866; border-radius:4px; background:#0b100dcc; color:#fff; text-shadow:none; }
#firstOver { position:fixed; left:50%; top:13vh; transform:translateX(-50%); z-index:18; text-align:center; pointer-events:none; color:#f4f1e8; text-shadow:0 1px 3px #000d, 0 0 18px #000a;
  opacity:0; transition:opacity 1.2s ease; white-space:nowrap; }
#firstOver.on { opacity:1; }
#firstOver b { display:block; font:500 30px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.14em; text-transform:uppercase; }
#firstOver i { display:block; margin-top:8px; font:400 15px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; font-style:normal; letter-spacing:.04em; color:#e4e0d4; }
#firstOver.small b { font-size:17px; letter-spacing:.12em; }
.firstTag { position:fixed; left:0; top:0; z-index:6; pointer-events:none; white-space:nowrap; text-align:center; font:600 13px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.08em;
  text-transform:uppercase; color:#fffbe9; text-shadow:0 1px 2px #000d; will-change:transform; }
.firstTag small { display:block; font-size:11px; font-weight:500; letter-spacing:.04em; text-transform:none; color:#e4e0d4cc; }
#firstFlash { position:fixed; inset:0; z-index:17; background:#000; opacity:0; pointer-events:none; transition:opacity .35s ease; }
#firstFlash.on { opacity:1; }
#firstCard { position:fixed; inset:0; z-index:30; display:flex; align-items:center; justify-content:center; background:#06090799; opacity:0; transition:opacity .6s ease; }
#firstCard.on { opacity:1; }
#firstCard .fc { width:min(470px, 90vw); max-height:88vh; overflow:auto; padding:26px 28px 22px; border:1px solid #2a352d; border-radius:14px; background:#0d1410f2; color:#e9ede6;
  font:400 14.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; box-shadow:0 20px 60px #000a; }
#firstCard h2 { margin:0; font:500 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.2em; text-transform:uppercase; color:#9fb3a4; }
#firstCard h1 { margin:6px 0 2px; font:500 24px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.02em; }
#firstCard .when { color:#b9c4bb; margin-bottom:14px; }
#firstCard h3 { margin:16px 0 4px; font:600 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.16em; text-transform:uppercase; color:#9fb3a4; }
#firstCard p { margin:0 0 4px; }
#firstCard .out { padding:10px 12px; border-left:2px solid #d9b45a; background:#1a2118; border-radius:0 8px 8px 0; color:#f6efd9; }
#firstCard .board { display:flex; gap:18px; } #firstCard .board b { display:block; font-size:19px; font-weight:500; }
#firstCard .board span { color:#b9c4bb; font-size:12px; }
#firstCard .row { display:flex; gap:10px; margin-top:20px; flex-wrap:wrap; }
#firstCard button { font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; letter-spacing:.04em; padding:10px 16px; border-radius:999px; border:1px solid #3a473d; background:#151d18; color:#e9ede6; cursor:pointer; }
#firstCard button.go { background:#f4f1e8; color:#0d1410; border-color:#f4f1e8; }
#firstCard .fine { margin-top:12px; font-size:12px; color:#8b988e; }
html.first #nearBar, html.first #game { display:none; }   /* the species bar and the acorn game's panel wait for the card: the guide's line says what they would */
html.first.first-centre #minimap { display:none; }
`;

// A column of light: an open cylinder, additive, soft at its foot and top and toward its edges, kept a few pixels wide
// at any distance. One draw each; at most seven live (three bodies, three places, the player's tree).
class Beam {
  constructor(scene, color, height, radius = 0.5) {
    this.height = height; this.radius = radius;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); geo.translate(0, 0.5, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAmt: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uAmt; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { float rim = abs(dot(normalize(vN), normalize(vV))); float a = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.6) * (0.25 + 0.75 * rim * rim); gl_FragColor = vec4(uColor * a * uAmt, 1.0); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 20; this.mesh.visible = false;
    this.mesh.layers.enable(1);   // drawn again after the spirit's look (spirit.js render: layer 1), so its colour stands in the blue world
    this.want = 0; scene.add(this.mesh);
  }
  set(x, y, z) { this.mesh.position.set(x, y, z); }
  update(dt, camera) {
    const u = this.mat.uniforms.uAmt; u.value += (this.want - u.value) * Math.min(1, dt * 2.2);
    this.mesh.visible = u.value > 0.01; if (!this.mesh.visible) return;
    const d = camera.position.distanceTo(this.mesh.position), r = Math.max(this.radius, d * 0.0035);
    this.mesh.scale.set(r, this.height, r);
  }
  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

export class FirstSession {
  // x: { mode, tile, scene, camera, flight, animals, spirit, acorns, squirrel, ground, places, weather, roads, peek, setPeek,
  //      dateNow, seasonNow, entering(), form(), sound() }
  constructor(x) {
    Object.assign(this, x);
    this.active = !!x.mode; this.centre = x.mode === 'centre';
    this.beat = null; this.t = 0; this.total = 0; this.done = new Set(); this.failed = false;
    this.beams = []; this.tags = []; this.offer = []; this.lights = []; this.timers = [];
    this.tree = null; this.treeBeam = null; this.carried = 0; this.hid = 0; this.startAt = null; this.moved = 0; this.last = null;
    this.hawk = null; this.cardOpen = false; this.cardShown = false; this.chip = false; this._v = new THREE.Vector3();
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); this.style = st;
    const mk = (id, tag = 'div') => { const e = document.createElement(tag); e.id = id; document.body.append(e); return e; };
    this.lineEl = mk('firstLine'); this.overEl = mk('firstOver'); this.flashEl = mk('firstFlash');
    this.onKey = e => {
      if (!this.active || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (this.held && !this.rise) this.fresh = true;   // a key pressed anew after the death (not one still held from the flight from the hawk)
      if (e.key === 'Enter') { if (this.cardOpen) return; if (this.chip) { e.preventDefault(); this.openCard(); } else if (this.beat === 'other') { e.preventDefault(); this.beSquirrel(); } }
      else if (this.beat === 'bodies' && ['1', '2', '3'].includes(e.key)) { const o = this.offer[+e.key - 1]; if (o && this.animals.alive(o.a)) { e.preventDefault(); this.spirit.enter(o.a.id); } }
      else if (e.key === 'Escape' && this.cardOpen) this.closeCard();
    };
    addEventListener('keydown', this.onKey);
    this.loadTree();
  }

  // ---- the player's own tree: where they first hid acorns, kept in this browser only ----
  loadTree() {
    try { const raw = localStorage.getItem(firstTreeKey(this.tile.id, this.seasonNow())); this.tree = raw ? JSON.parse(raw) : null; } catch (e) { this.tree = null; }
    if (this.tree && Number.isFinite(this.tree.x + this.tree.z)) this.markTree(); else this.tree = null;
  }
  markTree() {
    const t = this.tree; if (!t) return;
    this.treeBeam ||= new Beam(this.scene, 0xffd27a, 26, 0.35);
    this.treeBeam.set(t.x, this.tile.heights.atXZ(t.x, t.z), t.z); this.treeBeam.want = 0.9;
  }
  setTree(x, z) {
    const near = this.places?.nearest(x, -z);
    this.tree = { x: +x.toFixed(1), z: +z.toFixed(1), n: 0, near: near?.name || null };
    this.saveTree(); this.markTree();
  }
  saveTree() { try { localStorage.setItem(firstTreeKey(this.tile.id, this.seasonNow()), JSON.stringify(this.tree)); } catch (e) { /* private mode: the mark lasts the session */ } }

  // ---- words ----
  say(html, hold = 0) {
    const el = this.lineEl; clearTimeout(this.lineT);
    if (!html) { el.classList.remove('on'); return; }
    if (el.classList.contains('on') && el.innerHTML !== html) { el.classList.remove('on'); this.lineT = setTimeout(() => { el.innerHTML = html; el.classList.add('on'); if (hold) this.lineT = setTimeout(() => el.classList.remove('on'), hold * 1000); }, 500); return; }
    el.innerHTML = html; el.classList.add('on');
    if (hold) this.lineT = setTimeout(() => el.classList.remove('on'), hold * 1000);
  }
  over(big, small = '', compact = false) {
    const el = this.overEl;
    if (!big) { el.classList.remove('on'); return; }
    el.replaceChildren(); const b = document.createElement('b'); b.textContent = big; el.append(b);
    if (small) { const i = document.createElement('i'); i.textContent = small; el.append(i); }
    el.classList.toggle('small', compact); el.classList.add('on');
  }
  dateText() { const d = this.dateNow(); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
  placeAt(x, z) { const p = this.places?.nearest(x, -z); return p ? p.name : this.tile.name || 'home'; }
  go(beat) { this.beat = beat; this.t = 0; this.done.add(beat); }
  after(s, fn) { this.timers.push({ at: this.total + s, fn }); }

  // ---- the start (main.js enterWorld) ----
  begin() {
    if (!this.active) return;
    document.documentElement.classList.add('first'); if (this.centre) document.documentElement.classList.add('first-centre');
    const f = this.flight; this.startAt = { x: f.pos.x, z: f.pos.z }; this.last = { x: f.pos.x, z: f.pos.z };
    f.setHover?.(true); f.pos.y = Math.min(f.pos.y, this.tile.heights.atXZ(f.pos.x, f.pos.z) + OPEN_M); f.pitch = OPEN_PITCH; f.camSettled = false;   // still, low enough to know a roof, looking down at the place
    this.lookDown = true;
    this.spirit.plain = true; if (this.spirit.view) this.spirit.view.amt = 0;   // the true colours until the wisp's beat (spirit.js look)
    this.peek.fadeMs = 0; this.setPeek(true);                 // today's photograph, under the entry's black
    this.blackAt = performance.now();
    this.go('today');
  }
  // the entry's black waits for the photograph (main.js stepEntry), ten seconds at most
  holdBlack() { return this.active && this.beat === 'today' && !this.peek.shown && performance.now() - this.blackAt < 10000; }

  update(dt) {
    if (this.failed) return;
    try { this.step(dt); } catch (e) { this.failed = true; console.error('first session: the guide stopped', e); this.say(''); this.over(''); if (this.spirit) this.spirit.plain = false; }
  }
  step(dt) {
    for (const b of this.beams) b.update(dt, this.camera);
    this.treeBeam?.update(dt, this.camera);
    if (!this.active || !this.beat) return;
    if (this.entering()) return;                               // under the black
    this.t += dt; this.total += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.total >= this.timers[i].at) { const [tm] = this.timers.splice(i, 1); tm.fn(); }
    const f = this.flight, form = this.form() || 'spirit';
    if (this.last) { this.moved += Math.hypot(f.pos.x - this.last.x, f.pos.z - this.last.z); this.last.x = f.pos.x; this.last.z = f.pos.z; }
    this.trackOffer(); this.trackTags();
    // the opening looks down at the place until the player takes the controls (the flight eases its pitch level by itself)
    if (this.lookDown) { if (f.keys?.size || f.drag || !f.hover || (this.beat !== 'today' && this.beat !== 'wild')) this.lookDown = false; else f.pitch = this.beat === 'wild' && this.sink ? OPEN_PITCH * (1 - 0.6 * Math.min(1, (this.t - this.sink.t0) / (WILD_S - 1))) : this.beat === 'wild' && this.roadsT != null ? OPEN_PITCH * 0.4 : OPEN_PITCH; }
    this[`b_${this.beat}`]?.(dt, form);
    // the body chosen decides the path, whenever it is chosen
    if (form !== this.formWas) { const was = this.formWas; this.formWas = form; this.onForm(form, was); }
    // the close: offered once, late, in any beat but the hawk's
    if (!this.chip && !this.cardShown && this.total > CARD_AT_S && this.beat !== 'hawk') this.offerCard();
  }

  onForm(form, was) {
    if (this.held && form !== 'spirit') { this.held = false; this.rise = null; this.spirit.plain = false; }   // a body entered while the eye was on the death
    if (was === undefined && form === 'spirit') return;
    if (form === 'spirit') { if (['fly', 'places', 'acorns', 'hide', 'squirrel', 'herd', 'free'].includes(this.beat)) { this.clearLights(); this.say('You are the spirit again. Touch anything alive to go on.', 9); this.go('loose'); } return; }
    this.clearOffer();
    if (this.beat === 'today' || this.beat === 'wild') this.endOpening();   // a body entered before the opening was over
    if (form === RAVEN) { if (!this.done.has('fly')) this.go('fly'); else if (!this.tree) this.go('acorns'); else this.go('free'); }
    else if (form === SQUIRREL) this.go(this.done.has('squirrel') ? 'free' : 'squirrel');
    else if (form === DEER) this.go(this.done.has('herd') ? 'free' : 'herd');
    else this.go('free');
  }

  // ---- today, then without us ----
  b_today() {
    if (!this.peek.shown) { if (this.t > 12) this.toWild(); return; }   // no photograph in this tile: straight to the world
    if (!this.capT) {
      this.capT = this.t; const wx = this.weather?.describe?.();
      this.over(this.placeAt(this.flight.pos.x, this.flight.pos.z), `${this.dateText()}${wx?.text ? ' · ' + wx.text : ''}`);
      this.say('This is here, today.');
    }
    if (this.t - this.capT > TODAY_S) this.toWild();
  }
  toWild() {
    this.peek.fadeMs = DISSOLVE_MS; this.setPeek(false); this.go('wild'); this.roadsT = null;
    this.say('The same place, the same day, without us.');
  }
  // the opening cut short: the photograph, its caption and the roads' lines off, the spirit's own look back
  endOpening() {
    this.peek.fadeMs = 0; if (this.peek.want || this.peek.shown) this.setPeek(false);
    if (this.roadsT != null && !this.roadsOff) { this.roadsOff = true; this.roads.group.visible = false; }
    this.over(''); this.spirit.plain = false; this.sink = null; this.lookDown = false;
  }
  b_wild() {
    if (this.peek.shown) return;                              // the photograph is still up (applied after the next frame)
    if (this.roadsT == null) { this.roadsT = this.t; this.roads.group.visible = true; this.sink = { y0: this.flight.pos.y, t0: this.t }; }   // the roads' lines linger, then go
    // the wisp is let down toward the ground as the world appears (hovering still; any key ends it: the controls are the player's)
    if (this.sink) {
      const f = this.flight, u = Math.min(1, (this.t - this.sink.t0) / (WILD_S - 1)), e = u * u * (3 - 2 * u), y1 = this.tile.heights.atXZ(f.pos.x, f.pos.z) + SINK_TO_M;
      if (f.keys?.size || !f.hover || this.sink.y0 <= y1) this.sink = null; else { f.pos.y = this.sink.y0 + (y1 - this.sink.y0) * e; if (u >= 1) this.sink = null; }
    }
    if (this.roadsT != null && this.t - this.roadsT > ROADS_S && !this.roadsOff) { this.roadsOff = true; this.roads.group.visible = false; }
    if (this.t - this.roadsT > WILD_S) { this.over(''); this.peek.fadeMs = 0; this.spirit.plain = false; this.sink = null; this.moved = 0; this.go('wisp'); }
  }

  // ---- the wisp and three bodies ----
  b_wisp() {
    if (this.t < 1.2) return;
    if (!this.toldMove) { this.toldMove = true; this.say('You are a spirit here. <kbd>W</kbd> to go, <kbd>S</kbd> to slow, <kbd>←</kbd> <kbd>→</kbd> or drag to turn, <kbd>X</kbd> and <kbd>Z</kbd> to rise and sink.'); }
    if (this.moved > 25 || this.t > 11) { this.offerBodies(); this.go('bodies'); }
  }
  offerBodies() {
    const f = this.flight, A = this.animals, fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
    const spots = [[RAVEN, 60, 0], [SQUIRREL, 48, -22], [DEER, 54, 26]];
    this.clearOffer(); this.offers = (this.offers || 0) + 1;
    for (const [code, ahead, side] of spots) {
      const at = { x: f.pos.x + fx * ahead + rx * side, z: f.pos.z + fz * ahead + rz * side };
      let a = null, bd = Infinity;
      for (const c of A.summon(code, 0, at) || []) { if (A.codeOf(c) !== code || c.dead) continue; const d = (c.x - at.x) ** 2 + (c.z - at.z) ** 2; if (d < bd) { bd = d; a = c; } }
      if (!a) for (const c of A.list) { if (A.codeOf(c) !== code || !A.alive(c) || !A.playable(c)) continue; const d = (c.x - at.x) ** 2 + (c.z - at.z) ** 2; if (d < bd) { bd = d; a = c; } }
      if (!a) continue;
      const beam = new Beam(this.scene, 0xffc46a, 60, 0.7); beam.want = 1.5; this.beams.push(beam);
      this.offer.push({ a, code, beam });
    }
    const names = { [RAVEN]: 'the raven', [SQUIRREL]: 'the squirrel', [DEER]: 'the deer' };
    const keys = this.offer.map((o, i) => `<kbd>${i + 1}</kbd> ${names[o.code]}`).join(' · ');
    this.say(this.offer.length ? `Anything alive can carry you. Three are near, under the lights: touch one. (${keys})` : 'Anything alive can carry you. Touch one.');
  }
  trackOffer() {
    for (const o of this.offer) { if (!this.animals.alive(o.a)) { o.beam.want = 0; continue; } o.beam.set(o.a.x, o.a.y, o.a.z); }
  }
  clearOffer() { for (const o of this.offer) o.beam.want = 0; this.offer.length = 0; }
  b_bodies() {
    // flown past them all: the three are put ahead again (a few times; then the keys are the way)
    const f = this.flight; let near = Infinity; for (const o of this.offer) near = Math.min(near, Math.hypot(o.a.x - f.pos.x, o.a.z - f.pos.z));
    if (near > OFFER_FAR_M && this.offers < OFFER_AGAIN && this.t > 6) { this.offerBodies(); this.t = 0; }
    if (this.t > 60 && !this.toldAgain) { this.toldAgain = true; this.say('Fly down into one of the lights. Or press <kbd>1</kbd>, <kbd>2</kbd> or <kbd>3</kbd>.'); }
  }
  b_loose() { }

  // ---- the raven: home from the air ----
  b_fly() {
    const f = this.flight, air = 'You are flying. <kbd>W</kbd> faster, <kbd>S</kbd> slower. <kbd>←</kbd> <kbd>→</kbd> or drag to steer. <kbd>X</kbd> and <kbd>Z</kbd> to climb and sink.';
    if (!this.toldFly) { this.toldFly = f.landed ? 'ground' : 'air'; this.say(f.landed ? 'You are a raven, standing on the ground. <kbd>Space</kbd> takes off.' : air); }
    if (this.toldFly === 'ground') { if (f.landed) return; this.toldFly = 'air'; this.t = 0; this.say(air); }   // off the ground: the flight's keys
    if (this.t > 10) { if (this.centre) { this.say('Fly home. There is no map.', 12); this.go('acorns'); this.acornsAfter = 150; } else { this.raisePlaces(); this.go('places'); } }
  }
  raisePlaces() {
    const F = this.tile.features || {}, f = this.flight, px = f.pos.x, pn = -f.pos.z, cands = [];
    const add = (name, x, n, rank) => { const d = Math.hypot(x - px, n - pn); if (name && d > PLACE_R[0] && d < PLACE_R[1]) cands.push({ name, x, n, d, rank, bearing: Math.atan2(x - px, n - pn) }); };
    for (const p of F.places || F.pois || []) { const at = p.at || [p.x, p.north ?? p.n ?? p.y]; if (Number.isFinite(at[0] + at[1])) add(p.name, at[0], at[1], 0); }
    for (const w of F.waterbodies || []) { if (!w.name || !w.ring?.length) continue; let sx = 0, sn = 0; for (const [x, n] of w.ring) { sx += x; sn += n; } add(w.name, sx / w.ring.length, sn / w.ring.length, 1); }
    const seen = new Map();   // a creek: its vertex nearest the player, one light per name
    for (const s of F.streams || []) { if (!s.name || !(s.order >= 3)) continue; for (const [x, n] of s.path) { const d = Math.hypot(x - px, n - pn); const b = seen.get(s.name); if (d > PLACE_R[0] && (!b || d < b.d)) seen.set(s.name, { x, n, d }); } }
    for (const [name, v] of seen) add(name, v.x, v.n, 2);
    const near = c => c.d * (c.rank === 0 ? 0.55 : c.rank === 1 ? 0.8 : 1);   // a town counts as nearer than a creek as far off
    cands.sort((a, b) => near(a) - near(b));
    const picks = [];
    for (const c of cands) {   // three, spread round the compass (a second pass takes what is left)
      if (picks.length >= 3) break;
      if (picks.some(p => p.name === c.name || Math.abs(Math.atan2(Math.sin(p.bearing - c.bearing), Math.cos(p.bearing - c.bearing))) < 0.7)) continue;
      picks.push(c);
    }
    for (const c of cands) { if (picks.length >= 3) break; if (!picks.some(p => p.name === c.name)) picks.push(c); }
    for (const c of picks) {
      const z = -c.n, y = this.tile.heights.atXZ(c.x, z), beam = new Beam(this.scene, 0xdff3ff, 700, 2); beam.set(c.x, y, z); beam.want = 1; this.beams.push(beam);
      const tag = document.createElement('div'); tag.className = 'firstTag'; tag.hidden = true; const sm = document.createElement('small'); tag.append(c.name, sm); document.body.append(tag);
      const l = { name: c.name, x: c.x, y, z, beam, tag, sm }; this.lights.push(l); this.tags.push(l);
    }
    this.say(picks.length ? 'Places you know stand as lights on the horizon. Fly to one.' : 'Fly. This is your home from the air.', picks.length ? 0 : 10);
    if (!picks.length) this.go('acorns');
  }
  trackTags() {
    if (!this.tags.length) return;
    const cam = this.camera, v = this._v, W = innerWidth, H = innerHeight;
    for (const l of this.tags) {
      v.set(l.x, l.y + Math.min(260, 60 + cam.position.distanceTo(v.set(l.x, l.y, l.z)) * 0.12), l.z); const dist = Math.hypot(l.x - this.flight.pos.x, l.z - this.flight.pos.z);
      v.project(cam);
      const on = l.beam.want > 0 && v.z < 1 && v.z > -1 && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.95;
      l.tag.hidden = !on; if (!on) continue;
      l.sm.textContent = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist / 10) * 10} m`;
      l.tag.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
  clearLights() { for (const l of this.lights) { l.beam.want = 0; l.tag.hidden = true; l.tag.remove(); } this.lights.length = 0; this.tags.length = 0; }
  b_places() {
    const f = this.flight;
    if (!this.flick) {
      for (const l of this.lights) if (Math.hypot(l.x - f.pos.x, l.z - f.pos.z) < ARRIVE_M) {   // reached: what stands there today, for a moment
        this.flick = { l, t: this.t }; this.found = l.name; this.peek.fadeMs = FLICKER_MS; this.setPeek(true);
        this.over(l.name, 'as it is today', true); this.say('');
        break;
      }
      if (!this.flick && this.t > PLACES_MAX_S) { this.clearLights(); this.go('acorns'); }
      return;
    }
    if (this.t - this.flick.t > FLICKER_S && !this.flick.off) { this.flick.off = true; this.setPeek(false); }
    if (this.t - this.flick.t > FLICKER_S + 2.5) { this.over(''); this.peek.fadeMs = 0; this.clearLights(); this.flick = null; this.go('acorns'); }
  }

  // ---- acorns: taken, hidden, and the tree that becomes the player's ----
  b_acorns() {
    const G = this.acorns, me = G?.player;
    if (!G?.collecting || !me) { if (this.t > 2) this.go('free'); return; }   // not this season's food here: no acorn beat
    if (this.t < (this.acornsAfter || 1.5)) return;
    if (!this.toldAcorns) { this.toldAcorns = true; this.say(`It is ${MONTHS[this.dateNow().getMonth()]}. Acorns are down. Fly close to an oak that glows, and take one.`); }
    if (me.carrying > 0) { this.carried = me.carrying; this.go('hide'); this.say('Now hide them. Some oaks have a hole with a lit rim: fly close to one, where no one is watching.'); }
  }
  b_hide() {
    const me = this.acorns?.player; if (!me) return;
    if (me.carrying < this.carried) {                         // one went into a hole here
      this.hid += this.carried - me.carrying;
      if (!this.tree) { this.setTree(this.flight.pos.x, this.flight.pos.z); this.say('Hidden. This oak is yours now. It will be here tomorrow.'); this.treeAt = this.t; }
      this.tree.n = (this.tree.n || 0) + (this.carried - me.carrying); this.saveTree();
    }
    this.carried = me.carrying;
    if (this.treeAt != null && this.t - this.treeAt > 9) this.go('other');
  }
  b_other() {
    if (!this.toldOther) { this.toldOther = true; this.say('A squirrel watched you do it. Press <kbd>Enter</kbd> to be the squirrel.'); }
    if (this.t > OTHER_MAX_S) { this.say(''); this.go('free'); }
  }
  beSquirrel() {
    const A = this.animals, P = this.flight.pos, t = this.tree && Math.hypot(this.tree.x - P.x, this.tree.z - P.z) < 120 ? this.tree : { x: P.x, z: P.z };   // (a tree kept from an earlier day may be across the tile)
    if (this.spirit.body) this.spirit.leave();
    this.say('');
    setTimeout(() => {
      const at = { x: t.x + 3, z: t.z + 2 }; let a = null, bd = Infinity;
      for (const c of A.summon(SQUIRREL, 0, at) || []) { if (A.codeOf(c) !== SQUIRREL || c.dead) continue; const d = (c.x - at.x) ** 2 + (c.z - at.z) ** 2; if (d < bd) { bd = d; a = c; } }
      if (!a) for (const c of A.list) { if (A.codeOf(c) !== SQUIRREL || c.dead || !A.alive(c)) continue; const d = (c.x - at.x) ** 2 + (c.z - at.z) ** 2; if (d < bd) { bd = d; a = c; } }
      if (!a || !this.spirit.enter(a.id)) this.say('No squirrel is near. Touch anything alive to go on.', 9);
    }, 700);
  }

  // ---- the other side: the squirrel, and one hawk ----
  b_squirrel() {
    const me = this.acorns?.player;
    if (!this.toldSq) { this.toldSq = true; this.sqCarry = me?.carrying || 0; this.say('You are a gray squirrel. <kbd>W</kbd> runs, <kbd>A</kbd> <kbd>D</kbd> turn. Run into a trunk to climb it. <kbd>E</kbd> picks up an acorn, and buries it.'); }
    if (me) { if (me.carrying < this.sqCarry) this.buried = true; this.sqCarry = me.carrying; }
    if ((this.buried && this.t > 12) || this.t > BURY_MAX_S) this.go('hawk');
  }
  b_hawk(dt = 0) {
    const f = this.flight, A = this.animals, sq = this.squirrel;
    if (!this.warned) {
      this.warned = true; this.say('Jays are calling. Something is hunting. Get up a tree.');
      A.emit?.('alarm', { species: JAY, x: f.pos.x + 9, y: f.pos.y + 6, z: f.pos.z - 7, carry: 200, alarmed: 1, predator: 'buteo_jamaicensis' });
    }
    if (this.t > HAWK_WARN_S && !this.hawk && !this.hawkTried) {
      this.hawkTried = true; this.hawk = A.stoopOn?.(f.pos.x, f.pos.z) || null;
      if (!this.hawk) { this.say('It passes over. Not this time.', 8); this.after(9, () => this.offerCard()); this.go('free'); return; }
    }
    const h = this.hawk; if (!h) return;
    const up = f.pos.y - this.tile.heights.atXZ(f.pos.x, f.pos.z);
    const low = !!sq?.on && up <= SAFE_UP_M && (sq.mode === 'ground' || sq.mode === 'stun' || (sq.mode === 'work' && !sq.work?.back));   // on the ground, where a hawk can take it
    const aim = this.aim ||= { x: f.pos.x, z: f.pos.z, over: OVER_M[1] };
    const ax = f.pos.x - aim.x, az = f.pos.z - aim.z, ad = Math.hypot(ax, az), k = h.u < 0.75 ? 1 : Math.min(1, TRACK_MS * dt / (ad || 1));
    aim.x += ax * k; aim.z += az * k;
    aim.over += Math.max(-4 * dt, Math.min(4 * dt, OVER_M[low ? 0 : 1] - aim.over));
    A.stoopAim?.(h, aim.x, aim.z, aim.over);
    if (h.u >= 0.97 || !A.alive(h)) {
      const safe = !low || !A.alive(h) || Math.hypot(aim.x - f.pos.x, aim.z - f.pos.z) > CAUGHT_M;
      this.hawk = null; this.aim = null;
      if (safe) { this.say('It pulls away. Not this time.', 9); this.after(10, () => this.offerCard()); this.go('free'); }
      else this.caught(h);
    }
  }
  // The hawk takes the squirrel: the player is out of the body, which goes back to the world where it stood and dies
  // there as any animal does (animals.js stoopTake: the grab, the fall onto its side, the carcass, the hawk mantling
  // over it, the soul rising, spirit.js); the screen blinks, the eye stays, and the wisp rises away past the body.
  caught(h) {
    const f = this.flight, A = this.animals, id = this.spirit.body?.id, c = this.camera.position;
    let ex = c.x - f.pos.x, ez = c.z - f.pos.z; const el = Math.hypot(ex, ez), eye = Math.hypot(ex, c.y - f.pos.y, ez);   // toward the eye: the ground the player was looking over is clear
    if (el > 0.5) { ex /= el; ez /= el; } else { ex = Math.sin(f.yaw); ez = Math.cos(f.yaw); }
    this.spirit.plain = true; if (this.spirit.view) this.spirit.view.amt = 0;
    this.flashEl.classList.add('on'); setTimeout(() => this.flashEl.classList.remove('on'), BLINK_MS);
    if (this.spirit.body) this.spirit.leave();
    const body = id != null ? A.byId?.get(id) : null;
    this.took = !!(body && A.stoopTake?.(h, body));
    if (this.took) {
      const far = Math.min(RISE_FAR[1], Math.max(RISE_FAR[0], CHASE_M - el)), x = f.pos.x - ex * far, z = f.pos.z - ez * far, H = this.tile.heights;
      this.rise = { t: 0, x0: f.pos.x, y0: f.pos.y, z0: f.pos.z, x, z, y: Math.max(H.atXZ(f.pos.x, f.pos.z), H.atXZ(x, z)) + RISE_UP_M };
      f.yaw = f.camYaw = Math.atan2(ex, ez);   // facing away from the eye (the flight's yaw: 0 faces -z)
      this.held = eye > 1.2 && !!this.spirit.blend; this.fresh = false;   // (not from inside the body: a first-person view)
      if (this.held) this.spirit.blend.hold = HOLD_MAX_S;
    }
    if (!this.held) this.spirit.plain = false;
    this.say('The hawk had you. Out here that is the end of a squirrel, and a meal for a hawk. Choose again.', 12);
    this.after(13, () => this.offerCard()); this.go('caught');
  }
  b_caught(dt = 0) {
    const r = this.rise, f = this.flight, B = this.spirit.blend;
    if (this.held) {   // the eye on the death, until the player's own hand (a key pressed anew or a drag, once the wisp is clear) or the time is up
      if (!(B.hold > 0) || this.form() !== 'spirit') { this.held = false; this.spirit.plain = false; }
      else if (!r && (this.fresh || f.drag)) B.hold = 0;
      else { f.keys?.clear(); f.speed = 0; }   // keys still down from the squirrel's run do not carry the wisp off
    }
    if (!r) return;
    if (this.form() !== 'spirit') { this.rise = null; return; }
    r.t += dt; const u = Math.min(1, r.t / RISE_S), e = u * u * (3 - 2 * u);
    this.spirit.coolT = Math.max(this.spirit.coolT || 0, 0.4);   // no touch while it rises: the hawk stands on the body it leaves
    f.pos.set(r.x0 + (r.x - r.x0) * e, r.y0 + (r.y - r.y0) * e, r.z0 + (r.z - r.z0) * e); f.pitch = -0.2 * e;
    if (u >= 1) this.rise = null;
  }

  // ---- the deer: the quiet path ----
  b_herd() {
    if (!this.toldHerd) { this.toldHerd = true; this.say('You are a deer. <kbd>W</kbd> walks, <kbd>A</kbd> <kbd>D</kbd> turn. <kbd>E</kbd> grazes. When you stop, the herd carries on around you.', 16); }
    if (this.t > QUIET_S) { this.offerCard(); this.go('free'); }
  }
  b_free() { if (this.t > QUIET_S && !this.chip && !this.cardShown) this.offerCard(); }

  // ---- the card ----
  offerCard() { if (this.cardShown || this.chip) return; this.chip = true; this.say('<kbd>Enter</kbd> Today at home'); }
  openCard() {
    this.chip = false; this.cardShown = true; this.cardOpen = true; this.say('');
    const G = this.acorns, season = this.seasonNow(), wx = this.weather?.describe?.(), el = document.createElement('div'); el.id = 'firstCard';
    const fc = document.createElement('div'); fc.className = 'fc'; el.append(fc);
    const add = (tag, text, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; fc.append(e); return e; };
    add('h2', 'Today at home');
    add('h1', this.startAt ? this.placeAt(this.startAt.x, this.startAt.z) : this.tile.name || '');
    add('p', `${this.dateText()}${wx?.text ? ' · ' + wx.text : ''}`, 'when');
    add('h3', 'Your cache');
    const t = this.tree;
    add('p', t && t.n > 0 ? `${t.n === 1 ? 'One acorn' : t.n + ' acorns'} hidden in your oak${t.near ? ' near ' + t.near : ''}. A gold light stands over it for you alone.` : 'Nothing hidden yet. The oaks are still dropping acorns: any raven can carry three.');
    if (this.found) add('p', `You found ${this.found} from the air.`);
    const board = G?.world?.board;
    if (board) {
      add('h3', `This ${season}'s acorns, by who hid them`);
      const b = document.createElement('div'); b.className = 'board'; fc.append(b);
      for (const [code, name] of [['melanerpes_formicivorus', 'woodpeckers'], [SQUIRREL, 'squirrels'], [RAVEN, 'ravens']]) { const c = document.createElement('div'); const n = document.createElement('b'); n.textContent = String(board[code] ?? 0); const s = document.createElement('span'); s.textContent = name; c.append(n, s); b.append(c); }
    }
    add('h3', `${season[0].toUpperCase()}${season.slice(1)} here`);
    for (const l of SEASON_LINES[season] || []) add('p', l);
    add('h3', 'Outside, today');
    add('p', OUTSIDE[season] || OUTSIDE.fall, 'out');
    const row = document.createElement('div'); row.className = 'row'; fc.append(row);
    const keep = document.createElement('button'); keep.className = 'go'; keep.textContent = 'Keep playing'; keep.onclick = () => this.closeCard(); row.append(keep);
    const share = document.createElement('button'); share.textContent = 'Copy a link for a neighbour';
    share.onclick = async () => { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?first=1`); share.textContent = 'Copied'; } catch (e) { share.textContent = `${location.origin}${location.pathname}?first=1`; } };
    row.append(share);
    add('p', 'Your acorns stay hidden here until someone finds them. Tomorrow this place will have tomorrow\'s weather.', 'fine');
    document.body.append(el); this.cardEl = el; requestAnimationFrame(() => el.classList.add('on')); keep.focus({ preventScroll: true });
    try { localStorage.setItem('wild-earth:first:done', new Date().toISOString().slice(0, 10)); } catch (e) { /* private mode */ }
  }
  closeCard() {
    const el = this.cardEl; this.cardOpen = false; this.cardEl = null; if (!el) return;
    el.classList.remove('on'); setTimeout(() => el.remove(), 650);
    document.documentElement.classList.remove('first', 'first-centre');   // the rest of the HUD from here
  }

  dispose() {
    removeEventListener('keydown', this.onKey); clearTimeout(this.lineT);
    for (const b of this.beams) b.dispose(this.scene); this.treeBeam?.dispose(this.scene); this.beams.length = 0;
    for (const l of this.tags) l.tag.remove();
    this.lineEl.remove(); this.overEl.remove(); this.flashEl.remove(); this.cardEl?.remove(); this.style.remove();
    document.documentElement.classList.remove('first', 'first-centre');
    if (this.spirit) this.spirit.plain = false;
  }
}
