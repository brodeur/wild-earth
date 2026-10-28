import * as THREE from 'three';
import { uniforms as atmo } from './atmosphere.js';
import { SELF_LIT, rarityColor } from './animals.js';
import { bodyKind } from './playable.js';

// The spirit: the form the player starts in (main.js enter). A glowing, swirling wisp flown with the raven's keys
// (RavenFlight with flight.spirit on: flight.js updateSpirit; faster, no glide, no landing, kept over the ground and
// water), seen by nothing (animals.js: observer 'spirit' perceives every animal and none reacts to it). Touching a
// playable animal (any species in the world: animals.js playableNear, within TOUCH_R of its body, TOUCH_AIR of a bird in
// flight so one is catchable at speed) the player is that animal at once, where it was: the raven through RavenFlight
// (in the air, on the ground or a limb), the squirrel and the woodpecker through their own controls
// (squirrelControl.js, woodpeckerControl.js enterAt), every walker through groundControl.js and the hawk, vulture and
// jays through flierControl.js (playable.js bodyKind says which), the HUD, help line and perception theirs,
// while the wisp dives into the body and implodes (FLASH_IN s). The AI animal entered is held out of the population
// meanwhile (animals.js take), so there is no double. B (or the panel's "Back to spirit form") leaves the body: the
// animal is put back where the player leaves it and carries on its own life from there (animals.js release), and the
// wisp forms out of it as it rises (FLASH_OUT s, or as long as the camera's blend), ignoring that animal until it is
// CLEAR_R m away. Either way the view does not cut: CameraBlend (below; main.js calls it around the render) carries the
// camera from the old view to the new control's over BLEND_T s or a little more.
//
// The spirit's view (SpiritLook below, owner's requests): while a spirit, the world is faint, misty and blue-green and
// the bodies it can join are the only warm things in it. Done through the light, every world material untouched: after
// the Atmosphere's frame update the sun goes faint and blue, the sky light and the haze's colours blue-green, the haze
// thicker (so distance fades into mist), and a veil of mist on a shell past the land covers the sky dome. The playable
// species are drawn self-lit in their own colour (animals.js SELF_LIT) and carry a warm glow like the acorn game's,
// faint from far off and brightening on approach with the same easing as the wisp's swell. It fades in over LOOK_T s
// as the spirit forms and out with the camera's blend on a jump. The sky light and haze have a floor (LOOK_FLOOR), so a
// spirit's dusk and night are a readable blue. What warm albedo is left (fall leaves, gold grass) a light post pass
// cools (render(): the frame copied to a texture, a full-screen quad pulling warm hues toward grey-blue-green), then
// camera layer 1 is drawn over it: the playable species (self-lit, full colour), their glow, the sky's veil with the
// sunset glow let through it in blue-violet, and the wisp, so they are untouched by the pass and still occluded.
//
// The wisp (Wisp below), at the flight body's position so the chase camera and the arrival flight work as they do for
// the raven: a veil of light rather than a set of spheres. RIBBONS translucent streamers, each a camera-facing strip
// along the spirit's recent path (a ring of past positions; hovering, the path runs on up and back from it) woven round
// that path in a slow helix, RIB_LEN x RIB_LENS m long (longer at speed), ~20 cm wide at the head tapering and fading to the tail,
// warm at the head and pale blue behind; MIST large soft billboards (a noisy radial-gradient sprite drawn once on a
// canvas) drifting, turning and breathing round the core; MOTES a few dim specks in the mist, streaked along the
// velocity; and a small warm core sprite. Three draws (the ribbons and motes are one mesh), additive, no tone mapping,
// no asset files. Everything nearer the lens than ~1.5 m fades out, so a trail passing under the camera does not blot it.

const RIBBONS = 8, SEG = 40, RIB_LEN = 2.2, MIST = 7, MOTES = 22, HIST_T = 0.9;   // HIST_T s: how old a path point still shapes the ribbons
// In flight the ribbons hang along the path the spirit has flown (a ring of past positions resampled every TRAIL_RS m,
// HIST_N of them), so a turn leaves a curved trail in the air that the body pulls away from: the longest one is
// TRAIL_T s of travel, at most TRAIL_MAX m (x 0.55-1 with the swell); hovering they shorten to the curl up and back
// (RIB_LEN), blended by speed between TRAIL_SLOW and TRAIL_FAST m/s. Along a long trail the weave turns TRAIL_WAVE rad/m.
const TRAIL_RS = 0.15, HIST_N = 160, TRAIL_T = 0.8, TRAIL_MAX = 14, TRAIL_SLOW = 1.5, TRAIL_FAST = 10, TRAIL_WAVE = 0.9;
// The eight ribbons differ so they never fall into step: the first three as the wisp was first made (a short, a middle
// and a long one), then three more of the same kind, each shorter than the last, then a medium and a short one that
// weave the other way round the spine (a negative period) at a lower brightness (RIB_ALPHA) (owner, 2026-10-27):
// lengths (x RIB_LEN), weave periods (x RIB_PERIOD s; ratios with no simple multiples), weave radii (x the base),
// starting phases (rad) and brightness (x the base).
const RIB_LENS = [1, 1.4, 1.9, 0.75, 0.55, 0.4, 1.0, 0.55], RIB_PERIOD = 4.2, RIB_PERIODS = [1, 1.31, 1.73, 0.87, 1.13, 0.79, -1.07, -0.93];
const RIB_RADII = [1, 0.8, 1.18, 0.9, 0.7, 0.6, 0.85, 0.65], RIB_PHASES = [0, 2.3, 4.1, 1.1, 3.4, 5.2, 0.6, 2.9], RIB_ALPHA = [1, 1, 1, 1, 1, 1, 0.65, 0.65];
// The wisp at rest is REST_SCALE of its full size (RIB_LEN etc. are the full size) and REST_LUM of its full brightness;
// near a body it can inhabit it swells: from SWELL_FAR m off to full at the contact radius (smoothstep with distance,
// eased at SWELL_K 1/s so animals coming and going do not make it flicker), its ribbons and mist turning up to
// SWELL_SWIRL times faster, so the pull is felt before the jump.
const REST_SCALE = 0.5, REST_LUM = 0.6, SWELL_FAR = 14, SWELL_K = 6, SWELL_SWIRL = 1.7;
const TOUCH_R = 2.5, TOUCH_AIR = 4;                   // m: contact with an animal's body; with a raven in flight
const FLASH_IN = 0.45, FLASH_OUT = 0.8;               // s: the implosion into a body; the wisp forming out of one (at least the camera blend)
const COOL_T = 2.0, CLEAR_R = 6;                      // s after leaving a body before another contact; m from the one left
const SPIRIT = 'spirit';
// the look: fade time (s); the sun's strength and tint; the sky light, haze and sky tints; haze thickening; the glow
const LOOK_T = 0.9, LOOK_SUN = 0.35, LOOK_SUN_TINT = new THREE.Color(0.4, 0.66, 1.0), LOOK_AMB = new THREE.Color(0.3, 0.82, 0.95);
const LOOK_HAZE = new THREE.Color(0.5, 0.85, 0.9), LOOK_MIE = 14;
// the floor: a spirit's dusk is a blue dusk, readable like moonlight: the sky light times the exposure is kept at least
// LOOK_FLOOR, the haze's colours at least LOOK_HAZE_FLOOR (the real ones fall to near nothing as the sun goes down)
const LOOK_FLOOR = 0.8, LOOK_HAZE_FLOOR = 0.35;
// the sky: the veil's strength (it is the mist's own far colour, so the land dissolves into it), and the sunset glow let through it, cooled to blue-violet (LOOK_GLOW), as strong as the
// dome's own glow toward the sun times LOOK_GLOW_K, at most LOOK_GLOW_MAX
const LOOK_VEIL = 0.94, LOOK_GLOW = new THREE.Color(0.62, 0.5, 1.0), LOOK_GLOW_K = 0.6, LOOK_GLOW_MAX = 0.75;
const LOOK_TWILIGHT = 0.3;   // the glow's least through twilight (sun 2 degrees up to about 17 down), after the dome's has gone
// the post pass: how far warm hues are pulled to grey-blue-green (by their hue's distance from the blue-green axis), and
// the contrast it takes off; both fade with the look
const POST_WARM = 1.0, POST_CONTRAST = 0.1;
const GLOW_CAP = 1024, GLOW_FAR = 0.6;   // GLOW_CAP: every animal present gets a soul (one quad each; the far ones are culled in the vertex shader); GLOW_FAR: its strength far off (to 1 at contact)
// Each soul's glow (owner, 2026-10-27): its colour by the species' rarity on the tile (animals.js rarityColor, purple for
// the abundant to red for the rare), its brightness from GLOW_LUM[0] for the most abundant to GLOW_LUM[1] for the rarest,
// and round the core a wider faint bubble, GLOW_BUBBLE times the core's radius at GLOW_BUBBLE_A of its strength.
const GLOW_LUM = [0.55, 1.4], GLOW_BUBBLE = 2.4, GLOW_BUBBLE_A = 0.09;
// The rare are found from further off (owner): a soul's reach, the distance its far strength fades out over, runs from
// GLOW_REACH[0] m for the most abundant to GLOW_REACH[1] for the rarest (animals live within 400 m of the player,
// animals.js LIVE_R, so the far end means the whole live population), and its quad grows with rarity by up to
// GLOW_RARE_SIZE. BEACON: species whose souls are a test beacon, lit full and large at any distance (owner, 2026-10-27:
// "make it extremely bright or obvious where the mountain lions are even from far away").
const GLOW_REACH = [250, 600], GLOW_RARE_SIZE = 1.6, BEACON = new Set(['puma_concolor']), BEACON_LUM = 8.0, BEACON_SIZE = 5.0;
// A beacon animal also carries a beam: a BEAM_H m column of light BEAM_W m wide over it, a billboard turning about the
// vertical, additive and drawn through the terrain, in its soul's colour, so it is found from anywhere in the live set.
const BEAM_CAP = 32, BEAM_W = 2.5, BEAM_H = 90;
const COOL = new THREE.Color(0.6, 0.78, 1.0), WARM = new THREE.Color(1.0, 0.84, 0.58), WHITE = new THREE.Color(0.9, 0.95, 1.0);
const smooth = u => u * u * (3 - 2 * u);

