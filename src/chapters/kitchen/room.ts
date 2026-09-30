import * as THREE from 'three'
import { BRAND, SECTIONS } from '../../content'
import { catNo, coverTexture } from '../../kit/vinyl'
import { assemble, makeBackBar, makeBarRun, makeCeiling, makeRecordColumn, prepareRoom, tapBoards, type RoomKit } from '../../kit/room'
import { nextFrame } from '../../core/yield'
import { addChalkboard, addCounter, addGlassRows, addPlankColumn, addPlankWall, addSconce, addShelf, box, wood } from '../../kit/room/pieces'

/*
 * KITCHEN — the real Glory around the pass (room kit, Mike's photos).
 *
 * The bins sit on the long oiled bar (kit/room makeBarRun: honey planks, the
 * black rubber rail along the bartender's edge) under the pass's own
 * stainless shelf and heat lamps. Behind it, the back bar of ref1 runs left →
 * right along the whole pass, so the dolly slides past the real room:
 *
 *   black wall + the tap chalkboards (ref6) · glass bay · walnut column +
 *   sconce · the brick bay with the painted "Old 1837" (ref2) · the wide
 *   column + sconce · the records bay packed with LPs over the spouted liquor
 *   steps · ref4's record column (ONE Glory LP face-out on its steel ledge
 *   under a wire-cage bulb) behind the Sweets bin · walnut cladding on.
 *
 * Overhead: the black ceiling, joists, silver flex duct and wire-cage
 * pendants. Everything is the room kit (makeBackBar / makeRecordColumn /
 * makeCeiling / makeBarRun, and `assemble` + its pieces for the two ends);
 * no real lights — the kit's own bulb pools light it.
 *
 * UNITS: the chapter's (kit/vinyl: a 12" sleeve = 1 ≈ 0.315 m), so the kits
 * are scaled by U = 1 / 0.315 per metre. The bar top is y = 0.
 */

/** chapter units per metre (a 12" sleeve is 1 unit) */
export const U = 1 / 0.315
/** the room's floor (the long bar's top is y = 0, 1.07 m up) */
export const FLOOR_Y = -1.07 * U
/** the ceiling's height (chapter units above the bar top) */
export const CEIL_Y = (3.45 - 1.07) * U
/** the back wall's plane (the back bar's cladding face ≈ WALL_Z + 0.02 m) */
export const WALL_Z = -6.1
/** the long bar: centre z, depth (m) — its back edge (the rubber rail) at z ≈ −3.7, its front well past the camera's feet */
const BAR_D = 14.0
const BAR_Z = -3.7 + (BAR_D * U) / 2

export interface KitchenRoomOpts {
  mobile: boolean
  /** the pass's extent along x (chapter units) */
  x0: number
  x1: number
  /** the back bar's centre (chapter x) */
  backBarX: number
  /** ref4's record column (chapter x) */
  columnX: number
  /** the pendants: the first one's x and the spacing (chapter units) */
  pendantX0: number
  pendantStep: number
}

export interface KitchenRoom {
  group: THREE.Group
  kits: RoomKit[]
  /** the bulbs + their pools (0..1.5) and the kits' bounce light (0..2) */
  set(glow: number, amb: number): void
  /** a world anchor on the room: 'ledge' (the face-out LP), 'sconce' (its bulb), 'paint' ("Old 1837"), 'records' */
  anchor(name: 'ledge' | 'sconce' | 'paint' | 'records' | 'boards', out: THREE.Vector3): THREE.Vector3
  dispose(): void
}

