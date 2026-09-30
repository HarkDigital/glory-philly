import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { BRAND, CREDIT, HOURS, KITCHEN_HOURS, LINKS, RESERVATIONS, SECTIONS, SOCIALS, VISIT_UI } from '../../content'
import { makeGlass, BEERS } from '../../kit/beer'
import { makeBarTop } from '../../kit/bar'
import { WIN, SIGN, STREET_Z, drawSign, makeCoaster, makeSign, makeStreet, makeVotive, makeWall, makeWindow } from './scene'
import './visit.css'

/*
 * LAST CALL (visit) — the site's ending. 1.8 vh, lands at 0.3.
 *
 * The front of the house at night, from inside: Glory's tall black-framed
 * window onto cobbled Chestnut Street (warm brick facades out of focus, a
 * lantern, a shop window, now and then a car's lights sliding past), the
 * painted wall sign on the brick beside it, and on the sill a last pint on a
 * G-roundel coaster next to a votive. The copy is a clean "last call" card:
 * phone and address first, bar + kitchen hours, reservations, the rest of
 * the ways in, socials, the footer and Back to top.
 *
 *   0.00–0.10  under the pour cut: tight on the sill, the pint sliding in
 *   0.07–0.24  the pint slides along the sill and settles (damped, from local)
 *   0.00–0.34  the camera pulls back and up to the whole window + sign
 *   0.08–0.20  the card: eyebrow + headline rise, then its blocks in order
 *   0.34–1.00  hold. Nothing moves but light: the votive, the street, a car.
 *
 * It's the last chapter: no out-cut, it holds to the end of the page.
 */

const DOLLY_END = 0.34
/** where the pint lands on the sill */
const PINT = new THREE.Vector3(1.95, WIN.y0, 0.42)

/**
 * Where a turntable can sit (the vinyl follow-up): world position of the deck's
 * base centre, its yaw, and the console-top height it stands on. Keep the
 * deck within ~1.6 wide x 1.2 deep; the camera fit already includes this spot.
 */
export const DECK = { position: new THREE.Vector3(-0.75, WIN.y0, 0.75), yaw: 0.18, top: WIN.y0 }

/** a damped settle 0..1 (overshoots once, lands dead still at t = 1) */
function settle(t: number) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const s = 1 - Math.exp(-5.2 * t) * Math.cos(7.2 * t)
  // blend to exactly 1 at the end so nothing creeps after the beat
  return lerp(s, 1, smoothstep(0.7, 1, t))
}

/** group identical consecutive bar hours: Mon – Wed / Thu – Sun */
function groupedHours() {
  const out: { day: string; hours: string }[] = []
  let from = ''
  let to = ''
  let cur = ''
  const flush = () => {
    if (!from) return
    const a = from.slice(0, 3)
    const b = to.slice(0, 3)
    out.push({ day: a === b ? a : `${a} – ${b}`, hours: cur })
  }
  for (const h of HOURS) {
    if (h.hours === cur) to = h.day
    else {
      flush()
      from = to = h.day
      cur = h.hours
    }
  }
  flush()
  return out
}

/** "4pm - 2am" / "4pm-9pm" → "4pm – 2am" (typographic dash only) */
const dash = (s: string) => s.replace(/\s*-\s*/g, ' – ')

const ARROW = `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 L9 3 M4.2 3 H9 V7.8"/></svg>`
const UP = `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 10 V2.4 M2.6 5.6 L6 2.2 L9.4 5.6"/></svg>`

