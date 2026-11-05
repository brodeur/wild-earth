// Fixed capture poses for the reroute lane (with scratch/whitewater_harness.js; upload server on 8798): __rrCapture(prefix, tile)
window.__rrPoses = {
  utm10n_680_4280: {
    weber_a: [5672, 9598, 9, 5650, 9573, 0.5],      // Weber Creek, from the north-east bank, looking across
    weber_b: [5640, 9545, 5, 5655, 9590, 0.5],      // ... from downstream on the floor
    hangtown_a: [5547, 9822, 8, 5527, 9801, 0.5],   // Hangtown Creek
    hangtown_b: [5600, 9850, 14, 5560, 9815, 0.5],
  },
  utm10n_690_4280: {
    hunchup_a: [1895, 2072, 9, 1872, 2049, 0.5],    // Hunchup Creek
    hunchup_b: [2335, 2445, 9, 2310, 2424, 0.5],
    hunchup_c: [1950, 2120, 22, 1872, 2049, 0.5],
  },
  utm11n_270_4180: {                                 // 267_4175's Yosemite poses moved by (-3000, -5000)
    falls_whole: [1260, 1250, 60, 1242, 1800, 200],   // the upper fall from the valley floor
    falls_plunge: [1330, 1760, 35, 1241, 1950, 8],     // the upper fall's plunge from 200 m
    falls_lower: [1260, 1250, 25, 1212, 1355, 6],     // the lower fall
    merced_a: [1600, 560, 25, 1560, 430, 0.5],        // the Merced from the north bank
    merced_b: [2300, 620, 40, 2330, 330, 0.5],
  },
};
window.__rrCapture = async (prefix, tile, keys = null) => {
  const H = window.__ww, P = window.__rrPoses[tile], out = {};
  window.__we.setHour(11);
  for (const [k, p] of Object.entries(P)) {
    if (keys && !keys.includes(k)) continue;
    await H.view(...p, 1500); H.setTime(100);
    await H.wait(600);
    out[k] = await H.save(prefix + '_' + k, 0.85, 8798);
  }
  return out;
};
