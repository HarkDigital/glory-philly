import * as THREE from 'three'
import { BRAND, DRAFTS, SOCIALS } from '../../content'
import { makeBarTop } from '../bar'
import { catNo, coverTexture, makeSleeve, makeTurntable, type Sleeve, type Turntable } from '../vinyl'
import { AMBIENT_TINT, HALO_K, kitPools, poolHook, roomMaterials, withPools, type RoomMaterials } from './materials'
import {
  T,
  addBottleRow,
  addBottleSteps,
  addBrickPanel,
  addChalkboard,
  addCooler,
  addCounter,
  addDuct,
  addDuctTrunk,
  addGlassRows,
  addHifi,
  addLeaningSleeve,
  addPendant,
  addPlankColumn,
  addPlankWall,
  addRecordLedge,
  addRecordRow,
  addRecordShelf,
  addSconce,
  addShelf,
  addSinglesRack,
  addTV,
  box,
  recordGeometry,
  wood,
  type Ctx,
} from './pieces'
import { nextFrame } from '../../core/yield'
import {
  brickPanelMapsAsync,
  coolerMap,
  ductMaps,
  galvMaps,
  glowTexture,
  grainDetail,
  hifiMaps,
  pitchTexture,
  rubberData,
  spineAtlas,
  walnutMapsAsync,
  type ChalkSpec,
  type PaintLine,
} from './textures'
import { RoomBuilder, rng } from './util'

/*
 * ROOM KIT composers: whole runs of Glory's room, each returned as a RoomKit
 * ({ group, anchors, setGlow, dispose, … }). Metres, y up, floor at y = 0,
 * the back wall is the plane z = 0 and the room is +z; group.scale is set
 * from `scale` (world units per metre).
 */

export interface RoomKit {
  /** add this to your chapter group; move/rotate it freely (scale via the `scale` option) */
  group: THREE.Group
  /** named slots in the group's LOCAL space (metres); worldAnchor() gives world positions */
  anchors: Record<string, THREE.Vector3>
  materials: RoomMaterials
  /** the deck on the receiver (only with `turntable: true`) — drive it like any kit/vinyl turntable */
  turntable: Turntable | null
  /** the sleeves posed by the kit (face-out ledge / leaning on the counter) */
  sleeves: Sleeve[]
  /** real lights (only with `lights: 1|2`; intensity follows setGlow) */
  lights: THREE.PointLight[]
  /** 0..1.5 the bulbs, their halos and light pools (drive it; nothing toggles) */
  setGlow(k: number): void
  /** 0..2 the warm bounce light in the kit's materials, independent of the bulbs (default 1 = the `ambient` option) */
  setAmbient(k: number): void
  /** world position of an anchor (call after the group is placed) */
  worldAnchor(name: string, out?: THREE.Vector3): THREE.Vector3
  /** draw calls this kit issues (for budgets) */
  draws: number
  dispose(): void
}

export interface KitOpts {
  /** world units per metre (default 1) */
  scale?: number
  seed?: number
  /** starting bulb/pool level (default 1) */
  glow?: number
  /** phones: fewer segments, smaller canvases */
  mobile?: boolean
  /** 0 | 1 | 2 real point lights at the brightest bulbs (default 0: the pools light the kit) */
  lights?: 0 | 1 | 2
  /** the bulbs' warm bounce in the kit's own materials (default 0.3; scales with setGlow) */
  ambient?: number
}

const isMobile = () => typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)

