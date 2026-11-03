# Scavenge: a death in the world lasts a day

Aaron, 2026-11-02: "New game: Scavenge. When an animal dies, it begins to decompose over the course of 1 day. It emits a
smell 'dead animal' and appears to glow from an appropriate distance for carrion eaters."

The code is `client/src/carrion.js` (the carcass model, its drawing, its smell's reach, its glow, the feeding and the
shared world's client), `carrionworld.py` (the server's copy of the carcasses and their rules), the `cev` messages of
`server.py`'s `GameWorld` on the dig channel's socket, and hooks in `animals.js` (the kill makes the carcass; the AI
scavengers find and feed through it), `animalModels.js` (the decay in every animal shader), `scent.js` (the reach by
stage, the "dead animal" label), `needs.js` (a bite's share of the belly, the stage on the panel), `hunt.js` (the stage
on a hunter's panel), `abilities.js` (the feed slot lit beside a carcass), the controls' feed calls (`groundControl.js`,
`flierControl.js`, `flight.js`), `dig.js` (its socket shared) and `main.js`. Tests: `tests/test_carrion.py`. The
browser harness used to verify it: `scratch/scavenge_harness.js` (with `scratch/catch_harness.js`).

## What the player sees

**A carcass decays over a real day.** Every kill (the catch: `docs/movement.md`) lies where it fell and becomes a
carcass that lasts one real day: 24 hours for a deer or a buck, 12 for a jackrabbit or a brush rabbit, 6 for a vole or a
fence lizard (`LIFE_H` by the body's mass, `MASS` by species). The stages are drawn on the body itself:

| decay | stage | on the body |
|---|---|---|
| 0 - 0.1 | fresh | as it fell: the catch's pose, on its side |
| 0.1 - 0.35 | bloated | the trunk swollen by up to a fifth, the coat dulled |
| 0.35 - 0.6 | opened | the upper flank dark red-brown from the middle of the trunk outward, the more the more has been eaten |
| 0.6 - 0.85 | dried | the hide sunk over the frame, the colour gone grey-brown |
| 0.85 - 1 | bones | the body gone; a skull, spine, pelvis, ribs and long bones, pale in the grass, fading out |

The decay is the carcass's age over its life, with the heat: summer runs half again as fast as spring, winter two thirds
as fast, and the afternoon a quarter faster than the mean and the small hours a quarter slower (the day's swing is
integrated over the age, so a day takes a deer whatever the hour of the kill). Feeding hastens it: every kilo taken from
the `meat` store (the body's mass) advances the decay by 0.45 of the share eaten, and an emptied store is bones at once.

**It smells.** A carcass is a scent source as every animal is (`scent.js`): drawn as a wisp toward it when new and while
the player sniffs (L), labelled "dead animal" until the scent is strong enough to name the species ("deer · dead").
Its reach grows with the stage: a fresh kill carries three quarters of the nose's carrion reach, a bloated one a third
more than the reach, a dried one half, bones a fifth; the wind shapes it as it shapes every scent (full straight
downwind, half across the wind, a fifth upwind). A coyote's nose (300 m, half again for a scavenger) has a fresh deer
from about 340 m downwind and a bloated one from about 580; the vulture's carrion nose (800 m) a bloated one from a
kilometre.

**It glows for the carrion eaters.** For a body whose species scavenges (games.json `relations.scavenge`: the raven, the
vulture, the coyote, the bear) and for the lion at a lion's kill, a carcass carries a pool of warm light on the ground,
as `forage.js` lights a forager's plants: within 3 km of the vulture (it finds carrion from the air), 400 m of the raven,
150 m of the coyote, 120 of the bear, 60 of the lion; brighter with hunger and with the stage's smell, fading with
distance, wider with distance so it stays a few pixels across from high up, and dimmer at hand where the body itself is
plain. The needs panel (and a hunter's panel when it has no prey in reach) names the nearest one in reach with its stage:
"a deer, two hours dead, bloated · 140 m NE", and at the carcass "· hold E".

**Feeding.** As before: E beside it (the coyote, the bear, the lion), the raven's bill stabs, the vulture on contact.
Each feed now takes a bite from the store (the coyote 1.5 kg, the bear and the lion 4, the vulture 0.4, the raven 0.12)
and fills the belly by that bite's share of a full one, at most one bite every 2.2 s (3 s for a bird); the flank darkens
as the store goes down. An empty carcass says so.

## The AI

The AI scavengers come by what they would notice (`carrion.js aiNear`): the vulture from the air within 1.5 km once the
kill has begun to smell (within 300 m fresh), the raven by sight within 400 m, the coyote by its nose (450 m times the
stage's smell times the wind's carry) and by day only within 80 m, so it comes at dusk and at night, the bear by its nose.
So the vultures and ravens come first and the coyotes after. They feed in turns with a pecking order (`yields`): a raven
gives way to a coyote, a bear or a lion feeding at the carcass (the player's body counts) and comes back later; a coyote
to a bear or a lion. Each draws from the store as it feeds (the raven a bite per stab burst, the coyote and the bear a
quarter kilo at a time over a spell of 25-45 s and a minute), and leaves when its spell is over or the store is empty.

## Shared

A carcass is state of the tile. Its birth is an event (`carcass`: the animal's id, species, place, heading, size and
mass; the server stamps the time) and its meat is drawn by `feed` events (kg taken), both carried as `cev` messages on
the dig channel's socket and numbered by their own `cseq`, logged as `carrion` lines and kept in the world's snapshot
(`carrion`: seq and the records, beside `dig`). Every client computes the stage from the birth on the server's clock
(the welcome's `now` sets the offset), so every player sees the same carcass at the same stage, and a reload brings it
back. The server's sweep (every minute, with Dig's) removes a carcass whose decay has reached 1 and tells everyone
(`gone`). Each carcass is sent once, by one page: the page that runs the animals (the shared animals' host; with them
off, the dig channel's host) sends every AI kill, every catch it confirms for a mirror and every AI bite, marked `ai`;
a player's own kill on that page is sent unmarked; a mirror sends its bites but not its own catch, which its host sends
(`carrion.js runsAnimals`). The server takes `ai` events only from the page that runs the animals (`server.py
runs_animals`: the animals host's page id, else the dig host), and refuses a second birth of the same animal
("taken"): the carcass's id is the animal's, the same on every page. Events are anonymous: the killer and the feeder are
species codes. With no game server (a static host, `?net=0`) a carcass is this browser's alone, in memory.

The kills are the shared animals' events (2026-11-02): a mirror's `kill(a, ...)` from its host's ordered event makes
the carcass record there as on the host; `adopt` kills the local animal of that id when the world reports a carcass the
page has not seen.

## The drawing and its cost

The dead body is its own instance in its species' mesh, so it costs nothing new: its gait phase (`aAnim.x`) is free once
the fall is over (the amplitude is 0), and a dead body writes `-(1 + decay + 2 * round(15 * eaten share))` there.
`animalModels.js` decodes it in every path (the part rig, the reptile, the skin, the textured tiers, the depth and
silhouette twins): `DECAY_BODY` swells and then sinks the trunk (its middle by the model's bounding box), `DECAY_FRAG`
dulls, opens and dries the colour. No new vertex attribute (the skinned deer now declares `aAnim`, which it already
carried: 12 of Metal's 16 slots, the buck 15), no texture unit. The bones are one instanced draw (48 at most), the glow
another (32 halos). A carcass far from the player has no body until it is within 450 m.

## Debugging

`__we.carrion`: `describe()` lists the carcasses; `age(h)` moves this page's clock `h` hours on (0 back: off by
default; the shared stage is the server's, so another page does not move); `hint`, `near`; `k` scales the glow;
`enabled`. `scratch/scavenge_harness.js`: `__sh.kill()`, `__sh.stages(rec, ages)` (a montage), `__sh.show()`.

## What was verified, and what was not

In the viewer on the home tile, on a machine loaded by other lanes (load 10-30; where the page's frames crawled the world
was stepped by hand):

- A deer killed as the lion, aged with `carrion.age` through every stage to bones (montages at 0, 4, 8, 12, 16, 19, 21.5
  and 23.5 h), and fed on to 12, 26 and 52 per cent: the dark flank grows with what is eaten and dries over.
- The coyote 300 m straight downwind of a fresh deer smells it faintly, labelled "dead animal", at the bearing it lies;
  at 360 m nothing. Turning only by the wisp, it went from 280 m to the carcass in 14 steps, the label "deer · dead"
  from 160 m. There, the panel read "a deer, 5 minutes dead · hold E", the feed slot was lit, and two E presses took
  1.5 kg each (a hungry coyote to a full belly), both numbered by the server.
- The vulture, hungry, 260 m up and 1.7 km off: a single carcass a warm point among the oaks; the panel "a deer, six
  hours dead, opened · 1.7 km W".
- The AI: a vulture circling 30 m over a two-hour carcass and gliding off after its spell; a raven circling in,
  gliding down and feeding in stab bursts (twelve 0.12 kg bites); an AI coyote 150 m downwind at dusk smelling a
  jackrabbit carcass first and feeding there; sent to the deer with two ravens feeding, it came, both ravens took off,
  and it fed in quarter-kilo bites.
- Shared: a carcass back after three reloads at its age, its body drawn where it fell, its meat as the feeds left it;
  `tests/test_carrion.py` (two clients, the AI host's rule, the sweep, the reload from snapshot and from log).
- The catch harness: an AI coyote's pounce killed a brush rabbit in 1.5 s and it became a shared carcass (12 h).
- No shader diagnostics; no console errors from this lane's code (a terrain program's 17 samplers warned while the
  spirit flew low over the grassland: the terrain's micro patch, not this lane).
- The frame cost with ten carcasses in view: 6 more draw calls (of about 500), 29 thousand more triangles (of 12.3
  million), the module's own update under 0.01 ms. The GPU time could not be resolved: the 10th percentile was 37.2
  ms with them against 36.1 without, but the medians and tails swung by tens of ms with the other lanes' load.

Not seen: the bear or the fox at carrion, the lion's AI feed drawing from its kill, a summer or a winter carcass, two
pages at one carcass in the viewer (the tests do it on the server), a vole's or a lizard's stages up close, the
vulture landing (it only circles: there is no ground vulture).
