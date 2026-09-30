import * as THREE from 'three'
import './kitchen.css'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { KITCHEN_HOURS, KITCHEN_UI, LINKS, MENU, SECTIONS, type Dish } from '../../content'
import { clamp, lerp, smoothstep } from '../../core/math'
import { el, rise, setRise } from '../../core/dom'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { whenRevealed } from '../../kit/images'
import { makeBarTop } from '../../kit/bar'
import { BEERS, makeGlass, type Glass } from '../../kit/beer'
import { GEL } from '../../world/World'
import { CARD_H, CARD_W, blankTexture, decodePhoto, drawMenuCard, drawPrint, loadFonts, printSize } from './art'
import { makeFork, makePass, makePlate } from './props'

/*
 * KITCHEN — "The Pass".
 *
 * Resonance's record crate became Glory's pass: the long oiled bar top under a
 * stainless shelf with glowing heat-lamp tubes and a ticket rail. Each section
 * of the All Day Menu arrives as a MENU CARD (heavy cream stock printed in the
 * site's type) that slides onto the bar at its own station; the section's
 * photographed dishes arrive one at a time as thick matte PRINTS that slide in
 * along the bar on a damped spring, captioned (name + price) crisp in the DOM.
 * The camera dollies along the bar station to station, overhead to oblique.
 *
 *   0.00–0.06  the pour lands; the camera cranes down onto the first station
 *   0.07–0.13  "All Day Menu" holds; the Starters card slides onto the bar
 *   0.13–0.895 five sections (Starters, Soups & Salads, Sandwiches, Specials,
 *              Sweets), weighted by length: the card on the bar, the full list
 *              in the panel (paged on phones so every item reads at rest), the
 *              section's dishes cycling as prints. Sweets has no photos: its
 *              card sits under the lamps with a dessert plate, a fork and a
 *              snifter of stout.
 *   0.895–1.0  the camera pulls back along the whole pass (every card and a
 *              print per section back on the bar); "Order for Pickup with
 *              ToastTab" + kitchen hours; then the pour (straw).
 *
 * Camera, active section, page and dish are all driven by a StoryClock.
 */

const DEG = Math.PI / 180
const STEP = 7.5
const NSEC = MENU.length
const S0 = 0.13
const S1 = 0.895
const WEIGHTS = [1.8, 1.25, 1.45, 1.25, 0.65]
const A: number[] = (() => {
  const sum = WEIGHTS.reduce((a, b) => a + b, 0)
  const out = [S0]
  for (const w of WEIGHTS) out.push(out[out.length - 1] + ((S1 - S0) * w) / sum)
  return out
})()
/** the dolly between stations: [boundary - PRE, boundary + POST] */
const PRE = 0.02
const POST = 0.034
const INTRO_ON = 0.058
const CARD0_IN = 0.06
const END_ON = S1 + 0.012

/** the photographed dishes of each section */
const DISHES: Dish[][] = MENU.map(s => s.items.filter(d => d.photo))
const ALL_DISHES = DISHES.flatMap((ds, i) => ds.map((d, j) => ({ d, sec: i, j, last: j === ds.length - 1 })))

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

/** the section at clock value q: -1 intro, 0..4, NSEC = the end beat */
function sectionAt(q: number) {
  if (q < S0) return -1
  for (let i = 0; i < NSEC; i++) if (q < A[i + 1]) return i
  return NSEC
}
const phaseIn = (i: number, q: number) => clamp((q - A[i]) / (A[i + 1] - A[i]))

// ---- camera framing (after Resonance's frameTo)
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
interface Region {
  x0: number
  x1: number
  y0: number
  y1: number
}
const UP = new THREE.Vector3(0, 1, 0)
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const _d = new THREE.Vector3()
const dirOf = (yaw: number, pitch: number, out: THREE.Vector3) =>
  out.set(-Math.sin(yaw * DEG) * Math.cos(pitch * DEG), -Math.sin(pitch * DEG), -Math.cos(yaw * DEG) * Math.cos(pitch * DEG))
