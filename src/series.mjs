// Time interpolation of a census series, shared by the page and the tests.
//
// Between two censuses the population is unknown; a straight line in log
// space would change slope abruptly at every census, which reads as a jerk
// when playing. A monotone cubic (Fritsch-Carlson) through the log values
// keeps every census exactly, never overshoots, and stays smooth.

// Slopes of the monotone cubic at each knot, for knots x (ascending) and y.
export function monotoneSlopes(x, y) {
  const n = x.length,
    m = new Float64Array(n);
  if (n === 1) return m;
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * (x[i + 1] - x[i]) + (x[i] - x[i - 1]);
      const w2 = (x[i + 1] - x[i]) + 2 * (x[i] - x[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m;
}

// Value of the cubic at t; clamps outside the knots (no extrapolation).
// `from` is a hint for the segment, so a replay that moves a little each
// frame does not rescan the knots for 35 000 communes.
export function hermiteAt(x, y, m, t, from = 0) {
  const n = x.length;
  if (t <= x[0]) return y[0];
  if (t >= x[n - 1]) return y[n - 1];
  let i = Math.min(Math.max(from, 0), n - 2);
  while (i > 0 && x[i] > t) i--;
  while (x[i + 1] < t) i++;
  const h = x[i + 1] - x[i],
    u = (t - x[i]) / h,
    u2 = u * u,
    u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * y[i] +
    (u3 - 2 * u2 + u) * h * m[i] +
    (-2 * u3 + 3 * u2) * y[i + 1] +
    (u3 - u2) * h * m[i + 1]
  );
}

// One commune: `years` (ascending) and `pop` (Int32, -1 = no census).
// Returns a function year -> population, cubic in log space over the
// censuses that exist, flat before the first and after the last.
export function seriesOf(years, pop) {
  const x = [],
    y = [];
  for (let i = 0; i < years.length; i++)
    if (pop[i] >= 0) {
      x.push(years[i]);
      y.push(Math.log(pop[i] + 1));
    }
  if (!x.length) return () => -1;
  const m = monotoneSlopes(x, y);
  let seg = 0;
  return (t) => {
    while (seg > 0 && x[seg] > t) seg--;
    while (seg + 2 < x.length && x[seg + 1] < t) seg++;
    return Math.exp(hermiteAt(x, y, m, t, seg)) - 1;
  };
}

// Density (people per km²) to a 0..1 height, logarithmic between lo and hi.
export function heightOf(density, lo, hi) {
  if (!(density > 0)) return 0;
  const v = (Math.log10(density) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
