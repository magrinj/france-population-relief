// The relief: a GPU height field from the commune grid, blurred at two
// scales, drawn as a lit terrain that can be tilted and turned.
//
//  values (one float per commune)
//    └─ raw pass: every 1 km cell takes the value of its commune (R), land 1/0 (G)
//        ├─ fine blur, full resolution: the single commune as a hill
//        └─ coarse blur, quarter resolution: the landscape underneath
//    └─ combine: normalised convolution (so coasts are not eroded), sea depth
//        from the softened land mask, one texture read by the terrain mesh.
import * as THREE from "three";
import { HYPSO, LO, HI, NBAND, WATER } from "./scale.ts";
import type { Data } from "./data.ts";

const FINE_R = 6; // cells: two passes give a 12 km kernel; a city spreads its people that far
const COARSE_R = 9; // cells at quarter resolution, so ≈ 36 km
const TILT_MAX = (62 * Math.PI) / 180;
const Z_SCALE = 0.16; // full-scale value rises this fraction of the map height

const quadVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const rawFrag = `
uniform sampler2D idx; uniform sampler2D vals; uniform vec2 valsSize; varying vec2 vUv;
void main(){
  vec4 c = texture2D(idx, vec2(vUv.x, 1.0 - vUv.y));
  float id = floor(c.r * 255.0 + 0.5) + 256.0 * floor(c.g * 255.0 + 0.5);
  if (id < 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float k = id - 1.0;
  vec2 vuv = (vec2(mod(k, valsSize.x), floor(k / valsSize.x)) + 0.5) / valsSize;
  gl_FragColor = vec4(texture2D(vals, vuv).r, 1.0, 0.0, 1.0);
}`;
const blurFrag = (r: number) => `
uniform sampler2D src; uniform vec2 dir; varying vec2 vUv;
void main(){
  vec4 s = vec4(0.0);
  for (int i = -${r}; i <= ${r}; i++) s += texture2D(src, vUv + dir * float(i));
  gl_FragColor = s / ${(2 * r + 1).toFixed(1)};
}`;
const combineFrag = `
uniform sampler2D fine; uniform sampler2D coarse; uniform sampler2D raw; uniform float logLo; uniform float invSpan; varying vec2 vUv;
void main(){
  vec4 f = texture2D(fine, vUv), c = texture2D(coarse, vUv);
  float land = texture2D(raw, vUv).g;
  // Densities were blurred linearly, so the people are conserved and a
  // city becomes a broad mountain; only now the logarithmic ladder.
  float df = f.r / max(f.g, 1e-4), dc = c.r / max(c.g, 1e-4);
  float d = max(mix(dc, df, 0.85) + 0.13 * (df - dc), 0.0);
  float h = clamp((log(d + 1e-3) - logLo) * invSpan, 0.0, 1.0);
  // At sea the depth follows the softened coast: shallow next to land.
  float sea = ${WATER.toFixed(4)} * 0.85 * smoothstep(0.0, 1.0, c.g);
  // The coast is a few km of slope, not a vertical wall.
  gl_FragColor = vec4(mix(sea, max(h, 0.0), smoothstep(0.25, 0.75, f.g)), land, c.g, 1.0);
}`;
const terrainVert = `
uniform sampler2D height; uniform float zscale; varying vec2 vUv;
void main(){
  vUv = uv;
  float h = texture2D(height, uv).r;
  vec3 p = vec3(position.xy, max(h - ${WATER.toFixed(4)}, 0.0) * zscale);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const terrainFrag = `
