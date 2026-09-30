import * as THREE from 'three'
import { woodMaps } from '../../kit/bar'
import { catNo, coverTexture, leanAgainst, localBounds, makeRecord, makeSleeve, makeTurntable, type Sleeve, type Turntable, type VinylFrame } from '../../kit/vinyl'
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

/** the sleeve rack beside the deck (on the sideboard): centre, yaw, base size, the sleeves' lean */
export const RACK = { x: CONSOLE.x + 1.08, z: CONSOLE.z - 0.05, yaw: -0.5, w: 1.18, d: 0.36, z0: -0.3, lean: 0.34 }

/** the open gatefold on the table: its spine x, the panels' centre z */
export const GATEFOLD = { spine: 0.0, z: 1.7, t: 0.014 * K }

export interface Deck {
  group: THREE.Group
  tt: Turntable
  /** a point on the record for cameras (world) */
  focus: THREE.Vector3
  /** the rack's sleeves and its parts (clip checks) */
  rack: { group: THREE.Group; sleeves: Sleeve[]; parts: THREE.Mesh[] }
  update(frame: VinylFrame): void
}

export function makeDeck(mobile: boolean): Deck {
  const group = new THREE.Group()
  const rackSleeves: Sleeve[] = []
  const rackParts: THREE.Mesh[] = []
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
  const bodyH = CONSOLE.top - 0.08 + 3
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

  // ---- a little walnut rack of sleeves leaning back beside the deck. Each
  // sleeve is POSED from its real bounds (kit/vinyl leanAgainst): the rear one
  // on the rack's back board, each next one on the front face of the one
  // behind it; feet on the base, behind its lip; nothing touches.
  const rack = new THREE.Group()
  rack.position.set(RACK.x, CONSOLE.top, RACK.z)
  rack.rotation.y = RACK.yaw
  rack.userData.rack = true
  group.add(rack)
  const rackMat = new THREE.MeshPhysicalMaterial({ map, roughnessMap, color: '#9a6e50', roughness: 0.9, clearcoat: 0.2 })
  const baseTop = 0.09
  const base = new THREE.Mesh(new THREE.BoxGeometry(RACK.w, baseTop, RACK.d), rackMat)
  base.position.set(0, baseTop / 2, RACK.z0 + RACK.d / 2)
  // the front lip the feet stand behind
  const lip = new THREE.Mesh(new THREE.BoxGeometry(RACK.w, 0.05, 0.035), rackMat)
  lip.position.set(0, baseTop + 0.025, RACK.z0 + RACK.d - 0.0175)
  // the back board, leaning back
  const backT = 0.04
  const back = new THREE.Mesh(new THREE.BoxGeometry(RACK.w, 0.42, backT), rackMat)
  back.rotation.x = -RACK.lean
  back.position.set(0, baseTop + 0.2 * Math.cos(RACK.lean) - 0.02, RACK.z0 + 0.06 - 0.2 * Math.sin(RACK.lean))
  for (const m of [base, lip, back]) {
    m.castShadow = true
    m.receiveShadow = true
  }
  rack.add(base, lip, back)
  rack.updateMatrixWorld(true)
  const covers = [
    coverTexture({ title: 'The Back Room', kicker: SECTIONS.events.eyebrow, sub: EVENTS.title, cat: catNo(6), paper: 'red' }, small),
    coverTexture({ title: SECTIONS.kitchen.title, kicker: SECTIONS.kitchen.eyebrow, cat: catNo(3), paper: 'amber' }, small),
    coverTexture({ title: BRAND.motto.replace(/\.$/, ''), kicker: BRAND.name, cat: catNo(1), paper: 'stout' }, small),
  ]
  // the back board's front face (rack space), normal toward the sleeves
  const nrm = new THREE.Vector3(0, 0, 1).applyEuler(back.rotation)
  let surface = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, back.position.clone().addScaledVector(nrm, backT / 2))
  const sleeves: Sleeve[] = covers.map((front, i) => {
    // back → front: red, amber, then the stout motto sleeve in front
    const s = makeSleeve({ front, ink: i === 2, wear: 0.8, seed: 11 + i })
    s.group.scale.setScalar(K * 0.9)
    rack.add(s.group)
    leanAgainst(s, {
      plane: surface,
      at: new THREE.Vector3([0.07, -0.06, 0.0][i], baseTop, 0),
      floorY: baseTop,
      lean: RACK.lean,
      yaw: [0.035, -0.03, 0.012][i],
      clearance: 0.01,
    })
    // the next one leans on this one's front face
    const b = localBounds(s)
    const fn = new THREE.Vector3(0, 0, 1).applyQuaternion(s.group.quaternion)
    const fp = new THREE.Vector3(0, 0, b.max.z).applyMatrix4(s.group.matrix)
    surface = new THREE.Plane().setFromNormalAndCoplanarPoint(fn, fp)
    return s
  })
  rackSleeves.push(...sleeves)
  rackParts.push(base, lip, back)
  // ?audit: prove the poses (rack units; > 0 = clear)
  if (typeof location !== 'undefined' && /[?&]audit\b/.test(location.search)) {
    rack.updateMatrixWorld(true)
    const inv = new THREE.Matrix4().copy(rack.matrixWorld).invert()
    const pts = (o: THREE.Object3D) => {
      const b = localBounds(o)
      const out: THREE.Vector3[] = []
      for (let i = 0; i < 8; i++) out.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld).applyMatrix4(inv))
      return out
    }
    const minTo = (o: THREE.Object3D, pl: THREE.Plane) => Math.min(...pts(o).map(p => pl.distanceToPoint(p)))
    const backPl = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, back.position.clone().addScaledVector(nrm, backT / 2))
    const lipPl = new THREE.Plane(new THREE.Vector3(0, 0, -1), lip.position.z - 0.0175)
    const rows = sleeves.map((sl, i) => {
      const prev = i === 0 ? backPl : (() => {
        const p = sleeves[i - 1].group
        const b = localBounds(p)
        return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion), new THREE.Vector3(0, 0, b.max.z).applyMatrix4(p.matrix))
      })()
      const ys = pts(sl.group).map(p => p.y)
      return { i, behind: +minTo(sl.group, prev).toFixed(4), vsBackBoard: +minTo(sl.group, backPl).toFixed(4), footOverBase: +(Math.min(...ys) - baseTop).toFixed(4), behindLip: +minTo(sl.group, lipPl).toFixed(4) }
    })
    console.log('[events] rack audit ' + JSON.stringify(rows))
  }

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
    rack: { group: group.children.find(c => c.userData.rack) as THREE.Group, sleeves: rackSleeves, parts: rackParts },
    focus: focus.set(tt.group.position.x, CONSOLE.top + 0.35, tt.group.position.z),
    update(frame) {
      upd.dt = frame.dt
      upd.still = !!frame.still
      tt.update(upd)
    },
  }
}
