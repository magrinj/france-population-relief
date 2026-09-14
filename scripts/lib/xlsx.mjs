// Reads the first sheet of an .xlsx as rows of cell values without any
// dependency: an xlsx is a zip, `unzip -p` extracts one member to stdout.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const member = async (file, name) =>
  (await run("unzip", ["-p", file, name], { maxBuffer: 1 << 30, encoding: "utf8" })).stdout;
const unescape = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function parseSheet(xml, shared) {
  const rows = [];
  for (const [, rowXml] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const m of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const inner = m[3] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (v === undefined) {
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        if (t !== undefined) row[col] = unescape(t);
        continue;
      }
      row[col] = /t="s"/.test(m[2]) ? shared[+v] : /t="(str|inlineStr)"/.test(m[2]) ? unescape(v) : +v;
    }
    rows.push(row);
  }
  return rows;
}
export function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) =>
    [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescape(t[1])).join(""),
  );
}
export async function readXlsx(file) {
  const shared = parseSharedStrings(await member(file, "xl/sharedStrings.xml").catch(() => ""));
  return parseSheet(await member(file, "xl/worksheets/sheet1.xml"), shared);
}
