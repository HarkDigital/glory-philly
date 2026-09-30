import * as THREE from 'three'
import './kitchen.css'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { KITCHEN_HOURS, KITCHEN_UI, LINKS, MENU, SECTIONS, type Dish, type MenuSection } from '../../content'
import { clamp, lerp, smoothstep } from '../../core/math'
import { el, rise, setRise } from '../../core/dom'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { makeBarTop } from '../../kit/bar'
import { BEERS, makeGlass, type Glass } from '../../kit/beer'
import {
  CrateRig,
  RIG_PHASE,
  catNo,
  coverAtlas,
  coverTexture,
  dirOf,
  frameTo,
  labelTexture,
  makeCrate,
  makeSleeve,
  syncVinylLights,
  tracklistTexture,
  type Crate,
  type PaperName,
  type Region,
  type Sleeve,
  type Track,
} from '../../kit/vinyl'
import { GEL } from '../../world/World'
import { makeFork, makePass, makePlate } from './props'

/*
 * KITCHEN — "The Pass" (the menu is the record crate).
 *
 * Resonance's crate, set on Glory's pass: the long oiled bar top under a
 * stainless shelf with glowing heat-lamp tubes and a ticket rail. Every
 * section of the All Day Menu is a browser bin of 12" sleeves on the bar,
 * one station per section; the camera dollies along the pass from bin to bin.
 * In each bin:
 *  - the SECTION SLEEVE (a typographic cover) lifts out, turns over to show
 *    its BACK — the section's tracklist, prices as values — while its record
 *    slides out and spins, then turns back, drops and flips onto the stack
 *  - each PHOTOGRAPHED DISH is a sleeve with the real photo as its cover: it
 *    lifts, turns to camera, its record (label = the dish) slides out and
 *    spins at 33⅓, slides home, and the sleeve flips onto the stack
 *  - behind them stand the section's other dishes as typographic sleeves; in
 *    Sweets (no photos) they riffle face-out one by one (Tiramisu, Chocolate
 *    Cheesecake) beside a dessert plate and a fork
 * The readable menu is the DOM panel (paged to fit on phones); the caption
 * always names the sleeve in hand (or face-out in the riffle).
 *
 *   0.00–0.06  the pour lands; a wide look down the pass of bins
 *   0.058–0.12 "All Day Menu" holds; the camera settles on the Starters bin
 *   0.12–0.90  five sections, weighted by their sleeves (≈ 0.48 vh a sleeve)
 *   0.90–1.00  the camera pulls back along the whole pass (every bin played
 *              through, sleeves on their stacks); "Order for Pickup with
 *              ToastTab" + kitchen hours; then the pour (straw)
 *
 * Camera, section, page, the rigs' item and riffle all run from a StoryClock.
 */

const STEP = 4.4
const NSEC = MENU.length
const S0 = 0.12
const S1 = 0.9
const INTRO_ON = 0.058
const END_ON = S1 + 0.008
/** the dolly between bins: [boundary - PRE, boundary + POST] */
const PRE = 0.02
const POST = 0.022
const CRATE_YAW = -0.14
/** where a held sleeve is presented (crate-local): low over the bin, in front of it */
const PRESENT = new THREE.Vector3(0, 1.5, 0.98)
const PAPERS: PaperName[] = ['red', 'stout', 'amber', 'cream', 'bone']
const LABEL_PAPERS: PaperName[] = ['cream', 'red', 'stout', 'amber']

interface SecPlan {
  sec: MenuSection
  /** photographed dishes (featured sleeves after the section sleeve) */
  dishes: Dish[]
  /** the other dishes, standing behind as typographic sleeves */
  rest: Dish[]
  /** featured sleeves: the section sleeve + the dishes */
  items: number
  /** riffle length (Sweets only: its sleeves go face-out one by one) */
  riffle: number
  weight: number
}
const PLAN: SecPlan[] = MENU.map(sec => {
  const dishes = sec.items.filter(d => d.photo)
  // "Add to Salad" is an add-on, not a dish: it reads on the tracklist only
  const rest = sec.items.filter(d => !d.photo && !/^Add to/i.test(d.name))
  const riffle = dishes.length ? 0 : rest.length
  const items = 1 + dishes.length
  return { sec, dishes, rest, items, riffle, weight: items + riffle * 0.8 }
})
const A: number[] = (() => {
  const sum = PLAN.reduce((a, p) => a + p.weight, 0)
  const out = [S0]
  for (const p of PLAN) out.push(out[out.length - 1] + ((S1 - S0) * p.weight) / sum)
  return out
})()

