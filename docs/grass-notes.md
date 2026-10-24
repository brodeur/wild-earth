# Grass and shrubland from the air: notes

The camera is now a chase camera 5-150 m above ground, looking down 20-60 degrees. The band that
matters is 5-150 m slant range. Eye-level grass (grass.js, grassBlades.js) is good but rarely seen.
These notes cover what shipped games do for grass and scrub at this range, what fits a WebGL2
three.js client with no compute or mesh shaders, and what we built.

Sources: secondary write-ups were opened where the primary decks were unreachable (GDC Vault was
down during research), and the marks below say which. Numbers from secondary sources are as
reported, not checked against the decks.

## What shipped games do

**Ghost of Tsushima** (Wohllaib, GDC 2021; summaries at tigerabrodi.blog and gist.ly, opened):
- Generation: a compute pass per terrain tile reads height, grass-type and height maps, culls,
  and writes blade instances, drawn with no vertex streams.
- Blades: cubic Bezier blades. Normals are tilted outward so a flat blade shades as if round.
  Edge-on blades are pushed apart in view space so they never collapse to a sliver.
- Clumping: Voronoi clumps share height, facing and colour, so the clump is the unit of variation.
- LOD: 15 vertices near, 7 far. Far tiles are twice the size with the same blade count, and near
  tiles drop 3 of 4 blades before the switch.
- Wind and far field: one global wind field (noise plus "vorticles") feeds grass, trees, cloth and
  particles. Past grass range, artist-painted far textures avoid the flat monotone ground.
- Fit: no compute in WebGL2, so generation moves to the CPU. That is what we already do: cached per
  30 m cell. The rest (shared wind, clump-level variation, density traded for size, a dressed far
  ground) carries over, and we use all four.

**Horizon Zero Dawn** (van Muijden GDC 2017, Sanders GDC 2018; via csarko.sh, opened):
- Placement: deterministic GPU placement from density graphs.
- Grass: 10-36 triangle grass LODs. Normals use abs(view z), so cards always light as if facing
  the camera. A camera-based tilt keeps cards from showing an edge, and far grass sinks into the
  ground instead of popping.
- Rendering: a depth prepass then an EQUAL colour pass, and a global wind field around the player.
- Fit: all of it is vertex-shader work. We already flip normals to the camera and sink far grass.
  We added the tilt.

**Breath of the Wild** (CEDEC notes via thefamicast, opened; the rest is community analysis and
unverified):
- Few, low-poly blades with a strong root-to-tip colour ramp and per-clump palette.
- Detail is deliberately simplified with distance: art direction, not technology.
- Fit: our blades already ramp root to tip. The lesson is to stop drawing what does not read.

**Terrain-colour sampling:**
- Witcher 3: "pigment", the grass vertex shader samples the terrain colour.
- MSFS 2020/24: vegetation impostors are tinted from the aerial photo under them (SDK docs, opened).
- GPU Gems 2 ch.1: clumps lit exactly like the ground beneath them (opened).
- Fit: trivial in WebGL2 with vertex texture fetch. It is the single most important trick for an
  invisible handover to a photo texture.

**Shells:**
- Lengyel 2001 fur shells. Shipped in Shadow of the Colossus fur, Viva Pinata and Spider-Man 2
  grass (80.lv, opened).
- They fail at grazing angles, where the layers separate.
- Fit: a down-looking camera is the best case for shells. Fade them out toward grazing angles.

**Clump impostors and density-scaled LOD:**
- AMD's procedural grass widens survivors as the blade count drops (`width *= max/count`), so
  cover holds (gpuopen, opened).
- Ghost Recon Wildlands sets impostor distance by local density, with several growth stages per
  species (80.lv, opened).
- MSFS uses octahedral impostors per species, tinted by the aerial photo.
- Fit: instanced quads with per-pixel shading are cheap in WebGL2. Thin-and-grow is the
  "clump models that change with distance" idea: far away an impostor stands for a patch of
  plants, not one swollen plant.

**Ground-texture tricks:**
- Habel 2007 "Instant Animated Grass": gusts done entirely in the terrain shader by scrolling
  noise.
- The Hexaquo Godot series reuses the near grass's colour and wind noise on the far ground plane,
  so the handover is seamless.
- Fit: free. The terrain shader samples the blades' own gust field inside the grassland mask.

