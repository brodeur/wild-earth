# WebGPU evaluation

The roadmap's "Browser push" item 1: should the client move from three.js's WebGLRenderer to
WebGPURenderer (TSL node materials), and what would that buy? Evaluated 2026-10-25 against the
client at three.js r170 (the import map) and the current release, r186.1 (2026-09-24). Written
from the code, the three.js builds on unpkg, a benchmark page run in Chrome on this Mac, and
browser vendors' status pages.

**Verdict: stay on WebGLRenderer for the demo. Plan the port as one cutover, not a module at a
time, and do not start it until a feature needs compute.** On this scene WebGPU is not faster at
drawing. At client-like load it matches WebGL (r186) or is slower (r170). The real gain is GPU
compute: placing 100 k instances takes under 1.2 ms on the GPU against 25-80 ms on the CPU. That
matters for Tsushima-scale ground cover and GPU culling. It does nothing for the fill rate of
overlapping cards, and that fill rate is the client's real limit.

## 1. What WebGPURenderer offers, and whether the client's shaders run on it

**They do not run.** WebGPU has no GLSL. WebGPURenderer turns every material into a node graph
and emits WGSL, or GLSL on its WebGL2 fallback. Built-in materials are converted automatically
(MeshStandardMaterial becomes MeshStandardNodeMaterial). `ShaderMaterial` and `RawShaderMaterial`
have no node class: r170 logs `NodeMaterial: Material "ShaderMaterial" is not compatible`, and
r186 logs the same from NodeBuilder. `onBeforeCompile` is a no-op stub ("onBeforeRender and
onBeforeCompile only supported in WebGLRenderer", r170 `three.webgpu.js`). So every custom
shader in the client and every chunk patch on a built-in material has to be rewritten in TSL.
`wgslFn` in r186 can take raw WGSL functions, but that code would not run on the WebGL2 fallback.

**What a port has to rewrite** (counted from `client/src`, GLSL lines are non-blank lines in
shader template literals):

| Module | GLSL lines | ShaderMaterials | Chunk patches (onBeforeCompile `#include` replaces) | What makes it harder |
|---|---|---|---|---|
| atmosphere.js | 201 | 1 (cloud bake) | 5, on the Sky addon and on every lit built-in material (`applyAtmosphere`) | Holds the shared `ATMOSPHERE_GLSL` (haze, clouds, `csmShadow` with three `sampler2DShadow` PCF lookups). Six modules import it; nine import its uniforms. It becomes a TSL function library, ported first. |
| terrain.js (+ groundDetail.js) | 192 + 18 | 1 | 0 | `GROUND_GLSL`, shared with shrubfield.js |
| shrubfield.js | 381 | 2 | 0 | The largest single shader: procedural crowns, wands and stems with heavy branching. Alpha-to-coverage, dither. |
| grass.js, grassShells.js | 288 + 78 | 3 + 1 | 0 | Two render targets, interleaved-gradient-noise dither on `gl_FragCoord`, alpha-to-coverage, derivative mip selection |
| impostors.js, impostorBake.js | 172 + 14 | 2 + 1 | 0 | Alpha-to-coverage with `fwidth`-sharpened alpha, dither hand-over, atlas bake to a render target |
| treegen.js, vegetation.js | 45 + 16 | 0 | 15 + 4 on Lambert/Standard | Alpha-to-coverage, instanced dither fade. Chunk patching has no node equivalent, so these become node materials with `positionNode`/`colorNode`. |
| rocks.js | 129 | 1 | 9 on MeshStandardMaterial | Dither, `dFdx`/`fwidth` facets and joints, back-face depth material |
| shadows.js | 83 | 3 | 0 | Hand-rolled cascades: depth-compare `DepthTexture`s, a proxy scene sharing instance buffers, `customDepthMaterial` poses |
| water.js | 117 | 1 | 0 | |
| animalModels.js, acorns.js | 132 + 41 | 2 + 2 | 3 + 2 | Vertex-shader part animation and its depth twin |
| wind.js | 12 | 0 | 0 | `WIND_GLSL`, shared |
| **Total** | **~1,920 in 17 modules** | **20** | **~39 at 7 sites** | 5 alpha-to-coverage materials |

**How each technique maps** (each checked in the r170 and r186 builds; the benchmark below uses
the first four):

- Instanced attributes: `attribute('iPos','vec4')` on an `InstancedBufferGeometry` works.
  WebGPU's vertex stepMode follows `isInstancedBufferAttribute`, and the draw uses
  `geometry.instanceCount`.
- Screen-space dither: `screenCoordinate` stands in for `gl_FragCoord`, and `cond.discard()`
  for `discard`. It is the same expression.
- Alpha-to-coverage: `material.alphaToCoverage` sets `alphaToCoverageEnabled` on the WebGPU
  pipeline when MSAA is on. The client's sharpening, `(a - 0.5) / fwidth(a) + 0.5`, ports as is.
- Derivatives: `fwidth`, `dFdx` and `dFdy` exist in TSL.
- Custom shadow sampling: `DepthTexture` with a compare function and TSL's compare sampling
  cover `sampler2DShadow`. The proxy-scene design in shadows.js can stay; only its depth
  materials change. three's own `CSMShadowNode` exists, but it does not do the per-cascade
  caster sets.
- Render targets (cloud bake, impostor bake, grass): `RenderTarget` works the same way.
- Porting aid: the GLSL-to-TSL transpiler (`examples/jsm/transpiler`, in both r170 and r186)
  gives a first draft. It does not port chunk-patched built-ins or include structure, and every
  shader still needs a visual check against the WebGL version.

**Effort, roughly.** About 1,900 GLSL lines become roughly the same amount of TSL, which is
wordier: `a.mul(b).add(c)`. Then each module needs a side-by-side visual match. Small modules
(wind, water, terrain, acorns) take about a day each. atmosphere.js plus the shadow sampling
take two to three days. treegen/vegetation/rocks take two to three days, because of the
chunk-patched lit materials. shrubfield, grass and impostors take three to five days. In all,
about three to four weeks of focused work. Before that, the client must move to a current three
(see below).

**Mixed path.** One renderer draws a scene, and WebGLRenderer cannot draw node materials, so a
module-by-module port inside the running client ships nothing until the last module is done.
Keeping GLSL for WebGLRenderer and TSL for WebGPURenderer side by side would double the shader
code, which is not practical. The practical mixed path is TSL only: WebGPURenderer uses WebGPU
where it exists and falls back to its own WebGL2 backend elsewhere, from the same TSL. The
benchmark measured that fallback at 40-115% slower than today's WebGLRenderer on light frames.
So people without WebGPU would get a slower client than they have now.

**Version.** r170 is from 2024-10-31, and its WebGPU path is immature. It renders every frame
into an MSAA half-float target and then runs a separate output pass for tone mapping. In the
benchmark that cost 1.5-3 ms a frame against r186. The r170 WebGPU build is also a full second
copy of the core, so `three` and `three/webgpu` cannot be mixed. r171+ share `three.core.js`, and
r186 has `three/tsl` as its own entry. It also adds `instancedArray`/`attributeArray`,
`IndirectStorageBufferAttribute` with `drawIndirect`, `BundleGroup` render bundles, storage and
array textures, atomics, subgroups, and TSL post nodes (GTAO, SSR, SSGI, TRAA, god rays). Any
port starts with moving the client to the current release on WebGLRenderer. That step is cheap
to measure on its own: r186 WebGLRenderer was as fast as or faster than r170 on every benchmark
run.

## 2. What WebGPU would buy here, and what it would not

**It would buy:**

- **Compute placement.** Today the CPU builds every grass and shrub cell and every rock set.
  shrubfield.js generates "a couple of ms per frame" of cells, and the rest are cached. Measured:
  placing 100 k instances (hash, then a six-octave height field) took 25-60 ms on the CPU in the
  page, against 0.8-1.1 ms on the GPU including the sync round trip. For 1 M instances it was
  244-307 ms on the CPU against 0.5-1.2 ms on the GPU. Ground cover could be regenerated around
  the camera every frame instead of cached per 30 m cell. That is what Ghost of Tsushima does
  (docs/grass-notes.md).
  - Caveat 1: WebGL2 can already place instances procedurally in the vertex shader, from
    `gl_InstanceID` plus the height and habitat textures. That gets part of the gain with no
    WebGPU.
  - Caveat 2: gameplay that needs positions on the CPU (acorns, identify, collisions) then needs
    a readback.
- **GPU culling with indirect draws.** A compute pass can cull, compact the surviving instances
  and write an indirect draw count, so hidden cards are never submitted. This includes Hi-Z
  occlusion of trees behind ridges. WebGL2 cannot do this. Core WebGPU has single `drawIndirect`,
  not multi-draw-indirect.
- **Storage buffers.** Impostor atlas metadata, per-species parameters, and the clump fields' own
  instance data could live in storage buffers instead of attribute and uniform packing. This is
  convenient, but it is not a speed-up by itself.

**It would not buy:**

- **Raw instancing throughput.** In three.js, CPU cost per draw was higher on WebGPURenderer
  (r170, 653 draws: 2.7 ms CPU per frame against 1.1 ms), about 3.8 µs against 1.6 µs per draw.
  Render bundles (`BundleGroup`, r186) could win that back for static sets. The client issues
  about 200 draws, so neither renderer is draw-bound.
- **Bindless textures.** WebGPU has none yet. Texture arrays exist in WebGL2 already
  (`sampler2DArray`), so there is no new capability here.
- **Fill rate.** Overlapping alpha-to-coverage cards cost the same raster and blend work on the
  same Apple GPU through either API. In the fill-bound 4K test, r186 WebGPU took 8.1 ms per frame
  and WebGL 8.7. The client's cost lives in overdraw from canopies, shrub cards and grass tufts,
  plus shadow re-renders. WebGPU helps there only indirectly, by drawing fewer cards through
  compute culling and LOD selection.

## 3. Measurement

**Page:** `client/webgpu_test.html` with `client/src/webgpuTest.js`, standalone; it imports nothing
from the client. One renderer per page load (`?r=webgl | webgpu | webgpu-gl`), and `?v=` picks the
three.js version from unpkg. The scene is written twice, as GLSL ShaderMaterials and as TSL node
materials. The geometry, instance buffers, textures, camera, animation time and buffer size are
the same in both. The scene:

- terrain: a ~1.0 M-triangle mesh, lambert sun, two ground-texture samples, height haze;
- cards: 100 k instanced crossed cards in 196 spatial chunks (two vec4 instance attributes, vertex
  wind sway, a leaf alpha texture sharpened for alpha-to-coverage under 4x MSAA, and the client's
  interleaved-gradient-noise dither fade by distance);
- sky: a full-screen dome with a sun lobe and four octaves of value-noise cloud;
- one shared atmosphere function used by all three, the way `ATMOSPHERE_GLSL` is shared;
- ACES tone mapping to sRGB.

All three renderers produce the same image (screenshots compared).

**Where it ran:** headless Chrome 156.0.8078.47 on this M1 Pro (macOS 15.7.3), with `--enable-
unsafe-webgpu`, driven over the DevTools protocol. The built-in browser pane was at its tab cap,
so the run used headless Chrome. Adapters: WebGL is "ANGLE Metal Renderer: Apple M1 Pro"; WebGPU
is "apple / metal-3". Drawing buffer 1920x1080 at pixel ratio 1 unless noted.

**Load on the machine:** other GPU work was running throughout: the user's own Chrome (renderers
at 60-170% CPU) and the Claude browser pane with the client. Absolute numbers are noisy by about
±0.5 ms. Runs were interleaved, and the ordering held across repeats.

