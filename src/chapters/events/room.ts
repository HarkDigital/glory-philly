import * as THREE from 'three'
import { BRAND, PHOTOS } from '../../content'
import { PoolSet, assemble, brickPanelMapsAsync, houseCover, makeBackBar, makeBarRun, makeCeiling, prepareRoom, tapBoards, withPools, type RoomKit } from '../../kit/room'
import { kitPools, poolHook } from '../../kit/room/materials'
import { T, addBrickPanel, addChalkboard, addPlankColumn, addRecordLedge, addRecordShelf, addSconce, box, wood } from '../../kit/room/pieces'
import { woodMaps } from '../../kit/bar'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeSleeve, type Sleeve } from '../../kit/vinyl'
import { whenRevealed } from '../../kit/images'
import { nextFrame } from '../../core/yield'
import { OAK_TILE, PLASTER_TILE, PrintAtlas, atlasPlane, castIronColumn, oakFloorMap, plasterMap } from './fixtures'

/*
 * GLORY'S DINING ROOM around the Back Room's banquet table — the real room
 * from Mike's photos (ref6 the dining room, ref1 the back bar, ref4 the
 * record column), built from the room kit:
 *
 *   · the far end: Glory's back bar wall to wall (walnut bays, the brick bay
 *     with the painted "Old 1837", LPs packed over spouted liquor steps,
 *     wire-cage sconces, glowing coolers) with the long oiled bar and its
 *     black rubber rail in front of it
 *   · the left wall (ref6's bar side): black paint, boxy walnut-clad columns
 *     with wire-cage Edison sconces; between them the three tall chalk tap
 *     boards in walnut frames, one exposed-brick accent panel, a shelf packed
 *     with LPs, and a Glory LP face-out on a black steel ledge (ref4)
 *   · the right wall (ref6): cream plaster under a black band, two framed
 *     prints in white mats (the site's own photos), pendants over the floor
 *   · down the room: two round black cast-iron columns with flared capitals
 *     under a timber girder (ref6), between the table and the plaster wall
 *   · overhead: the black ceiling and joists, the big round silver flex duct,
 *     a galvanized trunk, wire-cage pendants on black cords
 *   · underfoot: a pale honey oak strip floor, lit by the pendants' pools
 *
 * Units: the table's (1 = 0.254 m, the table top is y = 0, the floor y = -3).
 * The kits are metres, scaled by U. The pendants' light POOLS (room kit fake
 * lights: no real lights, no shadows) also light the banquet table, the
 * floor and the chairs — see litByPendants().
 */

/** table units per metre */
export const U = 1 / 0.254

export const ROOM = {
  /** floor (table units) */
  floor: -3,
  /** side walls at x = ±halfW (metres) */
  halfW: 3.3,
  /** the back bar's wall (table z) */
  back: -46,
  /** where the room stops behind the cameras (table z) */
  front: 12,
  /** ceiling height (metres) */
  H: 3.45,
  /** the long bar in front of the back bar: its centre (table z) */
  barZ: -38.4,
}

export interface DiningRoom {
  group: THREE.Group
  kits: RoomKit[]
  backBar: RoomKit
  ceiling: RoomKit
  walls: RoomKit
  /** the pendants' pools (the ceiling kit's): hook meshes outside the kit so they're lit too */
  litByPendants(mesh: THREE.Mesh | THREE.InstancedMesh): void
  setGlow(k: number): void
  setAmbient(k: number): void
  /** world-space anchors for cameras */
  anchors: { backBar: THREE.Vector3; paint: THREE.Vector3; records: THREE.Vector3 }
}

const zm = (zt: number) => zt / U

/** the bar-side wall's walnut columns (table z) and which of them carry a sconce */
const COLS = [8, -4, -16, -28, -40]
const LIT = new Set([-4, -16, -28, -40])

