# Ground detail textures

Tileable surfaces for the near-ground detail layer (client/src/groundDetail.js, client/src/terrain.js).
Each slot has an albedo (`*_albedo.jpg`, sRGB) and a tangent-space normal map (`*_normal.jpg`,
OpenGL convention, +Y up). All are the 1K JPG downloads from Poly Haven, re-encoded once with
Pillow (albedo q82, normal q88 4:4:4) to keep the folder under 6 MB; pixels are otherwise unchanged.
At load the albedo is divided by its mean colour (mid-grey normalised), so it only modulates the
aerial photo underneath.

All five are **CC0 1.0 Universal** (public domain dedication, https://polyhaven.com/license).
Attribution is not required; it is given here anyway.

| Slot | File prefix | Title | Author | Real-world size | Source |
|---|---|---|---|---|---|
| Dry grass thatch | `thatch_` | Withered Grass | Charlotte Baglioni | 2 m | https://polyhaven.com/a/withered_grass |
| Oak duff / leaf litter | `litter_` | Dry Decay Leaves | Amal Kumar | 2 m | https://polyhaven.com/a/dry_decay_leaves |
| Gravelly dirt | `gravel_` | Rocky Trail | Amal Kumar | 2 m | https://polyhaven.com/a/rocky_trail |
| Cobbles and rock | `rock_` | Rocks Ground 06 | Rob Tuytel | 3 m | https://polyhaven.com/a/rocks_ground_06 |
| Worn pavement | `pavement_` | Worn Asphalt | Amal Kumar | 2 m | https://polyhaven.com/a/worn_asphalt |

Downloaded 2026-10-24 from `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/<id>/<id>_diff_1k.jpg`
and `<id>_nor_gl_1k.jpg`. Asphalt 02 (Rob Tuytel, CC0) was tried first for pavement and dropped:
its long cracks repeat every 3 m and read as stripes along a road from 15 m up.
