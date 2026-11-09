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
7. **Video and audio, in the controls row.** Beside the menu button in the world, one row: the sound toggle, then
   the microphone and the camera, both off, which show only while another member of the group is in the same world
   (Aaron, 2026-11-04; lane 5 below). On the earth no one is in the player's world, so they are not there.
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
   by then. Not now leaves that member where they are. **Group follow** (2026-11-06, below): a member who presses
   Start on the main screen asks the group's online members along at once; a Join fades to black, loads with a bar and
   puts them behind the one who asked.
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

- A position is relayed, never persisted. It goes only to players in the same world (the same tile's room and the
  same season), at 5 Hz: to the members of the player's group in any form, and to everyone else there only while the
  player is a spirit (2026-11-06, "Who sees whom" below; until then the group alone). A body's pose never goes outside
  the group. It is not written to disk, not logged, not kept after the connection closes. The connection holds its
  last one in memory so that a player who enters the world after it is told where the player is (lane 4), under the
  same rule; it goes with the room or the connection.
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
- Voice and video (lane 5) go peer to peer and are never recorded or stored; the hub relays only the signalling
  (SDP, ICE candidates, who has the mic and camera on), under the positions' rule, and keeps and logs none of it.
  **Peers see each other's IP addresses**: ICE candidates carry them, so a member of the player's group in the same
  world learns the player's public address (and local ones) once either turns on the mic or the camera. A TURN relay
  forced for everyone (`iceTransportPolicy: 'relay'`) would hide them at the relay's cost; not done yet.

### Protocol

JSON messages with a `t` field over `/api/hub/ws`, authenticated by the session cookie at the upgrade.
Rate limits as the game's token bucket. The client's module is `client/src/hub.js` (a class `Hub`, the
socket, reconnect, and an event emitter the screens subscribe to).

Client to hub:

```
hello     {}                                  -> welcome {you, friends[], requests[], groups[], online[], providers[], bodies[]}
search    {q}                                 -> found {users[]}
friend    {op: 'request'|'accept'|'remove'|'block'|'unblock', user}
group     {op: 'create', name, users[]} | {op: 'add'|'remove', group, user} | {op: 'leave'|'name', group, name?}
chat      {scope: 'group'|'tile', text}       (text <= 500 chars)
place     {tile, group?, to?, point?, follow?, season?, date?}
                                              -> the group's members and the people in `to` get invite {from, tile, season, date?, group?, point?, follow?}
                                              (point: the picker's planned arrival, tile-local {x, north}; lane 4. follow: Start
                                              was pressed, group follow: only online members are asked, `placed` counts them.
                                              season, date: the world the sender goes into when not the calendar's, group season)
season    {season, date?}                     (the sender changed the season: 'spring'..'winter' with the day 'MM-DD', or 'auto';
                                              -> season {from, season, date?, tile?} to every online member of their groups,
                                              seasoned {season, to} back; group season)
answer    {invite, join: true|false}
body      {tile, code, here?} | {tile: null}  (the body chosen for a tile on the home screen's rings, or worn there (here); code
                                              a species code or 'spirit'; -> body {user, tile, code, here} to the online members of
                                              the sender's groups while the sender shares their place; "Bodies")
room      {op: 'join'|'leave', tile, season?} (the client joins its tile's room when a world is entered, with the season
                                              the world is in, and again when the season changes in place; absent: the
                                              tile's by the calendar. Who sees whom)
pos       {x, y, z, yaw, form, b?, c?}        (5 Hz while in a room; relayed under the rule in "Who sees whom")
watch     {on: true|false}                    (on the earth: receive tile counts)
rtc       {to, tc?, k: 'sdp'|'ice'|'state'|'bye', sdp?: {type, sdp}, ice?: {candidate, sdpMid, sdpMLineIndex}|null,
           mic?, cam?}                        (WebRTC signalling to a group member in the same room; lane 5)
```

Hub to client:

```
welcome, found, err {why}
presence  {user, state: 'online'|'offline'|'tile', tile?}
friends   {friends[], requests[]}             (after any change)
groups    {groups[]}                          (after any change; each with its members)
chat      {scope, from, text, at}
invite    {id, from, tile, season, date?, group?, point?, follow?}
season    {from, season, date?, tile?}        (a group member changed the season; tile: theirs, when in a world)
body      {user, tile, code, here} | {user, tile: null}  (a group member's body chosen or worn there, or none any more;
                                              welcome's bodies[] holds the members' current ones; "Bodies")
pos       {user, name, x, y, z, yaw, form, b?, c?}  (name: their display name; from a group member in the same world in any form, or anyone in it while a
                                              spirit; on entering a world, the last one of each player already in it that
                                              may be seen; lane 4, Who sees whom)
gone      {user}                              (someone who was seen may no longer be: they left the world, or a stranger's
                                              spirit went into a body)
counts    {tiles: {tile_id: n}}               (every 2 s to watchers, only when changed)
rtc       {from, fc, k, ...}                  (relayed from a group member in the same world, fc their connection's id;
                                              k 'bye' also comes from the hub when they leave the room or close; lane 5)
```