/** Look along D so a subject (w × h in the view plane, centred on C) fills `reg`. */
function frameTo(out: Pose, C: THREE.Vector3, D: THREE.Vector3, w: number, h: number, reg: Region, W: number, H: number, fov: number) {
  const aspect = W / H
  const tanH = Math.tan((fov * DEG) / 2)
  const fw = Math.max(0.05, (reg.x1 - reg.x0) / W)
  const fh = Math.max(0.05, (reg.y1 - reg.y0) / H)
  const cx = ((reg.x0 + reg.x1) / 2 / W) * 2 - 1
  const cy = 1 - ((reg.y0 + reg.y1) / 2 / H) * 2
  const dist = Math.max(w / 2 / (fw * tanH * aspect), h / 2 / (fh * tanH))
  const hh = dist * tanH
  const hw = hh * aspect
  _r.crossVectors(D, UP).normalize()
  _u.crossVectors(_r, D).normalize()
  out.pos.copy(C).addScaledVector(D, -dist).addScaledVector(_r, -cx * hw).addScaledVector(_u, -cy * hh)
  out.tgt.copy(out.pos).addScaledVector(D, dist)
  out.fov = fov
  return out
}

// ---- station layouts (per screen shape)
type Mode = 'wide' | 'tall' | 'short'
interface Layout {
  card: [number, number, number]
  print: [number, number, number]
  glass: [number, number]
  /** subject centre (x offset, z) and span (x, depth) */
  c: [number, number]
  span: [number, number]
  pitch: [number, number]
}
const LAYOUTS: Record<Mode, Layout> = {
  wide: { card: [-1.72, -0.12, 0.07], print: [1.42, 0.12, -0.035], glass: [-0.05, -2.35], c: [0.05, -0.1], span: [6.7, 3.6], pitch: [64, 47] },
  short: { card: [-1.72, -0.12, 0.07], print: [1.42, 0.12, -0.035], glass: [-0.05, -2.35], c: [0.05, -0.1], span: [6.7, 3.6], pitch: [60, 46] },
  tall: { card: [-0.78, -0.95, 0.08], print: [0.42, 0.62, -0.05], glass: [-2.05, -2.25], c: [0.15, -0.3], span: [4.5, 4.3], pitch: [66, 52] },
}

interface Spring {
  s: number
  v: number
  target: number
}
const spring = (s = -1): Spring => ({ s, v: 0, target: s })
function stepSpring(sp: Spring, dt: number, snap: boolean) {
  if (snap) {
    sp.s = sp.target
    sp.v = 0
    return
  }
  const k = 58
  const c = 2 * 0.62 * Math.sqrt(k)
  let t = Math.min(dt, 0.1)
  while (t > 1e-5) {
    const h = Math.min(t, 1 / 120)
    sp.v += (-k * (sp.s - sp.target) - c * sp.v) * h
    sp.s += sp.v * h
    t -= h
  }
  if (Math.abs(sp.s - sp.target) < 1e-4 && Math.abs(sp.v) < 1e-3) {
    sp.s = sp.target
    sp.v = 0
  }
}
const settled = (sp: Spring) => sp.s === sp.target && sp.v === 0

interface Card {
  obj: THREE.Mesh
  sp: Spring
}
interface Print {
  obj: THREE.Mesh
  mat: THREE.MeshStandardMaterial
  sp: Spring
  sec: number
  j: number
  last: boolean
  aspect: number
  dish: Dish
}
interface SecDom {
  root: HTMLElement
  items: HTMLElement[]
  pageEl: HTMLElement
  pages: number[][]
  page: number
}

