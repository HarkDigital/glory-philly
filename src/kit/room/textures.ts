import * as THREE from 'three'
import { nextFrame } from '../../core/yield'
import { PLANK_STRETCH, canvas, clamp, fbm, hash2, lerp, noise1, rng, smoothstep, texFrom, vnoise } from './util'

/*
 * ROOM KIT maps — procedural canvases (≤ 1024), built once and cached (the
 * shared ones are never disposed by a kit instance). Every "data" map packs
 * R = height (bump) and G = roughness, so one texture serves bumpMap and
 * roughnessMap.
 */

export interface PbrMaps {
  map: THREE.Texture
  /** R = height, G = roughness (use for both bumpMap and roughnessMap) */
  data: THREE.Texture
}

// ─── reclaimed walnut planks ────────────────────────────────────────────────

/** metres of wall one walnut tile covers ACROSS the boards (v) */
export const WALNUT_TILE = 1.2
/** metres one tile covers ALONG the boards (u): the map is stretched 2 : 1 so boards run long */
export const WALNUT_ALONG = WALNUT_TILE * PLANK_STRETCH

/**
 * ONE warm walnut family (sRGB, before the chroma trim below): every board is
 * this colour, nudged a little brighter/darker, a little redder or a little
 * greyer — like the real cladding in ref1/ref2/ref4, where the boards read as
 * one wall, not a patchwork.
 */
const WALNUT_BASE: [number, number, number] = [104, 66, 42]
/** chroma kept (see the tone-mapping note in walnutGen) */
const WALNUT_CHROMA = 0.68

let walnut: PbrMaps | null = null
/**
 * Reclaimed walnut cladding, 1024² for 1.2 m across × 2.4 m along the boards:
 * long boards (10–16 cm wide, 1–2.3 m between butt joints) in one warm walnut
 * family (±7 % in value, a slight red/grey drift board to board), soft grain
 * with the odd cathedral figure, pores along the grain, faint saw marks, butt
 * joints with nail pairs; satin (roughness ~0.5).
 */