/** build a kit: `fill` poses pieces into the context; everything merges/instances on build */
export function assemble(o: KitOpts, fill: (c: Ctx) => { turntable?: Turntable | null; sleeves?: Sleeve[]; extra?: THREE.Object3D[]; bulbs?: THREE.Vector3[] } | void): RoomKit {
  const group = new THREE.Group()
  group.name = 'room-kit'
  const M = roomMaterials({ glow: 1 })
  const c: Ctx = { b: new RoomBuilder(), M, r: rng(o.seed ?? 7), mobile: o.mobile ?? isMobile(), owned: [], hooks: [], anchors: {} }
  const res = fill(c) ?? {}
  const built = c.b.build(group)
  for (const m of built.meshes) poolHook(m, M.pools, group)
  for (const h of c.hooks) poolHook(h, M.pools, group)
  for (const x of res.extra ?? []) group.add(x)
  delete c.anchors.__colFront
  const scale = o.scale ?? 1
  group.scale.setScalar(scale)

  // real lights (optional): at the first bulbs, warm, distance-limited, never toggled
  const lights: THREE.PointLight[] = []
  const bulbs = res.bulbs ?? []
  for (let i = 0; i < Math.min(o.lights ?? 0, bulbs.length); i++) {
    const l = new THREE.PointLight('#ffb36b', 0, 4.5, 2)
    l.position.copy(bulbs[i]).add(new THREE.Vector3(0, 0, 0.08))
    group.add(l)
    lights.push(l)
  }
  const amb = AMBIENT_TINT.clone().multiplyScalar(o.ambient ?? 0.3)
  M.pools.uniforms.uPoolAmb.value.copy(amb)
  const setAmbient = (k: number) => M.pools.uniforms.uPoolAmb.value.copy(amb).multiplyScalar(k)
  const fil = M.filament.color.clone()
  const bulbE = M.bulb.emissiveIntensity
  const setGlow = (k: number) => {
    M.pools.k = k
    M.glow.uniforms.uK.value = HALO_K * k
    M.filament.color.copy(fil).multiplyScalar(Math.max(0.02, k))
    M.bulb.emissiveIntensity = bulbE * k
    M.bottleGlow.value = 0.12 * (0.35 + 0.65 * k)
    for (const l of lights) l.intensity = 0.9 * k
  }
  setGlow(o.glow ?? 1)
  let draws = 0
  group.traverse(x => {
    if ((x as THREE.Mesh).isMesh) draws++
  })
  return {
    group,
    anchors: c.anchors,
    materials: M,
    turntable: res.turntable ?? null,
    sleeves: res.sleeves ?? [],
    lights,
    setGlow,
    setAmbient,
    worldAnchor(name, out = new THREE.Vector3()) {
      const a = c.anchors[name]
      if (!a) return out.set(0, 0, 0)
      group.updateWorldMatrix(true, false)
      return out.copy(a).applyMatrix4(group.matrixWorld)
    },
    draws,
    dispose() {
      built.dispose()
      M.dispose()
      for (const x of c.owned) x.dispose()
      res.turntable?.dispose()
      for (const s of res.sleeves ?? []) s.dispose()
    },
  }
}

/** a Glory typographic cover (never real album art) */
export function houseCover(i = 1, paper: 'cream' | 'red' | 'stout' | 'amber' | 'bone' = 'cream', title: string = BRAND.short) {
  return coverTexture({ title, kicker: `${BRAND.neighborhood} · Philadelphia`, cat: catNo(i), paper })
}

// ─── the back bar (ref1) ────────────────────────────────────────────────────

export interface BackBarOpts extends KitOpts {
  /** column/bulkhead height (default 3.1 m) */
  height?: number
  /** the back counter's top (default 0.92 m) */
  counterY?: number
  /** the brick bay: 'old1837' paints ref2's "Old / 1837"; PaintLine[] your own (sourced) words; true plain; false walnut */
  brick?: boolean | 'old1837' | PaintLine[]
  /** the packed LP shelf over the liquor steps (rows: 1–2; singles: metres of 7" at the right end) */
  records?: boolean | { rows?: number; singles?: number }
  bottles?: boolean
  glassware?: boolean
  sconces?: boolean
  coolers?: boolean
  hifi?: boolean
  /** a black kit/vinyl turntable on the receiver (kit.turntable) */
  turntable?: boolean
  /** a face-out LP leaning on the counter (true: a Glory cover; or pass a texture) */
  sleeve?: boolean | THREE.Texture
  /** a TV over the glass bay: off (dark glass) by default; 'on' = a very dim abstract pitch */
  tv?: false | 'off' | 'on'
  /** the black ceiling + a duct + a pendant over the run */
  ceiling?: boolean
}

/**
 * Glory's back bar, left → right as in ref1 (6.6 m, centred on x = 0):
 * column · glass bay (shelves of upturned pints, optional TV) · column with a
 * sconce · the brick bay with the painted "Old 1837", two shelves of bottles,
 * the hi-fi (+ turntable) and a face-out LP on the counter · a wide column
 * with a sconce · the records bay: a mirror strip behind tiered bottles with
 * pour spouts, a shelf packed with LPs above. Coolers glow under the counter.
 *
 * anchors: counter, counterFront, turntable, receiver, sleeve, brick, paint,
 * records, singles, bottles, glass, tv, sconceA, sconceB, sconceC, pendant, bayGlass,
 * bayBrick, bayRecords, left, right, top.
 */