export async function makeKitchenRoom(o: KitchenRoomOpts): Promise<KitchenRoom> {
  await prepareRoom({ backBar: {} })
  const group = new THREE.Group()
  group.name = 'kitchen-room'
  const mobile = o.mobile
  const m = (x: number) => x / U

  // the long oiled bar under the bins, the black rubber rail along its back edge
  const bar = makeBarRun({ scale: U, length: m(o.x1 - o.x0), depth: BAR_D, mobile })
  bar.group.position.set((o.x0 + o.x1) / 2, FLOOR_Y, BAR_Z)
  group.add(bar.group)
  await nextFrame()
  // ref1's honey oak, a touch less saturated than the kit's lift (PBR Neutral's toe pushes warm wood orange)
  bar.group.traverse(x => {
    const mat = (x as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
    if (mat && (mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && mat.color.r > 1.5) mat.color.setRGB(1.34, 1.27, 1.18)
  })

  // ref1's back bar (brick bay "Old 1837", the packed records over the spouted steps)
  const back = makeBackBar({ scale: U, mobile, tv: false, turntable: false, ceiling: false, seed: 5 })
  back.group.position.set(o.backBarX, FLOOR_Y, WALL_Z)
  group.add(back.group)
  await nextFrame()

  // ref4's record column behind the Sweets bin: one Glory LP face-out under a cage bulb
  const cover = coverTexture({ title: SECTIONS.kitchen.title, kicker: `${BRAND.short} · ${SECTIONS.kitchen.eyebrow}`, cat: catNo(40), paper: 'red' }, mobile ? 512 : 1024)
  const col = makeRecordColumn({ scale: U, mobile, cover, turntable: false, hifi: false, height: 3.2, seed: 3 })
  col.group.position.set(o.columnX, FLOOR_Y, WALL_Z)
  group.add(col.group)
  await nextFrame()

  // the rest of the wall (one merged kit): walnut runs either side, and past
  // the record column the black wall with the tap chalkboards (ref6)
  const bbL = m(o.backBarX) - 3.3
  const bbR = m(o.backBarX) + 3.3
  const colL = m(o.columnX) - 1.5
  const colR = m(o.columnX) + 1.6
  const L0 = m(o.x0) - 1.2
  const R1 = m(o.x1) + 1.2
  const H = 3.2
  const cy = 0.92
  const ends = assemble({ scale: U, mobile, seed: 13 }, c => {
    const bulbs: THREE.Vector3[] = []
    // walnut runs: cladding, the bulkhead, the back counter and its cabinet fronts
    const run = (a: number, b: number) => {
      const rw = b - a
      if (rw <= 0.01) return
      addPlankWall(c, rw, H, { depth: 0.02, x: (a + b) / 2 })
      wood(c, rw, 0.24, 0.48, (a + b) / 2, H - 0.12, 0.26)
      counter(a, b)
    }
    const counter = (a: number, b: number) => {
      addCounter(c, a, b, { y: cy, z: 0.02, d: 0.6 })
      wood(c, b - a, cy - 0.045, 0.58, (a + b) / 2, (cy - 0.045) / 2, 0.31, { vertical: true, tile: 1.6 })
    }
    // left of the back bar: walnut, a shelf of upturned pints
    run(L0, bbL)
    addShelf(c, 1.6, 0.26, { x: bbL - 1.1, y: 1.4, z: 0.02 })
    addGlassRows(c, bbL - 1.88, bbL - 0.32, { y: 1.4, z0: 0.04, z1: 0.26 })
    // between the back bar and the record column
    run(bbR, colL)
    // past the record column: the black-painted wall with the tap chalkboards
    // (ref6: the three boards, DRAFTS numbered as on the real wall), then walnut
    const bw = 0.62
    const gap = 0.16
    const boards = tapBoards()
    const total = boards.length * bw + (boards.length - 1) * gap
    const blackR = colR + total + 0.7
    box(c, c.M.ceiling, blackR - colR, H + 0.3, 0.02, (colR + blackR) / 2, (H + 0.3) / 2, 0.01)
    counter(colR, blackR)
    const bx = colR + 0.35 + total / 2
    boards.forEach((b, i) => addChalkboard(c, bw, 1.25, b, { x: bx - total / 2 + bw / 2 + i * (bw + gap), y: 1.55, z: 0.02 }))
    c.anchors.boards = new THREE.Vector3(bx, 2.15, 0.04)
    run(blackR, R1)
    const cx2 = blackR + 0.3
    addPlankColumn(c, 0.5, 0.48, H - 0.24 - cy, { x: cx2, y: cy, z: 0.02 })
    bulbs.push(addSconce(c, { x: cx2 - 0.12, y: 2.08, z: 0.5 }))
    return { bulbs }
  })
  ends.group.position.set(0, FLOOR_Y, WALL_Z)
  group.add(ends.group)
  await nextFrame()

  // overhead: black ceiling, joists, flex duct, wire-cage pendants over the bar
  const cw = R1 - L0 + 2
  const cd = (-WALL_Z) / U + 4.5
  const ch = 3.45
  const ccx = (L0 + R1) / 2
  // wire-cage pendants between the bins, over the bar's back half (bulbs ~2.1 m up)
  const pend: { x: number; z: number; drop: number }[] = []
  for (let k = 0; k < 8; k++) {
    const xw = o.pendantX0 + k * o.pendantStep
    pend.push({ x: m(xw) - ccx, z: (-1.2 - WALL_Z) / U + (k % 2 ? 0.1 : -0.06), drop: 0.93 + (k % 3) * 0.05 })
  }
  const ceil = makeCeiling({
    scale: U,
    mobile,
    width: cw,
    depth: cd,
    height: ch,
    // ref1's long galvanized trunk, tight under the joists over the customers' side, clear of the back bar
    ducts: [{ pts: [new THREE.Vector3(-cw / 2, 0, 3.3), new THREE.Vector3(cw / 2, 0, 3.3)], shape: 'rect' }],
    pendants: pend,
  })
  ceil.group.position.set(ccx * U, FLOOR_Y, WALL_Z)
  group.add(ceil.group)

  const kits = [bar, back, col, ends, ceil]
  return {
    group,
    kits,
    set(glow, amb) {
      for (const k of kits) {
        k.setGlow(glow)
        k.setAmbient(amb)
      }
    },
    anchor(name, out) {
      if (name === 'ledge') return col.worldAnchor('ledge', out)
      if (name === 'sconce') return col.worldAnchor('sconce', out)
      if (name === 'paint') return back.worldAnchor('paint', out)
      if (name === 'boards') return ends.worldAnchor('boards', out)
      return back.worldAnchor('records', out)
    },
    dispose() {
      for (const k of kits) k.dispose()
      cover.dispose()
    },
  }
}
