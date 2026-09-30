import * as THREE from 'three'
import './events.css'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { EVENTS, EVENTS_UI, LINKS, PHOTOS, SECTIONS } from '../../content'
import { clamp, lerp, smoothstep } from '../../core/math'
import { el, reveal, rise, setRise } from '../../core/dom'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { whenRevealed } from '../../kit/images'
import { GEL } from '../../world/World'
import { makeBanquetTable, type BanquetTable } from './table'
import { makePrints, loadPhoto, type PrintStack } from './prints'
import { makeDeck, GATEFOLD, K, type Deck } from './deck'
import { syncVinylLights } from '../../kit/vinyl'
import { makeDiningRoom, type DiningRoom } from './room'
import { dockEventForm, type EventFormDock } from '../../ui/eventForm'

/*
 * EVENTS — "The Back Room".
 *
 * One long banquet table set for a party down the middle of GLORY'S DINING
 * ROOM (room.ts, from the room kit and Mike's photos): reclaimed walnut
 * walls and boxy clad columns with wire-cage sconces, shelves packed with
 * LPs, the chalk tap boards on black, an exposed-brick accent panel, a Glory
 * LP face-out on a steel ledge; the black ceiling with the silver flex duct
 * and a galvanized trunk, wire-cage pendants over the table; the honey oak
 * floor; and at the far end the back bar itself ("Old 1837" on the brick,
 * LPs over spouted liquor steps) behind the long oiled bar and its stools.
 * A party needs a record: across the head of the table a sideboard carries a
 * black deck playing a Glory record at 33⅓ and a walnut rack of three Glory
 * sleeves (posed exactly: no clipping). On the table lies the photo "album":
 * an open gatefold LP with lab prints — the dining room, then the site's
 * seven party photographs, counted like a tracklist.
 *
 *   0.00–0.06  cut in: a dolly over the deck, down the room to the back bar
 *   0.07–0.72  "Book an Event / Parties & Corporate Events", the two body
 *              lines and Upcoming Events (copy column left; on top when
 *              stacked). Landing 0.1.
 *   0.13–0.23  the camera cranes up over the head of the table to the prints
 *   0.22–0.70  the album: the top print lifts and turns up to the camera;
 *              each next one follows while the last is laid on the
 *              gatefold's other panel — Track 1 / 7 … 7 / 7. Paced by a
 *              StoryClock (≤ 1.1 prints a second), cross-fades under reduced
 *              motion.
 *   0.71–0.80  the camera rises and turns down the room to the back bar
 *   0.77–0.975 THE FORM: the real Event Inquiry Form (src/ui/eventForm.ts)
 *              docked over the scene beside the room view (on phones it is
 *              the card over the room). It lives in #events' accessible
 *              section (srContent), never in this aria-hidden stage: Tab
 *              reaches it in story order and focusing it lands the story on
 *              0.86; it stays up while a field has focus.
 *
 * Anchors (srContent): 0 the room (photos + copy) · 1 the inquiry (the form).
 */

/** photo aspects (w / h) of the files, so the prints are the right shape before they load */
const ASPECT: Record<string, number> = {
  [PHOTOS.diningRoom]: 1600 / 1067,
  'photos/event-1.webp': 1162 / 1600,
  'photos/event-2.webp': 1600 / 1200,
  'photos/event-3.webp': 1085 / 1600,
  'photos/event-4.webp': 1600 / 1200,
  'photos/event-5.webp': 1280 / 1600,
  'photos/event-6.webp': 1200 / 1600,
  'photos/event-7.webp': 750 / 928,
}
const URLS = [PHOTOS.diningRoom, ...EVENTS.photos]
const NP = URLS.length
const NE = EVENTS.photos.length

// ---- timeline
const COPY_IN = [0.05, 0.085] as const
const COPY_OUT = [0.695, 0.725] as const
const TO_PRINTS = [0.125, 0.235] as const
const ALBUM = [0.22, 0.7] as const
const TO_ROOM = [0.71, 0.8] as const
const CARD_IN = [0.77, 0.805] as const
const CARD_OUT = [0.95, 0.975] as const

