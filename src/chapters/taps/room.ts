import * as THREE from 'three'
import { assemble, brickPanelMapsAsync, tapBoards, type RoomKit } from '../../kit/room'
import {
  addBottleRow,
  addBottleSteps,
  addBrickPanel,
  addChalkboard,
  addCounter,
  addDuct,
  addGlassRows,
  addPendant,
  addPlankColumn,
  addPlankWall,
  addRecordLedge,
  addRecordShelf,
  addSconce,
  addShelf,
  box,
  wood,
  T,
} from '../../kit/room/pieces'
import { withPools } from '../../kit/room/materials'
import { makeSleeve, type Sleeve } from '../../kit/vinyl'
import type { Chalkboard } from './chalk'

/*
 * ON TAP's room: the tap wall set into Glory's real back bar (ref1, ref2,
 * ref4, ref6), composed from the ROOM KIT's own pieces in ONE builder (one
 * set of materials, one set of light pools, ~30 draws):
 *
 *   records bay │ col │ AMERICAN taps │ col │ INTERNATIONAL │ col │ LOCAL │ col │ the black wall
 *   liquor steps│     │ two shelves   │     │ bare brick    │     │ one LP│ Last│ three tall chalk
 *   + packed LPs│     │ packed w/ LPs │     │ + a shelf of  │     │ face- │ Upd.│ tap boards (DRAFTS)
 *   over mirror │     │               │     │ bottles       │     │ out   │     │ over a glass shelf
 *
 * Reclaimed-walnut plank cladding and boxy clad columns (a wire-cage Edison
 * sconce on each), a walnut bulkhead, the black ceiling with joists and a
 * silver flex duct, wire-cage pendants over the bar, the ebonised back
 * counter the taps stand on. Brick is ONE accent panel (the middle bay), as
 * at the bar — left unpainted: the real "Old 1837" is one bay of ref1's back
 * bar, and it already shows in the chapters whose camera looks at that bay
 * (hero, City Wide, events), so the tap wall doesn't paint its own copy. The
 * long oiled bar (makeBarRun, with its black rubber rail) is the chapter's own
 * kit in front of this one.
 *
 * Units: the kit's METRES (floor y = 0, wall plane z = 0, room +z); the group
 * is scaled by S (world units per metre) and placed so the back counter's
 * top is the chapter's y = 0 and the cladding face sits at `wallZ`.
 */

/** kit heights (metres): back counter, cladding face, bulkhead top, bulkhead depth, ceiling */
export const ROOM = { CY: 0.92, WZ: 0.02, H: 3.2, HEAD: 0.24, CEIL: 3.45, SCONCE_Y: 1.72 }
/** the three tap boards on the black wall (metres): in from the last column, each board, the gap, the bottom edge */
export const BOARDS = { inset: 0.24, w: 0.54, h: 0.82, gap: 0.1, y: 1.55 }
/** the boards' centre from the last column's right face, and their mid height (metres) */
export const boardsCentre = () => ({ dx: BOARDS.inset + (3 * BOARDS.w + 2 * BOARDS.gap) / 2, y: BOARDS.y + BOARDS.h / 2 })

export interface TapRoomSpec {
  /** world units per metre */
  S: number
  /** world z of the cladding face */
  wallZ: number
  /** world x of the five column centres, left → right */
  cols: number[]
  /** column width and depth (from the cladding face), world units */
  colW: number
  colD: number
  /** world z where the ebonised back counter meets the long bar */
  counterFront: number
  /** the International bay (brick): world x of its clear width */
  brickBay: [number, number]
  /** the face-out LP's cover (the Local bay) */
  ledgeCover: THREE.Texture
  /** the Last Update slate, hung on the last column */
  chalk: Chalkboard
  mobile: boolean
}

export interface TapRoom {
  kit: RoomKit
  /** the face-out LP on the Local bay's ledge */
  sleeve: Sleeve
}

const TUCK = 0.05
/** the International bay's brick: bare (no painted lettering), its own soot and bond */
const BRICK = { lines: [], seed: 4, soot: 0.5 }

function brickSize(spec: TapRoomSpec) {
  const w = (spec.brickBay[1] - spec.brickBay[0]) / spec.S + 2 * TUCK
  const h = ROOM.H - ROOM.HEAD - (ROOM.CY - 0.05)
  return { w, h }
}

