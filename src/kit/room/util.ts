import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { PLANK_STRETCH } from './gen'

/*
 * ROOM KIT internals: seeded randomness, value noise, canvas helpers and the
 * RoomBuilder (every piece is posed into one builder, which merges static
 * parts per material and instances repeats — a whole back bar is ~30 draws).
 */

// ─── randomness + noise (DOM-free, in noise.ts: the texture worker shares it) ──

export { rng, hash2, vnoise, fbm, noise1, clamp, lerp, smoothstep } from './noise'
export type { Rng } from './noise'

// ─── canvases ───────────────────────────────────────────────────────────────

export function canvas(w: number, h = w) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return { cv, g: cv.getContext('2d', { willReadFrequently: false })! }
}

/**
 * A texture from a canvas. `free`: release the canvas's RAM after the GPU
 * upload (only for textures that never redraw).
 */
export function texFrom(cv: HTMLCanvasElement, { srgb = true, repeat = true, aniso = 8, free = true } = {}) {
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = aniso
  if (free) {
    t.onUpdate = () => {
      cv.width = cv.height = 1
      t.onUpdate = null
    }
  }
  return t
}

// ─── geometry helpers ───────────────────────────────────────────────────────

const KEEP = new Set(['position', 'normal', 'uv'])
/** non-indexed, exactly position/normal/uv (so any parts merge) */
export function normalizeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g.clone()
  for (const k of Object.keys(out.attributes)) if (!KEEP.has(k)) out.deleteAttribute(k)
  if (!out.attributes.normal) out.computeVertexNormals()
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2))
  out.morphAttributes = {}
  out.clearGroups()
  if (out === g) out = g.clone()
  return out
}

/** scale a geometry's uv attribute in place (and optionally swap u/v: boards turned 90°) */
export function scaleUv(g: THREE.BufferGeometry, su: number, sv: number, ou = 0, ov = 0, swap = false) {
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    if (swap) uv.setXY(i, v * su + ou, u * sv + ov)
    else uv.setXY(i, u * su + ou, v * sv + ov)
  }
  uv.needsUpdate = true
  return g
}

/**
 * The walnut map is stretched 2 : 1 — one tile covers `tile` metres ACROSS
 * the boards and `tile × PLANK_STRETCH` ALONG them — so boards run long (1–2.3
 * m between butt joints at the default 1.2 m tile, as on the real walls) and
 * the grain repeats half as often, at the same 1024² cost.
 */
export { PLANK_STRETCH }

/**
 * A box whose UVs are in METRES of the face (so a plank texture tiles at real
 * scale on every face), base on y = 0 when `base`. `tile` = metres per texture
 * repeat across the boards (× PLANK_STRETCH along them). `vertical`: the grain
 * runs up the ±z/±x faces (vertical boards).
 */
export function plankBox(w: number, h: number, d: number, { tile = 1.2, vertical = false, ou = 0, ov = 0, base = false } = {}) {
  const g = new THREE.BoxGeometry(w, h, d)
  if (base) g.translate(0, h / 2, 0)
  const pos = g.attributes.position as THREE.BufferAttribute
  const nrm = g.attributes.normal as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = Math.abs(nrm.getX(i))
    const ny = Math.abs(nrm.getY(i))
    let a: number
    let b: number
    if (ny > 0.5) {
      // top/bottom: grain along the longer horizontal side
      a = w >= d ? x : z
      b = w >= d ? z : x
    } else if (nx > 0.5) {
      a = z
      b = y
    } else {
      a = x
      b = y
    }
    const along = tile * PLANK_STRETCH
    if (vertical && ny < 0.5) uv.setXY(i, b / along + ou, a / tile + ov)
    else uv.setXY(i, a / along + ou, b / tile + ov)
  }
  return g
}

// ─── the builder ────────────────────────────────────────────────────────────

interface MergeBucket {
  geos: THREE.BufferGeometry[]
  cast: boolean
  receive: boolean
  order: number
}
interface InstBucket {
  geo: THREE.BufferGeometry
  mat: THREE.Material
  mats: THREE.Matrix4[]
  colors: (THREE.Color | null)[]
  attrs: Record<string, { size: number; data: number[] }>
  cast: boolean
  receive: boolean
  order: number
}

export interface Built {
  meshes: THREE.Mesh[]
  dispose(): void
}

/**
 * Pose parts with a matrix stack, then build(): one merged mesh per material,
 * one InstancedMesh per instance key. Geometries handed to merge() are
 * consumed (cloned, transformed, disposed); instance geometries are owned by
 * the builder unless `shared`.
 */
export class RoomBuilder {
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  private merges = new Map<THREE.Material, MergeBucket>()
  private insts = new Map<string, InstBucket>()
  /** objects added as-is (sleeves, lights…) */
  private objects: { o: THREE.Object3D; m: THREE.Matrix4 }[] = []
  private tmp = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpE = new THREE.Euler()
  private tmpS = new THREE.Vector3()
  private tmpP = new THREE.Vector3()

