import { holdInert, releaseInert } from './inert'
import { MICROCOPY } from '../content'
import { storeKey } from './prefs'
import { publishTextures } from './texture'

/*
 * Phone-landscape suggestion — GREG JONES PROJECT: a SETLIST TAPED UP in the
 * dark room. The card is a sheet of cream stock held by two strips of
 * masking tape, in the lamp's pool: a phone drawn in marker, turning upright
 * ONCE under a barn-red arrow (never a loop; simply upright under reduced
 * motion / Motion off). Beside it: "Turn your phone upright" (Fraunces;
 * "upright" is the Caveat hand), "This stage is set for portrait." and
 * "Continue anyway" (an ink plate). The scene is paused underneath
 * (createChrome wires onChange to the scene hold). Tablets and laptops in
 * landscape are taller than 500px and never see it.
 *
 * It is a suggestion, never a lock (WCAG 1.3.4): "Continue anyway" (or
 * Escape, as a dialog promises) releases it for the rest of the session. It
 * speaks once: focus moved to the card reads its name and description; the
 * live region only speaks when focus stayed in the copy layer / on the skip
 * link (a reader who never lands on the card). While it shows, the skip
 * link and the linear copy layer in #track stay reachable, and their focus
 * pills paint above the card (it sits at z 25: over the chrome (10) and the
 * stages (5), under #track:focus-within (30) and the skip link (120)); only
 * the chrome and the stages behind it are inert.
 *
 * API: mountRotateGate(onChange?) / unmountRotateGate(). Safe to call more
 * than once: later calls just add their onChange listener.
 */

export const ROTATE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)'

const DISMISS_KEY = storeKey('rotate-ok')
const wasDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
const rememberDismissed = () => {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* blocked storage: the choice lasts until reload */
  }
}

/* the drawing (0..110 × 0..132): a phone in marker under a curved arrow; the
   phone turns upright once (.rot-phone rotates about its centre) */
const ART = `<svg class="rot-draw" viewBox="0 0 110 132" aria-hidden="true" focusable="false">
  <g class="rot-arrow">
    <path d="M22 60C19 34 38 15 64 16c12 .4 22 5 29 13"/>
    <path d="M94.5 15.5l-1 14.2-13.8-2.6"/>
  </g>
  <g class="rot-phone">
    <rect x="36" y="54" width="44" height="68" rx="8.5"/>
    <path d="M51 61.5h14"/>
    <circle cx="58" cy="113.5" r="2.8" class="rot-dot"/>
  </g>
</svg>`

let gate: {
  el: HTMLElement
  mq: MediaQueryList
  sync: () => void
  listeners: ((shown: boolean) => void)[]
  on: () => boolean
  onKey: (e: KeyboardEvent) => void
} | null = null

export function mountRotateGate(onChange?: (shown: boolean) => void) {
  if (gate) {
    if (onChange) {
      gate.listeners.push(onChange)
      onChange(gate.on())
    }
    return
  }
  if (typeof matchMedia === 'undefined') return
  let dismissed = wasDismissed()
  // the sheet's cream stock
  publishTextures(['paper'])
  const el = document.createElement('div')
  el.className = 'rot'
  // non-modal: the copy layer behind it stays in reach
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-labelledby', 'rot-title')
  el.setAttribute('aria-describedby', 'rot-sub')
  el.tabIndex = -1
  el.innerHTML = `
    <div class="rot-card">
      <i class="rot-tape rot-tape--l" aria-hidden="true"></i><i class="rot-tape rot-tape--r" aria-hidden="true"></i>
      <div class="rot-art" aria-hidden="true">${ART}</div>
      <div class="rot-text">
        <p class="rot-k" aria-hidden="true">${MICROCOPY.signalEyebrow}</p>
        <h2 class="rot-title" id="rot-title">Turn your phone <em>upright</em></h2>
        <p class="rot-sub" id="rot-sub">This stage is set for portrait.</p>
        <p class="rot-actions"><button class="hud-btn rot-go" type="button">Continue anyway</button></p>
      </div>
    </div>
    <p class="sr-only" aria-live="assertive" data-rot-live></p>`
  // right after the skip link: Tab goes skip link → this card → the page
  const skip = document.querySelector('.skip-link')
  if (skip && skip.parentNode === document.body) skip.after(el)
  else document.body.prepend(el)

  const live = el.querySelector<HTMLElement>('[data-rot-live]')!
  const go = el.querySelector<HTMLButtonElement>('.rot-go')!
  const mq = matchMedia(ROTATE_QUERY)
  const listeners: ((shown: boolean) => void)[] = onChange ? [onChange] : []
  let on = false
  let turnTimer = 0
  const sync = () => {
    const want = mq.matches && !dismissed
    if (want === on) return
    on = want
    el.classList.toggle('is-on', on)
    document.documentElement.classList.toggle('is-rotate', on)
    clearTimeout(turnTimer)
    if (on) {
      // only the layers the card hides; the skip link and #track stay reachable
      holdInert('rotate', ['chrome', 'stages'].map(id => document.getElementById(id)))
      // focus stranded in a now-inert layer (or on <body>) comes to the card;
      // a reader already in the copy layer or on the skip link stays put
      const a = document.activeElement
      const keep = a instanceof HTMLElement && a !== document.body && (a.closest('#track') || a.matches('.skip-link'))
      if (!keep) el.focus({ preventScroll: true })
      document.addEventListener('keydown', onKey)
      // the phone turns upright once, after the card is on screen
      el.classList.remove('is-turned')
      void el.offsetWidth
      turnTimer = window.setTimeout(() => on && el.classList.add('is-turned'), 420)
      // announce ONCE: focus on the card already reads its label and
      // description, so the live region only speaks for a reader whose focus
      // stayed in the copy layer or on the skip link (it speaks when its text
      // changes after it is shown)
      if (keep)
        window.setTimeout(() => {
          if (on) live.textContent = 'Turn your phone upright. This stage is set for portrait.'
        }, 60)
    } else {
      releaseInert('rotate')
      document.removeEventListener('keydown', onKey)
      live.textContent = ''
    }
    for (const fn of listeners) fn(on)
  }

  // Escape dismisses it, like "Continue anyway" (a dialog should close on Escape)
  function onKey(e: KeyboardEvent) {
    if (!on || e.key !== 'Escape' || e.defaultPrevented) return
    e.preventDefault()
    go.click()
  }

  go.addEventListener('click', () => {
    const hadFocus = el.contains(document.activeElement)
    dismissed = true
    rememberDismissed()
    sync()
    if (!hadFocus) return
    // the card is gone: hand focus to the story, like the skip link does
    const main = document.getElementById('track')
    if (main && !main.closest('[inert], [aria-hidden="true"]')) main.focus({ preventScroll: true })
    else (document.activeElement as HTMLElement | null)?.blur?.()
  })

  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', sync)
  else mq.addListener?.(sync)
  gate = { el, mq, sync, listeners, on: () => on, onKey }
  sync()
}

/** The plain HTML page reads fine in any orientation. */
export function unmountRotateGate() {
  if (!gate) return
  const was = gate.on()
  if (typeof gate.mq.removeEventListener === 'function') gate.mq.removeEventListener('change', gate.sync)
  else gate.mq.removeListener?.(gate.sync)
  gate.el.remove()
  document.removeEventListener('keydown', gate.onKey)
  document.documentElement.classList.remove('is-rotate')
  releaseInert('rotate')
  if (was) for (const fn of gate.listeners) fn(false)
  gate = null
}
