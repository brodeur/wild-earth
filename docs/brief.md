# Wild Earth: project brief

Working title. This is the standing statement of the goal. Decisions that changed it
are in [decisions.md](decisions.md); what is built and what is next is in
[roadmap.md](roadmap.md). Start here.

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

## What players do

Each animal has games appropriate to the season: hunt, prepare a nest, cache food,
disperse. Seasons track the real calendar at the tile's location. Games are a small set
of verbs parameterised per species (forage, cache, hunt, nest, den, court, rear,
disperse, shelter), not bespoke mini-games, and the best encounters are asymmetric:
a hawk's hunt and a squirrel's forage are the same moment from two sides.

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
