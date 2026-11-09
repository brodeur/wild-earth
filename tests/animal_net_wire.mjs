// The host's animal stream never sends a message the server would refuse (ws.py WS_MAX_IN, 64 KB closes the socket):
// a join's full resend on a heavy world (many animals, herd rows, a big field backlog) and a pathological herd list are
// run through AnimalNet.tick() against a fake socket. Run by tests/test_animal_net.py; prints one JSON line.
import { AnimalNet } from '../client/src/animalNet.js';

const LIMIT = 64 * 1024;

function world({ animals = 1500, herds = 60, dead = 40, cells = 20000 } = {}) {
  const list = [];
  for (let i = 0; i < animals; i++) list.push({ id: `a${i}:${'x'.repeat(12)}`, sp: i % 40, size: 1.234, x: (i % 97) * 31.7, y: 1500.25, z: -(i * 7.3), yaw: 1.234, pitch: 0.01, roll: 0, spd: 1.5, wr: 0.5, pose: 0.25, amp: 0.7, flick: 0, vis: 1, lift: 0, e0: 0.1, e1: 0.2, e2: 0.3, e3: 1, state: 2, phase: i, phz: 6.3, speed: 1.2, u1: 0.3, u2: 0.6, u3: 0.9 });
  const rows = [];
  for (let k = 0; k < herds; k++) rows.push([`herd:${k}:bison_bison:summer`, 3, k, 1, 1234.5, -2345.6, 0.123, -0.456, 0.789, 1.5, 0, 0, 12.3, 1.2, -3.4, Array.from({ length: dead }, (_, j) => j * 3)]);
  const dirty = new Set(); for (let k = 0; k < cells; k++) dirty.add(k);
  const fields = {
    dirty, received: 0,
    all() { for (let k = 0; k < cells; k++) dirty.add(k); },
    delta(max) {
      if (!dirty.size) return null;
      let n = 0; for (const k of dirty) { dirty.delete(k); if (++n >= max) break; }
      return Buffer.alloc(n * 8, 7).toString('base64');
    },
  };
  return { list, time: 123.45, flight: { pos: { x: 0, z: 0 } }, fields, herdRows: (full, sent) => (full || !sent.size ? (sent.set('x', 1), rows) : []) };
}

function run(A, ticks) {
  const net = new AnimalNet(A, { pg: 'test' });
  const sizes = []; let spawned = new Set(), herdRows = 0, cells = 0;
  net.ws = { send(s) { sizes.push(s.length); const m = JSON.parse(s); for (const r of m.s) spawned.add(r[0]); herdRows += m.h?.length || 0; if (m.f) cells += Buffer.from(m.f, 'base64').length / 8; } };
  net.connected = true; net.host = true; net.n = 2; net.full = true;
  for (let i = 0; i < ticks; i++) net.tick();
  return { max: Math.max(...sizes), messages: sizes.length, spawned: spawned.size, herdRows, cells, oversize: net.stats.oversize || 0, split: net.stats.split || 0 };
}

const heavy = run(world(), 40);
const manyHerds = run(world({ animals: 50, herds: 3000, dead: 10, cells: 100 }), 4);
console.log(JSON.stringify({ limit: LIMIT, heavy, manyHerds }));
