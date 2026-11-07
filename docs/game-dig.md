# Dig: a game for the vole, the coyote and the rabbits

Aaron, 2026-11-02: "a new game for voles and coyotes. Dig! Voles may dig tunnels at a rate of .5"/s. They can create
tunnel systems, big chambers etc. coyotes may dig down at a rate of .5"/s if where they dig intersects with a tunnel
they are able to see the tunnel along with a bright glow from the tunnel side containing voles". And the same day, on
where it lives: "for both the acorn game and the dig game, I want the holes to be persistent. For holes in trees, they
should disappear if empty after 1 month. For holes in ground, they should disappear if no animal has been inside for
1 week. I want them to be seen by all players and animals. I want animals to do the behaviors as well."

The code is `client/src/dig.js` (the game, its shared world's client), `client/src/digCarve.js` and `digMesh.js` with
`digMesh.worker.js` (the drawing: the soil carved, below), `client/src/digRoots.js` (the roots in the tunnels), `digworld.py` (the server's copy
of the world and its rules), the dig channel of `server.py`'s `GameWorld`, and hooks in `groundControl.js` (the
vole's tunnel mode, the coyote's pit), `animals.js` (the AI voles and coyotes), `abilities.js` (the slots),
`terrain.js` and `grass.js` (the openings), `main.js` (the module in the world). Tests: `tests/test_dig.py`. The
browser harness used to verify it: `scratch/dig_harness.js`.

## What the player does