export class SpiritControl {
  constructor({ scene, renderer, camera, flight, raven, animals, squirrel, woodpecker, ground = null, flier = null, atmosphere, onBody = null }) {
    Object.assign(this, { scene, camera, flight, raven, animals, squirrel, woodpecker, ground, flier, onBody });
    this.on = false; this.body = null;   // body: the AI animal the player is in ({ id, code, sex }), or null
    this.fx = null;                      // the flash: { kind: 'in' | 'out', t, dur, from, lift }
    this.coolT = 0; this.ignoreId = null; this.swell = 0; this.prevP = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.wisp = new Wisp({ renderer, camera, scene, layer: 1 });   // layer 1: drawn over the spirit's view (SpiritLook.render)
    this.blend = new CameraBlend(camera, flight);
    this.view = new SpiritLook(scene, renderer, atmosphere, animals, flight, camera, this.wisp);
    this._q = new THREE.Vector3();
    // the HUD's words as index.html has them (the raven's); hud(on) swaps the spirit's in and back
    const $ = id => document.getElementById(id), h1 = $('hud')?.querySelector('h1'), near = $('animalsNear')?.parentElement;
    this.hudWas = { h1: h1?.firstChild?.nodeValue, help: $('help')?.innerHTML, near: near?.title };
    const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    // B, or Escape when it closed nothing else (the field guide and the species card take it first, and the
    // credits panel stops it while open), gives the body back and returns to spirit form.
    addEventListener('keydown', e => {
      if (e.repeat || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const card = document.getElementById('speciesCard'), cardOpen = !!card && !card.classList.contains('hidden');
      if (e.code === 'KeyB' || (e.code === 'Escape' && !e.fieldGuideClosed && !e.speciesCardClosed && !cardOpen)) this.leave();
    });
  }

  // Spirit form on or off: the flight's spirit mode, the raven hidden, the wisp, the HUD. (The bodies: enter, leave.)
  setOn(on) {
    on = !!on; if (on === this.on) return;
    this.on = on;
    this.flight.setSpirit(on);
    this.raven.setHidden(on);
    if (on) { this.prevP.copy(this.flight.pos); this.wisp.reset(this.flight.pos); }
    this.hud(on);
  }
  hud(on) {
    const $ = id => document.getElementById(id), h1 = $('hud')?.querySelector('h1'), help = $('help'), near = $('animalsNear')?.parentElement, W = this.hudWas;
    if (h1?.firstChild) h1.firstChild.nodeValue = on ? 'spirit ' : W.h1;
    if (help) help.innerHTML = on ? '<kbd>↑</kbd><kbd>↓</kbd> pitch · <kbd>←</kbd><kbd>→</kbd> turn · <kbd>W</kbd><kbd>S</kbd> speed (<kbd>shift</kbd> rush) · '
      + '<kbd>X</kbd><kbd>Z</kbd> rise / sink · <kbd>space</kbd> lift · <kbd>H</kbd> hover · touch an animal to become it (the warm ones: any animal you find) · '
      + '<kbd>V</kbd> view · <kbd>R</kbd> reset · <kbd>M</kbd> map · <kbd>G</kbd> roads · <kbd>P</kbd> present day · <kbd>T</kbd> tags · <kbd>N</kbd> mute · click a tree to identify · drag mouse to look' : W.help;
    if (near) near.title = on ? 'every animal within 150 m: a spirit perceives them all, and none of them perceives it' : W.near;
  }

  // The frame while a spirit (main.js, in place of flight.update): the flight, then contact with an animal.
  update(dt) {
    const f = this.flight, P = f.pos;
    if (P.distanceToSquared(this.prevP) > 50 * 50) this.prevP.copy(P);   // moved from outside (R, Go to, the arrival): no sweep
    const r = f.update(dt);
    this.coolT -= dt;
    if (this.ignoreId) {   // the animal just left: not again until the wisp is clear of it
      const o = this.animals.peek(this.ignoreId);
      if (!o || Math.hypot(o.x - P.x, o.y - P.y, o.z - P.z) > CLEAR_R) this.ignoreId = null;
    }
    if (this.coolT <= 0 && this.touch()) return r;
    this.prevP.copy(P);
    return r;
  }
  // Contact along the frame's move (every 2 m: a fast frame must not pass through a squirrel): into that animal.
  touch() {
    const P = this.flight.pos, a = this.prevP, n = Math.max(1, Math.ceil(a.distanceTo(P) / 2)), q = this._p;
    for (let i = 1; i <= n; i++) {
      q.lerpVectors(a, P, i / n);
      const hit = this.animals.playableNear(q.x, q.y, q.z, TOUCH_R, TOUCH_AIR);
      if (hit && hit.id !== this.ignoreId) return this.enter(hit.id);
    }
    return false;
  }

  // Into the animal at once: it leaves the population and the player is it, where it was. The camera blends over from
  // the spirit's (CameraBlend) and the wisp dives into the body and implodes over the blend's first FLASH_IN s.
  enter(id) {
    const f = this.flight, kind = bodyKind(this.animals.peek(id)?.code);
    const control = kind === 'ground' ? this.ground : kind === 'flier' ? this.flier : true;
    if (!control) { this.coolT = 0.3; return false; }   // a body with no control wired (main.js): still a spirit
    const from = f.pos.clone(), o = this.animals.take(id);
    if (!o) { this.coolT = 0.3; return false; }   // gone meanwhile (out of the live set): still a spirit
    this.blend.capture();
    this.body = { id, code: o.code, sex: o.sex };
    f.keys.clear(); f.drag = null;
    this.setOn(false);   // the HUD back to the raven's first: the controls below swap their own words in over it
    if (o.code === 'sciurus_griseus') { this.squirrel.setOn(true); this.squirrel.enterAt(o); }
    else if (o.code === 'melanerpes_formicivorus') { this.woodpecker.setOn(true, o.sex); this.woodpecker.enterAt(o); }
    else if (kind === 'ground' || kind === 'flier') { control.setOn(true, o.code); control.enterAt(o); }
    else {   // the raven: in the air at its speed, or standing where it stood (on a limb a raven can hold, else hovering there)
      f.yaw = o.yaw; f.roll = 0; f.hover = false;
      if (o.where === 'air') { f.pos.set(o.x, o.y, o.z); f.pitch = THREE.MathUtils.clamp(o.pitch, -0.6, 0.5); f.speed = Math.max(8, o.speed); f.noLand = 0.6; f.cut = true; }
      else {
        const perch = o.where === 'top' ? f.perchNear(o.x, o.y + 0.1, o.z, 1.0) : null;
        f.pitch = 0; f.pos.set(o.x, o.y + 0.2, o.z);
        if (perch || o.where === 'ground') f.settleOn(perch, o.y);
        else { f.speed = 0; f.hover = true; f.cut = true; }
      }
      f.camSettled = false;
    }
    this.fx = { kind: 'in', t: 0, dur: FLASH_IN, from, lift: o.code === 'corvus_corax' ? 0 : 0.12 };
    this.onBody?.(o.code, o.sex);
    return true;
  }
  // Back to spirit form (B, the panel button): the animal carries on where the player leaves it; the wisp rises out of
  // it, forming over the camera's blend from the body's view to the spirit's chase view.
  leave() {
    if (this.on) return false;
    const f = this.flight, G = f.gnd;
    this.blend.capture();
    let o;
    if (this.squirrel.on) { o = this.squirrel.leaveInfo(); this.squirrel.setOn(false); }
    else if (this.woodpecker.on) { o = this.woodpecker.leaveInfo(); this.woodpecker.setOn(false); }
    else if (this.ground?.on) { o = this.ground.leaveInfo(); this.ground.setOn(false); }
    else if (this.flier?.on) { o = this.flier.leaveInfo(); this.flier.setOn(false); }
    else if (f.landed) o = { x: f.pos.x, y: G.feet, z: f.pos.z, yaw: G.yaw, where: G.perch ? 'top' : 'ground', speed: 0 };
    else o = { x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw, where: 'air', speed: f.speed };
    if (this.body) this.animals.release(this.body.id, o);
    this.ignoreId = this.body?.id ?? null; this.body = null;
    this.setOn(true);
    f.pos.set(o.x, o.y + (o.where === 'air' ? 0 : 0.4), o.z);
    f.yaw = o.yaw; f.pitch = 0.2; f.roll = 0; f.speed = 0; f.hover = true; f.lift = 8; f.keys.clear(); f.drag = null;
    f.camSettled = false; f.camK = 0; f.camYaw = f.yaw;
    this.prevP.copy(f.pos); this.wisp.reset(f.pos);
    this.fx = { kind: 'out', t: 0, dur: FLASH_OUT }; this.wisp.burst(f.pos);
    this.coolT = COOL_T;
    this.onBody?.(SPIRIT, null);
    return true;
  }

  // Every frame after the controls (main.js): the wisp, while a spirit and the body is drawn (not in first person), or
  // diving into a body. Its exit flash lasts as long as the camera's blend, so it is whole when the view settles.
  draw(dt) {
    const f = this.flight, fx = this.fx;
    let grow = 1, bright = 1, show = this.on && f.body.visible, P = f.pos;
    if (fx) {
      if (fx.kind === 'out' && this.blend.dur) fx.dur = Math.max(fx.dur, this.blend.dur);
      fx.t += dt;
      const u = Math.min(1, fx.t / fx.dur);
      if (fx.kind === 'in') {   // from where it touched into the body, flaring and imploding
        P = this._p.copy(fx.from).lerp(this._q.set(f.pos.x, f.pos.y + fx.lift, f.pos.z), smooth(Math.min(1, u * 1.8)));
        grow = (1 - u) ** 1.5 * (1 + 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.6))); bright = 1 + 3 * Math.sin(Math.PI * u); show = u < 1;
      } else { grow = smooth(u); bright = 1 + 2.5 * (1 - u) ** 2; }
      if (u >= 1) this.fx = null;
    }
    // the swell: the nearest body it could inhabit (not the one just left)
    let want = 0;
    if (this.on && show) {
      const o = this.animals.playableNear(f.pos.x, f.pos.y, f.pos.z, SWELL_FAR, SWELL_FAR, this.ignoreId);
      if (o) { const r = o.where === 'air' ? TOUCH_AIR : TOUCH_R; want = 1 - smooth(Math.min(1, Math.max(0, (Math.hypot(o.x - f.pos.x, o.y - f.pos.y, o.z - f.pos.z) - r) / (SWELL_FAR - r)))); }
    }
    if (fx?.kind === 'in') want = 1;
    this.swell += (want - this.swell) * (1 - Math.exp(-dt * SWELL_K));
    const sw = this.swell;
    this.wisp.update(dt, P, f.yaw, show, grow, bright, REST_SCALE + (1 - REST_SCALE) * sw, REST_LUM + (1 - REST_LUM) * sw, 1 + (SWELL_SWIRL - 1) * sw);
  }
  // main.js, right after the Atmosphere's frame update: the spirit's view, fading in while a spirit, out otherwise.
  look(dt) { this.view.update(dt, this.on); }
  // main.js, in place of renderer.render: the frame with the spirit's view's passes (SpiritLook.render)
  render(renderer, scene, camera) { this.view.render(renderer, scene, camera); }
  // main.js, around the render: the camera blend over a switch (CameraBlend), and the control's own pose back after.
  blendCamera(dt) { this.blend.apply(dt); }
  unblendCamera() { this.blend.restore(); }
}

