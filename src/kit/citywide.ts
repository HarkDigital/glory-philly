import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Frame } from '../core/types'
import { makePourStream } from './beer'

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  GLORY KIT — THE CITY WIDE SPECIAL (a can of Hamm's, a shot of Old
 *  Overholt Rye, a cube of Swiss cheese on a bamboo pick across the rim)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Product-film pieces, built to the real objects in Mike's photo (ref3):
 *  - a 12 oz can: lathed to the real profile (domed base + stand ring,
 *    straight wall, necked shoulder, double-seam rim, recessed lid), printed
 *    in Hamm's classic livery (royal blue, the white crown band with gold
 *    pines in the blue arches, the red serif wordmark, BEER, the white script
 *    lines — all drawn on canvas, no logo files), clear-varnished; the gold
 *    lid, the plain aluminium pull tab and the mouth open with setOpen(0..1).
 *  - a heavy-based shot glass: a solid 0.55" base, ten pressed flutes with
 *    rounded tops, a slight flare, a rolled rim. The glass is a clear
 *    NON-transmissive shell (reflections only) over the TRANSMISSIVE rye
 *    (amber attenuation, a meniscus) — transparent-in-transparent vanishes in
 *    three.js, so exactly one transmissive mesh per shot.
 *  - a cube of Swiss (pale butter yellow, waxy sheen, a few eyes), speared on
 *    a bamboo pick that rests across the rim on two contact points; the cube
 *    is placed by a clearance solver so no corner ever touches the glass.
 *  - optional: a rye bottle with a plain paper label, a rye pour stream.
 *
 * UNITS: kit/beer's scale (a pint glass is 1.12 tall; IN = 0.19 = one inch),
 * so the City Wide stands next to any kit glass. The vinyl kit is 1 unit =
 * 12.4": to stand it next to records, scale the City Wide group by 0.43, or
 * the records by 2.3. Every piece: base on y = 0, faces +z (the camera side).
 *
 * ─── copy-paste ────────────────────────────────────────────────────────────
 *
 *   import { makeCityWide } from '../../kit/citywide'
 *
 *   const cw = makeCityWide({ open: 0, fill: 0, cheese: 0 })   // labelRes: 1024 on phones
 *   group.add(cw.group)                      // can left, shot right-forward, base on y = 0
 *   // update(local, frame, ctx) — every value is absolute (jump anywhere):
 *   cw.setCanOpen(smoothstep(0.1, 0.25, local))         // tab lifts, the mouth opens
 *   cw.setShotFill(0.55 * smoothstep(0.3, 0.5, local))  // 0..1 of the bowl (0.55 = the photo)
 *   cw.setCheese(smoothstep(0.5, 0.7, local))           // 0 hidden … lowers in … 1 resting on the rim
 *   cw.setLight(keyDirWorld)                            // contact shadows lean away from the key
 *   cw.update(frame)
 *   // cameras / callouts: cw.anchors.can / .canTop / .shot / .rye / .cheese (Object3Ds →
 *   //   .getWorldPosition(v)); cw.size = the footprint box in the group frame
 *
 *   // the rye glows when there is light BEHIND it in the transmission buffer:
 *   // a kit/beer backlight lying flat on the bar ~0.5 behind the shot (invisible in frame)
 *   const bl = makeBacklight({ width: 0.7, height: 0.9, isFrameTarget: rt => ctx.post.isFrameTarget(rt) })
 *   bl.mesh.rotation.x = -Math.PI / 2; bl.mesh.position.set(shotX, 0.004, shotZ - 0.5); bl.set(0.2)
 *
 *   // pieces on their own
 *   const can = makeCan({ open: 1, cold: 0.5 })        // .setOpen(k) · .mouth(v) · .lid · .height · .radius
 *   const shot = makeShotGlass({ fill: 0.55 })         // .setFill · .setGlow · .setStrips · .setRoom · .mouth(v) · .level()
 *   const cube = makeCheeseCube(); const pick = makePick({ length: 4 })   // inches
 *   const bottle = makeRyeBottle({ fill: 1, cap: false })  // tip bottle.group yourself; .lip(v) = where a pour leaves
 *   const pour = makeRyePour(); scene.add(pour.mesh); pour.set(bottle.lip(a), cw.anchors.rye.getWorldPosition(b), flow)
 *   pour.update(frame.time)
 *
 * The glass, rye, metals and cheese also reflect a band of warm "room lamps"
 * (ROOM_GLSL: a studio reflection like kit/beer's strips) so rims, the
 * meniscus and the lid read in any chapter's light; shot.setRoom(k) tones it.
 *
 * PERFORMANCE: one transmissive mesh (the rye). The can is opaque (label
 * 2048×1024 canvas + a small PBR map; pass labelRes: 1024 on phones), each
 * glass shell is two single-pass premultiplied draws of lean geometry (far
 * wall, then near wall; ~9k tris each for the shot glass, ~18k for the
 * bottle, whose shoulder keeps its rows for the strips; see glassShell and
 * leanProfile), the bottle's whiskey is a cheap non-transmissive stand-in.
 * Every art canvas is freed (1×1) once its final pixels are on the GPU: art
 * textures freeze then — make a new piece to change them. Everything is
 * readable from any value you pass (no state accumulates); update(frame)
 * only drives idle shimmer.
 */

/** one inch in kit units (kit/beer's scale: a pint glass is 1.12 tall) */
export const IN = 0.19

const TAU = Math.PI * 2
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const rng = (seed: number) => {
  let s = Math.max(1, Math.floor(seed * 7919) % 2147483647)
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
/**
 * A canvas texture whose canvas is freed once the GPU has its final pixels: when `settled` resolves
 * (after the canvas's last redraw — post-fonts for text; at once for static art), the next upload
 * (or the one already done) shrinks the canvas to 1×1. three keeps the uploaded texture, so never
 * set needsUpdate after `settled`: redraw into a new texture instead.
 */
function canvasTex(c: HTMLCanvasElement, srgb = true, settled: Promise<unknown> = Promise.resolve()) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 8
  let armed = false
  let uploaded = -1
  const free = () => {
    t.onUpdate = null
    c.width = 1
    c.height = 1
  }
  t.onUpdate = () => {
    uploaded = t.version
    if (armed) free()
  }
  const arm = () => {
    armed = true
    if (uploaded === t.version) free()
  }
  void settled.then(arm, arm)
  return t
}

/** a smooth lathe profile (inches in, kit units out); centripetal: no overshoot at tight rolls */
function profile(pts: [number, number][], n: number): THREE.Vector2[] {
  const c = new THREE.CatmullRomCurve3(
    pts.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    false,
    'centripetal',
  )
  return c.getSpacedPoints(n).map(p => new THREE.Vector2(Math.max(0, p.x) * IN, p.y * IN))
}

/**
 * Thin a profile polyline, returning the kept indices (Ramer–Douglas–Peucker; the ends stay): a
 * span is split while a point strays more than `tol` from its chord, or while its tangent swings
 * more than `turn` radians anywhere inside it and it is longer than `minLen` — sharp studio strips
 * on a curved shoulder need its normals, not just its outline.
 */
function thinIdx(pts: THREE.Vector2[], tol: number, turn = Math.PI, minLen = 0): number[] {
  if (pts.length < 3) return pts.map((_, i) => i)
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const dir = (i: number) => Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const A = pts[a]
    const dx = pts[b].x - A.x
    const dy = pts[b].y - A.y
    const L = Math.hypot(dx, dy) || 1e-12
    let far = -1
    let fi = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / L
      if (d > far) {
        far = d
        fi = i
      }
    }
    // how far the tangent swings anywhere inside the span (a shoulder can bend out and back)
    let cum = 0
    let lo = 0
    let hi = 0
    for (let i = a + 1; i < b; i++) {
      let d = dir(i) - dir(i - 1)
      if (d > Math.PI) d -= 2 * Math.PI
      else if (d < -Math.PI) d += 2 * Math.PI
      cum += d
      lo = Math.min(lo, cum)
      hi = Math.max(hi, cum)
    }
    if (far > tol || (hi - lo > turn && L > minLen)) {
      if (far <= tol) fi = (a + b) >> 1
      keep[fi] = 1
      stack.push([a, fi], [fi, b])
    }
  }
  const out: number[] = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

/** a thinned profile with its TRUE normals (null: let the lathe work it out) */
interface Lean {
  pts: THREE.Vector2[]
  nor: (THREE.Vector2 | null)[]
}

/**
 * Thin a dense profile polyline (units; tol, minLen in inches; turn in degrees) and keep each kept
 * point's normal from its dense neighbours. LatheGeometry weights its vertex normals by the
 * lengths of the two chords either side, so on a thinned profile a long straight run would drag
 * the first normals of the curve beside it; the dense normals don't.
 */
function lean(dense: THREE.Vector2[], tol: number, turnDeg = 4, minLen = 0.04): Lean {
  const idx = thinIdx(dense, tol * IN, (turnDeg * Math.PI) / 180, minLen * IN)
  const last = dense.length - 1
  return {
    pts: idx.map(i => dense[i]),
    nor: idx.map(i => {
      const a = dense[Math.max(0, i - 1)]
      const b = dense[Math.min(last, i + 1)]
      return new THREE.Vector2(b.y - a.y, a.x - b.x).normalize()
    }),
  }
}

/** a lean lathe profile: the rims and shoulders keep their rows, straight walls and floors lose theirs */
function leanProfile(pts: [number, number][], tol: number, turnDeg = 4, minLen = 0.04): Lean {
  return lean(profile(pts, 480), tol, turnDeg, minLen)
}

/**
 * LatheGeometry over one or more lean pieces joined end to end: each piece's interior points get
 * their true normals (the ends, and nulls, keep the lathe's own, as the joins always had).
 */
function latheLean(pieces: Lean[], segments: number, phiStart = 0): THREE.LatheGeometry {
  const pts = pieces.flatMap(p => p.pts)
  const geo = new THREE.LatheGeometry(pts, segments, phiStart)
  const nor = geo.attributes.normal as THREE.BufferAttribute
  const P = pts.length
  let j0 = 0
  for (const piece of pieces) {
    for (let j = 1; j < piece.pts.length - 1; j++) {
      const n = piece.nor[j]
      if (!n) continue
      for (let i = 0; i <= segments; i++) {
        const phi = phiStart + (i / segments) * TAU
        nor.setXYZ(i * P + j0 + j, n.x * Math.sin(phi), n.y, n.x * Math.cos(phi))
      }
    }
    j0 += piece.pts.length
  }
  return geo
}

const SANS = '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif'
const SERIF = 'Georgia, "Times New Roman", Times, serif'
/**
 * The can's two slogans ("The beer…refreshing!", "From the land of sky blue waters*") are set in
 * italic on the real can (ref3) — product livery, not a heading, and not Instrument Serif. Pending
 * Mike's OK on that (his rule bans italic serif titles): '' sets them upright at the same size.
 */
const SLOGAN = 'italic '

