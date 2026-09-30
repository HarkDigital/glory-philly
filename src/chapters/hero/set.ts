import * as THREE from 'three'
import { makeDripTray, makeFaucet, stainless } from '../../kit/bar'
import { BRAND } from '../../content'
import { catNo, coverTexture, drawRoundel, makeRecord, makeTurntable, onFonts, type Record, type Sleeve, type Turntable } from '../../kit/vinyl'
import { makeBackBar, makeBarRun, makeCeiling, prepareRoom, type RoomKit } from '../../kit/room'

/*
 * HERO SET — Glory's real back bar (Mike's ref1), seen from a stool at the
 * long bar. Foreground: the long oiled bar with its black rubber rail, a
 * stainless tap post with one faucet over a drip tray, the red-G coaster.
 * Across the bartender's aisle: the room kit's back bar (src/kit/room) —
 * walnut plank columns with wire-cage sconces, the brick bay with the painted
 * "Old 1837" over two shelves of bottles, the hi-fi (receiver with the blue
 * ring) carrying Glory's walnut deck and its red "This Must Be the Place"
 * record, the house sleeve leaning beside it, the records bay packed with LPs
 * over spouted liquor steps and a mirror strip, coolers glowing below. Over
 * it all the black ceiling, silver flex duct and a wire-cage pendant hanging
 * over the pour.
 *
 * Units: the hero's (1 unit ≈ 7.4 cm; the tulip is 2.42 units ≈ 18 cm); the
 * long bar's top is y = 0. The room kit works in metres: ROOM.k = units per
 * metre, and its floor sits 1.07 m under the bar top.
 */

/** where things stand (world units; the bar top is y = 0) */
export const SET = {
  glassScale: 2.2,
  /** the glass's spot on the drip tray, under the spout */
  pour: new THREE.Vector3(0.9, 0.05, -0.12),
  /** the coaster (the payoff) */
  coaster: new THREE.Vector3(2.35, 0, 0.95),
  tower: new THREE.Vector3(0.9, 0, -1.3),
  towerR: 0.17,
  faucetY: 3.3,
}

const K = 100 / 7.4
/** the room kit in hero units */
export const ROOM = {
  /** hero units per metre */
  k: K,
  /** the floor, 1.07 m under the long bar's top */
  floorY: -1.07 * K,
  /** the back wall (the kit's z = 0) */
  wallZ: -22.2,
  /** the kit's x = 0 (its brick bay's hi-fi sits at kit x 0.22 m) */
  x: -18,
  /** the long bar: its customer edge (+z) and depth (metres) */
  barEdgeZ: 2.35,
  barDepth: 0.64,
}

/**
 * THE DECK — Glory's walnut turntable (src/kit/vinyl) where the real one is:
 * on the hi-fi on the back counter (the room kit's `turntable` seat), spinning
 * the red-label Glory record. The kit's 12" unit is 0.315 m, so its scale in
 * hero units is 0.315 × ROOM.k (≈ 4.26: the old DECK_ANCHOR scale, unchanged).
 */
export const DECK_ANCHOR = {
  scale: 0.315 * K,
  cmPerUnit: 7.4,
}

/** A cream coaster printed with the red-ring "G" roundel (the site icon), drawn crisp. */
function roundelCoaster(): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; edge: THREE.MeshStandardMaterial; tex: THREE.CanvasTexture } {
  const n = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const draw = () => {
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, n, n)
    // pulp board, then the roundel filling it (cream disc, red ring, heavy G)
    g.fillStyle = '#efe7d6'
    g.fillRect(0, 0, n, n)
    drawRoundel(g, n / 2, n / 2, n * 0.47, { disc: '#f3ecdc' })
    tex.needsUpdate = true
  }
  draw()
  void onFonts(draw)
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: '#cfc7b7', roughness: 0.9, envMapIntensity: 0.3 })
  const edge = new THREE.MeshStandardMaterial({ color: '#b8ad98', roughness: 0.92 })
  const geo = new THREE.CylinderGeometry(0.82, 0.82, 0.035, 64, 1, true)
  geo.translate(0, 0.0175, 0)
  const mesh = new THREE.Mesh(geo, edge)
  mesh.receiveShadow = true
  // the printed face: a disc whose texture top points away from the room
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.82, 64), mat)
  face.rotation.x = -Math.PI / 2
  face.position.y = 0.035
  face.receiveShadow = true
  mesh.add(face)
  return { mesh, mat, edge, tex }
}