// The spirit's view (see the header). update() runs after Atmosphere.update has set this frame's light and haze and
// before SkyDome.update copies them to the sun and hemisphere lights, so the lights follow too.
class SpiritLook {
  constructor(scene, renderer, atmosphere, animals, flight, camera, wisp) {
    Object.assign(this, { scene, renderer, atmosphere, animals, flight, camera, wisp });
    this.amt = 0; this.k = 0; this._c = new THREE.Color(); this._b = new THREE.Vector2();
    scene.traverse(o => { if (o.isLight) o.layers.enable(1); });   // the layer-1 redraw is lit as the first draw
    // the sky's veil: a shell past the land (the dome sits at the far plane, so only sky pixels are behind the shell), a
    // the colour the mist reaches far off (the haze's horizon radiance, tone mapped and post-passed as the land's is), from
    // the horizon up with a slight darkening to the zenith, so far trees dissolve into it; a blue-violet glow toward the sun
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.ShaderMaterial({
      // the haze's own uniforms (atmosphere.js), shared: the veil is the colour the mist reaches far off, this frame
      uniforms: { sunDir: atmo.sunDir, skyHorizon: atmo.skyHorizon, skySun: atmo.skySun, hazePhase: atmo.hazePhase,
        uVeil: { value: 0 }, uGlow: { value: new THREE.Color() }, uContrast: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform vec3 sunDir, skyHorizon, skySun; uniform vec4 hazePhase;
        uniform vec3 uGlow; uniform float uVeil, uContrast; varying vec3 vW;
        // atmosphere.js atmoMieLobe, atmoLobe, atmoSky: the horizon radiance a long path of air takes in direction v
        float lobeMie(vec3 v) { float d = 1.64 - 1.6 * dot(v, sunDir); return clamp((1.0 / (d * sqrt(d)) - hazePhase.y) * hazePhase.z, 0.0, 1.0); }
        float lobe(vec3 v) { return mix(clamp(0.5 + 0.5 * dot(v, sunDir) / hazePhase.w, 0.0, 1.0), lobeMie(v), hazePhase.x); }
        void main() {
          vec3 d = normalize(vW - cameraPosition), hv = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
          vec3 mist = mix(skyHorizon, skySun, lobe(hv)) * (1.0 - 0.07 * smoothstep(0.0, 1.0, d.y));   // the horizon's mist, up the sky
          gl_FragColor = vec4(mist, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          vec3 m = (gl_FragColor.rgb - 0.42) * (1.0 - uContrast) + 0.42;   // as the post pass leaves the land's mist
          vec2 h = normalize(d.xz + 1e-5), s = normalize(sunDir.xz + 1e-5);
          float band = exp(-abs(d.y - 0.03) * 7.0), toward = pow(max(0.0, dot(h, s)), 3.0);
          float g = band * (0.15 + 0.85 * toward);
          float a = uVeil * (1.0 - 0.35 * g * step(0.001, dot(uGlow, vec3(1.0))));
          gl_FragColor = vec4(m * a + uGlow * g, a);   // premultiplied: the mist over the sky, the dusk glow added softly
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    this.shell.frustumCulled = false; this.shell.visible = false; this.shell.renderOrder = -10; this.shell.name = 'spirit sky veil';
    this.shell.layers.set(1);
    scene.add(this.shell);
    // the post pass: the frame as a texture, and a full-screen quad that cools what is warm in it
    this.post = { tex: null, scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    this.postMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, uWarm: { value: 0 }, uContrast: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform float uWarm, uContrast; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tMap, vUv).rgb;
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), ch = mx - mn;
          float hue = 0.0;   // degrees
          if (ch > 1e-4) {
            if (mx == c.r) hue = 60.0 * mod((c.g - c.b) / ch, 6.0);
            else if (mx == c.g) hue = 60.0 * ((c.b - c.r) / ch + 2.0);
            else hue = 60.0 * ((c.r - c.g) / ch + 4.0);
          }
          float off = abs(mod(hue - 185.0 + 180.0, 360.0) - 180.0) / 180.0;   // 0 on the blue-green axis, 1 opposite it
          float sat = ch / max(mx, 1e-4);
          float pull = uWarm * smoothstep(0.22, 0.55, off) * smoothstep(0.02, 0.12, sat);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec3 o = mix(c, l * vec3(0.86, 1.02, 1.04), pull);
          o = (o - 0.42) * (1.0 - uContrast) + 0.42;
          gl_FragColor = vec4(o, 1.0);
        }`,
      depthTest: false, depthWrite: false, toneMapped: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat); quad.frustumCulled = false;
    this.post.scene.add(quad);
    // the glow on the playable animals: camera-facing warm quads, size with the eye's distance, strength with the spirit's
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2));
    this.gp = new Float32Array(GLOW_CAP * 3); g.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.gp, 3).setUsage(THREE.DynamicDrawUsage));
    this.gc = new Float32Array(GLOW_CAP * 4); g.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.gc, 4).setUsage(THREE.DynamicDrawUsage));   // rgb, brightness
    g.instanceCount = 0;
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uSpirit: { value: new THREE.Vector3() }, uAmt: { value: 0 },
        uTouch: { value: TOUCH_R }, uSwell: { value: SWELL_FAR }, uFar: { value: GLOW_FAR }, uBubble: { value: GLOW_BUBBLE }, uBubbleA: { value: GLOW_BUBBLE_A },
        uLum: { value: new THREE.Vector2(...GLOW_LUM) }, uReach: { value: new THREE.Vector2(...GLOW_REACH) }, uRareSize: { value: GLOW_RARE_SIZE },
        uBeacon: { value: new THREE.Vector2(BEACON_LUM, BEACON_SIZE) } },
      vertexShader: /* glsl */`
        attribute vec3 aPos; attribute vec4 aColor;   // rgb the soul's colour; a its rarity 0..1, or 2 for a beacon
        uniform vec3 uSpirit; uniform float uAmt, uTouch, uSwell, uFar, uBubble, uRareSize; uniform vec2 uLum, uReach, uBeacon;
        varying vec2 vUv; varying float vI; varying vec3 vColor;
        void main() {
          float ds = distance(aPos, uSpirit), dc = distance(aPos, cameraPosition);
          float near = 1.0 - smoothstep(uTouch, uSwell, ds);                    // the wisp's swell easing
          float beacon = step(1.5, aColor.a), rar = min(aColor.a, 1.0);
          float reach = mix(uReach.x, uReach.y, rar);
          float far = mix(1.0 - smoothstep(reach * 0.4, reach, ds), 1.0, beacon);   // a beacon never fades with distance
          float lum = mix(mix(uLum.x, uLum.y, rar), uBeacon.x, beacon);
          vI = uAmt * lum * (uFar * far + (1.0 - uFar) * near);
          vColor = aColor.rgb;
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          mv.xyz += normalize(-mv.xyz) * min(1.8, dc * 0.4);                    // toward the eye: ground and bark do not clip it
          float size = mix(mix(1.0, uRareSize, rar), uBeacon.y, beacon);        // the rare larger, a beacon larger still
          mv.xy += position.xy * uBubble * size * (mix(0.6, 4.0, smoothstep(6.0, 200.0, dc)) * (1.0 + 0.8 * near));   // the quad holds the bubble; the core is 1 / uBubble of it
          vUv = position.xy;
          gl_Position = vI > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uBubble, uBubbleA; varying vec2 vUv; varying float vI; varying vec3 vColor;
        void main() {
          float r = length(vUv), rc = r * uBubble;                                 // r over the bubble (0..1), rc over the core
          float core = pow(max(0.0, 1.0 - rc), 1.8) * 0.9 + 0.5 * exp(-rc * rc * 22.0);
          float bubble = uBubbleA * exp(-r * r * 3.0) * (1.0 - smoothstep(0.8, 1.0, r));   // the wide faint soul, fading out at the quad's edge
          float a = (core + bubble) * vI;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.glow = new THREE.Mesh(g, this.glowMat); this.glow.frustumCulled = false; this.glow.renderOrder = 9; this.glow.name = 'spirit glow';
    this.glow.layers.set(1);
    scene.add(this.glow);
    // the beacon beams (BEACON species)
    const bg = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2));
    this.bp = new Float32Array(BEAM_CAP * 3); bg.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.bp, 3).setUsage(THREE.DynamicDrawUsage));
    this.bc = new Float32Array(BEAM_CAP * 3); bg.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.bc, 3).setUsage(THREE.DynamicDrawUsage));
    bg.instanceCount = 0;
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uAmt: { value: 0 }, uSize: { value: new THREE.Vector2(BEAM_W, BEAM_H) } },
      vertexShader: /* glsl */`
        attribute vec3 aPos; attribute vec3 aColor; uniform vec2 uSize;
        varying vec2 vUv; varying vec3 vColor;
        void main() {
          vec3 toCam = cameraPosition - aPos; toCam.y = 0.0;
          vec3 fwd = normalize(toCam + vec3(1e-4, 0.0, 0.0)), right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
          vec3 p = aPos + right * (position.x * uSize.x) + vec3(0.0, (position.y + 1.0) * 0.5 * uSize.y, 0.0);
          vUv = position.xy; vColor = aColor;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uAmt; varying vec2 vUv; varying vec3 vColor;
        void main() {
          float x = abs(vUv.x), t = (vUv.y + 1.0) * 0.5;
          float a = (1.0 - smoothstep(0.0, 1.0, x)) * (1.0 - t * t) * uAmt * 1.8;   // soft sides, fading up
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.beam = new THREE.Mesh(bg, this.beamMat); this.beam.frustumCulled = false; this.beam.renderOrder = 10; this.beam.name = 'beacon beams';
    this.beam.layers.set(1);
    scene.add(this.beam);
  }
  // In place of renderer.render(scene, camera) (main.js): the frame, then while the look is on the post pass and the
  // layer-1 redraw; with the look off but the wisp shown (the arrival, a jump's dive), the layer-1 draw alone.
  render(renderer, scene, camera) {
    renderer.render(scene, camera);
    const k = this.k, wisp = this.wisp.group.visible;
    if (k <= 0.001 && !wisp) return;
    const ac = renderer.autoClear; renderer.autoClear = false;
    if (k > 0.001) {
      const P = this.post, b = renderer.getDrawingBufferSize(this._b);
      if (!P.tex || P.tex.image.width !== b.x || P.tex.image.height !== b.y) { P.tex?.dispose(); P.tex = new THREE.FramebufferTexture(b.x, b.y); this.postMat.uniforms.tMap.value = P.tex; }
      renderer.copyFramebufferToTexture(P.tex);
      this.postMat.uniforms.uWarm.value = POST_WARM * k; this.postMat.uniforms.uContrast.value = POST_CONTRAST * k;
      renderer.render(P.scene, P.cam);
    }
    const mask = camera.layers.mask; camera.layers.set(1);
    renderer.render(scene, camera);
    camera.layers.mask = mask; renderer.autoClear = ac;
  }
  update(dt, on) {
    this.amt = Math.min(1, Math.max(0, this.amt + (on ? dt : -dt) / LOOK_T));
    const k = this.k = smooth(this.amt), u = atmo, a = this.atmosphere, c = this._c;
    SELF_LIT.value = 0.88 * k;
    this.shell.visible = this.glow.visible = k > 0.001;
    if (k <= 0.001) return;
    const lum = col => 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b, ex = Math.max(0.05, a.exposure);
    const sy = u.sunDir.value.y, twilight = THREE.MathUtils.smoothstep(sy, -0.29, -0.1) * (1 - THREE.MathUtils.smoothstep(sy, 0.03, 0.2));
    const glowL = Math.min(LOOK_GLOW_MAX, Math.max(lum(u.skySun.value) * ex * LOOK_GLOW_K, LOOK_TWILIGHT * twilight));   // the dome's own sunset glow, before the look
    const floor = (col, f) => { const l = lum(col); if (l * ex < f) col.multiplyScalar(1 + (f / ex / Math.max(l, 1e-4) - 1) * k); };
    const toward = (col, tint, f) => { const l = lum(col) * f; col.lerp(c.copy(tint).multiplyScalar(l), k); };
    // the sun: faint and blue
    a.sunIntensity *= 1 + (LOOK_SUN - 1) * k;
    u.sunColor.value.lerp(c.copy(u.sunColor.value).multiply(LOOK_SUN_TINT), k);
    u.sunLight.value.lerp(c.copy(u.sunLight.value).multiply(LOOK_SUN_TINT).multiplyScalar(LOOK_SUN), k);
    // the sky light and the haze's colours: blue-green, at their own brightness
    toward(u.ambientSky.value, LOOK_AMB, 1.9); toward(u.ambientGround.value, LOOK_AMB, 1.0);
    toward(u.skyZenith.value, LOOK_HAZE, 1); toward(u.skyHorizon.value, LOOK_HAZE, 1); toward(u.skySun.value, LOOK_HAZE, 0.9);
    // the floor: a blue dusk, not a black one
    floor(u.ambientSky.value, LOOK_FLOOR); floor(u.ambientGround.value, LOOK_FLOOR * 0.5);
    for (const col of [u.skyZenith.value, u.skyHorizon.value, u.skySun.value]) floor(col, LOOK_HAZE_FLOOR);
    // thicker haze, lifting dark and bright alike
    u.hazeDensity.value *= 1 + (LOOK_MIE - 1) * k; u.hazeContrast.value *= 1 - 0.7 * k;
    // the sky
    this.shell.position.copy(this.camera.position);
    const su = this.shell.material.uniforms;
    su.uVeil.value = LOOK_VEIL * k; su.uContrast.value = POST_CONTRAST * k;
    su.uGlow.value.copy(LOOK_GLOW).multiplyScalar(glowL * k);
    // the glow
    let n = 0, b = 0; const gp = this.gp, gc = this.gc, bp = this.bp, bc = this.bc, rar = this.animals.rarity, cols = this.glowCols ||= [], sl = this.animals.speciesList();
    this.animals.eachPlayable((x, y, z, s) => {
      if (n >= GLOW_CAP) return;
      gp[n * 3] = x; gp[n * 3 + 1] = y; gp[n * 3 + 2] = z;
      const c = cols[s] ||= rarityColor(rar[s]), beacon = BEACON.has(sl[s].code.split(':')[0]);   // the species' soul colour (once per species); a its rarity, 2 for a beacon species
      gc[n * 4] = c.r; gc[n * 4 + 1] = c.g; gc[n * 4 + 2] = c.b; gc[n * 4 + 3] = beacon ? 2 : rar[s];
      if (beacon && b < BEAM_CAP) { bp[b * 3] = x; bp[b * 3 + 1] = y; bp[b * 3 + 2] = z; bc[b * 3] = c.r; bc[b * 3 + 1] = c.g; bc[b * 3 + 2] = c.b; b++; }
      n++;
    });
    this.glow.geometry.instanceCount = n; this.glow.geometry.attributes.aPos.needsUpdate = true; this.glow.geometry.attributes.aColor.needsUpdate = true;
    this.beam.geometry.instanceCount = b; this.beam.geometry.attributes.aPos.needsUpdate = true; this.beam.geometry.attributes.aColor.needsUpdate = true;
    this.beamMat.uniforms.uAmt.value = k; this.beam.visible = b > 0 && k > 0.001;
    this.glowMat.uniforms.uSpirit.value.copy(this.flight.pos); this.glowMat.uniforms.uAmt.value = k;
  }
}

// The camera across a switch of body (owner's request: a transition, not a cut). capture() keeps the pose the player
// is seeing; each frame after that, apply() takes the pose the new control computed (its own camera, untouched) and
// draws from a blend of the two instead: the position along the straight line between them but kept CLEAR m over the
// ground, the orientation slerped, fov and near plane eased, over BLEND_T s (smoothstep), up to BLEND_FAR s more when
// the two are far apart (a raven high in flight to a squirrel on the ground). restore() puts the control's pose back
// after the render, so its next frame starts from its own camera. Input goes to the controls throughout.
const BLEND_T = 0.8, BLEND_FAR = 0.6, CLEAR = 0.3;
class CameraBlend {
  constructor(camera, flight) {
    this.camera = camera; this.flight = flight; this.on = false; this.applied = false; this.t = 0; this.dur = 0;
    this.p0 = new THREE.Vector3(); this.q0 = new THREE.Quaternion(); this.fov0 = 70; this.near0 = 0.5;
    this.p1 = new THREE.Vector3(); this.q1 = new THREE.Quaternion(); this.fov1 = 70; this.near1 = 0.5;
    this.ps = new THREE.Vector3(); this.qs = new THREE.Quaternion(); this.fovs = 70; this.nears = 0.5;   // last drawn
  }
  capture() {
    const c = this.camera, mid = this.on && this.applied;   // mid-blend: from the pose being drawn
    this.p0.copy(mid ? this.ps : c.position); this.q0.copy(mid ? this.qs : c.quaternion);
    this.fov0 = mid ? this.fovs : c.fov; this.near0 = mid ? this.nears : c.near;
    this.on = true; this.t = 0; this.dur = 0;
  }
  apply(dt) {
    this.applied = false;
    if (!this.on) return;
    const c = this.camera, f = this.flight;
    this.p1.copy(c.position); this.q1.copy(c.quaternion); this.fov1 = c.fov; this.near1 = c.near;
    if (this.t < 0.15) this.dur = Math.max(this.dur, BLEND_T + Math.min(BLEND_FAR, this.p0.distanceTo(this.p1) / 60));   // the new pose settles in a frame or two
    this.t += dt;
    const u = smooth(Math.min(1, this.t / this.dur));
    if (u >= 1) { this.on = false; this.dur = 0; return; }
    c.position.lerpVectors(this.p0, this.p1, u);
    const g = Math.max(f.heights.atXZ(c.position.x, c.position.z), f.meshAt(c.position.x, c.position.z)) + CLEAR;
    if (c.position.y < g) c.position.y = g;
    c.quaternion.slerpQuaternions(this.q0, this.q1, u);
    c.fov = this.fov0 + (this.fov1 - this.fov0) * u; c.near = this.near0 + (this.near1 - this.near0) * u; c.updateProjectionMatrix();
    this.ps.copy(c.position); this.qs.copy(c.quaternion); this.fovs = c.fov; this.nears = c.near;
    this.applied = true;
  }
  restore() {
    if (!this.applied) return;
    const c = this.camera;
    c.position.copy(this.p1); c.quaternion.copy(this.q1); c.fov = this.fov1; c.near = this.near1; c.updateProjectionMatrix();
  }
}

// ---- the wisp ------------------------------------------------------------------------------------------------
const RIB_VERT = /* glsl */`
  attribute vec3 aCol;
  varying vec3 vCol; varying vec2 vUv;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vCol = aCol * smoothstep(0.5, 1.6, -mv.z);   // fade near the lens
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }`;
const RIB_FRAG = /* glsl */`
  varying vec3 vCol; varying vec2 vUv;
  void main() {
    float y = vUv.y * 2.0 - 1.0, across = pow(max(0.0, 1.0 - y * y), 1.6);
    float along = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.7, 1.0, vUv.x));
    gl_FragColor = vec4(vCol * across * along, 1.0);
  }`;
const MIST_VERT = /* glsl */`
  attribute float aSize; attribute float aRot; attribute vec3 aCol;
  uniform float uScale;
  varying vec3 vCol; varying float vRot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    vCol = aCol * smoothstep(0.6, 2.0, d); vRot = aRot;
    gl_PointSize = min(aSize * uScale / max(d, 0.05), 480.0);
    gl_Position = projectionMatrix * mv;
  }`;
const MIST_FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying vec3 vCol; varying float vRot;
  void main() {
    vec2 c = gl_PointCoord - 0.5, s = vec2(cos(vRot), sin(vRot));
    vec2 uv = vec2(c.x * s.x - c.y * s.y, c.x * s.y + c.y * s.x) + 0.5;
    gl_FragColor = vec4(vCol * texture2D(uMap, uv).r, 1.0);
  }`;

