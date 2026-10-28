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
| gather | find the resource's hotspots, feed, keep an eye out; competitors deplete the same cells | the graze and forage idles; no scoring yet |
| drink | reach water on a rhythm; in summer the few sources draw every species, and the ambushers | no |
| hunt | find prey by perception, close unseen, strike | the AI hunts (fox pounce, lion ambush); not for the player |
| evade | notice the predator first (perception, the watchers' alarms), reach cover, keep the group together | the AI flees; the covey and flock flush |
| cache | store in season, recover later; competitors pilfer; a family defends its granary | the acorn game (raven), the squirrel and woodpecker caches |
| shelter | be in cover, a cavity, a burrow or the roost before dusk, a storm or a predator | turkeys roost at dusk; deer bed by day |
| court | find and win a mate in the season | no |
| rear | keep the young fed and alive; an escort game, collective where the young travel with the group | the lion's young and the deer's fawns follow |
| disperse | leave the natal range for an empty territory | no |
| watch | the collective's sentinel; an alarm sends everyone to cover | the ground squirrel colony's alarm; the jay mobbing |

## What it finds on the home tile

Eighteen species, 160 games, 79 of them collective, 14 predator-prey pairs, 1 scavenging link (raven follows lion),
4 alarm links (the brush rabbit cannot perceive the lion; the raven, fox, jackrabbit and coyote can, and see rabbits).

| species | unit | gather | drink | cache | shelter | court | rear | hunt | evade | watch | predators | prey |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| raven | pair | 3 |  | 1 | 1 | 1 | 2 |  |  |  |  |  |
| red-tailed hawk | solitary |  |  |  | 1 | 1 | 1 | 2 |  |  |  | jackrabbit, vole, ground squirrel, fence lizard, squirrel, brush rabbit |
| black-tailed deer | herd | 5 | 2 |  | 2 | 1 | 2 |  | 2 | 1 | coyote, mountain lion |  |
| gray fox | solitary | 1 |  |  | 2 | 1 | 2 | 2 |  |  |  | vole, brush rabbit |
| western gray squirrel | solitary | 3 |  | 1 | 2 | 1 | 1 |  | 1 |  | hawk |  |
| acorn woodpecker | family | 3 |  | 2 | 2 | 1 | 1 |  |  |  |  |  |
| California quail | covey | 3 |  |  | 1 | 1 | 2 |  |  |  |  |  |
| scrub-jay | family | 3 |  | 1 | 2 | 1 | 2 |  |  |  |  |  |
| Steller's jay | family | 2 |  | 1 | 1 | 1 | 1 |  |  |  |  |  |
| turkey vulture | solitary | 4 |  |  |  | 1 | 2 |  |  |  |  |  |
| brush rabbit | solitary | 4 |  |  | 2 | 1 | 1 |  | 4 |  | hawk, coyote, lion, fox |  |
| jackrabbit | solitary | 5 |  |  | 2 | 1 | 1 |  | 2 |  | hawk, coyote |  |
| California vole | solitary | 3 |  |  | 2 |  | 2 |  | 3 |  | hawk, coyote, fox |  |
| coyote | solitary | 2 |  |  | 1 | 1 | 1 | 2 |  |  |  | jackrabbit, vole, deer, brush rabbit |
| mountain lion | mother and young |  |  |  |  |  | 1 | 4 |  |  |  | deer, brush rabbit |
| wild turkey | flock | 4 |  |  | 2 | 1 | 2 |  |  |  |  |  |
| ground squirrel | colony | 3 |  |  | 3 | 1 | 2 |  | 1 | 1 | hawk |  |
| fence lizard | solitary | 3 |  |  | 3 | 1 | 1 |  | 1 |  | hawk |  |

Each game carries its hotspots (up to 12 cells in the resource's top 3% that season, at least 150 m apart, as tile
metres with the score) and its scarcity. Water in summer and fall: 12 sources, scarcity 0.93. Acorn mast in fall: 12
hotspots, scarcity 0.50, and ten species competing for it. Browse in spring is everywhere (scarcity 0.24); in winter it
scores under 50 on the whole tile, so the deer's winter browse game is the hardest gather on the tile.

## What the data is missing, which the classifier showed at once

- **The hunt lists are thin.** Quail, turkeys, the jays, the woodpecker and the raven have no predator in the calendar,
  so no evade or watch game, though the hawk takes quail and the coyote and fox take turkeys and ground birds. The
  calendar's `hunt` resources were written for the hunter's story, not the prey's. The fix is a diet table per predator
  (the animal briefs in `library/animals/drafts/*.md` have it in words) that the step reads alongside the calendar.
- **Drink is only the deer's**, because only the deer's calendar names water. Every species drinks; water belongs on a
  needs table per species (daily water, where from: open water, dew, prey), not in the activity list.
- **Alarm needs the perception matrix to be sparse.** On the home tile nearly every species perceives every other, so
  the only alarm links are the brush rabbit's. The matrix should carry range and sense (a vole hears the hawk's shadow
  late; a jay sees it a kilometre off), which `species.json` already has per species (`senses`), so a watcher is a
  species that perceives the predator sooner, not only at all.
- **Court has no place.** Leks, drumming trees and the rut's meeting grounds are places; the calendar gives court no
  resource, so it has no hotspots. Cliff or snag for ravens and hawks, a granary tree for woodpeckers, the meadow edge
  for turkeys would place them.
- **Scarcity is per tile, not per animal.** A game's difficulty should also count the competitors' numbers (the
  population the rarity ranking already computes) against the hotspots' capacity.

## Next

1. The client's `games.js`: one runtime per archetype, parametrised by `games.json`; the acorn game becomes the cache
   archetype's raven instance, the herd pilot the base for every collective game. Each loop has a visible target (the
   bar at the bottom could show the current game's resource and the nearest hotspot's bearing), a score, and a hand-over
   to the AI when the player stops, as the herd does.
2. The needs table and the diet table in `species_data.py`, read by the step, so every species gets drink and evade.
3. Perception with range and sense, so alarms are about who notices first.
4. Difficulty from competitors' populations against hotspot capacity.
