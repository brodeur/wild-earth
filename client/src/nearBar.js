// The nearby-animals bar (owner, 2026-10-27): in spirit form, the species within reach of the spirit (animals.js
// describe: within NEAR_R m, the counts the HUD's "animals near" line reads) as a small toolbar at the bottom of the
// screen, about an action bar's height. Each species is a slot: the animal's still (assets/opening/<code>.webp, the start
// screen's lineup stills, fitted to the slot rather than to scale) standing on a disc of its soul's glow (the species'
// rarity colour, animals.js rarityColor, as its soul is lit in the world), with a count pill. The
// slots are ordered by the species' rarity on the tile (animals.js rarity), the abundant left and the rare right, as the
// souls' spectrum runs from purple to red. Hidden while the player is in a body. The slots are rebuilt only when the
// set or a count changes; the bar's own element is the page's (index.html #nearBar), its slots a world's (torn down
// with it).
import { rarityColor } from './animals.js';

const STILLS = new URL('../assets/opening/', import.meta.url);

export class NearBar {
  constructor({ el, animals }) {
    this.el = el; this.animals = animals; this.species = animals.speciesList(); this.slots = new Map(); this.index = null; this.last = '';
    fetch(new URL('index.json', STILLS)).then(r => r.json()).then(j => { this.index = j.species || {}; this.last = ''; }).catch(() => { this.index = {}; });
  }
  // counts: per species index (animals.counts, filled by describe each HUD tick); on: in spirit form
  update(counts, on) {
    this.el.hidden = !on;
    if (!on || !this.index) return;
    const rar = this.animals.rarity, show = [];
    for (let k = 0; k < counts.length; k++) if (counts[k] > 0) show.push(k);
    show.sort((a, b) => (rar[a] - rar[b]) || (a - b));
    const key = show.map(k => `${k}:${counts[k]}`).join(',');
    if (key === this.last) return;
    this.last = key;
    for (const [k, slot] of this.slots) if (!show.includes(k)) { slot.remove(); this.slots.delete(k); }
    let prev = null;
    for (const k of show) {
      let slot = this.slots.get(k);
      if (!slot) { slot = this.makeSlot(k); this.slots.set(k, slot); }
      slot.lastChild.textContent = counts[k];
      const want = prev ? prev.nextSibling : this.el.firstChild;
      if (want !== slot) this.el.insertBefore(slot, want);
      prev = slot;
    }
  }
  makeSlot(k) {
    const sp = this.species[k], st = this.index[sp.code] || this.index[sp.code.split(':')[0]];
    const slot = document.createElement('div'); slot.className = 'nb-slot'; slot.title = sp.common || sp.many;
    slot.style.setProperty('--soul', `#${rarityColor(this.animals.rarity[k]).getHexString()}`);   // the disc's glow: the species' soul colour
    const disc = document.createElement('i'); disc.className = 'nb-disc';
    const img = document.createElement('img'); img.className = 'nb-img'; img.alt = sp.one; img.decoding = 'async';
    if (st) img.src = new URL(st.file, STILLS).href;
    const n = document.createElement('b'); n.className = 'nb-n';
    slot.append(disc, img, n);
    return slot;
  }
}
