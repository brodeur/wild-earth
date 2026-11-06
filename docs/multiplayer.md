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
  not kept after the connection closes. The connection holds its last one in memory so that a group member
  who enters the room after it is told where the player is (lane 4); it goes with the room or the connection.
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
hello     {}                                  -> welcome {you, friends[], requests[], groups[], online[], providers[]}
search    {q}                                 -> found {users[]}
friend    {op: 'request'|'accept'|'remove'|'block'|'unblock', user}
group     {op: 'create', name, users[]} | {op: 'add'|'remove', group, user} | {op: 'leave'|'name', group, name?}
chat      {scope: 'group'|'tile', text}       (text <= 500 chars)
place     {tile, group?, to?, point?}         -> the group's members and the people in `to` get invite {from, tile, season, group?, point?}
                                              (point: the picker's planned arrival, tile-local {x, north}; lane 4)
answer    {invite, join: true|false}
room      {op: 'join'|'leave', tile}          (the client joins its tile's room when a world is entered)
pos       {x, y, z, yaw, form}                (5 Hz, only while in a room and in a group)
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
invite    {id, from, tile, season}
pos       {user, x, y, z, yaw, form}          (from a group member in the same room; on entering a room, the
                                              last one from each group member already in it; lane 4)
counts    {tiles: {tile_id: n}}               (every 2 s to watchers, only when changed)
rtc       {from, fc, k, ...}                  (relayed from a group member in the same room, fc their connection's id;
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
up its oak on the host.

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

## Open

- Federation of accounts: a user is a row on one hub. A handle of the form name@hub and signing in to
  another node with it are for the federation step in the roadmap, not here. User ids are UUIDs so that a
  later handle can carry the home hub without renumbering.
- Seeing the other players on a tile as their animals, with their names over them for friends: the next
  step after group travel, under the same privacy rule (relay to the room, persist nothing). The group's members
  are drawn as their animals since 2026-11-02 ("Shared animals" above, "Players as their animals"); the players
  on the tile outside the group are still unseen.

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
