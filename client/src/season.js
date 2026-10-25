// Seasons track the real calendar at the tile; the sun follows latitude, day of year and hour.
export const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const MIDPOINT_DOY = { winter: 15, spring: 105, summer: 196, fall: 288 };

export function seasonOfDate(d = new Date()) {
  const m = d.getMonth() + 1;
  return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'fall';
}

// Foothill (Mediterranean) palette per season: grass, deciduous oak canopy, deciduous leaf-on fraction,
// and haze (aerial perspective and sky turbidity): rain-washed winter clearest, summer dust and smoke thickest.
// riparian: the creek-corridor floor under willow, alder and cottonwood (habitat 6). `tint` is the hue
// (sRGB) the texture's own riparian mean is pulled to, `dark` its brightness (damp soil reads darker),
// `mix` the strength; summer is the photo's own deep green, so 0. Fall: yellow leaf litter over dark
// damp soil; winter: bare grey-brown twigs over dark wet ground; spring: bright yellow-green flush.
export const SEASON_LOOK = {
  winter: { grass: [0.55, 0.68, 0.40], oakLeaf: [0.45, 0.40, 0.25], oakLeafOn: 0.0, haze: 0.55,
            riparian: { tint: [0.40, 0.38, 0.32], dark: 0.75, mix: 0.8 } },
  spring: { grass: [0.52, 0.72, 0.32], oakLeaf: [0.40, 0.55, 0.25], oakLeafOn: 1.0, haze: 0.7,
            riparian: { tint: [0.54, 0.60, 0.28], dark: 1.1, mix: 0.65 } },
  summer: { grass: [0.80, 0.68, 0.36], oakLeaf: [0.33, 0.45, 0.22], oakLeafOn: 1.0, haze: 1.2,
            riparian: { tint: [0.34, 0.38, 0.30], dark: 1.0, mix: 0.0 } },
  fall:   { grass: [0.76, 0.64, 0.38], oakLeaf: [0.55, 0.45, 0.22], oakLeafOn: 0.8, haze: 1.0,
            riparian: { tint: [0.48, 0.43, 0.28], dark: 0.85, mix: 0.75 } },
};

// Sun direction (unit vector, y up, -z north) for a latitude, season and local solar hour.
export function sunDirection(latDeg, season, hour) {
  const doy = MIDPOINT_DOY[season] ?? 180;
  const dec = -23.44 * Math.cos((2 * Math.PI / 365) * (doy + 10)) * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;
  const H = (hour - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz)));   // from north, clockwise; morning east
  if (H > 0) az = 2 * Math.PI - az;
  // x east, z south (so north is -z)
  const x = Math.cos(el) * Math.sin(az), z = -Math.cos(el) * Math.cos(az), y = Math.sin(el);
  return { dir: [x, y, z], elevation: el, azimuth: az };
}
