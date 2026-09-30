import * as THREE from 'three'

/*
 * VINYL KIT placement: poses that can't clip.
 *
 * Mike's rule: no sleeve (record, prop) may pass through a wall, a shelf, a
 * crate or another sleeve in any frame. A sleeve leaning back with a little
 * yaw swings one top corner toward the wall behind it; eyeballing the z puts
 * that corner through the brick. These helpers compute the pose from the
 * object's REAL bounds (every mesh under it, thickness included), so the
 * closest corner stops a set air gap in front of the surface and the foot
 * stands on the floor.
 *
 * All positions/planes are in the object's PARENT space. Put the object in
 * its parent (and set its scale) first; the pose is written to
 * object.position / object.quaternion (pass apply: false to only compute).
 *
 *   // a sleeve leaning on the brick (a wall plane z = wallZ facing +z)
 *   leanAgainst(sleeve, { wallZ: SET.wallZ, floorY: 0, x: -4.9, lean: 0.11, yaw: 0.06 })
 *   // any vertical surface: a plane whose normal points out of it, toward the sleeve
 *   leanAgainst(sleeve, { plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 3.2), at: new THREE.Vector3(3, 0, 0.4), lean: 0.08 })
 *   // an LP displayed face-out on a small steel ledge (ref4)
 *   const ledge = makeLedge({ width: 1.05 }); ledge.group.position.set(0, 1.9, colZ); parent.add(ledge.group)
 *   standOnLedge(sleeve, ledge.spec, { lean: 0.08 })
 *   // check any pose (e.g. a camera-facing sleeve near a shelf): > 0 is clear
 *   const gap = planeClearance(sleeve.group, worldPlane)
 */

/** anything with a group (Sleeve, Record, Turntable…) or a bare Object3D */
export type Placeable = THREE.Object3D | { group: THREE.Object3D }

const objOf = (p: Placeable): THREE.Object3D => ((p as { group?: THREE.Object3D }).group ?? (p as THREE.Object3D))

const _inv = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _bb = new THREE.Box3()

/**
 * The object's bounds in its OWN frame (unscaled local units): every mesh
 * underneath (a record half out of its sleeve counts), conservative (the
 * union of each part's box). Works for Sleeve.group, Record.group, any group.
 */
export function localBounds(p: Placeable, out = new THREE.Box3()): THREE.Box3 {
  const obj = objOf(p)
  obj.updateWorldMatrix(true, true)
  _inv.copy(obj.matrixWorld).invert()
  out.makeEmpty()
  obj.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    let box: THREE.Box3 | null
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const im = mesh as THREE.InstancedMesh
      if (!im.boundingBox) im.computeBoundingBox()
      box = im.boundingBox
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      box = mesh.geometry.boundingBox
    }
    if (!box || box.isEmpty()) return
    _bb.copy(box).applyMatrix4(_m.multiplyMatrices(_inv, mesh.matrixWorld))
    out.union(_bb)
  })
  return out
}

/** the 8 corners of a box */
function corners(b: THREE.Box3, out: THREE.Vector3[] = []): THREE.Vector3[] {
  for (let i = 0; i < 8; i++) {
    const v = out[i] ?? (out[i] = new THREE.Vector3())
    v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
  }
  return out
}

export interface LeanOpts {
  /** the surface behind: a wall plane z = wallZ facing +z (parent space; the default wall orientation) … */
  wallZ?: number
  /** … or any vertical-ish plane, its normal pointing OUT of the surface (toward the sleeve) */
  plane?: THREE.Plane
  /** top of the floor / bar / shelf the sleeve stands on (parent y, default 0) */
  floorY?: number
  /** where along the wall the foot stands (wallZ mode; default: the object's current x) */
  x?: number
  /** any mode: a floor point near where the sleeve should stand (it is slid along the plane's normal to the right distance) */
  at?: THREE.Vector3
  /** tip back from vertical, radians (default 0.1 ≈ 6°) */
  lean?: number
  /** turn about the vertical, radians (0 = square to the surface). The nearer corner is the one kept clear. */
  yaw?: number
  /** in-plane tilt, radians (a sleeve standing a little askew); the low corner stays on the floor */
  roll?: number
  /** air gap to the surface at the closest point, in KIT units (12" sleeve = 1): default 0.012 ≈ 4 mm */
  clearance?: number
  /** lift off the floor, kit units (default 0.001: no z-fighting with the floor) */
  floorGap?: number
  /** write the pose to the object (default true) */
  apply?: boolean
}