export interface HeroSet {
  group: THREE.Group
  /** the deck's mount on the hi-fi (the room kit's turntable seat) */
  deck: THREE.Group
  tt: Turntable
  record: Record
  /** the house sleeve leaning on the back counter beside the hi-fi */
  sleeve: Sleeve
  faucet: ReturnType<typeof makeFaucet>
  coaster: THREE.Mesh
  /** a warm spot from the sconce side onto the deck (the room's pools light only the kit) */
  wash: THREE.SpotLight
  /** the room kit pieces: the back bar, the long bar, the ceiling */
  backBar: RoomKit
  bar: RoomKit
  ceiling: RoomKit
  /** 0..1.5 every bulb and its light pools (drive it; never toggle) */
  setGlow(k: number): void
  /** 0..2 the kit's warm bounce */
  setAmbient(k: number): void
  dispose(): void
}

export async function buildSet(mobile: boolean): Promise<HeroSet> {
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []

  // the room kit's maps, built across frames (no long task); its makers are then quick
  await prepareRoom({ backBar: {} })

  // ── THE BACK BAR (ref1): the room kit, across the aisle ──
  // the record's own sleeve, red like the LP standing by the real hi-fi (ref1), a Glory typographic cover
  const houseSleeve = coverTexture({ title: BRAND.short, sub: BRAND.motto, kicker: `${BRAND.neighborhood} · Philadelphia`, cat: catNo(1), paper: 'red' })
  const backBar = makeBackBar({
    scale: K,
    brick: 'old1837',
    records: { rows: 1, singles: 0.42 },
    hifi: true,
    // the walnut deck goes on the hi-fi below (the kit's own is a black one)
    turntable: false,
    // the house sleeve stands beside the hi-fi, posed by the kit's leanOnWall (never clipped)
    sleeve: houseSleeve,
    tv: false,
    ceiling: false,
    mobile,
    ambient: 0.3,
  })
  backBar.group.position.set(ROOM.x, ROOM.floorY, ROOM.wallZ)
  group.add(backBar.group)
  // this instance's brick: a touch redder (ref2's old Philadelphia brick reads red-brown behind the pour)
  backBar.group.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if ((o as THREE.Mesh).isMesh && m && !Array.isArray(m) && m.bumpScale === 3.2 && m.map) m.color.setRGB(1.14, 0.9, 0.8)
  })
  disposables.push(backBar, houseSleeve)

  // ── THE DECK on the hi-fi ──
  const deck = new THREE.Group()
  deck.name = 'hero-deck'
  deck.position.copy(backBar.anchors.turntable)
  deck.scale.setScalar(0.315)
  backBar.group.add(deck)
  const tt = makeTurntable({ finish: 'walnut', shadows: false, contact: false })
  const record = makeRecord({ label: { title: 'This Must Be the Place', sub: BRAND.name, side: 'SIDE A', cat: catNo(1), paper: 'red' } })
  tt.setRecord(record)
  deck.add(tt.group)
  disposables.push(tt)

  // ── THE LONG BAR: oiled top, black rubber rail on the bartender's side, planked front ──
  const L = 6.2
  const bar = makeBarRun({ scale: K, length: L, depth: ROOM.barDepth, height: 1.07, mobile })
  bar.group.position.set(0.4, ROOM.floorY, ROOM.barEdgeZ - (ROOM.barDepth / 2) * K)
  group.add(bar.group)
  disposables.push(bar)
  // the kit tiles the top's grain once per 3.2 m; the hero films it from a few cm: re-tile it
  // (a tile per 0.8 m along the grain, ~9 cm boards across) so the planks stay crisp up close
  bar.group.traverse(o => {
    const m = o as THREE.Mesh
    const p = (m.geometry as THREE.BoxGeometry | undefined)?.parameters
    if (!m.isMesh || !p || Math.abs(p.width - L) > 1e-6 || Math.abs(p.depth - ROOM.barDepth) > 1e-6) return
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 2.2)
    uv.needsUpdate = true
    m.receiveShadow = true
    // oiled honey oak as at the bar, a touch less orange than the kit's lift under the hero's tungsten key
    ;(m.material as THREE.MeshPhysicalMaterial).color.setRGB(1.42, 1.36, 1.38)
  })

  // ── THE CEILING: black paint, joists, a galvanized duct trunk along the bulkhead, a wire-cage
  // pendant over the pour (its bulb ~0.6 m over the bar, just behind the tap post) ──
  const kx = (x: number) => x / K
  const kz = (z: number) => (z - ROOM.wallZ) / K
  const ceiling = makeCeiling({
    scale: K,
    width: 9,
    depth: kz(ROOM.barEdgeZ + 14),
    height: 3.45,
    mobile,
    // ref1: a long galvanized trunk tight under the black ceiling, along the back bar's bulkhead
    ducts: [{ pts: [new THREE.Vector3(-4.5, 0, 0.9), new THREE.Vector3(4.5, 0, 0.9)], shape: 'rect', size: [0.6, 0.32] }],
    pendants: [
      { x: kx(SET.pour.x + 0.6), z: kz(SET.tower.z - 1.6), drop: 1.3 },
      { x: kx(SET.pour.x - 30), z: kz(SET.tower.z - 1.2), drop: 1.25 },
      { x: kx(SET.pour.x + 34), z: kz(SET.tower.z - 1.4), drop: 1.3 },
    ],
  })
  ceiling.group.position.set(0, ROOM.floorY, ROOM.wallZ)
  group.add(ceiling.group)
  disposables.push(ceiling)

  // ── THE TAP POST: brushed stainless, one faucet facing the room ──
  const steel = stainless({ roughness: 0.3, color: '#767b80' })
  disposables.push(steel)
  const colH = SET.faucetY + 0.55
  const column = new THREE.Mesh(new THREE.CylinderGeometry(SET.towerR, SET.towerR * 1.12, colH, 48), steel)
  column.position.set(SET.tower.x, colH / 2, SET.tower.z)
  column.castShadow = true
  column.receiveShadow = true
  group.add(column)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(SET.towerR, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), steel)
  cap.position.set(SET.tower.x, colH, SET.tower.z)
  group.add(cap)
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(SET.towerR * 1.6, SET.towerR * 1.7, 0.08, 48), steel)
  foot.position.set(SET.tower.x, 0.04, SET.tower.z)
  group.add(foot)
  disposables.push(column.geometry, cap.geometry, foot.geometry)
  const faucet = makeFaucet({ scale: SET.glassScale })
  faucet.group.position.set(SET.tower.x, SET.faucetY, SET.tower.z + SET.towerR - 0.02)
  group.add(faucet.group)
  disposables.push(faucet)
  const tray = makeDripTray(1.7, 1.0)
  tray.position.set(SET.pour.x, SET.pour.y, SET.pour.z + 0.05)
  group.add(tray)

  // ── THE COASTER ──
  const co = roundelCoaster()
  co.mesh.position.copy(SET.coaster)
  co.mesh.rotation.y = -0.35
  group.add(co.mesh)
  disposables.push(co.mat, co.edge, co.tex, co.mesh.geometry)

  // a warm spot from the sconce's side onto the deck and the hi-fi (no shadows)
  const wash = new THREE.SpotLight('#ffb070', 0, 0, 0.32, 0.85, 2)
  const at = backBar.worldAnchor('turntable')
  wash.position.set(at.x + 6, at.y + 16, at.z + 7)
  wash.target.position.copy(at)
  group.add(wash, wash.target)

  const kits = [backBar, bar, ceiling]
  return {
    group,
    deck,
    tt,
    record,
    sleeve: backBar.sleeves[0],
    faucet,
    coaster: co.mesh,
    wash,
    backBar,
    bar,
    ceiling,
    setGlow(k) {
      for (const kit of kits) kit.setGlow(k)
    },
    setAmbient(k) {
      for (const kit of kits) kit.setAmbient(k)
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