export function makeBackBar(o: BackBarOpts = {}): RoomKit {
  return assemble(o, c => {
    const H = o.height ?? 3.2
    const cy = o.counterY ?? 0.92
    const wz = 0.02 // the cladding's face
    const X0 = -3.3
    const X1 = 3.3
    const colD = 0.5
    const cols = [
      { x: -2.8, w: 0.5 },
      { x: -0.85, w: 0.5 },
      { x: 1.1, w: 0.6 },
    ]
    const head = 0.24
    const A = c.anchors
    const bulbs: THREE.Vector3[] = []
    const sleeves: Sleeve[] = []
    let turntable: Turntable | null = null

    // the wall + bulkhead
    addPlankWall(c, X1 - X0, H, { depth: wz })
    wood(c, X1 - X0, head, colD - 0.02, 0, H - head / 2, wz + (colD - 0.02) / 2)
    // columns (from the counter up to the bulkhead)
    for (const k of cols) addPlankColumn(c, k.w, colD - wz, H - head - cy, { x: k.x, y: cy, z: wz })
    // the counter and what's under it
    addCounter(c, X0, X1, { y: cy, d: 0.62 })
    const underY = cy - 0.045
    const coolX0 = -0.6
    if (o.coolers !== false) {
      const n = 4
      const w = (X1 - coolX0) / n
      for (let i = 0; i < n; i++) addCooler(c, w - 0.01, underY, 0.6, { x: coolX0 + w * (i + 0.5), doors: 2 })
    }
    // walnut cabinet fronts under the glass bay (vertical boards)
    wood(c, (o.coolers !== false ? coolX0 : X1) - X0, underY, 0.6, (X0 + (o.coolers !== false ? coolX0 : X1)) / 2, underY / 2, 0.3, { vertical: true, tile: 1.6 })

    // ── bay 1: glassware (+ TV) ──
    const b1 = [cols[0].x + cols[0].w / 2, cols[1].x - cols[1].w / 2]
    A.bayGlass = new THREE.Vector3((b1[0] + b1[1]) / 2, cy, wz)
    if (o.glassware !== false) {
      for (const y of [1.4, 1.78]) {
        addShelf(c, b1[1] - b1[0], 0.3, { x: (b1[0] + b1[1]) / 2, y, z: wz })
        addGlassRows(c, b1[0] + 0.02, b1[1] - 0.02, { y, z0: wz + 0.02, z1: wz + 0.3 })
      }
      addGlassRows(c, b1[0] + 0.03, b1[1] - 0.03, { y: cy, z0: wz + 0.03, z1: wz + 0.24 })
      A.glass = new THREE.Vector3((b1[0] + b1[1]) / 2, 1.5, wz + 0.15)
    }
    if (o.tv) {
      addTV(c, 1.05, 0.6, { x: (b1[0] + b1[1]) / 2, y: 2.2, z: wz, on: o.tv === 'on' })
      A.tv = new THREE.Vector3((b1[0] + b1[1]) / 2, 2.5, wz + 0.06)
    }

    // ── bay 2: the brick with "Old 1837", bottle shelves, the hi-fi ──
    const b2 = [cols[1].x + cols[1].w / 2, cols[2].x - cols[2].w / 2]
    const b2w = b2[1] - b2[0]
    const b2x = (b2[0] + b2[1]) / 2
    A.bayBrick = new THREE.Vector3(b2x, cy, wz)
    const brickY = 1.3
    const brickH = H - head - brickY
    if (o.brick !== false) {
      const { lines, big } = backBarBrick(o, b2w, brickH)
      addBrickPanel(c, b2w, brickH, { x: b2x, y: brickY, z: wz, lines, seed: 4 })
      A.brick = new THREE.Vector3(b2x, brickY + brickH / 2, wz)
      A.paint = new THREE.Vector3(b2x, H - head - 0.2 - big * 1.33 + big / 2, wz)
    }
    if (o.bottles !== false) {
      const ys = [1.62, 2.02]
      ys.forEach((y, i) => {
        addShelf(c, b2w, 0.22, { x: b2x, y, z: wz })
        const above = i + 1 < ys.length ? ys[i + 1] - 0.032 : H - head
        addBottleRow(c, b2[0] + 0.02, b2[1] - 0.02, { y, z: wz + 0.11, slack: 0.04, spout: 0.15, maxH: above - y })
      })
    }
    if (o.hifi !== false) {
      const hx = b2[1] - 0.58
      const seat = addHifi(c, { x: hx, y: cy, z: 0.235 })
      A.turntable = seat
      A.receiver = new THREE.Vector3(hx, cy + 0.12, 0.235 + 0.165)
      if (o.turntable) {
        turntable = makeTurntable({ finish: 'black', shadows: false })
        turntable.group.scale.setScalar(0.315)
        turntable.group.position.copy(seat)
        c.b.object(turntable.group)
      }
    }
    if (o.sleeve !== false) {
      const s = makeSleeve({ front: o.sleeve instanceof THREE.Texture ? o.sleeve : houseCover(1, 'red') })
      sleeves.push(s)
      c.b.push(b2[1] - 0.175, cy, wz)
      const { centre } = addLeaningSleeve(c, s, { lean: 0.15 })
      c.b.pop()
      A.sleeve = centre
    }

    // ── bay 3: records over the liquor steps ──
    const b3 = [cols[2].x + cols[2].w / 2, X1]
    const b3x = (b3[0] + b3[1]) / 2
    A.bayRecords = new THREE.Vector3(b3x, cy, wz)
    const recY = 1.66
    // the mirror strip behind the bottles
    box(c, c.M.mirror, b3[1] - b3[0] - 0.02, recY - 0.05 - cy - 0.03, 0.006, b3x, cy + 0.03 + (recY - 0.05 - cy - 0.03) / 2, wz + 0.003)
    if (o.bottles !== false) {
      addBottleSteps(c, b3[0] + 0.02, b3[1] - 0.02, { y: cy, z: wz + 0.008, maxY: recY - 0.032 })
      A.bottles = new THREE.Vector3(b3x, cy + 0.25, wz + 0.3)
    }
    if (o.records !== false) {
      const ro = typeof o.records === 'object' ? o.records : {}
      const rows = Math.max(1, Math.min(2, ro.rows ?? 1))
      const singles = ro.singles ?? 0.42
      if (singles > 0) {
        // LPs, then a divider, then the 7" section at the right end of the bottom row
        const xs = b3[1] - singles
        addRecordShelf(c, b3[0], xs, { y: recY, z: wz, rows: 1, top: false, sides: true })
        wood(c, b3[1] - xs, 0.032, 0.34, (xs + b3[1]) / 2, recY - 0.016, wz + 0.17)
        addRecordRow(c, { x0: xs + 0.012, x1: b3[1] - 0.03, y: recY, zBack: wz, depth: 0.34, singles: true })
        wood(c, 0.028, 0.365, 0.34, b3[1] - 0.014, recY + 0.1825 - 0.032, wz + 0.17)
        A.singles = new THREE.Vector3((xs + b3[1]) / 2, recY + 0.09, wz + 0.34)
        if (rows > 1) addRecordShelf(c, b3[0], b3[1], { y: recY + 0.365, z: wz, rows: rows - 1, top: true, sides: true })
        else {
          // the shelf over the records: a few bottles, as at the bar
          addShelf(c, b3[1] - b3[0], 0.34, { x: b3x, y: recY + 0.365, z: wz })
          if (o.bottles !== false) addBottleRow(c, b3[1] - 0.9, b3[1] - 0.05, { y: recY + 0.365, z: wz + 0.17, slack: 0.08, spout: 0, maxH: H - head - recY - 0.365 })
        }
      } else addRecordShelf(c, b3[0], b3[1], { y: recY, z: wz, rows, top: true })
      A.records = new THREE.Vector3(b3x, recY + 0.16, wz + 0.34)
    }

    // sconces on the two inner columns
    if (o.sconces !== false) {
      // as at the bar: the sconces sit toward the brick bay's side of each column
      A.sconceA = addSconce(c, { x: cols[0].x + 0.1, y: 2.08, z: colD })
      A.sconceB = addSconce(c, { x: cols[1].x + 0.12, y: 2.08, z: colD })
      A.sconceC = addSconce(c, { x: cols[2].x - 0.14, y: 2.08, z: colD })
      bulbs.push(A.sconceC.clone(), A.sconceB.clone())
    }
    if (o.ceiling) {
      const ch = H + 0.35
      box(c, c.M.ceiling, X1 - X0 + 2, 0.02, 4, 0, ch + 0.01, 2)
      // ref1: a long straight galvanized trunk tight under the black ceiling
      addDuctTrunk(c, [new THREE.Vector3(X0 - 1, 0, 2.25), new THREE.Vector3(X1 + 1, 0, 2.25)], { width: 0.56, height: 0.3, ceilingY: ch })
      A.pendant = addPendant(c, { x: -1.6, y: ch, z: 1.35, drop: 0.85 })
      bulbs.push(A.pendant.clone())
    }

    A.counter = new THREE.Vector3(0, cy, 0.31)
    A.counterFront = new THREE.Vector3(0, cy, 0.62)
    A.left = new THREE.Vector3(X0, 0, 0)
    A.right = new THREE.Vector3(X1, 0, 0)
    A.top = new THREE.Vector3(0, H, 0)
    return { turntable, sleeves, bulbs }
  })
}