uniform sampler2D height; uniform sampler2D idx; uniform sampler2D ramp; uniform vec2 texel;
uniform sampler2D depOf; uniform vec2 valsSize;
uniform float zscale; uniform float hover; uniform float hoverDep; uniform float edge; uniform float communeMode; uniform vec3 light; varying vec2 vUv;
float id(vec2 uv){ vec4 c = texture2D(idx, vec2(uv.x, 1.0 - uv.y)); return floor(c.r * 255.0 + 0.5) + 256.0 * floor(c.g * 255.0 + 0.5); }
// Département of the commune under uv, 0 at sea.
float dep(vec2 uv){
  float k = id(uv) - 1.0;
  if (k < 0.0) return 0.0;
  vec2 vuv = (vec2(mod(k, valsSize.x), floor(k / valsSize.x)) + 0.5) / valsSize;
  return floor(texture2D(depOf, vuv).r * 255.0 + 0.5) + 1.0;
}
void main(){
  vec4 t = texture2D(height, vUv);
  float h = t.r;
  if (t.b < 0.004) discard;
  float land = step(${WATER.toFixed(4)}, h);
  float hx = (texture2D(height, vUv + vec2(texel.x, 0.0)).r - texture2D(height, vUv - vec2(texel.x, 0.0)).r) * 0.5;
  float hy = (texture2D(height, vUv + vec2(0.0, texel.y)).r - texture2D(height, vUv - vec2(0.0, texel.y)).r) * 0.5;
  vec3 n = normalize(vec3(-hx * zscale * land, -hy * zscale * land, 1.0));
  float diff = max(dot(n, light), 0.0);
  vec3 col = texture2D(ramp, vec2(h, 0.5)).rgb;
  col *= 0.36 + 0.82 * diff;
  // Open sea fades into the night around the plate.
  col *= mix(0.15, 1.0, smoothstep(0.004, 0.25, t.b));
  // Contour line on every band edge, thinner where the slope is gentle.
  float b = h * ${NBAND.toFixed(1)};
  float f = min(fract(b), 1.0 - fract(b));
  float w = fwidth(b);
  float line = (1.0 - smoothstep(0.0, w * 1.4, f)) * land * min(1.0, w * 6.0);
  col *= 1.0 - 0.28 * line;
  if (hoverDep >= 0.5 && communeMode > 0.5) {
    // Zoomed inside the département: the commune under the pointer is the unit.
    vec2 e = texel * edge;
    if (id(vUv) == hover) {
      float b = float(id(vUv + vec2(e.x, 0.0)) != hover) + float(id(vUv - vec2(e.x, 0.0)) != hover)
              + float(id(vUv + vec2(0.0, e.y)) != hover) + float(id(vUv - vec2(0.0, e.y)) != hover);
      col = mix(col, vec3(1.0), 0.18);
      col = mix(col, vec3(1.0), min(b, 1.0) * 0.9);
    }
  } else if (hoverDep >= 0.5) {
    float me = dep(vUv);
    if (me == hoverDep) {
      vec2 e = texel * edge; // thinner outline when zoomed in
      float edge = float(dep(vUv + vec2(e.x, 0.0)) != hoverDep) + float(dep(vUv - vec2(e.x, 0.0)) != hoverDep)
                 + float(dep(vUv + vec2(0.0, e.y)) != hoverDep) + float(dep(vUv - vec2(0.0, e.y)) != hoverDep);
      col = mix(col, vec3(1.0), 0.10);
      if (id(vUv) == hover) col = mix(col, vec3(1.0), 0.22);
      col = mix(col, vec3(1.0), min(edge, 1.0) * 0.9);
    } else col *= 0.72;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
const copyFrag = `
uniform sampler2D src; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(src, vUv).rgb, 1.0); }`;

function target(w: number, h: number, float = true) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}
const halfToFloat = (h: number) => {
  const s = h >> 15 ? -1 : 1,
    e = (h >> 10) & 31,
    m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
};

export class Relief {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(30, 1, 1, 1e5);
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private scene = new THREE.Scene();
  private terrain: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private mats: Record<string, THREE.ShaderMaterial>;
  private rt: Record<string, THREE.WebGLRenderTarget>;
  private vals: THREE.DataTexture;
  private low: Uint8Array;
  private lowPending = false;
  private dirty = true;
  tilt = 0;
  turn = 0;
  zoom = 1; // 1 = the whole map fits, larger = closer
  target = new THREE.Vector3(); // world point the camera looks at
  hover = -1;
  communeMode = false;
  frames = 0;
  readonly W: number;
  readonly H: number;
  readonly zmax: number;

  constructor(public canvas: HTMLCanvasElement, public data: Data) {
    const { W, H } = data;
    this.W = W;
    this.H = H;
    this.zmax = Z_SCALE * H;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x06080c, 1);

    const idxData = new Uint8Array(W * H * 2);
    for (let i = 0; i < W * H; i++) (idxData[2 * i] = data.grid[i] & 255), (idxData[2 * i + 1] = data.grid[i] >> 8);
    const idx = new THREE.DataTexture(idxData, W, H, THREE.RGFormat, THREE.UnsignedByteType);
    idx.minFilter = idx.magFilter = THREE.NearestFilter;
    idx.unpackAlignment = 1;
    idx.needsUpdate = true;
    const VW = 256,
      VH = Math.ceil(data.communes.length / VW);
    this.vals = new THREE.DataTexture(new Float32Array(VW * VH), VW, VH, THREE.RedFormat, THREE.FloatType);
    this.vals.minFilter = this.vals.magFilter = THREE.NearestFilter;
    const depData = new Uint8Array(VW * VH);
    depData.set(data.depOf);
    const depOf = new THREE.DataTexture(depData, VW, VH, THREE.RedFormat, THREE.UnsignedByteType);
    depOf.minFilter = depOf.magFilter = THREE.NearestFilter;
    depOf.unpackAlignment = 1;
    depOf.needsUpdate = true;
    const rampData = new Uint8Array(HYPSO.flatMap((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]));
    const ramp = new THREE.DataTexture(rampData, NBAND, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;

    const cw = Math.ceil(W / 4),
      ch = Math.ceil(H / 4);
    this.rt = { raw: target(W, H), a: target(W, H), b: target(W, H), ca: target(cw, ch), cb: target(cw, ch), height: target(W, H), low: target(cw, ch, false) };
    this.low = new Uint8Array(cw * ch * 4);
    const sm = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.mats = {
      raw: sm(rawFrag, { idx: { value: idx }, vals: { value: this.vals }, valsSize: { value: new THREE.Vector2(VW, VH) } }),
      fine: sm(blurFrag(FINE_R), { src: { value: null }, dir: { value: new THREE.Vector2() } }),
      coarse: sm(blurFrag(COARSE_R), { src: { value: null }, dir: { value: new THREE.Vector2() } }),
      combine: sm(combineFrag, { fine: { value: this.rt.b.texture }, coarse: { value: this.rt.cb.texture }, raw: { value: this.rt.raw.texture }, logLo: { value: Math.log(LO) }, invSpan: { value: 1 / Math.log(HI / LO) } }),
      copy: sm(copyFrag, { src: { value: this.rt.height.texture } }),
    };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mats.raw);
    this.quadScene.add(this.quad);

    const seg = 2; // cells per vertex
    const geo = new THREE.PlaneGeometry(W, H, Math.round(W / seg), Math.round(H / seg));
    const uniforms = {
      height: { value: this.rt.height.texture },
      idx: { value: idx },
      ramp: { value: ramp },
      texel: { value: new THREE.Vector2(1 / W, 1 / H) },
      zscale: { value: this.zmax },
      hover: { value: 0 },
      hoverDep: { value: 0 },
      edge: { value: 1 },
      communeMode: { value: 0 },
      depOf: { value: depOf },
      valsSize: { value: new THREE.Vector2(VW, VH) },
      light: { value: new THREE.Vector3(-1, 1, 1.25).normalize() },
    };
    this.mats.terrain = new THREE.ShaderMaterial({ vertexShader: terrainVert, fragmentShader: terrainFrag, uniforms });
    this.terrain = new THREE.Mesh(geo, this.mats.terrain);
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);
    this.camera.up.set(0, 1, 0);
    this.resize();
  }

  // One density (people per km²) per commune.
  setValues(v: Float32Array) {
    (this.vals.image.data as Float32Array).set(v);
    this.vals.needsUpdate = true;
    this.dirty = true;
  }
  // Commune index under the pointer (or -1); the outline follows its
  // département, or the commune itself when the view is zoomed inside it.
  setHover(i: number, communeMode = false) {
    this.hover = i;
    this.communeMode = communeMode;
    this.mats.terrain.uniforms.hover.value = i + 1;
    this.mats.terrain.uniforms.hoverDep.value = i >= 0 ? this.data.depOf[i] + 1 : 0;
    this.mats.terrain.uniforms.communeMode.value = communeMode ? 1 : 0;
  }
  // tilt and turn in 0..1 and 0..1 (full circle)
  setView(tilt: number, turn: number) {
    this.tilt = tilt;
    this.turn = turn;
    this.place();
  }
  // zoom factor and the grid point to centre on (kept inside the map)
  setZoom(zoom: number, gx: number, gy: number) {
    this.zoom = Math.min(12, Math.max(1, zoom));
    this.mats.terrain.uniforms.edge.value = 1 / Math.min(4, this.zoom);
    this.target.set(Math.min(this.W / 2, Math.max(-this.W / 2, gx - this.W / 2)), Math.min(this.H / 2, Math.max(-this.H / 2, this.H / 2 - gy)), 0);
    this.place();
  }
  // Grid point under a canvas pixel on the ground plane, or null.
  groundAt(px: number, py: number): [number, number] | null {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const ndc = new THREE.Vector3((px / w) * 2 - 1, 1 - (py / h) * 2, 0.5).unproject(this.camera);
    const o = this.camera.position,
      d = ndc.sub(o).normalize();
    if (d.z >= -1e-6) return null;
    const s = -o.z / d.z;
    return [o.x + d.x * s + this.W / 2, this.H / 2 - (o.y + d.y * s)];
  }
  resize() {
    const w = this.canvas.clientWidth || 1,
      h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.place();
  }
  // Puts the camera on its orbit and backs it off until the whole map,
  // including the tallest possible peak, fits the view; then closes in by
  // the zoom factor on the target.
  private place() {
    const phi = this.tilt * TILT_MAX,
      th = this.turn * 2 * Math.PI;
    const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(th), -Math.sin(phi) * Math.cos(th), Math.cos(phi));
    this.camera.up.set(-Math.sin(th), Math.cos(th), 0);
    const corners: THREE.Vector3[] = [];
    for (const x of [-this.W / 2, this.W / 2]) for (const y of [-this.H / 2, this.H / 2]) for (const z of [0, this.zmax * 0.6]) corners.push(new THREE.Vector3(x, y, z));
    let lo = 10,
      hi = 1e5;
    const p = new THREE.Vector3();
    for (let k = 0; k < 24; k++) {
      const d = (lo + hi) / 2;
      this.camera.position.copy(dir).multiplyScalar(d);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      let fits = true;
      for (const c of corners) {
        p.copy(c).project(this.camera);
        if (Math.abs(p.x) > 0.96 || Math.abs(p.y) > 0.96) fits = false;
      }
      if (fits) hi = d;
      else lo = d;
    }
    this.camera.position.copy(dir).multiplyScalar(hi / this.zoom).add(this.target);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
  }
  private pass(mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.quadScene, this.quadCam);
  }
  private blur(mat: THREE.ShaderMaterial, src: THREE.WebGLRenderTarget, a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget, passes: number) {
    let from = src;
    for (let k = 0; k < passes; k++) {
      mat.uniforms.src.value = from.texture;
      mat.uniforms.dir.value.set(1 / a.width, 0);
      this.pass(mat, a);
      mat.uniforms.src.value = a.texture;
      mat.uniforms.dir.value.set(0, 1 / a.height);
      this.pass(mat, b);
      from = b;
    }
  }
  private field() {
    this.pass(this.mats.raw, this.rt.raw);
    this.blur(this.mats.fine, this.rt.raw, this.rt.a, this.rt.b, 2);
    this.blur(this.mats.coarse, this.rt.raw, this.rt.ca, this.rt.cb, 2);
    this.pass(this.mats.combine, this.rt.height);
    // A quarter-resolution byte copy on the CPU, so labels and picking can
    // follow the surface. Read back asynchronously: a frame late is fine, a
    // pipeline stall every frame is not.
    this.pass(this.mats.copy, this.rt.low);
    if (!this.lowPending) {
      this.lowPending = true;
      this.renderer
        .readRenderTargetPixelsAsync(this.rt.low, 0, 0, this.rt.low.width, this.rt.low.height, this.low)
        .then((b) => (this.low = b as Uint8Array))
        .catch(() => {})
        .finally(() => (this.lowPending = false));
    }
    this.dirty = false;
  }
  render() {
    if (this.dirty) this.field();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }
  // Commune index under a canvas pixel, or -1: a ray from the camera,
  // marched down through the CPU copy of the relief until it goes under
  // the surface, then bisected.
  pick(px: number, py: number): number {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const ndc = new THREE.Vector3((px / w) * 2 - 1, 1 - (py / h) * 2, 0.5).unproject(this.camera);
    const o = this.camera.position,
      d = ndc.sub(o).normalize();
    if (d.z >= -1e-6) return -1;
    const surface = (s: number) => {
      const gx = o.x + d.x * s + this.W / 2,
        gy = this.H / 2 - (o.y + d.y * s);
      if (gx < 0 || gy < 0 || gx >= this.W || gy >= this.H) return -Infinity;
      return Math.max(this.fieldAt(gx, gy) - WATER, 0) * this.zmax;
    };
    // From the height of the tallest possible peak down to the ground.
    let s = (this.zmax - o.z) / d.z;
    const sEnd = -o.z / d.z,
      step = 1 / Math.max(1e-3, Math.hypot(d.x, d.y));
    let prev = s;
    for (; s < sEnd; s += step) {
      if (o.z + d.z * s <= surface(s)) break;
      prev = s;
    }
    let lo = prev,
      hi = Math.min(s, sEnd);
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      if (o.z + d.z * mid <= surface(mid)) hi = mid;
      else lo = mid;
    }
    const gx = o.x + d.x * hi + this.W / 2,
      gy = this.H / 2 - (o.y + d.y * hi);
    if (gx < 0 || gy < 0 || gx >= this.W || gy >= this.H) return -1;
    return this.data.grid[Math.floor(gy) * this.W + Math.floor(gx)] - 1;
  }
  // Field value at a grid point from the CPU copy, bilinear, no GPU round trip.
  fieldAt(gx: number, gy: number): number {
    if (this.dirty) this.field();
    const w = this.rt.low.width,
      h = this.rt.low.height;
    const x = Math.min(w - 1.001, Math.max(0, (gx / this.W) * w - 0.5)),
      y = Math.min(h - 1.001, Math.max(0, ((this.H - gy) / this.H) * h - 0.5));
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0;
    const at = (i: number, j: number) => this.low[(j * w + i) * 4] / 255;
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  }
  // Grid point, standing on the relief, to canvas pixels; z is the field value.
  project(gx: number, gy: number, out = { x: 0, y: 0, z: 0 }) {
    const h = this.fieldAt(gx, gy);
    const p = new THREE.Vector3(gx - this.W / 2, this.H / 2 - gy, Math.max(h - WATER, 0) * this.zmax).project(this.camera);
    out.x = ((p.x + 1) / 2) * this.canvas.clientWidth;
    out.y = ((1 - p.y) / 2) * this.canvas.clientHeight;
    out.z = h;
    return out;
  }
  // Value of the height field at a grid point (0..1, WATER and below is sea).
  heightAt(gx: number, gy: number): number {
    if (this.dirty) this.field();
    const b = new Uint16Array(4);
    const x = Math.min(this.W - 1, Math.max(0, Math.floor(gx))),
      y = Math.min(this.H - 1, Math.max(0, Math.floor(this.H - gy)));
    this.renderer.readRenderTargetPixels(this.rt.height, x, y, 1, 1, b);
    return halfToFloat(b[0]);
  }
}
