import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * VINYL KIT geometry (ported from Resonance's crate, generalised).
 *
 * World units: a 12" sleeve is 1 x 1 (1 unit ≈ 12.4" ≈ 314 mm). A 7" sleeve
 * is 0.586 (same geometry, scaled). Records are lathed with a real profile
 * (label plateau, dead wax step, grooved field, rolled edge bead); the axis is
 * local +z (side A faces +z). The crate is a record-shop browser bin in black
 * anodized aluminium with diamond-cut chamfers: it sits on y = 0, centred on
 * x, its low front wall toward +z (the camera side).
 */

/** 12" sleeve (w, h, board thickness) */
export const SLEEVE = { w: 1, h: 1, t: 0.014 }
/** a 7" sleeve is this fraction of a 12" one */
export const SEVEN = 0.586

/** Record dimensions (local units of the record itself; 12" sleeve = 1). */
export interface RecordDims {
  /** outer radius */
  R: number
  /** paper label radius */
  labelR: number
  /** centre hole radius (spindle hole, or the 45's big hole) */
  hole: number
  /** end of the dead wax (start of the grooves) */
  wax: number
  /** outermost groove (the lead-in) */
  lead: number
  /** half thickness of the grooved field */
  t: number
}

/** 12" LP: 7.24 mm spindle hole, 100 mm label */
export const REC12: RecordDims = { R: 0.476, labelR: 0.158, hole: 0.0115, wax: 0.19, lead: 0.452, t: 0.0022 }
/** 7" single: the 38 mm "big hole", 90 mm label */
export const REC7: RecordDims = { R: 0.283, labelR: 0.141, hole: 0.061, wax: 0.168, lead: 0.268, t: 0.0021 }
/** legacy aliases (Resonance names) */
export const RECORD_R = REC12.R
export const LABEL_R = REC12.labelR

export const CRATE = {
  /** inner half width (sleeves are 1 wide) */
  inner: 0.535,
  wall: 0.032,
  zFront: 0.6,
  zBack: -0.6,
  backH: 0.8,
  frontH: 0.24,
  floor: 0.032,
  feet: 0.018,
  /** top of the inner floor, where sleeves stand */
  get y0() {
    return this.feet + this.floor
  },
}

export interface CrateDims {
  inner: number
  wall: number
  zFront: number
  zBack: number
  backH: number
  frontH: number
  floor: number
  feet: number
  y0: number
}

/** Crate dimensions for a given depth (front-to-back inner length, default 1.2). */
export function crateDims(depth = 1.2): CrateDims {
  const d = {
    inner: CRATE.inner,
    wall: CRATE.wall,
    zFront: depth / 2,
    zBack: -depth / 2,
    backH: CRATE.backH,
    frontH: CRATE.frontH,
    floor: CRATE.floor,
    feet: CRATE.feet,
    y0: CRATE.feet + CRATE.floor,
  }
  return d
}

/** crate wall height (local y of the rim) at depth z along the sloped sides */
export const rimAt = (z: number, C: CrateDims = crateDims()) => {
  const t = (z - C.zBack) / (C.zFront - C.zBack)
  return C.backH + (C.frontH - C.backH) * Math.min(1, Math.max(0, t))
}

/** A 2D polygon with every corner cut by `c` (so extrusions get chamfers all round). */
function chamferPoly(pts: THREE.Vector2[], c: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const a = pts[(i + n - 1) % n]
    const b = pts[(i + 1) % n]
    const da = a.clone().sub(p)
    const db = b.clone().sub(p)
    const ca = Math.min(c, da.length() * 0.45)
    const cb = Math.min(c, db.length() * 0.45)
    out.push(p.clone().addScaledVector(da.normalize(), ca))
    out.push(p.clone().addScaledVector(db.normalize(), cb))
  }
  return out
}

function stadium(cx: number, cy: number, w: number, h: number, seg = 10): THREE.Path {
  const r = h / 2
  const path = new THREE.Path()
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * Math.PI
    pts.push(new THREE.Vector2(cx + w / 2 - r + Math.cos(a) * r, cy + Math.sin(a) * r))
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + (i / seg) * Math.PI
    pts.push(new THREE.Vector2(cx - w / 2 + r + Math.cos(a) * r, cy + Math.sin(a) * r))
  }
  // holes wind opposite to the outline
  pts.reverse()
  path.setFromPoints(pts)
  return path
}

/**
 * Extrude a (chamfered) outline by `depth` with a flat 1-segment bevel, centred
 * on z. Returns geometry with flat facet normals.
 */
