import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { BAR, DRAFTS, LINKS, SECTIONS, TAPS_UI } from '../../content'
import { makeGlass, makeBacklight, makePourStream, BEERS, type BeerStyle, type Glass, type GlassShape } from '../../kit/beer'
import { makeBarTop, makeBrickWall } from '../../kit/bar'
import { makeTapWall, TRAY_Y, FAUCET_Y, FAUCET_Z, type TapSpec } from '../../kit/tap'
import { StoryClock } from '../../kit/pace'
import { makeChalkboard, type Chalkboard } from './chalk'
import './taps.css'

/*
 * ON TAP — the tap wall (5.6 viewport heights).
 *
 *  0.000–0.045  in-beat: a macro on one chrome faucet, sliding past (the pour
 *               cut covers the first ~3%), pulling back into
 *  0.045–0.235  THE REVEAL: the camera pulls back along the wall — 36 handles
 *               on a stainless manifold against old brick — "36 beers on tap."
 *               with the Bar page intro (first sentence as the lead).
 *  0.25–0.49    AMERICAN   (19) · dolly along its stretch, settle on one handle:
 *  0.51–0.67    INTERNATIONAL (9)   it pulls forward and pours into a glass
 *  0.69–0.85    LOCAL      (7)   tinted for the group. The group's list sits in
 *                                 a menu-board panel (two columns on desktop,
 *                                 paged on phones so every name reads at rest).
 *  0.87–1.000   the chalkboard at the end of the wall: "Last Update
 *               2026-09-28", the app + Untappd buttons.
 *
 * The camera and the active group run on a StoryClock (kit/pace.ts), so a
 * fling never sweeps the lit wall across the frame faster than it can read.
 * The 36th handle is the house handle (the red G roundel, no beer named):
 * 35 beers are listed and the wall has 36 taps.
 */

const INTRO_A = 0.045
const INTRO_B = 0.235
const GROUPS: [number, number][] = [
  [0.25, 0.49],
  [0.51, 0.67],
  [0.69, 0.85],
]
const END_A = 0.87
/** each group mid-pour: handle pulled, callout + panel up (u = 0.45) */
const ANCHORS = GROUPS.map(([a, b]) => +(a + 0.45 * (b - a)).toFixed(3))

/** the handle that pours per group (by name; falls back to the middle), its glass and beer */
const POURS: { name: string; shape: GlassShape; beer: BeerStyle; tint: number }[] = [
  { name: 'Russian River Pliny the Elder', shape: 'pint', beer: BEERS.gold, tint: 0.3 },
  { name: 'Straffe Hendrik Quadrupel', shape: 'goblet', beer: BEERS.ruby, tint: 0.72 },
  { name: 'Glory Beer Bar - Gloria - Old City Saison', shape: 'tulip', beer: BEERS.straw, tint: 0.12 },
]

const SPACING = 0.3
const GLASS_SCALE = 0.5

/* ---------------- the wall's layout ---------------- */

interface TapInfo {
  spec: TapSpec
  group: number
  name?: string
}
const TAPS: TapInfo[] = []
const SLOT: number[] = []
{
  let slot = 0
  DRAFTS.forEach((g, gi) => {
    if (gi > 0) slot++ // a gap between groups
    g.beers.forEach(b => {
      TAPS.push({ spec: { name: b, num: String(TAPS.length + 1).padStart(2, '0') }, group: gi, name: b })
      SLOT.push(slot++)
    })
  })
  // the 36th handle: the house roundel, no beer claimed
  while (TAPS.length < BAR.taps) {
    TAPS.push({ spec: { num: String(TAPS.length + 1).padStart(2, '0') }, group: DRAFTS.length - 1 })
    SLOT.push(slot++)
  }
}
const SLOTS = SLOT[SLOT.length - 1] + 1
const TAP_X = SLOT.map(s => (s - (SLOTS - 1) / 2) * SPACING)
const FIRST = DRAFTS.map((_, g) => TAPS.findIndex(t => t.group === g))
const POUR_I = POURS.map((p, g) => {
  const i = TAPS.findIndex(t => t.group === g && t.name === p.name)
  if (i >= 0) return i
  const n = DRAFTS[g].beers.length
  return FIRST[g] + Math.floor(n / 2)
})
const WALL_R = TAP_X[TAP_X.length - 1]
const CHALK_X = WALL_R + 1.25

/* ---------------- camera ---------------- */

