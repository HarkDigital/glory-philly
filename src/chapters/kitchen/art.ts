import * as THREE from 'three'
import { BRAND, type Dish, type MenuSection } from '../../content'

/*
 * KITCHEN art: the printed things on the pass, drawn to canvas in the site's
 * type AFTER the fonts have loaded —
 *  - MENU CARDS: heavy cream stock, a slab section title, Inter Tight names and
 *    descriptions, Plex Mono prices (the DOM panel carries the same text crisp)
 *  - PRINTS: the real dish photos on thick matte stock, a cream border and the
 *    dish name + price along the bottom margin
 */

const SLAB = '"Alfa Slab One", Rockwell, Georgia, serif'
const SANS = '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, monospace'
const SERIF = '"Instrument Serif", "Times New Roman", serif'
const INK = '#1a100a'
const INK_2 = 'rgba(26,16,10,0.72)'
const RED = '#d8272e'
const CREAM = '#f1e7d2'

let fontsP: Promise<void> | null = null
/** Every face the art uses, loaded (with a guard so a stalled font never blocks init). */
export function loadFonts(): Promise<void> {
  if (fontsP) return fontsP
  const f = document.fonts
  const loads = f
    ? Promise.all([
        f.load(`400 80px ${SLAB}`),
        f.load(`600 28px ${SANS}`),
        f.load(`400 20px ${SANS}`),
        f.load(`400 20px ${MONO}`),
        f.load(`500 20px ${MONO}`),
        f.load(`italic 400 24px ${SERIF}`),
      ]).then(() => f.ready.then(() => undefined))
    : Promise.resolve()
  fontsP = Promise.race([loads.catch(() => undefined), new Promise<void>(r => setTimeout(r, 2500))])
  return fontsP
}

/** mono caps with manual tracking (canvas letterSpacing is missing in Safari) */
function tracked(g: CanvasRenderingContext2D, s: string, x: number, y: number, track: number, align: 'left' | 'right' | 'center' = 'left') {
  const w = [...s].reduce((a, c) => a + g.measureText(c).width + track, -track)
  let cx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2
  const prev = g.textAlign
  g.textAlign = 'left'
  for (const c of s) {
    g.fillText(c, cx, y)
    cx += g.measureText(c).width + track
  }
  g.textAlign = prev
  return w
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (g.measureText(t).width > maxW && line) {
      lines.push(line)
      line = w
    } else line = t
  }
  if (line) lines.push(line)
  return lines
}

/** paper: cream with fibres, a faint tooth and a soft edge falloff */
function paper(g: CanvasRenderingContext2D, w: number, h: number, seed = 3, base = CREAM) {
  g.fillStyle = base
  g.fillRect(0, 0, w, h)
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(120,90,50,0.05)' : 'rgba(255,255,255,0.07)'
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 6, 1 + rnd() * 1.4)
  }
  const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
  gr.addColorStop(0, 'rgba(120,80,30,0)')
  gr.addColorStop(1, 'rgba(120,80,30,0.12)')
  g.fillStyle = gr
  g.fillRect(0, 0, w, h)
}

