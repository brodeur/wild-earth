# Multiplayer: the title, the earth, friends, groups and the chat

Design written 2026-11-01 from Aaron's spec of the same day, before any lane starts. The decisions here were
his: username and password plus Discord first, the hub beside `server.py` with SQLite, positions relayed live
and never persisted, and a place is a built tile (go to Placerville, five other people are there). The lane
plan is at the end; each lane is held to this document and reports back against it.

## What the player sees

1. **The title.** A field of stars, drifting slowly. Across the middle, WILD EARTH in a wide simple
   geometric face with big letter spacing (Syncopate from Google Fonts, or another wide face if it reads
   better; the body text stays DM Sans). Behind it the page loads what the screen needs: the tile index, the
   hub's configuration, the earth's textures. Nothing else is built yet.
2. **The earth rises.** When the loading is done the title fades to black and the earth comes up from the
   bottom of the screen, a crescent of sunlight on its limb, the rest of it dark. There are no city lights
   on the night side: it is the earth with no humans.
3. **The sign-in.** A modal over the crescent: username and password, Sign in with Discord, Sign in with
   Google, Sign in with Apple. Google and Apple are drawn but greyed until their keys exist (the hub says
   which providers it has). A link to make an account. If the page's server has no hub at all (a static
   host), the modal says so and offers to explore alone, which is the game as it is today.
4. **The earth, lit.** On a good sign-in the modal fades, the earth rises the rest of the way and the sun
   swings round to light the side that faces the player: the player's last tile, or the first in the index.
   Dots appear at the built tiles. Over the right side of the screen a list of the places in view, sorted
   by how many players are in each, then by name. Grab the earth and spin it: it coasts, the dots on the
   near side are the ones listed, and the list re-sorts as the view changes.
5. **Friends, top left.** A row of the avatars of friends who are online. A button toggles the full list:
   at its top a Create group button, then a search box to find other Wild Earth users by name, then friends
   (online first) and pending requests. An avatar is a coloured wisp seeded from the user's id; no uploads.
6. **A group.** Create group asks for a name (optional) and lets the player add people from the list. The
   group's members are then listed in the left menu under the group's name. A member can leave; the
   creator can remove. Groups are small (sixteen at most).
7. **Video and audio, top middle.** Two toggles, both off. They do nothing until the last lane and say so
   on hover.
8. **The chat, bottom left.** A chat input. Above it a translucent pane with the chat history, invisible
   until a message arrives, then fading in, and fading out again some seconds after the last one (it stays
   while the input has focus). The chat goes to the group when the player is in one, else to the players
   on the same tile once in the world; on the earth with no group the input says there is no one to talk
   to yet.