**Shrubland from the air:**
- No public tech material exists for RDR2's sage flats or the Assassin's Creed foliage
  impostors; claims about them would be guesses.
- MSFS is the closest public analogue to this camera: species impostors tinted by the photo,
  over a ground that already carries the dark-dot pattern of the scrub, so thinning never
  exposes bare ground.

## What fits this camera

For a raven at 5-150 m:

1. The ground carries everything past ~60 m. It must look like what it is, at the grain the eye
   expects for that distance.
2. Geometry is only worth its cost where it adds relief or parallax: shells for the sward to
   ~60 m, impostor clumps where plants are discrete (tussocks, shrubs).
3. Everything takes its colour from the ground under it, so no handover is visible.

## What we built (client/src)

- **wind.js:** one gust field (uniforms and GLSL) shared by blades, tufts, shells, clumps and the
  terrain.
- **terrain.js:**
  - GROUND_GLSL and groundUniforms: the season-recoloured ground albedo as a function any
    material can call, sharing the terrain's texture and uniform objects.
  - In the grassland mask: sward grain at 0.22, 0.8 and 2.6 m, each faded by its pixel footprint,
    and the gust sheen (+-6%, to 420 m).
  - In the chaparral mask: shade mottling between crowns.
- **grass.js:**
  - Blades and tufts match the ground colour at their root. Near the camera a blade keeps its
    palette (it must stand out paler than the ground, as real wisps do) and takes only the ground's
    local patchiness: the texel over a ~600 m mip average. From 12 to 45 m it shifts to keeping its
    own variation as a ratio to its type's mean while taking the mean from the ground, so the far
    sward is exactly the colour of the texture it hands over to. A first version matched fully
    near the camera and made eye-level blades vanish into the ground.
  - Blades and tufts lean away from the camera by half the view's depression angle (at most 26
    degrees), so from above they show faces, not edges.
- **grassShells.js:** four shells on a 2 m grid that conforms exactly to the terrain triangles,
  8-62 m from the camera.
  - The bottom shell is a full dark floor, the shade inside the sward. Above it, two jittered tuft
    lattices at different scales and angles: each tuft is a leaning, star-edged cone with its own
    height, swaying with the gusts.
  - Fades toward grazing views. Colour, light and haze are per vertex, so the fragment shader is
    hash maths only.
  - Only when the camera is above 6-10 m: lower down, the shells' depth hides the blades, which
    carry eye level. The shrub and tussock impostors likewise start 25-60 m out when the camera is
    below 8 m.
- **shrubfield.js (ClumpField):** one camera-facing quad per plant, shaded per pixel as a lobed
  ellipsoid. The normal is rebuilt from the quad, and lobes come from 3D noise on that normal, so
  they stay on the plant as the camera turns.
  - Density LOD: full density to D0, then (D0/d)^2 kept, with survivors grown by 1/sqrt(keep). The
    CPU submits only the prefix of each cell's randomly ordered list that the LOD can keep.
  - ShrubField: chaparral cells filled to their canopy shrub % (floor 30%) with chamise and
    manzanita in stands ~45 m across, out to 430 m (silhouettes: see the second pass below).
  - GrassClumps: purple needlegrass tussocks at 12-225 m.
  - StalkClumps: dry wild oat stands, summer and fall, 10-240 m.

## Second pass: canopy shade, the sward from 120 m, shrub silhouettes

**Canopy occlusion.** terrain.js exports `groundSkyOcclusion(uv)` (tree and shrub cover from the
canopy raster) and `groundContactAO(posW)` (a soft blob under each near tree, from shadows.js).
Every grass and shrub material now multiplies its sky/ambient term by both, as the terrain does:
blades and tufts (per vertex, at the root, `skyOcc` in grass.js), shells (per vertex), tussocks
and oat stands (per instance). Shrub crowns take only the tree part of the cover term: they are the
shrub layer, so the shrub-cover share would darken them for shading themselves. The sun term
already had the cast shadow (cloudShadow). Measured on screen in oak woodland at 20 m, the sward
is 2.3% darker in mean luma with the terms than without, and the same in the open to within 0.5%.
That is the terrain's own factor: ambient is a small share of a sunlit pixel, so the cast shadow
still does most of the work under a crown.

