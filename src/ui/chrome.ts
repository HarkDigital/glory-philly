import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND, HOURS, KITCHEN_HOURS, LINKS, MICROCOPY } from '../content'
import { NAV_NAMES } from '../chapters/index'
import { WORDMARK, roundelSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'
import { bindScene, calmUi, holdScene, readMotion, releaseScene, rememberMotion } from './prefs'
import { publishTextures } from './texture'

/*
 * Persistent chrome — GLORY BEER BAR & KITCHEN. Everything sits on small
 * OPAQUE STOUT PLATES (never a blur over the canvas: backdrop-filter costs
 * 15–25% of the frame), so the small type holds ≥ 4.5:1 over the dark bar
 * and the bone-white cyclorama alike. Thin stout scrims settle the bands.
 * The chrome owns the --safe-top / --safe-bottom bands; chapter copy never
 * lives there.
 *
 *   top-left      the red G ROUNDEL (the site icon, as vector) + "Glory" in
 *                 Alfa Slab One over "Beer Bar & Kitchen" in mono caps
 *                 (→ lands on the hero).
 *   top-right     Bar · Kitchen · Events · Visit (NAV_NAMES) on one plate,
 *                 each with a small amber dot that lights for the chapter on
 *                 screen, then "Make a Reservation" (the Glory-red pill,
 *                 external: Toast). ≤ 900 px the plate folds into one Menu
 *                 button (the pill stays beside it down to 560 px). Menu opens
 *                 a full-screen dialog on the brick wall: every chapter (as
 *                 the tracklist), the
 *                 reservation pill, the phone, the address (→ map) and the
 *                 hours (focus moves in, Tab is trapped, Escape closes, the
 *                 page behind is inert and the scene pauses once covered;
 *                 focus returns to Menu).
 *   bottom-left   Sound · Motion: small quiet switches (aria-pressed); a dot
 *                 lights amber when on. Sound is off by default. Motion off
 *                 sets engine.motion = false + html.motion-off, is remembered
 *                 (prefs.ts) and starts off under prefers-reduced-motion.
 *   bottom-right  the story as a record's TRACKLIST: a small spinning disc,
 *                 "A3  The Kitchen · Kitchen", then one button per chapter
 *                 (A1 … A4 | B1 … B3, a hairline between the sides; a
 *                 hover/focus tag with its business name): the track playing
 *                 is lit amber, the ones behind stay cream, the ones ahead dim.
 *   The bottom band is one landmark (<aside> "Preferences and chapters"). The
 *   readout is NOT a live region; a quiet sr-only status names the chapter
 *   only after a pip / link was activated without moving focus (a click).
 *
 * API used by main.ts: createChrome(root, engine, sound) → { update(frame, state) }.
 * Navigation always uses engine.land(id) (lands on settled copy; long jumps cut).
 */

/** the primary nav on desktop (business names, in story order) */
const NAV = ['taps', 'kitchen', 'events', 'visit']
/** nav items that open gloryphilly.com's printable menu instead of landing on their chapter (Mike, 2026-09-30; the fallback page's header too) */
export const MENU_LINKS: Record<string, string> = { taps: 'Bar menu', kitchen: 'Kitchen menu' }
/** the story as a record's tracklist: side A is the first half (rounded up), side B the rest — A1 … A4, B1 … B3 */
export const trackCode = (i: number, total: number) => {
  const a = Math.ceil(total / 2)
  return i < a ? `A${i + 1}` : `B${i - a + 1}`
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** "Monday … Wednesday: 4pm - 2am" → [{ days: 'Mon – Wed', hours: '4pm - 2am' }, …] (runs of equal hours) */
export function hoursSummary() {
  const out: { days: string; hours: string }[] = []
  let i = 0
  while (i < HOURS.length) {
    let j = i
    while (j + 1 < HOURS.length && HOURS[j + 1].hours === HOURS[i].hours) j++
    const a = HOURS[i].day.slice(0, 3)
    const b = HOURS[j].day.slice(0, 3)
    out.push({ days: i === j ? a : `${a} – ${b}`, hours: HOURS[i].hours })
    i = j + 1
  }
  return out
}

/* glyphs (decorative) */
const MENU_IC = `<svg class="ch-ic" viewBox="0 0 20 14" aria-hidden="true" focusable="false"><path d="M1 2h18M1 7h18M1 12h12"/></svg>`
const CLOSE_IC = `<svg class="ch-ic" viewBox="0 0 20 14" aria-hidden="true" focusable="false"><path d="M5 1.5l10 11M15 1.5l-10 11"/></svg>`
export const EXT_IC = `<svg class="ch-ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 2h6v6M10 2L3 9"/></svg>`
const NEW_TAB = `<span class="sr-only"> (opens in a new tab)</span>`

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const html = document.documentElement
  const slots = engine.slots
  const total = slots.length
  const indexOf = (id: string) => slots.findIndex(s => s.def.id === id)
  const biz = (id: string, fallback = '') => NAV_NAMES[id] ?? fallback
  const first = slots[0]?.def.id ?? 'hero'
  /** the chapter's label, when it says more than its business name (never "City Wide (City Wide)") */
  const extra = (i: number) => {
    const d = slots[i].def
    return biz(d.id, d.label) === d.label ? '' : d.label
  }
  /** "A3: City Wide (City Wide Special)" — pips */
  const pipName = (i: number) => {
    const d = slots[i].def
    const x = extra(i)
    return `${trackCode(i, total)}: ${biz(d.id, d.label)}${x ? ` (${x})` : ''}`
  }

  // the rotate card (and the opaque menu) cover the picture: pause it
  // (engine.paused) while either is up — a counted hold, so both can overlap
  bindScene(engine)
  mountRotateGate(shown => (shown ? holdScene('rotate') : releaseScene('rotate')))

  // the menu dialog's brick wall
  publishTextures(['brick'])

  // ---------------------------------------------------------------- markup

  const brandInner = `<span class="ch-mark" aria-hidden="true">${roundelSvg('ch-mark-svg')}</span><span class="ch-brand-text" aria-hidden="true">${WORDMARK}</span>`
  const reserve = (cls: string) =>
    `<a class="hud-btn ${cls}" href="${esc(LINKS.reserve.url)}" target="_blank" rel="noopener" data-reserve><span>${esc(LINKS.reserve.label)}</span>${EXT_IC}${NEW_TAB}</a>`

  const menuLink = (id: string, cls: string, inner: string) =>
    `<a class="${cls}" href="${esc(LINKS.menus.url)}" target="_blank" rel="noopener" data-menu-link aria-label="${esc(MENU_LINKS[id])} (opens in a new tab)">${inner}</a>`
  const links = NAV.filter(id => indexOf(id) >= 0)
    .map(id =>
      MENU_LINKS[id]
        ? `<li>${menuLink(id, 'ch-link', `<i class="ch-led" aria-hidden="true"></i><span>${esc(biz(id))}</span>${EXT_IC}`)}</li>`
        : `<li><a class="ch-link" href="#${id}" data-go="${id}"><i class="ch-led" aria-hidden="true"></i><span>${esc(biz(id))}</span></a></li>`,
    )
    .join('')

  const sideA = Math.ceil(total / 2)
  const pips = slots
    .map(
      (s, i) =>
        `<li${i === sideA ? ' class="ch-side-b"' : ''}><button type="button" class="ch-pip" data-go="${s.def.id}" aria-label="${esc(pipName(i))}"><span class="ch-trk" aria-hidden="true">${trackCode(i, total)}</span><span class="ch-tag" aria-hidden="true">${esc(biz(s.def.id, s.def.label))}</span></button></li>`,
    )
    .join('')

  const rows = slots
    .map((s, i) => {
      const inner = `
          <span class="ch-ml-n" aria-hidden="true">${trackCode(i, total)}</span>
          <span class="ch-ml-name" aria-hidden="true">${esc(biz(s.def.id, s.def.label))}${MENU_LINKS[s.def.id] ? EXT_IC : ''}</span>
          <span class="ch-ml-lab" aria-hidden="true">${esc(MENU_LINKS[s.def.id] ?? s.def.label)}</span>`
      return MENU_LINKS[s.def.id]
        ? `<li>${menuLink(s.def.id, 'ch-ml', inner)}</li>`
        : `<li><a class="ch-ml" href="#${s.def.id}" data-go="${s.def.id}" aria-label="${esc(biz(s.def.id, s.def.label))}, ${trackCode(i, total)}${extra(i) ? `: ${esc(extra(i))}` : ''}">${inner}
        </a></li>`
    })
    .join('')

  const hours = hoursSummary()
    .map(h => `<li><span>${esc(h.days)}</span><span>${esc(h.hours)}</span></li>`)
    .join('')
  const kitchen = KITCHEN_HOURS.map(h => `<li><span>${esc(h.day)}</span><span>${esc(h.hours)}</span></li>`).join('')

  let motionOn = readMotion()
  // a quiet switch: a dot, the name, the state word (aria-pressed carries the state)
  const tgl = (kind: 'sound' | 'motion', extra = '') => {
    const on = kind === 'sound' ? sound.enabled : motionOn
    const k = kind === 'sound' ? MICROCOPY.audio : MICROCOPY.motion
    return `<button class="ch-tgl ch-tgl--${kind}${extra}" type="button" data-${kind}-toggle aria-pressed="${on}"><i class="ch-dot" aria-hidden="true"></i><span class="ch-tgl-k">${esc(k)}</span><span class="ch-tgl-s" aria-hidden="true"><span class="ch-tgl-on">On</span><span class="ch-tgl-off">Off</span></span></button>`
  }

  root.innerHTML = `
  <div class="ch">
    <div class="ch-scrim ch-scrim--top" aria-hidden="true"></div>
    <div class="ch-scrim ch-scrim--bot" aria-hidden="true"></div>
    <header class="ch-top">
      <a class="ch-brand" href="#${first}" data-go="${first}" aria-label="${esc(BRAND.name)}, back to the start">${brandInner}</a>
      <nav class="ch-nav" aria-label="Primary">
        <ul class="ch-links">${links}</ul>
      </nav>
      ${reserve('ch-cta')}
      <button class="ch-menu-btn" type="button" aria-expanded="false" aria-controls="ch-menu" aria-haspopup="dialog"><span>Menu</span>${MENU_IC}</button>
    </header>

    <aside class="ch-bottom" aria-label="Preferences and chapters">
      <div class="ch-prefs" role="group" aria-label="Preferences">${tgl('sound')}${tgl('motion')}</div>
      <div class="ch-read">
        <p class="ch-read-line"><i class="ch-disc" aria-hidden="true"></i><span class="ch-read-n"><b>A1</b></span><span class="ch-read-l"></span><span class="ch-read-b"></span></p>
        <nav class="ch-pips" aria-label="Chapters"><ol class="ch-rail">${pips}</ol></nav>
        <p class="sr-only" role="status" data-ch-status></p>
      </div>
    </aside>

    <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-label="Menu" data-lenis-prevent hidden>
      <div class="ch-menu-wall" aria-hidden="true"></div>
      <div class="ch-menu-top">
        <span class="ch-brand ch-menu-brand" aria-hidden="true">${brandInner}</span>
        <button class="ch-menu-btn ch-menu-close" type="button"><span>Close</span>${CLOSE_IC}</button>
      </div>
      <div class="ch-menu-body">
        <nav class="ch-menu-nav" aria-label="Chapters"><ol class="ch-ml-list">${rows}</ol></nav>
        <div class="ch-menu-info">
          ${reserve('ch-menu-cta')}
          <p class="ch-mi"><span class="ch-mi-k">Call</span><a href="${esc(BRAND.phoneHref)}">${esc(BRAND.phone)}</a></p>
          <p class="ch-mi"><span class="ch-mi-k">Find us</span><a href="${esc(BRAND.mapUrl)}" target="_blank" rel="noopener">${esc(BRAND.street)}<br>${esc(BRAND.city)}${NEW_TAB}</a></p>
          <div class="ch-mi ch-mi-hours">
            <h2 class="ch-mi-k">Hours</h2><ul class="ch-hours">${hours}</ul>
            <h2 class="ch-mi-k">Kitchen</h2><ul class="ch-hours">${kitchen}</ul>
          </div>
        </div>
        <div class="ch-menu-prefs" role="group" aria-label="Preferences">${tgl('sound', ' ch-menu-tgl')}${tgl('motion', ' ch-menu-tgl')}</div>
      </div>
    </div>
  </div>`

  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!
  const ch = $('.ch')
  const top = $('.ch-top')
  const bottom = $('.ch-bottom')
  const menu = $('.ch-menu')
  const menuBtn = $<HTMLButtonElement>('.ch-top .ch-menu-btn')
  const menuClose = $<HTMLButtonElement>('.ch-menu-close')
  const navEls = [...root.querySelectorAll<HTMLAnchorElement>('.ch-link')]
  const pipEls = [...root.querySelectorAll<HTMLButtonElement>('.ch-pip')]
  const menuLinks = [...root.querySelectorAll<HTMLAnchorElement>('.ch-ml')]
  const soundBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')]
  const motionBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]')]
  const readN = $('.ch-read-n b')
  const readL = $('.ch-read-l')
  const readB = $('.ch-read-b')
  const status = $('[data-ch-status]')
  /** the chapter to name once we arrive (set by a pointer activation only) */
  let announceFor: string | null = null
  const say = (i: number) => {
    const d = slots[i]?.def
    if (d) status.textContent = `${trackCode(i, total)}: ${biz(d.id, d.label)}${extra(i) ? `, ${extra(i)}` : ''}`
  }

  // ---------------------------------------------------------------- navigation

  root.addEventListener('click', e => {
    const t = e.target as Element
    // the reservation pill leaves for Toast: a clink, then let it go
    if (t.closest('[data-reserve], [data-menu-link]')) {
      sound.blip(6)
      return
    }
    const a = t.closest<HTMLElement>('[data-go]')
    if (!a || !root.contains(a)) return
    e.preventDefault()
    const id = a.dataset.go!
    const fromMenu = menuOpen && menu.contains(a)
    if (menuOpen) closeMenu(false)
    sound.blip(Math.max(0, indexOf(id)))
    if (indexOf(id) >= 0) engine.land(id)
    // keyboard activation (detail 0) hands focus on to the chapter's heading
    // so the next Tab continues in the story; a tap in the menu returns focus
    // to Menu, the control that opened it
    const keyboard = e.detail === 0
    const toHeading = keyboard && indexOf(id) >= 0
    if (toHeading) engine.focusChapter(id)
    else if (fromMenu) menuBtn.focus({ preventScroll: true })
    status.textContent = ''
    announceFor = null
    if (!toHeading && indexOf(id) >= 0) {
      if (indexOf(id) === lastIndex) window.setTimeout(() => say(lastIndex), 120)
      else announceFor = id
    }
  })

  // ---------------------------------------------------------------- sound

  const syncSound = (on: boolean) => {
    for (const b of soundBtns) b.setAttribute('aria-pressed', String(on))
  }
  for (const b of soundBtns) b.addEventListener('click', () => sound.toggle())
  sound.onChange.push(syncSound)
  syncSound(sound.enabled)

  // -------------------------------------------------------------------- motion

  const syncMotion = () => {
    document.documentElement.classList.toggle('motion-off', !motionOn)
    engine.motion = motionOn
    for (const b of motionBtns) b.setAttribute('aria-pressed', String(motionOn))
    window.dispatchEvent(new CustomEvent('hark:motion', { detail: { on: motionOn } }))
  }
  for (const b of motionBtns)
    b.addEventListener('click', () => {
      motionOn = !motionOn
      rememberMotion(motionOn)
      sound.blip(motionOn ? 4 : 2)
      syncMotion()
    })
  syncMotion()

  // ---------------------------------------------------------------- the menu

  let menuOpen = false
  let menuTimer = 0
  const focusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button')].filter(el => !el.hidden && el.getClientRects().length > 0)
  const openMenu = () => {
    if (menuOpen) return
    menuOpen = true
    clearTimeout(menuTimer)
    menu.hidden = false
    // flush the closed state so the dialog fades up
    void menu.offsetWidth
    ch.classList.add('is-menu')
    menuBtn.setAttribute('aria-expanded', 'true')
    holdInert('menu', [
      document.getElementById('stages'),
      document.getElementById('track'),
      document.querySelector<HTMLElement>('.skip-link'),
      top,
      bottom,
    ])
    engine.lenis?.stop()
    // the menu is opaque: hold the frame once it has covered the picture
    menuTimer = window.setTimeout(() => menuOpen && holdScene('menu'), calmUi() ? 0 : 320)
    menu.scrollTop = 0
    // focus the chapter on screen — unless its row leaves the site (Bar / Kitchen
    // open gloryphilly.com's menu in a new tab): an Enter out of habit must not
    // leave, so Close takes focus there (Tab goes on to the first chapter)
    const now = menuLinks[lastIndex]
    if (now && !now.hasAttribute('data-menu-link')) now.focus({ preventScroll: true })
    else menuClose.focus({ preventScroll: true })
    sound.blip(2)
  }
  const closeMenu = (restoreFocus = true) => {
    if (!menuOpen) return
    menuOpen = false
    clearTimeout(menuTimer)
    ch.classList.remove('is-menu')
    menuBtn.setAttribute('aria-expanded', 'false')
    releaseInert('menu')
    releaseScene('menu')
    engine.lenis?.start()
    menuTimer = window.setTimeout(
      () => {
        if (!menuOpen) menu.hidden = true
      },
      calmUi() ? 0 : 260,
    )
    if (restoreFocus) menuBtn.focus({ preventScroll: true })
  }
  menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))
  menuClose.addEventListener('click', () => closeMenu())
  // a link out of the dialog (reserve, map, phone) leaves the menu as it is
  // capture: the dialog's own trap runs ahead of the no-`inert` fallback in inert.ts
  window.addEventListener(
    'keydown',
    e => {
      if (!menuOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    },
    true,
  )
  // the desktop layout has no Menu button: a menu left open by a resize closes
  const wide = matchMedia('(min-width: 901px)')
  const onWide = () => wide.matches && closeMenu(false)
  if (typeof wide.addEventListener === 'function') wide.addEventListener('change', onWide)
  else wide.addListener?.(onWide)
  // the static page took over (no GPU): let go of everything the menu held
  window.addEventListener('hark:fallback', () => {
    closeMenu(false)
    html.classList.remove('ui-typing')
  })

  // ------------------------------------------------------ a phone keyboard
  // html.ui-typing while a text field outside the chrome has focus (the event
  // inquiry form). On a short touch viewport — a phone keyboard is up — ui.css
  // then gives the bottom band (Sound · Motion + the tracklist) to the form.
  const TEXT = /^(text|email|tel|url|search|number|password|date|datetime-local|month|week|time)$/
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement &&
    !root.contains(t) &&
    (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXT.test(t.type)) || t.isContentEditable)
  document.addEventListener('focusin', e => html.classList.toggle('ui-typing', typing(e.target)))
  // focus moving field → field keeps it (relatedTarget); leaving the form, or the window, drops it
  document.addEventListener('focusout', e => html.classList.toggle('ui-typing', typing(e.relatedTarget)))

  // -------------------------------------------------------------------- update

  let lastIndex = -1
  return {
    update(_frame: Frame, state: EngineState) {
      if (state.index === lastIndex) return
      const slot = state.slots[state.index]
      if (!slot) return
      lastIndex = state.index
      const id = slot.def.id
      if (announceFor === id) {
        announceFor = null
        say(state.index)
      }
      readN.textContent = trackCode(state.index, total)
      readL.textContent = slot.def.label
      const b = biz(id, '')
      readB.textContent = b && b !== slot.def.label ? b : ''
      pipEls.forEach((el, i) => {
        el.classList.toggle('is-on', i === state.index)
        el.classList.toggle('is-past', i < state.index)
        if (i === state.index) el.setAttribute('aria-current', 'step')
        else el.removeAttribute('aria-current')
      })
      navEls.forEach(a => {
        const on = a.dataset.go === id
        a.classList.toggle('is-on', on)
        if (on) a.setAttribute('aria-current', 'location')
        else a.removeAttribute('aria-current')
      })
      // like the desktop nav: only in-page rows mark the chapter on screen (an
      // external link is never "the current location")
      menuLinks.forEach((a, i) => {
        const on = i === state.index && !a.hasAttribute('data-menu-link')
        a.classList.toggle('is-on', on)
        if (on) a.setAttribute('aria-current', 'location')
        else a.removeAttribute('aria-current')
      })
      ch.dataset.chapter = id
    },
  }
}