// ---- the head of the table
const AT = {
  // the prints lie on the open gatefold: the stack on its right panel, the pile on its left
  stack: new THREE.Vector3(GATEFOLD.spine + K / 2, GATEFOLD.t, GATEFOLD.z),
  pile: new THREE.Vector3(GATEFOLD.spine - K / 2, GATEFOLD.t, GATEFOLD.z - 0.04),
  present: new THREE.Vector3(-0.02, 0.5, 2.0),
}

const DEG = Math.PI / 180

interface Pose {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
}
const pose = (): Pose => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 35 })

const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const _d = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Place a camera looking along `dir` so a subject (w × h in the view plane,
 * centred at C) fills the screen region (px) `reg`.
 */
function frameTo(out: Pose, C: THREE.Vector3, dir: THREE.Vector3, w: number, h: number, reg: { x0: number; x1: number; y0: number; y1: number }, W: number, H: number, fov: number) {
  const aspect = W / H
  const tanH = Math.tan((fov * DEG) / 2)
  const fw = Math.max(0.1, (reg.x1 - reg.x0) / W)
  const fh = Math.max(0.1, (reg.y1 - reg.y0) / H)
  const cx = ((reg.x0 + reg.x1) / 2 / W) * 2 - 1
  const cy = 1 - ((reg.y0 + reg.y1) / 2 / H) * 2
  const dist = Math.max(w / 2 / (fw * tanH * aspect), h / 2 / (fh * tanH))
  const hh = dist * tanH
  const hw = hh * aspect
  _d.copy(dir).normalize()
  _r.crossVectors(_d, UP).normalize()
  _u.crossVectors(_r, _d).normalize()
  out.tgt.copy(C).addScaledVector(_r, -cx * hw).addScaledVector(_u, -cy * hh)
  out.pos.copy(out.tgt).addScaledVector(_d, -dist)
  out.fov = fov
  return out
}

function blend(a: Pose, b: Pose, t: number, out: Pose) {
  out.pos.lerpVectors(a.pos, b.pos, t)
  out.tgt.lerpVectors(a.tgt, b.tgt, t)
  out.fov = lerp(a.fov, b.fov, t)
  return out
}