/** a set-up: look at (x,y,z) from yaw/pitch, framing `span` wide and `hgt` tall in the subject region */
interface Shot {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  span: number
  hgt: number
  fov: number
  /** extra x shift of the subject on tall screens (they crop the sides) */
  tdx: number
}
const KEYS_N = ['x', 'y', 'z', 'yaw', 'pitch', 'span', 'hgt', 'fov', 'tdx'] as const
const S = (o: Partial<Shot>): Shot => ({ x: 0, y: 1.3, z: -0.5, yaw: 0.5, pitch: 0.1, span: 3, hgt: 1.4, fov: 30, tdx: 0, ...o })

const X = (i: number) => TAP_X[i]
const MACRO_I = POUR_I[2] + 2
const KEYS: [number, Shot][] = [
  [0.0, S({ x: X(MACRO_I) + 0.05, y: FAUCET_Y, z: FAUCET_Z, yaw: 1.05, pitch: 0.05, span: 0.42, hgt: 0.3, fov: 26 })],
  [0.035, S({ x: X(MACRO_I) - 0.35, y: FAUCET_Y + 0.05, z: FAUCET_Z, yaw: 0.9, pitch: 0.07, span: 0.8, hgt: 0.5, fov: 26 })],
  [0.078, S({ x: 1.2, y: 1.28, z: -0.6, yaw: 1.0, pitch: 0.09, span: 6.2, hgt: 1.9, fov: 30 })],
  [INTRO_B, S({ x: 0.6, y: 1.3, z: -0.6, yaw: 0.9, pitch: 0.1, span: 6.8, hgt: 2, fov: 30 })],
]
GROUPS.forEach(([a, b], g) => {
  const L = b - a
  const p = POUR_I[g]
  const f = FIRST[g]
  KEYS.push([a + 0.14 * L, S({ x: X(f) + 0.5, y: 1.4, yaw: 0.62, pitch: 0.14, span: 3.0, hgt: 1.5 })])
  KEYS.push([a + 0.3 * L, S({ x: X(p) - 0.05, y: 1.2, yaw: 0.42, pitch: 0.12, span: 2.0, hgt: 2.3 })])
  KEYS.push([a + 0.45 * L, S({ x: X(p), y: 1.08, yaw: 0.3, pitch: 0.1, span: 1.5, hgt: 2.25 })])
  KEYS.push([a + 0.8 * L, S({ x: X(p), y: 1.04, yaw: 0.2, pitch: 0.08, span: 1.4, hgt: 2.2 })])
  KEYS.push([b, S({ x: X(p) + 0.1, y: 1.1, yaw: 0.32, pitch: 0.1, span: 1.8, hgt: 2.4 })])
})
KEYS.push([END_A + 0.02, S({ x: WALL_R + 0.55, y: 1.4, z: -0.7, yaw: 0.55, pitch: 0.1, span: 3.3, hgt: 1.9, tdx: 0.45 })])
KEYS.push([1.0, S({ x: WALL_R + 0.65, y: 1.42, z: -0.7, yaw: 0.66, pitch: 0.11, span: 3.6, hgt: 2, tdx: 0.5 })])

const _shot = S({})
const _up = new THREE.Vector3()
function sampleShot(t: number): Shot {
  let i = 0
  while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++
  const [t0, a] = KEYS[i]
  const [t1, b] = KEYS[i + 1]
  const s = ease.inOutCubic(clamp((t - t0) / (t1 - t0)))
  for (const k of KEYS_N) _shot[k] = lerp(a[k], b[k], s)
  return _shot
}

/* ---------------- layout ---------------- */

interface Layout {
  w: number
  h: number
  tall: boolean
  short: boolean
  /** subject region: NDC centre and fraction of the screen */
  sx: number
  sy: number
  rw: number
  rh: number
  /** names per page per group (Infinity = all) */
  per: number[]
}

function safeBands(h: number, short: boolean) {
  if (short) return [52, 52]
  const band = clamp(h * 0.105, 80, 112)
  return [band, clamp(h * 0.105, 82, 110)]
}

