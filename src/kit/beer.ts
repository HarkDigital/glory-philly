import * as THREE from 'three'

/*
 * GLORY KIT: glassware and beer, photoreal (Resonance's liquid chrome, poured
 * as beer). Every chapter that shows a drink builds it from here so the whole
 * site speaks one visual language.
 *
 *   const g = makeGlass({ shape: 'tulip', beer: BEERS.amber })
 *   g.group.position.set(0, 0, 0)       // base of the glass sits on y = 0
 *   g.setFill(0.8)                      // 0 empty .. 1 full (head included)
 *   g.setHead(0.12)                     // foam height as a fraction of the glass
 *
 * Glass is MeshPhysicalMaterial transmission (thin, clear, high IOR highlights
 * from the studio env). The beer is transmissive with an attenuation colour,
 * so it glows where rim lights come through. Foam is a rough cream with a
 * cellular bump. Keep ≤ ~4 glasses in one shot (transmission renders the
 * scene again; see the playbook's glass notes).
 */

export type GlassShape = 'tulip' | 'pint' | 'goblet' | 'stange' | 'snifter'

export interface BeerStyle {
  /** the liquid's colour seen through ~1 glass width */
  color: THREE.ColorRepresentation
  /** attenuation distance in world units (smaller = deeper colour) */
  depth: number
  /** foam colour */
  foam: THREE.ColorRepresentation
}

export const BEERS = {
  straw: { color: '#f4c24a', depth: 0.9, foam: '#fbf5e8' },
  gold: { color: '#e9a22a', depth: 0.6, foam: '#fbf3e2' },
  amber: { color: '#c8661a', depth: 0.4, foam: '#f6ead3' },
  ruby: { color: '#8a2414', depth: 0.28, foam: '#efdcc2' },
  stout: { color: '#2a1206', depth: 0.1, foam: '#e6cfa6' },
  rose: { color: '#e46a6a', depth: 0.7, foam: '#fbe9e6' },
  cider: { color: '#f0c060', depth: 1.2, foam: '#fff8ea' },
} satisfies Record<string, BeerStyle>

/** Outline profiles (x = radius, y = height), base → rim, in world units (~0.1 = 1 inch-ish). */
const PROFILES: Record<GlassShape, [number, number][]> = {
  tulip: [
    [0.0, 0.0], [0.24, 0.0], [0.26, 0.02], [0.1, 0.06], [0.05, 0.12], [0.045, 0.34], [0.09, 0.4],
    [0.26, 0.52], [0.34, 0.66], [0.35, 0.8], [0.32, 0.94], [0.29, 1.04], [0.3, 1.1],
  ],
  pint: [
    [0.0, 0.0], [0.24, 0.0], [0.25, 0.04], [0.26, 0.3], [0.31, 0.95], [0.33, 1.12],
  ],
  goblet: [
    [0.0, 0.0], [0.26, 0.0], [0.27, 0.02], [0.08, 0.05], [0.05, 0.1], [0.05, 0.38], [0.14, 0.44],
    [0.32, 0.54], [0.38, 0.68], [0.38, 0.84], [0.37, 0.92],
  ],
  stange: [
    [0.0, 0.0], [0.17, 0.0], [0.18, 0.05], [0.18, 1.2], [0.185, 1.26],
  ],
  snifter: [
    [0.0, 0.0], [0.25, 0.0], [0.26, 0.02], [0.08, 0.05], [0.045, 0.12], [0.05, 0.26], [0.2, 0.34],
    [0.36, 0.5], [0.4, 0.64], [0.36, 0.8], [0.26, 0.92], [0.24, 0.96],
  ],
}

/** the height where the bowl starts (below it is stem/base, never filled) */
const BOWL_FLOOR: Record<GlassShape, number> = { tulip: 0.4, pint: 0.05, goblet: 0.44, stange: 0.06, snifter: 0.34 }

function smoothProfile(pts: [number, number][], steps = 64): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  return curve.getSpacedPoints(steps)
}

/** radius of the inside of the glass at height y (linear through the profile) */
function radiusAt(pts: THREE.Vector2[], y: number) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) {
      const t = (y - a.y) / (b.y - a.y || 1)
      return a.x + (b.x - a.x) * t
    }
  }
  return pts[pts.length - 1].x
}

