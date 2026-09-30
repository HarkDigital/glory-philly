import * as THREE from 'three'
import { onFonts, type Sleeve } from '../vinyl'
import { kitPools, poolHook, withPools, type RoomMaterials } from './materials'
import { brickPanelMaps, chalkFontReady, drawChalk, hifiMaps, pitchTexture, SPINES, COVERS, type ChalkSpec, type PaintLine } from './textures'
import { RoomBuilder, canvas, clamp, lerp, plankBox, texFrom, type Rng } from './util'

/*
 * ROOM KIT pieces: each add*() poses one real fixture of the bar into the
 * builder's CURRENT frame (metres; y up; the wall is the plane z = 0 and the
 * room is +z unless noted). The composers (compose.ts) and the standalone
 * makers (index.ts) call these.
 */

export interface Ctx {
  b: RoomBuilder
  M: RoomMaterials
  r: Rng
  mobile: boolean
  /** unique maps/materials this kit owns (disposed with it) */
  owned: { dispose(): void }[]
  /** objects whose materials carry the pools but live outside the builder's merges (sleeves) */
  hooks: THREE.Object3D[]
  /** named slots, in the kit's root space */
  anchors: Record<string, THREE.Vector3>
}

export const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z)
const EPS = 0.004

/** a walnut box (planks at real scale; `vertical` turns the boards on the faces) */
export function wood(c: Ctx, w: number, h: number, d: number, x: number, y: number, z: number, { vertical = false, tile = 1.2 } = {}) {
  c.b.merge(plankBox(w, h, d, { vertical, tile, ou: c.r() * 7, ov: c.r() * 7 }), c.M.walnut, T(x, y, z))
}

/** a pale natural-wood box (the chalkboard frames, ref6): fine grain at real scale, along x (or up, `vertical`) */
export function paleWood(c: Ctx, w: number, h: number, d: number, x: number, y: number, z: number, { vertical = false } = {}) {
  c.b.merge(plankBox(w, h, d, { vertical, tile: 0.3, ou: c.r() * 7, ov: c.r() * 7 }), c.M.maple, T(x, y, z))
}

/** a plain box in any kit material, centred at (x, y, z) */
export function box(c: Ctx, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  c.b.merge(new THREE.BoxGeometry(w, h, d), mat, T(x, y, z))
}

// ─── walnut cladding ────────────────────────────────────────────────────────

/** a clad wall: x ∈ [x − w/2, x + w/2], y ∈ [y, y + h], front face at z + depth */
export function addPlankWall(c: Ctx, w: number, h: number, { dir = 'h' as 'h' | 'v', depth = 0.02, x = 0, y = 0, z = 0 } = {}) {
  wood(c, w, h, depth, x, y + h / 2, z + depth / 2, { vertical: dir === 'v', tile: dir === 'v' ? 1.6 : 1.2 })
}

/**
 * A boxy clad column (ref1/ref4): wide vertical boards on the front, horizontal
 * boards on the sides, corner trims. Back on z, front face at z + d.
 */
export function addPlankColumn(c: Ctx, w: number, d: number, h: number, { x = 0, y = 0, z = 0, trim = true, cap = false } = {}) {
  const t = 0.022
  // the front: long wide boards (a 2.4 m tile: 18–38 cm boards, few butt joints)
  wood(c, w, h, t, x, y + h / 2, z + d - t / 2, { vertical: true, tile: 2.4 })
  for (const s of [-1, 1]) wood(c, t, h, d - t, x + s * (w / 2 - t / 2), y + h / 2, z + (d - t) / 2)
  if (trim) for (const s of [-1, 1]) wood(c, 0.03, h, 0.03, x + s * (w / 2 - 0.012), y + h / 2, z + d - 0.012, { vertical: true })
  if (cap) wood(c, w + 0.02, 0.03, d + 0.02, x, y + h + 0.015, z + d / 2)
  c.anchors.__colFront = new THREE.Vector3(x, y, z + d)
}

/** a walnut shelf board: top surface at y, from the wall (z) out to z + d */
export function addShelf(c: Ctx, w: number, d: number, { x = 0, y = 0, z = 0, thick = 0.032 } = {}) {
  wood(c, w, thick, d, x, y - thick / 2, z + d / 2)
}

// ─── brick ──────────────────────────────────────────────────────────────────

/** an exposed brick panel on the wall plane (optionally hand-painted), x-centred, from y up */
export function addBrickPanel(c: Ctx, w: number, h: number, { x = 0, y = 0, z = 0, lines = [] as PaintLine[], seed = 3, soot = 0.5 } = {}) {
  // maps are cached by their arguments (prepareRoom() can build them ahead, across frames)
  const { map, data } = brickPanelMaps(w, h, { lines, seed, soot })
  const mat = kitPools(
    new THREE.MeshStandardMaterial({ map, roughnessMap: data, bumpMap: data, bumpScale: 3.2, roughness: 1, envMapIntensity: 0.35 }),
    c.M.pools,
    'brick',
  )
  c.owned.push(mat)
  c.b.merge(new THREE.PlaneGeometry(w, h), mat, T(x, y + h / 2, z + 0.003))
}

// ─── LPs ────────────────────────────────────────────────────────────────────

/** unit LP box: base at y = 0, x = thickness, z = depth; ±x faces are covers (aKind 1), the rest spines */
export function recordGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1)
  g.translate(0, 0.5, 0)
  const kind = new Float32Array(24)
  for (let i = 0; i < 8; i++) kind[i] = 1
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1))
  return g
}

type Poly = [number, number][]
function rectPoly(t: number, h: number, phi: number, px: number, py: number): Poly {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  return (
    [
      [-t / 2, 0],
      [t / 2, 0],
      [t / 2, h],
      [-t / 2, h],
    ] as Poly
  ).map(([x, y]) => [x * c - y * s + px, x * s + y * c + py])
}
function xRange(p: Poly, y: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    const y0 = Math.min(a[1], b[1])
    const y1 = Math.max(a[1], b[1])
    if (y < y0 - 1e-9 || y > y1 + 1e-9) continue
    if (Math.abs(b[1] - a[1]) < 1e-9) {
      lo = Math.min(lo, a[0], b[0])
      hi = Math.max(hi, a[0], b[0])
    } else {
      const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
  }
  return lo <= hi ? [lo, hi] : null
}
/** smallest shift s so that B + s sits right of A with `gap` at every shared height */
function shiftRightOf(A: Poly, B: Poly, gap: number) {
  const aY0 = Math.min(...A.map(p => p[1]))
  const aY1 = Math.max(...A.map(p => p[1]))
  const bY0 = Math.min(...B.map(p => p[1]))
  const bY1 = Math.max(...B.map(p => p[1]))
  const y0 = Math.max(aY0, bY0)
  const y1 = Math.min(aY1, bY1)
  if (y1 < y0) return -Infinity
  const ys = [y0, y1, ...A.map(p => p[1]), ...B.map(p => p[1])].filter(y => y >= y0 && y <= y1)
  let s = -Infinity
  for (const y of ys) {
    const a = xRange(A, y)
    const b = xRange(B, y)
    if (a && b) s = Math.max(s, a[1] - b[0] + gap)
  }
  return s
}

