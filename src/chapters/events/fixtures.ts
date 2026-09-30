import * as THREE from 'three'

/*
 * The dining room's own surfaces and fixtures from ref6 (Mike's photo of
 * Glory's dining room), for room.ts:
 *
 *   oakFloorMap()     the honey oak strip floor: 2¼" boards of random length
 *                     with butt joints, pale honey tones and a fine grain
 *                     (one small tiling canvas, drawn once as ImageData)
 *   plasterMap()      the cream plaster wall's soft, tiling mottle
 *   castIronColumn()  a round cast-iron column: a moulded base, a plain shaft,
 *                     a neck ring and a flared capital under a square abacus
 *   PrintAtlas        framed prints on the plaster (the site's own photos in a
 *                     white mat): one canvas, one material for every print,
 *                     photos drawn in when they arrive
 *
 * All sizes are metres.
 */

/** a periodic 2D value noise field (n × n samples, `cells` lattice cells across, tiles seamlessly) */
function tileNoise(n: number, cells: number, seed: number): Float32Array {
  let s = seed * 9301 + 49297
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const L = new Float32Array(cells * cells)
  for (let i = 0; i < L.length; i++) L[i] = r()
  const out = new Float32Array(n * n)
  const sm = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * cells
    const y0 = Math.floor(fy)
    const ty = sm(fy - y0)
    const r0 = (y0 % cells) * cells
    const r1 = ((y0 + 1) % cells) * cells
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells
      const x0 = Math.floor(fx)
      const tx = sm(fx - x0)
      const c0 = x0 % cells
      const c1 = (x0 + 1) % cells
      const a = L[r0 + c0] + (L[r0 + c1] - L[r0 + c0]) * tx
      const b = L[r1 + c0] + (L[r1 + c1] - L[r1 + c0]) * tx
      out[y * n + x] = a + (b - a) * ty
    }
  }
  return out
}

/** metres of floor one tile of oakFloorMap() covers (both ways) */
export const OAK_TILE = 1.2

/**
 * Honey oak strip flooring (ref6): boards run along the canvas's v (lay it so
 * v runs down the room). 21 strips of 2¼" across a 1.2 m tile, each broken
 * into boards of 0.3–1.2 m, every board its own honey tone (pale straw to
 * light amber, never red), a soft figure and fine grain lines, a dark hairline
 * seam round each board.
 */