/** the brick bay's paint as at the bar: "Old" tucked up top, "1837" just over the top shelf's bottles */
function backBarBrick(o: BackBarOpts, w: number, _h: number) {
  const big = 0.27
  const lines: PaintLine[] =
    o.brick === true
      ? []
      : Array.isArray(o.brick)
        ? o.brick
        : [
            { text: 'Old', x: w * 0.1, y: 0.2, size: big * 0.4, tracking: 0.02 },
            { text: '1837', x: w * 0.5 + big * 0.1, y: 0.2 + big * 1.33, size: big, align: 'center', tracking: 0.22 },
          ]
  return { lines, big }
}
/** the default back bar's brick bay size (see makeBackBar's layout) */
const BACKBAR_BRICK = (o: BackBarOpts) => ({ w: 1.4, h: (o.height ?? 3.2) - 0.24 - 1.3 })

/**
 * Build the kit's shared maps ahead, in slices across frames (walnut, the LP
 * atlas, grain, hi-fi, cooler, duct, glows; the back bar's painted brick),
 * so the sync makers that follow are instant. Call it first in an async
 * chapter init: `await prepareRoom({ backBar: {} })`.
 */
export async function prepareRoom(o: { backBar?: BackBarOpts } = {}) {
  await walnutMapsAsync()
  await nextFrame()
  spineAtlas()
  grainDetail()
  await nextFrame()
  hifiMaps()
  coolerMap()
  ductMaps()
  await nextFrame()
  galvMaps()
  rubberData()
  glowTexture()
  pitchTexture()
  await nextFrame()
  if (o.backBar && o.backBar.brick !== false) {
    const { w, h } = BACKBAR_BRICK(o.backBar)
    await brickPanelMapsAsync(w, h, { lines: backBarBrick(o.backBar, w, h).lines, seed: 4 })
  }
}

