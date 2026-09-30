import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { foamBump } from '../../kit/beer'
import { rng } from '../../core/math'

/*
 * SPECIALTY COCKTAILS as product shots: three glasses modelled here (coupe,
 * rocks, collins), a transmissive liquid with an attenuation colour (it glows
 * against the backlit shelves), ice, bubbles and the garnishes named in the
 * specs: a rosemary sprig, orange peel, lime wheel, jalapeño slice, espresso
 * beans (and a lemon twist for the Tiny Badger). Two "slots" alternate so a
 * glass can slide out while the next slides in.
 */

type GlassKind = 'coupe' | 'rocks' | 'collins'
type Garnish = 'rosemary' | 'beans' | 'orange' | 'lime' | 'jalapeno' | 'lemon'

interface Spec {
  glass: GlassKind
  color: string
  depth: number
  fill: number
  ice: 'cube' | 'cubes' | null
  foam?: string
  bubbles?: boolean
  /** cloudy drinks scatter: tinted base colour, rough transmission */
  cloudy?: number
  garnish: Garnish[]
}

/** one per COCKTAILS entry, in order */
export const SPECS: Spec[] = [
  // Rosemary Lemonade: vodka, lemon, rosemary
  { glass: 'collins', color: '#f5d970', depth: 0.3, fill: 0.84, ice: 'cubes', cloudy: 0.6, garnish: ['rosemary'] },
  // Espresso Martini: a crema head, three beans
  { glass: 'coupe', color: '#3a1a08', depth: 0.04, fill: 0.86, ice: null, foam: '#c49a68', cloudy: 1, garnish: ['beans'] },
  // Classic Negroni: one big cube, orange peel
  { glass: 'rocks', color: '#c0141c', depth: 0.16, fill: 0.72, ice: 'cube', garnish: ['orange'] },
  // Smoke on the Water Slammer: aperol, mezcal, pineapple, lime
  { glass: 'rocks', color: '#f07a26', depth: 0.22, fill: 0.74, ice: 'cube', cloudy: 0.45, garnish: ['lime'] },
  // Spicy Ranch Water: clear, sparkling, lime + jalapeño
  { glass: 'collins', color: '#eef2dc', depth: 3.5, fill: 0.84, ice: 'cubes', bubbles: true, garnish: ['lime', 'jalapeno'] },
  // Kingston Negroni: rum, punt e mes, campari — a darker ruby on one cube
  { glass: 'rocks', color: '#7a1410', depth: 0.1, fill: 0.72, ice: 'cube', garnish: [] },
  // Tiny Badger: prosecco, benedictine, lemon
  { glass: 'coupe', color: '#e2b84e', depth: 0.55, fill: 0.84, ice: null, bubbles: true, garnish: ['lemon'] },
]

const PROFILES: Record<GlassKind, { pts: [number, number][]; floor: number }> = {
  coupe: {
    pts: [
      [0, 0], [0.25, 0], [0.26, 0.015], [0.07, 0.04], [0.032, 0.1], [0.028, 0.44], [0.07, 0.47], [0.26, 0.53],
      [0.37, 0.6], [0.42, 0.68], [0.43, 0.72],
    ],
    floor: 0.465,
  },
  rocks: {
    pts: [[0, 0], [0.33, 0], [0.345, 0.015], [0.35, 0.1], [0.37, 0.64]],
    floor: 0.1,
  },
  collins: {
    pts: [[0, 0], [0.235, 0], [0.245, 0.015], [0.25, 0.08], [0.262, 1.3]],
    floor: 0.08,
  },
}

function smooth(pts: [number, number][], n = 64) {
  return new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getSpacedPoints(n)
}
function radiusAt(pts: THREE.Vector2[], y: number) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) return a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y || 1))
  }
  return pts[pts.length - 1].x
}

interface Built {
  group: THREE.Group
  height: number
  rimR: number
  /** liquid top for a fill */
  top(fill: number): number
  setLiquid(spec: Spec): void
}

