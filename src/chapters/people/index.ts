import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame, CameraPose } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { ease, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { PEOPLE, SECTIONS, MASCOT, PEOPLE_UI } from '../../content'
import { makeGlass, BEERS, type Glass } from '../../kit/beer'
import { whenRevealed } from '../../kit/images'
import { StoryClock } from '../../kit/pace'
import { labelTexture, catNo, syncVinylLights, type PaperName } from '../../kit/vinyl'
import { GEL } from '../../world/World'
import { makeWall, makeDisplay, makeLedge, FRAME_X, RAIL_Y, SLEEVE_S, type Display } from './wall'
import { portraitCover, type PortraitCover } from './cover'
import './people.css'

/*
 * THE CREW — Resonance's "Liner Notes" became the wall of the bar.
 *
 * The three people are ALBUM COVERS: 12" sleeves standing in record-store
 * "now playing" displays on Glory's exposed brick (a black steel rail with a
 * lip), each black-and-white portrait the cover photo with the name and role
 * in the cream band, each record half out of its sleeve showing its label
 * (name, role, GLY-051…053), a brass picture light above; The Glorious
 * Archibald is a 7" single between Kevin and Pier; a pint of stout stands on
 * the ledge below. The camera glides from display to display (a StoryClock,
 * never faster than ~0.5 s a move); the record in focus eases a little
 * further out of its sleeve. Each bio is that record's LINER NOTES: a panel
 * beside the display (phones: the display on top, the notes below). Notes
 * that can't fit at once (small phones, short landscape) are set in pages —
 * whole sentences, packed by measurement — that take turns in the panel.
 *
 *   0.00–0.17  in-beat → the wall: a slow dolly onto all three frames;
 *              "About / The people behind the bar." (intro 0.07)
 *   0.17–0.245 glide to Dave         · 0.24–0.425 Dave's panel
 *   0.42–0.49  glide to Kevin Wieman · 0.485–0.695 Kevin's panel
 *   0.69–0.76  glide to Pier Mutovic · 0.755–0.90 Pier's panel
 *   0.895–1.00 out-beat: the camera cranes down to the stout on the ledge
 *              (post beer → 1, the pour into the Back Room is a stout)
 *
 * Portraits are never stretched: each cover is cover-cropped once at a
 * per-portrait focus that keeps the whole face clear of the header and the
 * band (cover.ts); the sleeves' ring wear is kept faint so nothing marks a
 * face.
 */

/** cover crop focus per portrait (0..1 of the spare height): hair to chin in the photo area */
const FOCUS: Record<string, [number, number]> = { dave: [0.5, 0.56], kevin: [0.5, 0.11], pier: [0.45, 0.09] }
const LABEL_PAPER: PaperName[] = ['cream', 'red', 'amber']
/** the record's centre, right of the sleeve's centre (sleeve units): resting .. in focus */
const OUT: [number, number] = [0.57, 0.66]

/** glide windows between poses (q = time-paced local) */
const GLIDES: [number, number][] = [
  [0.17, 0.245], // wide → Dave
  [0.42, 0.49], // Dave → Kevin
  [0.69, 0.76], // Kevin → Pier
  [0.895, 0.97], // Pier → the stout
]
/** when each panel shows: [on, off) */
const HEAD: [number, number] = [0.035, 0.17]
const CARDS: [number, number][] = [
  [0.24, 0.425],
  [0.485, 0.695],
  [0.755, 0.9],
]
/** hold ranges (for the slow push-in while a print is up) */
const HOLDS: [number, number][] = [
  [0.0, 0.17],
  [0.245, 0.42],
  [0.49, 0.69],
  [0.76, 0.895],
  [0.97, 1.0],
]

const PINT_X = FRAME_X[2] + 1.15

interface Card {
  root: HTMLElement
  parts: HTMLElement[]
  /** the bio, paragraph by paragraph, sentence by sentence (verbatim) */
  text: string[][]
  bio: HTMLElement
  pages: HTMLElement[]
  pageNo: HTMLElement
  on: boolean
  curPage: number
  /** layout (stage px), measured on resize */
  top: number
  left: number
}

interface Pose {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  /** picture-light levels for the three displays */
  lamps: [number, number, number]
}

const mkPose = (): Pose => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), lamps: [0, 0, 0] })

