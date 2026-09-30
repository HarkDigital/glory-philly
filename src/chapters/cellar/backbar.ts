import * as THREE from 'three'
import { assemble, brickPanelMapsAsync, houseCover, makeBarRun, prepareRoom, type PaintLine, type RoomKit } from '../../kit/room'
import {
  addBottleRow,
  addBottleSteps,
  addBrickPanel,
  addCooler,
  addCounter,
  addDuct,
  addHifi,
  addPendant,
  addPlankColumn,
  addPlankWall,
  addRecordLedge,
  addRecordRow,
  addRecordShelf,
  addSconce,
  addShelf,
  box,
  wood,
} from '../../kit/room/pieces'
import { makeRecord, makeSleeve, makeTurntable, type Sleeve, type Turntable } from '../../kit/vinyl'
import { BRAND } from '../../content'

/*
 * THE CELLAR's back bar — Glory's real one (Mike's photos), built from the
 * room kit's pieces in the Cellar's own order, left → right (kit metres):
 *
 *   col · AMERICAN: the exposed-brick bay with the painted "Old / 1837" and
 *   two walnut shelves of bottles (ref2), a wire-cage sconce on each column
 *   · col · INTERNATIONAL: a wide walnut bay, three shelves of bottles, a
 *   shelf PACKED with LPs over them · col + sconce · LOCAL: the two bottles
 *   and the "Bottles" LP on a walnut shelf, bottles above, the hi-fi and a
 *   turntable on the counter below (ref4's left side) · ref4's record column:
 *   ONE Glory LP face-out on its black steel ledge under a cage bulb · the
 *   RECORDS bay: the mirror strip behind the spouted liquor steps, packed
 *   LPs + a 7" section over them (ref1), bottles on top · col + sconce.
 *
 * Under the counter: walnut cabinet fronts, then glass-door coolers. Over it
 * all: the walnut bulkhead, the black ceiling, silver flex duct, wire-cage
 * pendants over the long oiled bar (kit makeBarRun: honey planks, the black
 * rubber rail) that the wine tower and the cocktails stand on.
 *
 * The named bottles (bottles.ts) stand on these shelves; the kit's generic
 * bottles fill the rest of each row. No real lights: the bulbs' pools light
 * the kit (and, hooked in, the named bottles).
 */

/** chapter (world) units per metre: a 750 ml bottle ≈ 0.3 m = 1.8 units */
export const K = 6
/** the plane the named bottles stand on (their centres) */
export const WALL_Z = -4
/** how far the bottles stand off the wall (m) */
const BOTTLE_OFF = 0.125
/** kit → world: world = kit · K + (0, Y0, Z0) */
export const Z0 = WALL_Z - BOTTLE_OFF * K
/** the back counter's top (kit m) */
export const CY = 0.92
/** the back counter's top sits a little under the long bar's (world y = 0), as at the bar */
export const COUNTER_Y = -0.3
export const Y0 = COUNTER_Y - CY * K
/** bottle rows (kit m), top → bottom; the bottom row stands on the counter */
export const SHELF_Y = [1.903, 1.47, CY]
/** the Local shelf (kit m): the two bottles + the "Bottles" LP */
export const LOCAL_SHELF = 1.42
/** the cladding's face in front of the wall plane (m) */
export const WZ = 0.02
/** the columns' depth (their front face, m) */
const COL_D = 0.47
/** the bulkhead's height and the clad height (m) */
const HEAD = 0.24
const H = 3.1
/** the back counter's depth (the aisle to the long bar stays open) */
const COUNTER_D = 0.45

/** walnut columns (centre x, width), kit m */
export const COLS = [
  { x: -2.8, w: 0.5 },
  { x: -1.2, w: 0.5 },
  { x: 1.2, w: 0.5 },
  { x: 2.42, w: 0.44 },
  { x: 4.55, w: 0.5 },
]
const edge = (i: number, s: -1 | 1) => COLS[i].x + (s * COLS[i].w) / 2
/** the bays between the columns (kit m) */
export const BAYS = {
  american: [edge(0, 1), edge(1, -1)] as const,
  international: [edge(1, 1), edge(2, -1)] as const,
  local: [edge(2, 1), edge(3, -1)] as const,
  records: [edge(3, 1), edge(4, -1)] as const,
}
const X0 = edge(0, -1)
const X1 = edge(4, 1)

