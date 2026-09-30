import * as THREE from 'three'
import './events.css'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { BRAND, EVENTS, EVENTS_UI, LINKS, PHOTOS, RESERVATIONS, SECTIONS, eventInquiryHref } from '../../content'
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

/*
 * EVENTS — "The Back Room".
 *
 * One long banquet table in Glory's dining room, set for a party: plates and
 * black napkins, stemware, bentwood chairs, bouquets, and three-taper
 * candelabra down a linen runner, flickering off into the dark under the
 * string lights. A party needs a record: across the head of the table a
 * sideboard carries a black deck playing a Glory record at 33⅓, a few Glory
 * sleeves leaning in a rack beside it. On the table lies the photo "album":
 * an open gatefold LP with a stack of lab prints on it — the dining room,
 * then the site's seven party photographs, counted like a tracklist.
 *
 *   0.00–0.06  cut in: a dolly over the deck, down the length of the table
 *   0.07–0.72  "Book an Event / Parties & Corporate Events" + the two body
 *              lines (copy column left; on top when stacked). Landing 0.1.
 *   0.13–0.23  the camera cranes up over the head of the table to the prints
 *   0.22–0.70  the album: the top print (the dining room) lifts and turns up
 *              to the camera; each next one follows while the last is laid on
 *              the gatefold's other panel — Track 1 / 7 … 7 / 7. Paced by a StoryClock (≤ 1.1 prints
 *              a second, each ≥ 0.9 s), cross-fades in place under reduced
 *              motion.
 *   0.71–0.80  the camera rises to a high three-quarter view: the deck and the
 *              album bottom left, the whole table running up behind the card
 *   0.78–0.96  the inquiry: a printed card listing the form's fields, with
 *              Event Inquiry Form (a pre-filled email to Dave) and Upcoming
 *              Events, and the note for parties of more than 10.
 *
 * Anchors (srContent): 0 the room (photos + copy) · 1 the inquiry.
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
  let prints: PrintStack
  let deck: Deck
  let stage: HTMLElement
  let root: HTMLElement
  let copy: HTMLElement
  let head: HTMLElement
  let scrim: HTMLElement
  let count: HTMLElement
  let countN: HTMLElement
  let cardWrap: HTMLElement
  let cardFx: HTMLElement
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
      table = makeBanquetTable(mobile)
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

      count = el('div', 'ev-count', undefined, root)
      count.append(document.createTextNode(`${EVENTS_UI.track} `))
      countN = el('b', '', '1', count)
      count.append(document.createTextNode(` / ${NE}`))

      cardWrap = el('div', 'ev-card-wrap', undefined, root)
      cardFx = el('div', 'ev-card-fx', undefined, cardWrap)
      const card = el('div', 'ev-card', undefined, cardFx)
      const ch = el('div', 'ev-card-head', undefined, card)
      const ct = el('div', '', undefined, ch)
      el('p', 'ev-card-brand', BRAND.name, ct)
      el('h3', 'ev-card-title', SECTIONS.events.eyebrow, ct)
      const stamp = el('img', 'ev-stamp', undefined, ch)
      stamp.src = BRAND.roundel
      stamp.alt = ''
      const ul = el('ul', 'ev-fields', undefined, card)
      EVENTS.fields.forEach((f, i) => {
        const li = el('li', i === EVENTS.fields.length - 1 ? 'is-tall' : '', undefined, ul)
        el('span', 'ev-n', String(i + 1).padStart(2, '0'), li)
        el('span', '', f, li)
      })
      el('p', 'ev-req', EVENTS_UI.required, card)
      const btns = el('div', 'ev-btns', undefined, card)
      const a1 = el('a', 'hud-btn', EVENTS.cta, btns)
      a1.href = eventInquiryHref()
      const a2 = el('a', 'hud-btn hud-btn--ghost', LINKS.events.label, btns)
      a2.href = LINKS.events.url
      a2.target = '_blank'
      a2.rel = 'noopener'
      el('p', 'ev-large', RESERVATIONS.large, card)

      probe = el('div', 'ev-probe', undefined, root)
      reveal(copy, 0)
      reveal(cardFx, 0)
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
        L.intensity = (i === 0 ? 2.6 : 2.2) * fl
      })

      // ---- DOM
      const copyV = smoothstep(COPY_IN[0], COPY_IN[1], local) * (1 - smoothstep(COPY_OUT[0], COPY_OUT[1], local))
      reveal(copy, copyV)
      reveal(scrim, Math.max(copyV, 0.0), 0)
      setRise(head, local > 0.045 && local < 0.72)
      const cardV = smoothstep(CARD_IN[0], CARD_IN[1], local) * (1 - smoothstep(CARD_OUT[0], CARD_OUT[1], local))
      reveal(cardFx, cardV, 18)
      cardWrap.style.visibility = cardV < 0.002 ? 'hidden' : 'visible'

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

      // ---- light: the bar after dark, candles and the string lights overhead
      const w = ctx.world.params
      const room = smoothstep(TO_ROOM[0], TO_ROOM[1], local)
      w.brick = 0.42
      w.bulbs = 0.75
      w.bulbColor = GEL.bulb
      w.bokeh = 0.4
      w.bokehA = GEL.candle
      w.bokehB = GEL.amber
      w.haze = 0.22
      w.hazeColor = '#9a5a2e'
      w.hazeY = 0.05
      w.cyc = 0.32
      w.cycColor = '#5a2a18'
      w.cycX = stacked(W, H) ? 0 : 0.2
      w.cycY = 0.1
      // the key: over the deck and the album at the head (intro), onto the prints (album), the whole head (room)
      const onPrints = smoothstep(TO_PRINTS[0], TO_PRINTS[1], local) * (1 - room)
      const intro = 1 - Math.max(onPrints, room)
      w.spot = 0.34 * intro + 0.22 * onPrints + 0.3 * room
      w.spotColor = GEL.tungsten
      w.spotPos.set(2.6 * intro + 1.4 * onPrints + 3.2 * room, 7.5 * intro + 6.5 * onPrints + 8.5 * room, 8.2 * intro + 4.6 * onPrints + 7.5 * room)
      w.spotAt.set(0.9 * intro + 0.0 * onPrints + 0.6 * room, 0.2, 3.2 * intro + 1.7 * onPrints + 2.4 * room)
      w.spotAngle = 0.5 * intro + 0.36 * onPrints + 0.5 * room
      w.spotPenumbra = 0.7
      w.rimA = 0.9
      w.rimAColor = GEL.candle
      w.rimADir.set(-0.5, 0.45, -1)
      w.rimB = 0.35
      w.rimBColor = GEL.dusk
      w.rimBDir.set(0.9, 0.3, -1)
      w.fill = 0.06
      w.env = 0.85

      syncVinylLights(ctx.world)

      const p = ctx.post.params
      p.beer = 0.35
      p.bloomStrength = 0.42
      p.warmth = 0.55
      p.vignette = 0.38
    },

    camera(local, frame: Frame, out: CameraPose) {
      const W = frame.width
      const H = frame.height
      const st = stacked(W, H)
      const sl = shortLand(W, H)
      const calm = frame.reducedMotion
      const ow = lay.W > 1 ? W / lay.W : 1

      // A: low at the head of the table, looking down its length
      const dolly = calm ? 0.5 : smoothstep(0, 0.2, local)
      if (st) {
        A.pos.set(2.2, 3.0, lerp(10.9, 10.4, dolly))
        A.tgt.set(-0.2, 1.3, -3)
        A.fov = 50
      } else {
        // over the deck on the sideboard, down the length of the table
        A.pos.set(lerp(2.25, 2.05, dolly), 2.5, lerp(9.3, 8.8, dolly))
        A.tgt.set(-0.6, 0.25, -3)
        A.fov = sl ? 40 : 36
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

      // C: high three-quarter view of the whole table for the inquiry
      if (st) {
        Cp.pos.set(3.4, 5.4, 12.5)
        Cp.tgt.set(0.2, -0.6, -2)
        Cp.fov = 50
      } else {
        // high three-quarter: the deck and the album bottom left, the table running up behind the card
        Cp.pos.set(4.35, 4.6, 10.1)
        Cp.tgt.set(-0.25, -0.3, -3.9)
        Cp.fov = sl ? 40 : 36
      }
      if (!calm) Cp.pos.x -= 0.3 * smoothstep(TO_ROOM[1], 1, local)

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
