# Architecture review, 2026-11-03

Aaron asked for a pass over the whole app once the multiplayer, the games and hosting had landed: are we doing
things well, where are realism and speed to be had, and how much headroom the browser has left against Godot or
Unreal Engine 5. Three read-only reviews (client rendering, client code structure, server and pipeline) plus
measurements taken in the viewer on an M1 Pro (Chrome, ANGLE on Metal, 1280 x 800 at pixel ratio 1.5).

## 0. Fix first: the server publishes its own data

`server.py` serves the whole repo root, with no allow-list and with directory listings, and the Fly volume is mounted
inside it at `/app/data`. Checked against the live site on 2026-11-03 by status code only:

| Path on wild-earth.fly.dev | Answer |
|---|---|
| `/data/` | 200, a directory listing |
| `/data/hub.sqlite` | 200, 94 KB: the accounts (password hashes), friends, groups, group chat |
| `/server.py` | 200 |
| `/.env` | 404 (not in the image) |

The local dev server also answers `/.env` (the Meshy and Discord keys) to anything that can reach it. It is bound to
127.0.0.1, so only this machine's pages can reach it, or a hostile page by DNS rebinding, since no Host header is
checked. Fly keeps only the last 100 log lines, which show no fetch of these paths. Whether anyone took the database
earlier cannot be known.

**Fixed the same day** (Aaron: "Yes, fix and deploy"). `server.py` `static_allowed` serves only `client/`,
`viewer/`, `library/`, `tiles/index.json` and each tile's folder except its `game/` and `unreal/`. Any path segment
starting with a dot or an underscore is refused, and `scratch/` is served only on a server bound to loopback.
Directory listings are off, and `/` redirects to `/client/`. The default error log, which printed the client's
address, is silenced. `tests/test_static.py` covers the rule, GET and HEAD, and encoded `..`. The accounts on the
host are test accounts, so nothing needs rotating. If real players had signed up, their passwords would need resetting.

## 1. Where the frame goes (measured)

Raven start view, home tile, in a visible pane:

| Measure | Value |
|---|---|
| Frame rate | 41 fps (117 fps with the world's draw skipped, on a 120 Hz display) |
| JavaScript per frame | 4.3 ms median, 5.8 ms at the 90th percentile |
| Draw calls, triangles | 352 calls, 8.5 M triangles |
| Shader programs, textures, geometries | 303, 282, 656 |
| JavaScript heap | about 1 GB |
| Frame rate at pixel ratio 1.5 / 1.0 / 0.5 / 0.25 | 39 / 44 / 47 / 43 fps |

So the frame is GPU-bound and, from the raven's height, not fill-bound: cutting the pixels sixteen-fold changed
almost nothing. Ground-level deer view, timed by drawing the main pass several times and forcing the GPU to finish
(the pane was hidden, so frame rates were throttled):

| Main pass | Pixel ratio 1.5 | Pixel ratio 0.5 |
|---|---|---|
| Everything | 23-24 ms | 15.5-16.4 ms |
| Without the trees | 12.3 ms | 7.4 ms |

The trees are about half the frame, and their cost barely moves with resolution: it is vertex and triangle work.
Hiding each tier of trees in turn, at pixel ratio 1.5:

| Tier | Instances | Triangles | Saved when hidden |
|---|---|---|---|
| Leaf level (single leaves near the camera) | 22 trees | up to 2.2 M quads | 3.7 ms |
| Mid canopy | 33,839 | 2.64 M | 3.7 ms |
| Near canopy | 895 | 1.08 M | 2.0 ms |
| Mid trunks | 33,839 | 2.38 M | 1.6 ms |
| Close canopy and twigs | about 220 | 0.82 M | 2.2 ms |
| Near trunks | 895 | 0.60 M | 0.6 ms |

All 534 tree instanced meshes have frustum culling off (`vegetation.js:520`) and draw every instance within
1.5 km whichever way the camera faces. Only 26 % of the instances, and 32 % of their triangles, were inside the
view. Compacting them to the frustum by hand removed 45 % of the tree triangles but saved only about 2 ms, so
culling is worth doing but is not the main lever. The main levers are the triangle budgets: 22 trees at leaf level
cost as much as 34,000 mid canopies, and 2.4 M triangles of mid trunks are mostly hidden under their own crowns.

Earlier docs call the client fill-bound. That holds for some views (overlapping cards close up) but not for these
two on this machine. A per-pass GPU timer kept in the client would settle each view instead of guessing.

## 2. What is done well

- **Vegetation technique** is above typical three.js work: deterministic per-cell placement, impostors baked from
  the real trees with prefiltered normals, dithered hand-overs between tiers, alpha-to-coverage with sharpened alpha,
  frustum-culled grass and shrub cells drawn nearest first.
- **Terrain texturing**: texture arrays, biplanar projection on steep ground, a stochastic second sample, detail
  faded by on-screen footprint.
- **Shadows**: texel-snapped cascades, far ones re-rendered only after travel, contact AO, cloud shadows from the
  sky's own cloud field.
- **Animals**: GPU skinning from clip textures, one instanced draw per species and tier, far animals thinking on
  alternate frames.
- **World teardown and context-loss recovery** are deliberate and tested.
- **The network protocol** is careful (delta-quantised fields, nearer animals updated more often, a byte cap,
  sequence numbers). Text from other players is escaped everywhere it is shown.
- **SQL** is parameterized throughout; session tokens are stored hashed; the cookie is HttpOnly and SameSite.
- **Privacy rules hold** in the code: positions stay in memory, request logs carry paths only.

## 3. What is not best practice, ranked by consequence

1. **The static file server** (section 0).
2. **Sign-in rate limits are keyed on the proxy's address** (`hub.py:1092` uses `client_address[0]`, which on
   Fly is the proxy), so the per-address limits are global: one person can lock sign-in for everyone. Fly passes
   the real address in `Fly-Client-IP`.
