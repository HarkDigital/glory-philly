import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * GLORY KIT: the tap wall (owned by the TAPS chapter; reusable anywhere a
 * row of draft taps is wanted — the cellar's wine taps, a bar shot).
 *
 *   const wall = makeTapWall({ taps: [{ name: 'Pliny the Elder', num: '14' }, …], x: [...] })
 *   group.add(wall.group)
 *   await wall.drawLabels()             // after fonts load; call again on fonts.ready
 *   wall.setPull(13, 0.8)               // handle 13 pulled forward (0 rest .. 1 open)
 *   wall.spout(13, v)                   // where the beer leaves the faucet
 *
 * The pour itself (stream, glass, backlight) comes from kit/beer.ts.
 *
 * Everything repeated is instanced (faucets, handles, label plates: three
 * draw calls for any number of taps). Each handle is a tall lacquered
 * handle with a painted label plate; the plates read from one canvas atlas
 * (the beer's name set vertically in the sign's slab face, a tap number on
 * top), so a close shot reads the beer on the handle. Handles pivot at the
 * faucet like the real thing: pull brings the top toward the viewer (+z).
 *
 * The plate atlas is sized for the plates' on-screen size (a plate is ~2.5 cm
 * wide: ~40 CSS px in the tightest macro): `tileW` px per plate, 60 by default
 * (pass ~80 on desktop for a retina macro). Its canvas is freed after each
 * upload; drawLabels() restores it, so the fonts.ready redraw still works.
 *
 * Frame (local units, ~1 = 1 ft): faucets at y = FAUCET_Y, their fronts at
 * z = FAUCET_Z, the stainless manifold behind them at z = MANIFOLD_Z on a
 * black steel backplate. The drip tray top is at y = TRAY_Y. Put the wall
 * (walnut cladding / brick) at z ≈ -0.945 behind it.
 *
 * BAYS: a wall split by clad columns (the real room) passes `bays` — each
 * bay's taps (first..last) get their own manifold run, backplate and drip
 * tray, kept inside the bay's clear width [x0, x1] (column face to column
 * face), so nothing passes into a column:
 *   makeTapWall({ taps, x, bays: [{ first: 0, last: 18, x0: -7.1, x1: -1.1 }, …] })
 * Still three draws for the handles/plates/faucets and one each for the
 * manifolds, backplates, tray bodies and grates, however many bays.
 */

export interface TapSpec {
  /** the beer's name as listed (drawn on the plate; omitted = house roundel) */
  name?: string
  /** tap number, e.g. "07" */
  num: string
}

export const FAUCET_Y = 1.2
export const FAUCET_Z = -0.42
export const MANIFOLD_Z = -0.76
export const TRAY_Y = 0.034
/** handle height above its pivot */
export const HANDLE_H = 0.72
const PIVOT_Y = FAUCET_Y + 0.085
const PLATE_W = 0.08
/** the plate art's design space (px); the atlas tiles are this scaled to `tileW` */
const TILE_W = 120
const TILE_H = 680
const PLATE_H = (PLATE_W * TILE_H) / TILE_W
const PLATE_Y = 0.2 + PLATE_H / 2
const HANDLE_D = 0.062

/** handle lacquers (sRGB): black, walnut, oak, oxblood, cream, amber, stout */
const LACQUERS = ['#110d0c', '#3a2014', '#5a3620', '#5a1410', '#cbbd9f', '#110d0c', '#241510', '#6e4424', '#2e1a12', '#1a1a1c']
/** plate styles: [background, ink, rule] */
const PLATES: [string, string, string][] = [
  ['#eee3c9', '#1a110c', '#b0261f'],
  ['#15100c', '#f3ead8', '#f0a53a'],
  ['#b81f25', '#fff4e6', '#fff4e6'],
  ['#e9c77a', '#1a110c', '#1a110c'],
  ['#f3ead8', '#7a1a14', '#7a1a14'],
]