function buildGlass(kind: GlassKind, glassMat: THREE.Material): Built {
  const { pts: raw, floor } = PROFILES[kind]
  const pts = kind === 'rocks' || kind === 'collins' ? raw.map(([x, y]) => new THREE.Vector2(x, y)) : smooth(raw)
  const height = pts[pts.length - 1].y
  const wall = kind === 'coupe' ? 0.012 : 0.016
  const inner = pts.map(p => new THREE.Vector2(Math.max(0, p.x - wall), p.y)).filter(p => p.y >= floor)
  inner.unshift(new THREE.Vector2(0, floor))
  const shell = [...pts, ...inner.slice().reverse()]
  const glass = new THREE.Mesh(new THREE.LatheGeometry(shell, 64), glassMat)
  glass.castShadow = true
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    transmission: 1,
    thickness: 0.4,
    ior: 1.34,
    attenuationColor: new THREE.Color('#c0141c'),
    attenuationDistance: 0.2,
    envMapIntensity: 0.9,
    // the glass is an additive highlight shell and the ice is blended on top:
    // neither may be hidden by the liquid's depth
    depthWrite: false,
  })
  const liquid = new THREE.Mesh(new THREE.BufferGeometry(), liquidMat)
  const foamMat = new THREE.MeshStandardMaterial({ color: '#b88a5c', roughness: 0.9, envMapIntensity: 0.35, bumpMap: foamBump(), bumpScale: 1 })
  const foam = new THREE.Mesh(new THREE.BufferGeometry(), foamMat)
  const group = new THREE.Group()
  group.add(liquid, foam, glass)
  const top = (f: number) => floor + (height - 0.02 - floor) * f
  let cur = -1
  let curFoam = false
  return {
    group,
    height,
    rimR: pts[pts.length - 1].x,
    top,
    setLiquid(spec) {
      liquidMat.attenuationColor.set(spec.color)
      liquidMat.attenuationDistance = spec.depth
      const c = spec.cloudy ?? 0
      liquidMat.color.set(0xffffff).lerp(new THREE.Color(spec.color), c * 0.85)
      liquidMat.roughness = 0.05 + c * 0.35
      liquidMat.transmission = 1 - c * 0.35
      if (spec.foam) foamMat.color.set(spec.foam).multiplyScalar(0.8)
      const hasFoam = !!spec.foam
      if (cur === spec.fill && curFoam === hasFoam) return
      cur = spec.fill
      curFoam = hasFoam
      const t = top(spec.fill)
      const headH = hasFoam ? 0.045 : 0
      const lt = t - headH
      const inset = 0.006
      const lp = [new THREE.Vector2(0, floor + 0.002)]
      for (let i = 0; i <= 20; i++) {
        const y = floor + 0.002 + ((lt - floor) * i) / 20
        lp.push(new THREE.Vector2(Math.max(0.001, radiusAt(inner, y) - inset), y))
      }
      lp.push(new THREE.Vector2(0, lt))
      liquid.geometry.dispose()
      liquid.geometry = new THREE.LatheGeometry(lp, 56)
      foam.visible = hasFoam
      if (hasFoam) {
        const fp = [new THREE.Vector2(0, lt)]
        for (let i = 0; i <= 4; i++) {
          const y = lt + (headH * i) / 4
          fp.push(new THREE.Vector2(radiusAt(inner, y) - inset, y))
        }
        const r = radiusAt(inner, t) - inset
        for (let i = 1; i <= 5; i++) {
          const u = i / 5
          fp.push(new THREE.Vector2(r * Math.cos((u * Math.PI) / 2), t + Math.sin((u * Math.PI) / 2) * 0.012))
        }
        foam.geometry.dispose()
        foam.geometry = new THREE.LatheGeometry(fp, 56)
      }
    },
  }
}

/* ---------------- garnishes ---------------- */

function rosemary(): THREE.Group {
  const g = new THREE.Group()
  const stemMat = new THREE.MeshStandardMaterial({ color: '#4a3a24', roughness: 0.8 })
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3f5a3c', roughness: 0.55, envMapIntensity: 0.6 })
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.02, 0.3, 0.01),
    new THREE.Vector3(0.05, 0.6, 0),
    new THREE.Vector3(0.1, 0.88, -0.02),
  ])
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.011, 6), stemMat))
  const needle = new THREE.CylinderGeometry(0.004, 0.009, 0.13, 5)
  needle.translate(0, 0.065, 0)
  const n = 90
  const leaves = new THREE.InstancedMesh(needle, leafMat, n)
  const r = rng(4)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < n; i++) {
    const t = 0.28 + (i / n) * 0.72
    const p = curve.getPoint(t)
    const tan = curve.getTangent(t)
    const a = i * 2.39996
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const dir = out.multiplyScalar(0.9).addScaledVector(tan, 0.75 + r() * 0.3).normalize()
    q.setFromUnitVectors(up, dir)
    const s = 0.75 + r() * 0.35 - (t > 0.9 ? (t - 0.9) * 3 : 0)
    m.compose(p, q, new THREE.Vector3(s, s, s))
    leaves.setMatrixAt(i, m)
  }
  g.add(leaves)
  return g
}