// ─── the record column (ref4) ───────────────────────────────────────────────

export interface RecordColumnOpts extends KitOpts {
  height?: number
  counterY?: number
  /** the face-out LP's cover (default: a Glory typographic cover) */
  cover?: THREE.Texture
  /** its lean back onto the column (radians, default 0.1) */
  lean?: number
  records?: boolean
  singles?: boolean
  bottles?: boolean
  hifi?: boolean
  turntable?: boolean
  sconce?: boolean
  /** the column's width (ref4's is narrow: the LP nearly spans it) */
  columnWidth?: number
}

/**
 * ref4: a walnut column with ONE LP face-out on a black steel ledge and a
 * cage bulb above; packed records + a tipped "singles" rack to the right
 * over a mirror and tall spouted bottles; a shelf of bottles and a leaning
 * stack of LPs to the left over the receiver (+ turntable).
 *
 * anchors: ledge, ledgeTop, sconce, records, singles, bottles, turntable,
 * receiver, stack, counter, column.
 */
export function makeRecordColumn(o: RecordColumnOpts = {}): RoomKit {
  return assemble(o, c => {
    const H = o.height ?? 3.1
    const cy = o.counterY ?? 0.92
    const wz = 0.02
    const X0 = -1.5
    const X1 = 1.6
    const colW = o.columnWidth ?? 0.42
    const colD = 0.44
    const A = c.anchors
    const bulbs: THREE.Vector3[] = []
    const sleeves: Sleeve[] = []
    let turntable: Turntable | null = null

    addPlankWall(c, X1 - X0, H, { depth: wz, x: (X0 + X1) / 2 })
    addPlankColumn(c, colW, colD - wz, H - cy, { x: 0, y: cy, z: wz })
    addCounter(c, X0, X1, { y: cy, d: 0.6 })
    wood(c, X1 - X0, cy - 0.045, 0.58, (X0 + X1) / 2, (cy - 0.045) / 2, 0.29, { vertical: true, tile: 1.6 })
    A.column = new THREE.Vector3(0, 1.6, colD)
    A.counter = new THREE.Vector3(0, cy, 0.3)

    // the ledge + one sleeve, the bulb above
    const s = makeSleeve({ front: o.cover ?? houseCover(1, 'cream', BRAND.motto.replace(/\.$/, '')) })
    sleeves.push(s)
    c.b.push(0, 1.56, colD)
    const led = addRecordLedge(c, { sleeve: s, lean: o.lean ?? 0.1 })
    c.b.pop()
    A.ledge = led.centre
    A.ledgeTop = led.top
    if (o.sconce !== false) {
      A.sconce = addSconce(c, { x: 0, y: 2.42, z: colD })
      bulbs.push(A.sconce.clone())
    }

    // right: records + singles over the mirror and the bottles
    const r0 = colW / 2 + 0.005
    if (o.records !== false) {
      addRecordShelf(c, r0, X1, { y: 1.62, z: wz, rows: 1, top: true })
      A.records = new THREE.Vector3((r0 + X1) / 2, 1.78, wz + 0.34)
    }
    if (o.singles !== false) {
      addSinglesRack(c, 0.52, { x: r0 + 0.3, y: 2.12, z: wz })
      A.singles = new THREE.Vector3(r0 + 0.3, 2.22, wz + 0.2)
    }
    box(c, c.M.mirror, X1 - r0 - 0.02, 1.62 - 0.05 - cy - 0.03, 0.006, (r0 + X1) / 2, cy + 0.03 + (1.62 - 0.05 - cy - 0.03) / 2, wz + 0.003)
    if (o.bottles !== false) {
      addBottleSteps(c, r0 + 0.02, X1 - 0.02, { y: cy, z: wz + 0.008, tiers: 2, rise: 0.09, maxY: 1.62 - 0.032 })
      A.bottles = new THREE.Vector3((r0 + X1) / 2, cy + 0.2, wz + 0.25)
    }

    // left: a shelf of bottles + a face-out stack of LPs leaning on the wall, the hi-fi below
    const l1 = -colW / 2 - 0.005
    addShelf(c, l1 - X0, 0.26, { x: (X0 + l1) / 2, y: 1.66, z: wz })
    addBottleRow(c, X0 + 0.04, X0 + 0.5, { y: 1.66, z: wz + 0.13, slack: 0.04, spout: 0, maxH: 2.3 - 0.032 - 1.66 })
    faceOutStack(c, { x: l1 - 0.26, y: 1.66, z: wz, n: 7 })
    A.stack = new THREE.Vector3(l1 - 0.26, 1.82, wz + 0.1)
    addShelf(c, l1 - X0, 0.26, { x: (X0 + l1) / 2, y: 2.3, z: wz })
    addBottleRow(c, X0 + 0.06, X0 + 0.36, { y: 2.3, z: wz + 0.13, slack: 0.03, spout: 0 })
    if (o.hifi !== false) {
      const seat = addHifi(c, { x: l1 - 0.28, y: cy, z: 0.235 })
      A.turntable = seat
      A.receiver = new THREE.Vector3(l1 - 0.28, cy + 0.12, 0.4)
      if (o.turntable !== false) {
        turntable = makeTurntable({ finish: 'black', shadows: false })
        turntable.group.scale.setScalar(0.315)
        turntable.group.position.copy(seat)
        c.b.object(turntable.group)
      }
    }
    return { turntable, sleeves, bulbs }
  })
}

