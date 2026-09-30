import * as THREE from 'three'
import { BRAND, DRAFTS } from '../../content'
import { nextFrame } from '../../core/yield'
import { FAUCET_Y, FAUCET_Z, TRAY_Y, makeTapWall, type TapSpec, type TapWall } from '../../kit/tap'
import { catNo, coverTexture, drawRoundel, makeRecord, makeTurntable, onFonts, type Record, type Sleeve, type Turntable } from '../../kit/vinyl'
import { makeBackBar, makeBarRun, makeCeiling, prepareRoom, type RoomKit } from '../../kit/room'

/*
 * HERO SET — Glory's real back bar (Mike's ref1), seen from a stool at the
 * long bar. Foreground: the long oiled bar with its black rubber rail and the
 * red-G coaster. Across the bartender's aisle: the room kit's back bar
 * (src/kit/room) — walnut plank columns with wire-cage sconces, the brick bay
 * with the painted "Old 1837" over two shelves of bottles, and on its counter
 * a short run of the bar's tap wall (kit/tap, as in the On Tap chapter: black
 * backplate, stainless manifold, lacquered handles; the house G handle pours)
 * right beside the hi-fi (receiver with the blue ring) carrying Glory's
 * walnut deck and its red "This Must Be the Place" record, the house sleeve
 * leaning beside it; the records bay packed with LPs over spouted liquor
 * steps and a mirror strip, coolers glowing below. Over it all the black
 * ceiling, the galvanized duct trunk and wire-cage pendants.
 *
 * Units: the hero's (1 unit ≈ 7.4 cm; the tulip is 2.42 units ≈ 18 cm); the
 * long bar's top is y = 0. The room kit works in metres: ROOM.k = units per
 * metre, and its floor sits 1.07 m under the bar top.
 */

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

/** the back counter's top and the cladding's face (hero units) */
const COUNTER_Y = ROOM.floorY + 0.92 * ROOM.k
const CLAD_Z = ROOM.wallZ + 0.02 * ROOM.k

/**
 * THE TAPS — a short run of the bar's tap wall (kit/tap, whose unit is the
 * vinyl kit's 0.315 m) on the brick bay's back counter, in the clear span
 * between column B's face (kit x −0.6 m) and the hi-fi (kit x 0.005 m). The
 * backplate stands a hair off the cladding; the house handle (the red G, no
 * beer claimed) is the one that pours, next to the deck.
 */
export const TAPS = {
  /** hero units per kit/tap unit */
  s: 0.315 * K,
  /** the run's centre (world x): kit x −0.31 m */
  x: ROOM.x - 0.31 * K,
  /** the group origin: the counter top, the kit/tap wall plane (z = −0.945) 1.5 mm off the cladding */
  y: COUNTER_Y,
  z: CLAD_Z + 0.945 * 0.315 * K + 0.02,
  /** tap x in kit/tap units (spacing 0.3, as on the On Tap wall) */
  xs: [-0.6, -0.3, 0, 0.3, 0.6],
  /** the bay's clear width in kit/tap units: column B's face … 3 cm short of the hi-fi */
  bay: [-0.9, 0.82] as [number, number],
  /** the pouring tap (the house handle) */
  pour: 3,
}

