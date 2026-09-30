import { BRAND, EVENT_FORM } from '../content'
import { publishTextures } from './texture'
import './eventForm.css'

/*
 * THE EVENT INQUIRY FORM — gloryphilly.com's "Book an Event" form, made real:
 * the Back Room's printed inquiry card (cream stock, ink type, the red G
 * stamp) with ruled fill-in fields. Copy: EVENT_FORM in content.ts.
 *
 *   Fields   First and Last Name · Email · Phone Number · Date of Event ·
 *            Summary of Event (EVENTS.fields; all required) + a honeypot.
 *   Send     EVENT_FORM.endpoint set → POST JSON
 *              {name, email, phone, date, summary, website, turnstileToken}
 *            (worker/ — Turnstile + SendGrid, reply-to the visitor).
 *            No endpoint → the inquiry is written into the visitor's email
 *            app (mailto: dave@gloryphilly.com, subject "Event Inquiry",
 *            every field in the body); the button and its note say so.
 *   A11y     labels, autocomplete, inline errors (aria-invalid +
 *            aria-describedby), an error summary (role=alert) whose links
 *            focus their field, focus moves to the first bad field, then to
 *            the result; the button is never disabled (aria-disabled while
 *            sending) so focus is never dropped.
 *
 * Two ways to use it:
 *
 *   // 1. anywhere (a page, a dialog, the no-WebGL fallback): a static card
 *   parent.append(createEventForm({ onDone: how => console.log(how) }))
 *
 *   // 2. the story: the REAL form lives in the events chapter's accessible
 *   //    section (#events in #track, never in the aria-hidden stage) and is
 *   //    docked fixed over the scene; the chapter drives its visibility
 *   const dock = dockEventForm(document.querySelector('#events [data-event-form]')!)
 *   dock.set(v)   // every frame, 0..1 (the form beat); onLeave: dock.set(0)
 *
 * The dock stays focusable while hidden (opacity only — never visibility or
 * display): Tab / a screen reader reaches it in reading order, the engine's
 * section focusin lands the story on the form beat (data-anchor on the
 * mount), and :focus-within shows it at once. When the story leaves the beat
 * while a field still holds focus (the visitor scrolled away), focus is let
 * go so the form can hide — never trapped over another scene.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export type EventFormKey = 'name' | 'email' | 'phone' | 'date' | 'summary'
const KEYS: EventFormKey[] = ['name', 'email', 'phone', 'date', 'summary']

export type EventInquiry = Record<EventFormKey, string>

export interface EventFormOpts {
  /** called once the inquiry is sent ('sent') or handed to the email app ('mailed') */
  onDone?: (how: 'sent' | 'mailed') => void
  /** tighter spacing, no brand line: for small slots */
  compact?: boolean
  /** 'card' (default): the cream printed card · 'dark': a stout panel */
  tone?: 'card' | 'dark'
}

/* ---------------- dates ---------------- */

