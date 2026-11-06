// The animals' stills for the species chips (nearBar.js, herdMarks.js): assets/opening/index.json, fetched once and
// shared. A species' still is, in order: its own (index `species`: the hand-run page's for the static cast,
// client/tools/opening_sprites.html; the pipeline's for a tile's modelled animals, pipeline/stills.py), its stand-in
// entry (index `stand_ins`, pipeline/stills.py: the kin's still, or its kin's body tinted), its kin's (animals.js
// standIn.kin: the body the player sees, for a slot the pipeline has not reached yet), else a neutral glyph (a track
// for an animal on the ground, a bird's outline for a bird), so a chip is never empty.
const STILLS = new URL('../assets/opening/', import.meta.url);

const svg = s => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40">${s}</svg>`)}`;
const INK = 'fill="#d9e3db" fill-opacity="0.82"';
export const GLYPH = {
  ground: svg(`<g ${INK}><ellipse cx="24" cy="27" rx="8.5" ry="7"/><ellipse cx="13.5" cy="17" rx="3.4" ry="4.4"/>`
    + `<ellipse cx="20" cy="11" rx="3.4" ry="4.6"/><ellipse cx="28" cy="11" rx="3.4" ry="4.6"/><ellipse cx="34.5" cy="17" rx="3.4" ry="4.4"/></g>`),
  bird: svg(`<path ${INK} d="M4 22c6-6 12-8 17-6 1-3 3-5 6-5 2 0 3 1 4 2l5 1-5 2c0 5-3 9-9 11-5 1-10 0-14-3l-6 6 1-6c0-1 0-1 1-2z"/>`),
};

let index = null, loading = null;
// The index (a promise; {} when it cannot be read): { species, stand_ins } merged, the own entries over the stand-ins
export function loadStills() {
  return loading ||= fetch(new URL('index.json', STILLS)).then(r => r.json())
    .then(j => (index = { ...(j.stand_ins || {}), ...(j.species || {}) }))
    .catch(() => (index = {}));
}
export const stillsReady = () => index !== null;

// An <img> showing the species' still; a file that does not load (a deploy without it) gives way to the glyph
export function setStill(img, sp) {
  const st = stillOf(sp);
  img.src = st.src; img.classList.toggle('glyph', st.glyph);
  if (!st.glyph) img.onerror = () => { img.onerror = null; img.src = sp?.bird ? GLYPH.bird : GLYPH.ground; img.classList.add('glyph'); };
}
// The still's URL for a species (animals.js speciesList() entry: code, standIn, bird), and whether it is a glyph
export function stillOf(sp) {
  const ix = index || {}, code = sp?.code || '';
  const st = ix[code] || ix[code.split(':')[0]] || (sp?.standIn?.kin ? ix[sp.standIn.kin] : null);
  if (st?.file) return { src: new URL(st.file, STILLS).href, glyph: false };
  return { src: sp?.bird ? GLYPH.bird : GLYPH.ground, glyph: true };
}
