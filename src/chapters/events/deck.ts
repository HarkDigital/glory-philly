import * as THREE from 'three'
import { woodMaps } from '../../kit/bar'
import { catNo, coverTexture, makeRecord, makeSleeve, makeTurntable, type Sleeve, type Turntable, type VinylFrame } from '../../kit/vinyl'
import { BRAND, EVENTS, SECTIONS } from '../../content'

/*
 * THE PARTY'S RECORD: a black-satin sideboard across the head of the banquet
 * table with a black-finish deck playing a Glory record at 33⅓ (arm down),
 * a few Glory sleeves leaning in a little wooden rack beside it — and the
 * photo "album": an open gatefold LP lying on the table, the prints stacked on
 * its right panel and laid onto its left one.
 *
 * Units: the table's (1 ≈ 10 in); the vinyl kit is 1 ≈ 12.4 in, so every kit
 * part is scaled by K.
 */

export const K = 1.24

export const CONSOLE = {
  /** centre x, z of the sideboard; its top is at y = top (the table top is 0) */
  x: 1.3,
  z: 4.55,
  w: 3.5,
  d: 1.2,
  top: 0.36,
}

/** the open gatefold on the table: its spine x, the panels' centre z */
export const GATEFOLD = { spine: 0.0, z: 1.7, t: 0.014 * K }

export interface Deck {
  group: THREE.Group
  tt: Turntable
  /** a point on the record for cameras (world) */
  focus: THREE.Vector3
  update(frame: VinylFrame): void
}

export function makeDeck(mobile: boolean): Deck {
  const group = new THREE.Group()
  const res = mobile ? 512 : 1024
  const small = mobile ? 384 : 512

  // ---- the sideboard: an oiled top on a black satin body
  const { map, roughnessMap } = woodMaps()
  const topGeo = new THREE.BoxGeometry(CONSOLE.w + 0.08, 0.08, CONSOLE.d + 0.06)
  const uv = topGeo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (CONSOLE.w / 3.2), uv.getY(i) * (CONSOLE.d / 0.8))
  const top = new THREE.Mesh(
    topGeo,
    new THREE.MeshPhysicalMaterial({ map, roughnessMap, color: '#8a6a58', roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.2 }),
  )
  top.position.set(CONSOLE.x, CONSOLE.top - 0.04, CONSOLE.z)
  top.receiveShadow = true
  const bodyH = 3.0
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(CONSOLE.w, bodyH, CONSOLE.d),
    new THREE.MeshStandardMaterial({ color: '#16110f', roughness: 0.42, metalness: 0.1 }),
  )
  body.position.set(CONSOLE.x, CONSOLE.top - 0.08 - bodyH / 2, CONSOLE.z)
  body.receiveShadow = true
  // door seams + brass pulls on the face toward the camera (+z)
  const seamMat = new THREE.MeshBasicMaterial({ color: '#050303' })
  const pullMat = new THREE.MeshStandardMaterial({ color: '#c89a52', metalness: 1, roughness: 0.3 })
  for (let i = 1; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, bodyH - 0.2, 0.004), seamMat)
    s.position.set(CONSOLE.x - CONSOLE.w / 2 + (CONSOLE.w * i) / 3, body.position.y, CONSOLE.z + CONSOLE.d / 2 + 0.002)
    group.add(s)
  }
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 10), pullMat)
    p.position.set(CONSOLE.x - CONSOLE.w / 2 + (CONSOLE.w * (i + 0.5)) / 3 + (i === 1 ? 0 : i === 0 ? 0.42 : -0.42), CONSOLE.top - 0.42, CONSOLE.z + CONSOLE.d / 2 + 0.03)
    group.add(p)
  }
  group.add(top, body)

  // ---- the deck: black finish, a Glory record, playing
  const tt = makeTurntable({ finish: 'black' })
  tt.group.scale.setScalar(K)
  tt.group.position.set(CONSOLE.x - 0.45, CONSOLE.top, CONSOLE.z + 0.02)
  tt.group.rotation.y = -0.18
  const rec = makeRecord({
    label: { title: 'The Back Room', sub: EVENTS.title, side: 'SIDE A', cat: catNo(6), paper: 'red' },
    segments: mobile ? 96 : 128,
  })
  tt.setRecord(rec)
  tt.setSpeed(33.333, true)
  tt.setArm(1)
  tt.setCue(0)
  group.add(tt.group)

  // ---- a little oak rack of sleeves leaning back beside the deck
  const rack = new THREE.Group()
  rack.position.set(CONSOLE.x + 1.22, CONSOLE.top, CONSOLE.z - 0.22)
  rack.rotation.y = -0.5
  const rackMat = new THREE.MeshPhysicalMaterial({ map, roughnessMap, color: '#b08a6a', roughness: 0.5, clearcoat: 0.3 })
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.09, 0.44), rackMat)
  base.position.set(0, 0.045, 0.04)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.32, 0.04), rackMat)
  back.position.set(0, 0.16, -0.2)
  back.rotation.x = -0.36
  rack.add(base, back)
  const covers = [
    coverTexture({ title: BRAND.motto.replace(/\.$/, ''), kicker: BRAND.name, cat: catNo(1), paper: 'stout' }, small),
    coverTexture({ title: SECTIONS.kitchen.title, kicker: SECTIONS.kitchen.eyebrow, cat: catNo(3), paper: 'amber' }, small),
    coverTexture({ title: 'The Back Room', kicker: SECTIONS.events.eyebrow, sub: EVENTS.title, cat: catNo(6), paper: 'red' }, small),
  ]
  const sleeves: Sleeve[] = covers.map((front, i) => {
    const s = makeSleeve({ front, ink: i === 0, wear: 0.8, seed: 11 + i })
    s.group.scale.setScalar(K * 0.9)
    // stood in the rack, leaning back, fanned a little
    s.group.position.set((i - 1) * 0.012, 0.03, 0.2 - i * 0.12)
    s.group.rotation.set(-0.36, (i - 1) * 0.05, (i - 1) * -0.02)
    rack.add(s.group)
    return s
  })
  void sleeves
  group.add(rack)

  // ---- the album: an open gatefold on the table under the prints
  const inner = [
    coverTexture({ title: SECTIONS.events.title, kicker: SECTIONS.events.eyebrow, cat: catNo(6), paper: 'stout' }, res),
    coverTexture({ title: 'The Back Room', kicker: BRAND.name, sub: EVENTS.body[0], cat: catNo(6), paper: 'cream' }, res),
  ]
  for (let i = 0; i < 2; i++) {
    const s = makeSleeve({ front: inner[i], ink: i === 0, wear: 0.6, gloss: 0.5, seed: 31 + i })
    s.group.scale.setScalar(K)
    s.group.rotation.x = -Math.PI / 2
    // pivot = the panel's bottom edge; lying flat the panel runs from it toward -z
    const cx = GATEFOLD.spine + (i === 0 ? -K / 2 : K / 2) + (i === 0 ? -0.004 : 0.004)
    s.group.position.set(cx, GATEFOLD.t / 2, GATEFOLD.z + K / 2)
    group.add(s.group)
  }

  const focus = new THREE.Vector3()
  const upd = { dt: 0, still: false }
  return {
    group,
    tt,
    focus: focus.set(tt.group.position.x, CONSOLE.top + 0.35, tt.group.position.z),
    update(frame) {
      upd.dt = frame.dt
      upd.still = !!frame.still
      tt.update(upd)
    },
  }
}
