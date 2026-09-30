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
import { makeCrewWall, MPW, OUT, ROOM, type CrewWall, type Display } from './wall'
import { portraitCover, type PortraitCover } from './cover'
import './people.css'

/*
 * THE CREW — Resonance's "Liner Notes", hung on Glory's real back wall.
 *
 * Mike's ref4 is this chapter: a walnut plank column with ONE LP face-out on
 * a small black steel ledge under a wire-cage bulb, records packed on the
 * shelves beside it. Here there are three such columns (wall.ts, built from
 * the room kit): each person's 12" sleeve stands face-out on its column's
 * ledge — the black-and-white portrait is the cover, the name and role in
 * the cream band — its record half out to the right showing the label
 * (name, role, GLY-051…053), a wire-cage Edison sconce above. Between the
 * columns, shelves packed with LPs over spouted liquor steps; The Glorious
 * Archibald is a 7" face-out in front of the singles between Kevin and Pier;
 * the stout stands on a walnut shelf on the brick accent panel past Pier.
 * The camera glides from column to column (a StoryClock, never faster than
 * ~0.5 s a move); the record in focus eases a little further out of its
 * sleeve and its sconce's light comes up. Each bio is that record's LINER
 * NOTES: a panel beside the display (phones: the display on top, the notes
 * below). Notes that can't fit at once (small phones, short landscape) are
 * set in pages — whole sentences, packed by measurement — that take turns.
 *
 *   0.00–0.17  in-beat → the wall: a slow dolly onto the three columns;
 *              "About / The people behind the bar." (intro 0.07)
 *   0.17–0.245 glide to Dave         · 0.24–0.425 Dave's panel
 *   0.42–0.49  glide to Kevin Wieman · 0.485–0.695 Kevin's panel
 *   0.69–0.76  glide to Pier Mutovic · 0.755–0.90 Pier's panel
 *   0.895–1.00 out-beat: the camera cranes down to the stout on its shelf
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
/**
 * The room's exposure (after dark, lit by its bulbs as at the bar): the
 * bulbs + halos, the kit's warm bounce (low, so the light falls off down the
 * walnut), and the sconce pools (each bulb hangs ~0.6 m over its sleeve).
 */
const GLOW = 0.95
const AMB = 0.2
const LAMP = 0.55

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
  /** sconce levels for the three columns */
  lamps: [number, number, number]
}

const mkPose = (): Pose => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), lamps: [0, 0, 0] })

/**
 * The portrait covers' canvas size. A sleeve never spans more than about half
 * the screen's long side (the close shots put its liner notes beside or below
 * it), and touch devices render at DPR ≤ 1.5, so a phone gets 640² (a third
 * of 1024²'s memory) and only a large tablet the full 1024². Desktop: 1024².
 */
function coverRes(mobile: boolean) {
  if (!mobile) return 1024
  const long = Math.max(innerWidth, innerHeight, screen?.width ?? 0, screen?.height ?? 0)
  return Math.min(1024, Math.max(512, Math.ceil((long * 0.5 * 1.5) / 128) * 128))
}