function peel(color: string, pith: string): THREE.Group {
  const g = new THREE.Group()
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 30; i++) {
    const t = i / 30
    const a = t * Math.PI * 2.4
    pts.push(new THREE.Vector3(Math.cos(a) * 0.07, t * 0.3, Math.sin(a) * 0.07))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  const geo = new THREE.TubeGeometry(curve, 64, 0.028, 8)
  geo.scale(1, 1, 1)
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.3 })
  const m = new THREE.Mesh(geo, mat)
  m.scale.set(1, 1, 0.45)
  g.add(m)
  // the pale pith edge, a hair inside
  const inner = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.022, 8), new THREE.MeshStandardMaterial({ color: pith, roughness: 0.8 }))
  inner.scale.set(0.96, 1, 0.55)
  g.add(inner)
  g.traverse(o => (o.castShadow = true))
  return g
}

let limeTex: THREE.CanvasTexture | null = null
function limeFace() {
  if (limeTex) return limeTex
  const n = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  g.fillStyle = '#3d6a16'
  g.beginPath()
  g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#e4ecc0'
  g.beginPath()
  g.arc(n / 2, n / 2, n * 0.46, 0, Math.PI * 2)
  g.fill()
  for (let i = 0; i < 9; i++) {
    const a0 = (i / 9) * Math.PI * 2 + 0.05
    const a1 = ((i + 1) / 9) * Math.PI * 2 - 0.05
    const gr = g.createRadialGradient(n / 2, n / 2, n * 0.05, n / 2, n / 2, n * 0.43)
    gr.addColorStop(0, '#c4d67a')
    gr.addColorStop(1, '#86a832')
    g.fillStyle = gr
    g.beginPath()
    g.moveTo(n / 2 + Math.cos((a0 + a1) / 2) * n * 0.05, n / 2 + Math.sin((a0 + a1) / 2) * n * 0.05)
    g.arc(n / 2, n / 2, n * 0.42, a0, a1)
    g.closePath()
    g.fill()
  }
  limeTex = new THREE.CanvasTexture(cv)
  limeTex.colorSpace = THREE.SRGBColorSpace
  return limeTex
}
function limeWheel(): THREE.Group {
  const g = new THREE.Group()
  const face = new THREE.MeshPhysicalMaterial({ map: limeFace(), roughness: 0.45, clearcoat: 0.3 })
  const rind = new THREE.MeshStandardMaterial({ color: '#3a6414', roughness: 0.5 })
  const geo = new THREE.CylinderGeometry(0.14, 0.14, 0.03, 40)
  const m = new THREE.Mesh(geo, [rind, face, face])
  m.rotation.x = Math.PI / 2
  m.castShadow = true
  g.add(m)
  return g
}
function jalapeno(): THREE.Group {
  const g = new THREE.Group()
  const skin = new THREE.MeshPhysicalMaterial({ color: '#2f6a22', roughness: 0.3, clearcoat: 0.8 })
  const flesh = new THREE.MeshStandardMaterial({ color: '#c9d98a', roughness: 0.6 })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 10, 28), skin)
  ring.scale.set(1, 1, 0.9)
  ring.rotation.x = Math.PI / 2
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), flesh)
  g.add(ring, inner)
  // seeds
  const seed = new THREE.SphereGeometry(0.01, 6, 4)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const s = new THREE.Mesh(seed, new THREE.MeshStandardMaterial({ color: '#f1ecd0', roughness: 0.5 }))
    s.position.set(Math.cos(a) * 0.03, 0.012, Math.sin(a) * 0.03)
    s.scale.set(1, 0.5, 1.4)
    g.add(s)
  }
  return g
}
function beans(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshPhysicalMaterial({ color: '#2a1408', roughness: 0.28, clearcoat: 0.9 })
  const geo = new THREE.SphereGeometry(0.045, 16, 10)
  geo.scale(0.8, 0.55, 1.25)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4
    const b = new THREE.Mesh(geo, mat)
    b.position.set(Math.cos(a) * 0.06, 0.012, Math.sin(a) * 0.06)
    b.rotation.y = a + 0.6
    b.castShadow = true
    g.add(b)
  }
  return g
}

/* ---------------- a slot: every glass + garnish, configured per cocktail ---------------- */

export interface CocktailSlot {
  group: THREE.Group
  /** configure for cocktail k (idempotent) */
  show(k: number): void
  /** idle animation (bubbles) */
  tick(time: number): void
  shown: number
}

