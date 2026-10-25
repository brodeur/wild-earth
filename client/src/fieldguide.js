// Field guide: the small cards that turn the acorn game into something a child carries outside
// (docs/brief.md: "A child plays the acorn game and then goes outside to pick up acorns under a real oak").
//   - acorn card: the first acorn picked up this session, and again for each new oak species, with a
//     drawing of that species' acorn, its names, three facts and an invitation to find a real one.
//   - stash card: the first acorn put in a stash hole this session, about caching.
//   - witness cards (acorn game v2): the first time this session the player is close by when an acorn woodpecker
//     hammers an acorn into its granary, a gray squirrel buries one, or a raven caches one; its first line follows
//     the player's species (watching another species, or another of its own kind).
//   - own cards: the same card the first time the player does the thing itself (the player woodpecker's first acorn
//     into its family's granary, the player squirrel's first burial), in the player's voice. Counted apart from the
//     watched showing, so a family deposit seen first does not use up the player's own card, nor the other way round.
//   - v4 cards: the first raid the player sees or makes this session (an acorn pulled from a granary, or someone else's
//     buried acorn dug up), and the first time the player is mobbed (the woodpecker family, or a squirrel guarding).
// One DOM element (#fieldGuide), created here; it never takes pointer input except its close button,
// Esc closes it, and it closes itself after a few seconds. Nothing runs per frame.

import { resolveSpecies } from './trees.js';

const SHOW_MS = 8000, ASKED_MS = 20000, NEXT_GAP_MS = 350;

