# The first twenty minutes, home tile

Drafted 2026-11-13 after the whole-project review ([review-2026-11-13.md](review-2026-11-13.md)); Aaron: "Yes, build
it", with the four recommended answers at the end. A first build is in the client behind `?first=1`
(`client/src/firstSession.js`); "The first build" below says what it does, what differs from the draft and what has
not been seen. It is for the home tile (`utm10n_680_4280`), this season, and for a person who lives on it and has
never seen the game.

## The first build (2026-11-13)

**The link.** `…/client/?first=1` is the link a tester is sent. `?first=centre` is the brief's own measure: the same
opening, then "Fly home. There is no map." with the mini-map and the lights for known places off. Without the
parameter nothing changes for anyone, except that a player who has hidden acorns through the guide keeps a gold light
over that oak.

**What it does, in order** (each seen in the viewer on the home tile on 2026-11-13, in that day's rain):

1. **Where do you live?** On that link the home screen's search box asks it, and a visitor may choose a place and
   Start without an account (the rule of 2026-11-06, browse but not start, still holds on every other link). A place
   found inside a built tile is the point of arrival, as before; it is never stored and leaves the URL.
2. **Today, then without us.** The entry's black lifts on today's photograph from at most 140 m over the point, looking
   down, with the nearest name, the date and the day's weather over it ("North Street · 13 November · light rain ·
   14 °C"). After 5.5 s the photograph dissolves over 2.6 s into the rewilded world in its own colours (the spirit's
   blue look waits), the roads' lines linger 5.5 s, and the wisp is let down to 18 m over the ground among the trees.
   Any key ends the descent.
3. **The wisp and three bodies.** One line names the keys. A raven, a gray squirrel and a deer are put 50 to 60 m
   ahead under gold lights; touching one, or 1, 2 or 3, enters it. Flown past, they are put ahead again (three times).
4. **Home from the air** (raven). Three named places 0.5 to 3.5 km off stand as pale lights with their names and
   distances: towns first, then named water, then creeks, spread round the compass. Within 220 m of one, today's
   photograph shows for 2.4 s under "DEER PARK · as it is today".
5. **Acorns.** "It is November. Acorns are down." Then, carrying, the hole with the lit rim. The spot where the first
   acorn goes in becomes the player's tree: a gold light, kept in the browser (`wild-earth:first:tree:<tile>/<season>`),
   never sent.
6. **The other side.** Enter becomes a squirrel at the foot of that tree. After a burial, or 80 s, jays call and a
   red-tail is tipped into a stoop at the squirrel (`animals.stoopOn`), following it until the last quarter of its
   fall. Up a tree, off the ground, or more than 4 m from where it comes down: "It pulls away." Otherwise the screen
   goes dark for a moment and the player is the wisp again.
7. **The deer** is the quiet path: one line, then nothing.
8. **Today at home.** Offered as "Enter · Today at home" after the hawk, after seven quiet minutes, or at seventeen
   minutes: the place, the date and weather, the cache and the tree, the place found from the air, the season's
   board, three lines of the season, one thing to look for outdoors, Keep playing, and a link to copy for a neighbour.

While the guide runs the species bar and the acorn game's panel are hidden; the card's Keep playing gives them back.

**Differs from the draft**

- **The death is not drawn.** Tree squirrels are not killable in the animals' code, so the hawk's catch is a dark
  moment and the wisp, and the squirrel's body goes back to the world alive. The line says the hawk had you; no
  carcass lies there. Making tree squirrels killable (the fall, the carcass, the hawk mantling) is the honest fix.
- **The photograph is soft.** From 120 m it shows roads, fields and creeks, not roofs: the tile's present-day texture
  is one image for 10 km. A sharper patch round the point of arrival is a pipeline step.
- **The photograph is not the loading screen.** The world still builds and compiles first (about 30 s on this Mac
  when quiet); the black then waits up to 10 s more for the photograph.
- **The acorn game's panel is hidden** in place of "the season's board appears": it covered the middle of the screen.
  The board is on the card.
- **Tomorrow's weather** is a sentence on the card, not a forecast.
- **The guide is not on by default** for a new visitor. One line would make it so; it waits for the test.

**Not seen, or not checked**

- The deer's path and `?first=centre` were not played through: the Browser pane was hidden before I reached them.
- A second page on the same tile (a mirror of the shared animals): the guide's summons and its hawk need the host.
  If they fail the guide stops and says nothing more; not tried.
- The hawk's "It pulls away" branch (the squirrel up a tree).
- Any real person. Timings and wording are first guesses.
- No automated test: the client has none. Each changed module passes the ES-module syntax check.


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