/** a run of taps between two columns: taps first..last, clear width x0..x1 */
export interface TapBay {
  first: number
  last: number
  x0: number
  x1: number
}

export interface TapWall {
  group: THREE.Group
  count: number
  /** x of each tap */
  x: number[]
  /** the bays (one spanning every tap when none were given) */
  bays: TapBay[]
  /** redraw the label atlas (await fonts first; call again on document.fonts.ready) */
  drawLabels(): void
  /** 0 rest .. 1 fully open; slightly negative = a spring overshoot backward */
  setPull(i: number, pull: number): void
  /** world-local point where the beer leaves faucet i */
  spout(i: number, out: THREE.Vector3): THREE.Vector3
  /** world-local top of handle i (follows its pull) */
  handleTop(i: number, out: THREE.Vector3): THREE.Vector3
  /**
   * Give the metal and lacquer their OWN reflections (the world's studio env),
   * so a chapter can dim scene.environmentIntensity (the room's ambient)
   * while the steel keeps its softbox highlights.
   */
  setEnv(env: THREE.Texture, steel?: number): void
  dispose(): void
}

function hash(i: number) {
  let t = (i * 0x9e3779b1) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** faucet + shank + collar, merged (origin: the faucet's pivot column at y = FAUCET_Y, z = FAUCET_Z) */
function faucetGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  // shank from the manifold forward
  const shank = new THREE.CylinderGeometry(0.017, 0.017, FAUCET_Z - MANIFOLD_Z - 0.06, 20, 1, true)
  shank.rotateX(Math.PI / 2)
  shank.translate(0, 0, (MANIFOLD_Z + FAUCET_Z - 0.06) / 2 - FAUCET_Z)
  parts.push(shank)
  // coupling nut
  const nut = new THREE.CylinderGeometry(0.028, 0.028, 0.03, 6)
  nut.rotateX(Math.PI / 2)
  nut.translate(0, 0, -0.1)
  parts.push(nut)
  // faucet body: a rounded cylinder along z, front nose
  const bodyPts: THREE.Vector2[] = []
  const L = 0.13
  for (let k = 0; k <= 12; k++) {
    const y = -L / 2 + (L * k) / 12
    const endRound = Math.min(1, (L / 2 - Math.abs(y)) / 0.012)
    bodyPts.push(new THREE.Vector2(0.031 * Math.sqrt(Math.max(0.0001, endRound * (2 - endRound))), y))
  }
  const body = new THREE.LatheGeometry(bodyPts, 28)
  body.rotateX(Math.PI / 2)
  body.translate(0, 0, -0.045)
  parts.push(body)
  // spout pointing down at the front
  const spout = new THREE.CylinderGeometry(0.013, 0.016, 0.1, 18, 1, true)
  spout.translate(0, -0.06, 0.012)
  parts.push(spout)
  const lip = new THREE.TorusGeometry(0.0135, 0.004, 8, 20)
  lip.rotateX(Math.PI / 2)
  lip.translate(0, -0.11, 0.012)
  parts.push(lip)
  // lever collar + ferrule the handle screws onto
  const collar = new THREE.CylinderGeometry(0.02, 0.026, 0.05, 20)
  collar.translate(0, 0.045, -0.02)
  parts.push(collar)
  const ferrule = new THREE.CylinderGeometry(0.014, 0.018, 0.035, 16)
  ferrule.translate(0, 0.075, -0.02)
  parts.push(ferrule)
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()), false)!
  parts.forEach(p => p.dispose())
  g.computeVertexNormals()
  return g
}

/** a tall lacquered handle, wider at the top, origin at its pivot (bottom) */
function handleGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.12, HANDLE_H, HANDLE_D, 2, 12, 2)
  g.translate(0, HANDLE_H / 2, 0)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / HANDLE_H
    const wx = 0.52 + 0.48 * Math.min(1, t * 1.25)
    // a soft shoulder at the top
    const sh = t > 0.93 ? 1 - (t - 0.93) * 2.2 : 1
    p.setX(i, p.getX(i) * wx * sh)
    p.setZ(i, p.getZ(i) * (0.75 + 0.25 * Math.min(1, t * 1.6)) * (t > 0.93 ? 0.94 : 1))
  }
  g.computeVertexNormals()
  return g
}

