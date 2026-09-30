import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { BRAND, CREDIT, HOURS, KITCHEN_HOURS, LINKS, RESERVATIONS, SECTIONS, SOCIALS, VISIT_UI } from '../../content'
import { TT, catNo, leanAgainst, localBounds, makeRecord, makeSleeve, makeTurntable, planeClearance, syncVinylLights, tracklistTexture } from '../../kit/vinyl'
import { makeGlass, BEERS } from '../../kit/beer'
import { makeBarTop } from '../../kit/bar'
import { withPools } from '../../kit/room'
import { poolHook } from '../../kit/room/materials'
import {
  BRICK_Z,
  CONSOLE,
  COL_A,
  COL_B,
  WIN,
  SIGN,
  STREET_Z,
  makeFloor,
  makeCoaster,
  makeRoom,
  makeSign,
  makeStreet,
  makeVotive,
  makeWindow,
  paintSign,
  placeConsoleTop,
  prepareVisitRoom,
  type Sign,
  type VisitRoom,
} from './scene'
import './visit.css'

/*
 * LAST CALL (visit) — the site's ending. 1.8 vh, lands at 0.3.
 *
 * The front of the house at night, from inside, and the last record of the
 * night — in Glory's real room (the room kit: walnut-clad columns with
 * wire-cage sconces, the black ceiling with its silver duct and a cage
 * pendant). Glory's tall black-framed window onto cobbled Chestnut Street
 * (warm brick facades out of focus, a lantern, a lit bay window, now and
 * then a car's lights sliding past), in a black-painted bay like ref5's (the
 * pier beside it carries a cage sconce); the painted wall sign on the exposed
 * brick bay (ref5); under the sign an ebonised
 * record console packed with LPs, a walnut deck on it playing "Last Call"
 * (GLY-007), its sleeve propped against the brick behind, back out (Side A ·
 * Hours / Side B · Visit — decorative; the DOM card is the readable copy);
 * on the sill a last gold pint on a G-roundel coaster next to a votive. The
 * copy is a clean "last call" card set like a sleeve back: catalogue line,
 * phone and address, bar + kitchen hours, reservations, the other ways in,
 * socials, the footer and Back to top.
 *
 *   0.00–0.10  under the pour cut: close on the deck, the record playing
 *   0.10–0.15  the cue lifts the stylus off the run-out groove
 *   0.14–0.30  the platter winds down from 33⅓ to a stop
 *   0.15–0.27  the tonearm swings back to its rest; 0.27–0.31 it lowers onto it
 *   0.00–0.34  the camera pulls back and up to the whole front: the duct
 *              under the black ceiling, the sign, the pier + sconce, the
 *              window + pendant, the pint, the LPs in the console
 *   0.10–0.30  the warm rim eases in with the pull-back (on the close-up it
 *              would flood the deck's plinth)
 *   0.075–0.2  the card: eyebrow + headline rise, then its blocks in order
 *   0.34–1.00  hold. Nothing moves but light: the votive, the street, a car.
 *
 * NO CLIPPING: the sleeve is posed by the vinyl kit's leanAgainst (on a
 * wrapper that keeps its π turn), its foot on the console top and its
 * nearest corner 0.014 kit units off the brick; the deck stands clear in
 * front of it. In dev, window.__visitClear holds the audit (brick, console
 * top, column A, and a separating-axis gap to every solid deck mesh; > 0 clear).
 *
 * It's the last chapter: no out-cut, it holds to the end of the page.
 */

const DOLLY_END = 0.34
/** where the pint lands on the sill */
const PINT = new THREE.Vector3(1.95, WIN.y0, 0.42)

/**
 * The deck on the console: base centre, yaw (turned a touch toward the
 * window), and scale (kit units: a 12" sleeve = 1; this room is ~1.9x that).
 */
export const DECK = { position: new THREE.Vector3(-1.62, CONSOLE.top, 1.5), yaw: 0.12, scale: 1.9, top: CONSOLE.top }
/** its sleeve, leaning on the brick behind the deck (left of it), back out */
const SLEEVE = { x: -2.4, lean: 0.1, yaw: 0.04 }

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

/**
 * Dev audit: the smallest separation between two objects' oriented bounds
 * (their own-frame boxes in world space), by the separating-axis test.
 * > 0: that much air on the best axis; ≤ 0: the boxes overlap.
 */