export function makeSlot(glassMat: THREE.Material, iceMat: THREE.Material, iceMatInstanced: THREE.Material, seed: number): CocktailSlot {
  const group = new THREE.Group()
  const glasses: Record<GlassKind, Built> = {
    coupe: buildGlass('coupe', glassMat),
    rocks: buildGlass('rocks', glassMat),
    collins: buildGlass('collins', glassMat),
  }
  for (const k of Object.keys(glasses) as GlassKind[]) group.add(glasses[k].group)

  // ice
  const big = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.44, 0.44, 3, 0.05), iceMat)
  const cubes = new THREE.InstancedMesh(new RoundedBoxGeometry(0.28, 0.28, 0.28, 2, 0.04), iceMatInstanced, 4)
  group.add(big, cubes)
  // bubbles
  const nb = 36
  const bubbles = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.011, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 0.1, metalness: 0, envMapIntensity: 2, transparent: true, opacity: 0.7 }),
    nb,
  )
  bubbles.frustumCulled = false
  group.add(bubbles)
  const r = rng(seed)
  const bseed = Array.from({ length: nb }, () => [r(), r(), r(), r()])

  const gar: Record<Garnish, THREE.Group> = {
    rosemary: rosemary(),
    beans: beans(),
    orange: peel('#e2701c', '#f4dcb0'),
    lemon: peel('#e9c02e', '#f7ecc4'),
    lime: limeWheel(),
    jalapeno: jalapeno(),
  }
  for (const k of Object.keys(gar) as Garnish[]) group.add(gar[k])

  let bubbleSpec: { floor: number; top: number; r: number } | null = null
  const m = new THREE.Matrix4()
  const slot: CocktailSlot = {
    group,
    shown: -1,
    show(k) {
      if (slot.shown === k) return
      slot.shown = k
      const s = SPECS[k]
      const G = glasses[s.glass]
      for (const g of Object.keys(glasses) as GlassKind[]) glasses[g].group.visible = g === s.glass
      G.setLiquid(s)
      const top = G.top(s.fill)
      const floor = PROFILES[s.glass].floor
      // ice
      big.visible = s.ice === 'cube'
      if (big.visible) {
        big.position.set(0.02, floor + 0.23 + Math.max(0, top - floor - 0.3) * 0.5, 0)
        big.rotation.set(0.08, 0.5, 0.05)
      }
      cubes.visible = s.ice === 'cubes'
      if (cubes.visible) {
        const q = new THREE.Quaternion()
        for (let i = 0; i < 4; i++) {
          q.setFromEuler(new THREE.Euler(0.3 * i, 0.7 * i + 0.2, 0.2 * i))
          m.compose(new THREE.Vector3(i % 2 ? 0.06 : -0.06, floor + 0.2 + i * 0.27, i % 2 ? -0.03 : 0.04), q, new THREE.Vector3(1, 1, 1))
          cubes.setMatrixAt(i, m)
        }
        cubes.instanceMatrix.needsUpdate = true
      }
      bubbles.visible = !!s.bubbles
      bubbleSpec = s.bubbles ? { floor: floor + 0.02, top: top - 0.02, r: radiusAt(smooth(PROFILES[s.glass].pts), (floor + top) / 2) * 0.6 } : null
      // garnishes
      for (const g of Object.keys(gar) as Garnish[]) gar[g].visible = s.garnish.includes(g)
      const rim = G.height
      const rr = G.rimR
      gar.rosemary.position.set(-0.08, floor + 0.35, 0.02)
      gar.rosemary.rotation.set(0.05, 0.3, -0.18)
      gar.beans.position.set(0, top + 0.012, 0)
      gar.orange.position.set(-0.12, big.position.y + 0.25, 0.06)
      gar.orange.rotation.set(0.25, 0.5, -1.45)
      gar.lemon.position.set(rr * 0.55, rim + 0.01, 0.12)
      gar.lemon.rotation.set(0.2, 0.3, 1.5)
      gar.lime.position.set(rr * 0.95, rim - 0.03, 0.08)
      gar.lime.rotation.set(0, 0.35, 0)
      gar.jalapeno.position.set(-0.05, top + 0.012, 0.05)
    },
    tick(time) {
      if (!bubbleSpec || !bubbles.visible) return
      const { floor, top, r: rad } = bubbleSpec
      const q = new THREE.Quaternion()
      const one = new THREE.Vector3(1, 1, 1)
      for (let i = 0; i < nb; i++) {
        const [a, b, c, d] = bseed[i]
        // a few streams from nucleation points on the floor
        const stream = i % 5
        const ang = stream * 1.26 + a * 0.2
        const rr = rad * (0.35 + 0.6 * ((stream * 0.37) % 1))
        const f = (time * (0.18 + 0.1 * b) + c) % 1
        const y = floor + f * (top - floor)
        m.compose(new THREE.Vector3(Math.cos(ang) * rr + Math.sin(time * 3 + d * 6) * 0.004, y, Math.sin(ang) * rr), q, one.setScalar(0.6 + f * 0.8))
        bubbles.setMatrixAt(i, m)
      }
      bubbles.instanceMatrix.needsUpdate = true
    },
  }
  return slot
}