/** plate atlas: 12 columns of tiles (tileW × tileW·680/120 px each) */
const COLS = 12

function splitLines(words: string[], k: number): string[] {
  if (k <= 1 || words.length <= 1) return [words.join(' ')]
  // balanced split by characters (k ≤ 3, so brute force the cut points)
  let best: string[] = [words.join(' ')]
  let bestW = Infinity
  const n = words.length
  const cuts = (start: number, left: number): number[][] => {
    if (left === 0) return [[]]
    const out: number[][] = []
    for (let c = start + 1; c <= n - left; c++) for (const rest of cuts(c, left - 1)) out.push([c, ...rest])
    return out
  }
  for (const cs of cuts(0, k - 1)) {
    const idx = [0, ...cs, n]
    const lines = idx.slice(0, -1).map((a, j) => words.slice(a, idx[j + 1]).join(' '))
    const w = Math.max(...lines.map(l => l.length))
    if (w < bestW) {
      bestW = w
      best = lines
    }
  }
  return best
}

/** one plate into its tile at (x0, y0), `k` atlas px per design px */
function drawPlate(g: CanvasRenderingContext2D, x0: number, y0: number, k: number, spec: TapSpec, style: number) {
  const [bg, ink, rule] = PLATES[style]
  const W = TILE_W
  const H = TILE_H
  g.save()
  g.translate(x0, y0)
  g.scale(k, k)
  g.fillStyle = '#0c0806'
  g.fillRect(0, 0, W, H)
  g.fillStyle = bg
  g.beginPath()
  g.roundRect(3, 3, W - 6, H - 6, 12)
  g.fill()
  // enamel border
  g.strokeStyle = rule
  g.globalAlpha = 0.85
  g.lineWidth = 2.5
  g.beginPath()
  g.roundRect(10, 10, W - 20, H - 20, 8)
  g.stroke()
  g.globalAlpha = 1
  if (!spec.name) {
    // the house handle: the red G roundel
    g.fillStyle = '#15100c'
    g.beginPath()
    g.roundRect(3, 3, W - 6, H - 6, 12)
    g.fill()
    const cx = W / 2
    const cy = H * 0.42
    g.fillStyle = '#d8272e'
    g.beginPath()
    g.arc(cx, cy, 44, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#f3ead8'
    g.lineWidth = 3
    g.beginPath()
    g.arc(cx, cy, 38, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = '#fff4e6'
    g.font = '400 56px "Alfa Slab One", Georgia, serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('G', cx, cy + 3)
    g.font = '600 20px "Inter Tight Variable", "Inter Tight", system-ui, sans-serif'
    g.fillStyle = '#f0a53a'
    g.fillText(spec.num, cx, 44)
    g.restore()
    return
  }
  // tap number
  g.fillStyle = ink
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = '600 26px "Inter Tight Variable", "Inter Tight", system-ui, sans-serif'
  g.fillText(spec.num, W / 2, 46)
  g.fillStyle = rule
  g.fillRect(W / 2 - 22, 72, 44, 3)
  // the name, set vertically (reads bottom → top), fitted
  const text = spec.name.toUpperCase().replace(/\s+-\s+/g, ' · ')
  const words = text.split(/\s+/)
  const avLen = H - 120 - 26
  const avW = W - 34
  let best = { size: 0, lines: [text] }
  for (let k = 1; k <= 3; k++) {
    const lines = splitLines(words, k)
    g.font = '400 100px "Alfa Slab One", Georgia, serif'
    const wMax = Math.max(...lines.map(l => g.measureText(l).width)) / 100
    const size = Math.min(avLen / wMax, avW / (k * 1.08), 60)
    if (size > best.size * 1.08) best = { size, lines }
  }
  g.translate(W / 2, 120 + avLen / 2)
  g.rotate(-Math.PI / 2)
  g.font = `400 ${best.size.toFixed(1)}px "Alfa Slab One", Georgia, serif`
  g.fillStyle = ink
  const lh = best.size * 1.06
  best.lines.forEach((l, j) => g.fillText(l, 0, (j - (best.lines.length - 1) / 2) * lh + best.size * 0.04))
  g.restore()
}

export function makeTapWall({ taps, x, bays, tileW = 60 }: { taps: TapSpec[]; x: number[]; bays?: TapBay[]; tileW?: number }): TapWall {
  const count = taps.length
  const group = new THREE.Group()
  group.name = 'tapWall'
  const x0 = Math.min(...x)
  const x1 = Math.max(...x)

  // ---- stainless (separate material instances: instanced vs plain meshes)
  const steelOpts = { color: '#e9e6e1', metalness: 1, roughness: 0.17, envMapIntensity: 1.1 }
  const faucetMat = new THREE.MeshStandardMaterial(steelOpts)
  const manifoldMat = new THREE.MeshStandardMaterial({ ...steelOpts, roughness: 0.3 })
  const trayMat = new THREE.MeshStandardMaterial({ ...steelOpts, roughness: 0.32 })

  const faucetGeo = faucetGeometry()
  const faucets = new THREE.InstancedMesh(faucetGeo, faucetMat, count)
  faucets.castShadow = true
  const m = new THREE.Matrix4()
  for (let i = 0; i < count; i++) {
    m.makeTranslation(x[i], FAUCET_Y, FAUCET_Z)
    faucets.setMatrixAt(i, m)
  }
  faucets.computeBoundingSphere()

  // bays: each bay's taps get their own manifold run, backplate and tray (kept inside x0..x1)
  const bayList: TapBay[] = bays && bays.length ? bays : [{ first: 0, last: count - 1, x0: x0 - 0.45, x1: x1 + 0.45 }]
  const tubeGeos: THREE.BufferGeometry[] = []
  const plateGeos: THREE.BufferGeometry[] = []
  const trayGeos: THREE.BufferGeometry[] = []
  const grateGeos: THREE.BufferGeometry[] = []
  const put = (g: THREE.BufferGeometry, px: number, py: number, pz: number) => {
    g.translate(px, py, pz)
    return g.index ? g.toNonIndexed() : g
  }
  for (const b of bayList) {
    const bx0 = x[b.first]
    const bx1 = x[b.last]
    // manifold: a stainless tube with end caps on standoffs, 0.22 past the end taps (never into a column)
    const t0 = Math.max(b.x0 + 0.05, bx0 - 0.22)
    const t1 = Math.min(b.x1 - 0.05, bx1 + 0.22)
    const tube = new THREE.CylinderGeometry(0.046, 0.046, t1 - t0, 32, 1, false)
    tube.rotateZ(Math.PI / 2)
    tubeGeos.push(put(tube, (t0 + t1) / 2, FAUCET_Y, MANIFOLD_Z))
    const nS = Math.max(2, Math.round((t1 - t0) / 0.9) + 1)
    for (let k = 0; k < nS; k++) {
      const st = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 12)
      st.rotateX(Math.PI / 2)
      tubeGeos.push(put(st, t0 + 0.1 + ((t1 - t0 - 0.2) * k) / (nS - 1), FAUCET_Y, MANIFOLD_Z - 0.1))
    }
    // black steel backplate: fills the bay's clear width
    const pw = b.x1 - b.x0 - 0.02
    plateGeos.push(put(new THREE.BoxGeometry(pw, 0.56, 0.03), (b.x0 + b.x1) / 2, FAUCET_Y + 0.02, -0.92))
    // drip tray: a stainless body with a slotted grate on top (the grate tiles every 0.1 along x)
    const r0 = Math.max(b.x0 + 0.03, bx0 - 0.22)
    const r1 = Math.min(b.x1 - 0.03, bx1 + 0.22)
    trayGeos.push(put(new THREE.BoxGeometry(r1 - r0, TRAY_Y - 0.001, 0.36), (r0 + r1) / 2, (TRAY_Y - 0.001) / 2, FAUCET_Z + 0.02))
    const gr = new THREE.PlaneGeometry(r1 - r0 - 0.004, 0.356)
    gr.rotateX(-Math.PI / 2)
    const uv = gr.attributes.uv as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * ((r1 - r0) / 0.1))
    grateGeos.push(put(gr, (r0 + r1) / 2, TRAY_Y, FAUCET_Z + 0.02))
  }
  const merged = (gs: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(gs, false)!
    gs.forEach(x => x.dispose())
    return g
  }
  const manifold = new THREE.Mesh(merged(tubeGeos), manifoldMat)
  manifold.castShadow = true

  // black steel backplate(s) the manifold is mounted on
  const plateMat = new THREE.MeshStandardMaterial({ color: '#0e0b0a', metalness: 0.55, roughness: 0.42 })
  const backplate = new THREE.Mesh(merged(plateGeos), plateMat)
  backplate.receiveShadow = true

  // drip tray: stainless with a slotted grate
  const grate = document.createElement('canvas')
  grate.width = 64
  grate.height = 64
  const gg = grate.getContext('2d')!
  gg.fillStyle = '#c9c6c0'
  gg.fillRect(0, 0, 64, 64)
  gg.fillStyle = '#1a1714'
  for (let k = 0; k < 4; k++) gg.fillRect(k * 16 + 5, 6, 6, 52)
  const grateTex = new THREE.CanvasTexture(grate)
  grateTex.colorSpace = THREE.SRGBColorSpace
  grateTex.wrapS = grateTex.wrapT = THREE.RepeatWrapping
  grateTex.anisotropy = 8
  const trayTopMat = new THREE.MeshStandardMaterial({ ...steelOpts, roughness: 0.35, map: grateTex })
  const tray = new THREE.Mesh(merged(trayGeos), trayMat)
  tray.receiveShadow = true
  const trayTop = new THREE.Mesh(merged(grateGeos), trayTopMat)
  trayTop.receiveShadow = true

  // ---- handles (instanced, per-instance lacquer)
  const handleMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 0.9 })
  const handles = new THREE.InstancedMesh(handleGeometry(), handleMat, count)
  handles.castShadow = true
  const col = new THREE.Color()
  const styles: number[] = []
  for (let i = 0; i < count; i++) {
    const r = hash(i + 3)
    const lac = taps[i].name ? LACQUERS[Math.floor(r * LACQUERS.length)] : '#141010'
    handles.setColorAt(i, col.set(lac))
    // plate: contrast with the lacquer (light lacquer → dark plate)
    const light = lac === '#cbbd9f'
    const r2 = hash(i + 101)
    styles.push(light ? (r2 > 0.5 ? 1 : 2) : [0, 0, 3, 4, 2, 0][Math.floor(r2 * 6)])
  }

  // ---- label plates (instanced, each samples its own atlas tile)
  const atlas = document.createElement('canvas')
  const rows = Math.ceil(count / COLS)
  const tw = Math.max(16, Math.round(tileW))
  const th = Math.round((tw * TILE_H) / TILE_W)
  const aw = tw * COLS
  const ah = th * rows
  atlas.width = aw
  atlas.height = ah
  const atlasTex = new THREE.CanvasTexture(atlas)
  atlasTex.colorSpace = THREE.SRGBColorSpace
  atlasTex.anisotropy = 8
  // the GPU copy is all that's needed once uploaded: free the canvas (drawLabels restores it; the
  // texture's storage keeps the full size, so a later redraw uploads into it again)
  atlasTex.onUpdate = () => {
    atlas.width = atlas.height = 1
  }
  const plateGeo = new THREE.PlaneGeometry(PLATE_W, PLATE_H)
  const tile = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    tile[i * 2] = (i % COLS) / COLS
    tile[i * 2 + 1] = 1 - (Math.floor(i / COLS) + 1) / rows
  }
  plateGeo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tile, 2))
  const labelMat = new THREE.MeshStandardMaterial({ map: atlasTex, color: '#c9c3b8', roughness: 0.32, metalness: 0, envMapIntensity: 0.6 })
  labelMat.onBeforeCompile = sh => {
    sh.uniforms.uTileScale = { value: new THREE.Vector2(1 / COLS, 1 / rows) }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTile;\nuniform vec2 uTileScale;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vMapUv * uTileScale + aTile;\n#endif')
  }
  labelMat.customProgramCacheKey = () => 'glory-tap-plates'
  const plates = new THREE.InstancedMesh(plateGeo, labelMat, count)

  const pulls = new Float32Array(count)
  const piv = new THREE.Matrix4()
  const rot = new THREE.Matrix4()
  const loc = new THREE.Matrix4()
  const writeHandle = (i: number) => {
    const a = pulls[i] * 0.62
    piv.makeTranslation(x[i], PIVOT_Y, FAUCET_Z - 0.02)
    rot.makeRotationX(a)
    piv.multiply(rot)
    handles.setMatrixAt(i, piv)
    loc.makeTranslation(0, PLATE_Y, HANDLE_D / 2 + 0.0015)
    m.multiplyMatrices(piv, loc)
    plates.setMatrixAt(i, m)
  }
  for (let i = 0; i < count; i++) writeHandle(i)
  handles.computeBoundingSphere()
  plates.computeBoundingSphere()

  group.add(backplate, manifold, tray, trayTop, faucets, handles, plates)

  const drawLabels = () => {
    if (atlas.width !== aw || atlas.height !== ah) {
      atlas.width = aw
      atlas.height = ah
    }
    const g = atlas.getContext('2d')!
    g.fillStyle = '#0c0806'
    g.fillRect(0, 0, aw, ah)
    for (let i = 0; i < count; i++) drawPlate(g, (i % COLS) * tw, Math.floor(i / COLS) * th, tw / TILE_W, taps[i], styles[i])
    atlasTex.needsUpdate = true
  }
  drawLabels()

  const v = new THREE.Vector3()
  return {
    group,
    count,
    x,
    bays: bayList,
    drawLabels,
    setPull(i, pull) {
      if (Math.abs(pulls[i] - pull) < 1e-4) return
      pulls[i] = pull
      writeHandle(i)
      handles.instanceMatrix.needsUpdate = true
      plates.instanceMatrix.needsUpdate = true
    },
    spout(i, out) {
      return out.set(x[i], FAUCET_Y - 0.115, FAUCET_Z + 0.012)
    },
    handleTop(i, out) {
      const a = pulls[i] * 0.62
      v.set(0, HANDLE_H * Math.cos(a), HANDLE_H * Math.sin(a))
      return out.set(x[i], PIVOT_Y, FAUCET_Z - 0.02).add(v)
    },
    setEnv(env, steel = 1.15) {
      for (const [mt, k] of [
        [faucetMat, steel],
        [manifoldMat, steel],
        [trayMat, steel * 0.8],
        [trayTopMat, steel * 0.8],
        [plateMat, 0.7],
        [handleMat, 0.75],
        [labelMat, 0.3],
      ] as [THREE.MeshStandardMaterial, number][]) {
        mt.envMap = env
        mt.envMapIntensity = k
        mt.needsUpdate = true
      }
    },
    dispose() {
      group.traverse(o => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
      ;[faucetMat, manifoldMat, trayMat, trayTopMat, plateMat, handleMat, labelMat].forEach(mt => mt.dispose())
      atlasTex.dispose()
      grateTex.dispose()
    },
  }
}
