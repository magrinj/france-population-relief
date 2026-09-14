// Builds public/data/ from four public sources (cached in .cache/):
//   - INSEE, séries historiques de population 1876-2023 (xlsx, géographie 2025)
//   - INSEE, code officiel géographique 2025 (commune names and movements)
//   - EHESS / LaDéHiS, "Des villages de Cassini aux communes d'aujourd'hui":
//     33 censuses from 1793 to 1999 per place, with the 2021 commune code
//   - Etalab / IGN Admin Express, commune outlines 2025 (100 m generalisation)
// Output: meta.json (communes, years, grid), pop.bin (census matrix),
// grid.bin (which commune each 1 km cell belongs to), qa.json (consistency).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readXlsx } from "./lib/xlsx.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { successor } from "./lib/cog.mjs";
import { lambert93 } from "./lib/lambert93.mjs";
import { paintPolygon, polygonArea, ringArea } from "./lib/raster.mjs";
import { rleEncode, popEncode } from "../src/codec.mjs";

const run = promisify(execFile);
const out = new URL("../public/data/", import.meta.url);
const cache = new URL("../.cache/", import.meta.url);
await mkdir(out, { recursive: true });
await mkdir(cache, { recursive: true });

const SOURCES = {
  insee: "https://www.insee.fr/fr/statistiques/fichier/3698339/base-pop-historiques-1876-2023.xlsx",
  cog: "https://www.insee.fr/fr/statistiques/fichier/8377162/cog_ensemble_2025_csv.zip",
  cassini: "https://didomena.ehess.fr/downloads/kd17cw827?locale=en",
  contours: "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/communes-100m.geojson",
};
async function fetchTo(name, url) {
  const file = new URL(name, cache);
  try {
    await readFile(file);
  } catch {
    console.log("Fetching", name);
    await run("curl", ["-fLsS", "--retry", "3", "-o", file.pathname, url]);
  }
  return file.pathname;
}

// ---- INSEE 1876-2023, one row per commune (Paris by arrondissement) ----
const xlsx = await readXlsx(await fetchTo("base-pop-historiques-1876-2023.xlsx", SOURCES.insee));
const head = xlsx[5];
if (head[0] !== "CODGEO") throw Error("unexpected INSEE layout");
const inseeYears = head.slice(4).map((h) => +h.slice(-4));
const insee = new Map(); // code -> { name, dep, pop: Map(year -> value) }
for (const row of xlsx.slice(6)) {
  if (!row[0]) continue;
  let code = String(row[0]),
    name = row[3];
  if (String(row[2]).startsWith("97")) continue; // overseas: not on this map
  if (code.startsWith("751")) (code = "75056"), (name = "Paris");
  const e = insee.get(code) ?? { name, dep: String(row[2]), pop: new Map() };
  inseeYears.forEach((y, i) => {
    const v = row[4 + i];
    if (typeof v === "number") e.pop.set(y, (e.pop.get(y) ?? 0) + v);
  });
  insee.set(code, e);
}
console.log("INSEE communes", insee.size, "years", inseeYears.length);

// ---- COG 2025: movements, to bring 2021 codes onto 2025 codes ----
const cogZip = await fetchTo("cog_ensemble_2025_csv.zip", SOURCES.cog);
const moves = parseCsv((await run("unzip", ["-p", cogZip, "v_mvt_commune_2025.csv"], { maxBuffer: 1 << 28 })).stdout);
const deps = parseCsv((await run("unzip", ["-p", cogZip, "v_departement_2025.csv"])).stdout)
  .filter((d) => !d.DEP.startsWith("97"))
  .map((d) => [d.DEP, d.LIBELLE]);

// ---- Cassini 1793-1999, summed per commune ----
const CASSINI_YEARS = { an3: 1793, an8: 1800, 1820: 1821 };
const cassiniRows = parseCsv(await readFile(await fetchTo("lieux_cassini_devenus_communes.csv", SOURCES.cassini), "utf8"));
const cassiniYears = Object.keys(cassiniRows[0])
  .filter((k) => /^pop_.*_val$/.test(k))
  .map((k) => k.slice(4, -4));
const cassini = new Map(); // 2025 code -> Map(year -> value)
const unmapped = new Map();
const succ = new Map();
for (const r of cassiniRows) {
  const c21 = r.commune_mars_2021;
  if (!c21) continue;
  if (!succ.has(c21)) succ.set(c21, successor(c21, moves, insee, "2021-03-01"));
  const code = succ.get(c21);
  if (!code) {
    unmapped.set(c21, (unmapped.get(c21) ?? 0) + (+r.pop_1999_val || 0));
    continue;
  }
  const m = cassini.get(code) ?? new Map();
  for (const k of cassiniYears) {
    if (r[`pop_${k}_info`] !== "pop" || r[`pop_${k}_val`] === "") continue;
    const y = CASSINI_YEARS[k] ?? +k;
    m.set(y, (m.get(y) ?? 0) + +r[`pop_${k}_val`]);
  }
  cassini.set(code, m);
}
console.log("Cassini communes", cassini.size, "unmapped 2021 codes", unmapped.size);

// ---- Outlines: area, label point and the 1 km grid ----
const geo = JSON.parse(await readFile(await fetchTo("communes-100m.geojson", SOURCES.contours), "utf8"));
const shapes = new Map();
for (const f of geo.features) {
  const code = f.properties.code;
  if (!insee.has(code)) continue;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  shapes.set(code, polys.map((rings) => rings.map((ring) => ring.map(([lon, lat]) => lambert93(lon, lat)))));
}
const missingShape = [...insee.keys()].filter((c) => !shapes.has(c));
if (missingShape.length) throw Error("no outline for " + missingShape.join(" "));