export interface RecordRowOpts {
  /** clear interior along x (between the dividers) */
  x0: number
  x1: number
  /** the shelf top */
  y: number
  /** the wall (records' backs keep EPS off it) */
  zBack: number
  /** shelf depth from zBack */
  depth: number
  /** 7" singles instead of 12" LPs */
  singles?: boolean
  /** black divider cards now and then */
  dividers?: boolean
  /** 0..1 how full (leaves a loose, leaning end) */
  fill?: number
  /**
   * the clear height over the shelf top (to the underside of the board
   * above): every sleeve and divider, leaning or not, is kept 2 mm under it
   */
  maxH?: number
}

/** a black divider card: a touch taller than the sleeves (so it reads), still under a 0.333 m clear row */
const DIVIDER_H = 0.326

/**
 * A shelf row PACKED with records, spines out: runs of parallel sleeves (some
 * upright, some leaning 3–14°), the odd one pulled forward, black dividers.
 * Placement is exact: every sleeve is posed as a rotated rectangle and pushed
 * right until it clears the last ones by 0.4 mm at every height — nothing
 * interpenetrates, nothing passes through the shelf, the dividers or the wall.
 */
export function addRecordRow(c: Ctx, o: RecordRowOpts) {
  const r = c.r
  const singles = !!o.singles
  const placed: Poly[] = []
  const xEnd = o.x0 + (o.x1 - o.x0) * (o.fill ?? 1)
  let count = 0
  let stop = false
  let sinceDiv = 0
  const spec = () => {
    const div = !singles && o.dividers !== false && sinceDiv > 22 && r() < 0.08
    if (div) {
      sinceDiv = 0
      return { t: 0.0016, h: DIVIDER_H, d: 0.3, div: true }
    }
    sinceDiv++
    if (singles) return { t: lerp(0.0022, 0.0034, r()), h: 0.181, d: 0.181, div: false }
    const gate = r() < 0.06
    return { t: gate ? lerp(0.0075, 0.0095, r()) : lerp(0.0032, 0.0058, r()), h: lerp(0.311, 0.316, r()), d: lerp(0.311, 0.316, r()), div: false }
  }
  while (!stop) {
    const n = 3 + Math.floor(r() * (singles ? 30 : 22))
    const roll = r()
    let theta = roll < 0.68 ? (r() - 0.5) * 0.02 : roll < 0.9 ? lerp(0.04, 0.17, r()) : -lerp(0.04, 0.12, r())
    const gapExtra = r() < 0.14 ? lerp(0.006, 0.03, r()) : 0
    for (let k = 0; k < n; k++) {
      const s = spec()
      let placedOk = false
      for (let attempt = 0; attempt < 2 && !placedOk; attempt++) {
        const phi = -theta
        const lift = (s.t / 2) * Math.abs(Math.sin(phi)) + 0.0006
        // never up into the board above: the top corner (lift + h·cos φ + t/2·|sin φ|) keeps 2 mm under it
        const hMax = ((o.maxH ?? Infinity) - 0.002 - lift - (s.t / 2) * Math.abs(Math.sin(phi))) / Math.cos(phi)
        const h = Math.min(s.h, hMax)
        const poly = rectPoly(s.t, h, phi, 0, o.y + lift)
        let dx = o.x0 + EPS - Math.min(...poly.map(p => p[0]))
        for (let j = Math.max(0, placed.length - 10); j < placed.length; j++) dx = Math.max(dx, shiftRightOf(placed[j], poly, 0.0004 + (k === 0 ? gapExtra : 0)))
        const maxX = Math.max(...poly.map(p => p[0])) + dx
        if (maxX > Math.min(xEnd, o.x1 - EPS)) {
          if (theta !== 0) {
            theta = 0
            continue
          }
          stop = true
          break
        }
        placedOk = true
        placed.push(poly.map(([x, y]) => [x + dx, y] as [number, number]))
        // depth: backs EPS off the wall, a few pulled forward (never past the lip + 3 cm)
        const maxPull = Math.max(0, o.depth + 0.03 - s.d - EPS)
        const pull = s.div ? Math.min(0.012, maxPull) : r() < 0.1 ? Math.min(maxPull, lerp(0.01, 0.05, r())) : r() * Math.min(0.008, maxPull)
        const zc = o.zBack + EPS + s.d / 2 + pull
        const m = new THREE.Matrix4()
          .makeTranslation(dx, o.y + lift, zc)
          .multiply(new THREE.Matrix4().makeRotationZ(phi))
          .multiply(new THREE.Matrix4().makeScale(s.t, h, s.d))
        const tint = s.div ? 0.06 : lerp(0.72, 1.06, r())
        const warm = lerp(-0.04, 0.04, r())
        c.b.instance('records', recordGeometry, c.M.records, m, {
          color: new THREE.Color(tint * (1 + warm), tint, tint * (1 - warm)),
          attrs: { aArt: [Math.floor(r() * SPINES), Math.floor(r() * COVERS)] },
        })
        count++
      }
      if (stop) break
    }
  }
  return count
}

/**
 * A walnut record shelf with side dividers: `rows` shelves (0.36 m apart),
 * each packed by addRecordRow. Local frame: x ∈ [x0, x1], wall at z, the
 * first shelf top at y.
 */
export function addRecordShelf(c: Ctx, x0: number, x1: number, { y = 0, z = 0, rows = 1, depth = 0.34, singles = false, sides = true, top = true } = {}) {
  const pitch = singles ? 0.23 : 0.365
  const th = 0.032
  const w = x1 - x0
  const cx = (x0 + x1) / 2
  const side = 0.028
  for (let i = 0; i < rows; i++) {
    const yy = y + i * pitch
    addShelf(c, w, depth, { x: cx, y: yy, z, thick: th })
    // (the top row's clear height assumes a board over it too: `top`, or the caller's own shelf)
    addRecordRow(c, { x0: x0 + (sides ? side : 0), x1: x1 - (sides ? side : 0), y: yy, zBack: z, depth, singles, fill: i === rows - 1 ? 0.97 : 1, maxH: pitch - th })
  }
  // the top board sits at y + rows·pitch; without it the sides stop under the next shelf (the caller's)
  if (top) addShelf(c, w, depth, { x: cx, y: y + rows * pitch, z, thick: th })
  if (sides) {
    const y0 = y - th
    const y1 = y + rows * pitch - (top ? 0 : th)
    for (const s of [x0 + side / 2, x1 - side / 2]) wood(c, side, y1 - y0, depth, s, (y0 + y1) / 2, z + depth / 2)
  }
}