function computeLayout(w: number, h: number): Layout {
  const tall = w / h < 0.85
  const short = w > h && h <= 500
  const [top, bottom] = safeBands(h, short)
  const avail = h - top - bottom
  let per = DRAFTS.map(() => Infinity)
  if (tall && w < 600) {
    // phones: one column under the handles, paged
    const rows = clamp(Math.floor((avail * 0.56 - 96) / 25), 5, 12)
    per = DRAFTS.map(g => {
      const pages = Math.ceil(g.beers.length / rows)
      return Math.ceil(g.beers.length / pages)
    })
  } else if (short) {
    const rows = clamp(Math.floor((avail - 84) / 21), 3, 10)
    per = DRAFTS.map(g => {
      const pages = Math.ceil(g.beers.length / (rows * 2))
      return Math.ceil(g.beers.length / pages)
    })
  }
  if (tall) {
    // the handles live above the panel
    const panelTop = w < 600 ? 0.1 : 0.02
    const topN = 1 - (2 * top) / h
    return { w, h, tall, short, sx: 0, sy: (topN + panelTop) / 2, rw: 1, rh: (topN - panelTop) / 2, per }
  }
  // wide: the copy column on the left, the wall on the right
  const colFrac = short ? 0.46 : clamp(0.5 - (w - 1024) / 4000, 0.4, 0.5)
  return { w, h, tall, short, sx: colFrac, sy: 0, rw: 1 - colFrac, rh: 1, per }
}

/* ---------------- the chapter ---------------- */