/** the red "G" roundel as a printed stamp */
function roundel(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save()
  g.strokeStyle = RED
  g.lineWidth = r * 0.22
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = RED
  g.font = `400 ${Math.round(r * 1.25)}px ${SLAB}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('G', x, y + r * 0.06)
  g.restore()
}

export const CARD_W = 2.3
export const CARD_H = 3.2
const CW = 768
const CH = Math.round((CW * CARD_H) / CARD_W)

function finish(cv: HTMLCanvasElement, shrink = true) {
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  if (shrink)
    tex.onUpdate = () => {
      cv.width = cv.height = 1
      tex.onUpdate = null
    }
  return tex
}

/** A menu card for one section (the whole list, as printed). */
export function drawMenuCard(sec: MenuSection, index: number, total: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = CW
  cv.height = CH
  const g = cv.getContext('2d')!
  paper(g, CW, CH, 7 + index * 13)
  const M = 56
  // a printed hairline frame
  g.strokeStyle = 'rgba(26,16,10,0.35)'
  g.lineWidth = 2
  g.strokeRect(24, 24, CW - 48, CH - 48)

  // header
  roundel(g, M + 20, M + 30, 20)
  g.fillStyle = INK
  g.font = `500 15px ${MONO}`
  g.textBaseline = 'alphabetic'
  tracked(g, BRAND.name.toUpperCase(), M + 56, M + 26, 2.4)
  g.fillStyle = INK_2
  g.font = `400 14px ${MONO}`
  tracked(g, `ALL DAY MENU  ·  ${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`, M + 56, M + 48, 2.2)

  // measure the list, scale to fit
  const top0 = M + 170
  const bottom = CH - M - 44
  const inner = CW - M * 2
  const layout = (k: number) => {
    let y = 0
    const rows: { name: string; marks: string; price: string; desc: string[]; y: number; ns: number; ds: number }[] = []
    const ns = Math.round(27 * k)
    const ds = Math.round(19.5 * k)
    for (const d of sec.items) {
      g.font = `400 ${ds}px ${SANS}`
      const desc = wrap(g, d.desc, inner - 12)
      rows.push({ name: d.name, marks: (d.marks ?? []).join(' '), price: d.price, desc, y, ns, ds })
      y += ns * 1.15 + desc.length * ds * 1.32 + 22 * k
    }
    if (sec.note) y += 40 * k
    return { rows, h: y }
  }
  let k = 1
  let L = layout(k)
  while (L.h > bottom - top0 && k > 0.55) {
    k -= 0.04
    L = layout(k)
  }

  // section title
  g.fillStyle = INK
  let ts = 82
  g.font = `400 ${ts}px ${SLAB}`
  while (g.measureText(sec.title).width > inner && ts > 40) g.font = `400 ${(ts -= 4)}px ${SLAB}`
  g.fillText(sec.title, M, M + 140)
  g.fillStyle = RED
  g.fillRect(M, M + 158, 64, 5)

  for (const r of L.rows) {
    const y = top0 + r.y + r.ns
    g.fillStyle = INK
    g.font = `600 ${r.ns}px ${SANS}`
    g.fillText(r.name, M, y)
    let nx = M + g.measureText(r.name).width + 12
    if (r.marks) {
      g.fillStyle = RED
      g.font = `500 ${Math.round(r.ns * 0.56)}px ${MONO}`
      nx += tracked(g, r.marks, nx, y - 2, 1.5) + 10
    }
    g.fillStyle = INK
    g.font = `500 ${Math.round(r.ns * 0.92)}px ${MONO}`
    const pw = g.measureText(r.price).width
    g.fillText(r.price, CW - M - pw, y)
    // dotted leader
    g.fillStyle = 'rgba(26,16,10,0.3)'
    for (let x = nx + 6; x < CW - M - pw - 12; x += 9) g.fillRect(x, y - 4, 2.4, 2.4)
    g.fillStyle = INK_2
    g.font = `400 ${r.ds}px ${SANS}`
    r.desc.forEach((line, i) => g.fillText(line, M, y + r.ns * 0.2 + (i + 1) * r.ds * 1.32))
  }
  if (sec.note) {
    g.fillStyle = INK_2
    g.font = `italic 400 ${Math.round(24 * k)}px ${SERIF}`
    g.fillText(sec.note, M, top0 + L.h - 6)
  }
  // foot
  g.fillStyle = 'rgba(26,16,10,0.25)'
  g.fillRect(M, CH - M - 26, inner, 1.5)
  g.fillStyle = INK_2
  g.font = `400 13px ${MONO}`
  tracked(g, `${BRAND.street.toUpperCase()}  ·  ${BRAND.neighborhood.toUpperCase()}`, M, CH - M, 2)
  g.fillStyle = RED
  tracked(g, 'V · GF', CW - M, CH - M, 2, 'right')
  return finish(cv)
}

/** A blank card back / placeholder (cream). */
export function blankTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  paper(cv.getContext('2d')!, 64, 64, 5)
  return finish(cv, false)
}

// ---- prints --------------------------------------------------------------

/** the print's layout in world units, for a photo of aspect a (w/h) */
export function printSize(a: number) {
  const ph = a >= 1.2 ? 2.05 : 2.35
  const pw = ph * a
  const m = 0.11
  const foot = 0.44
  return { w: pw + m * 2, h: ph + m + foot, pw, ph, m, foot }
}

/** decode off the main thread where possible, keeping the photo's own aspect */
export async function decodePhoto(url: string): Promise<{ src: CanvasImageSource; w: number; h: number; close?: () => void }> {
  try {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
  } catch {
    const img = new Image()
    img.src = url
    await img.decode()
    return { src: img, w: img.naturalWidth, h: img.naturalHeight }
  }
}

/** The matte print for one dish: photo, cream border, name + price along the foot. */
export function drawPrint(photo: { src: CanvasImageSource; w: number; h: number }, dish: Dish, a: number): THREE.CanvasTexture {
  const S = printSize(a)
  const px = 1024 / S.w
  const W = 1024
  const H = Math.round(S.h * px)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  paper(g, W, H, 11, '#f4ecdc')
  const m = Math.round(S.m * px)
  const pw = W - m * 2
  const ph = Math.round(S.ph * px)
  // cover-fit the photo into the window
  const sa = photo.w / photo.h
  let sw = photo.w
  let sh = photo.h
  let sx = 0
  let sy = 0
  if (sa > a) {
    sw = photo.h * a
    sx = (photo.w - sw) / 2
  } else {
    sh = photo.w / a
    sy = (photo.h - sh) / 2
  }
  g.drawImage(photo.src, sx, sy, sw, sh, m, m, pw, ph)
  // a hairline inset shadow where the photo meets the matte
  g.strokeStyle = 'rgba(40,24,12,0.35)'
  g.lineWidth = 2
  g.strokeRect(m, m, pw, ph)
  // foot: the dish, as captioned
  const fy = m + ph + (H - m - ph) * 0.62
  g.fillStyle = INK
  let fs = 50
  g.font = `400 ${fs}px ${SLAB}`
  const pr = dish.price
  g.font = `500 40px ${MONO}`
  const pwid = g.measureText(pr).width
  g.font = `400 ${fs}px ${SLAB}`
  while (g.measureText(dish.name).width > pw - pwid - 40 && fs > 26) g.font = `400 ${(fs -= 2)}px ${SLAB}`
  g.fillText(dish.name, m, fy)
  g.fillStyle = RED
  g.font = `500 40px ${MONO}`
  g.fillText(pr, W - m - pwid, fy)
  return finish(cv)
}
