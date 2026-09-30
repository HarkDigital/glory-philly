import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeBarTop, makeBrickWall, makeDripTray, makeFaucet, stainless, woodMaps } from '../../kit/bar'
import { BRAND } from '../../content'
import { catNo, coverTexture, drawRoundel, makeRecord, makeSleeve, makeTurntable, onFonts, type Record, type Sleeve, type Turntable } from '../../kit/vinyl'

/*
 * HERO SET — Glory after dark, 126 Chestnut Street: the oiled bar, a
 * stainless tap column with one faucet over a drip tray, the red-G coaster,
 * and behind it the exposed brick wall with the tall black-framed windows
 * onto Chestnut Street (the street glows through them: it's what the beer
 * glows against).
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
  wallZ: -5.2,
}

/**
 * THE DECK — a walnut turntable (src/kit/vinyl) on the back bar, LEFT of the
 * tap column, spinning a red-label Glory record; a sleeve leans on the brick
 * behind it. Real size against the glass: the tulip is 2.42 units (~18 cm),
 * so 1 unit ≈ 7.4 cm and the kit's unit (a 12" sleeve, 31.5 cm) is ×4.26.
 */
export const DECK_ANCHOR = {
  position: new THREE.Vector3(-2.85, 0, -1.95),
  rotationY: 0.2,
  scale: 31.5 / 7.4,
  cmPerUnit: 7.4,
}

/** a tiny canvas of Chestnut Street at dusk, seen through old glass (the low resolution is the blur) */
function streetTexture(): THREE.CanvasTexture {
  const w = 96
  const h = 160
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  let seed = 29
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  // dusk sky over the rooftops across the street
  const sky = g.createLinearGradient(0, 0, 0, h * 0.3)
  sky.addColorStop(0, '#1d2740')
  sky.addColorStop(1, '#4a5a7c')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  // the brick facade across Chestnut: warm red-brown, lit windows
  g.fillStyle = '#4a2519'
  g.fillRect(0, h * 0.14, w, h * 0.62)
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 5; col++) {
      const x = 4 + col * 19
      const y = h * 0.18 + row * 22
      const lit = rnd()
      g.fillStyle = lit > 0.68 ? `rgba(255,${170 + Math.round(rnd() * 40)},${90 + Math.round(rnd() * 40)},${0.55 + rnd() * 0.4})` : 'rgba(30,26,34,0.9)'
      g.fillRect(x, y, 10, 15)
    }
  // street level: shopfront glow, a street lamp, parked cars
  const shop = g.createLinearGradient(0, h * 0.62, 0, h * 0.78)
  shop.addColorStop(0, 'rgba(255,190,110,0.0)')
  shop.addColorStop(1, 'rgba(255,190,110,0.55)')
  g.fillStyle = shop
  g.fillRect(0, h * 0.62, w, h * 0.16)
  g.fillStyle = '#16121a'
  g.fillRect(0, h * 0.76, w, h * 0.24)
  const lamp = g.createRadialGradient(w * 0.7, h * 0.46, 0, w * 0.7, h * 0.46, 26)
  lamp.addColorStop(0, 'rgba(255,214,150,1)')
  lamp.addColorStop(0.25, 'rgba(255,170,80,0.5)')
  lamp.addColorStop(1, 'rgba(255,170,80,0)')
  g.fillStyle = lamp
  g.fillRect(0, 0, w, h)
  // cars: a pale one and an orange one (the photo), tail lights
  g.fillStyle = 'rgba(200,200,210,0.75)'
  g.fillRect(w * 0.52, h * 0.79, w * 0.46, h * 0.06)
  g.fillStyle = 'rgba(210,110,60,0.8)'
  g.fillRect(w * 0.02, h * 0.8, w * 0.34, h * 0.055)
  g.fillStyle = 'rgba(255,40,30,0.9)'
  g.fillRect(w * 0.33, h * 0.815, 3, 2)
  // the railing
  g.fillStyle = 'rgba(8,6,8,0.9)'
  for (let x = 0; x < w; x += 3) g.fillRect(x, h * 0.86, 1, h * 0.08)
  g.fillRect(0, h * 0.86, w, 1.5)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A cream coaster printed with the red-ring "G" roundel (the site icon), drawn crisp. */