export function walnutMaps(): PbrMaps {
  if (walnut) return walnut
  return runSync(walnutGen())
}
/** the same, built in slices across frames (call from an async init: no long task) */
export async function walnutMapsAsync(): Promise<PbrMaps> {
  if (walnut) return walnut
  return runAsync(walnutGen())
}
function* walnutGen(): Generator<void, PbrMaps> {
  const N = 1024
  /** metres per pixel along (u) and across (v) the boards */
  const MU = WALNUT_ALONG / N
  const MV = WALNUT_TILE / N
  const r = rng(71)
  /** a bell-ish variate in [-0.5, 0.5] (sd ≈ 0.17): most boards near the middle, few extremes */
  const bell = () => (r() + r() + r()) / 3 - 0.5
  interface Seg {
    x0: number
    len: number
    col: [number, number, number]
    rough: number
    seed: number
    a1: number
    f1: number
    p1: number
    cath: number
    /** how figured this board is (plain ↔ lively), around 1 */
    fig: number
    cx: number
    cy: number
    ck: number
    saw: number
    sx: number
    sy: number
    sap: number
    sapTop: boolean
  }
  interface Row {
    y0: number
    h: number
    segs: Seg[]
  }
  // board widths 10–16 cm, scaled so the rows tile the map exactly
  const hs: number[] = []
  let sum = 0
  while (sum < N) {
    const h = lerp(0.1, 0.158, r()) / MV
    hs.push(h)
    sum += h
  }
  const rows: Row[] = []
  let acc = 0
  for (const hRaw of hs) {
    const y0 = Math.round((acc * N) / sum)
    acc += hRaw
    const h = Math.round((acc * N) / sum) - y0
    const segs: Seg[] = []
    let x = Math.floor(r() * N)
    let covered = 0
    while (covered < N) {
      // long boards: 1–2.3 m between butt joints, a third run the whole 2.4 m tile
      let len = r() < 0.32 ? N - covered : Math.round(lerp(1.0, 2.3, r()) / MU)
      if (N - covered - len < 0.7 / MU) len = N - covered
      // one walnut, board to board: value ±7 % (clamped), a slight red ↔ grey-brown drift
      // (and now and then a darker, greyer reclaimed board, as in ref4's wall)
      const dark = r() < 0.1
      const bright = clamp(1 + 0.6 * bell(), 0.8, 1.2) * (dark ? 0.84 : 1)
      const warm = bell() * 2
      const grey = dark ? lerp(0.25, 0.4, r()) : r() < 0.2 ? lerp(0.12, 0.3, r()) : 0
      let cr = WALNUT_BASE[0] * bright * (1 + 0.05 * warm)
      let cg = WALNUT_BASE[1] * bright * (1 + 0.012 * warm)
      let cb = WALNUT_BASE[2] * bright * (1 - 0.07 * warm)
      if (grey > 0) {
        const l = 0.3 * cr + 0.59 * cg + 0.11 * cb
        cr = lerp(cr, l, grey) * 0.97
        cg = lerp(cg, l, grey) * 0.97
        cb = lerp(cb, l, grey) * 0.97
      }
      segs.push({
        x0: x % N,
        len,
        col: [cr, cg, cb],
        rough: lerp(0.47, 0.56, r()),
        seed: r() * 1000,
        // grain wobble along the board: amplitude (m), frequency (rad/m), phase
        a1: lerp(0.002, 0.007, r()),
        f1: lerp(1.5, 5, r()),
        p1: r() * 6.28,
        cath: r() < 0.5 ? lerp(0.5, 1, r()) : 0,
        fig: lerp(0.7, 1.3, r()),
        cx: r() * len * MU,
        cy: lerp(0.3, 0.7, r()) * h * MV,
        ck: lerp(0.35, 1.1, r()) * (r() < 0.5 ? 1 : -1),
        saw: r() < 0.3 ? lerp(0.5, 1, r()) : 0,
        sx: r() * len * MU,
        sy: (r() < 0.5 ? -1 : 1) * lerp(0.5, 0.9, r()),
        sap: r() < 0.06 ? lerp(0.1, 0.22, r()) : 0,
        sapTop: r() < 0.5,
      })
      x += len
      covered += len
    }
    rows.push({ y0, h, segs })
  }
  const rowOf = new Int16Array(N)
  rows.forEach((row, i) => {
    for (let k = row.y0; k < row.y0 + row.h; k++) rowOf[k] = i
  })
  const n1 = noise1(5)
  const n2 = noise1(9)
  const { cv, g } = canvas(N)
  const { cv: dv, g: dg } = canvas(N)
  const img = g.createImageData(N, N)
  const dat = dg.createImageData(N, N)
  const C = img.data
  const D = dat.data
  const TAU = Math.PI * 2
  for (let py = 0; py < N; py++) {
    if (py % 96 === 95) yield
    if (walnut) return walnut
    const row = rows[rowOf[py]]
    const ly = py - row.y0
    const v = ly / row.h
    const lyM = ly * MV
    const dvEdge = Math.min(ly + 0.5, row.h - ly - 0.5)
    for (let px = 0; px < N; px++) {
      // which segment (they wrap around the tile)
      let s = row.segs[0]
      let u = 0
      for (const sg of row.segs) {
        const d = (px - sg.x0 + N) % N
        if (d < sg.len) {
          s = sg
          u = d
          break
        }
      }
      const uM = u * MU
      const duEdge = Math.min(u + 0.5, s.len - u - 0.5)
      // grain coordinate (metres across the board), wobbling gently along it
      const wob = s.a1 * Math.sin(uM * s.f1 + s.p1) + 0.006 * (n2.n(uM * 1.7 + s.seed) - 0.5)
      let gy = lyM + wob
      // cathedral figure: soft nested arches (plain-sawn boards)
      let cath = 0
      if (s.cath > 0) {
        const du = uM - s.cx
        const arch = gy - s.cy + s.ck * du * du
        const fade = 1 - smoothstep(0.15, 0.6, Math.abs(du))
        const ring = Math.sin(arch * 380 + n1.n(uM * 4 + s.seed) * 2)
        cath = smoothstep(0.55, 1, ring) * fade * s.cath
        gy = lerp(gy, arch, fade * 0.5)
      }
      // soft grain: broad bands (~1.5 cm) + fine lines (~1.5 mm)
      const streak = n1.fbm(gy * 38 + s.seed, 3)
      const fine = n2.fbm(gy * 520 + s.seed * 3, 2)
      // pores: short dark dashes along the grain
      const pore = hash2(Math.floor(u / 2) + Math.floor(s.seed), py) > 0.976 ? 1 : 0
      // the colour drifts slowly along a board (reclaimed stock is never quite even)
      const mott = n2.fbm(uM * 1.1 + s.seed * 1.7 + lyM * 3, 3)
      // walnut's darker heartwood streaks: broad wavy bands along the board
      const heart = smoothstep(0.5, 0.8, n2.fbm(gy * 22 + s.seed * 2.3 + 0.35 * Math.sin(uM * 1.8 + s.p1), 3))
      let tone = 1 + s.fig * (0.28 * (streak - 0.5) + 0.07 * (fine - 0.5) - 0.14 * cath - 0.24 * heart) - 0.07 * pore
      tone *= 0.94 + 0.12 * mott
      // saw marks on reclaimed stock: faint arcs
      if (s.saw > 0) {
        const d = Math.hypot(uM - s.sx, lyM - s.sy)
        tone *= 1 + 0.03 * s.saw * Math.sin((d * TAU) / 0.011) * (0.6 + 0.4 * n1.n(d * 40))
      }
      let cr = s.col[0] * tone
      let cg = s.col[1] * tone
      let cb = s.col[2] * tone
      // the odd paler sapwood edge (a wavy boundary), kept soft
      if (s.sap > 0) {
        const edgeV = s.sapTop ? v : 1 - v
        const bound = s.sap + 0.05 * Math.sin(uM * 4 + s.seed) + 0.03 * (n1.n(uM * 12) - 0.5)
        const k = 1 - smoothstep(bound - 0.05, bound + 0.03, edgeV)
        cr = lerp(cr, 150 * tone, k * 0.45)
        cg = lerp(cg, 112 * tone, k * 0.45)
        cb = lerp(cb, 80 * tone, k * 0.45)
      }
      let hgt = 0.62 + 0.1 * (fine - 0.5) + 0.07 * (streak - 0.5) - 0.1 * pore
      let rough = s.rough + 0.04 * (fine - 0.5) + 0.05 * (1 - mott)
      // bevelled seams between boards (≈ 1.4 mm gap) + butt joints (≈ 2.3 mm)
      const eV = dvEdge
      const eU = duEdge * (MU / MV)
      const e = Math.min(eV, eU)
      // tight joints (the real cladding butts closely: a fine dark line, a hint of an arris)
      if (e < 1.2) {
        cr *= 0.42
        cg *= 0.4
        cb *= 0.4
        hgt = 0.3
        rough = 0.85
      } else if (e < 2.6) {
        const k = (e - 1.2) / 1.4
        hgt *= 0.75 + 0.25 * k
        const dk = 0.88 + 0.12 * k
        cr *= dk
        cg *= dk
        cb *= dk
      }
      // authored less saturated than a photo: the site's PBR Neutral toe
      // saturates dim warm tones hard (it subtracts a black level off the min channel)
      const lw = 0.3 * cr + 0.59 * cg + 0.11 * cb
      cr = lw + (cr - lw) * WALNUT_CHROMA
      cg = lw + (cg - lw) * WALNUT_CHROMA
      cb = lw + (cb - lw) * WALNUT_CHROMA
      const i = (py * N + px) * 4
      C[i] = clamp(cr, 0, 255)
      C[i + 1] = clamp(cg, 0, 255)
      C[i + 2] = clamp(cb, 0, 255)
      C[i + 3] = 255
      D[i] = clamp(hgt * 255, 0, 255)
      D[i + 1] = clamp(rough * 255, 0, 255)
      D[i + 2] = 0
      D[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  dg.putImageData(dat, 0, 0)
  // nail holes (≈ 3 mm; the map is 2 : 1, so they're drawn as ellipses): pairs by the butt joints, a few strays
  const hole = (x: number, yy: number) => {
    const ry = 0.0014 / MV
    const rx = 0.0014 / MU
    for (const ox of [-N, 0, N]) {
      g.fillStyle = 'rgba(26,16,11,0.9)'
      g.beginPath()
      g.ellipse(x + ox, yy, rx, ry, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(0,0,0,0.18)'
      g.beginPath()
      g.ellipse(x + ox, yy, rx * 1.7, ry * 1.7, 0, 0, Math.PI * 2)
      g.fill()
      dg.fillStyle = 'rgb(20,240,0)'
      dg.beginPath()
      dg.ellipse(x + ox, yy, rx, ry, 0, 0, Math.PI * 2)
      dg.fill()
    }
  }
  for (const row of rows)
    for (const s of row.segs) {
      if (s.len < N) {
        const x = (s.x0 + 0.02 / MU) % N
        hole(x, row.y0 + row.h * 0.3)
        hole(x, row.y0 + row.h * 0.7)
      }
      if (r() < 0.25) hole((s.x0 + r() * s.len) % N, row.y0 + row.h * (r() < 0.5 ? 0.28 : 0.72))
    }
  walnut = { map: texFrom(cv), data: texFrom(dv, { srgb: false }) }
  return walnut
}

/** drive a slice generator to the end, now */
export function runSync<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
  }
}
/** drive a slice generator, yielding a frame between slices */
export async function runAsync<T>(g: Generator<void, T>): Promise<T> {
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
    await nextFrame()
  }
}

// ─── brick ──────────────────────────────────────────────────────────────────

/** A line of hand-painted lettering on brick (positions in metres from the panel's top-left). */
export interface PaintLine {
  text: string
  /** metres from the panel's left edge (to the text's left, or centre with align 'center') */
  x: number
  /** metres from the panel's top to the baseline */
  y: number
  /** cap height in metres */
  size: number
  align?: 'left' | 'center'
  /** extra letter spacing, em */
  tracking?: number
  /** CSS font family (upright; default a light book serif) */
  font?: string
  weight?: number
}

/** ref2's decor: a small "Old" over a big "1837" (as painted on the brick at the bar) */
export function old1837(w: number, h: number): PaintLine[] {
  const big = Math.min(h * 0.24, w * 0.19)
  return [
    { text: 'Old', x: w * 0.12, y: h * 0.2, size: big * 0.42, tracking: 0.02 },
    { text: '1837', x: w * 0.5 + big * 0.12, y: h * 0.2 + big * 1.36, size: big, align: 'center', tracking: 0.22 },
  ]
}

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif'

const BRICKS: [number, number, number][] = [
  [80, 46, 38],
  [68, 44, 38],
  [56, 40, 36],
  [90, 56, 46],
  [46, 34, 32],
  [98, 66, 54],
  [34, 27, 26],
  [74, 50, 44],
  [62, 48, 45],
]
const BRICK_W = [1.2, 1.3, 1.2, 0.8, 0.9, 0.3, 0.6, 0.9, 0.8]

/**
 * Old Philadelphia brick (modular 203 × 57 mm, dark recessed mortar), with
 * optional hand-painted lettering: distressed off-white, the brick showing
 * through, the mortar joints less painted. `w × h` metres; ≤ 1024 px.
 */
export interface BrickOpts {
  lines?: PaintLine[]
  seed?: number
  soot?: number
}
const brickPanels = new Map<string, PbrMaps>()
// (numbers rounded: 0.8 + 0.6 must key the same as 1.4)
const brickKey = (w: number, h: number, o: BrickOpts) =>
  JSON.stringify([w, h, o.lines ?? [], o.seed ?? 3, o.soot ?? 0.5], (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v))
/** a brick panel's maps, cached by its arguments (shared: never dispose them) */
export function brickPanelMaps(w: number, h: number, o: BrickOpts = {}): PbrMaps {
  const k = brickKey(w, h, o)
  let m = brickPanels.get(k)
  if (!m) {
    const { cv, dv } = runSync(brickGen(w, h, o))
    brickPanels.set(k, (m = { map: texFrom(cv, { repeat: false }), data: texFrom(dv, { srgb: false, repeat: false }) }))
  }
  return m
}
/** build a brick panel's maps across frames (then brickPanelMaps with the same arguments is instant) */
export async function brickPanelMapsAsync(w: number, h: number, o: BrickOpts = {}): Promise<PbrMaps> {
  const k = brickKey(w, h, o)
  const hit = brickPanels.get(k)
  if (hit) return hit
  const { cv, dv } = await runAsync(brickGen(w, h, o))
  const again = brickPanels.get(k)
  if (again) return again
  const m = { map: texFrom(cv, { repeat: false }), data: texFrom(dv, { srgb: false, repeat: false }) }
  brickPanels.set(k, m)
  return m
}

export function brickCanvas(w: number, h: number, o: BrickOpts = {}) {
  return runSync(brickGen(w, h, o))
}
function* brickGen(w: number, h: number, { lines = [] as PaintLine[], seed = 3, soot = 0.5 }: BrickOpts = {}): Generator<void, { cv: HTMLCanvasElement; dv: HTMLCanvasElement; ppm: number }> {
  const ppm = Math.min(1024 / w, 1024 / h, 700)
  const W = Math.max(8, Math.round(w * ppm))
  const H = Math.max(8, Math.round(h * ppm))
  const { cv, g } = canvas(W, H)
  const { cv: dv, g: dg } = canvas(W, H)
  // the paint mask
  let mask: Uint8ClampedArray | null = null
  if (lines.length) {
    const { g: mg } = canvas(W, H)
    mg.fillStyle = '#fff'
    mg.textBaseline = 'alphabetic'
    for (const l of lines) {
      const px = (l.size * ppm) / 0.7 // cap height → font size
      mg.font = `${l.weight ?? 400} ${px}px ${l.font ?? SERIF}`
      ;(mg as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(l.tracking ?? 0) * px}px`
      mg.textAlign = l.align ?? 'left'
      mg.fillText(l.text, l.x * ppm, l.y * ppm)
    }
    mask = mg.getImageData(0, 0, W, H).data
  }
  const r = rng(seed)
  const pickT = BRICK_W.reduce((a, b) => a + b, 0)
  const img = g.createImageData(W, H)
  const dat = dg.createImageData(W, H)
  const C = img.data
  const D = dat.data
  const course = 0.0667
  const pitch = 0.213
  const mort = 0.0098
  const rowOff: number[] = []
  for (let i = 0; i < 64; i++) rowOff.push((i % 2) * pitch * 0.5 + (r() - 0.5) * 0.02)
  for (let py = 0; py < H; py++) {
    if (py % 110 === 109) yield
    const ym = py / ppm
    const row = Math.floor(ym / course)
    const fy = ym - row * course
    for (let px = 0; px < W; px++) {
      const xm = px / ppm
      const xo = xm + rowOff[row & 63] + seed
      const col = Math.floor(xo / pitch)
      const fx = xo - col * pitch
      const id = hash2(col + seed * 7, row + seed * 13)
      // chipped arrises: the mortar line wanders
      const chip = (vnoise(xm * 90, ym * 90) - 0.5) * 0.0035 + (vnoise(xm * 22 + 5, ym * 22) - 0.5) * 0.003
      const ex = Math.min(fx, pitch - fx)
      const ey = Math.min(fy, course - fy)
      const edge = Math.min(ex, ey) - mort * 0.5 - chip
      const isBrick = edge > 0
      let cr: number
      let cg: number
      let cb: number
      let hgt: number
      let rough: number
      const big = fbm(xm * 1.6 + seed, ym * 1.6, 3)
      if (isBrick) {
        let t = id * pickT
        let c = BRICKS[0]
        for (let k = 0; k < BRICKS.length; k++) if ((t -= BRICK_W[k]) <= 0) {
          c = BRICKS[k]
          break
        }
        const mot = fbm(xm * 26 + id * 40, ym * 26, 3)
        const spk = vnoise(xm * 260, ym * 260)
        const tone = (0.78 + 0.42 * mot + 0.12 * (spk - 0.5)) * (0.85 + 0.3 * hash2(col, row + 99))
        // a fired face darker at one end
        const flash = 1 - 0.22 * smoothstep(0.3, 1, Math.sin((fx / pitch) * Math.PI * (id > 0.5 ? 1 : -1) + id * 3) * 0.5 + 0.5) * (id > 0.7 ? 1 : 0)
        cr = c[0] * tone * flash
        cg = c[1] * tone * flash
        cb = c[2] * tone * flash
        // lime ghosts + efflorescence
        const lime = smoothstep(0.66, 0.9, fbm(xm * 5 + 9, ym * 5 + seed, 3)) * 0.35
        cr = lerp(cr, 178, lime)
        cg = lerp(cg, 160, lime)
        cb = lerp(cb, 140, lime)
        const pit = vnoise(xm * 180 + 3, ym * 180) > 0.86 ? 0.5 : 0
        hgt = 0.72 + 0.12 * (mot - 0.5) - pit * 0.3 + 0.1 * smoothstep(0, 0.006, edge)
        rough = 0.86 + 0.08 * spk
        cr *= 1 - pit * 0.35
        cg *= 1 - pit * 0.35
        cb *= 1 - pit * 0.35
      } else {
        const mn = vnoise(xm * 120, ym * 120)
        const t = 0.8 + 0.4 * mn
        cr = 52 * t
        cg = 48 * t
        cb = 45 * t
        hgt = 0.18 + 0.1 * mn
        rough = 0.95
      }
      // soot: darker in patches and toward the top
      const s = soot * (0.25 + 0.75 * smoothstep(0.35, 0.8, big)) * (0.6 + 0.4 * (1 - py / H))
      cr *= 1 - s * 0.45
      cg *= 1 - s * 0.45
      cb *= 1 - s * 0.45
      if (mask) {
        const a = mask[(py * W + px) * 4 + 3] / 255
        if (a > 0) {
          // distressed paint: missing where the noise is high, thinner in the joints
          const loss = smoothstep(0.52, 0.72, fbm(xm * 30 + 7, ym * 30 + 3, 4)) * 0.85 + (vnoise(xm * 340, ym * 340) > 0.8 ? 0.5 : 0)
          const cover = a * (isBrick ? 0.94 : 0.5) * (1 - clamp(loss))
          const grime = 0.86 + 0.14 * big
          cr = lerp(cr, 226 * grime, cover)
          cg = lerp(cg, 216 * grime, cover)
          cb = lerp(cb, 194 * grime, cover)
          rough = lerp(rough, 0.72, cover)
          hgt += cover * 0.03
        }
      }
      // a little less chroma than a photo (the kit pre-cancels most of the tone-mapping toe)
      const lb = 0.3 * cr + 0.59 * cg + 0.11 * cb
      cr = lb + (cr - lb) * 0.8
      cg = lb + (cg - lb) * 0.8
      cb = lb + (cb - lb) * 0.8
      const i = (py * W + px) * 4
      C[i] = clamp(cr, 0, 255)
      C[i + 1] = clamp(cg, 0, 255)
      C[i + 2] = clamp(cb, 0, 255)
      C[i + 3] = 255
      D[i] = clamp(hgt * 255, 0, 255)
      D[i + 1] = clamp(rough * 255, 0, 255)
      D[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  dg.putImageData(dat, 0, 0)
  return { cv, dv, ppm }
}

const brickCache = new Map<string, PbrMaps>()
/** a cached plain brick tile (1.2 m square) for walls with world-scaled UVs */
export function brickMaps(): PbrMaps {
  const key = 'tile'
  let m = brickCache.get(key)
  if (!m) {
    const { cv, dv } = brickCanvas(1.2 * (0.213 * 6) / 1.278, 0.0667 * 18, { seed: 5 })
    m = { map: texFrom(cv), data: texFrom(dv, { srgb: false }) }
    brickCache.set(key, m)
  }
  return m
}

// ─── LP spines + covers atlas ───────────────────────────────────────────────

/** spine columns in the atlas (top half) and generic cover tiles (bottom half, 8 × 4) */
export const SPINES = 128
export const COVERS = 32

const SPINE_INKS = [
  '#e4dccb', '#d6ccb6', '#cbbd9f', '#b9aa8c', '#efe8d8', '#e8e0cf', '#d9cfba', '#2a2522', '#1c1917', '#3a3430', '#8b8378',
  '#a39a8a', '#9c3a30', '#c48c8c', '#b86f5a', '#56657a', '#6f6a48', '#b8943e', '#c07a4a', '#4f7470', '#6a4b35', '#8a5a3a',
  '#ddd5c4', '#c9bfa8', '#a8322c', '#d7a3a3', '#5d4a3a', '#efe3c8',
]

let spineTex: THREE.Texture | null = null
/**
 * 1024² atlas: 128 worn LP spines (8 px wide, printed bands and title-like
 * dashes — no real words) over 32 generic abstract cover tiles (colour
 * fields, stripes, circles; never real album art).
 */
export function spineAtlas(): THREE.Texture {
  if (spineTex) return spineTex
  const N = 1024
  const { cv, g } = canvas(N)
  const r = rng(404)
  const ink = () => SPINE_INKS[Math.floor(r() * SPINE_INKS.length)]
  const lum = (hex: string) => {
    const c = new THREE.Color(hex)
    return c.r * 0.3 + c.g * 0.59 + c.b * 0.11
  }
  // spines (top half): 512 px tall
  for (let i = 0; i < SPINES; i++) {
    const x = i * 8
    const base = ink()
    g.fillStyle = base
    g.fillRect(x, 0, 8, 512)
    // bands at the ends
    if (r() < 0.6) {
      g.fillStyle = ink()
      const bh = 20 + r() * 90
      g.fillRect(x, r() < 0.5 ? 0 : 512 - bh, 8, bh)
    }
    // title-like dashes down the middle (not letters)
    const light = lum(base) > 0.45
    g.fillStyle = light ? 'rgba(20,16,14,0.78)' : 'rgba(240,232,218,0.8)'
    let yy = 30 + r() * 60
    const words = 2 + Math.floor(r() * 4)
    for (let k = 0; k < words && yy < 480; k++) {
      const len = 16 + r() * 70
      g.fillRect(x + 3, yy, 2, len)
      yy += len + 8 + r() * 26
    }
    if (r() < 0.5) {
      g.fillStyle = r() < 0.5 ? '#d8272e' : light ? '#2a2420' : '#e8dcc4'
      g.fillRect(x + 2, 460 + r() * 30, 4, 10)
    }
    // wear: lighter scuffed edges, darker corners
    g.fillStyle = 'rgba(0,0,0,0.28)'
    g.fillRect(x, 0, 1, 512)
    g.fillRect(x + 7, 0, 1, 512)
    for (let k = 0; k < 6; k++) {
      g.fillStyle = `rgba(255,248,235,${0.05 + r() * 0.12})`
      g.fillRect(x + r() * 6, r() * 512, 1 + r() * 2, 4 + r() * 30)
    }
    const shade = g.createLinearGradient(0, 0, 0, 512)
    shade.addColorStop(0, 'rgba(0,0,0,0.18)')
    shade.addColorStop(0.1, 'rgba(0,0,0,0)')
    shade.addColorStop(0.9, 'rgba(0,0,0,0)')
    shade.addColorStop(1, 'rgba(0,0,0,0.22)')
    g.fillStyle = shade
    g.fillRect(x, 0, 8, 512)
  }
  // covers (bottom half): 8 × 4 tiles of 128²
  for (let i = 0; i < COVERS; i++) {
    const x = (i % 8) * 128
    const y = 512 + Math.floor(i / 8) * 128
    g.save()
    g.beginPath()
    g.rect(x, y, 128, 128)
    g.clip()
    g.fillStyle = ink()
    g.fillRect(x, y, 128, 128)
    const kind = i % 6
    if (kind === 0) {
      g.fillStyle = ink()
      g.beginPath()
      g.arc(x + 30 + r() * 68, y + 30 + r() * 68, 20 + r() * 40, 0, Math.PI * 2)
      g.fill()
    } else if (kind === 1) {
      const n = 3 + Math.floor(r() * 5)
      for (let k = 0; k < n; k++) {
        g.fillStyle = ink()
        g.fillRect(x, y + (k * 128) / n, 128, 128 / n / 2)
      }
    } else if (kind === 2) {
      g.fillStyle = ink()
      g.beginPath()
      g.moveTo(x, y + 128)
      g.lineTo(x + 128, y + r() * 60)
      g.lineTo(x + 128, y + 128)
      g.fill()
    } else if (kind === 3) {
      // soft "photo" blobs
      for (let k = 0; k < 7; k++) {
        const cx = x + r() * 128
        const cy = y + r() * 128
        const rr = 20 + r() * 50
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr)
        gr.addColorStop(0, ink())
        gr.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = gr
        g.fillRect(x, y, 128, 128)
      }
    } else if (kind === 4) {
      const c1 = ink()
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) {
          if ((a + b) % 2) continue
          g.fillStyle = c1
          g.fillRect(x + a * 32 + 3, y + b * 32 + 3, 26, 26)
        }
    } else {
      g.strokeStyle = ink()
      g.lineWidth = 8
      g.strokeRect(x + 12, y + 12, 104, 104)
      g.fillStyle = ink()
      g.fillRect(x + 30, y + 40, 68, 36)
    }
    // ring wear + grime
    g.strokeStyle = 'rgba(255,250,240,0.12)'
    g.lineWidth = 3
    g.beginPath()
    g.arc(x + 64, y + 64, 55, 0, Math.PI * 2)
    g.stroke()
    const gr = g.createRadialGradient(x + 64, y + 64, 30, x + 64, y + 64, 95)
    gr.addColorStop(0, 'rgba(0,0,0,0)')
    gr.addColorStop(1, 'rgba(0,0,0,0.3)')
    g.fillStyle = gr
    g.fillRect(x, y, 128, 128)
    g.restore()
  }
  spineTex = texFrom(cv, { repeat: false, aniso: 4 })
  spineTex.generateMipmaps = true
  return spineTex
}

// ─── chalkboards ────────────────────────────────────────────────────────────

export interface ChalkSpec {
  /** a header line (e.g. the site address) */
  header?: string
  /** the list (each line as given: pass real menu/tap names from content.ts) */
  lines?: string[]
  /** number the lines (1, 2, 3…) like the bar's tap boards */
  numbered?: boolean
  /** first number */
  start?: number
  seed?: number
}

const CHALK_FONT = '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif'

/**
 * A chalkboard face (512 × 1024): black slate, chalk haze and eraser swirls,
 * hand-lettered caps (Inter Tight, jittered) — legible words only from what
 * you pass (content.ts), nothing invented. Redraw once fonts land.
 */
export function drawChalk(g: CanvasRenderingContext2D, W: number, H: number, s: ChalkSpec) {
  const r = rng(s.seed ?? 11)
  g.fillStyle = '#131514'
  g.fillRect(0, 0, W, H)
  // slate grain
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(255,255,255,${0.012 + r() * 0.02})`
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1)
  }
  // haze of old chalk + eraser swirls
  for (let i = 0; i < 26; i++) {
    const x = r() * W
    const y = r() * H
    const rr = 40 + r() * 160
    const gr = g.createRadialGradient(x, y, 0, x, y, rr)
    gr.addColorStop(0, `rgba(230,232,226,${0.03 + r() * 0.05})`)
    gr.addColorStop(1, 'rgba(230,232,226,0)')
    g.fillStyle = gr
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2)
  }
  g.strokeStyle = 'rgba(230,232,226,0.035)'
  for (let i = 0; i < 18; i++) {
    g.lineWidth = 10 + r() * 30
    g.beginPath()
    const x = r() * W
    const y = r() * H
    g.arc(x, y, 40 + r() * 120, r() * 6, r() * 6 + 2 + r() * 2)
    g.stroke()
  }
  const set = (px: number, wgt = 600) => {
    g.font = `${wgt} ${px}px ${CHALK_FONT}`
    ;(g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px * 0.06}px`
  }
  const chalkText = (text: string, x: number, y: number, px: number, maxW: number, align: CanvasTextAlign = 'left') => {
    set(px)
    let w = g.measureText(text).width
    let p = px
    while (w > maxW && p > 9) {
      p *= 0.94
      set(p)
      w = g.measureText(text).width
    }
    g.save()
    g.translate(x, y)
    g.rotate((r() - 0.5) * 0.012)
    g.textAlign = align
    g.fillStyle = 'rgba(238,240,232,0.82)'
    g.fillText(text, 0, 0)
    // a second, offset pass: chalk grain
    g.fillStyle = 'rgba(238,240,232,0.18)'
    g.fillText(text, 0.8, -0.6)
    g.restore()
  }
  const m = W * 0.08
  let y = H * 0.075
  if (s.header) {
    chalkText(s.header.toUpperCase(), W / 2, y, W * 0.052, W - m * 2, 'center')
    y += W * 0.11
  }
  const lines = s.lines ?? []
  const lh = Math.min(W * 0.085, (H * 0.9 - y) / Math.max(1, lines.length))
  lines.forEach((l, i) => {
    const t = (s.numbered ? `${(s.start ?? 1) + i} ` : '') + l.toUpperCase()
    chalkText(t, m, y + lh * 0.72, lh * 0.52, W - m * 2)
    y += lh
  })
  // erosion: chalk never covers evenly
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.5})`
    g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5)
  }
  g.globalCompositeOperation = 'destination-over'
  g.fillStyle = '#131514'
  g.fillRect(0, 0, W, H)
  g.globalCompositeOperation = 'source-over'
}

