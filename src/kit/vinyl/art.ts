import * as THREE from 'three'
import { BRAND } from '../../content'

/*
 * VINYL KIT print design: Glory's house label ("Glory Records", catalogue
 * GLY-001…), sleeve fronts (a full-bleed photo with a title band, or a
 * typographic cover), sleeve backs as TRACKLISTS (auto-fit, split across
 * sides/columns), 7" company sleeves with a die-cut centre, and the paper
 * inner sleeve. Drawn with 2D canvas in the site's two faces (Mike's rules:
 * no italic serif, no IBM Plex Mono, anywhere):
 *   Alfa Slab One — titles only (the painted wall sign's slab)
 *   Inter Tight 400–700 — everything else: subs and notes in sentence case,
 *   labels / catalogue lines / numbers / prices in tracked caps.
 * "33⅓" is set from Inter Tight's own figures (fillText() below): the web
 * font subset has no fraction glyphs, so the browser would fall back.
 * Paper grain, ring wear and scuffs are added by the sleeve shader, so these
 * canvases are pure type and layout. Every draw function takes (ctx, x0, y0,
 * size, spec) so it can also paint one cell of an atlas.
 *
 * Fonts: `await loadVinylFonts()` before drawing; redraw with `onFonts(draw)`
 * (it runs `draw` once the faces are in and again on document.fonts.ready).
 */

export const FONT = {
  /** titles */
  display: '"Alfa Slab One", Rockwell, Georgia, serif',
  /** everything else (400–700) */
  sans: '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif',
  /** labels, numbers, prices (tracked caps) — the same face; the old mono slot, kept so chapters' FONT.mono still works */
  mono: '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif',
}

/** Glory palette (sRGB) */
export const INKS = {
  cream: '#f3ead8',
  paper: '#efe5d0',
  stout: '#0d0806',
  ink: '#1a110c',
  red: '#d8272e',
  amber: '#f0a53a',
  brick: '#7a3524',
  bone: '#ece6da',
}

export type PaperName = 'cream' | 'red' | 'stout' | 'amber' | 'bone'

interface Scheme {
  paper: string
  fg: string
  muted: string
  accent: string
  /** dark board (sleeve edges/wear go light) */
  ink: boolean
}

export function scheme(p: PaperName | undefined): Scheme {
  switch (p) {
    case 'red':
      return { paper: INKS.red, fg: INKS.cream, muted: 'rgba(243,234,216,0.78)', accent: INKS.cream, ink: true }
    case 'stout':
      return { paper: '#140d0a', fg: INKS.cream, muted: 'rgba(243,234,216,0.66)', accent: '#ff5a5f', ink: true }
    case 'amber':
      return { paper: INKS.amber, fg: INKS.ink, muted: 'rgba(26,17,12,0.7)', accent: '#8a1a14', ink: false }
    case 'bone':
      return { paper: INKS.bone, fg: INKS.ink, muted: 'rgba(26,17,12,0.62)', accent: INKS.red, ink: false }
    default:
      return { paper: INKS.paper, fg: INKS.ink, muted: 'rgba(26,17,12,0.62)', accent: INKS.red, ink: false }
  }
}

/** The house label's rim line (decorative; built from BRAND). */
export const RIM_TEXT = `${BRAND.name.toUpperCase()} · 126 CHESTNUT ST · ${BRAND.neighborhood.toUpperCase()} PHILADELPHIA · `

/** the motto as the sign sets it: caps, no full stop ("THIS MUST BE THE PLACE") */
const mottoCaps = () => BRAND.motto.replace(/[.!]+$/, '').toUpperCase()

/** "GLY-001" */
export const catNo = (n: number) => `GLY-${String(n).padStart(3, '0')}`

// ─── fonts ──────────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null
/** Load the faces the canvases use (they aren't fetched until something asks). Resolves within ~4 s. */
export function loadVinylFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise
  const fonts = document.fonts
  if (!fonts?.load) return (fontsPromise = Promise.resolve())
  // exactly the faces the canvases draw with; the sample text pulls in the
  // latin AND latin-ext subsets (beer names: "Šariš", "Łomża"…)
  const faces = [`400 40px ${FONT.display}`, ...[400, 500, 600, 700].map(w => `${w} 40px ${FONT.sans}`)]
  const all = Promise.all(faces.map(f => fonts.load(f, 'Glory 33 – G ĀŁŠ').catch(() => []))).then(() => undefined)
  const timeout = new Promise<void>(r => setTimeout(r, 4000))
  fontsPromise = Promise.race([all, timeout])
  return fontsPromise
}

/**
 * Run `draw` once the faces are loaded, and again when document.fonts.ready
 * settles (if that's later) so a slow face never leaves fallback type.
 */
export function onFonts(draw: () => void): Promise<void> {
  let ran = false
  const p = loadVinylFonts().then(() => {
    ran = true
    draw()
  })
  document.fonts?.ready.then(() => {
    if (ran) {
      // a face that landed after the race: redraw once
      if (document.fonts.status === 'loaded') draw()
    }
  })
  return p
}