**Metric:** "Uncapped" is wall time per frame for 60 frames rendered back to back and then waited
on (a WebGPU queue fence or a WebGL fence sync), median of 9 runs. It is the comparable
throughput number. Presented frames at vsync were 16.7 ms (60 fps) in every configuration, because
the scene fits the budget everywhere. GPU timestamps were available in both APIs, through
`EXT_disjoint_timer_query_webgl2` and WebGPU `timestamp-query`. They time different spans and
were taken while paced at 60 Hz, when the GPU clocks down. They are listed, but they are not the
comparison.

| Configuration (drawn triangles, draws) | WebGL r170 | WebGPU r170 | WebGPU r186 | WebGL r186 | WebGPU r186, WebGL2 fallback |
|---|---|---|---|---|---|
| Start view, 150 m up, 100 k cards (1.3 M, 154) | 3.0 | 5.9 | 4.1-4.3 | 2.6-2.9 | 3.8 (r170 fallback: 4.5) |
| Same, no tone mapping (no output pass) | 2.8 | 4.2 | 4.2 | | |
| Same, no MSAA | | | 3.7 | 2.0 | |
| 20 m low pass (1.2 M, 100) | 2.1 | 4.9 | | | (r170) 4.0 |
| 2 m in the cards (1.2 M, 86) | 1.9 | 4.0 | | | (r170) 4.0 |
| 653 draws instead of 154: frame / CPU in `render()` | 3.6 / 1.1 | 6.2 / 2.7 | | | |
| Fill-bound: 4K, 400 k cards, 2 m in them (1.7 M, 86) | 9.1 | 11.3 | **8.1** | **8.7** | |
| Client-like geometry: 4.5 M terrain + 400 k cards (5.7 M, 154) | 10.0 | 12.2 | **9.5** | **10.0** | |

