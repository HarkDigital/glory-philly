import * as THREE from 'three'

/*
 * GLORY KIT: glassware and beer, photoreal (Resonance's liquid chrome, poured
 * as beer). Every chapter that shows a drink builds it from here so the whole
 * site speaks one visual language.
 *
 *   const g = makeGlass({ shape: 'tulip', beer: BEERS.amber, bubbles: 160 })
 *   g.group.position.set(0, 0, 0)       // base of the glass sits on y = 0
 *   g.setFill(0.8)                      // 0 empty .. 1 full (head included)
 *   g.setHead(0.12)                     // foam height as a fraction of the glass
 *   g.update(frame.time)                // each frame, only if it has bubbles
 *
 * How it's lit (the product-shot recipe):
 *  - GLASS is a thin clear shell drawn AFTER the beer as premultiplied
 *    reflections: only the studio's softbox strips, bulbs and the key show on
 *    it (long crisp highlights) plus a faint Fresnel edge. It is NOT a
 *    transmission mesh — a transmissive shell hides the transmissive beer
 *    inside it (three renders transmissive meshes without each other).
 *  - BEER is the one transmissive mesh: it refracts what's behind it,
 *    tinted by its colour + attenuation, with a soft inner glow (setGlow).
 *    It glows amber when there is LIGHT behind it: put a rim light or a
 *    backlight card (makeBacklight, below) behind the glass. Never leave it
 *    over plain black — it goes murky.
 *  - The liquid STAYS LEVEL when the glass tilts (setTilt) or sloshes
 *    (setSlosh): its surface is a world-horizontal plane cut through the bowl.
 *  - FOAM is a matte cream cap, domed, bumped, never hot enough to blow out.
 *  - BUBBLES (option `bubbles`: a count) are instanced carbonation streams
 *    rising from nucleation sites, drawn over the beer; setBubbles(0..1).
 *
 * `cheap: true` makes a non-transmissive stand-in (far/dim glasses; keep ≤ ~4
 * transmissive meshes clearly on screen).
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

const WALL = 0.012
const INSET = 0.004

function smoothProfile(pts: [number, number][], steps = 64): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  return curve.getSpacedPoints(steps)
}

/** radius of the profile at height y (linear through the points) */
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
  // fine micro-foam first, a few bigger bubbles on top (a dense creamy head)
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * n
    const y = rnd() * n
    const big = i > 1250
    const r = big ? 3 + rnd() * 6 : 1 + rnd() * rnd() * 3.2
    for (const [dx, dy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
      gr.addColorStop(0, 'rgba(255,255,255,0.5)')
      gr.addColorStop(0.7, 'rgba(210,210,210,0.18)')
      gr.addColorStop(1, 'rgba(40,40,40,0.45)')
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

// ─── the level liquid: a bowl filled up to a (world-horizontal) plane ────────

const SEG = 56
const CAP_RINGS = 4
const RTAB = 48

/**
 * A lathe-like volume inside the bowl between a lower bound (the bowl floor or
 * a plane) and an upper plane dot(p, n) = level, rebuilt in place (fixed
 * topology, analytic normals). Used for the beer and its foam.
 */
class LevelVolume {
  geo = new THREE.BufferGeometry()
  private pos: Float32Array
  private nor: Float32Array
  private rows: number
  sideCount: number
  private capStart: number
  private botStart: number
  constructor(
    private rTab: Float32Array,
    private y0: number,
    private y1: number,
    rows: number,
    private bottom: boolean,
  ) {
    this.rows = rows
    const cols = SEG + 1
    this.sideCount = cols * (rows + 1)
    this.capStart = this.sideCount
    const capCount = 1 + CAP_RINGS * cols
    this.botStart = this.capStart + capCount
    const total = this.botStart + (bottom ? 1 + cols : 0)
    this.pos = new Float32Array(total * 3)
    this.nor = new Float32Array(total * 3)
    const idx: number[] = []
    for (let i = 0; i < SEG; i++) {
      for (let k = 0; k < rows; k++) {
        const a = i * (rows + 1) + k
        const b = (i + 1) * (rows + 1) + k
        const c = a + 1
        const d = b + 1
        idx.push(a, c, b, c, d, b)
      }
    }
    // cap: centre fan + rings (ring CAP_RINGS is the wall edge)
    const cc = this.capStart
    const ring = (r: number, i: number) => cc + 1 + (r - 1) * cols + i
    for (let i = 0; i < SEG; i++) idx.push(cc, ring(1, i + 1), ring(1, i))
    for (let r = 1; r < CAP_RINGS; r++)
      for (let i = 0; i < SEG; i++) {
        const a = ring(r, i)
        const b = ring(r, i + 1)
        const c = ring(r + 1, i)
        const d = ring(r + 1, i + 1)
        idx.push(a, b, c, b, d, c)
      }
    if (bottom) {
      const bc = this.botStart
      for (let i = 0; i < SEG; i++) idx.push(bc, bc + 1 + i, bc + 2 + i)
    }
    this.geo.setIndex(idx)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage))
    // bounds never exceed the glass: set once (no per-rebuild recompute)
    let rMax = 0
    for (const r of rTab) rMax = Math.max(rMax, r)
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (y0 + y1) / 2, 0), Math.hypot(rMax, (y1 - y0) / 2) + 0.05)
    this.geo.boundingBox = new THREE.Box3(new THREE.Vector3(-rMax, y0, -rMax), new THREE.Vector3(rMax, y1, rMax))
  }

  r(y: number) {
    const t = Math.min(1, Math.max(0, (y - this.y0) / (this.y1 - this.y0))) * (RTAB - 1)
    const i = Math.min(RTAB - 2, Math.floor(t))
    const f = t - i
    return this.rTab[i] + (this.rTab[i + 1] - this.rTab[i]) * f
  }
  dr(y: number) {
    const e = (this.y1 - this.y0) / RTAB
    return (this.r(y + e) - this.r(y - e)) / (2 * e)
  }

  /** the height on column (cos, sin) where dot(p, n) reaches `level`, scanning up from `from` */
  private solve(c: number, s: number, n: THREE.Vector3, level: number, from: number) {
    const lin = c * n.x + s * n.z
    const f = (y: number) => this.r(y) * lin + y * n.y - level
    let ya = from
    let fa = f(ya)
    if (fa >= 0) return from
    const steps = 40
    const h = (this.y1 - from) / steps
    for (let k = 1; k <= steps; k++) {
      const yb = from + h * k
      const fb = f(yb)
      if (fb >= 0) return ya + (yb - ya) * (fa / (fa - fb))
      ya = yb
      fa = fb
    }
    return this.y1
  }

  /**
   * Fill between `lower` (a level, or null = the bowl floor) and `upper`
   * (levels along the unit normal n, in local units), with a dome on top.
   */
  build(n: THREE.Vector3, upper: number, lower: number | null, dome: number) {
    const rows = this.rows
    const P = this.pos
    const N = this.nor
    const tops = TMP_TOPS
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2
      const c = Math.cos(th)
      const s = Math.sin(th)
      const lo = lower == null ? this.y0 : this.solve(c, s, n, lower, this.y0)
      const hi = Math.max(lo, this.solve(c, s, n, upper, this.y0))
      tops[i] = hi
      for (let k = 0; k <= rows; k++) {
        const y = lo + ((hi - lo) * k) / rows
        const r = Math.max(0.0005, this.r(y) - INSET)
        const o = (i * (rows + 1) + k) * 3
        P[o] = r * c
        P[o + 1] = y
        P[o + 2] = r * s
        const d = -this.dr(y)
        const l = Math.hypot(1, d)
        N[o] = c / l
        N[o + 1] = d / l
        N[o + 2] = s / l
      }
    }
    // cap: the plane's centre on the axis, lifted into a dome
    const yc = Math.min(this.y1, Math.max(lower == null ? this.y0 : lower / Math.max(0.2, n.y), upper / Math.max(0.2, n.y)))
    const cc = this.capStart * 3
    P[cc] = n.x * dome
    P[cc + 1] = yc + n.y * dome
    P[cc + 2] = n.z * dome
    N[cc] = n.x
    N[cc + 1] = n.y
    N[cc + 2] = n.z
    for (let r = 1; r <= CAP_RINGS; r++) {
      const u = r / CAP_RINGS
      const lift = dome * (1 - u * u)
      for (let i = 0; i <= SEG; i++) {
        const th = (i / SEG) * Math.PI * 2
        const c = Math.cos(th)
        const s = Math.sin(th)
        const y = tops[i]
        const rr = Math.max(0.0005, this.r(y) - INSET)
        const ex = rr * c
        const ez = rr * s
        const px = ex * u
        const py = yc + (y - yc) * u
        const pz = ez * u
        const o = (this.capStart + 1 + (r - 1) * (SEG + 1) + i) * 3
        P[o] = px + n.x * lift
        P[o + 1] = py + n.y * lift
        P[o + 2] = pz + n.z * lift
        // dome normal: tilt n outward by the slope
        const slope = (2 * dome * u) / Math.max(0.02, rr)
        let nx = n.x + c * slope
        let ny = n.y
        let nz = n.z + s * slope
        const l = Math.hypot(nx, ny, nz)
        nx /= l
        ny /= l
        nz /= l
        N[o] = nx
        N[o + 1] = ny
        N[o + 2] = nz
      }
    }
    if (this.bottom) {
      const b = this.botStart * 3
      const yb = this.y0
      P[b] = 0
      P[b + 1] = yb
      P[b + 2] = 0
      N[b] = 0
      N[b + 1] = -1
      N[b + 2] = 0
      const rb = Math.max(0.0005, this.r(yb) - INSET)
      for (let i = 0; i <= SEG; i++) {
        const th = (i / SEG) * Math.PI * 2
        const o = b + (1 + i) * 3
        P[o] = rb * Math.cos(th)
        P[o + 1] = yb
        P[o + 2] = rb * Math.sin(th)
        N[o] = 0
        N[o + 1] = -1
        N[o + 2] = 0
      }
    }
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true
  }
}
const TMP_TOPS = new Float32Array(SEG + 1)