3. **Shared game state trusts any socket.** Acorn keys and granary deposits are unchecked strings with no caps
   (`server.py:461-476`). The first page to join becomes the animal host, and its messages are relayed to everyone
   unchecked. A mirror's catch is checked against the position the mirror claims (`animals.js:4752`). `/api/edits`
   takes 1 MB per request with no sign-in, into a file the image overwrites on each deploy. Fine among friends; it
   needs a stated trust model before strangers arrive.
4. **The server can be starved.** No socket timeouts, four sockets per page against Fly's 400-connection limit
   (about 100 pages), a WebSocket send queue capped in frames rather than bytes, and scrypt at 16 MB a hash with no
   semaphore on a 512 MB machine.
5. **`main.js` is the hand-wired centre.** 57 imports, a 490-line `buildWorld`, about 72 cross-wiring assignments,
   a hand-ordered list of about 40 updates. It is the code file lanes collide in most (14 of the last ~24 merges).
   Two bugs show the cost: the player's flight is never registered in the world's module map, so the Location box
   always rebuilds the tile instead of flying within it, and a lost graphics context cannot restore the player's
   position; and the animals are not registered either, so their dispose never runs.
6. **Gameplay reaches other systems through the debug handles** (`window.__we`, `__weWorld()`), from
   `flight.js`, `animals.js` and `scent.js`. These links appear in no import and break silently.
7. **The animal simulation is tangled with drawing**: AI on the variable frame step, level of detail by distance to
   the host's camera, a render uniform read for a gameplay decision, instance matrices written in the same loop. So
   what the host simulates depends on where its camera is, and moving the simulation to a worker or the server is
   far off.
8. **One exception ends the game loop** (`frame()` has no try/catch), while 25 empty catches swallow errors
   elsewhere.
9. **No type checking, lint or client test.** three.js loads from unpkg at run time with no integrity check, so
   an outage blanks every federated instance.
10. **The docs are the biggest merge hotspot**: in the last 200 commits the running report changed 87 times,
    the decisions log 73 and the roadmap 48, more than any code file.
11. **The pipeline is not pinned** (no lockfile; rebuilds rest on a 3.3 GB local cache), and tiles ship full-size
    PNG and JPEG colour rasters, decoded on the main thread into uncompressed GPU memory.

## 4. Speed: the plan, in order

| # | Change | Expected gain | Effort |
|---|---|---|---|
| 1 | A per-pass GPU timer overlay in the client (the timer-query extension works in Chrome on Metal) | Every later step measured, not guessed | half a day |
| 2 | Leaf-level budget: cap it by measured cost, not 2.2 M quads; fewer trees or coarser clusters at its edge | up to 3 ms at ground level | 1 day |
| 3 | Mid trunks: a much coarser trunk for the mid tier, or none beyond a few hundred metres where crowns hide them | 1-1.5 ms | 1 day |
| 4 | Per-chunk culling for near and mid trees in the main pass and the shadow proxies (sort instances into chunks, as the impostors already are) | about 2 ms, more in the shadow pass | 2-3 days |
| 5 | Shadow cascade 0 every other frame, or a cached static map plus a per-frame map for moving casters | 1-3 ms in woodland (estimated) | 1 day |
| 6 | Dynamic resolution driven by the GPU timer | about a third of the non-tree cost in fill-bound views | 1-2 days |
| 7 | KTX2 compressed colour rasters, a coarse first level, and decoding in a worker | 60-75 % less GPU memory, faster loads, no 15 ms hitches | 3-5 days |
| 8 | Terrain distance LOD beyond about 1.5 km | 0.5-1.5 ms in high views | 1-2 days |

