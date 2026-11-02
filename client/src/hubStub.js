// The stub hub (?hub=stub): answers as the hub (docs/multiplayer.md, "The hub" and "Protocol") would for the title
// screen, so the screen is built and verified before hub.py (lane 2) and hub.js (lane 3) exist. The shapes are the
// doc's: config {name, providers[]}, welcome {you, friends[], requests[], groups[], online[], providers[]}, and counts
// {t: 'counts', tiles: {tileId: n}} sent to a watcher every few seconds with numbers that change, so the dots and the
// list can be seen re-sorting. Nothing here touches the network; no position, no address, only tile ids. Lane 3's
// hub.js replaces it behind the same calls (config, me, watch, on, close).

const YOU = { id: '00000000-0000-4000-8000-000000000001', name: 'aaron', display: 'Aaron' };
const PROVIDERS = ['password', 'discord'];

export class HubStub {
  // tiles: the tile ids to count (set later with hub.tiles = [...] when the index arrives); period: ms between counts.
  constructor({ tiles = [], period = 3000, home = null } = {}) {
    this.tiles = tiles; this.period = period; this.home = home;
    this.handlers = {}; this.counts = null; this.timer = null;
    let s = 0x9e3779b9;   // a small deterministic generator, so a reload replays the same walk
    this.rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
  }
  async config() { return { name: 'stub hub', providers: [...PROVIDERS] }; }
  async welcome() { return { you: { ...YOU }, friends: [], requests: [], groups: [], online: [], providers: [...PROVIDERS] }; }
  async me() { return { ...YOU }; }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(msg) { for (const fn of this.handlers[msg.t] || []) fn(msg); }

  // The counts: a few players scattered over the tiles, the home tile busiest to start; every period one or two tiles
  // gain or lose a player or two (never below zero), so an order change is seen within a few ticks.
  watch(on) {
    clearInterval(this.timer); this.timer = null;
    if (!on) return;
    if (!this.counts) {
      this.counts = {};
      for (const id of this.tiles) this.counts[id] = id === this.home ? 3 : Math.floor(this.rnd() * 4);
    }
    this.emit({ t: 'counts', tiles: { ...this.counts } });
    this.timer = setInterval(() => {
      const ids = Object.keys(this.counts); if (!ids.length) return;
      const n = 1 + Math.floor(this.rnd() * 2);
      for (let k = 0; k < n; k++) {
        const id = ids[Math.floor(this.rnd() * ids.length)], d = (this.rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(this.rnd() * 2));
        this.counts[id] = Math.max(0, Math.min(12, this.counts[id] + d));
      }
      this.emit({ t: 'counts', tiles: { ...this.counts } });
    }, this.period);
  }
  close() { this.watch(false); this.handlers = {}; }
}