/**
 * ref4's "singles" rack: an open walnut box tipped back so the 7"s lean on
 * the wall; the records stand upright in the box's own frame (no clipping
 * however steep the tip). Local frame: wall at z, box bottom-back at (x, y).
 */
export function addSinglesRack(c: Ctx, w: number, { x = 0, y = 0, z = 0, tilt = 0.32 } = {}) {
  const H = 0.2
  const D = 0.215
  const th = 0.016
  // tipped back about its back-bottom edge, pushed out so the back board clears the wall
  c.b.push(x, y, z + H * Math.sin(tilt) + EPS, -tilt, 0, 0)
  wood(c, w, th, D, 0, th / 2, D / 2)
  wood(c, w, H, th, 0, H / 2, th / 2)
  for (const s of [-1, 1]) wood(c, th, H * 0.75, D, s * (w / 2 - th / 2), (H * 0.75) / 2, D / 2)
  addRecordRow(c, { x0: -w / 2 + th, x1: w / 2 - th, y: th, zBack: th, depth: D - th - 0.004, singles: true })
  c.b.pop()
}

/**
 * ref4's black steel face-out ledge with ONE sleeve leaning back on the
 * column. The sleeve (kit/vinyl makeSleeve) is posed exactly: its top edge
 * keeps 3 mm off the column, its foot sits in the ledge behind the lip.
 * Local frame: column face at z = 0, the ledge's centre at x = 0, plate top y.
 */
export function addRecordLedge(c: Ctx, { length = 0.34, sleeve = null as Sleeve | null, lean = 0.1, scale = 0.315 } = {}) {
  const st = 0.014 * scale // board thickness (SLEEVE.t × scale)
  const zp = 0.003 + scale * Math.sin(lean) + (st / 2) * Math.cos(lean)
  const lipIn = zp + (st / 2) * Math.cos(lean) + 0.003
  const depth = lipIn + 0.004
  const plate = 0.004
  // plate, lip, back flange, two screws
  box(c, c.M.steel, length, plate, depth, 0, -plate / 2, depth / 2)
  box(c, c.M.steel, length, 0.024, 0.004, 0, 0.012 - plate, lipIn + 0.002)
  box(c, c.M.steel, length, 0.03, 0.003, 0, -0.015, 0.0015)
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.004, 0.004, 0.003, 10)
    g.rotateX(Math.PI / 2)
    c.b.merge(g, c.M.chrome, T(s * length * 0.38, -0.016, 0.0045))
  }
  if (sleeve) {
    const lift = (st / 2) * Math.sin(lean) + 0.0008
    const m = new THREE.Matrix4()
      .makeTranslation(0, lift, zp)
      .multiply(new THREE.Matrix4().makeRotationX(-lean))
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    c.b.object(sleeve.group, m)
    withPools(sleeve.material, c.M.pools, 'sleeve')
    c.hooks.push(sleeve.mesh)
  }
  return { top: c.b.at(0, scale * Math.cos(lean), zp - scale * Math.sin(lean)), centre: c.b.at(0, (scale / 2) * Math.cos(lean), zp - (scale / 2) * Math.sin(lean)) }
}

export interface LeanPose {
  /** the sleeve group's position (x = 0; add your own x) */
  position: THREE.Vector3
  /** its rotation (order 'YXZ': lean back about its own x, then the yaw) */
  rotation: THREE.Euler
}
/**
 * The exact pose for a kit/vinyl sleeve (pivot at its bottom-centre edge)
 * standing on a surface (y = 0) and leaning back on a wall (the plane z = 0,
 * room toward +z) by `lean` radians, turned by `yaw`: no corner passes
 * through the wall or the surface. The worst back corner keeps `clearance`
 * off the wall — with a yaw, a top corner swings back by (w/2)·|sin yaw|,
 * which is how sleeves lost their corners in the brick.
 *   const p = leanOnWall({ lean: 0.14, yaw: 0.08, scale: 4.26 })
 *   sleeve.group.position.copy(p.position).add(wallPoint); sleeve.group.rotation.copy(p.rotation)
 * size: 12 | 7; scale: the sleeve group's scale (world units per kit/vinyl unit).
 */
export function leanOnWall({ lean = 0.14, yaw = 0, scale = 1, size = 12 as 12 | 7, clearance = 0.003 / 0.315, thin = false } = {}): LeanPose {
  const e = size === 7 ? 0.586 : 1 // SEVEN
  const w = e * scale
  const h = e * scale
  const t = (size === 7 ? (thin ? 0.0125 : 0.016) : thin ? 0.0075 : 0.014) * e * scale
  const cl = Math.abs(clearance * scale)
  const sy = Math.abs(Math.sin(yaw))
  const cy = Math.cos(yaw)
  const z = cl + (w / 2) * sy + (h * Math.sin(lean) + (t / 2) * Math.cos(lean)) * cy
  const y = (t / 2) * Math.sin(lean) + cl * 0.25
  return { position: new THREE.Vector3(0, y, z), rotation: new THREE.Euler(-lean, yaw, 0, 'YXZ') }
}

/**
 * A sleeve standing on a surface (y = 0), leaning back on the wall (z = 0)
 * by `lean` with 3 mm to spare at the top and its foot clear of the wall.
 */
export function addLeaningSleeve(c: Ctx, sleeve: Sleeve, { lean = 0.16, scale = 0.315, x = 0, yaw = 0 } = {}) {
  const st = 0.014 * scale
  const p = leanOnWall({ lean, yaw, scale })
  const zp = p.position.z
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, p.position.y + 0.0006, zp),
    new THREE.Quaternion().setFromEuler(p.rotation),
    new THREE.Vector3(scale, scale, scale),
  )
  c.b.object(sleeve.group, m)
  withPools(sleeve.material, c.M.pools, 'sleeve')
  c.hooks.push(sleeve.mesh)
  return { footZ: zp + st, centre: c.b.at(x, (scale / 2) * Math.cos(lean), zp - (scale / 2) * Math.sin(lean)) }
}

// ─── bottles ────────────────────────────────────────────────────────────────