export const kx = (x: number) => x * K
export const ky = (y: number) => Y0 + y * K
export const kz = (z: number) => Z0 + z * K

/** the painted brick bay (American): its size and the paint, as at the bar (ref2) */
const BRICK_W = BAYS.american[1] - BAYS.american[0]
const BRICK_H = H - HEAD - CY
const PAINT: PaintLine[] = [
  // "1837" just over the top shelf's bottles, "Old" tucked up at its left
  { text: 'Old', x: BRICK_W * 0.13, y: 0.25, size: 0.1, tracking: 0.02 },
  { text: '1837', x: BRICK_W * 0.5 + 0.02, y: 0.25 + 0.3, size: 0.23, align: 'center', tracking: 0.22 },
]
/** "1837"'s centre (kit m) */
export const PAINT_Y = H - HEAD - 0.55 + 0.23 / 2

/** where the "Bottles" LP leans on the Local shelf (kit x) */
export const LP_KX = BAYS.local[1] - 0.2
/** the hi-fi under the Local shelf (kit x) */
const HIFI_KX = BAYS.local[0] + 0.3

/** a row of named bottles, in world units: its span (the kit fills either side) */
export interface NamedRow {
  section: 'american' | 'international' | 'local'
  /** kit y of the surface */
  y: number
  x0: number
  x1: number
}

export interface CellarBar {
  group: THREE.Group
  kit: RoomKit
  bar: RoomKit
  turntable: Turntable | null
  /** the bulbs + pools (0..1.5) and the kit's bounce (0..2) */
  set(glow: number, amb: number): void
  dispose(): void
}

export async function prepareCellarBar() {
  await prepareRoom({})
  await brickPanelMapsAsync(BRICK_W, BRICK_H, { lines: PAINT, seed: 4, soot: 0.5 })
}