// ─── hi-fi faces ────────────────────────────────────────────────────────────

let hifi: { map: THREE.Texture; emissive: THREE.Texture } | null = null
/**
 * Faces for the hi-fi stack, 512 × 512 in two halves: the receiver (top: a
 * big volume knob with a blue light ring, a small blue display, buttons) and
 * a streamer/amp (bottom: a slim display, LEDs). No brand marks.
 */
export function hifiMaps() {
  if (hifi) return hifi
  const W = 512
  const { cv, g } = canvas(W)
  const { cv: ev, g: eg } = canvas(W)
  eg.fillStyle = '#000'
  eg.fillRect(0, 0, W, W)
  const r = rng(8)
  const brushed = (y0: number, h: number, base: number) => {
    g.fillStyle = `rgb(${base},${base},${base + 2})`
    g.fillRect(0, y0, W, h)
    for (let i = 0; i < 700; i++) {
      const v = base + (r() - 0.5) * 14
      g.fillStyle = `rgba(${v},${v},${v + 3},0.5)`
      g.fillRect(0, y0 + r() * h, W, 1)
    }
  }
  // receiver (top half: 512 × 256 ↔ 0.43 × 0.15 m front)
  brushed(0, 256, 22)
  g.fillStyle = '#060607'
  g.fillRect(0, 0, W, 6)
  g.fillRect(0, 250, W, 6)
  // display window
  g.fillStyle = '#05070c'
  g.fillRect(40, 70, 150, 54)
  eg.fillStyle = 'rgba(40,110,255,0.9)'
  for (let i = 0; i < 3; i++) eg.fillRect(62 + i * 26, 84, 16, 26)
  eg.fillStyle = 'rgba(40,110,255,0.35)'
  eg.fillRect(140, 88, 36, 6)
  eg.fillRect(140, 100, 24, 6)
  // knob well + light ring
  const kx = 380
  const ky = 124
  const kg = g.createRadialGradient(kx, ky - 10, 4, kx, ky, 62)
  kg.addColorStop(0, '#3a3a3e')
  kg.addColorStop(1, '#0b0b0d')
  g.fillStyle = kg
  g.beginPath()
  g.arc(kx, ky, 60, 0, Math.PI * 2)
  g.fill()
  eg.strokeStyle = 'rgba(50,120,255,1)'
  eg.lineWidth = 7
  eg.beginPath()
  eg.arc(kx, ky, 66, 0, Math.PI * 2)
  eg.stroke()
  eg.strokeStyle = 'rgba(50,120,255,0.35)'
  eg.lineWidth = 16
  eg.beginPath()
  eg.arc(kx, ky, 66, 0, Math.PI * 2)
  eg.stroke()
  g.strokeStyle = '#1c2a4a'
  g.lineWidth = 7
  g.beginPath()
  g.arc(kx, ky, 66, 0, Math.PI * 2)
  g.stroke()
  // buttons + power LED
  for (let i = 0; i < 5; i++) {
    g.fillStyle = '#101012'
    g.fillRect(40 + i * 30, 170, 20, 12)
    g.fillStyle = 'rgba(255,255,255,0.08)'
    g.fillRect(40 + i * 30, 170, 20, 2)
  }
  g.fillStyle = '#0c0c10'
  g.beginPath()
  g.arc(60, 214, 11, 0, Math.PI * 2)
  g.fill()
  eg.fillStyle = 'rgba(60,130,255,1)'
  eg.beginPath()
  eg.arc(60, 214, 5, 0, Math.PI * 2)
  eg.fill()
  // streamer/amp (bottom half)
  brushed(256, 256, 17)
  g.fillStyle = '#050607'
  g.fillRect(0, 256, W, 6)
  g.fillRect(0, 506, W, 6)
  g.fillStyle = '#04060a'
  g.fillRect(170, 350, 180, 40)
  eg.fillStyle = 'rgba(40,110,255,0.55)'
  eg.fillRect(186, 364, 90, 5)
  eg.fillRect(186, 374, 60, 5)
  for (let i = 0; i < 4; i++) {
    eg.fillStyle = i === 2 ? 'rgba(60,220,120,0.9)' : 'rgba(60,130,255,0.7)'
    eg.beginPath()
    eg.arc(60 + i * 22, 440, 3.5, 0, Math.PI * 2)
    eg.fill()
  }
  hifi = { map: texFrom(cv, { repeat: false }), emissive: texFrom(ev, { repeat: false }) }
  return hifi
}