interface BottleShape {
  pts: [number, number][]
  label: [number, number]
  foil: number
  /** bounding radius */
  R: number
  h: number
  segs?: number
  phi0?: number
  flat?: boolean
}
const SHAPES: BottleShape[] = [
  // tall gin / vodka
  { pts: [[0, 0], [0.036, 0], [0.0385, 0.004], [0.0385, 0.19], [0.036, 0.205], [0.028, 0.222], [0.018, 0.236], [0.0145, 0.245], [0.0145, 0.285], [0.0155, 0.288], [0.0155, 0.298], [0.0135, 0.3], [0, 0.3]], label: [0.05, 0.16], foil: 0.268, R: 0.0385, h: 0.3 },
  // bourbon: round shoulder, short neck
  { pts: [[0, 0], [0.04, 0], [0.0425, 0.005], [0.0425, 0.16], [0.039, 0.18], [0.028, 0.198], [0.017, 0.21], [0.0155, 0.215], [0.0155, 0.255], [0.0165, 0.258], [0.0165, 0.268], [0, 0.27]], label: [0.04, 0.14], foil: 0.23, R: 0.0425, h: 0.27 },
  // long neck
  { pts: [[0, 0], [0.034, 0], [0.036, 0.005], [0.036, 0.175], [0.033, 0.195], [0.022, 0.225], [0.0145, 0.245], [0.0135, 0.292], [0.0145, 0.296], [0.0145, 0.305], [0, 0.306]], label: [0.05, 0.15], foil: 0.262, R: 0.036, h: 0.306 },
  // squat liqueur
  { pts: [[0, 0], [0.046, 0], [0.049, 0.006], [0.049, 0.13], [0.045, 0.148], [0.03, 0.166], [0.018, 0.176], [0.016, 0.182], [0.016, 0.214], [0.0175, 0.217], [0.0175, 0.226], [0, 0.227]], label: [0.035, 0.115], foil: 0.195, R: 0.049, h: 0.227 },
  // square whiskey (a 4-sided lathe)
  { pts: [[0, 0], [0.047, 0], [0.05, 0.004], [0.05, 0.17], [0.045, 0.186], [0.02, 0.2], [0.016, 0.206], [0.016, 0.25], [0.0175, 0.254], [0.0175, 0.262], [0, 0.263]], label: [0.045, 0.14], foil: 0.225, R: 0.05, h: 0.263, segs: 4, phi0: Math.PI / 4, flat: true },
]

function bottleGeometry(sh: BottleShape, segs: number) {
  // insert profile points at the label edges so no triangle straddles them
  const pts: [number, number][] = []
  for (let i = 0; i < sh.pts.length; i++) {
    const a = sh.pts[i]
    pts.push(a)
    const b = sh.pts[i + 1]
    if (!b) break
    for (const yy of [sh.label[0], sh.label[1], sh.foil]) {
      if (yy > a[1] + 1e-4 && yy < b[1] - 1e-4) pts.push([a[0] + ((yy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), yy])
    }
  }
  pts.sort((p, q) => p[1] - q[1] || p[0] - q[0])
  let g: THREE.BufferGeometry = new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    sh.segs ?? segs,
    sh.phi0 ?? 0,
  )
  g = g.toNonIndexed()
  if (sh.flat) g.computeVertexNormals()
  const pos = g.attributes.position as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  const n = pos.count
  const part = new Float32Array(n)
  const lv = new Float32Array(n)
  const around = new Float32Array(n)
  for (let i = 0; i < n; i += 3) {
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
    const p = cy > sh.foil ? 2 : cy > sh.label[0] && cy < sh.label[1] ? 1 : 0
    for (let k = 0; k < 3; k++) {
      part[i + k] = p
      lv[i + k] = clamp((pos.getY(i + k) - sh.label[0]) / (sh.label[1] - sh.label[0]))
      // lathe u → 0 faces +z; square bottles: phi0 = 45° (a flat faces the front)
      around[i + k] = uv.getX(i + k) + (sh.phi0 ?? 0) / (Math.PI * 2)
    }
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1))
  g.setAttribute('aLabelV', new THREE.BufferAttribute(lv, 1))
  g.setAttribute('aAround', new THREE.BufferAttribute(around, 1))
  g.deleteAttribute('uv')
  return g
}

/** how far a pour spout's tip stands above the bottle's lip (the cork sits 12 mm down the neck) */
const SPOUT_PROUD = 0.058

function spoutGeometry() {
  const cork = new THREE.CylinderGeometry(0.0092, 0.0118, 0.024, 12, 1)
  cork.translate(0, 0.004, 0)
  // a short tapered speed spout, kinked forward at the tip (ref4: ≈ 1/8 of the bottle, not a third)
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.012, 0),
    new THREE.Vector3(0, 0.045, 0),
    new THREE.Vector3(0, 0.058, 0.004),
    new THREE.Vector3(0, 0.066, 0.014),
  ])
  const tube = new THREE.TubeGeometry(path, 12, 0.0036, 8, false)
  {
    // taper: thinner toward the tip
    const p = tube.attributes.position as THREE.BufferAttribute
    const uv = tube.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const u = uv.getX(i)
      const c = path.getPointAt(Math.min(1, u))
      const k = 1 - 0.55 * u
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k)
    }
    tube.computeVertexNormals()
  }
  const parts = [cork.toNonIndexed(), tube.toNonIndexed()]
  const cols: number[] = []
  parts.forEach((p, i) => {
    for (let k = 0; k < p.attributes.position.count; k++) cols.push(...(i === 0 ? [0.03, 0.03, 0.03] : [1, 1, 1]))
    p.deleteAttribute('uv')
  })
  const pos: number[] = []
  const nor: number[] = []
  for (const p of parts) {
    pos.push(...(p.attributes.position.array as Float32Array))
    nor.push(...(p.attributes.normal.array as Float32Array))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  cork.dispose()
  tube.dispose()
  parts.forEach(p => p.dispose())
  return g
}

/** coloured glass (the liquid reads through it): ambers, browns, the odd green */
const LIQUORS = ['#6a3208', '#7d420f', '#4a1f06', '#a3601f', '#8a5018', '#3c4441', '#4a5350', '#23401f', '#551209', '#2e2012', '#b07a2a', '#5a2a0a', '#6a3a14']
/**
 * what CLEAR glass holds (ref1/ref4: most of the rail is clear spirits): water-white
 * vodka/gin/blanco, pale straw, whiskey and rum ambers, a gold liqueur
 */
const SPIRITS = ['#e2dccb', '#d8d2c0', '#cfd3cc', '#e4e2d6', '#dcd6c2', '#d9c48e', '#c07a2a', '#a8601c', '#b8742a', '#8a4512', '#c9a94a']
const LABELS = ['#e3d8bf', '#ece8de', '#1d1a17', '#a88c62', '#7c2a22', '#26303f', '#d6ccb2', '#2a2622', '#c2a25c', '#efe6d2', '#e0d6c0']
const fract = (v: number) => v - Math.floor(v)

/**
 * One row of bottles along x (centres from x0 to x1) on a surface at y,
 * centred at depth z (± jitter within `slack`). spout: chance of a chrome
 * pour spout. clear: share of clear-glass bottles (their liquid shows its own
 * colour below the fill line; above it the glass is clear). Returns the count.
 */
