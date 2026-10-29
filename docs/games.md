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
| hunt | find prey by perception, close unseen, strike | the AI hunts (fox pounce, lion ambush); not for the player |
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
   raven), kills; the dead lie as carrion for ten minutes and the scavenge relation brings ravens, vultures and
   coyotes to them; a hunter's hunger drains until a catch. Done 2026-10-29: the prey's nose: perception.json
   carries each species' `senses`, and an animal notices the player by its eyes and ears (shrunk by the stalk) or by
   its nose shaped by the wind (animals.js noticeAt: full with the wind from the player to it, a fifth the other way),
   whichever is farther; the hunt panel says "downwind of you" when the wind carries the hunter's scent to its prey. Done 2026-10-28: the hunt as a loop (client/src/hunt.js: the
   stake, the goal panel, the stalk in cover, the chase with stamina and the gallop, the arc; decisions "The hunt loop").
   Still to do: the court and rear loops; the prey's own win.