/**
 * A few LPs standing face-out on a shelf, leaning back on the wall like
 * ref4's stack: parallel boards, each one's back 0.4 mm clear of the one
 * behind, the rearmost 3 mm off the wall. Local: shelf top y, wall z.
 */
function faceOutStack(c: Ctx, { x = 0, y = 0, z = 0, n = 6, lean = 0.2 } = {}) {
  const r = c.r
  let zb = z + 0.003
  for (let i = 0; i < n; i++) {
    const t = 0.0045 + r() * 0.002
    const h = 0.314
    const d = 0.314
    // the back face's top must clear the previous board: pivot z so that top-back = zb
    const zp = zb + h * Math.sin(lean) + (t / 2) * Math.cos(lean)
    const lift = (t / 2) * Math.sin(lean) + 0.0006
    // record box: x = thickness → turn it so thickness runs along z (covers face ±z)
    const m = new THREE.Matrix4()
      .makeTranslation(x + (r() - 0.5) * 0.01, y + lift, zp)
      .multiply(new THREE.Matrix4().makeRotationX(-lean))
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeScale(t, h, d))
    c.b.instance('records', recordGeometry, c.M.records, m, {
      color: new THREE.Color().setScalar(0.8 + r() * 0.25),
      attrs: { aArt: [Math.floor(r() * 128), Math.floor(r() * 32)] },
    })
    // the next board's back sits on this one's front at the foot (parallel planes: t / cos apart)
    zb += (t + 0.0004) / Math.cos(lean)
  }
}
// ─── the ceiling (ref1/ref6) ────────────────────────────────────────────────