const CELL = 1000; // metres per grid cell
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const polys of shapes.values())
  for (const rings of polys)
    for (const [x, y] of rings[0]) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
const PAD = 40 * CELL;
x0 = Math.floor((x0 - PAD) / CELL) * CELL;
y1 = Math.ceil((y1 + PAD) / CELL) * CELL;
const W = Math.ceil((x1 + PAD - x0) / CELL),
  H = Math.ceil((y1 - (y0 - PAD)) / CELL);
const toGrid = ([x, y]) => [(x - x0) / CELL, (y1 - y) / CELL];

const codes = [...insee.keys()].sort();
const grid = new Uint16Array(W * H);
const communes = codes.map((code, i) => {
  const polys = shapes.get(code);
  let area = 0,
    best = 0,
    label = [0, 0];
  for (const rings of polys) {
    const a = polygonArea(rings);
    area += a;
    if (ringArea(rings[0]) > best) {
      best = ringArea(rings[0]);
      const r = rings[0];
      let sx = 0, sy = 0, s = 0;
      for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
        const w = r[j][0] * r[k][1] - r[k][0] * r[j][1];
        s += w;
        sx += (r[j][0] + r[k][0]) * w;
        sy += (r[j][1] + r[k][1]) * w;
      }
      label = toGrid([sx / (3 * s), sy / (3 * s)]);
    }
    paintPolygon(grid, W, H, rings.map((ring) => ring.map(toGrid)), i + 1);
  }
  const { name, dep } = insee.get(code);
  return { code, name, dep, area: area / 1e6, label };
});
// A commune too small for a cell of its own still gets the cell under its label.
let forced = 0;
const cells = new Uint32Array(codes.length + 1);
for (const v of grid) cells[v]++;
communes.forEach((c, i) => {
  if (cells[i + 1]) return;
  const [gx, gy] = c.label;
  grid[Math.round(gy - 0.5) * W + Math.round(gx - 0.5)] = i + 1;
  forced++;
});

// ---- Merge the two census series ----
const years = [...new Set([...inseeYears, ...[...cassini.values()].flatMap((m) => [...m.keys()])])].sort((a, b) => a - b);
const rows = codes.map((code) => {
  const a = insee.get(code).pop,
    b = cassini.get(code) ?? new Map();
  return years.map((y) => a.get(y) ?? b.get(y) ?? null);
});

// ---- Consistency: Cassini against INSEE where both count the same year ----
const qa = { compare: {}, unmapped: { codes: unmapped.size, pop1999: [...unmapped.values()].reduce((s, v) => s + v, 0) }, forcedCells: forced };
for (const y of [1876, 1911, 1936, 1962, 1999]) {
  let both = 0, exact = 0, close = 0, diff = 0, sum = 0;
  for (const code of codes) {
    const a = insee.get(code).pop.get(y),
      b = cassini.get(code)?.get(y);
    if (a == null || b == null) continue;
    both++;
    if (a === b) exact++;
    if (Math.abs(a - b) <= Math.max(5, 0.01 * a)) close++;
    diff += Math.abs(a - b);
    sum += a;
  }
  qa.compare[y] = { both, exact, close, relDiff: +(diff / sum).toFixed(5) };
}
const totals = years.map((y, j) => rows.reduce((s, r) => s + (r[j] ?? 0), 0));
const counted = years.map((y, j) => rows.reduce((s, r) => s + (r[j] != null), 0));
// Area-weighted density quantiles over every commune and census, for the scale.
const dens = [];
rows.forEach((r, i) => r.forEach((v) => v != null && dens.push([v / communes[i].area, communes[i].area])));
dens.sort((p, q) => p[0] - q[0]);
const total = dens.reduce((s, d) => s + d[1], 0);
const quantile = (t) => {
  let acc = 0;
  for (const [v, a] of dens) if ((acc += a) >= t * total) return +v.toFixed(2);
  return dens.at(-1)[0];
};
qa.density = { p01: quantile(0.01), p05: quantile(0.05), p25: quantile(0.25), p50: quantile(0.5), p75: quantile(0.75), p95: quantile(0.95), p99: quantile(0.99), p995: quantile(0.995), max: +dens.at(-1)[0].toFixed(1) };
qa.years = Object.fromEntries(years.map((y, j) => [y, { communes: counted[j], total: totals[j] }]));
qa.area = +communes.reduce((s, c) => s + c.area, 0).toFixed(1);
qa.cells = { land: cells.reduce((s, v, i) => s + (i ? v : 0), 0), total: W * H };

const meta = {
  built: new Date().toISOString().slice(0, 10),
  years,
  grid: { w: W, h: H, x0, y1, cell: CELL },
  deps,
  communes: communes.map((c) => [c.code, c.name, c.dep, +c.area.toFixed(3), +c.label[0].toFixed(1), +c.label[1].toFixed(1)]),
};
await writeFile(new URL("meta.json", out), JSON.stringify(meta));
await writeFile(new URL("pop.bin", out), popEncode(rows));
await writeFile(new URL("grid.bin", out), rleEncode(grid));
await writeFile(new URL("qa.json", out), JSON.stringify(qa, null, 1));
console.log(JSON.stringify({ communes: codes.length, years: years.length, grid: [W, H], ...qa.compare, density: qa.density, unmapped: qa.unmapped, forced }, null, 1));