export default function taps(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.2 })
  let layout = computeLayout(1440, 900)

  const wall = makeTapWall({ taps: TAPS.map(t => t.spec), x: TAP_X })
  let chalk: Chalkboard | null = null
  const glasses: Glass[] = []
  let stream: ReturnType<typeof makePourStream>
  let streamG = 0
  let bulbs: THREE.InstancedMesh
  let backGlow: THREE.Mesh
  const cards: ReturnType<typeof makeBacklight>[] = []

  // DOM
  let scrim: HTMLElement
  let intro: HTMLElement, introTitle: HTMLElement
  const boards: { root: HTMLElement; title: HTMLElement; items: HTMLElement[]; pager: HTMLElement; page: number; per: number }[] = []
  let endBox: HTMLElement
  let callout: Callout

  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()

  /** 0..1 progress through group g at story time q (may run outside 0..1) */
  const uOf = (q: number, g: number) => (q - GROUPS[g][0]) / (GROUPS[g][1] - GROUPS[g][0])

  /** the handle pull through a group: out, hold, release with a damped spring */
  const pullAt = (u: number) => {
    if (u < 0.33 || u > 1.2) return 0
    const inn = ease.outBack(clamp((u - 0.33) / 0.07))
    let p = inn * (1 - ease.inOutQuad(clamp((u - 0.8) / 0.06)))
    // released: it swings back past rest and rings out
    if (u > 0.86) p -= 0.09 * Math.sin((u - 0.86) * 40) * Math.exp(-(u - 0.86) * 25)
    return p
  }

  return {
    id: 'taps',
    group,
    anchors: ANCHORS,

    async init(ctx: ChapterContext) {
      // ---- the room
      const wallB = makeBrickWall(26, 6)
      wallB.position.set(0.8, 2.6, -0.95)
      ;(wallB.material as THREE.MeshStandardMaterial).color.set('#8a7066')
      wall.setEnv(ctx.world.envMap)
      const counter = makeBarTop({ length: 22, depth: 2.6, thickness: 0.9 })
      counter.position.set(0.8, 0, 0.3)
      group.add(wallB, counter, wall.group)

      // an amber wash on the backsplash: the light behind the glasses (beer glows, never murky)
      const gc = document.createElement('canvas')
      gc.width = 8
      gc.height = 128
      const gx = gc.getContext('2d')!
      const gr = gx.createLinearGradient(0, 128, 0, 0)
      gr.addColorStop(0, 'rgba(255,190,110,1)')
      gr.addColorStop(0.35, 'rgba(255,150,70,0.45)')
      gr.addColorStop(1, 'rgba(255,120,40,0)')
      gx.fillStyle = gr
      gx.fillRect(0, 0, 8, 128)
      const glowTex = new THREE.CanvasTexture(gc)
      backGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(TAP_X[TAP_X.length - 1] - TAP_X[0] + 1.6, 1.2),
        new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color('#ff9a48').multiplyScalar(0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      backGlow.position.set((TAP_X[0] + WALL_R) / 2, 0.6, -0.935)
      group.add(backGlow)

      // Edison bulbs hanging in front of the wall (foreground depth + glints)
      const nB = 9
      const bulbGeo = new THREE.SphereGeometry(0.07, 16, 12)
      bulbGeo.scale(1, 1.35, 1)
      bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb45e').multiplyScalar(2.4) }), nB)
      const cordGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5)
      cordGeo.translate(0, 0.5, 0)
      const cords = new THREE.InstancedMesh(cordGeo, new THREE.MeshStandardMaterial({ color: '#0b0908', roughness: 0.7 }), nB)
      const mm = new THREE.Matrix4()
      for (let i = 0; i < nB; i++) {
        const bx = TAP_X[0] - 0.6 + (i / (nB - 1)) * (WALL_R - TAP_X[0] + 2.4) + Math.sin(i * 2.3) * 0.25
        const by = 2.75 + Math.sin(i * 1.7) * 0.18
        const bz = 0.25 + Math.cos(i * 1.3) * 0.2
        mm.makeTranslation(bx, by, bz)
        bulbs.setMatrixAt(i, mm)
        mm.makeScale(1, 3, 1).setPosition(bx, by + 0.08, bz)
        cords.setMatrixAt(i, mm)
      }
      group.add(bulbs, cords)

      // glasses (one per group, under its pouring faucet) + the stream
      for (let g = 0; g < POURS.length; g++) {
        const gl = makeGlass({ shape: POURS[g].shape, beer: POURS[g].beer, scale: GLASS_SCALE, fill: 0, head: 0.02, bubbles: ctx.mobile ? 60 : 140 })
        gl.group.position.set(X(POUR_I[g]), TRAY_Y, FAUCET_Z + 0.012)
        gl.group.visible = false
        glasses.push(gl)
        group.add(gl.group)
      }
      // a softbox card behind each pouring glass: the beer sees it and glows (the frame sees a faint wash)
      for (let g = 0; g < POURS.length; g++) {
        const card = makeBacklight({ width: 0.9, height: 1.0, frameK: 0.12, isFrameTarget: rt => ctx.post.isFrameTarget(rt) })
        card.mesh.position.set(X(POUR_I[g]), 0.42, -0.9)
        card.set(0)
        cards.push(card)
        group.add(card.mesh)
      }
      stream = makePourStream(POURS[0].beer, 0.012)
      group.add(stream.mesh)
      await nextFrame()

      // canvas type: fonts first, redraw once all fonts settle
      const fontsReady = Promise.all([
        document.fonts.load('400 40px "Alfa Slab One"'),
        document.fonts.load('500 20px "IBM Plex Mono"'),
        document.fonts.load('italic 400 40px "Instrument Serif"'),
      ]).catch(() => undefined)
      await Promise.race([fontsReady, new Promise(r => setTimeout(r, 1500))])
      wall.drawLabels()
      chalk = makeChalkboard({ w: 1.45, title: TAPS_UI.drafts, label: TAPS_UI.lastUpdate, date: BAR.lastUpdate, count: `${BAR.taps} ${TAPS_UI.tap.toLowerCase()}s` })
      chalk.group.position.set(CHALK_X, 1.5, -0.93)
      group.add(chalk.group)
      document.fonts.ready.then(() => {
        wall.drawLabels()
        chalk?.redraw()
      })
      await nextFrame()

      // ---- the stage
      const st = ctx.stage
      st.classList.add('taps-stage')
      scrim = el('div', 'taps-scrim', undefined, st)
      intro = el('div', 'taps-intro', undefined, st)
      el('p', 'hud-eyebrow', SECTIONS.taps.eyebrow, intro)
      introTitle = rise(el('h2', 'hud-title taps-title', undefined, intro), SECTIONS.taps.title.replace(/tap\.$/, '<em>tap.</em>'))
      const m = BAR.intro.match(/^(.+?[.!?])\s+(.*)$/)
      el('p', 'taps-lead', m ? m[1] : BAR.intro, intro)
      if (m) el('p', 'hud-body taps-body', m[2], intro)

      DRAFTS.forEach((g, gi) => {
        const root = el('div', 'taps-board', undefined, st)
        root.dataset.group = g.id
        const panel = el('div', 'hud-panel taps-panel', undefined, root)
        const head = el('div', 'taps-board-head', undefined, panel)
        const first = TAPS.findIndex(t => t.group === gi)
        const last = first + g.beers.length - 1
        el('p', 'hud-label taps-board-label', `${TAPS_UI.drafts} · ${TAPS_UI.tap}s ${TAPS[first].spec.num}–${TAPS[last].spec.num}`, head)
        const title = rise(el('h3', 'hud-h2 taps-board-title', undefined, head), g.title)
        el('span', 'taps-board-count hud-lit', String(g.beers.length), head)
        const ol = el('ol', 'taps-list', undefined, panel)
        if (g.beers.length > 10) ol.classList.add('is-long')
        const items = g.beers.map((b, k) => {
          const li = el('li', '', undefined, ol)
          el('span', 'taps-n', TAPS[first + k].spec.num, li)
          el('span', 'taps-name', b, li)
          return li
        })
        const pager = el('p', 'hud-label taps-pager', '', panel)
        boards.push({ root, title, items, pager, page: -1, per: -1 })
      })

      endBox = el('div', 'taps-end', undefined, st)
      el('p', 'hud-eyebrow', SECTIONS.taps.eyebrow, endBox)
      const chalkDom = el('div', 'taps-chalk', undefined, endBox)
      el('span', 'taps-chalk-label', TAPS_UI.lastUpdate, chalkDom)
      el('span', 'taps-chalk-date', BAR.lastUpdate, chalkDom)
      el('p', 'hud-label taps-end-note', LINKS.app.label, endBox)
      const btns = el('div', 'taps-btns', undefined, endBox)
      const a1 = el('a', 'hud-btn', TAPS_UI.appButton, btns)
      a1.href = LINKS.app.url
      a1.target = '_blank'
      a1.rel = 'noopener'
      const a2 = el('a', 'hud-btn hud-btn--ghost', LINKS.untappd.label, btns)
      a2.href = LINKS.untappd.url
      a2.target = '_blank'
      a2.rel = 'noopener'

      callout = new Callout(st, { side: 'right', offset: { x: 64, y: -46 } })
      callout.root.classList.add('taps-callout')
    },

    onEnter() {
      clock.reset()
    },

    busy: () => clock.busy,

    update(local, frame, ctx) {
      if (frame.width !== layout.w || frame.height !== layout.h) layout = computeLayout(frame.width, frame.height)
      const q = clock.update(local, frame.dt)
      const rm = frame.reducedMotion

      // ---- which group, and the pours
      let tint = 0.45
      for (let g = 0; g < GROUPS.length; g++) {
        const u = uOf(q, g)
        const gl = glasses[g]
        const near = u > -0.35 && u < 1.45
        gl.group.visible = near
        wall.setPull(POUR_I[g], near ? pullAt(u) : 0)
        const fill = smoothstep(0.39, 0.8, u) * 0.94
        gl.setFill(Math.max(0.001, fill))
        gl.setHead(0.02 + 0.1 * smoothstep(0.5, 0.82, u))
        if (u > -0.1 && u < 1.1) tint = POURS[g].tint
        cards[g].set(near ? 0.55 + 0.45 * smoothstep(0.3, 0.6, u) : 0)
        if (near) {
          gl.setBubbles(smoothstep(0.45, 0.9, u))
          gl.update(rm ? 0 : frame.time)
        }
      }
      // the active pour's stream (one at a time: groups never overlap)
      let sOn = 0
      for (let g = 0; g < GROUPS.length; g++) {
        const u = uOf(q, g)
        if (u < 0.35 || u > 0.84) continue
        const grow = smoothstep(0.37, 0.4, u)
        const cut = smoothstep(0.79, 0.83, u)
        wall.spout(POUR_I[g], tmp)
        const glassTop = TRAY_Y + glasses[g].height * GLASS_SCALE
        const surface = TRAY_Y + 0.06 + (glassTop - TRAY_Y - 0.08) * smoothstep(0.39, 0.8, u) * 0.94
        tmp2.set(tmp.x, surface, tmp.z)
        sOn = grow * (1 - cut)
        if (streamG !== g) {
          streamG = g
          stream.setBeer(POURS[g].beer)
        }
        stream.set(tmp, tmp2, 1, cut, grow)
        stream.update(rm ? 0 : frame.time)
      }
      if (sOn <= 0) stream.set(tmp, tmp, 0)
      const endV = smoothstep(END_A - 0.01, END_A + 0.02, q)
      if (q > END_A - 0.02) tint = 0.45
      ctx.post.params.beer = tint

      // ---- light: the spot follows the subject; rims behind the glass make beer glow
      const shot = sampleShot(q)
      const w = ctx.world.params
      w.brick = 0
      w.bulbs = 0.4
      w.cyc = 0.35
      w.haze = 0.18
      w.spot = 0.8
      w.spotPos.set(shot.x + 1.4, 4.6, 3.2)
      w.spotAt.set(shot.x - 0.1, 0.9, -0.6)
      w.spotAngle = 0.58
      w.spotPenumbra = 0.75
      w.rimA = 1.5
      w.rimAColor = '#ffb060'
      w.rimADir.set(-0.7, 0.35, -1)
      w.rimB = 0.9
      w.rimBColor = '#ffd6a0'
      w.rimBDir.set(0.85, 0.45, -0.9)
      w.fill = 0.22
      // the room's ambient stays low; steel, lacquer and glass carry their own reflections
      w.env = 0.38

      // ---- HUD
      const introV = smoothstep(INTRO_A, INTRO_A + 0.02, q) * (1 - smoothstep(INTRO_B - 0.02, INTRO_B + 0.005, q))
      reveal(intro, introV)
      setRise(introTitle, q > INTRO_A - 0.005 && q < INTRO_B)
      let boardMax = 0
      for (let g = 0; g < boards.length; g++) {
        const [a, b] = GROUPS[g]
        const v = smoothstep(a - 0.015, a + 0.005, q) * (1 - smoothstep(b - 0.005, b + 0.015, q))
        boardMax = Math.max(boardMax, v)
        const bd = boards[g]
        reveal(bd.root, v)
        setRise(bd.title, v > 0.5)
        // paging (phones / short landscape): every name at rest somewhere in the range
        const n = bd.items.length
        const per = Math.min(n, layout.per[g])
        const pages = Math.ceil(n / per)
        const u = uOf(q, g)
        const page = Math.min(pages - 1, Math.max(0, Math.floor(clamp((u - 0.04) / 0.92) * pages)))
        if (page !== bd.page || per !== bd.per) {
          bd.page = page
          bd.per = per
          bd.items.forEach((li, k) => li.classList.toggle('is-off', Math.floor(k / per) !== page))
          bd.root.classList.toggle('is-paged', pages > 1)
          bd.pager.textContent = pages > 1 ? `${page + 1} / ${pages}` : ''
        }
      }
      reveal(endBox, endV)
      reveal(scrim, Math.max(introV, boardMax, endV), 0)

      // callout on the pulled handle
      let cg = -1
      for (let g = 0; g < GROUPS.length; g++) {
        const u = uOf(q, g)
        if (u > 0.3 && u < 0.95) cg = g
      }
      if (cg >= 0) {
        const u = uOf(q, cg)
        const i = POUR_I[cg]
        callout.label.textContent = `${TAPS_UI.tap} ${TAPS[i].spec.num} · ${TAPS[i].name}`
        wall.handleTop(i, tmp2)
        wall.spout(i, tmp).y += 0.2
        tmp2.lerp(tmp, 0.35).applyMatrix4(group.matrixWorld)
        callout.side = layout.tall ? 'left' : 'right'
        // keep the label below the top chrome band
        const py = (1 - (tmp.copy(tmp2).project(ctx.camera).y * 0.5 + 0.5)) * frame.height
        const band = safeBands(frame.height, layout.short)[0] + 14
        callout.offset.y = Math.max(-46, band - py)
        callout.update(tmp2, ctx.camera, frame.width, frame.height, smoothstep(0.38, 0.44, u) * (1 - smoothstep(0.88, 0.94, u)))
      } else callout.update(tmp2, ctx.camera, frame.width, frame.height, 0)

      // glow behind the glasses is stronger while pouring
      ;(backGlow.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * sOn
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      const q = Number.isFinite(clock.value) ? clock.value : local
      const s = sampleShot(q)
      const L = layout.w === frame.width && layout.h === frame.height ? layout : computeLayout(frame.width, frame.height)
      const aspect = frame.width / frame.height
      const tv = Math.tan((s.fov * Math.PI) / 360)
      const span = L.tall ? s.span * 0.72 : s.span
      const dist = Math.max(span / (2 * tv * aspect * L.rw), s.hgt / (2 * tv * L.rh))
      const drift = frame.reducedMotion ? 0 : Math.sin(frame.time * 0.21) * 0.012
      const yaw = s.yaw + drift
      const cp = Math.cos(s.pitch)
      const sx = s.x + (L.tall ? s.tdx : 0)
      out.target.set(sx, s.y, s.z)
      out.position.set(sx + Math.sin(yaw) * cp * dist, s.y + Math.sin(s.pitch) * dist, s.z + Math.cos(yaw) * cp * dist)
      // shift so the subject sits at the centre of its screen region
      const fwd = tmp.copy(out.target).sub(out.position).normalize()
      const right = tmp2.crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize()
      const up = _up.crossVectors(right, fwd)
      const halfH = dist * tv
      const halfW = halfH * aspect
      const shift = right.multiplyScalar(-L.sx * halfW).add(up.multiplyScalar(-L.sy * halfH))
      out.position.add(shift)
      out.target.add(shift)
      out.fov = s.fov
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : 0.06
    },
  }
}