export function addBottleRow(c: Ctx, x0: number, x1: number, { y = 0, z = 0, slack = 0.01, spout = 0.8, tall = 1, maxH = Infinity, clear = 0.4 } = {}) {
  const r = c.r
  const segs = c.mobile ? 12 : 18
  let x = x0
  let n = 0
  let first = true
  for (;;) {
    const si = Math.floor(r() * SHAPES.length)
    const sh = SHAPES[si]
    const gap = lerp(0.004, 0.018, r())
    const cx = first ? x0 + sh.R : x + gap + sh.R
    if (cx + sh.R > x1) break
    first = false
    x = cx + sh.R
    const zj = (r() - 0.5) * 2 * Math.max(0, slack)
    const yaw = (r() - 0.5) * 0.5
    // never taller than the clear height above (a shelf, a record row): 8 mm to spare
    const s = Math.min(lerp(0.94, 1.05, r()) * tall, (maxH - 0.008) / sh.h)
    const m = new THREE.Matrix4()
      .makeTranslation(cx, y + 0.0005, z + zj)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
    // (one draw decides the glass and what's in it, so the rows keep their layout)
    const gi = r()
    const isClear = fract(gi * 7.31 + 0.13) < clear
    const glass = new THREE.Color(isClear ? SPIRITS[Math.floor(fract(gi * 13.7) * SPIRITS.length)] : LIQUORS[Math.floor(gi * LIQUORS.length)])
    const label = new THREE.Color(LABELS[Math.floor(r() * LABELS.length)])
    // a spout only where it clears the shelf above (its tip stands SPOUT_PROUD over the lip)
    const spouted = r() < spout && sh.h * s + SPOUT_PROUD + 0.004 < maxH - 0.008
    c.b.instance(`bottle${si}`, () => bottleGeometry(sh, segs), c.M.bottles, m, {
      attrs: {
        aGlass: [glass.r, glass.g, glass.b],
        aClear: isClear ? 1 : 0,
        aLabel: [label.r, label.g, label.b],
        aSeed: (spouted ? -1 : 1) * (0.1 + r()),
        aFill: sh.h * lerp(0.28, 0.9, r()),
      },
    })
    if (spouted) {
      const top = sh.h * s
      const sm = new THREE.Matrix4()
        .makeTranslation(cx, y + top - 0.012 * s, z + zj)
        .multiply(new THREE.Matrix4().makeRotationY((r() - 0.5) * 0.9))
      c.b.instance('spouts', spoutGeometry, c.M.spouts, sm)
    }
    n++
  }
  return n
}

/**
 * Tiered liquor steps (ref1/ref4): black steel risers stepping up toward the
 * wall, a row of bottles on each, pour spouts on the speed rows. Local frame:
 * x ∈ [x0, x1], the steps stand on y, the back riser against the wall at z.
 */
export function addBottleSteps(c: Ctx, x0: number, x1: number, { y = 0, z = 0, tiers = 3, rise = 0.1, depth = 0.125, spout = 0.85, maxY = Infinity } = {}) {
  const w = x1 - x0
  const cx = (x0 + x1) / 2
  let n = 0
  for (let k = 0; k < tiers; k++) {
    // k = 0 is the back (highest) tier
    const top = y + 0.02 + (tiers - 1 - k) * rise
    const zf = z + (k + 1) * depth
    box(c, c.M.steel, w, top - y, depth, cx, y + (top - y) / 2, zf - depth / 2)
    n += addBottleRow(c, x0 + 0.01, x1 - 0.01, { y: top, z: zf - depth / 2, slack: depth / 2 - 0.052, spout: k === tiers - 1 ? spout : spout * 0.7, maxH: maxY - top })
  }
  return n
}

// ─── glassware ──────────────────────────────────────────────────────────────

function pintGeometry() {
  // upside down (rim on the shelf), open
  const pts = [
    [0.0432, 0],
    [0.0436, 0.004],
    [0.0418, 0.03],
    [0.0312, 0.142],
    [0.03, 0.148],
    [0.0, 0.15],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  return new THREE.LatheGeometry(pts, 20)
}

/** rows of upturned pint glasses (non-transmissive stand-ins) on a surface at y, x ∈ [x0, x1], z ∈ [z0, z1] */
export function addGlassRows(c: Ctx, x0: number, x1: number, { y = 0, z0 = 0, z1 = 0.3 } = {}) {
  const px = 0.095
  const pz = 0.096
  const nx = Math.floor((x1 - x0 - 0.01) / px)
  const nz = Math.max(1, Math.floor((z1 - z0 - 0.01) / pz))
  const ox = x0 + (x1 - x0 - (nx - 1) * px) / 2
  const oz = z0 + (z1 - z0 - (nz - 1) * pz) / 2
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (c.r() < 0.07) continue
      const m = T(ox + i * px + (c.r() - 0.5) * 0.004, y + 0.0005, oz + j * pz + (c.r() - 0.5) * 0.004)
      c.b.instance('pints', pintGeometry, c.M.glassware, m, { order: 2 })
    }
}

// ─── Edison fixtures ────────────────────────────────────────────────────────

const BULB_H = 0.137
function bulbGeometry() {
  const pts = [
    [0.0112, 0],
    [0.0125, 0.012],
    [0.02, 0.03],
    [0.028, 0.055],
    [0.032, 0.08],
    [0.031, 0.1],
    [0.025, 0.118],
    [0.015, 0.13],
    [0.005, 0.136],
    [0, BULB_H],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  return new THREE.LatheGeometry(pts, 20)
}
function filamentGeometry() {
  const pts: THREE.Vector3[] = []
  const n = 16
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const y = i % 2 ? 0.098 : 0.054
    pts.push(new THREE.Vector3(Math.cos(a) * 0.0105, y, Math.sin(a) * 0.0105))
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.05), 96, 0.0009, 4, true)
  const stem = new THREE.CylinderGeometry(0.0016, 0.0024, 0.05, 6)
  stem.translate(0, 0.028, 0)
  const merged = [g, stem]
  return merged
}
/** the teardrop wire cage around an upright bulb (socket end at y = 0) */
function cageGeometries(H = 0.176, ribs = 8) {
  const R = (y: number) => {
    const t = clamp(y / H)
    return 0.021 + 0.034 * Math.sin(Math.PI * Math.pow(t, 0.78)) - 0.015 * t
  }
  const out: THREE.BufferGeometry[] = []
  const wire = 0.0015
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 12; k++) {
      const y = (k / 12) * H
      const rr = k === 12 ? 0.004 : R(y)
      pts.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr))
    }
    out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, wire, 4, false))
  }
  for (const y of [0.004, H * 0.34, H * 0.7]) {
    const t = new THREE.TorusGeometry(R(y), wire * 1.2, 4, 28)
    t.rotateX(Math.PI / 2)
    t.translate(0, y, 0)
    out.push(t)
  }
  const top = new THREE.TorusGeometry(0.006, wire * 1.4, 4, 12)
  top.translate(0, H + 0.004, 0)
  out.push(top)
  return out
}