function boxGap(a: THREE.Object3D, b: THREE.Object3D): number {
  const obb = (o: THREE.Object3D) => {
    const bb = localBounds(o)
    const m = o.matrixWorld
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m))
    const e = new THREE.Matrix3().setFromMatrix4(m)
    const ax = [0, 1, 2].map(k => new THREE.Vector3().setFromMatrix3Column(e, k).normalize())
    return { pts, ax }
  }
  const A = obb(a)
  const B = obb(b)
  const axes = [...A.ax, ...B.ax]
  for (const u of A.ax) for (const v of B.ax) {
    const c = new THREE.Vector3().crossVectors(u, v)
    if (c.lengthSq() > 1e-8) axes.push(c.normalize())
  }
  let best = -Infinity
  for (const n of axes) {
    const pa = A.pts.map(p => p.dot(n))
    const pb = B.pts.map(p => p.dot(n))
    const gap = Math.max(Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb))
    best = Math.max(best, gap)
  }
  return best
}

/** dev audit: the smallest boxGap between `a` and any solid mesh under `b` (flat decals such as contact shadows skipped) */
function meshGap(a: THREE.Object3D, b: THREE.Object3D): number {
  let min = Infinity
  b.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.visible) return
    const bb = localBounds(m)
    const s = bb.getSize(new THREE.Vector3())
    if (Math.min(s.x, s.y, s.z) < 1e-4) return
    min = Math.min(min, boxGap(a, m))
  })
  return min
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let reduced = false

  // ---- set ----------------------------------------------------------------
  // (the room itself — brick, walnut, columns, sconces, ceiling, the record
  // console — is the room kit, built in init once its maps are ready)
  let room: VisitRoom | null = null
  const floor = makeFloor()
  const win = makeWindow()
  const street = makeStreet()
  // the painted wall sign: made in init (its canvas is half size on phones)
  let sign: Sign | null = null
  // the sill: from the black-painted pier across the window, its far end let into the painted wall
  const sillX0 = COL_B.x1
  const sillX1 = WIN.x1 + 0.25
  const sill = makeBarTop({ length: sillX1 - sillX0, depth: 1.05, thickness: 0.14 })
  sill.position.set((sillX0 + sillX1) / 2, WIN.y0, 0.18)
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
  group.add(floor, win.group, street.mesh, sill, pint.group, coaster, votive.group)

  pint.group.position.set(PINT.x, PINT.y + 0.012, PINT.z)
  coaster.position.set(PINT.x, PINT.y + 0.0125, PINT.z)

  // ---- the last record of the night: a walnut deck on a black console
  const consoleTop = makeBarTop({ length: CONSOLE.x1 - CONSOLE.x0, depth: CONSOLE.depth, thickness: CONSOLE.thick })
  {
    const m = consoleTop.material as THREE.MeshPhysicalMaterial
    m.clearcoat = 0.1
    m.clearcoatRoughness = 0.55
    m.roughness = 0.62
    m.specularIntensity = 0.3
  }
  placeConsoleTop(consoleTop)
  const deckSlot = new THREE.Group()
  deckSlot.name = 'visit-deck-slot'
  deckSlot.position.copy(DECK.position)
  deckSlot.rotation.y = DECK.yaw
  deckSlot.scale.setScalar(DECK.scale)
  const deck = makeTurntable({ finish: 'walnut' })
  const record = makeRecord({ label: { title: VISIT_UI.record, sub: BRAND.motto, side: 'SIDE B', cat: catNo(7), paper: 'amber' } })
  deck.setRecord(record)
  deck.setGroove(0.9)
  deckSlot.add(deck.group)
  // its sleeve, propped against the brick behind the deck, back out
  const hoursTracks = [
    ...groupedHours().map(h => ({ name: `${VISIT_UI.barHours} · ${h.day}`, value: dash(h.hours) })),
    ...KITCHEN_HOURS.map(h => ({ name: `${VISIT_UI.kitchenHours} · ${h.day}`, value: dash(h.hours) })),
  ]
  const sleeve = makeSleeve({
    ink: true,
    back: tracklistTexture({
      title: VISIT_UI.record,
      sub: BRAND.name,
      cat: catNo(7),
      paper: 'stout',
      numbers: 'side',
      sides: [
        { name: VISIT_UI.sideA, tracks: hoursTracks },
        { name: VISIT_UI.sideB, tracks: [{ name: BRAND.street }, { name: BRAND.city }, { name: BRAND.phone }, { name: LINKS.reserve.label }] },
      ],
      notes: BRAND.motto,
    }),
  })
  // posed by the vinyl kit's leanAgainst on a wrapper (the sleeve turned π
  // inside it, back out): its foot stands on the console top and its nearest
  // corner stops a set gap in front of the brick — nothing dips or clips
  const lean = new THREE.Group()
  lean.name = 'visit-sleeve'
  lean.scale.setScalar(DECK.scale)
  sleeve.group.rotation.y = Math.PI
  lean.add(sleeve.group)
  group.add(consoleTop, lean, deckSlot)
  const leanPose = leanAgainst(lean, { wallZ: BRICK_Z, floorY: CONSOLE.top, x: SLEEVE.x, lean: SLEEVE.lean, yaw: SLEEVE.yaw, clearance: 0.014 })
  // the platter's centre in world space (the dolly starts close on it)
  const platterAt = new THREE.Vector3(TT.px, TT.platterTop, TT.pz)
    .multiplyScalar(DECK.scale)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), DECK.yaw)
    .add(DECK.position)

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

    // the sleeve-back catalogue line (decorative)
    const cat = el('p', 'vs-cat', undefined, card)
    el('span', '', `${catNo(7)} · ${VISIT_UI.format}`, cat)
    el('span', '', VISIT_UI.record, cat)

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
    // the arrow is glued to the address's last word, so a wrap never strands it
    const addr = `${BRAND.street}, ${BRAND.city}`
    const cut = addr.lastIndexOf(' ')
    ext(reach, 'vs-addr', BRAND.mapUrl, `${addr.slice(0, cut + 1)}<span class="vs-nw">${addr.slice(cut + 1)}${ARROW}</span>`)
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
      // a card taller than its slot (only a huge text zoom now: visit.css fits
      // every viewport) scrolls inside itself, and only then keeps the wheel
      // from the story (Lenis), like the events inquiry form
      if (card.scrollHeight > card.clientHeight + 1) card.setAttribute('data-lenis-prevent', '')
      else card.removeAttribute('data-lenis-prevent')
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
  function fit(frame: Frame, fov: number, x0: number, x1: number, y0: number, y1: number, outPos: THREE.Vector3, outTgt: THREE.Vector3, lift = 0) {
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
    // spare height (the width bound): lift the box up to `lift`, so the ceiling's duct edges in at the top
    const slack = Math.max(0, d * t * hh * 0.94 - bh)
    const Y = (y0 + y1) / 2 - cy * d * t + Math.min(slack, lift)
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
      sign = makeSign({ mobile: ctx.mobile })
      group.add(sign.mesh)
      await nextFrame()
      // the room kit: maps across frames, then the room as one kit
      await prepareVisitRoom()
      room = makeRoom({ mobile: ctx.mobile })
      group.add(room.kit.group)
      // the bulbs' light pools also fall on this chapter's own pieces (the sign,
      // the sill, the console top, the window frame, the sleeve), so the walnut
      // and the brick aren't the only things the sconces light
      const pools = room.kit.materials.pools
      const hook = (mesh: THREE.Mesh, key: string) => {
        withPools(mesh.material as THREE.MeshStandardMaterial, pools, `visit-${key}`)
        poolHook(mesh, pools, room!.kit.group)
      }
      hook(sign.mesh, 'sign')
      hook(sill, 'sill')
      hook(consoleTop, 'console')
      hook(win.frame, 'frame')
      // (the sleeve stays on the key alone: its cream title would bloom in the pools)
      // the duct's silver sits back a touch: it's the frame's top edge, not a subject
      room.kit.materials.duct.color.multiplyScalar(0.8)
      if (import.meta.env.DEV) {
        // the no-clip audit (world units; > 0 clear): the sleeve's nearest corner vs the
        // brick, its foot vs the console top, its edge vs column A, and the deck's box
        group.updateMatrixWorld(true)
        const P = (nx: number, ny: number, nz: number, c: number) => new THREE.Plane(new THREE.Vector3(nx, ny, nz), c)
        ;(window as unknown as { __visitClear?: object }).__visitClear = {
          brick: planeClearance(lean, P(0, 0, 1, -BRICK_Z)),
          top: planeClearance(lean, P(0, 1, 0, -CONSOLE.top)),
          colA: planeClearance(lean, P(1, 0, 0, -COL_A.x1)),
          deck: meshGap(lean, deck.group),
          gap: leanPose.gap,
          foot: leanPose.foot,
        }
        ;(window as unknown as { __visitDebug?: object }).__visitDebug = { deck, lean, group, localBounds, boxGap }
      }
      await nextFrame()
      // the painted sign: drawn once Alfa Slab One is really there (it usually
      // is by now; a slow face gets a fallback draw after 1.5 s and one redraw),
      // so the prewarm uploads the finished sign and its canvas is freed
      await paintSign(sign)
      requestAnimationFrame(() => measureCard())
    },

    onEnter() {
      measureCard()
    },

    update(local, frame, ctx) {
      const still = reduced || frame.reducedMotion
      const t = frame.time

      // ---- the last record: cue up, the platter winds down, the arm goes home
      if (still) {
        deck.setSpeed(0, true)
        deck.setArm(0)
        deck.setCue(0)
      } else {
        deck.setSpeed(33.333 * (1 - smoothstep(0.14, 0.3, local)))
        deck.setArm(1 - smoothstep(0.15, 0.27, local))
        deck.setCue(smoothstep(0.1, 0.15, local) * (1 - smoothstep(0.27, 0.31, local)))
      }
      deck.update(frame)

      // ---- the pint on the sill; its foam relaxes as the room settles
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

      // ---- the room: the cage bulbs hold steady (drive the level, never toggle)
      if (room) {
        room.kit.setGlow(1)
        room.kit.setAmbient(1)
        // the bulbs themselves read hotter than their pools (the camera sits back from them)
        const M = room.kit.materials
        M.glow.uniforms.uK.value *= 2.6
        M.filament.color.multiplyScalar(1.7)
        M.bulb.emissiveIntensity *= 2.4
      }

      // ---- lights
      const w = ctx.world.params
      w.top = '#07060a'
      w.bottom = '#030202'
      w.cyc = 0
      w.brick = 0
      w.bulbs = 0
      w.bokeh = 0
      w.haze = 0
      w.spot = 0.95
      w.spotColor = '#ffdcb4'
      w.spotPos.set(-2.6, 9.5, 10)
      w.spotAt.set(-1.7, 3.1, 0.7)
      w.spotAngle = 0.3
      w.spotPenumbra = 0.9
      // the warm rim makes the pint glow against the window; on the close-up
      // (the camera looking down at the deck) it would flood the plinth, so it
      // eases in with the pull-back
      w.rimA = still ? 0.9 : lerp(0.18, 0.9, smoothstep(0.1, 0.3, local))
      w.rimAColor = '#ffc27a'
      w.rimADir.set(0.3, 0.75, -1)
      w.rimB = 0.1
      w.rimBColor = '#6f8fc4'
      w.rimBDir.set(-0.6, 0.35, -1)
      w.fill = 0.14
      w.env = 0.7
      w.envTurn = 0.4
      syncVinylLights(ctx.world)
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
        fit(frame, fov, SIGN.x0 + 0.1, WIN.x1 + 0.15, WIN.y0 - 0.6, SIGN.y1 - 0.2, pos, tgt)
      } else {
        fit(frame, fov, SIGN.x0 - 0.3, WIN.x1 + 0.35, WIN.y0 - 0.9, WIN.y1 - 0.7, pos, tgt, 0.3)
      }
      // the street keeps a lit window straight behind the pint, seen from the resting pose
      {
        const cz = PINT.z
        const tt = (pos.z - STREET_Z) / Math.max(0.01, pos.z - cz)
        const py = PINT.y + 0.8
        street.uniforms.uBack.value.set(pos.x + (PINT.x - pos.x) * tt, pos.y + (py - pos.y) * tt)
      }
      // start tight on the sill (the pint coming in), pull back to the whole front
      startTgt.copy(platterAt)
      startPos.set(platterAt.x + 1.1, platterAt.y + 2.3, platterAt.z + 3.4)
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
