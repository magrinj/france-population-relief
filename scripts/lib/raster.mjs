// Scanline rasteriser: paints polygons (rings of [x, y] in grid units) into
// a Uint16 grid with an id, even-odd rule so holes are respected. A cell is
// inside when its centre is. Also the planar area of a polygon.

export function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(s) / 2;
}
// Area of a GeoJSON Polygon (outer minus holes), same units² as the rings.
export function polygonArea(rings) {
  return rings.reduce((a, r, i) => a + (i ? -1 : 1) * ringArea(r), 0);
}

export function paintPolygon(grid, w, h, rings, id) {
  let y0 = Infinity,
    y1 = -Infinity;
  for (const r of rings) for (const [, y] of r) (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  const xs = [];
  for (let row = Math.max(0, Math.ceil(y0 - 0.5)); row < Math.min(h, y1 + 0.5); row++) {
    const cy = row + 0.5;
    xs.length = 0;
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xa, ya] = r[j],
          [xb, yb] = r[i];
        if (ya <= cy !== yb <= cy) xs.push(xa + ((cy - ya) * (xb - xa)) / (yb - ya));
      }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)),
        to = Math.min(w, Math.ceil(xs[k + 1] - 0.5));
      if (to > from) grid.fill(id, row * w + from, row * w + to);
    }
  }
}