export function slab(outline: THREE.Vector2[], depth: number, c: number, holes: THREE.Path[] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(chamferPoly(outline, c))
  shape.holes.push(...holes)
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - 2 * c),
    bevelEnabled: true,
    bevelThickness: c,
    bevelSize: c * 0.999,
    bevelOffset: -c,
    bevelSegments: 1,
    curveSegments: 10,
    steps: 1,
  })
  g.translate(0, 0, -(depth - 2 * c) / 2)
  return g
}

export const rect = (x0: number, y0: number, x1: number, y1: number) => [
  new THREE.Vector2(x0, y0),
  new THREE.Vector2(x1, y0),
  new THREE.Vector2(x1, y1),
  new THREE.Vector2(x0, y1),
]

/** Keep only position/normal/uv, non-indexed (so parts merge). */
export function cleanParts(parts: THREE.BufferGeometry[]) {
  return parts.map(g => {
    const n = g.index ? g.toNonIndexed() : g
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k)
    return n
  })
}

/**
 * The crate as ONE merged geometry with an `aChamfer` attribute (1 on the
 * diamond-cut bevels and machined cut edges, 0 on the anodized faces) so a
 * single material can render both.
 */
export function crateGeometry(C: CrateDims = crateDims()): THREE.BufferGeometry {
  const c = 0.006
  const parts: THREE.BufferGeometry[] = []
  const yb = C.feet
  const outer = C.inner + C.wall

  // floor: XZ slab (extrude along y)
  {
    const g = slab(rect(-outer, C.zBack, outer, C.zFront), C.floor, c)
    g.rotateX(Math.PI / 2)
    g.translate(0, yb + C.floor / 2, 0)
    parts.push(g)
  }
  // side walls: a profile in (z, y), extruded along x, with a hand-hole
  for (const side of [-1, 1]) {
    const prof = [
      new THREE.Vector2(C.zBack, yb),
      new THREE.Vector2(C.zFront, yb),
      new THREE.Vector2(C.zFront, C.frontH),
      new THREE.Vector2(C.zBack, C.backH),
    ]
    const hole = stadium(C.zBack + 0.27, C.backH - 0.13, 0.26, 0.075)
    const g = slab(prof, C.wall, c, [hole])
    g.rotateY(-Math.PI / 2)
    g.translate(side * (C.inner + C.wall / 2), 0, 0)
    parts.push(g)
  }
  // back wall
  {
    const g = slab(rect(-C.inner, yb + C.floor * 0.5, C.inner, C.backH), C.wall, c)
    g.translate(0, 0, C.zBack + C.wall / 2)
    parts.push(g)
  }
  // front wall (lower)
  {
    const g = slab(rect(-C.inner, yb + C.floor * 0.5, C.inner, C.frontH), C.wall, c)
    g.translate(0, 0, C.zFront - C.wall / 2)
    parts.push(g)
  }
  // rubber feet
  for (const [x, z] of [
    [-outer + 0.07, C.zBack + 0.07],
    [outer - 0.07, C.zBack + 0.07],
    [-outer + 0.07, C.zFront - 0.07],
    [outer - 0.07, C.zFront - 0.07],
  ]) {
    const g = new THREE.CylinderGeometry(0.04, 0.045, C.feet, 20, 1)
    g.translate(x, C.feet / 2, z)
    parts.push(g)
  }

  const merged = mergeGeometries(cleanParts(parts), false)!
  // classify facets: axis-aligned (and the gently sloped side tops) are
  // anodized, anything more oblique is a bright machined bevel
  const nrm = merged.attributes.normal
  const pos = merged.attributes.position
  const ch = new Float32Array(nrm.count)
  for (let i = 0; i < nrm.count; i++) {
    const m = Math.max(Math.abs(nrm.getX(i)), Math.abs(nrm.getY(i)), Math.abs(nrm.getZ(i)))
    const y = pos.getY(i)
    ch[i] = y < C.feet + 1e-4 ? 0 : m < 0.86 ? 1 : 0
  }
  merged.setAttribute('aChamfer', new THREE.BufferAttribute(ch, 1))
  merged.computeBoundingSphere()
  return merged
}

/**
 * A sleeve: a thin box, pivot at the bottom-centre edge (so flips hinge on
 * the crate floor). Local x in [-0.5, 0.5], y in [0, 1], z in ±t/2.
 * (A 7" sleeve is this geometry scaled by SEVEN.)
 */
