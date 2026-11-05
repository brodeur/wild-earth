#!/bin/bash
# state.sh save|load <name> <tile>: snapshot or restore the files the reroute and water steps write
op=$1; name=$2; t=$3
W=/Users/aaronbrodeur/Sites/wild-earth/.claude/worktrees/water-reroute
D=$W/scratch/reroute/state/$name/$t
FILES="manifest.json hydro/channels.geojson hydro/water_reaches.json client/features.json client/species_mix.json client/channel_profile.png client/channel_depth.png client/water.png client/water_width.png client/heights.png client/terrain_detail.png terrain/dem_banked.tif"
for f in $FILES; do
  if [ $op = save ]; then mkdir -p $(dirname $D/$f); [ -f $W/tiles/$t/$f ] && cp $W/tiles/$t/$f $D/$f
  else [ -f $D/$f ] && cp $D/$f $W/tiles/$t/$f; fi
done
echo "$op $name $t"