All figures are milliseconds per frame, uncapped (lower is better).

Other numbers:

- GPU timestamps, start view (ms): WebGL 3.2-4.0, WebGPU 3.8-4.9. With no output pass: WebGL 4.0,
  WebGPU 2.6. At 5.7 M triangles: WebGL 7.9, WebGPU 10.3-10.4.
- First frame on a cold shader cache (pipeline creation): WebGL 570 ms, WebGPU 921 ms (r170) and
  1,025 ms (r186), WebGL2 fallback 600-756 ms. With a warm cache, all are 50-170 ms.
- Placement (section 2): 100 k on the CPU 25-60 ms against the GPU 0.8-1.1 ms; 1 M on the CPU
  244-307 ms against the GPU 0.5-1.2 ms. The GPU figures are dominated by the sync round trip.

What the numbers say:

- At the client's real scale (millions of triangles, heavy fill), current three.js on WebGPU
  matches WebGL, within 5%.
- On light frames WebGPU carries about 1.5 ms of fixed overhead per frame, and r170 adds another
  1.5-3 ms for its output pass.
- The TSL WebGL2 fallback is slower than today's WebGLRenderer.
- No configuration showed WebGPU drawing the same thing faster by a margin that matters. The
  gain is in what compute makes possible, not in drawing.