export interface LeanPose {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** the lean actually used (radians) */
  lean: number
  /** the gap left at the closest point to the surface (parent units) */
  gap: number
  /** how far the foot (the lowest corners) stands out from the surface (parent units) */
  foot: number
  /** the object's scale factor (parent units per local unit) */
  scale: number
}

const _c: THREE.Vector3[] = []
const _box = new THREE.Box3()
const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _n = new THREE.Vector3()
const _nh = new THREE.Vector3()

function surfaceOf(o: LeanOpts, out: THREE.Plane) {
  if (o.plane) return out.copy(o.plane).normalize()
  return out.set(_n.set(0, 0, 1), -(o.wallZ ?? 0))
}
const _pl = new THREE.Plane()

/** the pose for a given lean: returns gap-free geometry (position, quaternion, foot) */
function solve(obj: THREE.Object3D, box: THREE.Box3, o: LeanOpts, lean: number, out: LeanPose) {
  const plane = surfaceOf(o, _pl)
  const n = plane.normal
  _nh.set(n.x, 0, n.z)
  if (_nh.lengthSq() < 1e-6) throw new Error('[vinyl] leanAgainst: the surface must not be horizontal')
  _nh.normalize()
  const base = Math.atan2(_nh.x, _nh.z)
  _e.set(-lean, base + (o.yaw ?? 0), o.roll ?? 0, 'YXZ')
  _q.setFromEuler(_e)
  // parent-space scale of the object's own units (its local scale; a uniform scale is assumed)
  const s = obj.scale.x
  const cs = corners(box, _c)
  let minY = Infinity
  let minN = Infinity
  for (const c of cs) {
    _v.copy(c).multiply(obj.scale).applyQuaternion(_q)
    minY = Math.min(minY, _v.y)
    minN = Math.min(minN, n.dot(_v))
  }
  const floorY = o.floorY ?? 0
  const y = floorY + (o.floorGap ?? 0.001) * s - minY
  const P = out.position
  if (o.at) P.copy(o.at)
  else P.set(o.x ?? obj.position.x, 0, o.plane ? obj.position.z : (o.wallZ ?? 0))
  P.y = y
  // slide horizontally along the normal until the closest corner is `clearance` off the surface
  const target = -plane.constant + (o.clearance ?? 0.012) * s
  const d = (target - minN - n.dot(P)) / n.dot(_nh)
  P.addScaledVector(_nh, d)
  out.quaternion.copy(_q)
  out.lean = lean
  out.scale = s
  out.gap = n.dot(P) + minN + plane.constant
  // the foot: the lowest corners' distance from the surface
  let foot = -Infinity
  for (const c of cs) {
    _v.copy(c).multiply(obj.scale).applyQuaternion(_q)
    if (_v.y < minY + 0.02 * s) foot = Math.max(foot, n.dot(_v) + n.dot(P) + plane.constant)
  }
  out.foot = foot
  return out
}

function applyPose(obj: THREE.Object3D, p: LeanPose) {
  obj.position.copy(p.position)
  obj.quaternion.copy(p.quaternion)
  if (!obj.matrixAutoUpdate) obj.updateMatrix()
  obj.updateMatrixWorld(true)
}

/**
 * Lean a sleeve (record, board, any object) back against a surface: its
 * foot on the floor, tipped back by `lean`, turned by `yaw`, and slid so its
 * nearest corner stops `clearance` in front of the surface — never through
 * it. The whole object counts (thickness and anything parented to it).
 *
 *   leanAgainst(sleeve, { wallZ: -2.4, floorY: 0, x: -1.2, lean: 0.1, yaw: 0.12 })
 */
export function leanAgainst(p: Placeable, o: LeanOpts = {}): LeanPose {
  const obj = objOf(p)
  const box = localBounds(obj, _box)
  const pose: LeanPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), lean: 0, gap: 0, foot: 0, scale: 1 }
  solve(obj, box, o, o.lean ?? 0.1, pose)
  if (o.apply !== false) applyPose(obj, pose)
  return pose
}

/** A ledge: a shelf lip a sleeve can stand on, leaning back on the surface behind it. */
export interface LedgeSpec {
  /** top of the ledge's shelf (parent y) */
  y: number
  /** the surface behind (column, wall): z = backZ facing +z, or a plane (normal toward the sleeve) */
  backZ?: number
  plane?: THREE.Plane
  /** shelf depth out from the surface (parent units) */
  depth: number
  /** thickness of a front lip (the foot must stand behind it); 0 = none */
  lip?: number
  /** centre along the surface (x in backZ mode) */
  x?: number
  /** a point on the ledge (plane mode) */
  at?: THREE.Vector3
}