// Text for a curious ten-year-old: concrete, kind, no exclamation marks.
export const ACORN_FACTS = [
  ['What it is', 'An acorn is a seed in a cup. The nut holds a tiny oak and the food it needs to start growing.'],
  ['Who eats it here', 'Acorn woodpeckers store thousands in granary trees. Scrub-jays and gray squirrels bury them and forget some, and those can grow into new oaks. Deer eat them whole.'],
  ['When', 'They drop in September and October.'],
];
export const ACORNS = {
  quercus_douglasii: {
    common: 'blue oak', scientific: 'Quercus douglasii',
    looks: 'Long and tapered, with a shallow, bumpy cap.',
    invite: 'Find a real one: look under a blue oak in October. The cap often stays on the tree.',
  },
  quercus_wislizeni: {
    common: 'interior live oak', scientific: 'Quercus wislizeni',
    looks: 'Slender and pointed, with a deep cap that hugs the nut.',
    invite: 'Find a real one: look under an interior live oak in October. Its acorns take two years to grow on the branch.',
  },
};
export const STASH_FACTS = [
  'Ravens hide food and remember hundreds of spots.',
  'Gray squirrels bury acorns one by one, each in its own small hole.',
  'Acorn woodpeckers drill holes in a granary tree and tap an acorn into each one.',
  'Some forgotten caches become new trees.',
];
export const STASH_INVITE = 'Try it: hide three acorns outside and come back tomorrow.';
// What the other gatherers are doing, for the witness cards. draw: the card's picture.
export const WITNESS = {
  granary: {
    kicker: 'acorn woodpecker', title: 'A granary tree', lead: 'You just watched an acorn woodpecker tap an acorn into its granary.',
    facts: [
      'A family of three to a dozen acorn woodpeckers shares one granary: a tree, often a dead one, full of holes they drilled.',
      'Each hole holds one acorn, wedged in tight. A big granary can hold tens of thousands.',
      'As the acorns dry and shrink the birds move them to snugger holes, and the family chases off jays and squirrels.',
    ],
    invite: 'Find a real one: in oak country, look for a dead branch, snag or old pole covered in neat round holes.',
  },
  bury: {
    kicker: 'western gray squirrel', title: 'One acorn, one hole', lead: 'You just watched a gray squirrel bury an acorn.',
    facts: [
      'Gray squirrels scatter their acorns: each one goes in its own small hole, a few centimetres down, then gets covered over.',
      'They find them again in winter mostly by smell, even under snow.',
      'The acorns they never come back for can sprout. Squirrels plant a lot of oaks.',
    ],
    invite: 'Find a real one: under an oak in fall, look for small fresh holes and scuffed leaves.',
  },
  cache: {
    kicker: 'common raven', title: 'Hiding it from the others', lead: 'You just watched a raven hide an acorn.',
    facts: [
      'Ravens push food into the ground, under leaves or beside a shrub, and come back for it later.',
      'They watch each other hide food and steal from each other, so a raven waits until no one is looking.',
      'They remember where their caches are for days.',
    ],
    invite: 'Watch a raven or crow on the ground: if it pokes at the leaves and walks off, it may have hidden something.',
  },
};
// v4: stealing and defending stores.
export const RAID_CARD = {
  kicker: 'stealing from the stores', title: 'Thieves at the larder',
  facts: [
    'A store of acorns draws thieves. Scrub-jays, Steller\'s jays and squirrels pull acorns from woodpecker granaries.',
    'Squirrels sniff out each other\'s buried acorns, and jays and ravens dig them up too. Much of what is buried is stolen.',
    'So the owners guard: an acorn woodpecker family chases thieves off its granary, and a squirrel that sees its acorn dug up gives chase.',
  ],
  invite: 'Watch a granary tree for a while in fall: a jay may slip in while the woodpeckers are away.',
};
export const MOBBED_CARD = {
  kicker: 'acorn woodpecker', title: 'Mobbed',
  facts: [
    'Acorn woodpeckers live in family groups that share one granary and defend it together.',
    'When a thief comes they call, a loud waka-waka, and fly at it, swooping past again and again until it leaves.',
    'Small birds ganging up to drive off a bigger animal is called mobbing. Jays and crows mob hawks and owls the same way.',
  ],
  invite: 'Listen near a granary tree: a sudden burst of waka calls may be the family chasing someone off.',
};
const THIEF = { corvus_corax: 'raven', sciurus_griseus: 'gray squirrel', aphelocoma_californica: 'scrub-jay', cyanocitta_stelleri: "Steller's jay" };
// Who does each witnessed thing, and the card's first line for the player's species: the player watching another
// species, another of its own kind, or doing it itself (the player as a woodpecker, squirrel or raven).
const WITNESS_BY = {
  granary: { code: 'melanerpes_formicivorus', one: 'acorn woodpecker',
    other: 'You just watched another acorn woodpecker tap an acorn into its granary.',
    self: "You just tapped an acorn into your family's granary, the way acorn woodpeckers do." },
  bury: { code: 'sciurus_griseus', one: 'gray squirrel',
    other: 'You just watched another gray squirrel bury an acorn.',
    self: 'You just buried an acorn in its own small hole, the way gray squirrels do.' },
  cache: { code: 'corvus_corax', one: 'raven',
    other: 'You just watched another raven hide an acorn.',
    self: 'You just hid an acorn for later, the way ravens do.' },
};
export function witnessLead(kind, playerSpecies, self = false) {
  const c = WITNESS[kind], b = WITNESS_BY[kind]; if (!c) return '';
  if (self) return b.self;
  return playerSpecies === b.code ? b.other : c.lead;
}
// The player's species: the game's player record (acorns.js), else the world's choice, else the raven.
const playerSpeciesOf = game => game?.player?.species || game?.playerSpecies
  || (typeof window !== 'undefined' && window.__we?.playerSpecies) || 'corvus_corax';
// One line for the species card (identify.js), from the same text.
export const acornLine = id => ACORNS[id] ? `${ACORN_FACTS[0][1].split('. ')[0]}. ${ACORNS[id].looks} ${ACORN_FACTS[2][1]}` : null;
export const acornSpecies = name => { const id = resolveSpecies(name); return ACORNS[id] ? id : null; };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
#fieldGuide { position:fixed; z-index:6; width:330px; max-width:calc(100vw - 28px); box-sizing:border-box; padding:10px 12px 10px;
  background:#0f1512e8; border:1px solid #3a3020; border-radius:8px; backdrop-filter:blur(4px); color:#d3ddd5; font-size:12.5px; line-height:1.4;
  pointer-events:none; opacity:1; transition:opacity .35s; }