function roundelCoaster(): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; tex: THREE.CanvasTexture } {
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
  return { mesh, mat, tex }
}

export interface HeroSet {
  group: THREE.Group
  /** the turntable's anchor (DECK_ANCHOR) */
  deck: THREE.Group
  tt: Turntable
  record: Record
  sleeve: Sleeve
  faucet: ReturnType<typeof makeFaucet>
  coaster: THREE.Mesh
  wash: THREE.SpotLight
  windowMat: THREE.MeshBasicMaterial
  dispose(): void
}

export function buildSet(mobile: boolean): HeroSet {
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []

  // THE BAR: a long oiled top and a dark panelled front
  // the top runs back to the brick (the deck and a sleeve stand at the back)
  const barBack = SET.wallZ + 0.02
  const bar = makeBarTop({ length: 22, depth: 1.7 - barBack, thickness: 0.14 })
  bar.position.set(1, 0, (1.7 + barBack) / 2)
  group.add(bar)
  const { map } = woodMaps()
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(22, 3.6, 0.2),
    new THREE.MeshStandardMaterial({ map, color: '#5a3a28', roughness: 0.6 }),
  )
  front.position.set(1, -1.94, 1.62)
  front.receiveShadow = true
  group.add(front)
  // a brass foot rail's worth of glint along the front edge of the top
  const nosing = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 22, 16, 1), new THREE.MeshPhysicalMaterial({ map, color: '#7a4a2c', roughness: 0.35, clearcoat: 0.6 }))
  nosing.rotation.z = Math.PI / 2
  nosing.position.set(1, -0.07, 1.72)
  group.add(nosing)

  // THE TAP COLUMN: brushed stainless, one faucet facing the room
  const steel = stainless({ roughness: 0.3, color: '#767b80' })
  disposables.push(steel)
  const colH = SET.faucetY + 0.55
  const column = new THREE.Mesh(new THREE.CylinderGeometry(SET.towerR, SET.towerR * 1.12, colH, 48), steel)
  column.position.set(SET.tower.x, colH / 2, SET.tower.z)
  column.castShadow = true
  column.receiveShadow = true
  group.add(column)
  const capGeo = new THREE.SphereGeometry(SET.towerR, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)
  const cap = new THREE.Mesh(capGeo, steel)
  cap.position.set(SET.tower.x, colH, SET.tower.z)
  group.add(cap)
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(SET.towerR * 1.6, SET.towerR * 1.7, 0.08, 48), steel)
  foot.position.set(SET.tower.x, 0.04, SET.tower.z)
  group.add(foot)
  const faucet = makeFaucet({ scale: SET.glassScale })
  faucet.group.position.set(SET.tower.x, SET.faucetY, SET.tower.z + SET.towerR - 0.02)
  group.add(faucet.group)
  disposables.push(faucet)
  const tray = makeDripTray(1.7, 1.0)
  tray.position.set(SET.pour.x, SET.pour.y, SET.pour.z + 0.05)
  group.add(tray)

  // THE COASTER
  const { mesh: coaster } = roundelCoaster()
  coaster.position.copy(SET.coaster)
  coaster.rotation.y = -0.35
  group.add(coaster)

  // the windows: two tall black-framed sashes, 3 × 6 panes each
  const winX = [1.6, 4.9]
  const winW = 2.7
  const winY0 = 0.7
  const winH = 6.2
  const street = streetTexture()
  const windowMat = new THREE.MeshBasicMaterial({ map: street, color: new THREE.Color(1, 1, 1).multiplyScalar(0.62), toneMapped: true, fog: false })
  const frameGeos: THREE.BufferGeometry[] = []
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.BoxGeometry(w, h, d)
    b.translate(x, y, z)
    frameGeos.push(b)
  }
  for (const cx of winX) {
    const glazing = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), windowMat)
    glazing.position.set(cx, winY0 + winH / 2, SET.wallZ - 0.12)
    group.add(glazing)
    // deep reveal + heavy frame (black paint), mullions
    const z = SET.wallZ + 0.03
    box(winW + 0.5, 0.26, 0.3, cx, winY0 - 0.08, z)
    box(winW + 0.5, 0.3, 0.3, cx, winY0 + winH + 0.1, z)
    box(0.26, winH + 0.5, 0.3, cx - winW / 2 - 0.08, winY0 + winH / 2, z)
    box(0.26, winH + 0.5, 0.3, cx + winW / 2 + 0.08, winY0 + winH / 2, z)
    for (let i = 1; i < 3; i++) box(0.06, winH, 0.08, cx - winW / 2 + (winW * i) / 3, winY0 + winH / 2, SET.wallZ - 0.06)
    for (let j = 1; j < 6; j++) box(winW, j === 3 ? 0.16 : 0.06, j === 3 ? 0.14 : 0.08, cx, winY0 + (winH * j) / 6, SET.wallZ - 0.06)
  }
  // the dark pier between/around the windows (the photo's black-painted wood)
  box(0.9, winH + 1.2, 0.2, (winX[0] + winX[1]) / 2, winY0 + winH / 2, SET.wallZ - 0.02)
  const frameMat = new THREE.MeshStandardMaterial({ color: '#0b0908', roughness: 0.55, envMapIntensity: 0.6 })
  const frames = new THREE.Mesh(mergeGeometries(frameGeos), frameMat)
  frames.receiveShadow = true
  group.add(frames)
  for (const g of frameGeos) g.dispose()
  // the brick, in panels around the window openings (UVs from world x/y so
  // the courses run straight through)
  const panel = (x0: number, x1: number, y0: number, y1: number) => {
    const m = makeBrickWall(x1 - x0, y1 - y0, { bump: 1.1, tint: '#b99a8a' })
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const pos = m.geometry.attributes.position as THREE.BufferAttribute
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + cx) / 2.4, (pos.getY(i) + cy) / 2.4)
    m.position.set(cx, cy, SET.wallZ)
    group.add(m)
  }
  const ox0 = winX[0] - winW / 2 - 0.2
  const ox1 = winX[1] + winW / 2 + 0.2
  panel(-22, ox0, -5, 11.5)
  panel(ox1, 16, -5, 11.5)
  panel(ox0, ox1, winY0 + winH + 0.2, 11.5)
  panel(ox0, ox1, -5, winY0 - 0.2)

  // a warm grazing wash down the brick (a sconce above the frame): no shadows
  const wash = new THREE.SpotLight('#ffb070', 0, 18, 0.7, 0.9, 1.4)
  wash.position.set(-3.5, 9.5, SET.wallZ + 1.6)
  wash.target.position.set(-3, 1.5, SET.wallZ)
  group.add(wash, wash.target)

  // THE DECK: a walnut turntable spinning the red-label Glory record
  const deck = new THREE.Group()
  deck.name = 'hero-deck'
  deck.position.copy(DECK_ANCHOR.position)
  deck.rotation.y = DECK_ANCHOR.rotationY
  deck.scale.setScalar(DECK_ANCHOR.scale)
  group.add(deck)
  const tt = makeTurntable({ finish: 'walnut' })
  const record = makeRecord({ label: { title: 'This Must Be the Place', sub: BRAND.name, side: 'SIDE A', cat: catNo(1), paper: 'red' } })
  tt.setRecord(record)
  deck.add(tt.group)
  disposables.push(tt)
  // its sleeve, leaning on the brick behind (the wall sign photo, the house cover)
  const sleeve = makeSleeve({
    front: coverTexture({ title: BRAND.short, sub: BRAND.motto, kicker: 'Glory Records', cat: catNo(1), photoUrl: 'photos/wall-sign.webp', focus: [0.3, 0.3] }),
  })
  sleeve.group.scale.setScalar(DECK_ANCHOR.scale)
  sleeve.group.position.set(-4.9, 0, SET.wallZ + 0.5)
  sleeve.group.rotation.set(-0.11, 0.06, 0)
  group.add(sleeve.group)

  void mobile
  return {
    group,
    deck,
    tt,
    record,
    sleeve,
    faucet,
    coaster,
    wash,
    windowMat,
    dispose() {
      for (const d of disposables) d.dispose()
      street.dispose()
      windowMat.dispose()
      frameMat.dispose()
      frames.geometry.dispose()
    },
  }
}