// ─── bubbles: instanced carbonation streams ──────────────────────────────────

const BUBBLE_VERT = /* glsl */ `
  attribute vec4 aSeed;   // x site angle, y site radius (0..1), z speed, w phase
  attribute float aSite;  // which stream (0..1)
  uniform float uTime, uLevel, uAmount, uSize, uPush, uScale, uY0, uY1;
  uniform vec3 uN;
  uniform float uR[${RTAB}];
  varying vec2 vUv;
  varying float vA;
  float rAt(float y) {
    float t = clamp((y - uY0) / (uY1 - uY0), 0.0, 1.0) * ${(RTAB - 1).toFixed(1)};
    int i = int(min(floor(t), ${(RTAB - 2).toFixed(1)}));
    return mix(uR[i], uR[i + 1], t - float(i));
  }
  void main() {
    vUv = uv;
    // a nucleation site near the floor (a few on the walls), bubbles rising
    // straight up in the WORLD (along uN) from it, a little wobble
    float ang = aSite * 6.2832;
    float y0 = uY0 + 0.012 + fract(aSite * 7.13) * 0.05;
    float rad = sqrt(fract(aSite * 3.71)) * 0.75 * rAt(y0);
    vec3 site = vec3(cos(ang) * rad, y0, sin(ang) * rad);
    float span = (uY1 - uY0) * 1.1;
    float t = fract(aSeed.w + uTime * aSeed.z);
    vec3 p = site + uN * (t * span);
    p.x += sin(t * 23.0 + aSeed.x * 6.0) * 0.004;
    p.z += cos(t * 19.0 + aSeed.x * 5.0) * 0.004;
    float r = rAt(p.y) - 0.02;
    float inside = step(length(p.xz), r) * step(dot(p, uN), uLevel - 0.01) * step(uY0, p.y);
    // only some streams run at low carbonation
    float on = step(aSeed.y, uAmount);
    vA = inside * on * smoothstep(0.0, 0.08, t);
    float size = uSize * (0.55 + 0.9 * t) * (0.7 + 0.6 * aSeed.x);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // bubbles sit INSIDE the beer: pull them in front of its surface
    mv.xyz += normalize(-mv.xyz) * uPush;
    mv.xy += (uv - 0.5) * size * uScale * step(0.001, vA);
    gl_Position = projectionMatrix * mv;
  }
`
const BUBBLE_FRAG = /* glsl */ `
  uniform vec3 uTint;
  uniform float uBright;
  varying vec2 vUv;
  varying float vA;
  void main() {
    if (vA < 0.001) discard;
    vec2 q = vUv - 0.5;
    float d = length(q) * 2.0;
    if (d > 1.0) discard;
    float ring = smoothstep(0.45, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d));
    float glint = exp(-dot(q - vec2(-0.14, 0.16), q - vec2(-0.14, 0.16)) * 180.0);
    vec3 c = uTint * ring * 0.4 + vec3(1.0, 0.97, 0.9) * glint * 1.2;
    gl_FragColor = vec4(c * vA * uBright, 1.0);
  }
`