**Grassland from 60-200 m.** At 120 m the far tussock tier had ended (120 m) and what was left
was the photo plus the terrain grain, so an annual hillside read as a smooth print.
- The tussock tier runs to 225 m. LOD: D0 34 m, floor 0.14, so far survivors grow ~2.7x and an
  impostor stands for a patch of tussocks. Tussocks are placed in drifts (18 m and 6 m noise),
  not an even sprinkle: needlegrass holds some ground and the annuals the rest.
- In the dry season tussocks are darker and greyer than the sward (needlegrass stays grey-green
  while the annuals cure gold). The bright fountain rim fades out on a grown far impostor.
- Clump colour exaggerates the photo's patches: the texel against its ~80 m mean (mip 6.5), as a
  luminance ratio^0.7 and a hue shift, so swales and greener or more cured patches carry into the
  clumps instead of being averaged out.
- Wild oat stands (StalkClumps, kind 4): sparse pale sprays of culms and panicles, 0.85-1.3 m
  tall, in stands 10-30 m across where annuals are thickest, plus a thin scatter; off in winter
  and spring (`dry` < 0.3, a per-season palette value). The colour is the ground's times a
  paler-yellower factor, never an absolute straw: an absolute straw colour turned to snow on pale
  slopes. The shading has no outline: density falls off from the centre, panicles are fine specks,
  culms vertical streaks, and far off the specks coarsen with the pixel footprint and fill in, so a
  stand reads as a paler patch. A separate field, so it is not among shadows.js's clump casters:
  a solid ellipse shadow under an airy spray would print a dark blob.
- Tried: a disc-edged stand with an absolute straw colour (white "cotton balls" at 30-60 m, the
  same failure as the first pass's annual clumps); brighter specks (read as litter or flowers).

**Shrub silhouettes.** Variants ride in the instance seed's fractional part, so the instance
layout, and shadows.js's casters, are unchanged.
- Every crown is a cluster: a main crown and two smaller ones offset to the sides; each pixel is
  shaded on the dome of the crown it is deepest inside, so the outline is lumpy and the shading
  has hollows between masses. A mid octave of lobes and vertically stretched "stem" noise break
  the edge into spikes rather than bumps. Up close, a fine octave cuts small dark gaps between
  sprays.
- Chamise: rounded (~40%), ragged vase (narrow base, spiky top), and vase with grey dead stems
  poking past the leafy outline (more in old stands). In summer and fall some carry rust-brown
  dried flower clusters on the top.
- Manzanita (whiteleaf): upswept with its red-mahogany trunks showing under the foliage and in the
  deepest holes, sprawling (H/D 0.5-0.7, more on thin cover), and open (more holes, more red).
- Size follows the canopy shrub % (x0.62 + 0.62 * cover) and a 28 m stand-age noise. Openings of
  a few to ~15 m in about a tenth of the ground, more where cover is thin.
- Palette: chamise dark olive, manzanita paler grey-green to glaucous, each varied per plant from
  cool grey-green to warm olive-yellow and by stand (a 40 m noise).
- Limits: the red branching is legible from 10-30 m but not from 60 m (it is under the crown);
  below ~12 m a crown is still a soft impostor, and the 3D shrubs of vegetation.js carry that range.

## Tried and dropped

- **Annual-grass clump impostors:** cotton balls and cookies from the air. Annual grass is a
  continuous sward, so the shells and terrain grain carry it.
- **Shell strokes (anisotropic noise):** moire "fingerprints".
- **Single-lattice dots on the terrain:** the grid showed from the air.

Costs and screenshots are in the hand-off report for this work.

## Third pass (2026-10-25): the bare ring at ground level

Report: "about 30 m around me becomes invisible". Cause: the near blades were tuned for
a level eye at 2 m, but since the third-person camera landed it sits ~4 m up and 5.5 m
behind the bird, looking down 15-50° at the near ring, where 5-15 cm fall blades covered
only 1-6% of the lower screen; past the close tier's 16-30 m handover only the sparse
main tier remained, and tufts did not start until 55-85 m. Changes: a ground tier of
8 extra clumps/m² within ~16 m (thinning as the camera climbs 8-14 m where the shells
take over), tufts dithering in at 26-38 m, near clumps culled in 10 m blocks (which
pays for the ground tier), and bare patches keep 40% of their clumps so they read as
thin ground rather than holes. Shells stay off below 6-10 m (they bury the blades up
close); tussocks stay at 45-60 m. No extra GPU cost; low flight is smoother (worst
frame 109 -> 30 ms).
