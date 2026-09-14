// Drives a headless Chrome through the DevTools protocol, no dependency:
// used by the end-to-end tests, the screenshots and the video recording.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function chromePath() {
  const c = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return c.find((p) => p && existsSync(p));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 800, port = 9333, headless = true, extra = [] } = {}) {
  const bin = chromePath();
  if (!bin) throw Error("Chrome not found; set CHROME=/path/to/chrome");
  const profile = mkdtempSync(path.join(tmpdir(), "relief-chrome-"));
  const proc = spawn(
    bin,
    [
      ...(headless ? ["--headless=new"] : []),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--use-angle=default",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--disable-gpu-vsync",
      ...extra,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let targets;
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    try {
      targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) throw Error("Chrome did not start");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    } else if (m.method) events.forEach((f) => f(m));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const me = ++id;
      waiting.set(me, (m) => (m.error ? rej(Error(m.error.message)) : res(m.result)));
      ws.send(JSON.stringify({ id: me, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  const logs = [];
  events.push((m) => {
    if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    send,
    evaluate,
    logs,
    on: (f) => events.push(f),
    goto: async (url) => {
      await send("Page.navigate", { url });
      for (let i = 0; i < 300; i++) {
        await sleep(100);
        if (await evaluate("!!window.__relief && window.__relief.frames() > 0").catch(() => false)) return;
      }
      throw Error("page did not become ready: " + logs.join("\n"));
    },
    screenshot: async () => Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"),
    close: async () => {
      ws.close();
      const gone = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await gone;
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