export default function events(): Chapter {
  const group = new THREE.Group()
  let table: BanquetTable
  let dining: DiningRoom
  let prints: PrintStack
  let deck: Deck
  let stage: HTMLElement
  let root: HTMLElement
  let copy: HTMLElement
  let head: HTMLElement
  let scrim: HTMLElement
  let count: HTMLElement
  let countN: HTMLElement
  /** the REAL Event Inquiry Form (src/ui/eventForm.ts), docked over the scene from #events' accessible section */
  let inquiry: EventFormDock | null = null
  let probe: HTMLElement
  let mobile = false

  // measured layout (px), refreshed on resize — never read layout per frame
  const lay = { copyL: 0, copyR: 0, copyB: 0, safeTop: 90, safeBottom: 90, gutter: 24, W: 1, H: 1 }
  const measure = () => {
    if (!copy) return
    lay.copyL = copy.offsetLeft
    lay.copyR = copy.offsetLeft + copy.offsetWidth
    lay.copyB = copy.offsetTop + copy.offsetHeight
    lay.safeBottom = probe.offsetHeight
    lay.safeTop = parseFloat(getComputedStyle(copy).top) || 90
    lay.gutter = copy.offsetLeft
    lay.W = root.clientWidth || window.innerWidth
    lay.H = root.clientHeight || window.innerHeight
  }

  // time-paced album: u = 0..NP-1 prints, ≤ 1.1 prints a second
  const clock = new StoryClock({ rate: 1.1, snap: 1.4 })
  let uc = 0

  const A = pose()
  const B = pose()
  const Cp = pose()
  const tmp = pose()
  const tmp2 = pose()
  const _p = new THREE.Vector3()
  const dirB = new THREE.Vector3()

  const stacked = (W: number, H: number) => W < 760 || H >= W
  const shortLand = (W: number, H: number) => W > H && H <= 500

  /** the album state: hold on each print, turn in the latter part of its slot */
  const stateOf = (u: number) => {
    const k = Math.floor(u)
    if (k >= NP - 1) return NP - 1
    return k + smoothstep(0.42, 0.95, u - k)
  }

  return {
    id: 'events',
    group,
    anchors: [0.1, 0.86],
    busy: () => clock.busy,

    async init(ctx: ChapterContext) {
      mobile = ctx.mobile
      stage = ctx.stage
      dining = await makeDiningRoom(mobile)
      group.add(dining.group)
      table = makeBanquetTable(mobile, m => dining.litByPendants(m))
      group.add(table.group)
      await nextFrame()
      deck = makeDeck(mobile)
      group.add(deck.group)
      await nextFrame()
      prints = makePrints(
        URLS.map(url => ({ url, aspect: ASPECT[url] ?? 1 })),
        AT,
      )
      group.add(prints.group)
      // their own env (so envMapIntensity counts): a soft sheen, never a veil over the photo
      for (const pr of prints.prints) {
        const pm = pr.photo.material as THREE.MeshStandardMaterial
        pm.envMap = ctx.world.envMap
        pm.envMapIntensity = 0.28
        const cm = pr.card.material as THREE.MeshStandardMaterial
        cm.envMap = ctx.world.envMap
        cm.envMapIntensity = 0.45
      }

      // ---- DOM
      root = el('div', 'ev', undefined, stage)
      scrim = el('div', 'ev-scrim', undefined, root)
      copy = el('div', 'ev-copy', undefined, root)
      el('p', 'hud-eyebrow', SECTIONS.events.eyebrow, copy)
      const words = EVENTS.title.split(' ')
      const last = words.pop()!
      head = rise(el('h2', 'hud-h2', undefined, copy), `${words.join(' ')} <em>${last}</em>`)
      const body = el('div', 'ev-body', undefined, copy)
      for (const b of EVENTS.body) el('p', 'hud-body', b, body)
      // Upcoming Events (mouse/touch; keyboard reaches the same link in the accessible copy)
      const up = el('a', 'hud-btn hud-btn--ghost ev-upcoming', undefined, copy)
      up.href = LINKS.events.url
      up.target = '_blank'
      up.rel = 'noopener'
      up.append(document.createTextNode(LINKS.events.label))
      el('span', 'ev-arrow', '↗', up).setAttribute('aria-hidden', 'true')

      count = el('div', 'ev-count', undefined, root)
      count.append(document.createTextNode(`${EVENTS_UI.track} `))
      countN = el('b', '', '1', count)
      count.append(document.createTextNode(` / ${NE}`))

      // the form itself lives in #events' accessible section (srContent: [data-event-form]),
      // never in this aria-hidden stage: dock it over the scene for the inquiry beat
      const mount = document.querySelector<HTMLElement>('#events [data-event-form]')
      if (mount) inquiry = dockEventForm(mount)

      probe = el('div', 'ev-probe', undefined, root)
      reveal(copy, 0)
      reveal(count, 0, 0)
      reveal(scrim, 0, 0)

      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(copy)
      window.addEventListener('resize', measure)
      requestAnimationFrame(measure)
      document.fonts?.ready.then(measure)

      // photos: the cover now, the party prints once the site is revealed
      const width = mobile ? 768 : 1024
      loadPhoto(URLS[0], width)
        .then(t => prints.setTexture(0, t))
        .catch(() => {})
      whenRevealed().then(async () => {
        for (let i = 1; i < NP; i++) {
          try {
            prints.setTexture(i, await loadPhoto(URLS[i], width))
          } catch {
            /* keep the blank print */
          }
          await nextFrame()
        }
      })
    },

    onEnter() {
      clock.reset()
      measure()
    },

    onLeave() {
      inquiry?.set(0)
    },

    update(local, frame: Frame, ctx: ChapterContext) {
      const reduced = frame.reducedMotion
      const W = frame.width
      const H = frame.height

      // ---- album state from the paced clock
      const uTarget = clamp((local - ALBUM[0]) / (ALBUM[1] - ALBUM[0])) * (NP - 1)
      uc = clock.update(uTarget, frame.dt)
      const s = stateOf(uc)
      prints.update(s, reduced)

      // ---- candles: gentle, time-based flicker (calmer under reduced motion)
      const amp = reduced ? 0.35 : 1
      table.update(frame.time, amp)
      deck.update(frame)
      const t = frame.time
      table.lights.forEach((L, i) => {
        const fl = 1 + amp * (0.05 * Math.sin(t * 4.1 + i * 2.3) + 0.03 * Math.sin(t * 7.3 + i * 5.1))
        L.intensity = (i === 0 ? 1.3 : 1.1) * fl
      })

      // ---- DOM
      // the form beat; while a field has focus the form stays up (a phone keyboard may nudge
      // the page) unless the visitor has clearly scrolled back into the story
      const hold = !!inquiry?.active && local > 0.6
      const formV = hold ? 1 : smoothstep(CARD_IN[0], CARD_IN[1], local) * (1 - smoothstep(CARD_OUT[0], CARD_OUT[1], local))
      inquiry?.set(formV)
      const copyV = hold ? 0 : smoothstep(COPY_IN[0], COPY_IN[1], local) * (1 - smoothstep(COPY_OUT[0], COPY_OUT[1], local))
      reveal(copy, copyV)
      reveal(scrim, copyV, 0)
      setRise(head, !hold && local > 0.045 && local < 0.72)

      // the count: shown while a party print is presented and settled
      const k = Math.round(s)
      const settle = 1 - clamp(Math.abs(s - k) * 5)
      const inAlbum = smoothstep(ALBUM[0] - 0.01, ALBUM[0] + 0.02, local) * (1 - smoothstep(COPY_OUT[0], COPY_OUT[1], local))
      const cv = k >= 1 ? settle * inAlbum : 0
      if (cv > 0.002) {
        const txt = String(k)
        if (countN.textContent !== txt) countN.textContent = txt
        // under the presented print's lower edge (last frame's camera: one frame of lag is invisible)
        const pr = prints.prints[k]
        const e = pr.h / 2 + 0.07
        _p.set(AT.present.x, AT.present.y - Math.sin(prints.tilt) * e, AT.present.z + Math.cos(prints.tilt) * e)
        _p.project(ctx.camera)
        const x = (_p.x * 0.5 + 0.5) * W
        const y = (-_p.y * 0.5 + 0.5) * H
        if (Number.isFinite(x) && Number.isFinite(y)) count.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateX(-50%)`
      }
      reveal(count, cv, 0)

      // ---- light: Glory after dark — the room's Edison sconces and pendants (kit pools), candles, one key
      const w = ctx.world.params
      const room = smoothstep(TO_ROOM[0], TO_ROOM[1], local)
      dining.setGlow(1)
      dining.setAmbient(0.5)
      // the real room is built around the table: the backdrop's own room only fills the gaps
      w.brick = 0
      w.room = 0.4
      w.bulbs = 0
      w.bokeh = 0.12
      w.bokehA = GEL.candle
      w.bokehB = GEL.amber
      w.haze = 0.1
      w.hazeColor = '#9a5a2e'
      w.hazeY = 0.2
      w.cyc = 0
      // the key (the only shadow caster): straight down from the head of the table onto the deck and
      // the album (a pendant's pool, sharpened), then down the room over the far table for the form
      const toPrints = smoothstep(TO_PRINTS[0], TO_PRINTS[1], local)
      const wI = (1 - toPrints) * (1 - room)
      const wP = toPrints * (1 - room)
      const wR = room
      w.spot = 0.36 * wI + 0.26 * wP + 0.2 * wR
      w.spotColor = GEL.tungsten
      // (always under the ceiling's joists and between the two ducts)
      w.spotPos.set(1.3 * wI + 1.2 * wP + 1.5 * wR, 9.0 * wI + 7.5 * wP + 9.0 * wR, 5.4 * wI + 4.0 * wP - 12 * wR)
      w.spotAt.set(0.6 * wI + 0.0 * wP + 0.0 * wR, 0.2, 3.0 * wI + 1.7 * wP - 19 * wR)
      w.spotAngle = 0.3 * wI + 0.32 * wP + 0.4 * wR
      w.spotPenumbra = 0.75
      // the rims make the rosé glasses and the prints glow; kept low — on the room's big floor and
      // walls a directional rim is a flood (the sconces and pendants light the room)
      w.rimA = 0.14 + 0.16 * wP
      w.rimAColor = GEL.bulb
      w.rimADir.set(-0.5, 0.45, -1)
      w.rimB = 0.1 + 0.12 * wP
      w.rimBColor = GEL.dusk
      w.rimBDir.set(0.9, 0.3, -1)
      w.fill = 0.05
      w.env = 0.85

      syncVinylLights(ctx.world)

      const p = ctx.post.params
      p.beer = 0.35
      p.bloomStrength = 0.42
      p.warmth = 0.2
      p.saturation = 0.95
      p.vignette = 0.34
    },

    camera(local, frame: Frame, out: CameraPose) {
      const W = frame.width
      const H = frame.height
      const st = stacked(W, H)
      const sl = shortLand(W, H)
      const calm = frame.reducedMotion
      const ow = lay.W > 1 ? W / lay.W : 1

      // A: low over the deck at the head of the table, looking down Glory's dining room to the
      // back bar at its far end (pendants, duct, walnut and records on the walls)
      const dolly = calm ? 0.5 : smoothstep(0, 0.2, local)
      if (st) {
        // nearly level: the back bar sits just under the copy, the table runs down to the deck
        A.pos.set(2.1, 3.2, lerp(11.6, 11.0, dolly))
        A.tgt.set(-0.5, 2.5, -14)
        A.fov = 54
      } else {
        A.pos.set(lerp(2.5, 2.25, dolly), 2.35, lerp(10.6, 9.9, dolly))
        A.tgt.set(-0.9, 1.45, -20)
        A.fov = sl ? 44 : 40
      }

      // B: over the prints, the presented print framed in the free region
      const s = stateOf(uc)
      const drift = calm ? 0 : s / (NP - 1)
      dirB.set(lerp(-0.1, 0.06, drift), -0.6, -1)
      const pr = prints ? prints.prints[clamp(Math.round(s), 0, NP - 1)] : { w: 1.1, h: 1.1 }
      const sw = Math.max(1.25, pr.w + 0.2)
      const sh = Math.max(1.15, pr.h * 0.92 + 0.35)
      const sT = lay.safeTop / ow
      const sB = lay.safeBottom / ow
      let reg
      if (st) {
        const top = Math.max(lay.copyB / ow + 18, H * 0.4)
        reg = { x0: 12, x1: W - 12, y0: top, y1: H - sB - 34 }
      } else {
        reg = { x0: lay.copyR / ow + W * 0.04, x1: W - lay.gutter / ow, y0: sT, y1: H - sB - 30 }
      }
      frameTo(B, AT.present, dirB, sw, sh, reg, W, H, st ? 40 : 34)
      if (!calm) B.pos.addScaledVector(dirB.normalize(), 0.12 * drift)

      // C: the inquiry — risen over the table and turned down the room: the party set all the
      // way to the back bar ("Old 1837", the LPs, the sconces), in the free space beside the form
      if (st) {
        Cp.pos.set(1.3, 4.1, 1.2)
        Cp.tgt.set(3.6, 3.1, -46)
        Cp.fov = 56
      } else {
        Cp.pos.set(2.6, 4.7, 2.0)
        Cp.tgt.set(9.6, 2.9, -46)
        Cp.fov = sl ? 46 : 42
      }
      if (!calm) Cp.pos.z -= 0.9 * smoothstep(TO_ROOM[1], 1, local)

      const ab = smoothstep(TO_PRINTS[0], TO_PRINTS[1], local)
      const bc = smoothstep(TO_ROOM[0], TO_ROOM[1], local)
      blend(A, B, ab, tmp)
      blend(tmp, Cp, bc, tmp2)
      out.position.copy(tmp2.pos)
      out.target.copy(tmp2.tgt)
      out.fov = tmp2.fov
      out.roll = 0
      out.parallax = calm ? 0 : 0.06
    },
  }
}