const pad2 = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const emLast = (t: string) => {
  const p = t.split(' ')
  const last = p.pop()!
  return `${esc(p.join(' '))} <em>${esc(last)}</em>`
}
const smoother = (t: number) => {
  t = clamp(t)
  return t * t * t * (t * (t * 6 - 15) + 10)
}
const withMarks = (d: Dish) => (d.marks?.length ? `${d.name} (${d.marks.join(', ')})` : d.name)

/** the section at clock value q: -1 intro, 0..4, NSEC = the end beat */
function sectionAt(q: number) {
  if (q < S0) return -1
  for (let i = 0; i < NSEC; i++) if (q < A[i + 1]) return i
  return NSEC
}
const phaseIn = (i: number, q: number) => clamp((q - A[i]) / (A[i + 1] - A[i]))
/** the rig's item / riffle for section i at clock value q */
function rigAt(i: number, q: number): { item: number; riffle: number } {
  const p = PLAN[i]
  if (q < A[i]) return { item: -1, riffle: 0 }
  if (q >= A[i + 1]) return { item: p.items, riffle: p.riffle ? p.riffle - 0.05 : 0 }
  const u = phaseIn(i, q) * p.weight
  if (u < p.items) return { item: u, riffle: 0 }
  return { item: p.items, riffle: ((u - p.items) / (p.weight - p.items)) * (p.riffle - 0.05) }
}

interface Pose {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
}
const pose = (): Pose => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 30 })
function blend(a: Pose, b: Pose, t: number, out: Pose) {
  out.pos.lerpVectors(a.pos, b.pos, t)
  out.tgt.lerpVectors(a.tgt, b.tgt, t)
  out.fov = lerp(a.fov, b.fov, t)
  return out
}
const frame = (out: Pose, c: THREE.Vector3, d: THREE.Vector3, w: number, h: number, reg: Region, W: number, H: number, fov: number) => {
  const o = { position: out.pos, target: out.tgt, fov }
  frameTo(o, c, d, w, h, reg, W, H, fov)
  out.fov = fov
  return out
}

interface Bin {
  crate: Crate
  rig: CrateRig
  /** the section sleeve: its back is read turned over (plain), then lies on the stack (pre-rotated) */
  secSleeve: Sleeve
  backRead: THREE.Texture
  backStack: THREE.Texture
  turn: number
  item: number
  riffle: number
}
interface SecDom {
  root: HTMLElement
  items: HTMLElement[]
  pageEl: HTMLElement
  pages: number[][]
  page: number
}

const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
const _m = new THREE.Matrix4()