let foamTex: THREE.CanvasTexture | null = null
/** a tileable cellular bump for foam (small canvas, built once) */
export function foamBump(): THREE.Texture {
  if (foamTex) return foamTex
  const n = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, n, n)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 900; i++) {
    const x = rnd() * n
    const y = rnd() * n
    const r = 2 + rnd() * rnd() * 9
    for (const [dx, dy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
      gr.addColorStop(0, 'rgba(255,255,255,0.55)')
      gr.addColorStop(0.75, 'rgba(200,200,200,0.2)')
      gr.addColorStop(1, 'rgba(40,40,40,0.5)')
      g.fillStyle = gr
      g.beginPath()
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  foamTex = new THREE.CanvasTexture(cv)
  foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping
  foamTex.colorSpace = THREE.NoColorSpace
  return foamTex
}

export interface Glass {
  group: THREE.Group
  glass: THREE.Mesh
  beer: THREE.Mesh
  foam: THREE.Mesh
  /** height of the rim */
  height: number
  /** 0 empty .. 1 full to the rim (foam included) */
  setFill(f: number): void
  /** foam height as a fraction of the glass height */
  setHead(h: number): void
  setBeer(style: BeerStyle): void
  dispose(): void
}

export function makeGlass({
  shape = 'tulip',
  beer = BEERS.amber as BeerStyle,
  scale = 1,
  fill = 0.9,
  head = 0.1,
}: { shape?: GlassShape; beer?: BeerStyle; scale?: number; fill?: number; head?: number } = {}): Glass {
  const group = new THREE.Group()
  const pts = smoothProfile(PROFILES[shape])
  const height = pts[pts.length - 1].y
  const floor = BOWL_FLOOR[shape]

  // the glass: a thin shell (outer profile + inner offset), clear
  const inner = pts.map(p => new THREE.Vector2(Math.max(0, p.x - 0.012), p.y)).filter(p => p.y >= floor - 0.02)
  const shell = [...pts, ...inner.slice().reverse()]
  const glassGeo = new THREE.LatheGeometry(shell, 64)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.03,
    transmission: 1,
    thickness: 0.04,
    ior: 1.5,
    specularIntensity: 1,
    envMapIntensity: 1.2,
    transparent: false,
  })
  const glass = new THREE.Mesh(glassGeo, glassMat)
  glass.castShadow = true

  const beerMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.08,
    transmission: 1,
    thickness: 0.5,
    ior: 1.34,
    attenuationColor: new THREE.Color(beer.color),
    attenuationDistance: beer.depth,
    envMapIntensity: 0.9,
  })
  // foam: matte cream that must never blow out under the key (it is the
  // brightest diffuse surface in most shots) — low env, no sheen
  const foamMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(beer.foam).multiplyScalar(0.78),
    roughness: 0.92,
    envMapIntensity: 0.35,
    bumpMap: foamBump(),
    bumpScale: 1.2,
  })
  foamMat.bumpMap!.repeat.set(3, 1)

  const beerMesh = new THREE.Mesh(new THREE.BufferGeometry(), beerMat)
  const foamMesh = new THREE.Mesh(new THREE.BufferGeometry(), foamMat)
  foamMesh.castShadow = false
  group.add(beerMesh, foamMesh, glass)
  group.scale.setScalar(scale)

  let curFill = -1
  let curHead = -1
  const rebuild = (f: number, h: number) => {
    f = Math.max(0, Math.min(1, f))
    h = Math.max(0, Math.min(0.3, h))
    if (Math.abs(f - curFill) < 1e-4 && Math.abs(h - curHead) < 1e-4) return
    curFill = f
    curHead = h
    const top = floor + (height - 0.02 - floor) * f
    const headH = Math.min(h * height, Math.max(0, top - floor))
    const liquidTop = top - headH
    const inset = 0.014
    const liquid: THREE.Vector2[] = [new THREE.Vector2(0, floor)]
    const N = 24
    for (let i = 0; i <= N; i++) {
      const y = floor + ((liquidTop - floor) * i) / N
      liquid.push(new THREE.Vector2(Math.max(0.001, radiusAt(inner, y) - inset), y))
    }
    liquid.push(new THREE.Vector2(0, liquidTop))
    beerMesh.geometry.dispose()
    beerMesh.geometry = new THREE.LatheGeometry(liquid, 48)
    beerMesh.visible = liquidTop > floor + 0.005
    // foam: a cap from the liquid top to the fill line, domed slightly
    const fp: THREE.Vector2[] = [new THREE.Vector2(0, liquidTop)]
    for (let i = 0; i <= 8; i++) {
      const y = liquidTop + (headH * i) / 8
      fp.push(new THREE.Vector2(Math.max(0.001, radiusAt(inner, y) - inset), y))
    }
    const rTop = radiusAt(inner, top) - inset
    for (let i = 1; i <= 6; i++) {
      const u = i / 6
      fp.push(new THREE.Vector2(rTop * Math.cos((u * Math.PI) / 2), top + Math.sin((u * Math.PI) / 2) * Math.min(0.03, headH * 0.4)))
    }
    foamMesh.geometry.dispose()
    foamMesh.geometry = new THREE.LatheGeometry(fp, 48)
    foamMesh.visible = headH > 0.002
  }
  rebuild(fill, head)

  return {
    group,
    glass,
    beer: beerMesh,
    foam: foamMesh,
    height,
    setFill: f => rebuild(f, curHead),
    setHead: h => rebuild(curFill, h),
    setBeer(style) {
      beerMat.attenuationColor.set(style.color)
      beerMat.attenuationDistance = style.depth
      foamMat.color.set(style.foam)
    },
    dispose() {
      glassGeo.dispose()
      beerMesh.geometry.dispose()
      foamMesh.geometry.dispose()
      glassMat.dispose()
      beerMat.dispose()
      foamMat.dispose()
    },
  }
}