**As the vole.** Hold **Q** (or **E** when there is nothing to eat under the nose) standing on open ground: the vole
starts a hole at its nose and digs down into it. From then it is in the tunnel. Held, the dig drives the face on at
(2026-11-04: four times faster, 5.1 cm/s for the vole, 10.2 for the brush rabbit, 5.1 cm a second deeper for the coyote's pit, 3.2 for the jackrabbit's form; Aaron: "lets increase the dig speed of all animals, and make it continuous rather than chunks". Below, the first pace.) **0.5 inch a second (1.27 cm/s)**: a metre takes 80 seconds, a slow and deliberate act; the body is in the digging
pose (nose into the face, the fore feet scrabbling, dirt thrown back). The face goes the way the camera looks (2026-11-05, see "Steering
by the camera" below): drag the view up over the vole and it digs down, to nearly straight down; drag it low and it
digs up; swing it round and the dig curves after it. With no drag it digs level, as it always did; from the surface it
goes steeply in (or steeper, if the view is up over it) until it is a tunnel's width under; as deep as a vole goes (50 cm) it will only go level or up. While digging it turns no tighter
than a 7 cm curve (the turn waits on the face). Dig round in a small circle and when the face comes back to an older
part of its own tunnel (within 13 cm, more than 30 cm back along it) the loop becomes a **chamber**: one room of
6-10 cm radius, big enough for several voles. Dig up and the face **breaks out** as a second hole (let the key go
before digging again; a hole is never dug upward from). **W** walks the tunnel along its centreline, taking at a
junction the branch nearest the way the vole faces; **S** backs; **W** at a hole with no tunnel ahead climbs out. A
vole walking onto a hole on the surface goes down it. The HUD's where line says "digging, down 26° · 34 cm down", "in
the tunnel", "in a chamber".

**As the coyote.** Hold **Q** (or **E** over ground with no prey within the pounce's reach, no carcass, no water)
standing: the coyote digs a pit at its forepaws with the mousing dig's paw strikes, at the same 1.27 cm/s, the pit
widening as it deepens (a 10 cm radius at first, 4.5 cm more for every 10 cm of depth, to a 37 cm radius at 60 cm
deep), the spoil thrown behind it. When the pit's floor reaches a tunnel the tunnel **opens**: the tube is seen from above through the pit,
the voles in that system run down the other branches (or out of a hole, when nothing closed is left), and a **glow**
shows where they went: inside the opened tube and as a trail of soft warm spots on the ground over the system, in
the forage glow's colour (`forage.js` GLOW_COL), brightest at a vole and falling by e every metre along the tunnels,
as if the coyote smells which way they went. A vole in an opened stretch is prey again: E (or a run) gives it the
mousing pounce as before (`groundControl.js` CATCH.pounce, `animals.js` catchNear), and a vole killed in a tunnel
lies where it died. The glow trail is drawn for a coyote or a fox.

**As the brush rabbit.** Q held (E nibbles) digs a burrow of its own from the nose, as the vole's tunnel but 6.5 cm in
radius at **an inch a second (2.54 cm/s)**, steeply in until it is 20 cm under, no deeper than 32 cm; it walks the
burrow faster than a vole (0.77 m/s). **X** at the dead end of its burrow digs out a **nest**: a room of 11 cm radius
round the body, where it lies crouched; X again or any key gets up. The HUD says "in the burrow" and "in the nest". A
rabbit goes down only a hole that fits it (6.5 cm or more: not a vole's), a vole down any.

**As the jackrabbit.** Q held standing scrapes a **form** under its chest: a shallow bowl widening from 8 to 15 cm in
radius as it deepens to **7 cm**, at 0.8 cm a second, the fore feet throwing the soil back into a low fan behind it.
"The form is scraped: X settles into it": X then hunches it in the form, its crouch sunk into the scrape (the leg
engine's form pose). Lying in its form keeps the form's clock.

The abilities row: the vole's **dig** (Q) and **burrow** (lit underground); the coyote's **dig** (Q); the brush rabbit's
**dig** and **burrow**; the jackrabbit's **dig** (its form).

## The underground view

Aaron, 2026-11-03: "When a vole or other rodent digs underground, the camera should stay where it is but the
ground/outside should become semi-transparent, and the hole becomes visible as a glowing channel that the animal is in."
It replaced the first build's camera inside the tunnel (on the centreline behind the body, its near plane 4 mm), which
cost 3.1 ms of GPU from inside at 1920 x 1200.

- **The camera** stays the chase camera above the ground for any body underground (the vole, the brush rabbit): framed
  from the ground over the body, eased up by 0.7 of its height and back by 0.15 over half a second going down (and
  back coming up) so it looks down into the ground, the line of sight not pushed up by the ground between
  (`groundControl.js` updateCamera, camClear). The aim takes the body's real depth.
- **The outside, semi-transparent.** After the world's draw (`main.js` calls `dig.xray`) a pass dims everything toward
  the soil's colour (half, to 0.8 round the body: a full-screen quad), so the ground reads as looked through. The blend
  keeps the canvas's alpha (the page composites the canvas by it; a blend that lowered it undid the dimming).
- **The channel.** The depth is cleared and, on a layer of their own (5; the lights join it, as the spirit's layer 1),
  drawn: the player's own body, lit as in the world; the carved surface within 10 m (the dirt's own geometry, below)
  under a cheap shader: both faces added, bright at the silhouette and faint across (a glowing translucent pipe), one
  surface so a junction, a loop or a crossing shows no inner walls, the scent glow along an opened
  stretch, a coyote's pit in a warning red; and a soft warm glow at every other animal underground within 10 m (an AI
  vole or rabbit in a tunnel or digging, a mirror's streamed `buried`, another player's body underground: `bodySample.js`
  now flags a body in a tunnel buried). The body's depth hides the channel behind it; the front wall glows over it.
- **The openings glow too** (Aaron, 2026-11-04: "the entrance hole and mound should also glow just like the x-ray
  version of the tunnel"): the mouths and the spoil round them and the pits' mounds are part of the carved surface and
  drawn in the same pass, the spoil a little brighter across (0.16 against the tube's 0.07) so a low mound seen from
  above still shows, the bare ground round a mouth faint (0.025).
- **The hand-over**: eased in over about 0.6 s going down (a dig or a hole), out coming up; the camera never cuts.

## Going down a hole, and the crawl

Aaron, 2026-11-04: "The entry radius for a hole should be larger than the hole proportional to the hole by about 1.75x -
the reason being is that if someone is running for cover, we want to make it easy to get into the hole. When entering a
hole the avatar should walk a few steps in." And: "While inside of a hole, the animal's rigging should be a crawling type
so that the body never escapes the tunnel walls."

- **The reach** (`dig.js` update, ENTER_K): a tunneller moving toward a hole that fits it goes down once its front (the
  line from its centre to its nose) passes within 1.75 of the hole's radii of the hole's centre. Before, its centre had
  to be within 1.6 radii (a brush rabbit's centre within 10 cm, its body over the hole); now a running rabbit's nose
  within 11 cm takes it (measured: down at 21.5 cm centre to centre, the nose 8.2 cm off, at 2.9 m/s). Coming up, the
  hole is ignored until the body's front is 3.25 radii from it.
- **The walk in** (`enterHole`, ENTER_WALK, ENTER_BLEND): the body starts on the first segment, faces down it and walks
  three body half-lengths in by itself (a brush rabbit about 0.37 m) carrying some of its run (at most 1.5 m/s); a back
  key or the dig key takes over. Its place is eased from where it stood to the tunnel's floor over 0.35 s (no cut).
- **The crawl** (`gait.js` hopStep `inp.crawl`, set by `groundControl.js` in a tunnel): the shuffle only (no bound), no
  sit-up, at least the freeze's crouch with the ears laid back, the haunch dropped by 0.45 and the chest by a further
  0.2 of the belly's depth, the head drawn 0.3 lower, no bob, lean or arch, the feet swung at 0.4 of their height. The
  part-rigged vole keeps its hop on the floor (no lift).
- **The bore** (`DIGGERS[code].crawl`, the crawling body's width and height at size 1, measured): the drawn body is
  narrowed and lowered to the tube's inside less a margin (1.7 and 1.68 of the radius across and up from the floor it
  stands on), eased in going down; in a chamber it is full size. The brush rabbit's drawn body is wider and taller than
  its 6.5 cm burrow even crawling (13.7 cm both ways at size 1; the burrow's inside is 12.4 cm across, 11.7 cm from the
  floor up), so it is drawn at 0.77 x 0.77 of its size in the tube; the vole at 1 x 0.80.
- **Measured** (2026-11-04, port 8781, an orthographic side and front render of the body alone in its own frame, still
  and crawling): the brush rabbit 15.4 cm tall crouched, 14.1 crawling, 10.8 squeezed against 11.7 of room; 12.3 cm wide
  squeezed against 12.4 before the side margin was widened; the vole 5.8 tall against 5.4, 5.4 squeezed before its
  margin was raised. Not measured: the brush rabbit's feet against the round floor's sides (they are planted on it), a
  rabbit backing out (S) over a long tunnel.
- **From above** nothing changed: the dirt is drawn only near an opening (visPass); the camera is never inside now.
- **The coyote digging toward a vole**: the player's vole underground sees the pit's bowl in red come down through the
  ground toward its channel, and the coyote itself dimmed above it; when the pit opens the tunnel, the opened stretch
  carries the scent glow in the channel (seen: an AI pit dug over the player's vole's tunnel at x25 opened it at 22 cm,
  the red bowl over the channel, the glow brightest at the vole).

## The rabbits

Aaron, 2026-11-03: "Rabbits should also be able to dig holes for themselves." What each does in life, and where the
game goes past it:

- **The brush rabbit** (*Sylvilagus bachmani*) digs no burrow of its own: it lives in dense brush on runways between
  cleared resting forms and now and then uses a burrow another animal dug (Chapman 1974, *Mammalian Species* 34;
  Chapman, Hockman & Ojeda 1990, *Rabbits, Hares and Pikas: Status Survey and Conservation Action Plan*, IUCN, p. 99:
  it "occasionally uses burrows made by other species, but does not dig its own"; Animal Diversity Web: it uses burrows
  less than other cottontails). **The game goes beyond the biology here, because Aaron asked for it**: the brush rabbit
  digs a short burrow of its own, kept modest (6.5 cm in radius for a body about 10 cm wide, 20-28 cm down, 30-70 cm
  long for the AI's) and ending in a nest chamber, in the way a cottontail doe digs the shallow cavity of her nest.
  Its use of others' burrows is biology: it goes down any hole that fits it, a player's or another rabbit's.
- **The black-tailed jackrabbit** (*Lepus californicus*) does not burrow; it rests in a **form**, a shallow
  depression it scrapes under a shrub or in tall grass, and has been seen to use abandoned burrows for escape and
  shade (Vorhies & Taylor 1933; Dunn, Chapman & Marsh 1982; the species' Wikipedia article, from the USFS Fire Effects
  Information System; forms "no more than a few centimeters deep", after Tiemeier & Plenert 1964). A West Texas A&M
  species account gives forms 10-20 cm wide, 30-45 cm long and 3-11 cm deep. The game's form is a round bowl 30 cm
  across and 7 cm deep (the drawing has no oval pits), scraped with the fore feet: the biology, not past it.

**AI brush rabbits** (`animals.js` rbDen, rbBurrow; states B_TOHOLE, B_BURROW, B_DIG). By day, settled in its form, a
brush rabbit goes down a burrow that fits it within 2 m (its wait 90-240 s, then up by a hole, where its form is then);
on the AI host, with no hole within 3 m, three settlings in ten it digs one (`dig.js` aiDigStart with the burrow's
spec: on the way it faces, down to 20-28 cm, along 30-70 cm, then aiNest: the room, and it lies up in it 60-180 s).
Bolting, it makes for a burrow within 6 m that is not past the danger (a short wait, 20-60 s). In a burrow it is
buried: not prey, not counted present; its legs stand on the burrow's floor (lagoInput's floor), crouched in the nest.
**AI jackrabbits** (jkUpdate, JK_FORM): on the AI host each scrapes its form as it settles in (`dig.js` aiForm: a form
within 30 cm of it is used again; none past 30 forms in the world), standing over it with the fore feet working, then
hunches in it; lying there keeps the form's clock. A mirror sees the form grow but the rabbit only crouched (the dig
flag is not in the animal stream).

**The digging motion** (`gait.js` hopStep, `inp.dig`): standing, the chest lowered by a third of the belly's height and
the head down; the fore feet in turn (half a cycle apart) reach 35 % of the leg's length ahead to the ground and rake
back 45 % behind under the chest at 4.5 strokes a second, lifted 18 % and curled on the way forward; the hind feet stay
planted. The soil is thrown back from the paws (a rabbit's specks bigger and further than a vole's; the specks are
small clods now, not cubes). The player's from `ground.digging` (groundControl draw), the AI's from `a.digK`.

**Shared** through the same dig channel as the vole's and the coyote's: a burrow is holes, digs (with `r` 0.065), grows
and a room; a form is a pit with `k: 'form'` (`digworld.py` keeps `k` on a pit and drops any other value), so both
persist, decay after 7 days with no animal inside (a rabbit in its burrow or form sends the visits) and are seen by
every player. `pipeline/games.py` PLAYS adds the two rabbits' shelter games to Dig (`plays.dig.species` of each tile).

## The animals

**AI voles.** A vole alarmed by a predator (the player or an AI hunter, `animals.js` threat and danger) with a hole
of a system with room (four voles at most) within 2.5 m runs for it and goes down; now and then a calm vole goes down
a hole within 3 m on its own. Underground it walks the tunnels to the far end of its system or a chamber, waits 15-40
s, then walks to a hole and comes up with a runway from it. A vole in a tunnel that is not opened is buried: not prey,
not counted present. On the AI host (below) a calm vole with no hole within 4 m sometimes digs a burrow of its own at
the same rate: down to 12-24 cm, along 0.6-1.4 m, round into a chamber, on 35 cm, up to a second hole (at most two
digging at once, none past forty holes in the world, never in water).

**AI coyotes.** On the AI host, a coyote (alone, or a pair's leader) sniffing at its hours with no surface prey in
reach smells a buried vole within 15 m, trots to 40 cm short of the point over it and digs a pit there; when the pit
opens the tunnel and a vole shows within the pounce's reach it fixes and pounces (the kill as before, at the canids'
catch odds); it gives up after 40-90 s or at the pit's full depth.

## The tunnel model

A tile's tunnels are a graph, as `digworld.py` and `dig.js` both hold it:

- a **node**: a point on a tunnel's centreline with the tube's radius there (3 cm); a **hole** where the tunnel meets
  the surface (its centre one radius under the ground); a **room** (a chamber: one node, a sphere flattened to 0.8,
  of 6-10 cm radius); `sys`, the id of the hole its system began at (systems merge when a tunnel joins another);
  `open` once a pit has opened a segment at it;
- a **segment** between two nodes (a tube between their radii);
- a **pit**: a bowl at a point (its rim at the ground, a parabola to its depth, its radius), the spoil heap behind it,
  and the segments it opened.

The face advances in 2 cm steps: while the tunnel runs straight (within 0.2 rad) and the segment is under 35 cm the
leaf node moves (`grow`); otherwise a new node and segment (`dig`). A room absorbs the nodes within 26 cm of the face
point (`room`): their segments to the outside end at the room, the ones among them go, and of two to the same
outside node one stays. A face that comes within 13 cm of a node of *another* system (two diggers meeting, since
2026-11-04) joins it (`join`) and the two systems are one; the dig stops there (let the key go, W walks on through).
A burrow does not open into a narrower bore (a rabbit's into a vole's), and a body never walks into a branch too
narrow for it. Every change is one of these events, applied in the server's order by the same reducer on
both sides (`applyEvent` in dig.js, `dig_reduce` in digworld.py):

```
{ type: 'hole',    id, x, y, z, r }                 a tunnel's first node, its own system
{ type: 'dig',     from, id, seg, x, y, z[, r] }    a new node joined to `from` (at most 0.6 m from it)
{ type: 'grow',    id, x, y, z }                    a leaf node (not a hole or a room) moves on
{ type: 'join',    a, b, seg }                      a segment between two nodes; their systems merge
{ type: 'room',    id, x, y, z, r, absorb: [ids] }  a chamber in place of the nodes round it
{ type: 'widen',   ids, r }                         nodes grown (kept for old logs; rooms replaced it)
{ type: 'surface', id, y }                          the face broke out: the node is a hole
{ type: 'pit',     id, x, z, y0, r, depth, hx, hz } a pit made or deepened (hx, hz: its spoil heap)
{ type: 'open',    pit, segs }                      the pit's floor met these segments
{ type: 'visit',   sys | pit }                      an animal is inside (the decay's clock)
{ type: 'pull',    id, x, y, z, sp, left }          a plant pulled down from below (id: the plant's own, below)
{ type: 'decay',   nodes, segs, pits }              the server's: removed (below)
```

Ids are `<page tag>.<n>`: six random characters a page picks and its own counter, so two players never make the same
id (the server refuses one it has). Events carry no player or animal id: a tunnel's position is never kept beside
whose it was. `ai: true` marks the AI's digging, which the server takes only from the AI host.

## Shared, and where it lives

Every page in a tile joins the **dig channel** of the game socket (`/api/game/ws`, hello `{t: 'dig', tile, season}`)
while it is in the world, whatever the body and whether or not the acorn game runs. The server (`server.py`
`GameWorld`, one per tile and season, the acorn game's) checks each event with `digworld.py` (fields in range: inside
the tile, radii, depths, a step at most 0.6 m), applies it, numbers it by its own `dseq` (so the acorn game's `seq`
never jumps under its clients) and sends it to everyone on the channel; the sender's copy echoes its counter. The
client keeps the acorn game's model (`DigNet` in dig.js, as `net.js`): `confirmed` is the server's world as of the last
`dseq`, the game's world that plus this page's events not yet answered; a reject (`drej`) or a remote event that does
not apply to the prediction rebuilds it; a gap in `dseq` reconnects for a fresh welcome. The first page on the channel
is the **AI host** (`dhost` tells each member when that changes): it runs the AI voles' burrowing and the AI coyotes'
pits and sends them. With no game endpoint (a static host, `?net=0`) the world is the browser's own, in localStorage
per tile and season (`wild-earth:dig:<tile>/<season>`).

The state is the world's **snapshot** (`tiles/<tile>/game/<season>.json`, `v` 4, its `dig`) and its **log**
(`<season>.events.jsonl`, one `{t: 'dig', dseq, at, e}` line per change, `at` the wall time so the clocks replay),
on the hosted server the volume (`docs/hosting.md`, `deploy/entrypoint.sh`). A v3 snapshot still loads (no tunnels
yet). On load the log's dig lines past the snapshot's `dseq` are replayed.

**The decay clocks** (wall time, checked on the server's tick every 60 s whether or not anyone is in the world, and
once on load):

- **a ground hole and its tunnel system**: gone when no animal has been inside for **7 days** (`digworld.DIG_IDLE_S`).
  Inside means a dig event in the system or a `visit`: a page sends one, at most once an hour per system, while the
  player's vole is in it, and the AI host for its AI voles in it. A **pit** the same, on its own clock (a dig in it,
  or a coyote digging there).
- **a tree hole** (the acorn game's stash holes and granaries): gone when it has held nothing for **30 days**
  (`server.py STASH_EMPTY_S`). The snapshot keeps `held` (an oak, the last time it held an acorn or went empty) and
  `since` (when the world first ran with the rule: an untouched stash hole dates from then); `gone` lists the holes
  removed, and the acorn clients are told (`{t: 'gone', oaks}`: `net.js` drops the hole's counts, `acorns.js`
  holeGone stops drawing it, and an untouched stash hole is gone on the client too once the rule is 30 days old by the
  server's clock); a deposit into a gone hole is refused ("no stash hole"). Offline (the v2 world in localStorage)
  the tree holes do not decay. A stash is never emptied in the game as it is (only granaries are raided), so in practice an unused stash
  hole goes 30 days after the rule began, a used one stays.

What the shared version does not share: the animals. Each page still runs its own animals (`docs/game-acorn-stash.md`
"Limits of this node"): another player sees the host's AI voles' tunnels grow and a coyote's pit deepen, but not those
animals themselves, and their own voles use the shared tunnels by their own rules. How another player's vole underground
shows on a group member's screen (`players.js` draws a member in a body as a small wisp over it) was not checked.

## Drawing

- **The soil, carved** (2026-11-04; below, "Carving"): the soil is a solid and digging removes it. Every segment, room,
  hole and pit is a primitive of the carved air, and the surface where the soil meets the air is meshed in sparse
  chunks in a Web Worker (`digCarve.js`, `digMesh.js`), so junctions, loops, crossings, chambers joined from two sides
  and pits breaking into tunnels are one watertight surface. Until 2026-11-04 each segment was a tube mesh and their
  union a discard in the fragment shader against at most eight neighbours, which left inner walls and dirt across the
  bore wherever a loop or a crossing missed a neighbour.
- **The dirt**: the soil's colour by the tile's soils layer (`client/soils.png`: the SSURGO map unit's surface texture
  class in `soils/classes.json`), two octaves of grain, stones by the unit's rock fragments, fine roots on the roof;
  lit by what kind of surface it is (from the field, per vertex): a tunnel's wall dark but for the sky seen up the
  nearest eight holes and pits (by the shaft's solid angle), a pit's bowl by the sky, less toward its floor, the ground
  and spoil round a mouth as the ground is lit, fresh earth darker. The scent glow is emissive, per node, read from a
  float texture by the node's slot.
- **The openings**: the terrain is not edited. A mouth comes out of the field: the ground and its spoil within 6 cm of
  an opening are meshed with the tunnel's wall as one surface, the spoil a ring round the mouth run out into a fan away
  from the tunnel, the lip rounded. The ground's shader (`terrain.js` FRAG) discards a disc in each of the eight holes
  and pits nearest the camera (`groundUniforms.digCuts`, no new sampler), now just inside that patch (a hole's radius
  plus the lip, under its spoil; a pit's radius), and the patch's bare ground sits 3 mm under the terrain, which wins a
  tie, so no seam shows; the grass's near and body tiers drop a clump rooted in one (`grass.js` inDig). Underground
  the camera stays above (the underground view, above); the forage glow and the sight marks are off there.
- **What is drawn**: in the world, the carved surface within 3 m of an opening and 30 m of the camera, after the
  terrain (whose depth hides the underground before it is shaded: the carved surface has no discard); underground the
  channel within 10 m (the underground view).

## Measured (2026-11-02, home tile, 1920 x 1200, the built-in browser)

The dig meshes' own GPU time (drawn alone ten times in one timer query against hidden, the median of fifteen), with a
system of 80 segments and 3 rooms: **from above** (2 m) 0.1-0.2 ms with 25 of the 80 drawn, from 5 m within the noise
(about 0.15 ms); **from inside** a tunnel, the walls filling the screen, 3.1 ms. Whole-frame from inside, the dig
drawn against hidden: no slower (the walls hide the world drawn behind them). dig.js's update: 0.005-0.05 ms a frame
(0.7 ms once, rebuilding every slot at a welcome). Tried and dropped: a depth pre-pass so the union's discard would not
turn the early depth test off (once the colour pass was rejected, once with a polygon offset it drew at 3.7 ms and
blackened the near tube); drawing the dig after the terrain (2.3 ms against 0.5 from above).

## Verified (2026-11-02, the home tile's grassland at 6960, -7032; the server on port 8792; the rate x20)

- The player's vole dug from the grassland down 26 degrees to 34 cm, level, round into a chamber, on, up to a second
  hole 2.2 m from the first; seen from inside (the dirt wall, the roots, the whiskers' light, daylight down the exit)
  and from the surface (two holes with spoil in the sward); walked back down a hole and along the tunnel to the room.
  216 events sent, none refused. The world came back from the server after a page reload.
- Three and four summoned voles bolted down the holes when a coyote came and walked the tunnels to the chamber and
  the far end. The player's coyote's pit (42 cm deep, 29 cm across) opened a segment, a 57-spot glow trail ran from the
  pit to the chamber, the voles fled down the other branch; a second pit over them sent them back; a pounce killed one
  in the tunnel, its body 39 cm down. After rooms replaced the widened capsules: the pit opened 7 segments, the voles
  fled along a 41-node path, 79 nodes glowed.
- An AI coyote smelt the voles in the chamber, dug a pit over it (30 cm, 14 segments opened) and killed one with its
  pounce; an AI vole dug a new system from a hole 7 m off (down, along, a chamber, up to a second hole 1.8 m away); the
  AI's 34 and 172 events accepted from the AI host.
- A second page (`?seat=2`) joined as the second member: its welcome held the same 72 nodes, 76 segments, 4 holes and 4
  pits, and the first page's next 30 events drew there as they happened (78 segments on both).
- `tests/test_dig.py` (6): two clients see one tunnel and a late joiner gets it in its welcome, a duplicate id and a
  non-host's AI event refused, a pit opening a segment, the decay after 8 days and none after a visit, the world from
  its snapshot and from its log alone, a v3 snapshot, a room, the tree holes' clocks. `tests/test_hub.py` (12) passes.
- Console: no errors; the 17-texture-unit warning is the terrain's program's, from before this lane.

## Measured and verified, the rabbits and the underground view (2026-11-03, home tile, port 8792)

- **GPU, the underground view's pass** (`dig.xray` drawn K = 8 times in one `EXT_disjoint_timer_query_webgl2` query per
  frame after the world's draw, alternating with the same pass with its meshes hidden, 40-60 samples each, at 1920 x
  1200 with load averages of 11-12 from other sessions; `scratch/xray_harness.js`): over the floor of
  an empty pass (0.05-0.1 ms: the depth clear and an empty render), **0.02-0.1 ms** looking down at a vole 50 cm under
  (the fade 0.03-0.1, the channel 0.02, the body within the noise), **0.16-0.33 ms** (min, p10 of the difference) from
  an orbit with 3 m of tunnel and a chamber on screen, **0.24-0.73 ms** zoomed in to 0.3 m with the tube across the
  screen. The medians were the machine's scheduling (1.5-11 ms on and off alike), so the min and p10 are quoted.
  Under the 1 ms asked; the view from inside it replaces was 3.1 ms (measured by the first lane, not again here). The
  pass's CPU (one more traversal of the scene, nothing on its layer but its own) was not timed.
- The player's vole dug down 26-32 degrees to 50 cm and round into a chamber at x20-25, seen from above through the
  dimmed ground as an amber channel with the vole drawn in it and the chamber a bulb; 304 events, none refused.
- The player's brush rabbit dug a 3.4 m burrow at x10 and a 1 m one at x4 (to 26-30 cm); X at the end dug the nest
  ("in the nest · 30 cm down"); it walked back up and out with W and the view eased out (1, 0.24, 0.02, 0 at half
  seconds) with no cut. The mouth from the surface: the collar and the fan of spoil, 13 cm across.
- The player's jackrabbit scraped a form (8 to 15 cm radius, to 7 cm deep, "the form is scraped: X settles into it");
  the leg engine's fore paw read back each stroke: forward 10 cm lifted 3 cm, raked back along the ground.
- AI rabbits at 13:00: the AI host's jackrabbits scraped 14 forms within minutes; a brush rabbit went down the burrow
  the player had dug and lay in its nest; summoned brush rabbits dug their own burrows and nests (28 cm down, at x3-6),
  one seen from a vole's underground view as a glow in the bulb of its nest beside the vole's own tunnel.
- **Two pages** (the second `?seat=2`, not the host): its welcome held the rabbits' 8 burrow mouths, 6 rooms and 18
  forms; a burrow the host's AI dug arrived as it was dug (its 6.5 cm mouth, 5 nodes, the nest), and the second page's
  player's form reached the host at full depth (10 events, none refused). Its screen shows the AI's burrow mouth.
- Found and fixed: a rabbit dropped from the population while digging stayed in the dig's list and held one of the two
  diggers' slots for good (a vole the same: now let go four times a second); a room dug round the body replaced the
  object the tunnel step held, so the step read an absorbed node (now updated in place).
- `tests/test_dig.py` test_rabbits: a burrow (6.5 cm tubes, the nest room) and a form reach a second player as they are
  dug and are in a late joiner's welcome; an unknown pit kind is dropped; a form decays as a pit does.

## Not verified, and what still reads wrong

- The underground view: not seen with another player's body underground as a glow (the flag is sent; not looked at on a second
  page); the glows of other animals are discs, not their bodies; the tube's segment ends show faintly as rings; not on
  a phone or a slower GPU. The rabbits: not at the real rate for long; a brush rabbit's burrow the player holds Q for has
  no length limit; the spoil of a rabbit's hole reads pale on dry sward; a mirror's jackrabbit does not show the scrape
  (only the host's); the name tags of buried animals still draw over the ground.
- Not seen at the real rate (1.27 cm/s) for long, only at x20; not on a phone or a narrow window; not on the hosted
  server; not with two real players digging the same system at once (only one page digging, one watching); not the
  decay in real time (the clock moved by hand in the test).
- (2026-11-02) From inside, the dig cost 3.1 ms of GPU when the walls filled a 1920 x 1200 frame: gone with the view
  from inside (the underground view, above).
- The vole's body underground is lit as on the surface (the animal material knows nothing of the dirt). The animals'
  name tags (T) draw through the ground. A hole's spoil can sit a centimetre off the drawn ground (the micro relief is
  not in the hole's height). The coyote stands over its pit at ground height (its
  footing does not know the pit). Tunnels do not avoid roots, rock or water; nothing stops two tunnels crossing without
  meeting except the 13 cm join. Bright specks were seen once at a room's crown.
- The other players' animals and bodies are not shared (above), so another player's AI vole is not seen in your tunnel.

## What a fuller shared version needs

The server holds the tunnels already. Still to do: the animals themselves shared (one host's AI voles and coyotes seen
by everyone, as positions from the host, `docs/multiplayer.md`); the other players' bodies drawn as their species
underground; a check on the server that a dig event's position is near the digger (it trusts the client now, as the
acorn game trusts an acorn key); the season worlds' state flow (a tunnel dug in fall is not in the spring world).

## Faster and continuous (2026-11-04)

Aaron: "lets increase the dig speed of all animals, and make it continuous rather than chunks".

**Speed.** `DIG_SPEED = 4` multiplies every digger's rate (`RATE` and the jackrabbit form's rate). A vole now digs a
metre in 20 s.

**Continuity.** The shared world still steps the face 2 cm at a time: those are the events the server and other
players see, now about 2.5 a second. Between steps, the player's own tunnel end is drawn where the face really is, and
the body stands there too (`faceAhead`). The segment is rewritten with its leaf node moved D.face along the dig
direction, then the node is put back, so the world itself is unchanged. A step, a stop or a new node redraws it where
the world has it.

**Measured** as a vole on the home tile over 10 s of digging: a median of 5.1 cm/s, and no frame moved more than
0.05 cm beyond the rate times the frame's time. Before, the body jumped 2 cm at each step.

**Not changed:**
- Other players' tunnels grow in 2 cm steps.
- The coyote's pit deepens in 1 cm steps, now 5 a second.
- The tube union was still the shader's neighbour test: replaced the same day by the carving (below).

## Carving (2026-11-04)

Aaron: "Dig is really cool. Strange things happen when geometries collide - when a tunnel loops back on itself. Right
now it seems like we're making polygons but is there a way instead to "remove" from a polygon? What if we made a
polygon on the underside of the earth that has the mirror polygon roof of the ground polygon. The user "digs" which
creates a joint between these two surfaces, and then starts "removing" the polygon. Players will want to dig elaborate
structures together." After testing the neighbour test's fix: "the geometry is a little bit better when I join two
holes but its still a little funky", then "Yes, start the carving".

**The world is unchanged**: the same graph, events and reducers on both sides (`applyEvent`, `dig_reduce`), the same
sync. Only the drawing changed, and one digging rule (two systems that meet join, above).

**The field** (`digMesh.js`). The soil's signed distance is `smax(y - G(x, z), -C(p), kL)`, negative in the soil. G is
the drawn ground (`Heightfield.ground`: the micro patch, the fine square or the coarse mesh, as the terrain draws it)
plus the spoil heaped on it. C, the carved air, is the minimum over every primitive: a round cone per segment between
its nodes' radii (a tunnel enters a room at its own bore), an ellipsoid per room (r, 0.8 r, r), a vertical shaft per
hole from its node up through its spoil, and a bowl per pit (its rim on the ground, its floor a parabola to its
depth). Within a tunnel's straight run (cones meeting at a two-segment node) the minimum is plain, so no joint bulges;
across runs, rooms, shafts and pits it is a smooth minimum of 1.5 cells, so junctions, doorways, the shaft's bend into
the tunnel and a pit breaking into a tunnel are filleted. The ground and the air meet in a lip rounded over 1.2 cells.

**The mesh**. Surface nets in chunks of 16 cm that exist only where a primitive reaches: a vertex per cell the surface
crosses (the mean of its edge crossings, then one Newton step onto the field's zero), a quad per lattice edge the
chunk owns, positions from the global lattice so two chunks compute a shared border cell bit for bit (watertight,
checked: every edge shared by two triangles but for zero-area slivers). The cells are sized by the smallest radius in
reach: 1 cm for a vole's 3 cm bore, 2 cm for a rabbit's burrow, a room or a form, 4 cm for a big pit, one size over
each joined component of chunks (a vole tunnel opening into a pit meshes the pit at 1 cm) so neighbours always agree.
Bare ground more than 6 cm from any air and under no spoil is not kept. The chunks a change reaches are meshed again,
the nearest to the body first, in two workers (one on a machine of fewer than six cores; with none, on the main
thread a few ms a frame); a cone whose end moved (the face growing) dirties only the chunks round its end and where
its side swung by more than 0.3 mm. The chunks are drawn four to a side in a region of 64 cm, one draw each.

**The face between the steps** (`faceAhead`): a short cone of its own from the leaf to where the face really is, so
only its one or few chunks are meshed again each frame. Measured at the real rate (5.1 cm/s, the home tile, two
workers): the carved tip trails the drawn face by 2.7 mm at the median, 3.5 mm at most over 9 s (about a third of a
cell: the surface net's vertex sits inside the true cap), at 184 chunk meshings a second, about 1 ms each.

**What changed besides the drawing**: `MAX_N` and `MAX_S` (and `digworld.py` `N_MAX`, `S_MAX`) from 1,500 and 1,200 to
5,000 each, since nothing is preallocated per slot now. The price: a vole's bore costs about 6,700 triangles and 3,700
vertices a metre (0.19 MB on the GPU, as much again in memory for the regions' rebuilds); a rabbit's at 2 cm cells
less than half that a metre of its length. 15 m of tunnels with thirteen pits and forms on the home tile were 155,000
triangles. A welcome of 5,000 nodes would be about 0.75 MB from the server. The joining of systems (`meet`) uses the
existing `join` event.

**Measured** (the home tile, 1280 x 800, the built-in browser; the load average 5): the carved surface's own GPU time
with all 216 regions (141,000 triangles) drawn alone, eight draws in one timer query against hidden, the p10: 0.02 ms
in the underground view from an orbit, 0.05 ms close up, 0.09 ms for the dirt with no terrain in front of it (in the
frame the terrain hides nearly all of it first). `dig.update` while digging: 0.5 ms median, 1.2 ms p99, 1.8 ms at
most (0.1 ms idle); a welcome of 2,745 chunks meshed in 0.7 s of worker time.

**Verified** (port 8786 on the worktree, captures in the underground view and from the surface):
- a vole's loop round back to its own tunnel became a chamber with clean doorways; a tunnel dug through the middle of
  an older 34 cm segment (no node within 13 cm, so no join: the case that showed inner walls) is one crossing with
  filleted corners and no walls across the bore;
- two tunnels dug toward each other from two holes met and joined (one system), and the vole walked from one hole
  through the join and out of the other;
- a coyote's pit (30 cm, 45 cm deep) over the joined tunnel opened three segments: the bowl breaks into the tunnel
  from both sides, seen red in the underground view with the vole in it, the tunnel's openings seen from above;
- a brush rabbit dug its burrow, came out and ran back at it: down 16 cm from the hole's centre, walked in 0.8 m,
  squeezed to the bore; the mouth (spoil fan, lip and burrow wall) is one surface;
- AI voles walked a joined system node to node (6 of 7); the AI host's voles and jackrabbits dug and scraped as before;
- no shader diagnostics (`renderer.info.programs`), no console errors; `tests/test_dig.py` test_meet_and_big (two
  systems joined, their clock merged; a 2,000-node tunnel taken), all 42 server tests pass.

**Not verified, and what still reads wrong**:
- the AI coyote's own pit in this build (the same code path as the player's pit, which was verified);
- two players digging one structure at once; a phone or a slower GPU; a structure near the 5,000-node cap (its memory
  above, untested);
- the hole's throat reads paler than a real burrow at night (the sky term at the lip); the pit's bowl is evenly lit
  (no occlusion but its depth); a bright point can show at the sharpest crotch of a crossing in the underground view;
- a vole tunnel meeting a rabbit's burrow draws as one opening but is not joined (the burrow does not open into the
  narrower bore), so neither walks through;
- when the micro patch moves, a mouth's chunks re-mesh to its new ground (the drawn ground under them changed by more
  than 2 mm); until then the patch can show a few millimetres above or under.

## Roots (2026-11-04)

Aaron: "Another layer of this will be showing roots hanging from the ceiling and letting players either pull the plant
down or eat the roots."

**What hangs** (`client/src/digRoots.js`). Where a tunnel's or a room's ceiling passes under a plant within the depth
its roots reach, its roots hang from the ceiling there. The library has no rooting depth, so these are set by kind:
- **the grasses**, everywhere under the sward (`grass.js` speciesAt and its density): fine fibrous roots, one to three
  on a 2.5 cm lattice, to 45 cm under an annual sward (wild oats, bromes, barley: most of their roots in the top 30 cm)
  and to 1 m under a perennial bunchgrass (purple needlegrass roots past a metre and a half);
- **the herbs** (`forbs.js`, each with its deterministic id `f:<cell i>.<cell j>.<candidate>`, the same on every
  page): **soap plant**'s bulb (7-15 cm, brown-fibred, set 15-30 cm deep: drawn 3 cm in radius, mostly in the soil, its
  base and roots out of the ceiling) where the tunnel passes at its depth, **blue dicks**' corm (1-2 cm, 5-15 cm deep),
  any other herb a taproot and fine roots, to 35 cm; above or below the bulb's depth only its roots;
- **the trees and shrubs** of the near set (`vegetation.js` nearPlants, within 1.1 times the drip line): woody roots
  crossing under the roof and sagging between their ends, an oak's 1-2 cm (thinner away from the trunk; at any depth a
  vole digs), a shrub's to 70 cm down, a conifer's to 1.2 m, each with a pale rootlet.
Drawn as instanced strands (a tapered five-sided tube that hangs and curls, or sags across as a woody root: 20
vertices, two instance attributes, no texture) and instanced bulbs (a flattened icosphere), on the world's layer and
the underground view's, built for the tunnels within 9 m of the body when the tunnels, the pulls, the near plants or
the forbs change or the body moves 2.5 m (0.2-3 ms, at most twice a second). Each root is a strand no longer than
the bore.

**Eating** (the food system as it was: `needs.js`). Underground, what fills the belly is what is at the nose, in
place of the surface's resource rasters: a pulled plant's heap or a bulb (100), a corm (90), a herb's root (50),
grass roots (35), a woody root (30). E held eats it (the nibble); the food line names it ("blue dicks corm here: hold
E"). A bulb or corm eaten for 5 s is eaten out and takes the plant above with it (a `pull` with nothing left), and a
vole's E digs only where there is nothing to eat at its nose, as on the surface.

**Pulling the plant down** (F held 1 s with the nose at a herb's roots; the abilities row's **pull**). The plant is
gone from the surface and lies on the tunnel's floor as a heap of its leaves, food for anyone (eaten away over 8 s of
E), as a pocket gopher pulls plants down by their roots. It is a world event, `pull`, in both reducers (`applyEvent`,
`digworld.py dig_reduce`): the plant's deterministic id, where it lies, its species and what is left of it (left only
falls). It is kept in the dig world of the tile and season (`pulls` in the snapshot, the log's dig lines), so it is
the season's own and a reload or a late joiner has it; it is not tied to a tunnel system and stays when the tunnels
decay. No player's id is attached. Grasses, shrubs and trees are not pulled (a grass clump has no id of its own in
`grass.js`; nothing a vole could pull is a shrub).

**Verified** (the home tile, port 8786, captures in the underground view and from the surface):
- grass roots along a vole's tunnel in the grassland; E there filled the belly (0.50 to 0.62 in 7 s, "wild oat roots");
- a blue dicks corm in the ceiling right under its plant at 9.8 cm; eaten for 5 s (the belly at the corm's rate), the
  pull sent and taken, the plant gone from the surface and its corm from the ceiling; still gone after a reload;
- a soap plant's bulb at 14 cm; F pulled the plant down (the rosette gone from the surface, its heap on the floor),
  then E ate the heap from 1 to 0.5 in 5 s, every step taken by the server;
- a blue oak's woody roots across a tunnel 3 m from its trunk, a coffeeberry's under its crown (and no grass roots
  under the shrub);
- a second page (not the AI host): its welcome held both pulls and neither plant was on its surface; a pull made on
  the first page reached it live and the nettle went from its surface too;
- no shader diagnostics, no console errors; `tests/test_dig.py` test_pull; all 53 server tests pass (one skipped).

**Not verified, and what still reads wrong**:
- a brush rabbit eating or pulling (the same code; its reach is the bore's 1.6 radii);
- the herbs follow the forbs as drawn this season: a blue dicks corm sleeping underground in summer (no plant drawn
  then) has no root in the tunnel, and the forbs' candidates can be other species in another season (the pulls are
  per season, so this never mixes);
- roots do not stop a tunnel (the face digs through them) and an eaten grass or woody root is not used up;
- a thick root's ends can stand a little out of a narrow bore's wall in the underground view; the AI voles do not eat
  roots or pull plants.

## Steering by the camera (2026-11-05)

Aaron: "Can you make the orbit controls work for digging - so that it's easy to dig down."

Since the orbit camera (2026-11-02) a drag on the ground swings the camera round the body and no longer tilts the
body's look, so the dig's "the way it looks" had nothing behind it: the flight's pitch stayed 0, and once a tunnel was
three radii under, it could only dig level. Now the orbit is the dig's aim (`dig.js` aimPitch, aimDot, digDir, digFrom,
tunnelStep; `flight.js` easeOrbit holdPitch; `groundControl.js` updateCamera):
- **Down and up.** The orbit's pitch off the camera's set-up is the dig's slope. Swinging the camera up over the body
  (looking down) digs down: steeper the higher it goes, to 83 degrees down (DOWN_MAX 1.45 rad) at 0.9 rad of orbit,
  which is a short drag. Swinging it low (looking up) digs up, to 57 degrees (UP_MAX 1.0) at the orbit's lowest.
  Within 0.04 rad of the set-up the dig is level, so the keyboard-only dig is unchanged. Before this, the slope was
  limited to 34 degrees.
- **Held.** Underground and while digging, the orbit's pitch no longer eases back behind when the keys move the body
  (the yaw still does). A steep dig stays steep while Q, W and A/D are held, and walking keeps the aim.
- **Steering.** While digging, a camera swung round (within 100 degrees of behind) turns the body toward the camera's
  heading. It turns only as fast as the face can carry a curve (a 7 cm curve for the vole, scaled up for the rabbit),
  and the orbit gives up whatever the body turns, so the view holds still while the tunnel bends toward it. A and D
  still turn the body as before. A camera swung round to look at the animal's face doesn't steer.
- **Curving.** The face's slope turns toward the aim at the same rate, so a dig turned from straight down to up bends
  round a curve instead of kinking.
- **The floor.** A dig nearing the digger's depth limit (the vole's 50 cm, the brush rabbit's 32) levels off over its
  last 2.5 radii instead of zigzagging against it.
- **Walking.** Shafts are walked by looking. The direction W takes along a segment, and the branch chosen at a
  junction, now weigh the segment's slope by the aim: looking down takes the way down, looking up the way up. On a
  slope up to the old 34 degrees with a level view, the old heading test is unchanged. In a near-vertical shaft with a
  level view, the body keeps the direction it last walked.
- **Hints.** Starting a dig says "swing the view up over you to dig down", and the dig slot's tooltip says the same
  (since 2026-11-06 the tooltip leads with the arrows: see below).

**Verified** (home tile, port 8786, the underground view, both at the real rate and at 4x):
- **Vole, straight down.** A simulated pointer drag (20 moves, 400 px down the screen) set the orbit to 1.0. Q dug
  straight down at 5 cm/s (34 cm of depth for 4 cm across), levelled off at 50 cm, and the aim held through a W.
- **Vole, back up.** With the view dragged low, the face climbed at 57 degrees from 44 cm and broke out as a new hole.
  An orbit yaw of 0.8 was taken into the body's heading while digging.
- **Vole, walking the shaft.** Looking down, W walked down a shaft entered from its hole. At the bottom, turned round
  and looking up, W climbed the shaft and out onto the surface. S backed as before.
- **Inside a tunnel.** From a level tunnel, the view swung up dug down at 83 degrees to the floor.
- **Keyboard only.** With no drag, the dig went in at the start pitch and then level, and A turned it.
- **Brush rabbit.** It dug from the surface steeply to 18 cm, levelled at its 32 cm floor, then (view dragged low)
  curved up and broke out 64 cm away: a U-shaped burrow with roots hanging along it.
- No console errors. All 61 server tests pass (one skipped).

**Not verified**:
- **Touch.** A touch drag on a phone or tablet: it goes through the same pointer events.
- **Players watching.** A second player watching a steep dig: it is the same events, so other pages see it in 2 cm
  steps as before.
- **Unchanged.** The coyote's pit and the jackrabbit's form already go straight down; the AI diggers keep their own
  slopes, except that an AI rabbit's last few centimetres to its depth are gentler under the new depth rule.

## The arrows steer the dig (2026-11-06)

Aaron: "While digging, the purpose of the arrow keys changes upArrow begins to dig up, downarrow begins to dig down"

With the dig key held (Q, or the vole's E with nothing to eat), the arrow keys stop walking and steer the dig's slope
instead (`dig.js` digFrom, aimPitch, keyAim; `groundControl.js` input and updateCamera):
- **↓ and ↑.** ↓ starts angling the face down and ↑ up, from the slope the face has now. Held, it keeps turning, at
  the same rate the face can curve (about 0.7 rad a second for the vole and the brush rabbit, so level to near straight
  down takes about 2 s), to the dig's limits: 83 degrees down, 57 up. The depth floor still levels a dig off near the
  digger's deepest (the vole's 50 cm, the rabbit's 32).
- **Released.** The slope holds where it was let go, through more digging, a short let-go of Q, and walking.
- **Left and right.** A and D, or a horizontal mouse drag (the camera's heading), still steer.
- **The camera.** It stays as a second way to aim, but yields to the keys. Once an arrow has set the slope, the
  orbit's pitch no longer moves it. A drag that swings the camera 0.08 rad (about 30 px) up or down hands the aim back
  to the camera; small vertical wobble in a steering drag doesn't. Leaving the tunnel, or starting a new dig from the
  surface, clears the arrows' slope.
- **Nothing else fires.** While the dig key is held, the arrows don't walk (no forward or back in `input()`) and don't
  ease the camera's orbit back behind. Without the dig key they mean what they always did: ↑ walks, ↓ backs, in a
  tunnel and on the surface.
- **Taught.** The keys strip shows `Q ↑ ↓ dig up · down` for the vole and the brush rabbit, and their dig slot's
  tooltip leads with the arrows.

**Verified** (home tile, port 8786, the brush rabbit at its real rate, real keyboard events; the frame strip is
`docs/dig-arrows-strip.jpg`, seen from a fixed side camera in the underground view):
- **Down.** Q dug in at the start pitch (-32 degrees at 15 cm). ↓ held turned the face to -72 degrees within 1 s, and
  the face levelled off at the rabbit's 32 cm floor. After ↓ was released, the held slope stayed down with the floor
  holding it level.
- **Level.** A 0.25 s tap of ↑ turned the face from level to 12 degrees up. It held there over the next 2.4 s.
- **Up and out.** ↑ held turned the face to 57 degrees up and it broke the surface 1.9 m from the first hole.
- **No walking.** The body stayed at the face all the while: the arrows never walked it.
- **The camera takes it back.** A camera swing of 0.5 rad returned the aim to the camera.
- **Without Q.** In the tunnel ↓ backed the rabbit 23 cm, and on the surface ↑ walked it 1.2 m.
- **Taught.** The strip and the tooltip read as above.
- All server tests pass.

**Not verified**:
- **The vole.** It runs the same code at its own rate, and isn't checked on its own.
- **The gray squirrel.** The brief named it, but it isn't a digger in the game: only the vole, the brush rabbit, the
  jackrabbit (its form) and the coyote (its pit) dig. The form and the pit go straight down, so the arrows do nothing
  for them beyond not walking while Q is held.

## Dens (2026-11-06)

Aaron: "For diggers, once they are underground a new control appears. The 1 key "dig den" which makes a large area.
Dens that overlap should have empty space. When you click build den, the den shape appears in a green silhouette,
attached to the mouse, its location fixed below the surface, but tracking the mouse. You can place the den anywhere
connected to a tunnel. Digging the den is a process that can be interrupted, and returned to/completed."

**A den is a room node** (`client/src/digDen.js`; `dig.js` applyEvent `den`, `denk`, denPlace; `digworld.py` the
same). The tunnels already had rooms: a chamber is one node drawn as an ellipsoid (r, 0.8r, r) carved into the soil,
with every tunnel entering it at its own bore. A den is the same thing, bigger, and dug over time:
- **The plan.** The `den` event names the den, a segment, and the tunnel node `at` it opens off. It carries where it
  starts (`at`'s place and bore: ax, ay, az, ar) and its planned centre and radius (x, y, z, r).
- **The growth.** The den's node stands at the plan's progress k: its centre moves from `at` toward the planned
  centre and its radius grows from the bore to the plan's as k goes from 0 to 1. So the cavity grows out of the
  tunnel and is joined to it from the first moment. Its top climbs linearly from the tunnel's to the plan's, so it
  never breaks the surface on the way.
- **Progress.** `denk` { id, k } only rises. The player sends it in 2% steps (50 events a den). Every page sees the
  cavity grow, and a late joiner gets the den as far as it was dug (`dn` [ax, ay, az, ar, x, y, z, r, k] on the node in
  the shared shape).
- **Limits.** A den is never absorbed into a chamber or widened, and decays with its system like any tunnel. Its
  radius is 8-40 cm, its centre within 70 cm of where it starts, and `at` must stand where the plan says (within
  5 cm). A tile and season hold at most 200 dens.
- **Size and depth.** Per species (`DIGGERS` den): the vole's den is 16 cm in radius (32 cm across) with its centre
  28 cm down, so its roof is 15 cm under the ground. The brush rabbit's is 30 cm in radius (60 cm across, about five
  times its bore) with its centre 42 cm down, its roof 18 cm under. Digging one out takes 40 s for the vole and 45 s for
  the rabbit.

**Overlapping dens are one cavity.** The carving is a union of the carved air, so two dens that overlap leave no wall
between them. A den placed over a finished den opens off it, so the two are joined by a segment and walked between.
When a den is finished, it is also joined to every other finished den it overlaps.

**The controls** (the vole and the brush rabbit, underground only):
- **Placing.** 1, or the "dig den" slot (shown only underground), takes out the silhouette: a green ellipsoid of the
  den's size at the species' depth under the ground the mouse points at, following the mouse. It turns red where it
  would join no tunnel. It joins the dug space it overlaps most: a tunnel's node within its radius plus 12 cm, or a room
  or finished den it overlaps, but never a den still being dug. A click places it. Esc, a right click, or 1 again puts
  it away. While placing, the click goes neither to the camera's orbit nor to identifying a tree, and 1 isn't a strike.
- **Digging.** A den placed where the body is starts digging at once, with the body in the digging pose and the dirt
  thrown back. One placed elsewhere along the tunnels waits with its outline drawn: walk to it and press 1, or hold Q
  at it.
- **Interrupting.** Any move key, A or D, E, F, X or Space stops the digging, as do leaving the tunnel, leaving the
  body, or a coyote's pit opening the system from above.
- **Resuming.** 1 or Q back at the outline carries on from the progress stored, on any page and after a reload.
- **Progress.** Shown by the slot's sweep (the dark part is what is left) and the HUD ("digging the den · 45% · 23 cm
  down").
- **Taught.** The keys strip shows `1 dig den (underground)`. The slot's tooltip says how to place, cancel, interrupt
  and resume, and that overlapping dens are one room.

**Where this departs from the brief:**
- **Who digs dens.** Only the tunnellers dig dens (the vole and the brush rabbit). The jackrabbit and the coyote never
  go underground: they scrape a form and dig a pit from the surface.
- **The gray squirrel.** It isn't a digger in the game.
- **Interrupting.** "Being attacked" maps to a coyote's pit opening the den's system. The player's body underground
  has no health to lose, and nothing else attacks it there.
- **Getting to a distant plan.** A plan placed far along the tunnels is not walked to automatically. The player walks
  there and presses 1, as with resuming.

**Verified** (home tile, port 8786, real key and pointer events, the dig rate at 4x; the frame strips are
`docs/dig-den-strip.jpg` and `docs/dig-den-overlap-strip.jpg`):
- **The slot.** As a brush rabbit, the "dig den" slot appeared once underground.
- **Placing.** 1 showed the silhouette at 42 cm down. It was red 1.6 m off the tunnel and green over its end, and a
  click placed it there without moving the camera. Esc, a right click, 1 again and the slot all worked.
- **Interrupting.** It dug at once (the HUD counted 2% to 50%). W stopped it at 52%, and the server held 52%.
- **Leaving and coming back.** The rabbit went back out of the hole and 2.4 m away. Back down the hole and along the
  tunnel to the outline, 1 resumed it, and it finished.
- **After a reload.** The finished den was still there and the rabbit walked into it.
- **Overlapping.** A second den, placed over the first and dug out, made one cavity with no wall left, and the rabbit
  walked from the tunnel through the first den into the second.
- **The vole.** A den 16 cm in radius, 28 cm down, dug out.
- **Tests.** `tests/test_dig.py` test_den: plan and progress relayed with no player id; a late joiner gets a half-dug
  den and finishes it; the refusals; two finished overlapping dens joined; a den decays with its system. All server
  tests pass.

**Not verified, and open:**
- **A lost WebGL context.** One happened while the second den was dug at 4x in the browser pane, and the page rebuilt
  its world. Both dens were already stored. It did not recur over a further vole den, the walks and the captures, and
  I haven't found the cause; this project has hit Chromium's context limit before (the memory notes).
- **Other players.** A second player watching a den grow live.
- **The AI.** AI voles and rabbits don't dig dens.
- **Touch.** Placing on a touch screen: a tap places it, but there is no hover to aim the silhouette first.