// ─── canvas helpers ─────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D

/*
 * Tracking (letter-spacing) that works everywhere. Canvas `letterSpacing`
 * is missing in Safari (the build targets safari15) and Firefox < 115; there,
 * setting it is a silent no-op and every tracked-caps label drew untracked.
 * setTracking() records the tracking per context and uses the native property
 * where it exists; fillText() / measure() below honour it, placing each
 * character at its kerned origin + i × tracking where it doesn't, with the
 * same metrics Chrome uses (tracking after every character, the last one
 * included), so layouts, fits and ellipses match across engines.
 * Draw and measure tracked text through fillText()/measure(), never
 * ctx.fillText()/ctx.measureText().
 */
const NATIVE_TRACKING = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype
const tracking = new WeakMap<Ctx, number>()

/** Set the tracking (px) for later fillText()/measure() calls on this context (0 = none). */
export function setTracking(ctx: Ctx, px: number) {
  if (NATIVE_TRACKING) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`
  if (px) tracking.set(ctx, px)
  else tracking.delete(ctx)
}
/** the tracking set on this context with setTracking() */
export const getTracking = (ctx: Ctx) => tracking.get(ctx) ?? 0
/** tracking the browser won't apply itself (0 where canvas letterSpacing exists) */
const emulated = (ctx: Ctx) => (NATIVE_TRACKING ? 0 : (tracking.get(ctx) ?? 0))
const track = setTracking

/** user-perceived characters (a base + its combining marks) */
const clusters = (text: string) => text.match(/\P{M}\p{M}*/gu) ?? []

/** width of a plain run at the current font and tracking */
function runWidth(ctx: Ctx, text: string) {
  const w = ctx.measureText(text).width
  const sp = emulated(ctx)
  return sp ? w + clusters(text).length * sp : w
}
/** a plain run, left-aligned at x; emulated tracking places each character at its kerned origin */
function drawRun(ctx: Ctx, text: string, x: number, y: number) {
  const sp = emulated(ctx)
  if (!sp) {
    ctx.fillText(text, x, y)
    return
  }
  let prefix = ''
  clusters(text).forEach((c, i) => {
    prefix += c
    // measure(prefix) − measure(c) keeps the kern between c and the character before it
    ctx.fillText(c, x + ctx.measureText(prefix).width - ctx.measureText(c).width + i * sp, y)
  })
}

/** a sub / note line: Inter Tight, sentence case */
export const subFont = (px: number, weight = 500) => `${weight} ${px}px ${FONT.sans}`
/** a label: Inter Tight caps (pair with tracking) */
export const capsFont = (px: number, weight = 600) => `${weight} ${px}px ${FONT.sans}`

const FRAC = '⅓'
const pxOf = (font: string) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font)
  return m ? parseFloat(m[1]) : 16
}
/** width of `text` at the current font and tracking, "⅓" measured the way fillText() sets it */
export function measure(ctx: Ctx, text: string): number {
  if (!text.includes(FRAC)) return runWidth(ctx, text)
  const font = ctx.font
  const px = pxOf(font)
  const parts = text.split(FRAC)
  let w = parts.reduce((a, p) => a + runWidth(ctx, p), 0)
  ctx.font = font.replace(/(\d+(?:\.\d+)?)px/, `${(px * 0.62).toFixed(2)}px`)
  w += (parts.length - 1) * (runWidth(ctx, '1') + runWidth(ctx, '3') + px * 0.14)
  ctx.font = font
  return w
}
/**
 * ctx.fillText that honours textAlign and the tracking set with
 * setTracking() (in every browser), and sets "⅓" from the face's own
 * figures (a raised 1, a fraction slash, a 3) so it never falls back.
 */
export function fillText(ctx: Ctx, text: string, x: number, y: number) {
  const frac = text.includes(FRAC)
  if (!frac && !emulated(ctx)) {
    ctx.fillText(text, x, y)
    return
  }
  const font = ctx.font
  const align = ctx.textAlign
  const px = pxOf(font)
  const small = font.replace(/(\d+(?:\.\d+)?)px/, `${(px * 0.62).toFixed(2)}px`)
  const total = measure(ctx, text)
  let cx = align === 'right' || align === 'end' ? x - total : align === 'center' ? x - total / 2 : x
  ctx.textAlign = 'left'
  if (!frac) {
    drawRun(ctx, text, cx, y)
    ctx.textAlign = align
    return
  }
  const parts = text.split(FRAC)
  parts.forEach((p, i) => {
    ctx.font = font
    drawRun(ctx, p, cx, y)
    cx += runWidth(ctx, p)
    if (i === parts.length - 1) return
    ctx.font = small
    drawRun(ctx, '1', cx, y - px * 0.3)
    cx += runWidth(ctx, '1')
    // the fraction slash
    ctx.save()
    ctx.strokeStyle = ctx.fillStyle
    ctx.lineWidth = Math.max(1, px * 0.075)
    ctx.beginPath()
    ctx.moveTo(cx + px * 0.01, y + px * 0.02)
    ctx.lineTo(cx + px * 0.13, y - px * 0.72)
    ctx.stroke()
    ctx.restore()
    cx += px * 0.14
    drawRun(ctx, '3', cx, y)
    cx += runWidth(ctx, '3')
  })
  ctx.font = font
  ctx.textAlign = align
}

/** Largest font size (<= px) at which `text` fits `maxW`. Sets ctx.font. */
export function fit(ctx: Ctx, text: string, font: (px: number) => string, px: number, maxW: number, min = 8) {
  let s = px
  for (let i = 0; i < 12; i++) {
    ctx.font = font(s)
    const w = measure(ctx, text)
    if (w <= maxW || s <= min) break
    s = Math.max(min, s * (maxW / w) * 0.995)
  }
  ctx.font = font(s)
  return s
}

/** Truncate with an ellipsis to fit maxW at the current font and tracking. */
function ellipsize(ctx: Ctx, text: string, maxW: number) {
  if (measure(ctx, text) <= maxW) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measure(ctx, text.slice(0, mid).trimEnd() + '…') <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo).trimEnd() + '…'
}

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (measure(ctx, t) > maxW && line) {
      lines.push(line)
      line = w
    } else line = t
  }
  if (line) lines.push(line)
  return lines
}

/** Balanced wrap of a title into at most `maxLines` lines at the largest size that fits (w × h box). */
function fitBlock(ctx: Ctx, text: string, font: (px: number) => string, maxPx: number, w: number, h: number, maxLines: number, lead = 0.92) {
  let px = maxPx
  let lines: string[] = [text]
  for (let i = 0; i < 24; i++) {
    ctx.font = font(px)
    lines = wrap(ctx, text, w)
    const widest = Math.max(...lines.map(l => measure(ctx, l)))
    if (lines.length <= maxLines && widest <= w && lines.length * px * lead <= h) break
    px *= 0.93
  }
  ctx.font = font(px)
  return { px, lines }
}

/** Characters around a circle, clockwise from `start` (radians, 0 = right, -π/2 = top), filling the ring. */
export function ringText(ctx: Ctx, text: string, cx: number, cy: number, R: number, px: number, color: string, start = -Math.PI / 2, font = FONT.mono) {
  const prevTracking = getTracking(ctx)
  ctx.save()
  ctx.font = `600 ${px}px ${font}`
  // spaced by hand (px × 0.16 per character), in every browser
  track(ctx, 0)
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
  const circ = Math.PI * 2 * R
  const chars = [...text]
  const widths = chars.map(c => ctx.measureText(c).width)
  const one = widths.reduce((a, b) => a + b, 0) + chars.length * px * 0.16
  const reps = Math.max(1, Math.floor(circ / one))
  // stretch the spacing so the repeats close the ring exactly
  const spare = (circ - one * reps) / (chars.length * reps)
  let a = start
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < chars.length; i++) {
      const w = widths[i] + px * 0.16 + spare
      a += w / 2 / R
      ctx.save()
      ctx.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
      ctx.rotate(a + Math.PI / 2)
      ctx.fillText(chars[i], 0, 0)
      ctx.restore()
      a += w / 2 / R
    }
  }
  ctx.restore()
  track(ctx, prevTracking)
}

/** the site mark's G (src/ui/mark.ts, viewBox 0 0 100 100): one closed contour, no font needed */
const G_PATH = 'M73.75 30.07A31 31 0 1 0 81 50V45H51V57H63.27A15 15 0 1 1 61.49 40.36Z'
let gPath: Path2D | null = null

/**
 * The red-ring "G" roundel (the sign's stamp): white disc, red ring, heavy
 * black G — the same drawing as the site's mark (disc radius r).
 */
export function drawRoundel(ctx: Ctx, cx: number, cy: number, r: number, opts: { disc?: string; ring?: string; g?: string } = {}) {
  const k = r / 49
  ctx.save()
  ctx.translate(cx - 50 * k, cy - 50 * k)
  ctx.scale(k, k)
  ctx.fillStyle = opts.disc ?? '#fffdf8'
  ctx.beginPath()
  ctx.arc(50, 50, 49, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = opts.ring ?? INKS.red
  ctx.lineWidth = 3.4
  ctx.beginPath()
  ctx.arc(50, 50, 44.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = opts.g ?? '#0d0806'
  gPath ??= new Path2D(G_PATH)
  ctx.fill(gPath)
  ctx.restore()
}

/** Cover-crop a source into a rect (never stretched). focus: 0..1 where the crop centres. */
export function drawCoverImage(ctx: Ctx, src: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, focus: [number, number] = [0.5, 0.5]) {
  const sw = (src as HTMLImageElement).naturalWidth || src.width
  const sh = (src as HTMLImageElement).naturalHeight || src.height
  if (!sw || !sh) return
  const s = Math.max(w / sw, h / sh)
  const cw = w / s
  const ch = h / s
  const sx = Math.min(sw - cw, Math.max(0, (sw - cw) * focus[0]))
  const sy = Math.min(sh - ch, Math.max(0, (sh - ch) * focus[1]))
  ctx.drawImage(src, sx, sy, cw, ch, x, y, w, h)
}

// ─── loading ────────────────────────────────────────────────────────────────

export type CoverSource = (ImageBitmap | HTMLCanvasElement | HTMLImageElement) & { width: number; height: number }

/**
 * Load a photo for a cover: decoded OFF the main thread, cover-cropped to a
 * `size`² square (or, with `square: false`, resized to `size` wide keeping its
 * aspect). Never stretched. Falls back to <img>.decode() + canvas.
 *
 *   const photo = await loadCover('photos/mussels.webp', { size: 1024 })
 */
export async function loadCover(url: string, { size = 1024, square = true, focus = [0.5, 0.5] as [number, number] } = {}): Promise<CoverSource> {
  const out = (w: number, h: number) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap')
    const blob = await (await fetch(url)).blob()
    const full = await createImageBitmap(blob)
    const sw = full.width
    const sh = full.height
    let bmp: ImageBitmap
    if (square) {
      const side = Math.min(sw, sh)
      const sx = Math.round((sw - side) * focus[0])
      const sy = Math.round((sh - side) * focus[1])
      bmp = await createImageBitmap(full, sx, sy, side, side, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' })
    } else {
      bmp = await createImageBitmap(full, { resizeWidth: size, resizeHeight: Math.round((size * sh) / sw), resizeQuality: 'high' })
    }
    full.close()
    return bmp
  } catch {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const sw = img.naturalWidth
    const sh = img.naturalHeight
    const c = square ? out(size, size) : out(size, Math.round((size * sh) / sw))
    drawCoverImage(c.getContext('2d')!, img as CoverSource, 0, 0, c.width, c.height, focus)
    return c
  }
}

/** A CanvasTexture over a fresh canvas (sRGB, anisotropic), for art you draw into. */
export function artCanvas(w: number, h = w, fill = INKS.paper) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, w, h)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return { canvas, ctx, texture }
}

// ─── record labels ──────────────────────────────────────────────────────────

export interface LabelSpec {
  title: string
  /** a line under the title (Inter Tight, sentence case) */
  sub?: string
  /** "SIDE A" */
  side?: string
  /** "GLY-001" */
  cat?: string
  paper?: PaperName
  /** 7" layout (around the big hole) */
  seven?: boolean
  /** "33⅓" (12") / "45" (7") by default */
  rpm?: string
  /** rim line (default RIM_TEXT) */
  rim?: string
}

/**
 * The Glory house label into a square (x0, y0, size): the red-ring G roundel,
 * a text ring, the title in the sign's slab, side and speed. The record maps
 * the label circle inscribed in this square; the centre hole is geometric.
 */
export function drawLabel(ctx: Ctx, x0: number, y0: number, size: number, s: LabelSpec) {
  const sc = scheme(s.paper ?? 'cream')
  const u = (v: number) => (v * size) / 512
  const c = size / 2
  ctx.save()
  ctx.translate(x0, y0)
  ctx.beginPath()
  ctx.rect(0, 0, size, size)
  ctx.clip()
  ctx.fillStyle = sc.paper
  ctx.fillRect(0, 0, size, size)
  ctx.textBaseline = 'alphabetic'

  // printed rings
  ctx.strokeStyle = sc.fg
  ctx.globalAlpha = 0.55
  ctx.lineWidth = u(1.4)
  ctx.beginPath()
  ctx.arc(c, c, u(214), 0, Math.PI * 2)
  ctx.stroke()
  if (sc.accent !== sc.fg) {
    ctx.strokeStyle = sc.accent
    ctx.globalAlpha = 0.9
    ctx.lineWidth = u(3)
    ctx.beginPath()
    ctx.arc(c, c, u(207), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ringText(ctx, s.rim ?? RIM_TEXT, c, c, u(232), u(12.5), sc.muted)

  const rpm = s.rpm ?? (s.seven ? '45' : '33⅓')
  const side = s.side ?? 'SIDE A'
  ctx.fillStyle = sc.fg
  ctx.textAlign = 'center'
  if (s.seven) {
    // around the big hole (r ≈ 111 of 256): roundel above, title below, side | speed either side
    drawRoundel(ctx, c, c - u(160), u(34))
    track(ctx, u(2))
    ctx.font = capsFont(u(14.5))
    fillText(ctx, side, c - u(166), c + u(6))
    fillText(ctx, `${rpm} RPM`, c + u(166), c + u(6))
    track(ctx, 0)
    const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(30), u(250), u(12))
    fillText(ctx, s.title, c, c + u(140) + tpx * 0.35)
    if (s.sub) {
      ctx.fillStyle = sc.muted
      fit(ctx, s.sub, px => subFont(px), u(18), u(200), u(10))
      fillText(ctx, ellipsize(ctx, s.sub, u(200)), c, c + u(172) + tpx * 0.2)
    }
    if (s.cat) {
      ctx.fillStyle = sc.fg
      track(ctx, u(2))
      ctx.font = capsFont(u(11))
      fillText(ctx, s.cat, c, c - u(118))
    }
  } else {
    drawRoundel(ctx, c, c - u(132), u(50))
    track(ctx, u(2.4))
    ctx.font = capsFont(u(10.5))
    ctx.fillStyle = sc.muted
    fillText(ctx, 'GLORY RECORDS', c, c - u(66))
    ctx.fillStyle = sc.fg
    track(ctx, u(2.2))
    ctx.font = capsFont(u(14.5))
    fillText(ctx, side, c - u(112), c + u(5))
    fillText(ctx, rpm, c + u(112), c + u(5))
    track(ctx, 0)
    const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(38), u(300), u(14))
    fillText(ctx, s.title, c, c + u(62) + tpx * 0.35)
    if (s.sub) {
      ctx.fillStyle = sc.muted
      fit(ctx, s.sub, px => subFont(px), u(21), u(280), u(11))
      fillText(ctx, ellipsize(ctx, s.sub, u(280)), c, c + u(98) + tpx * 0.35)
    }
    ctx.fillStyle = sc.fg
    track(ctx, u(2.4))
    ctx.font = capsFont(u(11.5))
    fillText(ctx, `${s.cat ?? catNo(1)} · STEREO`, c, c + u(150))
  }
  track(ctx, 0)
  ctx.textAlign = 'left'
  ctx.restore()
}

// ─── sleeve fronts ──────────────────────────────────────────────────────────

export interface CoverSpec {
  title: string
  /** a line under the title (Inter Tight, sentence case) */
  sub?: string
  /** "GLY-001" */
  cat?: string
  /** small line above the title (Inter Tight tracked caps), e.g. "THE KITCHEN" */
  kicker?: string
  /** a photo (any aspect; cover-cropped, never stretched). Without one: a typographic cover. */
  photo?: CoverSource | null
  focus?: [number, number]
  paper?: PaperName
  /** rotate 180° (a sleeve lying flipped on a stack, read from the front) */
  flip?: boolean
}

/** A sleeve FRONT into the square (x0, y0, size). */
export function drawCover(ctx: Ctx, x0: number, y0: number, size: number, s: CoverSpec) {
  const sc = scheme(s.paper ?? 'cream')
  const u = (v: number) => (v * size) / 1000
  ctx.save()
  ctx.translate(x0, y0)
  ctx.beginPath()
  ctx.rect(0, 0, size, size)
  ctx.clip()
  if (s.flip) {
    ctx.translate(size, size)
    ctx.rotate(Math.PI)
  }
  ctx.fillStyle = sc.paper
  ctx.fillRect(0, 0, size, size)
  ctx.textBaseline = 'alphabetic'
  const cat = s.cat ?? catNo(1)

  if (s.photo) {
    // full-bleed photo, a cream title band across the foot
    const band = u(206)
    drawCoverImage(ctx, s.photo, 0, 0, size, size - band + u(2), s.focus)
    // a soft shade under the header line
    const gr = ctx.createLinearGradient(0, 0, 0, u(150))
    gr.addColorStop(0, 'rgba(8,5,3,0.55)')
    gr.addColorStop(1, 'rgba(8,5,3,0)')
    ctx.fillStyle = gr
    ctx.fillRect(0, 0, size, u(150))
    ctx.fillStyle = INKS.cream
    track(ctx, u(3.2))
    ctx.font = capsFont(u(19))
    ctx.textAlign = 'left'
    fillText(ctx, 'GLORY RECORDS', u(44), u(62))
    ctx.textAlign = 'right'
    fillText(ctx, `${cat} · 33⅓`, size - u(44), u(62))
    // band
    ctx.fillStyle = sc.paper
    ctx.fillRect(0, size - band, size, band)
    ctx.fillStyle = sc.accent
    ctx.fillRect(0, size - band, size, u(8))
    const R = u(62)
    drawRoundel(ctx, size - u(44) - R, size - band / 2 + u(4), R, s.paper === 'red' ? { ring: INKS.red } : {})
    ctx.textAlign = 'left'
    const tw = size - u(44) * 2 - R * 2 - u(36)
    // laid out from the foot up: sub, title, kicker
    track(ctx, 0)
    const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(s.sub ? 70 : 78), tw, u(34))
    const subY = size - u(36)
    const titleY = s.sub ? subY - u(44) : size - u(s.kicker ? 50 : 70)
    if (s.sub) {
      ctx.fillStyle = sc.muted
      fit(ctx, s.sub, px => subFont(px), u(29), tw, u(21))
      fillText(ctx, ellipsize(ctx, s.sub, tw), u(45), subY)
    }
    ctx.fillStyle = sc.fg
    ctx.font = `400 ${tpx}px ${FONT.display}`
    fillText(ctx, s.title, u(42), titleY)
    if (s.kicker) {
      ctx.fillStyle = sc.accent === sc.fg ? sc.muted : sc.accent
      track(ctx, u(3))
      ctx.font = capsFont(u(19))
      fillText(ctx, ellipsize(ctx, s.kicker.toUpperCase(), tw), u(45), titleY - tpx * 0.74 - u(20))
    }
  } else {
    // typographic cover: header rule, a big slab title, the record's rings bleeding off
    const m = u(52)
    // the record silhouette, bottom right
    ctx.save()
    ctx.globalAlpha = sc.ink ? 0.16 : 0.1
    ctx.strokeStyle = sc.fg
    const cx = size * 0.8
    const cy = size * 0.86
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = u(i % 5 === 0 ? 3 : 1.2)
      ctx.beginPath()
      ctx.arc(cx, cy, u(170 + i * 14), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    ctx.fillStyle = sc.accent
    ctx.beginPath()
    ctx.arc(cx, cy, u(150), 0, Math.PI * 2)
    ctx.fill()
    drawRoundel(ctx, cx, cy, u(62))

    ctx.fillStyle = sc.fg
    track(ctx, u(3))
    ctx.font = capsFont(u(19))
    ctx.textAlign = 'left'
    fillText(ctx, 'GLORY RECORDS', m, u(76))
    ctx.textAlign = 'right'
    fillText(ctx, cat, size - m, u(76))
    ctx.fillRect(m, u(96), size - 2 * m, Math.max(1, u(3)))
    ctx.textAlign = 'left'
    let y = u(150)
    if (s.kicker) {
      ctx.fillStyle = sc.accent === sc.fg ? sc.muted : sc.accent
      track(ctx, u(3.4))
      ctx.font = capsFont(u(22))
      fillText(ctx, ellipsize(ctx, s.kicker.toUpperCase(), size - 2 * m), m, y)
      y += u(24)
    }
    ctx.fillStyle = sc.fg
    track(ctx, 0)
    const blk = fitBlock(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(190), size - 2 * m, u(430), 3, 0.98)
    for (const l of blk.lines) {
      y += blk.px * 0.98
      fillText(ctx, l, m - u(4), y)
    }
    if (s.sub) {
      ctx.fillStyle = sc.muted
      ctx.font = subFont(u(38))
      const lines = wrap(ctx, s.sub, u(540)).slice(0, 3)
      lines.forEach((l, i) => fillText(ctx, l, m, y + u(72) + i * u(50)))
    }
    ctx.fillStyle = sc.fg
    track(ctx, u(2.6))
    ctx.font = capsFont(u(17))
    fillText(ctx, '33⅓ RPM · STEREO', m, size - u(52))
  }
  track(ctx, 0)
  ctx.textAlign = 'left'
  ctx.restore()
}

// ─── sleeve backs: tracklists ───────────────────────────────────────────────

export interface Track {
  name: string
  /** right-aligned value: a price "16", a tap number, "5/8" */
  value?: string
  /** override the number column ("07", "A1"); default: A1, A2… per side */
  n?: string
}

export interface SideSpec {
  /** "SIDE A" or a group title ("American") */
  name: string
  tracks: Track[]
}

export interface TracklistSpec {
  title: string
  sub?: string
  cat?: string
  /** explicit sides, or… */
  sides?: SideSpec[]
  /** …one flat list, split into SIDE A / SIDE B automatically */
  tracks?: Track[]
  /** small print at the foot (wraps to 2 lines) */
  notes?: string
  paper?: PaperName
  /** number column: 'side' (A1, A2…, default), 'index' (01, 02…), 'none' */
  numbers?: 'side' | 'index' | 'none'
  /** force the column count (default: 1 for short lists, 2, 3 for very long ones) */
  columns?: number
  /** rotate 180° (a back lying up on the stack, read from the front of the crate) */
  flip?: boolean
}

/**
 * A sleeve BACK as a tracklist into (x0, y0, size): title, SIDE A / SIDE B
 * columns, numbered tracks with an optional right-aligned value on a dotted
 * leader, a notes line. Type size auto-fits the list (up to ~60 lines across
 * three columns stays readable on a 1024² canvas).
 */
export function drawTracklist(ctx: Ctx, x0: number, y0: number, size: number, s: TracklistSpec) {
  const sc = scheme(s.paper ?? 'cream')
  const u = (v: number) => (v * size) / 1000
  ctx.save()
  ctx.translate(x0, y0)
  ctx.beginPath()
  ctx.rect(0, 0, size, size)
  ctx.clip()
  if (s.flip) {
    ctx.translate(size, size)
    ctx.rotate(Math.PI)
  }
  ctx.fillStyle = sc.paper
  ctx.fillRect(0, 0, size, size)
  ctx.textBaseline = 'alphabetic'
  const m = u(56)
  const W = size - 2 * m
  const cat = s.cat ?? catNo(1)

  // header
  ctx.fillStyle = sc.fg
  track(ctx, u(2.8))
  ctx.font = capsFont(u(18))
  ctx.textAlign = 'left'
  fillText(ctx, `${cat} · STEREO`, m, u(66))
  ctx.textAlign = 'right'
  fillText(ctx, 'GLORY BEER BAR & KITCHEN', size - m, u(66))
  ctx.fillRect(m, u(84), W, Math.max(1, u(2.5)))
  ctx.textAlign = 'left'
  track(ctx, 0)
  const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(84), W, u(36))
  let y = u(100) + tpx * 0.92
  fillText(ctx, s.title, m - u(3), y)
  if (s.sub) {
    ctx.fillStyle = sc.muted
    fit(ctx, s.sub, px => subFont(px), u(31), W, u(20))
    y += u(46)
    fillText(ctx, ellipsize(ctx, s.sub, W), m, y)
  }
  y += u(34)

  // sides → lines
  let sides: SideSpec[] = s.sides ?? []
  if (!s.sides && s.tracks) {
    const t = s.tracks
    if (t.length > 8) {
      const h = Math.ceil(t.length / 2)
      sides = [
        { name: 'SIDE A', tracks: t.slice(0, h) },
        { name: 'SIDE B', tracks: t.slice(h) },
      ]
    } else sides = [{ name: 'SIDE A', tracks: t }]
  }
  type Line = { kind: 'head'; text: string } | { kind: 'track'; n: string; name: string; value?: string }
  const lines: Line[] = []
  const letters = 'ABCDEFGH'
  let idx = 0
  sides.forEach((side, si) => {
    lines.push({ kind: 'head', text: side.name.toUpperCase() })
    side.tracks.forEach((t, ti) => {
      idx++
      const n = t.n ?? (s.numbers === 'index' ? String(idx).padStart(2, '0') : s.numbers === 'none' ? '' : `${letters[si] ?? 'Z'}${ti + 1}`)
      lines.push({ kind: 'track', n, name: t.name, value: t.value })
    })
  })

  // footer (notes + stamp)
  const footH = u(s.notes ? 132 : 92)
  const top = y
  const bottom = size - footH
  const cols = s.columns ?? (lines.length <= 14 ? 1 : lines.length <= 44 ? 2 : 3)
  const perCol = Math.ceil(lines.length / cols)
  // flow into columns; never leave a side heading at a column's foot
  const colLines: Line[][] = []
  let cur: Line[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const room = perCol - cur.length
    if (cur.length && (room <= 0 || (l.kind === 'head' && room <= 1)) && colLines.length < cols - 1) {
      colLines.push(cur)
      cur = []
    }
    cur.push(l)
  }
  colLines.push(cur)
  const rows = Math.max(...colLines.map(c => c.length), 1)
  const rowH = Math.min(u(46), (bottom - top) / rows)
  const px = Math.max(u(11), Math.min(u(27), rowH * 0.64))
  const gap = u(34)
  const colW = (W - gap * (colLines.length - 1)) / colLines.length
  const numW = s.numbers === 'none' ? 0 : px * 2.2

  colLines.forEach((col, ci) => {
    const cx = m + ci * (colW + gap)
    let ly = top + rowH * 0.78
    for (const l of col) {
      if (l.kind === 'head') {
        ctx.fillStyle = sc.accent === sc.fg ? sc.fg : sc.accent
        track(ctx, px * 0.16)
        ctx.font = capsFont(px * 0.84)
        fillText(ctx, ellipsize(ctx, l.text, colW), cx, ly)
        track(ctx, 0)
        ctx.globalAlpha = 0.35
        ctx.fillStyle = sc.fg
        ctx.fillRect(cx, ly + rowH * 0.2, colW, Math.max(1, u(1.2)))
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = sc.muted
        track(ctx, 0)
        ctx.font = subFont(px * 0.78)
        if (l.n) fillText(ctx, l.n, cx, ly)
        // value
        let vw = 0
        if (l.value) {
          ctx.fillStyle = sc.fg
          ctx.font = subFont(px * 0.92, 600)
          ctx.textAlign = 'right'
          fillText(ctx, l.value, cx + colW, ly)
          ctx.textAlign = 'left'
          vw = measure(ctx, l.value) + px * 0.5
        }
        // name: same size on every line; a long one is condensed (to 78%), then ellipsized
        ctx.fillStyle = sc.fg
        const nameW = colW - numW - vw
        ctx.font = subFont(px)
        const w0 = measure(ctx, l.name)
        const k = w0 > nameW ? Math.max(0.78, nameW / w0) : 1
        const name = ellipsize(ctx, l.name, nameW / k)
        ctx.save()
        ctx.translate(cx + numW, ly)
        ctx.scale(k, 1)
        fillText(ctx, name, 0, 0)
        ctx.restore()
        // dotted leader to the value
        if (l.value) {
          const x1 = cx + numW + measure(ctx, name) * k + px * 0.35
          const x2 = cx + colW - vw
          ctx.fillStyle = sc.muted
          for (let x = x1; x < x2; x += px * 0.42) ctx.fillRect(x, ly - px * 0.06, Math.max(1, px * 0.08), Math.max(1, px * 0.08))
        }
      }
      ly += rowH
    }
  })

  // footer
  ctx.fillStyle = sc.fg
  ctx.fillRect(m, size - footH + u(14), W, Math.max(1, u(2)))
  let fy = size - footH + u(50)
  if (s.notes) {
    ctx.fillStyle = sc.muted
    track(ctx, u(0.3))
    ctx.font = subFont(u(18), 400)
    const nl = wrap(ctx, s.notes, W - u(120)).slice(0, 2)
    nl.forEach((l, i) => fillText(ctx, l, m, fy + i * u(24)))
    fy += nl.length * u(24) + u(4)
  }
  ctx.fillStyle = sc.fg
  track(ctx, u(2.6))
  ctx.font = capsFont(u(15))
  fillText(ctx, `${mottoCaps()}  ·  33⅓ RPM`, m, size - u(34))
  drawRoundel(ctx, size - m - u(40), size - footH / 2 + u(8), u(38))
  track(ctx, 0)
  ctx.restore()
}

// ─── company sleeves (7") and the inner sleeve (12") ────────────────────────

export interface CompanySleeveSpec {
  paper?: PaperName
  /** die-cut hole radius in cover units (match the sleeve's `hole` option) */
  hole?: number
  /** "45 RPM" */
  rpm?: string
  /** light print (a plain paper inner sleeve) */
  inner?: boolean
  flip?: boolean
}

/**
 * The 7" company sleeve (or the 12" paper inner sleeve with `inner`): big
 * GLORY slab over the die-cut centre hole, groove rings round it, the motto
 * under it. Same art on both faces works (draw it once, pass it as front and
 * back).
 */
export function drawCompanySleeve(ctx: Ctx, x0: number, y0: number, size: number, s: CompanySleeveSpec = {}) {
  const sc = scheme(s.paper ?? 'cream')
  const u = (v: number) => (v * size) / 1000
  const c = size / 2
  const hole = (s.hole ?? 0.19) * size
  ctx.save()
  ctx.translate(x0, y0)
  ctx.beginPath()
  ctx.rect(0, 0, size, size)
  ctx.clip()
  if (s.flip) {
    ctx.translate(size, size)
    ctx.rotate(Math.PI)
  }
  ctx.fillStyle = s.inner ? '#f6f1e6' : sc.paper
  ctx.fillRect(0, 0, size, size)
  const ink = s.inner ? 'rgba(26,17,12,0.5)' : sc.accent === sc.fg ? sc.fg : sc.accent
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  // rings around the hole, the address running round them
  ctx.strokeStyle = ink
  for (let i = 0; i < (s.inner ? 2 : 4); i++) {
    ctx.globalAlpha = s.inner ? 0.5 : 0.85 - i * 0.16
    ctx.lineWidth = u(i === 0 ? 6 : 2)
    ctx.beginPath()
    ctx.arc(c, c, hole + u(16 + i * 13), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // the ring text sits between the rings and the type block (≤ ~0.3 of the cover from centre)
  const ringR = Math.min(hole + u(86), u(318))
  if (!s.inner) ringText(ctx, RIM_TEXT, c, c, ringR, u(16), sc.fg)
  // GLORY across the top, the motto under the hole
  ctx.fillStyle = s.inner ? ink : sc.fg
  track(ctx, 0)
  if (s.inner) {
    ctx.font = capsFont(u(18))
    track(ctx, u(4))
    fillText(ctx, 'GLORY RECORDS · HOUSE PRESSING', c, u(80))
    fillText(ctx, `${BRAND.street.toUpperCase()} · PHILADELPHIA`, c, size - u(62))
  } else {
    // GLORY + the subline fill the band above the ring text
    const top = c - ringR - u(26)
    const gpx = fit(ctx, 'GLORY', px => `400 ${px}px ${FONT.display}`, Math.min(u(150), (top - u(40)) * 0.95), u(600), u(40))
    fillText(ctx, 'GLORY', c, u(34) + gpx * 0.8)
    track(ctx, u(5))
    ctx.font = capsFont(u(20))
    fillText(ctx, 'BEER BAR & KITCHEN', c, Math.min(top, u(34) + gpx * 0.8 + u(34)))
    // the motto in a ruled box, as on the painted sign by the front windows
    const motto = mottoCaps()
    const my = Math.max(c + ringR + u(66), size - u(116))
    track(ctx, u(4))
    fit(ctx, motto, px => capsFont(px, 700), u(27), u(640), u(14))
    const mw = measure(ctx, motto)
    const bh = u(58)
    fillText(ctx, motto, c + u(2), my + u(10))
    ctx.strokeStyle = ctx.fillStyle
    ctx.lineWidth = u(3)
    ctx.strokeRect(c - mw / 2 - u(30), my - bh / 2, mw + u(60), bh)
    ctx.fillStyle = ink
    track(ctx, u(3))
    ctx.font = capsFont(u(19))
    ctx.textAlign = 'left'
    fillText(ctx, s.rpm ?? '45 RPM', u(46), size - u(40))
    ctx.textAlign = 'right'
    fillText(ctx, 'STEREO', size - u(46), size - u(40))
    drawRoundel(ctx, u(96), u(96), u(52))
    drawRoundel(ctx, size - u(96), u(96), u(52))
  }
  track(ctx, 0)
  ctx.textAlign = 'left'
  ctx.restore()
}
