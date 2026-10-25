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

Report (2026-10-25): "grass and small shrubs/herbs disappearing when I get close".
Two causes. From the air between about 8 and 30 m up the blade clumps are sub-pixel,
the shells are too faint on a cured tan sward, and the tufts only dithered in at 26-38 m,
so a bare disc opened around the camera as you came down; the tufts now come in from
9-15 m once the camera is 6-10 m up and more (the same height blend the tussock
impostors use), sliding back to 26-38 m at eye level where the blade tiers carry.
In chaparral the shrub impostors were cut 3-8 m from the camera, but the chase camera
trails the raven by 3-5 m, so the ring around the bird itself emptied; the cut is now
1.2-3.5 m. Verified at 2, 4, 7, 10 and 20 m over grassland and 2 and 6 m in chaparral.
The tree work landed the same day was checked and is not involved.

## Fourth pass (2026-10-25): one population of plants, cards that are their own blade clumps

Report: "When I get close to the ground, grass and herbs and small shrubs disappear, replaced with a
different grass layer - is it possible for them to stay?" Goal: a plant you can see from 40 m is
still there, in the same place, size and kind, when you land next to it.

**Cause.** The blade tiers, the tuft cards, the tussock impostors and the oat impostors were four
independent placements (own seeds and densities), so every hand-over was one set of plants vanishing
while another appeared elsewhere. Per 30 m cell of open grassland (mean of 25 cells around x=4309,
north=3440): main tier 454 clumps, close 2943, ground 4892, tufts 138 (both types), tussock impostors
393, oat impostors 163; none of the 694 cards stood where a blade clump stood. On top of that the
tussock and oat impostors were held to 45-60 m (30-45 m) low down, moving in to 12-20 m (10-18 m)
only from 6-10 m up, so coming down through 10-6 m swapped every tussock and oat stand within ~50 m
for unrelated blades: the dark tussock dots visible from 7 m up were gone at 4 m.

**Design (grass.js).**
- One placement per cell. Candidate k of N = 900 m^2 x 13.6 per cell is a pure function of (cell, k)
  (its own mulberry seed), with rank (k + 0.5) / N; every tier reads a rank range of the same list:
  ground all ranks, close the lowest 41%, main the lowest 5.5%. Counts per cell are unchanged (main
  452, close 2946, ground 4875).
- Cards are roles of those plants, never extra plants: tufts are annuals ranked below 2.5% (139 per
  cell), tussocks needlegrass below 22% (391), wild oats annuals in [2.5%, 2.5% + 9.8% x stand)
  (149). All are main- or close-tier plants. A card instance carries the plant's own position, yaw,
  scale and seed; checked: all 786 cards in the test cell match their blade plant exactly.
- The needlegrass/annual mix follows the old tussock drifts (18 m and 6 m noise, mean share kept),
  so the drifts seen from the air are where the bunchgrass is on the ground.
- Per-plant hand-over: the blade shader gives a plant with a card the card's own hand-over distance
  (same hash of the seed), and the card dithers in over the same window as the blades thin out, in
  place: tufts at 26-38 m low down (9-15 m from the air, the old blend), tussocks and oats at 6-12 m
  at every height and in every season. Plants without a card fade at their tier's band as before.
- The card is a bake of the plant's own blade clump. At load (and when the season changes the
  flowering culms, thatch or leaf length) the clumps are drawn with NEAR_VERT's own per-blade
  heights, leans and flowering into an atlas: 3 kinds x 2 geometry variants x 8 azimuths x
  5 elevations, 128 px tiles, 4x MSAA strips, mipmapped (0.5 ms, with the main renderer, captured by
  a never-drawn hook mesh). Channels: coverage, t along the blade, part, thatch, premultiplied, so
  the card is coloured and lit by the blades' rules (palette root to tip, heads and awns, per-clump
  and field variation, ground match at the same distance, sky occlusion, light through the blades).
  It samples the four nearest views (azimuth in the plant's frame, elevation less the lean the
  blades take away from the camera). A plant with a card comes in one of the two baked variants (its
  per-blade jitter is seeded by the variant), so blades and card are the same clump.
