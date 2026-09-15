import "@fontsource-variable/dm-sans";
import "./style.css";
import { pickLang } from "./i18n.ts";
import { loadData, sampleYear } from "./data.ts";
import { Relief } from "./relief.ts";
import { buildDom, legend, marks, sign, feed, drawOverlay, tooltip, setPlayIcon, $el } from "./ui.ts";

const { t, lang } = pickLang();
document.documentElement.lang = lang;
const q = new URLSearchParams(location.search);
const RECORD = q.has("record");
buildDom(t, RECORD);
legend(t, lang);
$el<HTMLAnchorElement>("#lang").onclick = (e) => {
  e.preventDefault();
  const u = new URL(location.href);
  u.searchParams.set("lang", lang === "fr" ? "en" : "fr");
  location.href = u.toString();
};

const Y0 = 1793,
  Y1 = 2023;
const YEARS_PER_SEC = 6;

async function start() {
  const data = await loadData();
  const map = $el<HTMLCanvasElement>("#map");
  const relief = new Relief(map, data);
  marks(data.years);
  const heights = new Float32Array(data.communes.length),
    dens = new Float32Array(data.communes.length),
    pops = new Float32Array(data.communes.length),
    depPops = new Float64Array(data.deps.length);

  // URL presets: numbers only, clamped; anything else falls back.
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && q.get(k) !== null ? Math.min(hi, Math.max(lo, v)) : d;
  };
  let year = num("year", Y0, Y0, Y1),
    speed = [1, 2, 4].includes(num("speed", 1, 1, 4)) ? num("speed", 1, 1, 4) : 1,
    playing = false,
    names = true,
    total = 0,
    hover = -1,
    last = performance.now(),
    pointer: { x: number; y: number } | null = null,
    events: { period: number; since: number } | null = null,
    zoomedDep = -1,
    anim: { from: [number, number, number]; to: [number, number, number]; t0: number } | null = null,
    dirty = true; // something to draw
  const time = $el<HTMLInputElement>("#time"),
    play = $el<HTMLButtonElement>("#play"),
    tilt = $el<HTMLInputElement>("#tilt"),
    turn = $el<HTMLInputElement>("#turn"),
    labels = $el<HTMLCanvasElement>("#labels");
  tilt.value = String(num("tilt", 35, 0, 100));
  turn.value = String(num("turn", 0, 0, 360));

  const setYear = (y: number) => {
    year = Math.min(Y1, Math.max(Y0, y));
    total = sampleYear(data, year, heights, pops, depPops, dens);
    relief.setValues(dens);
    time.value = String(year);
    sign(t, lang, year, total, data.total1793);
    feed(t, year);
    // A period that just started shows its places for a few seconds.
    let period = -1;
    t.periods.forEach((p, i) => p.from <= year && (period = i));
    if (period !== (events?.period ?? -1)) events = { period, since: performance.now() };
    dirty = true;
  };
  const setPlaying = (on: boolean) => {
    playing = on;
    setPlayIcon(on);
    play.setAttribute("aria-label", on ? t.pause : t.play);
  };
  const view = () => {
    relief.setView(+tilt.value / 100, +turn.value / 360);
    dirty = true;
  };
  // Zoom: animated towards a factor and a grid point, 1 = the whole map.
  const cur = (): [number, number, number] => [relief.zoom, relief.target.x + data.W / 2, data.H / 2 - relief.target.y];
  const zoomTo = (zoom: number, gx: number, gy: number, instant = false) => {
    if (instant) (relief.setZoom(zoom, gx, gy), (anim = null));
    else anim = { from: cur(), to: [Math.min(12, Math.max(1, zoom)), gx, gy], t0: performance.now() };
    dirty = true;
  };
  const zoomDep = (d: number) => {
    const [x0, y0, x1, y1] = data.deps[d].box;
    zoomedDep = d;
    zoomTo(0.8 * Math.min(data.W / (x1 - x0), data.H / (y1 - y0)), (x0 + x1) / 2, (y0 + y1) / 2);
  };
  const zoomReset = () => ((zoomedDep = -1), zoomTo(1, data.W / 2, data.H / 2));
  // Zoom by a factor keeping the ground point under the pointer in place.
  const zoomBy = (f: number, px?: number, py?: number) => {
    const [z, tx, ty] = anim ? anim.to : cur();
    const nz = Math.min(12, Math.max(1, z * f));
    const g = px !== undefined ? relief.groundAt(px, py!) : null;
    const k = 1 - z / nz;
    zoomedDep = -1;
    if (g) zoomTo(nz, tx + (g[0] - tx) * k, ty + (g[1] - ty) * k);
    else zoomTo(nz, tx, ty);
  };

  play.onclick = () => {
    if (!playing && year >= Y1 - 0.01) setYear(Y0);
    setPlaying(!playing);
  };
  time.oninput = () => {
    setPlaying(false);
    setYear(+time.value);
  };
  tilt.oninput = turn.oninput = view;
  $el("#names").onclick = (e) => {
    names = !names;
    (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(names));
    dirty = true;
  };
  document.querySelectorAll<HTMLButtonElement>(".speeds button").forEach((b) => {
    b.setAttribute("aria-pressed", String(+b.dataset.s! === speed));
    b.onclick = () => {
      speed = +b.dataset.s!;
      document.querySelectorAll(".speeds button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    };
  });
  $el("#zin").onclick = () => zoomBy(1.6);
  $el("#zout").onclick = () => zoomBy(1 / 1.6);
  $el("#zreset").onclick = zoomReset;
  map.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = map.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  addEventListener("keydown", (e) => {
    if (e.code === "Escape") zoomReset();
    if ((e.key === "+" || e.key === "=") && !(e.target instanceof HTMLInputElement)) zoomBy(1.6);
    if (e.key === "-" && !(e.target instanceof HTMLInputElement)) zoomBy(1 / 1.6);
    if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) (e.preventDefault(), play.click());
    if (e.code === "ArrowRight") setYear(year + (e.shiftKey ? 10 : 1));
    if (e.code === "ArrowLeft") setYear(year - (e.shiftKey ? 10 : 1));
  });
  map.addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }));
  map.addEventListener("pointerleave", () => (pointer = null));
  addEventListener("resize", () => (relief.resize(), (dirty = true)));
  // Drag on the map turns it; a vertical drag tilts it. A click without a
  // drag zooms on the département under it, or back out.
  let drag: { x: number; y: number; tilt: number; turn: number; moved: boolean } | null = null;
  map.addEventListener("pointerdown", (e) => (drag = { x: e.clientX, y: e.clientY, tilt: +tilt.value, turn: +turn.value, moved: false }));
  addEventListener("pointerup", (e) => {
    if (drag && !drag.moved && e.target === map) {
      const r = map.getBoundingClientRect();
      const i = relief.pick(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0 && data.depOf[i] !== zoomedDep) zoomDep(data.depOf[i]);
      else zoomReset();
      tipKey = "";
    }
    drag = null;
  });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    turn.value = String((((drag.turn + (e.clientX - drag.x) * 0.5) % 360) + 360) % 360);
    tilt.value = String(Math.min(100, Math.max(0, drag.tilt + (e.clientY - drag.y) * 0.3)));
    view();
  });

  let lastPick = 0,
    tipKey = "";
  view();
  setYear(year);
  if (q.has("zoom")) zoomTo(num("zoom", 1, 1, 12), data.W / 2, data.H / 2, true);
  $el("#loading").remove();
  const frameMs: number[] = [];
  const loop = (now: number) => {
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (anim) {
      const u = Math.min(1, (now - anim.t0) / 550),
        e = 1 - Math.pow(1 - u, 3);
      const z = anim.from[0] * Math.pow(anim.to[0] / anim.from[0], e);
      relief.setZoom(z, anim.from[1] + (anim.to[1] - anim.from[1]) * e, anim.from[2] + (anim.to[2] - anim.from[2]) * e);
      if (u >= 1) anim = null;
      dirty = true;
    }
    if (playing) {
      setYear(year + dt * YEARS_PER_SEC * speed);
      if (year >= Y1) setPlaying(false);
    }
    if (pointer && !drag && now - lastPick > 50) {
      lastPick = now;
      const r = map.getBoundingClientRect();
      const i = relief.pick(pointer.x - r.left, pointer.y - r.top);
      const communeMode = i >= 0 && data.depOf[i] === zoomedDep;
      if (i !== hover || communeMode !== relief.communeMode) (relief.setHover((hover = i), communeMode), (dirty = true));
      const key = `${hover}|${Math.floor(year)}|${zoomedDep}`;
      if (key !== tipKey) {
        tipKey = key;
        tooltip(t, lang, data, hover, year, pops, depPops, total, pointer.x, pointer.y, zoomedDep);
      }
    } else if (!pointer && hover >= 0) {
      relief.setHover((hover = -1));
      tipKey = "";
      tooltip(t, lang, data, -1, year, pops, depPops, total, 0, 0);
      dirty = true;
    }
    const eventsAlive = events && now - events.since < 5500;
    if (dirty || eventsAlive) {
      if (dirty) relief.render();
      $el<HTMLButtonElement>("#zreset").disabled = relief.zoom <= 1.001;
      drawOverlay(relief, data, t, pops, names, events, year, now, labels, relief.zoom);
      dirty = false;
    }
    frameMs.push(performance.now() - t0);
    if (frameMs.length > 600) frameMs.shift();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Exposed for the end-to-end tests and the recording script.
  (window as any).__relief = {
    data,
    relief,
    setYear,
    getYear: () => year,
    total: () => total,
    setView: (a: number, b: number) => ((tilt.value = String(a * 100)), (turn.value = String(b * 360)), view()),
    zoomDep: (code: string) => zoomDep(data.deps.findIndex((d) => d.code === code)),
    zoomTo: (z: number, gx: number, gy: number) => zoomTo(z, gx, gy, true),
    zoomReset: () => (zoomReset(), (anim = null), relief.setZoom(1, data.W / 2, data.H / 2)),
    zoom: () => relief.zoom,
    play: () => play.click(),
    playing: () => playing,
    setSpeed: (s: number) => (speed = s),
    pops,
    heights,
    depPops,
    heightOf: (code: string) => {
      const c = data.communes[data.byCode.get(code)!];
      return relief.heightAt(c.gx, c.gy);
    },
    project: (code: string) => {
      const c = data.communes[data.byCode.get(code)!];
      return relief.project(c.gx, c.gy);
    },
    pick: (x: number, y: number) => relief.pick(x, y),
    frames: () => relief.frames,
    stats: () => ({ avg: frameMs.reduce((a, b) => a + b, 0) / frameMs.length, max: Math.max(...frameMs), over16: frameMs.filter((m) => m > 16).length, n: frameMs.length }),
  };
}
start().catch((e) => {
  console.error(e);
  $el("#loading").textContent = t.loadError;
});