let glowQuad: THREE.BufferGeometry | null = null
const glowGeo = () => (glowQuad = glowQuad ?? new THREE.PlaneGeometry(1, 1)).clone()

/**
 * The bulb + filament + cage (+ halo, + light pool) at the CURRENT frame's
 * origin, bulb up (flip the frame for a hanging one). Returns the bulb centre.
 */
function addBulb(c: Ctx, { halo = 0.2, pool = 3.2, power = 1, cage = true } = {}) {
  c.b.merge(bulbGeometry(), c.M.bulb, undefined, { order: 3 })
  for (const g of filamentGeometry()) c.b.merge(g, c.M.filament)
  if (cage) for (const g of cageGeometries()) c.b.merge(g, c.M.steel)
  const centre = c.b.at(0, 0.075, 0)
  const s = new THREE.Vector3().setFromMatrixScale(c.b.m).x
  c.b.instance('glow', glowGeo, c.M.glow, new THREE.Matrix4().makeTranslation(0, 0.075, 0).multiply(new THREE.Matrix4().makeScale(halo / s, halo / s, halo / s)), {
    color: new THREE.Color(1, 0.52, 0.2).multiplyScalar(power),
    order: 4,
  })
  c.M.pools.add(centre, pool, '#ffdcb6', 0.8 * power)
  return centre
}

/**
 * ref1/ref2 wall sconce: a round aged-brass back plate, a curved arm, a
 * socket, the Edison bulb standing up in its wire cage. Local frame: the
 * wall/column face at z = 0 (plate centre at the origin). Returns the bulb centre.
 */
export function addSconce(c: Ctx, { x = 0, y = 0, z = 0, power = 1.15 } = {}) {
  c.b.push(x, y, z)
  const plate = new THREE.CylinderGeometry(0.048, 0.05, 0.012, 32)
  plate.rotateX(Math.PI / 2)
  c.b.merge(plate, c.M.brass, T(0, 0, 0.006))
  const arm = new THREE.TubeGeometry(
    new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0.01), new THREE.Vector3(0, 0, 0.13), new THREE.Vector3(0, 0.07, 0.13)),
    18,
    0.0065,
    10,
    false,
  )
  c.b.merge(arm, c.M.brass)
  const sock = new THREE.CylinderGeometry(0.017, 0.019, 0.05, 20)
  c.b.merge(sock, c.M.brass, T(0, 0.095, 0.13))
  const ring = new THREE.CylinderGeometry(0.023, 0.023, 0.008, 20)
  c.b.merge(ring, c.M.brass, T(0, 0.118, 0.13))
  c.b.push(0, 0.12, 0.13)
  const centre = addBulb(c, { power })
  c.b.pop()
  c.b.pop()
  return centre
}

/**
 * A wire-cage pendant hanging from the ceiling on a black cord (ref1/ref6).
 * Local frame: the ceiling point at the origin (the ceiling above, y < 0 is
 * the room). Returns the bulb centre.
 */
export function addPendant(c: Ctx, { x = 0, y = 0, z = 0, drop = 0.9, power = 1.5 } = {}) {
  c.b.push(x, y, z)
  const canopy = new THREE.CylinderGeometry(0.045, 0.05, 0.03, 24)
  c.b.merge(canopy, c.M.steel, T(0, -0.015, 0))
  const cord = new THREE.CylinderGeometry(0.0032, 0.0032, drop, 6)
  c.b.merge(cord, c.M.steel, T(0, -0.03 - drop / 2, 0))
  const sock = new THREE.CylinderGeometry(0.019, 0.017, 0.055, 20)
  c.b.merge(sock, c.M.steel, T(0, -0.03 - drop - 0.0275, 0))
  // bulb hangs down: flip the frame
  c.b.push(0, -0.03 - drop - 0.055, 0, Math.PI, 0, 0)
  const centre = addBulb(c, { power })
  c.b.pop()
  c.b.pop()
  return centre
}

// ─── ceiling: flex duct ─────────────────────────────────────────────────────

/**
 * Insulated silver flex duct along `pts` (a gentle curve), sagging a touch
 * between black straps every ~1.2 m, each strap hung from the ceiling at
 * `ceilingY` by a rod. Returns the duct's length.
 */
export function addDuct(c: Ctx, pts: THREE.Vector3[], { radius = 0.2, ceilingY = null as number | null, strap = 1.2 } = {}) {
  const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3) : new THREE.LineCurve3(pts[0], pts[1])
  const len = curve.getLength()
  const tub = Math.max(24, Math.round(len / 0.05))
  const g = new THREE.TubeGeometry(curve as THREE.Curve<THREE.Vector3>, tub, radius, c.mobile ? 14 : 20, false)
  const pos = g.attributes.position as THREE.BufferAttribute
  const nor = g.attributes.normal as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i)
    const s = u * len
    const between = Math.sin(Math.PI * ((s / strap) % 1))
    const bulge = radius * (0.05 * Math.pow(Math.max(0, between), 0.7) + 0.012 * Math.sin(s * 34 + uv.getY(i) * 9))
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * bulge, pos.getY(i) + nor.getY(i) * bulge, pos.getZ(i) + nor.getZ(i) * bulge)
    uv.setXY(i, (u * len) / 0.25, uv.getY(i) * Math.max(1, Math.round((2 * Math.PI * radius) / 0.5)))
  }
  g.computeVertexNormals()
  c.b.merge(g, c.M.duct)
  // straps + hanger rods
  const n = Math.floor(len / strap)
  for (let k = 0; k <= n; k++) {
    const t = Math.min(1, (k * strap + 0.02) / len)
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    const ring = new THREE.TorusGeometry(radius * 0.985, 0.006, 4, 32)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan)
    c.b.merge(ring, c.M.steel, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)))
    if (ceilingY != null && ceilingY > p.y + radius) {
      const L = ceilingY - (p.y + radius)
      c.b.merge(new THREE.CylinderGeometry(0.005, 0.005, L, 5), c.M.steel, T(p.x, p.y + radius + L / 2, p.z))
    }
  }
  // collars at the ends
  for (const t of [0, 1]) {
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    const col = new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, 0.06, 24, 1, false)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan)
    c.b.merge(col, c.M.duct, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)))
  }
  return len
}

/** a box with UVs in metres / tile on every face (u along the box's z, its length) */
function metreBox(w: number, h: number, l: number, tile: number, ou = 0) {
  const g = new THREE.BoxGeometry(w, h, l)
  const pos = g.attributes.position as THREE.BufferAttribute
  const nrm = g.attributes.normal as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(nrm.getZ(i)) > 0.5) uv.setXY(i, x / tile + ou, y / tile)
    else if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, z / tile + ou, x / tile + 0.37)
    else uv.setXY(i, z / tile + ou, y / tile + 0.71)
  }
  return g
}