/** where things stand (world units; the long bar top is y = 0) */
export const SET = {
  glassScale: 2.2,
  /** the glass's spot on the tap's drip tray, under the house faucet */
  pour: new THREE.Vector3(TAPS.x + TAPS.xs[TAPS.pour] * TAPS.s, TAPS.y + TRAY_Y * TAPS.s, TAPS.z + (FAUCET_Z + 0.012) * TAPS.s),
  /** the spout, over it */
  spout: new THREE.Vector3(TAPS.x + TAPS.xs[TAPS.pour] * TAPS.s, TAPS.y + (FAUCET_Y - 0.115) * TAPS.s, TAPS.z + (FAUCET_Z + 0.012) * TAPS.s),
  /** how far the bartender lifts the glass up to the faucet (its base ends level with the long bar's top) */
  lift: 0.0 - (TAPS.y + TRAY_Y * TAPS.s) + 0.12,
  /** the coaster on the long bar, across the aisle from the tap (the payoff) */
  coaster: new THREE.Vector3(-1.2, 0, -3.2),
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

/** the run's handles: four International drafts (as in the On Tap chapter's brick bay) and the house handle */
function tapSpecs(): TapSpec[] {
  const intl = DRAFTS.find(g => g.id === 'international') ?? DRAFTS[1] ?? DRAFTS[0]
  const first = DRAFTS.slice(0, DRAFTS.indexOf(intl)).reduce((n, g) => n + g.beers.length, 0) + 1
  const named = intl.beers.slice(0, 4).map((name, i) => ({ name, num: String(first + i).padStart(2, '0') }))
  const specs: TapSpec[] = []
  for (let i = 0, j = 0; i < TAPS.xs.length; i++) specs.push(i === TAPS.pour ? { num: '36' } : named[j++] ?? { num: '36' })
  return specs
}

export interface HeroSet {
  group: THREE.Group
  /** the deck's mount on the hi-fi (the room kit's turntable seat) */
  deck: THREE.Group
  tt: Turntable
  record: Record
  /** the house sleeve leaning on the back counter beside the hi-fi */
  sleeve: Sleeve
  /** the run of taps on the back counter */
  taps: TapWall
  /** 0 shut .. 1 the house handle pulled fully forward */
  setPull(k: number): void
  /** world position where the beer leaves the house faucet */
  spout(out: THREE.Vector3): THREE.Vector3
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
  /**
   * Give the room kit's materials the world's env EXPLICITLY at `k` × their
   * authored envMapIntensity (walnut 0.5, brick 0.35, black ceiling 0.3 …).
   * With envMap null three r186 replaces a material's envMapIntensity by
   * scene.environmentIntensity, so the walnut, the brick and the black paint
   * all took the studio env at full strength: the flat lift over ref1's
   * shadows. The glass and the steel keep the scene env.
   */
  setRoomEnv(env: THREE.Texture, k: number): void
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
  await nextFrame()

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
  await nextFrame()

  // ── THE TAPS on the back counter, beside the hi-fi ──
  const taps = makeTapWall({ taps: tapSpecs(), x: TAPS.xs, bays: [{ first: 0, last: TAPS.xs.length - 1, x0: TAPS.bay[0], x1: TAPS.bay[1] }] })
  taps.group.name = 'hero-taps'
  taps.group.scale.setScalar(TAPS.s)
  taps.group.position.set(TAPS.x, TAPS.y, TAPS.z)
  group.add(taps.group)
  disposables.push(taps)
  // the plates are canvas type: redraw once the slab face has landed
  void document.fonts?.load('400 60px "Alfa Slab One"').then(() => taps.drawLabels(), () => {})
  void document.fonts?.ready.then(() => taps.drawLabels())
  const spoutL = new THREE.Vector3()
  await nextFrame()

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
    // ref1's honey oak. kit/bar's planks are red-brown (linear G/R ≈ 0.32, B/R ≈ 0.11) and
    // every light in the room is warm, so under the hero's tungsten the top rendered
    // orange-red (hue 21°, HSL sat 0.55–0.7). The photo's oiled oak is G/R ≈ 0.54, B/R ≈ 0.26:
    // this replaces the kit's lift with one that lands the rendered top at hue ~30°, sat ~0.38
    // (measured in the landing, the serve and the payoff)
    ;(m.material as THREE.MeshPhysicalMaterial).color.setRGB(1.3, 3.7, 6.6)
  })
  await nextFrame()

  // ── THE CEILING: black paint, joists, a galvanized duct trunk along the bulkhead, wire-cage
  // pendants over the long bar (one over the coaster) ──
  // (the ceiling's group sits at world x 0)
  const kx = (x: number) => x / K
  const kz = (z: number) => (z - ROOM.wallZ) / K
  const ceiling = makeCeiling({
    scale: K,
    width: 9,
    depth: kz(ROOM.barEdgeZ + 14),
    height: 3.45,
    mobile,
    // ref1: a galvanized trunk tight under the black ceiling along the back bar's bulkhead, coming in
    // from the far (left) end of the room; over column B it turns out over the long bar toward the
    // room (as the photo's top-left), clear of the brick bay's view
    ducts: [
      {
        pts: [new THREE.Vector3(-4.5, 0, 0.9), new THREE.Vector3(kx(ROOM.x - 1.05 * K), 0, 0.9), new THREE.Vector3(kx(ROOM.x - 1.05 * K), 0, kz(ROOM.barEdgeZ + 12))],
        shape: 'rect',
        size: [0.6, 0.32],
      },
    ],
    pendants: [
      { x: kx(SET.coaster.x + 3), z: kz(SET.coaster.z + 1.5), drop: 1.3 },
      { x: kx(SET.coaster.x - 30), z: kz(SET.coaster.z + 1.8), drop: 1.25 },
      { x: kx(SET.coaster.x + 34), z: kz(SET.coaster.z + 1.4), drop: 1.3 },
    ],
  })
  ceiling.group.position.set(0, ROOM.floorY, ROOM.wallZ)
  group.add(ceiling.group)
  disposables.push(ceiling)

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
  const roomEnv: { m: THREE.MeshStandardMaterial; base: number }[] = []
  return {
    group,
    deck,
    tt,
    record,
    sleeve: backBar.sleeves[0],
    taps,
    setPull(k) {
      taps.setPull(TAPS.pour, k)
    },
    spout(out) {
      taps.group.updateWorldMatrix(true, false)
      return out.copy(taps.spout(TAPS.pour, spoutL)).applyMatrix4(taps.group.matrixWorld)
    },
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
    setRoomEnv(env, k) {
      if (!roomEnv.length) {
        const seen = new Set<THREE.Material>()
        const visit = (o: THREE.Object3D) => {
          if (o === deck) return
          const m = (o as THREE.Mesh).material
          for (const x of Array.isArray(m) ? m : m ? [m] : []) {
            const sm = x as THREE.MeshStandardMaterial
            if (!sm.isMeshStandardMaterial || seen.has(sm) || (sm.envMap && sm.envMap !== env)) continue
            seen.add(sm)
            roomEnv.push({ m: sm, base: sm.envMapIntensity })
          }
          for (const c of o.children) visit(c)
        }
        for (const kit of kits) visit(kit.group)
      }
      for (const r of roomEnv) {
        if (r.m.envMap !== env) {
          r.m.envMap = env
          r.m.needsUpdate = true
        }
        r.m.envMapIntensity = r.base * k
      }
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
