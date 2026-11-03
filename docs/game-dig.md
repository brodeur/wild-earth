# Dig: a game for the vole and the coyote

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

The abilities row: the vole's **dig** (Q) and **burrow** (lit underground); the coyote's **dig** (Q).

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
  removed, and the acorn clients are told (`{t: 'gone', oaks}`); a deposit into a gone hole is refused ("no stash
  hole"). A stash is never emptied in the game as it is (only granaries are raided), so in practice an unused stash
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
  bowl and a mound. Inside a tunnel the camera stays on the body's line, pulled in until it is inside the tunnels, its
  near plane 4 mm (a 3 cm tube otherwise lets the frustum's corners out); the forage glow and the sight marks are off
  there (the sound cues stay).
- **What is drawn**: a pass four times a second (`visPass`) shows, underground, only the stretches within 1.6 m along
  the tunnels from the body, and above ground only those within 60 cm of a hole or a pit.

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

## Not verified, and what still reads wrong

- Not seen at the real rate (1.27 cm/s) for long, only at x20; not on a phone or a narrow window; not on the hosted
  server; not with two real players digging the same system at once (only one page digging, one watching); not the
  decay in real time (the clock moved by hand in the test).
- From inside, the dig costs 3.1 ms of GPU when the walls fill a 1920 x 1200 frame, over the 1 ms asked; the frame as a
  whole was not slower in the A/B, but a slower GPU will feel it. Next: a cheaper wall (a noise texture in place of the
  hash noise; the union test only near a node).
- The vole's body underground is lit as on the surface (the animal material knows nothing of the dirt). The animals'
  name tags (T) draw through the ground. A hole's spoil can sit a centimetre off the drawn ground (the micro relief is
  not in the hole's height). The specks of dirt are small cubes. The coyote stands over its pit at ground height (its
  footing does not know the pit). Tunnels do not avoid roots, rock or water; nothing stops two tunnels crossing without
  meeting except the 13 cm join. Bright specks were seen once at a room's crown.
- The other players' animals and bodies are not shared (above), so another player's AI vole is not seen in your tunnel.

## What a fuller shared version needs

The server holds the tunnels already. Still to do: the animals themselves shared (one host's AI voles and coyotes seen
by everyone, as positions from the host, `docs/multiplayer.md`); the other players' bodies drawn as their species
underground; a check on the server that a dig event's position is near the digger (it trusts the client now, as the
acorn game trusts an acorn key); the season worlds' state flow (a tunnel dug in fall is not in the spring world).
