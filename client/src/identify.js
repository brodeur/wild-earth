import * as THREE from 'three';
import { SPECIES } from './trees.js';
import { CLOSE_R } from './vegetation.js';
import { fieldGuide, acornLine, acornSpecies, ANIMALS } from './fieldguide.js';

// Species identification: the project's mission is to connect people to their bioregion, so the
// player should be able to learn what they are looking at.
//   - HUD: the nearest tree and the species around you (counts within 100 m), from veg.nearPlants,
//     scanned at most four times a second.
//   - Click a tree (a press that moves less than 4 px, so dragging to look never triggers it): a ray
//     against the near-set trunks and canopies picks the plant, and a card shows its species with a
//     short description and what it is doing this season (from the species file).
//   - Tags: a small name tag above about one plant in ten within 160 m (deterministic per plant),
//     a pooled set of constant-size sprites. T toggles them.
//   - Click an animal with a field-guide entry (the wild turkey, California ground squirrel and western fence lizard;
//     fieldguide.js ANIMALS): a ray against a sphere round each one in view (animals.js registers itself as
//     this.animals), at least ~1.2 degrees across so a lizard at 10 m can be hit; its card names it, says what it is
//     doing and opens its field-guide card.

const SCAN_MS = 250, AROUND_R = 100, PICK_R = 150, CLICK_PX = 4;
const TAG_R = 160, TAG_MAX = 200, TAG_EVERY = 10;
const SEASON_WORD = { winter: 'winter', spring: 'spring', summer: 'summer', fall: 'fall' };
// The species file's `form` token in plain words (any other token: its underscores as spaces).
const FORM_WORD = { tree: 'tree', shrub: 'shrub', multi_stem_shrub_tree: 'multi-stemmed shrub or small tree' };
const formWord = f => FORM_WORD[f] || String(f || 'plant').replace(/_/g, ' ');
// Animal cards: the pick sphere's radius (m at size 1) and how far up the body its centre is, per species code.
const ANIMAL_PICK = { meleagris_gallopavo: [0.45, 0.5], otospermophilus_beecheyi: [0.16, 0.08], sceloporus_occidentalis: [0.09, 0.02] };
const ANIMAL_SEASON = {
  meleagris_gallopavo: { winter: 'Winter flocks are the biggest of the year, and roost together in the tallest oaks.', spring: 'Spring: toms gobble and strut; hens slip away to nest on the ground under brush.', summer: 'Summer: hens lead their poults through the grass, snapping up grasshoppers.', fall: 'Fall: flocks gather under the oaks for the acorn crop.' },
  otospermophilus_beecheyi: { winter: 'Winter: most stay down in their burrows through the coldest weeks.', spring: 'Spring: the young come up out of the burrows in April and May.', summer: 'Summer: busy gathering the dry grasses\' seeds; in the hottest weeks the adults stay below.', fall: 'Fall: storing seeds and acorns in the burrows before winter.' },
  sceloporus_occidentalis: { winter: 'Winter: hidden under bark, logs and rocks; out only on the warmest days.', spring: 'Spring: the males push up from every rock and post to hold their patch.', summer: 'Summer: out in the morning and late afternoon, in the shade at midday.', fall: 'Fall: out on warm afternoons until the nights turn cold.' },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tagged = id => ((Math.imul(id, 0x9E3779B1) >>> 0) >>> 8) % TAG_EVERY === 0;

// The acorn gatherers by species, as the oak card names them (the player's own kind are "other" ones).
const GATHERERS = { melanerpes_formicivorus: 'acorn woodpeckers', sciurus_griseus: 'gray squirrels', corvus_corax: 'ravens' };
const gatherers = (sp, me) => GATHERERS[sp] ? (sp === me ? `other ${GATHERERS[sp].replace(/^(acorn|gray) /, '')}` : GATHERERS[sp]) : 'other animals';
const others = me => {
  const l = Object.keys(GATHERERS).map(sp => gatherers(sp, me)).sort((a, b) => a.startsWith('other') - b.startsWith('other'));
  const s = `${l.slice(0, -1).join(', ')} and ${l.at(-1)}`; return s[0].toUpperCase() + s.slice(1);
};

export class Identify {
  // els: { nearest, around, card } ; seasonNow(): current season name
  constructor({ veg, camera, dom, scene, flight, acorns, seasonNow, els }) {
    Object.assign(this, { veg, camera, dom, flight, acorns, seasonNow, els });
    // Who took each acorn (the game's world records only when): collector species and kind per acorn key, kept per
    // world (a season has its own), from the game's pickup events. Acorns taken before this page loaded are unknown.
    this.takenBy = new WeakMap();
    acorns?.on?.('pickup', e => {
      const w = acorns.world, c = w?.collectors[e.by]; if (!w || !c) return;
      let m = this.takenBy.get(w); if (!m) this.takenBy.set(w, m = new Map());
      m.set(e.key, { species: c.species, you: c.kind === 'player' });
    });
    fieldGuide.attach(acorns);
    this.lastScan = -1e9; this.selected = null;   // selected: { id, species }
    this.raycaster = new THREE.Raycaster(); this.raycaster.far = PICK_R;
    this.probe = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.m4 = new THREE.Matrix4(); this.v = new THREE.Vector3();
    // tags
    this.tagsOn = true; this.tagGroup = new THREE.Group(); this.tagGroup.renderOrder = 19; scene.add(this.tagGroup);
    this.tagPool = []; this.tagMats = {};
    // click (pointerdown/up on the canvas only: panels, the mini-map and the card are other elements)
    let down = null;
    dom.addEventListener('pointerdown', e => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
    dom.addEventListener('pointerup', e => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
      if (moved < CLICK_PX) this.click(e.clientX, e.clientY);
    });
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Escape' && !e.fieldGuideClosed) {   // Esc closes a field-guide card first, then the species card
        if (!els.card.classList.contains('hidden')) e.speciesCardClosed = true;   // ... and only then leaves a body (spirit.js)
        this.hideCard();
      }
      if (e.code === 'KeyT') this.setTags(!this.tagsOn);
    });
    els.card.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) this.hideCard();
      const g = e.target.closest('[data-guide]');
      if (g) fieldGuide.showAcorn(g.dataset.guide, this.acorns?.running ? this.acorns.ui.box : null, true);
      const an = e.target.closest('[data-animal]');
      if (an) fieldGuide.showAnimal(an.dataset.animal, null, true);
    });
  }

  setTags(on) { this.tagsOn = on; this.tagGroup.visible = on; if (on) this.lastScan = -1e9; }

  // HUD tick (main.js calls this on its HUD timer; it scans at most every SCAN_MS).
  tick(now) {
    if (now - this.lastScan < SCAN_MS) return;
    this.lastScan = now;
    const p = this.flight.pos, cam = this.camera.position, plants = this.veg.nearPlants;
    let nearest = null, nearestD = Infinity, nearestShrub = null, shrubD = Infinity;
    const counts = {}, tags = [];
    for (const q of plants) {
      const dx = q.x - p.x, dz = q.z - p.z, h2 = dx * dx + dz * dz;
      if (h2 < AROUND_R * AROUND_R) counts[q.species] = (counts[q.species] || 0) + 1;
      const dy = p.y - Math.min(Math.max(p.y, q.y), q.y + q.height);   // to the nearest point of the trunk line
      const d = Math.sqrt(h2 + dy * dy);
      if (SPECIES[q.species].shrub) { if (d < shrubD) { shrubD = d; nearestShrub = q; } }
      else if (d < nearestD) { nearestD = d; nearest = q; }
      if (this.tagsOn && tagged(q.id)) {
        const tx = q.x - cam.x, ty = q.y + q.height - cam.y, tz = q.z - cam.z, t2 = tx * tx + ty * ty + tz * tz;
        if (t2 < TAG_R * TAG_R) tags.push([t2, q]);
      }
    }
    if (!nearest) { nearest = nearestShrub; nearestD = shrubD; }
    const { nearest: nEl, around: aEl } = this.els;
    if (nearest) {
      const s = SPECIES[nearest.species];
      nEl.innerHTML = `${esc(s.common)} <i>${esc(s.scientific)}</i> · ${nearestD.toFixed(0)} m`;
    } else nEl.textContent = '–';
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
    aEl.textContent = top.length ? top.map(([id, n]) => `${n} ${SPECIES[id].common}`).join(' · ') : '–';
    if (this.tagsOn) this.placeTags(tags);
  }

  // ---- tags -----------------------------------------------------------------------------------
  tagMaterial(id) {
    if (this.tagMats[id]) return this.tagMats[id];
    const name = SPECIES[id].common, font = '600 30px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = font; const w = Math.ceil(g.measureText(name).width) + 28; c.width = w; c.height = 46;
    g.font = font; g.fillStyle = 'rgba(10,15,12,0.66)'; g.beginPath(); g.roundRect(1, 1, w - 2, 44, 12); g.fill();
    g.fillStyle = '#e6ede7'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, w / 2, 24);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: false, fog: false });
    m.userData.aspect = w / 46;
    return (this.tagMats[id] = m);
  }
  placeTags(tags) {
    tags.sort((a, b) => a[0] - b[0]);
    const n = Math.min(TAG_MAX, tags.length), H = 0.032;   // about 16 CSS px tall at a 70 degree fov
    let used = 0;
    for (let i = 0; i < n; i++) {
      const q = tags[i][1];
      if (this.selected && this.selected.id === q.id) continue;   // the card already names it
      let sp = this.tagPool[used];
      if (!sp) { sp = new THREE.Sprite(this.tagMaterial(q.species)); sp.renderOrder = 19; this.tagPool.push(sp); this.tagGroup.add(sp); }
      const m = this.tagMaterial(q.species);
      if (sp.material !== m) sp.material = m;
      sp.scale.set(H * m.userData.aspect, H, 1);
      sp.position.set(q.x, q.y + q.height + 1.5, q.z); sp.visible = true; used++;
    }
    for (let i = used; i < this.tagPool.length; i++) this.tagPool[i].visible = false;
  }

  // ---- click to identify -----------------------------------------------------------------------
  click(cx, cy) {
    const hit = this.pick(cx, cy), ah = this.pickAnimal(cx, cy, hit ? hit.distance : this.raycaster.far);
    if (ah) this.showAnimalCard(ah);
    else if (hit) this.showCard(hit);
  }
  // The nearest animal with a card whose pick sphere the ray passes through, nearer than maxT (the tree hit or the
  // ground), or null.
  pickAnimal(cx, cy, maxT = PICK_R) {
    const A = this.animals; if (!A) return null;
    const ray = this.raycaster.ray, o = ray.origin, d = ray.direction;
    let best = null, bt = maxT;
    for (const a of A.list) {
      const code = A.codeOf(a), P = ANIMAL_PICK[code]; if (!P || !A.shown(a)) continue;
      const s = a.size || 1, vx = a.x - o.x, vy = a.y + P[1] * s - o.y, vz = a.z - o.z, t = vx * d.x + vy * d.y + vz * d.z;
      if (t < 0 || t > bt + 1) continue;
      const R = Math.max(P[0] * s, t * 0.01), m2 = vx * vx + vy * vy + vz * vz - t * t;
      if (m2 > R * R) continue;
      bt = t; best = { animal: a, code, distance: t };
    }
    return best;
  }
  pick(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray, o = ray.origin, d = ray.direction, eye = this.camera.position;
    // Stop at the ground: march the heightfield so a tree behind a ridge is not picked through it.
    const hts = this.flight.heights; let far = PICK_R;
    for (let t = 1.5; t <= PICK_R; t += 1.5) if (o.y + d.y * t < hts.atXZ(o.x + d.x * t, o.z + d.z * t)) { far = t; break; }
    this.raycaster.far = far;
    let best = null; const hits = [];
    for (const [id, arr] of Object.entries(this.veg.meshes)) {
      const leafOn = this.veg.leafOn?.[id] ?? 1;
      for (const e of arr) {
        const a = e.near.trunk.instanceMatrix.array;
        for (let i = 0; i < e.near.n; i++) {
          const b = i * 16, s = Math.hypot(a[b], a[b + 1], a[b + 2]), H = e.height * s, R = H * 0.7 + 1;
          const vx = a[b + 12] - o.x, vy = a[b + 13] + H * 0.5 - o.y, vz = a[b + 14] - o.z;
          const t = vx * d.x + vy * d.y + vz * d.z, l2 = vx * vx + vy * vy + vz * vz;
          if (t < -R || t - R > far || l2 - t * t > R * R) continue;   // behind, beyond the ground or 150 m, or off the ray
          if (best && t - R > best.distance) continue;
          this.probe.matrixWorld.fromArray(a, b);
          const base = Math.hypot(a[b + 12] - eye.x, a[b + 13] - eye.y, a[b + 14] - eye.z);
          const canopy = base < CLOSE_R && e.close.n ? e.close.canopy : e.near.canopy;   // the cards on screen
          const parts = [[e.near.trunk.geometry, null]];
          if (leafOn > 0) parts.push([canopy.geometry, canopy.material.map]);
          for (const [geo, map] of parts) {
            hits.length = 0; this.probe.geometry = geo;
            this.raycaster.intersectObject(this.probe, false, hits);
            for (const h of hits) {
              if (best && h.distance >= best.distance) break;
              if (map && !this.opaque(geo, map, h, leafOn)) continue;
              best = { distance: h.distance, species: id, id: e.near.ids[i], point: h.point.clone(), x: a[b + 12], z: a[b + 14] };
              break;
            }
          }
        }
      }
    }
    this.probe.geometry = null;
    if (best && this.onPickup(o, d, best.distance)) return null;   // the acorn game's pickups and stashes stay quiet
    return best;
  }
  // A card hit counts only where the leaf texture is solid and the card is on this season.
  opaque(geo, map, h, leafOn) {
    const rank = geo.attributes.leafRank?.getX(h.face.a) ?? 0;
    if (rank >= leafOn) return false;
    const img = map.mipmaps?.[0]; if (!img || !h.uv) return true;
    const x = Math.min(img.width - 1, Math.max(0, Math.floor(h.uv.x * img.width)));
    const y = Math.min(img.height - 1, Math.max(0, Math.floor((1 - h.uv.y) * img.height)));   // flipY
    return img.data[(y * img.width + x) * 4 + 3] >= 128;
  }
  onPickup(o, d, maxT) {
    const g = this.acorns;
    if (!g || !g.running) return false;
    for (const m of [g.nuts, g.acornGlow, g.holes, g.ringGlow]) {
      if (!m || !m.visible) continue;
      const a = m.instanceMatrix.array;
      for (let i = 0; i < m.count; i++) {
        const b = i * 16, vx = a[b + 12] - o.x, vy = a[b + 13] - o.y, vz = a[b + 14] - o.z;
        const t = vx * d.x + vy * d.y + vz * d.z;
        if (t < 0 || t > maxT + 1) continue;
        if (vx * vx + vy * vy + vz * vz - t * t < 1.5 * 1.5) return true;
      }
    }
    return false;
  }

  // ---- species card ----------------------------------------------------------------------------
  showCard(hit) {
    const s = SPECIES[hit.species], season = this.seasonNow(), card = this.els.card;
    this.selected = { id: hit.id, species: hit.species };
    const h = s.height_m ? `${s.height_m[0]}-${s.height_m[1]} m` : '–';
    const kind = s.deciduous ? 'deciduous' : 'evergreen';
    const note = s.season_notes?.[season];
    card.innerHTML = `<button class="close" data-close title="close (Esc)">×</button>
      <h1>${esc(s.common)}</h1>
      <div class="sci"><i>${esc(s.scientific)}</i> · ${hit.distance.toFixed(0)} m away</div>
      <div class="row"><span>form</span><b>${esc(formWord(s.form))} · ${kind}</b></div>
      <div class="row"><span>architecture</span><b>${esc(s.architectural_model || '–')} model</b></div>
      <div class="row"><span>height here</span><b>${esc(h)}</b></div>
      ${s.description ? `<p>${esc(s.description)}</p>` : ''}
      <p class="season"><b>${esc(SEASON_WORD[season] || season)}:</b> ${esc(note || (s.deciduous ? 'deciduous: the crown empties in winter.' : 'evergreen: in leaf all year.'))}</p>
      ${this.acornHtml(hit)}
      <div class="status">status: ${esc(s.status || 'agent draft, needs local sign-off')}</div>`;
    card.classList.remove('hidden');
    this.lastScan = -1e9;   // drop its tag on the next tick
  }
  // An animal's card: its names, distance, what it is doing, the season's line, and its field-guide card.
  showAnimalCard(hit) {
    const a = hit.animal, f = ANIMALS[hit.code], card = this.els.card, season = this.seasonNow();
    this.selected = { id: null, species: hit.code };
    const doing = this.animals.activity(a), note = ANIMAL_SEASON[hit.code]?.[season];
    card.innerHTML = `<button class="close" data-close title="close (Esc)">×</button>
      <h1>${esc(f.common)}</h1>
      <div class="sci"><i>${esc(f.scientific)}</i> · ${hit.distance.toFixed(0)} m away</div>
      ${doing ? `<div class="row"><span>now</span><b>${esc(doing)}</b></div>` : ''}
      <p>${esc(f.looks)}</p>
      ${note ? `<p class="season">${esc(note)}</p>` : ''}
      <p class="acorns"><button class="fg-open" data-animal="${esc(hit.code)}" title="open the field guide card">field guide</button></p>
      <div class="status">status: agent draft, needs local sign-off</div>`;
    card.classList.remove('hidden');
  }
  // Oaks: one acorns line from the field guide, and how many acorns this tree holds if the game is on. Since acorn
  // game v2 the woodpeckers, squirrels and ravens gather too, so the taken ones are worded by who took them.
  acornHtml(hit) {
    const sp = acornSpecies(hit.species); if (!sp) return '';
    let count = '';
    const g = this.acorns;
    if (g?.running && hit.x !== undefined) {
      const oak = g.oakAt(hit.x, hit.z), on = oak && g.acornsOn(oak.id);
      if (on) {
        count = on.total === 0 ? ' No acorns on this tree right now.' : ` ${this.takenLine(oak, on)}`;
        if (on.stash && g.revealed) count += ` Stash hole: ${on.stash.count} / ${on.stash.capacity}.`;
      }
    }
    return `<p class="acorns"><b>acorns:</b> ${esc(acornLine(sp))}${esc(count)} <button class="fg-open" data-guide="${esc(sp)}" title="open the field guide card">field guide</button></p>`;
  }
  // "This tree has 4 acorns." / "This tree still has 2 acorns; you picked up 1 and acorn woodpeckers took 1." /
  // "You picked up all 3 acorns from this tree." / "All the acorns here are gone: ..." (unknown takers: a hint who).
  takenLine(oak, on) {
    const g = this.acorns, n = k => `${k} acorn${k === 1 ? '' : 's'}`, took = on.total - on.left;
    if (!took) return `This tree has ${n(on.left)}.`;
    const me = g.player?.species || g.playerSpecies || 'corvus_corax';
    const m = this.takenBy.get(g.world), by = new Map();
    let you = 0, unknown = 0;
    for (const a of g.info(oak).acorns) {
      if (!g.world.picked.has(a.key)) continue;
      const t = m?.get(a.key);
      if (!t) unknown++; else if (t.you) you++; else by.set(t.species, (by.get(t.species) || 0) + 1);
    }
    const parts = [];
    if (you) parts.push(`you picked up ${you}`);
    for (const [s, k] of by) parts.push(`${gatherers(s, me)} took ${k}`);
    if (unknown) parts.push(parts.length ? `${unknown} more ${unknown === 1 ? 'is' : 'are'} gone` : null);
    const list = parts.filter(Boolean), said = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
    const hint = unknown ? ` ${others(me)} gather them too.` : '';
    if (on.left > 0) return said ? `This tree still has ${n(on.left)}; ${said}.${hint}` : `This tree still has ${n(on.left)}; ${took} ${took === 1 ? 'is' : 'are'} gone.${hint}`;
    if (you === took) return `You picked up all ${took === 1 ? 'the acorn' : took + ' acorns'} from this tree.`;
    return said ? `All the acorns here are gone: ${said}.${hint}` : `All the acorns here are gone.${hint}`;
  }
  hideCard() {
    this.els.card.classList.add('hidden'); this.selected = null; this.lastScan = -1e9;
  }
}
