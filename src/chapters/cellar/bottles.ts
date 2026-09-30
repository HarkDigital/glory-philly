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
 *   American       the brick bay under the painted "Old 1837": 5 / 5 / 4
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
}

function wrapLines(g: CanvasRenderingContext2D, text: string, width: number) {
  const words = text.replace(/\s+-\s+/g, ' ').split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (g.measureText(t).width <= width || !cur) cur = t
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
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
    const gg = g as CanvasRenderingContext2D & { letterSpacing?: string }
    let size = style === 'slab' ? 34 : 26
    const lead = style === 'slab' ? 1.08 : 1.22
    let lines: string[] = []
    for (; size >= 13; size -= 1) {
      g.font = style === 'slab' ? `400 ${size * k}px ${FONT.display}` : `700 ${size * k}px ${FONT.sans}`
      if (style === 'caps') gg.letterSpacing = `${(size * k * 0.1).toFixed(2)}px`
      lines = wrapLines(g, text, 170 * k)
      if (lines.length * size * lead <= 146 && lines.every(l => g.measureText(l).width <= 184 * k)) break
    }
    const lh = size * lead * k
    const top = c / 2 - ((lines.length - 1) * lh) / 2
    lines.forEach((l, i) => g.fillText(l, c / 2, top + i * lh))
    if (style === 'caps') gg.letterSpacing = '0px'
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
      specs.push({ name: n, design: (designSeed + i * 5 + Math.floor(rnd() * 3)) % PAPERS.length })
      slots.push({
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
  // AMERICAN: 5 / 5 / 4 under the paint
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
  /** 0..1 light through the glass (the bulbs behind/beside) */
  setBacklight(v: number): void
  /** world-space centre of a bottle of group gi, index bi */
  bottlePos(group: BeerGroup['id'], i: number, out: THREE.Vector3): THREE.Vector3
  /** redraw the label text once fonts arrive */
  redraw(): void
}

/** the named bottles; `pools` (the room kit's) light them like the kit's own */
export async function makeBottleWall(plan: BottlePlan, mobile: boolean, pools?: { set: PoolSet; root: THREE.Object3D }): Promise<BottleWall> {
  const group = new THREE.Group()
  const { slots, specs, posIndex } = plan

  // ---- atlas ----
  const A = mobile ? 1024 : 2048
  const cell = A / GRID
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = A
  const ctx2 = canvas.getContext('2d')!
  const draw = () => {
    ctx2.clearRect(0, 0, A, A)
    specs.forEach((s, i) => drawLabel(ctx2, (i % GRID) * cell, Math.floor(i / GRID) * cell, cell, s))
  }
  draw()
  const atlas = new THREE.CanvasTexture(canvas)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.anisotropy = 8

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
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * ${(1 / GRID).toFixed(4)} * 0.96 + ${(0.02 / GRID).toFixed(5)} + aCell;\n#endif`)
  }
  labelMat.customProgramCacheKey = () => 'cellar-label'
  pooled(labelMat, 'cellar-label')
  const foilMat = pooled(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.4, envMapIntensity: 0.85 }), 'cellar-foil')
  const cageMat = pooled(new THREE.MeshStandardMaterial({ color: '#d8d4cc', metalness: 1, roughness: 0.3 }), 'cellar-cage')

  // ---- instanced meshes: one family per profile ----
  const corkLike = slots.filter(s => s.kind !== 'stubby')
  const stubs = slots.filter(s => s.kind === 'stubby')
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const sc = new THREE.Vector3()
  const p = new THREE.Vector3()
  const build = (list: Slot[], body: THREE.BufferGeometry, label: THREE.BufferGeometry, cap: THREE.BufferGeometry, cage: THREE.BufferGeometry | null) => {
    const n = list.length
    if (!n) return
    const bodies = new THREE.InstancedMesh(body, glassMat, n)
    const labels = new THREE.InstancedMesh(label, labelMat, n)
    const caps = new THREE.InstancedMesh(cap, foilMat, n)
    const cages = cage ? new THREE.InstancedMesh(cage, cageMat, n) : null
    const cells = new Float32Array(n * 2)
    list.forEach((s, i) => {
      const k = KIND_SCALE[s.kind]
      // a hair off the shelf: no z-fight with the walnut
      p.set(s.x, s.y + 0.003, WALL_Z)
      q.setFromEuler(e.set(0, s.rotY, 0))
      sc.setScalar(k)
      m4.compose(p, q, sc)
      bodies.setMatrixAt(i, m4)
      labels.setMatrixAt(i, m4)
      caps.setMatrixAt(i, m4)
      cages?.setMatrixAt(i, m4)
      bodies.setColorAt(i, s.tint)
      caps.setColorAt(i, s.foil)
      cells[i * 2] = (s.cell % GRID) / GRID
      cells[i * 2 + 1] = 1 - (Math.floor(s.cell / GRID) + 1) / GRID
    })
    label.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2))
    for (const m of [bodies, labels, caps, cages]) {
      if (!m) continue
      m.frustumCulled = false
      m.castShadow = false
      m.receiveShadow = false
      if (pools) poolHook(m, pools.set, pools.root)
      group.add(m)
    }
  }
  build(corkLike, bodyGeo(CORK_BODY, mobile), labelGeo(0.259, 0.28, 0.9), corkCapsuleGeo(), cageGeo())
  build(stubs, bodyGeo(STUBBY_BODY, mobile), labelGeo(0.216, 0.2, 0.66), crownGeo(), null)

  return {
    group,
    setBacklight(v) {
      backlight.value = v
    },
    bottlePos(gid, i, out) {
      const v = posIndex.get(`${gid}:${i}`)
      return v ? out.copy(v) : out.set(0, 3, WALL_Z)
    },
    redraw() {
      draw()
      atlas.needsUpdate = true
    },
  }
}
