import * as THREE from 'three'
import { nextFrame } from '../../core/yield'
import { brickPixels, galvPixels, runToEnd, walnutPixels, WALNUT_ALONG, WALNUT_TILE, type BrickJob, type BrickPixels, type GalvPixels, type WalnutPixels } from './gen'
import type { TexJobBody } from './texgen.worker'
import { canvas, clamp, fbm, hash2, lerp, noise1, rng, smoothstep, texFrom, vnoise } from './util'

/*
 * ROOM KIT maps — procedural canvases, built once and cached (the shared
 * ones are never disposed by a kit instance). Every "data" map packs
 * R = height (bump) and G = roughness, so one texture serves bumpMap and
 * roughnessMap.
 *
 * COST: the per-pixel maps (walnut, brick panels, galvanized sheet) are built in a worker
 * (texgen.worker.ts) by the *Async makers — the main thread only uploads
 * them. Where a worker can't start they run here in ~8 ms slices. Phones
 * get half-size maps (512² walnut and LP atlas, brick ≤ 512 px): a quarter
 * of the work and the memory, the same layout in metres.
 */

export interface PbrMaps {
  map: THREE.Texture
  /** R = height, G = roughness (use for both bumpMap and roughnessMap) */
  data: THREE.Texture
}

export { WALNUT_TILE, WALNUT_ALONG }

/** phones — the engine's own test (Engine.mobile) */
const PHONE = typeof window !== 'undefined' && typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
/** the big maps' edge in pixels: walnut and the LP atlas; brick panels at most this on their longer side */
export const MAP_MAX = PHONE ? 512 : 1024

// ─── the worker ─────────────────────────────────────────────────────────────

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }
/** undefined: not tried yet; null: none (no Worker, no module workers, or it failed) */
let worker: Worker | null | undefined
let jobId = 1
const pending = new Map<number, Pending>()

function texWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined') return null
  try {
    const w = new Worker(new URL('./texgen.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; out?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.error != null) p.reject(new Error(e.data.error))
      else p.resolve(e.data.out)
    }
    // a worker that can't run (a browser without module workers, a blocked script):
    // everything in flight — and everything after — is built on the main thread instead
    const fail = () => {
      if (worker === w) worker = null
      for (const p of pending.values()) p.reject(new Error('room texture worker failed'))
      pending.clear()
      w.terminate()
    }
    w.onerror = fail
    w.onmessageerror = fail
    worker = w
  } catch {
    worker = null
  }
  return worker
}

/** run a job in the worker (null: no worker — build it here) */
function inWorker<T>(job: TexJobBody, transfer: Transferable[] = []): Promise<T> | null {
  const w = texWorker()
  if (!w) return null
  const id = jobId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage({ ...job, id }, transfer)
    // a watchdog: a worker that never answers must not hold the site's boot hostage
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error('room texture worker timed out'))
    }, 20000)
  })
}

/** drive a slice generator to the end, now */
export const runSync = runToEnd
/** drive a slice generator on the main thread in ~`budget` ms slices, a frame apart */
export async function runAsync<T>(g: Generator<void, T>, budget = 8): Promise<T> {
  let t0 = performance.now()
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
    if (performance.now() - t0 > budget) {
      await nextFrame()
      t0 = performance.now()
    }
  }
}

/** bytes → a canvas (the worker's arrays are plain ArrayBuffers) */
function putPixels(g: CanvasRenderingContext2D, px: Uint8ClampedArray, w: number, h: number) {
  g.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
}

// ─── reclaimed walnut planks ────────────────────────────────────────────────

let walnut: PbrMaps | null = null
let walnutJob: Promise<PbrMaps> | null = null

/** the canvases (+ nail holes) and textures from the generator's bytes */
function walnutFrom(p: WalnutPixels): PbrMaps {
  const N = p.N
  const { cv, g } = canvas(N)
  const { cv: dv, g: dg } = canvas(N)
  putPixels(g, p.C, N, N)
  putPixels(dg, p.D, N, N)
  // nail holes (≈ 3 mm ellipses: the map is 2 : 1), wrapped across the tile's seam
  const ell = (c2: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) => {
    c2.beginPath()
    c2.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
    c2.fill()
  }
  for (let i = 0; i < p.holes.length; i += 2) {
    const x = p.holes[i]
    const y = p.holes[i + 1]
    for (const ox of [-N, 0, N]) {
      g.fillStyle = 'rgba(26,16,11,0.9)'
      ell(g, x + ox, y, p.rx, p.ry)
      g.fillStyle = 'rgba(0,0,0,0.18)'
      ell(g, x + ox, y, p.rx * 1.7, p.ry * 1.7)
      dg.fillStyle = 'rgb(20,240,0)'
      ell(dg, x + ox, y, p.rx, p.ry)
    }
  }
  return { map: texFrom(cv), data: texFrom(dv, { srgb: false }) }
}