export function sleeveGeometry(t = SLEEVE.t): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(SLEEVE.w, SLEEVE.h, t, 1, 1, 1)
  g.translate(0, SLEEVE.h / 2, 0)
  return g
}

/**
 * The record: a lathed profile (axis = local z) — label plateau with a
 * raised ring, a step down to the dead wax, the grooved field, and a rolled
 * edge bead. Side A faces +z.
 */
export function recordGeometry(d: RecordDims = REC12, segments = 128): THREE.BufferGeometry {
  const { R, labelR: L, hole, t } = d
  const top: [number, number][] = [
    [hole, t + 0.0008],
    [L - 0.004, t + 0.0008],
    [L + 0.003, t + 0.0013],
    [L + 0.011, t + 0.0004],
    [Math.min(d.wax, L + 0.03), t],
    [R - 0.024, t],
    [R - 0.013, t + 0.0003],
    [R - 0.006, t + 0.0014],
    [R - 0.0015, t + 0.0004],
    [R, 0.0],
  ]
  const pts: THREE.Vector2[] = []
  for (const [r, h] of top) pts.push(new THREE.Vector2(r, h))
  for (let i = top.length - 2; i >= 0; i--) pts.push(new THREE.Vector2(top[i][0], -top[i][1]))
  pts.push(new THREE.Vector2(hole, t + 0.0008))
  // LatheGeometry revolves (x = radius, y = height) around +y; walk the
  // profile bottom → top so the faces wind outward (side A's normal is +z)
  pts.reverse()
  const g = new THREE.LatheGeometry(pts, segments)
  g.rotateX(Math.PI / 2)
  g.computeVertexNormals()
  return g
}

/** Soft floor shadow quad (XZ), unit size — scaled by the caller. */
export function shadowQuad(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1)
  g.rotateX(-Math.PI / 2)
  return g
}

/**
 * The 45 adapter ("spider"): a three-spoke insert that fills the big hole of
 * a 7" (axis = local z, sits in the record's centre plane).
 */
export function adapterGeometry(d: RecordDims = REC7): THREE.BufferGeometry {
  const r0 = d.hole * 0.98
  const shape = new THREE.Shape()
  const n = 3
  const pts: THREE.Vector2[] = []
  for (let i = 0; i < n * 24; i++) {
    const a = (i / (n * 24)) * Math.PI * 2
    // three spokes reach the rim; between them the edge dips inward
    const k = Math.cos(a * n)
    const r = k > 0.55 ? r0 : r0 * (0.62 + 0.38 * Math.max(0, (k + 0.2) / 0.75))
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r))
  }
  shape.setFromPoints(pts)
  const hole = new THREE.Path()
  hole.absarc(0, 0, 0.0115, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(shape, { depth: d.t * 2.2, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1, curveSegments: 24 })
  g.translate(0, 0, -d.t * 1.1)
  g.computeVertexNormals()
  return g
}

/**
 * A box with rounded edges (w × h × d, radius r), centred. Per-face 0..1 UVs.
 * (Local stand-in for three's RoundedBoxGeometry addon.)
 */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const n = seg * 2 + 1
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n)
  const pos = g.attributes.position as THREE.BufferAttribute
  const nrm = g.attributes.normal as THREE.BufferAttribute
  const half = [w / 2, h / 2, d / 2]
  const rr = Math.min(r, w / 2, h / 2, d / 2)
  const p = new THREE.Vector3()
  const inner = new THREE.Vector3()
  const map = (u: number, hs: number) => {
    // unit coordinate → the flat middle segment spans the face, the rest bunch at the edges
    const t = (u + 0.5) * n
    if (t <= seg) return -hs + (t / seg) * rr
    if (t >= seg + 1) return hs - rr + ((t - seg - 1) / seg) * rr
    return -hs + rr + (t - seg) * (2 * hs - 2 * rr)
  }
  for (let i = 0; i < pos.count; i++) {
    p.set(map(pos.getX(i), half[0]), map(pos.getY(i), half[1]), map(pos.getZ(i), half[2]))
    inner.set(
      Math.max(-half[0] + rr, Math.min(half[0] - rr, p.x)),
      Math.max(-half[1] + rr, Math.min(half[1] - rr, p.y)),
      Math.max(-half[2] + rr, Math.min(half[2] - rr, p.z)),
    )
    const o = p.sub(inner)
    if (o.lengthSq() > 1e-12) {
      o.normalize()
      nrm.setXYZ(i, o.x, o.y, o.z)
      p.copy(inner).addScaledVector(o, rr)
    } else p.copy(inner)
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  g.computeBoundingSphere()
  return g
}