/** the whole back bar + the long bar, placed in world space (see K, Y0, Z0) */
export function makeCellarBar(rows: NamedRow[], mobile: boolean): CellarBar {
  const group = new THREE.Group()
  group.name = 'cellar-bar'
  const kit = assemble({ scale: K, mobile, seed: 17, ambient: 0.3 }, c => {
    const A = c.anchors
    const bulbs: THREE.Vector3[] = []
    const sleeves: Sleeve[] = []
    let turntable: Turntable | null = null
    const cx = (X0 + X1) / 2

    // the wall (horizontal walnut boards, on past both ends), the bulkhead, the columns on the counter
    addPlankWall(c, X1 - X0 + 4, H, { depth: WZ, x: cx })
    wood(c, X1 - X0 + 4, HEAD, COL_D - 0.02, cx, H - HEAD / 2, WZ + (COL_D - 0.02) / 2)
    for (const k of COLS) addPlankColumn(c, k.w, COL_D - WZ, H - HEAD - CY, { x: k.x, y: CY, z: WZ })

    // the back counter; walnut cabinet fronts under American + International, coolers under the rest
    addCounter(c, X0 - 2, X1 + 2, { y: CY, d: COUNTER_D })
    const underY = CY - 0.045
    const coolX0 = BAYS.local[0]
    wood(c, coolX0 - X0 + 2, underY, COUNTER_D - 0.02, (X0 - 2 + coolX0) / 2, underY / 2, (COUNTER_D - 0.02) / 2, { vertical: true, tile: 1.6 })
    wood(c, 2, underY, COUNTER_D - 0.02, X1 + 1, underY / 2, (COUNTER_D - 0.02) / 2, { vertical: true, tile: 1.6 })
    {
      const n = 4
      const w = (X1 - coolX0) / n
      for (let i = 0; i < n; i++) addCooler(c, w - 0.01, underY, COUNTER_D - 0.02, { x: coolX0 + w * (i + 0.5), doors: 2 })
    }

    // fill a named row's bay either side of the named bottles with the kit's generic ones
    const fill = (bx0: number, bx1: number, r: NamedRow | undefined, y: number, maxH: number) => {
      const z = WZ + 0.105
      const o = { y, z, slack: 0.02, spout: 0, maxH }
      if (!r) {
        addBottleRow(c, bx0 + 0.02, bx1 - 0.02, o)
        return
      }
      const a = r.x0 / K - 0.012
      const b = r.x1 / K + 0.012
      if (a - (bx0 + 0.02) > 0.09) addBottleRow(c, bx0 + 0.02, a, o)
      if (bx1 - 0.02 - b > 0.09) addBottleRow(c, b, bx1 - 0.02, o)
    }
    const rowOf = (s: NamedRow['section'], y: number) => rows.find(r => r.section === s && Math.abs(r.y - y) < 1e-3)

    // ── AMERICAN: the brick bay, "Old / 1837" (ref2) ──
    {
      const [b0, b1] = BAYS.american
      const bx = (b0 + b1) / 2
      addBrickPanel(c, b1 - b0, BRICK_H, { x: bx, y: CY, z: WZ, lines: PAINT, seed: 4, soot: 0.5 })
      A.brick = new THREE.Vector3(bx, CY + BRICK_H / 2, WZ)
      A.paint = new THREE.Vector3(bx, PAINT_Y, WZ)
      for (let i = 0; i < 3; i++) {
        const y = SHELF_Y[i]
        if (i < 2) addShelf(c, b1 - b0, 0.22, { x: bx, y, z: WZ })
        const above = i === 0 ? H - HEAD - 0.62 : SHELF_Y[i - 1] - 0.032
        fill(b0, b1, rowOf('american', y), y, above - y)
      }
    }

    // ── INTERNATIONAL: a wide walnut bay, three shelves, LPs packed over them ──
    {
      const [b0, b1] = BAYS.international
      const bx = (b0 + b1) / 2
      const lpY = 2.36
      for (let i = 0; i < 3; i++) {
        const y = SHELF_Y[i]
        if (i < 2) addShelf(c, b1 - b0, 0.22, { x: bx, y, z: WZ })
        const above = i === 0 ? lpY - 0.032 : SHELF_Y[i - 1] - 0.032
        fill(b0, b1, rowOf('international', y), y, above - y)
      }
      addRecordShelf(c, b0, b1, { y: lpY, z: WZ, rows: 1, top: true, sides: true })
      A.intlRecords = new THREE.Vector3(bx, lpY + 0.16, WZ + 0.34)
    }

    // ── LOCAL: the two bottles + the LP on a shelf, bottles above, the hi-fi below ──
    {
      const [b0, b1] = BAYS.local
      const bx = (b0 + b1) / 2
      addShelf(c, b1 - b0, 0.24, { x: bx, y: LOCAL_SHELF, z: WZ })
      const top = 1.88
      addShelf(c, b1 - b0, 0.24, { x: bx, y: top, z: WZ })
      addBottleRow(c, b0 + 0.03, b1 - 0.03, { y: top, z: WZ + 0.12, slack: 0.03, spout: 0, maxH: 0.34 })
      const seat = addHifi(c, { x: HIFI_KX, y: CY, z: WZ + 0.235, d: 0.3 })
      A.turntable = seat
      turntable = makeTurntable({ finish: 'black', shadows: false, contact: false })
      turntable.group.name = 'cellar-turntable'
      // the builder poses objects from the matrix it is given (their own position/scale are overwritten)
      c.b.object(turntable.group, new THREE.Matrix4().compose(seat, new THREE.Quaternion(), new THREE.Vector3(0.315, 0.315, 0.315)))
      A.local = new THREE.Vector3(bx, LOCAL_SHELF + 0.16, WZ + 0.12)
    }

    // ── ref4's record column: ONE Glory LP face-out on the steel ledge, a cage bulb above ──
    {
      const col = COLS[3]
      const s = makeSleeve({ front: houseCover(3, 'cream', BRAND.short) })
      s.group.name = 'cellar-ledge-lp'
      c.b.push(col.x, 1.5, COL_D)
      const led = addRecordLedge(c, { sleeve: s, lean: 0.1 })
      c.b.pop()
      A.ledge = led.centre
      A.sconceLedge = addSconce(c, { x: col.x, y: 2.28, z: COL_D })
      bulbs.push(A.sconceLedge.clone())
      sleeves.push(s)
    }

    // ── RECORDS: the mirror strip behind the spouted liquor steps, LPs + 7"s over them (ref1) ──
    {
      const [b0, b1] = BAYS.records
      const bx = (b0 + b1) / 2
      const recY = 1.66
      box(c, c.M.mirror, b1 - b0 - 0.02, recY - 0.05 - CY - 0.03, 0.006, bx, CY + 0.03 + (recY - 0.05 - CY - 0.03) / 2, WZ + 0.003)
      addBottleSteps(c, b0 + 0.02, b1 - 0.02, { y: CY, z: WZ + 0.008, maxY: recY - 0.032 })
      A.bottles = new THREE.Vector3(bx, CY + 0.25, WZ + 0.3)
      const singles = 0.42
      const xs = b1 - singles
      addRecordShelf(c, b0, xs, { y: recY, z: WZ, rows: 1, top: false, sides: true })
      wood(c, b1 - xs, 0.032, 0.34, (xs + b1) / 2, recY - 0.016, WZ + 0.17)
      addRecordRow(c, { x0: xs + 0.012, x1: b1 - 0.03, y: recY, zBack: WZ, depth: 0.34, singles: true })
      wood(c, 0.028, 0.365, 0.34, b1 - 0.014, recY + 0.1825 - 0.032, WZ + 0.17)
      addShelf(c, b1 - b0, 0.34, { x: bx, y: recY + 0.365, z: WZ })
      addBottleRow(c, b0 + 0.08, b1 - 0.05, { y: recY + 0.365, z: WZ + 0.17, slack: 0.08, spout: 0, maxH: H - HEAD - recY - 0.365 })
      A.records = new THREE.Vector3(bx, recY + 0.16, WZ + 0.34)
    }

    // wire-cage sconces: two flank the brick bay (as at the bar), one lights each other bay
    A.sconceA = addSconce(c, { x: COLS[0].x + 0.13, y: 2.1, z: COL_D })
    A.sconceB = addSconce(c, { x: COLS[1].x - 0.13, y: 2.1, z: COL_D })
    A.sconceC = addSconce(c, { x: COLS[2].x - 0.13, y: 2.1, z: COL_D })
    A.sconceD = addSconce(c, { x: COLS[4].x - 0.13, y: 2.1, z: COL_D })
    bulbs.push(A.sconceA.clone(), A.sconceB.clone(), A.sconceC.clone(), A.sconceD.clone())

    // the black ceiling, silver flex duct, pendants over the long bar
    const ch = H + 0.35
    box(c, c.M.ceiling, X1 - X0 + 5, 0.02, 4, cx, ch + 0.01, 2)
    addDuct(c, [new THREE.Vector3(X0 - 1.5, ch - 0.34, 1.5), new THREE.Vector3(cx, ch - 0.36, 1.42), new THREE.Vector3(X1 + 1.5, ch - 0.33, 1.36)], { radius: 0.24, ceilingY: ch })
    for (const [i, x] of [-2.45, 0.9, 3.3].entries()) {
      A[`pendant${i}`] = addPendant(c, { x, y: ch, z: 0.95, drop: 0.78 })
      bulbs.push(A[`pendant${i}`].clone())
    }
    return { turntable, bulbs, sleeves }
  })
  kit.group.position.set(0, Y0, Z0)
  group.add(kit.group)
  // the old brick a touch darker than the kit's default: under the Cellar's key the
  // off-white "1837" reads as paint on brick, not a light
  kit.group.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m && (o as THREE.Mesh).isMesh && m.customProgramCacheKey?.().startsWith('room-brick')) m.color.setScalar(0.72)
  })
  // softer, dimmer glints on the liquor behind the cocktails (a product shot's backdrop, not fairy lights)
  kit.materials.bottles.envMapIntensity = 0.8
  kit.materials.bottles.roughness = 0.16
  kit.materials.spouts.roughness = 0.24
  const turntable = kit.turntable
  if (turntable) {
    turntable.setRecord(makeRecord({ label: { title: BRAND.short, paper: 'red' } }))
    // playing: the arm over the record, the stylus down
    turntable.setArm(1)
    turntable.setCue(0)
  }

  // the long oiled bar the wine and the cocktails stand on (top at y = 0, the rubber rail at the back)
  const barD = 0.6
  const bar = makeBarRun({ scale: K, length: 7.6, depth: barD, height: 1.07, mobile, seed: 23 })
  bar.group.position.set(6, -1.07 * K, 1.3)
  group.add(bar.group)

  return {
    group,
    kit,
    bar,
    turntable,
    set(glow, amb) {
      kit.setGlow(glow)
      kit.setAmbient(amb)
      bar.setAmbient(amb)
    },
    dispose() {
      kit.dispose()
      bar.dispose()
    },
  }
}
