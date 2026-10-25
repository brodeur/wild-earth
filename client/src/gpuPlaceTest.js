// GPU ground-cover placement prototype (client/gpu_place_test.html, docs/gpu-placement-prototype.md).
// Standalone: nothing in the client imports this, and it changes nothing there. It reads the home tile's
// rasters with tilepackage.js's loadTile and runs grass.js's own CPU placement as the reference.
//
// Per frame, for the cells around the camera:
//   1. GEN (WGSL compute): every candidate of the three blade tiers (main, close, ground: rank slices of
//      one per-cell placement) and of the card roles (tufts, tussocks, oats), each a pure function of
//      (cell, k) as in grass.js, written to a placed buffer. No cache: the whole radius every frame.
//   2. ARGS: the placed count becomes the cull's indirect dispatch size.
//   3. CULL (WGSL compute): distance band and per-plant hand-over, card density LOD, frustum; survivors
//      are compacted into the draw buffer and counted into a drawIndexedIndirect instanceCount.
//   4. DRAW: one three.js mesh, crossed cards, a TSL node material reading the draw buffer by
//      instanceIndex, alpha-to-coverage, dithered fade; geometry.setIndirect on the cull's count.
// Compute passes are raw WGSL pipelines on WebGPURenderer's GPUDevice (renderer.backend.device); the
// draw buffer and the indirect buffer are three.js storage attributes whose GPUBuffers the compute
// passes bind (renderer.backend.get(attribute).buffer, an internal but stable r186 accessor).

import { loadTile } from './tilepackage.js';
import { waterAt } from './shrubfield.js';
import { makeRef, resetRef, cpuFrame, gather, LAYERS, CARDS, R_TUS, R_TUFT, OAT_K, R_OAT_END, R_MAIN, R_CLOSE, P_TOTAL, DRIFT_MEAN, CARD_CODE } from './gpuplace/cpuRef.js';
import { GEN_WGSL, ARGS_WGSL, CULL_WGSL, CLAMP_WGSL } from './gpuplace/wgsl.js';

const Q = new URLSearchParams(location.search);
const TILE = Q.get('tile') || 'utm10n_680_4280';
const X0 = +(Q.get('x') || 4309), N0 = +(Q.get('n') || 3440);
const MODE = Q.get('mode') || 'bench';
const DENS = Math.max(1, Math.round(+(Q.get('dens') || 1)));
const W = +(Q.get('w') || 1280), H = +(Q.get('h') || 720);
const MSAA = Q.get('msaa') !== '0';
const CHECKS = Q.get('checks') !== '0', SIM = Q.get('sim') !== '0';
const PLACED_CAP = Math.min(700000 * DENS, 4000000), DRAW_CAP = Math.min(400000 * DENS, 3000000);
const LATTICE = [11, 4, 18, 6, 22, 7];   // grass.js's noise scales (bare patches, needlegrass drifts, oat stands), in wgsl.js's order
const CARD_R = 250;                      // card layer generation radius (the tuft field's band end)
const BOX = [[0.32, 0.55], [0.35, 0.6], [0.45, 0.75], [0.35, 1.15]];   // card half-width, height per unit plant scale: blade clump, tuft, tussock, oat

const out = document.getElementById('out');
const log = s => { out.textContent += '\n' + s; console.log(s); };
const RESULT = window.RESULT = { tile: TILE, x: X0, n: N0, dens: DENS, w: W, h: H, msaa: MSAA, ua: navigator.userAgent };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const r3 = x => Math.round(x * 1000) / 1000;
const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const raf = () => new Promise(r => requestAnimationFrame(r));

// The client's per-height rules (Grass.update): which tiers are on and their bands, the card bands.
function clientState(agl) {
  const k = sm(8, 28, agl), nf = [55 - 25 * k, 85 - 40 * k], gk = 1 - sm(8, 14, agl), up = sm(6, 10, agl);
  const off = [1e9, 1e9 + 1, 1e9 + 2, 1e9 + 3];
  return {
    on: [agl < nf[1] + 3, agl < nf[1] + 3, agl < 14],
    tier: [nf, [16, 30], gk > 0 ? [10 * gk, 16 * gk] : [0, 1e-3]],
    band: [off, agl < 250 ? [26 - 17 * up, 38 - 23 * up, 215, 250] : off, agl < 225 ? [6, 12, 185, 225] : off, agl < 240 ? [6, 12, 200, 240] : off],
    cardsOn: agl < 250,
  };
}

