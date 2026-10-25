// Soundscape: the place heard from a raven's height, all synthesised with the Web Audio API (no samples).
//
// Layers, each on its own bus into one sum -> gentle compressor -> master volume -> speakers:
//   wind     looping brown noise (rumble) and white noise (hiss) through filters that follow airspeed and
//            height above ground, a slow gust LFO plus a random walk, stereo width and balance from the bank;
//            over conifer and mixed forest a "wind in pines" sough (band-passed noise) and more hiss.
//   wings    a band-passed noise whoosh on each downstroke of the raven's fly clip; a hard flap (space)
//            gives three quick beats. Gliding is silent.
//   voice    a procedural raven "kraa" (sawtooth with FM rasp, noise, two formants, pitch falling): C calls,
//            and the ambient ravens of animals.js within 300 m answer from where they are (one, sometimes
//            its mate too); with none near, now and then a distant one answers from a random spot. A
//            raven calls every 20-60 s, a real one within 450 m when there is one.
//   birds    short synthesised calls with HRTF panners, the species drawn from the habitat class at a
//            random spot 50-300 m around the raven, the rate from sun height (dawn and dusk chorus, quiet
//            at noon and night) and season (spring loudest). When animals.js has a bird of that species
//            within 300 m the call comes from it (a random one of those in range) and the panner follows
//            it while it calls; otherwise from the random spot (the fallback). The coyote's yips and howl
//            ride the same layer at dawn, dusk and night over open ground, on a real coyote when one is in
//            range. Two calls are events of animals.js instead of chance:
//            a quail covey's flush (a whirring burst of wingbeats, one per bird, staggered as they go up,
//            and a few alarm "pit"s) and a red-tailed hawk's stoop (its scream, on the hawk).
//   near     calls tied to the animals of animals.js close to the player and to what they are doing (_nearTick,
//            4x a second): acorn woodpeckers' "waka" rally when one lands (mostly at its granary) and now and
//            then around it, and the knocks of their hammering in step with the AI's pecking (W_CLING with
//            flickV); a gray squirrel's barking alarm when the player comes within 15 m (from its perch once it
//            has run up, its tail flicking on each chuff) and a soft chatter now and then; jays scolding the
//            player within 20 m (Steller's "shaaar", the scrub-jay's "shreep"); a quail covey's "pit-pit" clucks
//            while it forages or runs near the player and its "chi-ca-go" assembly after a flush; a deer's
//            snort-wheeze when the player comes within 30 m of an active herd; a gray fox's bark at night,
//            rare; a brush rabbit's or a jackrabbit's foot thump, rare, when it freezes or bolts. Each kind has its own cooldowns
//            (per animal or group, and overall) so near animals give a few calls a minute, and none are near,
//            none. These voices take a tighter distance model (refDistance 4-25 m) and at most NEAR_MAX slots.
//            Played by the player: C barks as a squirrel, gives the waka as a woodpecker; a neighbour may answer.
//   water    a stream wash plus gurgle, on a panner kept at the nearest point of the nearest flowline, so it
//            fades in within ~80 m and comes from the right side; quieter in summer and fall.
//   insects  a pre-rendered loop of field-cricket chirps at dusk in summer and fall over grassland.
//
// Audio can only start after a user gesture, so the graph is built on the first pointerdown or keydown.
// N mutes (the context is suspended while muted or while the tab is hidden), C calls (the player's species' call); the volume and mute
// state persist in localStorage. Short-lived voices are disconnected by the frame loop once they end, and
// created/disconnected node counts are kept so a leak shows up in stats().

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
const STORE = 'wildearth.sound';
const MAX_VOICES = 14;
const REAL_R = 300;        // a call goes on a real bird of its species within this range of the raven
const EVENT_R = 600;       // flushes and stoops farther than this from the listener are not heard
const LOG_N = 24;          // recent calls kept for debugging (lastCalls())
const NEAR_MAX = 6;        // voice slots the near layer may hold at once (of MAX_VOICES)

const SEASON_BIRDS = { winter: 0.4, spring: 1.0, summer: 0.6, fall: 0.5 };
const SEASON_STREAM = { winter: 1.0, spring: 1.0, summer: 0.35, fall: 0.3 };   // intermittent streams dry out
const SEASON_CRICKETS = { winter: 0, spring: 0.15, summer: 1.0, fall: 0.8 };

// Habitat classes (tilepackage.js): 1 oak woodland, 2 conifer, 3 mixed, 4 chaparral, 5 grassland, 6 riparian,
// 7 water, 8 barren. `hab` weights a species by the class under the call; `tod(chorus, day, noon)` by the
// time of day; `rate` is the chance per placement attempt at full activity; `gain` levels the voices (narrow band-passes lose energy); `height` is metres above ground.
const CALLERS = [
  { key: 'quail', code: 'callipepla_californica', label: 'quail', hab: { 5: 1, 4: 1, 1: 0.3, 6: 0.3 }, rate: 0.22, gain: 0.45,
    tod: (c, d) => c + d * 0.08, height: [0.3, 1.5], synth: 'quail' },
  { key: 'woodpecker', code: 'melanerpes_formicivorus', label: 'acorn woodpecker', hab: { 1: 1, 3: 0.5, 6: 0.35 }, rate: 0.22, gain: 0.8,
    tod: (c, d) => c * 0.8 + d * 0.45, height: [6, 14], synth: 'woodpecker' },
  { key: 'scrubjay', code: 'aphelocoma_californica', label: 'scrub-jay', hab: { 1: 0.7, 4: 0.9, 6: 0.4, 3: 0.2 }, rate: 0.16, gain: 1.0,
    tod: (c, d) => c * 0.9 + d * 0.35, height: [2, 8], synth: 'scrubjay' },
  { key: 'hawk', code: 'buteo_jamaicensis', label: 'red-tailed hawk', hab: { 5: 1, 4: 0.7, 1: 0.5, 8: 0.6 }, rate: 0.025, gain: 0.55,
    tod: (c, d, noon) => d * (0.25 + 0.75 * noon), height: [40, 140], synth: 'hawk' },
  // `extra` lets it play in any tile that has conifer or mixed forest, listed in its species.json or not
  // (animals.js draws Steller's jays in the pines; a call goes on one of them when one is within range).
  { key: 'steller', code: 'cyanocitta_stelleri', label: "Steller's jay", hab: { 2: 1, 3: 0.7, 6: 0.2 }, rate: 0.2, gain: 0.75,
    tod: (c, d) => c * 0.9 + d * 0.35, height: [5, 20], synth: 'steller', extra: true },
  // Coyote: a few yips running into a wavering howl, at dawn and dusk (and on into the night) over grass and savanna.
  { key: 'coyote', code: 'canis_latrans', label: 'coyote', hab: { 5: 1, 9: 0.7, 1: 0.45, 4: 0.5, 6: 0.3 }, rate: 0.035, gain: 0.5,
    tod: c => c, height: [0.4, 0.6], synth: 'coyote' },
];

// The near layer's calls (keys for _play): label for the HUD and log, gain, the panner's refDistance (m; a
// tighter one for soft, close sounds) and range (m from the listener beyond which it is not played).
const NEAR = {
  waka:     { label: 'acorn woodpecker', gain: 0.8, ref: 25, range: 200, synth: 'woodpecker' },
  knock:    { label: 'woodpecker hammering', gain: 0.9, ref: 5, range: 55, synth: 'knocks' },
  bark:     { label: 'gray squirrel', gain: 0.85, ref: 12, range: 140, synth: 'squirrelBark' },
  chatter:  { label: 'gray squirrel', gain: 0.55, ref: 4, range: 35, synth: 'chatter' },
  cluck:    { label: 'quail', gain: 0.45, ref: 4, range: 55, synth: 'clucks' },
  assembly: { label: 'quail', gain: 0.45, ref: 25, range: 250, synth: 'quail' },
  shaaar:   { label: "Steller's jay", gain: 0.75, ref: 20, range: 200, synth: 'shaaar' },
  shreep:   { label: 'scrub-jay', gain: 1.0, ref: 20, range: 200, synth: 'scrubjay' },
  snort:    { label: 'deer', gain: 1.6, ref: 12, range: 160, synth: 'snort' },
  foxbark:  { label: 'gray fox', gain: 0.7, ref: 20, range: 320, synth: 'foxBark' },
  thump:    { label: 'brush rabbit', gain: 1.0, ref: 4, range: 35, synth: 'thump' },
  jthump:   { label: 'jackrabbit', gain: 1.3, ref: 5, range: 45, synth: 'thump' },
};
// animals.js state values the near layer reads (not exported there; keep in step with its constants)
const S_PAUSE = 0, S_OUT = 3, S_SIT = 4, S_WORK = 7, S_EAT = 8;            // squirrel
const W_CLING = 10, W_TOP = 11, W_FLY = 12, T_STORE = 2;                   // woodpecker; the acorn game's store task
const D_BED = 32, J_FLY = 52, M_BED = 80, M_FLEE = 85, B_FREEZE = 104, B_BOLT = 105, JK_FREEZE = 124, JK_BOLT = 125;
const G_FORAGE = 0, G_RUN = 1;                                             // quail covey
const PECK_W = 38;   // a clinging woodpecker's peck: flick = max(0, sin(time * 38)), one strike per 2pi/38 s

function loadPrefs() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* private window */ } }

// Stream flowlines (tile-local metres [x east, north]) as segments in a 100 m grid for nearest-point queries.
function streamIndex(streams) {
  const CELL = 100, segs = [], cells = new Map();
  for (const s of streams || []) {
    const p = s.path; if (!p || p.length < 2) continue;
    for (let i = 0; i + 1 < p.length; i++) {
      const k = segs.length / 4; segs.push(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
      const x0 = Math.floor(Math.min(p[i][0], p[i + 1][0]) / CELL), x1 = Math.floor(Math.max(p[i][0], p[i + 1][0]) / CELL);
      const y0 = Math.floor(Math.min(p[i][1], p[i + 1][1]) / CELL), y1 = Math.floor(Math.max(p[i][1], p[i + 1][1]) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const key = cx * 4096 + cy; let a = cells.get(key); if (!a) cells.set(key, a = []); a.push(k);
      }
    }
  }
  const S = new Float32Array(segs);
  // nearest point within ~100-200 m of (x, n), or null
  return (x, n) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(n / CELL);
    let best = Infinity, bx = 0, bn = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = cells.get((cx + i) * 4096 + cy + j); if (!a) continue;
      for (const k of a) {
        const ax = S[k * 4], an = S[k * 4 + 1], dx = S[k * 4 + 2] - ax, dn = S[k * 4 + 3] - an;
        const t = clamp(((x - ax) * dx + (n - an) * dn) / (dx * dx + dn * dn || 1));
        const px = ax + dx * t, pn = an + dn * t, d = (x - px) ** 2 + (n - pn) ** 2;
        if (d < best) { best = d; bx = px; bn = pn; }
      }
    }
    return best < Infinity ? { x: bx, n: bn, d: Math.sqrt(best) } : null;
  };
}

