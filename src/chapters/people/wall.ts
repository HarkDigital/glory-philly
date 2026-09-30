import * as THREE from 'three'
import { assemble, prepareRoom, brickPanelMapsAsync, withPools, type RoomKit } from '../../kit/room'
import {
  addBottleRow,
  addBottleSteps,
  addBrickPanel,
  addCounter,
  addDuct,
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
import { leanAgainst, makeRecord, makeSleeve, planeClearance, SEVEN, type Record as VinylRecord, type Sleeve } from '../../kit/vinyl'

/*
 * THE CREW's set: a run of Glory's real back wall (Mike's ref4 is this
 * chapter — a walnut plank column with ONE LP face-out on a small black
 * steel ledge under a wire-cage bulb, records packed on the shelves beside
 * it), built from the room kit (src/kit/room) as ONE kit, so every bulb's
 * light pool falls on all of the walnut, the records and the portraits:
 *
 *   bay L │ DAVE's column │ bay 1 │ KEVIN's column │ bay 2 │ PIER's column │ bay R
 *
 *   columns  boxy walnut-clad columns (wide vertical boards, trims) from the
 *            back counter to the black ceiling; on each, a black steel
 *            face-out ledge with the person's 12" sleeve (the portrait is the
 *            cover), its record half out to the right showing the label, and
 *            a wire-cage Edison sconce above
 *   bays     shelves PACKED with LPs over a mirror strip and spouted liquor
 *            steps on the counter; bay 2 carries the 7" singles, with The
 *            Glorious Archibald face-out in front of them; bottles up top
 *   bay R    an exposed-brick accent panel with two walnut shelves: the stout
 *            stands on the lower one (the out-beat cranes down to it)
 *   above    the black ceiling, silver flex duct, two wire-cage pendants
 *
 * Every sleeve is posed by kit/vinyl's leanAgainst from its real bounds (the
 * record half out counts): the top edge keeps ~4 mm off the column (or the
 * singles' spines), the foot stands on the steel behind its lip.
 *
 * UNITS: the kit is in metres; the chapter's world unit is SLEEVE_S / 0.315
 * per metre (a 12" sleeve = 1.6 world units), and world y = 0 is the top of
 * the portrait ledges.
 */

/** world size of a 12" sleeve (the chapter's scale) */
export const SLEEVE_S = 1.6
/** world units per metre */
export const MPW = SLEEVE_S / 0.315

/** the run, in metres (kit space: floor y = 0, the wall's face at z = WZ, the room toward +z) */
export const ROOM = {
  /** back counter top */
  cy: 0.92,
  /** the black ceiling */
  ceil: 3.3,
  /** column centres (Dave, Kevin, Pier) */
  cols: [-1.22, 0, 1.22],
  colW: 0.62,
  /** column front face (from the wall plane z = 0) */
  colD: 0.44,
  /** the cladding's face */
  WZ: 0.02,
  /** the portrait ledges' top */
  ledgeY: 1.52,
  /** how far left of the column centre the sleeve stands (the record runs out to the right) */
  sleeveOff: 0.1,
  /** the lean back onto the column (radians) */
  lean: 0.085,
  /** sconce back plate (on the column's face) */
  sconceY: 1.95,
  /** first LP shelf in the bays */
  recY: 1.45,
  /** bay R: the brick panel's width and the stout's shelf */
  brickW: 1.05,
  brickY0: 1.02,
  brickY1: 2.46,
  stoutY: 1.2,
}

const L = ROOM
/** the stout's x on bay R's lower shelf (from the bay's left edge, metres) */
const PINT_AT = 0.44
/** record half out of its sleeve (display-local, sleeve units): resting .. in focus */
export const OUT: [number, number] = [0.57, 0.66]

export interface Display {
  /** sleeve + record, posed in the kit's space (metres); scale = 0.315 m per sleeve unit */
  holder: THREE.Group
  sleeve: Sleeve
  record: VinylRecord
  size: 12 | 7
  /** WORLD box of the sleeve with its record fully out (for camera fits) */
  box: THREE.Box3
  /** WORLD centre of the sconce's bulb above it (12" displays) */
  bulb: THREE.Vector3
  /** index of its bulb's light pool (−1 = none) */
  pool: number
  /** clearance left to the surface behind (metres) — logged by the clip check */
  gap: number
}

export interface CrewWall {
  kit: RoomKit
  /** the three portraits, left → right */
  displays: Display[]
  /** The Glorious Archibald, face-out in front of the singles */
  single: Display
  /** WORLD point on the stout's shelf where the pint stands (its base centre) */
  pint: THREE.Vector3
  /** the portraits' sconce pools: 0..1 (the one in focus up, the others lower) */
  setLamp(i: number, k: number): void
  dispose(): void
}

interface DisplaySpec {
  front: THREE.Texture
  label: THREE.Texture
  size?: 12 | 7
  seed?: number
}

/** the sleeve + its record half out to the right (label showing), in one group */
function makeHolder(spec: DisplaySpec, out: number) {
  const size = spec.size ?? 12
  const k = size === 7 ? SEVEN : 1
  const seed = spec.seed ?? 0
  const sleeve = makeSleeve({ front: spec.front, size, wear: 0.25, seed, gloss: 0.4 })
  sleeve.mesh.castShadow = true
  const record = makeRecord({ label: spec.label, size, seed: 11 + seed * 3, segments: 128 })
  record.disc.castShadow = true
  record.group.position.set(out * k, 0.5 * k, 0)
  record.setSpin(-0.08 - seed * 0.21)
  const holder = new THREE.Group()
  holder.add(sleeve.group, record.group)
  holder.scale.setScalar(0.315)
  return { holder, sleeve, record, size }
}

/**
 * Build the wall (async: the room kit's maps are built across frames first).
 * `people`: the three portraits' cover + label; `single`: the Archibald 7".
 */
export async function makeCrewWall(people: DisplaySpec[], single: DisplaySpec, mobile: boolean): Promise<CrewWall> {
  const [c0, c1, c2] = L.cols
  const half = L.colW / 2
  // bays (clear x between the columns' side faces)
  const bayL: [number, number] = [c0 - half - 1.35, c0 - half - 0.002]
  const bay1: [number, number] = [c0 + half + 0.002, c1 - half - 0.002]
  const bay2: [number, number] = [c1 + half + 0.002, c2 - half - 0.002]
  const bayR: [number, number] = [c2 + half + 0.002, c2 + half + 0.002 + L.brickW]
  const X0 = bayL[0] - 0.4
  const X1 = bayR[1] + 1.6
  const brickH = L.brickY1 - L.brickY0
  const brick = { lines: [], seed: 12, soot: 0.45 }

  await prepareRoom()
  await brickPanelMapsAsync(L.brickW, brickH, brick)

  const holders = people.map((p, i) => makeHolder({ ...p, seed: p.seed ?? i }, OUT[0]))
  const archie = makeHolder({ ...single, size: 7, seed: single.seed ?? 3 }, 0.44)
  const pools: number[] = []
  const bulbs: THREE.Vector3[] = []
  // singles: their spines stand no further out than this (addRecordRow: EPS + depth + max pull)
  const singlesDepth = 0.16
  const singlesFront = L.WZ + 0.004 + 0.181 + Math.max(0, singlesDepth + 0.03 - 0.181 - 0.004)
  const yS = L.recY + 0.365 // bay 2: the singles stand on the LP shelf's top board

  const kit = assemble({ scale: MPW, mobile, seed: 31, glow: 1.15, ambient: 0.3 }, c => {
    const WZ = L.WZ
    // walls, ceiling, counter
    addPlankWall(c, X1 - X0, L.ceil, { depth: WZ, x: (X0 + X1) / 2 })
    box(c, c.M.ceiling, X1 - X0 + 2, 0.03, 5, (X0 + X1) / 2, L.ceil + 0.015, 2.5)
    for (let x = X0 + 0.3; x < X1; x += 1.2) box(c, c.M.ceiling, 0.1, 0.2, 5, x, L.ceil - 0.1, 2.5)
    addCounter(c, X0, X1, { y: L.cy, d: 0.6 })
    wood(c, X1 - X0, L.cy - 0.045, 0.58, (X0 + X1) / 2, (L.cy - 0.045) / 2, 0.29, { vertical: true, tile: 1.6 })
    // the ceiling's silver flex duct and two wire-cage pendants in front of the wall
    // (it runs just in front of the columns — 5 cm clear of their faces, 8 cm over the
    // sconces' cages — and behind the pendants, low enough that the wide shot catches it
    // along the top, as in ref1; the close shots stay under it)
    addDuct(c, [new THREE.Vector3(X0, L.ceil - 0.77, 0.72), new THREE.Vector3((c0 + c1) / 2, L.ceil - 0.8, 0.7), new THREE.Vector3(X1, L.ceil - 0.77, 0.71)], {
      radius: 0.19,
      ceilingY: L.ceil - 0.2,
    })

    // the three portrait columns: walnut, a steel ledge, a sconce
    L.cols.forEach((cx, i) => {
      addPlankColumn(c, L.colW, L.colD - WZ, L.ceil - L.cy, { x: cx, y: L.cy, z: WZ })
      c.b.push(cx, L.ledgeY, L.colD)
      addRecordLedge(c, { length: L.colW - 0.09, lean: L.lean, sleeve: null })
      c.b.pop()
      const n = c.M.pools.pools.length
      const bulb = addSconce(c, { x: cx, y: L.sconceY, z: L.colD, power: 1.1 })
      pools[i] = c.M.pools.pools.length > n ? n : -1
      bulbs[i] = bulb
      const h = holders[i]
      withPools(h.sleeve.material, c.M.pools, 'sleeve')
      c.hooks.push(h.sleeve.mesh)
      c.b.object(h.holder, new THREE.Matrix4().makeScale(0.315, 0.315, 0.315))
    })

    // bays 1, 2 and L: LP shelves over a mirror strip and spouted liquor steps
    const lpBay = ([x0, x1]: [number, number], rows: number) => {
      const cx = (x0 + x1) / 2
      const mh = L.recY - 0.05 - L.cy - 0.03
      box(c, c.M.mirror, x1 - x0 - 0.02, mh, 0.006, cx, L.cy + 0.03 + mh / 2, WZ + 0.003)
      addBottleSteps(c, x0 + 0.02, x1 - 0.02, { y: L.cy, z: WZ + 0.008, tiers: 2, rise: 0.09, maxY: L.recY - 0.032 })
      addRecordShelf(c, x0, x1, { y: L.recY, z: WZ, rows, top: true, sides: false })
    }
    lpBay(bay1, 2)
    lpBay(bay2, 1)
    lpBay(bayL, 2)
    // bottles over the LPs (bay 1, bay L)
    for (const [x0, x1] of [bay1, bayL]) {
      const y = L.recY + 0.73
      addBottleRow(c, x0 + 0.04, x1 - 0.04, { y, z: WZ + 0.16, slack: 0.05, spout: 0, maxH: L.ceil - 0.25 - y })
    }
    // bay 2: the 7" singles on the LP shelf's top board, a shelf of bottles over them
    addRecordRow(c, { x0: bay2[0] + 0.004, x1: bay2[1] - 0.004, y: yS, zBack: WZ, depth: singlesDepth, singles: true })
    const yCub = yS + 0.26
    addShelf(c, bay2[1] - bay2[0], 0.34, { x: (bay2[0] + bay2[1]) / 2, y: yCub, z: WZ })
    addBottleRow(c, bay2[0] + 0.05, bay2[1] - 0.05, { y: yCub, z: WZ + 0.16, slack: 0.05, spout: 0, maxH: 0.36 })
    withPools(archie.sleeve.material, c.M.pools, 'sleeve')
    c.hooks.push(archie.sleeve.mesh)
    c.b.object(archie.holder, new THREE.Matrix4().makeScale(0.315, 0.315, 0.315))

    // bay R: the exposed-brick accent panel with two walnut shelves; the stout's on the lower one
    const bx = (bayR[0] + bayR[1]) / 2
    addBrickPanel(c, L.brickW, brickH, { x: bx, y: L.brickY0, z: WZ, ...brick })
    addShelf(c, L.brickW, 0.28, { x: bx, y: L.stoutY, z: WZ })
    addShelf(c, L.brickW, 0.24, { x: bx, y: 1.66, z: WZ })
    // (the stout stands alone on its stretch of shelf; bottles further along)
    addBottleRow(c, bayR[0] + PINT_AT + 0.36, bayR[1] - 0.03, { y: L.stoutY, z: WZ + 0.1, slack: 0.02, spout: 0, maxH: 1.66 - 0.032 - L.stoutY })
    addBottleRow(c, bayR[0] + 0.3, bayR[1] - 0.04, { y: 1.66, z: WZ + 0.1, slack: 0.02, spout: 0, maxH: L.brickY1 - 1.66 + 0.2 })
    // beyond: more LPs
    addRecordShelf(c, bayR[1] + 0.03, X1 - 0.1, { y: L.recY, z: WZ, rows: 2, top: true, sides: true })

    // pendants over bays 1 and 2 (hung well in front of the wall, above the close shots)
    const pn = c.M.pools.pools.length
    addPendant(c, { x: (c0 + c1) / 2 + 0.05, y: L.ceil - 0.2, z: 1.2, drop: 0.66 })
    addPendant(c, { x: (c1 + c2) / 2 - 0.05, y: L.ceil - 0.2, z: 1.2, drop: 0.74 })
    // (they hang in front of the sleeves: kept low, so no cover band blooms)
    for (let k = pn; k < c.M.pools.pools.length; k++) c.M.pools.pools[k].power *= 0.28
    return { sleeves: [] }
  })

  // this run's sconce plates: aged, darker brass (they sit 12 cm from their own bulbs)
  kit.materials.brass.color.set('#5e4228')
  kit.materials.brass.roughness = 0.46

  // ── pose every sleeve exactly (after build: parent = the kit group, metres) ──
  // (posed on the sleeve's own bounds: the record lies inside the sleeve's
  // thickness and above its foot, but its spun disc's bounding box would
  // read as a corner below the foot)
  const lean = (h: ReturnType<typeof makeHolder>, o: Parameters<typeof leanAgainst>[1]) => {
    h.holder.remove(h.record.group)
    const p = leanAgainst(h.holder, o)
    h.holder.add(h.record.group)
    return p
  }
  const gaps: number[] = []
  holders.forEach((h, i) => {
    const sx = L.cols[i] - L.sleeveOff
    const p = lean(h, { wallZ: L.colD, floorY: L.ledgeY, x: sx, lean: L.lean, clearance: 0.012 })
    gaps.push(p.gap)
    // the foot must stand behind the ledge's lip (addRecordLedge: lip inner face)
    const st = 0.014 * 0.315
    const zp = 0.003 + 0.315 * Math.sin(L.lean) + (st / 2) * Math.cos(L.lean)
    const lipIn = zp + (st / 2) * Math.cos(L.lean) + 0.003
    if (p.foot > lipIn - 0.0005) console.warn(`[people] sleeve ${i}: foot ${p.foot.toFixed(4)} past the lip ${lipIn.toFixed(4)}`)
  })
  const ax = bay2[0] + 0.13
  const pa = lean(archie, { wallZ: singlesFront, floorY: yS, x: ax, lean: 0.11, clearance: 0.012 })
  gaps.push(pa.gap)

  // the kit: world y = 0 at the ledges' top
  kit.group.position.set(0, -L.ledgeY * MPW, 0)
  kit.group.updateMatrixWorld(true)

  const toDisplay = (h: ReturnType<typeof makeHolder>, pool: number, bulb: THREE.Vector3 | null, gap: number, out: number): Display => {
    const k = h.size === 7 ? SEVEN : 1
    const x0 = h.record.group.position.x
    h.record.group.position.x = out * k
    h.holder.updateMatrixWorld(true)
    const bx = new THREE.Box3().setFromObject(h.holder, true)
    h.record.group.position.x = x0
    h.holder.updateMatrixWorld(true)
    const b = bulb ? bulb.clone().applyMatrix4(kit.group.matrixWorld) : bx.getCenter(new THREE.Vector3())
    return { holder: h.holder, sleeve: h.sleeve, record: h.record, size: h.size, box: bx, bulb: b, pool, gap }
  }
  const displays = holders.map((h, i) => toDisplay(h, pools[i], bulbs[i], gaps[i], OUT[1]))
  const singleD = toDisplay(archie, -1, null, pa.gap, 0.44)

  // clip audit: every sleeve's clearance to what it leans on (world units; > 0 is clear)
  const wpl = new THREE.Plane()
  const clear = (d: Display, zKit: number) => {
    wpl.set(new THREE.Vector3(0, 0, 1), -(zKit * MPW))
    // (a spun disc's box would stick out past the disc: measure it square)
    const spin = d.record.disc.rotation.z
    d.record.disc.rotation.z = 0
    const g = planeClearance(d.holder, wpl) / MPW
    d.record.disc.rotation.z = spin
    d.holder.updateMatrixWorld(true)
    return g
  }
  const audit = [...displays.map(d => clear(d, L.colD)), clear(singleD, singlesFront)]
  if (audit.some(g => g < 0.002)) console.warn('[people] a sleeve is under 2 mm from its wall', audit)
  if (new URLSearchParams(location.search).has('debug')) {
    console.log('[people] sleeve clearances (mm):', audit.map(g => (g * 1000).toFixed(1)).join(' / '))
    const rows: string[] = []
    kit.group.traverse(o => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const g = m.geometry
      const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1)
      rows.push(`${(m.material as THREE.Material).type}:${Math.round(n)}${(m as THREE.InstancedMesh).isInstancedMesh ? 'x' + (m as THREE.InstancedMesh).count : ''}`)
    })
    console.log(`[people] kit draws ${kit.draws}: ${rows.join(' ')}`)
  }

  // the stout's spot on bay R's lower shelf
  const pint = new THREE.Vector3(bayR[0] + PINT_AT, L.stoutY, L.WZ + 0.16).applyMatrix4(kit.group.matrixWorld)

  const base = kit.materials.pools.pools.map(p => p.power)
  return {
    kit,
    displays,
    single: singleD,
    pint,
    setLamp(i, k) {
      const d = displays[i]
      if (!d || d.pool < 0) return
      kit.materials.pools.pools[d.pool].power = base[d.pool] * k
    },
    dispose() {
      kit.dispose()
      for (const h of [...holders, archie]) {
        h.sleeve.dispose()
        ;(h.record.disc.material as THREE.Material).dispose()
      }
    },
  }
}
