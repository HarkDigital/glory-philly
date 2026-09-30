import * as THREE from 'three'
import { BRAND } from '../../content'

/*
 * VINYL KIT print design: Glory's house label ("Glory Records", catalogue
 * GLY-001…), sleeve fronts (a full-bleed photo with a title band, or a
 * typographic cover), sleeve backs as TRACKLISTS (auto-fit, split across
 * sides/columns), 7" company sleeves with a die-cut centre, and the paper
 * inner sleeve. Drawn with 2D canvas in the site's faces:
 *   Alfa Slab One (display) · Inter Tight (reading) · Instrument Serif italic
 *   (the accent) · IBM Plex Mono (numbers, prices, catalogue lines).
 * Paper grain, ring wear and scuffs are added by the sleeve shader, so these
 * canvases are pure type and layout. Every draw function takes (ctx, x0, y0,
 * size, spec) so it can also paint one cell of an atlas.
 *
 * Fonts: `await loadVinylFonts()` before drawing; redraw with `onFonts(draw)`
 * (it runs `draw` once the faces are in and again on document.fonts.ready).
 */

export const FONT = {
  display: '"Alfa Slab One", Rockwell, Georgia, serif',
  sans: '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif',
  serif: '"Instrument Serif", Georgia, serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
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

/** "GLY-001" */
export const catNo = (n: number) => `GLY-${String(n).padStart(3, '0')}`

// ─── fonts ──────────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null
/** Load the faces the canvases use (they aren't fetched until something asks). Resolves within ~4 s. */
export function loadVinylFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise
  const fonts = document.fonts
  if (!fonts?.load) return (fontsPromise = Promise.resolve())
  const faces = [
    `400 40px ${FONT.display}`,
    `500 40px ${FONT.sans}`,
    `650 40px ${FONT.sans}`,
    `900 40px ${FONT.sans}`,
    `italic 400 40px ${FONT.serif}`,
    `500 20px ${FONT.mono}`,
    `400 20px ${FONT.mono}`,
  ]
  const all = Promise.all(faces.map(f => fonts.load(f, 'Glory 33⅓ – G').catch(() => []))).then(() => undefined)
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

const track = (ctx: Ctx, px: number) => {
  ;(ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${px}px`
}

/** Largest font size (<= px) at which `text` fits `maxW`. Sets ctx.font. */
export function fit(ctx: Ctx, text: string, font: (px: number) => string, px: number, maxW: number, min = 8) {
  let s = px
  for (let i = 0; i < 12; i++) {
    ctx.font = font(s)
    const w = ctx.measureText(text).width
    if (w <= maxW || s <= min) break
    s = Math.max(min, s * (maxW / w) * 0.995)
  }
  ctx.font = font(s)
  return s
}

/** Truncate with an ellipsis to fit maxW at the current font. */
function ellipsize(ctx: Ctx, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid).trimEnd() + '…').width <= maxW) lo = mid
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
    if (ctx.measureText(t).width > maxW && line) {
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
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width))
    if (lines.length <= maxLines && widest <= w && lines.length * px * lead <= h) break
    px *= 0.93
  }
  ctx.font = font(px)
  return { px, lines }
}

/** Characters around a circle, clockwise from `start` (radians, 0 = right, -π/2 = top), filling the ring. */
export function ringText(ctx: Ctx, text: string, cx: number, cy: number, R: number, px: number, color: string, start = -Math.PI / 2, font = FONT.mono) {
  ctx.save()
  ctx.font = `500 ${px}px ${font}`
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
}

/** The red-ring "G" roundel (the sign's stamp): white disc, red ring, heavy black G. */
export function drawRoundel(ctx: Ctx, cx: number, cy: number, r: number, opts: { disc?: string; ring?: string; g?: string } = {}) {
  ctx.save()
  ctx.fillStyle = opts.disc ?? '#fbf8f2'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = opts.ring ?? INKS.red
  ctx.lineWidth = r * 0.075
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = opts.g ?? '#0f0d0c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  track(ctx, 0)
  ctx.font = `900 ${r * 1.34}px ${FONT.sans}`
  // optical centre: cap height ≈ 0.72 em
  ctx.fillText('G', cx - r * 0.02, cy + r * 1.34 * 0.36)
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
  /** italic serif line under the title */
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
    ctx.font = `500 ${u(15)}px ${FONT.mono}`
    ctx.fillText(side, c - u(166), c + u(6))
    ctx.fillText(`${rpm} RPM`, c + u(166), c + u(6))
    track(ctx, 0)
    const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(30), u(250), u(12))
    ctx.fillText(s.title, c, c + u(140) + tpx * 0.35)
    if (s.sub) {
      ctx.fillStyle = sc.muted
      fit(ctx, s.sub, px => `italic 400 ${px}px ${FONT.serif}`, u(22), u(190), u(10))
      ctx.fillText(s.sub, c, c + u(176) + tpx * 0.2)
    }
    if (s.cat) {
      ctx.fillStyle = sc.fg
      track(ctx, u(2))
      ctx.font = `500 ${u(11)}px ${FONT.mono}`
      ctx.fillText(s.cat, c, c - u(118))
    }
  } else {
    drawRoundel(ctx, c, c - u(132), u(50))
    track(ctx, u(2.4))
    ctx.font = `500 ${u(10.5)}px ${FONT.mono}`
    ctx.fillStyle = sc.muted
    ctx.fillText('GLORY RECORDS', c, c - u(66))
    ctx.fillStyle = sc.fg
    track(ctx, u(2.2))
    ctx.font = `500 ${u(15)}px ${FONT.mono}`
    ctx.fillText(side, c - u(112), c + u(5))
    ctx.fillText(rpm, c + u(112), c + u(5))
    track(ctx, 0)
    const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(38), u(300), u(14))
    ctx.fillText(s.title, c, c + u(62) + tpx * 0.35)
    if (s.sub) {
      ctx.fillStyle = sc.muted
      fit(ctx, s.sub, px => `italic 400 ${px}px ${FONT.serif}`, u(26), u(270), u(12))
      ctx.fillText(s.sub, c, c + u(102) + tpx * 0.35)
    }
    ctx.fillStyle = sc.fg
    track(ctx, u(2.4))
    ctx.font = `500 ${u(12)}px ${FONT.mono}`
    ctx.fillText(`${s.cat ?? catNo(1)} · STEREO`, c, c + u(150))
  }
  track(ctx, 0)
  ctx.textAlign = 'left'
  ctx.restore()
}

// ─── sleeve fronts ──────────────────────────────────────────────────────────

export interface CoverSpec {
  title: string
  sub?: string
  /** "GLY-001" */
  cat?: string
  /** small line above the title (mono), e.g. "THE KITCHEN" */
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
    ctx.font = `500 ${u(19)}px ${FONT.mono}`
    ctx.textAlign = 'left'
    ctx.fillText('GLORY RECORDS', u(44), u(62))
    ctx.textAlign = 'right'
    ctx.fillText(`${cat} · 33⅓`, size - u(44), u(62))
    // band
    ctx.fillStyle = sc.paper
    ctx.fillRect(0, size - band, size, band)
    ctx.fillStyle = sc.accent
    ctx.fillRect(0, size - band, size, u(8))
    const R = u(62)
    drawRoundel(ctx, size - u(44) - R, size - band / 2 + u(4), R, s.paper === 'red' ? { ring: INKS.red } : {})
    ctx.textAlign = 'left'
    const tw = size - u(44) * 2 - R * 2 - u(36)
    let ty = size - band + u(64)
    if (s.kicker) {
      ctx.fillStyle = sc.accent === sc.fg ? sc.muted : sc.accent
      track(ctx, u(3))
      ctx.font = `500 ${u(19)}px ${FONT.mono}`
      ctx.fillText(ellipsize(ctx, s.kicker.toUpperCase(), tw), u(46), ty)
      ty += u(12)
    } else ty -= u(14)
    ctx.fillStyle = sc.fg
    track(ctx, 0)
    const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(76), tw, u(34))
    ty += tpx * 0.86
    ctx.fillText(s.title, u(42), ty)
    if (s.sub) {
      ctx.fillStyle = sc.muted
      fit(ctx, s.sub, px => `italic 400 ${px}px ${FONT.serif}`, u(40), tw, u(20))
      ctx.fillText(ellipsize(ctx, s.sub, tw), u(46), Math.min(size - u(26), ty + u(48)))
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
    ctx.font = `500 ${u(19)}px ${FONT.mono}`
    ctx.textAlign = 'left'
    ctx.fillText('GLORY RECORDS', m, u(76))
    ctx.textAlign = 'right'
    ctx.fillText(cat, size - m, u(76))
    ctx.fillRect(m, u(96), size - 2 * m, Math.max(1, u(3)))
    ctx.textAlign = 'left'
    let y = u(150)
    if (s.kicker) {
      ctx.fillStyle = sc.accent === sc.fg ? sc.muted : sc.accent
      track(ctx, u(3.4))
      ctx.font = `500 ${u(22)}px ${FONT.mono}`
      ctx.fillText(s.kicker.toUpperCase(), m, y)
      y += u(24)
    }
    ctx.fillStyle = sc.fg
    track(ctx, 0)
    const blk = fitBlock(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(190), size - 2 * m, u(430), 3, 0.98)
    for (const l of blk.lines) {
      y += blk.px * 0.98
      ctx.fillText(l, m - u(4), y)
    }
    if (s.sub) {
      ctx.fillStyle = sc.muted
      ctx.font = `italic 400 ${u(52)}px ${FONT.serif}`
      const lines = wrap(ctx, s.sub, u(560)).slice(0, 3)
      lines.forEach((l, i) => ctx.fillText(l, m, y + u(76) + i * u(56)))
    }
    ctx.fillStyle = sc.fg
    track(ctx, u(2.6))
    ctx.font = `500 ${u(17)}px ${FONT.mono}`
    ctx.fillText('33⅓ RPM · STEREO', m, size - u(52))
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
  ctx.font = `500 ${u(18)}px ${FONT.mono}`
  ctx.textAlign = 'left'
  ctx.fillText(`${cat} · STEREO`, m, u(66))
  ctx.textAlign = 'right'
  ctx.fillText('GLORY BEER BAR & KITCHEN', size - m, u(66))
  ctx.fillRect(m, u(84), W, Math.max(1, u(2.5)))
  ctx.textAlign = 'left'
  track(ctx, 0)
  const tpx = fit(ctx, s.title, px => `400 ${px}px ${FONT.display}`, u(84), W, u(36))
  let y = u(100) + tpx * 0.92
  ctx.fillText(s.title, m - u(3), y)
  if (s.sub) {
    ctx.fillStyle = sc.muted
    fit(ctx, s.sub, px => `italic 400 ${px}px ${FONT.serif}`, u(40), W, u(22))
    y += u(50)
    ctx.fillText(ellipsize(ctx, s.sub, W), m, y)
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
        ctx.font = `500 ${px * 0.86}px ${FONT.mono}`
        ctx.fillText(ellipsize(ctx, l.text, colW), cx, ly)
        track(ctx, 0)
        ctx.globalAlpha = 0.35
        ctx.fillStyle = sc.fg
        ctx.fillRect(cx, ly + rowH * 0.2, colW, Math.max(1, u(1.2)))
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = sc.muted
        track(ctx, 0)
        ctx.font = `500 ${px * 0.8}px ${FONT.mono}`
        if (l.n) ctx.fillText(l.n, cx, ly)
        // value
        let vw = 0
        if (l.value) {
          ctx.fillStyle = sc.fg
          ctx.font = `500 ${px * 0.92}px ${FONT.mono}`
          ctx.textAlign = 'right'
          ctx.fillText(l.value, cx + colW, ly)
          ctx.textAlign = 'left'
          vw = ctx.measureText(l.value).width + px * 0.5
        }
        // name: same size on every line; a long one is condensed (to 78%), then ellipsized
        ctx.fillStyle = sc.fg
        const nameW = colW - numW - vw
        ctx.font = `500 ${px}px ${FONT.sans}`
        const w0 = ctx.measureText(l.name).width
        const k = w0 > nameW ? Math.max(0.78, nameW / w0) : 1
        const name = ellipsize(ctx, l.name, nameW / k)
        ctx.save()
        ctx.translate(cx + numW, ly)
        ctx.scale(k, 1)
        ctx.fillText(name, 0, 0)
        ctx.restore()
        // dotted leader to the value
        if (l.value) {
          const x1 = cx + numW + ctx.measureText(name).width * k + px * 0.35
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
    track(ctx, u(1.2))
    ctx.font = `400 ${u(17)}px ${FONT.mono}`
    const nl = wrap(ctx, s.notes, W - u(120)).slice(0, 2)
    nl.forEach((l, i) => ctx.fillText(l, m, fy + i * u(24)))
    fy += nl.length * u(24) + u(4)
  }
  ctx.fillStyle = sc.fg
  track(ctx, u(2.6))
  ctx.font = `500 ${u(15)}px ${FONT.mono}`
  ctx.fillText(`${BRAND.motto.toUpperCase()}  ·  33⅓ RPM`, m, size - u(34))
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
    ctx.font = `500 ${u(18)}px ${FONT.mono}`
    track(ctx, u(4))
    ctx.fillText('GLORY RECORDS · HOUSE PRESSING', c, u(80))
    ctx.fillText(`${BRAND.street.toUpperCase()} · PHILADELPHIA`, c, size - u(62))
  } else {
    // GLORY + the subline fill the band above the ring text
    const top = c - ringR - u(26)
    const gpx = fit(ctx, 'GLORY', px => `400 ${px}px ${FONT.display}`, Math.min(u(150), (top - u(40)) * 0.95), u(600), u(40))
    ctx.fillText('GLORY', c, u(34) + gpx * 0.8)
    track(ctx, u(5))
    ctx.font = `500 ${u(20)}px ${FONT.mono}`
    ctx.fillText('BEER BAR & KITCHEN', c, Math.min(top, u(34) + gpx * 0.8 + u(34)))
    track(ctx, 0)
    fit(ctx, BRAND.motto, px => `italic 400 ${px}px ${FONT.serif}`, u(58), u(600), u(24))
    ctx.fillText(BRAND.motto, c, Math.max(c + ringR + u(70), size - u(96)))
    ctx.fillStyle = ink
    track(ctx, u(3))
    ctx.font = `500 ${u(20)}px ${FONT.mono}`
    ctx.textAlign = 'left'
    ctx.fillText(s.rpm ?? '45 RPM', u(46), size - u(40))
    ctx.textAlign = 'right'
    ctx.fillText('STEREO', size - u(46), size - u(40))
    drawRoundel(ctx, u(96), u(96), u(52))
    drawRoundel(ctx, size - u(96), u(96), u(52))
  }
  track(ctx, 0)
  ctx.textAlign = 'left'
  ctx.restore()
}