export function oakFloorMap(mobile: boolean): THREE.CanvasTexture {
  const n = mobile ? 256 : 512
  const strips = 21
  const sw = n / strips
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  const img = g.createImageData(n, n)
  const d = img.data
  let seed = 31
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  // each strip: its joints (fractions of the tile, wrapping) and one tone per board
  const joints: number[][] = []
  const tones: number[][] = []
  for (let i = 0; i < strips; i++) {
    const js: number[] = []
    let v = r()
    const start = v
    // boards 0.3–1.2 m long on a 1.2 m tile: 1–3 joints per strip
    do {
      js.push(v % 1)
      v += (0.3 + r() * 0.9) / OAK_TILE
    } while (v < start + 1 - 0.2)
    js.sort((a, b) => a - b)
    joints.push(js)
    tones.push(js.map(() => r()))
  }
  const fig = tileNoise(n, 6, 3)
  const fine = tileNoise(n, 48, 7)
  // honey oak albedo (sRGB): pale straw → light amber; hue ~30°, never red
  const lo = [190, 152, 112]
  const hi = [220, 186, 140]
  for (let y = 0; y < n; y++) {
    const v = y / n
    for (let x = 0; x < n; x++) {
      const si = Math.min(strips - 1, Math.floor(x / sw))
      const js = joints[si]
      // which board of the strip is this row in (the last one wraps into the first)
      let bi = js.length - 1
      for (let k = 0; k < js.length; k++) if (v >= js[k]) bi = k
      const t = tones[si][bi]
      // distance to the strip's seams (px) and to the nearest butt joint (px)
      const u = x - si * sw
      const du = Math.min(u, sw - u)
      let dv = Infinity
      for (const j of js) {
        const dd = Math.abs(v - j) * n
        dv = Math.min(dv, dd, n - dd)
      }
      // figure: slow flame along the board, fine grain lines across it
      const f = fig[y * n + x]
      const grain = Math.sin((u / sw) * 9.0 + f * 7.0 + t * 20.0)
      const lineK = 0.5 + 0.5 * grain
      const lines = Math.pow(lineK, 6) * 0.1
      const fn = fine[y * n + x] - 0.5
      let k = 0.93 + 0.1 * (f - 0.5) - lines + 0.04 * fn
      // seams: a dark hairline, a touch of shading either side
      if (du < 0.9) k *= 0.6
      else if (du < 1.8) k *= 0.88
      if (dv < 0.8) k *= 0.62
      const i = (y * n + x) * 4
      d[i] = Math.min(255, (lo[0] + (hi[0] - lo[0]) * t) * k)
      d[i + 1] = Math.min(255, (lo[1] + (hi[1] - lo[1]) * t) * k)
      d[i + 2] = Math.min(255, (lo[2] + (hi[2] - lo[2]) * t) * k)
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.onUpdate = () => {
    cv.width = cv.height = 1
    tex.onUpdate = null
  }
  return tex
}

/** metres of wall one tile of plasterMap() covers */
export const PLASTER_TILE = 1.6

/** the cream plaster (ref6's right wall): a warm cream with a soft trowelled mottle, tiling */
export function plasterMap(mobile: boolean): THREE.CanvasTexture {
  const n = mobile ? 128 : 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  const img = g.createImageData(n, n)
  const a = tileNoise(n, 3, 11)
  const b = tileNoise(n, 9, 13)
  const c = tileNoise(n, 32, 17)
  // ref6's cream (sRGB albedo)
  const base = [228, 214, 188]
  for (let i = 0; i < n * n; i++) {
    const k = 0.955 + 0.05 * (a[i] - 0.5) + 0.035 * (b[i] - 0.5) + 0.02 * (c[i] - 0.5)
    img.data[i * 4] = Math.min(255, base[0] * k)
    img.data[i * 4 + 1] = Math.min(255, base[1] * k)
    img.data[i * 4 + 2] = Math.min(255, base[2] * (k - 0.004))
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.onUpdate = () => {
    cv.width = cv.height = 1
    tex.onUpdate = null
  }
  return tex
}

/**
 * ref6's round cast-iron column, floor (y = 0) to `height`: a moulded base,
 * a plain shaft with a little entasis, a neck ring, a flared bell capital
 * and a square-ish abacus plate on top. Lathe (metres).
 */
export function castIronColumn(height: number, radial: number): THREE.BufferGeometry {
  const top = height
  const P: [number, number][] = [
    [0, 0],
    [0.13, 0],
    [0.13, 0.03],
    [0.118, 0.045],
    [0.118, 0.07],
    [0.1, 0.095],
    [0.088, 0.125],
    [0.082, 0.2],
    [0.078, top * 0.5],
    [0.072, top - 0.47],
    // the neck ring
    [0.081, top - 0.455],
    [0.081, top - 0.425],
    [0.072, top - 0.41],
    // the bell, flaring out to the abacus
    [0.078, top - 0.34],
    [0.096, top - 0.24],
    [0.124, top - 0.15],
    [0.158, top - 0.085],
    [0.176, top - 0.06],
    [0.176, top - 0.035],
    [0.158, top - 0.028],
    [0.158, top],
    [0, top],
  ]
  return new THREE.LatheGeometry(
    P.map(([x, y]) => new THREE.Vector2(x, y)),
    radial,
  )
}

/**
 * Framed prints (the site's own photographs in a white mat) sharing ONE canvas
 * and one material. `add()` reserves a cell and returns the UV rect for the
 * mat opening of the given aspect (w / h); `load()` draws a photo in.
 */
export class PrintAtlas {
  readonly cv: HTMLCanvasElement
  readonly tex: THREE.CanvasTexture
  private g: CanvasRenderingContext2D
  private cells: { x: number; y: number; w: number; h: number; mat: number }[] = []
  private cell: number

  constructor(
    private count: number,
    mobile: boolean,
  ) {
    this.cell = mobile ? 256 : 512
    this.cv = document.createElement('canvas')
    this.cv.width = this.cell * count
    this.cv.height = this.cell
    this.g = this.cv.getContext('2d')!
    this.tex = new THREE.CanvasTexture(this.cv)
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.tex.anisotropy = 8
  }

  /** reserve a cell for a print whose mat opening is `aspect` (w / h); `mat` = the mat's share of the short side */
  add(aspect: number, mat = 0.12): { u0: number; u1: number; v0: number; v1: number } {
    const i = this.cells.length
    const C = this.cell
    const w = aspect >= 1 ? C : Math.round(C * aspect)
    const h = aspect >= 1 ? Math.round(C / aspect) : C
    const x = i * C
    const y = 0
    this.cells.push({ x, y, w, h, mat })
    // the mat and a dark print until the photo arrives
    const g = this.g
    g.fillStyle = '#ece6da'
    g.fillRect(x, y, w, h)
    const m = Math.round(Math.min(w, h) * mat)
    g.fillStyle = '#2a2420'
    g.fillRect(x + m, y + m, w - 2 * m, h - 2 * m)
    this.tex.needsUpdate = true
    const W = this.cv.width
    const H = this.cv.height
    return { u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H }
  }

  /** draw photo `url` into print i's window (cover-cropped), off the main thread where possible */
  async load(i: number, url: string) {
    const c = this.cells[i]
    if (!c) return
    const m = Math.round(Math.min(c.w, c.h) * c.mat)
    const ww = c.w - 2 * m
    const wh = c.h - 2 * m
    let src: CanvasImageSource
    let sw: number
    let sh: number
    try {
      const blob = await (await fetch(url)).blob()
      const bmp = await createImageBitmap(blob)
      src = bmp
      sw = bmp.width
      sh = bmp.height
    } catch {
      const img = new Image()
      img.src = url
      await img.decode()
      src = img
      sw = img.naturalWidth
      sh = img.naturalHeight
    }
    // cover: crop the photo to the window's aspect, centred
    const want = ww / wh
    let cw = sw
    let ch = sh
    if (sw / sh > want) cw = sh * want
    else ch = sw / want
    this.g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, c.x + m, c.y + m, ww, wh)
    // a hairline bevel where the mat is cut
    this.g.strokeStyle = 'rgba(255, 252, 244, 0.9)'
    this.g.lineWidth = Math.max(1, c.w / 256)
    this.g.strokeRect(c.x + m - 1, c.y + m - 1, ww + 2, wh + 2)
    if ('close' in src && typeof (src as ImageBitmap).close === 'function') (src as ImageBitmap).close()
    this.tex.needsUpdate = true
  }
}

/** a plane (w × h, facing +z) whose UVs cover `uv` of an atlas */
export function atlasPlane(w: number, h: number, uv: { u0: number; u1: number; v0: number; v1: number }) {
  const geo = new THREE.PlaneGeometry(w, h)
  const a = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < a.count; i++) {
    a.setXY(i, uv.u0 + a.getX(i) * (uv.u1 - uv.u0), uv.v0 + a.getY(i) * (uv.v1 - uv.v0))
  }
  a.needsUpdate = true
  return geo
}