let fontsReady: Promise<void> | null = null
function whenFonts(): Promise<void> {
  if (fontsReady) return fontsReady
  const f = document.fonts
  if (!f?.load) return (fontsReady = Promise.resolve())
  fontsReady = Promise.race([
    Promise.all([f.load(`800 40px ${SANS}`), f.load(`700 40px ${SERIF}`), f.load(`${SLOGAN}700 40px ${SERIF}`)]).then(() => undefined),
    new Promise<void>(r => setTimeout(r, 4000)),
  ]).catch(() => undefined)
  return fontsReady
}

// ─── the premultiplied clear-glass shell (after kit/beer) ────────────────────

/**
 * The bar as a reflection (world-space reflection vector in): a band of warm
 * lamps 12–40° up — brightest in two soft windows either side of the camera —
 * and the lit bar top below. The world's PMREM is mostly dark at the angles a
 * close product shot reflects; this gives rims, meniscus and facets their
 * crisp product-shot lines wherever the chapter puts its lights.
 */
const ROOM_GLSL = /* glsl */ `
vec3 cwRoom(vec3 rw, out float lampK) {
  float az = atan(rw.x, rw.z);
  float band = smoothstep(0.2, 0.3, rw.y) * (1.0 - smoothstep(0.52, 0.72, rw.y));
  float win = 0.3 + exp(-(az + 0.75) * (az + 0.75) / 0.12) + 0.75 * exp(-(az - 0.85) * (az - 0.85) / 0.09);
  lampK = band * win;
  float bounce = 1.0 - smoothstep(-0.5, -0.12, rw.y);
  return vec3(1.0, 0.84, 0.62) * lampK * 1.1 + vec3(0.2, 0.1, 0.045) * bounce * 0.5;
}
`

/**
 * Give a lit (standard/physical) material the room's lamps in its
 * reflections — base layer (tinted by metal) and clearcoat. k: strength.
 */
function withRoom<T extends THREE.MeshStandardMaterial>(mat: T, key: string, k = 1): T & { roomU: { value: number } } {
  const roomU = { value: k }
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r)
    sh.uniforms.uCwRoom = roomU
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `uniform float uCwRoom;\n${ROOM_GLSL}\nvoid main() {`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 vdir = normalize(vViewPosition);
          float lampK;
          vec3 roomC = cwRoom(inverseTransformDirection(reflect(-vdir, normal), viewMatrix), lampK) * uCwRoom;
          float fw = pow(1.0 - saturate(dot(normal, vdir)), 5.0);
          vec3 Fr = material.specularColorBlended + (vec3(1.0) - material.specularColorBlended) * fw;
          float gl = 1.0 - material.roughness;
          reflectedLight.indirectSpecular += roomC * Fr * gl * gl;
          #ifdef USE_CLEARCOAT
            float lk2;
            vec3 roomCc = cwRoom(inverseTransformDirection(reflect(-vdir, clearcoatNormal), viewMatrix), lk2) * uCwRoom;
            float fc = 0.04 + 0.96 * pow(1.0 - saturate(dot(clearcoatNormal, vdir)), 5.0);
            float gc = 1.0 - material.clearcoatRoughness;
            reflectedLight.indirectSpecular += roomCc * fc * material.clearcoat * gc * gc;
          #endif
        }`,
      )
  }
  const prevKey = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => `${prevKey()}|cwroom-${key}`
  return Object.assign(mat, { roomU })
}

/**
 * A clear glass shell drawn AFTER the liquid as premultiplied reflections:
 * the studio strips, bulbs and key on it, a Fresnel edge, a darker
 * refraction band inside the silhouette. `floor` = the local height (units)
 * below which the glass is solid (a heavy base): it shows more, and carries
 * the liquid's glow down it.
 *
 * Two materials sharing the uniforms: `back` draws the far wall (back faces),
 * then `front` the near wall — see glassShell().
 */
function clearGlass(floor: number, { tint = 0.06, edge = 0.55, solid = 0.2, facets = false } = {}) {
  const u = {
    uGEdge: { value: edge },
    uGTint: { value: tint },
    uFloor: { value: floor },
    uStrips: { value: 0.38 },
    uSolidK: { value: solid },
    uGlowC: { value: new THREE.Color(0, 0, 0) },
    uRoom: { value: 1 },
  }
  const make = (side: THREE.Side) => shellMat(side, u, facets)
  return { front: make(THREE.FrontSide), back: make(THREE.BackSide), u }
}

/**
 * A glass shell as two single-pass meshes on one geometry: the far wall (back faces) under
 * the near wall (front faces). That is the order three's DoubleSide transparency gives,
 * without its cost: it draws one mesh twice and flips material.side with needsUpdate
 * around each draw, re-resolving the program every frame. `mesh` is the near wall; the
 * far wall rides on it as a child. The pair sorts as ONE object among the other
 * transparents (same renderOrder, same depth): three's stable sort then breaks the tie
 * by id, and the far wall is made first.
 */
function glassShell(geo: THREE.BufferGeometry, floor: number, opts: Parameters<typeof clearGlass>[1]) {
  const { front, back, u } = clearGlass(floor, opts)
  const far = new THREE.Mesh(geo, back)
  const mesh = new THREE.Mesh(geo, front)
  mesh.renderOrder = far.renderOrder = 2
  mesh.castShadow = far.castShadow = false
  mesh.add(far)
  return {
    mesh,
    u,
    dispose() {
      front.dispose()
      back.dispose()
    },
  }
}

function shellMat(side: THREE.Side, u: Record<string, THREE.IUniform>, facets: boolean) {
  const mat = new THREE.MeshPhysicalMaterial({
    side,
    color: 0x000000,
    metalness: 0,
    roughness: 0.03,
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
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader.replace(
      'void main() {',
      facets
        ? 'attribute float aFacet;\nvarying float vGy;\nvarying float vFacet;\nvoid main() {\n  vGy = position.y;\n  vFacet = aFacet;'
        : 'varying float vGy;\nvoid main() {\n  vGy = position.y;',
    )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        `uniform float uGEdge, uGTint, uFloor, uStrips, uSolidK, uRoom;\nuniform vec3 uGlowC;\nvarying float vGy;\n${facets ? 'varying float vFacet;' : 'const float vFacet = 0.0;'}\n${ROOM_GLSL}\nvoid main() {`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          vec3 vn = normalize(normal);
          // |dot| of two normalized vectors can land a hair over 1: pow(1 - nv) of a negative is NaN
          float nv = min(abs(dot(vn, normalize(vViewPosition))), 1.0);
          float fr = 1.0 - nv;
          fr = fr * fr * fr;
          // the far wall's surfaces, seen through the near one, show less
          float back = gl_FrontFacing ? 1.0 : 0.55;
          gl_FragColor.rgb *= back;
          // the heavy base: solid glass, it shows (and pipes the liquid's glow)
          float solid = 1.0 - smoothstep(uFloor - 0.014, uFloor + 0.004, vGy);
          gl_FragColor.rgb += uGlowC * solid * (0.35 + 0.65 * nv);
          gl_FragColor.rgb += vec3(0.020, 0.024, 0.024) * solid * (0.4 + 0.6 * fr);
          // the room in the glass (Schlick, glass F0 0.04)
          vec3 rw = inverseTransformDirection(reflect(-normalize(vViewPosition), vn), viewMatrix);
          float lampK;
          vec3 room = cwRoom(rw, lampK);
          float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
          gl_FragColor.rgb += room * uRoom * (0.1 + 2.6 * F) * back;
          float hi = smoothstep(0.86, 0.985, fr);
          float rband = smoothstep(0.5, 0.8, fr) * (1.0 - smoothstep(0.9, 0.99, fr));
          gl_FragColor.rgb += vec3(1.0, 0.9, 0.76) * hi * 0.3;
          float sA = exp(-(vn.x + 0.6) * (vn.x + 0.6) / 0.0009) * smoothstep(-0.75, -0.2, vn.y + 0.35 * vn.z);
          float sB = exp(-(vn.x - 0.7) * (vn.x - 0.7) / 0.0005) * smoothstep(-0.75, -0.2, vn.y + 0.35 * vn.z);
          // flat flutes flash whole (a facet catching the strip): calmer there
          float strips = (sA + sB * 0.7) * uStrips * (1.0 - 0.88 * vFacet);
          gl_FragColor.rgb += vec3(1.0, 0.96, 0.9) * strips;
          gl_FragColor.a = clamp(uGTint + solid * uSolidK + rband * 0.45 + fr * uGEdge + strips * 0.2 + lampK * uRoom * 0.22, 0.0, 0.9);
        }`,
      )
  }
  mat.customProgramCacheKey = () => (facets ? 'cw-glass-f' : 'cw-glass')
  return mat
}

// ═══ THE CAN ════════════════════════════════════════════════════════════════

/** 12 oz standard can (inches): 2.60" body, 4.83" tall, 202 lid */
const CAN = { R: 1.3, H: 4.83, print0: 0.46, print1: 4.6, panelY: 4.62, panelR: 0.955 }

const CAN_BASE: [number, number][] = [
  [0, 0.4], [0.3, 0.388], [0.58, 0.34], [0.78, 0.25], [0.88, 0.15], [0.93, 0.06], [0.955, 0.014], [0.985, 0], [1.02, 0.006],
  [1.08, 0.05], [1.17, 0.15], [1.245, 0.27], [1.285, 0.38], [1.3, 0.46],
]
const CAN_BODY: [number, number][] = [
  [1.3, 0.46], [1.3, 1.6], [1.3, 2.8], [1.3, 3.7], [1.3, 4.08], [1.296, 4.16], [1.278, 4.25], [1.235, 4.35], [1.17, 4.45],
  [1.11, 4.53], [1.075, 4.582], [1.066, 4.6],
]
const CAN_TOP: [number, number][] = [
  [1.066, 4.6], [1.072, 4.65], [1.084, 4.71], [1.089, 4.77], [1.085, 4.808], [1.07, 4.83], [1.05, 4.831], [1.036, 4.818],
  [1.031, 4.785], [1.025, 4.7], [1.012, 4.628], [0.996, 4.598], [0.976, 4.6], [0.962, 4.612], [0.955, 4.62],
]

/** the mouth (score line) outline in lid coords (x right, z toward the mouth), inches */
function mouthOutline(n = 44): THREE.Vector2[] {
  const out: THREE.Vector2[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    const z = 0.54 - 0.32 * Math.cos(t)
    const w = 0.285 - 0.05 * Math.cos(t)
    out.push(new THREE.Vector2(w * Math.sin(t), z))
  }
  return out
}
const MOUTH_HINGE = 0.22

