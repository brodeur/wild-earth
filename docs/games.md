# Games: a pipeline for finding and classifying them

Aaron, 2026-10-27: "figure out a pipeline for games: what are species-level games, collective games and so on.
Obviously there is predator-prey. But there is also get water and get food: graze, forage. What are the games for the
species we have, and how do we discover and classify those games from a pipeline perspective."

## What a game is here

A game is a need an animal has, in a season, at a place, with something in the way. The package already holds every
part of that sentence:

| part | where it already is |
|---|---|
| the need and its verb | `species_data.CALENDAR`: per species and season, `forage`, `hunt`, `cache`, `shelter`, `nest`, `den`, `court`, `rear`, `disperse`, each with the resources it needs and a goal in words |
| the resource | the nine seasonal resource rasters (`resources/*.tif`, resources.py): acorn mast, grass and forbs, browse, cover, insects, cavities, cliffs and snags, burrows, water, each 0-100 on the 30 m grid for each season; or another species, named in the calendar |
| the place | the raster's best cells that season |
| what is in the way | the other species' hunt lists (predators), the species after the same resource the same season (competitors), the season's own scarcity, the clock (dusk, a storm) |
| who helps | the perception matrix (`perception.json`): a species that sees a predator another cannot is its watcher; a scavenger follows a predator to kills (the raven's winter calendar names the lion) |
| the unit | how the species moves (animals.js): a herd, a covey, a flock, a family, a colony, a pair, a mother with young, or alone |

So games are not written per tile. The `games` step (pipeline/games.py, run in `derive` after the resources) reads
those and writes `games.json` beside `calendar.json` and `perception.json`: every species the tile has, its games by
season, each classified, placed and scored. A species the tile lacks has no games there; a resource the tile lacks makes
no hotspots; a new species in the calendar gets its games the same way.

## The axes

- **Unit: species-level or collective.** A solitary species plays alone: the fox's hunt, the lizard's bask. A species
  that moves as a group plays its games as the group: the herd grazes, the covey forages, the flock roosts, the
  woodpecker family keeps a granary, the ground squirrel colony keeps watch, the lion mother brings the young. Every
  game of a group species is marked collective, and two games exist only for groups: **watch** (someone looks up while
  the rest feed) and the collective form of **rear** (keeping the young with the group). The herd pilot (decisions,
  2026-10-27) is how a player plays a collective game: steer the group, and when you stop, the group plays on.
- **Need.** Eat (gather: graze, browse, forage; hunt), drink, hide (shelter: cover, cavity, burrow, roost), store
  (cache, recover), reproduce (court, nest, rear), move (disperse).
- **Resource.** A raster resource, with hotspots and a scarcity, or a species: prey for a hunter, a predator for a
  scavenger, a mate for courting.
- **Opposition.** A predator (the prey's game is **evade**, the dual of every **hunt**), a competitor (every species that
  eats acorns in fall is after the same cells), scarcity (water in summer scores under 50 on 93% of the home tile, so
  the few sources draw everyone, and the ambushers), the clock (roost before dusk, cover before the storm).
- **Scale in time.** A flush lasts seconds; a graze an hour; a cache and its recovery a season; rearing a year; dispersal
  a life. The client plays the short ones as loops and the long ones as the world's state across seasons.

## The archetypes (what the client will play each as)

| archetype | the loop | exists in the client |
|---|---|---|
| gather | find the resource's hotspots, feed, keep an eye out; competitors deplete the same cells | the walkers: hunger, fed by holding E where a gather resource scores (needs.js, 2026-10-27); not yet for the birds, the squirrel or the hunters |
| drink | reach water on a rhythm; in summer the few sources draw every species, and the ambushers | the walkers: thirst at the species' rhythm, met by E while wading or at the water (needs.js) |
| hunt | find prey by perception, close unseen, strike | the AI hunts (fox pounce, lion ambush) and the player's (hunt.js: the lion, coyote, fox, hawk, raven, jay); the kill is the family's catch move and the prey falls (2026-10-30, docs/movement.md "The catch"): the cats' leap and neck bite, the canids' mousing pounce, the hawks' talon strike and mantle, the corvids' bill stab, from `catch` blocks per family in the locomotion tree |
| evade | notice the predator first (perception, the watchers' alarms), reach cover, keep the group together | the AI flees; the covey and flock flush |
| cache | store in season, recover later; competitors pilfer; a family defends its granary | the acorn game (raven), the squirrel and woodpecker caches |
| shelter | be in cover, a cavity, a burrow or the roost before dusk, a storm or a predator | turkeys roost at dusk; deer bed by day |
| court | find and win a mate in the season | no |
| rear | keep the young fed and alive; an escort game, collective where the young travel with the group | the lion's young and the deer's fawns follow |
| disperse | leave the natal range for an empty territory | no |
| watch | the collective's sentinel; an alarm sends everyone to cover | the ground squirrel colony's alarm; the jay mobbing |

## What a need asks the world to contain

Aaron, 2026-10-27: "whenever a species has a need, we also need to generate a request for that species to be generated
by the pipeline." Every game with a resource now carries `requires`: the objects a player meets for it and the client
module that draws them (acorns under the oaks: acorns.js; grass: grass.js; browse and cover: the shrubs and trees;
water: water.js; burrows: the ground squirrels' only; cavities: the granaries only; insects: nothing yet) and its raster
(`client/res_<resource>.png`, the four seasons as RGBA on the 30 m grid, written by resources.py for the client to read
the score under the player). The tile's `requests` gathers every resource and prey species its games need with a
status: drawn, partial or missing. On the home tile: 9 resources needed, 5 drawn, 3 partial (cavities, snags and cliffs,
burrows) and 1 missing (insects, needed by ten species), and 10 prey species, all drawn. That list is the pipeline's and
the client's to-do for the games of life, and it is generated, so a new species or resource in the tables appears on it.

## The games of life in the client

needs.js (2026-10-27): in a walker, hunger and thirst from 1 to 0 over minutes (food 7; thirst by the drink game's rhythm:
daily 4, often 8, rare 16; none means no thirst), eating by holding E where one of the species' gather resources this
season scores at least 25 on its raster (about 20 s of grazing from empty), drinking by E while wading or at the water
(10 s). Under a quarter the body slows to 0.7. The widget bottom right shows the meters and, when a need is low, the
nearest good cell of the resource, found by scanning the raster in rings round the body, with bearing and distance.
Everything comes from games.json and the rasters, so any species in the tables gets its needs; a species whose food this
season is prey rather than a raster (the hunters) has no drain yet, since hunting is not a loop. The acorns are their
real size (2 cm by 3 cm, ACORN_R in acorns.js) and lie on the ground; the glow still finds them.
Since 2026-11-03 they are drawn only for a body whose diet has acorns that season (a gather or cache game on the
acorn mast, or a forage row for an oak's acorns: `acorns.js eatsAcorns`); the shared world keeps them for everyone else,
and the spirit sees none. Eating takes the head to the food on every rig (decisions, "food shown by diet").

The forage relation (`relations.forage`: [animal, plant, part, resource, seasons], written by pipeline/games.py from the
plant records' `eaten_by`) is what the client reads to know a body's food plants this season (needs.js `foodPlants`),
and it is used three ways (2026-10-29 and 2026-11-01): needs.js names the plant under a feeding body ("blue dicks here:
hold E") and feeds a little faster on a named one; forage.js lights every food plant within the body's radius with a
warm glow, weighted by the row's part against the plant's state this month (a flower while it flowers, seeds once
set, berries while the crown shows them), dimmer as the body is fed; and scent.js draws the food plants in reach as
scents, one per species, with their names. A species with no rows this season (the lion, the lizard) gets none of the
three; a new plant record with `eaten_by` gets all three on the next `derive`.

The fruit (2026-11-04, `client/src/fruit.js`; decisions, "fruit on the plants"): the same rows, read for their berries
and seeds of woody plants, put the fruit itself on the plants: a small model for each of the 19 kinds the records name
(the berry shrubs, walnut, bay nut, maple samaras, ceanothus capsules, redbud pods; acorns stay the acorn game's), hung
on the crowns or lying under the trees, glowing as the acorns do, within 16 m of the body and faded with the distance.
A plant is in fruit in its species' berry months (`foliage.berries`, the months the crowns paint them), else in its
`eaten_by` seasons, and its fruit is drawn only for a body that eats it this season; on a tile whose games have no
forage rows (Placerville) the library's `eaten_by` stands in. A new berry record with `eaten_by` and a `foliage.berries`
block needs a model in `KINDS` to be drawn. The acorn and the rose hips are Meshy models baked to vertex colours
(`tools/build_fruit.py`, `client/assets/fruit/`); the rest are procedural.

Scavenge (2026-11-02, `docs/game-scavenge.md`, `client/src/carrion.js`): the scavenge relation played out. Every kill
is a carcass that decays over a real day in stages drawn on the body, with a meat store by its mass that each feed
draws down; it is a scent ("dead animal") whose reach grows with the stage, and for the species `relations.scavenge`
lists (and the lion at a lion's kill) it glows from a distance by species, the vulture's kilometres from the air the
farthest. The AI scavengers come by what they notice (the vulture and the raven by eye, the coyote and the bear by the
nose), feed in a pecking order and leave. Shared through the game server's world for the tile and season, beside Dig.

Dig (2026-11-02, `docs/game-dig.md`, `client/src/dig.js`): the first played game registered from the pipeline. A
rule in `pipeline/games.py` (PLAYS) tags the games a client module plays out: the vole's shelter in a burrow (its den)
and the coyote's hunt of the vole carry `play: ["dig"]`, and the tile's `plays.dig` lists the module and the species
(the five foothill and San Francisco tiles: the vole and the coyote; the Yosemite tiles, which have no vole: none). The
vole digs tunnels, chambers and holes at half an inch a second; the coyote digs a pit at the same rate, and a tunnel it
meets opens and glows toward the voles. The burrow request's objects now name dig.js beside the ground squirrels'
burrows (still partial). The tunnels are the tile's shared state on the game server, decaying after a week no animal
has been inside; the AI voles and coyotes dig and use them too.

The predator's eyes, the quarry and the dive (2026-11-06, `client/src/sight.js`, `quarry.js`, `dive.js`; decisions, "a
predator's eyes, the selected quarry and the dive"): the hunt relation read once more. For a body whose species hunts
(`relations.predation`), the species it hunts are seen as far as its eyes reach (perception.json `senses.vision`, capped
at 600 m; kept alive and drawn to 320 m for it) and are lit in their colour while the camera has a line of sight to
them: the ground, the near trees' crowns and trunks and the canopy raster close it, cheaply and a few times a second per
animal. Tab, or a click on a lit one, selects it: a ring of its colour under it, the hunt panel's goal. A hunting bird
above its selection gets the dive (Q): wings tucked, straight at it, faster and faster; the prey may see it coming, more
likely the nearer it gets, and then runs its own escape (a rabbit bolts, a ground squirrel goes down, a vole hides); a
prey that reached cover is not there to take, and losing the line of sight calls the dive off. The strike is the catch.
On the home tile as a red-tail, the last batch on the finished code: 6 dives, the prey saw 4 coming, 5 caught (the voles
that saw it all the same: their run to hide follows the runway at 1.6 m/s, slower than a stoop), and a brush rabbit that
saw it bolted out of sight and the dive was called off. Earlier runs had a ground squirrel go down its burrow and a
jackrabbit run into cover the same way. Since 2026-11-08 a lit prey animal reads as a dim orb round a bright heart, with the spirit's
soul column ("spike") over it, grown with distance so it reads from a dive's height; a group stands one spike at its
centre (decisions, "a lit prey animal reads as a dim orb, a bright heart and the spirit's spike").

The strikes (2026-11-06, `client/src/strikes.js`, `combat.js`; decisions, "the hunt's strikes"): with a prey animal
selected a walking hunter has its family's strikes (the cats bite, swipe, pounce; the bears add a swipe to bite and lunge;
the rest bite and lunge) on keys 1-3, each with its reach, damage and cooldown from the bodies' masses and lengths, the
prey's health bar on the screen and over it, health coming back slowly out of a fight, and at none the existing kill.
Struck prey runs its own escape, or, much the bigger, now and then fights back. In spirit form any animal is a target
(click, Tab), the chips fly the spirit to the nearest of a species, and the one action, Embody, flies into the target
and becomes it.

Plant targets (2026-11-06, decisions "plant eaters target their food plants"): a body with food plants this season can
target them as it targets animals (Tab, a click): the frame names the plant and the part it eats, a warm ring marks it,
and with one targeted the act feeds only within the body's reach of it (E out of reach walks there, then eats). The same
forage relation that lights the food plants and gives their scents decides which plants are targets.

Desirability and the sniff (2026-11-06, decisions "the sniff's shockwave"): the games step scores each eater's foods per
season from the relations themselves (the part eaten's energy, a seasonal pulse; the prey's mass against the optimal prey
size and the diet's order) into `relations.desirability`, 0..1. A sniff sends a ring out from the body to its smell reach
and every food it passes pulses once, nearest first, as a soul does in the spirit's sight: the most wanted as the mountain
lion's, the least as the vole's.

## What it finds on the home tile

Eighteen species, 275 games, 146 of them collective, 29 predator-prey pairs, 5 scavenging links
(the raven and the vulture follow the lion and the coyote; the coyote follows the lion), 51 alarm links (who notices
a predator first: the raven sees the hawk at 1,200 m and warns the quail, vole, rabbits, squirrels and lizard; the deer
smells the lion at 300 m and its snort warns the turkeys and ground squirrels, which would notice it at 60 m). With the needs and diet tables
(species_data.py NEEDS and DIET, 2026-10-27) every species that uses open water drinks each season, every species has
a shelter game each season, every prey species has an evade game per predator and every group species a watch.

| species | unit | gather | drink | cache | shelter | court | rear | hunt | evade | watch | predators |
|---|---|---|---|---|---|---|---|---|---|---|---|
| raven | pair | 3 | 4 | 1 | 4 | 1 | 2 |  |  |  |  |
| red-tailed hawk | solitary |  | 4 |  | 4 | 1 | 1 | 2 |  |  |  |
| black-tailed deer | herd | 5 | 4 |  | 4 | 1 | 2 |  | 2 | 1 | coyote, lion |
| gray fox | solitary | 1 | 4 |  | 5 | 1 | 2 | 2 |  |  |  |
| western gray squirrel | solitary | 3 | 4 | 1 | 4 | 1 | 1 |  | 1 |  | hawk |
| acorn woodpecker | family | 3 | 4 | 2 | 4 | 1 | 1 |  |  |  |  |
| California quail | covey | 3 | 4 |  | 4 | 1 | 2 |  | 4 | 1 | hawk, coyote, raven, fox |
| scrub-jay | family | 3 | 4 | 1 | 4 | 1 | 2 |  |  |  |  |
| Steller's jay | family | 2 | 4 | 1 | 4 | 1 | 1 |  |  |  |  |
| turkey vulture | solitary | 4 | 4 |  | 4 | 1 | 2 |  |  |  |  |
| brush rabbit | solitary | 4 |  |  | 4 | 1 | 1 |  | 4 |  | hawk, coyote, lion, fox |
| jackrabbit | solitary | 5 |  |  | 4 | 1 | 1 |  | 3 |  | hawk, coyote, lion |
| California vole | solitary | 3 |  |  | 4 |  | 2 |  | 4 |  | hawk, coyote, raven, fox |
| coyote | solitary | 2 | 4 |  | 4 | 1 | 1 | 2 | 1 |  | lion |
| mountain lion | mother and young |  | 4 |  | 4 |  | 1 | 4 |  |  |  |
| wild turkey | flock | 4 | 4 |  | 4 | 1 | 2 |  | 2 | 1 | coyote, lion |
| ground squirrel | colony | 3 | 4 |  | 4 | 1 | 2 |  | 4 | 1 | hawk, coyote, lion, fox |
| fence lizard | solitary | 3 |  |  | 4 | 1 | 1 |  | 4 |  | scrub-jay, hawk, raven, fox |

Each game carries its hotspots (up to 12 cells in the resource's top 3% that season, at least 150 m apart, as tile
metres with the score) and its scarcity. Water in summer and fall: 12 sources, scarcity 0.93, and thirteen species
that drink. Acorn mast in fall: 12 hotspots, scarcity 0.50, and ten species competing for it. Browse in spring is
everywhere (scarcity 0.24); in winter it scores under 50 on the whole tile, so the deer's winter browse game is the
hardest gather on the tile. A drink game carries the species' rhythm (daily, often, rare); a court game its ground.

## What the data was missing, which the classifier showed at once

- **The hunt lists were thin** (fixed 2026-10-27 with `DIET`): quail, turkeys, the jays, the woodpecker and the raven
  had no predator in the calendar, so no evade or watch game, though the hawk takes quail and the coyote and fox take
  turkeys and ground birds. The calendar's `hunt` resources were written for the hunter's story, not the prey's. The
  diet table per predator (prey, and whose kills it scavenges) is read beside the calendar; the raven and the scrub-jay
  are predators of lizards, voles and quail nests, which the animal briefs say and the calendar did not.
- **Drink was only the deer's** (fixed with `NEEDS`): every species that uses open water now drinks every season at its
  rhythm (daily, often, rare), and the rabbits, the vole and the lizard, which take moisture from food and dew, do not.
- **Shelter and court have places** (fixed with `NEEDS`): a shelter game in every season the calendar gave none, in the
  species' own cover, cavity, burrow or tall roost; the courting ground (the rut's and the strutting ground's open grass,
  a granary, a cliff) gives court its hotspots.
- **Alarm needed perception with range and sense** (fixed 2026-10-27): the yes-or-no matrix made nearly every species
  perceive every other, so the only alarm links were the brush rabbit's (4). Now `species_data.SIGNATURE` gives how far
  each species gives itself away in the open by sight, sound and scent (a soaring hawk is seen 1.2 km off, a stalking
  lion not until 60 m, but smelt at 300 m), and `detect_m(p, q)` is the best of p's senses (`species.json` `senses`)
  against q's signature. `perception.json` carries the whole matrix (`detects`, m) beside `perceives`. A watcher is a
  species with an alarm call others heed (`ALARM_CALL`, with the call's carry) that notices the predator at least a
  quarter further off than the prey does; the home tile has 51 such links, each with both distances. Every evade
  game carries how far its prey notices the predator (`notice_m`) and its watchers with theirs; every hunt game how far
  each prey notices the hunter (`noticed_at_m`): the stalk's difficulty.
- **Scarcity is per tile, not per animal.** A game's difficulty should also count the competitors' numbers (the
  population the rarity ranking already computes) against the hotspots' capacity.

## The snakes' prey (2026-11-06)

`DIET` and the calendar cover the static cast only, so a tile's own snake (a `fauna.json` slot with `reptile` `snake`)
hunted nothing: Lamar's and Teton's garter snakes had no `predation` rows. `pipeline/games.py snake_predation` adds them
by rule (`add_snake_predation`, in the games step and in `python -m pipeline.games tiles/<id>/games.json`). A snake
swallows its prey whole, so its gape bounds it. It takes the tile's ground-living amphibians, rodents, shrews and
lizards (the trait cards' class and order, never a bird), from 0.005 of its own mass up to its gape: 0.6 of its mass
for the vipers, 1.0 for the boas and pythons, 0.25 for the rest (a colubrid such as a garter snake lives mostly on frogs,
salamanders, voles and mice; Greene 1997, "Snakes: the evolution of mystery in nature"). The insects and worms of its
diet have no bodies here. `relations.snake_prey_basis` records the rule.

- **Lamar** (`utm12n_557_4964`): the garter snake takes the tiger salamander, the western toad, the Columbia spotted
  frog, the montane and meadow voles, the western jumping mouse and the yellow-pine chipmunk.
- **Teton** (`utm12n_514_4838`): the western toad, the spotted frog, the deer mouse and two chipmunks.
- **Corcovado** (`utm17n_210_932`): the terciopelo (1.04 kg, a viper's gape) takes the common basilisk, Savage's thin-toed
  frog and the red-tailed squirrel. Lamar's, Teton's and Corcovado's `games.json` gained the desirability with this
  run, since they predated that step.

The client reads these rows as any others (`animals.js buildHunts`: the strike, the sniff's wave, desirability). The
small ones are now killable: the yellow-pine chipmunk, the shrew, the salamanders, the toad and the frog
(`animals.js KILLABLE`).

**The strike's damage** follows the hunt's rules (`strikes.js`): a third of the health of prey the snake's own size, which
kills a frog or a vole outright. **Venom** (Viperidae and Elapidae: `strikes.js venomous`) does another half of the
bite's share over 8 s after the strike (`animals.js venomTick`, on the host; everyone's bar every 0.5 s). The struck
prey runs off with it. A kill by the venom, wherever the prey has run, is the striker's catch (`combat.js` takes the
`kill` event marked `venom`). A garter snake's bite has no venom.

**Open.** The trait cards carry no diet for the snakes, so the rule stands in for one. Tree squirrels are not killable
yet, so the terciopelo's squirrel row waits on that. Corcovado's small rodents were cut by the slot caps.

## Next

1. The client's `games.js`: one runtime per archetype, parametrised by `games.json`; the acorn game becomes the cache
   archetype's raven instance, the herd pilot the base for every collective game. Each loop has a visible target (the
   bar at the bottom could show the current game's resource and the nearest hotspot's bearing), a score, and a hand-over
   to the AI when the player stops, as the herd does.
2. Difficulty from competitors' populations against hotspot capacity.
3. Done 2026-10-27: the client's animals read `detects` and `alarm_calls`: a hunter is noticed at each prey's distance
   (alert, then the flee radius capped by it) and a watcher's call sends the hunted within its carry to cover
   (decisions, "the animals notice the player at their own distance"). Done 2026-10-28: AI predators are threats to AI
   prey (prey react to the nearest noticed predator, AI or player; watchers call at AI hunters; lions stalk and rush
   herds, canids trot at and pounce on small prey, hawks stoop at voles), alarm calls are heard, and the hunt ends: a
   rush or pounce that lands, or the player's E within reach (a lion, coyote or fox) or pass within reach (a hawk or
   raven), kills; the dead lie as carrion (since 2026-11-02 for a real day: Scavenge, `docs/game-scavenge.md`) and
   the scavenge relation brings ravens, vultures and coyotes to them; a hunter's hunger drains until a catch. Done 2026-10-29: the prey's nose: perception.json
   carries each species' `senses`, and an animal notices the player by its eyes and ears (shrunk by the stalk) or by
   its nose shaped by the wind (animals.js noticeAt: full with the wind from the player to it, a fifth the other way),
   whichever is farther; the hunt panel says "downwind of you" when the wind carries the hunter's scent to its prey. Done 2026-10-28: the hunt as a loop (client/src/hunt.js: the
   stake, the goal panel, the stalk in cover, the chase with stamina and the gallop, the arc; decisions "The hunt loop").
   Done 2026-10-29: the player's senses as indicators (sight.js, soundCues.js, scent.js): a predator or prey the
   camera has in sight is lit in its rarity colour for a 5 s hold and throbs when it has the player in sight (the hunt
   panel: "spotted", "it sees you"); a heard one rings on the screen at its point or at the nearest edge; a scent is
   drawn when new (it flickers in and away) or while the player sniffs (L, the slot, or the canids' and the lion's E),
   each strand labelled. Still to do: the court and rear loops; the prey's own win.
