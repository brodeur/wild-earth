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
  - ShrubField: chaparral cells filled to their canopy shrub % (floor 30%) with chamise (rounded,
    twiggy, grey-green) and manzanita (taller, upswept, darker, red-brown stems under the crown),
    in stands ~45 m across, out to 430 m.
  - GrassClumps: purple needlegrass tussocks at 12-120 m.

## Tried and dropped

- **Annual-grass clump impostors:** cotton balls and cookies from the air. Annual grass is a
  continuous sward, so the shells and terrain grain carry it.
- **Shell strokes (anisotropic noise):** moire "fingerprints".
- **Single-lattice dots on the terrain:** the grid showed from the air.

Costs and screenshots are in the hand-off report for this work.
