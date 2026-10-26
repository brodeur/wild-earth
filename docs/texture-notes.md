# Ground texture without trees: notes

Trees are drawn in 3D over the ground texture, so a crown left in the photo is a dark blob under
every tree, and a canopy-green tint once the season turns. `pipeline/inpaint_crowns.py` makes
`client/texture_ground.jpg`: `client/texture_imagery.jpg` (the erased NAIP) with the crowns and their
shadows replaced by synthesized ground of the same class and the same summer. It also writes
`client/texture_ground_mask.png`, which shows what it filled. `texture_present.jpg` is left alone.

    python -m pipeline.inpaint_crowns utm10n_680_4280 [more ids] [--sheet DIR]

## What it does

- **Mask.** A pixel is masked where the 1 m CHM is at least 3 m over 30% or more of the 2.5 m pixel,
  grown by 1 px. Chaparral under 3 m keeps its own tint. The shadow lobe is added where it is 12% darker
  than the clean ground of its class, and so are up to 2 px of dark neighbours. The sun is fitted to
  the photo for each 5 km quadrant: the step tries each hour of the flight date and keeps the one
  whose cast shadows are darkest.
- **Colour.** The fill takes the colour of lit, clean ground of the pixel's habitat class
  (riparian is a class of its own). That colour is a normalised convolution at 15, 60, 250 and
  1000 m, and each scale is weighted by how much clean ground it covers. Classes are blended over
  30 m.
- **Texture.** 30 m quilting patches are taken from the nearest wholly clean, shadow-free windows,
  using erase_imagery's `_gain` and `_seam`. Each window pays a penalty for every time it has
  already been used.
- **Brightness.** The low frequencies of the fill (sigma 20 m) are then set to the ground colour.
  This prevents patchwork, and the fill is never brighter than the lit ground beside it.
- **Never touched:** highway and county-road pavement, and open water (the 30 m water cells minus
  their CHM canopy).
- **Erased built areas.** erase_imagery quilted woodland into these areas, crowns included, and
  under them the CHM records houses. Only their dark pixels are filled here. No source window is
  ever taken from an erased area, so no buildings come back.
- **Minor pavement.** erase_imagery faded it toward its surroundings, so it follows 70% of the
  change in that surrounding ground.

## What we found (2026-10-26, NAIP 2022)

| | 680_4280 home | 690_4280 Placerville | 680_4270 Cosumnes |
|---|---|---|---|
| CHM canopy (>= 3 m) | 57% | 75% | 57% |
| masked (+1 px feather) | 73% (80%) | 88% (91%) | 73% (80%) |
| clean lit ground left | 6.7% | 1.9% | 10% |
| fitted flight hour, PDT | 14.0-14.4 | 15.5-16.5 (weak) | 14.1-14.2 |
| run time, peak RSS | 2.7 min, 2.6 GB | 2.9 min, 2.2 GB | 2.8 min, 2.6 GB |

- **NAIP flight time.** NAIP here was flown in the early afternoon, not near noon. The sun was in
  the south-west (azimuth 215-230 degrees) and 65-70 degrees up, so shadows fall north-east. They
  are 2-5 m long and lie mostly inside the 1 px grown crown. The shadow lobe adds only 0.1-1.6% of
  the tile.
- **Placerville fit.** On Placerville (75% canopy) the fit keeps improving toward late afternoon
  even when it compares the shadow side with the sun side, so its hour is weakly determined. The
  dark clip limits the harm.
- **Mask size.** The mask is larger than the 50-60% we expected. The CHM canopy alone is that size,
  and growing a fragmented savanna canopy by 1 px adds another 5-13% of the tile. The rest is dark
  pixels in erased built areas, about 10% of the home tile.
- **Fill colour.** At 200 random tall-CHM pixels, 89-97% of fills are within one class standard
  deviation of the class's clean brightness. Before the fill, 3-10% were. The fill's 5x5 detail is
  0.98-1.21 of clean ground's.
- **Class means.** Filled class means are within 5% of the clean means for every class except
  barren (5-14% darker; it is small and its cells blend with neighbours) and home-tile conifer
  (blue channel 5.8% low, brightness within 3.3%).
- **Riparian.** In July the creek floors are dry grass. The clean riparian ground is within 1-6
  grey levels of grassland on these tiles, so "riparian not grassland" barely separates.
- **Unchanged pixels.** Kept pavement and open water are bit-identical.

## What reads well and what does not

- **Savanna and woodland edges.** The open-grass grain continues under the crowns with no seams
  and no patchwork, at the brightness of the grass beside it. Creek corridors and erased lots come
  out as the same dry ground.
- **Closed canopy** (Placerville's mixed conifer, the ponderosa stand, dense live oak) has no
  ground in the photo. The fill there is invented from openings 1-2 km away (median source
  distance 0.6-1.3 km). It reads as a uniform dry-grass beige with a faint repeating grain. Real
  ground there would be darker needle and leaf litter. A litter tint for forest classes would be
  more honest, and the seasonal colour step could supply it.
- **Topographic shading.** The photo's hillside light and shade under canopy is lost. The fill is
  as flat as the lit ground it copies, so the client's own terrain lighting has to carry relief.
- **Leftovers.** Shrubs under 3 m and their dark spots stay. That is intended, because they are
  drawn as impostors too. A few dark smudges remain where the CHM missed a crown that is in the
  photo.
