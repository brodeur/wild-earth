// Seasons track the real calendar at the tile; the sun follows latitude, day of year and hour.
export const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const MIDPOINT_DOY = { winter: 15, spring: 105, summer: 196, fall: 288 };

export function seasonOfDate(d = new Date()) {
  const m = d.getMonth() + 1;
  return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'fall';
}

// Foothill (Mediterranean) palette per season: grass, deciduous oak canopy, deciduous leaf-on fraction,
// and haze (aerial perspective and sky turbidity): rain-washed winter clearest, summer dust and smoke thickest.
// riparian: the creek-corridor floor under willow, alder and cottonwood (habitat 6). `tint` is the hue
// (sRGB) the texture's own riparian mean is pulled to, `dark` its brightness (damp soil reads darker),
// `mix` the strength; summer is the photo's own deep green, so 0. Fall: yellow leaf litter over dark
// damp soil; winter: bare grey-brown twigs over dark wet ground; spring: bright yellow-green flush.
export const SEASON_LOOK = {
  winter: { grass: [0.55, 0.68, 0.40], oakLeaf: [0.45, 0.40, 0.25], oakLeafOn: 0.0, haze: 0.55,
            riparian: { tint: [0.40, 0.38, 0.32], dark: 0.75, mix: 0.8 } },
  spring: { grass: [0.52, 0.72, 0.32], oakLeaf: [0.40, 0.55, 0.25], oakLeafOn: 1.0, haze: 0.7,
            riparian: { tint: [0.54, 0.60, 0.28], dark: 1.1, mix: 0.65 } },
  summer: { grass: [0.80, 0.68, 0.36], oakLeaf: [0.33, 0.45, 0.22], oakLeafOn: 1.0, haze: 1.2,
            riparian: { tint: [0.34, 0.38, 0.30], dark: 1.0, mix: 0.0 } },
  fall:   { grass: [0.76, 0.64, 0.38], oakLeaf: [0.55, 0.45, 0.22], oakLeafOn: 0.8, haze: 1.0,
            riparian: { tint: [0.48, 0.43, 0.28], dark: 0.85, mix: 0.75 } },
};

// Sun direction (unit vector, y up, -z north) for a latitude, season and local solar hour.
export function sunDirection(latDeg, season, hour) {
  const doy = MIDPOINT_DOY[season] ?? 180;
  const dec = -23.44 * Math.cos((2 * Math.PI / 365) * (doy + 10)) * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;
  const H = (hour - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz)));   // from north, clockwise; morning east
  if (H > 0) az = 2 * Math.PI - az;
  // x east, z south (so north is -z)
  const x = Math.cos(el) * Math.sin(az), z = -Math.cos(el) * Math.cos(az), y = Math.sin(el);
  return { dir: [x, y, z], elevation: el, azimuth: az };
}

// ---- measured colour by date (Sentinel-2 monthly medians; tile-spec "Seasonal colour") -----------------
// A season choice stands for its mid-month (the same days MIDPOINT_DOY uses for the sun).
export const SEASON_DATE = { winter: [1, 15], spring: [4, 15], summer: [7, 15], fall: [10, 15] };
export function dateForSeason(season, year = new Date().getFullYear()) {
  const md = SEASON_DATE[season]; return md ? new Date(year, md[0] - 1, md[1], 12) : new Date();
}
// "?date=MM-DD" or "YYYY-MM-DD" (tests, comparisons) -> Date at noon, else null.
export function parseDate(s) {
  const m = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(s || '');
  return m ? new Date(m[1] ? +m[1] : new Date().getFullYear(), +m[2] - 1, +m[3], 12) : null;
}
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = MONTH_DAYS.reduce((a, d, i) => (a.push(i ? a[i - 1] + MONTH_DAYS[i - 1] : 0), a), []);
const MONTH_MID = MONTH_START.map(s => s + 14.5);   // day of year (0-based, at the day's middle) of each month's 15th: a frame is its month's middle
// The two calendar months around a date and the weight of the second: the 15th to the 15th, linear by day.
export function monthBlend(d) {
  const doy = MONTH_START[d.getMonth()] + Math.min(d.getDate(), MONTH_DAYS[d.getMonth()]) - 0.5;   // the day's middle
  let i = 11; for (let k = 0; k < 12; k++) if (MONTH_MID[k] <= doy) i = k;
  if (doy < MONTH_MID[0]) i = 11;
  const j = (i + 1) % 12, a = MONTH_MID[i], b = j ? MONTH_MID[j] : MONTH_MID[0] + 365;
  const x = doy < a ? doy + 365 : doy;
  return { m1: i + 1, m2: j + 1, t: Math.min(Math.max((x - a) / (b - a), 0), 1) };
}

