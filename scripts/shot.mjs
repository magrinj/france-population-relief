// node scripts/shot.mjs <url> <out.png> [year] [tilt 0-1] [turn 0-1]
import { writeFileSync } from "node:fs";
import { launch } from "./lib/chrome.mjs";
const [url, out, year, tilt, turn] = process.argv.slice(2);
const c = await launch({ width: 1400, height: 900 });
try {
  await c.goto(url);
  if (year) await c.evaluate(`__relief.setYear(${year})`);
  if (tilt || turn) await c.evaluate(`__relief.setView(${tilt || 0}, ${turn || 0})`);
  await c.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  writeFileSync(out, await c.screenshot());
  console.log("saved", out, c.logs.join("\n"));
} finally {
  await c.close();
}