- The tussock and oat plants have their own blade clumps and meshes: a full tussock (80 fine
  arching leaves, five culms with awns; the old 9-leaf bunch was invisible from 15 m) and wild oat
  (nine tall culms with nodding panicles). They are drawn only to 15 m (where they have handed over),
  so the fuller geometry costs little; a tussock plant is 1.2x a young bunch.
- Far off a card's leaves are sub-pixel and the mips average them to haze, so coverage is built up
  with the minification (`1 - (1 - a)^(1 + 2 x (mip - 0.7))`), as if the clump had the hundreds of
  leaves of a real tussock; nothing at the hand-over distances, where the card is one texel per pixel.
- Cards are pulled R + 0.3 m toward the camera (screen size kept), so the 0.3 m sward shells do not
  bury their lower half.
- Needlegrass far off: groundMatch holds bunchgrass at the old tussock impostors' factor against the
  photo (0.9-0.95 green season, 0.77-0.82 dry), in blades and cards alike, so tussocks still show from
  the air. Thatch (winter, spring) takes only the ground's brightness far off: through the green
  mean's ratios it turned rust-red.
- Shadows: shadows.js casts each tussock card as an ellipse from the instance's R and H and the
  field's `band` uniform. The instance now carries the dense leaf mass (0.5 R, 0.65 H of the bake
  box), and `band` keeps the old near edge (45-60 m low, 12-20 m from 10 m up) while the card fade
  uses its own `cardBand`: solid ellipses under near clumps of blades read as dark blots.
- shrubfield.js: ClumpField takes `cfg.cellList` (an outside placement) and `cfg.shader`; the old
  GrassClumps/StalkClumps and their shader branches are gone. grassBlades.js: the 4-card tuft
  builder is gone (tufts are cards of the annual clump), tussock and oat clumps added.

**Results.** Grassland at 2/4/7/10/20/40 m and a 40 -> 2 m descent: the tussocks and oat stands seen
from the air are the same plants, in the same places, down to the ground (before: gone below ~5 m).
Start view unchanged (it is 400 m up; mean pixel difference 0.04/255). GPU, alternating A/B against
HEAD's files, median of five rounds of 120-frame medians (p10 in brackets), contended machine:
3 m grassland 9.30 -> 9.76 ms (7.75 -> 7.86), 3 m chaparral 11.37 -> 11.15 (9.42 -> 9.41), 10 m
9.45 -> 8.43 (8.38 -> 7.40), 40 m 7.98 -> 7.54 (6.96 -> 6.72): cheaper from the air (the tufts are
one quad instead of four cards with a 7-blade loop, the tussock/oat cards four texture taps instead
of 3D noise), +0.1-0.5 ms at 3 m. Card cell generation 0.5 ms, ground-tier cell 1.9 ms.

**What still changes as you come down.** Density LOD: plants without a card (most of the sward)
still appear as you descend (ground tier below ~14 m, close tier from ~25 m) and the shells fade out
below 10-6 m; nothing that was visible vanishes, but the sward fills in. The tussock contact-shadow
ellipses still stop 12-60 m out as before. Cards differ from their blades in detail: no per-blade
flutter (the top shears with the gust), lit with one mean normal, and the far coverage build-up makes
a far tussock a little denser than its 80 leaves. Far survivors past 34 m (tussocks) and 30 m (oats)
still grow by 1/sqrt(keep) (1.18x at 40 m), as before. Small shrubs: the chaparral impostors already
persist to 1.2-3.5 m and read as volumes at 2-5 m (per-pixel dome shading with 3D lobes); a crossed
plane would break the dome shading, so they are unchanged.

## Fifth pass (2026-10-25): chaparral impostors up close (2-15 m)

Report: the chaparral cards read as volumes at 2-5 m but have a soft, sponge-like outline. Goal: at
2-15 m, judged among the 3D shrubs, a ragged outline of leaves, tufts and wands, stems at the base,
leaf texture that reads as the species and its season, the dome shading kept, the far look unchanged.