// Linear ramps through [dt, value] points from time t (the first point is set, not ramped to).
function env(p, t, pts) {
  p.setValueAtTime(pts[0][1], t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
}

export class Soundscape {
  // els: { button, volume, hud } (all optional). camera supplies the listener; flight and raven the motion.
  // animals (optional): animals.js; when not passed it is looked up as window.__we.animals at call time.
  constructor({ tile, flight, raven, camera, els = {}, animals = null }) {
    Object.assign(this, { tile, flight, raven, camera, els, animals });
    const prefs = loadPrefs();
    this.volume = clamp(prefs.volume ?? 0.5); this.muted = !!prefs.muted;
    this.ctx = null; this.voices = []; this.created = 0; this.disconnected = 0;
    this.heard = {}; this.t = 0; this.paramT = 0; this.habT = 1; this.waterT = 1; this.gurgleT = 0;
    this.gustWalk = 0; this.gust = 0.6; this.pine = 0; this.grassFrac = 0; this.habFrac = new Float32Array(10);
    this.waterLevel = 0; this.cricketLevel = 0; this.windLevel = 0; this.water = null;
    this.nextRaven = rand(20, 60); this.replies = [];
    this.log = []; this.sources = { animal: 0, habitat: 0, event: 0, answer: 0, near: 0, player: 0 }; this._near = []; this._hooked = null; this._unhook = null;
    // near layer: per-animal and per-group memory (WeakMaps, so dropped animals are let go), pending calls and tail
    // flicks, overall cooldowns; trace: set to [] to record every call (debugging, unbounded while set)
    this.nearT = 0; this.mem = new WeakMap(); this.pending = []; this.flicks = []; this.gap = {}; this.trace = null;
    this.clipPrev = null; this.flapPrev = 0; this.hardUntil = 0; this.phase = 0;
    const codes = new Set((tile.species || []).map(s => s.code));
    this.callers = CALLERS.filter(c => !codes.size || codes.has(c.code) || c.extra);
    this.nearestStream = streamIndex(tile.features?.streams);

    const arm = () => { removeEventListener('pointerdown', arm, true); removeEventListener('keydown', arm, true); this.start(); };
    addEventListener('pointerdown', arm, true); addEventListener('keydown', arm, true);
    addEventListener('keydown', e => {
      if (e.repeat || typing(e)) return;
      if (e.code === 'KeyN') this.setMuted(!this.muted);
      if (e.code === 'KeyC') this.call();   // the player's species' call: raven kraa, squirrel bark, woodpecker waka
    });
    document.addEventListener('visibilitychange', () => this._runState());
    if (els.button) els.button.addEventListener('click', () => {
      // The click that started the audio means "sound on", not "toggle".
      if (performance.now() - this.startedAt < 500 && !this.muted) return;
      this.setMuted(!this.muted);
    });
    if (els.volume) {
      els.volume.value = this.volume;
      els.volume.addEventListener('input', () => this.setVolume(+els.volume.value));
    }
    this._ui();
  }

  setMuted(m) { this.muted = m; savePrefs({ volume: this.volume, muted: m }); this._runState(); this._ui(); }
  setVolume(v) { this.volume = clamp(v); savePrefs({ volume: this.volume, muted: this.muted }); this._runState(); }

  _ui() {
    const b = this.els.button; if (!b) return;
    const on = this.ctx && !this.muted;
    b.textContent = !this.ctx ? (this.muted ? 'Sound off' : 'Sound') : on ? 'Sound on' : 'Sound off';
    b.classList.toggle('on', !!on);
    b.title = !this.ctx ? 'sound starts on your first click or key (N mutes)' : 'sound on or off (N)';
  }

  _runState() {
    const ctx = this.ctx; if (!ctx) return;
    const want = !this.muted && !document.hidden;
    this.master.gain.setTargetAtTime(want ? this.volume : 0, ctx.currentTime, 0.06);
    clearTimeout(this._suspendT);
    if (want) ctx.resume();
    else this._suspendT = setTimeout(() => { if (this.muted || document.hidden) ctx.suspend(); }, 400);
  }

  _mk(n) { this.created++; return n; }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.startedAt = performance.now();
    const mk = n => this._mk(n);
    this.sum = mk(new GainNode(ctx));
    this.comp = mk(new DynamicsCompressorNode(ctx, { threshold: -20, knee: 12, ratio: 3, attack: 0.008, release: 0.3 }));
    this.master = mk(new GainNode(ctx, { gain: 0 }));
    this.analyser = mk(new AnalyserNode(ctx, { fftSize: 2048 }));
    this.sum.connect(this.comp).connect(this.master).connect(this.analyser).connect(ctx.destination);
    this.taps = {};
    const bus = (name, g = 1) => {
      const b = mk(new GainNode(ctx, { gain: g })); b.connect(this.sum);
      const a = this.taps[name] = mk(new AnalyserNode(ctx, { fftSize: 1024 })); b.connect(a);
      return b;
    };
    this.windBus = bus('wind'); this.wingBus = bus('wings'); this.voiceBus = bus('voice');
    this.birdBus = bus('birds'); this.waterBus = bus('water', 0); this.insectBus = bus('insects');

    // Noise: 6 s stereo loops, ends cross-faded into the start so the loop point does not click, RMS 0.3.
    const sr = ctx.sampleRate, N = Math.floor(sr * 6), F = Math.floor(sr * 0.25);
    const noise = brown => {
      const buf = ctx.createBuffer(2, N, sr);
      for (let ch = 0; ch < 2; ch++) {
        const x = new Float32Array(N + F); let b = 0;
        for (let i = 0; i < N + F; i++) { const w = Math.random() * 2 - 1; x[i] = brown ? (b = (b + 0.02 * w) / 1.02) : w; }
        const out = buf.getChannelData(ch); let ss = 0;
        for (let i = 0; i < N; i++) { const u = i < F ? i / F : 1; out[i] = x[i] * u + (i < F ? x[N + i] * (1 - u) : 0); ss += out[i] * out[i]; }
        let mean = 0; if (brown) { for (let i = 0; i < N; i++) mean += out[i]; mean /= N; ss = 0; for (let i = 0; i < N; i++) { out[i] -= mean; ss += out[i] * out[i]; } }
        const k = 0.3 / Math.sqrt(ss / N); for (let i = 0; i < N; i++) out[i] *= k;
      }
      return buf;
    };
    this.white = noise(false); this.brown = noise(true);
    const loop = (buffer, offset) => { const s = mk(new AudioBufferSourceNode(ctx, { buffer, loop: true })); s.start(0, offset); return s; };
    const filt = (type, frequency, Q = 0.7) => mk(new BiquadFilterNode(ctx, { type, frequency, Q }));
    const gain = g => mk(new GainNode(ctx, { gain: g }));

    // Wind: rumble + hiss + pine sough into a 2x2 stereo matrix (width and balance) into the wind bus.
    this.rumbleLP = filt('lowpass', 400, 0.5); this.rumbleGain = gain(0);
    loop(this.brown, 0).connect(this.rumbleLP).connect(this.rumbleGain);
    this.hissHP = filt('highpass', 3500, 0.5); this.hissGain = gain(0);
    loop(this.white, 0).connect(this.hissHP).connect(filt('lowpass', 11000, 0.5)).connect(this.hissGain);
    this.soughBP = filt('bandpass', 800, 0.6); this.soughGain = gain(0);
    loop(this.white, 2.9).connect(this.soughBP).connect(this.soughGain);
    const windMix = gain(1); this.rumbleGain.connect(windMix); this.hissGain.connect(windMix); this.soughGain.connect(windMix);
    const split = mk(new ChannelSplitterNode(ctx, { numberOfOutputs: 2 })), merge = mk(new ChannelMergerNode(ctx, { numberOfInputs: 2 }));
    windMix.connect(split);
    this.wLL = gain(0.7); this.wLR = gain(0.3); this.wRR = gain(0.7); this.wRL = gain(0.3);
    split.connect(this.wLL, 0); this.wLL.connect(merge, 0, 0); split.connect(this.wLR, 0); this.wLR.connect(merge, 0, 1);
    split.connect(this.wRR, 1); this.wRR.connect(merge, 0, 1); split.connect(this.wRL, 1); this.wRL.connect(merge, 0, 0);
    merge.connect(this.windBus);

    // Water: wash and gurgle on one panner kept at the nearest stream point. Its linear distance model
    // (full within 5 m, silent at 75 m) times the same proximity on the bus gives a roughly quadratic fade.
    this.waterPan = mk(new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'linear', refDistance: 5, maxDistance: 75, rolloffFactor: 1, positionY: -1e5 }));
    this.washGain = gain(0); this.gurgleBP = filt('bandpass', 900, 7); this.gurgleGain = gain(0);
    loop(this.white, 1.3).connect(filt('highpass', 350, 0.5)).connect(filt('lowpass', 2000, 0.5)).connect(this.washGain).connect(this.waterPan);
    loop(this.white, 4.1).connect(this.gurgleBP).connect(this.gurgleGain).connect(this.waterPan);
    this.waterPan.connect(this.waterBus);

    // Crickets: a 4 s loop of seven field crickets (4.2-4.9 kHz pulses, 3-4 per chirp, each with its own
    // chirp period dividing the loop so it repeats seamlessly, its own pan).
    const CN = Math.floor(sr * 4), cbuf = ctx.createBuffer(2, CN, sr), L = cbuf.getChannelData(0), R = cbuf.getChannelData(1);
    for (let c = 0; c < 7; c++) {
      const f = rand(4200, 4900), per = 4 / (5 + Math.floor(Math.random() * 5)), pulses = 3 + (Math.random() < 0.5), amp = rand(0.25, 1);
      const pan = rand(-0.8, 0.8), gl = amp * Math.sqrt((1 - pan) / 2), gr = amp * Math.sqrt((1 + pan) / 2), off = Math.random() * per;
      const pd = Math.floor(sr * 0.016), gap = Math.floor(sr * 0.032);
      for (let t0 = off; t0 < 4 + off; t0 += per) for (let p = 0; p < pulses; p++) {
        const s0 = Math.floor(t0 * sr) + p * gap;
        for (let i = 0; i < pd; i++) {
          const e = Math.sin(Math.PI * i / pd) ** 2, v = Math.sin(2 * Math.PI * f * (s0 + i) / sr) * e * 0.3, k = (s0 + i) % CN;
          L[k] += v * gl; R[k] += v * gr;
        }
      }
    }
    this.cricketGain = gain(0);
    loop(cbuf, 0).connect(filt('lowpass', 7000, 0.5)).connect(this.cricketGain).connect(this.insectBus);

    this._runState(); this._ui();
  }

  // ---- short voices --------------------------------------------------------------------------------------
  // A voice owns the nodes of one call or whoosh; update() disconnects them once `end` has passed.
  // follow: an animal whose position the panner tracks while the voice plays.
  // ref: the panner's refDistance (m), smaller for soft sounds heard only close by.
  _voice(pos, gain, bus, follow = null, ref = 25) {
    const ctx = this.ctx, v = { nodes: [], end: ctx.currentTime, follow, pan: null };
    v.add = n => { this.created++; v.nodes.push(n); return n; };
    v.gain = g => v.add(new GainNode(ctx, { gain: g }));
    v.filter = (type, frequency, Q = 0.7) => v.add(new BiquadFilterNode(ctx, { type, frequency, Q }));
    v.osc = (type, frequency, t0, t1) => { const o = v.add(new OscillatorNode(ctx, { type, frequency })); o.start(t0); o.stop(t1); v.end = Math.max(v.end, t1); return o; };
    v.noise = (t0, t1) => { const s = v.add(new AudioBufferSourceNode(ctx, { buffer: this.white, loop: true })); s.start(t0, Math.random() * 5); s.stop(t1); v.end = Math.max(v.end, t1); return s; };
    v.input = v.gain(gain);
    if (pos) {
      const c = this.camera.position, d = Math.hypot(pos.x - c.x, pos.y - c.y, pos.z - c.z);
      const air = v.filter('lowpass', clamp(18000 * Math.exp(-d / 300), 2500, 18000), 0.5);   // air absorbs the highs
      const pan = v.add(new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, maxDistance: 5000, rolloffFactor: 1,
        positionX: pos.x, positionY: pos.y, positionZ: pos.z }));
      v.input.connect(air).connect(pan).connect(bus);
      v.dist = d; v.pan = pan;
    } else v.input.connect(bus);
    this.voices.push(v);
    return v;
  }

  _whoosh(t, strength, pm) {
    const v = this._voice(null, strength, this.wingBus);
    const s = v.noise(t, t + 0.4), bp = v.filter('bandpass', 1000 * pm, 0.8), g = v.gain(0);
    s.connect(bp).connect(g).connect(v.input);
    bp.frequency.setValueAtTime(1100 * pm, t); bp.frequency.exponentialRampToValueAtTime(300 * pm, t + 0.3);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  }

  // Raven "kraa": sawtooth with an FM rasp and a little noise through two formants and a lowpass; the pitch
  // rises a touch then falls about a fifth. count calls in a row.
  _kraa(v, t, count = 1, pm = 1) {
    const dur = rand(0.32, 0.48), gapT = rand(0.14, 0.24), f0 = 340 * pm, end = t + count * (dur + gapT);
    const o = v.osc('sawtooth', f0, t, end), m = v.osc('sine', rand(55, 80), t, end), md = v.gain(f0 * 0.1);
    m.connect(md).connect(o.frequency);
    const n = v.noise(t, end), ng = v.gain(0.35), mix = v.gain(1);
    o.connect(mix); n.connect(ng).connect(mix);
    const g = v.gain(0), f1 = v.filter('bandpass', 1050, 3), f2 = v.filter('bandpass', 1900, 4), lp = v.filter('lowpass', 3200, 0.5);
    const g1 = v.gain(1.6), g2 = v.gain(1.0), g3 = v.gain(0.22);
    mix.connect(f1).connect(g1).connect(g); mix.connect(f2).connect(g2).connect(g); mix.connect(lp).connect(g3).connect(g);
    g.connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < count; i++) {
      const s = t + i * (dur + gapT), p = pm * rand(0.96, 1.04);
      o.frequency.setValueAtTime(f0 * 0.95 * p, s); o.frequency.linearRampToValueAtTime(f0 * 1.03 * p, s + 0.05);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.74 * p, s + dur);
      env(g.gain, s, [[0, 0], [0.025, 1], [dur * 0.6, 0.85], [dur, 0]]);
    }
  }

  // California quail "chi-CA-go": three notes, the middle highest and loudest, the last falling.
  _quail(v, t) {
    const pm = rand(0.94, 1.06), o = v.osc('triangle', 1500 * pm, t, t + 0.6), lp = v.filter('lowpass', 5000), g = v.gain(0);
    o.connect(lp).connect(g).connect(v.input);
    const F = o.frequency;
    F.setValueAtTime(1450 * pm, t); F.linearRampToValueAtTime(1750 * pm, t + 0.07);
    F.setValueAtTime(1850 * pm, t + 0.13); F.linearRampToValueAtTime(2750 * pm, t + 0.21); F.linearRampToValueAtTime(2450 * pm, t + 0.29);
    F.setValueAtTime(2350 * pm, t + 0.36); F.exponentialRampToValueAtTime(1500 * pm, t + 0.56);
    env(g.gain, t, [[0, 0], [0.012, 0.5], [0.06, 0.4], [0.075, 0], [0.13, 0], [0.15, 1], [0.27, 0.85], [0.295, 0], [0.36, 0], [0.375, 0.8], [0.5, 0.55], [0.56, 0]]);
  }

  // Acorn woodpecker "waka-waka" rally: a nasal, laughing series of 2-5 "waka"s, each a step higher and a
  // touch quicker than the last. A "waka" is a rising "wa" and a shorter, higher, falling "ka": a sawtooth with
  // a 42 Hz square-wave rasp on its gain (each "waka" 9 % above the last), through two formants (1.5 and 2.9 kHz) for the nasal colour.
  _woodpecker(v, t) {
    const n = 2 + Math.floor(Math.random() * 4), pm = rand(0.92, 1.08), at = [];
    let s = t; for (let i = 0; i < n; i++) { at.push(s); s += 0.255 - i * 0.012; }
    const end = s + 0.05;
    const o = v.osc('sawtooth', 700 * pm, t, end), am = v.osc('square', 42, t, end), amd = v.gain(0.3), rasp = v.gain(0.7);
    am.connect(amd).connect(rasp.gain);
    const f1 = v.filter('bandpass', 1500 * pm, 2), f2 = v.filter('bandpass', 2900 * pm, 3), g2 = v.gain(0.55), g = v.gain(0);
    o.connect(rasp); rasp.connect(f1).connect(g); rasp.connect(f2).connect(g2).connect(g); g.connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s0 = at[i], k = pm * (1 + 0.09 * i), F = o.frequency;
      F.setValueAtTime(560 * k, s0); F.linearRampToValueAtTime(800 * k, s0 + 0.08);
      F.setValueAtTime(860 * k, s0 + 0.115); F.linearRampToValueAtTime(640 * k, s0 + 0.19);
      env(g.gain, s0, [[0, 0], [0.012, 0.8 + 0.05 * i], [0.07, 0.7], [0.09, 0], [0.11, 0], [0.122, 1], [0.17, 0.7], [0.195, 0]]);
    }
  }

  // A woodpecker's hammering: n dry knocks `period` s apart (the AI's peck rate), each a 1.5 ms noise click
  // through a band-pass at 1.6-2.6 kHz (the bark's ring) decaying in ~30 ms, over a 450-750 Hz sine "tok" (the
  // trunk) decaying in ~45 ms. hard: 1 hammering an acorn home, about 0.6 probing bark.
  _knocks(v, t, n = 6, period = 2 * Math.PI / PECK_W, hard = 1) {
    const end = t + n * period + 0.08;
    const ns = v.noise(t, end), bp = v.filter('bandpass', 2000, 2.5), ng = v.gain(0);
    const o = v.osc('sine', 600, t, end), og = v.gain(0);
    ns.connect(bp).connect(ng).connect(v.input); o.connect(og).connect(v.input);
    ng.gain.setValueAtTime(0, t); og.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s0 = t + i * period + rand(-0.004, 0.004), a = hard * rand(0.7, 1) * (i ? 1 : 0.8), f = rand(450, 750);
      bp.frequency.setValueAtTime(rand(1600, 2600), s0);
      ng.gain.setValueAtTime(0, s0); ng.gain.linearRampToValueAtTime(a, s0 + 0.0015); ng.gain.exponentialRampToValueAtTime(0.001, s0 + 0.03); ng.gain.setValueAtTime(0, s0 + 0.031);
      o.frequency.setValueAtTime(f, s0); o.frequency.exponentialRampToValueAtTime(f * 0.7, s0 + 0.045);
      og.gain.setValueAtTime(0, s0); og.gain.linearRampToValueAtTime(a * 0.5, s0 + 0.002); og.gain.exponentialRampToValueAtTime(0.001, s0 + 0.045); og.gain.setValueAtTime(0, s0 + 0.046);
    }
  }

  // California scrub-jay: a harsh rising "shreep", two or three times (sawtooth plus noise, band-pass sweeping up).
  _scrubjay(v, t) {
    const n = 2 + (Math.random() < 0.5), pm = rand(0.93, 1.07), end = t + n * 0.42;
    const o = v.osc('sawtooth', 1000, t, end), ns = v.noise(t, end), ng = v.gain(0.5), mix = v.gain(1);
    const bp = v.filter('bandpass', 2000, 2.2), g = v.gain(0);
    o.connect(mix); ns.connect(ng).connect(mix); mix.connect(bp).connect(g).connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.42;
      o.frequency.setValueAtTime(1000 * pm, s); o.frequency.exponentialRampToValueAtTime(1900 * pm, s + 0.26);
      bp.frequency.setValueAtTime(2000 * pm, s); bp.frequency.exponentialRampToValueAtTime(3400 * pm, s + 0.26);
      env(g.gain, s, [[0, 0], [0.03, 0.8], [0.2, 1], [0.26, 0]]);
    }
  }

  // Red-tailed hawk: a hoarse descending scream, about 1.5 s, with vibrato.
  _hawk(v, t) {
    const pm = rand(0.95, 1.05), dur = rand(1.3, 1.7), end = t + dur;
    const o = v.osc('sawtooth', 2900 * pm, t, end), vib = v.osc('sine', 6.5, t, end), vd = v.gain(60);
    vib.connect(vd).connect(o.frequency);
    const ns = v.noise(t, end), ng = v.gain(0.7), mix = v.gain(1), bp = v.filter('bandpass', 3000 * pm, 1.4), g = v.gain(0);
    o.connect(mix); ns.connect(ng).connect(mix); mix.connect(bp).connect(g).connect(v.input);
    o.frequency.setValueAtTime(2900 * pm, t); o.frequency.linearRampToValueAtTime(3100 * pm, t + 0.15); o.frequency.exponentialRampToValueAtTime(1700 * pm, end);
    bp.frequency.setValueAtTime(3000 * pm, t); bp.frequency.exponentialRampToValueAtTime(1900 * pm, end);
    env(g.gain, t, [[0, 0], [0.12, 1], [dur * 0.6, 0.7], [dur, 0]]);
  }

  // Steller's jay, its three common calls: the "shook" series (55 %), the "shaaar" scold (30 %), the whistle (15 %).
  _steller(v, t) {
    const q = Math.random();
    if (q < 0.55) this._shook(v, t); else if (q < 0.85) this._shaaar(v, t); else this._jayWhistle(v, t);
  }
  // Steller's jay: harsh "shook shook shook", lower and shorter than the scrub-jay, three to five times.
  _shook(v, t) {
    const n = 3 + Math.floor(Math.random() * 3), pm = rand(0.93, 1.07), end = t + n * 0.27;
    const o = v.osc('sawtooth', 760, t, end), ns = v.noise(t, end), ng = v.gain(0.8), mix = v.gain(1);
    const bp = v.filter('bandpass', 1700, 1.6), g = v.gain(0);
    o.connect(mix); ns.connect(ng).connect(mix); mix.connect(bp).connect(g).connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.27;
      o.frequency.setValueAtTime(760 * pm, s); o.frequency.exponentialRampToValueAtTime(520 * pm, s + 0.14);
      bp.frequency.setValueAtTime(1700 * pm, s); bp.frequency.exponentialRampToValueAtTime(1150 * pm, s + 0.14);
      env(g.gain, s, [[0, 0], [0.01, 1], [0.08, 0.6], [0.14, 0]]);
    }
  }

  // A covey flushing: n quail burst up, each a run of wingbeats (16-22 Hz) for 0.6-1.0 s, staggered by
  // up to half a second as in animals.js (flushCovey: rank * 0.04 + 0-0.45 s), then gliding. One noise
  // source through a low thrum and a band-passed whirr, under one gain curve summed over the birds;
  // and two or three alarm "pit"s from the covey.
  _flush(v, t, n) {
    const birds = Math.max(1, Math.min(n, 12)), RATE = 400, total = 1.9, N = Math.ceil(total * RATE);
    const curve = new Float32Array(N);
    for (let b = 0; b < birds; b++) {
      const t0 = b * 0.04 + Math.random() * 0.45, len = rand(0.6, 1.0), f = rand(16, 22), amp = rand(0.55, 1), ph = Math.random() * 6.28;
      for (let i = Math.floor(t0 * RATE); i < N; i++) {
        const tt = i / RATE - t0; if (tt > len) break;
        const e = Math.min(1, tt / 0.04) * Math.pow(1 - tt / len, 0.6), beat = Math.pow(0.5 + 0.5 * Math.sin(6.2832 * f * tt + ph), 3);
        curve[i] += amp * e * (0.3 + 0.7 * beat);
      }
    }
    let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, curve[i]);
    const k = 1 / Math.max(peak, 1e-3) * Math.min(1, 0.55 + 0.08 * birds); curve[N - 1] = 0;
    for (let i = 0; i < N; i++) curve[i] *= k;
    const ns = v.noise(t, t + total), bp = v.filter('bandpass', rand(1000, 1300), 0.9), lp = v.filter('lowpass', 320, 0.7);
    const gl = v.gain(1.4), mix = v.gain(1), g = v.gain(0);
    ns.connect(bp).connect(mix); ns.connect(lp).connect(gl).connect(mix); mix.connect(g).connect(v.input);
    g.gain.setValueCurveAtTime(curve, t, total);
    // alarm "pit"s: short falling chips
    const pits = 2 + (Math.random() < 0.5), o = v.osc('sine', 2600, t + 0.1, t + 0.1 + pits * 0.17 + 0.1), pg = v.gain(0);
    o.connect(pg).connect(v.input); pg.gain.setValueAtTime(0, t);
    for (let i = 0; i < pits; i++) {
      const s = t + 0.1 + i * rand(0.13, 0.19);
      o.frequency.setValueAtTime(2900, s); o.frequency.exponentialRampToValueAtTime(2100, s + 0.05);
      env(pg.gain, s, [[0, 0], [0.006, 0.35], [0.05, 0]]);
    }
  }

  // Steller's jay "shaaar": a harsh, drawn-out, falling scold, once or twice: a sawtooth (900 -> 600 Hz) and
  // as much noise through a wide band-pass sliding 2.4 -> 1.6 kHz, roughened by a 70 Hz amplitude flutter.
  _shaaar(v, t) {
    const n = 1 + (Math.random() < 0.45), pm = rand(0.93, 1.07), dur = rand(0.42, 0.58), gapT = rand(0.18, 0.3), end = t + n * (dur + gapT);
    const o = v.osc('sawtooth', 900 * pm, t, end), ns = v.noise(t, end), ng = v.gain(0.9), mix = v.gain(0.6);
    const fl = v.osc('sine', 70, t, end), fd = v.gain(0.4), bp = v.filter('bandpass', 2400 * pm, 1.1), g = v.gain(0);
    fl.connect(fd).connect(mix.gain);
    o.connect(mix); ns.connect(ng).connect(mix); mix.connect(bp).connect(g).connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s0 = t + i * (dur + gapT);
      o.frequency.setValueAtTime(900 * pm, s0); o.frequency.exponentialRampToValueAtTime(600 * pm, s0 + dur);
      bp.frequency.setValueAtTime(2400 * pm, s0); bp.frequency.exponentialRampToValueAtTime(1600 * pm, s0 + dur);
      env(g.gain, s0, [[0, 0], [0.04, 1], [dur * 0.55, 0.85], [dur, 0]]);
    }
  }
  // Steller's jay's mellow rising whistle: a sine gliding 1.3 -> 2.1 kHz over a third of a second with a slow
  // vibrato, sometimes a second one a little higher.
  _jayWhistle(v, t) {
    const n = 1 + (Math.random() < 0.4), pm = rand(0.92, 1.08), dur = 0.34, end = t + n * 0.55;
    const o = v.osc('sine', 1300 * pm, t, end), vib = v.osc('sine', 9, t, end), vd = v.gain(25), g = v.gain(0);
    vib.connect(vd).connect(o.frequency); o.connect(g).connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s0 = t + i * 0.55, k = pm * (1 + 0.06 * i);
      o.frequency.setValueAtTime(1300 * k, s0); o.frequency.exponentialRampToValueAtTime(2100 * k, s0 + dur);
      env(g.gain, s0, [[0, 0], [0.06, 0.45], [dur * 0.7, 0.4], [dur, 0]]);
    }
  }

  // Western gray squirrel's barking alarm: n hoarse "chuff"s 0.32-0.5 s apart (the tail flicks on each), each
  // ~90 ms of noise through a 1.8 kHz band-pass over a falling 420 -> 300 Hz sawtooth through a 1.1 kHz formant,
  // a hard 4 ms onset; now and then a longer moaning "quaa" closes the series. Sets v.beats: the chuffs' offsets (s).
  _squirrelBark(v, t, n = 4 + Math.floor(Math.random() * 6)) {
    const pm = rand(0.92, 1.08), at = []; let s = t;
    for (let i = 0; i < n; i++) { at.push(s); s += rand(0.32, 0.5); }
    const quaa = Math.random() < 0.4, end = s + (quaa ? 0.4 : 0.15);
    const o = v.osc('sawtooth', 420 * pm, t, end), ns = v.noise(t, end);
    const nb = v.filter('bandpass', 1800 * pm, 1.4), ngain = v.gain(1.3), vf = v.filter('bandpass', 1100 * pm, 2.2), vg = v.gain(0.9);
    const g = v.gain(0);
    ns.connect(nb).connect(ngain).connect(g); o.connect(vf).connect(vg).connect(g); g.connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (const s0 of at) {
      const a = rand(0.75, 1);
      o.frequency.setValueAtTime(420 * pm, s0); o.frequency.exponentialRampToValueAtTime(300 * pm, s0 + 0.09);
      env(g.gain, s0, [[0, 0], [0.004, a], [0.03, a * 0.6], [0.09, 0]]);
    }
    if (quaa) {   // the moan: voiced, less breath, falling
      o.frequency.setValueAtTime(560 * pm, s); o.frequency.exponentialRampToValueAtTime(380 * pm, s + 0.32);
      ngain.gain.setValueAtTime(0.5, s);
      env(g.gain, s, [[0, 0], [0.03, 0.7], [0.2, 0.55], [0.32, 0]]);
    }
    v.beats = at.map(x => x - t);
  }
  // A gray squirrel's soft chatter: a burst of tooth clicks at 14-18 a second for 0.4-0.9 s, louder in the middle,
  // with a grumbling "muk" or two: one noise source through a 3.2 kHz band-pass under a gain curve, and a low
  // triangle murmur.
  _chatter(v, t) {
    const len = rand(0.4, 0.9), rate = rand(14, 18), RATE = 500, N = Math.ceil((len + 0.05) * RATE), curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const tt = i / RATE, ph = (tt * rate) % 1, e = Math.sin(Math.PI * Math.min(1, tt / len)) ** 0.7;
      curve[i] = tt < len ? e * Math.exp(-ph * 18) * rand(0.6, 1) : 0;
    }
    curve[N - 1] = 0;
    const ns = v.noise(t, t + len + 0.05), bp = v.filter('bandpass', rand(2800, 3600), 2), g = v.gain(0);
    ns.connect(bp).connect(g).connect(v.input);
    g.gain.setValueCurveAtTime(curve, t, len + 0.05);
    const m = 1 + (Math.random() < 0.5), o = v.osc('triangle', 380, t, t + len + 0.1), lp = v.filter('lowpass', 1400, 0.7), mg = v.gain(0);
    o.connect(lp).connect(mg).connect(v.input); mg.gain.setValueAtTime(0, t);
    for (let i = 0; i < m; i++) {
      const s0 = t + rand(0, len * 0.7);
      o.frequency.setValueAtTime(rand(340, 420), s0); o.frequency.exponentialRampToValueAtTime(260, s0 + 0.08);
      env(mg.gain, s0, [[0, 0], [0.01, 0.25], [0.08, 0]]);
    }
  }

  // California quail contact clucks, "pit ... pit-pit": 2-4 soft 40-60 ms notes, a sine starting near
  // 2.3 kHz, flicking up then down, 0.1-0.3 s apart; quicker while the covey runs.
  _clucks(v, t, quick = false) {
    const n = 2 + Math.floor(Math.random() * 3), pm = rand(0.92, 1.08), at = []; let s = t;
    for (let i = 0; i < n; i++) { at.push(s); s += quick ? rand(0.09, 0.15) : rand(0.12, 0.3); }
    const o = v.osc('sine', 2300 * pm, t, s + 0.08), g = v.gain(0);
    o.connect(g).connect(v.input); g.gain.setValueAtTime(0, t);
    for (const s0 of at) {
      const d = rand(0.04, 0.06), k = pm * rand(0.96, 1.04);
      o.frequency.setValueAtTime(2200 * k, s0); o.frequency.linearRampToValueAtTime(2600 * k, s0 + d * 0.3); o.frequency.exponentialRampToValueAtTime(1900 * k, s0 + d);
      env(g.gain, s0, [[0, 0], [0.006, rand(0.6, 1)], [d, 0]]);
    }
  }

  // Mule deer snort-wheeze: a hard nasal blow (noise, low-passed at 1.1 kHz, 15 ms onset, ~0.2 s) and then a
  // long whistling exhale through the nose (noise through two narrow band-passes gliding 2.6 -> 1.5 kHz, a 26 Hz
  // flutter, 0.7-1.0 s, swelling then fading). One noise source feeds both.
  _snort(v, t) {
    const pm = rand(0.9, 1.1), w0 = t + 0.16, wl = rand(0.7, 1.0), end = w0 + wl;
    const ns = v.noise(t, end), lp = v.filter('lowpass', 1100 * pm, 0.8), sg = v.gain(0);
    const bp = v.filter('bandpass', 2600 * pm, 4.5), bp2 = v.filter('bandpass', 2600 * pm, 4.5), wg = v.gain(0), fg = v.gain(0.75);
    const fl = v.osc('sine', 26, w0, end), fd = v.gain(0.25);
    ns.connect(lp).connect(sg).connect(v.input); ns.connect(bp).connect(bp2).connect(wg).connect(fg).connect(v.input);
    fl.connect(fd).connect(fg.gain);
    env(sg.gain, t, [[0, 0], [0.015, 1.6], [0.07, 0.9], [0.2, 0]]);
    for (const f of [bp, bp2]) { f.frequency.setValueAtTime(2600 * pm, w0); f.frequency.exponentialRampToValueAtTime(1500 * pm, end); }
    env(wg.gain, w0, [[0, 0], [0.12, 3], [wl * 0.5, 2.2], [wl, 0]]);
  }

  // Gray fox: a single hoarse bark (a second now and then): a sawtooth jumping 600 -> 900 Hz and falling to 480
  // in 0.22 s with noise rasp, through formants at 1.0 and 2.3 kHz.
  _foxBark(v, t) {
    const n = 1 + (Math.random() < 0.2), pm = rand(0.9, 1.1), end = t + n * 0.6;
    const o = v.osc('sawtooth', 600 * pm, t, end), ns = v.noise(t, end), ng = v.gain(0.5), mix = v.gain(1);
    const f1 = v.filter('bandpass', 1000 * pm, 2.5), f2 = v.filter('bandpass', 2300 * pm, 3), g2 = v.gain(0.6), g = v.gain(0);
    o.connect(mix); ns.connect(ng).connect(mix); mix.connect(f1).connect(g); mix.connect(f2).connect(g2).connect(g); g.connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s0 = t + i * 0.6;
      o.frequency.setValueAtTime(600 * pm, s0); o.frequency.linearRampToValueAtTime(900 * pm, s0 + 0.04); o.frequency.exponentialRampToValueAtTime(480 * pm, s0 + 0.22);
      env(g.gain, s0, [[0, 0], [0.012, 1], [0.08, 0.8], [0.22, 0]]);
    }
  }

  // Brush rabbit: a hind-foot thump on the ground, once or twice: a sine falling 110 -> 45 Hz in 80 ms under
  // a low-passed noise scuff.
  _thump(v, t) {
    const n = 1 + (Math.random() < 0.4), end = t + n * 0.35 + 0.15;
    const o = v.osc('sine', 110, t, end), og = v.gain(0), ns = v.noise(t, end), lp = v.filter('lowpass', 450, 0.7), ng = v.gain(0);
    o.connect(og).connect(v.input); ns.connect(lp).connect(ng).connect(v.input);
    og.gain.setValueAtTime(0, t); ng.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s0 = t + i * rand(0.3, 0.4);
      o.frequency.setValueAtTime(110, s0); o.frequency.exponentialRampToValueAtTime(45, s0 + 0.08);
      og.gain.setValueAtTime(0, s0); og.gain.linearRampToValueAtTime(1, s0 + 0.004); og.gain.exponentialRampToValueAtTime(0.001, s0 + 0.13);
      ng.gain.setValueAtTime(0, s0); ng.gain.linearRampToValueAtTime(0.5, s0 + 0.003); ng.gain.exponentialRampToValueAtTime(0.001, s0 + 0.04);
    }
  }

  // ---- calls on animals ----------------------------------------------------------------------------------
  // animals.js, passed in or found on the debugging handle at call time (main.js builds it after us)
  _animals() { return this.animals || (typeof window !== 'undefined' ? window.__we?.animals : null) || null; }
  // Subscribe to the animals' flush and stoop events (once per animals instance).
  _hook() {
    const A = this._animals(); if (!A?.on || A === this._hooked) return;
    if (this._unhook) for (const off of this._unhook) off();
    this._unhook = [A.on('flush', e => this._onFlush(e)), A.on('stoop', e => this._onStoop(e)), A.on('rally', e => this._onRally(e))];
    this._hooked = A;
  }
  // A random animal of this species within r of the raven, or null.
  _pick(code, r) {
    const A = this._animals(), p = this.flight.pos; if (!A?.within) return null;
    const list = A.within(code, p.x, p.y, p.z, r, this._near);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  _live() { return this.ctx && this.ctx.state === 'running' && !this.muted; }
  _listenerDist(x, y, z) { const c = this.camera.position; return Math.hypot(x - c.x, y - c.y, z - c.z); }
  // Play a species call ('raven' or a CALLERS key) at pos, following `animal` when given. source: how it
  // was placed (animal, habitat, event, answer), for the log.
  // NEAR keys (the near layer) take their own refDistance and are capped at NEAR_MAX voices; `delay` (s) starts
  // the call later (the knocks' sync with the pecks).
  _play(key, pos, animal, source, synth = null, delay = 0) {
    if (!this.ctx || this.voices.length >= MAX_VOICES) return null;
    const near = NEAR[key];
    if (near && this.voices.reduce((n, v) => n + (v.near ? 1 : 0), 0) >= NEAR_MAX) return null;
    const t = this.ctx.currentTime + 0.03 + delay;
    let v, label;
    if (key === 'raven') {
      v = this._voice(pos, 0.7, this.birdBus, animal); label = 'raven';
      this._kraa(v, t, 1 + Math.floor(Math.random() * 3), rand(0.9, 1.12));
    } else {
      const c = near || CALLERS.find(c => c.key === key); if (!c) return null;
      v = this._voice(pos, c.gain, this.birdBus, animal, c.ref ?? 25); label = c.label; v.near = !!near;
      if (synth) synth(v, t); else this['_' + c.synth](v, t);
    }
    this._heard(label, v.dist);
    this.sources[source] = (this.sources[source] || 0) + 1;
    const rec = { at: +this.t.toFixed(2), key, label, source, id: animal?.id ?? null, x: pos.x, y: pos.y, z: pos.z, dist: Math.round(v.dist) };
    this.log.push({ ...rec, voice: v, animal });
    if (this.log.length > LOG_N) this.log.shift();
    if (this.trace) this.trace.push(rec);
    return v;
  }
  _onAnimal(a) { return { x: a.x, y: a.y + 0.3, z: a.z }; }
  _onFlush(e) {
    if (!this._live() || this._listenerDist(e.x, e.y, e.z) > EVENT_R) return;
    this._play('quail', { x: e.x, y: e.y + 0.5, z: e.z }, e.group?.leader || null, 'event', (v, t) => this._flush(v, t, e.n));
    // scattered, they call each other back together: a "chi-ca-go" or two from where the covey lands
    const g = e.group; if (!g || !(this.elevDeg > -6) || this._listenerDist(e.x, e.y, e.z) > NEAR.assembly.range || Math.random() > 0.6) return;   // not in the dark
    let at = this.t + rand(4, 9);
    if (this.pending.some(p => p.covey === g)) return;
    for (let i = 0, n = 1 + (Math.random() < 0.3); i < n; i++, at += rand(2, 5)) this.pending.push({ at, key: 'assembly', animal: g.leader, covey: g });
  }
  // Acorn game v4: a woodpecker family rallying against a raider at its granary: the waka from the nearest bird, and a
  // second from a family member a moment later.
  _onRally(e) {
    if (!this._live() || !e.animal || this._listenerDist(e.x, e.y, e.z) > NEAR.waka.range) return;
    this._play('waka', this._onAnimal(e.animal), e.animal, 'event');
    const A = this._animals(), mates = A?.bySpecies?.[e.animal.sp]?.filter(b => b !== e.animal && b.anchor === e.animal.anchor) || [];
    if (mates.length) this.pending.push({ at: this.t + rand(0.35, 0.8), key: 'waka', animal: mates[Math.floor(Math.random() * mates.length)] });
  }
  _onStoop(e) {
    if (!this._live() || this._listenerDist(e.x, e.y, e.z) > EVENT_R + 200) return;
    this._play('hawk', this._onAnimal(e.animal), e.animal, 'event');
  }

  // ---- public actions ------------------------------------------------------------------------------------
  // The player's raven calls (C). Ambient ravens within REAL_R answer from where they are: one (85 %),
  // and a second, often its mate (35 %); with none in range a distant raven answers now and then.
  call() {
    if (!this.ctx || this.muted) return;
    const sp = typeof window !== 'undefined' ? window.__we?.playerSpecies : null;
    if (sp === 'sciurus_griseus') return this.squirrelCall();
    if (sp === 'melanerpes_formicivorus') return this.woodpeckerCall();
    const t = this.ctx.currentTime + 0.02;
    this._kraa(this._voice(null, 0.5, this.voiceBus), t, 1 + (Math.random() < 0.35), 1);
    const A = this._animals(), p = this.flight.pos;
    const near = A?.within ? A.within('corvus_corax', p.x, p.y, p.z, REAL_R, []) : [];
    if (near.length) {
      near.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z) - Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z));
      let at = this.t + rand(0.8, 2.4);
      if (Math.random() < 0.85) this.replies.push({ t: at, animal: near[0] });
      if (near.length > 1 && Math.random() < 0.35) this.replies.push({ t: at + rand(0.6, 1.8), animal: near[1] });
    } else if (Math.random() < 0.4) this.replies.push({ t: this.t + rand(1.2, 3.5), animal: null });
    return near.length;
  }

  // The player squirrel's bark (C): the alarm series from the player; a squirrel within 40 m may bark back.
  squirrelCall() {
    if (!this.ctx || this.muted) return 0;
    const v = this._voice(null, 0.5, this.voiceBus); this._squirrelBark(v, this.ctx.currentTime + 0.02, 3 + Math.floor(Math.random() * 4));
    this._playerLog('bark', 'gray squirrel');
    return this._answer('squirrel', 40, 0.45, 'bark', [1, 2.5]);
  }
  // The player woodpecker's waka (C); one of the woodpeckers within 80 m may answer.
  woodpeckerCall() {
    if (!this.ctx || this.muted) return 0;
    this._woodpecker(this._voice(null, 0.45, this.voiceBus), this.ctx.currentTime + 0.02);
    this._playerLog('waka', 'acorn woodpecker');
    return this._answer('woodpecker', 80, 0.5, 'waka', [0.6, 1.8]);
  }
  _playerLog(key, label) {
    const p = this.flight.pos, rec = { at: +this.t.toFixed(2), key, label, source: 'player', id: null, x: p.x, y: p.y, z: p.z, dist: 0 };
    this.sources.player++; if (this.trace) this.trace.push(rec);
  }
  // An animal of a near-layer species (mesh name) within r of the player answers with `key` (chance p) after a
  // delay in [lo, hi] s; the number of candidates.
  _answer(name, r, p, key, [lo, hi]) {
    const A = this._animals(); if (!A?.bySpecies) return 0;
    const I = this._idx(A), P = this.flight.pos, cand = [];
    for (const k of name === 'woodpecker' ? [I.wp, I.wf] : [I[name === 'squirrel' ? 'sq' : name]]) {
      if (k < 0 || !A.meshes[k].visible) continue;
      for (const a of A.bySpecies[k]) { const d = Math.hypot(a.x - P.x, a.y - P.y, a.z - P.z); if (d > 1 && d < r) cand.push(a); }
    }
    if (cand.length && Math.random() < p) this.pending.push({ at: this.t + rand(lo, hi), key, animal: cand[Math.floor(Math.random() * cand.length)], source: 'answer' });
    return cand.length;
  }

  // A call placed `dist` metres away in a random direction: a species key from CALLERS, or 'raven'.
  callAt(key, dist, height, source = 'habitat') {
    if (!this.ctx) return null;
    const p = this.flight.pos, a = Math.random() * Math.PI * 2, size = this.tile.size;
    const x = clamp(p.x + Math.cos(a) * dist, 0, size), z = clamp(p.z + Math.sin(a) * dist, -size, 0);
    const ground = this.tile.heights.atXZ(x, z);
    const c = key === 'raven' ? { height: [15, 80] } : CALLERS.find(c => c.key === key); if (!c) return null;
    return this._play(key, { x, y: ground + (height ?? rand(...c.height)), z }, null, source);
  }
  // A call from a real animal of the species within r (default REAL_R), or null when there is none.
  callOn(key, r = REAL_R) {
    if (!this.ctx) return null;
    const code = key === 'raven' ? 'corvus_corax' : CALLERS.find(c => c.key === key)?.code;
    const a = code && this._pick(code, r);
    return a ? this._play(key, this._onAnimal(a), a, 'animal') : null;
  }

  // Coyote: three to six short rising yips, then a howl gliding up and wavering down (sine with vibrato, a little noise).
  _coyote(v, t) {
    const n = 3 + Math.floor(Math.random() * 4), pm = rand(0.9, 1.12);
    for (let i = 0; i < n; i++) {
      const s = t + i * rand(0.13, 0.2), e = s + 0.09, o = v.osc('triangle', 700 * pm, s, e), g = v.gain(0);
      o.frequency.setValueAtTime(650 * pm, s); o.frequency.exponentialRampToValueAtTime(1150 * pm, e);
      o.connect(g).connect(v.input); env(g.gain, s, [[0, 0], [0.015, 0.8], [0.09, 0]]);
    }
    const h = t + n * 0.18 + 0.1, dur = rand(1.4, 2.2), end = h + dur;
    const o = v.osc('sine', 500 * pm, h, end), vib = v.osc('sine', rand(5, 7), h, end), vd = v.gain(18 * pm), g = v.gain(0);
    vib.connect(vd).connect(o.frequency);
    o.frequency.setValueAtTime(480 * pm, h); o.frequency.exponentialRampToValueAtTime(900 * pm, h + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(620 * pm, end);
    const ns = v.noise(h, end), nb = v.filter('bandpass', 800 * pm, 3), ng = v.gain(0.08);
    ns.connect(nb).connect(ng).connect(g); o.connect(g).connect(v.input);
    env(g.gain, h, [[0, 0], [0.25, 0.9], [dur * 0.7, 0.7], [dur, 0]]);
  }

  _heard(label, d) { this.heard[label] = (this.heard[label] || 0) + Math.min(1, 40 / Math.max(1, d)); }

  // One placement attempt: a random spot 50-300 m away, the habitat there, each species' weight by habitat,
  // time of day and season; maybe one of them calls.
  _attempt(act) {
    const p = this.flight.pos, a = Math.random() * Math.PI * 2, d = rand(50, 300), size = this.tile.size;
    const x = clamp(p.x + Math.cos(a) * d, 0, size), z = clamp(p.z + Math.sin(a) * d, -size, 0);
    const h = this.tile.habitat.at(x, -z);
    let total = 0; const w = [];
    for (const c of this.callers) { const wi = (c.hab[h] || 0) * c.rate * c.tod(act.chorus, act.day, act.noon) * act.season; w.push(wi); total += wi; }
    if (Math.random() >= Math.min(1, total)) return;
    let r = Math.random() * total, i = 0; while (i < w.length - 1 && (r -= w[i]) > 0) i++;
    const c = this.callers[i], bird = this._pick(c.code, REAL_R);
    if (bird && c.key === 'woodpecker' && this._listenerDist(bird.x, bird.y, bird.z) < NEAR.waka.range) return;   // the near layer voices these
    if (bird) this._play(c.key, this._onAnimal(bird), bird, 'animal');
    else this._play(c.key, { x, y: this.tile.heights.atXZ(x, z) + rand(...c.height), z }, null, 'habitat');
  }

  // ---- near layer: calls tied to the animals close by and their states --------------------------------------
  // Species slots by their mesh name (animals.js SPECIES[].one), once per animals instance.
  _idx(A) {
    if (this._idxOf === A) return this._idxV;
    const by = n => A.meshes ? A.meshes.findIndex(m => m.name === n) : -1;
    this._idxV = { sq: by('squirrel'), wp: by('woodpecker'), wf: by('female woodpecker'), dr: by('deer'), bk: by('buck'), qu: by('quail'),
      sj: by('scrub-jay'), st: by("Steller's jay"), fx: by('gray fox'), rb: by('brush rabbit'), jr: by('jackrabbit') };
    this._idxOf = A; return this._idxV;
  }
  _m(o) { let m = this.mem.get(o); if (!m) this.mem.set(o, m = { s: -1, cd: 0, in: false, bark: 0, k: 0 }); return m; }
  _due(k, t) { return t >= (this.gap[k] || 0); }
  // 4x a second: what the animals near the player are doing, and which of them call. dt: since the last tick.
  _nearTick(dt, elevDeg) {
    const A = this._animals(); if (!A?.bySpecies) return;
    const I = this._idx(A), P = this.flight.pos, C = this.camera.position, t = this.t;
    const day = elevDeg > -4, night = elevDeg < -6;
    const dl = a => Math.hypot(a.x - C.x, a.y - C.y, a.z - C.z), dp = a => Math.hypot(a.x - P.x, a.y - P.y, a.z - P.z);
    const each = (k, fn) => { if (k >= 0 && A.meshes[k].visible) { const arr = A.bySpecies[k]; for (let i = 0; i < arr.length; i++) fn(arr[i]); } };
    const ear = (a, key) => dl(a) < NEAR[key].range;

    // acorn woodpeckers: the rally when one lands (mostly on its granary) and now and then on it; the hammering
    const wood = a => {
      const m = this._m(a), prev = m.s, fam = this._m(a.anchor || a); m.s = a.state;
      if (!(elevDeg > -6)) return;
      if (ear(a, 'waka') && t >= fam.cd && this._due('waka', t)) {
        const home = a.tree === a.anchor && a.state !== W_FLY;
        const landed = prev === W_FLY && (a.state === W_CLING || a.state === W_TOP);
        if ((landed && Math.random() < (home ? 0.35 : 0.1)) || (home && Math.random() < dt / 400)) {
          this.pending.push({ at: t + rand(0.15, 0.6), key: 'waka', animal: a });
          fam.cd = t + rand(20, 45); this.gap.waka = t + rand(15, 30);
          if (Math.random() < 0.4) {   // a family member joins in
            const mates = A.bySpecies[a.sp].filter(b => b !== a && b.anchor === a.anchor && b.state !== W_FLY);
            if (mates.length) this.pending.push({ at: t + rand(0.7, 1.4), key: 'waka', animal: mates[Math.floor(Math.random() * mates.length)] });
          }
        }
      }
      if (a.state === W_CLING && a.flickV > 0.5 && ear(a, 'knock') && t >= m.k && this._due('knock', t)) {
        const store = a.task === T_STORE && a.carry && a.tree === a.anchor;
        const n = store ? 5 + Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 3), period = 2 * Math.PI / PECK_W;
        // in step with the pecks: the next peak of sin(A.time * 38)
        const ph = A.time * PECK_W - Math.PI / 2, delay = (Math.ceil(ph / (2 * Math.PI)) * 2 * Math.PI - ph) / PECK_W;
        if (this._play('knock', this._onAnimal(a), a, 'near', (v, t0) => this._knocks(v, t0, n, period, store ? 1 : 0.6), delay)) {
          m.k = t + delay + n * period + (store ? rand(0.3, 0.8) : rand(3, 7)); this.gap.knock = t + (store ? 0.4 : rand(3, 6));
        }
      }
    };
    each(I.wp, wood); each(I.wf, wood);

    // gray squirrels: the alarm when the player comes within 15 m (barked from where it stops), and a chatter
    each(I.sq, a => {
      const m = this._m(a), d = dp(a);
      if (d < 0.5) return;   // the player's own squirrel, were it one of them
      const inside = m.in ? d < 20 : d < 15;
      if (inside && !m.in && t >= m.cd && day && ear(a, 'bark')) {
        const p = window.__we?.playerSpecies === 'sciurus_griseus' ? 0.35 : 0.85;   // at a fellow squirrel, less often
        if (Math.random() < p) m.bark = t + rand(0.8, 2);
        m.cd = t + rand(45, 90);
      }
      m.in = inside;
      if (m.bark && t >= m.bark) {
        const settled = a.state === S_SIT || a.state === S_PAUSE || a.state === S_OUT || a.state === S_EAT;
        if (d > 40) m.bark = 0;
        else if ((settled || t > m.bark + 6) && this._due('bark', t)) { m.bark = 0; this._squirrelAlarm(a); }
      }
      if (day && (a.state === S_SIT || a.state === S_PAUSE || a.state === S_EAT || a.state === S_WORK) && ear(a, 'chatter') && this._due('chatter', t) && Math.random() < dt / 60) {
        if (this._play('chatter', this._onAnimal(a), a, 'near')) this.gap.chatter = t + rand(20, 45);
      }
    });

    // jays: a group scolds the player within 20 m (perched or on the ground), now and then
    const jay = key => a => {
      const g = this._m(a.group || a);
      if (!day || a.state === J_FLY || t < g.cd || dp(a) > 20 || !ear(a, key)) return;
      g.cd = t + rand(30, 60);
      if (Math.random() < 0.6) this.pending.push({ at: t + rand(0.2, 1.2), key, animal: a });
    };
    each(I.st, jay('shaaar')); each(I.sj, jay('shreep'));

    // quail: soft clucks while a covey forages or runs near the player
    if (I.qu >= 0 && A.meshes[I.qu].visible && A.coveys && elevDeg > -6) for (const g of A.coveys) {
      const L = g.leader; if (!L || (g.state !== G_FORAGE && g.state !== G_RUN)) continue;
      const m = this._m(g);
      if (t < m.cd || Math.hypot(L.x - P.x, L.z - P.z) > 30 || !ear(L, 'cluck')) continue;   // across the ground: a raven above hears them too
      const run = g.state === G_RUN;
      m.cd = t + (run ? rand(3, 7) : rand(7, 16));
      const birds = A.bySpecies[I.qu].filter(b => b.group === g), b = birds[Math.floor(Math.random() * birds.length)] || L;
      this._play('cluck', this._onAnimal(b), b, 'near', (v, t0) => this._clucks(v, t0, run));
    }

    // deer: a snort-wheeze when the player comes within 30 m of an active herd (low over it): once as it comes in,
    // not again until it has been 45 m off and the herd's cooldown has passed
    const herds = new Map();   // herd -> its active member nearest the player
    const deer = a => { if (a.state === D_BED) return; const g = a.group || a, d = dp(a), h = herds.get(g); if (!h || d < h.d) herds.set(g, { a, d }); };
    each(I.dr, deer); each(I.bk, deer);
    for (const [g, { a, d }] of herds) {
      const m = this._m(g);
      if (m.in && d > 45) m.in = false;
      if (m.in || d > 30 || P.y - a.y > 30 || t < m.cd || !ear(a, 'snort')) continue;
      m.in = true; m.cd = t + rand(60, 120);
      if (Math.random() < 0.8) this.pending.push({ at: t + rand(0.1, 0.5), key: 'snort', animal: a });
    }

    // gray fox: a single bark at night, rare; sometimes when it runs from the player
    each(I.fx, a => {
      const m = this._m(a), prev = m.s; m.s = a.state;
      if (!night || a.state === M_BED || !ear(a, 'foxbark') || !this._due('foxbark', t)) return;
      const fled = a.state === M_FLEE && prev !== M_FLEE && prev !== -1;
      if ((fled && Math.random() < 0.3) || Math.random() < dt / 150) {
        if (this._play('foxbark', this._onAnimal(a), a, 'near')) this.gap.foxbark = t + rand(90, 240);
      }
    });

    // brush rabbit: a thump now and then as it freezes or bolts
    each(I.rb, a => {
      const m = this._m(a), prev = m.s; m.s = a.state;
      const alarm = (a.state === B_FREEZE || a.state === B_BOLT) && prev !== B_FREEZE && prev !== B_BOLT && prev !== -1;
      if (alarm && ear(a, 'thump') && this._due('thump', t) && Math.random() < 0.35) {
        if (this._play('thump', { x: a.x, y: a.y + 0.05, z: a.z }, null, 'near')) this.gap.thump = t + 20;
      }
    });
    // jackrabbit: the same, a little heavier
    each(I.jr, a => {
      const m = this._m(a), prev = m.s; m.s = a.state;
      const alarm = (a.state === JK_FREEZE || a.state === JK_BOLT) && prev !== JK_FREEZE && prev !== JK_BOLT && prev !== -1;
      if (alarm && ear(a, 'jthump') && this._due('jthump', t) && Math.random() < 0.3) {
        if (this._play('jthump', { x: a.x, y: a.y + 0.05, z: a.z }, null, 'near')) this.gap.jthump = t + 20;
      }
    });
  }
  // A squirrel's barking alarm from where it is, its tail flicking on each chuff (animals.js flickV, the same
  // flick it gives a squirrel at rest).
  _squirrelAlarm(a, source = 'near') {
    const v = this._play('bark', this._onAnimal(a), a, source);
    if (!v) return;
    this.gap.bark = this.t + 6;
    for (const b of v.beats || []) this.flicks.push({ at: this.t + 0.03 + b, a });
  }
  // Every frame: pending calls whose time has come (dropped if the animal has gone or is out of earshot), and the
  // tail flicks of a barking squirrel.
  _pendingTick() {
    const t = this.t, A = this._animals();
    if (this.pending.length) {
      const keep = [];
      for (const p of this.pending) {
        if (t < p.at) { keep.push(p); continue; }
        let a = p.animal;
        if (p.covey) a = p.covey.leader || a;   // where the covey is now
        if (!a || (A?.alive && !A.alive(a))) continue;
        if (this._listenerDist(a.x, a.y, a.z) > NEAR[p.key].range) continue;
        if (p.key === 'bark') this._squirrelAlarm(a, p.source);
        else this._play(p.key, this._onAnimal(a), a, p.source || 'near');
      }
      this.pending = keep.length > 16 ? keep.slice(-16) : keep;
    }
    if (this.flicks.length) this.flicks = this.flicks.filter(f => { if (t < f.at) return true; f.a.flickV = 1; return false; });
  }

  // ---- per frame -----------------------------------------------------------------------------------------
  // env: { season, hour, sunElevation (radians) }. Call after the render so camera.matrixWorld is current.
  update(dt, { season = 'spring', hour = 12, sunElevation = 0.5 } = {}) {
    this._hook();
    const ctx = this.ctx; if (!ctx) return;
    this.t += dt;
    // retire finished voices whatever the state, so nothing accumulates
    if (this.voices.length) {
      const now = ctx.currentTime;
      this.voices = this.voices.filter(v => {
        if (now < v.end + 0.25) return true;
        for (const n of v.nodes) n.disconnect();
        this.disconnected += v.nodes.length; return false;
      });
    }
    for (const k in this.heard) { this.heard[k] *= Math.exp(-dt / 6); if (this.heard[k] < 0.02) delete this.heard[k]; }
    if (ctx.state !== 'running' || this.muted) return;

    const f = this.flight, cam = this.camera, now = ctx.currentTime;
    // calls on animals: the panner follows the bird while it calls
    for (const v of this.voices) {
      const a = v.follow; if (!a || !v.pan || now > v.end) continue;
      const P = v.pan; P.positionX.setTargetAtTime(a.x, now, 0.04); P.positionY.setTargetAtTime(a.y + 0.3, now, 0.04); P.positionZ.setTargetAtTime(a.z, now, 0.04);
    }
    // listener = the camera
    const Lr = ctx.listener, e = cam.matrixWorld.elements, cp = cam.position;
    if (Lr.positionX) {
      Lr.positionX.value = cp.x; Lr.positionY.value = cp.y; Lr.positionZ.value = cp.z;
      Lr.forwardX.value = -e[8]; Lr.forwardY.value = -e[9]; Lr.forwardZ.value = -e[10];
      Lr.upX.value = e[4]; Lr.upY.value = e[5]; Lr.upZ.value = e[6];
    } else { Lr.setPosition(cp.x, cp.y, cp.z); Lr.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); }

    const ground = this.tile.heights.atXZ(f.pos.x, f.pos.z), agl = Math.max(0, f.pos.y - ground), spd = Math.abs(f.speed);
    const elevDeg = this.elevDeg = sunElevation * 180 / Math.PI;

    // habitat around the bird, twice a second: centre + 8 at 60 m + 8 at 160 m
    if ((this.habT += dt) > 0.5) {
      this.habT = 0; const fr = this.habFrac.fill(0); let n = 0;
      const add = (x, z, w) => { fr[this.tile.habitat.at(x, -z)] += w; n += w; };
      add(f.pos.x, f.pos.z, 2);
      for (const [r, w] of [[60, 1], [160, 0.6]]) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; add(f.pos.x + Math.cos(a) * r, f.pos.z + Math.sin(a) * r, w); }
      for (let i = 0; i < fr.length; i++) fr[i] /= n;
      this.grassFrac = fr[5] + 0.5 * fr[4] + 0.4 * fr[1];
      this.pineTarget = clamp((fr[2] + 0.7 * fr[3]) * 1.3) * (1 - smooth(60, 300, agl));
    }
    this.pine += ((this.pineTarget || 0) - this.pine) * (1 - Math.exp(-dt / 2));

    // gusts: a slow LFO pair plus a mean-reverting random walk
    this.gustWalk = clamp(this.gustWalk * Math.exp(-dt * 0.15) + (Math.random() - 0.5) * dt * 0.9, -0.5, 0.5);
    const lfo = Math.sin(this.t * 2 * Math.PI / 23) * Math.sin(this.t * 2 * Math.PI / 9.7 + 1);
    this.gust = clamp(0.6 + 0.3 * lfo + this.gustWalk, 0.15, 1.3);

    // wind and water parameters at 20 Hz
    if ((this.paramT += dt) > 0.05) {
      this.paramT = 0;
      const tc = 0.12, g = this.gust, pine = this.pine;
      const v = clamp(spd / 28, 0, 1.45), low = Math.exp(-agl / 45), high = smooth(80, 400, agl), ambient = 0.35 + 0.65 * high;
      const rumble = (0.04 * ambient * g + 0.3 * v ** 1.3 * (0.55 + 0.45 * low) * (0.8 + 0.2 * g)) * (1 - 0.35 * pine);
      const cut = (180 + 900 * v + 900 * v * low + 250 * g) * (1 - 0.4 * pine);
      const hiss = 0.006 + 0.035 * high * g + 0.2 * v * v * (0.6 + 0.4 * low) + 0.03 * pine * g;   // airflow roar: broadband when fast
      this.rumbleGain.gain.setTargetAtTime(rumble, now, tc); this.rumbleLP.frequency.setTargetAtTime(cut, now, tc);
      this.hissGain.gain.setTargetAtTime(hiss, now, tc); this.hissHP.frequency.setTargetAtTime(3800 - 2600 * clamp(v), now, tc);
      this.soughGain.gain.setTargetAtTime(pine * 0.22 * g * g, now, 0.3); this.soughBP.frequency.setTargetAtTime(650 + 300 * g, now, 0.3);
      this.windLevel = rumble + hiss;
      // width from the bank, balance toward the lowered wing (roll > 0 dips the left)
      const roll = f.roll || 0, w = clamp(0.35 + 0.5 * Math.min(1, Math.abs(roll) / 0.6) + 0.15 * v), bal = clamp(roll * 0.6, -0.35, 0.35);
      const dir = (1 + w) / 2, crs = (1 - w) / 2;
      this.wLL.gain.setTargetAtTime(dir * (1 + bal), now, tc); this.wRL.gain.setTargetAtTime(crs * (1 + bal), now, tc);
      this.wRR.gain.setTargetAtTime(dir * (1 - bal), now, tc); this.wLR.gain.setTargetAtTime(crs * (1 - bal), now, tc);

      // crickets: summer/fall, dusk into night, over grass, near the ground; very quiet
      const dusk = hour > 12 ? smooth(8, -2, elevDeg) : 0.5 * smooth(-2, -8, elevDeg);
      const crick = (SEASON_CRICKETS[season] ?? 0) * dusk * clamp(this.grassFrac * 1.3) / (1 + agl / 40);
      this.cricketGain.gain.setTargetAtTime(crick * 0.12, now, 0.5); this.cricketLevel = crick;
    }

    // stream: nearest flowline point 4x a second; the panner's linear distance model does the fade
    if ((this.waterT += dt) > 0.25) {
      this.waterT = 0;
      const s = this.nearestStream(f.pos.x, -f.pos.z), seasonW = SEASON_STREAM[season] ?? 1;
      if (s && s.d < 150) {
        const y = this.tile.heights.at(s.x, s.n) + 0.5, P = this.waterPan;
        const jump = !this.water || Math.hypot(this.water.x - s.x, this.water.n - s.n) > 40;
        for (const [p, val] of [[P.positionX, s.x], [P.positionY, y], [P.positionZ, -s.n]]) jump ? p.setValueAtTime(val, now) : p.setTargetAtTime(val, now, 0.2);
        this.water = s;
        const prox = clamp(1 - (Math.hypot(s.d, cp.y - y) - 5) / 70);
        this.waterBus.gain.setTargetAtTime(seasonW * prox, now, 0.3); this.washGain.gain.setTargetAtTime(1.0, now, 0.3);
        this.waterLevel = seasonW * prox * prox;
      } else {
        if (this.water) { this.washGain.gain.setTargetAtTime(0, now, 0.3); this.gurgleGain.gain.setTargetAtTime(0, now, 0.1); }
        this.water = null; this.waterLevel = 0;
      }
    }
    if (this.water && (this.gurgleT += dt) > 0.08) {
      this.gurgleT = 0;
      this.gurgleBP.frequency.setTargetAtTime(rand(450, 1600), now, 0.03);
      this.gurgleGain.gain.setTargetAtTime(Math.random() < 0.5 ? rand(0.6, 2.2) : 0.15, now, 0.025);
    }

    // wingbeats: the downstroke of the fly clip (fast stroke from ~1.15 s through the loop to ~0.2 s)
    const STROKE = 1.15, pm = rand(0.92, 1.08);
    const hover = f.hover || spd < 4, strength = 0.22 * (hover ? 1.25 : 1) * (0.8 + 0.2 * Math.min(1, spd / 20));
    if (f.flap > this.flapPrev + 0.4) {   // space: a hard flap, three quick beats
      for (let i = 0; i < 3; i++) this._whoosh(now + 0.01 + i * rand(0.24, 0.3), strength * 1.5 * (1 - i * 0.2), pm * (1 + i * 0.04));
      this.hardUntil = this.t + 0.9;
    }
    this.flapPrev = f.flap;
    const fly = this.raven?.mixer && this.raven.fly;
    if (fly) {
      const dur = fly.getClip().duration, tm = fly.time % dur, w = fly.getEffectiveWeight();
      if (this.clipPrev !== null && w > 0.4 && this.raven.flapping) {
        const crossed = tm >= this.clipPrev ? (this.clipPrev < STROKE && tm >= STROKE) : (this.clipPrev < STROKE || tm >= STROKE);
        if (crossed && this.t > this.hardUntil) this._whoosh(now + 0.01, strength * w, pm);
      }
      this.clipPrev = tm;
    } else if (f.flapping) {   // model not loaded yet: the clip's own period
      if ((this.phase += dt / 1.4) >= 1) { this.phase -= 1; if (this.t > this.hardUntil) this._whoosh(now + 0.01, strength, pm); }
    }

    // ambient birds: chorus at sunrise and sunset, a floor by day, almost nothing at night
    const day = smooth(-8, 3, elevDeg), noon = smooth(30, 55, elevDeg);
    const chorus = Math.exp(-(((elevDeg - 7) / 10) ** 2)) * (hour > 12 ? 0.85 : 1);
    const act = { day, noon, chorus, season: SEASON_BIRDS[season] ?? 0.6 };
    if (this.voices.length < MAX_VOICES && Math.random() < dt * 1.0) this._attempt(act);
    // the animals close by (near layer) and the calls waiting their turn
    if ((this.nearT += dt) > 0.25) { this._nearTick(this.nearT, elevDeg); this.nearT = 0; }
    this._pendingTick();
    // a distant raven every 20-60 s, and the answer to the player's call
    if (this.t > this.nextRaven) { this.nextRaven = this.t + rand(20, 60); this.callOn('raven', 450) || this.callAt('raven', rand(150, 450)); }
    if (this.replies.length && this.t > this.replies[0].t) {
      const r = this.replies.shift(), A = this._animals();
      if (r.animal && (!A?.alive || A.alive(r.animal))) this._play('raven', this._onAnimal(r.animal), r.animal, 'answer');
      else this.callAt('raven', rand(120, 350), undefined, 'answer');
      this.replies.sort((a, b) => a.t - b.t);
    }
  }

  // HUD: the loudest recent birds plus water, insects, pines; cheap.
  describe() {
    if (!this.ctx) return this.muted ? 'off' : 'click to start';
    if (this.muted) return 'muted';
    if (this.ctx.state !== 'running') return 'starting…';
    const parts = Object.entries(this.heard).filter(([, s]) => s > 0.15).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
    if (this.waterLevel > 0.08) parts.push('stream');
    if (this.cricketLevel > 0.1) parts.push('crickets');
    if (this.pine > 0.35) parts.push('wind in pines');
    if (!parts.length) parts.push('wind');
    return parts.join(' · ');
  }

  // Debugging: node counts (a steady `live` means no leak) and the RMS (dBFS) of master and each bus.
  stats() {
    return { created: this.created, disconnected: this.disconnected, live: this.created - this.disconnected,
      voices: this.voices.length, nearVoices: this.voices.filter(v => v.near).length, pending: this.pending.length,
      state: this.ctx?.state || 'not started', sources: { ...this.sources } };
  }
  // Debugging: the recent calls, where each was placed and, for calls on animals, how far the panner is
  // from the animal now (it stops following when the call ends) and how far the animal is from the raven.
  lastCalls(n = 8) {
    const p = this.flight.pos;
    return this.log.slice(-n).map(({ voice, animal, ...c }) => {
      const P = voice.pan, o = { ...c, playing: !!this.ctx && this.ctx.currentTime < voice.end };
      if (P) o.pan = [P.positionX.value, P.positionY.value, P.positionZ.value].map(v => +v.toFixed(1));
      if (animal) {
        o.animalToRaven = Math.round(Math.hypot(animal.x - p.x, animal.y - p.y, animal.z - p.z));
        if (P) o.panToAnimal = +Math.hypot(P.positionX.value - animal.x, P.positionY.value - animal.y - 0.3, P.positionZ.value - animal.z).toFixed(2);
      }
      return o;
    });
  }
  meter() {
    if (!this.ctx) return null;
    const buf = new Float32Array(2048), rms = a => {
      const b = buf.subarray(0, a.fftSize); a.getFloatTimeDomainData(b);
      let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i];
      return +(10 * Math.log10(s / b.length + 1e-12)).toFixed(1);
    };
    const out = { master: rms(this.analyser) };
    for (const k in this.taps) out[k] = rms(this.taps[k]);
    return out;
  }
}