9. **Going somewhere.** A player picks a place (a dot or a row). Alone, the world builds behind the earth
   as it does today behind the cards, and the arrival follows. In a group, every other member gets a
   dialog: *Aaron wants to go to Placerville. Join · Not now*. Those who join have their world built for
   that tile and arrive in spirit form above and behind the one who picked it (6 m up, 10 m back along the
   picker's heading), then are free. A member who joins later arrives behind the picker wherever they are
   by then. Not now leaves that member where they are.
10. **The season** is the real one at the tile, by the calendar, as the brief says. The season slider of
    today's opening screen does not come to the earth; the HUD panel's season control stays for play.

The dev paths (`?skip=1`, `?game=1`, `?as=`) go straight into a world as they do now, with no title, no
sign-in and no hub, so the viewer stays verifiable from a URL.

## The hub

A hub is one process that holds accounts, friends, groups, presence and chat for the players of a node.
It lives beside `server.py` in the same process (the dev server today; a public host later, which is a
separate step and not designed here): `hub.py`, mounted at `/api/hub/*` and `/api/hub/ws`, with SQLite at
`data/hub.sqlite` (git-ignored). The acorn game's world (`GameWorld`) and the hub stay separate: nothing
joins a user id to a game player id, and the game keeps its per-round rotating ids.

The WebSocket framing and the connection's threads now inside `GameConn` are factored into `ws.py`
(`WsConn`: the handshake, `recv`, the writer queue, the token bucket); `GameConn` and `HubConn` both
subclass it.

### Accounts

- **Username and password.** A name of 3 to 24 characters (letters, digits, `_` and `.`; unique, case
  folded), a password of at least 8. Hashes by `hashlib.scrypt` with a per-user salt (standard library; no
  new dependency). No email address is asked for or stored, so there is no password reset by email: at
  sign-up the hub shows six one-time recovery codes once (hashed in the database), and a sign-in with a
  recovery code lets the player set a new password. Sign-in attempts are limited per name and per address.
- **Discord.** The authorization-code flow with the `identify` scope only (never `email`). The hub keeps
  the Discord user id in `identities` and takes the Discord username as the first display name. The
  application id and secret live in the git-ignored `.env` as `DISCORD_CLIENT_ID` and
  `DISCORD_CLIENT_SECRET`, read like `MESHY_API_KEY`, never printed or logged. Aaron registers the
  application at the Discord developer portal and sets the redirect to `/api/hub/oauth/discord`; the lane
  cannot do that. Until the keys exist the button is greyed.
- **Google and Apple** use the same `identities` table when their keys exist (`GOOGLE_CLIENT_ID` and
  secret; Apple needs a developer team, a service id and a signing key). Not built in the first lanes; the
  buttons are drawn greyed.
- **Sessions.** A random 32-byte token, its hash in `sessions`, sent as an `HttpOnly`, `SameSite=Lax`
  cookie `we_session` that slides for 30 days. The WebSocket upgrade is authenticated by the cookie. Sign
  out deletes the row.
- **Display name and avatar.** The display name starts as the username and can be changed; the avatar is
  a wisp coloured from the user id (a hue, a second hue, a swirl), drawn by the client.

### Tables

```
users        id (uuid), name, name_fold (unique), display, pass_hash, pass_salt, created_at, findable
identities   user_id, provider ('discord' | 'google' | 'apple'), subject (unique per provider)
recovery     user_id, code_hash, used_at
sessions     token_hash (pk), user_id, created_at, last_seen, expires_at
friends      a, b, state ('requested' | 'accepted'), at         (a asked b; one row per pair)
blocks       user_id, blocked_id
groups       id, name, created_by, created_at
members      group_id, user_id, joined_at
messages     id, group_id, user_id, text, at                     (group chat, kept 7 days)
```

Nothing in these tables is a position, a tile or a time of play. Presence (who is online, which tile they
are in), tile rooms, tile counts and the tile chat are in memory only.

### Privacy

The rule until now was "never store a player id beside a position". Groups need live positions shared and
the places list needs to say how many players are at Placerville, so the rule becomes:

- A position is relayed, never persisted. It goes to the members of the player's group who are in the same
  tile, at 5 Hz, and to no one else in the first lanes (a later step may show every player on a tile as
  their animal, relaying to the tile's room; that is the same rule). It is not written to disk, not logged,
  not kept after the connection closes.
- The places list needs only a count per tile: the number of distinct users with a connection in that
  tile's room. Counts are what the hub sends to the earth; never who.
- Presence tells friends and group members that a user is online and, when they are in a world, which tile
  (the tile id, never where in it). A user can turn presence down to online-only.
- The hub logs method, path without query, status and counts, as `server.py` does: no names, no chat, no
  positions, no request bodies.
- Search finds users by name prefix (3 characters or more, rate limited) and returns name, display name and
  avatar seed, nothing else; a user can be unfindable. A blocked user cannot find, friend or message the
  one who blocked them.
- No email, no anchor, no address: the brief's rule stands (`brief.md`, `contributing.md`).

### Protocol

JSON messages with a `t` field over `/api/hub/ws`, authenticated by the session cookie at the upgrade.
Rate limits as the game's token bucket. The client's module is `client/src/hub.js` (a class `Hub`, the
socket, reconnect, and an event emitter the screens subscribe to).

Client to hub:

```
hello     {}                                  -> welcome {you, friends[], requests[], groups[], online[], providers[]}
search    {q}                                 -> found {users[]}
friend    {op: 'request'|'accept'|'remove'|'block'|'unblock', user}
group     {op: 'create', name, users[]} | {op: 'add'|'remove', group, user} | {op: 'leave'|'name', group, name?}
chat      {scope: 'group'|'tile', text}       (text <= 500 chars)
place     {tile}                              -> the group's members get invite {from, tile, season}
answer    {invite, join: true|false}
room      {op: 'join'|'leave', tile}          (the client joins its tile's room when a world is entered)
pos       {x, y, z, yaw, form}                (5 Hz, only while in a room and in a group)
watch     {on: true|false}                    (on the earth: receive tile counts)
```

Hub to client:

```
welcome, found, err {why}
presence  {user, state: 'online'|'offline'|'tile', tile?}
friends   {friends[], requests[]}             (after any change)
groups    {groups[]}                          (after any change; each with its members)
chat      {scope, from, text, at}
invite    {id, from, tile, season}
pos       {user, x, y, z, yaw, form}          (from a group member in the same room)
counts    {tiles: {tile_id: n}}               (every 2 s to watchers, only when changed)
```

HTTP: `POST /api/hub/signup`, `POST /api/hub/signin`, `POST /api/hub/signout`, `POST /api/hub/recover`,
`GET /api/hub/me`, `GET /api/hub/config` (which providers are on, the hub's name), `GET /api/hub/oauth/discord`
and its callback. Every POST reads JSON, answers JSON, and errors name the field, not the value.

## The earth

A three.js sphere drawn by `client/src/title.js` in its own small scene (the world's renderer is shared;
the earth's scene is disposed when a world is entered, like the opening screen's assets). The texture is
NASA's Blue Marble Next Generation for the current month (public domain; twelve 2048 x 1024 JPEGs in
`client/assets/earth/`, with the source and the date retrieved in `credits.js`'s `ASSET_CREDITS`, downloaded
into that empty folder as the download rule says). No night lights, no cloud layer at first. A thin
atmosphere rim. The sun is a directional light whose azimuth animates from the crescent's angle to the
facing side on sign-in.

The dots are the built tiles from `tiles/index.json` (`bounds_wgs84` centres), drawn as small discs on
the sphere, brighter with more players, the one under the pointer named. A place's name is the opening
screen's title for the tile today (the best-ranked OSM place in `client/features.json`). The list on the
right holds the dots within 70 degrees of the facing point, sorted by count then name, each row the name,
its region and the count ("5 here"). Drag spins the earth with inertia; the wheel zooms a little.

Choosing a place builds the world as the card screen does now (`onSelect`) and the arrival follows the
wisp. The old card screen (`OpeningScreen` in `arrival.js`, `opening.css`) stays in the code until the
earth is verified on the home tile and then goes, with its pre-rendered sprites.

## The lanes

Each lane gets its own worktree and a brief written from this document, builds against the home tile,
verifies in the viewer itself, commits with honest messages, keeps `docs/decisions.md`, `docs/roadmap.md`
and the report current, and reports what it could not verify. Lanes 1 and 2 touch no common file and run
together. Lane 3 needs lane 1's screen in main; lane 4 needs 1 to 3. Lane 5 is last.

1. **The title and the earth** (client). `title.js`, `title.css`, the earth assets, the hookup in `main.js`
   where the opening screen is made today (the card screen kept for now). Works against a stub hub
   (`?hub=stub`: a fake signed-in user, fake counts, so the screen is built and verified before the hub
   exists), and against the real hub's `config`, `me` and `counts` once it lands. Done when: the title on
   stars, the fade, the crescent rising, the sun swinging round, the dots and the list following a drag,
   a click building and arriving on the home tile, all seen in the viewer; the dev paths unchanged.

   *Built 2026-11-01* (`client/src/title.js`, `client/title.css`, `client/src/hubStub.js`, `client/assets/earth/`;
   `docs/decisions.md` "the title and the earth"): all of the above, seen on the home tile against `?hub=stub` and
   with no hub (Explore where the modal will stand). The hooks for the lanes after it: the screen takes a `hub`
   object with `config()`, `me()`, `watch(on)`, `on('counts', fn)` and `close()` (lane 3's `hub.js` replaces the
   stub and the HTTP-only fallback behind the same calls); `title.onGate = title => …` is called when the sign-in's
   place is reached and the modal calls `title.onSignedIn(user)`; `title.choose(tileId)` is the one function group
   travel wraps; `title.user` and `title.config` hold the hub's `you` and `config`. Open: counts arrive only from
   the stub until `hub.js`; the card screen (`?cards=1`) and its sprites stay until the earth is signed off; a
   Begin on the earth itself (the row's is built); clouds; touch and narrow screens untested.
2. **The hub** (server). `ws.py` factored out of `server.py`, `hub.py` with the tables, accounts (username
   and password, recovery codes, Discord when keys exist), sessions, friends, blocks, groups, group chat,
   presence, rooms, position relay, counts and the protocol above; `tests/test_hub.py` with a small
   WebSocket client over `socket` (no new dependency) covering sign-up and sign-in, a friend request both
   ways, a group, a chat line, an invite, a position relayed to a group member in the same room and to no
   one else, counts, and that nothing but the tables above is written. Done when the tests pass and the
   acorn game still runs over the factored framing.

   **Built (2026-11-01, branch `claude/mp-hub-54b819`).** `ws.py` (`WsConn`, `ws_frame`, `ws_upgrade`: the
   one handshake both endpoints call), `GameConn` on it unchanged in behaviour (one fix: a ping between the
   fragments of a message no longer loses the message); `hub.py` mounted by `hub.handle()` from `server.py`'s
   `do_GET` and `do_POST`; `tests/test_hub.py` and `tests/wsclient.py` (`.venv/bin/python -m unittest
   tests.test_hub`, 11 tests, about 19 s). Verified: the tests; the acorn game in the viewer over the
   factored framing ("1 player here · animals run here", the AI host's events accepted); a `curl` sign-up,
   sign-in and `me`, and the hub socket opened with the cookie. Not verified: Discord against Discord itself
   (no application is registered; the flow is tested with the exchange stubbed), a browser on the hub socket
   (lane 3 brings one). What lane 3 needs to know, where the protocol above was silent or had to grow:
   - **Passwords** are hashed by `hashlib.scrypt` where Python has it; this machine's Python 3.9 is built on
     LibreSSL and has none, so there it is PBKDF2-HMAC-SHA256 at 600,000 iterations. The hash names its
     algorithm and a sign-in rehashes to the preferred one, so a move to a host with scrypt upgrades quietly.
   - **HTTP answers.** `signup` -> `{you, recovery: [6 codes]}`; `signin` -> `{you}`; `recover {name, code,
     password}` -> `{you, left}` (it also ends every other session and closes their sockets); `me` -> `{you}`
     or 401; errors are `{error, field?}` with 400, 401, 403, 404, 409 (name taken) or 429 (limited). `you` is
     `{id, name, display, findable, presence, password: bool, providers: [...]}`. `config` -> `{hub,
     providers}`, where providers lists only external ones (`discord` when both keys exist; the password
     form is always there). A request whose `Origin` is another host is refused (403), the socket too.
   - **Discord** is one path: `GET /api/hub/oauth/discord` without `code` redirects to Discord (state in a
     short `we_oauth` cookie); Discord sends the browser back to the same path, which redirects to
     `/client/?signin=discord` (or `?signin=failed`). The redirect URI to register is
     `<origin>/api/hub/oauth/discord` (`HUB_ORIGIN` in `.env` overrides the Host header). A signed-in user
     who goes through it links Discord to the account; otherwise the Discord username (lower-cased, to the
     name rules, numbered if taken) is the name and its global name the display.
   - **Messages added:** `me {display?, findable?, presence?: 'tile'|'online'}` -> `me {you}` (the doc's
     changeable display name and presence turned down; a `users.presence` column holds the choice);
     `placed {id, tile, season, to}` back to the picker; `answer {invite, from, join}` to the picker;
     `found` carries `q`. `err` carries `re` (the `t` it answers) and `field` where there is one.
   - **Several groups.** A user may be in more than one group, so `chat {scope: 'group'}` and `place` take
     an optional `group` (required when in several); chat out carries `group`. `pos` goes to members of any
     of the sender's groups in the same room. `invite` carries `group`; its `season` is the tile's by the
     calendar (meteorological, the south six months on).
   - **Shapes.** `welcome.online` is `[{user, state, tile?}]`; `requests` are `{id, name, display, dir:
     'in'|'out'}`; each group is `{id, name, created_by, members: [{id, name, display}]}` and in `welcome`
     also `messages: [{from, text, at}]` (the last 50). Tile chat carries `name` (the sender's display) since
     the room's people may be strangers. `at` is Unix seconds. A position is rounded to the centimetre.
   - **Rules chosen:** a group is made from accepted friends; any member adds a friend, the creator removes,
     any member renames; when the creator leaves the longest-standing member becomes the creator; the last
     to leave deletes the group and its chat. A request to someone who already asked you accepts. A blocker
     can still find the one they blocked (to unblock); blocks cut friendship, presence, chat, positions and
     invites both ways, and a group's chat history hides the blocked one's lines. Search: 20 results at
     most, one a second with a burst of five per user.
   - **The client half** is `client/src/hub.js` (a second commit): `Hub.config()`, `Hub.me()`, `Hub.signup`,
     `signin`, `recover`, `signout` (throwing `HubError {status, field}`), and `new Hub()` with `on(t, fn)`,
     `connect()`, reconnect with backoff while `me` still answers (else a `signedout` event), the state as
     last told (`you`, `friends`, `requests`, `groups`, `online`, `counts`), the room and the watch re-sent
     after a reconnect, and a method per message (`enter(tile)` for the room). Verified in the browser pane
     against the server: sign-up, two connections of one user counted once in a room, the tile chat reaching
     the other, sign-out, and `signedout` with no reconnect on a socket without a session.
   - **Open:** Google and Apple; a hub-level ban list; the per-address limit uses the socket's address, so
     behind a proxy it needs `X-Forwarded-For` handled; the cookie is `Secure` only when
     `X-Forwarded-Proto: https` says so.
3. **The social screen** (client). `account.js` (the sign-in modal, sign-up, recovery), `social.js` (the
   avatars row, the list, search, requests, groups), `chat.js` (the input and the fading pane), the two
   toggles, all on the earth screen and carried into the world's HUD (the avatars, the chat), over
   `hub.js`. Done when two seats in one browser (`?seat=2`, as the game's tests do) make friends, a group
   and talk.

   **Built (2026-11-01, branch `claude/optimistic-margulis-d0e20d`).** `client/src/account.js` (`AccountModal`:
   the sign-in in the title's gate, sign-up with the six codes shown once and a copy button, the recover path, the
   no-hub view with Explore in place of the title's placeholder), `client/src/social.js` (`Social`: the avatars row
   and the list; `avatarFor(id, size)` draws the wisp on a canvas from the id, exported), `client/src/chat.js`
   (`Chat`: the input, the picker when in several scopes, the fading pane), `client/src/multiplayer.js`
   (`Multiplayer`: the one object `main.js` makes beside the title screen; it owns the page's `Hub`, gives the
   title its `config()`, `me()`, `watch(on)`, `on('counts')` and `close()`, puts the modal at `title.onGate`, mounts
   the rest on `title.onLit(user)`, joins the tile's room by wrapping `title.onBegin`, and keeps the three fixed
   elements clear of the HUD's panels), `client/social.css`, and the Video and Audio toggles (`#media`, off, "soon"
   on hover). Small changes: `title.js` (an `onLit` hook after `onSignedIn`; the gate goes to `onGate` whether or
   not there is a hub; the drag and the wheel leave the gate alone; the key guard lets `#social` and `#chat` keep
   their keys; a hub given from outside is not closed with the screen), `hub.js` (instance `config()` and `me()`),
   `main.js` (one place, commented), `index.html` (the stylesheet). The seat: `hub.js` has none (the session is the
   cookie), so the second user was a script over `tests/wsclient.py`. Verified in the viewer on the home tile against
   the real hub with two users: sign-up with the codes and the copy button, sign-out, a wrong password refused with
   the field marked, sign-in, recovery with a code ("5 recovery codes are left"), Explore with no hub (a static
   `http.server`, 404 on `config`), a friend found by search and asked, the request accepted, the group made by the
   other user and by the dialog, renamed and left, group chat both ways with the pane fading in and out (7 s after
   the last line, kept while the input has focus), the tile chat once in El Dorado (tagged "here" beside the group's
   lines), the earth's counts and list from the hub (Placerville "1 here" re-sorting to the top as the other user
   entered its room), the row and the list carried into the world beside the menu button and the list moving right of
   the HUD's readouts while the menu is open, the chat above the key line, the toggles' "soon", `?hub=stub`,
   `?skip=1` and `?signin=failed` (the note shown, the flag taken off the URL), no new console errors (the browser
   logs the hub's 401 to `me` with no session as a failed resource; that is the hub saying not signed in). Not
   verified: Discord against Discord (no keys here, so the button is greyed; live it is a navigation to
   `Hub.discordUrl()`), Google and Apple (drawn greyed), touch, narrow screens, two sessions of one user.
   What lane 4 needs to know:
   - `window.__weMp` is the `Multiplayer` (debugging); `mp.hub` the page's `Hub`; `mp.social.nameOf(id)` and
     `avatarFor(id, size)` for the invite dialog; `mp.placeName(tileId)` the place's name from the title's list.
   - The room is joined at Begin (`mp.entered(tileId)`, wrapping `title.onBegin`), not at the world's entry, and a
     tile switch from the Location box does not move it: lane 4 moves the join to the entry and the switch (the doc's
     "joined on entry and left on a switch") and calls `mp.chat.setRoom()` after, so the picker follows.
   - The chat's picker lists the tile's room (when `hub.room` is set) and every group; the group lines carry their
     group's name when there are several scopes. `title.choose(id)` is untouched: wrap it there for `place`.
   - The elements are `#social` (top left; `html:not(.opening)` moves it beside the menu button), `#chat` (bottom
     left) and `#media` (top middle), hidden with the HUD while `html.arriving` or `html.switching`;
     `Multiplayer.layout()` runs on resize and on the `html` and `#game` class changes.
   - Rules chosen: Sign out reloads the page; the display name and a group's name are edited through `prompt()`
     and Block and Leave ask `confirm()` (inline editors are a later nicety); the search box asks 350 ms after the
     typing stops, 3 characters or more; Escape leaves the chat input; a request to someone who asked first accepts
     (the hub's rule); a group's chat history from `welcome` is in the pane without fading it in.
   - The earth is now the spirit world from space (Aaron's refinement, done here): `title.js`'s earth shader uses the
     spirit view's palette and post pass, dimmer, and the dots are bright (`docs/decisions.md`, the lane 3 entry).
   - A choice zooms to the place and shows its card beside the list (Aaron's second refinement, done here): the card
     screen's card (`arrival.js` `CardLineup`, now shared; `opening.css`), its animals arriving in their soul colours
     (`animals.js` `rarityByCode`), Begin on the card; Begin zooms in to the dot, the earth goes black under the dot
     (a DOM spot, `.tt-spot`), and the world fades in through `enterWorld` as the screen's fade takes the dot. Lane 4
     wraps `title.choose(id)` as before; `title.begin()` is the one Begin.
   - Open: Unblock is offered only for users blocked this session (the hub sends no block list); the chat row and
     the nearby-animals bar meet on a narrow window; the species card can overlap the chat pane; the chat's lines
     do not say the time.
4. **Group travel.** The `place` and `invite` messages on the client, the dialog, the joiner's world
   built for the picker's tile and the arrival behind the picker from the relayed position, the tile room
   joined on entry and left on a switch. Done when two seats go to Placerville together and the second
   arrives above and behind the first.
5. **Video and audio.** WebRTC between the members of a group, signalling over the hub (`rtc` messages
   added to the protocol then), the two toggles live, a small tile of each member's video by their avatar.
   Not before the four above are in.

## Open

- Federation of accounts: a user is a row on one hub. A handle of the form name@hub and signing in to
  another node with it are for the federation step in the roadmap, not here. User ids are UUIDs so that a
  later handle can carry the home hub without renumbering.
- Seeing the other players on a tile as their animals, with their names over them for friends: the next
  step after group travel, under the same privacy rule (relay to the room, persist nothing).
- Regions: a place is a tile now; when a bioregion holds several tiles the list can group them.
- Moderation beyond blocking: a report button and a hub-level ban list, when there is a public hub.