interface LabelInks {
  blue: string
  white: string
  gold: string
  red: string
  navy: string
  script: string
}
const INK_COLOR: LabelInks = {
  blue: '#1d4db3',
  white: '#f1efe6',
  gold: '#d4ae5e',
  red: '#d2302a',
  navy: '#18214d',
  script: '#f5f3ea',
}
// PBR map inks: G = roughness, B = metalness (printed over bare aluminium:
// the blue and the gold are metallic inks, the white band is an opaque basecoat)
const INK_RM: LabelInks = {
  blue: 'rgb(0,84,80)',
  white: 'rgb(0,104,0)',
  gold: 'rgb(0,74,95)',
  red: 'rgb(0,88,30)',
  navy: 'rgb(0,88,70)',
  script: 'rgb(0,104,0)',
}

/** fit a single line of text into maxW by squeezing it (never grows) */
function fitText(g: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, stretch = 1) {
  const w = g.measureText(s).width * stretch
  const k = Math.min(stretch, (maxW / Math.max(1, w)) * stretch)
  g.save()
  g.translate(x, y)
  g.scale(k, 1)
  g.fillText(s, 0, 0)
  g.restore()
}

/**
 * Hamm's classic livery, twice round the can (two faces, each centred on a
 * white crown point). W × H covers the printed band CAN.print0..print1; face
 * centres at u = 0.25 and 0.75.
 */
function drawHamms(g: CanvasRenderingContext2D, W: number, H: number, ink: LabelInks) {
  const pv = H / (CAN.print1 - CAN.print0) // px per inch, vertical
  const ph = W / (TAU * CAN.R) // px per inch, around
  const yAt = (h: number) => (CAN.print1 - h) * pv
  const F = W / 2
  const s = W / 2048
  g.fillStyle = ink.blue
  g.fillRect(0, 0, W, H)

  // the white band: a crown of pointed white peaks between round-bottomed blue arches
  const P = F / 6
  const yTip = yAt(3.22)
  const yU = yAt(2.12)
  const yBand = yAt(1.04)
  const D = yU - yTip
  g.fillStyle = ink.white
  g.beginPath()
  g.moveTo(0, yTip)
  for (let j = 0; j < 12; j++) {
    const xs = j * P
    g.bezierCurveTo(xs + 0.13 * P, yTip + 0.42 * D, xs + 0.22 * P, yU, xs + 0.5 * P, yU)
    g.bezierCurveTo(xs + 0.78 * P, yU, xs + 0.87 * P, yTip + 0.42 * D, xs + P, yTip)
  }
  g.lineTo(W, yBand)
  g.lineTo(0, yBand)
  g.closePath()
  g.fill()

  // gold pines standing in the blue arches: stacked bars, a short barred trunk
  g.fillStyle = ink.gold
  const tTop = yTip + 0.02 * D
  const tBot = yTip + 0.75 * D
  const halfW = 0.2 * P
  const bars = 17
  const pitch = (tBot - tTop) / bars
  for (let j = 0; j < 12; j++) {
    const xc = j * P + P / 2
    for (let b = 0; b < bars; b++) {
      const y0 = tTop + b * pitch + pitch * 0.32
      const y1 = tTop + (b + 1) * pitch
      const w0 = halfW * ((y0 - tTop) / (tBot - tTop))
      const w1 = halfW * ((y1 - tTop) / (tBot - tTop))
      g.beginPath()
      g.moveTo(xc - w0, y0)
      g.lineTo(xc + w0, y0)
      g.lineTo(xc + w1, y1)
      g.lineTo(xc - w1, y1)
      g.closePath()
      g.fill()
    }
    const tw = halfW * 0.26
    for (let b = 0; b < 4; b++) {
      const y0 = tBot + b * pitch + pitch * 0.32
      g.fillRect(xc - tw, y0, tw * 2, pitch * 0.68)
    }
  }

  for (let f = 0; f < 2; f++) {
    const cx = F * f + F / 2
    // "The beer...refreshing!" — the white script line, rising left to right
    g.fillStyle = ink.script
    g.save()
    g.translate(cx, yAt(3.74))
    g.rotate(-0.075)
    g.font = `${SLOGAN}700 ${Math.round(66 * s)}px ${SERIF}`
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    fitText(g, 'The beer…refreshing!', 0, 0, 2.3 * ph)
    g.restore()

    // the red serif wordmark
    g.fillStyle = ink.red
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.font = `700 ${Math.round(168 * s)}px ${SERIF}`
    const mark = 'Hamm’s'
    const mw = Math.min(g.measureText(mark).width * 1.04, 2.3 * ph)
    fitText(g, mark, cx, yAt(1.5), 2.3 * ph, 1.04)
    // the little full stop after the wordmark
    g.beginPath()
    g.arc(cx + mw / 2 + 12 * s, yAt(1.5) - 7 * s, 7.5 * s, 0, TAU)
    g.fill()

    // BEER: wide caps, tracked
    g.fillStyle = ink.navy
    g.font = `800 ${Math.round(40 * s)}px ${SANS}`
    g.textAlign = 'center'
    const letters = 'BEER'
    const track = 62 * s
    for (let i = 0; i < letters.length; i++) {
      const x = cx + (i - (letters.length - 1) / 2) * track
      g.save()
      g.translate(x, yAt(1.15))
      g.scale(1.45, 1)
      g.fillText(letters[i], 0, 0)
      g.restore()
    }

    // "From the land of / sky blue waters*" — white serif italic
    g.fillStyle = ink.script
    g.font = `${SLOGAN}700 ${Math.round(46 * s)}px ${SERIF}`
    fitText(g, 'From the land of', cx, yAt(0.8), 1.7 * ph)
    fitText(g, 'sky blue waters*', cx, yAt(0.57), 1.7 * ph)
  }
}


function labelTextures(res: number) {
  const W = res
  const H = res / 2
  const cv = makeCanvas(W, H)
  const rm = makeCanvas(W / 2, H / 2)
  // the canvases are freed once the post-fonts art is on the GPU
  let settle!: () => void
  const settled = new Promise<void>(r => (settle = r))
  const map = canvasTex(cv, true, settled)
  const rmTex = canvasTex(rm, false, settled)
  const draw = () => {
    drawHamms(cv.getContext('2d')!, W, H, INK_COLOR)
    drawHamms(rm.getContext('2d')!, W / 2, H / 2, INK_RM)
    map.needsUpdate = true
    rmTex.needsUpdate = true
  }
  draw()
  void Promise.all([whenFonts().then(draw), document.fonts?.ready?.then(draw)])
    .catch(() => undefined)
    .finally(settle)
  return { map, rm: rmTex }
}

