// Everything that is not the relief: controls, year sign, period feed,
// legend, city names, located events and the tooltip. Plain DOM, one
// overlay canvas.
import type { fr } from "./i18n.ts";
import { censusesAround, type Data } from "./data.ts";
import type { Relief } from "./relief.ts";
import { HYPSO, NBAND, WATER_BANDS, densityAt } from "./scale.ts";

type T = typeof fr;
const $ = <E extends HTMLElement>(sel: string) => document.querySelector(sel) as E;
const html = String.raw;
// Names come from INSEE files; escaped anyway before they meet innerHTML.
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const locale = (lang: string) => (lang === "fr" ? "fr-FR" : "en-GB");

export function buildDom(t: T, record: boolean) {
  document.body.innerHTML = html`
    <main class="${record ? "record" : ""}">
      <canvas id="map"></canvas>
      <canvas id="labels"></canvas>
      <div id="tip" class="tip" hidden></div>
      <header>
        <h1>${t.title}</h1>
        <p class="sub">${t.subtitle}</p>
        <p class="span">${t.span}</p>
        <a class="lang" id="lang" href="#">${t.otherLang}</a>
      </header>
      <div class="sign"><b id="year">–</b><span id="total"></span><span id="growth" class="growth"></span></div>
      <aside class="feed" id="feed"></aside>
      <div class="view">
        <label><span>${t.tilt}</span><input type="range" id="tilt" min="0" max="100" value="35" /></label>
        <label><span>${t.turn}</span><input type="range" id="turn" min="0" max="360" value="0" /></label>
        <button id="names" aria-pressed="true">${t.names}</button>
        <div class="zoom" role="group" aria-label="Zoom">
          <button id="zin" aria-label="${t.zoomIn}" title="${t.zoomIn} (+)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
          <button id="zout" aria-label="${t.zoomOut}" title="${t.zoomOut} (−)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
          <button id="zreset" aria-label="${t.zoomReset}" title="${t.zoomReset} (Esc)" disabled><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>
      <footer>
        <div class="legend">
          <div class="ramp" id="ramp"></div>
          <div class="ticks" id="ticks"></div>
          <p class="small">${t.legend}</p>
          <p class="small sources">${t.sources.replace("GitHub", '<a href="https://github.com/magrinj/france-population-relief">GitHub</a>')}</p>
        </div>
        <div class="player">
          <button id="play" aria-label="${t.play}"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path id="playIcon" d="M4 2.5v13l11-6.5z" fill="currentColor"/></svg></button>
          <div class="track">
            <input type="range" id="time" min="1793" max="2023" step="0.01" value="1793" aria-label="${t.year}" />
            <div class="marks" id="marks"></div>
          </div>
          <div class="speeds">
            <button data-s="1" aria-pressed="true">1×</button><button data-s="2">2×</button><button data-s="4">4×</button>
          </div>
        </div>
      </footer>
      <div class="loading" id="loading">${t.loading}</div>
    </main>`;
}

export function setPlayIcon(playing: boolean) {
  $("#playIcon").setAttribute("d", playing ? "M3.5 2.5h4v13h-4zM10.5 2.5h4v13h-4z" : "M4 2.5v13l11-6.5z");
}

export function legend(t: T, lang: string) {
  const compact = new Intl.NumberFormat(locale(lang), { notation: "compact" });
  $("#ramp").style.background = `linear-gradient(to right, ${HYPSO.map((c, i) => `${c} ${(i / NBAND) * 100}% ${((i + 1) / NBAND) * 100}%`).join(",")})`;
  const ticks = $("#ticks");
  for (const [band, label] of [
    [WATER_BANDS, 40],
    [10, Math.round(densityAt(10 / NBAND) / 10) * 10],
    [15, Math.round(densityAt(15 / NBAND) / 100) * 100],
    [20, Math.round(densityAt(20 / NBAND) / 1000) * 1000],
    [23, Math.round(densityAt(23 / NBAND) / 1000) * 1000],
  ] as [number, number][]) {
    const s = document.createElement("span");
    s.style.left = `${(band / NBAND) * 100}%`;
    s.textContent = compact.format(label);
    ticks.append(s);
  }
  ticks.insertAdjacentHTML("beforeend", `<em class="l">${t.less}</em><em class="r">${t.more} (${t.perKm})</em>`);
}

export function marks(years: number[]) {
  const m = $("#marks");
  for (const y of years) {
    const s = document.createElement("i");
    s.style.left = `${((y - 1793) / 230) * 100}%`;
    m.append(s);
  }
}

export function sign(t: T, lang: string, year: number, total: number, total1793: number) {
  const L = locale(lang);
  $("#year").textContent = String(Math.floor(year));
  $("#total").textContent = `${(total / 1e6).toLocaleString(L, { maximumFractionDigits: 1 })} M · ${t.metro}`;
  $("#growth").textContent = `×${(total / total1793).toLocaleString(L, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${t.since1793}`;
}

