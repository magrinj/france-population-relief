// WGS84 longitude/latitude (degrees) to Lambert-93 (EPSG:2154) metres, the
// official French projection. Conformal conic, two standard parallels.
const a = 6378137,
  f = 1 / 298.257222101,
  e = Math.sqrt(2 * f - f * f);
const lon0 = (3 * Math.PI) / 180,
  lat1 = (44 * Math.PI) / 180,
  lat2 = (49 * Math.PI) / 180,
  lat0 = (46.5 * Math.PI) / 180;
const x0 = 700000,
  y0 = 6600000;
const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
const t = (p) =>
  Math.tan(Math.PI / 4 - p / 2) /
  ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
const n = Math.log(m(lat1) / m(lat2)) / Math.log(t(lat1) / t(lat2));
const F = m(lat1) / (n * t(lat1) ** n);
const rho0 = a * F * t(lat0) ** n;
export function lambert93(lon, lat) {
  const p = (lat * Math.PI) / 180,
    l = (lon * Math.PI) / 180;
  const rho = a * F * t(p) ** n,
    th = n * (l - lon0);
  return [x0 + rho * Math.sin(th), y0 + rho0 - rho * Math.cos(th)];
}
