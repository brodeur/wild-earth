// Yosemite Falls capture poses (tile utm11n_267_4175) for the white-water lane, with whitewater_harness.js:
// window.__wwPosesYos() and __wwCaptureYos(prefix, keys, date). The upper fall: lip (4242, 7031), plunge (4241, 6946),
// top 1980 m, base 1566 m, drop 414 m; the lower fall: lip (4212, 6406), plunge (4212, 6355), drop 96 m.
window.__wwPosesYos = () => {
  const P = {};
  P.y1 = { view: [4260, 6250, 60, 4242, 6800, 200] };          // the whole upper fall from the valley floor, 700 m off, as the May photograph
  P.y2 = { view: [4330, 6760, 35, 4241, 6950, 8] };            // the upper fall's plunge and boil from 200 m, 35 m over the ground
  P.y3 = { view: [4245, 6880, 4, 4241, 6940, 1] };             // on the stream 70 m below the plunge, looking up at the boil and the run-out
  P.y4 = { view: [4260, 6250, 25, 4212, 6355, 6] };            // the lower fall's plunge and run-out from 110 m
  P.y5 = { view: [4216, 6300, 3, 4212, 6350, 1] };             // the lower fall's run-out from the stream, 55 m below the plunge
  return P;
};
window.__wwCaptureYos = async (prefix, keys = null, date = null) => {
  const H = window.__ww, we = window.__we, P = window.__wwPosesYos(), out = {};
  if (date) { we.setDate(date); await H.wait(2500); }
  we.setHour(11);
  for (const [k, p] of Object.entries(P)) {
    if (keys && !keys.includes(k)) continue;
    const r = await H.view(...p.view);
    H.setTime(100);
    out[k] = { cam: r.cam, saved: await H.save(prefix + '_' + k) };
  }
  return out;
};