export default function create(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.12 })
  let q = 0

  const displays: Display[] = []
  const covers: PortraitCover[] = []
  let single: Display
  let pint: Glass

  // DOM
  let head: HTMLElement
  let headParts: HTMLElement[] = []
  let headOn = false
  const cards: Card[] = []
  let safeEl: HTMLElement
  let stageEl: HTMLElement
  const L = { W: 1, H: 1, safeTop: 80, safeBottom: 82, gutter: 24, headTop: 600, portrait: false }
  let dirty = true

  // pose scratch
  const poses = { wide: mkPose(), p: [mkPose(), mkPose(), mkPose()], pint: mkPose() }
  const A = mkPose()
  const B = mkPose()
  const cur = mkPose()

  /* ------------------------------------------------------------ layout */

  const portraitMQ = typeof matchMedia !== 'undefined' ? matchMedia('(max-aspect-ratio: 19/20)') : null

  function measure() {
    dirty = false
    const r = stageEl.getBoundingClientRect()
    L.W = Math.max(1, r.width)
    L.H = Math.max(1, r.height)
    L.portrait = portraitMQ ? portraitMQ.matches : L.W / L.H < 0.95
    L.safeTop = safeEl.offsetTop
    L.gutter = safeEl.offsetLeft
    L.safeBottom = L.H - (safeEl.offsetTop + safeEl.offsetHeight)
    L.headTop = head.offsetTop
    const avail = L.H - L.safeTop - L.safeBottom
    for (const c of cards) {
      paginate(c, L.portrait ? avail * 0.64 : avail)
      const side = c.root.parentElement as HTMLElement
      c.top = side.offsetTop + c.root.offsetTop
      c.left = side.offsetLeft + c.root.offsetLeft
    }
  }

  /** render pages: each page is a list of paragraphs, each a list of sentences */
  function renderPages(c: Card, pages: string[][][]) {
    c.bio.textContent = ''
    c.pages = pages.map(pg => {
      const d = el('div', 'pp-pg', undefined, c.bio)
      for (const para of pg) el('p', '', para.join(' '), d)
      return d
    })
    c.root.classList.toggle('is-paged', pages.length > 1)
    c.curPage = -1
    applyPage(c, 0)
  }

  /**
   * Fit the bio into `limit` px of panel height: all of it if it fits,
   * otherwise whole sentences packed greedily into pages (measured).
   */
  function paginate(c: Card, limit: number) {
    renderPages(c, [c.text])
    if (c.root.offsetHeight <= limit) return
    c.root.classList.add('is-paged')
    const pages: string[][][] = []
    let cur: string[][] = []
    const fits = (pg: string[][]) => {
      renderPages(c, [pg])
      c.root.classList.add('is-paged')
      return c.root.offsetHeight <= limit
    }
    for (const para of c.text) {
      let run: string[] = []
      for (const sen of para) {
        const tryPg = [...cur, [...run, sen]]
        if (fits(tryPg) || (cur.length === 0 && run.length === 0)) {
          run.push(sen)
        } else {
          if (run.length) cur.push(run)
          pages.push(cur)
          cur = []
          run = [sen]
        }
      }
      if (run.length) cur.push(run)
    }
    if (cur.length) pages.push(cur)
    renderPages(c, pages)
  }

  function applyPage(c: Card, i: number) {
    if (c.curPage === i) return
    c.curPage = i
    c.pages.forEach((p, k) => p.classList.toggle('is-page', k === i))
    c.pageNo.textContent = `${i + 1} / ${c.pages.length}`
  }

  /**
   * Fit a world box (on the wall plane) into a screen rect: camera straight
   * on, the box centred in the rect. `swing`/`lift` angle the view a touch
   * (fractions of the distance).
   */
  function fit(out: Pose, cx: number, cy: number, bw: number, bh: number, z: number, x0: number, y0: number, x1: number, y1: number, fill: number, fov: number, swing: number, lift: number) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const rw = Math.max(40, x1 - x0)
    const rh = Math.max(60, y1 - y0)
    const ppu = Math.min((rh * fill) / bh, (rw * fill) / bw)
    const d = L.H / (2 * tanV * ppu)
    const nx = (x0 + x1) / L.W - 1
    const ny = 1 - (y0 + y1) / L.H
    const halfH = d * tanV
    const halfW = (halfH * L.W) / L.H
    out.tgt.set(cx - nx * halfW, cy - ny * halfH, z)
    out.pos.set(out.tgt.x + swing * d, out.tgt.y + lift * d, z + d)
  }

  function buildPoses() {
    const { W, H, safeTop, safeBottom, gutter } = L
    const fov = L.portrait ? 34 : 30
    // the wall: all three displays (and the ledge) above the headline
    const d0 = displays[0]
    const d2 = displays[2]
    const wideTop = RAIL_Y + d0.top + 0.15
    const wideBot = -0.25
    const x0 = FRAME_X[0] + d0.left - 0.2
    const x1 = FRAME_X[2] + d2.right + 0.2
    const y1 = Math.max(safeTop + 120, L.headTop - 14)
    // (portrait: Kevin's display and the single whole, Dave and Pier cut by the edges)
    const kc = FRAME_X[1] + (displays[1].left + displays[1].right) / 2
    const wideW = L.portrait ? 5.4 : x1 - x0
    const wideX = L.portrait ? kc + 0.8 : (x0 + x1) / 2
    const wb = L.portrait ? RAIL_Y - 0.9 : wideBot
    fit(poses.wide, wideX, (wideTop + wb) / 2, wideW, wideTop - wb, 0, gutter, safeTop, W - gutter, y1, L.portrait ? 1.0 : 0.96, fov, -0.02, 0.03)
    poses.wide.lamps = [0.8, 0.8, 0.8]
    // each display: beside its liner notes (desktop) or above them (portrait)
    for (let i = 0; i < 3; i++) {
      const d = displays[i]
      const c = cards[i]
      const bw = d.right - d.left + 0.25
      const bh = d.top - d.bottom + 0.25
      const cx = FRAME_X[i] + (d.left + d.right) / 2
      const cy = RAIL_Y + (d.top + d.bottom) / 2
      if (L.portrait) {
        const bot = Math.max(safeTop + 110, c.top - 14)
        fit(poses.p[i], cx, cy, bw, bh, 0.1, gutter, safeTop + 2, W - gutter, bot, 0.96, fov, 0.035, 0.02)
      } else {
        const right = Math.max(gutter + 160, c.left - 28)
        fit(poses.p[i], cx, cy, bw, bh, 0.1, gutter, safeTop, right, H - safeBottom, 0.92, fov, 0.05, 0.03)
      }
      poses.p[i].lamps = [0.3, 0.3, 0.3]
      poses.p[i].lamps[i] = 1
    }
    // the stout on the ledge, low and close
    fit(poses.pint, PINT_X, 0.42, 1.5, 1.3, 0.2, gutter, safeTop, W - gutter, H - safeBottom, 0.62, fov, -0.12, 0.12)
    poses.pint.lamps = [0.3, 0.3, 0.55]
  }

  const copyPose = (o: Pose, s: Pose) => {
    o.pos.copy(s.pos)
    o.tgt.copy(s.tgt)
    o.lamps[0] = s.lamps[0]
    o.lamps[1] = s.lamps[1]
    o.lamps[2] = s.lamps[2]
  }
  const lerpPose = (o: Pose, a: Pose, b: Pose, t: number) => {
    o.pos.lerpVectors(a.pos, b.pos, t)
    o.tgt.lerpVectors(a.tgt, b.tgt, t)
    for (let i = 0; i < 3; i++) o.lamps[i] = lerp(a.lamps[i], b.lamps[i], t)
  }
  /** a hold: a slow push toward the subject (0 at the start of the hold .. 1 at its end) */
  const push = (o: Pose, k: number) => {
    const s = lerp(1.035, 0.985, k)
    o.pos.sub(o.tgt).multiplyScalar(s).add(o.tgt)
  }

  const seq = () => [poses.wide, poses.p[0], poses.p[1], poses.p[2], poses.pint]

  function poseAt(qq: number, out: Pose) {
    const list = seq()
    for (let i = 0; i < GLIDES.length; i++) {
      const [g0, g1] = GLIDES[i]
      if (qq < g0) {
        // holding pose i
        const [h0, h1] = HOLDS[i]
        copyPose(out, list[i])
        push(out, segment(qq, h0, h1))
        return
      }
      if (qq < g1) {
        const t = ease.inOutCubic(segment(qq, g0, g1))
        copyPose(A, list[i])
        push(A, 1)
        copyPose(B, list[i + 1])
        push(B, 0)
        lerpPose(out, A, B, t)
        // a glide arcs gently off the wall (a dolly, not a pan)
        const arc = Math.sin(t * Math.PI)
        out.pos.z += arc * 0.9
        return
      }
    }
    copyPose(out, poses.pint)
    push(out, segment(qq, HOLDS[4][0], HOLDS[4][1]))
  }

  /* --------------------------------------------------------------- DOM */

  function buildDom(stage: HTMLElement) {
    stageEl = stage
    stage.classList.add('pp-stage')
    safeEl = el('div', 'pp-safe', undefined, stage)
    head = el('div', 'pp-head', undefined, stage)
    const eb = el('p', 'hud-eyebrow', undefined, head)
    const ebT = rise(el('span', '', undefined, eb), SECTIONS.people.eyebrow)
    const title = SECTIONS.people.title
    const html = title.replace(/(\S+)$/, '<em>$1</em>')
    const h = rise(el('h2', 'hud-h2 pp-title', undefined, head), html)
    headParts = [ebT, h]

    const side = el('div', 'pp-side', undefined, stage)
    PEOPLE.forEach((p, i) => {
      const root = el('article', 'pp-card hud-panel', undefined, side)
      const meta = el('p', 'pp-meta', undefined, root)
      el('span', 'pp-notes', PEOPLE_UI.notes, meta)
      el('span', 'pp-no', catNo(51 + i), meta)
      const role = rise(el('p', 'pp-role', undefined, root), p.role)
      const name = rise(el('h3', 'pp-name', undefined, root), p.name)
      el('div', 'pp-rule', undefined, root)
      const bio = el('div', 'pp-bio', undefined, root)
      const pageNo = el('p', 'pp-page', undefined, root)
      // sentences (no lookbehind: Safari 15) — the words stay verbatim
      const text = p.bio.map(b => (b.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [b]).map(x => x.trim()))
      const card: Card = { root, parts: [role, name], text, bio, pages: [], pageNo, on: false, curPage: 0, top: 0, left: 0 }
      renderPages(card, [text])
      cards.push(card)
    })

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => (dirty = true))
      ro.observe(stage)
      ro.observe(head)
      for (const c of cards) ro.observe(c.root)
    }
    addEventListener('resize', () => (dirty = true))
    document.fonts?.ready.then(() => (dirty = true))
  }

  function setCard(c: Card, on: boolean) {
    if (c.on === on) return
    c.on = on
    c.root.classList.toggle('is-on', on)
    for (const p of c.parts) setRise(p, on)
  }

  function updateDom(qq: number) {
    const hOn = qq >= HEAD[0] && qq < HEAD[1]
    if (hOn !== headOn) {
      headOn = hOn
      head.classList.toggle('is-on', hOn)
    }
    for (const p of headParts) setRise(p, hOn)
    cards.forEach((c, i) => {
      const [a, b] = CARDS[i]
      setCard(c, qq >= a && qq < b)
      const n = c.pages.length
      if (n > 1) applyPage(c, Math.min(n - 1, Math.max(0, Math.floor(((qq - a) / (b - a)) * n))))
    })
  }

  /* ------------------------------------------------------------ chapter */

  return {
    id: 'people',
    group,
    // 0 Dave · 1 Kevin Wieman (on his first page) · 2 Pier Mutovic
    anchors: [0.33, 0.535, 0.83],
    busy: () => clock.busy,

    async init(ctx: ChapterContext) {
      buildDom(ctx.stage)

      const wall = makeWall(64, 40)
      wall.position.set(FRAME_X[1], 6, 0)
      group.add(wall)
      await nextFrame()

      // the three albums: portrait covers, labels, rails, picture lights
      PEOPLE.forEach((p, i) => {
        const cover = portraitCover({ title: p.name, kicker: p.role, cat: catNo(51 + i), paper: 'cream', focus: FOCUS[p.id] ?? [0.5, 0.2] }, p.photo)
        covers.push(cover)
        const label = labelTexture({ title: p.name, sub: p.role, side: 'SIDE A', cat: catNo(51 + i), paper: LABEL_PAPER[i] })
        const d = makeDisplay({ front: cover.texture, label, scale: SLEEVE_S, out: OUT[1], seed: i })
        d.group.position.set(FRAME_X[i], RAIL_Y, 0)
        group.add(d.group)
        displays.push(d)
      })
      await nextFrame()
      // the house mascot as a 7" single (decorative)
      const mCover = portraitCover({ title: MASCOT.name, cat: catNo(54), paper: 'stout' }, MASCOT.photo, 512)
      covers.push(mCover)
      single = makeDisplay({
        front: mCover.texture,
        label: labelTexture({ title: MASCOT.name, seven: true, side: 'SIDE A', cat: catNo(54), paper: 'red' }, 384),
        size: 7,
        scale: SLEEVE_S,
        lamp: false,
        seed: 3,
      })
      single.group.position.set((FRAME_X[1] + FRAME_X[2]) / 2 - 0.2, RAIL_Y + 0.95, 0)
      group.add(single.group)

      const ledge = makeLedge(FRAME_X[2] - FRAME_X[0] + 5)
      ledge.position.set(FRAME_X[1], 0, 0)
      group.add(ledge)

      pint = makeGlass({ shape: 'pint', beer: BEERS.stout, scale: 0.72, fill: 0.95, head: 0.09 })
      pint.group.position.set(PINT_X, 0, 0.21)
      group.add(pint.group)
      await nextFrame()

      // cover photos: Dave now, the rest once the site has revealed (never block init)
      covers[0].load()
      void whenRevealed().then(() => covers.slice(1).forEach(c => c.load()))
    },

    onEnter() {
      clock.reset()
      dirty = true
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      q = clock.update(local, frame.dt)
      if (dirty) measure()
      buildPoses()
      poseAt(q, cur)
      updateDom(q)

      // picture lights: the album in focus is lit, the others glow low; its
      // record eases a little further out of the sleeve (all from q)
      displays.forEach((d, i) => {
        const lv = cur.lamps[i]
        if (d.lamp) {
          d.lamp.spot.intensity = 4.2 * lv
          d.lamp.glow.emissiveIntensity = 0.35 + 1.5 * lv
        }
        const f = smoothstep(0.45, 1, lv)
        d.record.group.position.x = lerp(OUT[0], OUT[1], f)
      })

      const w = ctx.world.params
      w.top = '#0e0806'
      w.bottom = '#040201'
      w.cyc = 0
      w.brick = 0
      w.bulbs = 0
      w.haze = 0
      w.bokeh = 0
      w.beams = 0
      // the key: a dim tungsten spot from high front-left, following the camera
      w.spot = 0.24
      w.spotColor = GEL.tungsten
      w.spotPos.set(cur.tgt.x - 3.5, 8.5, 8)
      w.spotAt.set(cur.tgt.x, 1.4, 0)
      w.spotAngle = 0.55
      w.spotPenumbra = 0.85
      w.rimA = 0.55
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.7, 0.45, -1)
      w.rimB = 0.3
      w.rimBColor = GEL.tungsten
      w.rimBDir.set(0.85, 0.2, -1)
      w.fill = 0.1
      w.env = 0.7
      w.envTurn = 0.3
      syncVinylLights(ctx.world)

      const p = ctx.post.params
      // the pour: stout (the pint on the ledge) into the Back Room
      p.beer = lerp(0.82, 1, smoothstep(0.55, 0.95, local))
      p.vignette = 0.4
      p.grain = 0.05
      p.bloomThreshold = 0.95
      p.bloomStrength = 0.3
      p.warmth = 0.5

      // idle: the foam is still; the glass just sits there
      pint.group.rotation.y = 0.4
    },

    camera(_local: number, frame: Frame, out: CameraPose) {
      out.position.copy(cur.pos)
      out.target.copy(cur.tgt)
      if (!frame.reducedMotion) {
        const t = frame.time
        out.position.x += Math.sin(t * 0.21) * 0.04
        out.position.y += Math.sin(t * 0.17 + 1.3) * 0.025
      }
      out.fov = L.portrait ? 34 : 30
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : 0.12
    },
  }
}