/**
 * Reclaimed walnut cladding (gen.ts walnutPixels): 1024² (phones 512²) for
 * 1.2 m across × 2.4 m along the boards. Synchronous: builds it here if
 * prepareRoom()/walnutMapsAsync() hasn't.
 */
export function walnutMaps(): PbrMaps {
  if (!walnut) walnut = walnutFrom(runToEnd(walnutPixels(MAP_MAX)))
  return walnut
}
/** the same, built in the worker (or in slices here): no long task. Call from an async init. */
export function walnutMapsAsync(): Promise<PbrMaps> {
  if (walnut) return Promise.resolve(walnut)
  if (!walnutJob) {
    const here = () => runAsync(walnutPixels(MAP_MAX))
    const w = inWorker<WalnutPixels>({ kind: 'walnut', N: MAP_MAX })
    walnutJob = (w ? w.catch(here) : here()).then(p => (walnut ??= walnutFrom(p)))
  }
  return walnutJob
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

/**
 * Tracked text without canvas `letterSpacing` (Safari has none): each glyph
 * at its kerned position plus `track` px per glyph before it. Like Chrome's
 * letterSpacing, the spacing follows every glyph (the last one too), so
 * centred/right-aligned lines land exactly where they did there.
 */
export function fillTracked(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number, align: CanvasTextAlign = 'left') {
  const prev = g.textAlign
  if (!track) {
    g.textAlign = align
    g.fillText(text, x, y)
    g.textAlign = prev
    return
  }
  const chars = Array.from(text)
  const total = measureTracked(g, text, track)
  const x0 = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x
  g.textAlign = 'left'
  let pre = ''
  chars.forEach((ch, i) => {
    pre += ch
    // the kerned end of this glyph (prefix width) minus its own advance = where it starts
    const at = g.measureText(pre).width - g.measureText(ch).width
    g.fillText(ch, x0 + at + i * track, y)
  })
  g.textAlign = prev
}
/** the width fillTracked draws (spacing after every glyph, as letterSpacing measures) */
export function measureTracked(g: CanvasRenderingContext2D, text: string, track: number) {
  return g.measureText(text).width + Array.from(text).length * track
}

/**
 * Old Philadelphia brick (gen.ts brickPixels: modular 203 × 57 mm, dark
 * recessed mortar), with optional hand-painted lettering: distressed
 * off-white, the brick showing through, the mortar joints less painted.
 * `w × h` metres; ≤ 1024 px (phones ≤ 512).
 */
export interface BrickOpts {
  lines?: PaintLine[]
  seed?: number
  soot?: number
}
const brickPanels = new Map<string, PbrMaps>()
const brickJobs = new Map<string, Promise<PbrMaps>>()
// (numbers rounded: 0.8 + 0.6 must key the same as 1.4)
const brickKey = (w: number, h: number, o: BrickOpts) =>
  JSON.stringify([w, h, o.lines ?? [], o.seed ?? 3, o.soot ?? 0.5], (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v))

/** the job: pixel size + the paint's coverage mask (drawn here: fonts live on the main thread) */
function brickJob(w: number, h: number, { lines = [], seed = 3, soot = 0.5 }: BrickOpts): BrickJob {
  const ppm = Math.min(MAP_MAX / w, MAP_MAX / h, PHONE ? 350 : 700)
  const W = Math.max(8, Math.round(w * ppm))
  const H = Math.max(8, Math.round(h * ppm))
  let mask: Uint8Array | null = null
  if (lines.length) {
    // a CPU canvas (it's read straight back), and only the rows the lettering covers
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.fillStyle = '#fff'
    g.textBaseline = 'alphabetic'
    let y0 = H
    let y1 = 0
    for (const l of lines) {
      const px = (l.size * ppm) / 0.7 // cap height → font size
      g.font = `${l.weight ?? 400} ${px}px ${l.font ?? SERIF}`
      fillTracked(g, l.text, l.x * ppm, l.y * ppm, (l.tracking ?? 0) * px, l.align ?? 'left')
      y0 = Math.min(y0, l.y * ppm - px * 1.1)
      y1 = Math.max(y1, l.y * ppm + px * 0.4)
    }
    y0 = Math.max(0, Math.floor(y0))
    y1 = Math.min(H, Math.ceil(y1))
    mask = new Uint8Array(W * H)
    if (y1 > y0) {
      const a = g.getImageData(0, y0, W, y1 - y0).data
      for (let i = 0, o = y0 * W; i < W * (y1 - y0); i++) mask[o + i] = a[i * 4 + 3]
    }
    cv.width = cv.height = 1
  }
  return { W, H, ppm, seed, soot, mask }
}
function brickCanvases(p: BrickPixels) {
  const { cv, g } = canvas(p.W, p.H)
  const { cv: dv, g: dg } = canvas(p.W, p.H)
  putPixels(g, p.C, p.W, p.H)
  putPixels(dg, p.D, p.W, p.H)
  return { cv, dv }
}
const brickMapsFrom = (p: BrickPixels): PbrMaps => {
  const { cv, dv } = brickCanvases(p)
  return { map: texFrom(cv, { repeat: false }), data: texFrom(dv, { srgb: false, repeat: false }) }
}

/** a brick panel's maps, cached by its arguments (shared: never dispose them). Builds here if not prepared. */
export function brickPanelMaps(w: number, h: number, o: BrickOpts = {}): PbrMaps {
  const k = brickKey(w, h, o)
  let m = brickPanels.get(k)
  if (!m) brickPanels.set(k, (m = brickMapsFrom(runToEnd(brickPixels(brickJob(w, h, o))))))
  return m
}
/** build a brick panel's maps in the worker (or in slices here); then brickPanelMaps with the same arguments is instant */
export function brickPanelMapsAsync(w: number, h: number, o: BrickOpts = {}): Promise<PbrMaps> {
  const k = brickKey(w, h, o)
  const hit = brickPanels.get(k)
  if (hit) return Promise.resolve(hit)
  let job = brickJobs.get(k)
  if (!job) {
    const spec = brickJob(w, h, o)
    const here = () => runAsync(brickPixels(spec))
    // (the mask is copied, not transferred: the fallback may still need it)
    const viaWorker = inWorker<BrickPixels>({ kind: 'brick', job: spec })
    job = (viaWorker ? viaWorker.catch(here) : here()).then(p => {
      let m = brickPanels.get(k)
      if (!m) brickPanels.set(k, (m = brickMapsFrom(p)))
      brickJobs.delete(k)
      return m
    })
    brickJobs.set(k, job)
  }
  return job
}

/** a brick panel's canvases (uncached; the caller owns them) */
export function brickCanvas(w: number, h: number, o: BrickOpts = {}) {
  const spec = brickJob(w, h, o)
  return { ...brickCanvases(runToEnd(brickPixels(spec))), ppm: spec.ppm }
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
 * 1024² atlas (phones 512², the same art at half size): 128 worn LP spines
 * (8 px wide, printed bands and title-like dashes — no real words) over 32
 * generic abstract cover tiles (colour fields, stripes, circles; never real
 * album art).
 */
export function spineAtlas(): THREE.Texture {
  if (spineTex) return spineTex
  const N = MAP_MAX
  const { cv, g } = canvas(N)
  // drawn in 1024 units whatever the size
  g.scale(N / 1024, N / 1024)
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

export const CHALK_FONT = '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif'

/** is the chalk face in (both subsets: beer names carry latin-ext)? */
export function chalkFontReady() {
  try {
    return document.fonts?.check?.(`600 40px ${CHALK_FONT}`, 'AŠ') ?? true
  } catch {
    return true
  }
}

/** the slate's shared texture: light grain specks and the chalk's erosion, as two small tiles */
const SLATE_T = 256
let slateTiles: { grain: HTMLCanvasElement; erosion: HTMLCanvasElement } | null = null
function slateTiles256() {
  if (slateTiles) return slateTiles
  const r = rng(907)
  const T = SLATE_T
  // wrapped rects, so the tiles repeat seamlessly
  const rect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    for (const ox of x + w > T ? [0, -T] : [0]) for (const oy of y + h > T ? [0, -T] : [0]) g.fillRect(x + ox, y + oy, w, h)
  }
  // as dense as the old per-board draws (1,400 specks and 9,000 erosion marks per 512 × 1024 board)
  const per = (n: number) => Math.round((T * T * n) / (512 * 1024))
  const { cv: grain, g: gg } = canvas(T)
  for (let i = 0, n = per(1400); i < n; i++) {
    gg.fillStyle = `rgba(255,255,255,${(0.012 + r() * 0.02).toFixed(3)})`
    rect(gg, r() * T, r() * T, 1 + r() * 2, 1)
  }
  const { cv: erosion, g: eg } = canvas(T)
  for (let i = 0, n = per(9000); i < n; i++) {
    eg.fillStyle = `rgba(0,0,0,${(0.2 + r() * 0.5).toFixed(3)})`
    rect(eg, r() * T, r() * T, 1 + r() * 1.5, 1 + r() * 1.5)
  }
  return (slateTiles = { grain, erosion })
}
/** fill the board with a tile, offset (so no two boards share the pattern's phase) */
function tileFill(g: CanvasRenderingContext2D, tile: HTMLCanvasElement, ox: number, oy: number, W: number, H: number) {
  const pat = g.createPattern(tile, 'repeat')
  if (!pat) return
  g.save()
  g.translate(-ox, -oy)
  g.fillStyle = pat
  g.fillRect(ox, oy, W, H)
  g.restore()
}

/**
 * A chalkboard face (512 × ~1024): black slate, chalk haze and eraser swirls,
 * hand-lettered caps (Inter Tight, jittered, tracked by hand — Safari has no
 * canvas letterSpacing) — legible words only from what you pass (content.ts),
 * nothing invented. The slate grain and the chalk's erosion are two shared
 * tiles laid on with patterns (the old per-board 10,400 fillRects took up to
 * 0.6 s on a slow phone). Draw it once the chalk face is in (chalkFontReady).
 */
export function drawChalk(g: CanvasRenderingContext2D, W: number, H: number, s: ChalkSpec) {
  const r = rng(s.seed ?? 11)
  const tiles = slateTiles256()
  g.globalCompositeOperation = 'source-over'
  g.fillStyle = '#131514'
  g.fillRect(0, 0, W, H)
  // slate grain
  tileFill(g, tiles.grain, Math.floor(r() * SLATE_T), Math.floor(r() * SLATE_T), W, H)
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
  const chalkText = (text: string, x: number, y: number, px: number, maxW: number, align: CanvasTextAlign = 'left') => {
    let p = px
    const fit = () => {
      g.font = `600 ${p}px ${CHALK_FONT}`
      return measureTracked(g, text, p * 0.06)
    }
    let w = fit()
    while (w > maxW && p > 9) {
      p *= 0.94
      w = fit()
    }
    g.save()
    g.translate(x, y)
    g.rotate((r() - 0.5) * 0.012)
    g.fillStyle = 'rgba(238,240,232,0.82)'
    fillTracked(g, text, 0, 0, p * 0.06, align)
    // a second, offset pass: chalk grain
    g.fillStyle = 'rgba(238,240,232,0.18)'
    fillTracked(g, text, 0.8, -0.6, p * 0.06, align)
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
  // erosion: chalk never covers evenly (then the slate shows back through)
  g.globalCompositeOperation = 'destination-out'
  tileFill(g, tiles.erosion, Math.floor(r() * SLATE_T), Math.floor(r() * SLATE_T), W, H)
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
let galvJob: Promise<PbrMaps> | null = null
/** metres of duct one galvanized tile covers */
export const GALV_TILE = 0.6
const galvFrom = (p: GalvPixels): PbrMaps => {
  const { cv, g } = canvas(p.N)
  const { cv: dv, g: dg } = canvas(p.N)
  putPixels(g, p.C, p.N, p.N)
  putPixels(dg, p.D, p.N, p.N)
  return { map: texFrom(cv), data: texFrom(dv, { srgb: false }) }
}
/**
 * Galvanized sheet steel (gen.ts galvPixels: 256² for 0.6 m, the zinc spangle
 * with pale oxidation streaks, as on the trunk duct in ref1). R = height,
 * G = roughness. Builds here if prepareRoom()/galvMapsAsync() hasn't.
 */
export function galvMaps(): PbrMaps {
  if (!galv) galv = galvFrom(runToEnd(galvPixels()))
  return galv
}
/** the same, built in the worker (or in slices here) */
export function galvMapsAsync(): Promise<PbrMaps> {
  if (galv) return Promise.resolve(galv)
  if (!galvJob) {
    const here = () => runAsync(galvPixels())
    const w = inWorker<GalvPixels>({ kind: 'galv' })
    galvJob = (w ? w.catch(here) : here()).then(p => (galv ??= galvFrom(p)))
  }
  return galvJob
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
