import test from "node:test";
import assert from "node:assert/strict";
import { lambert93 } from "../scripts/lib/lambert93.mjs";
import { paintPolygon, polygonArea } from "../scripts/lib/raster.mjs";
import { parseCsv } from "../scripts/lib/csv.mjs";
import { parseSheet, parseSharedStrings } from "../scripts/lib/xlsx.mjs";
import { successor } from "../scripts/lib/cog.mjs";

test("Lambert-93 matches IGN reference points to the metre", () => {
  // Reference: IGN test point (lon 3°, lat 46.5°) is the origin 700000, 6600000.
  const [x, y] = lambert93(3, 46.5);
  assert.ok(Math.abs(x - 700000) < 1 && Math.abs(y - 6600000) < 1, `${x} ${y}`);
  // Values from pyproj (PROJ 9, EPSG:2154) for Paris, Corsica and Brittany.
  for (const [lon, lat, X, Y] of [
    [2.3488, 48.853, 652216.26, 6861637.02],
    [9, 42, 1197656.7, 6118854.94],
    [-4.5, 48.4, 145709.79, 6837422.08],
  ]) {
    const [px, py] = lambert93(lon, lat);
    assert.ok(Math.abs(px - X) < 0.05 && Math.abs(py - Y) < 0.05, `${px} ${py}`);
  }
});

test("rasteriser fills by cell centre and respects holes", () => {
  const w = 8,
    h = 8,
    g = new Uint16Array(w * h);
  const outer = [[1, 1], [7, 1], [7, 7], [1, 7]];
  const hole = [[3, 3], [5, 3], [5, 5], [3, 5]];
  paintPolygon(g, w, h, [outer, hole], 9);
  let n = 0;
  for (const v of g) n += v === 9;
  assert.equal(n, 36 - 4);
  assert.equal(g[1 * w + 1], 9);
  assert.equal(g[3 * w + 3], 0);
  assert.equal(g[0], 0);
  assert.equal(polygonArea([outer, hole]), 32);
  // Clipped polygon does not write outside the grid.
  paintPolygon(g, w, h, [[[-5, -5], [3, -5], [3, 2], [-5, 2]]], 4);
  assert.equal(g[0], 4);
  assert.equal(g[2 * w + 2], 9);
});

test("csv parser handles quotes, embedded separators and CRLF", () => {
  const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n1,\r\n');
  assert.deepEqual(rows, [
    { a: "x, y", b: 'he said "hi"' },
    { a: "1", b: "" },
  ]);
});

test("xlsx sheet parser resolves shared strings and numbers", () => {
  const shared = parseSharedStrings("<sst><si><t>Code</t></si><si><r><t>Ab</t></r><r><t>c</t></r></si></sst>");
  const rows = parseSheet(
    '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>12</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="str"><v>x&amp;y</v></c></row></sheetData>',
    shared,
  );
  assert.deepEqual([...rows[0]], ["Code", undefined, 12]);
  assert.deepEqual(rows[1], ["Abc", "x&y"]);
});

test("commune successor follows chained mergers and stops at live codes", () => {
  const moves = [
    { MOD: "32", DATE_EFF: "2022-01-01", TYPECOM_AV: "COM", COM_AV: "01001", TYPECOM_AP: "COM", COM_AP: "01002" },
    { MOD: "32", DATE_EFF: "2024-01-01", TYPECOM_AV: "COM", COM_AV: "01002", TYPECOM_AP: "COM", COM_AP: "01003" },
    { MOD: "32", DATE_EFF: "2019-01-01", TYPECOM_AV: "COM", COM_AV: "01009", TYPECOM_AP: "COM", COM_AP: "01003" },
    { MOD: "10", DATE_EFF: "2023-01-01", TYPECOM_AV: "COM", COM_AV: "01005", TYPECOM_AP: "COM", COM_AP: "01005" },
  ];
  const live = new Set(["01003", "01005"]);
  assert.equal(successor("01001", moves, live, "2021-03-01"), "01003");
  assert.equal(successor("01003", moves, live, "2021-03-01"), "01003");
  assert.equal(successor("01005", moves, live, "2021-03-01"), "01005");
  assert.equal(successor("01009", moves, live, "2021-03-01"), null);
});
