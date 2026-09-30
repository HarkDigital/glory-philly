import * as THREE from 'three'
import { BOTTLES, type BeerGroup } from '../../content'
import { rng } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { FONT } from '../../kit/vinyl'
import { withPools, type PoolSet } from '../../kit/room'
import { poolHook } from '../../kit/room/materials'
import { BAYS, K, LOCAL_SHELF, LP_KX, SHELF_Y, WALL_Z, ky, type NamedRow } from './backbar'

/*
 * THE NAMED BOTTLES on Glory's back bar (backbar.ts builds the room around
 * them from the room kit): every bottle on the Cellar's list stands on its
 * group's shelves, shot like Resonance's product macros. Each is an
 * instance: dark glass (a physical clearcoat that catches the room's
 * reflections, a little light through it), a label from one canvas atlas
 * (generic cream / gold / black / oxblood paper, the beer's NAME in the
 * house type — Alfa Slab One or tracked Inter Tight caps, no brand marks)
 * and a foil capsule (+ wire cage on the corked 750s). Four formats: the 750
 * corked-and-caged, the 330 stubby, the magnum and the 3 litre.
 *
 *   American       the sooty brick bay: 5 / 5 / 4
 *   International  the wide walnut bay: 3 shelves of 14, in list order
 *   Local          the two bottles on the Local shelf, beside the "Bottles" LP
 *
 * The kit's generic bottles fill each row either side (backbar.ts). The
 * bulbs' light pools (the kit's) light these too, hooked in below.
 */

export { WALL_Z }
/** bottle rows (world y, surfaces), top → bottom */
export const ROW_Y = SHELF_Y.map(ky)
/** the Local shelf (world y) */
export const LOCAL_Y = ky(LOCAL_SHELF)
const mid = (b: readonly [number, number]) => ((b[0] + b[1]) / 2) * K
/** section centres (world x); local = the two bottles' centre */
export const SECTION_X = {
  american: mid(BAYS.american),
  international: mid(BAYS.international),
  local: (BAYS.local[0] + 0.17) * K,
}
/** where the "Bottles" LP leans on the Local shelf (world x) */
export const LP_X = LP_KX * K

type Kind = 'cork' | 'stubby' | 'magnum' | 'jero'
const KIND_SCALE: Record<Kind, number> = { cork: 1, stubby: 1, magnum: 1.26, jero: 1.62 }
const KIND_RADIUS: Record<Kind, number> = { cork: 0.255, stubby: 0.212, magnum: 0.255 * 1.26, jero: 0.255 * 1.62 }

function kindOf(name: string): Kind {
  if (/3\s?Liter/i.test(name)) return 'jero'
  if (/1\.5L|Magnum/i.test(name)) return 'magnum'
  if (/Fonteinen|Tilquin|Gueuze|Kriek|Lambic|Fantome|Cidre|Cider|Sagardo|Logsdon|Kestemont|Malpolon|Blaugies|Bon-Chien|Consecration|Tripel|Saison|Cuvee|Dulle|Darbyste|Framboise|Vin Jaune|Cerasus|Bretta|Conversation|Relic|Ploughman|Taras|Termino/i.test(name))
    return 'cork'
  return 'stubby'
}

/* ---------------- geometry ---------------- */

const smooth = (pts: [number, number][], n = 56) =>
  new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getSpacedPoints(n)

const CORK_BODY: [number, number][] = [
  [0, 0.05], [0.2, 0.0], [0.25, 0.03], [0.255, 0.2], [0.255, 0.95], [0.24, 1.08], [0.19, 1.22],
  [0.12, 1.34], [0.09, 1.43], [0.085, 1.6], [0.086, 1.66], [0.1, 1.68], [0.1, 1.76], [0.07, 1.8], [0, 1.8],
]
const STUBBY_BODY: [number, number][] = [
  [0, 0.04], [0.18, 0.0], [0.21, 0.03], [0.212, 0.2], [0.212, 0.7], [0.19, 0.84], [0.125, 0.98],
  [0.086, 1.08], [0.08, 1.2], [0.09, 1.23], [0.086, 1.28], [0, 1.28],
]

