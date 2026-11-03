#!/bin/sh
# The hosted server's start (Dockerfile): the state that must outlive a deploy goes on the volume at /app/data.
#   data/hub.sqlite            the hub's accounts, friends, groups and group chat (hub.py writes it there already)
#   data/game/<tile>/          each tile's played acorn-game worlds (server.py GameWorld writes tiles/<tile>/game/):
#                              the image's tiles/<tile>/game is made a symlink to it, so a redeploy keeps the worlds
#   data/tiles/<tile>/client/    the tiles' client rasters (png, jpg, bin), uploaded to the volume (docs/hosting.md:
#                              `tools/push_tiles.sh`), not shipped in the image: flyctl's build context dropped the
#                              git-ignored rasters (2026-11-02), and a deploy is far quicker without 400 MB of them;
#                              each raster is linked into the image's tiles/<tile>/client/ beside the JSON layers
set -e
cd /app
mkdir -p /app/data/game /app/data/tiles
for t in tiles/*/; do
  id=$(basename "$t")
  [ -f "$t/manifest.json" ] || continue
  mkdir -p "/app/data/game/$id"
  rm -rf "$t/game"
  ln -s "/app/data/game/$id" "$t/game"
  if [ -d "/app/data/tiles/$id/client" ]; then
    for f in /app/data/tiles/$id/client/*; do
      [ -e "$f" ] && ln -sf "$f" "$t/client/$(basename "$f")"
    done
  fi
done
exec "$@"
