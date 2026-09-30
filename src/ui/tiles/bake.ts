/*
 * The BAKER for the UI tiles in this folder (brick.webp, paper.webp). Not
 * part of the site bundle: texture.ts ships the baked files, so boot paints
 * nothing (the per-pixel loops + PNG encode cost ~35–60 ms of main thread).
 *
 *   brick()   OLD PHILADELPHIA BRICK after dark: running bond, dusty
 *             red-brown bricks, recessed mortar (opaque; CSS washes it dark).
 *   paper()   MENU-CARD STOCK: the fibre and speckle of an uncoated cream
 *             card, as a transparent overlay on a flat cream.
 *
 * Every tile wraps seamlessly (periodic noise lattices).
 *
 * To change the art: edit below, then on the dev server run in the console
 *   (await import('/src/ui/tiles/bake.ts')).download()
 * and convert the two PNGs losslessly into this folder:
 *   cwebp -lossless -z 9 glory-brick.png -o src/ui/tiles/brick.webp
 *   cwebp -lossless -z 9 glory-paper.png -o src/ui/tiles/paper.webp
 */

const cache = new Map<string, string>()

/** a tiny seeded PRNG, so the grain is the same on every visit */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** periodic value noise over a gx × gy lattice (wraps at the tile's edges) */
function field(r: () => number, gx: number, gy: number) {
  const lattice = Array.from({ length: gx * gy }, () => r())
  const at = (ix: number, iy: number) => lattice[(((iy % gy) + gy) % gy) * gx + (((ix % gx) + gx) % gx)]
  return (u: number, v: number) => {
    const fx = u * gx
    const fy = v * gy
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    let tx = fx - ix
    let ty = fy - iy
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx
    return a + (b - a) * ty
  }
}

function paint(
  key: string,
  w: number,
  h: number,
  draw: (d: Uint8ClampedArray, w: number, h: number) => void,
  after?: (g: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const hit = cache.get(key)
  if (hit != null) return hit
  let url = ''
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (g) {
      const img = g.createImageData(w, h)
      draw(img.data, w, h)
      g.putImageData(img, 0, 0)
      after?.(g, w, h)
      url = c.toDataURL('image/png')
    }
  } catch {
    url = ''
  }
  cache.set(key, url)
  return url
}

/**
 * Old Philadelphia brick, after dark: running bond in a 4-course tile, each
 * brick its own dusty red-brown with a soft mottle and chipped edges, recessed
 * mortar joints. Drawn dark (it sits behind cream type at ≥ 4.5:1 once the
 * CSS lays a stout wash over it). Meant at 160 x 80 CSS px.
 */
export function brick() {
  return paint('brick', 320, 160, (d, w, h) => {
    const r = rng(19)
    const mottle = field(r, 8, 4)
    const grit = field(r, 64, 32)
    const COURSES = 4
    const PER = 2 // bricks per course across the tile
    const ch = h / COURSES
    const bw = w / PER
    const tint: number[] = Array.from({ length: COURSES * PER * 2 }, () => r())
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / ch)
      const yIn = y - row * ch
      for (let x = 0; x < w; x++) {
        const shift = row % 2 ? bw / 2 : 0
        const xs = (x + shift) % w
        const col = Math.floor(xs / bw)
        const xIn = xs - col * bw
        const joint = Math.min(yIn, ch - yIn, xIn, bw - xIn)
        const u = x / w
        const v = y / h
        const g = grit(u, v)
        const m = mottle(u, v)
        const i = (y * w + x) * 4
        if (joint < 3.2 + (g - 0.5) * 2) {
          // mortar: dark and recessed
          d[i] = 34
          d[i + 1] = 26
          d[i + 2] = 22
        } else {
          const t = tint[row * PER + col]
          const k = 0.75 + 0.35 * m + (g - 0.5) * 0.22 - Math.max(0, 5 - joint) * 0.03
          d[i] = Math.round((96 + 34 * t) * k)
          d[i + 1] = Math.round((40 + 12 * t) * k)
          d[i + 2] = Math.round((28 + 8 * t) * k)
        }
        d[i + 3] = 255
      }
    }
  })
}

/**
 * Cream stock: soft mottling and tooth, short pale and dark fibres lying
 * every which way, and a few specks — an uncoated menu card. Meant at
 * 160 x 160 CSS px over #f1e3c6.
 */
export function paper() {
  return paint(
    'paper',
    160,
    160,
    (d, w, h) => {
      const r = rng(7)
      const mottle = field(r, 4, 4)
      const cloud = field(r, 9, 9)
      const tooth = field(r, 80, 80)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = x / w
          const v = y / h
          const m = mottle(u, v) * 0.6 + cloud(u, v) * 0.4
          const t = tooth(u, v)
          const i = (y * w + x) * 4
          // a warm brown at low alpha: broad and very soft, plus a fine tooth
          d[i] = 128
          d[i + 1] = 88
          d[i + 2] = 40
          d[i + 3] = Math.round(Math.max(0, 4 + (0.55 - m) * 14 + (0.5 - t) * 10))
        }
    },
    (g, w, h) => {
      const r = rng(11)
      // a fibre, drawn at every wrap so the tile stays seamless
      const fibre = (x: number, y: number, len: number, a: number, bend: number, style: string, lw: number) => {
        for (const ox of [-w, 0, w])
          for (const oy of [-h, 0, h]) {
            const x0 = x + ox
            const y0 = y + oy
            const x1 = x0 + Math.cos(a) * len
            const y1 = y0 + Math.sin(a) * len
            const mx = (x0 + x1) / 2 + Math.cos(a + Math.PI / 2) * bend
            const my = (y0 + y1) / 2 + Math.sin(a + Math.PI / 2) * bend
            g.beginPath()
            g.moveTo(x0, y0)
            g.quadraticCurveTo(mx, my, x1, y1)
            g.strokeStyle = style
            g.lineWidth = lw
            g.stroke()
          }
      }
      g.lineCap = 'round'
      for (let k = 0; k < 46; k++)
        fibre(r() * w, r() * h, 4 + r() * 11, r() * Math.PI * 2, (r() - 0.5) * 4, `rgba(255, 252, 242, ${(0.18 + r() * 0.22).toFixed(2)})`, 0.6 + r() * 0.5)
      for (let k = 0; k < 14; k++)
        fibre(r() * w, r() * h, 3 + r() * 7, r() * Math.PI * 2, (r() - 0.5) * 3, `rgba(96, 64, 32, ${(0.1 + r() * 0.12).toFixed(2)})`, 0.5)
      // a few specks
      for (let k = 0; k < 9; k++) {
        g.beginPath()
        g.arc(r() * w, r() * h, 0.4 + r() * 0.5, 0, Math.PI * 2)
        g.fillStyle = `rgba(62, 40, 22, ${(0.25 + r() * 0.3).toFixed(2)})`
        g.fill()
      }
    },
  )
}

/** Save both tiles as PNGs (dev only; see the doc block). */
export function download() {
  for (const [name, url] of [
    ['glory-brick.png', brick()],
    ['glory-paper.png', paper()],
  ]) {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
  }
}