function ext(parent: HTMLElement, cls: string, href: string, html: string) {
  const a = el('a', cls, undefined, parent)
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener'
  a.innerHTML = html
  return a
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let reduced = false

  // ---- set ----------------------------------------------------------------
  const wall = makeWall()
  const win = makeWindow()
  const street = makeStreet()
  const sign = makeSign()
  const sill = makeBarTop({ length: WIN.x1 - WIN.x0 + 0.5, depth: 1.05, thickness: 0.14 })
  sill.position.set((WIN.x0 + WIN.x1) / 2, WIN.y0, 0.18)
  {
    // a worn, oiled sill: a softer sheen than the bar top, so the rims from the
    // street don't mirror off it as one big glare
    const m = sill.material as THREE.MeshPhysicalMaterial
    m.clearcoat = 0.08
    m.clearcoatRoughness = 0.6
    m.roughness = 0.7
    m.specularIntensity = 0.25
  }
  const pint = makeGlass({ shape: 'pint', beer: BEERS.gold, scale: 1.45, fill: 0.93, head: 0.09 })
  const coaster = makeCoaster(BRAND.roundel)
  const votive = makeVotive()
  votive.group.position.set(3.55, WIN.y0, 0.42)
  votive.group.scale.setScalar(1.25)
  group.add(wall, win.group, street.mesh, sign.mesh, sill, pint.group, coaster, votive.group)

  // VINYL HOOK (follow-up): the last record of the night. A turntable from
  // src/kit/vinyl/ goes in `deckSlot` — on a low black console against the
  // brick, under the sign and just left of the window, deck top at DECK.top.
  // Plan: the platter winds down 0.10–0.34 with the dolly (derived from
  // local, calm, no flashing), the tonearm lifts and parks by ~0.3, then it
  // holds still to the end; the card can read as a sleeve back (Side A: Hours,
  // Side B: Visit). Empty until the kit lands; nothing here renders.
  const deckSlot = new THREE.Group()
  deckSlot.name = 'visit-deck-slot'
  deckSlot.position.copy(DECK.position)
  deckSlot.rotation.y = DECK.yaw
  group.add(deckSlot)

  // two practical lights of our own (intensity-driven, never toggled): the
  // votive's glow on the sill, and the street's spill through the window
  const candle = new THREE.PointLight('#ff9a3c', 0, 3, 2)
  candle.position.set(3.55, WIN.y0 + 0.7, 0.55)
  const spill = new THREE.PointLight('#ffb869', 0, 14, 1.6)
  spill.position.set(2.5, 4.2, -2.4)
  // a pendant over the sill: the pint's key (warm, from above and in front)
  const pendant = new THREE.PointLight('#ffd3a0', 0, 6, 2)
  pendant.position.set(PINT.x + 0.2, WIN.y0 + 2.2, 1.3)
  group.add(candle, spill, pendant)

  // ---- HUD ----------------------------------------------------------------
  const hud = {} as {
    card: HTMLElement
    head: HTMLElement
    title: HTMLElement
    blocks: HTMLElement[]
  }
  // the free part of the screen for the scene, in 0..1 fractions (measured from the card)
  const free = { x0: 0.42, x1: 1, y0: 0, y1: 1, portrait: false }
  let measureCard = () => {}

  function buildHud(stage: HTMLElement) {
    const wrap = el('div', 'vs-wrap', undefined, stage)
    const card = el('div', 'vs-card hud-panel', undefined, wrap)
    hud.card = card
    hud.blocks = []
    const block = (cls: string) => {
      const b = el('div', `vs-block ${cls}`, undefined, card)
      b.style.setProperty('--d', String(hud.blocks.length))
      hud.blocks.push(b)
      return b
    }

    // headline
    const head = el('div', 'vs-head', undefined, card)
    hud.head = head
    const eyebrow = el('p', 'hud-eyebrow vs-eyebrow', SECTIONS.visit.eyebrow, head)
    void eyebrow
    const t = SECTIONS.visit.title
    const lastSpace = t.lastIndexOf(' ')
    hud.title = rise(el('h2', 'hud-h2 vs-title', undefined, head), `${t.slice(0, lastSpace)} <em>${t.slice(lastSpace + 1)}</em>`)
    const stamp = el('img', 'vs-stamp', undefined, head)
    stamp.src = BRAND.roundel
    stamp.alt = ''
    stamp.width = stamp.height = 60

    // phone + address (+ email)
    const reach = block('vs-reach')
    const phone = el('a', 'vs-phone', BRAND.phone, reach)
    phone.href = BRAND.phoneHref
    ext(reach, 'vs-addr', BRAND.mapUrl, `<span>${BRAND.street}, ${BRAND.city}</span>${ARROW}`)
    const mail = el('a', 'vs-mail', BRAND.email, reach)
    mail.href = `mailto:${BRAND.email}`

    // hours: bar + kitchen, side by side
    const hours = block('vs-hours')
    const table = (title: string, rows: { day: string; hours: string }[], cls: string) => {
      const col = el('div', `vs-hcol ${cls}`, undefined, hours)
      el('h3', 'vs-hlabel', title, col)
      const dl = el('dl', 'vs-hrows', undefined, col)
      for (const r of rows) {
        const row = el('div', 'vs-hrow', undefined, dl)
        el('dt', '', r.day, row)
        el('dd', '', dash(r.hours), row)
      }
      return col
    }
    table(VISIT_UI.barHours, HOURS, 'vs-bar vs-bar-full')
    table(VISIT_UI.barHours, groupedHours(), 'vs-bar vs-bar-short')
    table(VISIT_UI.kitchenHours, KITCHEN_HOURS, 'vs-kitchen')

    // reservations + the other ways in
    const ctas = block('vs-ctas')
    ext(ctas, 'hud-btn vs-reserve', LINKS.reserve.url, `<span>${LINKS.reserve.label}</span>${ARROW}`)
    const more = el('div', 'vs-more', undefined, ctas)
    for (const [label, url] of [
      [VISIT_UI.order, LINKS.order.url],
      [VISIT_UI.giftCards, LINKS.giftCards.url],
      [VISIT_UI.app, LINKS.app.url],
      [VISIT_UI.untappd, LINKS.untappd.url],
    ]) {
      const a = ext(more, 'hud-btn hud-btn--ghost vs-sub', url, `<span>${label}</span>${ARROW}`)
      a.title = label
    }
    const note = el('p', 'vs-note', undefined, ctas)
    // the large-party note, with Dave's address as a mail link
    const i = RESERVATIONS.large.indexOf(RESERVATIONS.email)
    if (i >= 0) {
      note.append(RESERVATIONS.large.slice(0, i))
      const m = el('a', '', RESERVATIONS.email, note)
      m.href = `mailto:${RESERVATIONS.email}`
      note.append(RESERVATIONS.large.slice(i + RESERVATIONS.email.length))
    } else note.textContent = RESERVATIONS.large

    // socials
    const social = block('vs-social')
    for (const s of SOCIALS) {
      // a handle that's just the brand's name reads better as the network's name
      const html = s.handle === BRAND.name ? `<span class="vs-soc-handle">${s.name}</span>` : `<span class="vs-soc-name">${s.name}</span><span class="vs-soc-handle">${s.handle}</span>`
      ext(social, 'vs-soc', s.url, html)
    }

    // footer + back to top
    const foot = block('vs-foot')
    const fl = el('p', 'vs-legal', undefined, foot)
    fl.append(`© ${new Date().getFullYear()} ${BRAND.name} · `)
    ext(fl, 'vs-credit', CREDIT.url, CREDIT.text)
    const top = el('button', 'vs-top', undefined, foot)
    top.type = 'button'
    top.innerHTML = `<span>${VISIT_UI.backToTop}</span>${UP}`
    top.addEventListener('click', () => window.__hark?.land('hero'))

    // measure where the card is (layout reads only on resize, never per frame)
    measureCard = () => {
      const r = card.getBoundingClientRect()
      const W = window.innerWidth
      const H = window.innerHeight
      if (!W || !H || !r.width) return
      free.portrait = r.width > W * 0.72
      if (free.portrait) {
        free.x0 = 0
        free.x1 = 1
        // the scene gets what's between the top chrome and the card (at least ~30% of the screen)
        free.y0 = clamp(64 / H, 0, 0.12)
        free.y1 = clamp(r.top / H, free.y0 + 0.3, 1)
      } else {
        free.x0 = clamp((r.right + 16) / W, 0, 0.7)
        free.x1 = 1
        free.y0 = 0
        free.y1 = 1
      }
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => measureCard()).observe(card)
    window.addEventListener('resize', () => measureCard())
  }

  // ---- camera fit -----------------------------------------------------------
  const pos = new THREE.Vector3()
  const tgt = new THREE.Vector3()
  const startPos = new THREE.Vector3()
  const startTgt = new THREE.Vector3()
  /** Straight-on framing that fits a world box into the free part of the screen. */
  function fit(frame: Frame, fov: number, x0: number, x1: number, y0: number, y1: number, outPos: THREE.Vector3, outTgt: THREE.Vector3) {
    const a = frame.width / Math.max(1, frame.height)
    const t = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    // free region in NDC
    const nx0 = free.x0 * 2 - 1
    const nx1 = free.x1 * 2 - 1
    const ny0 = 1 - free.y1 * 2
    const ny1 = 1 - free.y0 * 2
    const hw = (nx1 - nx0) / 2
    const hh = (ny1 - ny0) / 2
    const cx = (nx0 + nx1) / 2
    const cy = (ny0 + ny1) / 2
    const bw = (x1 - x0) / 2
    const bh = (y1 - y0) / 2
    const d = Math.max(bw / (t * a * hw * 0.94), bh / (t * hh * 0.94))
    const X = (x0 + x1) / 2 - cx * d * t * a
    const Y = (y0 + y1) / 2 - cy * d * t
    outPos.set(X, Y, d)
    outTgt.set(X, Y, 0)
  }

  return {
    id: 'visit',
    group,
    anchors: [],

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      buildHud(ctx.stage)
      await nextFrame()
      // the painted sign: redraw once Alfa Slab One is really there
      const redraw = () => {
        drawSign(sign.canvas)
        sign.tex.needsUpdate = true
      }
      if (document.fonts?.load) {
        document.fonts
          .load('400 120px "Alfa Slab One"')
          .then(redraw)
          .catch(() => {})
        document.fonts.ready.then(redraw).catch(() => {})
      }
      requestAnimationFrame(() => measureCard())
    },

    onEnter() {
      measureCard()
    },

    update(local, frame, ctx) {
      const still = reduced || frame.reducedMotion
      const t = frame.time

      // ---- the pint slides in along the sill and settles; foam relaxes
      const k = still ? 1 : settle(segment(local, 0.05, 0.24))
      pint.group.position.set(PINT.x + (1 - k) * 1.1, PINT.y + 0.012, PINT.z)
      coaster.position.set(PINT.x + (1 - k) * 1.1, PINT.y + 0.0125, PINT.z)
      const tilt = still ? 0 : (1 - k) * 0.05
      pint.group.rotation.z = tilt
      pint.setHead(still ? 0.085 : lerp(0.12, 0.085, smoothstep(0.06, 0.34, local)))

      // ---- the votive: a slow, soft breath (never a flicker you could count)
      const breathe = still ? 1 : 0.9 + 0.06 * Math.sin(t * 1.7) + 0.04 * Math.sin(t * 3.1 + 1.3)
      votive.flame.scale.set(0.16, 0.24 * (0.95 + 0.05 * breathe), 1)
      votive.jarMat.emissiveIntensity = 0.3 * breathe
      candle.intensity = 0.1 * breathe

      // ---- the street: a car's lights slide past now and then
      street.uniforms.uTime.value = t
      let carX = -12
      let car = 0
      if (!still) {
        const period = 26
        const ph = (t + 9) % period
        const cross = 8
        if (ph < cross) {
          const u = ph / cross
          carX = lerp(-9, 13, u)
          car = smoothstep(0, 0.15, u) * (1 - smoothstep(0.85, 1, u))
        }
      }
      street.uniforms.uCarX.value = carX
      street.uniforms.uCar.value = car
      // the headlights brighten the spill through the window a touch as they pass
      const pass = car * Math.exp(-((carX - 2.5) * (carX - 2.5)) * 0.06)
      spill.intensity = 1.6 + 2.2 * pass
      spill.position.x = 2.5 + clamp(carX - 2.5, -2, 2) * 0.5 * car

      pendant.intensity = 3.2

      // ---- lights
      const w = ctx.world.params
      w.top = '#07060a'
      w.bottom = '#030202'
      w.cyc = 0
      w.brick = 0
      w.bulbs = 0
      w.bokeh = 0
      w.haze = 0
      w.spot = 1.1
      w.spotColor = '#ffdcb4'
      w.spotPos.set(-2.2, 9.5, 10)
      w.spotAt.set(-1.3, 4.3, 0)
      w.spotAngle = 0.24
      w.spotPenumbra = 0.9
      w.rimA = 0.9
      w.rimAColor = '#ffc27a'
      w.rimADir.set(0.3, 0.75, -1)
      w.rimB = 0.1
      w.rimBColor = '#6f8fc4'
      w.rimBDir.set(-0.6, 0.35, -1)
      w.fill = 0.14
      w.env = 0.7
      w.envTurn = 0.4
      const p = ctx.post.params
      p.beer = 0.55
      p.vignette = 0.38
      p.warmth = 0.55

      // ---- copy
      const inCard = local > 0.075
      hud.card.classList.toggle('is-in', inCard)
      setRise(hud.title, local > 0.09)
      for (const b of hud.blocks) b.classList.toggle('is-in', local > 0.11)
    },

    camera(local, frame, out: CameraPose) {
      const still = reduced || frame.reducedMotion
      const portrait = free.portrait
      const fov = portrait ? 40 : 34
      if (portrait) {
        // phones and tall tablets: the pint against the window, the sign above-left
        fit(frame, fov, SIGN.x0 + 1.6, WIN.x1 + 0.15, WIN.y0 - 0.35, SIGN.y1 - 0.2, pos, tgt)
      } else {
        fit(frame, fov, SIGN.x0 - 0.3, WIN.x1 + 0.35, WIN.y0 - 0.6, WIN.y1 - 0.7, pos, tgt)
      }
      // the street keeps a lit window straight behind the pint, seen from the resting pose
      {
        const cz = PINT.z
        const tt = (pos.z - STREET_Z) / Math.max(0.01, pos.z - cz)
        const py = PINT.y + 0.8
        street.uniforms.uBack.value.set(pos.x + (PINT.x - pos.x) * tt, pos.y + (py - pos.y) * tt)
      }
      // start tight on the sill (the pint coming in), pull back to the whole front
      startTgt.set(PINT.x - 0.35, PINT.y + 0.8, PINT.z)
      startPos.set(PINT.x + 0.4, PINT.y + 1.35, PINT.z + 4.6)
      const k = still ? 1 : smoothstep(0, DOLLY_END, local)
      const e = 1 - Math.pow(1 - k, 2.4)
      out.position.lerpVectors(startPos, pos, e)
      out.target.lerpVectors(startTgt, tgt, e)
      out.fov = fov
      out.roll = 0
      out.parallax = still ? 0 : 0.14
    },
  }
}
