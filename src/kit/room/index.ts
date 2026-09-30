import * as THREE from 'three'
import { makeSleeve, makeTurntable, type Sleeve, type Turntable } from '../vinyl'
import { assemble, houseCover, type KitOpts, type RoomKit } from './compose'
import {
  addBottleSteps,
  addBrickPanel,
  addChalkboard,
  addCooler,
  addDuct,
  addDuctTrunk,
  addGlassRows,
  addHifi,
  addPendant,
  addPlankColumn,
  addPlankWall,
  addRecordLedge,
  addRecordShelf,
  addSconce,
  addShelf,
  addTV,
} from './pieces'
import { old1837, type ChalkSpec, type PaintLine } from './textures'

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  GLORY ROOM KIT — the real bar at 126 Chestnut, piece by piece
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Built from Mike's photos (ref1 back bar, ref2 "Old 1837", ref4 record
 * column, ref6 dining room): reclaimed-walnut plank cladding, boxy clad
 * columns, an exposed-brick panel with the painted "Old / 1837", a shelf
 * PACKED with LPs (+ a 7" singles section), a face-out LP on a black steel
 * ledge, tiered liquor with chrome pour spouts over a mirror strip, glassware,
 * glowing glass-door coolers, a hi-fi with a blue ring (a kit/vinyl turntable
 * sits on it), wire-cage Edison sconces and pendants, the black ceiling with
 * long galvanized trunk duct tight under it (or round silver flex), tall
 * chalkboards, the long oiled bar with its rubber rail.
 * See it: ?lab=room&view=backbar|column|brick|ceiling|all
 *
 * UNITS: METRES (y up, floor y = 0; the back wall is the plane z = 0, the room
 * is +z). `scale` = your world units per metre (the hero's 7.4 cm unit →
 * scale 100 / 7.4 = 13.5). A 12" sleeve is 0.315 m (kit/vinyl's unit × 0.315).
 *
 * Every maker returns a RoomKit:
 *   { group, anchors, setGlow(k), setAmbient(k), worldAnchor(name), turntable,
 *     sleeves, lights, materials, draws, dispose() }
 *   group       add it to your chapter group; move/rotate it (scale via `scale`)
 *   anchors     named Vector3 slots in the group's LOCAL space (metres)
 *   setGlow     0..1.5 bulbs + halos + light POOLS together (drive it; never toggle)
 *   setAmbient  0..2 the kit's warm bounce light (0 = only the bulbs light it: moodier)
 *   dispose     frees the kit's own geometry/materials (shared/cached maps stay)
 * Common options (KitOpts): scale, seed, glow, ambient (default 0.3), mobile,
 * lights (0|1|2 real point lights; default 0 — the pools light the kit).
 *
 * WALNUT: one warm walnut family — long boards (10–16 cm wide, 1–2.3 m between
 * butt joints; the map is 1.2 m across × 2.4 m along the boards), board tones
 * within ±~10 % with the odd darker reclaimed board, soft figure, tight joints.
 *
 * TONE: the kit's own opaque materials pre-cancel PBR Neutral's toe (it
 * crushes dim warm tones to orange by subtracting the smallest channel), so
 * walnut, brick and LP spines keep the photos' brown in the shadows. Give
 * your own pooled materials the same with kitPools(mat, pools, key) or
 * withPools(mat, pools, key, undefined, { untoe: true }); plain withPools()
 * is unchanged.
 *
 * INIT: the maps are procedural (walnut 1024², the LP atlas, painted brick…),
 * built once per page; phones get half-size maps (walnut/atlas 512², brick
 * ≤ 512 px — a quarter of the work and memory, the same wall in metres).
 * Call `await prepareRoom({ backBar: {} })` first in an async init: the heavy
 * per-pixel maps (walnut, galvanized sheet, painted brick) are built in a
 * WORKER (textures.ts; ~8 ms main-thread slices where a worker can't start),
 * the light canvases a frame apart — no long task; the makers after it are
 * then ~50 ms. Prefetch your own brick panels with brickPanelMapsAsync().
 * Without it the first maker builds them synchronously. Chalkboards draw
 * once their face is in and free their canvas after upload.
 *
 * LIGHT: the kit is lit by the world (env reflections, fill, your spot/rims)
 * PLUS its own "pools": fake point lights evaluated only in the kit's
 * materials at every bulb (diffuse wrap + a satin highlight on the bumped
 * walnut, glints on bottles and spouts). No program changes elsewhere, no
 * shadows. Bulbs are HDR filaments + an additive halo (bloom-friendly; they
 * don't white out at the default bloom threshold).
 *
 * NO CLIPPING: every sleeve and record is posed exactly — packed LPs are
 * placed as rotated rectangles pushed until they clear their neighbours by
 * 0.4 mm at every height; leaning sleeves keep 3 mm off the wall/column at
 * the top and sit in front of the ledge lip; bottles are spaced by radius
 * and kept (with their spouts) under the shelf above.
 * leanOnWall({ lean, yaw, scale, size }) gives ANY chapter the exact pose for
 * a kit/vinyl sleeve leaning on a wall — including the yaw case (a turned
 * sleeve's top corner swings back into the wall by (w/2)·|sin yaw|).
 *
 * COST (measured in the lab): makeBackBar ≈ 27 draws, +17 with its
 * turntable (44), ~100k triangles with it; makeRecordColumn ≈ 22 (+17);
 * makeCeiling 6. No real lights by default; maps ≤ 1024², built once.
 *
 * ─── composers ─────────────────────────────────────────────────────────────
 *
 *  makeBackBar({ brick: 'old1837', records: { rows: 1, singles: 0.42 },
 *                bottles, glassware, sconces, coolers, hifi, turntable,
 *                sleeve: true | texture, tv: false | 'off' | 'on', ceiling })
 *     ref1's run (6.6 m, x ∈ [−3.3, 3.3], clad to 3.2 m, counter 0.92 m).
 *     anchors: counter, counterFront, turntable, receiver, sleeve, brick,
 *     paint, records, singles, bottles, glass, tv, sconceA/B/C, pendant,
 *     bayGlass, bayBrick, bayRecords, left, right, top
 *  makeRecordColumn({ cover, stackCover, lean, columnWidth, records, singles, bottles, hifi, turntable, sconce })
 *     ref4 (x ∈ [−1.5, 1.6], a 0.42 m column). anchors: ledge, ledgeTop, sconce, records,
 *     singles, bottles, turntable, receiver, stack, counter, column
 *  makeCeiling({ width, depth, height, ducts: [{ pts, shape, size, radius }], pendants: [{ x, z, drop }], beams })
 *     ducts: shape 'rect' (ref1; the default without a radius): a long straight
 *     galvanized trunk along the pts' xz, its top 3 cm under the joists, flanges +
 *     black straps + a conduit; 'flex' (the default WITH a radius): round silver
 *     flex through the pts. anchors: pendant0.., duct0.., centre
 *  makeBarRun({ length, depth, height, mat, front })  the long oiled bar + rubber rail
 *     anchors: top, edge, rail
 *  makeChalkboards({ boards: ChalkSpec[] })  default = tapBoards(): the real tap
 *     boards (site / name / Instagram header + numbered DRAFTS from content.ts)
 *
 * ─── single pieces (each a RoomKit too) ────────────────────────────────────
 *
 *  plankWall(w, h, { dir: 'h' | 'v' })         reclaimed walnut cladding
 *  plankColumn(w, d, h)                          boxy clad column, corner trims
 *  paintedBrickPanel(w, h, { lines: 'old1837' | PaintLine[] })   brick + paint
 *  recordShelf({ length, rows, depth, singles }) walnut shelf packed with LPs
 *  recordLedge({ cover | sleeve, lean })         ONE sleeve face-out on steel
 *  liquorSteps({ length, tiers, maxY })          tiered bottles + pour spouts (kept under maxY)
 *  glassRows({ length, depth })                  upturned pints (non-transmissive)
 *  cooler({ width, doors })                      glass-door back-bar cooler
 *  hifiStack({ turntable })                      receiver + amp (+ a black deck)
 *  sconce() · pendant({ drop })                  wire-cage Edison fixtures
 *  ductRun(length, { radius, shape: 'rect', size })  silver flex (default) or the galvanized trunk
 *  chalkboard(w, h, spec)                        one framed board
 *  tv({ on })                                    dark glass; 'on' = a dim abstract pitch
 *
 * ─── copy-paste ────────────────────────────────────────────────────────────
 *
 *   import { makeBackBar, prepareRoom } from '../../kit/room'
 *
 *   // Glory's back bar behind your subject, in a chapter whose unit is 7.4 cm
 *   await prepareRoom({ backBar: {} })                       // in async init()
 *   const room = makeBackBar({ scale: 100 / 7.4, turntable: true })
 *   room.group.position.set(0, -0.92 * (100 / 7.4), -9)   // counter top at your y = 0
 *   group.add(room.group)
 *   // update(): room.setGlow(0.8 + 0.2 * local)            (optional)
 *   //           room.turntable?.update(frame)               (if you spin it)
 *   // camera:   const at = room.worldAnchor('paint')        ("Old 1837")
 *
 *   // ref4's record column: one Glory LP face-out under a cage bulb
 *   const col = makeRecordColumn({ cover: coverTexture({ title: 'On Tap', paper: 'red' }) })
 *   group.add(col.group)
 *
 *   // just a packed shelf of LPs (2 rows, 1.8 m) on your own wall
 *   const shelf = recordShelf({ length: 1.8, rows: 2 })
 *
 *   // the ceiling over the room: duct + three pendants
 *   const ceil = makeCeiling({ width: 8, depth: 5 })
 *
 *   // chapter onLeave/dispose: room.dispose()
 */

export { makeBackBar, makeRecordColumn, makeCeiling, makeBarRun, makeChalkboards, tapBoards, houseCover, assemble, prepareRoom } from './compose'
export type { RoomKit, KitOpts, BackBarOpts, RecordColumnOpts, CeilingOpts, BarRunOpts, ChalkWallOpts } from './compose'
export { old1837, walnutMaps, walnutMapsAsync, brickCanvas, brickPanelMaps, brickPanelMapsAsync, spineAtlas, galvMaps, galvMapsAsync, fillTracked, measureTracked, MAP_MAX, WALNUT_TILE, WALNUT_ALONG } from './textures'
export type { PaintLine, ChalkSpec, PbrMaps } from './textures'
export { PoolSet, withPools, kitPools, MAX_POOLS } from './materials'
export { leanOnWall } from './pieces'
export type { LeanPose } from './pieces'
export type { RoomMaterials } from './materials'

// ─── single pieces ──────────────────────────────────────────────────────────

/** reclaimed walnut cladding: x ∈ [−w/2, w/2], y ∈ [0, h], face at z = 0.02 */
export function plankWall(w: number, h: number, o: KitOpts & { dir?: 'h' | 'v' } = {}): RoomKit {
  return assemble(o, c => {
    addPlankWall(c, w, h, { dir: o.dir ?? 'h' })
  })
}

/** a boxy clad column (w × d × h), back on z = 0, front face at z = d */
export function plankColumn(w = 0.55, d = 0.45, h = 2.2, o: KitOpts & { trim?: boolean } = {}): RoomKit {
  return assemble(o, c => {
    addPlankColumn(c, w, d, h, { trim: o.trim !== false, cap: true })
    c.anchors.front = new THREE.Vector3(0, h / 2, d)
  })
}

/** exposed brick (w × h, x-centred, from y = 0), optionally hand-painted: 'old1837' = ref2's decor */
export function paintedBrickPanel(w = 1.4, h = 1.6, o: KitOpts & { lines?: 'old1837' | PaintLine[]; soot?: number } = {}): RoomKit {
  return assemble(o, c => {
    const lines = o.lines === 'old1837' ? old1837(w, h) : (o.lines ?? [])
    addBrickPanel(c, w, h, { lines, seed: o.seed ?? 4, soot: o.soot ?? 0.5 })
    c.anchors.centre = new THREE.Vector3(0, h / 2, 0.003)
  })
}

/** a walnut shelf (x ∈ [−length/2, length/2], wall z = 0, first shelf at y = 0) packed with LPs; singles: 7" rows */
export function recordShelf(o: KitOpts & { length?: number; rows?: number; depth?: number; singles?: boolean } = {}): RoomKit {
  return assemble(o, c => {
    const L = o.length ?? 1.8
    addRecordShelf(c, -L / 2, L / 2, { rows: o.rows ?? 1, depth: o.depth ?? 0.34, singles: o.singles })
    c.anchors.front = new THREE.Vector3(0, 0.16, o.depth ?? 0.34)
  })
}

/** the black steel face-out ledge with ONE sleeve (a Glory cover by default; or pass `sleeve` / `cover`) */
export function recordLedge(o: KitOpts & { sleeve?: Sleeve; cover?: THREE.Texture; lean?: number; length?: number } = {}): RoomKit {
  return assemble(o, c => {
    const s = o.sleeve ?? makeSleeve({ front: o.cover ?? houseCover(1, 'cream') })
    const { centre, top } = addRecordLedge(c, { sleeve: s, lean: o.lean ?? 0.1, length: o.length ?? 0.34 })
    c.anchors.sleeve = centre
    c.anchors.top = top
    return { sleeves: o.sleeve ? [] : [s] }
  })
}

/** tiered liquor steps (x-centred, length long) with bottles + pour spouts; back riser on z = 0 */
export function liquorSteps(o: KitOpts & { length?: number; tiers?: number; maxY?: number } = {}): RoomKit {
  return assemble(o, c => {
    const L = o.length ?? 1.6
    addBottleSteps(c, -L / 2, L / 2, { tiers: o.tiers ?? 3, maxY: o.maxY })
    c.anchors.front = new THREE.Vector3(0, 0.25, 0.125 * (o.tiers ?? 3))
  })
}

/** a walnut shelf of upturned pint glasses (non-transmissive stand-ins) */
export function glassRows(o: KitOpts & { length?: number; depth?: number } = {}): RoomKit {
  return assemble(o, c => {
    const L = o.length ?? 1.2
    const d = o.depth ?? 0.3
    addShelf(c, L, d, {})
    addGlassRows(c, -L / 2 + 0.02, L / 2 - 0.02, { z0: 0.02, z1: d })
  })
}

/** a glass-door under-counter cooler (front at z = 0.6) */
export function cooler(o: KitOpts & { width?: number; height?: number; doors?: number } = {}): RoomKit {
  return assemble(o, c => {
    addCooler(c, o.width ?? 0.95, o.height ?? 0.86, 0.6, { doors: o.doors ?? 2 })
  })
}

/** the hi-fi stack (receiver with the blue ring on a streamer/amp); turntable: a black kit/vinyl deck on top */
export function hifiStack(o: KitOpts & { turntable?: boolean } = {}): RoomKit {
  return assemble(o, c => {
    const seat = addHifi(c, {})
    c.anchors.turntable = seat
    let tt: Turntable | null = null
    if (o.turntable) {
      tt = makeTurntable({ finish: 'black', shadows: false })
      tt.group.scale.setScalar(0.315)
      tt.group.position.copy(seat)
      c.b.object(tt.group)
    }
    return { turntable: tt }
  })
}

/** a wire-cage Edison wall sconce (plate at the origin on the wall z = 0) */
export function sconce(o: KitOpts & { power?: number } = {}): RoomKit {
  return assemble(o, c => {
    c.anchors.bulb = addSconce(c, { power: o.power ?? 1 })
    return { bulbs: [c.anchors.bulb.clone()] }
  })
}

/** a wire-cage Edison pendant hanging `drop` m below its ceiling point (the origin) */
export function pendant(o: KitOpts & { drop?: number; power?: number } = {}): RoomKit {
  return assemble(o, c => {
    c.anchors.bulb = addPendant(c, { drop: o.drop ?? 0.9, power: o.power ?? 1 })
    return { bulbs: [c.anchors.bulb.clone()] }
  })
}

/**
 * A straight run along x (centred) of silver flex duct (default), hung from
 * ceilingY if given — or, with shape 'rect', ref1's galvanized trunk (size
 * [width, height], default [0.6, 0.32]; its top 3 cm under ceilingY, else
 * centred on y = 0) with flanges, straps and a conduit.
 */
export function ductRun(length = 4, o: KitOpts & { radius?: number; ceilingY?: number; shape?: 'flex' | 'rect'; size?: [number, number] } = {}): RoomKit {
  return assemble(o, c => {
    if (o.shape === 'rect') {
      const [width, height] = o.size ?? [0.6, 0.32]
      addDuctTrunk(c, [new THREE.Vector3(-length / 2, 0, 0), new THREE.Vector3(length / 2, 0, 0)], { width, height, ceilingY: o.ceilingY ?? null })
      return
    }
    addDuct(c, [new THREE.Vector3(-length / 2, 0, 0), new THREE.Vector3(0, -0.02, 0.03), new THREE.Vector3(length / 2, 0, 0)], {
      radius: o.radius ?? 0.22,
      ceilingY: o.ceilingY ?? null,
    })
  })
}

/** one tall chalkboard in a pale wood frame (legible chalk only from `spec`) */
export function chalkboard(w = 0.62, h = 1.25, spec: ChalkSpec = {}, o: KitOpts = {}): RoomKit {
  return assemble(o, c => {
    addChalkboard(c, w, h, spec)
    c.anchors.centre = new THREE.Vector3(0, h / 2, 0.02)
  })
}

/** an optional TV (dark glass; `on` = a very dim abstract pitch, no logos, no flashing) */
export function tv(o: KitOpts & { on?: boolean; width?: number; height?: number } = {}): RoomKit {
  return assemble(o, c => {
    addTV(c, o.width ?? 1.0, o.height ?? 0.58, { on: !!o.on })
  })
}