/** ~2.9k triangles a bottle (1.4k on phones): 58 of them stand on the bar */
function bodyGeo(pts: [number, number][], mobile = false) {
  return new THREE.LatheGeometry(smooth(pts, mobile ? 32 : 44), mobile ? 22 : 32)
}

function labelGeo(r: number, y0: number, y1: number) {
  const span = 2.3
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 28, 1, true, -span / 2, span)
  g.translate(0, (y0 + y1) / 2, 0)
  return g
}

function corkCapsuleGeo() {
  const pts: [number, number][] = [
    [0.0925, 1.47], [0.091, 1.6], [0.092, 1.665], [0.106, 1.675], [0.106, 1.775], [0.08, 1.812], [0, 1.816],
  ]
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 28)
}
function crownGeo() {
  const pts: [number, number][] = [[0.09, 1.245], [0.094, 1.27], [0.088, 1.296], [0, 1.3]]
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 24)
}
/** the wire cage over the cork: a ring round the lip and four legs meeting on a disc */
function cageGeo() {
  const parts: THREE.BufferGeometry[] = []
  const ring = new THREE.TorusGeometry(0.109, 0.0055, 5, 28)
  ring.rotateX(Math.PI / 2)
  ring.translate(0, 1.7, 0)
  parts.push(ring)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const from = new THREE.Vector3(Math.sin(a) * 0.109, 1.7, Math.cos(a) * 0.109)
    const to = new THREE.Vector3(Math.sin(a) * 0.03, 1.826, Math.cos(a) * 0.03)
    const len = from.distanceTo(to)
    const leg = new THREE.CylinderGeometry(0.0045, 0.0045, len, 4)
    leg.translate(0, len / 2, 0)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    leg.applyQuaternion(q)
    leg.translate(from.x, from.y, from.z)
    parts.push(leg)
  }
  const disc = new THREE.CylinderGeometry(0.04, 0.04, 0.008, 12)
  disc.translate(0, 1.828, 0)
  parts.push(disc)
  return mergeSimple(parts)
}

/** merge non-indexed-compatible geometries (position + normal only) */
function mergeSimple(parts: THREE.BufferGeometry[]) {
  const pos: number[] = []
  const nor: number[] = []
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p
    pos.push(...(g.attributes.position.array as Float32Array))
    nor.push(...(g.attributes.normal.array as Float32Array))
    g.dispose()
    if (g !== p) p.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return out
}


/* ---------------- the label atlas ---------------- */

const GRID = 8
/** paper, ink, rule */
const PAPERS: [string, string, string][] = [
  ['#efe4cc', '#2a170c', '#8e2a1c'],
  ['#c9a24c', '#1a0f06', '#1a0f06'],
  ['#15100c', '#d9b56a', '#d9b56a'],
  ['#e4d2a6', '#3a2110', '#a51a20'],
  ['#5c1812', '#f1e3c6', '#e3c17a'],
  ['#f3ead8', '#1c120b', '#b08a3c'],
]

interface LabelSpec {
  name: string | null
  design: number
  /** a double-size atlas cell: the Local pair, the one macro on the shelves */
  big: boolean
}