/** ref6's cast-iron columns: x (metres) and table z, between the table and the plaster wall */
const COLUMN_X = 1.55
const COLUMN_Z = [-13, -27.5]
/** the timber girder they carry (metres) */
const GIRDER = { w: 0.26, h: 0.36 }
/** the framed prints on the plaster wall: table z of each, centre height (metres), mat openings (metres) */
const PRINT_Z = [-16, -30]
const PRINT_Y = 1.62
const PRINTS = [
  { url: PHOTOS.wallSign, w: 0.96, h: 0.64 },
  { url: PHOTOS.sidewalk, w: 0.57, h: 0.76 },
]
/** the pendants by the plaster wall (metres; clear of the galvanized trunk at 1.84–2.46) */
const RIGHT_PENDANT_X = 2.72

/** a wall plane (w × h, facing +z) with its UVs in `tile`-metre repeats (0: 0..1) */
function tiledPlane(w: number, h: number, tile: number) {
  const g = new THREE.PlaneGeometry(w, h)
  if (tile > 0) {
    const a = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < a.count; i++) a.setXY(i, (a.getX(i) * w) / tile, (a.getY(i) * h) / tile)
  }
  return g
}

export async function makeDiningRoom(mobile: boolean): Promise<DiningRoom> {
  const group = new THREE.Group()
  // the shared maps (walnut, LP atlas, back bar brick…) across frames; then the accent brick panel
  await prepareRoom({ backBar: {} })
  const BRICK = { w: 2.3, h: 1.9 }
  await brickPanelMapsAsync(BRICK.w, BRICK.h, { lines: [], seed: 12, soot: 0.35 })
  await nextFrame()

  // ── the far end: the back bar, wall to wall, and the long bar in front of it ──
  const backBar = makeBackBar({ scale: U, turntable: false, tv: false, sleeve: true, mobile, records: { rows: 1, singles: 0.42 } })
  backBar.group.position.set(0, ROOM.floor, ROOM.back)
  group.add(backBar.group)
  await nextFrame()
  const run = makeBarRun({ scale: U, length: 5.3, depth: 0.76, mobile })
  run.group.position.set(-0.55 * U, ROOM.floor, ROOM.barZ)
  group.add(run.group)
  // Glory's bar stools along it (ref6: black steel frames, walnut seats and low backs)
  const stools = makeStools(6, 5.3 - 0.9)
  stools.group.position.set(-0.55 * U, ROOM.floor, ROOM.barZ + (0.76 / 2 + 0.36) * U)
  group.add(stools.group)
  await nextFrame()

  // ── the ceiling: black paint + joists, two flex duct runs, pendants over the table and the bar ──
  const depth = zm(ROOM.front - ROOM.back)
  const H = ROOM.H
  const kz = (zt: number) => zm(zt - ROOM.back)
  const ceiling = makeCeiling({
    scale: U,
    width: ROOM.halfW * 2,
    depth,
    height: H,
    mobile,
    ducts: [
      // ref6: the dining room's big round silver flex duct down its length…
      {
        shape: 'flex',
        pts: [new THREE.Vector3(-1.75, H - 0.6, 0.35), new THREE.Vector3(-1.7, H - 0.63, depth * 0.35), new THREE.Vector3(-1.82, H - 0.61, depth * 0.7), new THREE.Vector3(-1.76, H - 0.6, depth)],
        radius: 0.34,
      },
      // …and ref1's straight galvanized trunk along the other side
      { shape: 'rect', pts: [new THREE.Vector3(2.15, 0, 0.6), new THREE.Vector3(2.15, 0, depth)], size: [0.62, 0.32] },
    ],
    pendants: [
      // down the length of the table (its top is 0.76 m): a bulb about 1.2 m over it
      { x: 0, z: kz(-3.5), drop: 1.05 },
      { x: 0, z: kz(-11.5), drop: 1.05 },
      { x: 0, z: kz(-19.5), drop: 1.05 },
      { x: 0, z: kz(-27.5), drop: 1.05 },
      // over the long bar
      { x: -1.9, z: kz(ROOM.barZ), drop: 0.8 },
      { x: 0.9, z: kz(ROOM.barZ), drop: 0.8 },
      // ref6: bare bulbs hanging by the cream wall (clear of the galvanized trunk), lighting its prints
      { x: RIGHT_PENDANT_X, z: kz(PRINT_Z[0]), drop: 1.0 },
      { x: RIGHT_PENDANT_X, z: kz(PRINT_Z[1]), drop: 1.0 },
    ],
  })
  ceiling.group.position.set(0, ROOM.floor, ROOM.back)
  group.add(ceiling.group)
  await nextFrame()
  // the pendants' light on things outside the kits (the table, the chairs, the floor): the same
  // bulbs as the ceiling kit's pools (its space), a little softer — they are lit by candles too
  const pools = new PoolSet()
  for (const p of ceiling.materials.pools.pools) pools.add(p.pos, p.radius, p.color, p.power * 0.5)
  pools.uniforms.uPoolAmb.value.setRGB(0, 0, 0)

  // ── the long walls (ref6): the bar side black with the chalk boards, walnut columns, brick and
  // records; the far side cream plaster with framed prints. A timber girder over the column line ──
  const zc = zm((ROOM.front + ROOM.back) / 2)
  const L = zm(ROOM.front - ROOM.back)
  const clad = 2.95
  const colW = 0.5
  const colD = 0.36
  const wz = 0.02
  const boards = tapBoards()
  const atlas = new PrintAtlas(PRINTS.length, mobile)
  const walls = assemble({ scale: U, mobile, seed: 17 }, c => {
    const sleeves: Sleeve[] = []
    // the house's black wall paint (a touch lighter than the ceiling, so the chalk boards' frames read on it)
    const paint = kitPools(new THREE.MeshStandardMaterial({ color: '#1f1c1a', roughness: 0.86, envMapIntensity: 0.3 }), c.M.pools, 'ev-paint')
    // ref6's cream plaster
    const pmap = plasterMap(mobile)
    const plaster = kitPools(new THREE.MeshStandardMaterial({ map: pmap, roughness: 0.88, envMapIntensity: 0.22 }), c.M.pools, 'ev-plaster')
    // the prints: the site's own photos in white mats, one atlas
    const art = kitPools(new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.6, envMapIntensity: 0.2 }), c.M.pools, 'ev-art')
    c.owned.push(paint, pmap, plaster, art, atlas.tex)

    // the timber girder over the cast-iron columns, down the length of the room (ref6)
    c.b.push(COLUMN_X, H - GIRDER.h / 2, zc, 0, Math.PI / 2, 0)
    wood(c, L, GIRDER.h, GIRDER.w, 0, 0, 0)
    c.b.pop()

    for (const side of [-1, 1] as const) {
      // left wall (side -1) faces +x: local +x runs toward -z; right wall faces -x: local +x runs toward +z
      c.b.push(side * ROOM.halfW, 0, zc, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0)
      const lx = (zt: number) => (side < 0 ? zc - zm(zt) : zm(zt) - zc)
      // the wall itself, then the black band up to the ceiling and a black base shoe
      c.b.merge(tiledPlane(L, clad, side < 0 ? 0 : PLASTER_TILE), side < 0 ? paint : plaster, T(0, clad / 2, wz))
      box(c, c.M.ceiling, L, H - clad + 0.02, 0.012, 0, clad + (H - clad) / 2, 0.006)
      box(c, c.M.steel, L, 0.1, 0.03, 0, 0.05, wz + 0.015)
      if (side < 0) {
        // the bar side: walnut-clad columns with sconces (ref1/ref4) on the black wall
        for (const zt of COLS) {
          addPlankColumn(c, colW, colD - wz, H, { x: lx(zt), y: 0, z: wz })
          if (LIT.has(zt)) addSconce(c, { x: lx(zt) - 0.1, y: 2.05, z: colD, power: 1.1 })
        }
        // the bays between the columns (x between two columns' faces)
        const bay = (a: number, b: number) => {
          const x0 = Math.min(lx(a), lx(b)) + colW / 2 + 0.006
          const x1 = Math.max(lx(a), lx(b)) - colW / 2 - 0.006
          return { x0, x1, cx: (x0 + x1) / 2, w: x1 - x0 }
        }
        // an exposed brick accent panel
        const b1 = bay(-4, -16)
        addBrickPanel(c, BRICK.w, BRICK.h, { x: b1.cx, y: 0.75, z: wz, seed: 12, soot: 0.35 })
        // ref6: the three tall chalk tap boards in walnut frames on the black wall
        const b2 = bay(-16, -28)
        const bw = 0.6
        const gap = 0.14
        const tot = boards.length * bw + (boards.length - 1) * gap
        boards.forEach((spec, i) => addChalkboard(c, bw, 1.22, spec, { x: b2.cx - tot / 2 + bw / 2 + i * (bw + gap), y: 1.3, z: wz + 0.004 }))
        // a shelf packed with LPs
        const b3 = bay(-28, -40)
        addRecordShelf(c, b3.x0, b3.x1, { y: 1.12, z: wz, rows: 2, depth: 0.32 })
        // ref4: ONE Glory LP face-out on a black steel ledge on the column (never real album art)
        const s = makeSleeve({ front: houseCover(9, 'red', BRAND.short), wear: 0.7, seed: 41 })
        sleeves.push(s)
        c.b.push(lx(-16), 1.42, colD)
        addRecordLedge(c, { sleeve: s, lean: 0.1 })
        c.b.pop()
      } else {
        // the plaster side: two framed prints, each under its pendant
        PRINTS.forEach((pr, i) => {
          const uv = atlas.add(pr.w / pr.h)
          const x = lx(PRINT_Z[i])
          const y = PRINT_Y
          const fb = 0.034
          const fd = 0.032
          c.b.merge(atlasPlane(pr.w, pr.h, uv), art, T(x, y, wz + 0.012))
          box(c, c.M.steel, pr.w + 2 * fb, fb, fd, x, y + pr.h / 2 + fb / 2, wz + fd / 2)
          box(c, c.M.steel, pr.w + 2 * fb, fb, fd, x, y - pr.h / 2 - fb / 2, wz + fd / 2)
          for (const sx of [-1, 1]) box(c, c.M.steel, fb, pr.h, fd, x + sx * (pr.w / 2 + fb / 2), y, wz + fd / 2)
        })
      }
      c.b.pop()
    }
    return { sleeves, bulbs: [] }
  })
  walls.group.position.set(0, ROOM.floor, 0)
  group.add(walls.group)
  // the pendants by the plaster wall light it and its prints (ceiling kit → walls kit space: same scale, z shifted)
  for (let i = 0; i < PRINT_Z.length; i++) {
    const a = ceiling.anchors[`pendant${6 + i}`]
    if (a) walls.materials.pools.add(new THREE.Vector3(a.x, a.y, a.z + zm(ROOM.back)), 3.4, '#ffdcb6', 1.25)
  }
  whenRevealed().then(async () => {
    for (let i = 0; i < PRINTS.length; i++) {
      try {
        await atlas.load(i, PRINTS[i].url)
      } catch {
        /* keep the blank print */
      }
      await nextFrame()
    }
  })
  await nextFrame()

  // ── the columns: ref6's two round black cast-iron columns, floor to girder, beside the table ──
  const colGeo = mergeGeometries(
    COLUMN_Z.map(zt => castIronColumn(H - GIRDER.h, mobile ? 18 : 28).translate(COLUMN_X, 0, zm(zt))),
  )!
  const columns = new THREE.Mesh(colGeo, new THREE.MeshStandardMaterial({ color: '#161514', roughness: 0.4, metalness: 0.35, envMapIntensity: 0.9 }))
  columns.scale.setScalar(U)
  columns.position.set(0, ROOM.floor, 0)
  columns.receiveShadow = true
  group.add(columns)

  // ── the floor: pale honey oak strips running the length of the room (ref6) ──
  // (no roughness map: glossy boards mirrored the overhead glow of the room's reflections)
  const fm = oakFloorMap(mobile)
  fm.repeat.set((ROOM.halfW * 2) / OAK_TILE, zm(ROOM.front - ROOM.back) / OAK_TILE)
  const floorMat = withPools(new THREE.MeshStandardMaterial({ map: fm, roughness: 0.56, envMapIntensity: 0.32 }), pools, 'ev-floor')
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfW * 2 * U, ROOM.front - ROOM.back), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, ROOM.floor, (ROOM.front + ROOM.back) / 2)
  floor.receiveShadow = true
  poolHook(floor, pools, ceiling.group)
  group.add(floor)

  const kits = [backBar, run, ceiling, walls]
  const hooked = new Set<THREE.Material>()
  for (const m of stools.meshes) hookPools(m)
  hookPools(columns)
  const anchors = {
    backBar: new THREE.Vector3(0, ROOM.floor + 1.6 * U, ROOM.back),
    paint: new THREE.Vector3(),
    records: new THREE.Vector3(),
  }
  group.updateMatrixWorld(true)
  backBar.worldAnchor('paint', anchors.paint)
  backBar.worldAnchor('records', anchors.records)

  function hookPools(mesh: THREE.Mesh | THREE.InstancedMesh) {
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (!hooked.has(mat)) {
      withPools(mat, pools, 'ev-lit')
      hooked.add(mat)
    }
    poolHook(mesh, pools, ceiling.group)
  }

  return {
    group,
    kits,
    backBar,
    ceiling,
    walls,
    anchors,
    litByPendants: hookPools,
    setGlow(k) {
      for (const kit of kits) kit.setGlow(k)
      pools.k = k
    },
    setAmbient(k) {
      for (const kit of kits) kit.setAmbient(k)
    },
  }
}