export interface CeilingOpts extends KitOpts {
  width?: number
  depth?: number
  /** the ceiling's height above the floor (default 3.45) */
  height?: number
  /**
   * duct runs (default: one long straight trunk along x); points are metres in
   * the kit's frame. shape 'rect' (as in ref1; the default when no `radius` is
   * given): a galvanized trunk along the pts' xz, its top tight under the
   * ceiling (the pts' y is ignored; near-straight wobbles are straightened),
   * `size` [width, height] (default [0.6, 0.32]). 'flex' (the default when an
   * entry gives a `radius`, as the first API did): round silver flex duct
   * through the pts, strapped.
   */
  ducts?: { pts: THREE.Vector3[]; radius?: number; shape?: 'rect' | 'flex'; size?: [number, number]; conduit?: boolean }[]
  /** pendants: x, z and drop below the ceiling (defaults: three) */
  pendants?: { x: number; z: number; drop?: number }[]
  /** black joists across (default true) */
  beams?: boolean
}

/**
 * Glory's ceiling: flat black paint, black joists, silver flex duct strapped
 * and hung from it, wire-cage Edison pendants on black cords. Local: the
 * ceiling at y = height over x ∈ [−w/2, w/2], z ∈ [0, depth].
 * anchors: pendant0.., duct0.., centre.
 */
export function makeCeiling(o: CeilingOpts = {}): RoomKit {
  return assemble(o, c => {
    const w = o.width ?? 8
    const d = o.depth ?? 6
    const H = o.height ?? 3.45
    const A = c.anchors
    const bulbs: THREE.Vector3[] = []
    box(c, c.M.ceiling, w, 0.03, d, 0, H + 0.015, d / 2)
    if (o.beams !== false) for (let x = -w / 2 + 0.6; x < w / 2; x += 1.2) box(c, c.M.ceiling, 0.1, 0.22, d, x, H - 0.11, d / 2)
    // what the duct hangs under: the joists' bottoms (or the ceiling itself)
    const under = o.beams !== false ? H - 0.22 : H
    const ducts = o.ducts ?? [{ pts: [new THREE.Vector3(-w / 2, 0, d * 0.34), new THREE.Vector3(w / 2, 0, d * 0.34)] }]
    ducts.forEach((k, i) => {
      // (entries written for the old flex-only API — a radius, no shape — stay flex)
      if ((k.shape ?? (k.radius != null ? 'flex' : 'rect')) === 'flex') {
        addDuct(c, k.pts, { radius: k.radius ?? 0.24, ceilingY: under })
        A[`duct${i}`] = k.pts[Math.floor(k.pts.length / 2)].clone()
      } else {
        const [dw, dh] = k.size ?? (k.radius ? [k.radius * 2.4, k.radius * 1.3] : [0.6, 0.32])
        addDuctTrunk(c, k.pts, { width: dw, height: dh, ceilingY: under, conduit: k.conduit !== false })
        const m = k.pts[Math.floor(k.pts.length / 2)]
        const m0 = k.pts[Math.floor((k.pts.length - 1) / 2)]
        A[`duct${i}`] = new THREE.Vector3((m.x + m0.x) / 2, under - 0.03 - dh / 2, (m.z + m0.z) / 2)
      }
    })
    const pend = o.pendants ?? [
      { x: -2.2, z: d * 0.62, drop: 0.95 },
      { x: 0.4, z: d * 0.7, drop: 0.8 },
      { x: 2.6, z: d * 0.6, drop: 1.0 },
    ]
    pend.forEach((p, i) => {
      A[`pendant${i}`] = addPendant(c, { x: p.x, y: H - 0.22, z: p.z, drop: p.drop ?? 0.9 })
      bulbs.push(A[`pendant${i}`].clone())
    })
    A.centre = new THREE.Vector3(0, H, d / 2)
    return { bulbs }
  })
}

