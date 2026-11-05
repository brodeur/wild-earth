// A Mapbox Vector Tile reader (the MVT 2.1 spec, over a minimal protocol-buffer reader): enough for the home screen's
// map (mapTiles.worker.js), with no dependency. decodeTile(bytes, wanted) -> { layerName: { extent, features } } for the
// layers named in `wanted` (a Set; null for every layer); a feature is { type: 1 point | 2 line | 3 polygon, props,
// geom: [ring or line or point run as a flat [x0, y0, x1, y1, ...] in tile units] }.

class Pbf {
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end; }
  varint() {
    const b = this.buf; let v = 0, shift = 0, c;
    do { c = b[this.pos++]; v += (c & 0x7f) * 2 ** shift; shift += 7; } while (c >= 0x80 && shift < 70);
    return v;
  }
  svarint() { const v = this.varint(); return v % 2 === 1 ? (v + 1) / -2 : v / 2; }
  bytes() { const n = this.varint(), s = this.pos; this.pos += n; return [s, this.pos]; }
  string() { const [s, e] = this.bytes(); return DEC.decode(this.buf.subarray(s, e)); }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`pbf: wire type ${wire}`);
  }
  // each field of the message in [pos, end): fn(tag, wire)
  fields(fn) { while (this.pos < this.end) { const k = this.varint(); fn(k >> 3, k & 7); } }
  packed() { const [s, e] = this.bytes(), out = [], sub = new Pbf(this.buf, s, e); while (sub.pos < e) out.push(sub.varint()); return out; }
}
const DEC = new TextDecoder();

function readValue(p) {
  const [s, e] = p.bytes(), q = new Pbf(p.buf, s, e); let v = null;
  q.fields((tag, wire) => {
    if (tag === 1) v = q.string();
    else if (tag === 2) { v = new DataView(q.buf.buffer, q.buf.byteOffset + q.pos, 4).getFloat32(0, true); q.pos += 4; }
    else if (tag === 3) { v = new DataView(q.buf.buffer, q.buf.byteOffset + q.pos, 8).getFloat64(0, true); q.pos += 8; }
    else if (tag === 4 || tag === 5) v = q.varint();
    else if (tag === 6) v = q.svarint();
    else if (tag === 7) v = !!q.varint();
    else q.skip(wire);
  });
  return v;
}

// The geometry's commands (MoveTo 1, LineTo 2, ClosePath 7) and zig-zag deltas into flat runs.
function readGeom(cmds) {
  const out = []; let x = 0, y = 0, run = null;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 7) { if (run && run.length >= 2) run.push(run[0], run[1]); continue; }
    for (let k = 0; k < n; k++) {
      const a = cmds[i++], b = cmds[i++];
      x += (a >>> 1) ^ -(a & 1); y += (b >>> 1) ^ -(b & 1);
      if (id === 1) { run = [x, y]; out.push(run); } else if (run) run.push(x, y);
    }
  }
  return out;
}

function readLayer(p, wanted) {
  const [s, e] = p.bytes(), q = new Pbf(p.buf, s, e);
  let name = '', extent = 4096; const keys = [], values = [], raw = [];
  q.fields((tag, wire) => {
    if (tag === 1) name = q.string();
    else if (tag === 2) raw.push(q.bytes());
    else if (tag === 3) keys.push(q.string());
    else if (tag === 4) values.push(readValue(q));
    else if (tag === 5) extent = q.varint();
    else q.skip(wire);
  });
  if (wanted && !wanted.has(name)) return null;
  const features = raw.map(([fs, fe]) => {
    const f = new Pbf(p.buf, fs, fe); let type = 0, tags = [], geom = [];
    f.fields((tag, wire) => {
      if (tag === 2) tags = f.packed();
      else if (tag === 3) type = f.varint();
      else if (tag === 4) geom = f.packed();
      else f.skip(wire);
    });
    const props = {};
    for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
    return { type, props, geom: readGeom(geom) };
  });
  return { name, extent, features };
}

export function decodeTile(bytes, wanted = null) {
  const p = new Pbf(bytes), out = {};
  p.fields((tag, wire) => {
    if (tag === 3) { const l = readLayer(p, wanted); if (l) out[l.name] = l; }
    else p.skip(wire);
  });
  return out;
}