The `welcome` also carries `ice`, the ICE servers for voice and video (public STUN, and TURN when the hub's
environment has it; "TURN" under lane 5).

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

   **Built (2026-11-02, branch `claude/epic-ritchie-24d56d`).** `client/src/multiplayer.js` (the invite dialog, the
   room on entry, the position relay, the arrival behind the picker), `client/src/arrival.js` (`plan(point, follow)`),
   `client/src/main.js` (the room at `enterWorld` and the leave at `switchWorld`; a switch asks the group along; a
   Join from a world is a switch carrying the picker), `client/src/hub.js` (`place(tile, group, point)`),
   `client/src/chat.js` (`currentGroup()`), `client/social.css` (`#invite`), `hub.py` (below), `tests/test_hub.py`
   (`test_travel_together`). Verified in the viewer on the home tile and Placerville against the real hub, the second
   user a script over `tests/wsclient.py` (the session is a cookie): the scripted picker's `place` with a point put
   the dialog on the earth ("trav_b wants to go to Placerville. Join · Not now", the avatar, Placerville "1 here");
   Join built Placerville, Began itself, entered, joined the room, got the picker's last position from the hub on
   entry and re-planned the arrival to end 6.00 m above and 10.00 m behind the picker along their heading, hovering
   (the offsets read back from `flight.pos` against the relayed `pos`); the same from a world (the dialog over the
   HUD, the switch, the arrival behind the picker); the browser as the picker from the earth (the row) and from a
   world (the Location box, the point from the lat/lon) with the script joining and declining, the pane reading
   "asked your group to come to Placerville" then "trav_b joined" / "trav_b declined"; Not now leaving the browser
   user in El Dorado with the script told `join: false`; the room joined at the entry (the picker's `hub.room` null
   while the card built, set as the arrival began, the script in the room getting the picker's first `pos`); the
   arrival caption over the HUD ("near Silver Lode Drive · fall · spirit"; a joiner's names the road under the
   picker); the forced dialog from the handle gone after a minute; `?skip=1` as before; the hub's 12 tests; no new
   console errors. Not verified: two real browsers (one tab is one session, so the second user never had the client:
   its dialog, its Join and its arrival were the browser's turn as the joiner), two joiners at once, a picker who
   moves far during a joiner's 12 s arrival (the path slides with them, seen only with a still picker), touch and
   narrow screens, a reconnect mid-arrival. What lane 5 needs to know:
   - **The hub changed where the protocol needed it.** `place` takes `point {x, north}` (the picker's planned
     arrival, tile-local, rounded to the centimetre as a position is) and the `invite` and the `placed` carry it; the
     hub's invite record still holds no tile and no point. A connection keeps its last relayed `pos` in memory
     (`HubConn.last_pos`; gone when it leaves the room or closes) and `room join` sends the joiner the last `pos` of
     each group member already in that room, so a joiner has the picker's place at once instead of a fifth of a
     second later; the Privacy section's rule is unchanged (relayed, never written, never logged; `test_zz` still
     searches the file and the log for the numbers). `INVITE_S` is 90 s (the client's dialog lasts 60).
   - **The flow.** `title.choose(id)` is wrapped: a choice by a player in a group sends `place` with the group (the
     chat's scope when it is a group, else the first) and the title's point for the tile (null means the centre). A
     switch from the Location box sends it from `main.js` once the tile is loaded (the point needs the manifest); a
     rebuild after a lost context is `quiet`. Join on the earth is `title.choose` under `mp.quiet` (no invite of its
     own), then `title.begin()` as soon as `setReady` names the tile (wrapped), and `title.onBegin`'s choice gets
     `point` (the invite's) and `lead` (the picker's id); Join in a world is `mp.switchTile(tile, xy, lead)`, which
     `main.js` sets to `switchWorld(id, null, params, xy, { lead })`. Not now answers and does nothing else. A newer
     invite replaces an older unanswered one without answering it.
   - **The room.** `mp.entered(tileId, { flight, arrival, form, caption, lead })` is called at the end of
     `enterWorld` and `mp.left()` at the start of `switchWorld`; `mp.chat.setRoom()` follows both. While entered, a
     200 ms timer sends `hub.pos` (x, y, z, yaw rounded to 2 decimals, `form` from `__we.playerSpecies` or `spirit`);
     `hub.js` sends nothing unless in a room and in a group. `mp.poses` holds the last `pos` per member, cleared on
     leaving.
   - **The arrival.** `Arrival.plan(point, follow)`: with `follow` `{x, y, z, yaw}` the path comes in from 1.5 km
     behind the lead along their heading (cut at the tile's edge, 150 m at least), ends 6 m up and 10 m back, slows
     to a hover (`f.hover = true, speed 0` at finish) and the clearance lift fades out over the last 15 % of the path
     so the end pose is exact; the object is read every frame, so the path slides with a lead who moves (the heading
     stays). The joiner's arrival starts on the invite's point as before; the first `pos` from the lead within 2.5 s
     of its start re-plans it (over localhost it comes with the room join, a few ms in; over the internet one round
     trip), later ones only slide it; after 2.5 s the arrival goes on to the planned point, which is what the doc
     asks when the picker has not entered. The picker's own position streams during their arrival too, so a joiner
     who enters while the picker is still flying in follows that flight's samples.
   - **Chat lines.** `placed` -> "asked your group to come to <place>" (or "no one else in the group to ask along"),
     `answer` -> "<name> joined" / "<name> declined", `err` for `place` or `answer` -> its `why`. An answer that
     comes while the chat is hidden (the picker switching or arriving) shows the pane again once they have arrived.
   - **Debugging** (`window.__weMp`): `showInvite({id, from, tile, point})`, `answer(join)`, `invite`, `chose(tile,
     point)`, `poses`, `room`. The scripted second user was a small script in the session's scratchpad over
     `tests/wsclient.py` (sign up two users over HTTP, befriend, one group; then pick, wait-and-answer, invite,
     listen); `test_travel_together` is the same flow and the place to rebuild it from.
   - **Open.** The invite's dialog has no sound and no count of who else joined; a joiner sees no marker of the
     picker once arrived (done 2026-11-02 for the spirit, the map and the screen's edge: the Built note under
     "Seeing the other players" in Open; the bodies are still open); the final yaw is
     the heading at the plan, not the picker's yaw at the end; the chat's scope picker's choice is the group asked,
     with no way to ask another group without changing the chat; two invites from two groups show one dialog.
   **The home screen redesigned (2026-11-04, branch `claude/home-map`; docs/decisions.md).** Lanes 1, 3 and 4 as they
   stand on the earth now: the places listed on the left (search, "Most Active (global)" then "(visible)"), the
   social panel and the sign-in on the right, the earth as a map (`mapGlobe.js`), a choice flying to 10,000 ft with
   the tile outlined and a card naming the players there or coming (`title.peopleAt`, filled by `multiplayer.js`), and
   the bar with Invite and Start. A choice no longer asks the group along by itself: Invite (`title.onInvite`) opens
   a picker of groups and friends and sends `place` with `group` and/or `to`. Join chooses the place and builds it; the
   joiner presses Start. Without the inviter's position the joiner ends behind and above the inviter's planned
   arrival (`Arrival.plan(point, null, true)`).

5. **Video and audio.** WebRTC between the members of a group, signalling over the hub (`rtc` messages
   added to the protocol then), the two toggles live, a small tile of each member's video by their avatar.
   Not before the four above are in.

   **Built (2026-11-04, branch `claude/voice-video-a2143c`).** Aaron: "Lets redesign the ingame menu. First, lets move
   the audio toggle up into the row with video and microphone" and "If the user is in a world with no other users,
   video and microphone should disappear."
   - **The row** (`client/index.html` `#ctlRow`, beside `#menuBtn`): the sound toggle (`#muteBtn`, sound.js els.mute,
     still N), the microphone (`#micBtn`), the camera (`#camBtn`), and the self-view (`#selfView`, 46x34, mirrored,
     160x120 on hover) while the camera is on. The friends row stands right of it (multiplayer.js layout, as the row
     grows and shrinks). The old top-middle `#media` toggles are gone. The mic and camera show while at least one
     group member is in the same world: a `pos` from them within 6 s (the hub relays positions only to group members
     in the same tile room), or their signalling; a `bye` (they left the room or closed) or a presence elsewhere
     removes them at once. Joining or leaving changes the row live. Both are off at first; the browser's prompt comes
     with the first press only. Alone again, both turn off and the devices are let go. A refusal shows on the button
     (amber, a "!", the reason in its title: blocked, none found, in use), not as an error; a press asks again. Off,
     a toggle is barred; on, it is lit green; the mic glows while the player speaks (an analyser on their own mic).
   - **Signalling** (`hub.py` `m_rtc`, `rtc_peers`, `rtc_bye`; `client/src/hub.js` `rtc`): `rtc` {to, tc?, k, ...} goes
     to the addressed user only when they share a group with the sender, neither blocks the other, and they are in
     the sender's room; to the connection `tc` names (each connection has a random 8-hex id, memory only, stamped on
     what it sends as `fc`), else to the one that entered the room last, so a member with two tabs answers once. Out
     of a room, or to anyone else, nothing goes (quietly: a peer may just have left). SDP up to 48,000 characters
     (under the socket's 64 KB), candidates up to 1,024. Its own token bucket (40/s, 120 burst) beside the general
     one, since a mesh's candidates come in bursts. Leaving a room, switching it, or closing sends `bye` to the group
     members in it. Nothing of it is kept or printed. Tests: `tests/test_hub.py` test_rtc_signalling (not across
     groups, not across tiles, not out of a room, not to oneself, one tab answers, `tc` honoured, malformed fields
     named, `bye` on leave and close) and test_ice_servers_with_turn; test_zz checks that an SDP, a candidate's address
     and the TURN secrets reached neither the database nor the log.
   - **The peers** (`client/src/voice.js` `Voice`, made by multiplayer.js on sign-in, fed by gotPos, presence and the
     room): one RTCPeerConnection per member here, made when either side first sends anything, with "perfect
     negotiation" (the lower user id is polite and yields on a collision; the other side's tracks go into the offer's
     m-lines, so mic and camera on both sides share two transceivers). Turning a device off replaces the sender's
     track with none (no renegotiation) and stops it; on again replaces it back. `state` {mic, cam} tells the others
     what is on. A failed connection restarts ICE.
   - **Voices** play through Web Audio: a muted `<audio>` holds each remote stream (Chrome feeds a remote stream to
     Web Audio only while a media element plays it), its source goes through a gain (x1.6) and an HRTF panner
     (inverse distance, 6 m reference: -16 dB at 40 m, -24 dB at 100 m) kept at the member's wisp or body
     (players.js `posOf`, 20 Hz, smoothed), into the soundscape's talk bus (`sound.js` `talkBus`: to the speakers
     under the volume and the mute, not the compressor). While anyone is heard (`setTalking`) the context keeps
     running in a hidden tab with the soundscape itself silent, so a friend is still heard after alt-tab.
   - **Speaking**: an analyser per voice, over 0.018 RMS is speaking, held 350 ms; players.js draws a pulsing dot
     before the name (the name then shown on screen out to 400 m, not only 60), a ring round the edge avatar and the
     video tile.
   - **Video**: 320x240 at 15 fps asked of the camera, the sender capped at 300 kb/s. players.js draws each member's
     camera (while their `state` says it is on) as a 176x132 rounded tile in their hue over them, scaled by 2600 / d
     px (0.36 to 1), the name under it, on screen within 400 m; off screen the video fills their edge avatar's
     circle (48 px). Two video elements on the one stream, so neither is moved between parents.
   - **Debugging**: `window.__weVoice` (peers, present, states, local, toggle('mic' | 'cam'), set(kind, on)).
   - **The menu under the X** (2026-11-04, after this lane): with the menu open, Settings (the old right-hand panel)
     and Exit to main screen, which leaves the hub's room as a switch does, tears the world down and makes the title
     screen again, signed in still (docs/decisions.md, "the menu under the X"); the data panel (`#hud`) now stands on
     the right under the mini-map, so the friends list opens right of the menu rather than right of the HUD.
   - Verified in the built-in browser with two tabs as two signed-in users (vv_a on 127.0.0.1:8793, vv_b on
     localhost:8793, so the cookies are separate; one group; the home tile), `getUserMedia` replaced in a scratch
     harness by a canvas's captureStream (a letter on a moving disc) and an oscillator bursting 1.2 s on and off:
     the alone state (sound only), the together state (mic and camera appearing in both tabs as the second
     arrived), mic and camera on with real clicks (the peer connected, both directions over two sendrecv
     transceivers; the other side's mic added later renegotiated into the existing m-line), the voice arriving at
     the other tab in the oscillator's bursts (RMS 0.28 on, 0 off) with its panner at the member's wisp, A's camera
     as a tile over A's wisp at 16 m (scale 0.68) with the name under it, the edge avatar filled by the video with the
     speaking ring when A was behind, the speaking dot on the name once A's camera was off, the self-view and the lit
     buttons, mute taking the talk bus to 0 and back, a refused mic (amber "!", "microphone blocked: allow it for this
     site in the browser, then press again") then allowed on the next press, and B leaving the room: A's peer closed
     and A's mic and camera turned off and hidden within 0.4 s (the `bye`). No console errors (the hub's 401 to `me`
     before sign-in, as before). Hub tests 14 OK; all 35 server tests OK.
   - **Not verified**: real devices and two machines across real NATs (the tabs were on one machine: host
     candidates); TURN against a real relay; the voice heard by ear; a hidden tab keeping the voice (the pane reports
     its background tab as visible); three or more members; the bodies' head height as the panner's point while in a
     body; Safari and Firefox.
   - **Next**: TURN on the public hub (below); MediaPipe selfie segmentation to draw a cut-out figure in place of the
     tile; an SFU (LiveKit) past about six; a push-to-talk key and a per-member volume; relay-only ICE as a privacy
     option.

   **TURN: what Aaron needs to set up, and why.** STUN lets two browsers find their public addresses and connect
   directly, which works across most home routers; it fails behind symmetric NATs (many mobile carriers, some
   corporate and campus networks, CGNAT), where only a relay in the middle gets the media through. Without TURN those
   players simply never connect (the peer stays "connecting", the row looks fine, no one is heard). The hub hands
   TURN out in `welcome` when its environment (Fly secrets, or the git-ignored `.env` locally) has:
   - `TURN_URL`: one or more comma-separated `turn:` / `turns:` URLs, e.g.
     `turn:relay.example.org:3478?transport=udp,turns:relay.example.org:5349`;
   - and either `TURN_USERNAME` with `TURN_CREDENTIAL` (a provider's static pair), or `TURN_SECRET` (coturn's
     `static-auth-secret`: the hub makes a credential per welcome good for 12 hours, the TURN REST API rule).
   Choices, cheapest effort first:
   - **metered.ca** (Open Relay / their TURN): sign up, create a TURN credential, put its URLs, username and
     credential in the three variables. A free tier of some gigabytes a month; static credentials (anyone who signs
     in to the hub can read them from the welcome, so rotate them if abused).
   - **Cloudflare Realtime TURN**: a TURN key in the Cloudflare dashboard; its credentials are short-lived and made by
     an API call (`/v1/turn/keys/<id>/credentials/generate-ice-servers` with the key's API token), which the hub does
     not make yet: a small addition (cached, made outside the hub's lock). Generous free allowance, global anycast.
   - **coturn on Fly**: a second small app running coturn with `use-auth-secret` and `static-auth-secret=<TURN_SECRET>`;
     it needs a dedicated IPv4 (`fly ips allocate-v4`, paid) because TURN listens on UDP 3478 and a relay port range,
     and Fly's shared IPv4 does not carry UDP; set `external-ip` to that address and open the ports in `fly.toml`.
     Most control, a fixed small monthly cost, bandwidth billed as Fly egress.
   Video at 300 kb/s per sender relayed through TURN is about 135 MB per hour per relayed pair and direction.

## Shared animals

Aaron, 2026-11-02, after two browsers on the site: "Do both users see the same animals moving the same direction? One
interesting wrinkle is that each user can see the other, but not in their animal form." Until then each browser ran
its own animals, so two players saw different herds and a kill was not shared. Built the same day
(`client/src/animalNet.js`, `animals.js` mirror mode, `server.py` `GameWorld.animals_*`, `tests/test_animals.py`).

**One authority per tile and season.** One page in a world, the animal host, runs `animals.js` as before for everyone
in the world; every other page mirrors it. The host is the page the server names: the acorn game's AI host when that
page is on the animals channel, else the first to join the channel; the AI collectors, the AI's digging and the animals
are one page's (each page sends a random page id `pg`, memory only, on its acorn, dig and animals channels, so the
server can match the three sockets of one page). When the host leaves, the server names the next page, which starts
simulating from where its mirror last had each animal: the live set is rebuilt round the remaining players and every
animal found in the mirror is released into the AI where it stood (as a body the player leaves is), carcasses stay
where they lie. Alone in a world, or with no game endpoint (a static host, `?net=0`, the dev paths), the page is its
own host and nothing changes.

**What the host simulates.** Every page sends the host where it is, rounded to 10 m, and what it perceives as (its
species, or spirit), once a second (`apos`, to the host alone, never kept); the host's live set covers a 400 m circle
round each player and the species any player perceives, and its far-animal rule (ground animals past 250 m think on
alternate frames; rabbits, voles and jackrabbits past their cull distance do not think) is judged from the nearest
player, not only its own eye.

**The protocol** (the game socket, `/api/game/ws`; JSON):

```
animals   {tile, season, pg}         -> awelcome {host, n, you, m: [members], aseq}   (join the channel)
                                        ahost {host, n, you, m, aseq, full?}           (membership changed; full: send everything)
ast       {s, u, d, g, at}           host -> server -> every other member, as it comes, kept nowhere
aev       {c, e}                     host -> server -> everyone, numbered by aseq (memory only); the host's copy echoes c
areq      {e}                        a mirror -> server -> the host, with from (the mirror's number)
apos      {x, z, sp}                 a mirror -> server -> the host, with from; x, z rounded to 10 m
```

`ast` holds `s` spawns (per animal the host has not yet told: its number n, id, species, size, the sex or antler
constants, its herd's number and rank, then its first full sample, so it is never drawn before it is placed), `u`
updates (`[n, mask, ...the fields whose bit is set]`: a field unchanged since the last row sent is left out), `d` drops
(numbers gone from the live set), `g` groups (number, leader, state, centre: the herd marks, the herd pilot and the
sounds read them) and `at` the host's clock. The fields (`animalNet.js` FIELDS): x, y, z, yaw, pitch, roll, the gait's
speed and turn rate, pose, the wings' or gait's amplitude, flick, visibility, lift, the four model channels e0 to e3,
the state, the phase and its rate, flags (in the air, the raven's ground model, buried, hidden, dead) and the speed,
each quantized (centimetres, milliradians, hundredths). `aev` carries the events that change the world: a kill (the
prey's number, who killed it, where and how it fell), a carcass gone, a flush of a covey or a flock, a ground squirrel
colony's alarm, an alarm call, a stoop, a hunt starting, a rally of a woodpecker family, and a catch refused (`miss`).
`areq` asks the host for a catch (the prey's number, the point struck, the striker's species), a body taken (the
player goes into an animal: the host takes it out of everyone's world) or given back (where and how it was left).

**The rates and the cap.** The host's stream is 4 Hz. An animal within 80 m of any player gets a row every tick,
within 250 m every other tick, beyond that every fourth; the rows go out most-overdue first until the tick's share of
the cap is spent and the rest wait. **The cap is 24,000 bytes per second of JSON from the host** (6,000 a tick); the
server relays the same bytes to each mirror, so a mirror receives at most the cap. Measured on the home tile (two
pages, `?skip=1`): 20.8 KB/s out of the host and 19.8 KB/s into the mirror with the two players together and 232
animals live; 23.9 KB/s, at the cap, with the players 600 m apart and about 330 animals, of which some rows waited a
tick (about one in ten). A page alone on the channel sends nothing; a page joining makes the host send every animal's
spawn and full sample once, at most 30 KB of them a message (the server refuses a message over 64 KB: the first
build sent 67 KB for 499 animals in one and lost the host's socket), so a join costs a second or so over the cap:
measured, 30.5 KB (222 animals) and 16.2 KB (121) in the first two ticks, then about 6 KB a tick. Dead animals are not streamed after their spawn: the kill
event carries the last pose and the mirror lets the body fall and lie as the host does; the host's `gone` ends it.

**The mirror** (`animals.js` `becomeMirror`, `mirrorSpawn`, `mirrorSample`, `mirrorStep`): each mirrored record holds
two samples (two Float32Arrays on the record, no allocation per frame or per sample): where it was drawn when the
newer came, and the newer. It eases from one to the other over their measured spacing (0.1 to 1.2 s), carries on at
that velocity for 0.4 s past the end, then holds; a jump over 20 m or a silence over 3 s snaps. Angles go the shorter
way round, the state and flags step at once, the phase advances by its rate and is pulled to each sample. The rest of
the update is the host's: the same instanced draw, the leg engine for the quadrupeds, the deer's clips, the far tier,
the ravens' two models, the carried acorns. A mirror runs no AI (no hunts, alarms, coveys, flocks, colonies, defence
of granaries, burials of carcasses); its perception, senses, the hunt panel, the needs, the catch and feeding read the
mirrored animals. A mirror's catch (`catchNear`) asks the host instead of killing: the host checks the prey is the
striker's and within its reach of the point struck (a metre's slack and 0.3 s of the prey's speed for the stream's
lag) and orders the kill, which everyone sees, the striker as its own catch (fed, "caught a brush rabbit", the hunt
panel's count); a refused one comes back as "the catch misses". The controls hold their own "misses" while the host's
answer is on its way. Since 2026-11-06 a kill for this page on a body already dead still counts as its catch: the
carcass's own message on the dig channel (carrion.js `adopt`) often came first and killed the mirror's copy as
'shared', and the animal channel's kill was then dropped, so the striker was never fed (the hunt panel's kill count still
misses those). A hawk's dive from a mirror (dive.js) strikes through the same `catch` request; the prey's seeing it
coming is a `startle` request (`areq {k: 'startle', n, x, y, z, sp}`): the host alarms the prey, with the remote diver as a
stand-in hunter at the point it gave, within 600 m of the prey. Seen 2026-11-06 with two headless Chromes on the home
tile: the mirror's red-tail stooped at a brush rabbit, the host killed it, the mirror was fed and mantled; a vole the
mirror's dive startled was alarmed on the host with the diver as its threat; a gray squirrel startled from the mirror ran
up its oak on the host. The strikes (2026-11-06, decisions "the hunt's strikes") follow the same road: a mirror's strike is a
`hit` request the host checks (the family's move, its prey, the move's reach with the stream's slack, its cooldown) and
deals; everyone's bar comes from the host's `hp` event (the regeneration is worked out when read, so it needs no
stream); a big prey's fight-back is a `kick` event to the striker; the kill is the kill event. Two players striking one
deer saw the same numbers on both pages.

**Seen** (2026-11-02, two pages on the home tile against the worktree's server, the pane hidden so the frames came
from a timer at 13 to 16 a second): both pages listed the same 327 animals with the same ids, and the deer herds at
the same positions; six squirrels sampled on both pages on one wall-clock schedule followed the same paths and
headings, the mirror 0.3 to 1 s behind (the far ones get a row once a second under the cap); a lion's kill of a deer
on the host lay on the mirror at the same point, on its side; the mirror's player went into a coyote (the host took
it out of its world), set down at a brush rabbit and struck: the host killed that rabbit at the same point and the
mirror said "caught a brush rabbit" and counted the kill; a strike claimed 50 m from a quail came back "the catch
misses" with the quail alive; leaving the coyote gave it back to the host's AI where it stood; the host's page
closed and the mirror became the host within a second, ran its own AI, and kept all 82 animals within 350 m of its
player where they were (the largest move in the 5 s after, 10 m, an animal walking), dropping only those that lived
round the player who had left. The acorn game on both pages: one page the host of the acorn, dig and animal channels,
its gathering animals' 36 events accepted, 28 applied on the other page, and both drawing the same 16 acorns in the
same animals' bills. The frame on the home tile with 232 animals: the mirror's animal update 0.40 ms median (0.50
p90) plus 0.11 ms to decode each of the four messages a second; the host's 0.50 ms (0.70 p90) plus 0.44 ms per
stream tick (`performance.now` in the pane resolves 0.1 ms; the GPU's work is the same instanced draw on both and was
not measured). The server's tests: `tests.test_animals` (the relay to the others and not the host, state and events
only from the host, the events' order, a request and a position to the host alone, the hand-over, the acorn host
leading the animal host, nothing in the world's files or the log).

**Players as their animals** (2026-11-02, the second half of Aaron's observation: "each user can see the other, but
not in their animal form"). The hub's `pos` (5 Hz, to the group members in the same tile room, as before) carries, for
a player in a body, `b` (the body's pose as the animal stream's fields above: `client/src/bodySample.js`, read off the
body's own drawn mesh where it shares the AI's conventions, the control's yaw and the gait's speed and turn rate where
the AI's draw recomputes the rest, the raven put together from the flight) and `c` (its constants: size, sex,
antlers, and the species slot, so a buck or a female woodpecker is drawn as one). The hub checks they are short lists
of finite numbers and relays them; nothing is kept past the connection. `players.js` gives each member in a body a
record in the species' pool of `animals.js` (`remoteSample`: the remote bodies are laid out first, so a slot is kept
for them), mirrored from the 5 Hz samples exactly as the host's animals are, drawn by the same instanced draw, leg
engine, clips and far tier; no wisp over it, the member's name over the body within 60 m while it is on screen, the
avatar at the screen's edge and the dot on the mini-map as before. Back in spirit form, out of the room or silent, the
body goes. A remote body is no one's prey and no one's body to take: the AI does not hunt it, the catch does not
strike it, the spirit cannot enter it, the counts and the species tags leave it out. The privacy rule is unchanged:
other players in the tile who are not in the player's group send nothing here and stay unseen, as animals or as
spirits (Aaron may widen it later; the relay to the whole room is the same rule). Seen on the home tile against the
worktree's server: a scripted group member (over `tests/wsclient.py`) walking a 12 m circle at 1.3 m/s as a deer was
drawn as a black-tailed deer in slot 0 of the deer pool, on the slope, its legs in four phases of the walk over 0.75 s,
"body_b" over it while in view and its avatar at the edge while not; flying a 40 m circle 30 m up as a raven, it was
the ravens' flying model, banked, its wings beating and then set in the glide; the browser's own player in a deer
body sent 225 positions in 45 s, each with the 22-field sample and its constants (slot 3, size 0.92); `tests.test_hub`
covers the relay of `b` and `c`, their absence in spirit form and the malformed ones dropped.

**Open.** The fliers' detail: a soaring bird far off gets a row once a second and its wing beat is the phase rate
between rows (fine for a soar, coarse for a hawk's stoop seen from far); the AI's internal targets (a hunter's prey,
a raven's cache, a squirrel's path) are not streamed, so a mirror's sound cues and the field guide's witness cards that
read them see less; the Dig game's AI voles' tunnel state is not mirrored (the position is). The far animals: beyond
250 m a row comes every second or less, so a running deer far off moves in visible steps of its interpolation, and a
host far from the others streams animals nobody near it sees. The rate under many players: the cap is per host, so
ten players together share 24 KB/s of rows (more animals, the same bytes: the far ones wait); the server's relay
copies each message to every mirror (no fan-out cost measured past two pages). A host on a slow machine is everyone's
animals; there is no choice of host by capability. The host's own frame does the work for every player's
surroundings (two players 600 m apart: about 330 animals instead of 230).

**Herds (2026-11-07).** A planned herd's members (pipeline/herds.py; a few hundred bison on Lamar) are never streamed
one by one: at the stream's 24 KB/s cap they would crowd out everything else. The host sends each herd as one row in the
`ast` message's `h` list (animals.js `herdRows`):

    [key, slot, plan index, live, x, z, wx, wz, fcx, fcz, hdx, hdz, fleeT, ax, az, dead ranks]

- **When a row goes.** When the herd's centre moved 0.5 m, its flight began or ended, a member died or its live state
  changed, and at least every 8 ticks. A full snapshot sends them all.
- **What it carries.** The centre, the grazing front's waypoint or flight point, the frame's centre and heading, the
  flight's time left and origin, and the ranks that died. About 120 bytes a herd.
- **The relay.** server.py relays `h` as it is (tests/test_animals.py).
- **On a mirror (`mirrorHerds`).** The rows fill the page's own aggregates, and the far tier draws far herds from them.
  As the mirror's player comes within LIVE_R plus a herd's radius, the mirror spawns the members itself
  (`mirrorHerdLive`) from the same seeded ids and places (`herdLayout`) and steers them under the host's frame:
  waypoint, heading, and a flight started from the member nearest its origin, with the wave as anywhere.
- **Naming a member.** An event about a herd member (kill, gone, hp, kick, miss) names it by its id, which is the same
  on every page. A mirror's startle, strike, catch or take of one asks the host by id. A mirror's own herd taking
  fright asks the host to start the flight (`areq` `herdAlarm`), and the host's next row carries it to everyone.
- **What was seen.** Two headless Chrome pages on Lamar, the mirror's player beside the 400-herd.
  - Both pages ran 400 members with centres within 6 m.
  - A flight started on the host reached the mirror's herd on the next tick; the two waves spread at the same pace and
    the centres stayed within 3 m through the run.
  - A flight started on the mirror reached the host the same way.
  - A bison killed on the host fell at the same spot on the mirror, by its id, and neither page spawned it again.
  - Over 51 s the herd rows were 26 KB of the host's 966 KB (about 0.5 KB/s); the largest message was the 32.8 KB join
    snapshot.
- **Fields (2026-11-08).** The herds' stigmergy fields (herdField.js: forage, trail, fear on 10 m cells) belong to the
  host. It sends the cells written since the last as `ast.f`: base64 of two 32-bit words a cell, up to 4,000 cells a
  message (43 KB), every 8 ticks, and after a join the whole changed set over several ticks. server.py relays `f` up to
  60,000 characters. A mirror applies them (queued until its fields are made). No positions are kept.
- **No message over the server's limit (2026-11-08).** Aaron: one computer flying as a hawk, the second pressed Join,
  "i show up as a spirit but see no animals". The join's full resend put the spawns (up to 30 KB), every herd row and a
  4,000-cell field delta (43 KB) in one message: 70-77 KB once the fields held over about 3,000 changed cells (a few
  hours of herds on the home tile). ws.py closes a socket that sends over 64 KB (`WS_MAX_IN`), so the host lost its
  socket, the server moved the host, the joiner was torn down as a fresh mirror and a host again, and the host's
  reconnect began another full resend. Now (animalNet.js): every message is held to `MSG_MAX` 56,000 characters. The
  field delta takes only the room the message has left after its spawns, groups and herd rows (the rest of the backlog
  goes on later ticks), `sendAst` splits any message still over (the field delta alone, each array spread over parts,
  which a mirror applies row by row as they come), and `raw` never sends anything over the limit (it counts
  `stats.oversize` and warns once). `stats.maxOut` is the largest message sent and `stats.split` the splits.
  tests/test_animal_net.py drives `tick()` against a fake socket (1,500 animals, 60 herd rows, 20,000 changed cells; and
  3,000 herd rows) and fails over 64 KB; the old code sent 85,842 characters there.
  - **Seen** (local server, two headless Chromes, A on the channel first as a red-tailed hawk (`?as=hawk`), the fields
    filled by `herdFastForward`, then B opened the same tile): home in fall with 3,649 and 4,381 changed cells (the old
    code lost the host's socket at 3,366), and Lamar in summer with 57,951. Each time A stayed host with no reconnect,
    its largest message was 53,996-54,044 characters, the whole backlog drained, the server logged no host move, and B
    was a mirror of all of A's animals: 967 and 971 on home (61 herds), 656 on Lamar (93 herds).
  - **Nothing keys on the address.** Two computers on one network or mesh are two pages to the game: the animals
    channel is a world per tile and season, the host chosen by page (`pg`, server.py `host_of`). hub.py reads the client
    address only for sign-up, sign-in and recovery limits. The invitation carries the inviter's tile and season, so a
    joiner opens the same animals channel (read in code; this round's check opened the second page directly rather than
    through the hub's Join).
- **Open.**
  - The members on two pages are each page's own steering under one frame, so single animals do not stand in the same
    spots, though the herd does.
  - An AI hunter streamed from the host chases the host's copy of a bison while the mirror draws its own.
  - A herd's layout recorded when it went far (`herdKeep`) is each page's own.

## Group follow

Aaron, 2026-11-06: "When a player in a group is in a tile with another player, and one of them leaves to go to the main
screen - when that person presses "START" the other people in the group receive an invitation to join them which they
can decline. Their screen fades to black and a loading bar begins and then they should enter the tile where the person
who originated the invitation is, above and behind them."

**Built (2026-11-06, branch `claude/group-follow`).** `client/src/follow.js` and `client/follow.css` (the invitation and
the veil, linked from the module so `index.html` and the title screen's files are untouched), `client/src/multiplayer.js`
(askFollow, showFollow, follow, awaitLead, placeBehind), `client/src/main.js` (followTile, the build's steps to the veil,
enterWorld's follow entry, the page-node opt-out in the world's recorder), `client/src/arrival.js` (plan's
`follow.ground`), `client/src/hub.js` (`place(..., follow)`), `hub.py` (`m_place` follow), `tests/test_hub.py`
(`test_follow_invite`).

- **Start asks the group.** The title's `onBegin` (wrapped in `multiplayer.js attach`) sends `place` with `follow: true`
  for the group: the chat's group when it has anyone else in it, else the first such group; a joiner's own Start (the old
  Invite flow's) sends none. Every Start on the main screen does this, the first of a session too, since it is the same
  moment ("I am going in here"); Exit to main screen then Start is the case Aaron named. The hub sends the invite only to
  members with a connection (a follow means "now"), marks it `follow`, and answers `placed {to, follow}` with that count.
  The inviter's chat says "asked N people in your group to join you at <place>", then who joined or declined.
- **The invitation** (FollowToast, top middle on the main screen and over the HUD): the inviter's avatar, "<name> started
  at <place>", "Join them there?", Join and Decline, and a thin line along the bottom that runs down to its expiry
  (`followMs`, 60 s; the hub keeps the invite 90 s). Decline (or Escape) answers `join: false`; the expiry answers
  nothing. A newer invite replaces an unanswered one; none shows while a Join is loading.
- **Join** answers `join: true`, then the veil (FollowVeil, z 200 over everything) fades to black in 0.6 s: "joining
  <name>", the place, a bar and the build's words under it. Then `main.js followTile` builds the tile in place: from the
  main screen the screen closes first (its own world, building or ready, is abandoned as a second choice abandons it);
  from a world it is a tile switch (the world torn down, the hub's room left). The bar follows `buildSteps`' `w.next`
  steps with the home screen's weights (a copy of title.js STEPS, so that file is untouched) up to 94 %; the rest is the
  inviter's position and the first frames. The veil is marked `data-we-page` so the world being torn down does not take
  it (main.js `w.record` records every node added while a world is played; the first world-to-world test lost the veil
  that way).
- **The entry** (enterWorld with `c.follow`): no arrival flight. The spirit is put at once behind the inviter's planned
  arrival (the invite's point, `Arrival.plan(point, null, true)` finished at its end), and `mp.entered` waits for the
  inviter's position: the hub's room join sends the last `pos` of each group member in the room, so over localhost it
  comes a few ms later. `placeBehind` puts the joiner at Arrival's follow end pose (`plan(null, follow)`, `start`,
  `finish(true)`): **in the air 6 m above and 10 m behind** along the inviter's yaw, facing the same way and hovering,
  when the inviter is the spirit or a flier; **on the ground 6 m behind, 2 m up** (the spirit's climb-out height) when the
  inviter's form is a ground animal (`bodyKind(form) === 'ground'`, playable.js). With no position within 6 s
  (LEAD_WAIT_MS) the planned-point pose stands. A few frames later (at least 0.7 s) the bar fills and the veil fades out.
  A joiner already in the inviter's tile is only moved: veil, the inviter's last relayed pose, veil out.
- **Privacy** as before: the position is the room's relay, used once and kept nowhere; the invite record holds no tile
  or point; nothing is logged.
- **Debugging** (`window.__weMp`): `placed` (the inviter's pose used, ground or air, and where the joiner was put),
  `toast`, `veil`, `followMs` (shorten it to see the expiry), `askFollow(tile, point)`.
- **Verified** against the real hub on a worktree server (127.0.0.1:8812, its own `data/hub.sqlite`), two local test
  accounts (follow_a, follow_b: friends, one group), each in its own headless Chrome (own profile, so own cookie) over
  CDP, because the browser pane had no window and drew no frames: Start from the main screen sent `placed {to: 1,
  follow}`; the toast on follow_b's main screen; Decline (follow_a told `join: false`, the chat "follow_b declined",
  follow_b left on the earth); the expiry (`followMs` 8 s: gone, nothing answered); Join from the main screen (veil, bar
  0 -> 20 -> 84 -> 96, entry, veil out; placed at x 5000, y 763.83, z -4992.79 behind follow_a at 5000, 757.83,
  -5002.79, yaw 0: 6.00 up, 10.00 back); Join while already in the tile with follow_a a mule deer at yaw -2.48 (6.00 m
  behind along the heading, 2.00 m over the ground, same yaw); Join from a world on another tile (Placerville to El
  Dorado: the switch, the veil kept across it, 6 up and 10 back); the reverse direction (follow_b's Start invited
  follow_a). The first run showed follow_b 525 m behind: follow_a's own arrival ends at cruise speed and it had flown
  on after the joiner was placed behind it, which is right (the joiner stands where the inviter was); later runs held
  the inviter still. Frames: the side-session notes folder, group-follow-captures/. Not verified: touch and narrow
  screens, two joiners at once, a slow network (the room join's position one round trip later; the 6 s fallback was
  read in code, not forced), sound on entry from the main screen (headless Chrome has no audio output to check).
- **Open.** The joiner's chase camera, behind and above its own wisp, puts the inviter low in the frame (6 m below, 10 m
  ahead); a wider first view or a short camera ease toward them may read better. An invite that times out tells the
  inviter nothing. A joiner's Join lands behind the inviter even if the inviter has gone back to the main screen since
  (the planned-point fallback); cancelling the invite when the inviter leaves the tile is not done.

## Group season

Aaron, 2026-11-06: "If one player changes the season, it changes for everyone in the group."

**How a season change worked before (checked first).** The Settings card's season select (`main.js`, `#season`) picks a
random day in the season and calls `setDate('MM-DD')` (the select then shows the season; "tracks today's date" is
`setDate('')`): `applySeason` re-colours the ground for the date, swaps the leaf look and the far impostors, and picks
that day's weather (last year's at the tile, `weather.js`). Nothing is rebuilt: the world, the position and the hub's
room (per tile, not per season) stay. The frame loop then moves the shared animals to the new season's channel
(`anet.join(tile, season)`: the server keeps one animal world, one acorn-game world and one dig world per tile and season;
the first page in a (tile, season) channel hosts its animals). The acorn game and the dig keep the season they were built
with until the next build. Nothing synced the season between players: a group could fly together in two seasons, each
drawing the other's wisp over a different forest with different animals.

**Built (2026-11-06, branch `claude/group-follow`).** `hub.py` (`m_season`, `_season_date`, `place` season and date),
`client/src/hub.js` (`season()`, `place(..., world)`), `client/src/multiplayer.js` (seasonChanged, gotSeason, toSeason,
groupSeason, Start into it), `client/src/main.js` (the select's relay, `seasonCtl` for the room, `pick`),
`client/src/follow.js` (the veil's heading and the toast's season), `tests/test_hub.py` (`test_group_season`).
- **The change goes out** only from the player's own use of the select (`mp.seasonChanged(season, day)`), so a change
  applied from the group never echoes. The hub checks it (`season` one of the four or `auto`, `date` MM-DD and only with
  a season) and relays `season {from, season, date, tile}` to every online member of the sender's groups, as `pos` goes
  to comembers, but wherever they are; nothing is kept or logged.
- **A member in the same tile follows at once**, with no question: the veil ("FOLLOW_A changed the season", the season)
  fades to black, the season is set in place as the select would set it, on the same day (so the same weather; `seasonCtl.set`
  calls `setDate(day)` without relaying), the bar runs to the end and the veil fades out after a few frames. The member
  stays where they are. A member already in that season and day sees only the notice.
- **The notice** is a line in the chat for every member: "<name> changed the season to winter", or "<name> set the season
  back to today's".
- **A member elsewhere** (another tile, the main screen, a world building) keeps it (`groupSeason`, memory only). Their
  next Start goes into that season and day (`c.season`, `c.date`) and the follow invitation carries them (`place` season
  and date); a joiner's world is entered with the invitation's season and day (`followTile` world), and one already in
  the tile is set to it. The toast shows the season ("Join them there? · spring").
- **No confirmation step**, as asked, and on purpose: the hub's room, the position relay, the wisps and voice are per
  tile, not per season, so a member who stayed behind would still see the group's wisps and hear them while standing in
  another season's forest with another season's animals (their own animal host and channel). Following keeps the
  group in one world; anyone can change it back, and everyone is told who did. (Since 2026-11-06 seeing and voice are
  per world, the tile and the season, so a member left in another season is no longer seen at all: "Who sees whom".)
- **Verified** with the two headless Chromes against the real hub: both in Placerville in fall (follow_a hosting the
  animals, follow_b mirroring); follow_a picks winter in the select: follow_b's veil, then winter on the same day (02-16),
  the select on winter, the animal channel winter with follow_a still the host, follow_b at the same spot (5000, 764,
  -4992 before and after), the notice in its chat; follow_b on the main screen when follow_a picks spring: the notice and
  `groupSeason {spring, 04-03}`, follow_b's Start goes into spring on 04-03 and follow_a's invitation says `season:
  spring, date: 04-03` ("· spring" on the toast); follow_a's Start into its own spring, follow_b joining from the main
  screen entered spring on 04-03 (select on spring) behind follow_a; follow_a back to today's: follow_b back to fall
  (auto), the notice "follow_a set the season back to today's". Frames: group-follow-captures/group_season_winter.gif in
  the side-session notes. Not verified: two changes in quick succession (the second applies under the first's veil),
  a change while a member's follow Join is loading (it enters the invitation's season, which may be the older one).
- **Open.** The acorn game and the dig keep the season they were built with after any season change, the player's own
  included (as before); a change made while signed out of the hub or with no group stays the player's own.

## Bodies

Aaron, 2026-11-07: "Right now when the tile is selected there is a label in the middle and a tooltip above. Instead,
center the tile on the screen in its final position so that there is space on the bottom for a proper Title above the
Invite/start buttons. Remove the label and tooltip. put the information above the buttons. Then the animals pop in just
like the did before, but this time instead of at the bottom they are in a ring above the tiles. There is a ring of
terrestrial animals on one plane, and a ring of flight animals in another plane. As they teleport in the rings begin to
gentle rotate. In the center of the ring is the spirit avatar, bigger. It is selected. If an animal is selected it thje
ring rotates so that the selected animal is to the "front" /bottom/center/forward towards the camera If any animal is
selected, any other players in the group will see which animal they selected or are currently inhabiting. Any other
group member can click on that same animal and join the tile in that body, right next to their friend."

**Built (2026-11-07, branch `claude/animal-rings`).** `client/src/bodyRing.js` (the rings), `client/src/bodyModels.js`
(each species' drawn model and still pose, shared with `client/tools/opening_sprites.js`), `client/src/title.js` (the
stage, the place's title, picking, `startWith`), `client/title.css`, `hub.py` (`m_body`, the bodies in memory, welcome's
`bodies`), `client/src/hub.js` (`body()`, `bodies`), `client/src/multiplayer.js` (`bodiesAt`, the body worn, the follow
that needs no question, Start beside a member), `client/src/main.js` (`takeBody`), `client/src/spirit.js` (`enter(id,
at)`), `client/src/animals.js` (`summon(..., at)`), `tests/test_hub.py` (`test_bodies`).

- **The layout.** The chosen place's card over its north edge and its label on the map are gone. The stage is the free
  centre between the panels, under the risen title and above the bar; the tile is framed in it, a little kept clear
  above for the back animals (`focusArea`), and the rings stand inside the tile (below; "pinned to the tile" since
  2026-11-07, Aaron: "lets have the avatar selector pinned to the tile").
  The bar now opens with the place's title: the name (30 px) and its players' pill, the Indigenous territories, "As the
  spirit" / "As a black-tailed deer · beside Juno", and the players there and coming (their list opens upward). Map
  labels are kept out of the rings' space and out from under the stage. At a phone's width a chosen place takes the
  whole width: the places fold behind an All places button under the search, which opens them over the stage.
- **The rings.** The tile's bodies are its species present (`species.json`) that the client draws and the spirit can
  take (`GROUND`, `FLIERS` and the three with their own controls), and its own fauna's stand-ins (`client/fauna.json`
  slots on a kin with a body, their own model when they have one): the walkers on one ring, the fliers on a wider one
  above it, the spirit (the live wisp, chasing its tail) in the middle, bigger, chosen at first. Each animal is the
  client's own model drawn live with the opening stills' pose and light (walkers standing, fliers on the wing, beating),
  on a compressed scale (the largest side `0.44 * max(0.56, min(1, m / 2.2)^0.3)` ring radii, and a walker's height or
  plan at least 0.16, about 40% of the deer's, as far as the ring's spacing lets it grow: a squirrel or a jay about half
  a deer). **Pinned to the tile**: the rings live in the tile's own frame (its centre on the earth, east, up, south) and
  are drawn through the earth camera expressed in that frame, so they stay registered to the tile through the zoom, a
  drag and a resize, and vanish with it over the horizon. The walkers' ring is 0.64 of the tile's half-width; the
  fliers' is a smaller tier well above it (0.74 of that, raised 1.05: "more elevation between them", 2026-11-07), the
  spirit between the two, and every animal casts a soft shadow on the ground away from the light (the fliers' fainter);
  the walkers stand inside the tile's square as the camera sees it (a ring of more
  than 14 stands in two staggered rows, so the busy tiles' animals keep their size); the spirit is
  about a fifth of the tile across (half its share before). The
  models load during the flight to the place, behind the world's heavy steps (four at once; each compiled with `compileAsync` before it is drawn) and pop
  in when it lands, in a random order a short gap apart, with the old lineup's arrival in 3D: a beam of the species' soul
  colour, a white flash and a spring to full size; a new place beams the old ones out. The rings then turn slowly, the
  walkers one way and the fliers the other.
- **Zooming away deselects** (2026-11-07): the chosen tile drawn under 14% of the free centre's width (once framed, held
  350 ms) unchooses the place: the rings, the spirit, the title, Invite and Start fade together, the tile is an ordinary
  place again, its world is let go and the group hears `body {tile: null}`. Zooming back in chooses nothing.
- **Choosing.** A click on an animal (or the spirit) chooses it: its ring swings it to the front on a critically damped
  spring and holds it there, turned partly toward the camera, a halo under it; the other ring keeps turning. Hovering
  names the animal. Signed out the rings show but nothing is chosen: hovering or tapping an animal shows "Log in or sign
  up to start", as Start does. Reduced motion: no turning, no beams or springs (fades), a choice jumps to the front.
- **The group sees it.** `body {tile, code}` goes to the hub on each choice ('spirit' included), and `body {tile, form,
  here: true}` from a world whenever the body worn changes; leaving a world takes it back. The hub relays it to the online
  members of the sender's groups (not to friends outside them, not across a block), only while the sender shares their
  place (presence 'tile'), and holds the last one per user in memory for a member who connects later (welcome's
  `bodies`) until the connection that told it closes. A tile id and a species code: no position, nothing written down,
  nothing logged. Each member's pick shows over that animal in the rings as their face and name, a gold ring when they
  are wearing it there.
- **Going with a friend.** Choosing the animal a member chose or wears at that place means going with them (`joinWith`;
  the one wearing it first). If they are in the world, Start goes in with no flight, as a follow Join is put: the room's
  join brings their pose, and the body is taken beside them (`takeBody`: 2.5 m to their right, else left, behind or a
  little further out, up to 6 m, wherever the near plants' crowns (`veg.nearPlants`) leave 1.2 m clear; facing their way;
  in the air beside them when both fly). If both are still on the main screen, whichever presses Start first goes in
  and asks the group to follow as every Start does; the other, having chosen the same animal there, is not asked: their
  Start is pressed for them (`startWith`, once their world is built), their arrival flies in behind the first, and their
  body is taken beside the first's. Alone, a walker is taken on the ground 25 m ahead of the arrival's end and a flier
  where the spirit is, on the wing. The body is a fresh animal of that species summoned there and entered as the spirit
  enters any body (the camera's blend, the wisp diving in).
- **Cost.** The rings draw with the page's renderer (no second WebGL context) in their own scene after the earth, the
  depth cleared: on El Dorado's 20 bodies, 24 draw calls and 14,000 to 34,000 triangles a frame, 0.45 ms of CPU for the
  rings' frame (headless Chrome on Metal, on this Mac). A new place, or the screen closing, frees every model's
  geometry, material and clip texture (checked by the renderer's counts: -20 geometries, -7 textures on El Dorado).
- **The zoom is not slowed.** The models first loaded from the moment of the choice and slowed the paced flight (click to
  Start, 20 Mbit/s and a cold cache: 50.0 s against main's 47.8 and 48.3); they now wait until the world's build is past
  its animals step (at once for a visitor, who builds nothing): 46.3 s. The pops then run over the first few seconds after
  landing instead of at once.
- **Verified** with two headless Chromes and two local test accounts in one group on the real local hub (El Dorado):
  aaron_t chose the deer; juno_t's rings showed his face and name on it; juno_t chose it ("As a black-tailed deer ·
  beside aaron", and aaron_t's rings showed her on it); aaron_t pressed Start and juno_t's Start went with him at once;
  both arrived as deer, 2.7 m apart. Then with aaron_t still in the world as the deer, juno_t back on the main screen saw
  him on it with the gold ring ("1 here"), chose it and pressed Start: no flight, a deer 2.7 m beside him, the hub's
  last pose used (`__weMp.placed`). No errors on either page. The first try put her deer, and its camera, inside a shrub;
  the spot is now kept clear of the near plants' crowns (`veg.nearPlants`). Also checked: signed out (the rings show, a
  click keeps the spirit and shows the tip, the cursor not-allowed, Start greyed), reduced motion (the rings still, a
  choice at the front at once), a phone (390 x 844: the list folded, the rings and the title across the width),
  `?skip=1&as=deer` (straight into a deer), and `test_bodies` with the hub's tests. Frames: animal-rings-captures/ in
  the side-session notes. Lamar Valley's rings (its fauna's stand-ins, the moose and bison on their own models) drew
  with no errors. Not verified: two fliers joining in the air, a member's body changing while the other looks at the rings (the relay is the same message).

## Who sees whom

Aaron, 2026-11-06: "Players should be able to see other players in spirit mode. When in a group, users can see eachother
regardless of form. Each user sees the other in the form that they are currently inhabiting."

**The rule.** A player's world is a tile and a season (the game server already keeps one animal, acorn and dig world per
tile and season). Within a world:

1. **Spirits are public.** A player in spirit form is seen by everyone in the same world, group or not, whatever form the
   viewer is in.
2. **The group sees each other in any form**: spirit, any ground animal, any flier, the raven, the squirrel, the
   woodpecker, and the change from one to the other.
3. **Each is drawn in their current form**: a spirit as the wisp in their avatar's colours, a body as that species' own
   model at its size in the species' pool, its gait or wings driven by the relayed motion (players.js, "Players as their
   animals" above).
4. **Strangers in a body are not shown as players.** Their position does not leave the hub while they are in a body.

Nothing crosses worlds: two players in one tile in different seasons stand in different forests with different animals,
and do not see each other (nor hear each other: the voice signalling keeps to the same world too). The tile chat stays the
tile's, and counts and presence stay per tile.

**The hub** (`hub.py` `HubConn.viewers`, `m_pos`, `m_room`, `leave_world`, `tell_gone`). The room join carries the season
(`room {op: 'join', tile, season}`; an older client without it is put in the tile's calendar season). A position goes to
every other user's connection in the same world where neither blocks the other and either they share a group or the
sender is a spirit; a body's pose (`b`, `c`) therefore only ever goes to the group. It carries the sender's display name
(`name`), which a stranger's page has no other way to know and the tile chat already shows. `gone {user}` goes to those who could
see the sender and no longer may: when the sender leaves the room, closes, switches tile, or changes season (a join in the
same tile with another season moves the connection between the two worlds), and, to the strangers alone, when the
sender's form goes from spirit to a body. A joiner is sent the last position of each player already in the world that it
may see (a group member's in any form, anyone's while a spirit). WebRTC signalling and its `bye` keep to group members in
the same world. Positions stay in memory only (the connection's last one, gone with the room), are never logged, and only
tile ids go anywhere else, as before.

**The client.** `hub.js` `enter(tile, season)` (and the reconnect's re-join) sends the season; `pos()` now goes whenever
the player is in a room (the hub decides who gets it, so a body with no group goes nowhere). `multiplayer.js` joins the
room with the world's season (`seasonCtl.now()`), re-joins when the season changes in place (checked on each 5 Hz send:
the select, or the group's season), clearing the old world's players; `gone` takes a player off; voice counts only group
members as present (`isMate`). `players.js` draws what comes:
- a group member as before (the wisp or their animal, the name within 60 m, the avatar at the screen's edge with the
  distance, the dot on the mini-map);
- anyone else, only ever as a spirit: the wisp in their avatar's colours and **their name within 30 m**, smaller and paler
  than a group member's. Why a label at all: the tile's chat already shows a speaker's display name to everyone in the
  tile, so a name over a wisp tells no one anything new, and it gives a wisp drifting by a name to greet in that chat
  (Aaron's aim of bringing people closer to each other). Why nearer and with nothing more: the edge avatar, the distance
  and the map dot exist to find friends across the tile; for a stranger they would track them. Never a location, only
  the account's display name;
- twelve slots (six before), the one longest unheard from reused.

**Two fixes the audit turned up** (both seen with the test below):
- **A group member's body in a species the viewer does not perceive was never drawn.** `animals.js` hides a species'
  whole pool when the player's own species does not perceive it (`setObserver`, perception.json), so a member in the
  woodpecker's body was invisible to a member in a deer's (the record was there, its pool hidden). Now a species with a
  remote body in it is drawn with only its remote bodies (`showRemoteBodies`: they hold its first slots, so the pool's
  count stops after them); its AI animals stay unseen, as the perception says.
- **Leaving a woodpecker in flight on a mirror page threw** (`animals.release` read the AI record's home oak, which a
  mirrored record does not have), leaving the player in no body and no spirit, every control off. It now flies to the
  oak nearest where it was left (the host runs it on from there).

**The transitions.** Going into a body in view of the group, the wisp dives into the animal's chest over 0.7 s, shrinking
and flaring, and the body is then the member (the AI's animal is taken out of the shared animals as before). Leaving a
body, the wisp grows out of where the animal stands with a burst of motes (`Wisp.burst`, the player's own exit) while the
animal goes back to the AI there. A stranger's spirit going into a body, or anyone leaving the world, shrinks away where it
was over 0.6 s (`gone`). Seen again later (out of the body, back in the world), it forms anew.

**A stranger's body as an ordinary animal: not yet, and it should be.** Today when a stranger embodies an animal the
host takes that animal out of everyone's world (`areq` take), so the strangers around them see a deer vanish and nothing
where the player walks. It should go on being drawn as an ordinary animal: no name, no wisp, no mark, no link to the
account, so the herd stays whole. The shared-animals channel is the place for it, not the hub (it is already anonymous and
per world): the embodied page would send its body's pose (the bodySample fields, 4 Hz) on the animals channel to the
host only (as `apos` goes), the host would keep the record in its stream marked held by that member instead of dropping
it, skip its AI, and stream its row like any animal's (under the cap); the host's own body would be streamed the same way.
A hand-over keeps it, since the new host rebuilds from its mirror and the held record carries the member number. The
group would draw both the named body (the hub) and the anonymous one (the stream): the hub's `c` would carry the body's
stream number so a group member's page hides the anonymous copy. Not built in this lane.

**Verified** (2026-11-06) with `tools/mp/visibility.mjs` on the home tile against a local hub: three headless Chromes
signed in as three test users, A and B in a group and C a stranger, each entering El Dorado from the main screen (A's
Start sent B the follow invitation). Every case was checked from both sides, from the page's own state: the slot in
players.js and, for a body, its record in the species' pool and its instance drawn. Each viewer's side was also
screenshotted with a camera aimed at the other player. **35 of 35 checks passed**:
- C's spirit and A's spirit see each other, and B sees C's. A has no edge avatar or map dot for C, and C's label reads
  C's name from the hub.
- A in a deer sees C's spirit. C does not see A.
- C in a deer is hidden from A and B. From the deer, C sees B's spirit.
- B's spirit and A's deer see each other.
- A's deer and B see each other as each of B's bodies: the raven, the western gray squirrel, the acorn woodpecker and
  the red-tailed hawk. The woodpecker failed before the perception fix and the release crash fix above.
- A leaves the deer and is seen by B and C as a spirit (frames from B's side show the wisp grow out of the deer).
  A goes into a deer again: B sees the deer, C sees nothing.
- C changes the season to winter: B and C no longer see each other. Back in fall, they see each other again.
- C and B go to the main screen: gone for A within a second.

Before the rule, the same pages audited what was there: sign-in, friends and the group, Start with the follow
invitation and Join, the group's positions and wisps, group and tile chat, the shared animals (one host, the others
mirroring, a hand-over when the acorn host moved) and voice. Voice was A's microphone on (a fake device) and A and B's
peer connection `connected`, with the stranger getting no peer. All of it worked.

Not verified: real browsers by real people; more than three pages (Chromium's WebGL context limit and this machine's
load, 20 to 400, during the run); a stranger's label and the embody frames by eye at play speed (the pages ran at a few
frames a second). The fliers' shots are from a moving camera behind a fast bird, so the state checks are the evidence
there.

**Open.** A player removed from a group while in a body fades from the former member's view after the 4.5 s silence rather
than at once (no `gone` on a group change). Two tabs of one user in one world both send positions (as before). Strangers'
bodies as ordinary animals (above).

## Open

- Federation of accounts: a user is a row on one hub. A handle of the form name@hub and signing in to
  another node with it are for the federation step in the roadmap, not here. User ids are UUIDs so that a
  later handle can carry the home hub without renumbering.
- Seeing the other players on a tile as their animals, with their names over them for friends: the next
  step after group travel, under the same privacy rule (relay to the room, persist nothing). The group's members
  are drawn as their animals since 2026-11-02 ("Shared animals" above, "Players as their animals"); the players
  on the tile outside the group are seen as spirits since 2026-11-06 ("Who sees whom" above), and not in their bodies.

  **Built (2026-11-02, the group's players seen; the bodies are still open).** Aaron, after testing with two
  browsers: "I can't see the other player's spirit. The players should show up on the map and just like if I'm in a
  deer herd, if the other player is not visible on the screen their avatar should be shown at the edge of the screen
  closest to them." `client/src/players.js` (`RemotePlayers`, built in `enterWorld` and fed by `multiplayer.js`
  `gotPos`): each group member whose `pos` the hub relays (same tile room, 5 Hz) is drawn in the world as a spirit
  wisp like the player's own (`spirit.js` `Wisp`, six built once sharing the player's wisp's textures, so no new
  texture unit, on the souls' camera layer 2, which `SpiritLook.render` now draws while any is live, in every form)
  in the two hues of the member's avatar (`social.js` `avatarSeed`, so the wisp and the avatar match), gliding
  between samples (each sample starts a run from where the wisp is drawn to the sample over the samples' measured
  spacing, 0.1 to 0.5 s, so it never jumps; past a run's end it carries on at the run's speed for 0.4 s, then
  holds; 3 s without a sample and it fades over 1.5 s and the slot is freed), grown with the eye's distance as the
  souls are (x1 within 8 m to x8 at 300 m), with the display name over it within 60 m while on screen
  (`#playerLabels`, a label like the smell sense's, in the member's hue). A member in a body (`form` not `spirit`)
  is a small wisp 0.7 m over the body's position for now: the bodies of other players are the open part of this
  item. On the mini-map (`minimap.js` `others`, `dotIn`, `drawOthers`) each member is a dot in the avatar's hue,
  pinned at the map's rim in their direction when outside the 800 m, the name drawn beside the dot under the
  pointer (the full map too). Off screen, the member's avatar (`avatarFor`, 26 px) sits in a circle at the screen's
  edge nearest them with the distance under it (over it along the bottom edge), placed by the herd marks' rule,
  which moved into an exported `edgePlace(camera, x, y, z)` in `herdMarks.js` that `HerdMarks` now calls too; the
  bottom edge's inset is measured from the HUD's bottom rows (`setEdgeBottom`; the abilities row with its key line,
  the nearby bar, the chat) so a mark stands over them, for herd members too. A member the hub says is offline or
  in another tile is dropped at once (`presence` in `multiplayer.js`); one online elsewhere, not in a world, or in
  the tile but not in the group sends nothing here and is not drawn (the hub relays within the room to co-members
  only). Positions live only in `RemotePlayers`' slots and `mp.poses`, in memory, cleared when the room is left;
  nothing is written or logged. Debugging on `__weMp`: `fake(id, {x, y, z, yaw, form}, name)` feeds a position as
  the hub's relay would; `fakes(n, r)` runs n fake members circling the player at r m at 5 Hz (`fakes(0)` stops).
  Verified in the viewer on the home tile against the real hub with a scripted second user (`seen_b`, a script
  over `tests/wsclient.py` circling at 1.5 to 2.5 m/s; the browser `seen_a`; one group "Seen"): the wisp in the
  world in seen_b's hue gliding (2.77 m over 1.1 s at 2.5 m/s, continuous) with "seen_b" over it within 60 m, the
  label gone past 60 m and the wisp still a glow at 180 m; the avatar circle at the left edge with "143 m" when the
  view faced away, sliding to the right edge ("141 m") as the view turned, gone with the wisp in view; the dot on
  the mini-map north-east of the player and "seen_b" beside it under the pointer; a far fake's dot pinned at the
  rim; the same as a black-tailed deer (the body's `form` relayed, the mark at the top and bottom edges while the
  script was 380 to 450 m off, the dot pinned at the rim); four fakes two of them "deer" drawn with their names.
  The frame with four faked members by a CPU timer round `players.update` and the spirit's render over ~290
  frames: four within 25 m add 0.2 ms (0.3 vs 0.1 ms median; 0.4 vs 0.1 at p90), four at 95 to 320 m 0.1 ms
  (past 60 m a wisp's form is updated on alternate frames), the render's submit unchanged within its noise (three
  small draws each); the hub's 12 tests pass; no console errors (a pre-existing warning, THREE's "17 texture units"
  from the terrain's ground program with the micro-clump maps, fires with no member drawn too and is not this
  lane's). Not verified: two real browsers (the second user never had the client: its own view of the first was not
  seen), a member's wisp seen through the arrival, the hover name on a touch screen, the bottom-edge inset on a
  window where the chat is hidden, more than six members at once (the seventh takes the slot longest unheard from).
- Regions: a place is a tile now; when a bioregion holds several tiles the list can group them.
- Moderation beyond blocking: a report button and a hub-level ban list, when there is a public hub.