// ─── cooler interiors ───────────────────────────────────────────────────────

let cooler: THREE.Texture | null = null
/** a lit cooler interior (512²): wire shelves of bottles and cans against cool light */
export function coolerMap(): THREE.Texture {
  if (cooler) return cooler
  const W = 512
  const { cv, g } = canvas(W)
  const r = rng(31)
  const bg = g.createLinearGradient(0, 0, 0, W)
  bg.addColorStop(0, '#eef6f2')
  bg.addColorStop(0.5, '#b9ccc6')
  bg.addColorStop(1, '#7f948f')
  g.fillStyle = bg
  g.fillRect(0, 0, W, W)
  const shelves = 3
  for (let s = 0; s < shelves; s++) {
    const y1 = ((s + 1) * W) / shelves - 6
    let x = 4 + r() * 10
    while (x < W - 20) {
      const can = r() < 0.4
      const w = can ? 30 : 34
      const h = can ? 58 : 110 + r() * 30
      const col = can
        ? ['#c23a2e', '#2c5aa0', '#e0b53a', '#3f7f5a', '#d9d4c8'][Math.floor(r() * 5)]
        : ['#3a1e0e', '#2a3a1a', '#4a2a10', '#1c1a18'][Math.floor(r() * 4)]
      g.fillStyle = col
      if (can) g.fillRect(x, y1 - h, w, h)
      else {
        g.fillRect(x, y1 - h * 0.62, w, h * 0.62)
        g.fillRect(x + w * 0.34, y1 - h, w * 0.32, h * 0.4)
        g.fillStyle = 'rgba(240,232,210,0.85)'
        g.fillRect(x + 3, y1 - h * 0.45, w - 6, h * 0.22)
      }
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillRect(x + 4, y1 - h + 6, 3, h - 12)
      x += w + 4 + r() * 6
    }
    g.fillStyle = 'rgba(40,50,48,0.8)'
    g.fillRect(0, y1, W, 5)
  }
  cooler = texFrom(cv)
  return cooler
}

