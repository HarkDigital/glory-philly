import { clamp, fbm, hash2, lerp, noise1, rng, smoothstep, vnoise } from './noise'

/*
 * ROOM KIT pixel generators: the heavy per-pixel maps (walnut, brick) as pure
 * functions of their arguments → RGBA byte arrays. No DOM, no three: they run
 * in the texture worker (texgen.worker.ts) off the main thread, or — where a
 * worker can't start — on the main thread in ~8 ms slices (textures.ts).
 * Each is a generator that yields every few rows; drive it with runToEnd().
 */

/**
 * The walnut map is stretched 2 : 1 — one tile covers `tile` metres ACROSS
 * the boards and `tile × PLANK_STRETCH` ALONG them — so boards run long (1–2.3
 * m between butt joints at the default 1.2 m tile, as on the real walls) and
 * the grain repeats half as often, at the same cost.
 */
export const PLANK_STRETCH = 2
/** metres of wall one walnut tile covers ACROSS the boards (v) */
export const WALNUT_TILE = 1.2
/** metres one tile covers ALONG the boards (u): the map is stretched 2 : 1 so boards run long */
export const WALNUT_ALONG = WALNUT_TILE * PLANK_STRETCH

/** rows between yields (a slice is a few rows; the runner decides how many slices fit a frame) */
const ROWS = 8

/** drive a slice generator to the end, now */
export function runToEnd<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
  }
}

// ─── reclaimed walnut ───────────────────────────────────────────────────────

/**
 * ONE warm walnut family (sRGB, before the chroma trim below): every board is
 * this colour, nudged a little brighter/darker, a little redder or a little
 * greyer — like the real cladding in ref1/ref2/ref4, where the boards read as
 * one wall, not a patchwork.
 */
const WALNUT_BASE: [number, number, number] = [104, 66, 42]
/** chroma kept (see the tone-mapping note below) */
const WALNUT_CHROMA = 0.68

export interface WalnutPixels {
  N: number
  /** RGBA colour, row 0 = the canvas's top row */
  C: Uint8ClampedArray
  /** RGBA data: R = height, G = roughness */
  D: Uint8ClampedArray
  /** nail holes (x, y pixel centre pairs) and their radii in pixels: drawn on a canvas after */
  holes: number[]
  rx: number
  ry: number
}

/**
 * Reclaimed walnut cladding, N² for 1.2 m across × 2.4 m along the boards:
 * long boards (10–16 cm wide, 1–2.3 m between butt joints) in one warm walnut
 * family (±7 % in value, a slight red/grey drift board to board), soft grain
 * with the odd cathedral figure, pores along the grain, faint saw marks, butt
 * joints with nail pairs; satin (roughness ~0.5). The layout is in metres, so
 * a phone's 512² map is the same wall at half the resolution.
 */