let dropTex: THREE.CanvasTexture | null = null
/** condensation: fine beads (and a few that have run) as a bump map over the label's uv */
function dropletMap(): THREE.CanvasTexture {
  if (dropTex) return dropTex
  const W = 1024
  const H = 512
  const cv = makeCanvas(W, H)
  const g = cv.getContext('2d')!
  g.fillStyle = '#000000'
  g.fillRect(0, 0, W, H)
  const r = rng(29)
  const bead = (x: number, y: number, rad: number, a: number) => {
    for (const dx of [0, W, -W]) {
      const gr = g.createRadialGradient(x + dx - rad * 0.2, y - rad * 0.2, 0, x + dx, y, rad)
      gr.addColorStop(0, `rgba(255,255,255,${a})`)
      gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.55})`)
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      g.beginPath()
      g.arc(x + dx, y, rad, 0, TAU)
      g.fill()
    }
  }
  // fewer on the shoulder (warmer), a fine mist everywhere else
  for (let i = 0; i < 2600; i++) {
    const y = H * (0.08 + 0.92 * Math.sqrt(r()))
    bead(r() * W, y, 0.8 + r() * r() * 3.2, 0.55 + r() * 0.45)
  }
  // a few runs: a drop that slid, leaving a trail
  for (let i = 0; i < 9; i++) {
    const x = r() * W
    const y0 = H * (0.25 + r() * 0.4)
    const len = 20 + r() * 60
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(x, y0)
    g.lineTo(x + (r() - 0.5) * 3, y0 + len)
    g.stroke()
    bead(x, y0 + len, 3.5 + r() * 1.5, 1)
  }
  dropTex = canvasTex(cv, false)
  dropTex.wrapS = THREE.RepeatWrapping
  return dropTex
}

/** the lid's pressed detail as a bump map (lid coords, inches → 512²) */
function lidBump(): THREE.CanvasTexture {
  const N = 512
  const cv = makeCanvas(N, N)
  const g = cv.getContext('2d')!
  const R = CAN.panelR
  const S = N / (2 * R) // px per inch
  g.fillStyle = '#808080'
  g.fillRect(0, 0, N, N)
  g.save()
  g.translate(N / 2, N / 2)
  g.scale(S, S)
  // a soft (Gaussian) paint without ctx.filter, which Safari before 18 ignores (hard edges): the
  // shape is drawn two canvas-widths off to the left and only its shadow lands, back in place.
  // Shadow offset and blur are in canvas px whatever the transform; σ = shadowBlur / 2.
  const soft = (sigmaPx: number, color: string, paint: () => void) => {
    const off = 2 * N
    g.save()
    g.fillStyle = g.strokeStyle = '#000'
    g.shadowColor = color
    g.shadowBlur = 2 * sigmaPx
    g.shadowOffsetX = off
    g.translate(-off / S, 0)
    paint()
    g.restore()
  }
  // concentric spin marks (the lid is spun: faint rings)
  const r = rng(5)
  for (let i = 0; i < 90; i++) {
    const rad = 0.05 + (i / 90) * 0.88
    g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
    g.lineWidth = 0.004 + r() * 0.006
    g.beginPath()
    g.arc(0, 0, rad, 0, TAU)
    g.stroke()
  }
  // the panel's outer bead
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.lineWidth = 0.035
  g.beginPath()
  g.arc(0, 0, 0.9, 0, TAU)
  g.stroke()
  // the raised bead round the mouth and the score line itself
  const m = mouthOutline()
  const path = (k: number, dz: number) => {
    g.beginPath()
    m.forEach((p, i) => {
      const x = p.x * k
      const z = 0.54 + (p.y - 0.54) * k + dz
      if (i === 0) g.moveTo(x, z)
      else g.lineTo(x, z)
    })
    g.closePath()
  }
  soft(2, 'rgba(255,255,255,0.7)', () => {
    g.lineWidth = 0.05
    path(1.16, 0.01)
    g.stroke()
  })
  g.strokeStyle = 'rgba(0,0,0,0.85)'
  g.lineWidth = 0.014
  path(1.0, 0)
  g.stroke()
  // the rivet and the finger well under the tab's ring
  g.fillStyle = 'rgba(255,255,255,0.8)'
  g.beginPath()
  g.arc(0, 0, 0.1, 0, TAU)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.6)'
  g.lineWidth = 0.02
  g.beginPath()
  g.arc(0, 0, 0.13, 0, TAU)
  g.stroke()
  soft(6, 'rgba(0,0,0,0.5)', () => {
    g.beginPath()
    g.ellipse(0, -0.62, 0.22, 0.12, 0, 0, TAU)
    g.fill()
  })
  g.restore()
  return canvasTex(cv, false)
}

function tabGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(0, 0.27)
  s.bezierCurveTo(0.12, 0.27, 0.17, 0.2, 0.18, 0.1)
  s.bezierCurveTo(0.2, -0.05, 0.26, -0.18, 0.26, -0.36)
  s.bezierCurveTo(0.26, -0.62, 0.16, -0.72, 0, -0.72)
  s.bezierCurveTo(-0.16, -0.72, -0.26, -0.62, -0.26, -0.36)
  s.bezierCurveTo(-0.26, -0.18, -0.2, -0.05, -0.18, 0.1)
  s.bezierCurveTo(-0.17, 0.2, -0.12, 0.27, 0, 0.27)
  const finger = new THREE.Path()
  finger.absellipse(0, -0.46, 0.165, 0.16, 0, TAU, true, 0)
  const slot = new THREE.Path()
  slot.absellipse(0, -0.16, 0.12, 0.05, 0, TAU, true, 0)
  s.holes.push(finger, slot)
  const depth = 0.022
  const bevel = 0.007
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 28,
  })
  geo.rotateX(Math.PI / 2) // shape y → +z (nose toward the mouth), extrude → down
  geo.translate(0, depth + bevel, 0)
  // the rivet head on top
  const rivet = new THREE.CylinderGeometry(0.07, 0.078, 0.02, 20)
  rivet.translate(0, depth + 2 * bevel + 0.008, 0)
  const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g)
  const merged = mergeGeometries([flat(geo), flat(rivet)])!
  geo.dispose()
  rivet.dispose()
  merged.scale(IN, IN, IN)
  return merged
}

export interface Can {
  group: THREE.Group
  /** the printed wall (map = the label texture) */
  body: THREE.Mesh
  /** turns the whole lid (tab + mouth) about the can's axis */
  lid: THREE.Group
  tab: THREE.Group
  /** units */
  height: number
  radius: number
  /** 0 closed … 0.55 tab up, mouth open … 1 (tab standing, like the photo) */
  setOpen(k: number): void
  /** world position of the mouth (the opening) */
  mouth(out: THREE.Vector3): THREE.Vector3
  dispose(): void
}

export function makeCan({
  open = 0,
  cold = 0.5,
  labelRes = 2048,
  lidColor = '#e0bd76',
  mouthYaw = 0.35,
  shadows = true,
}: {
  open?: number
  /** 0 dry … 1 sweating: fine condensation beads catching the light (a bump map) */
  cold?: number
  /** label canvas width (height is half): 2048 hero, 1024 phones / far cans */
  labelRes?: number
  /** the lid + rim anodize (Mike's can: gold) */
  lidColor?: THREE.ColorRepresentation
  /** where the mouth points (radians about y; 0 = toward +z / the camera) */
  mouthYaw?: number
  shadows?: boolean
} = {}): Can {
  const group = new THREE.Group()
  const { map, rm } = labelTextures(labelRes)

  // the printed wall: label mapped by HEIGHT (printed flat, then necked — the shoulder compresses it)
  const bodyGeo = new THREE.LatheGeometry(profile(CAN_BODY, 72), 128, -Math.PI / 2, TAU)
  {
    const pos = bodyGeo.attributes.position as THREE.BufferAttribute
    const uv = bodyGeo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) / IN - CAN.print0) / (CAN.print1 - CAN.print0))
  }
  const bodyMat = withRoom(
    new THREE.MeshPhysicalMaterial({
      map,
      roughnessMap: rm,
      metalnessMap: rm,
      roughness: 1,
      metalness: 1,
      clearcoat: 0.55,
      clearcoatRoughness: 0.14,
      envMapIntensity: 0.75,
      ...(cold > 0 ? { bumpMap: dropletMap(), bumpScale: 0.9 * cold } : {}),
    }),
    'can',
    0.7,
  )
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.castShadow = shadows
  body.receiveShadow = true

  const alu = withRoom(new THREE.MeshPhysicalMaterial({ color: '#cfd1d3', metalness: 1, roughness: 0.3, anisotropy: 0.3 }), 'alu', 0.8)
  const gold = withRoom(new THREE.MeshPhysicalMaterial({ color: lidColor, metalness: 1, roughness: 0.36, envMapIntensity: 0.6 }), 'gold', 0.5)
  const base = new THREE.Mesh(new THREE.LatheGeometry(profile(CAN_BASE, 56), 96, -Math.PI / 2, TAU), alu)
  base.castShadow = shadows
  base.receiveShadow = true
  const top = new THREE.Mesh(new THREE.LatheGeometry(profile(CAN_TOP, 64), 128, -Math.PI / 2, TAU), gold)
  top.castShadow = shadows
  top.receiveShadow = true
  group.add(body, base, top)

  // the lid: panel with the mouth cut out, the flap, the tab, the dark inside
  const lid = new THREE.Group()
  lid.rotation.y = mouthYaw
  group.add(lid)
  const R = CAN.panelR * IN
  const outline = mouthOutline()
  const panelShape = new THREE.Shape()
  panelShape.absarc(0, 0, R, 0, TAU, false)
  panelShape.holes.push(new THREE.Path(outline.map(p => new THREE.Vector2(p.x * IN, -p.y * IN))))
  const panelGeo = new THREE.ShapeGeometry(panelShape, 64)
  panelGeo.rotateX(-Math.PI / 2)
  const lidUv = (geo: THREE.BufferGeometry, ox = 0, oz = 0) => {
    const pos = geo.attributes.position as THREE.BufferAttribute
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = (pos.getX(i) + ox) / IN
      const z = (pos.getZ(i) + oz) / IN
      uv.setXY(i, x / (2 * CAN.panelR) + 0.5, 1 - (z / (2 * CAN.panelR) + 0.5))
    }
  }
  lidUv(panelGeo)
  panelGeo.translate(0, CAN.panelY * IN, 0)
  const bump = lidBump()
  const panelMat = withRoom(
    new THREE.MeshPhysicalMaterial({
      color: lidColor,
      metalness: 1,
      roughness: 0.32,
      envMapIntensity: 0.7,
      bumpMap: bump,
      bumpScale: 1.2,
    }),
    'lid',
    1,
  )
  const panel = new THREE.Mesh(panelGeo, panelMat)
  panel.receiveShadow = true
  panel.castShadow = shadows
  lid.add(panel)

  const flapShape = new THREE.Shape(outline.map(p => new THREE.Vector2(p.x * IN, -(p.y - MOUTH_HINGE) * IN)))
  const flapGeo = new THREE.ShapeGeometry(flapShape, 32)
  flapGeo.rotateX(-Math.PI / 2)
  lidUv(flapGeo, 0, MOUTH_HINGE * IN)
  const flapPivot = new THREE.Group()
  flapPivot.position.set(0, CAN.panelY * IN, MOUTH_HINGE * IN)
  // the flap folds into the dark of the can: it darkens as it goes
  const flapMat = panelMat.clone()
  const flapColor = new THREE.Color(lidColor)
  const flap = new THREE.Mesh(flapGeo, flapMat)
  flapPivot.add(flap)
  lid.add(flapPivot)

  // inside: dark lacquered wall + the beer's dark surface, seen through the mouth
  const insideMat = new THREE.MeshStandardMaterial({ color: '#151311', metalness: 0, roughness: 0.8, side: THREE.BackSide })
  const inside = new THREE.Mesh(new THREE.CylinderGeometry(1.0 * IN, 1.0 * IN, 0.8 * IN, 40, 1, true), insideMat)
  inside.position.y = (CAN.panelY - 0.4) * IN
  const beerMat = new THREE.MeshPhysicalMaterial({ color: '#2a1406', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 })
  const beerTop = new THREE.Mesh(new THREE.CircleGeometry(1.0 * IN, 40), beerMat)
  beerTop.rotation.x = -Math.PI / 2
  beerTop.position.y = 3.86 * IN
  lid.add(inside, beerTop)

  // the tab is plain aluminium (ref3: silver beside the gold lid, in the same light); the bar's warm
  // light gives it its cast
  const tabMat = withRoom(new THREE.MeshPhysicalMaterial({ color: '#c9cdd0', metalness: 1, roughness: 0.25 }), 'tab', 1)
  const tabGeo = tabGeometry()
  const tab = new THREE.Group()
  tab.position.set(0, CAN.panelY * IN + 0.004 * IN, 0)
  const tabMesh = new THREE.Mesh(tabGeo, tabMat)
  tabMesh.castShadow = shadows
  tab.add(tabMesh)
  lid.add(tab)

  const height = CAN.H * IN
  const setOpen = (k: number) => {
    k = clamp01(k)
    // the ring lifts (the nose presses the panel), the mouth flap folds in
    tab.rotation.x = 1.46 * sstep(0, 0.55, k)
    const f = sstep(0.14, 0.5, k)
    flapPivot.rotation.x = 1.45 * f
    flapMat.color.copy(flapColor).multiplyScalar(1 - 0.88 * f)
    inside.visible = beerTop.visible = k > 0.005
  }
  setOpen(open)

  return {
    group,
    body,
    lid,
    tab,
    height,
    radius: CAN.R * IN,
    setOpen,
    mouth(out) {
      out.set(0, CAN.panelY * IN, 0.54 * IN)
      return lid.localToWorld(out)
    },
    dispose() {
      for (const m of [body, base, top, panel, flap, inside, beerTop, tabMesh]) m.geometry.dispose()
      for (const m of [bodyMat, alu, gold, panelMat, flapMat, insideMat, beerMat, tabMat]) m.dispose()
      map.dispose()
      rm.dispose()
      bump.dispose()
    },
  }
}

// ═══ THE SHOT GLASS ═════════════════════════════════════════════════════════

/** heavy-based shot glass (inches): 0.55" solid base, ten fluted facets, slight flare, rolled rim */
const SG = { rimY: 2.38, top: 2.45, R0: 1.02, R1: 1.17, floor: 0.55, N: 10, bead: 1.12, lipIn: 1.07, maxLevel: 2.28 }
const sgR = (y: number) => SG.R0 + (SG.R1 - SG.R0) * (y / SG.rimY)
const sgA = (y: number) => {
  const s = Math.max(0, (y - 0.7) / 0.45)
  return 0.955 + 0.06 * y + 0.2 * s * s
}
const sgAd = (y: number) => 0.06 + (0.4 * Math.max(0, (y - 0.7) / 0.45)) / 0.45
const sgCham = (y: number) => Math.max(0, 0.05 - y) * 0.9

const SG_INNER: [number, number][] = [
  [1.17, 2.38], [1.173, 2.41], [1.162, 2.437], [1.137, 2.45], [1.107, 2.448], [1.083, 2.43], [1.07, 2.4],
  [1.035, 1.99], [1.0, 1.575], [0.965, 1.16], [0.93, 0.75], [0.915, 0.665], [0.878, 0.595], [0.8, 0.558], [0.5, 0.55], [0, 0.55],
]

/** radial columns per flute: the outside and the inside lathe share the same N·M angles (no cracks at the rim) */
const SG_M = 10

/**
 * The faceted outside: each flute is a plane cutting the flared round (arched tops fall out of the
 * cut). Rows follow the arch: per column, the flute meets the round where R − rf = 0 (y* ≈ 0.82" at
 * a flute's edges, 0.96" at its middle), and a row sits on that crease with three either side at
 * fixed R − rf levels (where the normal blends), so the arch is one clean curve on every column.
 * Below it the flute is flat and above it the round is a cone, so a few rows carry the rest.
 */
function facetedOuter(): THREE.BufferGeometry {
  const N = SG.N
  const M = SG_M
  // R − rf at height y on a column cd = cos(θ − φ) (above the chamfer): decreasing from 0.7" up
  const gap = (y: number, cd: number) => sgR(y) - sgA(y) / cd
  const at = (level: number, cd: number) => {
    let lo = 0.7
    let hi = SG.rimY
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (gap(mid, cd) > level) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const LEVELS = [0.012, 0.006, 0.003, 0, -0.003, -0.006, -0.012]
  const column = (cd: number) => {
    const ys = [0, 0.017, 0.034, 0.05, 0.7]
    const y0 = at(LEVELS[0], cd)
    for (const f of [0.35, 0.65, 0.85]) ys.push(0.7 + (y0 - 0.7) * f)
    for (const l of LEVELS) ys.push(at(l, cd))
    ys.push(SG.rimY)
    // strictly rising (the edge columns start their arch just above 0.7")
    for (let j = 1; j < ys.length; j++) ys[j] = Math.max(ys[j], ys[j - 1] + 1e-4)
    return ys
  }
  const rows = column(1).length
  const cols = N * (M + 1)
  const pos = new Float32Array(cols * rows * 3)
  const nor = new Float32Array(cols * rows * 3)
  const fac = new Float32Array(cols * rows)
  const idx: number[] = []
  const flare = (SG.R1 - SG.R0) / SG.rimY
  const n = new THREE.Vector3()
  const nr = new THREE.Vector3()
  for (let k = 0; k < N; k++) {
    const phi = (k / N) * TAU
    for (let c = 0; c <= M; c++) {
      const th = phi - Math.PI / N + ((TAU / N) * c) / M
      const st = Math.sin(th)
      const ct = Math.cos(th)
      const cd = Math.cos(th - phi)
      const ys = column(cd)
      for (let j = 0; j < rows; j++) {
        const y = ys[j]
        const ch = sgCham(y)
        const R = sgR(y) - ch
        const rf = (sgA(y) - ch) / cd
        const r = Math.min(R, rf)
        // the flute blends into the round over a hair (a pressed edge, not a knife cut)
        const w = sstep(-0.006, 0.006, R - rf)
        n.set(Math.sin(phi), -sgAd(y), Math.cos(phi)).normalize()
        nr.set(st, -flare, ct).normalize()
        n.lerp(nr, 1 - w).normalize()
        if (ch > 0) {
          n.y -= (ch / 0.045) * 0.9
          n.normalize()
        }
        const vi = (k * (M + 1) + c) * rows + j
        fac[vi] = w
        const o = vi * 3
        pos[o] = r * st * IN
        pos[o + 1] = y * IN
        pos[o + 2] = r * ct * IN
        nor[o] = n.x
        nor[o + 1] = n.y
        nor[o + 2] = n.z
      }
    }
    for (let c = 0; c < M; c++)
      for (let j = 0; j < rows - 1; j++) {
        const a = (k * (M + 1) + c) * rows + j
        const b = a + rows
        const cc = b + 1
        const d = a + 1
        idx.push(a, b, d, cc, d, b)
      }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setAttribute('aFacet', new THREE.BufferAttribute(fac, 1))
  geo.setIndex(idx)
  return geo
}

const RYE_SEG = 64
const RYE_ROWS = 14
const RYE_U = [0.3, 0.55, 0.74, 0.86, 0.93, 0.965, 0.985, 1]

/** the rye: a level volume inside the bowl, fixed topology rebuilt in place (meniscus at the wall) */
class RyeVolume {
  geo = new THREE.BufferGeometry()
  private pos: Float32Array
  private nor: Float32Array
  private sideCount: number
  private capStart: number
  private botStart: number
  constructor(
    private rAt: (y: number) => number,
    private yBot: number,
  ) {
    const cols = RYE_SEG + 1
    const rows = RYE_ROWS
    this.sideCount = cols * (rows + 1)
    this.capStart = this.sideCount
    const rings = RYE_U.length
    this.botStart = this.capStart + 1 + rings * cols
    const total = this.botStart + 1 + cols
    this.pos = new Float32Array(total * 3)
    this.nor = new Float32Array(total * 3)
    const idx: number[] = []
    for (let i = 0; i < RYE_SEG; i++)
      for (let k = 0; k < rows; k++) {
        const a = i * (rows + 1) + k
        const b = (i + 1) * (rows + 1) + k
        idx.push(a, a + 1, b, a + 1, b + 1, b)
      }
    const cc = this.capStart
    const ring = (r: number, i: number) => cc + 1 + (r - 1) * cols + i
    for (let i = 0; i < RYE_SEG; i++) idx.push(cc, ring(1, i + 1), ring(1, i))
    for (let r = 1; r < rings; r++)
      for (let i = 0; i < RYE_SEG; i++) {
        const a = ring(r, i)
        const b = ring(r, i + 1)
        const c = ring(r + 1, i)
        const d = ring(r + 1, i + 1)
        idx.push(a, b, c, b, d, c)
      }
    const bc = this.botStart
    for (let i = 0; i < RYE_SEG; i++) idx.push(bc, bc + 1 + i, bc + 2 + i)
    this.geo.setIndex(idx)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage))
    const rMax = SG.lipIn * IN
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SG.top * IN * 0.6, 0), Math.hypot(rMax, SG.top * IN * 0.5) + 0.02)
    this.geo.boundingBox = new THREE.Box3(new THREE.Vector3(-rMax, 0, -rMax), new THREE.Vector3(rMax, SG.top * IN, rMax))
  }

  /** level: surface height (inches); m: meniscus lift at the wall (inches) */
  build(level: number, m: number) {
    const P = this.pos
    const N = this.nor
    const rows = RYE_ROWS
    const lo = this.yBot
    const hi = Math.max(lo + 0.002, level)
    const inset = 0.006
    const rTop = this.rAt(hi) - inset
    for (let i = 0; i <= RYE_SEG; i++) {
      const th = (i / RYE_SEG) * TAU
      const c = Math.cos(th)
      const s = Math.sin(th)
      for (let k = 0; k <= rows; k++) {
        const t = k / rows
        // rows crowd toward the bottom's curve
        const y = lo + (hi - lo) * (1 - (1 - t) * (1 - t))
        const r = Math.max(0.001, this.rAt(y) - inset)
        const yy = k === rows ? hi + m : y
        const o = (i * (rows + 1) + k) * 3
        P[o] = r * c * IN
        P[o + 1] = yy * IN
        P[o + 2] = r * s * IN
        const e = 0.01
        const dr = (this.rAt(Math.min(hi, y + e)) - this.rAt(Math.max(lo, y - e))) / (2 * e)
        const l = Math.hypot(1, dr)
        N[o] = c / l
        N[o + 1] = -dr / l
        N[o + 2] = s / l
      }
    }
    // the surface: flat, rising in a meniscus at the wall
    const lift = (u: number) => m * Math.exp(-((1 - u) * rTop) / 0.035)
    const cc = this.capStart * 3
    P[cc] = 0
    P[cc + 1] = hi * IN
    P[cc + 2] = 0
    N[cc] = 0
    N[cc + 1] = 1
    N[cc + 2] = 0
    RYE_U.forEach((u, ri) => {
      const du = 0.004
      const slope = (lift(Math.min(1, u + du)) - lift(u - du)) / (2 * du * rTop)
      const l = Math.hypot(1, slope)
      for (let i = 0; i <= RYE_SEG; i++) {
        const th = (i / RYE_SEG) * TAU
        const c = Math.cos(th)
        const s = Math.sin(th)
        const o = (this.capStart + 1 + ri * (RYE_SEG + 1) + i) * 3
        P[o] = rTop * u * c * IN
        P[o + 1] = (hi + lift(u)) * IN
        P[o + 2] = rTop * u * s * IN
        N[o] = (-slope * c) / l
        N[o + 1] = 1 / l
        N[o + 2] = (-slope * s) / l
      }
    })
    const b = this.botStart * 3
    const rb = Math.max(0.001, this.rAt(lo) - inset)
    P[b] = 0
    P[b + 1] = lo * IN
    P[b + 2] = 0
    N[b] = 0
    N[b + 1] = -1
    N[b + 2] = 0
    for (let i = 0; i <= RYE_SEG; i++) {
      const th = (i / RYE_SEG) * TAU
      const o = b + (1 + i) * 3
      P[o] = rb * Math.cos(th) * IN
      P[o + 1] = lo * IN
      P[o + 2] = rb * Math.sin(th) * IN
      N[o] = 0
      N[o + 1] = -1
      N[o + 2] = 0
    }
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true
  }
}

/** Old Overholt rye in the glass: deep amber seen through ~2" */
export const RYE = { color: '#c07a22', depth: 0.32, foam: '#f2dcb4' }

export interface ShotGlass {
  group: THREE.Group
  glass: THREE.Mesh
  /** the one transmissive mesh */
  rye: THREE.Mesh
  /** rim top height (units) */
  rimTop: number
  /** outer radius at the rim (units) */
  rimRadius: number
  /** radius of the rim bead's crown (units): where a pick rests */
  beadRadius: number
  /** 0 empty … 1 full (0.55 = the photo) */
  setFill(k: number): void
  /** the rye surface height (units, local) */
  level(): number
  /** inner wall radius at local height y (units) */
  innerRadius(y: number): number
  /** 0..1.5 inner glow of the rye (0.3 default) */
  setGlow(k: number): void
  /** 0..1.5 studio strip highlights on the glass */
  setStrips(k: number): void
  /** 0..1.5 the room's lamps reflected in the glass and on the rye (1 default) */
  setRoom(k: number): void
  mouth(out: THREE.Vector3): THREE.Vector3
  update(time: number): void
  dispose(): void
}

export function makeShotGlass({ fill = 0.55, glow = 0.3 }: { fill?: number; glow?: number } = {}): ShotGlass {
  const group = new THREE.Group()
  // the inside: the rolled rim and the bowl's foot keep their points, the straight wall and the
  // floor don't; on the outside's N·M angles, so the two meet exactly at the rim
  const lathe = latheLean([leanProfile(SG_INNER, 0.001)], SG.N * SG_M, -Math.PI / SG.N)
  lathe.deleteAttribute('uv')
  lathe.setAttribute('aFacet', new THREE.BufferAttribute(new Float32Array(lathe.attributes.position.count), 1))
  const outer = facetedOuter()
  const glassGeo = mergeGeometries([outer, lathe])!
  outer.dispose()
  lathe.dispose()
  const shell = glassShell(glassGeo, SG.floor * IN, { facets: true, edge: 0.65, tint: 0.07 })
  const glassU = shell.u
  const glass = shell.mesh

  // inner radius table (inches) from the profile, rim → floor
  const wall = profile(SG_INNER, 120)
    .map(p => ({ r: p.x / IN, y: p.y / IN }))
    .filter(p => p.y <= 2.4 + 1e-4 && p.r <= SG.lipIn + 1e-4)
    .sort((a, b) => a.y - b.y)
  const rIn = (y: number) => {
    if (y <= wall[0].y) return wall[0].r
    for (let i = 1; i < wall.length; i++) {
      const a = wall[i - 1]
      const b = wall[i]
      if (y <= b.y) return a.r + ((b.r - a.r) * (y - a.y)) / Math.max(1e-6, b.y - a.y)
    }
    return SG.lipIn
  }
  const yBot = SG.floor + 0.014
  const vol = new RyeVolume(rIn, yBot)

  const col = new THREE.Color(RYE.color)
  const hsl = { h: 0, s: 0, l: 0 }
  col.getHSL(hsl)
  const glowC = new THREE.Color().setHSL(Math.min(0.12, hsl.h + 0.02), Math.min(1, hsl.s * 0.95), Math.min(0.5, hsl.l * 1.05 + 0.04))
  const glowU = { value: glow }
  const byU = { value: new THREE.Vector2(yBot * IN, SG.top * IN) }
  const ryeMat = new THREE.MeshPhysicalMaterial({
    color: col.clone().lerp(new THREE.Color(1, 1, 1), 0.55),
    roughness: 0.03,
    transmission: 1,
    thickness: 0.36,
    ior: 1.36,
    attenuationColor: col.clone(),
    attenuationDistance: RYE.depth,
    specularIntensity: 1,
    envMapIntensity: 1.2,
    emissive: glowC,
    emissiveIntensity: 1,
  })
  ryeMat.onBeforeCompile = sh => {
    sh.uniforms.uRoom = glassU.uRoom
    sh.uniforms.uGlow = glowU
    sh.uniforms.uBy = byU
    sh.vertexShader = sh.vertexShader.replace(
      'void main() {',
      'varying float vBy;\nvarying float vCap;\nvoid main() {\n  vBy = position.y;\n  vCap = normal.y;',
    )
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `uniform float uGlow, uRoom;\nuniform vec2 uBy;\nvarying float vBy;\nvarying float vCap;\n${ROOM_GLSL}\nvoid main() {`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      {
        // the glow gathers through the thick middle, deepest low in the glass
        float nv = min(abs(dot(normalize(normal), normalize(vViewPosition))), 1.0);
        float h = clamp((vBy - uBy.x) / max(0.004, uBy.y - uBy.x), 0.0, 1.0);
        vec3 glowBase = totalEmissiveRadiance;
        float cap = smoothstep(0.6, 0.95, vCap);
        totalEmissiveRadiance *= uGlow * (0.08 + 0.92 * nv * nv * nv) * (0.5 + 0.7 * h) * (1.0 - 0.6 * cap);
        // light gathers where the liquid meets the glass floor (a warm line at the foot)
        float foot = exp(-max(0.0, vBy - uBy.x) / 0.012) * (1.0 - cap);
        totalEmissiveRadiance += glowBase * uGlow * foot * 1.6;
        // the room's lamps on the surface and the meniscus (water: F0 0.02)
        vec3 rw = inverseTransformDirection(reflect(-normalize(vViewPosition), normalize(normal)), viewMatrix);
        float lampK;
        vec3 room = cwRoom(rw, lampK);
        totalEmissiveRadiance += room * uRoom * (0.02 + 0.98 * pow(1.0 - nv, 5.0)) * (1.4 + 1.2 * cap);
      }`,
      )
      .replace(
        '#include <transmission_fragment>',
        `#include <transmission_fragment>
      {
        float h2 = clamp((vBy - uBy.x) / max(0.004, uBy.y - uBy.x), 0.0, 1.0);
        // the surface reads as a dark glassy plane (it mirrors the dark bar), the body glows
        totalDiffuse *= (0.6 + 0.55 * h2) * (1.0 - 0.45 * smoothstep(0.6, 0.95, vCap));
      }`,
      )
  }
  ryeMat.customProgramCacheKey = () => 'cw-rye'
  const rye = new THREE.Mesh(vol.geo, ryeMat)
  rye.castShadow = true
  rye.renderOrder = 0
  group.add(rye, glass)

  let level = yBot
  let curFill = -1
  const setFill = (k: number) => {
    k = clamp01(k)
    if (Math.abs(k - curFill) < 1e-5) return
    curFill = k
    level = yBot + (SG.maxLevel - yBot) * k
    const on = k > 0.004
    rye.visible = on
    if (on) vol.build(level, 0.035 * sstep(0, 0.06, k))
    byU.value.set(yBot * IN, Math.max(yBot + 0.2, level) * IN)
    glassU.uGlowC.value.copy(glowC).multiplyScalar(on ? 0.22 * Math.min(1, (level - yBot) / 0.5) : 0)
  }
  setFill(fill)

  return {
    group,
    glass,
    rye,
    rimTop: SG.top * IN,
    rimRadius: SG.R1 * IN,
    beadRadius: SG.bead * IN,
    setFill,
    level: () => level * IN,
    innerRadius: (y: number) => rIn(Math.min(2.4, y / IN)) * IN,
    setGlow(k) {
      glowU.value = k
    },
    setStrips(k) {
      glassU.uStrips.value = k
    },
    setRoom(k) {
      glassU.uRoom.value = k
    },
    mouth(out) {
      out.set(0, SG.top * IN, 0)
      return group.localToWorld(out)
    },
    update() {},
    dispose() {
      glassGeo.dispose()
      vol.geo.dispose()
      shell.dispose()
      ryeMat.dispose()
    },
  }
}

