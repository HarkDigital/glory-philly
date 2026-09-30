import * as THREE from 'three'
import './kitchen.css'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { KITCHEN_HOURS, KITCHEN_UI, LINKS, MENU, SECTIONS, type Dish, type MenuSection } from '../../content'
import { clamp, lerp, smoothstep } from '../../core/math'
import { el, rise, setRise } from '../../core/dom'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { whenRevealed } from '../../kit/images'
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
  makeRecord,
  makeSleeve,
  syncVinylLights,
  tracklistTexture,
  type Crate,
  type PaperName,
  type Region,
  type Sleeve,
  type Track,
  type TracklistSpec,
} from '../../kit/vinyl'
import { GEL } from '../../world/World'
import { makeFork, makePlate } from './props'
import { makeKitchenRoom, type KitchenRoom } from './room'

/*
 * KITCHEN — "The Pass" (the menu is the record crate), in Glory's real room.
 *
 * Resonance's crate, set on Glory's long oiled bar (black rubber rail along
 * its back edge) with the back bar from Mike's photos behind it (room kit,
 * see room.ts): walnut plank cladding and boxy clad columns with wire-cage
 * sconces, the brick bay with the painted "Old 1837" over its bottle shelves,
 * the records bay packed with LPs over the spouted liquor steps, ref4's
 * record column (one Glory LP face-out on its steel ledge under a cage bulb)
 * and the black wall with the tap chalkboards; pendants hang between the bins
 * from the black ceiling. Every section of the All Day Menu is a browser bin
 * of 12" sleeves on the bar, one station per section; the camera dollies
 * along the bar from bin to bin, the back bar sliding past behind.
 * In each bin:
 *  - the SECTION SLEEVE (a typographic cover) lifts out and turns over to show
 *    its BACK — the section's tracklist, prices as values; only then does its
 *    record slide out and spin beside it, and it's home again before the
 *    sleeve turns back, drops and flips onto the stack (a record half out of
 *    its sleeve never turns with it: the sleeve would slice through it)
 *  - each PHOTOGRAPHED DISH is a sleeve with the real photo as its cover: it
 *    lifts, turns to camera, its record (label = the dish) slides out and
 *    spins at 33⅓, slides home, and the sleeve flips onto the stack
 *  - behind them stand the section's other dishes as typographic sleeves; in
 *    Sweets (no photos) they riffle face-out one by one (Tiramisu, Chocolate
 *    Cheesecake) beside a dessert plate and a fork
 * The readable menu is the DOM panel (paged to fit on phones). No caption
 * card: the panel marks the row of the dish in hand (or face-out in the
 * riffle) like the track that's playing.
 *
 * Art: the first two bins (the intro frame) draw their sleeves, backs and
 * labels in init, time-sliced; the other three after the reveal, in idle
 * slices (at once if the chapter is entered first), and upload as they land.
 *
 *   0.00–0.06  the pour lands on a wide look along the back bar
 *   0.058–0.12 "All Day Menu" holds over the Starters bin, "Old 1837" above it;
 *              the camera dollies round the bin into the crate-digger view
 *   0.12–0.90  five sections, weighted by their sleeves (≈ 0.48 vh a sleeve);
 *              the Sweets bin (the last) is watched from the ending's low
 *              angle already, the record column's LP framed below the chrome
 *   0.90–1.00  low on the Sweets bin (the last sweet face-out) under the
 *              record column's face-out LP and its cage bulb; "Order for
 *              Pickup with ToastTab" + kitchen hours; then the pour (straw)
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
/** camera pitches (degrees down): low enough that Glory's back bar reads behind every bin */
const BIN_PITCH = 15
const BIN_PITCH_TALL = 19
const PRESENT_PITCH = 5
/** where a held sleeve is presented (crate-local): low over the bin, in front of it */
const PRESENT = new THREE.Vector3(0, 1.5, 0.98)
const PAPERS: PaperName[] = ['red', 'stout', 'amber', 'cream', 'bone']
const LABEL_PAPERS: PaperName[] = ['cream', 'red', 'stout', 'amber']
/**
 * The section sleeve's slot (rig phase s): it turns over [0]→[1] and back
 * [2]→[3] (done before RIG_PHASE.fall, so it drops square into its slot).
 * Its record stays in the sleeve while it turns: out once the tracklist is
 * up (REC_OUT), home before the turn back (REC_HOME).
 */