function wrapLines(text: string, width: number, measure: (t: string) => number) {
  const words = text.replace(/\s+-\s+/g, ' ').split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (measure(t) <= width || !cur) cur = t
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/*
 * Tracked caps, laid out glyph by glyph: canvas `letterSpacing` doesn't exist
 * in Safari 15–17 (the build target), where tracked names came out tight. The
 * tracking is added here, the same in every browser; each glyph's x is the
 * kerned width of the text up to and including it, minus its own advance, so
 * kerning pairs survive.
 */
const trackedWidth = (g: CanvasRenderingContext2D, t: string, track: number) =>
  g.measureText(t).width + track * Math.max(0, [...t].length - 1)

function fillTracked(g: CanvasRenderingContext2D, t: string, cx: number, y: number, track: number) {
  const align = g.textAlign
  g.textAlign = 'left'
  const x0 = cx - trackedWidth(g, t, track) / 2
  let pre = ''
  let i = 0
  for (const ch of t) {
    pre += ch
    g.fillText(ch, x0 + g.measureText(pre).width - g.measureText(ch).width + i * track, y)
    i++
  }
  g.textAlign = align
}

/** the label's name face: the slab on the light papers, tracked Inter Tight caps on the dark ones (and on long names) */
function nameStyle(spec: LabelSpec): 'slab' | 'caps' {
  const light = spec.design === 0 || spec.design === 3 || spec.design === 5
  return light && (spec.name?.length ?? 0) <= 30 ? 'slab' : 'caps'
}

function drawLabel(g: CanvasRenderingContext2D, x: number, y: number, s: number, spec: LabelSpec) {
  const [paper, ink, rule] = PAPERS[spec.design % PAPERS.length]
  const c = s
  g.save()
  g.translate(x, y)
  g.fillStyle = paper
  g.fillRect(0, 0, c, c)
  // aged paper: a soft darker edge
  const vg = g.createRadialGradient(c / 2, c / 2, c * 0.2, c / 2, c / 2, c * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(40,20,5,0.22)')
  g.fillStyle = vg
  g.fillRect(0, 0, c, c)
  const k = c / 256
  // double rule frame
  g.strokeStyle = rule
  g.lineWidth = 2.2 * k
  g.strokeRect(14 * k, 16 * k, c - 28 * k, c - 32 * k)
  g.lineWidth = 0.9 * k
  g.strokeRect(20 * k, 22 * k, c - 40 * k, c - 44 * k)
  // ornament: a small diamond between two rules
  const orn = (yy: number) => {
    g.fillStyle = rule
    g.beginPath()
    g.moveTo(c / 2, yy - 5 * k)
    g.lineTo(c / 2 + 5 * k, yy)
    g.lineTo(c / 2, yy + 5 * k)
    g.lineTo(c / 2 - 5 * k, yy)
    g.closePath()
    g.fill()
    g.fillRect(c / 2 - 46 * k, yy - 0.6 * k, 34 * k, 1.2 * k)
    g.fillRect(c / 2 + 12 * k, yy - 0.6 * k, 34 * k, 1.2 * k)
  }
  orn(42 * k)
  orn(c - 42 * k)
  if (spec.name) {
    g.fillStyle = ink
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const style = nameStyle(spec)
    const text = style === 'caps' ? spec.name.toUpperCase() : spec.name
    let size = style === 'slab' ? 34 : 26
    const lead = style === 'slab' ? 1.08 : 1.22
    let lines: string[] = []
    // caps are tracked 0.1 em (drawn glyph by glyph), the slab is set solid
    let track = 0
    const measure = (t: string) => (track ? trackedWidth(g, t, track) : g.measureText(t).width)
    for (; size >= 13; size -= 1) {
      g.font = style === 'slab' ? `400 ${size * k}px ${FONT.display}` : `700 ${size * k}px ${FONT.sans}`
      track = style === 'caps' ? size * k * 0.1 : 0
      lines = wrapLines(text, 170 * k, measure)
      if (lines.length * size * lead <= 146 && lines.every(l => measure(l) <= 184 * k)) break
    }
    const lh = size * lead * k
    const top = c / 2 - ((lines.length - 1) * lh) / 2
    lines.forEach((l, i) => (track ? fillTracked(g, l, c / 2, top + i * lh, track) : g.fillText(l, c / 2, top + i * lh)))
  } else {
    // blank: a seal
    g.strokeStyle = rule
    g.lineWidth = 1.6 * k
    g.beginPath()
    g.arc(c / 2, c / 2, 38 * k, 0, Math.PI * 2)
    g.stroke()
    g.beginPath()
    g.arc(c / 2, c / 2, 30 * k, 0, Math.PI * 2)
    g.stroke()
  }
  g.restore()
}

/* ---------------- the plan: where every named bottle stands ---------------- */

interface Slot {
  section: NamedRow['section']
  kind: Kind
  x: number
  y: number
  cell: number
  tint: THREE.Color
  foil: THREE.Color
  rotY: number
}

const TINTS = ['#3a1a07', '#241006', '#2e1a0c', '#1c120c', '#3b2208', '#170d08'].map(c => new THREE.Color(c))
const FOILS = ['#c9a24c', '#e8dcc0', '#1a1410', '#8e1f18', '#b8b4ac', '#c9a24c'].map(c => new THREE.Color(c))

export interface BottlePlan {
  slots: Slot[]
  specs: LabelSpec[]
  /** the named rows' spans (the kit fills the rest of each shelf) */
  rows: NamedRow[]
  posIndex: Map<string, THREE.Vector3>
}

/** lay out every named bottle (world units); pure, run before the room is built */
export function planBottles(): BottlePlan {
  const rnd = rng(31)
  const slots: Slot[] = []
  const specs: LabelSpec[] = []
  const rows: NamedRow[] = []
  const posIndex = new Map<string, THREE.Vector3>()
  const GAP = 0.2
  const layRow = (section: NamedRow['section'], names: string[], cx: number, kitY: number, startIndex: number, designSeed: number) => {
    const y = ky(kitY)
    const kinds = names.map(kindOf)
    const widths = kinds.map(k => KIND_RADIUS[k] * 2 + GAP)
    const total = widths.reduce((a, b) => a + b, 0)
    let x = cx - total / 2
    rows.push({ section, y: kitY, x0: x + GAP / 2, x1: x + total - GAP / 2 })
    names.forEach((n, i) => {
      const k = kinds[i]
      const bx = x + widths[i] / 2
      x += widths[i]
      const cell = specs.length
      specs.push({ name: n, design: (designSeed + i * 5 + Math.floor(rnd() * 3)) % PAPERS.length, big: section === 'local' })
      slots.push({
        section,
        kind: k,
        x: bx,
        y,
        cell,
        tint: TINTS[Math.floor(rnd() * TINTS.length)],
        foil: FOILS[Math.floor(rnd() * FOILS.length)],
        rotY: (rnd() - 0.5) * 0.22,
      })
      posIndex.set(`${section}:${startIndex + i}`, new THREE.Vector3(bx, y + 0.9 * KIND_SCALE[k], WALL_Z))
    })
  }
  const byId = (id: BeerGroup['id']) => BOTTLES.find(g => g.id === id)!.beers
  // AMERICAN: 5 / 5 / 4 in the brick bay
  {
    const b = byId('american')
    const rs = [b.slice(0, 5), b.slice(5, 10), b.slice(10)]
    let s = 0
    rs.forEach((r, ri) => {
      layRow('american', r, SECTION_X.american, SHELF_Y[ri], s, ri)
      s += r.length
    })
  }
  // INTERNATIONAL: 3 × 14 in list order (row 0 = top shelf = the first 14 names)
  {
    const b = byId('international')
    for (let ri = 0; ri < 3; ri++) layRow('international', b.slice(ri * 14, ri * 14 + 14), SECTION_X.international, SHELF_Y[ri], ri * 14, ri + 2)
  }
  // LOCAL: the two bottles on the Local shelf (the LP leans to their right)
  layRow('local', byId('local'), SECTION_X.local, LOCAL_SHELF, 0, 4)
  return { slots, specs, rows, posIndex }
}

/* ---------------- the meshes ---------------- */

export interface BottleWall {
  group: THREE.Group
  /**
   * Cull the bottles bottle by bottle against the camera about to render
   * (call from post.preRender; see the families below).
   */
  cull(camera: THREE.Camera): void
  /** 0..1 light through the glass (the bulbs behind/beside) */
  setBacklight(v: number): void
  /** world-space centre of a bottle of group gi, index bi */
  bottlePos(group: BeerGroup['id'], i: number, out: THREE.Vector3): THREE.Vector3
  /** redraw the label text once fonts arrive (uploads now when given the renderer) */
  redraw(renderer?: THREE.WebGLRenderer): void
}

/** the label faces the atlas draws with have landed (then the canvas can go) */
const labelFacesReady = () => {
  const f = document.fonts
  if (!f?.check) return true
  try {
    return f.check(`400 40px ${FONT.display}`, 'Glory ĀŁŠ') && f.check(`700 40px ${FONT.sans}`, 'Glory ĀŁŠ')
  } catch {
    return true
  }
}

/**
 * Pack the labels into a G×G grid of cells: the big ones (the Local pair, shot
 * in macro) as 2×2 blocks along the bottom rows, the rest row-major around them.
 */
function packAtlas(specs: LabelSpec[]) {
  for (let G = GRID; ; G++) {
    const used = new Uint8Array(G * G)
    const at: { col: number; row: number; size: number }[] = []
    let ok = true
    let bc = 0
    specs.forEach((s, i) => {
      if (!s.big || !ok) return
      const col = bc
      const row = G - 2
      bc += 2
      if (col + 2 > G) {
        ok = false
        return
      }
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) used[(row + dy) * G + col + dx] = 1
      at[i] = { col, row, size: 2 }
    })
    let c = 0
    specs.forEach((s, i) => {
      if (s.big || !ok) return
      while (c < G * G && used[c]) c++
      if (c >= G * G) {
        ok = false
        return
      }
      used[c] = 1
      at[i] = { col: c % G, row: Math.floor(c / G), size: 1 }
    })
    if (ok) return { G, at }
  }
}

const _frustum = new THREE.Frustum()
const _pv = new THREE.Matrix4()

/** the named bottles; `pools` (the room kit's) light them like the kit's own */
export async function makeBottleWall(plan: BottlePlan, mobile: boolean, pools?: { set: PoolSet; root: THREE.Object3D }): Promise<BottleWall> {
  const group = new THREE.Group()
  const { slots, specs, posIndex } = plan

  // ---- atlas ----
  // 192 px cells (128 on phones) read the shelf shots; the Local pair gets
  // 2×2 cells for its macro. The canvas is freed once the final (house-face)
  // labels are on the GPU.
  const A = mobile ? 1024 : 1536
  const { G, at } = packAtlas(specs)
  const cell = A / G
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = A
  const ctx2 = canvas.getContext('2d')!
  const draw = () => {
    ctx2.clearRect(0, 0, A, A)
    specs.forEach((s, i) => drawLabel(ctx2, at[i].col * cell, at[i].row * cell, at[i].size * cell, s))
  }
  draw()
  const atlas = new THREE.CanvasTexture(canvas)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.anisotropy = 8
  let final = false
  let freed = false
  atlas.onUpdate = () => {
    if (!final) return
    canvas.width = canvas.height = 1
    freed = true
  }

  await nextFrame()

  // ---- materials ----
  const backlight = { value: 0.3 }
  const backCol = { value: new THREE.Color('#ff9a3c') }
  const pooled = <T extends THREE.MeshStandardMaterial>(m: T, key: string) => (pools ? withPools(m, pools.set, key) : m)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.05,
    envMapIntensity: 0.9,
    specularIntensity: 1,
  })
  glassMat.onBeforeCompile = sh => {
    sh.uniforms.uBack = backlight
    sh.uniforms.uBackCol = backCol
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBack;\nuniform vec3 uBackCol;')
      .replace(
        '#include <opaque_fragment>',
        `{
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          vec3 tint = vec3(1.0);
          #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
            tint = vColor.rgb;
          #endif
          // light through the glass: it glows its own colour, brightest where it is thinnest
          outgoingLight += uBackCol * tint * 7.0 * uBack * (0.12 + 0.88 * ndv * ndv);
        }
        #include <opaque_fragment>`,
      )
  }
  glassMat.customProgramCacheKey = () => 'cellar-bottle-glass'
  pooled(glassMat, 'cellar-glass')

  const labelMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.62, metalness: 0, envMapIntensity: 0.5 })
  labelMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
      // the label's cell in the atlas (xy corner, zw size), inset 2% against mip bleed
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aCell.xy + aCell.zw * (0.02 + 0.96 * vMapUv);\n#endif')
  }
  labelMat.customProgramCacheKey = () => 'cellar-label'
  pooled(labelMat, 'cellar-label')
  const foilMat = pooled(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.4, envMapIntensity: 0.85 }), 'cellar-foil')
  const cageMat = pooled(new THREE.MeshStandardMaterial({ color: '#d8d4cc', metalness: 1, roughness: 0.3 }), 'cellar-cage')

  // ---- instanced meshes: one family per profile per section ----
  // Culled by hand (cull() below) against the camera about to render: each
  // family's instances are sorted right → left (the story moves right after
  // the bottle beats), and the family draws only the prefix up to its last
  // bottle inside the frustum — none of the wall that a shot can't see, in
  // either the frame or three's transmission pass. (A shelf's bounding sphere
  // grazes shots that never see it, e.g. the wine tower's.)
  const families: { meshes: THREE.InstancedMesh[]; boxes: THREE.Box3[] }[] = []
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const sc = new THREE.Vector3()
  const p = new THREE.Vector3()
  const build = (into: THREE.Group, unsorted: Slot[], body: THREE.BufferGeometry, labelBase: THREE.BufferGeometry, cap: THREE.BufferGeometry, cage: THREE.BufferGeometry | null) => {
    const n = unsorted.length
    if (!n) return
    const list = [...unsorted].sort((a, b) => b.x - a.x)
    // the label carries a per-family instanced attribute: its own geometry
    const label = labelBase.clone()
    const bodies = new THREE.InstancedMesh(body, glassMat, n)
    const labels = new THREE.InstancedMesh(label, labelMat, n)
    const caps = new THREE.InstancedMesh(cap, foilMat, n)
    const cages = cage ? new THREE.InstancedMesh(cage, cageMat, n) : null
    const meshes = [bodies, labels, caps, ...(cages ? [cages] : [])]
    // one bottle's bounds (glass, label, capsule, cage), placed per instance
    const unit = new THREE.Box3()
    for (const m of meshes) {
      m.geometry.computeBoundingBox()
      unit.union(m.geometry.boundingBox!)
    }
    const boxes: THREE.Box3[] = []
    const cells = new Float32Array(n * 4)
    list.forEach((s, i) => {
      const k = KIND_SCALE[s.kind]
      // a hair off the shelf: no z-fight with the walnut
      p.set(s.x, s.y + 0.003, WALL_Z)
      q.setFromEuler(e.set(0, s.rotY, 0))
      sc.setScalar(k)
      m4.compose(p, q, sc)
      for (const m of meshes) m.setMatrixAt(i, m4)
      boxes.push(unit.clone().applyMatrix4(m4))
      bodies.setColorAt(i, s.tint)
      caps.setColorAt(i, s.foil)
      const c = at[s.cell]
      cells[i * 4] = c.col / G
      cells[i * 4 + 1] = 1 - (c.row + c.size) / G
      cells[i * 4 + 2] = c.size / G
      cells[i * 4 + 3] = c.size / G
    })
    label.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 4))
    for (const m of meshes) {
      m.computeBoundingSphere()
      m.castShadow = false
      m.receiveShadow = false
      if (pools) poolHook(m, pools.set, pools.root)
      into.add(m)
    }
    families.push({ meshes, boxes })
  }
  const cork = { body: bodyGeo(CORK_BODY, mobile), label: labelGeo(0.259, 0.28, 0.9), cap: corkCapsuleGeo(), cage: cageGeo() }
  const stub = { body: bodyGeo(STUBBY_BODY, mobile), label: labelGeo(0.216, 0.2, 0.66), cap: crownGeo() }
  for (const section of ['american', 'international', 'local'] as const) {
    const into = new THREE.Group()
    into.name = `cellar-bottles-${section}`
    group.add(into)
    const mine = slots.filter(s => s.section === section)
    build(into, mine.filter(s => s.kind !== 'stubby'), cork.body, cork.label, cork.cap, cork.cage)
    build(into, mine.filter(s => s.kind === 'stubby'), stub.body, stub.label, stub.cap, null)
  }
  cork.label.dispose()
  stub.label.dispose()

  return {
    group,
    cull(camera) {
      for (const f of families) {
        // the frustum in the family's own space: test the stored boxes as they are
        _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(f.meshes[0].matrixWorld)
        _frustum.setFromProjectionMatrix(_pv)
        let count = 0
        for (let i = f.boxes.length - 1; i >= 0; i--)
          if (_frustum.intersectsBox(f.boxes[i])) {
            count = i + 1
            break
          }
        for (const m of f.meshes) {
          m.count = count
          m.visible = count > 0
        }
      }
    },
    setBacklight(v) {
      backlight.value = v
    },
    bottlePos(gid, i, out) {
      const v = posIndex.get(`${gid}:${i}`)
      return v ? out.copy(v) : out.set(0, 3, WALL_Z)
    },
    redraw(renderer) {
      if (freed) {
        canvas.width = canvas.height = A
        freed = false
      }
      draw()
      // the house faces are in: free the canvas once this upload lands
      final = labelFacesReady()
      atlas.needsUpdate = true
      // upload now (off the first Cellar frame)
      renderer?.initTexture(atlas)
    },
  }
}