// ═══ THE CHEESE AND THE PICK ════════════════════════════════════════════════

/** 3 × 2 atlas of cut faces: butter-yellow Swiss, faint knife drag, a few eyes */
function cheeseMaps(seed: number, eyes: boolean) {
  const C = 256
  const W = C * 3
  const H = C * 2
  const col = makeCanvas(W, H)
  const bmp = makeCanvas(W, H)
  const rgh = makeCanvas(W, H)
  const g = col.getContext('2d')!
  const b = bmp.getContext('2d')!
  const r = rgh.getContext('2d')!
  const rnd = rng(seed + 3)
  g.fillStyle = '#f5eabf'
  g.fillRect(0, 0, W, H)
  b.fillStyle = '#808080'
  b.fillRect(0, 0, W, H)
  r.fillStyle = 'rgb(0,100,0)'
  r.fillRect(0, 0, W, H)
  // eyes per face (+x, -x, +y, -y, +z, -z): a few, clear of the edges
  const eyePlan: [number, number, number][][] = [
    [[0.34, 0.62, 0.11]],
    [],
    [[0.66, 0.36, 0.085], [0.3, 0.72, 0.05]],
    [[0.5, 0.5, 0.12]],
    [[0.7, 0.64, 0.09]],
    [[0.28, 0.3, 0.1], [0.72, 0.74, 0.05]],
  ]
  for (let f = 0; f < 6; f++) {
    const x0 = (f % 3) * C
    const y0 = Math.floor(f / 3) * C
    // mottling: the paste is a touch warmer here and there, paler elsewhere
    for (let i = 0; i < 70; i++) {
      const x = x0 + rnd() * C
      const y = y0 + rnd() * C
      const rad = 10 + rnd() * 40
      const gr = g.createRadialGradient(x, y, 0, x, y, rad)
      const warm = rnd() > 0.5
      gr.addColorStop(0, warm ? 'rgba(236,206,120,0.10)' : 'rgba(252,244,206,0.12)')
      gr.addColorStop(1, 'rgba(242,226,164,0)')
      g.fillStyle = gr
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    // knife drag on two faces: faint parallel ridges
    if (f === 2 || f === 4) {
      for (let i = 0; i < 26; i++) {
        const yy = y0 + rnd() * C
        b.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)'
        b.lineWidth = 1 + rnd() * 2.5
        b.beginPath()
        b.moveTo(x0, yy)
        b.lineTo(x0 + C, yy + (rnd() - 0.5) * 18)
        b.stroke()
      }
    }
    // fine grain in the bump + roughness
    for (let i = 0; i < 900; i++) {
      const x = x0 + rnd() * C
      const y = y0 + rnd() * C
      const v = rnd()
      b.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
      b.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2)
      r.fillStyle = `rgba(0,${Math.round(100 + rnd() * 50)},0,0.25)`
      r.fillRect(x, y, 2, 2)
    }
    if (!eyes) continue
    for (const [u, v, rad] of eyePlan[f]) {
      const x = x0 + u * C
      const y = y0 + v * C
      const R = rad * C
      // colour: a shadowed, slightly glossier hollow
      const gc = g.createRadialGradient(x, y - R * 0.2, R * 0.1, x, y, R)
      gc.addColorStop(0, 'rgba(206,170,86,0.38)')
      gc.addColorStop(0.7, 'rgba(222,194,116,0.28)')
      gc.addColorStop(0.92, 'rgba(250,240,200,0.35)')
      gc.addColorStop(1, 'rgba(242,226,164,0)')
      g.fillStyle = gc
      g.beginPath()
      g.arc(x, y, R * 1.05, 0, TAU)
      g.fill()
      // bump: a spherical hollow with a soft lip
      const gb = b.createRadialGradient(x, y, 0, x, y, R * 1.15)
      gb.addColorStop(0, 'rgba(0,0,0,0.9)')
      gb.addColorStop(0.6, 'rgba(0,0,0,0.55)')
      gb.addColorStop(0.86, 'rgba(0,0,0,0.12)')
      gb.addColorStop(0.95, 'rgba(255,255,255,0.12)')
      gb.addColorStop(1, 'rgba(128,128,128,0)')
      b.fillStyle = gb
      b.beginPath()
      b.arc(x, y, R * 1.15, 0, TAU)
      b.fill()
      r.fillStyle = 'rgb(0,70,0)'
      r.beginPath()
      r.arc(x, y, R * 0.9, 0, TAU)
      r.fill()
    }
  }
  return { map: canvasTex(col), bump: canvasTex(bmp, false), rough: canvasTex(rgh, false) }
}

