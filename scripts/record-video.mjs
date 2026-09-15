// Records the replay as frames for a video, through headless Chrome:
//   node scripts/record-video.mjs <url> <folder> [tilt 0-1] [turn 0-1] [speed] [zoom]
// then, in the folder:
//   ffmpeg -f concat -safe 0 -i frames.txt -vf "scale=1080:1080:flags=lanczos,format=yuv420p" -r 60 -c:v libx264 -crf 16 out.mp4
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/chrome.mjs";

const [url, outdir, tilt = "0.5", turn = "0", speed = "1.5", zoom = "1.06"] = process.argv.slice(2);
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Rendered at 2160 × 2160 and downscaled by ffmpeg: crisp names and contour lines.
const c = await launch({ width: 1080, height: 1080, extra: ["--force-device-scale-factor=2"] });
const sep = url.includes("?") ? "&" : "?";
await c.goto(`${url}${sep}record&tilt=${+tilt * 100}&turn=${+turn * 360}&speed=${speed}&zoom=${zoom}`);
await sleep(500);
const frames = [];
c.on(async (m) => {
  if (m.method !== "Page.screencastFrame") return;
  const i = frames.length;
  frames.push(m.params.metadata.timestamp);
  fs.writeFileSync(path.join(outdir, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(m.params.data, "base64"));
  await c.send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
});
await c.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: 2160, maxHeight: 2160, everyNthFrame: 1 });
await sleep(1000);
await c.evaluate("__relief.play()");
const t0 = Date.now();
while ((await c.evaluate("__relief.playing()")) && Date.now() - t0 < 120000) await sleep(500);
await sleep(1500);
await c.send("Page.stopScreencast");
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? frames[i + 1] - frames[i] : 1 / 60;
  lines.push(`file 'f${String(i).padStart(5, "0")}.jpg'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
}
if (frames.length) lines.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
fs.writeFileSync(path.join(outdir, "frames.txt"), lines.join("\n"));
const dur = frames.length > 1 ? frames.at(-1) - frames[0] : 0;
console.log(JSON.stringify({ frames: frames.length, seconds: +dur.toFixed(1), fps: +(frames.length / dur).toFixed(1) }));
await c.close();
