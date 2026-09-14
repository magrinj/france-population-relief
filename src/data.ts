import { popDecode, rleDecode } from "./codec.mjs";
import { seriesOf, monotoneSlopes } from "./series.mjs";
import { LO, HI } from "./scale.ts";

export type Commune = { i: number; code: string; name: string; dep: number; area: number; gx: number; gy: number; maxPop: number };
export type Dep = { code: string; name: string; area: number; series: Float64Array; box: [number, number, number, number] };
export type Data = {
  years: number[];
  W: number;
  H: number;
  communes: Commune[];
  byCode: Map<string, number>;
  deps: Dep[];
  depOf: Uint8Array; // commune -> département index
  pop: Int32Array; // communes × years, -1 = no census
  grid: Uint16Array; // W × H, commune index + 1, 0 = sea or abroad
  series: ((t: number) => number)[];
  knots: Knots;
  candidates: number[]; // label candidates, biggest first
  total1793: number;
};
// Every commune's censuses in log space, flattened, for the per-frame loop.
export type Knots = { start: Int32Array; count: Int32Array; x: Float64Array; y: Float64Array; m: Float64Array; seg: Int32Array; base: Float32Array };

export async function loadData(base = "data/"): Promise<Data> {
  const [meta, popBuf, gridBuf] = await Promise.all([
    fetch(base + "meta.json").then((r) => r.json()),
    fetch(base + "pop.bin").then((r) => r.arrayBuffer()),
    fetch(base + "grid.bin").then((r) => r.arrayBuffer()),
  ]);
  const years: number[] = meta.years;
  const n = meta.communes.length;
  const pop = popDecode(new Uint8Array(popBuf), n, years.length);
  const grid = rleDecode(new Uint16Array(gridBuf), meta.grid.w * meta.grid.h);
  const depIndex = new Map<string, number>((meta.deps as [string, string][]).map((d, i) => [d[0], i]));
  const deps: Dep[] = (meta.deps as [string, string][]).map(([code, name]) => ({ code, name, area: 0, series: new Float64Array(years.length), box: [Infinity, Infinity, -Infinity, -Infinity] }));
  const depOf = new Uint8Array(n);
  const communes: Commune[] = meta.communes.map((c: [string, string, string, number, number, number], i: number) => {
    let maxPop = 0;
    for (let j = 0; j < years.length; j++) maxPop = Math.max(maxPop, pop[i * years.length + j]);
    const dep = depIndex.get(c[2])!;
    depOf[i] = dep;
    deps[dep].area += c[3];
    return { i, code: c[0], name: c[1], dep, area: c[3], gx: c[4], gy: c[5], maxPop };
  });
  const series = communes.map((c) => seriesOf(years, pop.subarray(c.i * years.length, (c.i + 1) * years.length)));
  const knots = flatten(years, pop, communes);
  // Département series at every census, on the same rule as the map (a
  // commune without a count keeps its nearest census).
  for (let i = 0; i < n; i++) {
    const s = deps[depOf[i]].series;
    for (let j = 0; j < years.length; j++) {
      const v = series[i](years[j]);
      if (v > 0) s[j] += v;
    }
  }
  // Bounding box of every département on the grid, for the click-to-zoom.
  const W = meta.grid.w;
  for (let k = 0; k < grid.length; k++) {
    if (!grid[k]) continue;
    const b = deps[depOf[grid[k] - 1]].box,
      x = k % W,
      y = (k - x) / W;
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x + 1 > b[2]) b[2] = x + 1;
    if (y + 1 > b[3]) b[3] = y + 1;
  }
  const candidates = communes
    .map((c) => c.i)
    .sort((a, b) => communes[b].maxPop - communes[a].maxPop)
    .slice(0, 400);
  const total1793 = deps.reduce((s, d) => s + d.series[0], 0);
  return { years, W: meta.grid.w, H: meta.grid.h, communes, byCode: new Map(communes.map((c) => [c.code, c.i])), deps, depOf, pop, grid, series, knots, candidates, total1793 };
}

function flatten(years: number[], pop: Int32Array, communes: Commune[]): Knots {
  const n = communes.length,
    ny = years.length;
  const start = new Int32Array(n),
    count = new Int32Array(n),
    x = new Float64Array(n * ny),
    y = new Float64Array(n * ny),
    m = new Float64Array(n * ny),
    base = new Float32Array(n);
  let k = 0;
  const span = Math.log(HI / LO);
  for (let i = 0; i < n; i++) {
    start[i] = k;
    const xs: number[] = [],
      ys: number[] = [];
    for (let j = 0; j < ny; j++) {
      const v = pop[i * ny + j];
      if (v >= 0) (xs.push(years[j]), ys.push(Math.log(v + 1)));
    }
    const ms = monotoneSlopes(xs, ys);
    for (let j = 0; j < xs.length; j++) (x[k] = xs[j]), (y[k] = ys[j]), (m[k] = ms[j]), k++;
    count[i] = xs.length;
    // height = (ln p - ln area - ln LO) / ln(HI / LO)
    base[i] = (Math.log(communes[i].area) + Math.log(LO)) / span;
  }
  return { start, count, x: x.subarray(0, k), y: y.subarray(0, k), m: m.subarray(0, k), seg: new Int32Array(n), base };
}

// Populations and heights of every commune at a fractional year, plus the
// population of every département. Returns the national total.
export function sampleYear(d: Data, t: number, heights: Float32Array, pops: Float32Array, depPops: Float64Array): number {
  let total = 0;
  depPops.fill(0);
  const { start, count, x, y, m, seg, base } = d.knots;
  const invSpan = 1 / Math.log(HI / LO);
  for (let i = 0; i < d.communes.length; i++) {
    const n = count[i];
    if (!n) {
      pops[i] = -1;
      heights[i] = 0;
      continue;
    }
    const s0 = start[i];
    let lp: number;
    if (t <= x[s0]) lp = y[s0];
    else if (t >= x[s0 + n - 1]) lp = y[s0 + n - 1];
    else {
      let k = seg[i];
      while (k > 0 && x[s0 + k] > t) k--;
      while (x[s0 + k + 1] < t) k++;
      seg[i] = k;
      const a = s0 + k,
        h = x[a + 1] - x[a],
        u = (t - x[a]) / h,
        u2 = u * u,
        u3 = u2 * u;
      lp = (2 * u3 - 3 * u2 + 1) * y[a] + (u3 - 2 * u2 + u) * h * m[a] + (-2 * u3 + 3 * u2) * y[a + 1] + (u3 - u2) * h * m[a + 1];
    }
    const p = Math.exp(lp) - 1;
    pops[i] = p;
    const hv = lp * invSpan - base[i];
    heights[i] = hv < 0 ? 0 : hv > 1 ? 1 : hv;
    if (p > 0) {
      total += p;
      depPops[d.depOf[i]] += p;
    }
  }
  return total;
}

// The censuses around a year: [before, after] indices into years, either may be -1.
export function censusesAround(years: number[], t: number): [number, number] {
  let a = -1;
  for (let j = 0; j < years.length; j++) if (years[j] <= t) a = j;
  const b = a + 1 < years.length ? a + 1 : -1;
  return [a, b];
}
