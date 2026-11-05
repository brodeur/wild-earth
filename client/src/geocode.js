// Finding any place on earth from the home screen's search box (title.js): Photon, komoot's OpenStreetMap geocoder,
// asked straight from the page (never through our server, and with nothing of the player's but the words typed).
// Photon is built for search as you type; its fair-use terms ask for no heavy use, so the box asks only after the
// typing has paused (WAIT_MS), with three characters or more, one question at a time (a newer one cancels the older),
// and keeps the last few answers so a backspace asks nothing. The browser sends the page's origin as the Referer.
// Results are { name, context, lat, lon, kind, extent: [w, s, e, n] | null }. Data © OpenStreetMap contributors (ODbL).

const URL_BASE = 'https://photon.komoot.io/api/';
export const WAIT_MS = 450, MIN_CHARS = 3, LIMIT = 7;
const seen = new Map();   // query -> results (this page only, a few dozen)

function shape(f) {
  const p = f.properties || {}, [lon, lat] = f.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const context = [p.city !== p.name ? p.city : null, p.county, p.state, p.country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  const e = p.extent;   // [w, n, e, s] in Photon
  return { name: p.name || p.street || context, context, lat, lon, kind: p.osm_value || p.type || '', type: p.type || '',
    extent: Array.isArray(e) && e.length === 4 ? [Math.min(e[0], e[2]), Math.min(e[1], e[3]), Math.max(e[0], e[2]), Math.max(e[1], e[3])] : null };
}

export class Geocoder {
  constructor() { this.ctl = null; this.timer = null; }
  // Ask for `q` after the pause (now: at once, the Enter key); fn(results | null on an error) unless a newer ask came.
  ask(q, fn, now = false) {
    clearTimeout(this.timer); this.ctl?.abort(); this.ctl = null;
    q = q.trim();
    if (q.length < MIN_CHARS) return;
    if (seen.has(q)) { fn(seen.get(q)); return; }
    this.timer = setTimeout(async () => {
      const ctl = this.ctl = new AbortController();
      try {
        const r = await fetch(`${URL_BASE}?q=${encodeURIComponent(q)}&limit=${LIMIT}&lang=en`, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
        if (!r.ok) throw new Error(`search ${r.status}`);
        const out = ((await r.json()).features || []).map(shape).filter(Boolean);
        seen.set(q, out); if (seen.size > 40) seen.delete(seen.keys().next().value);
        if (this.ctl === ctl) fn(out);
      } catch (e) { if (e.name !== 'AbortError' && this.ctl === ctl) fn(null); }
    }, now ? 0 : WAIT_MS);
  }
  cancel() { clearTimeout(this.timer); this.ctl?.abort(); this.ctl = null; }
}
