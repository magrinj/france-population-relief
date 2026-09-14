import test from "node:test";
import assert from "node:assert/strict";
import { rleEncode, rleDecode, popEncode, popDecode } from "../src/codec.mjs";
import { seriesOf, heightOf, monotoneSlopes, hermiteAt } from "../src/series.mjs";

test("rle round-trips a grid, including long runs and single cells", () => {
  const g = new Uint16Array(70000);
  g.fill(7, 0, 66000);
  g[66000] = 1;
  g[66001] = 2;
  g.fill(65535, 66002);
  assert.deepEqual(rleDecode(rleEncode(g), g.length), g);
  assert.throws(() => rleDecode(rleEncode(g), g.length + 1));
});

test("population varints round-trip with gaps, big cities and zeros", () => {
  const rows = [
    [null, 12, 15, null, 2_200_000, 0],
    [0, 0, 0, 0, 0, 0],
    [null, null, null, null, null, null],
  ];
  const bytes = popEncode(rows);
  const back = popDecode(bytes, rows.length, 6);
  assert.deepEqual(
    Array.from(back),
    rows.flat().map((v) => (v == null ? -1 : v)),
  );
  // A small step costs one byte, a first big value three.
  assert.ok(bytes.length < 6 * 3 * 3);
});

test("monotone cubic keeps every census, never overshoots, stays flat outside", () => {
  const years = [1793, 1806, 1876, 1999];
  const pop = Int32Array.from([1000, -1, 4000, 2000]);
  const f = seriesOf(years, pop);
  assert.ok(Math.abs(f(1793) - 1000) < 1e-6);
  assert.ok(Math.abs(f(1876) - 4000) < 1e-6);
  assert.ok(Math.abs(f(1999) - 2000) < 1e-6);
  assert.ok(Math.abs(f(1700) - 1000) < 1e-6);
  assert.ok(Math.abs(f(2100) - 2000) < 1e-6);
  let last = 0;
  for (let t = 1793; t <= 1876; t += 0.5) {
    const v = f(t);
    assert.ok(v >= last - 1e-6 && v <= 4000 + 1e-6, `${t} ${v}`);
    last = v;
  }
  for (let t = 1876; t <= 1999; t += 0.5) {
    const v = f(t);
    assert.ok(v <= last + 1e-6 && v >= 2000 - 1e-6, `${t} ${v}`);
    last = v;
  }
  assert.equal(seriesOf([1, 2], Int32Array.from([-1, -1]))(1), -1);
});

test("hermite reproduces a straight line exactly", () => {
  const x = [0, 1, 3],
    y = [0, 2, 6];
  const m = monotoneSlopes(x, y);
  assert.ok(Math.abs(hermiteAt(x, y, m, 2) - 4) < 1e-12);
});

test("height is logarithmic in density and clamped", () => {
  assert.equal(heightOf(0, 10, 1000), 0);
  assert.equal(heightOf(5, 10, 1000), 0);
  assert.ok(Math.abs(heightOf(100, 10, 1000) - 0.5) < 1e-12);
  assert.equal(heightOf(1e9, 10, 1000), 1);
});