// ─── the long bar (ref1 foreground) ─────────────────────────────────────────

export interface BarRunOpts extends KitOpts {
  length?: number
  depth?: number
  /** bar top height (default 1.07 m) */
  height?: number
  /** the black rubber rail/mat along the bartender's edge (−z) */
  mat?: boolean
  /** reclaimed planks down the customer face */
  front?: boolean
}

/**
 * The long oiled bar (kit/bar's top) with the black rubber rail along the
 * bartender's edge and a planked front. Local: centred on x, the customer
 * side toward +z, the top surface at y = height. anchors: top, edge, rail.
 */
export function makeBarRun(o: BarRunOpts = {}): RoomKit {
  return assemble(o, c => {
    const L = o.length ?? 6
    const D = o.depth ?? 0.75
    const H = o.height ?? 1.07
    const A = c.anchors
    const top = makeBarTop({ length: L, depth: D, thickness: 0.06 })
    // the long bar is oiled light oak-honey (ref1): lift kit/bar's darker planks
    ;(top.material as THREE.MeshPhysicalMaterial).color.setRGB(1.7, 1.55, 1.38)
    kitPools(top.material as THREE.MeshPhysicalMaterial, c.M.pools, 'bartop')
    c.hooks.push(top)
    top.position.set(0, H, 0)
    top.matrixAutoUpdate = true
    c.owned.push({ dispose: () => (top.material as THREE.Material).dispose() }, top.geometry)
    if (o.mat !== false) {
      const g = new THREE.BoxGeometry(L, 0.012, 0.12)
      const uv = g.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L / 0.1), uv.getY(i) * 1.2)
      c.b.merge(g, c.M.rubber, T(0, H + 0.006, -D / 2 + 0.07))
      void rubberData
      A.rail = new THREE.Vector3(0, H + 0.012, -D / 2 + 0.07)
    }
    if (o.front !== false) {
      wood(c, L, H - 0.06, 0.04, 0, (H - 0.06) / 2, D / 2 - 0.06, { vertical: true, tile: 1.6 })
      box(c, c.M.steel, L, 0.12, 0.03, 0, 0.06, D / 2 - 0.03)
    }
    A.top = new THREE.Vector3(0, H, 0)
    A.edge = new THREE.Vector3(0, H, D / 2)
    return { extra: [top] }
  })
}

// ─── chalkboards wall (ref1/ref6) ───────────────────────────────────────────

export interface ChalkWallOpts extends KitOpts {
  /** boards (default: the three tap boards, American / International / Local, from DRAFTS) */
  boards?: ChalkSpec[]
  width?: number
  height?: number
  gap?: number
  /** the boards' bottom edge (default 1.55 m) */
  y?: number
}

/** default board faces: the bar's own tap boards (header + numbered DRAFTS, as on the real wall) */
export function tapBoards(): ChalkSpec[] {
  const site = BRAND.website.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const headers = [site, BRAND.name, SOCIALS[0]?.handle ?? BRAND.short]
  let start = 1
  return DRAFTS.map((g, i) => {
    const spec: ChalkSpec = { header: headers[i % headers.length], lines: g.beers, numbered: true, start, seed: 11 + i }
    start += g.beers.length
    return spec
  })
}

/**
 * Tall black chalkboards in walnut frames on a black wall (ref6), side by
 * side. Local: the wall at z = 0, boards centred on x. anchors: board0..
 */
export function makeChalkboards(o: ChalkWallOpts = {}): RoomKit {
  return assemble(o, c => {
    const boards = o.boards ?? tapBoards()
    const w = o.width ?? 0.62
    const h = o.height ?? 1.25
    const gap = o.gap ?? 0.16
    const y = o.y ?? 1.55
    const total = boards.length * w + (boards.length - 1) * gap
    boards.forEach((b, i) => {
      const x = -total / 2 + w / 2 + i * (w + gap)
      addChalkboard(c, w, h, b, { x, y })
      c.anchors[`board${i}`] = new THREE.Vector3(x, y + h / 2, 0.02)
    })
  })
}

export { addRecordRow, addBottleRow }
