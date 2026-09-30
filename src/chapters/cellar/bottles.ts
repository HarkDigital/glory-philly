import * as THREE from 'three'
import { BOTTLES, type BeerGroup } from '../../content'
import { woodMaps } from '../../kit/bar'
import { rng } from '../../core/math'
import { nextFrame } from '../../core/yield'

/*
 * THE BOTTLE WALL: a backlit back bar of shelves, shot like Resonance's
 * product macros. Every bottle is an instance: dark glass (a physical
 * clearcoat that catches the softbox strips, plus a fake transmitted glow
 * from the backlight), a label from one canvas atlas (generic cream / gold /
 * black paper, the beer's NAME in type, no brand marks) and a foil capsule
 * (+ wire cage on the corked 750s). Four formats: the 750 corked-and-caged,
 * the 330 stubby, the magnum and the 3 litre (the 750 scaled).
 *
 * Sections along x (bottles stand at z = WALL_Z):
 *   American   x ≈ -9.5 (3 shelves: 5 / 5 / 4)
 *   International x ≈ 0 (3 shelves of 14; big formats on the bottom shelf)
 *   Local      x ≈ 8 (the two Ploughman bottles, the Glory roundel above)
 *   back bar   x 10.5 … 23 (unlabelled silhouettes behind the wine tower and
 *              the cocktail station)
 */

export const WALL_Z = -4
/** shelf bases, top → bottom */
export const ROW_Y = [6.9, 4.3, 1.0]
export const SECTION_X = { american: -7.7, international: 0, local: 8 }

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

