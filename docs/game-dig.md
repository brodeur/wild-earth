# Dig: a game for the vole, the coyote and the rabbits

Aaron, 2026-11-02: "a new game for voles and coyotes. Dig! Voles may dig tunnels at a rate of .5"/s. They can create
tunnel systems, big chambers etc. coyotes may dig down at a rate of .5"/s if where they dig intersects with a tunnel
they are able to see the tunnel along with a bright glow from the tunnel side containing voles". And the same day, on
where it lives: "for both the acorn game and the dig game, I want the holes to be persistent. For holes in trees, they
should disappear if empty after 1 month. For holes in ground, they should disappear if no animal has been inside for
1 week. I want them to be seen by all players and animals. I want animals to do the behaviors as well."

The code is `client/src/dig.js` (the game, its drawing, its shared world's client), `digworld.py` (the server's copy
of the world and its rules), the dig channel of `server.py`'s `GameWorld`, and hooks in `groundControl.js` (the
vole's tunnel mode, the coyote's pit), `animals.js` (the AI voles and coyotes), `abilities.js` (the slots),
`terrain.js` and `grass.js` (the openings), `main.js` (the module in the world). Tests: `tests/test_dig.py`. The
browser harness used to verify it: `scratch/dig_harness.js`.

## What the player does

**As the vole.** Hold **Q** (or **E** when there is nothing to eat under the nose) standing on open ground: the vole
starts a hole at its nose and digs down into it. From then it is in the tunnel. Held, the dig drives the face on at
**0.5 inch a second (1.27 cm/s)**: a metre takes 80 seconds, a slow and deliberate act; the body is in the digging
pose (nose into the face, the fore feet scrabbling, dirt thrown back). The face goes the way the vole faces and looks:
the drag's pitch tilts it down or up (within about 34 degrees); from the surface it goes steeply in until it is a
tunnel's width under; as deep as a vole goes (50 cm) it will only go level or up. While digging it turns no tighter
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
  drawn: the player's own body, lit as in the world; the tunnels, rooms and pits within 10 m from the dirt's own
  buffers under a cheap shader: both faces added, bright at the silhouette and faint across (a glowing translucent
  pipe), the union kept by the dirt's neighbour test so a junction shows no inner walls, the scent glow along an opened
  stretch, a coyote's pit in a warning red; and a soft warm glow at every other animal underground within 10 m (an AI
  vole or rabbit in a tunnel or digging, a mirror's streamed `buried`, another player's body underground: `bodySample.js`
  now flags a body in a tunnel buried). The body's depth hides the channel behind it; the front wall glows over it.
- **The openings glow too** (Aaron, 2026-11-04: "the entrance hole and mound should also glow just like the x-ray
  version of the tunnel"): the holes' collars, the spoil round them and the pits' mounds (the heaps buffer) are drawn
  in the same pass under the channel's shader, a little brighter across (0.16 against the tube's 0.07) so a low mound
  seen from above still shows; a collar's fragments inside the tunnel it opens onto are dropped as a tube's are.
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
outside node one stays. Every change is one of these events, applied in the server's order by the same reducer on
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

- **The tubes**: every segment a round cone (a tube between its nodes' radii with hemispherical ends; 12 sides, 8
  rings) in one preallocated buffer, every room a flattened sphere in another. They are one-sided (only ever seen from
  inside), drawn first (`renderOrder` -1), and their union is made in the fragment shader: each vertex names up to
  eight neighbouring capsules (the segments sharing its nodes, a room, a hole's collar, any tube crossing it) whose
  ends and radii sit in a float texture; a fragment inside a neighbour (less the mesh's chord error) is air and
  discarded. Junctions, chambers and collars need no mesh booleans.
- **The dirt**: the soil's colour by the tile's soils layer (`client/soils.png`: the SSURGO map unit's surface texture
  class in `soils/classes.json`), two octaves of grain, stones by the unit's rock fragments, roots hanging from the
  roof; dark but for the daylight down the nearest eight holes and pits (falling by e every 1.5 widths of the opening)
  and a warm glow at the vole's whiskers. The scent glow is emissive.
- **The openings**: the terrain is not edited. The ground's shader (`terrain.js` FRAG) discards a disc in each of the
  eight holes and pits nearest the camera (`groundUniforms.digCuts`, no new sampler), so a hole is seen from above and
  the sky from below; the grass's near and body tiers drop a clump rooted in one (`grass.js` inDig). A hole is a collar
  (the tube's mouth up through the surface) and a fan of fresh, darker spoil thrown out away from the tunnel; a pit a
  bowl and a mound; a jackrabbit's form a shallow bowl and a low fan. Underground the camera stays above (the
  underground view, above; until 2026-11-03 it went inside on the body's line with a 4 mm near plane); the forage glow
  and the sight marks are off there (the sound cues stay).
- **What is drawn**: a pass four times a second (`visPass`) shows the dirt only within 60 cm of a hole or a pit (the
  camera is always above the ground now); underground the channel is the underground view's (above).

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
