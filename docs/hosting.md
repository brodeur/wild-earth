# Hosting Wild Earth: one origin, one always-on process

Written 2026-11-02, when Aaron said it was time to host, after testing two players on one Mac ("it seriously lags":
that was two worlds rendering on one machine, not the hub, which relays a few hundred bytes a second per player).

## The shape

Everything from one origin, exactly as the dev server runs on a workstation: `server.py` serves the client, the built
tiles' client layers and the hub (`hub.py`, `ws.py`) on one port, behind TLS. One origin because the hub's session is
a cookie and its WebSockets are same-site; splitting the static client from the hub would need cross-site cookies and
an origin allow-list for nothing gained. The process must be always on: the hub holds the players' sockets, so a host
that sleeps idle machines or runs code only per request will not do.

**Vercel will not hold the hub.** Its functions are serverless and short-lived: no WebSocket server, no process that
lives between requests, no SQLite that persists. It could serve the static client and the tiles, but then the hub is
elsewhere and the cookie is cross-site. So the Vercel instance is for a landing page, if anything, not the game.

**What fits:** any host that runs a Docker container all day with a persistent volume. Two are set up in the repo:

- **Fly.io** (`fly.toml`): a shared-CPU machine with 512 MB, TLS at Fly's edge, a 1 GB volume. About 5 dollars a
  month at this size. The simplest.
- **Any Docker VPS** (`deploy/docker-compose.yml`, `deploy/Caddyfile`): Hetzner, DigitalOcean, a machine of your own.
  Caddy in front gets and renews the certificate for the domain by itself.

Both run the same `Dockerfile`: Python 3.12 and pyproj, the server, the client, the library and the tiles. The
pipeline is not installed (rasterio, the lidar tools and the rest are workstation dependencies): `server.py` loads it
if it can and otherwise turns the build API off with a 503, so tiles are built on the workstation and shipped in the
image. `.dockerignore` keeps each tile's intermediates out (terrain, vegetation, imagery, seasons, the cache, the
unreal export); what goes in is each tile's `client/` rasters and its JSON layers, about 60 to 80 MB a foothill tile,
412 MB for the seven tiles today. The image is built from the workstation checkout, where the git-ignored rasters
exist; `fly deploy` uploads that context to Fly's builder.

## What persists where

- `data/hub.sqlite` on the volume: the accounts, recovery codes, sessions, friends, blocks, groups, group chat. The
  only personal data the host holds: a name, a password hash, a Discord id if linked. No email, no positions, no
  tiles, no times of play (`docs/multiplayer.md`, Privacy).
- `data/game/<tile>/` on the volume: each tile's played acorn-game worlds (`server.py` writes `tiles/<tile>/game/`;
  `deploy/entrypoint.sh` makes that a symlink to the volume at start, so a redeploy keeps them).
- `data/tiles/<tile>/client/` on the volume: the tiles' client rasters (png, jpg, bin), pushed from the workstation
  with `tools/push_tiles.sh` (a tar streamed over `fly ssh console`) and linked into the image's tile folders by
  `deploy/entrypoint.sh` at start. The first deploy showed flyctl's build context drops the git-ignored rasters even
  with a `.dockerignore`, and a deploy is far quicker without 400 MB of them anyway. A rebuilt tile means a push and a
  `fly machine restart`; the JSON layers travel in the image.
- Nothing else. Presence, rooms, counts, tile chat and positions are memory in the process and go with it.

The hub logs method, path and status, never a body, a name, a chat line or a position. Open-Meteo is called with a
tile's centre only. The dev server's own request log goes to the container's stdout, which Fly keeps for a while.

## Steps that need your accounts (not mine to do)

1. **A domain** (or Fly's `<app>.fly.dev` to start). Point it at the host; Fly: `fly certs add <domain>`.
2. **Fly:** `fly launch --copy-config --no-deploy` in the checkout (it reads `fly.toml`; choose a region near the
   players), `fly volumes create we_data --size 1 --region <region>`, then the secrets:
   `fly secrets set HUB_ORIGIN=https://<domain>`; with the Discord application registered (its redirect is
   `https://<domain>/api/hub/oauth/discord`), add `DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=...`. Then
   `fly deploy` (the image: about 90 MB), then `tools/push_tiles.sh` for the rasters and `fly machine restart`.
3. **A VPS instead:** check the repo out on the host, rsync the tiles' `client/` folders from the workstation (they are
   not in git), copy `.env.example` to `.env` and fill `HUB_DOMAIN`, `HUB_ORIGIN` and the Discord keys, then
   `docker compose -f deploy/docker-compose.yml up -d --build`.
4. **Check:** `https://<domain>/api/hub/config` answers `{"hub": "Wild Earth", "providers": [...]}`;
   `https://<domain>/client/` shows the title and the earth; two accounts on two machines find each other.
5. **Backups:** Fly volume snapshots are daily by default; `fly volumes snapshots list we_data`. On a VPS, copy
   `data/` (SQLite is one file; stop the container or use `sqlite3 .backup` for a consistent copy).

## Costs and limits to expect

- A shared-CPU 512 MB machine holds the hub and the static files for a handful of players easily: the server is
  Python's threaded `http.server`, one thread per connection, and the client fetches each tile's rasters once (tens of
  MB per tile per player; put the domain behind a CDN or raise the machine's bandwidth when that matters).
- The acorn game's AI runs on the first client in each world (the "host" client), not on the server; the server only
  orders events. That stays as it is.
- There is no rate limit on the static files and no CDN; Fly's edge caches nothing by default. Fine for friends,
  revisit for strangers.
- The two tunnels (Tailscale to the workstation, or `cloudflared`) remain the quickest way to test with one friend
  without deploying anything: the dev server bound to `0.0.0.0` behind the tunnel, `HUB_ORIGIN` set to the tunnel's
  URL.

## Not done here

- Deployed 2026-11-02 (Aaron's Fly account, the app `wild-earth`, San Jose, a 3 GB volume): the hub, the client and
  the tiles answer at https://wild-earth.fly.dev; Fly's own GitHub launch had made a first machine in Amsterdam
  without rasters, removed. The Docker image was never built on this Mac (the daemon was off); Fly's builder built it.
- Shared animals between players (each browser runs its own animals today; `docs/multiplayer.md` Open) is a design
  step, not a hosting one.
- A CDN for the tiles, a hub-level ban list, and moving the hub to its own process when the player count asks for it.