Safari and Firefox were not run. The installed Safari is 18.6 and Firefox is 136, and neither has
WebGPU on by default on this macOS 15 machine. Driving them would also have meant changing system
or browser settings.

**Browser support as of October 2026** (sources below):

- **Chrome and Edge:**
  - macOS, Windows and ChromeOS since 113.
  - Android 12+ on Qualcomm, ARM and Intel GPUs since 121, and on Imagination since 139.
  - Linux: Intel Gen12+ since 144 and NVIDIA on Wayland since 147. Other Linux setups are behind
    a flag.
  - Windows on ARM is behind a flag.
- **Safari:** WebGPU is on by default from Safari 26: macOS Tahoe 26, iOS 26, iPadOS 26 and
  visionOS 26, shipped September 2025. Older macOS and iOS versions, including this Mac's Safari
  18.6, do not have it.
- **Firefox:**
  - Windows since 141.
  - macOS on Apple Silicon since 145 (macOS 26+), with all macOS versions listed from 147.
  - Linux is Nightly only (expected 2026).
  - Android is behind a flag.

## 4. Recommendation

**Stay on WebGLRenderer for the demo.** The success metric is "a resident finds their own hill
from the air". It depends on likeness, the photo, the forest's composition and the silhouettes,
and none of these is limited by the graphics API. WebGPU would not make today's frame faster.
Many people would also lose: anyone on a Mac or iPhone not yet on the 26 releases, anyone on
Firefox outside Windows and new Macs, and most of Linux. On WebGPURenderer they would fall back
to a renderer slower than the one they have now.

**Do now (cheap, no port):**

1. Move the client from r170 to the current three.js on WebGLRenderer. It measured as fast or
   faster, and the port depends on it.
2. Keep any new shader code easy to port: shared chunks as small, pure functions (like
   `atmosphere.js`), and no new chunk patching of built-in materials where a ShaderMaterial would
   do.