/**
 * Stand a sleeve on a ledge (ref4: an LP face-out on a small black steel
 * ledge on the walnut column), leaning back on the surface behind. If the
 * requested lean would put the foot past the shelf (or over its lip), the
 * lean is reduced until the foot fits — the sleeve stands more upright.
 *
 *   standOnLedge(sleeve, ledge.spec, { lean: 0.09, yaw: 0.04 })
 */
export function standOnLedge(
  p: Placeable,
  ledge: LedgeSpec,
  o: Omit<LeanOpts, 'wallZ' | 'plane' | 'floorY' | 'x' | 'at'> = {},
): LeanPose & { fits: boolean } {
  const obj = objOf(p)
  const box = localBounds(obj, _box)
  const lo: LeanOpts = { ...o, wallZ: ledge.backZ, plane: ledge.plane, floorY: ledge.y, x: ledge.x, at: ledge.at }
  const pose: LeanPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), lean: 0, gap: 0, foot: 0, scale: 1 }
  const room = ledge.depth - (ledge.lip ?? 0) - (o.clearance ?? 0.012) * obj.scale.x
  let lean = o.lean ?? 0.1
  solve(obj, box, lo, lean, pose)
  let fits = pose.foot <= room
  if (!fits) {
    // bisect toward upright until the foot lands on the shelf
    let a = 0
    let b = lean
    for (let i = 0; i < 28; i++) {
      const mid = (a + b) / 2
      solve(obj, box, lo, mid, pose)
      if (pose.foot <= room) a = mid
      else b = mid
    }
    lean = a
    solve(obj, box, lo, lean, pose)
    fits = pose.foot <= room + 1e-6
    if (!fits) console.warn('[vinyl] standOnLedge: the ledge is too shallow for this sleeve, even upright')
  }
  if (o.apply !== false) applyPose(obj, pose)
  return Object.assign(pose, { fits })
}

const _w = new THREE.Vector3()
/**
 * Signed clearance (world units) between an object's bounds and a WORLD
 * plane: > 0 clear on the normal's side, < 0 = that far through. Use it to
 * verify any pose (camera-facing sleeves near shelves, a record on a stand).
 */
export function planeClearance(p: Placeable, plane: THREE.Plane): number {
  const obj = objOf(p)
  const box = localBounds(obj, _box)
  let min = Infinity
  for (const c of corners(box, _c)) min = Math.min(min, plane.distanceToPoint(_w.copy(c).applyMatrix4(obj.matrixWorld)))
  return min
}

export interface Ledge {
  /** the steel ledge: shelf top at local y = 0, back edge at local z = 0 (against the surface), lip toward +z */
  group: THREE.Group
  /** the ledge in the group's PARENT space, for standOnLedge — call update() after moving/turning the group */
  spec: LedgeSpec
  /** recompute spec from the group's position and yaw */
  update(): LedgeSpec
  dispose(): void
}

/**
 * A small display ledge in black powder-coated steel (ref4): a thin shelf
 * with a short front lip, a record's width. Local: shelf top at y = 0, back
 * edge at z = 0 (against the wall), lip toward +z. Position the group on the
 * surface (turned to face out), then standOnLedge(sleeve, ledge.update()).
 */
export function makeLedge({ width = 1.02, depth = 0.13, lip = 0.05, t = 0.008, color = '#161413' as THREE.ColorRepresentation } = {}): Ledge {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.55 })
  const shelf = new THREE.BoxGeometry(width, t, depth)
  shelf.translate(0, -t / 2, depth / 2)
  const front = new THREE.BoxGeometry(width, lip, t)
  front.translate(0, -t + lip / 2, depth - t / 2)
  const m1 = new THREE.Mesh(shelf, mat)
  const m2 = new THREE.Mesh(front, mat)
  for (const m of [m1, m2]) {
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }
  const spec: LedgeSpec = { y: 0, depth, lip: t, plane: new THREE.Plane(), at: new THREE.Vector3() }
  const nrm = new THREE.Vector3()
  const update = () => {
    nrm.set(0, 0, 1).applyQuaternion(group.quaternion)
    spec.plane!.setFromNormalAndCoplanarPoint(nrm, group.position)
    spec.at!.copy(group.position)
    spec.y = group.position.y
    return spec
  }
  update()
  return {
    group,
    spec,
    update,
    dispose() {
      shelf.dispose()
      front.dispose()
      mat.dispose()
    },
  }
}
