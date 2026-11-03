// Capture poses for the tree-heights lane (with heights_harness.js): __thCapture(prefix, tile) saves each pose's jpeg and
// returns the frame times. Yosemite (utm11n_267_4175): a valley-floor meadow at (4425, 5265), 1206 m; the river's
// cottonwoods at (7462, 5269). Home (utm10n_680_4280): oak woodland round the tile centre.
window.__thPoses = {
  utm11n_267_4175: {
    deerE: [4425, 5265, 1.2, 5600, 5450, 12],     // a deer's eye on the meadow looking up the valley along the canopy
    deerW: [4425, 5265, 1.2, 3300, 4750, 12],     // and down the valley
    air: [2600, 4200, 380, 5600, 5600, 0],        // the valley floor from the air, looking up the valley
    airHigh: [1500, 3200, 900, 6000, 6000, 0],    // higher and further: the far tier's silhouette
    river: [7420, 5230, 1.5, 7462, 5269, 10],     // the river's cottonwoods from the bank
    rimN: [4425, 5265, 1.2, 4600, 6400, 500],     // the north rim's treeline against the sky from the meadow (the far tier)
    floorFar: [3000, 4300, 25, 7500, 5600, 10],   // over the floor's canopy at 25 m, looking 4.7 km up the valley
  },
  utm10n_680_4280: {
    airOak: [4300, 4300, 220, 5200, 5200, 0],     // the oak woodland from the air
    groundOak: [4800, 4800, 1.5, 5300, 5250, 8],  // and from the ground
  },
};
window.__thCapture = async (prefix, tile, keys = null) => {
  const H = window.__th, P = window.__thPoses[tile], out = {};
  H.opts.clear = true;
  H.we.setHour(11);
  for (const [k, p] of Object.entries(P)) {
    if (keys && !keys.includes(k)) continue;
    const r = await H.view(...p);
    out[k] = { cam: r.cam, t: H.timeGpu(30), saved: await H.save(`${prefix}_${k}`) };
  }
  await H.view(null);
  return out;
};

// GPU frame times at every pose of a tile, three rounds (the rounds' medians kept), into window.__gpu
window.__thGpu = async (tile, rounds = 3) => {
  const H = window.__th, P = window.__thPoses[tile], out = {};
  for (let r = 0; r < rounds; r++) for (const [k, p] of Object.entries(P)) {
    await H.view(...p, 300);
    const t = await H.gpuTime(40); (out[k] ||= []).push(t && t.median);
    out[k + ':calls'] = t && [t.calls, t.tris];
  }
  await H.view(null);
  return out;
};
