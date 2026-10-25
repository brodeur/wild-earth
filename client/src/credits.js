// Data and credits panel: the "Data" link in the HUD opens it (docs/tile-spec.md, Sources and
// attribution: the required lines one step from the main view). Built from the tile manifest's
// `sources`: the lines marked attribution_required first, word for word, each linked to its
// attribution_url, its licence linked to license_url, with the date retrieved; then the other
// sources' lines. Then the GBIF datasets behind the animal density prior (client.species_prior, CC0
// and CC BY records only) and the client's own assets (README.md, Credits; assets/ground/ATTRIBUTION.md).
// All text goes in through textContent; only http(s) links are made.

const CC0 = ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'];
const CC_BY_SA = ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'];
const MESHY = 'generated with Meshy (meshy.ai) for Wild Earth';

// Models and textures the client loads (README.md, Credits). Keep in step with README.
export const ASSET_CREDITS = [
  { what: 'Common raven (fallback model)', line: '"Raven" by Teh_Bucket, OpenGameArt', url: 'https://opengameart.org', license: CC0 },
  { what: 'Player raven, ground raven', line: MESHY, url: 'https://www.meshy.ai', license: CC_BY_SA },
  { what: 'California scrub-jay, California quail, western gray squirrel', line: MESHY, url: 'https://www.meshy.ai', license: CC_BY_SA },
  { what: "Red-tailed hawk, turkey vulture, Steller's jay", line: MESHY, url: 'https://www.meshy.ai', license: CC_BY_SA },
  { what: 'Mountain lion, California vole', line: MESHY, url: 'https://www.meshy.ai', license: CC_BY_SA },
  { what: 'Black-tailed deer and buck', line: '"Deer" by Quaternius, Ultimate Animated Animal Pack, via Poly Pizza', url: 'https://poly.pizza/m/T6Cs7tmMHJ', license: CC0 },
  { what: 'Gray fox', line: '"Fox" by Quaternius, Ultimate Animated Animal Pack, via Poly Pizza', url: 'https://poly.pizza/m/Bc97C66HKi', license: CC0 },
  { what: 'Coyote', line: '"Wolf" by Quaternius, Ultimate Animated Animal Pack, via Poly Pizza', url: 'https://poly.pizza/m/P1gU3Qkr9r', license: CC0 },
  { what: 'Brush rabbit', line: '"Rabbit" by Čestmír Dammer (CDmir), OpenGameArt', url: 'https://opengameart.org/content/rabbit-0', license: CC0 },
  { what: 'Ground: dry grass thatch', line: '"Withered Grass" by Charlotte Baglioni, Poly Haven', url: 'https://polyhaven.com/a/withered_grass', license: CC0 },
  { what: 'Ground: leaf litter', line: '"Dry Decay Leaves" by Amal Kumar, Poly Haven', url: 'https://polyhaven.com/a/dry_decay_leaves', license: CC0 },
  { what: 'Ground: gravelly dirt', line: '"Rocky Trail" by Amal Kumar, Poly Haven', url: 'https://polyhaven.com/a/rocky_trail', license: CC0 },
  { what: 'Ground: cobbles and rock', line: '"Rocks Ground 06" by Rob Tuytel, Poly Haven', url: 'https://polyhaven.com/a/rocks_ground_06', license: CC0 },
  { what: 'Ground: worn pavement', line: '"Worn Asphalt" by Amal Kumar, Poly Haven', url: 'https://polyhaven.com/a/worn_asphalt', license: CC0 },
  { what: 'Icons', line: 'Lucide, © Lucide Icons and Contributors', url: 'https://lucide.dev', license: ['ISC', 'https://lucide.dev/license'] },
];

const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function link(text, url) {
  const u = safeUrl(url); if (!u) return el('span', null, text);
  const a = el('a', null, text); a.href = u; a.target = '_blank'; a.rel = 'noopener'; return a;
}

function sourceItem(key, s) {
  const li = el('li');
  li.append(link(s.attribution || s.name || key, s.attribution_url));
  const sub = el('div', 'cr-sub');
  sub.append(link(s.license || 'licence unknown', s.license_url), ` · retrieved ${s.retrieved || '–'}`);
  if (s.name) sub.append(` · ${s.name}`);
  li.append(sub);
  return li;
}

export function setupCredits({ tile, link: opener, panel }) {
  const m = tile.manifest || {}, sources = Object.entries(m.sources || {});
  const required = sources.filter(([, s]) => s.attribution_required === true);
  const other = sources.filter(([, s]) => s.attribution_required !== true);
  panel.replaceChildren();
  const close = el('button', 'cr-close', '×'); close.title = 'close (Esc)'; close.setAttribute('aria-label', 'close');
  panel.append(close, el('h1', null, 'Data and credits'));
  const meta = el('div', 'cr-sub');
  meta.append('tile ', el('b', null, tile.id), ` · built ${(m.generated_at || '').slice(0, 10) || '–'}`);
  panel.append(meta);

  panel.append(el('h2', null, 'Required'));
  const ul1 = el('ul'); for (const [k, s] of required) ul1.append(sourceItem(k, s)); panel.append(ul1);
  if (other.length) {
    panel.append(el('h2', null, 'Also credited (public domain)'));
    const ul2 = el('ul'); for (const [k, s] of other) ul2.append(sourceItem(k, s)); panel.append(ul2);
  }

  const prior = m.layers?.['client.species_prior'], ds = tile.speciesPrior?.datasets || [];
  if (prior) {
    panel.append(el('h2', null, 'Animal density'));
    const p = el('p', 'cr-note');
    const used = prior.records_used_by_license || {}, excl = Object.entries(prior.records_excluded || {});
    p.textContent = `Where animals gather is weighted by ${prior.records_used} GBIF occurrence records (` +
      Object.entries(used).map(([l, n]) => `${n} ${l}`).join(', ') + `) from ${ds.length || prior.datasets} datasets` +
      (excl.length ? `; ${excl.map(([l, n]) => `${n} ${l}`).join(', ')} records are not used.` : '.');
    panel.append(p);
    if (ds.length) {
      const dl = el('div', 'cr-sub');
      ds.forEach((d, i) => { if (i) dl.append(' · '); dl.append(link(`${d.key.slice(0, 8)} (${d.records}, ${d.license})`, `https://www.gbif.org/dataset/${encodeURIComponent(d.key)}`)); });
      panel.append(dl);
    }
  }

  panel.append(el('h2', null, 'Models, textures and icons'));
  const ul3 = el('ul');
  for (const a of ASSET_CREDITS) {
    const li = el('li'); li.append(el('span', 'cr-what', `${a.what}: `), link(a.line, a.url));
    const sub = el('div', 'cr-sub'); sub.append(link(a.license[0], a.license[1])); li.append(sub); ul3.append(li);
  }
  panel.append(ul3);

  const set = on => { panel.hidden = !on; opener.setAttribute('aria-expanded', String(on)); };
  set(false);
  opener.addEventListener('click', e => { e.preventDefault(); set(panel.hidden); });
  close.addEventListener('click', () => set(false));
  addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { set(false); e.stopPropagation(); } }, true);
  // keep flight keys and look-drags from reaching the game while the panel is used
  for (const ev of ['keydown', 'pointerdown', 'wheel']) panel.addEventListener(ev, e => e.stopPropagation());
  return { open: () => set(true), close: () => set(false), get isOpen() { return !panel.hidden; } };
}
