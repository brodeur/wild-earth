import * as THREE from 'three';

// Letting go of the CPU side of what lives on the GPU (2026-10-27: a loaded tile held 550-700 MB of JS heap, 200 MB of
// it copies of uploaded data). three keeps every geometry's attribute arrays and every DataTexture's bytes after it
// has uploaded them, to upload again on a needsUpdate, a dispose and redraw, or a lost context. A world is built once
// and disposed with its geometries and textures (main.js disposeWorld), so for the static ones that copy is dead weight.
//
// releaseGeometry(g, { keep, keepIndex }): once a static attribute of g is uploaded (BufferAttribute.onUpload, which
// WebGLAttributes calls right after its gl.bufferData, on the first draw) its array is dropped, except the attributes
// named in `keep` and, with keepIndex, the index: whatever a CPU reader still needs (a raycast wants position and
// index, identify.js's pick the canopy's uv and leafRank too; the fine terrain cuts its hole by rewriting the coarse
// chunks' index). Dynamic attributes (usage DynamicDrawUsage: instance seats, per-frame buffers)
// and interleaved ones are never touched. The bounds are computed first, since a frustum test or a raycast would
// compute them from the array later. A released attribute cannot be uploaded again: never set needsUpdate on it,
// clone it, or dispose the geometry and draw it again. A geometry never drawn keeps its arrays (the callback never
// runs), so an entry only ever drawn far away costs what it always did.
//
// releaseTexture(t): a DataTexture or DataArrayTexture's image bytes and mip levels are dropped once three has
// uploaded them (Texture.onUpdate, called at the end of WebGLTextures.uploadTexture); dropTextureData(t) drops them
// now, for a texture uploaded another way (gpuUpload.js's banded path replaces it with an ExternalTexture). Never for
// a texture uploaded again later (the season map, rewritten when the date changes) or whose pixels the CPU reads
// (the leaf textures: identify.js's opaque(); the far bake reads them while it bakes, before this).

const drop = function () { this.array = null; };

export function releaseGeometry(g, { keep = [], keepIndex = false } = {}) {
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  for (const [name, a] of Object.entries(g.attributes)) {
    if (keep.includes(name) || a.isInterleavedBufferAttribute || a.usage !== THREE.StaticDrawUsage) continue;
    a.onUpload(drop);
  }
  if (g.index && !keepIndex && g.index.usage === THREE.StaticDrawUsage) g.index.onUpload(drop);
  return g;
}

export function dropTextureData(t) {
  const im = t.image;
  if (im && Object.getPrototypeOf(im) === Object.prototype && 'data' in im) im.data = null;   // a DataTexture's { data, width, height }
  if (t.mipmaps?.length) t.mipmaps = [];
  return t;
}

export function releaseTexture(t) {
  t.onUpdate = () => { t.onUpdate = null; dropTextureData(t); };
  return t;
}
