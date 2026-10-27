import * as THREE from 'three';

// Large textures to the GPU a band of rows per step (2026-10-26, the opening screen's responsiveness): three uploads a
// texture in one call on first use, 50-350 ms for the 4000 px ground photo or the impostor atlases, a task the opening
// screen cannot answer a click in. These generators (stepped by slice.js runSliced; a yielded promise is waited for)
// make a texture with the storage, sampler and mip chain three would give `t`, fill it a band at a time, and return a
// THREE.ExternalTexture over it, for the caller to put where `t` was. The texel bytes are three's own (checked by
// reading both back): the same unpack rules (an image file decoded with no colour conversion and no premultiply,
// flipped as t.flipY says; a DataTexture's arrays as they are). `t` itself is never uploaded. GL state goes through
// renderer.state (three caches the bound textures), and the pixel-store state is left alone: an ImageBitmap or an
// array view ignores the flip and premultiply flags, and three keeps the row-skip ones at 0 between its own uploads.

const filterOf = (gl, f) => ({ [THREE.NearestFilter]: gl.NEAREST, [THREE.LinearFilter]: gl.LINEAR, [THREE.LinearMipmapLinearFilter]: gl.LINEAR_MIPMAP_LINEAR,
  [THREE.LinearMipmapNearestFilter]: gl.LINEAR_MIPMAP_NEAREST, [THREE.NearestMipmapLinearFilter]: gl.NEAREST_MIPMAP_LINEAR, [THREE.NearestMipmapNearestFilter]: gl.NEAREST_MIPMAP_NEAREST })[f];
const wrapOf = (gl, w) => w === THREE.RepeatWrapping ? gl.REPEAT : w === THREE.MirroredRepeatWrapping ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;

export const canBand = renderer => typeof createImageBitmap === 'function' && !!renderer.getContext().texStorage2D;

function begin(renderer, t, W, H, levels) {
  const gl = renderer.getContext(), tex = gl.createTexture(), st = renderer.state;
  const bind = () => st.bindTexture(gl.TEXTURE_2D, tex);
  bind(); gl.texStorage2D(gl.TEXTURE_2D, levels, t.colorSpace === THREE.SRGBColorSpace ? gl.SRGB8_ALPHA8 : gl.RGBA8, W, H);
  return { gl, tex, st, bind };
}
function finish(renderer, t, { gl, tex, st, bind }, generate) {
  bind();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapOf(gl, t.wrapS)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapOf(gl, t.wrapT));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterOf(gl, t.magFilter)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterOf(gl, t.minFilter));
  const an = gl.getExtension('EXT_texture_filter_anisotropic');
  if (an && t.anisotropy > 1) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(t.anisotropy, renderer.capabilities.getMaxAnisotropy()));
  if (generate) gl.generateMipmap(gl.TEXTURE_2D);
  st.unbindTexture();
  const ext = new THREE.ExternalTexture(tex);
  ext.colorSpace = t.colorSpace; ext.userData.banded = { from: t };
  return ext;
}

// An image texture (t.image an HTMLImageElement carrying its file's bytes as image.blob, tilepackage.js), RGBA8 or
// sRGB, with three's generated mipmaps where t asks for them.
export function* uploadImageSteps(renderer, t, BAND = 400) {
  const img = t.image;
  const bmp = yield createImageBitmap(img.blob, { imageOrientation: t.flipY ? 'flipY' : 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: t.premultiplyAlpha ? 'premultiply' : 'none' });
  const W = bmp.width, H = bmp.height, mips = t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter;
  const g = begin(renderer, t, W, H, mips ? Math.floor(Math.log2(Math.max(W, H))) + 1 : 1);
  for (let y = 0; y < H; y += BAND) {
    const h = Math.min(BAND, H - y), band = yield createImageBitmap(bmp, 0, y, W, h);
    g.bind(); g.gl.texSubImage2D(g.gl.TEXTURE_2D, 0, 0, y, W, h, g.gl.RGBA, g.gl.UNSIGNED_BYTE, band); band.close();
    yield;
  }
  bmp.close();
  const ext = finish(renderer, t, g, mips);
  ext.userData.banded.image = img;
  return ext;
}

// A DataTexture of RGBA bytes with its own mip chain (t.mipmaps: [{ data, width, height }], as impostorBake.js makes),
// level by level, BYTES at a time.
export function* uploadDataSteps(renderer, t, BYTES = 4 << 20) {
  const L = t.mipmaps, g = begin(renderer, t, L[0].width, L[0].height, L.length);
  for (let l = 0; l < L.length; l++) {
    const { data, width: w, height: h } = L[l], rows = Math.max(1, Math.floor(BYTES / (w * 4)));
    for (let y = 0; y < h; y += rows) {
      const n = Math.min(rows, h - y);
      g.bind(); g.gl.texSubImage2D(g.gl.TEXTURE_2D, l, 0, y, w, n, g.gl.RGBA, g.gl.UNSIGNED_BYTE, data.subarray(y * w * 4, (y + n) * w * 4));
      yield;
    }
  }
  return finish(renderer, t, g, false);
}