/**
 * Glory's bar stools (ref6): square black steel tube frames with foot rails,
 * a walnut seat and a low walnut back. Metres (scaled by U), seat 0.76 m,
 * facing -z (the bar); `n` along x over `span`, centred.
 */
function makeStools(n: number, span: number) {
  const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y, z)
    return g
  }
  const t = 0.024
  const seatY = 0.76
  const hw = 0.19
  const steel = [
    ...[-1, 1].flatMap(sx => [-1, 1].map(sz => bx(t, seatY - 0.03, t, sx * hw, (seatY - 0.03) / 2, sz * hw))),
    // foot rails and a lower ring
    bx(hw * 2, 0.02, 0.02, 0, 0.3, -hw),
    bx(hw * 2, 0.02, 0.02, 0, 0.3, hw),
    bx(0.02, 0.02, hw * 2, -hw, 0.24, 0),
    bx(0.02, 0.02, hw * 2, hw, 0.24, 0),
    // the back posts up from the rear legs
    bx(t, 0.3, t, -hw, seatY + 0.14, hw),
    bx(t, 0.3, t, hw, seatY + 0.14, hw),
  ]
  const wood = [bx(0.44, 0.035, 0.44, 0, seatY - 0.012, 0), bx(0.42, 0.1, 0.022, 0, seatY + 0.22, hw + 0.004)]
  const sg = mergeGeometries(steel)!
  const wg = mergeGeometries(wood)!
  for (const g of [...steel, ...wood]) g.dispose()
  const { map } = woodMaps()
  const sm = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: '#141212', roughness: 0.5, metalness: 0.5 }), n)
  const wm = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ map, color: '#b48560', roughness: 0.8, envMapIntensity: 0.5 }), n)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const p = new THREE.Vector3()
  let seed = 5
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.3)
    m.compose(p.set(-span / 2 + (span * i) / Math.max(1, n - 1) + (r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.1), q, one)
    sm.setMatrixAt(i, m)
    wm.setMatrixAt(i, m)
  }
  const group = new THREE.Group()
  group.scale.setScalar(U)
  group.add(sm, wm)
  return { group, meshes: [sm, wm] }
}
