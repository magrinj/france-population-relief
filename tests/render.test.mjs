// End-to-end: the page in a headless Chrome, the relief read back from the
// GPU. Checks that the mountains follow the data: a dense commune is high,
// an empty one is under water, the sea is flat, growth over time is visible,
// hovering finds the right commune. Skipped when Chrome is not installed.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromePath, launch } from "../scripts/lib/chrome.mjs";

const PORT = 5199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WATER = 0.2;

test("relief follows the census data end to end", { skip: chromePath() ? false : "Chrome not found" }, async (t) => {
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--logLevel", "error"], { stdio: "ignore" });
  const chrome = await launch({ width: 1280, height: 800 });
  t.after(async () => {
    vite.kill(); // first, so nothing keeps the runner alive if Chrome misbehaves
    await chrome.close();
  });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok).catch(() => false)) break;
    await sleep(200);
  }
  await chrome.goto(`http://localhost:${PORT}/?lang=fr`);
  const ev = (s) => chrome.evaluate(s);
  const settle = () => ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  const at = async (year) => {
    await ev(`__relief.setYear(${year})`);
    await settle();
  };
  const h = (code) => ev(`__relief.heightOf(${JSON.stringify(code)})`);
  mkdirSync(".cache/shots", { recursive: true });

  await t.test("bundled data: counts and national totals", async () => {
    const d = await ev("(({years, communes}) => ({years, n: communes.length}))(__relief.data)");
    assert.equal(d.n, 34746);
    assert.equal(d.years.length, 51);
    assert.equal(d.years[0], 1793);
    assert.equal(d.years.at(-1), 2023);
    // At a census the interpolated total is the census total (communes
    // without a figure keep their nearest census, hence a small margin).
    await at(2023);
    assert.ok(Math.abs((await ev("__relief.total()")) - 66165815) < 1000);
    await at(1876);
    assert.ok(Math.abs((await ev("__relief.total()")) - 38436260) < 2000);
    await at(1911);
    assert.ok(Math.abs((await ev("__relief.total()")) - 41436359) < 2000);
  });

  await t.test("interpolation is continuous between censuses", async () => {
    const totals = [];
    for (const y of [1900, 1900.25, 1900.5, 1900.75, 1901]) {
      await at(y);
      totals.push(await ev("__relief.total()"));
    }
    for (let i = 1; i < totals.length; i++) assert.ok(Math.abs(totals[i] - totals[i - 1]) < 300000, `${totals}`);
    assert.ok(totals[0] > 40.5e6 && totals[4] > totals[0]);
  });

  await t.test("2023: Paris is snow, the Lozère is under water, the sea is flat", async () => {
    await at(2023);
    const paris = await h("75056"),
      lyon = await h("69123"),
      bordeaux = await h("33063"),
      lozere = await h("48050"); // Le Chastel-Nouvel, ~30 people/km²... Nasbinals-like plateau
    assert.ok(paris > 0.9, `Paris ${paris}`);
    assert.ok(paris > lyon && lyon > bordeaux, `${paris} ${lyon} ${bordeaux}`);
    const own = await ev("__relief.heights[__relief.data.byCode.get('75056')]");
    assert.ok(Math.abs(paris - own) < 0.08, `field ${paris} vs commune ${own}`);
    assert.ok(lozere < WATER + 0.06, `Lozère ${lozere}`);
    // Atlantic, 200 km west of Brest: nothing there.
    const sea = await ev("__relief.relief.heightAt(60, 300)");
    assert.ok(sea < 0.02, `sea ${sea}`);
  });

  await t.test("mountains grow and shrink with the population", async () => {
    await at(1793);
    const t0 = { toulouse: await h("31555"), paris: await h("75056"), aubusson: await h("23008") };
    await at(1876);
    const t1 = { aubusson: await h("23008") };
    await at(2023);
    const t2 = { toulouse: await h("31555"), paris: await h("75056"), aubusson: await h("23008") };
    assert.ok(t2.toulouse > t0.toulouse + 0.1, `Toulouse ${t0.toulouse} -> ${t2.toulouse}`);
    assert.ok(t2.paris > t0.paris + 0.05, `Paris ${t0.paris} -> ${t2.paris}`);
    assert.ok(t2.aubusson < t1.aubusson - 0.03, `Aubusson ${t1.aubusson} -> ${t2.aubusson}`);
  });

  await t.test("picking under a city label finds that commune, tilted and turned", async () => {
    await at(1962);
    await ev("__relief.setView(0.5, 0.1)");
    await settle();
    for (const code of ["75056", "13055", "2A004"]) {
      const p = await ev(`__relief.project(${JSON.stringify(code)})`);
      const i = await ev(`__relief.pick(${p.x}, ${p.y})`);
      const got = await ev(`__relief.data.communes[${i}]?.code`);
      assert.equal(got, code);
    }
    writeFileSync(".cache/shots/test-1962.png", await chrome.screenshot());
  });

  await t.test("zooming on a département keeps picking and labels consistent", async () => {
    await ev("__relief.zoomDep('33')");
    // The zoom animates over frames; a slow software renderer needs time.
    for (let k = 0; k < 40 && (await ev("__relief.zoom()")) < 2; k++) await sleep(200);
    await settle();
    assert.ok((await ev("__relief.zoom()")) > 2);
    const p = await ev("__relief.project('33063')");
    const i = await ev(`__relief.pick(${p.x}, ${p.y})`);
    assert.equal(await ev(`__relief.data.communes[${i}]?.dep`), await ev("__relief.data.deps.findIndex(d => d.code === '33')"));
    writeFileSync(".cache/shots/test-zoom.png", await chrome.screenshot());
    await ev("__relief.zoomReset()");
    await settle();
    assert.equal(await ev("__relief.zoom()"), 1);
  });

  await t.test("no exception in the console", () => {
    assert.deepEqual(chrome.logs.filter((l) => l.startsWith("EXCEPTION")), []);
  });
});