export interface Cheese {
  group: THREE.Group
  mesh: THREE.Mesh
  /** edge length (units) */
  size: number
  dispose(): void
}

/** a cube of Swiss (~0.78"), centred on its group's origin */
export function makeCheeseCube({ size = 0.78, seed = 3, eyes = true }: { size?: number; seed?: number; eyes?: boolean } = {}): Cheese {
  const s = size * IN
  const geo = new RoundedBoxGeometry(s, s * 0.97, s * 1.02, 4, 0.05 * IN)
  // RoundedBoxGeometry is non-indexed, six equal face blocks (+x −x +y −y +z −z),
  // each with its own 0..1 uv: move each face into its cell of the 3 × 2 atlas
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const per = pos.count / 6
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const face = Math.min(5, Math.floor(i / per))
    const fu = Math.min(0.995, Math.max(0.005, uv.getX(i)))
    const fv = Math.min(0.995, Math.max(0.005, uv.getY(i)))
    uv.setXY(i, ((face % 3) + fu) / 3, 1 - (Math.floor(face / 3) + (1 - fv)) / 2)
    // hand-cut: a soft belly on the faces, a whisper of skew
    v.fromBufferAttribute(pos, i)
    n.fromBufferAttribute(nor, i)
    const belly = 0.012 * s * Math.cos((v.x / s) * Math.PI) * Math.cos((v.y / s) * Math.PI) * Math.cos((v.z / s) * Math.PI)
    v.addScaledVector(n, belly)
    v.x += v.y * 0.035
    v.z += v.y * -0.02
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  const { map, bump, rough } = cheeseMaps(seed, eyes)
  const mat = withRoom(
    new THREE.MeshPhysicalMaterial({
      map,
      bumpMap: bump,
      bumpScale: 0.9,
      roughnessMap: rough,
      roughness: 1,
      clearcoat: 0.7,
      clearcoatRoughness: 0.14,
      sheen: 0.2,
      sheenColor: new THREE.Color('#fff0bf'),
      sheenRoughness: 0.5,
      // light carries into the paste (no dead-black shadow sides)
      emissive: new THREE.Color('#6b4b0e'),
      emissiveIntensity: 0.07,
    }),
    'cheese',
    0.9,
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return {
    group,
    mesh,
    size: s,
    dispose() {
      geo.dispose()
      mat.dispose()
      map.dispose()
      bump.dispose()
      rough.dispose()
    },
  }
}

let bambooTex: THREE.CanvasTexture | null = null
function bambooMap() {
  if (bambooTex) return bambooTex
  const cv = makeCanvas(64, 512)
  const g = cv.getContext('2d')!
  g.fillStyle = '#9d9660'
  g.fillRect(0, 0, 64, 512)
  const r = rng(17)
  for (let i = 0; i < 60; i++) {
    const x = r() * 64
    g.fillStyle = r() > 0.5 ? 'rgba(120,98,40,0.22)' : 'rgba(236,222,160,0.2)'
    g.fillRect(x, 0, 0.6 + r() * 1.6, 512)
  }
  // a node: a darker band with a paler lip
  const ny = 150
  g.fillStyle = 'rgba(96,78,30,0.45)'
  g.fillRect(0, ny, 64, 7)
  g.fillStyle = 'rgba(240,226,170,0.35)'
  g.fillRect(0, ny + 7, 64, 3)
  bambooTex = canvasTex(cv)
  return bambooTex
}

export interface Pick {
  group: THREE.Group
  mesh: THREE.Mesh
  /** units */
  length: number
  radius: number
  dispose(): void
}

/** a bamboo pick along local +x (tip at +length/2), centred on its group's origin */
export function makePick({ length = 4.6, radius = 0.036 }: { length?: number; radius?: number } = {}): Pick {
  const L = length
  const r = radius
  const pts: [number, number][] = [
    [0, 0], [r * 0.85, 0], [r, 0.015], [r, 0.3], [r * 0.985, L * 0.5], [r, L - 0.46], [r * 0.8, L - 0.32], [r * 0.42, L - 0.14], [0.004, L],
  ]
  const geo = new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x * IN, y * IN)),
    12,
  )
  geo.rotateZ(-Math.PI / 2)
  geo.translate((-L * IN) / 2, 0, 0)
  const mat = new THREE.MeshStandardMaterial({ map: bambooMap(), roughness: 0.6, metalness: 0 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return {
    group,
    mesh,
    length: L * IN,
    radius: r * IN,
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}

// ═══ THE BOTTLE AND THE POUR ═════════════════════════════════════════════════

function bottleLabel(): THREE.CanvasTexture {
  const W = 1024
  const H = 512
  const cv = makeCanvas(W, H)
  let settle!: () => void
  const tex = canvasTex(cv, true, new Promise<void>(r => (settle = r)))
  const draw = () => {
    const g = cv.getContext('2d')!
    g.fillStyle = '#ece0c2'
    g.fillRect(0, 0, W, H)
    // paper tooth
    const r = rng(23)
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(120,96,60,0.05)' : 'rgba(255,255,255,0.06)'
      g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2)
    }
    g.strokeStyle = '#1a140e'
    g.lineWidth = 3
    g.strokeRect(W * 0.3, 22, W * 0.4, H - 44)
    g.lineWidth = 1.2
    g.strokeRect(W * 0.3 + 10, 32, W * 0.4 - 20, H - 64)
    g.fillStyle = '#1a140e'
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.font = `700 64px ${SERIF}`
    fitText(g, 'Old Overholt', W / 2, H * 0.44, W * 0.34)
    g.fillRect(W * 0.42, H * 0.52, W * 0.16, 2)
    g.font = `700 24px ${SANS}`
    const line = 'STRAIGHT RYE WHISKEY'
    const track = 3
    let w = 0
    for (const ch of line) w += g.measureText(ch).width + track
    let x = W / 2 - w / 2
    g.textAlign = 'left'
    for (const ch of line) {
      g.fillText(ch, x, H * 0.64)
      x += g.measureText(ch).width + track
    }
    tex.needsUpdate = true
  }
  draw()
  void whenFonts()
    .then(draw)
    .catch(() => undefined)
    .finally(settle)
  return tex
}

