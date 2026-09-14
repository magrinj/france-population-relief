// Binary encodings shared by the data script (Node) and the page (browser).
// Everything is plain little-endian typed arrays: no dependency either side.

// Run-length encode a Uint16 grid as [value, count] pairs, counts up to 65535.
export function rleEncode(grid) {
  const out = [];
  for (let i = 0; i < grid.length; ) {
    const v = grid[i];
    let n = 1;
    while (i + n < grid.length && grid[i + n] === v && n < 65535) n++;
    out.push(v, n);
    i += n;
  }
  return Uint16Array.from(out);
}
export function rleDecode(pairs, length) {
  const grid = new Uint16Array(length);
  let i = 0;
  for (let p = 0; p < pairs.length; p += 2) {
    grid.fill(pairs[p], i, i + pairs[p + 1]);
    i += pairs[p + 1];
  }
  if (i !== length) throw Error(`rle length ${i} != ${length}`);
  return grid;
}

// Population matrix: rows of `cols` values, each either a non-negative integer
// or null (no census). A value is stored as a LEB128 varint of
// 1 + zigzag(value - previous value in the row), 0 marks a missing value.
const zig = (n) => (n << 1) ^ (n >> 31);
const unzig = (n) => (n >>> 1) ^ -(n & 1);
export function popEncode(rows) {
  const bytes = [];
  for (const row of rows) {
    let prev = 0;
    for (const v of row) {
      let n = v == null ? 0 : 1 + zig(v - prev);
      if (v != null) prev = v;
      while (n >= 0x80) {
        bytes.push((n & 0x7f) | 0x80);
        n >>>= 7;
      }
      bytes.push(n);
    }
  }
  return Uint8Array.from(bytes);
}
export function popDecode(bytes, nrows, cols) {
  const out = new Int32Array(nrows * cols); // -1 = missing
  let p = 0;
  for (let r = 0; r < nrows; r++) {
    let prev = 0;
    for (let c = 0; c < cols; c++) {
      let n = 0,
        shift = 0,
        b;
      do {
        b = bytes[p++];
        n |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      if (n === 0) out[r * cols + c] = -1;
      else out[r * cols + c] = prev = prev + unzig(n - 1);
    }
  }
  if (p !== bytes.length) throw Error(`pop bytes ${p} != ${bytes.length}`);
  return out;
}