/**
 * ref1's duct: a long, straight, RECTANGULAR galvanized trunk tight under the
 * black ceiling — straight sections along the pts (their xz; the top keeps
 * `gap` under `ceilingY`, or follows the pts' y without a ceiling), a collar
 * at each turn, transverse joint flanges every ~1.2 m, black U-straps up to
 * the ceiling beside each flange, end flanges, and a black conduit run along
 * its room-side top edge. Returns the trunk's length.
 */
export function addDuctTrunk(
  c: Ctx,
  pts: THREE.Vector3[],
  { width = 0.6, height = 0.32, ceilingY = null as number | null, gap = 0.03, joint = 1.2, conduit = true } = {},
) {
  const tile = 0.6
  const yTop = (p: THREE.Vector3) => (ceilingY != null ? ceilingY - gap : p.y + height / 2)
  // sheet-metal runs are straight: drop interior points that turn the run by < 8°
  const keep: THREE.Vector3[] = [pts[0]]
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = keep[keep.length - 1]
    const h0 = Math.atan2(pts[i].x - a.x, pts[i].z - a.z)
    const h1 = Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)
    const d = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))
    if (d > 0.14) keep.push(pts[i])
  }
  if (pts.length > 1) keep.push(pts[pts.length - 1])
  const P = keep.map(p => new THREE.Vector3(p.x, yTop(p) - height / 2, p.z))
  let total = 0
  const flange = (x: number, y: number, z: number, yaw: number, grow = 0.03) => {
    c.b.merge(metreBox(width + grow, height + grow, 0.035, tile, c.r()), c.M.galv, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)))
  }
  const strap = (x: number, y: number, z: number, yaw: number) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    const up = ceilingY != null ? ceilingY - (y - height / 2) + 0.003 : height + 0.03
    const yc = y - height / 2 - 0.003 + up / 2
    for (const s of [-1, 1]) {
      const off = new THREE.Vector3(s * (width / 2 + 0.002), 0, 0).applyQuaternion(q)
      c.b.merge(new THREE.BoxGeometry(0.003, up, 0.026), c.M.steel, new THREE.Matrix4().compose(new THREE.Vector3(x + off.x, yc, z + off.z), q, new THREE.Vector3(1, 1, 1)))
    }
    c.b.merge(new THREE.BoxGeometry(width + 0.007, 0.003, 0.026), c.M.steel, new THREE.Matrix4().compose(new THREE.Vector3(x, y - height / 2 - 0.0015, z), q, new THREE.Vector3(1, 1, 1)))
  }
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i]
    const b = P[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L = Math.hypot(dx, dz)
    if (L < 1e-3) continue
    const yaw = Math.atan2(dx, dz)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    // interior ends run into the turn's collar
    const e0 = i > 0 ? width / 2 - 0.01 : 0
    const e1 = i + 2 < P.length ? width / 2 - 0.01 : 0
    const len = L + e0 + e1
    const mid = new THREE.Vector3((a.x + b.x) / 2, a.y, (a.z + b.z) / 2).addScaledVector(new THREE.Vector3(dx / L, 0, dz / L), (e1 - e0) / 2)
    c.b.merge(metreBox(width, height, len, tile, c.r() * 5), c.M.galv, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)))
    // joint flanges + straps along the section
    const n = Math.max(1, Math.round(L / joint))
    for (let k = 1; k < n; k++) {
      const t = k / n
      const x = a.x + dx * t
      const z = a.z + dz * t
      flange(x, a.y, z, yaw)
      const so = 0.22
      strap(x + (dx / L) * so, a.y, z + (dz / L) * so, yaw)
    }
    if (n === 1) strap(a.x + dx * 0.5, a.y, a.z + dz * 0.5, yaw)
    // the conduit: a black pipe along the room-side top edge, clipped every ~0.8 m
    if (conduit) {
      let nx = -dz / L
      let nz = dx / L
      if (nz < -1e-6 || (Math.abs(nz) < 1e-6 && nx < 0)) {
        nx = -nx
        nz = -nz
      }
      const rr = 0.011
      const ox = nx * (width / 2 + rr + 0.004)
      const oz = nz * (width / 2 + rr + 0.004)
      const cy = a.y + height / 2 - 0.035
      const pipe = new THREE.CylinderGeometry(rr, rr, len + (i + 2 < P.length ? width : 0), 10)
      pipe.rotateX(Math.PI / 2)
      c.b.merge(pipe, c.M.steel, new THREE.Matrix4().compose(new THREE.Vector3(mid.x + ox, cy, mid.z + oz), q, new THREE.Vector3(1, 1, 1)))
      const nc = Math.max(1, Math.floor(L / 0.8))
      for (let k = 0; k <= nc; k++) {
        const t = (k + 0.5) / (nc + 1)
        c.b.merge(new THREE.BoxGeometry(rr * 2.6, rr * 2.6, 0.018), c.M.steel, new THREE.Matrix4().compose(new THREE.Vector3(a.x + dx * t + ox * 0.94, cy, a.z + dz * t + oz * 0.94), q, new THREE.Vector3(1, 1, 1)))
      }
    }
    // end flanges on the open ends
    if (i === 0) flange(a.x, a.y, a.z, yaw, 0.024)
    if (i + 2 === P.length) flange(b.x, b.y, b.z, yaw, 0.024)
    total += L
  }
  // a collar at each turn (a touch bigger, so its faces never fight the sections')
  for (let i = 1; i + 1 < P.length; i++) {
    const a = P[i - 1]
    const yaw = Math.atan2(P[i].x - a.x, P[i].z - a.z)
    c.b.merge(metreBox(width + 0.012, height + 0.012, width + 0.012, tile, c.r()), c.M.galv, new THREE.Matrix4().compose(P[i], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)))
  }
  return total
}

// ─── chalkboards ────────────────────────────────────────────────────────────

/**
 * A tall black chalkboard in a pale natural-wood frame (ref6), hung on the wall
 * (z = 0) with its bottom at y. Legible chalk comes only from `spec`.
 */