// ─── the glass ───────────────────────────────────────────────────────────────

export interface Glass {
  group: THREE.Group
  /** tilts the glass about its base centre (setTilt); the liquid stays level */
  pivot: THREE.Group
  glass: THREE.Mesh
  beer: THREE.Mesh
  foam: THREE.Mesh
  /** instanced carbonation (null without the `bubbles` option) */
  bubbles: THREE.Mesh | null
  /** height of the rim (local units, before `scale`) */
  height: number
  /** 0 empty .. 1 full to the rim (foam included) */
  setFill(f: number): void
  /** foam height as a fraction of the glass height */
  setHead(h: number): void
  setBeer(style: BeerStyle): void
  /** tilt the glass (radians about its local z, positive leans toward -x); the liquid stays level */
  setTilt(rad: number): void
  /** a small surface tilt (radians about x / z) for sloshes; liquid-like motion */
  setSlosh(x: number, z: number): void
  /** 0..1.5 the studio strip highlights on the glass (1 default) */
  setStrips(k: number): void
  /** 0..1 inner glow of the beer (0.3 default): the backlit amber */
  setGlow(k: number): void
  /** 0..1 carbonation (which share of the streams run) */
  setBubbles(k: number): void
  /** per frame (idle): bubbles rise with time */
  update(time: number): void
  /** world position of the rim's centre */
  mouth(out: THREE.Vector3): THREE.Vector3
  dispose(): void
}