const pad = (n: number) => String(n).padStart(2, '0')
/** today as YYYY-MM-DD in the visitor's own time zone */
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** "2026-11-14" → "Saturday, November 14, 2026" (local, no UTC shift) */
function longDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  try {
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

/* ---------------- the inquiry as an email ---------------- */

/** The inquiry as plain text: one "Label: value" line per field, the summary last. */
export function inquiryText(q: EventInquiry): string {
  const L = EVENT_FORM.labels
  return [
    `${L.name}: ${q.name}`,
    `${L.email}: ${q.email}`,
    `${L.phone}: ${q.phone}`,
    `${L.date}: ${longDate(q.date)}`,
    '',
    `${L.summary}:`,
    q.summary,
  ].join('\r\n')
}

/** mailto: Dave, subject "Event Inquiry", every field in the body. */
export function inquiryMailto(q?: EventInquiry): string {
  const subject = `?subject=${encodeURIComponent(EVENT_FORM.subject)}`
  return `mailto:${EVENT_FORM.to}${subject}${q ? `&body=${encodeURIComponent(inquiryText(q))}` : ''}`
}

/* ---------------- Cloudflare Turnstile (only with an endpoint + site key) ---------------- */

interface Turnstile {
  render(el: HTMLElement, o: Record<string, unknown>): string
  getResponse(id: string): string | undefined
  reset(id: string): void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}
let turnstileLoad: Promise<Turnstile | null> | null = null
function loadTurnstile(): Promise<Turnstile | null> {
  if (turnstileLoad) return turnstileLoad
  turnstileLoad = new Promise(resolve => {
    if (window.turnstile) return resolve(window.turnstile)
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => resolve(window.turnstile ?? null)
    s.onerror = () => resolve(null)
    document.head.append(s)
  })
  return turnstileLoad
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* ---------------- the form ---------------- */

let uid = 0

export function createEventForm(o: EventFormOpts = {}): HTMLElement {
  publishTextures(['paper'])
  const F = EVENT_FORM
  const L = F.labels
  const E = F.errors
  const id = `gef${++uid}`
  const tone = o.tone ?? 'card'

  const root = document.createElement('div')
  root.className = `gef gef--${tone}${o.compact ? ' gef--compact' : ''}`

  const field = (k: EventFormKey, n: number, control: string) => `
        <div class="gef-field gef-f-${k}">
          <label class="gef-label" for="${id}-${k}"><span class="gef-n" aria-hidden="true">${pad(n)}</span><span>${esc(L[k])}</span></label>
          ${control}
          <p class="gef-err" id="${id}-${k}-err" hidden></p>
        </div>`
  const large = esc(F.large).replace(esc(F.to), `<a class="gef-link" href="mailto:${esc(F.to)}">${esc(F.to)}</a>`)

  root.innerHTML = `
  <div class="gef-card">
    <div class="gef-body">
      <div class="gef-head">
        <div class="gef-head-t">
          <p class="gef-brand">${esc(F.brand)}</p>
          <h3 class="gef-title" id="${id}-title">${esc(F.title)}</h3>
          <p class="gef-req" id="${id}-req">${esc(F.required)}</p>
        </div>
        <img class="gef-stamp" src="${esc(BRAND.roundel)}" alt="" width="58" height="58" decoding="async" />
      </div>
      <form class="gef-form" novalidate aria-labelledby="${id}-title" aria-describedby="${id}-req">
        <div class="gef-hp" aria-hidden="true">
          <label for="${id}-hp">Leave this empty</label>
          <input id="${id}-hp" name="gef-hp" type="text" tabindex="-1" autocomplete="off" />
        </div>
        <div class="gef-grid">${field(
          'name',
          1,
          `<input class="gef-input" id="${id}-name" name="name" type="text" required autocomplete="name" autocapitalize="words" spellcheck="false" maxlength="120" />`,
        )}${field(
          'email',
          2,
          `<input class="gef-input" id="${id}-email" name="email" type="email" required autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="200" />`,
        )}${field('phone', 3, `<input class="gef-input" id="${id}-phone" name="phone" type="tel" required autocomplete="tel" inputmode="tel" maxlength="40" />`)}${field(
          'date',
          4,
          `<input class="gef-input gef-date" id="${id}-date" name="date" type="date" required min="${todayISO()}" />`,
        )}${field('summary', 5, `<textarea class="gef-input gef-text" id="${id}-summary" name="summary" required rows="3" maxlength="2000"></textarea>`)}
        </div>
        <div class="gef-turnstile" hidden></div>
        <div class="gef-summary" id="${id}-alert" role="alert"></div>
        <div class="gef-actions">
          <button class="hud-btn gef-submit" type="submit" aria-describedby="${id}-via"><span class="gef-spin" aria-hidden="true"></span><span class="gef-submit-t"></span><span class="gef-arrow" aria-hidden="true">→</span></button>
          <p class="gef-via" id="${id}-via"></p>
        </div>
      </form>
      <div class="gef-done" hidden>
        <p class="gef-done-t" tabindex="-1"></p>
        <p class="gef-done-b"></p>
        <dl class="gef-recap" hidden></dl>
        <div class="gef-mailed" hidden>
          <p class="gef-mailed-q">${esc(F.mailedHelp)} <a class="gef-link gef-mailed-link" href="${esc(inquiryMailto())}">${esc(F.to)}</a></p>
          <p class="gef-copy-status" role="status"></p>
        </div>
        <div class="gef-done-actions">
          <button class="hud-btn hud-btn--ghost gef-ghost gef-copy" type="button" hidden>${esc(F.copy)}</button>
          <button class="hud-btn hud-btn--ghost gef-ghost gef-again" type="button"></button>
        </div>
      </div>
      <p class="gef-large">${large}</p>
    </div>
  </div>`

  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
  const form = $<HTMLFormElement>('.gef-form')
  const body = $('.gef-body')
  const alertBox = $('.gef-summary')
  const submit = $<HTMLButtonElement>('.gef-submit')
  const submitT = $('.gef-submit-t')
  const via = $('.gef-via')
  const done = $('.gef-done')
  const doneT = $('.gef-done-t')
  const doneB = $('.gef-done-b')
  const recap = $('.gef-recap')
  const mailed = $('.gef-mailed')
  const mailedLink = $<HTMLAnchorElement>('.gef-mailed-link')
  const copyBtn = $<HTMLButtonElement>('.gef-copy')
  const copyStatus = $('.gef-copy-status')
  const again = $<HTMLButtonElement>('.gef-again')
  // the honeypot has a name no autofill knows, so a person's browser never fills it
  const hp = $<HTMLInputElement>(`#${id}-hp`)
  const tsSlot = $('.gef-turnstile')
  const input = (k: EventFormKey) => $<HTMLInputElement | HTMLTextAreaElement>(`#${id}-${k}`)
  const errEl = (k: EventFormKey) => $(`#${id}-${k}-err`)

  // the endpoint can be configured after the module loads (tests, a late config): read it live
  const mailMode = () => !F.endpoint
  const setLabels = () => {
    submitT.textContent = mailMode() ? F.submitMail : F.submit
    via.textContent = mailMode() ? F.submitMailNote : F.submitNote
  }
  setLabels()

  /* ---- validation ---- */

  const value = (k: EventFormKey) => input(k).value.trim()
  const values = (): EventInquiry => ({ name: value('name'), email: value('email'), phone: value('phone'), date: value('date'), summary: value('summary') })
  const check = (k: EventFormKey, v: string): string => {
    switch (k) {
      case 'name':
        return v ? '' : E.name
      case 'email':
        return !v ? E.email : EMAIL_RE.test(v) ? '' : E.emailBad
      case 'phone': {
        if (!v) return E.phone
        const n = v.replace(/\D/g, '').length
        return n >= 10 && n <= 20 ? '' : E.phoneBad
      }
      case 'date':
        return !/^\d{4}-\d{2}-\d{2}$/.test(v) ? E.date : v < todayISO() ? E.datePast : ''
      case 'summary':
        return v ? '' : E.summary
    }
  }
  const bad = new Set<EventFormKey>()
  /** show / clear one field's error; returns true when it is wrong */
  const mark = (k: EventFormKey, msg: string) => {
    const f = input(k)
    const er = errEl(k)
    if (msg) {
      bad.add(k)
      if (er.textContent !== msg) er.textContent = msg
      er.hidden = false
      f.setAttribute('aria-invalid', 'true')
      f.setAttribute('aria-describedby', er.id)
    } else {
      bad.delete(k)
      er.hidden = true
      er.textContent = ''
      f.removeAttribute('aria-invalid')
      f.removeAttribute('aria-describedby')
    }
    return !!msg
  }

  /** scroll a field into view inside the card only (never the page: the page scroll IS the story) */
  const into = (el: HTMLElement) => {
    if (body.scrollHeight <= body.clientHeight + 1) return
    const b = body.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top < b.top + 12) body.scrollTop += r.top - b.top - 40
    else if (r.bottom > b.bottom - 12) body.scrollTop += r.bottom - b.bottom + 40
  }
  const focusEl = (el: HTMLElement) => {
    el.focus({ preventScroll: true })
    into(el)
  }

  // the alert: cleared, then written a beat later so a repeat is announced again
  let alertTimer = 0
  const say = (html: string) => {
    window.clearTimeout(alertTimer)
    alertBox.innerHTML = ''
    if (!html) return
    alertTimer = window.setTimeout(() => (alertBox.innerHTML = html), 60)
  }
  const sayFields = (keys: EventFormKey[]) =>
    say(
      `<p class="gef-summary-t">${esc(keys.length === 1 ? F.checkOne : F.checkMany)} ${keys
        .map(k => `<a class="gef-link" href="#${id}-${k}" data-k="${k}">${esc(L[k])}</a>`)
        .join(', ')}</p>`,
    )
  /** a send error: the reason, then the way round it (a pre-filled email to Dave) */
  const sayFailed = (lead: string, q: EventInquiry) =>
    say(`<p class="gef-summary-t">${esc(lead)} ${esc(E.fallback)} <a class="gef-link" href="${esc(inquiryMailto(q))}">${esc(F.to)}</a>.</p>`)

  alertBox.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-k]')
    if (!a) return
    // never follow the hash: it would move the story
    e.preventDefault()
    focusEl(input(a.dataset.k as EventFormKey))
  })

  // punish late, reward early: a filled field is checked when you leave it,
  // a wrong one is re-checked as you type (and cleared the moment it's right)
  let tried = false
  for (const k of KEYS) {
    const f = input(k)
    f.addEventListener('blur', () => {
      const v = value(k)
      if (v || tried) mark(k, check(k, v))
    })
    f.addEventListener('input', () => {
      if (!bad.has(k)) return
      const msg = check(k, value(k))
      // while typing, only clear: a half-typed email isn't an error yet
      if (!msg) mark(k, '')
      if (!bad.size) say('')
    })
  }
  // midnight passes with the page open: keep the date's lower bound fresh
  const dateIn = input('date')
  dateIn.addEventListener('focus', () => dateIn.setAttribute('min', todayISO()))
  // an empty date's format hint reads as a placeholder (muted), not as a value
  const dateEmpty = () => dateIn.classList.toggle('is-empty', !dateIn.value)
  dateIn.addEventListener('input', dateEmpty)
  dateIn.addEventListener('change', dateEmpty)
  form.addEventListener('reset', () => requestAnimationFrame(dateEmpty))
  dateEmpty()

  /* ---- Turnstile: rendered on first use, only with an endpoint + site key ---- */

  let ts: Turnstile | null = null
  let tsId = ''
  let tsPrimed = false
  const primeTurnstile = () => {
    if (tsPrimed || mailMode() || !F.turnstileSiteKey) return
    tsPrimed = true
    tsSlot.hidden = false
    void loadTurnstile().then(t => {
      if (!t) return
      const mount = () => {
        if (!tsSlot.isConnected) return requestAnimationFrame(mount)
        ts = t
        tsId = t.render(tsSlot, { sitekey: F.turnstileSiteKey, theme: tone === 'dark' ? 'dark' : 'light', size: 'flexible', appearance: 'interaction-only' })
      }
      mount()
    })
  }
  root.addEventListener('focusin', primeTurnstile)
  root.addEventListener('pointerdown', primeTurnstile)
  ;(root as HTMLElement & { primeTurnstile?: () => void }).primeTurnstile = primeTurnstile
  /** a token, waiting a little for the invisible check to finish */
  const token = async () => {
    primeTurnstile()
    for (let i = 0; i < 25; i++) {
      const t = ts && tsId ? ts.getResponse(tsId) : ''
      if (t) return t
      await sleep(200)
    }
    return ''
  }

  /* ---- states ---- */

  let busy = false
  const setBusy = (on: boolean) => {
    busy = on
    root.classList.toggle('is-busy', on)
    form.setAttribute('aria-busy', String(on))
    if (on) submit.setAttribute('aria-disabled', 'true')
    else submit.removeAttribute('aria-disabled')
    submitT.textContent = on ? F.sending : mailMode() ? F.submitMail : F.submit
  }

  let last: EventInquiry | null = null
  const finish = (how: 'sent' | 'mailed', q: EventInquiry | null) => {
    last = q
    // keep the card's size: the result sits where the form was
    done.style.minHeight = `${Math.round(form.offsetHeight)}px`
    form.hidden = true
    done.hidden = false
    root.classList.add('is-done')
    doneT.textContent = how === 'sent' ? F.sentTitle : F.mailedTitle
    doneB.textContent = how === 'sent' ? F.sentBody : F.mailedBody
    mailed.hidden = how !== 'mailed'
    copyBtn.hidden = how !== 'mailed'
    copyStatus.textContent = ''
    again.textContent = how === 'sent' ? F.again : F.edit
    if (q) mailedLink.href = inquiryMailto(q)
    // the inquiry as sent: a ruled recap, like the printed card's lines
    recap.hidden = !q
    recap.innerHTML = q
      ? KEYS.map(
          (k, i) =>
            `<div class="gef-recap-row${k === 'summary' ? ' is-summary' : ''}"><dt><span class="gef-n" aria-hidden="true">${pad(i + 1)}</span>${esc(L[k])}</dt><dd>${esc(k === 'date' ? longDate(q[k]) : q[k])}</dd></div>`,
        ).join('')
      : ''
    if (how === 'sent') {
      form.reset()
      tried = false
    }
    say('')
    body.scrollTop = 0
    doneT.focus({ preventScroll: true })
    o.onDone?.(how)
  }

  again.addEventListener('click', () => {
    done.hidden = true
    done.style.minHeight = ''
    form.hidden = false
    root.classList.remove('is-done')
    setLabels()
    focusEl(input('name'))
  })

  copyBtn.addEventListener('click', async () => {
    if (!last) return
    const text = `${EVENT_FORM.subject}\r\n\r\n${inquiryText(last)}`
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'
      document.body.append(ta)
      ta.select()
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      ta.remove()
      copyBtn.focus({ preventScroll: true })
    }
    copyStatus.textContent = ok ? F.copied : F.copyFailed
  })

  /* ---- submit ---- */

  form.addEventListener('submit', async e => {
    e.preventDefault()
    if (busy) return
    // honeypot: people never fill it — look done, send nothing
    if (hp.value) return finish('sent', null)
    tried = true
    const q = values()
    const wrong = KEYS.filter(k => mark(k, check(k, q[k])))
    if (wrong.length) {
      sayFields(wrong)
      focusEl(input(wrong[0]))
      return
    }
    say('')

    if (mailMode()) {
      // a static host: write the inquiry into the visitor's email app. The
      // event is cancelable (tests, analytics) and carries the href.
      const href = inquiryMailto(q)
      const go = root.dispatchEvent(new CustomEvent('gef:mailto', { detail: { href, inquiry: q }, bubbles: true, cancelable: true }))
      if (go) window.location.href = href
      return finish('mailed', q)
    }

    setBusy(true)
    try {
      let t = ''
      if (F.turnstileSiteKey) {
        t = await token()
        if (!t) {
          sayFailed(E.unverified, q)
          return
        }
      }
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = window.setTimeout(() => ctrl?.abort(), 20000)
      let res: Response
      try {
        res = await fetch(F.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ...q, website: '', turnstileToken: t }),
          signal: ctrl?.signal,
        })
      } finally {
        window.clearTimeout(timer)
      }
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string }
        // the Worker's 4xx messages are for people ("Please complete the verification")
        const msg = res.status < 500 && b.error ? `${b.error.replace(/\.?$/, '.')}` : E.failed
        sayFailed(msg, q)
        if (ts && tsId) ts.reset(tsId)
        return
      }
      finish('sent', q)
    } catch {
      sayFailed(E.failed, q)
      // a token is single-use: get a fresh one for the next try
      if (ts && tsId) ts.reset(tsId)
    } finally {
      setBusy(false)
    }
  })

  // the button is aria-disabled (not disabled) while sending, so it keeps focus
  submit.addEventListener('click', e => {
    if (busy) e.preventDefault()
  })

  return root
}

