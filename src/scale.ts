// The one scale everything shares: colour, height and contour lines all read
// the same number, the logarithm of density mapped linearly between LO and HI
// people per km² (land from about 40, red from about 4 000, snow from about 9 000). Fixed over the whole period ("absolute"), so the same colour
// means the same density in 1793 and in 2023 and the country visibly fills.
//
// Chosen from the area-weighted density quantiles in public/data/qa.json:
// half of the territory sits between 20 and 65 /km², the top half-percent
// above 1 900, Paris at 20 000. Land starts at the sixth band (WATER), about
// 40 /km²: in 1793 much of the country is still under water and the towns
// stand out as islands; the emptied countryside of today sinks back. The top
// is tight on purpose: the big cities (4 000 to 10 000 /km²) reach the reds,
// only Paris the snow.
export const LO = 8;
export const HI = 16000;
export const NBAND = 25;
export const WATER_BANDS = 5;
export const WATER = WATER_BANDS / NBAND;
// Five blues from the deep to the shore, then dark forest to pale grass,
// straw, ochre, brick and wine, and rock and snow for the two highest bands.
export const HYPSO = [
  "#08172e", "#0c2547", "#123663", "#1a4a80", "#25619c",
  "#1b4332", "#1f5638", "#276a3e", "#357f45", "#4a944d", "#66a755", "#87b95f", "#abc86a",
  "#cdd473", "#e2d27a", "#ebc36c", "#eeaf5e", "#ec9752", "#e57c48", "#da6141", "#c94a3d",
  "#b0373b", "#96293d", "#e9dfe0", "#ffffff",
];
// Density at a given band boundary, for the legend.
export const densityAt = (h: number) => LO * Math.pow(HI / LO, h);
