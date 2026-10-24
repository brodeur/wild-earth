# Wild Earth: project brief

Working title. This is the standing statement of the goal. Decisions that changed it
are in [decisions.md](decisions.md); what is built and what is next is in
[roadmap.md](roadmap.md). Start here.

## Mission

Connect modern people directly to their bioregion, in a fun and engaging way. Everything
else in this brief serves that: the real terrain, the real species, the real seasons,
and the local knowledge of the people who live there. The project is intended to be
open source and community-built ("crowdware"): the code, the tile package spec, and
the species and asset library are meant to be shared, and regions are built by the
people who live in them with help from agents, not by a studio. (Stated 2026-10-24.)

## Core concept (decided)

- A federated MMO set in the real world as it would be with no humans, played as animals.
- Players log in, give a location, and play in a map generated from real data for that
  place: satellite imagery, terrain, local species data.
- No humans: no buildings, roads or dams. The world is the present day with human
  infrastructure removed.
- Species baseline: today's species, with ranges and densities as predicted 10 years
  after humans disappear.
- Players pick an animal. Each species perceives only a slice of the world. A bird sees
  all birds, squirrels, rabbits, deer, foxes and some large insects; a vole sees much less.
- Agent-built regions: when someone signs up in an unbuilt region, agents research
  species, generate assets and populate the map, up to about a week per region.
- Federated: regions are hosted as nodes that exchange tile packages.
- Crowdfunded regions: players pool money to fund asset generation for a region and
  invite friends; the per-person cost drops as more people pitch in. A matching pool in
  the style of quadratic funding lets less wealthy, biodiverse regions get built.
- Local knowledge matters: people who live in a region are involved in building it,
  not just funding it.
- Engine: progressive level of detail in the spirit of No Man's Sky, scaling to creature
  size (insect scale versus bird scale). The demo starts at larger scales; insect scale
  comes later.
- Shared asset library: species built for one region are free everywhere.
- Bioregions are the social unit: communities, funding and local knowledge organise
  around watersheds and ecoregions, while the 10 km tile stays the technical unit.

## What players do

Each animal has games appropriate to the season: hunt, prepare a nest, cache food,
disperse. Seasons track the real calendar at the tile's location. Games are a small set
of verbs parameterised per species (forage, cache, hunt, nest, den, court, rear,
disperse, shelter), not bespoke mini-games, and the best encounters are asymmetric:
a hawk's hunt and a squirrel's forage are the same moment from two sides.

## Worlds: a location plus a season

A tile exists as four joinable worlds, one per season. The one matching today's date
is live; the others are stable places you can go. Joining is three choices: where,
when, who. Persistent state belongs to a world. Whether state flows forward from one
season's world to the next is still open (see the decision log). (Added 2026-10-23.)

## Direction (2026-10-24)

Push the browser as far as it will go before any native engine. Then the first game:
the acorn game as a living world where acorn woodpeckers, western gray squirrels and
common ravens all collect acorns in their own ways, many of each species are always
present, controlled by AI or by people, and a species-level leaderboard keeps score.
The goal of the game is to recognise one's home in a new way; realism serves
recognition. The open question is whether an open-source engine can be made to
astonish people the way Unreal does, or whether the browser plus real-place data is
itself the astonishing thing.

## Success metric for the demo

Someone who lives in the tile can fly from the tile centre to their own hill from the
air, without the mini-map. When that is true the world is real enough, whatever engine
drew it. (Adopted 2026-10-24.)

## The experience comes first

The world has to be beautiful enough to carry itself before any loop is tuned. Motion
and sound count as beauty: wind in canopies, a hawk circling, deer in grass, birdsong.
The hook is experiential: my own hills, rewilded, as a raven, in today's season. Many
open-world loops can be built once that feeling exists. (Added 2026-10-23.)

## Immediate scope

One tile at a time, starting with the Sierra foothills near Placerville, CA. Three
workstreams sharing one contract, the [tile package spec](tile-spec.md):

1. Dataset pipeline for the tile
2. Admin viewer for the tile
3. Renderer for the tile (a browser client now; Unreal Engine 5 when the browser is
   the ceiling, with an export step already in place)

## Demo species

Playable: common raven, red-tailed hawk, black-tailed deer, gray fox, western gray
squirrel. Ambient: California quail, brush rabbit, California vole, coyote, mountain lion.

## Design notes to keep

- Location privacy: snap to a grid cell, never store or expose a player's anchor.
- Some land knowledge, especially Indigenous knowledge, must stay under community
  control. Follow the CARE principles for Indigenous data governance.
- Be honest in the data: each tile's manifest states what is present-day and what has
  been rewilded.