**Two programs from one source (shrubfield.js).** The shrub shader is compiled twice: the far one
(no define) is the old shader plus a dither line, the near one (`NEAR`) carries the new detail. A second
mesh on the same instances (a child of the field's mesh, drawn first so far plants behind near crowns
fail the depth test) draws only plants nearer than `nearBand` (14-26 m); across the band each plant's
pixels are split between the two programs by an R2 dither (apart from the fade's), so no pixel runs both
and nothing changes size or crossfades. From 26 m out the far program draws everything as before: at
40 m (both stands, frozen camera) the difference to HEAD is the same as between two frames of HEAD 1.6 s
apart (mean 1.7-1.8/255, wind and clouds).

**What the near program draws.**
- Leaf pictures, baked once at load with canvas 2D (`bakeLeaves`, 512 px tiles, mipmapped; r shade,
  g coverage with 0.5 at a leaf's edge and 1 at its middle, b a random per leaf, a wood). Manzanita
  (1 m tile): stiff round leaves 2.5-5 cm in sprays 20-30 cm across, each upright at its own azimuth
  (round face-on, a sliver edge-on), each spray lit from above, red twigs in the gaps. Chamise (0.8 m):
  upright wands, some dead, with tufts of needles in bunches along them. Wrapped on the dome by azimuth
  and height (a whole number of tiles round, rows sheared per plant) with a flat cap on top, so they stay
  on the plant as the view turns; the azimuth's gradient is worked out analytically (no seam at its cut).
- Outline: past the crown's edge the picture runs on and only the leaves' cores are kept, so the edge is
  single leaves and tufts thinning out; the crown's own octaves push the edge into sprays (manzanita:
  rounded masses; chamise: the upright streak noise). The sub-crowns meet along a wavering line.
- Chamise: 15-35 wands fanning from the burl (all round from above), bowing outward, tufted along their
  upper part, ending inside or up to 0.36 crown radii past the outline, rust-tipped in summer and fall,
  bare low down; decadent plants have 45% grey dead wands that reach further.
- Manzanita: 3-4 crooked maroon stems from the base, each forking once, with S-bends, some grey and dead,
  seen under the crown (the lowest ~15% of the height is bare stems from the side) and through gaps in
  the lower crown.
- Shading: the dome and lobe normal as before; each leaf's shade from the picture; manzanita leaves
  catch the sun or stand edge-on to it by their azimuth; crevices between sub-crowns shaded.
- Season (species files, as a change of hue on the photo-matched colour; luminance within ~10%):
  chamise darkest and greenest in winter, cream flower tips in spring, rust seed heads summer and fall
  (on 70% of plants, near the top), old brown heads in winter; manzanita a little warmer in spring and
  white-pink flower specks in winter and early spring. The season is read from grass.js's `dry` uniform.
- Gains matched to the far look on screen (shrub pixels, near forced on vs off, same view): sun 2.5
  (manzanita), 4.0 (chamise; its flower and seed tips taken down by 0.6 against it), shade 1.25, 1.4.
  Measured after: manzanita 0.101 vs 0.101 linear luma at 5 m in sun, chamise 0.90-0.95 of the far
  look; in shade (17:00) within 5%.

**Cost.** 3D cellular leaves (two 2x2x2 Worley lookups) cost ~8 ms at 3 m and were dropped for the baked
pictures (~0.4 ms for the taps); a further noise octave for the sprays (0.75 ms) and a second leaf-layer
tap were dropped; the wand and stem loops run only where wood can show (they were 1.5 ms before that).
Shrub draw time at 3 m in the manzanita stand (x 3830, n 1210), timer queries around the shrub draws
alternating with HEAD's shader, medians of five rounds of 40-60 frames, contended machine (other lanes'
tabs rendering): 8.64 -> 9.30 ms and 6.53 -> 8.14 ms in two runs (+0.7 to +1.6). Whole-frame GPU in the
same runs: 16.9 -> 15.5 and 15.4 -> 18.4 ms, within the noise (rounds spread 13-28 ms). Over the 0.5 ms
target; `nearBand` (14-26 m) is the knob: the near pixels cost about twice the old near shading.