export function* walnutPixels(N = 1024): Generator<void, WalnutPixels> {
  /** metres per pixel along (u) and across (v) the boards */
  const MU = WALNUT_ALONG / N
  const MV = WALNUT_TILE / N
  /** the map's scale against the 1024² it was tuned at (joints/pores are drawn in pixels) */
  const k = N / 1024
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
    for (let q = row.y0; q < row.y0 + row.h; q++) rowOf[q] = i
  })
  const n1 = noise1(5)
  const n2 = noise1(9)
  const C = new Uint8ClampedArray(N * N * 4)
  const D = new Uint8ClampedArray(N * N * 4)
  const TAU = Math.PI * 2
  // joints: a fine dark line (≈ 1.2 px at 1024), a hint of an arris over ≈ 1.4 px more;
  // a smaller map keeps the same weight by darkening its one-pixel line less
  const seamPx = Math.max(0.6, 1.2 * k)
  const seamDark = 1 - 0.6 * Math.min(1, k * 1.15)
  const arrisPx = 1.4 * Math.max(0.5, k)
  const porePx = Math.max(1, 2 * k)
  for (let py = 0; py < N; py++) {
    if (py % ROWS === ROWS - 1) yield
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
      const pore = hash2(Math.floor(u / porePx) + Math.floor(s.seed), py) > 0.976 ? 1 : 0
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
        const kk = 1 - smoothstep(bound - 0.05, bound + 0.03, edgeV)
        cr = lerp(cr, 150 * tone, kk * 0.45)
        cg = lerp(cg, 112 * tone, kk * 0.45)
        cb = lerp(cb, 80 * tone, kk * 0.45)
      }
      let hgt = 0.62 + 0.1 * (fine - 0.5) + 0.07 * (streak - 0.5) - 0.1 * pore
      let rough = s.rough + 0.04 * (fine - 0.5) + 0.05 * (1 - mott)
      // bevelled seams between boards (≈ 1.4 mm gap) + butt joints (≈ 2.3 mm)
      const eV = dvEdge
      const eU = duEdge * (MU / MV)
      const e = Math.min(eV, eU)
      // tight joints (the real cladding butts closely: a fine dark line, a hint of an arris)
      if (e < seamPx) {
        cr *= seamDark + 0.02
        cg *= seamDark
        cb *= seamDark
        hgt = 0.3
        rough = 0.85
      } else if (e < seamPx + arrisPx) {
        const q = (e - seamPx) / arrisPx
        hgt *= 0.75 + 0.25 * q
        const dk = 0.88 + 0.12 * q
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
      C[i] = cr
      C[i + 1] = cg
      C[i + 2] = cb
      C[i + 3] = 255
      D[i] = hgt * 255
      D[i + 1] = rough * 255
      D[i + 2] = 0
      D[i + 3] = 255
    }
  }
  // nail holes (≈ 3 mm; the map is 2 : 1, so they're ellipses): pairs by the butt joints, a few strays
  const holes: number[] = []
  for (const row of rows)
    for (const s of row.segs) {
      if (s.len < N) {
        const x = (s.x0 + 0.02 / MU) % N
        holes.push(x, row.y0 + row.h * 0.3, x, row.y0 + row.h * 0.7)
      }
      if (r() < 0.25) holes.push((s.x0 + r() * s.len) % N, row.y0 + row.h * (r() < 0.5 ? 0.28 : 0.72))
    }
  return { N, C, D, holes, rx: 0.0014 / MU, ry: 0.0014 / MV }
}

// ─── brick ──────────────────────────────────────────────────────────────────

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

export interface BrickJob {
  W: number
  H: number
  /** pixels per metre */
  ppm: number
  seed: number
  soot: number
  /** the paint's coverage (0..255 per pixel, W × H), or null for bare brick */
  mask: Uint8Array | null
}
export interface BrickPixels {
  W: number
  H: number
  C: Uint8ClampedArray
  D: Uint8ClampedArray
}

/**
 * Old Philadelphia brick (modular 203 × 57 mm, dark recessed mortar), with
 * optional hand-painted lettering (`mask`): distressed off-white, the brick
 * showing through, the mortar joints less painted. The slow fields (soot
 * patches, lime ghosts, the chipped arrises' wander) are sampled on a 4 px
 * grid and interpolated: they're smooth at that scale, and it halves the cost.
 */