**Next WebGPU step: a prototype, not a client module.** Extend `webgpu_test.html` into a
compute-driven ground-cover field. A compute pass places and culls clumps from the habitat and
height rasters around the camera every frame, and an indirect draw shows the survivors.
Measure the density reachable at equal frame time against shrubfield.js and grass.js. If it
clearly beats the CPU cell cache (the Tsushima-scale grass the roadmap item names), the port
has a reason.

**The port, when it comes, is one branch and one cutover.**

- **Order:**
  1. three upgrade.
  2. atmosphere.js, wind.js and terrain's `GROUND_GLSL` as a TSL function library.
  3. terrain and sky (r186's SkyMesh is TSL).
  4. shadows.js depth proxies and the `csmShadow` sampling.
  5. treegen.js and vegetation.js (chunk patches become node materials).
  6. impostors.js and the bake.
  7. shrubfield.js.
  8. grass.js and grassShells.js (where compute placement then lands).
  9. rocks.js.
  10. water.js.
  11. animals and acorns.
- **Each module** is checked against WebGL screenshots from the lineup and start views.
- **Ship gate:**
  - WebGPU at least as fast as WebGL on the start view and the low pass.
  - The WebGL2 fallback within about 15% of today's WebGLRenderer, or a decision to keep the old
    client for non-WebGPU browsers.
- **Risks:**
  - Browser reach (above).
  - Safari's WebGPU is young.
  - Mobile GPUs are fill-limited, so phones need a lighter scene whatever the API.
  - TSL still changes between three.js releases.
  - Three to four weeks of porting with no visible change.

**What "astonishing" would take, and whether it needs WebGPU:**

| Effect | Needs WebGPU? |
|---|---|
| Dense ground cover with GPU culling (Tsushima-scale grass and chaparral, more foliage instances) | **Yes, in practice.** Compute placement, culling and indirect draws are the WebGPU-only win measured here. |
| Global illumination: sky occlusion and bounce light under canopies | **No.** A per-tile irradiance or bent-normal bake in the pipeline needs neither. Screen-space GI (SSGINode, TSL, added after r170) runs on WebGPURenderer and, slower, on its fallback. |
| Volumetric clouds (raymarched, lit) | **No, but compute helps.** A fragment raymarch with temporal reprojection works in WebGL2; the client already raymarches a slab. Compute and 3D storage textures make froxel fog and low-res cloud passes cheaper. |
| Screen-space effects: GTAO, SSR on ponds, temporal AA for foliage shimmer | **No, but the momentum is there.** They work in WebGL2. three.js's newer ones (TRAA, SSGI, GTAO, SSR) are TSL nodes for WebGPURenderer, and the GLSL EffectComposer path gets no new work. |
| Hi-Z occlusion culling behind ridges | **Yes** (compute). |

So the honest answer to the decision log's open question is:

- The browser can astonish because the place is real.
- WebGPU's part in that is density (many more plants placed and culled on the GPU), not better
  pixels.
- The better pixels (GI, clouds, AA) are available on WebGL today, at the cost of building them.

## Sources

- three.js r170 and r186.1 builds on unpkg: `build/three.webgpu.js` (ShaderMaterial
  incompatibility, `onBeforeCompile` stub, `alphaToCoverageEnabled`, timestamp queries, the
  frame-buffer target and output pass), `package.json` exports (`./webgpu`, `./tsl`), and
  `examples/jsm/transpiler`, `examples/jsm/tsl/display`. Release dates from registry.npmjs.org.
- [WebGPU Implementation Status, gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) (last edited 2026-10-02).
- [WebGPU is now supported in major browsers, web.dev](https://web.dev/blog/webgpu-supported-major-browsers) (2025-11-25).
- [Khronos, WebGL and WebGPU at SIGGRAPH 2026](https://www.khronos.org/developers/linkto/webgl-and-webgpu-sigg26) (page too large to open; its dates are from the search summary: Safari WebGPU everywhere September 2025, Android compatibility mode on GLES 3.1 February 2026).
- The client's own numbers: docs/report-2026-10-25-morning.md (5.5 M triangles, 179-214 draws,
  61-69 fps on this machine).