export default function create(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.12 })
  let q = 0

  let wall: CrewWall
  let displays: Display[] = []
  const covers: PortraitCover[] = []
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

  const _cam = new THREE.PerspectiveCamera()
  const _min = new THREE.Vector3()
  const _max = new THREE.Vector3()
  const _dir = new THREE.Vector3()
  const _tgt = new THREE.Vector3()
  const _v = new THREE.Vector3()
  const _right = new THREE.Vector3()
  const _up = new THREE.Vector3()
  const _b = { x0: 0, x1: 0, y0: 0, y1: 0, ok: true }

  function place(tgt: THREE.Vector3, d: number) {
    _cam.position.copy(tgt).addScaledVector(_dir, d)
    _cam.lookAt(tgt)
    _cam.updateMatrixWorld()
  }
  /** NDC bounds of the box's corners through _cam */
  function bounds(min: THREE.Vector3, max: THREE.Vector3) {
    _b.x0 = _b.y0 = Infinity
    _b.x1 = _b.y1 = -Infinity
    _b.ok = true
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(_cam)
      if (_v.z > 1 || _v.z < -1) _b.ok = false
      _b.x0 = Math.min(_b.x0, _v.x)
      _b.x1 = Math.max(_b.x1, _v.x)
      _b.y0 = Math.min(_b.y0, _v.y)
      _b.y1 = Math.max(_b.y1, _v.y)
    }
    return _b
  }

  /**
   * Fit a world box into a screen rect (px) from a given view direction
   * (yaw: + = camera to the right of the box, pitch: + = above it), by
   * projection: bisect the distance, then slide the view so the box's
   * projected centre sits at the rect's centre.
   */
  function fitView(out: Pose, min: THREE.Vector3, max: THREE.Vector3, x0: number, y0: number, x1: number, y1: number, fill: number, fov: number, yaw: number, pitch: number) {
    _cam.fov = fov
    _cam.aspect = L.W / L.H
    _cam.near = 0.05
    _cam.far = 500
    _cam.updateProjectionMatrix()
    _dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const rx0 = (2 * x0) / L.W - 1
    const rx1 = (2 * x1) / L.W - 1
    const ry0 = 1 - (2 * y1) / L.H
    const ry1 = 1 - (2 * y0) / L.H
    const rw = (rx1 - rx0) * fill
    const rh = (ry1 - ry0) * fill
    _tgt.copy(min).add(max).multiplyScalar(0.5)
    let d = 20
    for (let pass = 0; pass < 3; pass++) {
      let lo = 0.5
      let hi = 300
      for (let k = 0; k < 26; k++) {
        const mid = (lo + hi) / 2
        place(_tgt, mid)
        const b = bounds(min, max)
        if (b.ok && b.x1 - b.x0 <= rw && b.y1 - b.y0 <= rh) hi = mid
        else lo = mid
      }
      d = hi
      place(_tgt, d)
      const b = bounds(min, max)
      const dx = (rx0 + rx1) / 2 - (b.x0 + b.x1) / 2
      const dy = (ry0 + ry1) / 2 - (b.y0 + b.y1) / 2
      const halfH = d * Math.tan(THREE.MathUtils.degToRad(fov / 2))
      const halfW = halfH * _cam.aspect
      _right.setFromMatrixColumn(_cam.matrixWorld, 0)
      _up.setFromMatrixColumn(_cam.matrixWorld, 1)
      _tgt.addScaledVector(_right, -dx * halfW).addScaledVector(_up, -dy * halfH)
    }
    out.tgt.copy(_tgt)
    out.pos.copy(_tgt).addScaledVector(_dir, d)
  }

  /** true when nothing of Pier's display (sleeve, record, ledge) is in this view */
  function clearAbove(p: Pose, fov: number) {
    _cam.fov = fov
    _cam.aspect = L.W / L.H
    _cam.updateProjectionMatrix()
    _cam.position.copy(p.pos)
    _cam.lookAt(p.tgt)
    _cam.updateMatrixWorld()
    const b = displays[2].box
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j <= 4; j++)
        for (const z of [b.min.z, b.max.z]) {
          _v.set(lerp(b.min.x, b.max.x, i / 8), lerp(b.min.y - 0.1, b.max.y, j / 4), z).project(_cam)
          if (_v.z < 1 && _v.x > -1.02 && _v.x < 1.02 && _v.y > -1.02 && _v.y < 1.02) return false
        }
    return true
  }

  function buildPoses() {
    const { W, H, safeTop, safeBottom, gutter } = L
    const fov = L.portrait ? 34 : 30
    const m = MPW
    const [d0] = displays
    const colFront = ROOM.colD * m
    // THE WALL, above the headline. Desktop / landscape: straight on (a hair
    // from below: the pendants hang in along the top from the dark overhead),
    // the three columns with their sleeves and sconces, the packed bays between.
    // Portrait: a three-quarter view down the wall from the left, Dave's
    // display near and large, the bays and Kevin's column running on beyond.
    const y1 = Math.max(safeTop + 120, L.headTop - 18)
    if (L.portrait) {
      _min.set(d0.box.min.x - 0.04 * m, d0.box.min.y - 0.05 * m, d0.box.min.z)
      _max.set(d0.box.max.x + 0.14 * m, d0.box.max.y + 0.06 * m, d0.box.max.z)
      fitView(poses.wide, _min, _max, gutter, safeTop + 8, W - gutter, y1, 0.99, fov, -0.66, 0.03)
    } else {
      const half = (ROOM.colW / 2) * m
      _min.set(ROOM.cols[0] * m - half - 0.1 * m, d0.box.min.y - 0.34 * m, 0)
      _max.set(ROOM.cols[2] * m + half + 0.1 * m, d0.bulb.y + 0.14 * m, colFront)
      fitView(poses.wide, _min, _max, gutter, safeTop, W - gutter, y1, 0.99, fov, 0.05, -0.035)
    }
    poses.wide.lamps = [1, 1, 1]
    // each display: beside its liner notes (desktop) or above them (portrait);
    // the sconce's bulb is in the frame on the wider screens
    for (let i = 0; i < 3; i++) {
      const d = displays[i]
      const c = cards[i]
      const pad = 0.035 * m
      const x0 = d.box.min.x - pad
      const x1 = d.box.max.x + pad
      const yb = d.box.min.y - pad
      const cz = (d.box.min.z + d.box.max.z) / 2
      if (L.portrait) {
        const yt = d.box.max.y + pad
        const bot = Math.max(safeTop + 110, c.top - 14)
        fit(poses.p[i], (x0 + x1) / 2, (yb + yt) / 2, x1 - x0, yt - yb, cz, gutter, safeTop + 2, W - gutter, bot, 0.96, fov, 0.035, 0.02)
      } else {
        // (up to the sconce's socket: the cage and its glow fill the top of the frame)
        const yt = Math.max(d.box.max.y + pad, d.bulb.y - 0.06 * m)
        const right = Math.max(gutter + 160, c.left - 28)
        fit(poses.p[i], (x0 + x1) / 2, (yb + yt) / 2, x1 - x0, yt - yb, cz, gutter, safeTop, right, H - safeBottom, 0.94, fov, 0.05, 0.02)
      }
      poses.p[i].lamps = [0.3, 0.3, 0.3]
      poses.p[i].lamps[i] = 1
    }
    // the stout on its shelf, close and a touch from above, near enough that
    // Pier's display (up and to the left) stays wholly out of frame
    const pp = wall.pint
    _min.set(pp.x - 0.42, pp.y - 0.06, pp.z - 0.26)
    _max.set(pp.x + 0.42, pp.y + 0.86, pp.z + 0.26)
    let fillP = L.portrait ? 0.66 : 0.56
    for (let k = 0; k < 8; k++) {
      fitView(poses.pint, _min, _max, gutter, safeTop, W - gutter, H - safeBottom, fillP, fov, -0.12, 0.1)
      if (clearAbove(poses.pint, fov)) break
      fillP = Math.min(0.98, fillP + 0.05)
    }
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

      // the portraits' covers + labels, the Archibald 7"
      const res = coverRes(ctx.mobile)
      const specs = PEOPLE.map((p, i) => {
        // (the ledge's steel lip covers the foot of the sleeve: the band's name is set above it)
        const cover = portraitCover({ title: p.name, kicker: p.role, cat: catNo(51 + i), paper: 'cream', focus: FOCUS[p.id] ?? [0.5, 0.2] }, p.photo, res, 0.052)
        covers.push(cover)
        const label = labelTexture({ title: p.name, sub: p.role, side: 'SIDE A', cat: catNo(51 + i), paper: LABEL_PAPER[i] })
        return { front: cover.texture, label, seed: i }
      })
      const mCover = portraitCover({ title: MASCOT.name, cat: catNo(54), paper: 'stout' }, MASCOT.photo, 512)
      covers.push(mCover)
      const mLabel = labelTexture({ title: MASCOT.name, seven: true, side: 'SIDE A', cat: catNo(54), paper: 'red' }, 384)
      await nextFrame()

      // Glory's back wall: three walnut columns with the sleeves face-out on steel ledges
      wall = await makeCrewWall(specs, { front: mCover.texture, label: mLabel, seed: 3 }, ctx.mobile)
      displays = wall.displays
      group.add(wall.kit.group)
      await nextFrame()

      pint = makeGlass({ shape: 'pint', beer: BEERS.stout, scale: 0.72, fill: 0.95, head: 0.09 })
      pint.group.position.copy(wall.pint)
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
      if (dirty) {
        measure()
        buildPoses()
      }
      poseAt(q, cur)
      updateDom(q)

      // sconces: the column in focus is up, the others a little lower; its
      // record eases a little further out of the sleeve (all from q)
      displays.forEach((d, i) => {
        const lv = cur.lamps[i]
        wall.setLamp(i, LAMP * (0.62 + 0.38 * lv))
        const f = smoothstep(0.45, 1, lv)
        d.record.group.position.x = lerp(OUT[0], OUT[1], f)
      })

      const w = ctx.world.params
      // the room is all built (wall.ts): the backdrop stays black behind it
      w.top = '#070505'
      w.bottom = '#040201'
      w.cyc = 0
      w.brick = 0
      w.room = 0
      w.bulbs = 0
      w.haze = 0
      w.bokeh = 0
      w.beams = 0
      // the key: a dim tungsten spot from high front-left, following the camera
      w.spot = 0.3
      w.spotColor = GEL.tungsten
      w.spotPos.set(cur.tgt.x - 3.5, cur.tgt.y + 7.5, cur.tgt.z + 8)
      w.spotAt.set(cur.tgt.x, cur.tgt.y - 0.3, cur.tgt.z - 1)
      w.spotAngle = 0.55
      w.spotPenumbra = 0.85
      w.rimA = 0.55
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.7, 0.45, -1)
      w.rimB = 0.3
      w.rimBColor = GEL.tungsten
      w.rimBDir.set(0.85, 0.2, -1)
      // (low fill + env: the bulbs make the falloff down the walnut, as at the bar)
      w.fill = 0.06
      w.env = 0.5
      w.envTurn = 0.3
      syncVinylLights(ctx.world)
      wall.kit.setGlow(GLOW)
      wall.kit.setAmbient(AMB)

      const p = ctx.post.params
      // the pour: stout (the pint on its shelf) into the Back Room
      p.beer = lerp(0.82, 1, smoothstep(0.55, 0.95, local))
      p.vignette = 0.4
      p.grain = 0.05
      p.bloomThreshold = 0.95
      p.bloomStrength = 0.3
      p.warmth = 0.5

      // idle: the foam is still; the glass just sits there. As the camera
      // cranes down to it, the stout's ruby edge comes up (backlit, not murky)
      pint.group.rotation.y = 0.4
      pint.setGlow(lerp(0.3, 0.62, smoothstep(0.86, 0.97, q)))
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
