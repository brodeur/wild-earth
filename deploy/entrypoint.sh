#!/bin/sh
# The hosted server's start (Dockerfile): the state that must outlive a deploy goes on the volume at /app/data.
#   data/hub.sqlite            the hub's accounts, friends, groups and group chat (hub.py writes it there already)
#   data/game/<tile>/          each tile's played acorn-game worlds (server.py GameWorld writes tiles/<tile>/game/):
#                              the image's tiles/<tile>/game is made a symlink to it, so a redeploy keeps the worlds
set -e
cd /app
mkdir -p /app/data/game
for t in tiles/*/; do
  id=$(basename "$t")
  [ -f "$t/manifest.json" ] || continue
  mkdir -p "/app/data/game/$id"
  rm -rf "$t/game"
  ln -s "/app/data/game/$id" "$t/game"
done
exec "$@"