export function feed(t: T, year: number) {
  const el = $("#feed");
  const started = t.periods.filter((p) => p.from <= year);
  if (el.dataset.n !== String(started.length)) {
    el.dataset.n = String(started.length);
    el.innerHTML = started.map((p) => html`<section><h2><span>${p.from}–${p.to}</span> ${esc(p.title)}</h2><p>${esc(p.text)}</p></section>`).join("");
    el.querySelectorAll("section").forEach((s, i) => s.classList.toggle("now", i === started.length - 1));
    el.scrollTop = el.scrollHeight;
  }
}

// City names: the biggest communes of the moment, never two overlapping,
// plus the events of the current period, pulsing where they happened.
export function drawOverlay(
  relief: Relief,
  data: Data,
  t: T,
  pops: Float32Array,
  names: boolean,
  events: { period: number; since: number } | null,
  year: number,
  now: number,
  canvas: HTMLCanvasElement,
  zoom = 1,
) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight,
    dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr)) (canvas.width = Math.round(w * dpr)), (canvas.height = Math.round(h * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // Panels are no-go zones for names, so a zoomed map does not write over them.
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("header, .sign, .feed, .view, .legend, .player")) {
    if (!el.offsetParent) continue;
    const r = el.getBoundingClientRect(),
      c = canvas.getBoundingClientRect();
    placed.push({ x0: r.left - c.left - 6, y0: r.top - c.top - 6, x1: r.right - c.left + 6, y1: r.bottom - c.top + 6 });
  }
  const p = { x: 0, y: 0, z: 0 };
  const font = (size: number, weight = 600) => `${weight} ${size}px "DM Sans Variable", system-ui, sans-serif`;
  const label = (x: number, y: number, text: string, size: number, color: string) => {
    ctx.font = font(size);
    const tw = ctx.measureText(text).width;
    const left = x + 8 + tw > w - 8; // would run off the right edge: write it leftwards
    const box = left
      ? { x0: x - 8 - tw, y0: y - size * 0.7 - 3, x1: x + 6, y1: y + size * 0.7 + 3 }
      : { x0: x - 6, y0: y - size * 0.7 - 3, x1: x + 8 + tw, y1: y + size * 0.7 + 3 };
    if (placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) return false;
    placed.push(box);
    ctx.textAlign = left ? "right" : "left";
    const tx = left ? x - 5 : x + 5;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(4,8,16,.8)";
    ctx.strokeText(text, tx, y);
    ctx.fillStyle = color;
    ctx.fillText(text, tx, y);
    ctx.textAlign = "left";
    return true;
  };

  // Events first: they own their spot.
  const period = events ? t.periods[events.period] : null;
  // The frame timestamp can precede the moment the period was noticed.
  const age = events ? Math.max(0, now - events.since) : 0;
  const alive = period ? Math.max(0, Math.min(1, (5500 - age) / 1200)) : 0;
  if (period && alive > 0) {
    ctx.textAlign = "left";
    for (const ev of period.places) {
      const c = data.communes[data.byCode.get(ev.code)!];
      relief.project(c.gx, c.gy, p);
      const pulse = (age / 900) % 1;
      ctx.globalAlpha = alive * (1 - pulse);
      ctx.strokeStyle = "#f2c14e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + pulse * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alive;
      ctx.fillStyle = "#f2c14e";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      label(p.x + 4, p.y - 14, ev.label, w < 640 ? 11 : 13, "#f7d77a");
      ctx.globalAlpha = 1;
    }
  }
  if (!names) return;
  const cands = data.candidates.filter((i) => pops[i] > 0).sort((a, b) => pops[b] - pops[a]);
  const max = Math.round((w < 640 ? 10 : 22) * Math.min(3, zoom));
  let n = 0;
  ctx.textAlign = "left";
  for (const i of cands) {
    if (n >= max) break;
    const c = data.communes[i];
    relief.project(c.gx, c.gy, p);
    if (p.x < 10 || p.y < 10 || p.x > w - 10 || p.y > h - 10) continue;
    const size = Math.min(15, Math.max(9, 7 + Math.log10(pops[i]) * 1.4));
    if (!label(p.x, p.y, c.name, size, "#fff")) continue;
    n++;
    ctx.fillStyle = "#ff5d4a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  void year;
}

// The hovered département with its commune: population now, density, share
// of the country, growth since 1793 and the whole series.
export function tooltip(t: T, lang: string, data: Data, i: number, year: number, pops: Float32Array, depPops: Float64Array, total: number, x: number, y: number, zoomedDep = -1) {
  const tip = $("#tip");
  if (i < 0) {
    tip.hidden = true;
    return;
  }
  const L = locale(lang),
    n = new Intl.NumberFormat(L);
  const c = data.communes[i],
    d = data.deps[c.dep],
    dp = depPops[c.dep],
    pop = pops[i];
  const [a, b] = censusesAround(data.years, year);
  const row = data.pop.subarray(i * data.years.length, (i + 1) * data.years.length);
  const near = [a, b]
    .filter((j) => j >= 0 && row[j] >= 0)
    .map((j) => `${data.years[j]}: ${n.format(row[j])}`)
    .join(" · ");
  if (zoomedDep === c.dep) {
    // Zoomed inside the département: the commune is the unit.
    let first = -1;
    for (let j = 0; j < data.years.length && first < 0; j++) if (row[j] > 0) first = row[j];
    tip.innerHTML = html`
      <div class="dep"><b>${esc(c.name)}</b> <span class="code">${esc(d.code)} · ${esc(d.name)}</span></div>
      <div class="big">${pop >= 0 ? n.format(Math.round(pop)) : "–"} <small>${t.inhabitants}</small></div>
      <div class="row">
        <span>${pop >= 0 ? n.format(Math.round(pop / c.area)) : "–"} ${t.perKm}</span>
        <span>${n.format(Math.round(c.area))} km²</span>
        ${first > 0 && pop > 0 ? html`<span>×${(pop / first).toLocaleString(L, { maximumFractionDigits: 1 })} ${t.since1793}</span>` : ""}
      </div>
      <canvas class="spark" width="240" height="46"></canvas>
      <div class="small">${near || t.noCensus}</div>
      <div class="commune"><b>${esc(d.name)}</b> · ${n.format(Math.round(dp))} ${t.inhabitants} · ${n.format(Math.round(dp / d.area))} ${t.perKm}</div>
      <div class="hint">${t.clickToReset}</div>`;
    spark(tip.querySelector("canvas")!, data.years, Array.from(row, (v) => Math.max(0, v)), year);
    tip.hidden = false;
    tip.style.left = `${Math.min(x + 18, innerWidth - tip.offsetWidth - 12)}px`;
    tip.style.top = `${Math.min(y + 18, innerHeight - tip.offsetHeight - 12)}px`;
    return;
  }
  tip.innerHTML = html`
    <div class="dep"><b>${esc(d.name)}</b> <span class="code">${esc(d.code)}</span></div>
    <div class="big">${n.format(Math.round(dp))} <small>${t.inhabitants}</small></div>
    <div class="row">
      <span>${n.format(Math.round(dp / d.area))} ${t.perKm}</span>
      <span>${((100 * dp) / total).toLocaleString(L, { maximumFractionDigits: 1 })} % ${t.ofFrance}</span>
      <span>×${(dp / d.series[0]).toLocaleString(L, { maximumFractionDigits: 1 })} ${t.since1793}</span>
    </div>
    <canvas class="spark" width="240" height="46"></canvas>
    <div class="commune"><b>${esc(c.name)}</b> · ${pop >= 0 ? n.format(Math.round(pop)) : "–"} ${t.inhabitants} · ${pop >= 0 ? n.format(Math.round(pop / c.area)) : "–"} ${t.perKm}</div>
    <div class="small">${near || t.noCensus}</div>
    <div class="hint">${zoomedDep === c.dep ? t.clickToReset : t.clickToZoom}</div>`;
  spark(tip.querySelector("canvas")!, data.years, d.series, year);
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 18, innerWidth - tip.offsetWidth - 12)}px`;
  tip.style.top = `${Math.min(y + 18, innerHeight - tip.offsetHeight - 12)}px`;
}

function spark(cv: HTMLCanvasElement, years: number[], row: ArrayLike<number>, year: number) {
  const ctx = cv.getContext("2d")!,
    w = cv.width,
    h = cv.height;
  let max = 1;
  for (let j = 0; j < row.length; j++) max = Math.max(max, row[j]);
  const X = (y: number) => ((y - 1793) / 230) * (w - 4) + 2;
  const Y = (v: number) => h - 3 - (v / max) * (h - 10);
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(X(years[0]), h);
  years.forEach((y, j) => ctx.lineTo(X(y), Y(row[j])));
  ctx.lineTo(X(years.at(-1)!), h);
  ctx.fillStyle = "rgba(242,193,78,.18)";
  ctx.fill();
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  years.forEach((y, j) => (j ? ctx.lineTo(X(y), Y(row[j])) : ctx.moveTo(X(y), Y(row[j]))));
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(year), 0);
  ctx.lineTo(X(year), h);
  ctx.stroke();
}

export function $el<E extends HTMLElement>(sel: string) {
  return $<E>(sel);
}