export function makeGlass({
  shape = 'tulip',
  beer = BEERS.amber as BeerStyle,
  scale = 1,
  fill = 0.9,
  head = 0.1,
  bubbles = 0,
  cheap = false,
}: {
  shape?: GlassShape
  beer?: BeerStyle
  scale?: number
  fill?: number
  head?: number
  /** number of carbonation bubbles (0 = none; ~120–240 for a hero glass) */
  bubbles?: number
  /** a non-transmissive stand-in for far / dim glasses */
  cheap?: boolean
} = {}): Glass {
  const group = new THREE.Group()
  const pivot = new THREE.Group()
  group.add(pivot)
  const pts = smoothProfile(PROFILES[shape])
  const height = pts[pts.length - 1].y
  const floor = BOWL_FLOOR[shape]

  // the glass: a thin shell (outer profile + inner offset)
  const inner = pts.map(p => new THREE.Vector2(Math.max(0, p.x - WALL), p.y)).filter(p => p.y >= floor - 0.02)
  const shell = [...pts, ...inner.slice().reverse()]
  const glassGeo = new THREE.LatheGeometry(shell, 96)
  const edge = { value: 0.6 }
  const tint = { value: 0.09 }
  const stemGlow = { value: new THREE.Color(0, 0, 0) }
  const floorU = { value: floor }
  const stripsU = { value: 1 }
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 0.035,
    ior: 1.5,
    specularIntensity: 1,
    envMapIntensity: 2.2,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  })
  glassMat.onBeforeCompile = sh => {
    sh.uniforms.uGEdge = edge
    sh.uniforms.uGTint = tint
    sh.uniforms.uStemGlow = stemGlow
    sh.uniforms.uFloor = floorU
    sh.uniforms.uStrips = stripsU
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying float vGy;\nvoid main() {\n  vGy = position.y;')
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uGEdge, uGTint, uFloor, uStrips;\nuniform vec3 uStemGlow;\nvarying float vGy;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          float nv = abs(dot(normalize(normal), normalize(vViewPosition)));
          float fr = 1.0 - nv;
          fr = fr * fr * fr;
          // premultiplied: rgb = the reflections, alpha = how much of the
          // world behind the glass it dims (a whisper face-on, more at the edges)
          // the solid stem and foot: thicker glass, it shows more (and
          // carries the beer's light down it like a light pipe)
          float solid = 1.0 - smoothstep(uFloor - 0.03, uFloor + 0.01, vGy);
          gl_FragColor.rgb += uStemGlow * solid * (0.4 + 0.6 * nv);
          // product-shot edges: a thin bright line right at the silhouette (the
          // rim lights / strips catching the curve), a darker refraction band
          // just inside it — the glass reads on dark AND on bright grounds
          float hi = smoothstep(0.86, 0.985, fr);
          float band = smoothstep(0.5, 0.8, fr) * (1.0 - smoothstep(0.9, 0.99, fr));
          gl_FragColor.rgb += vec3(1.0, 0.9, 0.76) * hi * 0.32;
          // two studio strip boxes (left key strip, right fill strip): long
          // vertical highlights down the bowl, whatever the room reflects
          vec3 vn = normalize(normal);
          float sA = exp(-(vn.x + 0.6) * (vn.x + 0.6) / 0.0016) * smoothstep(-0.75, -0.2, vn.y + 0.35 * vn.z);
          float sB = exp(-(vn.x - 0.7) * (vn.x - 0.7) / 0.0009) * smoothstep(-0.75, -0.2, vn.y + 0.35 * vn.z);
          float strips = (sA * 1.0 + sB * 0.7) * uStrips;
          gl_FragColor.rgb += vec3(1.0, 0.96, 0.9) * strips;
          gl_FragColor.a = max(gl_FragColor.a, 0.0) + strips * 0.2;
          gl_FragColor.a = clamp(uGTint + solid * 0.14 + band * 0.45 + fr * uGEdge, 0.0, 0.9);
        }`,
      )
  }
  glassMat.customProgramCacheKey = () => 'glory-glass'
  const glass = new THREE.Mesh(glassGeo, glassMat)
  // clear glass casts almost nothing; the beer casts the shape
  glass.castShadow = false
  glass.renderOrder = 2

  // the bowl's inside radius, tabled from the floor to the rim
  const rTab = new Float32Array(RTAB)
  for (let i = 0; i < RTAB; i++) rTab[i] = radiusAt(inner, floor + ((height - floor) * i) / (RTAB - 1))

  const beerColor = new THREE.Color()
  const glowColor = new THREE.Color()
  const glowU = { value: 0.3 }
  /** the liquid's local y range (floor → surface), for the depth gradient */
  const byU = { value: new THREE.Vector2(floor, height) }
  const setBeerColors = (style: BeerStyle) => {
    beerColor.set(style.color)
    // the glow: the beer's colour lifted toward its own highlight (amber, never grey)
    const hsl = { h: 0, s: 0, l: 0 }
    beerColor.getHSL(hsl)
    glowColor.setHSL(Math.min(0.14, hsl.h + 0.035), Math.min(1, hsl.s * 0.92), Math.min(0.58, hsl.l * 1.1 + 0.05))
  }
  setBeerColors(beer)

  let beerMat: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial
  if (cheap) {
    beerMat = new THREE.MeshStandardMaterial({
      color: beerColor.clone().multiplyScalar(0.55),
      emissive: glowColor.clone(),
      emissiveIntensity: 0.5,
      roughness: 0.12,
      envMapIntensity: 0.9,
    })
  } else {
    beerMat = new THREE.MeshPhysicalMaterial({
      color: beerColor.clone().lerp(new THREE.Color(1, 1, 1), 0.5),
      roughness: 0.06,
      transmission: 1,
      thickness: 0.55,
      ior: 1.34,
      attenuationColor: beerColor.clone(),
      attenuationDistance: beer.depth * 3,
      specularIntensity: 1,
      envMapIntensity: 1.1,
      emissive: glowColor.clone(),
      emissiveIntensity: 1,
    })
  }
  beerMat.onBeforeCompile = sh => {
    sh.uniforms.uGlow = glowU
    sh.uniforms.uBy = byU
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vBy;\nvoid main() {\n  vBy = position.y;')
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uGlow;\nuniform vec2 uBy;\nvarying float vBy;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      {
        // thicker toward the middle of the glass: the glow gathers there;
        // deeper low in the bowl, brightest just under the head
        float nv = abs(dot(normalize(normal), normalize(vViewPosition)));
        float h = clamp((vBy - uBy.x) / max(0.02, uBy.y - uBy.x), 0.0, 1.0);
        totalEmissiveRadiance *= uGlow * (0.06 + 0.94 * nv * nv * nv) * (0.4 + 0.85 * h * h);
      }`,
      )
      .replace(
        '#include <transmission_fragment>',
        `#include <transmission_fragment>
      {
        float h2 = clamp((vBy - uBy.x) / max(0.02, uBy.y - uBy.x), 0.0, 1.0);
        totalDiffuse *= 0.55 + 0.6 * h2;
      }`,
      )
  }
  beerMat.customProgramCacheKey = () => (cheap ? 'glory-beer-cheap' : 'glory-beer')

  // foam: matte cream that must never blow out under the key (it is the
  // brightest diffuse surface in most shots) — low env, no sheen
  const foamMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(beer.foam).multiplyScalar(0.62),
    roughness: 0.95,
    envMapIntensity: 0.3,
    bumpMap: foamBump(),
    bumpScale: 1.1,
  })

  const liquid = new LevelVolume(rTab, floor, height, 18, true)
  const cap = new LevelVolume(rTab, floor, height, 5, false)
  // UVs aren't generated for the level volumes: the foam's bump uses a
  // triplanar-free trick — a tiny generated uv from position
  const foamUv = new Float32Array((cap.geo.attributes.position as THREE.BufferAttribute).count * 2)
  cap.geo.setAttribute('uv', new THREE.BufferAttribute(foamUv, 2).setUsage(THREE.DynamicDrawUsage))
  const beerMesh = new THREE.Mesh(liquid.geo, beerMat)
  const foamMesh = new THREE.Mesh(cap.geo, foamMat)
  beerMesh.renderOrder = 0
  beerMesh.castShadow = true
  foamMesh.castShadow = false
  pivot.add(beerMesh, foamMesh, glass)

  // carbonation
  let bubbleMesh: THREE.Mesh | null = null
  let bubbleMat: THREE.ShaderMaterial | null = null
  const nU = new THREE.Vector3(0, 1, 0)
  if (bubbles > 0) {
    const geo = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    geo.index = quad.index
    geo.setAttribute('position', quad.attributes.position)
    geo.setAttribute('uv', quad.attributes.uv)
    const seeds = new Float32Array(bubbles * 4)
    const sites = new Float32Array(bubbles)
    let sd = 13
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647)
    const streams = Math.max(6, Math.round(bubbles / 14))
    const siteSeeds = Array.from({ length: streams }, () => rnd())
    const siteOn = Array.from({ length: streams }, () => rnd())
    for (let i = 0; i < bubbles; i++) {
      const s = i % streams
      seeds[i * 4] = rnd()
      seeds[i * 4 + 1] = siteOn[s] * 0.95
      seeds[i * 4 + 2] = 0.16 + rnd() * 0.14 + siteSeeds[s] * 0.1
      seeds[i * 4 + 3] = rnd()
      sites[i] = siteSeeds[s]
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    geo.setAttribute('aSite', new THREE.InstancedBufferAttribute(sites, 1))
    geo.instanceCount = bubbles
    const rArr = Array.from(rTab, r => r - INSET)
    bubbleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uAmount: { value: 1 },
        uSize: { value: 0.0085 },
        uPush: { value: 0.42 * scale },
        uScale: { value: scale },
        uY0: { value: floor },
        uY1: { value: height },
        uN: { value: nU },
        uR: { value: rArr },
        uTint: { value: new THREE.Color(beer.foam) },
        uBright: { value: 1.2 },
      },
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    bubbleMesh = new THREE.Mesh(geo, bubbleMat)
    bubbleMesh.frustumCulled = false
    bubbleMesh.renderOrder = 1
    pivot.add(bubbleMesh)
  }

  group.scale.setScalar(scale)

  let curFill = -1
  let curHead = -1
  let tilt = 0
  let slx = 0
  let slz = 0
  let curKey = ''
  const n = new THREE.Vector3()
  const rebuild = (f: number, h: number) => {
    f = Math.max(0, Math.min(1, f))
    h = Math.max(0, Math.min(0.3, h))
    const key = `${f.toFixed(4)}|${h.toFixed(4)}|${tilt.toFixed(4)}|${slx.toFixed(4)}|${slz.toFixed(4)}`
    curFill = f
    curHead = h
    if (key === curKey) return
    curKey = key
    // world up in the pivot's frame (+ the slosh), the surface normal
    n.set(Math.sin(tilt), Math.cos(tilt), 0)
    n.x += slz
    n.z += slx
    n.normalize()
    const top = floor + (height - 0.02 - floor) * f
    const headH = Math.min(h * height, Math.max(0, top - floor))
    const levelTop = top * n.y
    const levelLiquid = (top - headH) * n.y
    const liquidOn = top - headH > floor + 0.004
    beerMesh.visible = liquidOn
    if (liquidOn) liquid.build(n, levelLiquid, null, 0)
    byU.value.set(floor, Math.max(floor + 0.05, top - headH))
    foamMesh.visible = headH > 0.002
    if (foamMesh.visible) {
      cap.build(n, levelTop, levelLiquid, Math.min(0.028, headH * 0.35))
      // uv from position: around the bowl on the side, planar across the top
      // (both at the same density, so the bubbles stay round)
      const p = cap.geo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i)
        const y = p.getY(i)
        const z = p.getZ(i)
        if (i < cap.sideCount) {
          const r = Math.hypot(x, z)
          foamUv[i * 2] = (Math.atan2(z, x) / (Math.PI * 2)) * Math.max(1, Math.round(r * 2 * Math.PI * 4.5))
          foamUv[i * 2 + 1] = y * 4.5
        } else {
          foamUv[i * 2] = x * 4.5
          foamUv[i * 2 + 1] = z * 4.5
        }
      }
      ;(cap.geo.attributes.uv as THREE.BufferAttribute).needsUpdate = true
    }
    stemGlow.value.copy(glowColor).multiplyScalar(liquidOn ? 0.12 * Math.min(1, (top - headH - floor) / 0.2) : 0)
    if (bubbleMat) {
      nU.copy(n)
      bubbleMat.uniforms.uLevel.value = liquidOn ? levelLiquid : -1
    }
  }
  rebuild(fill, head)

  return {
    group,
    pivot,
    glass,
    beer: beerMesh,
    foam: foamMesh,
    bubbles: bubbleMesh,
    height,
    setFill: f => rebuild(f, curHead),
    setHead: h => rebuild(curFill, h),
    setTilt(rad) {
      tilt = rad
      pivot.rotation.z = rad
      rebuild(curFill, curHead)
    },
    setSlosh(x, z) {
      slx = x
      slz = z
      rebuild(curFill, curHead)
    },
    setGlow(k) {
      glowU.value = k
    },
    setStrips(k) {
      stripsU.value = k
    },
    setBubbles(k) {
      if (bubbleMat) bubbleMat.uniforms.uAmount.value = k
      if (bubbleMesh) bubbleMesh.visible = k > 0.001
    },
    update(time) {
      if (bubbleMat) bubbleMat.uniforms.uTime.value = time
    },
    mouth(out) {
      out.set(0, height, 0)
      return pivot.localToWorld(out)
    },
    setBeer(style) {
      setBeerColors(style)
      if (beerMat instanceof THREE.MeshPhysicalMaterial) {
        beerMat.attenuationColor.copy(beerColor)
        beerMat.attenuationDistance = style.depth * 3
        beerMat.color.copy(beerColor).lerp(new THREE.Color(1, 1, 1), 0.5)
      } else beerMat.color.copy(beerColor).multiplyScalar(0.55)
      beerMat.emissive.copy(glowColor)
      foamMat.color.set(style.foam).multiplyScalar(0.62)
      if (bubbleMat) (bubbleMat.uniforms.uTint.value as THREE.Color).set(style.foam)
    },
    dispose() {
      glassGeo.dispose()
      liquid.geo.dispose()
      cap.geo.dispose()
      glassMat.dispose()
      beerMat.dispose()
      foamMat.dispose()
      bubbleMesh?.geometry.dispose()
      bubbleMat?.dispose()
    },
  }
}