export default function kitchen(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.06 })
  let q = 0
  let W = 0
  let H = 0
  let tall = false
  let region: Region = { x0: 0, x1: 1, y0: 0, y1: 1 }
  const camPose = pose()
  const pa = pose()
  const pb = pose()
  const pc = pose()
  /** which bin the camera is at (fractional during a dolly) */
  let camStation = 0
  /** real time until which the rigs' physics may still be settling (Motion-off heartbeat) */
  let settleUntil = 0

  const bins: Bin[] = []
  const glasses: { g: Glass; station: number }[] = []
  let still: THREE.Group
  let pass: ReturnType<typeof makePass>

  // DOM
  let probe: HTMLElement
  let dock: HTMLElement
  let intro: HTMLElement
  let introH: HTMLElement
  let panel: HTMLElement
  let cap: HTMLElement
  let capLabel: HTMLElement
  let capName: HTMLElement
  let capPrice: HTMLElement
  let end: HTMLElement
  const secs: SecDom[] = []
  let curSec = -2
  let curCap = ''
  let needFit = true

  const stationX = (i: number) => i * STEP

  // ---- camera poses
  /** Resonance's crate-digger three-quarter view onto bin i */
  function binPose(i: number, out: Pose) {
    const cr = bins[i].crate.group
    cr.updateWorldMatrix(true, false)
    _c.set(0.05, 0.55, 0.2).applyMatrix4(cr.matrixWorld)
    dirOf(tall ? 6 : 10, tall ? 30 : 27, _d)
    return frame(out, _c, _d, tall ? 1.9 : 2.2, 1.9, region, W, H, 30)
  }
  /** the held sleeve + its record, with the top of the bin under it */
  function presentPose(i: number, out: Pose) {
    const rig = bins[i].rig
    const sz = rig.station(0, _c, _d)
    _c.y -= 0.22
    dirOf(tall ? 2 : 4, tall ? 18 : 16, _d)
    return frame(out, _c, _d, sz.w * (tall ? 1.1 : 1.2), sz.h + 0.75, region, W, H, 30)
  }
  function stationPose(i: number, qv: number, out: Pose) {
    const { item } = rigAt(i, qv)
    const n = PLAN[i].items
    const p = item < 0 ? 0 : smoothstep(0.02, 0.24, item) * (1 - smoothstep(n - 0.2, n - 0.02, item))
    binPose(i, pa)
    if (p <= 0) return blend(pa, pa, 0, out)
    presentPose(i, pc)
    return blend(pa, pc, smoother(p), out)
  }
  /**
   * The opening: a low product-film dolly past the front of the Starters bin
   * (its section sleeve face-out, the dish covers standing behind it, the pass
   * glowing beyond), rising into the crate-digger view by the first section.
   */
  function introPose(u: number, out: Pose) {
    const cr = bins[0].crate.group
    cr.updateWorldMatrix(true, false)
    const e = smoother(u)
    _c.set(lerp(0.25, 0.1, e), lerp(0.5, 0.55, e), 0.3).applyMatrix4(cr.matrixWorld)
    dirOf(lerp(tall ? -30 : -36, tall ? 4 : 8, e), lerp(7, 22, e), _d)
    return frame(out, _c, _d, tall ? 1.75 : lerp(2.3, 2.1, e), lerp(1.25, 1.6, e), region, W, H, 30)
  }
  /**
   * The ending: a close, lit shot of the Sweets bin (the last sweet standing
   * face-out) with the dessert plate and the snifter, clear of the order card;
   * a slow push in before the pour.
   */
  function endPose(u: number, out: Pose) {
    const cr = bins[NSEC - 1].crate.group
    cr.updateWorldMatrix(true, false)
    _c.set(0.12, 0.42, 0.5).applyMatrix4(cr.matrixWorld)
    const push = smoother(clamp((u - 0.45) / 0.55))
    dirOf(lerp(-10, -4, push), lerp(20, 17, push), _d)
    const k = lerp(1, 0.86, push)
    return frame(out, _c, _d, (tall ? 2.35 : 2.45) * k, 1.3 * k, region, W, H, 30)
  }
  function computePose(qv: number, out: Pose) {
    if (qv < S0 + POST) {
      const u = clamp(qv / (S0 + POST))
      introPose(u, pb)
      stationPose(0, qv, out)
      camStation = 0
      return blend(pb, out, smoothstep(0.78, 1, u), out)
    }
    if (qv > S1 - PRE) {
      stationPose(NSEC - 1, qv, pb)
      endPose(clamp((qv - S1) / (1 - S1)), out)
      camStation = NSEC - 1
      return blend(pb, out, smoother((qv - (S1 - PRE)) / (PRE + POST + 0.01)), out)
    }
    for (let i = 1; i < NSEC; i++) {
      if (qv > A[i] - PRE && qv < A[i] + POST) {
        const t = smoother((qv - (A[i] - PRE)) / (PRE + POST))
        stationPose(i - 1, qv, pb)
        stationPose(i, qv, out)
        camStation = i - 1 + t
        return blend(pb, out, t, out)
      }
    }
    const s = sectionAt(qv)
    camStation = s
    return stationPose(s, qv, out)
  }

  // ---- the list panel: split every section into pages that fit (on resize only)
  function fit() {
    needFit = false
    const avail = dock.clientHeight
    if (avail <= 0) return
    const cs = getComputedStyle(panel)
    const room = avail - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    for (const sd of secs) {
      const n = sd.items.length
      const was = sd.root.style.display
      sd.root.style.display = 'block'
      let chosen: number[][] = [sd.items.map((_, i) => i)]
      for (let P = 1; P <= n; P++) {
        const per = Math.ceil(n / P)
        const pages: number[][] = []
        for (let k = 0; k < n; k += per) pages.push(Array.from({ length: Math.min(per, n - k) }, (_, i) => k + i))
        let ok = true
        sd.pageEl.textContent = pages.length > 1 ? `1/${pages.length}` : ''
        for (const pg of pages) {
          sd.items.forEach((it, i) => (it.style.display = pg.includes(i) ? '' : 'none'))
          if (sd.root.offsetHeight > room + 1) {
            ok = false
            break
          }
        }
        chosen = pages
        if (ok) break
      }
      sd.pages = chosen
      sd.page = -1
      sd.root.style.display = was
    }
    curSec = -2
  }
  function showPage(sd: SecDom, k: number) {
    if (sd.page === k) return
    sd.page = k
    const pg = sd.pages[k] ?? []
    sd.items.forEach((it, i) => (it.style.display = pg.includes(i) ? '' : 'none'))
    sd.pageEl.textContent = sd.pages.length > 1 ? `${k + 1}/${sd.pages.length}` : ''
    sd.root.classList.remove('kt-flip')
    void sd.root.offsetWidth
    sd.root.classList.add('kt-flip')
  }
  function measure(fw: number, fh: number) {
    W = fw
    H = fh
    tall = H > W
    const short = !tall && H <= 500
    const P = probe.getBoundingClientRect()
    const D = dock.getBoundingClientRect()
    const capH = short ? 46 : 64
    if (tall) region = { x0: P.left, x1: P.right, y0: P.top, y1: Math.max(P.top + 80, D.top - capH - 6) }
    else region = { x0: P.left, x1: Math.max(P.left + 120, D.left - 28), y0: P.top, y1: Math.max(P.top + 80, P.bottom - capH) }
    needFit = true
  }

  function setCaption(label: string, name: string, price: string) {
    const key = `${label}|${name}`
    if (key === curCap) return
    curCap = key
    capLabel.textContent = label
    capName.textContent = name
    capPrice.textContent = price
    cap.classList.remove('kt-flip')
    void cap.offsetWidth
    cap.classList.add('kt-flip')
  }

  return {
    id: 'kitchen',
    group,
    // each section lands on its section sleeve turned over (the tracklist up)
    anchors: PLAN.map((p, i) => A[i] + ((A[i + 1] - A[i]) * 0.5) / p.weight),
    busy: () => clock.busy || performance.now() < settleUntil,

    async init(ctx: ChapterContext) {
      const phone = ctx.mobile
      // ---- the room: the bar top and the pass
      const bar = makeBarTop({ length: STEP * NSEC + 40, depth: 7 })
      bar.position.set(stationX(2), 0, -0.6)
      group.add(bar)
      pass = makePass(-14, stationX(4) + 18, -2.6, 2.35, STEP)
      group.add(pass.group)
      await nextFrame()

      // ---- a bin of sleeves per section
      let cat = 1
      PLAN.forEach((p, i) => {
        const sec = p.sec
        const crate = makeCrate({ depth: 1.0, legend: ['GLORY RECORDS · THE KITCHEN', sec.title.toUpperCase()] })
        crate.group.position.set(stationX(i), 0, 0)
        crate.group.rotation.y = CRATE_YAW
        group.add(crate.group)
        const tracks: Track[] = sec.items.map(d => ({ name: withMarks(d), value: d.price }))
        const notes = [sec.note, 'V vegetarian · GF gluten free'].filter(Boolean).join(' · ')
        const secCat = catNo(cat++)
        const list = { title: sec.title, sub: SECTIONS.kitchen.title, cat: secCat, tracks, notes }
        const backRead = tracklistTexture(list, phone ? 768 : 1024)
        const backStack = tracklistTexture({ ...list, flip: true }, 512)
        const secSleeve = makeSleeve({
          front: coverTexture({ title: sec.title, kicker: `${SECTIONS.kitchen.eyebrow} · ${SECTIONS.kitchen.title}`, cat: secCat, paper: PAPERS[i] }, 512),
          back: backStack,
          seed: i * 5.1,
        })
        const dishSleeves = p.dishes.map((d, j) =>
          makeSleeve({
            front: coverTexture(
              { title: d.name, kicker: `${sec.title} · ${d.price}`, sub: d.desc, cat: catNo(cat + j), photoUrl: d.photo, eager: i === 0 && j === 0 },
              phone ? 768 : 1024,
            ),
            back: backStack,
            seed: i * 5.1 + j * 1.7 + 1,
          }),
        )
        const labels = [
          labelTexture({ title: sec.title, sub: SECTIONS.kitchen.title, side: 'SIDE A', cat: secCat, paper: PAPERS[i] === 'cream' ? 'red' : 'cream' }, phone ? 384 : 512),
          ...p.dishes.map((d, j) =>
            labelTexture({ title: d.name, sub: d.desc.split(',')[0], side: 'SIDE A', cat: catNo(cat + j), paper: LABEL_PAPERS[(i + j + 1) % LABEL_PAPERS.length] }, phone ? 384 : 512),
          ),
        ]
        cat += p.dishes.length
        const atlas = coverAtlas(
          p.rest.map((d, j) => ({ title: d.name, kicker: `${sec.title} · ${d.price}`, sub: d.desc, cat: catNo(cat + j), paper: (['cream', 'bone', 'stout', 'amber'] as PaperName[])[(i + j) % 4] })),
          { ...list, cat: secCat },
          p.riffle ? 1024 : 512,
        )
        cat += p.rest.length
        const rig = new CrateRig({
          crate,
          sleeves: [secSleeve, ...dishSleeves],
          labels,
          fillers: { count: p.rest.length, atlas },
          present: PRESENT,
          yaw: [4, -3, 5, -4],
          pitch: 16,
        })
        bins.push({ crate, rig, secSleeve, backRead, backStack, turn: 0, item: -1, riffle: 0 })
      })
      await nextFrame()

      // ---- a beer by some bins; the Sweets still life: a dessert plate and a fork
      const beers: [number, Parameters<typeof makeGlass>[0], number, number][] = [
        [0, { shape: 'pint', beer: BEERS.gold, scale: 0.48, fill: 0.93, head: 0.09 }, -0.98, -0.25],
        [2, { shape: 'tulip', beer: BEERS.amber, scale: 0.5, fill: 0.9, head: 0.1 }, 0.95, 0.4],
        [4, { shape: 'snifter', beer: BEERS.stout, scale: 0.5, fill: 0.62, head: 0.07 }, -0.84, 0.2],
      ]
      for (const [station, opt, dx, dz] of beers) {
        const g = makeGlass(opt)
        g.group.position.set(stationX(station) + dx, 0, dz)
        group.add(g.group)
        glasses.push({ g, station })
      }
      still = new THREE.Group()
      const plate = makePlate(0.36)
      const fork = makeFork(0.62)
      fork.position.set(-0.3, 0.035, 0.1)
      fork.rotation.y = 0.45
      still.add(plate, fork)
      still.position.set(stationX(4) + 0.86, 0, 0.62)
      group.add(still)

      // ---- DOM
      const root = el('div', 'kt', undefined, ctx.stage)
      probe = el('div', 'kt-probe', undefined, root)
      dock = el('div', 'kt-dock', undefined, root)
      intro = el('div', 'kt-intro', undefined, dock)
      el('p', 'hud-eyebrow', SECTIONS.kitchen.eyebrow, intro)
      introH = rise(el('h2', 'hud-h2 kt-title', undefined, intro), emLast(SECTIONS.kitchen.title))

      panel = el('div', 'kt-panel hud-panel', undefined, dock)
      MENU.forEach((sec, i) => {
        const r = el('section', 'kt-sec', undefined, panel)
        const head = el('div', 'kt-head', undefined, r)
        el('span', 'kt-num', `${pad2(i + 1)}/${pad2(NSEC)}`, head)
        el('span', 'kt-kicker', SECTIONS.kitchen.title, head)
        const pageEl = el('span', 'kt-page', '', head)
        el('h3', 'kt-sec-title', sec.title, r)
        if (sec.note) el('p', 'kt-note', sec.note, r)
        const ul = el('ul', 'kt-items', undefined, r)
        const items = sec.items.map(d => {
          const li = el('li', 'kt-item', undefined, ul)
          const row = el('div', 'kt-row', undefined, li)
          el('span', 'kt-name', d.name, row)
          if (d.marks?.length) {
            const mk = el('span', 'kt-marks', undefined, row)
            d.marks.forEach(x => el('span', 'kt-mark', x, mk))
          }
          el('span', 'kt-lead', undefined, row)
          el('span', 'kt-price', d.price, row)
          el('p', 'kt-desc', d.desc, li)
          return li
        })
        secs.push({ root: r, items, pageEl, pages: [items.map((_, k) => k)], page: -1 })
      })

      cap = el('div', 'kt-cap', undefined, root)
      capLabel = el('span', 'kt-cap-label', '', cap)
      const capRow = el('span', 'kt-cap-row', undefined, cap)
      capName = el('span', 'kt-cap-name', '', capRow)
      capPrice = el('span', 'kt-cap-price', '', capRow)

      end = el('div', 'kt-end', undefined, dock)
      el('p', 'hud-eyebrow', SECTIONS.kitchen.eyebrow, end)
      const btn = el('a', 'hud-btn kt-order', LINKS.order.label, end)
      btn.href = LINKS.order.url
      btn.target = '_blank'
      btn.rel = 'noopener'
      const hrs = el('div', 'kt-hours', undefined, end)
      el('p', 'hud-label kt-hours-label', KITCHEN_UI.hours, hrs)
      const ul = el('ul', 'kt-hours-list', undefined, hrs)
      for (const h of KITCHEN_HOURS) {
        const li = el('li', undefined, undefined, ul)
        el('span', 'kt-day', h.day, li)
        el('span', 'kt-hrs', h.hours, li)
      }
      if (document.fonts) document.fonts.ready.then(() => (needFit = true))
    },

    onEnter() {
      clock.reset()
      for (const b of bins) b.rig.reset()
    },

    update(local: number, f: Frame, ctx: ChapterContext) {
      q = clock.update(local, f.dt)
      if (f.width !== W || f.height !== H) measure(f.width, f.height)
      if (needFit && document.fonts?.status !== 'loading') fit()
      const s = sectionAt(q)

      // ---- light first (the rigs' groove highlights follow it)
      const camX = camStation * STEP
      // the heat lamps' warm key; it eases down in the last beat, ahead of the pour
      const fade = 1 - 0.35 * smoothstep(0.95, 1, local)
      const w = ctx.world.params
      w.spot = 0.5 * fade
      w.spotColor = '#ffc486'
      w.spotPos.set(camX - 2.2, 7.5, 5.2)
      w.spotAt.set(camX, 0.6, 0.2)
      w.spotAngle = 0.5
      w.spotPenumbra = 0.7
      w.rimA = 0.9 * fade
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.9, 0.5, -1)
      w.rimB = 0.55
      w.rimBColor = GEL.tungsten
      w.rimBDir.set(1, 0.35, -1)
      w.fill = 0.26 * fade
      w.brick = 0.5
      w.bulbs = 0.7
      w.cyc = 0.45
      w.cycColor = '#6a3218'
      w.cycX = tall ? 0 : -0.25
      w.cycY = 0.25
      w.haze = 0.3
      w.hazeColor = '#b0602a'
      w.envTurn = camX * 0.02
      syncVinylLights(ctx.world)
      pass.setHeat(f.reducedMotion ? 1.1 : 1.1 + 0.08 * Math.sin(f.time * 1.3))
      ctx.post.params.beer = 0.2

      // ---- the bins
      bins.forEach((b, i) => {
        const { item, riffle } = rigAt(i, q)
        if (Math.abs(item - b.item) > 1e-4 || Math.abs(riffle - b.riffle) > 1e-4) settleUntil = performance.now() + 1400
        b.item = item
        b.riffle = riffle
        b.rig.update(item, f, riffle)
        // the section sleeve turns over in hand to show its back (the tracklist), then back
        const rig = b.rig
        const held = rig.k === 0 && rig.lift > 0.0005
        const t = held ? smoothstep(0.2, 0.36, rig.s) * (1 - smoothstep(0.66, 0.79, rig.s)) : 0
        b.turn = t
        const want = t > 0.001 ? b.backRead : b.backStack
        if (b.secSleeve.uniforms.uBack.value !== want) b.secSleeve.setBack(want)
        if (t > 0.001) {
          const g = b.secSleeve.group
          // turn about the sleeve's vertical centre line (the group pivots at the bottom edge)
          g.matrix.multiply(_m.makeRotationY(Math.PI * smoother(t)))
          g.matrixWorldNeedsUpdate = true
        }
        b.crate.group.visible = Math.abs(i - camStation) < 1.45
      })
      for (const { g, station } of glasses) g.group.visible = Math.abs(station - camStation) < 1.2
      still.visible = camStation > 3.2

      computePose(q, camPose)

      // ---- DOM: intro, panel, caption, end
      const introOn = local > 0.035 && q >= INTRO_ON && q < S0 - 0.004
      intro.classList.toggle('is-on', introOn)
      setRise(introH, introOn)
      const secOn = s >= 0 && s < NSEC
      panel.classList.toggle('is-on', secOn)
      if (secOn) {
        const sd = secs[s]
        const P = sd.pages.length
        showPage(sd, Math.min(P - 1, Math.floor(phaseIn(s, q) * P)))
      }
      if (s !== curSec) {
        curSec = s
        secs.forEach((sd, i) => sd.root.classList.toggle('is-on', i === s))
      }

      // the caption names the sleeve in hand (or face-out in the riffle)
      let capOn = false
      if (secOn) {
        const b = bins[s]
        const p = PLAN[s]
        const rig = b.rig
        if (rig.k >= 0 && rig.s > RIG_PHASE.hudOn && rig.s < RIG_PHASE.hudOff) {
          capOn = true
          if (rig.k === 0) setCaption(`${KITCHEN_UI.tracklist} · ${pad2(s + 1)}/${pad2(NSEC)}`, p.sec.title, '')
          else {
            const d = p.dishes[rig.k - 1]
            setCaption(`${KITCHEN_UI.pass} · ${pad2(rig.k)}/${pad2(p.dishes.length)}`, d.name, d.price)
          }
        } else if (p.riffle && b.item >= p.items) {
          const j = Math.floor(b.riffle)
          const fr = b.riffle - j
          if (j < p.rest.length && fr > 0.12 && fr < 0.88) {
            capOn = true
            const d = p.rest[j]
            setCaption(`${p.sec.title} · ${pad2(j + 1)}/${pad2(p.rest.length)}`, d.name, d.price)
          }
        }
      }
      cap.classList.toggle('is-on', capOn && local < 0.95)
      end.classList.toggle('is-on', q >= END_ON && local < 0.965)
    },

    camera(_local: number, _frame: Frame, out: CameraPose) {
      out.position.copy(camPose.pos)
      out.target.copy(camPose.tgt)
      out.fov = camPose.fov
      out.roll = 0
      out.parallax = 0.08
    },
  }
}