export default function kitchen(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.085 })
  let lastLocal = NaN
  let q = 0
  let mode: Mode = 'wide'
  let W = 0
  let H = 0
  let region: Region = { x0: 0, x1: 1, y0: 0, y1: 1 }
  const camPose = pose()
  /** which station the camera is at (fractional during a dolly; NSEC = the overview) */
  let camStation = 0
  const pa = pose()
  const pb = pose()

  const cards: Card[] = []
  const prints: Print[] = []
  const glasses: { g: Glass; station: number }[] = []
  let plate: THREE.Mesh
  let fork: THREE.Group
  let pass: ReturnType<typeof makePass>

  // DOM
  let root: HTMLElement
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
  let curDish = -2
  let needFit = true

  const stationX = (i: number) => i * STEP

  function place(L: Layout) {
    cards.forEach((c, i) => {
      c.obj.userData.base = [stationX(i) + L.card[0], L.card[1], L.card[2]]
    })
    prints.forEach(p => {
      p.obj.userData.base = [stationX(p.sec) + L.print[0], L.print[1], L.print[2] + (p.j - 1) * 0.03]
    })
    glasses.forEach(({ g, station }) => g.group.position.set(stationX(station) + L.glass[0], 0, L.glass[1]))
    plate.position.set(stationX(4) + L.print[0] - 0.1, 0, L.print[1])
    fork.position.set(stationX(4) + L.print[0] - 0.55, 0.045, L.print[1] + 0.22)
  }

  /** pose at station i, phase p (0..1): overhead → oblique, a slow yaw along the bar */
  function stationPose(i: number, p: number, out: Pose) {
    const L = LAYOUTS[mode]
    const e = smoother(p)
    const pitch = lerp(L.pitch[0], L.pitch[1], e)
    const yaw = lerp(-6, 5, e)
    dirOf(yaw, pitch, _d)
    const C = new THREE.Vector3(stationX(i) + L.c[0], 0.05, L.c[1])
    const w = L.span[0] * lerp(1, 0.94, e)
    const h = L.span[1] * Math.sin(pitch * DEG) + 0.4 * Math.cos(pitch * DEG)
    return frameTo(out, C, _d, w, h, region, W, H, 30)
  }
  function introPose(out: Pose) {
    const L = LAYOUTS[mode]
    dirOf(-14, 78, _d)
    const C = new THREE.Vector3(L.c[0] - 1.2, 0.05, L.c[1])
    return frameTo(out, C, _d, L.span[0] * 1.6, L.span[1] * 1.6, region, W, H, 30)
  }
  function overviewPose(out: Pose) {
    // looking back along the whole pass from past the last station
    const tall = mode === 'tall'
    dirOf(tall ? 50 : 60, tall ? 38 : 27, _d)
    const C = new THREE.Vector3(stationX(2) + 1, 0, 0)
    return frameTo(out, C, _d, tall ? 11 : 14, tall ? 9 : 6.5, region, W, H, tall ? 36 : 30)
  }

  function computePose(qv: number, out: Pose) {
    const s = sectionAt(qv)
    if (qv < S0 + POST) {
      introPose(pa)
      stationPose(0, 0, pb)
      const t = smoother(clamp(qv / (S0 + POST)))
      camStation = 0
      return blend(pa, pb, t, out)
    }
    if (s >= NSEC || qv > S1 - PRE) {
      stationPose(NSEC - 1, phaseIn(NSEC - 1, qv), pa)
      overviewPose(pb)
      camStation = NSEC
      return blend(pa, pb, smoother((qv - (S1 - PRE)) / (PRE + POST + 0.01)), out)
    }
    // near a boundary between sections i-1 and i?
    for (let i = 1; i < NSEC; i++) {
      if (qv > A[i] - PRE && qv < A[i] + POST) {
        stationPose(i - 1, phaseIn(i - 1, qv), pa)
        stationPose(i, phaseIn(i, qv), pb)
        const t = smoother((qv - (A[i] - PRE)) / (PRE + POST))
        camStation = i - 1 + t
        return blend(pa, pb, t, out)
      }
    }
    camStation = s
    return stationPose(s, phaseIn(s, qv), out)
  }

  /** split every section's list into pages that fit the panel (runs on resize only) */
  function fit() {
    needFit = false
    const avail = dock.clientHeight
    if (avail <= 0) return
    const cs = getComputedStyle(panel)
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const room = avail - padY
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
    mode = H > W ? 'tall' : H <= 500 ? 'short' : 'wide'
    const P = probe.getBoundingClientRect()
    const D = dock.getBoundingClientRect()
    const capH = mode === 'short' ? 46 : 64
    if (mode === 'tall') region = { x0: P.left, x1: P.right, y0: P.top, y1: Math.max(P.top + 80, D.top - capH - 6) }
    else region = { x0: P.left, x1: Math.max(P.left + 120, D.left - 28), y0: P.top, y1: Math.max(P.top + 80, P.bottom - capH) }
    if (W > 0 && H > 0) place(LAYOUTS[mode])
    needFit = true
  }

  return {
    id: 'kitchen',
    group,
    anchors: A.slice(0, NSEC).map((a, i) => (i === 0 ? a + POST + 0.012 : a + POST + 0.006)),
    busy: () => clock.busy || cards.some(c => !settled(c.sp)) || prints.some(p => !settled(p.sp)),

    async init(ctx: ChapterContext) {
      // ---- the room: bar top, the pass
      const bar = makeBarTop({ length: STEP * NSEC + 40, depth: 8 })
      bar.position.set(stationX(2), 0, -0.3)
      group.add(bar)
      pass = makePass(-12, stationX(4) + 16, -4.3, 2.2, STEP)
      group.add(pass.group)

      // ---- menu cards (cream stock; faces drawn after the fonts load)
      const edge = new THREE.MeshStandardMaterial({ color: 0xe9dcc2, roughness: 0.9 })
      const cardGeo = new THREE.BoxGeometry(CARD_W, 0.024, CARD_H)
      cardGeo.translate(0, 0.012, 0)
      const blank = blankTexture()
      MENU.forEach(() => {
        const top = new THREE.MeshStandardMaterial({ map: blank, roughness: 0.82, emissive: 0xffffff, emissiveMap: blank, emissiveIntensity: 0.04 })
        const m = new THREE.Mesh(cardGeo, [edge, edge, top, edge, edge, edge])
        m.castShadow = true
        m.receiveShadow = true
        group.add(m)
        cards.push({ obj: m, sp: spring(-1) })
      })

      // ---- prints (thick matte stock; photos after reveal, the first now)
      const printGeo = new THREE.BoxGeometry(1, 0.036, 1)
      printGeo.translate(0, 0.018, 0)
      const printEdge = new THREE.MeshStandardMaterial({ color: 0xefe6d4, roughness: 0.95 })
      for (const { d, sec, j, last } of ALL_DISHES) {
        const mat = new THREE.MeshStandardMaterial({ map: blank, roughness: 0.88, emissive: 0xffffff, emissiveMap: blank, emissiveIntensity: 0.06 })
        const m = new THREE.Mesh(printGeo, [printEdge, printEdge, mat, printEdge, printEdge, printEdge])
        m.castShadow = true
        m.receiveShadow = true
        m.visible = false
        const a = d.photo!.includes('octopus') || d.photo!.includes('/ig-') ? 1 : 1.5
        const S = printSize(a)
        m.scale.set(S.w, 1, S.h)
        group.add(m)
        prints.push({ obj: m, mat, sp: spring(-1), sec, j, last, aspect: a, dish: d })
      }

      // ---- sweets: a plate and a fork under the lamps; beers along the bar
      plate = makePlate(0.95)
      group.add(plate)
      fork = makeFork(1.15)
      fork.rotation.y = 0.5
      group.add(fork)
      const beers: [number, Parameters<typeof makeGlass>[0]][] = [
        [0, { shape: 'pint', beer: BEERS.gold, scale: 1.35, fill: 0.93, head: 0.09 }],
        [2, { shape: 'tulip', beer: BEERS.amber, scale: 1.35, fill: 0.9, head: 0.1 }],
        [4, { shape: 'snifter', beer: BEERS.stout, scale: 1.45, fill: 0.62, head: 0.07 }],
      ]
      for (const [station, opt] of beers) {
        const g = makeGlass(opt)
        group.add(g.group)
        glasses.push({ g, station })
      }
      await nextFrame()

      // ---- DOM
      const stage = ctx.stage
      root = el('div', 'kt', undefined, stage)
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

      // ---- type: draw the cards once the faces are in
      await loadFonts()
      await nextFrame()
      MENU.forEach((sec, i) => {
        const tex = drawMenuCard(sec, i, NSEC)
        const m = (cards[i].obj.material as THREE.MeshStandardMaterial[])[2]
        m.map = tex
        m.emissiveMap = tex
        m.needsUpdate = true
      })
      needFit = true

      // ---- photos: the first now, the rest once the site is revealed
      const loadPrint = async (p: Print) => {
        try {
          const ph = await decodePhoto(p.dish.photo!)
          const a = ph.w / ph.h > 1.2 ? 1.5 : 1
          p.aspect = a
          const S = printSize(a)
          p.obj.scale.set(S.w, 1, S.h)
          const tex = drawPrint(ph, p.dish, a)
          ph.close?.()
          p.mat.map = tex
          p.mat.emissiveMap = tex
          p.mat.needsUpdate = true
        } catch {
          /* the blank print stays */
        }
      }
      void loadPrint(prints[0])
      void whenRevealed().then(async () => {
        for (const p of prints.slice(1)) {
          await loadPrint(p)
          await nextFrame()
        }
      })
    },

    onEnter() {
      clock.reset()
      lastLocal = NaN
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      const jumped = !Number.isFinite(lastLocal) || Math.abs(local - lastLocal) > 0.12
      lastLocal = local
      q = clock.update(local, frame.dt)
      if (frame.width !== W || frame.height !== H) measure(frame.width, frame.height)
      if (needFit && document.fonts?.status !== 'loading') fit()
      const snap = jumped || frame.reducedMotion
      const s = sectionAt(q)

      // ---- which dish is on the pass
      let active = -1
      if (s >= 0 && s < NSEC && DISHES[s].length) {
        const D = DISHES[s].length
        const j = Math.min(D - 1, Math.floor(phaseIn(s, q) * D))
        active = ALL_DISHES.findIndex(x => x.sec === s && x.j === j)
      }

      // ---- cards
      cards.forEach((c, i) => {
        c.sp.target = q >= (i === 0 ? CARD0_IN : A[i] - PRE * 0.5) ? 0 : -1
        stepSpring(c.sp, frame.dt, snap)
        const [bx, by, byaw] = c.obj.userData.base as number[]
        const sx = c.sp.s
        c.obj.position.set(bx - sx * 6, 0.004 + i * 0.0005 + Math.max(0, -sx) * 0.05, by)
        c.obj.rotation.set(0, byaw + c.sp.v * 0.035 + sx * 0.25, 0)
        c.obj.visible = Math.abs(sx) < 0.985
      })

      // ---- prints
      prints.forEach((p, g) => {
        let t: number
        if (s >= NSEC) t = p.last ? 0 : 1
        else if (active >= 0) t = g < active ? 1 : g === active ? 0 : -1
        else if (s < 0) t = -1
        else t = p.sec < s ? 1 : -1
        p.sp.target = t
        stepSpring(p.sp, frame.dt, snap)
        const [bx, bz, byaw] = p.obj.userData.base as number[]
        const sx = p.sp.s
        p.obj.position.set(bx - sx * 6.5, 0.03 + p.j * 0.012, bz + Math.abs(sx) * 0.25)
        p.obj.rotation.set(0, byaw + (p.j % 2 ? 0.03 : -0.02) + p.sp.v * 0.05 + sx * 0.12, 0)
        p.obj.visible = Math.abs(sx) < 0.985
      })

      // ---- sweets props + beers: only near their station
      computePose(q, camPose)
      const overview = q > S1 - PRE
      for (const { g, station } of glasses) {
        g.group.visible = overview || Math.abs(station - camStation) < 0.8
      }
      plate.visible = fork.visible = overview || camStation > 3.2

      // ---- DOM: intro, panel, caption, end
      const introOn = local > 0.035 && q >= INTRO_ON && q < S0 - 0.004
      intro.classList.toggle('is-on', introOn)
      setRise(introH, introOn)
      const secOn = s >= 0 && s < NSEC
      panel.classList.toggle('is-on', secOn)
      if (secOn) {
        const sd = secs[s]
        const P = sd.pages.length
        const k = Math.min(P - 1, Math.floor(phaseIn(s, q) * P))
        showPage(sd, k)
      }
      if (s !== curSec) {
        curSec = s
        secs.forEach((sd, i) => sd.root.classList.toggle('is-on', i === s))
      }
      if (active !== curDish) {
        curDish = active
        if (active >= 0) {
          const x = ALL_DISHES[active]
          capLabel.textContent = `${KITCHEN_UI.pass} · ${pad2(x.j + 1)}/${pad2(DISHES[x.sec].length)}`
          capName.textContent = x.d.name
          capPrice.textContent = x.d.price
          cap.classList.remove('kt-flip')
          void cap.offsetWidth
          cap.classList.add('kt-flip')
        }
      }
      cap.classList.toggle('is-on', active >= 0 && local < 0.95)
      end.classList.toggle('is-on', q >= END_ON && local < 0.965)

      // ---- light: the heat lamps' warm key over the station
      const L = LAYOUTS[mode]
      const camX = overview ? stationX(2) : camStation * STEP + L.c[0]
      const w = ctx.world.params
      w.spot = overview ? 0.45 : 0.4
      w.spotColor = '#ffc486'
      w.spotPos.set(camX - 1.5, 8.5, 3.6)
      w.spotAt.set(camX + 0.6, 0, -0.3)
      w.spotAngle = overview ? 0.9 : 0.62
      w.spotPenumbra = 0.7
      w.rimA = 0.32
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.7, 0.35, -1)
      w.rimB = 0.18
      w.rimBColor = GEL.tungsten
      w.rimBDir.set(0.9, 0.5, -0.8)
      w.fill = 0.4
      w.brick = 0.5
      w.bulbs = 0.7
      w.cyc = 0.45
      w.cycColor = '#6a3218'
      w.cycX = mode === 'tall' ? 0 : -0.25
      w.cycY = 0.25
      w.haze = 0.3
      w.hazeColor = '#b0602a'
      w.envTurn = camX * 0.02
      pass.setHeat(frame.reducedMotion ? 1.1 : 1.1 + 0.08 * Math.sin(frame.time * 1.3))
      ctx.post.params.beer = 0.2
    },

    camera(_local: number, _frame: Frame, out: CameraPose) {
      out.position.copy(camPose.pos)
      out.target.copy(camPose.tgt)
      out.fov = camPose.fov
      out.roll = 0
      out.parallax = 0.12
    },
  }
}