const TURN = [0.2, 0.34, 0.66, 0.79] as const
const REC_OUT = [0.34, 0.46] as const
const REC_HOME = [0.55, 0.66] as const
/** bins whose art is drawn in init (the intro frame shows the first two); the rest land after the reveal */
const EAGER = 2

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
/** each bin's first catalogue number (its section sleeve; then its dishes, then the rest) */
const CAT0: number[] = (() => {
  let c = 1
  return PLAN.map(p => {
    const c0 = c
    c += 1 + p.dishes.length + p.rest.length
    return c0
  })
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
const seg = (x: number, a: number, b: number) => clamp((x - a) / (b - a))
/** ease out with a little overshoot (the record's slide lands like the kit's) */
const outBack = (t: number, k = 1.1) => {
  const u = clamp(t) - 1
  return 1 + (k + 1) * u * u * u + k * u * u
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
/** blend with the height (camera and aim) arriving on its own, faster curve */
function blendLowFirst(a: Pose, b: Pose, t: number, ty: number, out: Pose) {
  const py = lerp(a.pos.y, b.pos.y, ty)
  const ty2 = lerp(a.tgt.y, b.tgt.y, ty)
  blend(a, b, t, out)
  out.pos.y = py
  out.tgt.y = ty2
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
  dishSleeves: Sleeve[]
  backRead: THREE.Texture
  backStack: THREE.Texture
  turn: number
  item: number
  riffle: number
}

/** a stand-in (sleeve backs, record labels) until a bin's art is drawn */
const BLANK = (() => {
  const t = new THREE.DataTexture(new Uint8Array([226, 218, 202, 255]), 1, 1)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
})()
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
  let phone = false
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
  let room: KitchenRoom

  // DOM
  let probe: HTMLElement
  let dock: HTMLElement
  let intro: HTMLElement
  let introH: HTMLElement
  let panel: HTMLElement
  let end: HTMLElement
  const secs: SecDom[] = []
  let curSec = -2
  /** the panel row marked as playing (the dish in hand) */
  let curRow: HTMLElement | null = null
  let needFit = true
  /** bins whose art is drawn (the rest wait for the reveal) */
  let artDone = 0
  /** entered before the deferred art landed: stop waiting for idle time */
  let hurry = false

  const stationX = (i: number) => i * STEP

  // ---- camera poses
  /** Resonance's crate-digger three-quarter view onto bin i */
  function binPose(i: number, out: Pose) {
    // the last bin: its riffle is watched from the ending's low angle, so ref4's face-out
    // LP over the bin stays framed below the top chrome from the Sweets sleeve to the end
    // (the high crate-digger look cut it off at the frame's top, under the chrome, and the
    // end crane then dragged it down through the band)
    if (i === NSEC - 1) return endPose(0, out)
    const cr = bins[i].crate.group
    cr.updateWorldMatrix(true, false)
    _c.set(0.05, 0.55, 0.2).applyMatrix4(cr.matrixWorld)
    dirOf(tall ? 6 : 10, tall ? BIN_PITCH_TALL : BIN_PITCH, _d)
    return frame(out, _c, _d, tall ? 1.9 : 2.2, 1.9, region, W, H, 30)
  }
  /** the held sleeve + its record, with the top of the bin under it */
  function presentPose(i: number, out: Pose) {
    const rig = bins[i].rig
    const sz = rig.station(0, _c, _d)
    // (the last bin: aim a touch higher so ref4's LP above it sits clear of the top chrome)
    _c.y -= i === NSEC - 1 ? (tall ? 0.06 : 0.12) : 0.22
    dirOf(tall ? 2 : 4, tall ? PRESENT_PITCH + 2 : PRESENT_PITCH, _d)
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
   * The opening, in Glory's room: under the pour a wide look along the back
   * bar (walnut columns, sconces, the brick with "Old 1837", pendants, the
   * black ceiling and duct), easing down onto the Starters bin — its section
   * sleeve face-out in the foreground with "Old 1837" over it while the
   * headline holds — then a dolly round the front of the bin into the
   * crate-digger view by the first section.
   */
  function introPose(u: number, out: Pose) {
    const cr = bins[0].crate.group
    cr.updateWorldMatrix(true, false)
    // K0: the establishing wide (under the cut)
    _c.set(tall ? 1.1 : 2.0, tall ? 2.6 : 3.3, -2.2).applyMatrix4(cr.matrixWorld)
    dirOf(tall ? -10 : -14, tall ? 1 : -5, _d)
    frame(pa, _c, _d, tall ? 5.6 : 8.2, tall ? 6 : 7.2, region, W, H, 36)
    // K1: the bin with the brick over it, a slow push while the headline holds
    const e = smoother(clamp(u / 0.46))
    const p = smoother(clamp((u - 0.46) / 0.54))
    if (tall) {
      _c.set(0.55, lerp(1.75, 1.6, p), -0.8).applyMatrix4(cr.matrixWorld)
      dirOf(lerp(-12, -8, p), lerp(3, 5, p), _d)
      frame(pc, _c, _d, 2.9 * lerp(1, 0.94, p), 3.3 * lerp(1, 0.94, p), region, W, H, 32)
    } else {
      _c.set(0.8, lerp(2.05, 1.8, p), -0.6).applyMatrix4(cr.matrixWorld)
      dirOf(lerp(-17, -12, p), lerp(-3, 0, p), _d)
      const k = lerp(1, 0.92, p)
      frame(pc, _c, _d, 3.6 * k, 4.1 * k, region, W, H, 32)
    }
    blend(pa, pc, e, out)
    return keepAbove(out)
  }
  /**
   * The ending: low on the Sweets bin (the last sweet face-out) with the
   * dessert plate and the snifter, and behind it ref4's walnut column — one
   * Glory LP face-out on its steel ledge under a wire-cage bulb — clear of
   * the order card; a slow push in before the pour.
   */
  function endPose(u: number, out: Pose) {
    const cr = bins[NSEC - 1].crate.group
    cr.updateWorldMatrix(true, false)
    const push = smoother(clamp((u - 0.35) / 0.65))
    const k = lerp(1, 0.92, push)
    if (tall) {
      _c.set(0.4, lerp(1.45, 1.35, push), -1.1).applyMatrix4(cr.matrixWorld)
      dirOf(lerp(-9, -6, push), lerp(7, 8, push), _d)
      frame(out, _c, _d, 2.5 * k, 2.8 * k, region, W, H, 30)
    } else {
      _c.set(0.5, lerp(1.9, 1.8, push), -1.3).applyMatrix4(cr.matrixWorld)
      dirOf(lerp(-9, -6, push), lerp(0.5, 1.5, push), _d)
      frame(out, _c, _d, 3.0 * k, 3.95 * k, region, W, H, 30)
    }
    return keepAbove(out)
  }
  /** never let a framing drop the camera to the bar's edge (tall regions push it down): lift pose + aim together */
  function keepAbove(out: Pose, minY = 0.75) {
    if (out.pos.y < minY) {
      const d = minY - out.pos.y
      out.pos.y += d
      out.tgt.y += d
    }
    return out
  }
  function computePose(qv: number, out: Pose) {
    if (qv < S0 + POST) {
      const u = clamp(qv / (S0 + POST))
      introPose(u, pb)
      stationPose(0, qv, out)
      camStation = 0
      return blend(pb, out, smoothstep(0.74, 1, u), out)
    }
    if (qv > S1 - PRE) {
      stationPose(NSEC - 1, qv, pb)
      endPose(clamp((qv - S1) / (1 - S1)), out)
      camStation = NSEC - 1
      return blend(pb, out, smoother((qv - (S1 - PRE)) / (PRE + POST + 0.01)), out)
    }
    for (let i = 1; i < NSEC; i++) {
      if (qv > A[i] - PRE && qv < A[i] + POST) {
        const u = (qv - (A[i] - PRE)) / (PRE + POST)
        const t = smoother(u)
        stationPose(i - 1, qv, pb)
        stationPose(i, qv, out)
        camStation = i - 1 + t
        // into the last bin the camera settles low first, then trucks along: ref4's LP
        // over it comes in from the side below the top chrome, not down through it
        if (i === NSEC - 1) return blendLowFirst(pb, out, t, smoother(u * 2.4), out)
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
    const space = avail - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
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
          if (sd.root.offsetHeight > space + 1) {
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
    // (the bottom margin the old caption card took is kept: the framings were tuned inside it)
    const padB = short ? 46 : 64
    if (tall) region = { x0: P.left, x1: P.right, y0: P.top, y1: Math.max(P.top + 80, D.top - padB - 6) }
    else region = { x0: P.left, x1: Math.max(P.left + 120, D.left - 28), y0: P.top, y1: Math.max(P.top + 80, P.bottom - padB) }
    needFit = true
  }

  /** mark the panel row of the dish in hand (null: none) */
  function markRow(row: HTMLElement | null) {
    if (row === curRow) return
    curRow?.classList.remove('is-on')
    row?.classList.add('is-on')
    curRow = row
  }

  /** the section sleeve's record: in the sleeve while it turns, out beside it while the tracklist is up */
  function placeSectionRecord(rig: CrateRig) {
    const s = rig.s
    const out = outBack(seg(s, REC_OUT[0], REC_OUT[1])) * (1 - smoother(seg(s, REC_HOME[0], REC_HOME[1]))) * smoothstep(0.7, 0.97, rig.lift)
    const rec = rig.record
    const shown = out > 0.002
    if (shown) {
      const lab = rig.labels[0]
      if (lab && rec.uniforms.uLabel.value !== lab) rec.setLabel(lab)
      rec.group.scale.setScalar(1)
      rec.group.quaternion.copy(rig.held.q)
      rec.group.position.set(rig.slide * out, 0, 0).applyQuaternion(rig.held.q).add(rig.held.center)
    } else {
      // collapsed in its sleeve, the way the rig keeps it (it still draws: no program hitch)
      rec.group.scale.setScalar(1e-4)
      rec.group.position.set(0, -1, 0)
    }
    rig.recordShown = shown
    rig.out = shown ? out : 0
    rig.recordCenter.copy(rec.group.position)
  }

  // ---- the bins' art
  /** section i's tracklist (the section sleeve's back, and the fillers' shared back) */
  function trackList(i: number): TracklistSpec {
    const sec = PLAN[i].sec
    const tracks: Track[] = sec.items.map(d => ({ name: withMarks(d), value: d.price }))
    const notes = [sec.note, 'V vegetarian · GF gluten free'].filter(Boolean).join(' · ')
    return { title: sec.title, sub: SECTIONS.kitchen.title, cat: catNo(CAT0[i]), tracks, notes }
  }
  /**
   * Bin i's art, one texture per step (each step draws it and puts it in
   * place). Dish covers and the tracklist fill at most ~45% of the frame when
   * presented: 768 is ~1:1 at DPR 2 on desktop, 512 on phones (DPR ≤ 1.5).
   */
  function artSteps(i: number): (() => THREE.Texture)[] {
    const p = PLAN[i]
    const b = bins[i]
    const sec = p.sec
    const secCat = catNo(CAT0[i])
    const list = trackList(i)
    const big = phone ? 512 : 768
    const lab = phone ? 384 : 512
    return [
      () => {
        const t = tracklistTexture({ ...list, flip: true }, phone ? 384 : 512)
        b.backStack = t
        for (const d of b.dishSleeves) d.setBack(t)
        return t
      },
      () => {
        const t = coverTexture({ title: sec.title, kicker: `${SECTIONS.kitchen.eyebrow} · ${SECTIONS.kitchen.title}`, cat: secCat, paper: PAPERS[i] }, 512)
        b.secSleeve.setFront(t)
        return t
      },
      () => (b.backRead = tracklistTexture(list, big)),
      () => {
        const t = labelTexture({ title: sec.title, sub: SECTIONS.kitchen.title, side: 'SIDE A', cat: secCat, paper: PAPERS[i] === 'cream' ? 'red' : 'cream' }, lab)
        b.rig.labels[0] = t
        return t
      },
      ...p.dishes.flatMap((d, j) => {
        const cat = catNo(CAT0[i] + 1 + j)
        return [
          () => {
            const t = coverTexture({ title: d.name, kicker: `${sec.title} · ${d.price}`, sub: d.desc, cat, photoUrl: d.photo, eager: i === 0 && j === 0 }, big)
            b.dishSleeves[j].setFront(t)
            return t
          },
          () => {
            const t = labelTexture({ title: d.name, sub: d.desc.split(',')[0], side: 'SIDE A', cat, paper: LABEL_PAPERS[(i + j + 1) % LABEL_PAPERS.length] }, lab)
            b.rig.labels[j + 1] = t
            return t
          },
        ]
      }),
    ]
  }
  const idle = () =>
    new Promise<void>(r => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => r(), { timeout: 500 })
      else nextFrame().then(r)
    })

  return {
    id: 'kitchen',
    group,
    // each section lands on its section sleeve turned over (the tracklist up)
    anchors: PLAN.map((p, i) => A[i] + ((A[i + 1] - A[i]) * 0.5) / p.weight),
    busy: () => clock.busy || performance.now() < settleUntil,

    async init(ctx: ChapterContext) {
      phone = ctx.mobile
      // ---- the room: the long oiled bar, Glory's back bar behind it (room.ts)
      room = await makeKitchenRoom({ mobile: phone, x0: -16, x1: stationX(4) + 22, backBarX: 1.5, columnX: 18.3, pendantX0: -6.6, pendantStep: STEP })
      group.add(room.group)
      await nextFrame()

      // ---- a bin of sleeves per section (their art: artSteps, drawn below / after the reveal)
      for (const [i, p] of PLAN.entries()) {
        const sec = p.sec
        const crate = makeCrate({ depth: 1.0, legend: ['GLORY RECORDS · THE KITCHEN', sec.title.toUpperCase()] })
        crate.group.position.set(stationX(i), 0, 0)
        crate.group.rotation.y = CRATE_YAW
        group.add(crate.group)
        const secSleeve = makeSleeve({ back: BLANK, seed: i * 5.1 })
        const dishSleeves = p.dishes.map((_, j) => makeSleeve({ back: BLANK, seed: i * 5.1 + j * 1.7 + 1 }))
        // the background sleeves' atlas is small (one texture): drawn now
        const c0 = CAT0[i] + 1 + p.dishes.length
        const atlas = coverAtlas(
          p.rest.map((d, j) => ({ title: d.name, kicker: `${sec.title} · ${d.price}`, sub: d.desc, cat: catNo(c0 + j), paper: (['cream', 'bone', 'stout', 'amber'] as PaperName[])[(i + j) % 4] })),
          trackList(i),
          p.riffle ? 1024 : 512,
        )
        const rig = new CrateRig({
          crate,
          sleeves: [secSleeve, ...dishSleeves],
          // one record per bin, labelled when its art lands (no stand-in "Glory" label drawn per rig)
          record: makeRecord({ label: BLANK, seed: i * 2.3 + 0.7 }),
          labels: [],
          fillers: { count: p.rest.length, atlas },
          present: PRESENT,
          yaw: [4, -3, 5, -4],
          pitch: PRESENT_PITCH,
        })
        bins.push({ crate, rig, secSleeve, dishSleeves, backRead: BLANK, backStack: BLANK, turn: 0, item: -1, riffle: 0 })
        await nextFrame()
      }

      // ---- the first bins' art now (the intro frame), time-sliced so boot never blocks
      let t0 = performance.now()
      for (let i = 0; i < EAGER; i++)
        for (const step of artSteps(i)) {
          step()
          if (performance.now() - t0 > 10) {
            await nextFrame()
            t0 = performance.now()
          }
        }
      artDone = EAGER
      // …the rest once the story is revealed, in idle slices; each texture uploads as it lands
      void (async () => {
        await whenRevealed()
        for (let k = 0; k < 90 && !hurry; k++) await nextFrame()
        for (let i = EAGER; i < NSEC; i++) {
          for (const step of artSteps(i)) {
            await (hurry ? nextFrame() : idle())
            const tex = step()
            // (a texture's font/final redraws run as microtasks: upload in the next slice, once it's final)
            await (hurry ? nextFrame() : idle())
            ctx.renderer.initTexture(tex)
          }
          artDone = i + 1
        }
      })()

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
      // the fork lies across the plate's well, clear of its rising rim (audited: its lowest point sits on the glaze)
      const fork = makeFork(0.52)
      fork.rotation.y = 0.45
      fork.position.set(-0.248 * Math.cos(0.45), 0.066, 0.248 * Math.sin(0.45))
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
      // here before the deferred art landed (a direct link, a fast jump): finish it now
      if (artDone < NSEC) hurry = true
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
      w.spotColor = '#ffd6ae'
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
      // the room is built (kit/room): the backdrop only shows past its ends
      w.top = '#070505'
      w.bottom = '#050302'
      w.room = 0
      w.brick = 0
      w.bulbs = 0
      w.bokeh = 0
      w.cyc = 0.12
      w.cycColor = '#4a2616'
      w.cycX = tall ? 0 : -0.25
      w.cycY = 0.25
      w.haze = 0.08
      w.hazeColor = '#8a5028'
      w.envTurn = camX * 0.02
      room.set(1.1 * (0.85 + 0.15 * fade), 1)
      syncVinylLights(ctx.world)
      ctx.post.params.beer = 0.2

      // ---- the bins
      bins.forEach((b, i) => {
        const { item, riffle } = rigAt(i, q)
        if (Math.abs(item - b.item) > 1e-4 || Math.abs(riffle - b.riffle) > 1e-4) settleUntil = performance.now() + 1400
        b.item = item
        b.riffle = riffle
        b.rig.update(item, f, riffle)
        // the section sleeve turns over in hand to show its back (the tracklist), then back;
        // its record waits in the sleeve until it's over and is home before it turns back
        const rig = b.rig
        const held = rig.k === 0 && rig.lift > 0.0005
        const t = held ? smoothstep(TURN[0], TURN[1], rig.s) * (1 - smoothstep(TURN[2], TURN[3], rig.s)) : 0
        if (held) placeSectionRecord(rig)
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

      // the panel marks the row of the dish in hand (or face-out in the riffle), like the track playing
      let row: HTMLElement | null = null
      if (secOn && local < 0.95) {
        const b = bins[s]
        const p = PLAN[s]
        const rig = b.rig
        let d: Dish | undefined
        if (rig.k >= 1 && rig.s > RIG_PHASE.hudOn && rig.s < RIG_PHASE.hudOff) d = p.dishes[rig.k - 1]
        else if (p.riffle && b.item >= p.items) {
          const j = Math.floor(b.riffle)
          const fr = b.riffle - j
          if (j < p.rest.length && fr > 0.12 && fr < 0.88) d = p.rest[j]
        }
        if (d) row = secs[s].items[p.sec.items.indexOf(d)] ?? null
      }
      markRow(row)
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