export interface RyeBottle {
  group: THREE.Group
  /** units */
  height: number
  /** world position of the lip's centre */
  spout(out: THREE.Vector3): THREE.Vector3
  /** world position of the lip's LOWEST point as the bottle is tipped (where a pour leaves it) */
  lip(out: THREE.Vector3): THREE.Vector3
  dispose(): void
}

/** a tall rye bottle (~11.9"): clear glass, whiskey to the shoulder, a plain paper label, a black cap */
export function makeRyeBottle({ fill = 0.85, cap = true }: { fill?: number; cap?: boolean } = {}): RyeBottle {
  const group = new THREE.Group()
  const OUT: [number, number][] = [
    [0, 0.02], [1.3, 0.0], [1.47, 0.06], [1.52, 0.3], [1.53, 4.0], [1.53, 7.1], [1.48, 7.7], [1.2, 8.35], [0.78, 8.9], [0.58, 9.35],
    [0.56, 10.4], [0.6, 10.55], [0.6, 10.75], [0.54, 10.85],
  ]
  const outer = profile(OUT, 110)
  // a thin shell: outer out, inner back (offset inward), for the reflections; lean (the long
  // straight body and neck carry no rows, the shoulder and the lip keep theirs)
  const outside = leanProfile(OUT, 0.004, 3, 0.02)
  // the inside: back down, 0.09" in (flat over the punt, where the lathe's own normals stay)
  const inside: Lean = { pts: [], nor: [] }
  for (let j = outside.pts.length - 1; j >= 0; j--) {
    const p = outside.pts[j]
    const n = outside.nor[j]
    inside.pts.push(new THREE.Vector2(Math.max(0, p.x - 0.09 * IN), Math.max(0.3 * IN, p.y)))
    inside.nor.push(n && p.y >= 0.3 * IN ? n.clone().negate() : null)
  }
  const shellGeo = latheLean([outside, inside], 64)
  shellGeo.deleteAttribute('uv')
  const glass = glassShell(shellGeo, 0.3 * IN, { tint: 0.05, edge: 0.5, solid: 0.12 })
  const shell = glass.mesh

  // the whiskey: a non-transmissive stand-in (dark amber, glowing where it's thick)
  // follows the glass 0.1" inside, from the punt to `fill` (0.85 = the shoulder, 1 = up the neck)
  const top = (0.4 + (10.3 - 0.4) * clamp01(fill)) * IN
  const liq: THREE.Vector2[] = [new THREE.Vector2(0, 0.32 * IN)]
  for (const p of outer) {
    if (p.y < 0.32 * IN) continue
    if (p.y > top) break
    liq.push(new THREE.Vector2(Math.max(0.001, p.x - 0.1 * IN), p.y))
  }
  liq.push(new THREE.Vector2(Math.max(0.001, liq[liq.length - 1].x), top), new THREE.Vector2(0, top))
  const liqGeo = latheLean([lean(liq, 0.002, 3, 0.05)], 64)
  const liqMat = new THREE.MeshPhysicalMaterial({
    color: '#3a1604',
    roughness: 0.12,
    metalness: 0,
    emissive: new THREE.Color('#8a3a0c'),
    emissiveIntensity: 1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
  })
  liqMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float nvB = abs(dot(normalize(normal), normalize(vViewPosition)));
        totalEmissiveRadiance *= 0.05 + 0.5 * nvB * nvB * nvB;
      }`,
    )
  }
  liqMat.customProgramCacheKey = () => 'cw-rye-cheap'
  const liquid = new THREE.Mesh(liqGeo, liqMat)
  liquid.castShadow = true

  // paper label on the front: a partial wrap just proud of the glass
  const labelTex = bottleLabel()
  const lr = 1.545 * IN
  const labelGeo = new THREE.CylinderGeometry(lr, lr, 3.6 * IN, 48, 1, true, -1.15, 2.3)
  labelGeo.translate(0, 4.2 * IN, 0)
  const labelMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.82, metalness: 0 })
  const label = new THREE.Mesh(labelGeo, labelMat)
  label.receiveShadow = true

  group.add(liquid, label, shell)
  let capMesh: THREE.Mesh | null = null
  let capMat: THREE.MeshStandardMaterial | null = null
  if (cap) {
    capMat = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.45, metalness: 0.2 })
    capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.64 * IN, 0.64 * IN, 1.0 * IN, 48), capMat)
    capMesh.position.y = 10.95 * IN
    capMesh.castShadow = true
    group.add(capMesh)
  }
  return {
    group,
    height: (cap ? 11.45 : 10.85) * IN,
    spout(out) {
      out.set(0, 10.85 * IN, 0)
      return group.localToWorld(out)
    },
    lip(out) {
      let best = Infinity
      const v = new THREE.Vector3()
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU
        v.set(Math.cos(a) * 0.52 * IN, 10.85 * IN, Math.sin(a) * 0.52 * IN)
        group.localToWorld(v)
        if (v.y < best) {
          best = v.y
          out.copy(v)
        }
      }
      return out
    },
    dispose() {
      shellGeo.dispose()
      glass.dispose()
      liqGeo.dispose()
      liqMat.dispose()
      labelGeo.dispose()
      labelMat.dispose()
      labelTex.dispose()
      capMesh?.geometry.dispose()
      capMat?.dispose()
    },
  }
}

/**
 * A rye pour: kit/beer's stream in whiskey amber (thin — it's a shot).
 *   const p = makeRyePour(); scene.add(p.mesh); p.set(spoutWorld, landWorld, flow); p.update(time)
 */
export function makeRyePour(radius = 0.012) {
  return makePourStream(RYE, radius)
}

// ═══ CONTACT SHADOWS ════════════════════════════════════════════════════════

let contactTex: THREE.CanvasTexture | null = null
function contactMap() {
  if (contactTex) return contactTex
  const N = 128
  const cv = makeCanvas(N, N)
  const g = cv.getContext('2d')!
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  gr.addColorStop(0, 'rgba(0,0,0,1)')
  gr.addColorStop(0.55, 'rgba(0,0,0,0.85)')
  gr.addColorStop(0.72, 'rgba(0,0,0,0.35)')
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, N, N)
  contactTex = canvasTex(cv, false)
  return contactTex
}
function contactShadow(radius: number, opacity: number) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: contactMap(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat)
  m.rotation.x = -Math.PI / 2
  m.position.y = 0.0008
  m.renderOrder = 1
  return m
}

// ═══ THE CITY WIDE ══════════════════════════════════════════════════════════

/** the arrangement (inches): can left and back, the shot right and forward, as on the bar in the photo */
const CANX = -1.6
const CANZ = -0.75
const SHOTX = 1.4
const SHOTZ = 1.15

export interface CityWide {
  group: THREE.Group
  can: Can
  shot: ShotGlass
  cheese: Cheese
  pick: Pick
  /** pick + cube: moves with setCheese (child of shot.group) */
  garnish: THREE.Group
  /** 0 closed … 1 open, tab standing */
  setCanOpen(k: number): void
  /** 0 empty … 1 full (clamped under the cube when it's resting) */
  setShotFill(k: number): void
  /** 0 hidden … lowering in … 1 resting across the rim */
  setCheese(k: number): void
  /** the key light's direction (world, toward the light): contact shadows lean away from it */
  setLight(dir: THREE.Vector3): void
  update(frame: Frame): void
  dispose(): void
  /** Object3Ds for cameras and callouts (use getWorldPosition) */
  anchors: { can: THREE.Object3D; canTop: THREE.Object3D; shot: THREE.Object3D; rye: THREE.Object3D; cheese: THREE.Object3D }
  /** the arrangement's footprint in the group frame (units) */
  size: THREE.Box3
}

export function makeCityWide({
  open = 1,
  fill = 0.55,
  cheese: cheeseK = 1,
  canYaw = 0.12,
  labelRes = 2048,
  shadows = true,
}: {
  open?: number
  fill?: number
  cheese?: number
  /** turn the can's print (radians) */
  canYaw?: number
  labelRes?: number
  shadows?: boolean
} = {}): CityWide {
  const group = new THREE.Group()
  const can = makeCan({ labelRes, shadows, mouthYaw: 0.5 })
  const shot = makeShotGlass({ fill })
  can.group.position.set(CANX * IN, 0, CANZ * IN)
  can.group.rotation.y = canYaw
  shot.group.position.set(SHOTX * IN, 0, SHOTZ * IN)
  group.add(can.group, shot.group)

  // contact shadows (the ambient occlusion under each; the world spot casts the real ones)
  const canAO = contactShadow(1.62 * IN, 0.75)
  const shotAO = contactShadow(1.45 * IN, 0.5)
  can.group.add(canAO)
  shot.group.add(shotAO)

  // ── the pick across the rim, the cube near the front-right contact ──
  const d = new THREE.Vector3(0.785, 0, 0.62).normalize()
  const p = new THREE.Vector3(-d.z, 0, d.x) // front-left, perpendicular
  const e = -0.2 // chord offset (inches, along p)
  const Rb = SG.bead
  const hChord = Math.sqrt(Rb * Rb - e * e)
  const pickR = 0.036
  const pickY = SG.top + pickR + 0.006
  const over = 0.55 // the tip past the front-right rim
  const sTip = hChord + over
  // how long may the pick be before its back end reaches the can?
  const canLocal = new THREE.Vector3(CANX - SHOTX, 0, CANZ - SHOTZ) // can axis in the shot's frame (inches)
  const clearOfCan = (sBack: number) => {
    const x = p.x * e + d.x * sBack
    const z = p.z * e + d.z * sBack
    return Math.hypot(x - canLocal.x, z - canLocal.z) > CAN.R + 0.16
  }
  let L = 4.6
  while (L > 3 && !clearOfCan(sTip - L)) L -= 0.05
  const pick = makePick({ length: L, radius: pickR })
  const cheese = makeCheeseCube()
  const garnish = new THREE.Group()
  shot.group.add(garnish)
  garnish.add(pick.group, cheese.group)
  // garnish frame: origin on the pick's axis at its centre, +x along the pick
  const sMid = sTip - L / 2
  const rest = new THREE.Vector3(p.x * e + d.x * sMid, pickY, p.z * e + d.z * sMid).multiplyScalar(IN)
  const yaw = Math.atan2(-d.z, d.x)

  // the cube: speared through its upper third, rolled toward the camera,
  // slid along the pick until every edge clears the glass by ≥ 0.03"
  const half = 0.39 * 1.03
  const q = 0.17
  const beta = 0.42
  const gamma = 0.1
  const cubeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(beta, gamma, 0, 'XYZ'))
  const drop = new THREE.Vector3(0, q, 0).applyQuaternion(cubeQ)
  const garnishM = new THREE.Matrix4().compose(rest, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1))
  const probe = new THREE.Vector3()
  const samples: THREE.Vector3[] = []
  {
    const cs = [-1, 1]
    for (const x of cs) for (const y of cs) for (const z of cs) samples.push(new THREE.Vector3(x, y, z))
    // edge points and face centres
    for (let a = 0; a < 3; a++)
      for (const u of cs)
        for (const v of cs)
          for (const t of [-0.5, 0, 0.5]) {
            const s = new THREE.Vector3()
            s.setComponent(a, t)
            s.setComponent((a + 1) % 3, u)
            s.setComponent((a + 2) % 3, v)
            samples.push(s)
          }
    for (let a = 0; a < 3; a++)
      for (const u of cs) {
        const s = new THREE.Vector3()
        s.setComponent(a, u)
        samples.push(s)
      }
  }
  const clearance = 0.03
  const rIn = (y: number) => shot.innerRadius(Math.min(2.4, y) * IN) / IN
  let lowest = Infinity
  const fits = (xc: number) => {
    lowest = Infinity
    for (const s of samples) {
      // cube-local (inches) → garnish-local → shot-local (units → inches)
      probe.copy(s).multiplyScalar(half).applyQuaternion(cubeQ)
      probe.x += xc
      probe.y -= drop.y
      probe.z -= drop.z
      probe.multiplyScalar(IN).applyMatrix4(garnishM).divideScalar(IN)
      lowest = Math.min(lowest, probe.y)
      if (probe.y > SG.top + 0.035) continue
      if (Math.hypot(probe.x, probe.z) > rIn(probe.y) - clearance) return false
    }
    return true
  }
  // from the front-right contact inward
  const sContact = hChord - sMid
  let xc = sContact - half
  for (let i = 0; i < 200 && !fits(xc); i++) xc -= 0.01
  xc -= 0.02
  fits(xc)
  const cubeBottom = lowest
  cheese.group.quaternion.copy(cubeQ)
  cheese.group.position.set(xc * IN, -drop.y * IN, -drop.z * IN)
  // the rye must stay under the resting cube
  const maxFill = clamp01((cubeBottom - 0.06 - (SG.floor + 0.014)) / (SG.maxLevel - (SG.floor + 0.014)))

  // anchors
  const anchors = {
    can: new THREE.Object3D(),
    canTop: new THREE.Object3D(),
    shot: new THREE.Object3D(),
    rye: new THREE.Object3D(),
    cheese: new THREE.Object3D(),
  }
  anchors.can.position.set(0, can.height / 2, 0)
  can.group.add(anchors.can)
  anchors.canTop.position.set(0, CAN.panelY * IN, 0.54 * IN)
  can.lid.add(anchors.canTop)
  anchors.shot.position.set(0, (SG.top * IN) / 2, 0)
  shot.group.add(anchors.shot)
  shot.group.add(anchors.rye)
  cheese.group.add(anchors.cheese)

  let cheeseNow = 0
  let fillReq = fill
  const applyFill = () => {
    const lim = cheeseNow > 0.6 ? maxFill : 1
    shot.setFill(Math.min(fillReq, lim))
    anchors.rye.position.set(0, shot.level(), 0)
  }
  const tmpQ = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const setCheese = (k: number) => {
    k = clamp01(k)
    cheeseNow = k
    garnish.visible = k > 0.001
    // lowered in from above: a gentle arc while high, the last inches straight
    // down, a small settle that never dips below the rest pose
    const ease = 1 - Math.pow(1 - sstep(0, 0.8, k), 3)
    const lift = (1 - ease) * 2.8
    const high = sstep(1.1, 2.4, lift)
    const u = sstep(0.8, 1, k)
    const settle = u > 0 && u < 1 ? 0.045 * Math.abs(Math.sin(u * Math.PI * 2)) * Math.exp(-3 * u) : 0
    garnish.position.copy(rest).addScaledVector(up, (lift + settle) * IN).addScaledVector(p, high * 0.9 * IN)
    tmpQ.setFromAxisAngle(up, yaw + high * 0.35)
    garnish.quaternion.copy(tmpQ)
    garnish.rotateX(-high * 0.25)
    applyFill()
  }
  setCheese(cheeseK)
  can.setOpen(open)

  const box = new THREE.Box3(
    new THREE.Vector3((CANX - CAN.R) * IN, 0, (CANZ - CAN.R) * IN),
    new THREE.Vector3((SHOTX + SG.R1 + 0.6) * IN, CAN.H * IN, (SHOTZ + SG.R1 + 0.3) * IN),
  )

  const lightXZ = new THREE.Vector3()
  const inv = new THREE.Quaternion()
  return {
    group,
    can,
    shot,
    cheese,
    pick,
    garnish,
    setCanOpen: k => can.setOpen(k),
    setShotFill(k) {
      fillReq = clamp01(k)
      applyFill()
    },
    setCheese,
    setLight(dir) {
      group.getWorldQuaternion(inv).invert()
      lightXZ.copy(dir).applyQuaternion(inv)
      lightXZ.y = 0
      if (lightXZ.lengthSq() < 1e-6) return
      lightXZ.normalize()
      canAO.position.set(-lightXZ.x * 0.12 * IN, 0.0008, -lightXZ.z * 0.12 * IN)
      shotAO.position.set(-lightXZ.x * 0.1 * IN, 0.0008, -lightXZ.z * 0.1 * IN)
    },
    update(frame) {
      shot.update(frame.time)
    },
    dispose() {
      can.dispose()
      shot.dispose()
      cheese.dispose()
      pick.dispose()
      for (const m of [canAO, shotAO]) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    },
    anchors,
    size: box,
  }
}
