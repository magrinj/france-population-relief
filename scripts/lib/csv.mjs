// Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. Returns rows
// as objects keyed by the header line.
export function parseCsv(text, sep = ",") {
  const rows = [];
  let row = [],
    field = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows;
  return body
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}