// ─── the backlight: what makes beer glow ─────────────────────────────────────

/**
 * An emissive soft card to stand BEHIND a glass (between it and the camera's
 * far side). It's drawn only into the transmission buffer — the beer sees it
 * and glows amber — and at `frameK` of that in the frame itself (0 =
 * invisible, the room stays dark). Keep it facing the camera:
 *
 *   const card = makeBacklight({ isFrameTarget: rt => ctx.post.isFrameTarget(rt) })
 *   card.mesh.position.set(0, 1.4, -0.9); card.mesh.lookAt(camera.position)
 *   card.set(1.0)   // intensity
 */
export function makeBacklight({
  width = 2.4,
  height = 3.2,
  color = '#ffd9a0',
  hdr = 2.4,
  frameK = 0,
  isFrameTarget,
}: {
  width?: number
  height?: number
  color?: THREE.ColorRepresentation
  hdr?: number
  frameK?: number
  isFrameTarget: (rt: THREE.WebGLRenderTarget | null) => boolean
}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 1 }, uI: { value: 1 }, uHdr: { value: hdr } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uK, uI, uHdr;
      varying vec2 vUv;
      void main() {
        // a softbox: bright core, long soft falloff (two bars read as studio light)
        vec2 q = (vUv - 0.5) * 2.0;
        float body = exp(-q.x * q.x * 2.2) * (1.0 - smoothstep(0.55, 1.0, abs(q.y)));
        float bars = exp(-(abs(q.x) - 0.42) * (abs(q.x) - 0.42) * 60.0) * (1.0 - smoothstep(0.7, 1.0, abs(q.y)));
        gl_FragColor = vec4(uColor * (body * 0.8 + bars * 0.6) * uHdr * uK * uI, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: false,
    toneMapped: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat)
  // after the opaque room (it adds light; never hides what's behind it)
  mesh.renderOrder = 5
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.onBeforeRender = renderer => {
    const rt = renderer.getRenderTarget() as THREE.WebGLRenderTarget | null
    mat.uniforms.uK.value = rt === null || isFrameTarget(rt) ? frameK : 1
    mat.uniformsNeedUpdate = true
  }
  return {
    mesh,
    set(intensity: number) {
      mat.uniforms.uI.value = intensity
      mesh.visible = intensity > 0.001
    },
    dispose() {
      mesh.geometry.dispose()
      mat.dispose()
    },
  }
}