  /** the current transform */
  get m() {
    return this.stack[this.stack.length - 1]
  }
  /** push a local transform (translation, euler rotation 'YXZ', uniform/xyz scale) */
  push(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | THREE.Vector3 = 1) {
    this.stack.push(this.m.clone().multiply(this.compose(x, y, z, rx, ry, rz, s)))
    return this
  }
  pushMatrix(mat: THREE.Matrix4) {
    this.stack.push(this.m.clone().multiply(mat))
    return this
  }
  pop() {
    if (this.stack.length > 1) this.stack.pop()
    return this
  }
  /** a point in the current frame → builder (root) space */
  at(x: number, y: number, z: number, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.m)
  }
  compose(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | THREE.Vector3 = 1, out = new THREE.Matrix4()) {
    this.tmpE.set(rx, ry, rz, 'YXZ')
    this.tmpQ.setFromEuler(this.tmpE)
    if (typeof s === 'number') this.tmpS.set(s, s, s)
    else this.tmpS.copy(s)
    return out.compose(this.tmpP.set(x, y, z), this.tmpQ, this.tmpS)
  }

  /** merge a static part (consumes geo). `local`: an extra transform inside the current frame. */
  merge(geo: THREE.BufferGeometry, mat: THREE.Material, local?: THREE.Matrix4, { cast = false, receive = true, order = 0 } = {}) {
    const g = normalizeGeo(geo)
    geo.dispose()
    this.tmp.copy(this.m)
    if (local) this.tmp.multiply(local)
    g.applyMatrix4(this.tmp)
    let b = this.merges.get(mat)
    if (!b) this.merges.set(mat, (b = { geos: [], cast, receive, order }))
    b.cast ||= cast
    b.geos.push(g)
  }

  /**
   * add one instance under `key` (geometry + material are taken from the first
   * call). attrs: per-instance attributes (number or number[]).
   */
  instance(
    key: string,
    geo: () => THREE.BufferGeometry,
    mat: THREE.Material,
    local: THREE.Matrix4,
    { color, attrs, cast = false, receive = true, order = 0 }: { color?: THREE.ColorRepresentation; attrs?: Record<string, number | number[]>; cast?: boolean; receive?: boolean; order?: number } = {},
  ) {
    let b = this.insts.get(key)
    if (!b) this.insts.set(key, (b = { geo: geo(), mat, mats: [], colors: [], attrs: {}, cast, receive, order }))
    b.mats.push(this.m.clone().multiply(local))
    b.colors.push(color != null ? new THREE.Color(color) : null)
    if (attrs)
      for (const [k, v] of Object.entries(attrs)) {
        const arr = typeof v === 'number' ? [v] : v
        let a = b.attrs[k]
        if (!a) b.attrs[k] = a = { size: arr.length, data: [] }
        a.data.push(...arr)
      }
  }

  /** add a ready-made object (a vinyl sleeve, a light…) posed by the current frame × local */
  object(o: THREE.Object3D, local?: THREE.Matrix4) {
    const m = this.m.clone()
    // no explicit local pose: keep the object's own position/rotation/scale
    // (build() decomposes into them, so they'd be lost otherwise)
    if (local) m.multiply(local)
    else {
      o.updateMatrix()
      m.multiply(o.matrix)
    }
    this.objects.push({ o, m })
    return o
  }

  build(parent: THREE.Object3D): Built {
    const meshes: THREE.Mesh[] = []
    const geos: THREE.BufferGeometry[] = []
    for (const [mat, b] of this.merges) {
      const g = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false)!
      if (b.geos.length > 1) for (const x of b.geos) x.dispose()
      g.computeBoundingSphere()
      g.computeBoundingBox()
      geos.push(g)
      const m = new THREE.Mesh(g, mat)
      m.castShadow = b.cast
      m.receiveShadow = b.receive
      m.renderOrder = b.order
      m.matrixAutoUpdate = false
      parent.add(m)
      meshes.push(m)
    }
    for (const b of this.insts.values()) {
      const n = b.mats.length
      const im = new THREE.InstancedMesh(b.geo, b.mat, n)
      geos.push(b.geo)
      for (let i = 0; i < n; i++) im.setMatrixAt(i, b.mats[i])
      if (b.colors.some(c => c)) for (let i = 0; i < n; i++) im.setColorAt(i, b.colors[i] ?? new THREE.Color(1, 1, 1))
      for (const [k, a] of Object.entries(b.attrs)) b.geo.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(a.data), a.size))
      im.instanceMatrix.needsUpdate = true
      im.computeBoundingSphere()
      im.castShadow = b.cast
      im.receiveShadow = b.receive
      im.renderOrder = b.order
      im.matrixAutoUpdate = false
      parent.add(im)
      meshes.push(im)
    }
    for (const { o, m } of this.objects) {
      m.decompose(o.position, o.quaternion, o.scale)
      parent.add(o)
    }
    this.merges.clear()
    this.insts.clear()
    this.objects = []
    return {
      meshes,
      dispose() {
        for (const g of geos) g.dispose()
      },
    }
  }
}
