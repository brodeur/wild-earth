// Desirability (2026-11-06; pipeline/games.py desirability): how much an eater prefers a food this season, 0 (the least
// preferred of its foods that season) to 1 (the most), from the tile's games.json relations.desirability
// ({eater: {food: [one value per season]}}, the seasons in relations.desirability_seasons' order); null when the tile has
// none, or the eater does not eat it this season. sniffWave.js pulses by it, quarry.js's Tab leans to it.
const ORDER = ['winter', 'spring', 'summer', 'fall'];
export function desireOf(tile, eater, food, season) {
  const R = tile?.games?.relations, row = R?.desirability?.[eater]?.[food]; if (!row) return null;
  const i = (R.desirability_seasons || ORDER).indexOf(season); if (i < 0) return null;
  const v = row[i]; return typeof v === 'number' ? v : null;
}
