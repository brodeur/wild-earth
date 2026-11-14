# The first twenty minutes, home tile: a draft

Draft of 2026-11-13, after the whole-project review ([review-2026-11-13.md](review-2026-11-13.md)) and Aaron's "Yes,
draft it". Nothing here is built. It is for the home tile (`utm10n_680_4280`), this season, and for a person who
lives on it and has never seen the game. Four questions for Aaron are at the end.

## What a person should have by minute twenty

1. **They have seen their own place without us**, and said its name aloud. (The brief's adult and the parking lot.)
2. **They have finished one thing an animal does here this month**: carried acorns and hidden them.
3. **They have been on both sides of one moment**: the one who hides and the one who is hunted.
4. **They have a reason for tomorrow, and one for outdoors today**: their cache is still there, and there is one thing
   to go and look for under a real oak. (The brief's child and the acorns.)

## Rules

- One line of words at a time, at the bottom, gone when the thing is done. No panels, no pauses, no fail screens.
- Controls are live from the first frame. Every beat can be ignored; the world carries on.
- Everything shown is true today: the date, the weather, what is in season.
- Only what the first session needs is on screen. The menu, the other sixty species and the other tiles are there
  afterwards.
- No account before playing. A name is offered at the end, to keep the cache.

## The beats

| Minutes | Beat | What the player does | What they see and are told |
|---|---|---|---|
| 0 to 1 | **Where do you live?** | Types a road or a place into one box | The earth turns and falls toward it |
| 1 to 2 | **Today, then without us** | Nothing: watches | From 120 m over their own cell: today's photograph, their road named, "13 November · 9 °C · light rain". The photograph dissolves into the rewilded world; the roads linger as faint lines, then go. "The same place, the same day, without us." |
| 2 to 4 | **The wisp** | Moves, looks, touches a body | Three bodies near them glow warm: a raven overhead, a squirrel in the nearest oak, a deer herd. "Anything alive can carry you. Touch one." |
| 4 to 9 | **Home from the air** (raven) | Flies to a place they know | Three named places stand as thin columns of light on the horizon. Names surface as they pass over creeks and ridges. At the column, what stands there today flickers for two seconds and is gone |
| 9 to 14 | **Put something away** (raven) | Takes acorns from a lit oak, finds a hole, hides them | "Acorns. Fly close." Then "Hide them where no one is watching." The season's board appears: ravens, squirrels, woodpeckers. The oak becomes **their tree**, marked for them alone |
| 14 to 18 | **The other side** (squirrel) | Becomes the squirrel that watched; buries one acorn; a hawk comes | Small body, tall grass, the smell of buried acorns. Jays call. "Something is hunting." Up the oak, or not. If not: the wisp again, "The hawk eats tonight. Choose again." |
| 18 to 20 | **Today at home** | Reads one card | Their cache and their tree; the fall board; three lines of what this season is here; **Outside today**: "Find an oak. Look under it for caps with no acorn in them: someone has been there." Then: keep this with a name; send it to a neighbour; tomorrow's weather |

**The deer is the quiet path.** A person who cannot steer a flight, or does not want a goal, touches the herd:
walk, graze, drink at the creek, lie down, and the herd carries on when they stop. No lines after the first. The
lion may come. It ends at the same card.

**The opening shot is also the loading.** Today's photograph over one cell is one texture on the terrain, with no
trees. If it can be drawn before the vegetation is built, the minute of loading and shader compilation becomes the
"today" view, and the dissolve happens when the world is ready. This is the part I am least sure can be built as
described.

## What exists and what must be built

Sizes are my estimates of lane time, not measured.

| Piece | Exists today | To build | Size |
|---|---|---|---|
| Arrive over an address | Place search on the home screen; a start at `?lat=&lon=` | A first-session path with one box, the point snapped to a grid cell and stored nowhere | 1 day |
| Today, then without us | The present-day view (P), its cross-fade, the road holograms | Enter with it on, the timed dissolve, the caption | 1 day |
| The photograph while loading | Nothing | The terrain and photograph drawn before the vegetation | 2 days, uncertain |
| The guide | A toast line (`ground.say`), the acorn hint line | A small state machine: one line at a time, conditions read from the systems, progress in the browser, off for a returning player | 2 days |
| Three bodies | The spirit's warm bodies, touch to enter, `animals.summon` | Offer only three in the first session, one of each placed near | half a day |
| Columns and the flicker | Place names (`places.describe`), the souls' columns | Three known places as columns; the two-second present-day flicker on arrival | 1 to 2 days |
| Acorns and the cache | All of it: glow, carry three, stash holes, the board, the shared world | Nothing | 0 |
| Their tree | Landmark ids on the old trees | A mark only that player sees, kept in the browser | 1 day |
| The other side | The squirrel's climb, its smell, jays' alarm calls, hawks that stoop, the soul at a death | One hunt started on purpose in the first session | 1 day |
| The card | The calendar, today's weather, the board | The card and its Outside line per season | 1 to 2 days |
| What I saw on 2026-11-13 | | Shade close to black in the morning; the ground's colour from the air; a guard on the frame | 2 to 3 days |

About two weeks for one lane, less with three in parallel. The acorn game needs nothing: the first twenty minutes
are mostly an order and a voice for what is already there.

## The test

Five adults and two children who live on the tile. A recent laptop each (theirs if it is one). Twenty-five minutes,
thinking aloud, no help, screen and voice recorded with their consent, a parent with each child. Half start over their
own address as above. The other half start at the tile's centre with the mini-map off and are asked to fly home: the
brief's own measure.

Watch for: the seconds to their first movement; the first place name they say aloud; whether they reach a place they
know, and how long it takes; whether they hide an acorn; whether they change body unasked; what they do at the death;
whether they read the card. Ask the next day: did you look under an oak; would you open it again.

It has worked if five of the seven name a real place unprompted in the first five minutes and five of the seven hide
an acorn. Anything they stall on for more than a minute is the next thing to fix.

## Left out on purpose

Other players, hunting as the hunter, digging, scavenging, the field guide, the menu, the other tiles. All of them
stay reachable after the card.

## Questions for Aaron

1. **Start over their own address, or at the tile's centre?** I recommend their address: recognition in the first
   minute. The centre start stays as half of the test.
2. **The hawk: started on purpose once, or left to the world?** I recommend on purpose, once. Left alone, most
   first sessions would have no hunt.
3. **Can a child's first body die?** I recommend yes, gently: the soul leaves, the wisp is back at once, one line.
4. **A name before or after?** I recommend after, at the card.
