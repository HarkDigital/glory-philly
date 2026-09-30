/*
 * ROOM KIT noise: seeded randomness and value noise. No DOM, no three — the
 * texture worker (texgen.worker.ts) imports this, so keep it dependency-free.
 */

/** mulberry32: a small seeded PRNG → [0, 1) */
export function rng(seed: number) {
  let a = (Math.floor(seed * 9301 + 49297) >>> 0) || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export type Rng = ReturnType<typeof rng>

/** integer lattice hash → [0, 1) */
export function hash2(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const sm = (t: number) => t * t * (3 - 2 * t)

/** smooth 2D value noise → [0, 1) */
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = sm(x - xi)
  const fy = sm(y - yi)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** 2D fbm → ~[0, 1) */
export function fbm(x: number, y: number, oct = 4) {
  let s = 0
  let a = 0.5
  let n = 0
  for (let i = 0; i < oct; i++) {
    s += vnoise(x, y) * a
    n += a
    x = x * 2.03 + 17.1
    y = y * 2.03 + 3.7
    a *= 0.5
  }
  return s / n
}

/** a 1D noise line (table based, wraps every 4096) → [0, 1) */
export function noise1(seed: number) {
  const r = rng(seed)
  const T = new Float32Array(4096)
  for (let i = 0; i < T.length; i++) T[i] = r()
  const n = (x: number) => {
    const xi = Math.floor(x)
    const f = sm(x - xi)
    const a = T[xi & 4095]
    return a + (T[(xi + 1) & 4095] - a) * f
  }
  return {
    n,
    fbm(x: number, oct = 4) {
      let s = 0
      let a = 0.5
      let t = 0
      for (let i = 0; i < oct; i++) {
        s += n(x) * a
        t += a
        x = x * 2.07 + 31.3
        a *= 0.5
      }
      return s / t
    },
  }
}

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, v: number) => sm(clamp((v - a) / (b - a)))