export function addChalkboard(c: Ctx, w: number, h: number, spec: ChalkSpec, { x = 0, y = 0, z = 0 } = {}) {
  const res = c.mobile ? 384 : 512
  const W = res
  const H = Math.round((res * h) / w)
  const { cv, g } = canvas(W, H)
  // the bare slate until the chalk face is in
  g.fillStyle = '#131514'
  g.fillRect(0, 0, W, H)
  const map = texFrom(cv, { repeat: false, free: false })
  // drawn ONCE with the face in (not again on every font event), then the
  // canvas is freed as soon as it's on the GPU
  let done = false
  const draw = () => {
    if (done) return
    if (cv.width !== W || cv.height !== H) {
      cv.width = W
      cv.height = H
    }
    drawChalk(g, W, H, spec)
    map.needsUpdate = true
    if ((done = chalkFontReady()))
      map.onUpdate = () => {
        cv.width = cv.height = 1
        map.onUpdate = null
      }
  }
  if (chalkFontReady()) draw()
  else onFonts(draw)
  const mat = kitPools(new THREE.MeshStandardMaterial({ map, roughness: 0.92, envMapIntensity: 0.25 }), c.M.pools, 'chalk')
  c.owned.push(map, mat)
  const f = 0.045
  c.b.merge(new THREE.PlaneGeometry(w, h), mat, T(x, y + h / 2, z + 0.012))
  box(c, c.M.steel, w, h, 0.01, x, y + h / 2, z + 0.005)
  // the frame: pale natural wood, as on the real tap boards (ref6) — it pops on the black wall
  paleWood(c, w + 2 * f, f, 0.026, x, y + h + f / 2, z + 0.013)
  paleWood(c, w + 2 * f, f, 0.026, x, y - f / 2, z + 0.013)
  for (const s of [-1, 1]) paleWood(c, f, h, 0.026, x + s * (w / 2 + f / 2), y + h / 2, z + 0.013, { vertical: true })
}

// ─── hi-fi, TV ──────────────────────────────────────────────────────────────

/** receiver (blue ring + display) on a slim streamer/amp. Local: base centre at origin, front +z. Returns the turntable seat (top centre). */
export function addHifi(c: Ctx, { x = 0, y = 0, z = 0, d = 0.33 } = {}) {
  const W = 0.43
  const amp = 0.085
  const rec = 0.145
  const hm = hifiMaps()
  let mat = c.M.list.find(m => m.name === 'room-hifi') as THREE.MeshStandardMaterial | undefined
  if (!mat) {
    mat = kitPools(
      new THREE.MeshStandardMaterial({ map: hm.map, emissiveMap: hm.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 2.4, roughness: 0.42, metalness: 0.5 }),
      c.M.pools,
      'hifi',
    )
    mat.name = 'room-hifi'
    c.M.list.push(mat)
  }
  c.b.push(x, y, z)
  box(c, c.M.steel, W - 0.006, amp - 0.004, d, 0, amp / 2, 0)
  box(c, c.M.steel, W, rec - 0.004, d, 0, amp + rec / 2, 0)
  // faces: amp = bottom half of the map, receiver = top half
  const face = (h: number, yc: number, v0: number) => {
    const g = new THREE.PlaneGeometry(W - 0.004, h)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * 0.5)
    c.b.merge(g, mat!, T(0, yc, d / 2 + 0.0012))
  }
  face(amp - 0.006, amp / 2, 0)
  face(rec - 0.006, amp + rec / 2, 0.5)
  // the volume knob in its ring
  const knob = new THREE.CylinderGeometry(0.036, 0.038, 0.022, 32)
  knob.rotateX(Math.PI / 2)
  c.b.merge(knob, c.M.steel, T(((380 / 512) - 0.5) * (W - 0.004), amp + rec / 2 + (0.5 - 124 / 256) * (rec - 0.006), d / 2 + 0.012))
  // feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(c, c.M.steel, 0.03, 0.006, 0.03, sx * (W / 2 - 0.04), -0.003 + 0.003, sz * (d / 2 - 0.04))
  const seat = c.b.at(0, amp + rec, 0)
  c.b.pop()
  return seat
}

/** an optional wall TV: dark glass, a very dim abstract pitch when `on` (no logos, no flashing) */
export function addTV(c: Ctx, w = 1.0, h = 0.58, { x = 0, y = 0, z = 0, on = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#050606',
    roughness: 0.1,
    metalness: 0.2,
    emissiveMap: pitchTexture(),
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: on ? 0.18 : 0,
    envMapIntensity: 0.35,
  })
  c.owned.push(mat)
  box(c, c.M.steel, w + 0.02, h + 0.02, 0.05, x, y + h / 2, z + 0.03)
  c.b.merge(new THREE.PlaneGeometry(w, h), mat, T(x, y + h / 2, z + 0.0555))
  return mat
}

// ─── coolers, counter ───────────────────────────────────────────────────────

/**
 * An under-counter glass-door cooler (ref1): black carcass, `doors` framed
 * glass doors over a cool-lit interior (gentle), chrome pulls, a vent kick.
 * Local: back at z, front face at z + d, base y.
 */
export function addCooler(c: Ctx, w: number, h: number, d: number, { x = 0, y = 0, z = 0, doors = 2 } = {}) {
  box(c, c.M.steel, w, h, d - 0.02, x, y + h / 2, z + (d - 0.02) / 2)
  const kick = 0.075
  const dw = w / doors
  const fz = z + d
  for (let i = 0; i < doors; i++) {
    const cx = x - w / 2 + dw * (i + 0.5)
    const fw = 0.034
    const top = y + h - 0.02
    const bot = y + kick
    const dh = top - bot
    // frame
    box(c, c.M.steel, dw - 0.006, fw, 0.03, cx, top - fw / 2, fz - 0.015)
    box(c, c.M.steel, dw - 0.006, fw, 0.03, cx, bot + fw / 2, fz - 0.015)
    for (const s of [-1, 1]) box(c, c.M.steel, fw, dh, 0.03, cx + s * (dw / 2 - 0.003 - fw / 2), bot + dh / 2, fz - 0.015)
    // interior (lit), glass in front
    const iw = dw - 0.006 - 2 * fw
    const ih = dh - 2 * fw
    const g = new THREE.PlaneGeometry(iw, ih)
    const uv = g.attributes.uv as THREE.BufferAttribute
    const ou = c.r()
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (iw / 0.5) + ou)
    c.b.merge(g, c.M.coolerLight, T(cx, bot + dh / 2, fz - 0.06))
    c.b.merge(new THREE.PlaneGeometry(iw, ih), c.M.coolerGlass, T(cx, bot + dh / 2, fz - 0.012), { order: 1 })
    // pull
    const pull = new THREE.CylinderGeometry(0.006, 0.006, dh * 0.5, 8)
    c.b.merge(pull, c.M.chrome, T(cx + (i % 2 ? -1 : 1) * (dw / 2 - fw - 0.02), bot + dh * 0.55, fz + 0.012))
  }
  // vent kick
  box(c, c.M.steel, w, kick, 0.02, x, y + kick / 2, fz - 0.01)
  for (let k = 0; k < 3; k++) box(c, c.M.counter, w - 0.08, 0.006, 0.004, x, y + 0.02 + k * 0.018, fz + 0.001)
}

/** the back counter: an ebonised top (top face at y) from the wall to z + d, with a steel apron */
export function addCounter(c: Ctx, x0: number, x1: number, { y = 0.92, z = 0, d = 0.62, thick = 0.045 } = {}) {
  box(c, c.M.counter, x1 - x0, thick, d, (x0 + x1) / 2, y - thick / 2, z + d / 2)
}