// ─── flex duct, rubber mat ──────────────────────────────────────────────────

let duct: PbrMaps | null = null
/**
 * Insulated flex duct's foil jacket (256², u along the duct = 0.25 m): the
 * wire helix as soft ridges every ~4 cm, the foil between them creased along
 * the duct in short shiny facets (glints) — silver, not fabric.
 */
export function ductMaps(): PbrMaps {
  if (duct) return duct
  const N = 256
  const { cv, g } = canvas(N)
  const { cv: dv, g: dg } = canvas(N)
  const img = g.createImageData(N, N)
  const dat = dg.createImageData(N, N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N
      const v = y / N
      // the helix: 6 ridges per tile, a slight pitch around
      const ph = (u * 6 + v * 0.5) % 1
      const ridge = Math.exp(-((ph - 0.5) * (ph - 0.5)) / 0.012)
      // creases between the ridges: short facets running along the duct (tileable: periodic in both)
      const cx = Math.cos(u * Math.PI * 2)
      const sx = Math.sin(u * Math.PI * 2)
      const crease = vnoise(cx * 2.2 + sx * 1.7 + ph * 3, y * 0.42)
      const facet = Math.abs(crease - 0.5) * 2
      const blot = fbm(cx * 2 + 7, sx * 2 + v * 4, 3)
      const t = 0.9 + 0.12 * ridge + 0.12 * (facet - 0.5) + 0.08 * (blot - 0.5)
      const i = (y * N + x) * 4
      img.data[i] = clamp(196 * t, 0, 255)
      img.data[i + 1] = clamp(198 * t, 0, 255)
      img.data[i + 2] = clamp(200 * t, 0, 255)
      img.data[i + 3] = 255
      dat.data[i] = clamp((0.4 + 0.45 * ridge + 0.14 * facet * (1 - ridge)) * 255, 0, 255)
      dat.data[i + 1] = clamp((0.14 + 0.26 * (1 - facet) * (1 - ridge) + 0.12 * blot) * 255, 0, 255)
      dat.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  dg.putImageData(dat, 0, 0)
  duct = { map: texFrom(cv), data: texFrom(dv, { srgb: false }) }
  return duct
}

let galv: PbrMaps | null = null
/** metres of duct one galvanized tile covers */
export const GALV_TILE = 0.6
/**
 * Galvanized sheet steel (256² for 0.6 m): the zinc SPANGLE (crystals 1.5–4 cm,
 * each its own grey, sheen and feathery grain) with whitish oxidation streaks
 * running across the sheet, as on the trunk duct in ref1. R = height, G = roughness.
 */
export function galvMaps(): PbrMaps {
  if (galv) return galv
  const N = 256
  const r = rng(301)
  // spangle seeds on a jittered grid (tileable: distances wrap)
  const cells: { x: number; y: number; tone: number; rough: number; ang: number; k: number }[] = []
  const G = 20
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++)
      cells.push({ x: ((i + r()) * N) / G, y: ((j + r()) * N) / G, tone: lerp(0.96, 1.04, r()), rough: lerp(0.32, 0.5, r()), ang: r() * Math.PI, k: lerp(0.4, 1, r()) })
  const { cv, g } = canvas(N)
  const { cv: dv, g: dg } = canvas(N)
  const img = g.createImageData(N, N)
  const dat = dg.createImageData(N, N)
  const wrapD = (a: number) => {
    const d = Math.abs(a) % N
    return Math.min(d, N - d)
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // nearest two seeds → the crystal and how close its boundary is
      let d1 = 1e9
      let d2 = 1e9
      let best = cells[0]
      const gi = Math.floor((x * G) / N)
      const gj = Math.floor((y * G) / N)
      for (let k = 0; k < 9; k++) {
        const cl = cells[((gj + ((k / 3) | 0) - 1 + G) % G) * G + ((gi + (k % 3) - 1 + G) % G)]
        const dx = wrapD(x - cl.x)
        const dy = wrapD(y - cl.y)
        const d = dx * dx + dy * dy
        if (d < d1) {
          d2 = d1
          d1 = d
          best = cl
        } else if (d < d2) d2 = d
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1)
      const bound = 1 - smoothstep(0, 1.6, edge)
      // feathery dendrites inside each crystal (directional fine noise)
      const ca = Math.cos(best.ang)
      const sa = Math.sin(best.ang)
      const fx = x * ca + y * sa
      const fy = -x * sa + y * ca
      const feather = vnoise(fx * 0.9, fy * 0.12 + best.ang * 10)
      // oxidation: pale streaks across the sheet (along v), tileable in both axes
      const streak = smoothstep(0.55, 0.85, fbm(Math.cos((x / N) * Math.PI * 2) * 3 + 11, Math.sin((x / N) * Math.PI * 2) * 3 + (y / N) * 0.8, 3))
      const blot = fbm((x / N) * 6, (y / N) * 6, 3)
      let t = best.tone * (0.97 + 0.05 * feather * best.k) - 0.035 * bound
      t = lerp(t, 1.2, streak * 0.3) * (0.95 + 0.1 * blot)
      const i = (y * N + x) * 4
      img.data[i] = clamp(146 * t, 0, 255)
      img.data[i + 1] = clamp(150 * t, 0, 255)
      img.data[i + 2] = clamp(154 * t, 0, 255)
      img.data[i + 3] = 255
      dat.data[i] = clamp((0.55 + 0.05 * feather - 0.06 * bound) * 255, 0, 255)
      dat.data[i + 1] = clamp((best.rough + 0.06 * feather + 0.3 * streak + 0.08 * bound) * 255, 0, 255)
      dat.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  dg.putImageData(dat, 0, 0)
  galv = { map: texFrom(cv), data: texFrom(dv, { srgb: false }) }
  return galv
}

let rubber: THREE.Texture | null = null
/** ribbed rubber bar mat (128² data map for ~0.1 m): raised ribs with drain slots */
export function rubberData(): THREE.Texture {
  if (rubber) return rubber
  const N = 128
  const { cv, g } = canvas(N)
  const img = g.createImageData(N, N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const fx = (x % 16) / 16
      const fy = (y % 16) / 16
      const rib = smoothstep(0.1, 0.2, fx) * (1 - smoothstep(0.8, 0.9, fx))
      const slot = fy > 0.35 && fy < 0.65 && fx > 0.3 && fx < 0.7 ? 1 : 0
      const h = 0.35 + 0.5 * rib - 0.3 * slot
      const i = (y * N + x) * 4
      img.data[i] = h * 255
      img.data[i + 1] = (0.55 + 0.25 * rib) * 255
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  rubber = texFrom(cv, { srgb: false })
  return rubber
}

// ─── glows + TV ─────────────────────────────────────────────────────────────

let glow: THREE.Texture | null = null
/** a soft radial glow (128²), white on black: additive halos around bulbs */
export function glowTexture(): THREE.Texture {
  if (glow) return glow
  const N = 128
  const { cv, g } = canvas(N)
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.08, 'rgba(255,255,255,0.75)')
  gr.addColorStop(0.25, 'rgba(255,255,255,0.22)')
  gr.addColorStop(0.55, 'rgba(255,255,255,0.05)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, N, N)
  glow = texFrom(cv, { repeat: false, srgb: false })
  return glow
}

let pitch: THREE.Texture | null = null
/** a very dim, abstract green pitch for an optional TV (no logos, no text, no flashing) */
export function pitchTexture(): THREE.Texture {
  if (pitch) return pitch
  const W = 512
  const H = 288
  const { cv, g } = canvas(W, H)
  const gr = g.createLinearGradient(0, 0, 0, H)
  gr.addColorStop(0, '#1d4a2a')
  gr.addColorStop(1, '#2f6e3a')
  g.fillStyle = gr
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.04)'
    g.fillRect((i * W) / 8, 0, W / 8, H)
  }
  g.strokeStyle = 'rgba(235,245,235,0.35)'
  g.lineWidth = 2
  g.strokeRect(24, 24, W - 48, H - 48)
  g.beginPath()
  g.moveTo(W / 2, 24)
  g.lineTo(W / 2, H - 24)
  g.stroke()
  g.beginPath()
  g.arc(W / 2, H / 2, 38, 0, Math.PI * 2)
  g.stroke()
  pitch = texFrom(cv, { repeat: false })
  return pitch
}

let grain: THREE.Texture | null = null
/** fine walnut grain (256², tileable): long hairline streaks along u, for close-range detail */
export function grainDetail(): THREE.Texture {
  if (grain) return grain
  const N = 256
  const { cv, g } = canvas(N)
  const img = g.createImageData(N, N)
  const n1 = noise1(77)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // wrap-safe wobble (periodic in x)
      const wob = 2.2 * Math.sin((x / N) * Math.PI * 2 * 2 + y * 0.05) + 1.2 * Math.sin((x / N) * Math.PI * 2 * 5 + 1.3)
      const gy = y + wob
      const lines = n1.n(gy * 1.6) * 0.6 + n1.n(gy * 0.45 + 50) * 0.4
      const pore = hash2((x >> 2) & 63, y) > 0.955 ? 0.35 : 0
      const v = clamp(0.5 + (lines - 0.5) * 1.4 - pore)
      const i = (y * N + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  grain = texFrom(cv, { srgb: false, aniso: 8 })
  return grain
}