/* ---------------- the dock: the real form over the scene ---------------- */

export interface EventFormDock {
  /** the mount (now the fixed dock); the form card is its child */
  el: HTMLElement
  /** the form card (createEventForm's root) */
  form: HTMLElement
  /** 0..1, every frame: the form beat's visibility (opacity + a small settle; never hides it from Tab) */
  set(v: number): void
  /** true while focus is inside the form */
  readonly active: boolean
}

/** after a field takes focus, a phone keyboard may nudge the page: don't let go of focus for this long */
const GRACE = 1200

/**
 * Dock the Event Inquiry Form over the scene. `mount` is the events
 * chapter's `[data-event-form]` in its accessible section (see the doc block
 * at the top). The form is created inside it if it isn't there yet, and the
 * mount is moved out of the visually hidden `.sr-copy` block to sit right
 * after it in the same <section> (the copy layer's focus-pill styles and
 * scroll-key blur are for its links, not for a form someone is typing in).
 */
export function dockEventForm(mount: HTMLElement, o: EventFormOpts = {}): EventFormDock {
  let form = mount.querySelector<HTMLElement>(':scope > .gef')
  if (!form) {
    form = createEventForm(o)
    mount.append(form)
  }
  const copy = mount.parentElement?.closest('.sr-copy')
  if (copy) copy.after(mount)
  mount.classList.add('gef-dock')
  const card = form
  const body = card.querySelector<HTMLElement>('.gef-body')!

  let v = -1
  let shown = false
  let focusAt = -1e9
  let timer = 0
  const inside = () => mount.contains(document.activeElement)

  mount.addEventListener('focusin', () => {
    focusAt = performance.now()
  })

  // the story left the beat with a field still focused (the visitor scrolled
  // away): let go, so the form hides instead of floating over the next scene
  const letGo = () => {
    window.clearTimeout(timer)
    if (shown || !inside()) return
    const wait = GRACE - (performance.now() - focusAt)
    if (wait > 0) {
      timer = window.setTimeout(letGo, wait + 30)
      return
    }
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  // a card taller than its slot (errors on a small phone, 200% zoom) scrolls
  // inside itself — and only then keeps the wheel from the story (Lenis)
  const fit = () => {
    const over = body.scrollHeight > body.clientHeight + 1
    if (over) body.setAttribute('data-lenis-prevent', '')
    else body.removeAttribute('data-lenis-prevent')
  }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(fit)
    ro.observe(body)
    ro.observe(card)
  }
  window.addEventListener('resize', fit)

  const prime = (card as HTMLElement & { primeTurnstile?: () => void }).primeTurnstile

  return {
    el: mount,
    form: card,
    get active() {
      return inside()
    },
    set(x: number) {
      const n = Math.max(0, Math.min(1, x))
      if (Math.abs(n - v) < 0.001) return
      v = n
      mount.style.setProperty('--gef-s', n.toFixed(3))
      const was = shown
      shown = n > 0.5
      if (shown !== was) {
        mount.classList.toggle('is-shown', shown)
        if (shown) {
          fit()
          prime?.()
        } else letGo()
      }
    },
  }
}
