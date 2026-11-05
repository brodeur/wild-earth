import { meshChunk } from './digMesh.js';

// Dig's mesher off the main thread (digCarve.js asks): a chunk of the soil's surface per message. In: {jid, job} (the
// job as meshChunk takes it); out: {jid, ms, res} with the result's arrays transferred.
self.onmessage = m => {
  const { jid, job } = m.data, t0 = performance.now();
  let res;
  try { res = meshChunk(job); } catch (e) { self.postMessage({ jid, error: String(e) }); return; }
  self.postMessage({ jid, ms: performance.now() - t0, res }, [res.pos.buffer, res.nrm.buffer, res.mix.buffer, res.gref.buffer, res.idx.buffer]);
};