/** build the painted brick's maps across frames (call before makeTapRoom) */
export async function prepareTapRoom(spec: TapRoomSpec) {
  const { w, h } = brickSize(spec)
  await brickPanelMapsAsync(w, h, BRICK)
}

export function makeTapRoom(spec: TapRoomSpec): TapRoom {
  const { S } = spec
  const { CY, WZ, H, HEAD, CEIL } = ROOM
  const kx = (x: number) => x / S
  const kzOf = (z: number) => WZ + (z - spec.wallZ) / S
  const cx = spec.cols.map(kx)
  const w = spec.colW / S
  const d = spec.colD / S
  const L = (i: number) => cx[i] - w / 2
  const R = (i: number) => cx[i] + w / 2
  const X0 = L(0) - 0.7
  const e0 = R(4)
  const X1 = e0 + 2.5
  let sleeve!: Sleeve

  const kit = assemble({ scale: S, mobile: spec.mobile, seed: 13, ambient: 0.3 }, c => {
    // ── the wall: black paint behind everything (it shows above the bulkhead and at the end) ──
    box(c, c.M.ceiling, X1 - X0 + 0.4, CEIL - CY + 0.2, 0.02, (X0 + X1) / 2, (CEIL + CY - 0.2) / 2, -0.012)
    // walnut cladding either side of the brick bay (tucked under the columns)
    const bL = kx(spec.brickBay[0])
    const bR = kx(spec.brickBay[1])
    addPlankWall(c, bL - TUCK - X0, H - CY + 0.05, { depth: WZ, x: (X0 + bL - TUCK) / 2, y: CY - 0.05 })
    addPlankWall(c, e0 - TUCK - (bR + TUCK), H - CY + 0.05, { depth: WZ, x: (bR + TUCK + e0 - TUCK) / 2, y: CY - 0.05 })
    // the brick bay behind the International taps (bare brick: the accent, not the landmark)
    {
      const { w: bw, h: bh } = brickSize(spec)
      addBrickPanel(c, bw, bh, { x: (bL + bR) / 2, y: CY - 0.05, z: 0, ...BRICK })
      // a walnut shelf of bottles (with pour spouts) up over the paint, as in ref2
      const sy = 2.34
      addShelf(c, bR - bL, 0.22, { x: (bL + bR) / 2, y: sy, z: 0 })
      addBottleRow(c, bL + 0.03, bR - 0.03, { y: sy, z: 0.11, slack: 0.035, spout: 0.55, maxH: H - HEAD - sy })
    }
    // the back counter the taps stand on (ebonised), from the wall to the long bar
    const cf = kzOf(spec.counterFront)
    addCounter(c, X0, X1, { y: CY, z: -0.01, d: cf + 0.01 })

    // ── columns (boxy, walnut-clad) + a wire-cage sconce on each ──
    for (let i = 0; i < cx.length; i++) {
      addPlankColumn(c, w, d, H - HEAD - CY, { x: cx[i], y: CY, z: WZ })
      // the two either side of the brick bay a touch softer: the paint is off-white
      addSconce(c, { x: cx[i], y: ROOM.SCONCE_Y, z: WZ + d, power: i === 2 || i === 3 ? 0.8 : 1.1 })
    }
    // the bulkhead over the back bar (flush with the column fronts)
    wood(c, e0 - X0, HEAD, d, (X0 + e0) / 2, H - HEAD / 2, WZ + d / 2)

    // ── the records bay (left): spouted liquor steps over a mirror, a shelf PACKED with LPs ──
    {
      const a = R(0)
      const b = L(1)
      const recY = 1.66
      box(c, c.M.mirror, b - a - 0.02, recY - 0.05 - CY - 0.03, 0.006, (a + b) / 2, CY + 0.03 + (recY - 0.05 - CY - 0.03) / 2, WZ + 0.003)
      addBottleSteps(c, a + 0.02, b - 0.02, { y: CY, z: WZ + 0.008, tiers: 3, maxY: recY - 0.032 })
      addRecordShelf(c, a, b, { y: recY, z: WZ, rows: 2, depth: 0.34, sides: false, top: true })
    }

    // ── AMERICAN bay: two shelves packed with LPs over the taps ──
    {
      const a = R(1)
      const b = L(2)
      addRecordShelf(c, a, b, { y: 1.7, z: WZ, rows: 2, depth: 0.34, sides: false, top: true })
    }

    // ── LOCAL bay: ONE LP face-out on a black steel ledge (ref4) ──
    {
      const a = R(3)
      const b = L(4)
      sleeve = makeSleeve({ front: spec.ledgeCover })
      c.b.push((a + b) / 2, 1.595, WZ)
      addRecordLedge(c, { sleeve, lean: 0.09, length: 0.36 })
      c.b.pop()
    }

    // ── the Last Update slate on the last column, framed in the kit's walnut ──
    {
      const ch = spec.chalk
      const x = cx[4]
      const y = 1.3
      const z = WZ + d
      const f = 0.03
      box(c, c.M.steel, ch.width, ch.height, 0.01, x, y, z + 0.005)
      wood(c, ch.width + 2 * f, f, 0.024, x, y + ch.height / 2 + f / 2, z + 0.012)
      wood(c, ch.width + 2 * f, f, 0.024, x, y - ch.height / 2 - f / 2, z + 0.012)
      for (const s of [-1, 1]) wood(c, f, ch.height, 0.024, x + s * (ch.width / 2 + f / 2), y, z + 0.012, { vertical: true })
      // the chalk ledge
      wood(c, ch.width + 0.03, 0.012, 0.04, x, y - ch.height / 2 - f - 0.006, z + 0.02)
      c.b.object(ch.group, T(x, y, z))
      for (const m of ch.materials) withPools(m, c.M.pools, 'lastupdate')
      c.hooks.push(...ch.meshes)
    }

    // ── the black wall: the three tall chalk tap boards (DRAFTS, as on the real wall) over a glass shelf ──
    {
      const { w: bw, h: bh, gap, y: by } = BOARDS
      const x0 = e0 + BOARDS.inset
      tapBoards().forEach((b, i) => addChalkboard(c, bw, bh, b, { x: x0 + bw / 2 + i * (bw + gap), y: by, z: 0 }))
      const mid = x0 + (3 * bw + 2 * gap) / 2
      // a walnut shelf of upturned glasses under the boards (ref6)
      addShelf(c, 1.5, 0.2, { x: mid - 0.1, y: 1.3, z: 0 })
      addGlassRows(c, mid - 0.83, mid + 0.63, { y: 1.3, z0: 0.02, z1: 0.2 })
    }

    // ── the ceiling: flat black, joists, a silver flex duct strapped along the room, pendants over the bar ──
    {
      const depth = 4.2
      box(c, c.M.ceiling, X1 - X0 + 1, 0.03, depth, (X0 + X1) / 2, CEIL + 0.015, depth / 2)
      for (let x = X0 + 0.3; x < X1; x += 1.2) box(c, c.M.ceiling, 0.1, 0.22, depth, x, CEIL - 0.11, depth / 2)
      addDuct(
        c,
        // strapped along the room just in front of the bulkhead, clear of it and of the joists (ref1: over the back bar)
        [new THREE.Vector3(X0 - 0.4, CEIL - 0.52, 0.86), new THREE.Vector3((X0 + X1) / 2, CEIL - 0.55, 0.9), new THREE.Vector3(X1 + 0.4, CEIL - 0.51, 0.84)],
        { radius: 0.24, ceilingY: CEIL - 0.22 },
      )
      // over the bar, clear of the bays' faces: the records bay, the American bay, the Local bay
      const pend: [number, number, number][] = [
        [(R(0) + L(1)) / 2, 1.35, 1.0],
        [(R(1) + L(2)) / 2 - 0.25, 1.35, 1.08],
        [(R(3) + L(4)) / 2, 1.35, 1.02],
      ]
      for (const [x, z, drop] of pend) addPendant(c, { x, y: CEIL - 0.22, z, drop })
    }
    return { sleeves: [sleeve] }
  })

  kit.group.name = 'taps-room'
  kit.group.position.set(0, -CY * S, spec.wallZ - WZ * S)
  return { kit, sleeve }
}