#fieldGuide.hidden { display:none; }
#fieldGuide.fading { opacity:0; }
#fieldGuide .close { pointer-events:auto; position:absolute; right:6px; top:4px; background:none; border:none; color:#b7c4ba; font-size:18px; line-height:1; cursor:pointer; padding:2px 6px; }
#fieldGuide .close:hover { color:#e6ede7; }
#fieldGuide .kicker { font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#ffd08a; margin:0 0 6px; }
#fieldGuide .head { display:flex; gap:10px; align-items:center; }
#fieldGuide canvas { flex:none; width:64px; height:84px; }
#fieldGuide h1 { font-size:15px; margin:0; color:#e6ede7; padding-right:20px; }
#fieldGuide .sci { color:#b7c4ba; font-style:italic; }
#fieldGuide .looks { color:#b7c4ba; margin-top:3px; font-size:12px; }
#fieldGuide ul { margin:8px 0 0; padding:0 0 0 16px; }
#fieldGuide li { margin:3px 0; }
#fieldGuide li b { color:#e6ede7; font-weight:600; }
#fieldGuide .invite { margin:8px 0 0; padding-top:7px; border-top:1px solid #263128; color:#ffe2b0; }
html.narrow #fieldGuide { width:300px; padding:8px 10px; font-size:12px; line-height:1.33; }   /* a narrow or short window (main.js layoutHud) */
html.narrow #fieldGuide canvas { width:48px; height:63px; }
html.narrow #fieldGuide h1 { font-size:14px; }
html.narrow #fieldGuide .kicker { margin-bottom:4px; }
html.narrow #fieldGuide ul { margin-top:5px; }
html.narrow #fieldGuide li { margin:2px 0; }
html.narrow #fieldGuide .invite { margin-top:6px; padding-top:5px; }
#game .row.fg-notes b { font-weight:500; text-align:right; max-width:190px; }
#speciesCard p.acorns b { color:#ffd08a; }
#speciesCard .fg-open { background:none; border:1px solid #6b4a2b; color:#ffd08a; border-radius:5px; font:inherit; font-size:11.5px; padding:1px 7px; margin-left:4px; cursor:pointer; }
#speciesCard .fg-open:hover { background:#3a2c17; }
`;

class FieldGuide {
  constructor() { this.el = null; this.timer = 0; this.fadeTimer = 0; this.seen = new Set(); this.stashSeen = false; this.witnessed = new Set(); this.ownSeen = new Set(); this.queue = []; }

  mount() {
    if (this.el) return this.el;
    const st = document.createElement('style'); st.id = 'fieldGuideStyle'; st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'fieldGuide'; el.className = 'hidden';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target.closest('[data-close]')) this.next(); });
    // Capture phase, so identify.js can tell this Esc already closed a field-guide card.
    addEventListener('keydown', e => { if (e.code === 'Escape' && this.isOpen()) { this.queue.length = 0; this.hide(); e.fieldGuideClosed = true; } }, true);
    addEventListener('resize', () => { if (this.isOpen()) requestAnimationFrame(() => this.place(this.anchor)); });   // after main.js lays out the HUD
    return el;
  }
  isOpen() { return !!this.el && !this.el.classList.contains('hidden'); }

  // Game hooks: they show a card only the first time per session (per species for acorns).
  acornPicked(name, anchor) {
    const id = acornSpecies(name); if (!id || this.seen.has(id)) return;
    this.seen.add(id); this.showAcorn(id, anchor);
  }
  stashFilled(anchor) {
    if (this.stashSeen) return;
    this.stashSeen = true; this.showStash(anchor);
  }

  // The acorn game (identify.js attaches it): its player record says which species the player is, and its deposit
  // and burial events say who did the thing a witness card is about. acorns.js calls witness() from inside the
  // event's dispatch, before its listeners run, so the card waits a microtask for this event's listener entry.
  // The player's own granary deposit or burial shows its own card from the listener, wherever the camera is.
  attach(game) {
    if (!game || this.game === game) return;
    this.game = game; this.log = []; this.logN = 0;
    for (const t of ['deposit', 'bury']) game.on?.(t, e => {
      this.log[this.logN++ % 8] = e;
      if (e.by !== 'player') return;
      if (t === 'deposit' && e.into === 'granary') this.own('granary', game.ui?.box);
      else if (t === 'bury') this.own(e.kind === 'cache' || this.playerSpecies === 'corvus_corax' ? 'cache' : 'bury', game.ui?.box);
    });
  }
  get playerSpecies() { return playerSpeciesOf(this.game); }

  witness(kind, anchor) {
    const c = WITNESS[kind]; if (!c || this.witnessed.has(kind)) return;
    const n = this.logN || 0;
    queueMicrotask(() => this.witnessShow(kind, anchor, this.logN > n ? this.log[n % 8] : null));
  }
  witnessShow(kind, anchor, e) {
    if (e?.by === 'player' || this.witnessed.has(kind)) return;   // the player's own: own(), from the listener
    this.witnessed.add(kind);
    this.witnessCard(kind, anchor, witnessLead(kind, this.playerSpecies));
  }
  // The player's first own granary deposit or burial this session (per kind), in the player's voice.
  own(kind, anchor) {
    if (!WITNESS[kind] || this.ownSeen.has(kind)) return;
    this.ownSeen.add(kind);
    this.witnessCard(kind, anchor, witnessLead(kind, this.playerSpecies, true));
  }
  witnessCard(kind, anchor, lead) {
    const c = WITNESS[kind];
    this.show(`<button class="close" data-close title="close (Esc)">×</button>
      <div class="kicker">field guide · ${esc(c.kicker)}</div>
      <div class="head"><canvas width="128" height="168"></canvas>
        <div><h1>${esc(c.title)}</h1><div class="looks">${esc(lead)}</div></div></div>
      <ul>${c.facts.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="invite">${esc(c.invite)}</p>`, anchor, false, kind === 'granary' ? drawGranary : g => drawDig(g, kind === 'cache'));
  }

  // v4: the first raid seen or made this session (kind 'granary' or 'pilfer'; sp: the raider's species), and the first
  // time the player is mobbed (by 'family' or 'squirrel').
  raidSeen(kind, sp, mine, anchor) {
    if (this.raidShown) return;
    this.raidShown = true;
    const who = THIEF[sp] || 'thief';
    const lead = kind === 'granary'
      ? (mine ? 'You just pulled an acorn out of a woodpecker family\'s granary.' : `You just watched a ${who} pull an acorn out of a woodpecker granary.`)
      : (mine ? 'You just dug up an acorn someone else buried.' : `You just watched a ${who} dig up an acorn someone else buried.`);
    this.storeCard(RAID_CARD, lead, anchor, kind === 'granary' ? drawGranary : g => drawDig(g, false));
  }
  mobbed(by, sp, anchor) {
    if (this.mobShown) return;
    this.mobShown = true;
    if (by === 'squirrel') {
      this.storeCard({ ...MOBBED_CARD, kicker: 'western gray squirrel', title: 'Chased off',
        facts: ['A gray squirrel finds its buried acorns again mostly by smell, and so can any other squirrel close by.',
          'Squirrels chase each other, tails flicking, when one comes too close to food it has found or hidden.',
          'Most of the time the owner is too far off to notice, so many buried acorns are dug up by someone else.'],
        invite: 'Watch a squirrel bury an acorn: it often looks around first, and may move it if another animal is watching.' },
      'The squirrel whose acorn you dug up chased you off.', anchor, g => drawDig(g, false));
      return;
    }
    const lead = sp === 'sciurus_griseus' ? 'The woodpecker family dived at you until you let go and left their granary.'
      : 'The woodpecker family dived at you and drove you off their granary.';
    this.storeCard(MOBBED_CARD, lead, anchor, drawGranary);
  }
  storeCard(c, lead, anchor, draw) {
    this.show(`<button class="close" data-close title="close (Esc)">×</button>
      <div class="kicker">field guide · ${esc(c.kicker)}</div>
      <div class="head"><canvas width="128" height="168"></canvas>
        <div><h1>${esc(c.title)}</h1><div class="looks">${esc(lead)}</div></div></div>
      <ul>${c.facts.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="invite">${esc(c.invite)}</p>`, anchor, false, draw);
  }

  // asked: opened from the species card, so it shows at once and stays longer.
  showAcorn(name, anchor, asked = false) {
    const id = acornSpecies(name); if (!id) return;
    const a = ACORNS[id];
    this.show(`<button class="close" data-close title="close (Esc)">×</button>
      <div class="kicker">field guide · acorn</div>
      <div class="head"><canvas width="128" height="168"></canvas>
        <div><h1>${esc(a.common)}</h1><div class="sci">${esc(a.scientific)}</div><div class="looks">${esc(a.looks)}</div></div></div>
      <ul>${ACORN_FACTS.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>
      <p class="invite">${esc(a.invite)}</p>`, anchor, asked, g => drawAcorn(g, id));
  }
  showStash(anchor) {
    this.show(`<button class="close" data-close title="close (Esc)">×</button>
      <div class="kicker">field guide · caching</div>
      <div class="head"><canvas width="128" height="168"></canvas>
        <div><h1>Hiding food for later</h1><div class="looks">Many animals here store food when there is plenty and come back for it in winter.</div></div></div>
      <ul>${STASH_FACTS.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="invite">${esc(STASH_INVITE)}</p>`, anchor, false, drawGranary);
  }

  // A game card that arrives while another is open waits its turn (pickup and stash often come
  // within a second of each other), so each is on screen for SHOW_MS or until closed.
  show(html, anchor, asked, draw) {
    const card = { html, anchor, ms: asked ? ASKED_MS : SHOW_MS, draw };
    if (!asked && this.isOpen()) { this.queue.push(card); return; }
    this.queue.length = asked ? 0 : this.queue.length;
    this.render(card);
  }
  render({ html, anchor, ms, draw }) {
    const el = this.mount();
    clearTimeout(this.timer); clearTimeout(this.fadeTimer);
    el.innerHTML = html; el.classList.remove('hidden', 'fading');
    const c = el.querySelector('canvas'); if (c && draw) draw(c.getContext('2d'));
    this.anchor = anchor; this.place(anchor);
    this.timer = setTimeout(() => { el.classList.add('fading'); this.fadeTimer = setTimeout(() => this.next(), 400); }, ms);
  }
  // Close the open card and bring on the next waiting one, if any.
  next() {
    this.hide();
    if (this.queue.length) this.timer = setTimeout(() => this.render(this.queue.shift()), NEXT_GAP_MS);
  }
  // Beside the game HUD (right of it, or below it on a narrow screen); top centre when there is no HUD.
  place(anchor) {
    const el = this.el, w = el.offsetWidth, h = el.offsetHeight, W = innerWidth, H = innerHeight;
    const r = anchor && !anchor.classList.contains('hidden') ? anchor.getBoundingClientRect() : null;
    // keep clear of the side panels: the right panel's left edge and the left HUD's right edge
    const box = id => { const b = document.getElementById(id)?.getBoundingClientRect(); return b && b.width ? b : null; };   // fixed elements: no offsetParent
    const pr = box('panel'), hr = box('hud');
    const maxX = (pr ? pr.left : W) - 10, minX = (hr ? hr.right : 0) + 10;
    let x, y;
    if (r && r.width) {
      if (r.right + 10 + w <= maxX) { x = r.right + 10; y = r.top; }                 // right of the game HUD
      else if (r.left - 10 - w >= minX) { x = r.left - 10 - w; y = r.top; }          // left of it
      else {                                                                          // below it, between the HUD and the panel when it fits there
        x = r.left + r.width / 2 - w / 2; y = r.bottom + 8;
        if (maxX - minX >= w) x = Math.min(Math.max(x, minX), maxX - w);
      }
    } else { x = W / 2 - w / 2; y = 12; }
    el.style.left = `${Math.round(Math.max(10, Math.min(x, W - w - 10)))}px`;
    el.style.top = `${Math.round(Math.max(10, Math.min(y, H - h - 10)))}px`;
  }
  hide() {
    clearTimeout(this.timer); clearTimeout(this.fadeTimer);
    if (this.el) this.el.classList.add('hidden');
  }
}

export const fieldGuide = new FieldGuide();

// ---- drawings (2D canvas, 128 x 168 px drawn in a 64 x 84 unit space) -----------------------------

// Nut outline: an oval that swells just below the cap rim, then narrows to a point at the tip
// (`tip` is the half-width near the point: larger is blunter).
function nutPath(cx, top, bottom, w, tip) {
  const p = new Path2D(), L = bottom - top, hw = w / 2;
  p.moveTo(cx - hw * 0.9, top - 6);
  p.bezierCurveTo(cx - hw * 1.08, top + L * 0.08, cx - hw * 1.08, top + L * 0.3, cx - hw, top + L * 0.48);
  p.bezierCurveTo(cx - hw * 0.88, top + L * 0.8, cx - hw * tip, bottom - L * 0.04, cx, bottom);
  p.bezierCurveTo(cx + hw * tip, bottom - L * 0.04, cx + hw * 0.88, top + L * 0.8, cx + hw, top + L * 0.48);
  p.bezierCurveTo(cx + hw * 1.08, top + L * 0.3, cx + hw * 1.08, top + L * 0.08, cx + hw * 0.9, top - 6);
  p.closePath();
  return p;
}
// Cap: a cup open downward, rim at rimY, dome rising `depth` above it.
function capPath(cx, rimY, cw, depth) {
  const p = new Path2D(), hw = cw / 2;
  p.moveTo(cx - hw, rimY);
  p.bezierCurveTo(cx - hw * 1.04, rimY - depth * 0.85, cx - hw * 0.62, rimY - depth, cx, rimY - depth);
  p.bezierCurveTo(cx + hw * 0.62, rimY - depth, cx + hw * 1.04, rimY - depth * 0.85, cx + hw, rimY);
  p.quadraticCurveTo(cx, rimY + 3, cx - hw, rimY);
  p.closePath();
  return p;
}

function drawAcorn(g, id) {
  g.save(); g.scale(2, 2); g.lineJoin = 'round'; g.lineCap = 'round';
  const blue = id === 'quercus_douglasii';
  // shapes: blue oak long and tapered, shallow warty cap; interior live oak slender and pointed, deep cap
  const cx = 32, nw = blue ? 24 : 17, rim = blue ? 20 : 32, tip = blue ? 80 : 81, taper = blue ? 0.3 : 0.16;
  const cw = blue ? 27 : 21, depth = blue ? 8 : 15;
  const nut = nutPath(cx, rim, tip, nw, taper);
  // soft shadow, then the nut body: a warm brown with a lit left side and faint lengthwise stripes
  g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 5; g.shadowOffsetY = 2;
  const body = g.createLinearGradient(cx - nw / 2, 0, cx + nw / 2, 0);
  if (blue) { body.addColorStop(0, '#8a6538'); body.addColorStop(0.35, '#c79a5c'); body.addColorStop(1, '#6a4a26'); }
  else { body.addColorStop(0, '#5e3d1f'); body.addColorStop(0.35, '#9a6a38'); body.addColorStop(1, '#4a2f17'); }
  g.fillStyle = body; g.fill(nut); g.restore();
  g.save(); g.clip(nut);
  g.strokeStyle = blue ? 'rgba(90,60,30,0.35)' : 'rgba(40,24,10,0.4)'; g.lineWidth = 0.7;
  for (const f of [-0.28, 0, 0.28]) {
    g.beginPath(); g.moveTo(cx + f * nw, rim); g.quadraticCurveTo(cx + f * nw * 1.1, (rim + tip) / 2, cx + f * nw * 0.2, tip - 2); g.stroke();
  }
  g.fillStyle = 'rgba(255,240,210,0.28)';   // highlight
  g.beginPath(); g.ellipse(cx - nw * 0.2, rim + (tip - rim) * 0.32, nw * 0.1, (tip - rim) * 0.22, -0.08, 0, Math.PI * 2); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(30,18,8,0.8)'; g.lineWidth = 0.9; g.stroke(nut);
  g.fillStyle = '#3a2412'; g.beginPath(); g.arc(cx, tip - 0.6, 1.1, 0, Math.PI * 2); g.fill();   // the point at the tip
  // cap
  const cap = capPath(cx, rim, cw, depth);
  const cg = g.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0);
  cg.addColorStop(0, '#7d6c4c'); cg.addColorStop(0.4, '#b5a27a'); cg.addColorStop(1, '#5f5138');
  g.fillStyle = cg; g.fill(cap);
  g.save(); g.clip(cap);
  if (blue) {
    // warty: rows of round knobs, each with a lit top and a dark underside
    for (let r = 0; r < 4; r++) {
      const y = rim - 1.5 - r * 2.6, n = 8 - r, span = cw * (1 - r * 0.16);
      for (let k = 0; k < n; k++) {
        const x = cx - span / 2 + (k + 0.5 + (r % 2) * 0.35) * span / n;
        g.fillStyle = 'rgba(60,48,30,0.7)'; g.beginPath(); g.arc(x, y + 0.5, 1.45, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(214,198,160,0.9)'; g.beginPath(); g.arc(x - 0.2, y - 0.2, 1.05, 0, Math.PI * 2); g.fill();
      }
    }
  } else {
    // thin, flat, overlapping scales in rows up the deep cup, with a fine fuzz of hairs
    for (let r = 0; r < 6; r++) {
      const y = rim - 1.2 - r * 2.4, n = 8, span = cw * (1.04 - Math.pow(r / 6, 2) * 0.5);
      for (let k = 0; k < n; k++) {
        const x = cx - span / 2 + (k + 0.5 + (r % 2) * 0.5) * span / n;
        g.strokeStyle = 'rgba(70,58,40,0.38)'; g.lineWidth = 0.55;
        g.beginPath(); g.moveTo(x - 1.2, y + 0.4); g.quadraticCurveTo(x, y - 0.8, x + 1.2, y + 0.4); g.stroke();
      }
    }
    g.strokeStyle = 'rgba(225,210,175,0.25)'; g.lineWidth = 0.4;
    for (let k = 0; k < 40; k++) {
      const x = cx - cw / 2 + ((k * 37) % 41) / 41 * cw, y = rim - ((k * 23) % 29) / 29 * depth;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.8, y - 0.9); g.stroke();
    }
  }
  g.restore();
  g.strokeStyle = 'rgba(30,22,10,0.85)'; g.lineWidth = 0.9; g.stroke(cap);
  // a short stalk nub
  g.strokeStyle = '#5a4a32'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(cx, rim - depth + 0.5); g.lineTo(cx + 1, rim - depth - 4); g.stroke();
  g.restore();
}

// A piece of granary-tree bark with drilled holes, some holding an acorn end-on.
function drawGranary(g) {
  g.save(); g.scale(2, 2);
  const x0 = 6, y0 = 4, w = 52, h = 76;
  const bark = g.createLinearGradient(x0, 0, x0 + w, 0);
  bark.addColorStop(0, '#4a4036'); bark.addColorStop(0.5, '#7a6c5c'); bark.addColorStop(1, '#3e352c');
  g.fillStyle = bark; g.beginPath(); g.roundRect(x0, y0, w, h, 6); g.fill();
  g.save(); g.clip();
  g.strokeStyle = 'rgba(30,24,18,0.55)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = x0 + 5 + i * 9; g.beginPath(); g.moveTo(x, y0); g.bezierCurveTo(x + 3, y0 + h * 0.35, x - 3, y0 + h * 0.65, x + 1, y0 + h); g.stroke();
  }
  const filled = [1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const x = x0 + 11 + c * 15 + (r % 2) * 3, y = y0 + 12 + r * 17;
    g.fillStyle = '#1a120b'; g.beginPath(); g.ellipse(x, y, 4.6, 5.2, 0, 0, Math.PI * 2); g.fill();
    if (filled[r * 3 + c]) {
      const ng = g.createRadialGradient(x - 1.2, y - 1.4, 0.5, x, y, 4);
      ng.addColorStop(0, '#d0a066'); ng.addColorStop(1, '#6a4524');
      g.fillStyle = ng; g.beginPath(); g.ellipse(x, y, 3.6, 4.1, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3a2412'; g.beginPath(); g.arc(x, y, 0.8, 0, Math.PI * 2); g.fill();   // the acorn's tip, facing out
    }
  }
  g.restore(); g.restore();
}

// A small hole in the ground with an acorn going in (bury), or an acorn half under leaves (a raven's cache).
function drawDig(g, leaves) {
  g.save(); g.scale(2, 2);
  const soil = g.createLinearGradient(0, 30, 0, 84);
  soil.addColorStop(0, '#5a4630'); soil.addColorStop(1, '#3a2c1c');
  g.fillStyle = soil; g.beginPath(); g.roundRect(4, 34, 56, 46, 8); g.fill();
  g.fillStyle = '#1e150c'; g.beginPath(); g.ellipse(32, 58, 13, 7, 0, 0, Math.PI * 2); g.fill();   // the hole
  g.fillStyle = '#6e5638'; for (const [x, y, r] of [[14, 50, 3], [50, 52, 3.4], [44, 66, 2.6], [19, 67, 2.2]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }   // thrown-up soil
  // the acorn, end-on into the hole
  const ng = g.createLinearGradient(25, 0, 39, 0); ng.addColorStop(0, '#6a4524'); ng.addColorStop(0.4, '#c79a5c'); ng.addColorStop(1, '#5e3d1f');
  g.fillStyle = ng; g.beginPath(); g.ellipse(32, 50, 6, 10, 0.25, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9a8a62'; g.beginPath(); g.ellipse(30, 41, 6.5, 4, 0.25, Math.PI, 0); g.fill();
  if (leaves) {
    for (const [x, y, a, c] of [[20, 54, 0.6, '#8a6a2a'], [42, 56, -0.5, '#a07a34'], [32, 62, 0.1, '#7a5a26'], [26, 46, -1.1, '#94743a']]) {
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c; g.beginPath(); g.ellipse(0, 0, 11, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(40,28,10,0.6)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(-10, 0); g.lineTo(10, 0); g.stroke(); g.restore();
    }
  }
  g.restore();
}