// A soft, uneven puff: a radial falloff times three octaves of value noise, white in the red channel.
function mistTexture(n = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n), G = 9, rnd = [];
  for (let i = 0; i < 4 * G * G; i++) rnd.push(Math.random());
  const noise = (x, y, f, o) => {
    const X = x * f, Y = y * f, i = Math.floor(X), j = Math.floor(Y), u = X - i, v = Y - j, h = (a, b) => rnd[(o + ((a % G) + G) % G + (((b % G) + G) % G) * G) % rnd.length];
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, r = Math.hypot(dx, dy);
    const nz = 0.5 * noise(x / n, y / n, 3, 0) + 0.3 * noise(x / n, y / n, 6, G * G) + 0.2 * noise(x / n, y / n, 9, 2 * G * G);
    const fall = Math.max(0, 1 - r) ** 1.8, a = Math.min(1, fall * (0.35 + 1.1 * nz) * 1.15);
    const k = (y * n + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * a); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; return t;
}

// The wisp on its own (exported: the opening screen's spinner uses it too). No flight, atmosphere or game: it needs the
// renderer (for the drawing buffer's size) and the camera it is seen through (its position and lens), both only in
// update. API:
//   new Wisp({ renderer, camera, scene = null, layer = 0 })   builds it; `group` is its Object3D (added to scene if given)
//   setSwell(s)                    0 the resting form (REST_SCALE, REST_LUM), 1 full size, brightness and swirl
//   animate(dt, position?, yaw?)   a frame for a standalone wisp: shown, at `position` (a Vector3, default the origin),
//                                  its ribbons trailing up and back from `yaw` (rad, the flight's frame) when still;
//                                  moving `position` between frames streams them behind it
//   update(dt, P, yaw, show, grow, bright, scale, lum, swirl)   the full form the spirit drives (flashes, swell)
//   dispose()                      off its parent, geometries, materials and textures freed
// Its parts are world-space and drawn on `layer` (the spirit uses 1); give its camera that layer.
export class Wisp {
  constructor({ renderer, camera, scene = null, layer = 0 } = {}) {
    this.renderer = renderer; this.camera = camera; this.t = 0; this.ph = 0; this.swellK = 0; this._origin = new THREE.Vector3();
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
    // ribbons and motes: one mesh of strips and quads
    const RV = RIBBONS * (SEG + 1) * 2, V = RV + MOTES * 4;
    this.rp = new Float32Array(V * 3); this.rc = new Float32Array(V * 3); const uv = new Float32Array(V * 2), idx = [];
    for (let r = 0; r < RIBBONS; r++) for (let j = 0; j <= SEG; j++) {
      const v = (r * (SEG + 1) + j) * 2; uv.set([j / SEG, 0, j / SEG, 1], v * 2);
      if (j < SEG) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    for (let m = 0; m < MOTES; m++) { const v = RV + m * 4; uv.set([0, 0, 0, 1, 1, 0, 1, 1], v * 2); idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    const rg = new THREE.BufferGeometry(), dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('position', dyn(this.rp, 3)); rg.setAttribute('aCol', dyn(this.rc, 3)); rg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); rg.setIndex(idx);
    this.ribbons = new THREE.Mesh(rg, new THREE.ShaderMaterial({ vertexShader: RIB_VERT, fragmentShader: RIB_FRAG, side: THREE.DoubleSide, ...add }));
    this.ribbons.frustumCulled = false; this.ribbons.renderOrder = 8; this.ribbons.name = 'spirit ribbons';
    // mist
    this.mp = new Float32Array(MIST * 3); this.mc = new Float32Array(MIST * 3); this.ms = new Float32Array(MIST); this.mr = new Float32Array(MIST);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', dyn(this.mp, 3)); mg.setAttribute('aCol', dyn(this.mc, 3)); mg.setAttribute('aSize', dyn(this.ms, 1)); mg.setAttribute('aRot', dyn(this.mr, 1));
    this.mistMat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 500 }, uMap: { value: mistTexture() } }, vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, ...add });
    this.mist = new THREE.Points(mg, this.mistMat); this.mist.frustumCulled = false; this.mist.renderOrder = 7; this.mist.name = 'spirit mist';
    // the core: a small warm sprite, its gradient a canvas
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.2, 'rgba(255,255,255,0.6)'); grad.addColorStop(0.55, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: WARM.clone(), fog: false, ...add }));
    this.core.renderOrder = 9; this.core.name = 'spirit core';
    this.group = new THREE.Group(); this.group.add(this.mist, this.ribbons, this.core); this.group.visible = false; this.group.name = 'wisp';
    for (const o of [this.mist, this.ribbons, this.core]) o.layers.set(layer);
    if (scene) scene.add(this.group);
    const rnd = Math.random;
    this.puffs = Array.from({ length: MIST }, (_, i) => ({ a: rnd() * 6.28, w: (0.25 + rnd() * 0.4) * (i % 2 ? 1 : -1), r: 0.08 + rnd() * 0.28, y: (rnd() - 0.5) * 0.25,
      s: 0.7 + (i / (MIST - 1)) * 1.0, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.8, ph: rnd() * 6.28, lag: rnd() }));
    this.motes = Array.from({ length: MOTES }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 0 }));
    this.next = 0; this.emit = 0;
    // the path: recent positions, newest first (hist[0] is the last pushed)
    this.hist = Array.from({ length: HIST_N }, () => new THREE.Vector3()); this.ht = new Float64Array(HIST_N); this.hn = 0; this.hi = 0; this._pa = new THREE.Vector3();
    this.spine = Array.from({ length: SEG + 1 }, () => new THREE.Vector3()); this.tan = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());
    this.vel = new THREE.Vector3(); this.last = new THREE.Vector3(); this._v = new THREE.Vector3(); this._b = new THREE.Vector2();
    this._n1 = new THREE.Vector3(); this._t = new THREE.Vector3(); this._n2 = new THREE.Vector3(); this._s = new THREE.Vector3(); this._q = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.shown = false;
  }
  setSwell(s) { this.swellK = Math.min(1, Math.max(0, +s || 0)); }
  animate(dt, position = this._origin, yaw = 0) {
    const s = this.swellK;
    this.update(dt, position, yaw, true, 1, 1, REST_SCALE + (1 - REST_SCALE) * s, REST_LUM + (1 - REST_LUM) * s, 1 + (SWELL_SWIRL - 1) * s);
  }
  dispose() {
    this.group.removeFromParent();
    for (const o of [this.mist, this.ribbons, this.core]) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); }
    this.mistMat.uniforms.uMap.value?.dispose();
  }
  reset(P) { this.last.copy(P); this.vel.set(0, 0, 0); this.hn = 0; for (const m of this.motes) m.age = m.life = 1; }
  // Motes outward and up from P (rising out of a body).
  burst(P) {
    for (const p of this.motes) {
      const a = Math.random() * Math.PI * 2, b = Math.random(), v = 1.2 + Math.random() * 1.8;
      p.x = P.x; p.y = P.y; p.z = P.z; p.vx = Math.cos(a) * v * (1 - b * 0.5); p.vy = 0.6 + b * v; p.vz = Math.sin(a) * v * (1 - b * 0.5);
      p.age = 0; p.life = 0.7 + Math.random() * 0.7;
    }
  }
  // the newest-first path position k (k < hn)
  h(k) { return this.hist[(this.hi - 1 - k + this.hist.length * 2) % this.hist.length]; }
  push(v, t) { this.hist[this.hi].copy(v); this.ht[this.hi] = t; this.hi = (this.hi + 1) % this.hist.length; this.hn = Math.min(this.hn + 1, this.hist.length); }
  // grow: the form's scale (0..1, the flashes), bright: its brightness (1 and up)
  // scale, lum: the size and brightness (REST_* at rest, 1 swollen near an animal); swirl: how fast it turns (1 at rest)
  update(dt, P, yaw, show, grow, bright, scale = 1, lum = 1, swirl = 1) {
    if (show !== this.shown) { this.shown = show; this.group.visible = show; if (show) this.reset(P); }
    if (!show) return;
    this.t += dt; this.ph += dt * swirl; const t = this.t, sw = this.ph, ks = scale, cam = this.camera.position;
    if (dt > 0) { this._v.subVectors(P, this.last).divideScalar(dt); if (this._v.lengthSq() > 200 * 200) { this._v.set(0, 0, 0); this.hn = 0; } this.vel.lerp(this._v, 1 - Math.exp(-dt * 8)); }
    const spd = this.vel.length(), vx = spd > 0.05 ? this.vel.x / spd : 0, vy = spd > 0.05 ? this.vel.y / spd : 0, vz = spd > 0.05 ? this.vel.z / spd : 0;
    // the path, resampled every TRAIL_RS m along the move (a fast frame leaves points along its chord, not one at its end)
    if (!this.hn) this.push(P, t);
    else {
      const a = this._pa.copy(this.h(0)); let d = a.distanceTo(P);
      if (d > TRAIL_RS * HIST_N) { this.hn = 0; this.push(P, t); }
      else for (; d >= TRAIL_RS; d -= TRAIL_RS) { a.lerp(P, TRAIL_RS / d); this.push(a, t); }
    }
    // the lengths: the curl's (RIB_LEN) hovering, TRAIL_T s of travel in flight; L is the shortest ribbon's
    const fly = smooth(Math.min(1, Math.max(0, (spd - TRAIL_SLOW) / (TRAIL_FAST - TRAIL_SLOW))));
    const Ltrail = Math.min(spd * TRAIL_T, TRAIL_MAX) * (0.55 + 0.45 * ks) / Math.max(...RIB_LENS);
    const L = (RIB_LEN * ks * (1 - fly) + Ltrail * fly) * (0.3 + 0.7 * grow), Lmax = L * Math.max(...RIB_LENS), step = Lmax / SEG;   // the spine runs the longest one's length
    const wave = 2.2 / ks * (1 - fly) + TRAIL_WAVE * fly;   // the weave's turn along the ribbon, rad/m
    // the spine: back along the path from P every Lmax / SEG m; past its end (hovering) on up and back, curling slowly
    const dx0 = Math.sin(yaw) * 0.55, dz0 = Math.cos(yaw) * 0.55, cw = 0.5 * Math.sin(t * 0.37);
    const drift = this._d.set(dx0 * Math.cos(cw) - dz0 * Math.sin(cw), 0.85, dx0 * Math.sin(cw) + dz0 * Math.cos(cw)).normalize();
    const S = this.spine; S[0].copy(P);
    let k = 0, a = P, rem = 0;   // walking the path: segment from a to h(k)
    for (let j = 1; j <= SEG; j++) {
      let need = step; const q = S[j].copy(S[j - 1]);
      while (need > 1e-6) {
        if (k < this.hn && t - this.ht[(this.hi - 1 - k + this.hist.length * 2) % this.hist.length] < HIST_T) {
          const b = this.h(k), seg = a.distanceTo(b) - rem;
          if (seg <= need) { need -= seg; q.copy(b); a = b; rem = 0; k++; }
          else { rem += need; q.copy(a).lerp(b, rem / a.distanceTo(b)); need = 0; }
        } else { q.addScaledVector(drift, need); need = 0; }
      }
    }
    for (let j = 0; j <= SEG; j++) this.tan[j].subVectors(S[Math.min(SEG, j + 1)], S[Math.max(0, j - 1)]).normalize();
    // the ribbons: woven round the spine, camera-facing, tapering and fading
    const rp = this.rp, rc = this.rc, n1 = this._n1, n2 = this._n2, side = this._s, c = this._q;
    for (let r = 0; r < RIBBONS; r++) {
      const om = 2 * Math.PI / (RIB_PERIOD * RIB_PERIODS[r]), ph = RIB_PHASES[r], Lr = L * RIB_LENS[r], breathe = 1 + 0.18 * Math.sin(1.3 * t / Math.abs(RIB_PERIODS[r]) + r * 1.7);   // a negative period weaves the other way
      for (let j = 0; j <= SEG; j++) {
        const u = j / SEG, x = u * Lr / step, i0 = Math.min(SEG - 1, Math.floor(x)), fr = x - i0;   // this ribbon's point along the spine
        const T = this._t.copy(this.tan[i0]).lerp(this.tan[i0 + 1], fr).normalize();
        n1.set(-T.z, 0, T.x); if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0); n1.normalize(); n2.crossVectors(T, n1);
        const rad = (0.1 + 0.42 * u) * RIB_RADII[r] * ks * grow * breathe, phi = om * sw + ph - wave * u * Lr;
        c.copy(S[i0]).lerp(S[i0 + 1], fr).addScaledVector(n1, rad * Math.cos(phi)).addScaledVector(n2, rad * Math.sin(phi));
        side.subVectors(c, cam).cross(T); if (side.lengthSq() < 1e-8) side.copy(n1); side.normalize();
        const hw = (0.12 - 0.07 * u) * ks * (0.4 + 0.6 * grow), v = (r * (SEG + 1) + j) * 2;
        rp[v * 3] = c.x - side.x * hw; rp[v * 3 + 1] = c.y - side.y * hw; rp[v * 3 + 2] = c.z - side.z * hw;
        rp[v * 3 + 3] = c.x + side.x * hw; rp[v * 3 + 4] = c.y + side.y * hw; rp[v * 3 + 5] = c.z + side.z * hw;
        const w = smooth(Math.min(1, u * 2.2)), f = 0.75 * lum * RIB_ALPHA[r] * (1 - u) ** 1.1 * Math.min(bright, 2.5) * (0.85 + 0.15 * Math.sin(3 * t - 6 * u + r));
        const cr = (WARM.r * (1 - w) + COOL.r * w) * f, cg = (WARM.g * (1 - w) + COOL.g * w) * f, cb = (WARM.b * (1 - w) + COOL.b * w) * f;
        rc.set([cr, cg, cb, cr, cg, cb], v * 3);
      }
    }
    // the motes: a few dim specks shed in the mist, streaked along the velocity
    const life = Math.min(1.8, Math.max(0.2, 3 / Math.max(spd, 0.1)));
    this.emit += MOTES * dt / life * 0.8;
    for (; this.emit >= 1; this.emit--) {
      const p = this.motes[this.next]; this.next = (this.next + 1) % MOTES;
      const u = Math.random(), j = 0.3 * ks * grow;
      p.x = this.last.x + (P.x - this.last.x) * u + (Math.random() - 0.5) * j; p.y = this.last.y + (P.y - this.last.y) * u + (Math.random() - 0.5) * j; p.z = this.last.z + (P.z - this.last.z) * u + (Math.random() - 0.5) * j;
      const a = Math.random() * 6.28; p.vx = Math.cos(a) * 0.3; p.vy = 0.3; p.vz = Math.sin(a) * 0.3;
      p.age = (1 - u) * dt; p.life = life * (0.6 + 0.8 * Math.random());
    }
    const RV = RIBBONS * (SEG + 1) * 2, ex = this._v;
    for (let m = 0; m < MOTES; m++) {
      const p = this.motes[m], v = RV + m * 4;
      if (p.age >= p.life) { rc.fill(0, v * 3, v * 3 + 12); continue; }
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const u = Math.min(1, p.age / p.life), len = (0.05 + Math.min(spd, 60) * 0.012) * ks;
      if (spd > 0.5) ex.set(vx, vy, vz); else ex.set(p.vx, p.vy, p.vz).normalize();
      c.set(p.x, p.y, p.z); side.subVectors(c, cam).cross(ex); if (side.lengthSq() < 1e-8) side.set(1, 0, 0); side.normalize();
      const hw = 0.022 * Math.max(ks, 0.7), x0 = p.x - ex.x * len, y0 = p.y - ex.y * len, z0 = p.z - ex.z * len;
      rp.set([x0 - side.x * hw, y0 - side.y * hw, z0 - side.z * hw, x0 + side.x * hw, y0 + side.y * hw, z0 + side.z * hw,
        p.x - side.x * hw, p.y - side.y * hw, p.z - side.z * hw, p.x + side.x * hw, p.y + side.y * hw, p.z + side.z * hw], v * 3);
      const f = 0.35 * lum * Math.sin(Math.PI * u) * Math.min(bright, 2), cr = WHITE.r * f, cg = WHITE.g * f, cb = WHITE.b * f;
      rc.set([cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb], v * 3);
    }
    const ra = this.ribbons.geometry.attributes; ra.position.needsUpdate = true; ra.aCol.needsUpdate = true;
    // the mist: soft puffs drifting round the core, trailing a little at speed, turning and breathing
    this.renderer.getDrawingBufferSize(this._b);
    this.mistMat.uniforms.uScale.value = this._b.y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const sweep = Math.min(spd, 60) * 0.012 * ks;
    for (let i = 0; i < MIST; i++) {
      const m = this.puffs[i], an = m.a + m.w * sw, br = 1 + 0.15 * Math.sin(0.9 * t + m.ph), back = m.lag * sweep;
      this.mp[i * 3] = P.x + Math.cos(an) * m.r * ks * grow - vx * back; this.mp[i * 3 + 1] = P.y + (m.y + 0.06 * Math.sin(0.7 * t + m.ph)) * ks * grow - vy * back;
      this.mp[i * 3 + 2] = P.z + Math.sin(an) * m.r * ks * grow - vz * back;
      this.ms[i] = m.s * ks * br * (0.3 + 0.7 * grow); this.mr[i] = m.rot + m.spin * sw;
      const w = i / (MIST - 1), f = (0.22 - 0.06 * w) * lum * Math.min(bright, 3) * br;
      this.mc[i * 3] = (WARM.r * (1 - w) + COOL.r * w) * f; this.mc[i * 3 + 1] = (WARM.g * (1 - w) + COOL.g * w) * f; this.mc[i * 3 + 2] = (WARM.b * (1 - w) + COOL.b * w) * f;
    }
    const ma = this.mist.geometry.attributes; ma.position.needsUpdate = ma.aCol.needsUpdate = ma.aSize.needsUpdate = ma.aRot.needsUpdate = true;
    // the core
    const pulse = 1 + 0.08 * Math.sin(t * 7) + 0.04 * Math.sin(t * 19);
    this.core.position.copy(P);
    this.core.scale.setScalar(0.34 * ks * pulse * (0.3 + 0.7 * grow) * (1 + 0.5 * (bright - 1)));
    this.core.material.color.copy(WARM).multiplyScalar(Math.min(3, 0.9 * lum * bright));
    this.last.copy(P);
  }
}