export function* brickPixels({ W, H, ppm, seed, soot, mask }: BrickJob): Generator<void, BrickPixels> {
  const r = rng(seed)
  const pickT = BRICK_W.reduce((a, b) => a + b, 0)
  const C = new Uint8ClampedArray(W * H * 4)
  const D = new Uint8ClampedArray(W * H * 4)
  const course = 0.0667
  const pitch = 0.213
  const mort = 0.0098
  const rowOff: number[] = []
  for (let i = 0; i < 64; i++) rowOff.push((i % 2) * pitch * 0.5 + (r() - 0.5) * 0.02)
  // the slow fields on a coarse grid (bilinear): soot patches, lime ghosts, the arris wander
  const G = 4
  const gw = Math.ceil(W / G) + 2
  const gh = Math.ceil(H / G) + 2
  const BIG = new Float32Array(gw * gh)
  const LIME = new Float32Array(gw * gh)
  const CHIP = new Float32Array(gw * gh)
  for (let j = 0; j < gh; j++) {
    const ym = (j * G) / ppm
    for (let i = 0; i < gw; i++) {
      const xm = (i * G) / ppm
      const q = j * gw + i
      BIG[q] = fbm(xm * 1.6 + seed, ym * 1.6, 3)
      LIME[q] = fbm(xm * 5 + 9, ym * 5 + seed, 3)
      CHIP[q] = vnoise(xm * 22 + 5, ym * 22)
    }
    if (j % 32 === 31) yield
  }
  for (let py = 0; py < H; py++) {
    if (py % ROWS === ROWS - 1) yield
    const ym = py / ppm
    const row = Math.floor(ym / course)
    const fy = ym - row * course
    const gy = py / G
    const j0 = Math.floor(gy)
    const ty = gy - j0
    const topFade = 0.6 + 0.4 * (1 - py / H)
    for (let px = 0; px < W; px++) {
      const xm = px / ppm
      // the coarse fields at this pixel
      const gx = px / G
      const i0 = Math.floor(gx)
      const tx = gx - i0
      const q = j0 * gw + i0
      const w00 = (1 - tx) * (1 - ty)
      const w10 = tx * (1 - ty)
      const w01 = (1 - tx) * ty
      const w11 = tx * ty
      const big = BIG[q] * w00 + BIG[q + 1] * w10 + BIG[q + gw] * w01 + BIG[q + gw + 1] * w11
      const chip2 = CHIP[q] * w00 + CHIP[q + 1] * w10 + CHIP[q + gw] * w01 + CHIP[q + gw + 1] * w11
      const xo = xm + rowOff[row & 63] + seed
      const col = Math.floor(xo / pitch)
      const fx = xo - col * pitch
      const id = hash2(col + seed * 7, row + seed * 13)
      // chipped arrises: the mortar line wanders
      const chip = (vnoise(xm * 90, ym * 90) - 0.5) * 0.0035 + (chip2 - 0.5) * 0.003
      const ex = Math.min(fx, pitch - fx)
      const ey = Math.min(fy, course - fy)
      const edge = Math.min(ex, ey) - mort * 0.5 - chip
      const isBrick = edge > 0
      let cr: number
      let cg: number
      let cb: number
      let hgt: number
      let rough: number
      if (isBrick) {
        let t = id * pickT
        let c = BRICKS[0]
        for (let kk = 0; kk < BRICKS.length; kk++)
          if ((t -= BRICK_W[kk]) <= 0) {
            c = BRICKS[kk]
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
        const limeN = LIME[q] * w00 + LIME[q + 1] * w10 + LIME[q + gw] * w01 + LIME[q + gw + 1] * w11
        const lime = smoothstep(0.66, 0.9, limeN) * 0.35
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
      const s = soot * (0.25 + 0.75 * smoothstep(0.35, 0.8, big)) * topFade
      cr *= 1 - s * 0.45
      cg *= 1 - s * 0.45
      cb *= 1 - s * 0.45
      if (mask) {
        const a = mask[py * W + px] / 255
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
      const i = (py * W + px) * 4
      C[i] = lb + (cr - lb) * 0.8
      C[i + 1] = lb + (cg - lb) * 0.8
      C[i + 2] = lb + (cb - lb) * 0.8
      C[i + 3] = 255
      D[i] = hgt * 255
      D[i + 1] = rough * 255
      D[i + 3] = 255
    }
  }
  return { W, H, C, D }
}

// ─── galvanized sheet ───────────────────────────────────────────────────────

export interface GalvPixels {
  N: number
  C: Uint8ClampedArray
  D: Uint8ClampedArray
}

/**
 * Galvanized sheet steel (256² for 0.6 m): the zinc SPANGLE (crystals 1.5–4 cm,
 * each its own grey, sheen and feathery grain) with whitish oxidation streaks
 * running across the sheet, as on the trunk duct in ref1. Tileable.
 */
export function* galvPixels(N = 256): Generator<void, GalvPixels> {
  const r = rng(301)
  // spangle seeds on a jittered grid (tileable: distances wrap)
  const cells: { x: number; y: number; tone: number; rough: number; ang: number; k: number }[] = []
  const G = 20
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++)
      cells.push({ x: ((i + r()) * N) / G, y: ((j + r()) * N) / G, tone: lerp(0.96, 1.04, r()), rough: lerp(0.32, 0.5, r()), ang: r() * Math.PI, k: lerp(0.4, 1, r()) })
  const C = new Uint8ClampedArray(N * N * 4)
  const D = new Uint8ClampedArray(N * N * 4)
  const wrapD = (a: number) => {
    const d = Math.abs(a) % N
    return Math.min(d, N - d)
  }
  for (let y = 0; y < N; y++) {
    if (y % ROWS === ROWS - 1) yield
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
      C[i] = 146 * t
      C[i + 1] = 150 * t
      C[i + 2] = 154 * t
      C[i + 3] = 255
      D[i] = (0.55 + 0.05 * feather - 0.06 * bound) * 255
      D[i + 1] = (best.rough + 0.06 * feather + 0.3 * streak + 0.08 * bound) * 255
      D[i + 3] = 255
    }
  }
  return { N, C, D }
}
