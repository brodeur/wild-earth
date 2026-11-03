#!/bin/sh
# Push the tiles' client rasters (png, jpg, bin: git-ignored, built on the workstation) to the hosted server's volume
# (docs/hosting.md), where deploy/entrypoint.sh links them into the image's tiles/<tile>/client/ at start. The JSON
# layers travel in the image and are left out here. Usage, from the repo root, signed in to Fly:
#   tools/push_tiles.sh                    every tile in tiles/
#   tools/push_tiles.sh utm10n_680_4280    one tile
# Then `fly machine restart` (or a deploy) so the entrypoint links the new files.
set -e
APP=${FLY_APP:-wild-earth}
cd "$(dirname "$0")/.."
if [ $# -gt 0 ]; then dirs=""; for t in "$@"; do dirs="$dirs tiles/$t/client"; done; else dirs=$(ls -d tiles/*/client); fi
echo "pushing to $APP: $dirs"
COPYFILE_DISABLE=1 tar czf - --exclude='*.json' --exclude='.DS_Store' $dirs \
  | fly ssh console -a "$APP" -C "sh -c 'mkdir -p /app/data/tiles && tar xzf - -C /app/data/tiles --strip-components=1 && du -sh /app/data/tiles'"
