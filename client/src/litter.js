// The body-scaled litter ring (2026-10-28): pebbles, fallen leaves, acorn caps, twigs and dead stems drawn from the
// ground detail's material weights (groundDetail.js mask: thatch, litter, gravel, rock, pavement) inside a ring whose
// radius and density follow bodyScale.js. A vole's and a lizard's world is mostly litter and stone with blades
// standing out of it; a deer barely sees this layer. Stub: main.js constructs, updates and disposes it; the lane fills it.
export class Litter {
  constructor(tile, scene, { terrain = null, atmosphere = null } = {}) {
    Object.assign(this, { tile, scene, terrain, atmosphere });
  }
  update(dt, camera, pos) { /* filled by the litter lane */ }
  dispose() { /* nothing yet */ }
}