**Still wrong.** The near crowns are as large as before (the field's sizes, up to 5 m tall for chamise,
well over the 3D shrubs and the species' 1.2-2.4 m); the dome is still a dome under the leaves from
5-15 m, the leaf pictures repeat visibly in rows on the biggest crowns, chamise reads yellower than
the far olive in fall, manzanita a little bluer, the manzanita stems are saturated maroon against the
3D shrubs' crimson, and the near program costs more than the old near shading (see the numbers).
Captures (HEAD and new, 2/5/15/40 m, fall and spring, 10:00 and 17:00, both stands): the session
scratchpad's shrubcards/fin_*.png.

## Sixth pass (2026-10-25): chaparral impostors at the species' sizes

Report: the impostors stood far over the 3D shrubs among them (chamise to ~5 m against 1.2-2.4 m); the
squirrel player (0.3 m) saw shrubs ~15x its height. Causes: crown size grew with the cover % and stand
age (up to 1.6x), chamise and manzanita were drawn taller than wide (W/H ~0.8 against the species' 1.2
and 1.4), far survivors grew to 2.9x wide and 1.7x tall, and the card's pull toward the camera
(0.6 R, so the ground does not clip it) drew a crown 3 m off up to 1.5x its size.

**Now (shrubfield.js only).**
- Height from the species files by age class (young / mature / decadent: chamise 0.6-1.3 / 1.2-2.4 /
  1.5-2.6 m, manzanita 0.7-1.5 / 1.5-3.5 / 2.0-3.5 m), the class from the old stand-age noise (~30 m
  stands), width over height 1.12-1.3 for chamise and 1.15-1.8 for manzanita by silhouette variant
  (means 1.2, 1.4); the dead-stem variant follows the class (6 / 15 / 55%). Visible size of a card
  measured by rendering it alone: about H tall, 1.85 R wide near, 1.6 R at 40 m (R = width / 1.75).
- The pulled card is shrunk by (d - pull) / d, so it covers the screen of a card at the plant.
- Cover: each place keeps the crown area per m^2 the old rule drew there (the count follows the old over
  the new mean crown area at that cover, age and class: young stands of small plants get ~3x the plants),
  x1.3 because lower, wider crowns hide less ground at the chase camera's oblique angles. Young stands
  take ~10% of the ground so plants come out 25/50/25 by class, as the species files weight them.
- Far growth capped at 1.5x width (1.22x height) by KMIN = 1/1.5^2 (shadows.js reads the same kParams).

**Measured** (x 3830, n 1210, 2,000 instances within 200 m). Chamise height p5/p25/p50/p95/max: before
1.12/1.49/1.86/2.74/3.44 m (5 m in the densest stands elsewhere), after 0.84/1.42/1.77/2.33/2.54;
manzanita before 1.25/1.86/2.41/4.01/4.96, after 0.85/1.30/2.14/3.06/3.43 (3D shrubs here: chamise
median 1.53, manzanita 2.87). Plants per cell within 200 m: mean 106 -> 72, median 103 -> 64, max per
cell on the tile 237 -> 398 (young stands); cell generation 0.095 -> 0.29 ms. Worst frame on the tile
(80 degree wedge, densest stand) 14.1k -> 13.8k instances: the 140k cap holds. Shrub pixels among
chaparral-stand pixels (render with and without the field, 4x MSAA, mean of 7 stands, 2 rounds):
straight down from 60 m +6-12%; from 200 m up, at 150-250 / 250-350 / 350-430 m out 0.24 -> 0.30,
0.23 -> 0.29, 0.18 -> 0.24; from 15-40 m up, 80-250 m out 7-11% less (the old far crowns grew 1.7x
tall). Squirrel 2 m beside a 1.88 m chamise: 6.3x its height (HEAD: crowns past the top of the frame).
GPU (timer queries, alternating with HEAD's plant rule and shader in the same page, median of five
rounds, contended machine): shrub draws at 3 m 9.44 -> 8.02 ms, at the start view 5.81 -> 6.03 ms
(780 -> 1100 instances); whole frame 32.4 -> 29.4 and 30.7 -> 26.5 ms (noise-dominated).

**Still wrong.** Crowns wider than tall read as flat discs from 15-40 m and as umbrellas from the
ground (the dome is an oblate ellipsoid, the crown base is lifted); low oblique views are 7-11% more
open than before; backlit manzanita sprays glow white at 17:00 (HEAD too). Captures: the session
scratchpad's shrubsize/ (head_*, new_*: 2/3/15/40/200/400 m, fall 10:00 and 17:00, squirrel).