function bodyGeo(pts: [number, number][]) {
  return new THREE.LatheGeometry(smooth(pts, 64), 36)
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
    let size = 38
    let lines: string[] = []
    for (; size >= 17; size -= 1) {
      g.font = `italic 400 ${size * k}px "Instrument Serif", Georgia, serif`
      lines = wrapLines(g, spec.name, 176 * k)
      if (lines.length * size * 1.02 <= 150 && lines.every(l => g.measureText(l).width <= 186 * k)) break
    }
    const lh = size * 1.02 * k
    const top = c / 2 - ((lines.length - 1) * lh) / 2
    lines.forEach((l, i) => g.fillText(l, c / 2, top + i * lh))
  } else {
    // blank: a big initial-free seal
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

/* ---------------- the wall ---------------- */

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

export interface BottleWall {
  group: THREE.Group
  /** 0..1 backlight strength */
  setBacklight(v: number): void
  /** world-space centre of a bottle of group gi, index bi */
  bottlePos(group: BeerGroup['id'], i: number, out: THREE.Vector3): THREE.Vector3
  /** redraw the label text once fonts arrive */
  redraw(): void
  /** x range per section and row centre heights */
  rowCentre(section: keyof typeof SECTION_X, row: number, out: THREE.Vector3): THREE.Vector3
  sectionWidth(section: keyof typeof SECTION_X): number
}

export async function makeBottleWall(mobile: boolean): Promise<BottleWall> {
  const group = new THREE.Group()
  const rnd = rng(31)
  const slots: Slot[] = []
  const specs: LabelSpec[] = []
  const posIndex = new Map<string, THREE.Vector3>()
  const sectionW: Record<string, number> = {}
  const rowCentres: Record<string, THREE.Vector3[]> = {}

  const GAP = 0.2
  /** lay one row of bottles centred on cx at base y */
  const layRow = (names: (string | null)[], cx: number, y: number, key: string | null, startIndex: number, designSeed: number) => {
    const kinds = names.map(n => (n ? kindOf(n) : rnd() > 0.45 ? 'cork' : 'stubby') as Kind)
    const widths = kinds.map(k => KIND_RADIUS[k] * 2 + GAP)
    const total = widths.reduce((a, b) => a + b, 0)
    let x = cx - total / 2
    names.forEach((n, i) => {
      const k = kinds[i]
      const bx = x + widths[i] / 2
      x += widths[i]
      let cell: number
      if (n) {
        cell = specs.length
        specs.push({ name: n, design: (designSeed + i * 5 + Math.floor(rnd() * 3)) % PAPERS.length })
      } else cell = 58 + Math.floor(rnd() * 6)
      slots.push({
        kind: k,
        x: bx,
        y,
        cell,
        tint: TINTS[Math.floor(rnd() * TINTS.length)],
        foil: FOILS[Math.floor(rnd() * FOILS.length)],
        rotY: (rnd() - 0.5) * 0.22,
      })
      if (key) posIndex.set(`${key}:${startIndex + i}`, new THREE.Vector3(bx, y + 0.9 * KIND_SCALE[k], WALL_Z))
    })
    return total
  }

  const byId = (id: BeerGroup['id']) => BOTTLES.find(g => g.id === id)!.beers
  // AMERICAN: 5 / 5 / 4
  {
    const b = byId('american')
    const rows = [b.slice(0, 5), b.slice(5, 10), b.slice(10)]
    let w = 0
    let s = 0
    rowCentres.american = []
    rows.forEach((r, ri) => {
      w = Math.max(w, layRow(r, SECTION_X.american, ROW_Y[ri], 'american', s, ri))
      rowCentres.american.push(new THREE.Vector3(SECTION_X.american, ROW_Y[ri] + 0.95, WALL_Z))
      s += r.length
    })
    sectionW.american = w
  }
  // INTERNATIONAL: 3 × 14 in list order (row 0 = top shelf = first 14 names)
  {
    const b = byId('international')
    let w = 0
    rowCentres.international = []
    for (let ri = 0; ri < 3; ri++) {
      const r = b.slice(ri * 14, ri * 14 + 14)
      w = Math.max(w, layRow(r, SECTION_X.international, ROW_Y[ri], 'international', ri * 14, ri + 2))
      rowCentres.international.push(new THREE.Vector3(SECTION_X.international, ROW_Y[ri] + (ri === 2 ? 1.3 : 0.95), WALL_Z))
    }
    sectionW.international = w
  }
  // LOCAL: the two bottles, bottom shelf
  {
    const b = byId('local')
    sectionW.local = layRow(b, SECTION_X.local, ROW_Y[2], 'local', 0, 4) + 1.4
    rowCentres.local = [0, 1, 2].map(ri => new THREE.Vector3(SECTION_X.local, ROW_Y[ri] + 0.95, WALL_Z))
  }
  // BACK BAR fillers: unlabelled silhouettes behind the wine tower and cocktails
  const FILL = [
    { cx: 13.4, n: 7 },
    { cx: 20.6, n: 9 },
  ]
  for (const f of FILL) {
    for (let ri = 0; ri < 3; ri++) layRow(new Array(f.n).fill(null), f.cx, ROW_Y[ri], null, 0, 0)
  }

  await nextFrame()

  // ---- atlas ----
  const A = mobile ? 1024 : 2048
  const cell = A / GRID
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = A
  const ctx2 = canvas.getContext('2d')!
  const blanks: LabelSpec[] = [0, 1, 2, 3, 4, 5].map(d => ({ name: null, design: d }))
  const draw = () => {
    ctx2.clearRect(0, 0, A, A)
    const all = [...specs]
    while (all.length < 58) all.push({ name: null, design: 0 })
    all.push(...blanks)
    all.forEach((s, i) => drawLabel(ctx2, (i % GRID) * cell, Math.floor(i / GRID) * cell, cell, s))
  }
  draw()
  const atlas = new THREE.CanvasTexture(canvas)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.anisotropy = 8

  await nextFrame()

  // ---- materials ----
  const backlight = { value: 1 }
  const backCol = { value: new THREE.Color('#ff9a3c') }
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.5,
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
          // transmitted backlight: the glass glows its own colour, brightest where it is thinnest
          outgoingLight += uBackCol * tint * 7.0 * uBack * (0.12 + 0.88 * ndv * ndv);
        }
        #include <opaque_fragment>`,
      )
  }
  glassMat.customProgramCacheKey = () => 'cellar-bottle-glass'

  const labelMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.62, metalness: 0, envMapIntensity: 0.5 })
  labelMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * ${(1 / GRID).toFixed(4)} * 0.96 + ${(0.02 / GRID).toFixed(5)} + aCell;\n#endif`)
  }
  labelMat.customProgramCacheKey = () => 'cellar-label'
  const foilMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.3 })
  const cageMat = new THREE.MeshStandardMaterial({ color: '#d8d4cc', metalness: 1, roughness: 0.3 })

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
    const bodies = new THREE.InstancedMesh(body, glassMat, n)
    const labels = new THREE.InstancedMesh(label, labelMat, n)
    const caps = new THREE.InstancedMesh(cap, foilMat, n)
    const cages = cage ? new THREE.InstancedMesh(cage, cageMat, n) : null
    const cells = new Float32Array(n * 2)
    list.forEach((s, i) => {
      const k = KIND_SCALE[s.kind]
      p.set(s.x, s.y, WALL_Z)
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
      group.add(m)
    }
  }
  build(corkLike, bodyGeo(CORK_BODY), labelGeo(0.259, 0.28, 0.9), corkCapsuleGeo(), cageGeo())
  build(stubs, bodyGeo(STUBBY_BODY), labelGeo(0.216, 0.2, 0.66), crownGeo(), null)

  await nextFrame()

  // ---- shelves, backlight panels, uprights, the back counter ----
  const { map, roughnessMap } = woodMaps()
  const plankMat = new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: 0.6, color: '#b58a66' })
  const steelMat = new THREE.MeshStandardMaterial({ color: '#141212', metalness: 0.6, roughness: 0.45 })
  // the backlight: a warm onyx glow, brightest just above each shelf (an LED strip under the plank above)
  const glowCv = document.createElement('canvas')
  glowCv.width = 64
  glowCv.height = 256
  {
    const g = glowCv.getContext('2d')!
    const gr = g.createLinearGradient(0, 256, 0, 0)
    gr.addColorStop(0, 'rgb(255,214,160)')
    gr.addColorStop(0.35, 'rgb(236,150,70)')
    gr.addColorStop(0.8, 'rgb(120,56,20)')
    gr.addColorStop(1, 'rgb(40,16,6)')
    g.fillStyle = gr
    g.fillRect(0, 0, 64, 256)
    // onyx veining, very soft
    const r2 = rng(9)
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(80,30,8,${0.05 + r2() * 0.08})`
      g.lineWidth = 1 + r2() * 4
      g.beginPath()
      g.moveTo(r2() * 64, r2() * 256)
      g.bezierCurveTo(r2() * 64, r2() * 256, r2() * 64, r2() * 256, r2() * 64, r2() * 256)
      g.stroke()
    }
  }
  const glowTex = new THREE.CanvasTexture(glowCv)
  glowTex.colorSpace = THREE.SRGBColorSpace
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1, 1, 1) })

  // [centre, width, first row] — Local is one shelf under the roundel
  const sections: [number, number, number][] = [
    [SECTION_X.american, sectionW.american + 0.6, 0],
    [SECTION_X.international, sectionW.international + 0.6, 0],
    [SECTION_X.local, sectionW.local + 0.6, 2],
    [FILL[0].cx, 6.2, 0],
    [FILL[1].cx, 7.6, 0],
  ]
  const heights = [2.5, 2.55, 3.25] // clearance above each shelf (top, mid, bottom)
  for (const [cx, w, r0] of sections) {
    for (let ri = r0; ri < 3; ri++) {
      const y = ROW_Y[ri]
      const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 1.05), plankMat)
      plank.position.set(cx, y - 0.05, WALL_Z + 0.05)
      plank.receiveShadow = true
      group.add(plank)
      const h = heights[ri]
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.1), glowMat)
      glow.position.set(cx, y + (h - 0.1) / 2, WALL_Z - 0.55)
      group.add(glow)
    }
    // top cap and uprights
    const capY = ROW_Y[r0] + heights[r0]
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.16, 1.2), steelMat)
    cap.position.set(cx, capY, WALL_Z)
    group.add(cap)
    const upH = capY - ROW_Y[2] + 1.6
    for (const sx of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.14, upH, 1.2), steelMat)
      up.position.set(cx + sx * (w / 2 + 0.07), ROW_Y[2] - 1.6 + upH / 2, WALL_Z)
      group.add(up)
    }
  }
  // the dark wall between and around sections
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), new THREE.MeshStandardMaterial({ color: '#120a07', roughness: 0.9 }))
  wall.position.set(6, 4, WALL_Z - 0.6)
  group.add(wall)
  // the back counter under the bottom shelf
  const counter = new THREE.Mesh(new THREE.BoxGeometry(60, 3, 1.4), new THREE.MeshStandardMaterial({ color: '#1a0f0a', roughness: 0.7 }))
  counter.position.set(6, ROW_Y[2] - 1.6, WALL_Z + 0.1)
  group.add(counter)

  return {
    group,
    setBacklight(v) {
      backlight.value = v
      glowMat.color.setScalar(v * 0.42)
    },
    bottlePos(gid, i, out) {
      const v = posIndex.get(`${gid}:${i}`)
      return v ? out.copy(v) : out.set(0, 3, WALL_Z)
    },
    redraw() {
      draw()
      atlas.needsUpdate = true
    },
    rowCentre(section, row, out) {
      return out.copy(rowCentres[section][row])
    },
    sectionWidth(section) {
      return sectionW[section]
    },
  }
}