Steps 2 to 5 together should take the ground-level main pass from about 23 ms to about 14-16 ms: 60 fps on this
machine at the current look.

## 5. Realism: the plan, in order

1. **Directional ambient light.** Project the sky into a few spherical-harmonic terms when the sun or weather
   changes, and bake a sky-visibility raster from the lidar terrain in the pipeline. Today shade is lit the same from
   every side, and canyon floors and the Yosemite walls are lit like open ground. The largest visible gain for the
   effort: 2-3 days.
2. **Tone mapping.** Compare three.js's AgX and Neutral against ACES, which shifts bright greens and skies. Half a
   day, plus re-tuning the palettes.
3. **Specular sheen** on glossy-leaved species (live oak, madrone, bay, toyon) and wet ground, from the crown
   normals that already exist. 1-2 days.
4. **A physically based sky with aerial perspective** (lookup-table sky in the Hillaire style) in place of the
   Preetham sky and the hand-tuned haze: consistent twilight and distant ridges. 4-6 days.

## 6. Engineering: the plan, in order

1. Static allow-list and redeploy (section 0). Two hours.
2. Server hardening: real client address from `Fly-Client-IP`, socket timeouts, byte-capped send queues, a
   semaphore on scrypt, validated Content-Length, Origin check on the game socket. Half a day.
3. Vendor three.js into the repo and serve it with a long cache. Half a day.
4. A check gate: JSDoc types checked by `tsc --checkJs` file by file, eslint for undefined and unused names, one
   shared escape helper, run before each merge. 1-2 days.
5. One headless smoke test (load a tile, 300 frames, no console errors, switch tiles, the old world freed). 1-2 days.
6. `main.js` as a registry of systems, each with a phase, build, update and dispose, every update wrapped so one
   failing system cannot stop the loop. This fixes the two registration bugs and turns a new feature into one line
   instead of four hunks. 3-4 days, incrementally.
7. Game trust: validate acorn keys against the tile's trees, cap the maps, make the animal host a signed-in
   account, check every decoded field for range, store edits in SQLite on the volume. 1-2 days.
8. One file per decision and per report entry, so lanes stop colliding in the docs. Half a day.
9. Split the animal simulation from its drawing: a fixed-step simulation that takes the sun and time as inputs,
   level of detail by distance to any player, a separate view that interpolates. 4-6 days. This is what lets the
   shared animals run in a worker, and later headless on the server, so no player's browser is trusted with them.
10. When there are about 30 concurrent players: tiles on object storage behind a CDN, and an asyncio realtime
    service with one socket per page and tiles sharded across machines.

## 7. Browser, Godot or Unreal Engine 5

**The browser's limit today is our own content budget, not the browser.** About half of the GPU frame is tree
triangles, much of it hidden or far more detailed than the pixels need. The browser does add costs: WebGL2 has no
compute shaders, no indirect drawing and no multi-draw indirect, draw calls cost more through ANGLE than natively,
and memory per tab is tighter. But steps 2-5 above recover more than any engine switch would in the near term.

**What each step up buys, and costs:**

| Option | Raises the ceiling by | Costs |
|---|---|---|
| WebGPU in three.js (WebGPURenderer, TSL shaders) | GPU-driven culling and level of detail in compute with indirect draws: exactly what 80,000 trees want. GPU placement measured at about 1 ms for 100 k instances against 25-80 ms on the CPU (`docs/webgpu-evaluation.md`) | About 1,900 lines of GLSL in 17 modules rewritten in TSL, as one cutover. Chrome, Edge and Safari ship WebGPU; Firefox is partial |
| Godot 4, native | Native draw-call throughput, compute shaders, MIT licence (fits a federated open-source project) | A full rewrite of about 45,000 lines. Its web export is WebGL2 only, so on the web it is no better than three.js. Weaker large-world and foliage tooling than Unreal; global illumination is modest |
| Unreal Engine 5, native | The real jump: Nanite geometry (foliage included in recent versions), Lumen global illumination, virtual shadow maps, World Partition streaming, a procedural vegetation framework that maps onto our pipeline | A full rewrite in C++ and Blueprints; a multi-gigabyte download instead of a link; the engine is source-available, not open source, with a royalty past 1 M dollars, which sits badly with federation; in the browser only through Pixel Streaming, one cloud GPU per concurrent player |

**Recommendation: stay in the browser.** The project's assets are the pipeline that turns real data into a
rewilded tile, the species library, and a link anyone can open to be somewhere real with someone else. A native
engine gives up the link. Do the speed steps now. Plan the WebGPU cutover when GPU-driven vegetation is the next
thing worth having, which these measurements suggest is soon. Keep the tile format engine-neutral (plain rasters,
JSON, standard compressed textures) so that an Unreal "showcase" client reading the same tiles stays possible later
without forking the world.