async function main() {
  if (!navigator.gpu) throw new Error('navigator.gpu missing: no WebGPU in this browser');
  const THREE = await import('three/webgpu'), T = await import('three/tsl');
  RESULT.three = THREE.REVISION;

  // ---- tile and the CPU reference ------------------------------------------------------------
  let t0 = performance.now();
  const tile = await loadTile(TILE, '../tiles/');
  const g = makeRef(tile, DENS), wm = tile.waterMask;
  wm.channel(0, 0);   // build the 5 m water grid
  RESULT.tileLoadMs = Math.round(performance.now() - t0);
  const res = tile.habitat.res, N = g.candidates();
  RESULT.candidatesPerCell = N;
  const ground = g.ground;

  // ---- renderer and device -------------------------------------------------------------------
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  RESULT.adapter = [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' / ');
  const renderer = new THREE.WebGPURenderer({ antialias: MSAA, powerPreference: 'high-performance', trackTimestamp: true,
    requiredLimits: { maxStorageBuffersPerShaderStage: Math.min(10, adapter.limits.maxStorageBuffersPerShaderStage),
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('WebGPURenderer fell back to WebGL2: this prototype needs WebGPU compute');
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  const device = renderer.backend.device, hasTS = device.features.has('timestamp-query');
  RESULT.timestampQuery = hasTS;
  device.addEventListener?.('uncapturederror', e => log('GPU error: ' + e.error.message));

  // ---- pack the rasters ----------------------------------------------------------------------
  t0 = performance.now();
  const Wc = g.W, Hc = g.Hh, cellsArr = new Float32Array(Wc * Hc * 4);
  const oc = tile.outcrop && tile.outcrop.img.width === Wc ? tile.outcrop.img.data : null;
  for (let k = 0; k < Wc * Hc; k++) { cellsArr[4 * k] = g.dens[k]; cellsArr[4 * k + 1] = g.herb[k]; cellsArr[4 * k + 2] = oc ? oc[k * 4] : 0; }
  const gW = wm.width, npx = gW * gW, rwArr = new Uint32Array(Math.ceil(npx / 2)), rd = tile.roads?.img.data;
  for (let p = 0; p < npx; p++) rwArr[p >> 1] |= ((rd ? rd[p * 4] : 0) | (wm.grid[p] << 8)) << ((p & 1) * 16);
  const watArr = packWater(wm);
  RESULT.packMs = Math.round(performance.now() - t0);
  RESULT.gpuDataMB = r3((cellsArr.byteLength + rwArr.byteLength + watArr.byteLength + tile.heights.z.byteLength) / 1e6);

  const U = GPUBufferUsage;
  const buf = (size, usage) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage });
  const upload = (data, usage) => { const b = buf(data.byteLength, usage | U.COPY_DST); device.queue.writeBuffer(b, 0, data); return b; };
  const B = {
    params: buf(80, U.UNIFORM | U.COPY_DST), items: buf(8192 * 160, U.STORAGE | U.COPY_DST),
    cells: upload(cellsArr, U.STORAGE), rw: upload(rwArr, U.STORAGE), hts: upload(tile.heights.z, U.STORAGE), wat: upload(watArr, U.STORAGE),
    placed: buf(PLACED_CAP * 32, U.STORAGE | U.COPY_SRC), counters: buf(64, U.STORAGE | U.COPY_DST | U.COPY_SRC),
    ids: buf(PLACED_CAP * 8, U.STORAGE | U.COPY_SRC), args: buf(16, U.STORAGE | U.INDIRECT | U.COPY_SRC),
    cull: buf(368, U.UNIFORM | U.COPY_DST), capP: buf(16, U.UNIFORM | U.COPY_DST), capD: buf(16, U.UNIFORM | U.COPY_DST),
    read: buf(64, U.MAP_READ | U.COPY_DST),
  };
  device.queue.writeBuffer(B.capP, 0, new Uint32Array([PLACED_CAP, 0, 0, 0]));
  device.queue.writeBuffer(B.capD, 0, new Uint32Array([DRAW_CAP, 0, 0, 0]));
  const pipe = async code => {
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    for (const m of info.messages) if (m.type === 'error') throw new Error(`WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
    return device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  };
  const P = { gen: await pipe(GEN_WGSL), args: await pipe(ARGS_WGSL), cull: await pipe(CULL_WGSL), clamp: await pipe(CLAMP_WGSL) };
  const bg = (p, list) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: list.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  const genBG = bg(P.gen, [B.params, B.items, B.cells, B.rw, B.hts, B.wat, B.placed, B.counters, B.ids]);
  const argsBG = bg(P.args, [B.counters, B.args, B.capP]);
  let qs = null, qResolve = null, qRead = null;
  if (hasTS) { qs = device.createQuerySet({ type: 'timestamp', count: 4 }); qResolve = buf(32, U.QUERY_RESOLVE | U.COPY_SRC); qRead = buf(32, U.MAP_READ | U.COPY_DST); }

  // ---- scene ---------------------------------------------------------------------------------
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0.62, 0.72, 0.86);
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 6000);
  const terrain = makeTerrain(THREE, T, tile, ground, X0, N0, 1600);
  scene.add(terrain);
  const drawAttr = new THREE.StorageBufferAttribute(new Float32Array(DRAW_CAP * 8), 4);
  const indAttr = new THREE.IndirectStorageBufferAttribute(new Uint32Array([12, 0, 0, 0, 0, 0, 0, 0]), 1);
  const grass = makeGrassMesh(THREE, T, drawAttr, indAttr);
  scene.add(grass);

  // ---- per frame -------------------------------------------------------------------------------
  const st = { items: [], total: 0, agl: 0, debug: 0 };
  const paramsArr = new ArrayBuffer(80), pU = new Uint32Array(paramsArr), pF = new Float32Array(paramsArr);
  const kOf = r => Math.round(N * r);
  const firstAtOrAbove = R => { let k = Math.max(0, Math.ceil(R * N - 0.5) - 2); while ((k + 0.5) / N < R) k++; return k; };   // smallest k with (k + 0.5) / N >= R
  const kTus = firstAtOrAbove(R_TUS), kTuft = firstAtOrAbove(R_TUFT), cardEnd = Math.ceil(N * Math.max(R_TUS, R_OAT_END));
  // Work items around (x, north): the cells each active layer's placement radius covers, as Grass.fill
  // selects them (cellsAround, then d - half > place skipped), plus the card cells (ClumpField.gather).
  function itemsAround(x, north, agl, only = null) {
    const S = clientState(agl), half = res * 0.71, list = [];
    if (only) {
      for (const [i, j] of only) {
        for (let layer = 0; layer < 3; layer++) { const L = LAYERS[layer]; list.push({ i, j, layer, k0: kOf(L.r[0]), count: kOf(L.r[1]) - kOf(L.r[0]) }); }
        list.push({ i, j, layer: 3, k0: 0, count: cardEnd });
      }
    } else {
      for (let layer = 0; layer < 3; layer++) {
        if (!S.on[layer]) continue;
        const L = LAYERS[layer];
        for (const [d, i, j] of g.cellsAround(x, north, L.place)) {
          if (d - half > L.place || !g.cellAny(i, j)) continue;
          list.push({ i, j, layer, k0: kOf(L.r[0]), count: kOf(L.r[1]) - kOf(L.r[0]) });
        }
      }
      if (S.cardsOn) for (const [, i, j] of gather(g, x, north, CARD_R)) list.push({ i, j, layer: 3, k0: 0, count: cardEnd });
    }
    return list;
  }
  function setItems(list, debug = 0) {
    if (list.length > 8192) throw new Error('too many work items');
    const ab = new ArrayBuffer(Math.max(160, list.length * 160)), u = new Uint32Array(ab), f = new Float32Array(ab);
    let base = 0;
    const split = v => { const a = Math.floor(v); return [a, v - a]; };
    list.forEach((it, n) => {
      const o = n * 40;
      u.set([it.i, it.j, it.layer, it.k0, it.count, base], o); f[o + 6] = g.annualAt(it.i, it.j); base += it.count;
      const ox = it.i * res, on = tile.size - it.j * res;   // double precision, as grass.js computes x and north
      LATTICE.forEach((sc, l) => f.set([...split(ox / sc), ...split(on / sc)], o + 8 + l * 4));
      f.set([...split(ox / wm.res), ...split(it.j * res / wm.res)], o + 8 + 6 * 4);
      const hx = Math.fround(ox), hn = Math.fround(on); f.set([hx, ox - hx, hn, on - hn], o + 8 + 7 * 4);
    });
    device.queue.writeBuffer(B.items, 0, ab);
    st.items = list; st.total = base; st.debug = debug;
    pF[0] = tile.size; pF[1] = res; pU[2] = Wc; pU[3] = Hc;
    pU[4] = N; pU[5] = list.length; pU[6] = PLACED_CAP; pF[7] = DRIFT_MEAN;
    pU[8] = tile.heights.w; pF[9] = tile.heights.res; pF[10] = ground.sp; pF[11] = wm.res;
    pU[12] = gW; pU[13] = debug; pU[14] = kTus; pU[15] = kTuft;
    pF[16] = OAT_K; pF[17] = R_TUFT; pU[18] = oc ? 1 : 0; pU[19] = base;
    device.queue.writeBuffer(B.params, 0, paramsArr);
  }
  const cullArr = new Float32Array(92), cullU = new Uint32Array(cullArr.buffer);
  const frustum = new THREE.Frustum(), m4 = new THREE.Matrix4();
  function setCull(agl) {
    camera.updateMatrixWorld();
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m4, camera.coordinateSystem);
    frustum.planes.forEach((p, i) => cullArr.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4));
    cullArr.set([camera.position.x, camera.position.y, camera.position.z, 0], 24);
    const S = clientState(agl);
    S.tier.forEach((t, i) => cullArr.set([t[0], t[1], 0, 0], 28 + i * 4));
    S.band.forEach((b, i) => cullArr.set(b, 40 + i * 4));
    const span = [1, R_TUFT, R_TUS, R_OAT_END - R_TUFT], start = [0, 0, 0, R_TUFT];
    for (let r = 1; r <= 3; r++) { const c = CARDS[r - 1]; cullArr.set([c.D0, c.KMIN, span[r], start[r]], 56 + r * 4); }
    BOX.forEach((b, i) => cullArr.set([b[0], b[1], 0, 0], 72 + i * 4));
    cullU[88] = DRAW_CAP;
    device.queue.writeBuffer(B.cull, 0, cullArr);
  }
  let cullBG = null, clampBG = null, indGPU = null;
  const zeros = new Uint32Array(16), zero1 = new Uint32Array([0]);
  // Encode and submit GEN (+ ARGS, CULL, CLAMP). ts: write timestamps around GEN and CULL.
  function compute({ cull = true, ts = false } = {}) {
    device.queue.writeBuffer(B.counters, 0, zeros);
    if (cull) device.queue.writeBuffer(indGPU, 4, zero1);
    const enc = device.createCommandEncoder();
    const gx = Math.max(1, Math.ceil(st.total / 256));
    let pass = enc.beginComputePass(ts && qs ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    pass.setPipeline(P.gen); pass.setBindGroup(0, genBG); pass.dispatchWorkgroups(Math.min(gx, 65535), Math.ceil(gx / 65535)); pass.end();
    if (cull) {
      pass = enc.beginComputePass(); pass.setPipeline(P.args); pass.setBindGroup(0, argsBG); pass.dispatchWorkgroups(1); pass.end();
      pass = enc.beginComputePass(ts && qs ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {});
      pass.setPipeline(P.cull); pass.setBindGroup(0, cullBG); pass.dispatchWorkgroupsIndirect(B.args, 0); pass.end();
      pass = enc.beginComputePass(); pass.setPipeline(P.clamp); pass.setBindGroup(0, clampBG); pass.dispatchWorkgroups(1); pass.end();
    }
    if (ts && qs) { enc.resolveQuerySet(qs, 0, cull ? 4 : 2, qResolve, 0); enc.copyBufferToBuffer(qResolve, 0, qRead, 0, 32); }
    device.queue.submit([enc.finish()]);
  }
  const sync = () => device.queue.onSubmittedWorkDone();
  async function readTS(cull = true) {
    await qRead.mapAsync(GPUMapMode.READ); const t = new BigUint64Array(qRead.getMappedRange().slice(0)); qRead.unmap();
    return { gen: Number(t[1] - t[0]) / 1e6, cull: cull ? Number(t[3] - t[2]) / 1e6 : NaN };
  }
  async function readBuf(src, offset, size) {
    const rb = buf(size, U.MAP_READ | U.COPY_DST), enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, offset, rb, 0, Math.ceil(size / 4) * 4); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ); const a = rb.getMappedRange().slice(0); rb.unmap(); rb.destroy(); return a;
  }
  async function counts() {
    const c = new Uint32Array(await readBuf(B.counters, 0, 64)), ind = new Uint32Array(await readBuf(indGPU, 0, 32));
    return { placed: c[0], drawn: ind[1], survivors: ind[5], reasons: Array.from(c.slice(2, 8)) };
  }
  function place(x, north, agl, yawDeg, pitchDeg) {
    const y = ground(x, north) + agl, yaw = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
    camera.position.set(x, y, -north);
    camera.lookAt(x + Math.sin(yaw) * Math.cos(p) * 100, y - Math.sin(p) * 100, -north - Math.cos(yaw) * Math.cos(p) * 100);
    camera.updateMatrixWorld();
  }

  // First render creates three's buffers for the draw and indirect attributes; then bind them.
  place(X0, N0, 3, 45, 12);
  renderer.render(scene, camera); await sync();
  indGPU = renderer.backend.get(indAttr).buffer; const drawGPU = renderer.backend.get(drawAttr).buffer;
  if (!indGPU || !drawGPU) throw new Error('three.js did not create the storage buffers');
  cullBG = bg(P.cull, [B.cull, B.placed, B.args, drawGPU, indGPU]);
  clampBG = bg(P.clamp, [indGPU, B.capD]);
  log(`tile ${tile.id} loaded (${RESULT.tileLoadMs} ms), ${N} candidates per cell, GPU data ${RESULT.gpuDataMB} MB, timestamps ${hasTS}`);

  const frame = (x, north, agl, yaw, pitch, opts = {}) => {
    place(x, north, agl, yaw, pitch);
    if (opts.items !== false) setItems(itemsAround(x, north, agl));
    setCull(agl); compute(opts); renderer.render(scene, camera);
  };

  // ---- view mode: draw one view (screenshots) ---------------------------------------------------
  const agl0 = +(Q.get('agl') || 3), yaw0 = +(Q.get('yaw') || 45), pitch0 = +(Q.get('pitch') || (agl0 > 50 ? 35 : agl0 > 8 ? 25 : 12));
  if (MODE === 'view') {
    for (let i = 0; i < 4; i++) { frame(X0, N0, agl0, yaw0, pitch0); await sync(); }
    Object.assign(RESULT, await counts());
    out.style.display = 'none'; document.title = 'done'; return;
  }

  // ---- bench ----------------------------------------------------------------------------------
  // 1. Equality against grass.js on chosen cells, every layer, with the reasons each candidate was skipped.
  if (CHECKS) {
    const cells = Q.get('cells') ? Q.get('cells').split(';').map(c => { const [i, j] = c.split(',').map(Number); return { name: 'given', i, j }; }) : findTestCells(tile, g, X0, N0);
    RESULT.checks = [];
    for (const c of cells) RESULT.checks.push(await checkCell(c));
    // A sweep: every 97th cell that holds grass, all layers; totals, and the cells that differ.
    const sweep = { cells: 0, plants: 0, unmatched: 0, extraGpu: 0, fieldDiff: 0, differing: [] };
    for (let k = 0, n = 0; DENS === 1 && !Q.get('cells') && k < g.W * g.Hh; k += 97) {
      if (g.dens[k] <= 0) continue;
      const r = await checkCell({ name: 'sweep', i: k % g.W, j: Math.floor(k / g.W) });
      sweep.cells++; let diff = 0;
      for (const l of r.layers) { sweep.plants += l.cpu; sweep.unmatched += l.unmatched; sweep.extraGpu += l.extraGpu; sweep.fieldDiff += l.fieldDiff; diff += l.unmatched + l.extraGpu + l.fieldDiff; }
      if (diff && sweep.differing.length < 12) sweep.differing.push({ i: r.i, j: r.j, layers: r.layers.filter(l => l.unmatched + l.extraGpu + l.fieldDiff).map(l => ({ layer: l.layer, unmatched: l.unmatched, extraGpu: l.extraGpu, fieldDiff: l.fieldDiff, odd: l.odd.map(o => [...o, waterAt(wm, o[1], o[2]), tile.roads?.at(o[1], o[2]) ?? 0]) })) });
      if (++n >= +(Q.get('sweep') || 1000)) break;
    }
    RESULT.sweep = sweep; log('sweep ' + JSON.stringify(sweep).slice(0, 3000));
    for (const c of RESULT.checks) log(`check ${c.name} (${c.i},${c.j}): ${c.layers.map(l => `${l.layer} ${l.cpu}/${l.gpu} -${l.unmatched} +${l.extraGpu} ~${l.fieldDiff}`).join(' | ')} | reasons ${JSON.stringify(c.reasons)}`);
  }
  async function checkCell(c) {
    setItems(itemsAround(0, 0, 0, [[c.i, c.j]]), 1);
    compute({ cull: false }); await sync();
    const cnt = await counts(), n = Math.min(cnt.placed, PLACED_CAP);
    const recs = new Float32Array(await readBuf(B.placed, 0, n * 32)), ids = new Uint32Array(await readBuf(B.ids, 0, n * 8));
    const gpu = [[], [], [], []];
    for (let o = 0; o < n; o++) gpu[ids[o * 2 + 1] >>> 24].push(Array.from(recs.subarray(o * 8, o * 8 + 8)));
    resetRef(g);
    const layers = [];
    for (let layer = 0; layer < 3; layer++) {
      const cpu = []; for (const grp of g.cellData(c.i, c.j, layer)) for (let o = 0; o < grp.data.length; o += 8) cpu.push(Array.from(grp.data.subarray(o, o + 8)));
      const gp = gpu[layer].map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], Math.floor(r[7])]);
      layers.push({ layer: LAYERS[layer].name, ...compare(cpu, gp, [1e-3, 3e-3, 1e-3, 1e-5, 2e-5, 2e-5, 0, 0], 6) });
    }
    for (const f of CARDS) {
      const cpu = []; const a = Float32Array.from(g.cardCell(c.i, c.j, f.role, f.kind)); for (let o = 0; o < a.length; o += 8) cpu.push(Array.from(a.subarray(o, o + 7)));   // stored as f32, as ClumpField does
      const gp = gpu[3].filter(r => (Math.floor(r[7]) >> 3) === f.role).map(r => [r[0], r[1], r[2], 0.5 * r[4], 0.65 * r[5], r[6], CARD_CODE[f.role] + 0.999 * r[3] / (Math.PI * 2)]);
      layers.push({ layer: f.name, ...compare(cpu, gp, [1e-3, 3e-3, 1e-3, 1e-5, 1e-5, 0, 2e-6], 5) });
    }
    // Every card plant is also a blade plant of the main or close tier, at the same place (one population).
    const bladeKeys = new Set([...gpu[0], ...gpu[1]].map(r => `${Math.round(r[0] * 1000)},${Math.round(r[2] * 1000)},${Math.floor(r[7]) >> 3}`));
    const orphanCards = gpu[3].filter(r => !bladeKeys.has(`${Math.round(r[0] * 1000)},${Math.round(r[2] * 1000)},${Math.floor(r[7]) >> 3}`)).length;
    const [kept, dens, outcrop, road, water, bare] = cnt.reasons;
    return { ...c, layers, orphanCards, reasons: { candidates: st.total, kept, density: dens, outcrop, road, water, bare } };
  }

  // 2. Views: GPU passes, draw, counts, and the CPU's cost for the same cells.
  const views = Q.get("views") === "0" ? [] : [
    { name: 'start view (150 m up)', agl: 150, pitch: 35 },
    { name: '40 m up', agl: 40, pitch: 30 },
    { name: '10 m up', agl: 10, pitch: 25 },
    { name: '3 m (low chase camera)', agl: 3, pitch: 12 },
  ];
  if (DENS > 1) views.splice(1, 2);
  RESULT.views = [];
  for (const v of views) {
    const r = await measureView(v);
    RESULT.views.push(r); log(JSON.stringify(r));
  }
  async function measureView(v) {
    const run = opts => frame(X0, N0, v.agl, yaw0, v.pitch, opts);
    for (let i = 0; i < 6; i++) { run(); await sync(); }
    const items = st.items, byLayer = [0, 0, 0, 0], cand = [0, 0, 0, 0];
    for (const it of items) { byLayer[it.layer]++; cand[it.layer] += it.count; }
    const c = await counts();
    const gen = [], cull = [];
    if (hasTS) for (let i = 0; i < 40; i++) { run({ ts: true }); const t = await readTS(); gen.push(t.gen); cull.push(t.cull); }
    // Draw time: render timestamps with and without the grass mesh (same buffers, no compute).
    const drawTS = async vis => {
      grass.visible = vis; const a = [];
      for (let i = 0; i < 40; i++) { renderer.render(scene, camera); await renderer.resolveTimestampsAsync('render'); await sync(); if (i > 4) a.push(renderer.info.render.timestamp); }
      grass.visible = true; return median(a);
    };
    const dw = [], dwo = [];
    for (let k = 0; k < 3; k++) { dw.push(await drawTS(true)); dwo.push(await drawTS(false)); }
    const withGrass = median(dw), without = median(dwo);
    // Wall time per frame, 60 frames back to back then a queue fence: compute + draw, draw only, compute only.
    const wall = async fn => { const a = []; for (let k = 0; k < 7; k++) { await sync(); const s = performance.now(); for (let i = 0; i < 60; i++) fn(); await sync(); a.push((performance.now() - s) / 60); await raf(); } return median(a); };
    const wallAll = await wall(() => run({ items: false })), wallDraw = await wall(() => renderer.render(scene, camera)), wallCompute = await wall(() => compute());
    // CPU side of a GPU frame: the work-item list (cells around the camera), uploads, cull uniforms, encoding.
    const cs = []; for (let i = 0; i < 30; i++) { const s = performance.now(); setItems(itemsAround(X0, N0, v.agl)); setCull(v.agl); compute(); cs.push(performance.now() - s); await sync(); }
    // CPU cost of the same cells: grass.js cellData (blade tiers) and cardCell (per card field, its own radius).
    const cpu = cpuCost(items, v.agl);
    cpu.cpuPathSubmitted = cpuSubmitted(v.agl);
    return { view: v.name, agl: v.agl, cells: { main: byLayer[0], close: byLayer[1], ground: byLayer[2], cards: byLayer[3] },
      candidates: cand.reduce((a, b) => a + b, 0), placed: c.placed, drawn: c.drawn, survivors: c.survivors,
      gpuGenMs: r3(median(gen)), gpuGenP90: r3(pct(gen, 0.9)), gpuCullMs: r3(median(cull)), gpuCullP90: r3(pct(cull, 0.9)),
      renderTsWithGrassMs: r3(withGrass), renderTsWithoutGrassMs: r3(without), grassDrawMs: r3(withGrass - without),
      wallComputeAndDrawMs: r3(wallAll), wallDrawOnlyMs: r3(wallDraw), wallComputeOnlyMs: r3(wallCompute), cpuSideOfGpuFrameMs: r3(median(cs)), items: items.length, ...cpu };
  }
  function cpuCost(items, agl) {
    const S = clientState(agl), blade = items.filter(it => it.layer < 3);
    const once = () => {
      resetRef(g); const t = [0, 0, 0], ct = [0, 0, 0];
      for (const it of blade) { const s = performance.now(); g.cellData(it.i, it.j, it.layer); t[it.layer] += performance.now() - s; }
      CARDS.forEach((f, n) => {
        if (S.band[f.role][0] > 1e8) return;
        for (const [, i, j] of gather(g, X0, N0, f.band[3])) { const s = performance.now(); g.cardCell(i, j, f.role, f.kind); ct[n] += performance.now() - s; }
      });
      return { t, ct };
    };
    once();   // JIT warm-up
    const runs = [once(), once(), once()], med = f => r3(median(runs.map(f)));
    const n = l => blade.filter(it => it.layer === l).length || 1;
    return { cpuBladeMs: med(r => r.t[0] + r.t[1] + r.t[2]), cpuCardMs: med(r => r.ct[0] + r.ct[1] + r.ct[2]),
      cpuMsPerCell: { main: med(r => r.t[0] / n(0)), close: med(r => r.t[1] / n(1)), ground: med(r => r.t[2] / n(2)) },
      cpuCardFieldMs: { tufts: med(r => r.ct[0]), tussocks: med(r => r.ct[1]), oats: med(r => r.ct[2]) } };
  }

  // What the CPU path would hand the GPU at this view: grass.js's 10 m blocks culled by sphere and band
  // (Grass.cull), and the card fields' cells with their LOD prefix (ClumpField.update), all cells built.
  function cpuSubmitted(agl) {
    resetRef(g); const S = clientState(agl), cp = camera.position, sph = new THREE.Sphere();
    camera.updateMatrixWorld(); m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(m4, camera.coordinateSystem);
    const nb = [[0, S.tier[0][1] + 3], [0, 33]], cb = [[0, 15.5], [0, 15.5]], gb = [null, null, [0, S.tier[2][1] + 3]];
    const bands = { annual: nb, bunch: nb, tussock: cb, oat: cb, groundA: gb, groundB: gb };
    for (const pool of ['near', 'ground']) {
      if (!S.on[pool === 'near' ? 0 : 2]) continue;
      g.fill(X0, N0, pool); while (g.queue.size) g.drain(1e9); g.fill(X0, N0, pool);
    }
    let blades = 0, cards = 0;
    for (const [name, set] of Object.entries(g.sets)) for (const k of set.blocks) {
      const band = bands[name][k.tier]; if (!band) continue;
      const d = Math.hypot(k.x - cp.x, k.y - cp.y, k.z - cp.z);
      if (d + k.r < band[0] || d - k.r > band[1]) continue;
      sph.center.set(k.x, k.y, k.z); sph.radius = k.r; if (frustum.intersectsSphere(sph)) blades += k.count;
    }
    for (const f of CARDS) {
      const band = S.band[f.role]; if (band[0] > 1e8) continue;
      for (const [, i, j] of gather(g, X0, N0, f.band[3])) {
        const a = g.cardCell(i, j, f.role, f.kind), n = a.length / 8; if (!n) continue;
        let y0 = Infinity, y1 = -Infinity, hm = 0; for (let o = 0; o < a.length; o += 8) { y0 = Math.min(y0, a[o + 1]); y1 = Math.max(y1, a[o + 1]); hm = Math.max(hm, a[o + 4]); }
        const cx = (i + 0.5) * res, cz = -(tile.size - (j + 0.5) * res), cy = (y0 + y1) / 2 + hm, r = Math.hypot(res * 0.71 + 3, (y1 - y0) / 2 + 2 * hm);
        const dc = Math.hypot(cx - cp.x, cy - cp.y, cz - cp.z);
        if (dc - r > band[3] || dc + r < band[0]) continue;
        sph.center.set(cx, cy, cz); sph.radius = r; if (!frustum.intersectsSphere(sph)) continue;
        const d = Math.max(dc - r, 1), keep = Math.min(Math.max(f.D0 * f.D0 / (d * d), f.KMIN), 1);
        cards += Math.min(n, Math.ceil(n * (keep + 0.06)));
      }
    }
    return { blades, cards };
  }

  // 3. Flying: the CPU path's per-frame placement work along a line at 3 m (grass.js fill/drain and the card
  //    fields' generation, real timing), against the GPU passes along the same line (which regenerate all).
  if (SIM) {
    const hd = 45 * Math.PI / 180, path = (v, t) => [X0 + v * t * Math.sin(hd), N0 + v * t * Math.cos(hd)];
    RESULT.sim = [];
    for (const v of DENS === 1 ? [6, 12, 25, 50, 100, 200] : [6, 12, 25, 50]) {
      resetRef(g); const ms = [], bl = [], miss = []; let maxCells = 0, maxQueue = 0;
      for (let f = 0; f < (DENS === 1 ? 420 : 300); f++) {
        const [x, n] = path(v, f / 60), r = cpuFrame(g, x, n);
        if (f >= 60) { ms.push(r.ms); bl.push(r.bladesMs); maxCells = Math.max(maxCells, r.bladeCells); maxQueue = Math.max(maxQueue, r.queue); miss.push(r.cardMissing / Math.max(1, r.cardTotal)); }
      }
      const s = { speed: v, frames: ms.length, medianMs: r3(median(ms)), p95Ms: r3(pct(ms, 0.95)), maxMs: r3(Math.max(...ms)),
        bladesP95Ms: r3(pct(bl, 0.95)), over4: ms.filter(m => m > 4).length, over8: ms.filter(m => m > 8).length, over16: ms.filter(m => m > 16.7).length, maxBladeCellsInAFrame: maxCells, maxQueuedBladeCells: maxQueue,
        cardCellsNotYetBuilt: { mean: r3(miss.reduce((a, b) => a + b, 0) / miss.length), max: r3(Math.max(...miss)) } };
      RESULT.sim.push(s); log('cpu fly ' + JSON.stringify(s));
    }
    const gfly = [];
    for (const v of [12, 100]) {
      const gen = [], cull = [], placed = [];
      for (let f = 0; f < 120; f++) {
        const [x, n] = path(v, f / 60); frame(x, n, 3, 45, 12, { ts: hasTS });
        if (hasTS) { const t = await readTS(); gen.push(t.gen); cull.push(t.cull); }
        if (f % 20 === 0) placed.push((await counts()).placed);
      }
      gfly.push({ speed: v, gpuGenMedianMs: r3(median(gen)), gpuGenMaxMs: r3(Math.max(...gen)), gpuCullMedianMs: r3(median(cull)), placedRange: [Math.min(...placed), Math.max(...placed)] });
    }
    RESULT.gpuFly = gfly; log('gpu fly ' + JSON.stringify(gfly));
  }

  out.textContent = JSON.stringify(RESULT, null, 1);
  document.title = 'done';
}

// Test cells near the start: plain grassland, a road (pavement and verge), water (pond or channel and its
// riparian band), an outcrop, a rewilded meadow; each must hold grass (habitat density > 0).
function findTestCells(tile, g, x0, n0) {
  const res = tile.habitat.res, W = g.W, wm = tile.waterMask, gr = wm.res, rd = tile.roads?.img.data, oc = tile.outcrop?.img.data;
  const best = {};
  const consider = (name, i, j) => { const d = Math.hypot((i + 0.5) * res - x0, tile.size - (j + 0.5) * res - n0); if (!best[name] || d < best[name].d) best[name] = { name, i, j, d: Math.round(d) }; };
  for (let j = 0; j < g.Hh; j++) for (let i = 0; i < W; i++) {
    if (g.dens[j * W + i] < 0.3) continue;
    let road = 0, verge = 0, water = 0, rip = 0;
    for (let y = Math.floor(j * res / gr); y < Math.floor((j + 1) * res / gr); y++) for (let x = Math.floor(i * res / gr); x < Math.floor((i + 1) * res / gr); x++) {
      const p = y * wm.width + x, r = rd ? rd[p * 4] : 0, w = wm.grid[p];
      if (r > 140) road++; else if (r > 0) verge++;
      if (w === 255) water++; else if (w > 0) rip++;
    }
    if (road > 3 && verge > 3) consider('road', i, j);
    if (water > 3 && rip > 3) consider('water', i, j);
    if (oc && oc[(j * W + i) * 4] > 170) consider('outcrop', i, j);
    if (tile.rewild && g.annualAt(i, j) === 0.4) consider('rewilded meadow', i, j);
  }
  const ci = Math.floor(x0 / res), cj = Math.floor((tile.size - n0) / res);
  return [{ name: 'start grassland', i: ci, j: cj, d: 0 }, ...Object.values(best)];
}

// Match two record lists plant by plant (same seed, the nearest root within 1 cm) and compare every field
// against a tolerance. Reports plants only one side has (`unmatched` CPU plants, `extraGpu`) and matched
// plants with a field out of tolerance (`fieldDiff`); maxErr is per field over the matched plants.
function compare(cpu, gpu, tol, seedIdx) {
  const map = new Map();
  gpu.forEach((r, n) => { const k = r[seedIdx]; if (!map.has(k)) map.set(k, []); map.get(k).push(n); });
  const used = new Uint8Array(gpu.length), maxErr = tol.map(() => 0), odd = [];
  let unmatched = 0, fieldDiff = 0;
  for (const r of cpu) {
    let hit = -1, best = 0.01;
    for (const n of map.get(Math.fround(r[seedIdx])) || []) { const e = Math.hypot(gpu[n][0] - r[0], gpu[n][2] - r[2]); if (!used[n] && e < best) { best = e; hit = n; } }
    if (hit < 0) { unmatched++; if (odd.length < 4) odd.push(['cpu only', r[0], -r[2]]); continue; }
    used[hit] = 1; let ok = true;
    for (let f = 0; f < tol.length; f++) {
      let e = Math.abs(gpu[hit][f] - r[f]); if (f === 3 && seedIdx === 6) e = Math.min(e, Math.abs(e - Math.PI * 2));
      maxErr[f] = Math.max(maxErr[f], e); if (e > tol[f]) ok = false;
    }
    if (!ok) fieldDiff++;
  }
  const extraGpu = gpu.length - (cpu.length - unmatched);
  gpu.forEach((r, n) => { if (!used[n] && odd.length < 8) odd.push(['gpu only', r[0], -r[2]]); });
  return { cpu: cpu.length, gpu: gpu.length, unmatched, extraGpu, fieldDiff, odd, maxErr: maxErr.map(e => Number(e.toExponential(2))) };
}

// WaterMask's buckets as one u32 array: header [nb, bucket table, ring table, vertices], per bucket
// (offset, segments | rings << 16), the lists (segment: ax, ay, bx, by relative to the bucket's corner,
// half-width; ring: index), ring table (integer origin, bbox relative to it, first vertex, count), vertices
// (x, y relative to the ring's origin). Relative coordinates keep f32 precise (see wgsl.js inWater).
function packWater(wm) {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer), bits = v => { f[0] = v; return u[0]; };
  const nb = wm.nb, B = wm.B, words = [nb, 4, 0, 0], ringIdx = new Map(wm.rings.map((r, i) => [r, i]));
  const table = 4; for (let k = 0; k < 2 * nb * nb; k++) words.push(0);
  for (const [k, b] of wm.buckets) {
    const bx = (k % nb) * B, by = Math.floor(k / nb) * B;
    words[table + 2 * k] = words.length; words[table + 2 * k + 1] = b.segs.length | (b.rings.length << 16);
    for (const s of b.segs) words.push(bits(s[0] - bx), bits(s[1] - by), bits(s[2] - bx), bits(s[3] - by), bits(s[4]));
    for (const r of b.rings) words.push(ringIdx.get(r));
  }
  words[2] = words.length; let v = 0;
  const org = wm.rings.map(r => [Math.floor(r.bbox[0]), Math.floor(r.bbox[1])]);
  wm.rings.forEach((r, i) => { const [ox, oy] = org[i]; words.push(ox >>> 0, oy >>> 0, bits(r.bbox[0] - ox), bits(r.bbox[1] - oy), bits(r.bbox[2] - ox), bits(r.bbox[3] - oy), v, r.ring.length); v += r.ring.length; });
  words[3] = words.length;
  wm.rings.forEach((r, i) => { const [ox, oy] = org[i]; for (const [x, y] of r.ring) words.push(bits(x - ox), bits(y - oy)); });
  return new Uint32Array(words);
}

// A patch of the terrain mesh (grass.js terrainHeight's triangles, 10 m quads split as PlaneGeometry),
// coloured by the tile's ground texture.
function makeTerrain(THREE, T, tile, ground, x0, n0, R) {
  const sp = ground.sp, i0 = Math.floor((x0 - R) / sp), i1 = Math.ceil((x0 + R) / sp), j0 = Math.floor((tile.size - n0 - R) / sp), j1 = Math.ceil((tile.size - n0 + R) / sp);
  const nx = i1 - i0 + 1, nz = j1 - j0 + 1, pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = (i0 + i) * sp, n = tile.size - (j0 + j) * sp, k = j * nx + i;
    pos.set([x, ground(x, n), -n], k * 3); uv.set([x / tile.size, n / tile.size], k * 2);
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + nx, c = b + 1, d = a + 1;
    idx.push(a, b, d, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const tex = new THREE.Texture(tile.textureImage); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  const { texture, uv: uvN, normalWorld, max, dot, vec3, vec4, normalize } = T;
  const mat = new THREE.MeshBasicNodeMaterial();
  const sun = normalize(vec3(0.45, 0.62, 0.64));
  mat.colorNode = vec4(texture(tex, uvN()).rgb.mul(max(dot(normalWorld, sun), 0).mul(0.75).add(0.45)), 1);
  return new THREE.Mesh(geo, mat);
}

// Crossed cards drawn from the draw buffer by instanceIndex, one indirect draw.
function makeGrassMesh(THREE, T, drawAttr, indAttr) {
  const { Fn, storage, instanceIndex, positionGeometry, vec2, vec3, vec4, cos, sin, varying, texture, uv, fract, dot, screenCoordinate, clamp, max, fwidth, mix, step } = T;
  const geo = new THREE.InstancedBufferGeometry();
  const P = [-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 1, 0, 1, -1];
  const UV = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), 1));
  geo.instanceCount = 1; geo.setIndirect(indAttr);
  // Tuft alpha: blades fanning from the root, mipmapped.
  const S = 128, d = new Uint8Array(S * S * 4);
  const blades = Array.from({ length: 11 }, (_, b) => { const a = (b / 10 - 0.5) * 1.5 + Math.sin(b * 7.1) * 0.12, L = 0.75 + 0.25 * Math.abs(Math.sin(b * 3.7)); return [Math.sin(a) * L * 0.5, Math.cos(a) * L]; });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S * 2 - 1, v = 1 - (y + 0.5) / S; let a = 0, t = 0;
    for (const [bx, by] of blades) {
      const h = Math.min(Math.max((u * bx + v * by) / (bx * bx + by * by), 0), 1), ex = u - bx * h, ey = v - by * h, w = 0.05 * (1 - h) + 0.008;
      if (ex * ex + ey * ey < w * w) { a = 1; t = Math.max(t, h); }
    }
    const o = ((S - 1 - y) * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(120 + 135 * t); d[o + 3] = a * 255;
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const sb = storage(drawAttr, 'vec4', drawAttr.count).toReadOnly();
  const iA = sb.element(instanceIndex.mul(2)), iB = sb.element(instanceIndex.mul(2).add(1));
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mat.alphaToCoverage = true;
  mat.positionNode = Fn(() => {
    const A = iA.toVar(), Bv = iB.toVar(), p = positionGeometry, c = cos(A.w), s = sin(A.w);
    return vec3(p.x.mul(c).sub(p.z.mul(s)).mul(Bv.x), p.y.mul(Bv.y), p.x.mul(s).add(p.z.mul(c)).mul(Bv.x)).add(A.xyz);
  })();
  // Colour code: type + 2 role + 8 (card): annual straw, needlegrass grey-green; cards a little darker.
  const vFade = varying(iB.z), code = iB.w;
  const vCol = varying(Fn(() => {
    const ty = code.mod(2), role = code.mod(8).sub(ty).div(2), card = step(7.5, code);
    const col = mix(vec3(0.72, 0.62, 0.38), vec3(0.47, 0.52, 0.36), ty).toVar();
    col.assign(mix(col, vec3(0.40, 0.46, 0.33), step(1.5, role).mul(step(role, 2.5))));
    col.assign(mix(col, vec3(0.80, 0.72, 0.50), step(2.5, role)));
    return col.mul(card.mul(-0.12).add(1));
  })());
  mat.colorNode = Fn(() => {
    const n = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
    n.greaterThanEqual(vFade).discard();
    const t = texture(tex, uv());
    const a = clamp(t.a.sub(0.5).div(max(fwidth(t.a), 1e-4)).add(0.5), 0, 1);
    return vec4(vCol.mul(t.r.mul(1.6)), a);
  })();
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  return mesh;
}

main().catch(e => { RESULT.error = String(e && e.stack || e); log('ERROR ' + RESULT.error); document.title = 'error'; console.error(e); });
