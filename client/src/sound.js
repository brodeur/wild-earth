// Soundscape: the place heard from a raven's height, all synthesised with the Web Audio API (no samples).
//
// Layers, each on its own bus into one sum -> gentle compressor -> master volume -> speakers:
//   wind     looping brown noise (rumble) and white noise (hiss) through filters that follow airspeed and
//            height above ground, a slow gust LFO plus a random walk, stereo width and balance from the bank;
//            over conifer and mixed forest a "wind in pines" sough (band-passed noise) and more hiss.
//   wings    a band-passed noise whoosh on each downstroke of the raven's fly clip; a hard flap (space)
//            gives three quick beats. Gliding is silent.
//   voice    a procedural raven "kraa" (sawtooth with FM rasp, noise, two formants, pitch falling): C calls,
//            and a distant raven calls every 20-60 s and sometimes answers yours.
//   birds    short synthesised calls placed 50-300 m around the raven with HRTF panners, the species drawn
//            from the habitat class sampled where the call is placed, the rate from sun height (dawn and
//            dusk chorus, quiet at noon and night) and season (spring loudest).
//   water    a stream wash plus gurgle, on a panner kept at the nearest point of the nearest flowline, so it
//            fades in within ~80 m and comes from the right side; quieter in summer and fall.
//   insects  a pre-rendered loop of field-cricket chirps at dusk in summer and fall over grassland.
//
// Audio can only start after a user gesture, so the graph is built on the first pointerdown or keydown.
// N mutes (the context is suspended while muted or while the tab is hidden), C calls; the volume and mute
// state persist in localStorage. Short-lived voices are disconnected by the frame loop once they end, and
// created/disconnected node counts are kept so a leak shows up in stats().

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
const STORE = 'wildearth.sound';
const MAX_VOICES = 14;

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
  // Not in this tile's species.json; kept because the soundscape asks for a conifer voice. `extra` lets it
  // play in any tile that has conifer or mixed forest.
  { key: 'steller', code: 'cyanocitta_stelleri', label: "Steller's jay", hab: { 2: 1, 3: 0.7, 6: 0.2 }, rate: 0.2, gain: 0.75,
    tod: (c, d) => c * 0.9 + d * 0.35, height: [5, 20], synth: 'steller', extra: true },
];

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
  constructor({ tile, flight, raven, camera, els = {} }) {
    Object.assign(this, { tile, flight, raven, camera, els });
    const prefs = loadPrefs();
    this.volume = clamp(prefs.volume ?? 0.5); this.muted = !!prefs.muted;
    this.ctx = null; this.voices = []; this.created = 0; this.disconnected = 0;
    this.heard = {}; this.t = 0; this.paramT = 0; this.habT = 1; this.waterT = 1; this.gurgleT = 0;
    this.gustWalk = 0; this.gust = 0.6; this.pine = 0; this.grassFrac = 0; this.habFrac = new Float32Array(10);
    this.waterLevel = 0; this.cricketLevel = 0; this.windLevel = 0; this.water = null;
    this.nextRaven = rand(20, 60); this.reply = null;
    this.clipPrev = null; this.flapPrev = 0; this.hardUntil = 0; this.phase = 0;
    const codes = new Set((tile.species || []).map(s => s.code));
    this.callers = CALLERS.filter(c => !codes.size || codes.has(c.code) || c.extra);
    this.nearestStream = streamIndex(tile.features?.streams);

    const arm = () => { removeEventListener('pointerdown', arm, true); removeEventListener('keydown', arm, true); this.start(); };
    addEventListener('pointerdown', arm, true); addEventListener('keydown', arm, true);
    addEventListener('keydown', e => {
      if (e.repeat || typing(e)) return;
      if (e.code === 'KeyN') this.setMuted(!this.muted);
      if (e.code === 'KeyC') this.call();
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
  _voice(pos, gain, bus) {
    const ctx = this.ctx, v = { nodes: [], end: ctx.currentTime };
    v.add = n => { this.created++; v.nodes.push(n); return n; };
    v.gain = g => v.add(new GainNode(ctx, { gain: g }));
    v.filter = (type, frequency, Q = 0.7) => v.add(new BiquadFilterNode(ctx, { type, frequency, Q }));
    v.osc = (type, frequency, t0, t1) => { const o = v.add(new OscillatorNode(ctx, { type, frequency })); o.start(t0); o.stop(t1); v.end = Math.max(v.end, t1); return o; };
    v.noise = (t0, t1) => { const s = v.add(new AudioBufferSourceNode(ctx, { buffer: this.white, loop: true })); s.start(t0, Math.random() * 5); s.stop(t1); v.end = Math.max(v.end, t1); return s; };
    v.input = v.gain(gain);
    if (pos) {
      const c = this.camera.position, d = Math.hypot(pos.x - c.x, pos.y - c.y, pos.z - c.z);
      const air = v.filter('lowpass', clamp(18000 * Math.exp(-d / 300), 2500, 18000), 0.5);   // air absorbs the highs
      const pan = v.add(new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 25, maxDistance: 5000, rolloffFactor: 1,
        positionX: pos.x, positionY: pos.y, positionZ: pos.z }));
      v.input.connect(air).connect(pan).connect(bus);
      v.dist = d;
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

  // Acorn woodpecker "waka-waka": nasal sawtooth syllables (rising "wa", falling "ka") with a 38 Hz rasp.
  _woodpecker(v, t) {
    const pairs = 2 + (Math.random() < 0.6) + (Math.random() < 0.4), pm = rand(0.92, 1.08), end = t + pairs * 0.3;
    const o = v.osc('sawtooth', 600, t, end), bp = v.filter('bandpass', 1500 * pm, 1.3);
    const am = v.osc('square', 38, t, end), amd = v.gain(0.35), rasp = v.gain(0.65), g = v.gain(0);
    am.connect(amd).connect(rasp.gain);
    o.connect(bp).connect(rasp).connect(g).connect(v.input);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < pairs; i++) {
      const s = t + i * 0.3, F = o.frequency;
      F.setValueAtTime(520 * pm, s); F.linearRampToValueAtTime(760 * pm, s + 0.07);
      F.setValueAtTime(780 * pm, s + 0.11); F.linearRampToValueAtTime(560 * pm, s + 0.19);
      env(g.gain, s, [[0, 0], [0.012, 1], [0.07, 0.8], [0.085, 0], [0.11, 0], [0.122, 0.9], [0.18, 0.6], [0.2, 0]]);
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

  // Steller's jay: harsh "shook shook shook", lower and shorter than the scrub-jay, three to five times.
  _steller(v, t) {
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

  // ---- public actions ------------------------------------------------------------------------------------
  // The player's raven calls (C); now and then a distant raven answers.
  call() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + 0.02;
    this._kraa(this._voice(null, 0.5, this.voiceBus), t, 1 + (Math.random() < 0.35), 1);
    if (Math.random() < 0.4) this.reply = this.t + rand(1.2, 3.5);
  }

  // A call placed `dist` metres away in a random direction: a species key from CALLERS, or 'raven'.
  callAt(key, dist, height) {
    if (!this.ctx || this.voices.length >= MAX_VOICES) return null;
    const p = this.flight.pos, a = Math.random() * Math.PI * 2, size = this.tile.size;
    const x = clamp(p.x + Math.cos(a) * dist, 0, size), z = clamp(p.z + Math.sin(a) * dist, -size, 0);
    const ground = this.tile.heights.atXZ(x, z), t = this.ctx.currentTime + 0.03;
    if (key === 'raven') {
      const v = this._voice({ x, y: ground + (height ?? rand(15, 80)), z }, 0.7, this.birdBus);
      this._kraa(v, t, 1 + Math.floor(Math.random() * 3), rand(0.9, 1.12));
      this._heard('raven', v.dist); return v;
    }
    const c = CALLERS.find(c => c.key === key); if (!c) return null;
    const v = this._voice({ x, y: ground + (height ?? rand(...c.height)), z }, c.gain, this.birdBus);
    this['_' + c.synth](v, t);
    this._heard(c.label, v.dist); return v;
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
    const c = this.callers[i], ground = this.tile.heights.atXZ(x, z), t = this.ctx.currentTime + 0.03;
    const v = this._voice({ x, y: ground + rand(...c.height), z }, c.gain, this.birdBus);
    this['_' + c.synth](v, t);
    this._heard(c.label, v.dist);
  }

  // ---- per frame -----------------------------------------------------------------------------------------
  // env: { season, hour, sunElevation (radians) }. Call after the render so camera.matrixWorld is current.
  update(dt, { season = 'spring', hour = 12, sunElevation = 0.5 } = {}) {
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
    // listener = the camera
    const Lr = ctx.listener, e = cam.matrixWorld.elements, cp = cam.position;
    if (Lr.positionX) {
      Lr.positionX.value = cp.x; Lr.positionY.value = cp.y; Lr.positionZ.value = cp.z;
      Lr.forwardX.value = -e[8]; Lr.forwardY.value = -e[9]; Lr.forwardZ.value = -e[10];
      Lr.upX.value = e[4]; Lr.upY.value = e[5]; Lr.upZ.value = e[6];
    } else { Lr.setPosition(cp.x, cp.y, cp.z); Lr.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); }

    const ground = this.tile.heights.atXZ(f.pos.x, f.pos.z), agl = Math.max(0, f.pos.y - ground), spd = Math.abs(f.speed);
    const elevDeg = sunElevation * 180 / Math.PI;

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
    // a distant raven every 20-60 s, and the answer to the player's call
    if (this.t > this.nextRaven) { this.nextRaven = this.t + rand(20, 60); this.callAt('raven', rand(150, 450)); }
    if (this.reply !== null && this.t > this.reply) { this.reply = null; this.callAt('raven', rand(120, 350)); }
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
      voices: this.voices.length, state: this.ctx?.state || 'not started' };
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