const LUMA = [0.2126, 0.7152, 0.0722];
const lin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const enc = v => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const LIN8 = Float32Array.from({ length: 256 }, (_, i) => lin(i / 255));
const CLASS_KEY = { 1: 'oak_woodland', 2: 'conifer_forest', 3: 'mixed_forest', 4: 'chaparral', 5: 'grassland', 6: 'riparian' };
// Forest-floor litter (sRGB) under closed canopy: ponderosa and mixed-conifer needle duff, oak leaf litter.
export const LITTER = { needle: [0.40, 0.31, 0.22], oak: [0.43, 0.37, 0.28] };
const BLUR_R = 2, PRIOR = 0.15, LOCAL_L = 0.12;

// Season multiplier for the ground texture, on the Sentinel frames' 20 m grid. Per month m, per 20 m
// pixel: the colour ratio month / July (the NAIP month) of the open ground (tree plus shrub cover under
// 35%, fully weighted under 10%) of the pixel's own habitat class around it (two box passes of 100 m, sigma ~40 m,
// shrunk toward the class's tile-wide open mean where little open ground is near), in linear light.
// Its hue is kept; its luminance is the class's, measured on flat ground: per month the log luminance
// ratio of every open pixel is regressed on the slope's northness (n_north sin slope from the 5 m DEM)
// and the slope term removed, so the low winter sun's dark north slopes do not darken them a second
// time under the client's own sun; what local brightness is left after that passes within +-12%.
// Under closed canopy (tree cover 50% -> 90%) the multiplier turns toward forest litter. Built on the
// CPU for the two months around a date (cached per month) and blended, never per frame.
export class SeasonColour {
  constructor(tile) {
    const L = tile.manifest.layers['client.season_rgb'];
    this.tile = tile; this.img = tile.seasonImage; this.layer = L;
    this.N = L.layout?.frame_pixels || 500; this.cols = L.layout?.columns || 4;
    this.ref = L.naip_reference?.month || 7;
    this.months = new Map(); this.prepared = false;
    this.flat = true;   // false (comparisons only; clear `months`): the frames' own luminance, slope shading and all
  }
  // Pixel grids at 20 m, once: class, tree cover, open weight, northness.
  prepare() {
    if (this.prepared) return; this.prepared = true;
    const t = this.tile, N = this.N, n = N * N, res = t.size / N;
    this.cls = new Uint8Array(n); this.cov = new Float32Array(n); this.wOpen = new Float32Array(n); this.ns = new Float32Array(n);
    const ch = t.canopyHeight, H = t.heights;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = (i + 0.5) * res, north = t.size - (j + 0.5) * res;
      let c = t.habitat.at(x, north);
      if (c === 0 || c === 9) c = 5;        // nodata and erased built ground: grassland
      this.cls[k] = c;
      let cv, sh;   // tree cover (CHM 4 m and up), shrub cover (0.5-4 m)
      if (ch && ch.img.width === 2 * N) {   // 10 m lidar cover, the 2 x 2 under the pixel
        const d = ch.img.data, W = ch.img.width, a = (2 * j * W + 2 * i) * 4 + 1, sum = o => d[a + o] + d[a + o + 4] + d[a + o + W * 4] + d[a + o + W * 4 + 4];
        cv = sum(0) / 400; sh = sum(1) / 400;
      } else if (ch) { cv = ch.at(x, north, 1) / 100; sh = ch.at(x, north, 2) / 100; }
      else { cv = t.canopy.at(x, north, 0) / 100; sh = t.canopy.at(x, north, 1) / 100; }
      this.cov[k] = Math.min(cv, 1);
      // open ground: little tree or shrub cover (shrubs and saplings under 4 m stay green in July and damp the ratio)
      this.wOpen[k] = c === 7 ? 0 : Math.min(Math.max((0.35 - cv - sh) / 0.25, 0), 1);
      const gx = (H.base(x + 10, north) - H.base(x - 10, north)) / 20, gn = (H.base(x, north + 10) - H.base(x, north - 10)) / 20;
      this.ns[k] = -gn / Math.hypot(gx, gn, 1);
    }
    this.classes = [...new Set(this.cls)].filter(c => c !== 7);
    this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = N;
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.ctx.imageSmoothingEnabled = false;
    this.refFrame = this.frame(this.ref);
    // the month-invariant half of the local blur: each pixel's own class's blurred open weight and July colour
    const f7 = this.refFrame, W = new Float32Array(n), A = [0, 1, 2].map(() => new Float32Array(n));
    this.Wb = new Float32Array(n); this.J7 = new Float32Array(n * 3);
    for (const c of this.classes) {
      W.fill(0); for (const a of A) a.fill(0);
      for (let k = 0; k < n; k++) { if (this.cls[k] !== c) continue; const w = this.wOpen[k]; if (!w) continue; W[k] = w; for (let q = 0; q < 3; q++) A[q][k] = w * f7[k * 3 + q]; }
      this.blur([W, ...A]);
      for (let k = 0; k < n; k++) if (this.cls[k] === c) { this.Wb[k] = W[k]; for (let q = 0; q < 3; q++) this.J7[k * 3 + q] = A[q][k]; }
    }
    this.scratch = [0, 1, 2, 3].map(() => new Float32Array(n));
  }
  // Month m's frame, linear reflectance-proportional RGB (Float32, 3 per pixel).
  frame(m) {
    const N = this.N, c = (m - 1) % this.cols, r = Math.floor((m - 1) / this.cols);
    this.ctx.clearRect(0, 0, N, N); this.ctx.drawImage(this.img, c * N, r * N, N, N, 0, 0, N, N);
    const d = this.ctx.getImageData(0, 0, N, N).data, f = new Float32Array(N * N * 3);
    for (let k = 0, n = N * N; k < n; k++) { f[k * 3] = LIN8[d[k * 4]]; f[k * 3 + 1] = LIN8[d[k * 4 + 1]]; f[k * 3 + 2] = LIN8[d[k * 4 + 2]]; }
    return f;
  }
  // Two passes of a (2R+1)^2 box, separable, edges clamped; in place over each array.
  blur(arrs, passes = 2, R = BLUR_R) {
    const N = this.N, tmp = new Float32Array(N), w = 2 * R + 1;
    for (const a of arrs) for (let p = 0; p < passes; p++) for (let axis = 0; axis < 2; axis++) {
      const step = axis ? N : 1, lineStep = axis ? 1 : N;
      for (let l = 0; l < N; l++) {
        const o = l * lineStep; let s = 0;
        for (let q = -R; q <= R; q++) s += a[o + Math.min(Math.max(q, 0), N - 1) * step];
        for (let q = 0; q < N; q++) {
          tmp[q] = s / w;
          s += a[o + Math.min(q + R + 1, N - 1) * step] - a[o + Math.max(q - R, 0) * step];
        }
        for (let q = 0; q < N; q++) a[o + q * step] = tmp[q];
      }
    }
  }
  // Month m: Float32 multiplier (3 per pixel) and the per-class flat-ground ratios.
  month(m) {
    let M = this.months.get(m);
    if (M) { this.months.delete(m); this.months.set(m, M); return M; }   // most recently used last
    this.prepare();
    const N = this.N, n = N * N, f = this.frame(m), f7 = this.refFrame, cls = this.cls, wO = this.wOpen, ns = this.ns;
    // log luminance ratio, and its northness slope over the open ground
    const lr = new Float32Array(n);
    let sx = 0, sy = 0, sxx = 0, sxy = 0, sw = 0;
    for (let k = 0; k < n; k++) {
      const L = f[k * 3] * LUMA[0] + f[k * 3 + 1] * LUMA[1] + f[k * 3 + 2] * LUMA[2];
      const L7 = f7[k * 3] * LUMA[0] + f7[k * 3 + 1] * LUMA[1] + f7[k * 3 + 2] * LUMA[2];
      lr[k] = Math.log(Math.max(L, 1e-4) / Math.max(L7, 1e-4));
      if (wO[k] >= 1 && cls[k] !== 7 && L > 1e-3 && L7 > 1e-3) { const x = ns[k], y = lr[k]; sx += x; sy += y; sxx += x * x; sxy += x * y; sw++; }
    }
    const slope = sw > 100 && this.flat ? (sxy - sx * sy / sw) / Math.max(sxx - sx * sx / sw, 1e-6) : 0;
    for (let k = 0; k < n; k++) lr[k] -= slope * ns[k];
    const out = new Float32Array(n * 3).fill(1), classes = {};
    // tile-wide open means per class (fallback: grassland's, then everything open)
    const stat = c => { const s = [0, 0, 0, 0, 0, 0, 0, 0]; for (let k = 0; k < n; k++) { if (c && cls[k] !== c) continue; const w = wO[k]; if (!w) continue;
      s[0] += w; for (let q = 0; q < 3; q++) { s[1 + q] += w * f[k * 3 + q]; s[4 + q] += w * f7[k * 3 + q]; } s[7] += w * lr[k]; } return s; };
    const all = stat(0), means = {};
    for (const c of this.classes) { const s = stat(c); means[c] = s[0] >= 100 ? s : null; }
    for (const c of this.classes) if (!means[c]) means[c] = means[5] || all;
    for (const c of this.classes) {
      const s = means[c], mf = [s[1] / s[0], s[2] / s[0], s[3] / s[0]], m7 = [s[4] / s[0], s[5] / s[0], s[6] / s[0]], a = s[7] / s[0];
      const r = mf.map((v, q) => v / Math.max(m7[q], 1e-5)), Lr = r[0] * LUMA[0] + r[1] * LUMA[1] + r[2] * LUMA[2], La = Math.exp(a);
      classes[c] = { ratio: r.map(v => v / Lr * La), hue: r.map(v => v / Lr), lum: La, srgb: mf.map(v => enc(v)) };
      // local, class-aware blur of the open ground (July's half from prepare)
      const [A0, A1, A2, LR] = this.scratch, A = [A0, A1, A2];
      for (const x of this.scratch) x.fill(0);
      for (let k = 0; k < n; k++) { if (cls[k] !== c) continue; const w = wO[k]; if (!w) continue;
        for (let q = 0; q < 3; q++) A[q][k] = w * f[k * 3 + q]; LR[k] = w * lr[k]; }
      this.blur(this.scratch);
      const Wb = this.Wb, J7 = this.J7;
      for (let k = 0; k < n; k++) {
        if (cls[k] !== c) continue;
        const w = Wb[k] + PRIOR, r = [0, 0, 0];
        for (let q = 0; q < 3; q++) r[q] = (A[q][k] + PRIOR * mf[q]) / Math.max(J7[k * 3 + q] + PRIOR * m7[q], 1e-5);
        const Lr2 = r[0] * LUMA[0] + r[1] * LUMA[1] + r[2] * LUMA[2];
        const lim = this.flat ? LOCAL_L : 9, loc = Math.min(Math.max((LR[k] + PRIOR * a) / w - a, -lim), lim), L = Math.exp(a + loc);
        for (let q = 0; q < 3; q++) out[k * 3 + q] = Math.min(Math.max(r[q] / Lr2, 0.5), 1.6) * L;
      }
    }
    M = { data: out, classes, slope };
    this.months.set(m, M);
    if (this.months.size > 4) this.months.delete(this.months.keys().next().value);   // 3 MB a month: keep the last four
    return M;
  }
  // The multiplier for a date: the two months blended, the litter under closed canopy, softened over
  // ~60 m (class edges), as RGBA8 holding sRGB_encode(multiplier / 2) (an sRGB texture: the GPU decodes
  // it, finer steps where the multiplier is small). litter: linear [needle, oak] multipliers or null.
  build(date, litter) {
    const { m1, m2, t } = monthBlend(date), A = this.month(m1), B = this.month(m2), N = this.N, n = N * N;
    const ch = [0, 1, 2].map(() => new Float32Array(n));
    for (let k = 0; k < n; k++) {
      const c = this.cls[k];
      let wl = 0;
      if (litter && c !== 7) { const x = Math.min(Math.max((this.cov[k] - 0.5) / 0.4, 0), 1); wl = x * x * (3 - 2 * x) * 0.9; }
      const needle = c === 2 ? 1 : c === 3 ? 0.5 : 0;
      for (let q = 0; q < 3; q++) {
        let v = A.data[k * 3 + q] * (1 - t) + B.data[k * 3 + q] * t;
        if (wl) v += (litter[0][q] * needle + litter[1][q] * (1 - needle) - v) * wl;
        ch[q][k] = v;
      }
    }
    this.blur(ch, 1, 1);
    const px = new Uint8Array(n * 4);
    for (let k = 0; k < n; k++) {
      for (let q = 0; q < 3; q++) px[k * 4 + q] = Math.round(255 * enc(Math.min(Math.max(ch[q][k] / 2, 0), 1)));
      px[k * 4 + 3] = 255;
    }
    // per-class flat-ground ratio for the date (blades, rewilded palette), blended the same way
    const classes = {};
    for (const c of this.classes) { const a = A.classes[c], b = B.classes[c]; if (a && b) classes[c] = a.ratio.map((v, q) => v * (1 - t) + b.ratio[q] * t); }
    return { pixels: px, size: N, classes, months: [m1, m2, t], slope: [A.slope, B.slope] };
  }
  // A manifest class's whole-class mean ratio for a date (linear, month / July): the rewilded palette.
  manifestRatio(date, key) {
    const { m1, m2, t } = monthBlend(date), ms = this.layer.months || [];
    const get = m => ms.find(e => e.month === m)?.classes?.[key]?.srgb;
    const a = get(m1), b = get(m2), r = get(this.ref);
    if (!a || !b || !r) return null;
    return [0, 1, 2].map(q => (lin(a[q]) * (1 - t) + lin(b[q]) * t) / Math.max(lin(r[q]), 1e-5));
  }
}
export { CLASS_KEY };