// ─── the pour: a stream of beer from a spout ─────────────────────────────────

/**
 * A falling stream of beer (world space): a thin glossy rope from `from`
 * (the spout) to `to` (where it lands), thinning as it falls, rippling.
 *
 *   const s = makePourStream(BEERS.amber); scene.add(s.mesh)
 *   s.set(spoutWorld, landWorld, flow)   // flow 0..1 (0 hides it)
 *   s.update(time)
 */
export function makePourStream(style: BeerStyle = BEERS.amber, radius = 0.045) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 40, true)
  geo.translate(0, -0.5, 0) // y: 0 at the spout .. -1 at the landing
  const col = new THREE.Color(style.color)
  const hsl = { h: 0, s: 0, l: 0 }
  col.getHSL(hsl)
  const u = {
    uA: { value: new THREE.Vector3() },
    uB: { value: new THREE.Vector3() },
    uR: { value: radius },
    uFlow: { value: 1 },
    uT: { value: 0 },
    uHead: { value: 0 },
    uTail: { value: 1 },
  }
  const mat = new THREE.MeshPhysicalMaterial({
    color: col.clone().multiplyScalar(0.6),
    emissive: new THREE.Color().setHSL(Math.min(0.14, hsl.h + 0.04), hsl.s * 0.9, Math.min(0.58, hsl.l + 0.14)),
    emissiveIntensity: 0.9,
    roughness: 0.08,
    metalness: 0,
    ior: 1.34,
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.82,
  })
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    // thin at the silhouette (it's a rope of liquid, not a pipe)
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 0.25 + 0.75 * abs(dot(normalize(normal), normalize(vViewPosition)));`,
    )
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform vec3 uA, uB;\nuniform float uR, uFlow, uT, uHead, uTail;\nvoid main() {')
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = normalize(vec3(normal.x, 0.0, normal.z));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `float s = clamp(-position.y, 0.0, 1.0);
        // falls under gravity: a slight arc (the spout throws forward a touch)
        float s2 = mix(uHead, uTail, s);
        vec3 c = mix(uA, uB, s2);
        c.xz += (uB.xz - uA.xz) * 0.12 * sin(s2 * 3.1416);
        // thins as it accelerates; ripples travel down it
        float r = uR * uFlow * (1.0 - 0.45 * s2) * (1.0 + 0.1 * sin(s2 * 46.0 - uT * 26.0) + 0.05 * sin(s2 * 91.0 - uT * 41.0));
        vec3 transformed = c + vec3(normal.x, 0.0, normal.z) * r;`,
      )
  }
  mat.customProgramCacheKey = () => 'glory-stream'
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  return {
    mesh,
    /** head/tail 0..1: which part of the from→to line exists (a stream that starts / breaks off) */
    set(from: THREE.Vector3, to: THREE.Vector3, flow: number, head = 0, tail = 1) {
      u.uA.value.copy(from)
      u.uB.value.copy(to)
      u.uFlow.value = flow
      u.uHead.value = head
      u.uTail.value = tail
      mesh.visible = flow > 0.01 && tail - head > 0.005
    },
    update(time: number) {
      u.uT.value = time
    },
    setBeer(s: BeerStyle) {
      const c = new THREE.Color(s.color)
      c.getHSL(hsl)
      mat.color.copy(c).multiplyScalar(0.6)
      mat.emissive.setHSL(Math.min(0.14, hsl.h + 0.03), hsl.s * 0.9, Math.min(0.55, hsl.l + 0.1))
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}
