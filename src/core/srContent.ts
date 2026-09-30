import {
  BAR, BOTTLES, BRAND, CELLAR_UI, CITY_WIDE, COCKTAILS, CREDIT, DRAFTS, EVENTS, HOURS, KITCHEN_HOURS, LINKS, MENU, PEOPLE, RESERVATIONS, SECTIONS, SOCIALS, WINE,
} from '../content'
import { createEventForm } from '../ui/eventForm'

/*
 * The accessible layer. Each chapter's copy, as plain linear semantic HTML,
 * lives inside that chapter's scroll <section> in #track. It is visually
 * hidden (the canvas + stages are the visual layer and are aria-hidden), but
 * screen readers, crawlers and keyboard users get the whole story in order.
 * Focusing a link here moves the visuals to its chapter (Engine.land), and
 * the focused link itself becomes visible (.sr-copy :focus-visible in base.css).
 *
 * Item stops carry data-anchor="i" → chapter.anchors[i]. The ORDER of the
 * anchors per chapter is the contract with each chapter module:
 *   taps     0 American · 1 International · 2 Local (DRAFTS groups, in order)
 *   kitchen  0–4 MENU sections in order (Starters, Soups & Salads, Sandwiches, Specials, Sweets)
 *   cellar   0 bottles American · 1 bottles International · 2 bottles Local · 3 wine · 4 cocktails
 *   people   0 Dave · 1 Kevin Wieman · 2 Pier Mutovic
 *   events   0 the room (photos + copy) · 1 the inquiry
 *
 * renderFallback() reuses the same builders, visibly, when WebGL2 is missing.
 */

const esc = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const ext = (href: string, label: string, anchor?: number) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener"${anchor != null ? ` data-anchor="${anchor}"` : ''}>${esc(label)}<span class="sr-note"> (opens in a new tab)</span></a>`

/** An in-page stop that moves the story to item i of a chapter (see Chapter.anchors). */
const stop = (id: string, i: number, label: string) => `<a href="#${id}" data-anchor="${i}">${esc(label)}</a>`

const marks = (m?: string[]) => (m?.length ? ` (${m.map(x => (x === 'V' ? 'vegetarian' : x === 'GF' ? 'gluten free' : x)).join(', ')})` : '')

const COPY: Record<string, () => string> = {
  hero: () => `
    <p class="sr-kicker">${esc(BRAND.motto)}</p>
    <h1 tabindex="0">${esc(BRAND.name)}</h1>
    <p>${esc(BRAND.tagline)}</p>
    <p>${esc(BRAND.street)}, ${esc(BRAND.city)}</p>
    <p>${ext(LINKS.reserve.url, LINKS.reserve.label)} · ${ext(LINKS.menus.url, 'See the menu')} · <a href="#taps" data-land="taps">What’s on tap</a></p>`,

  taps: () => `
    <p>${esc(SECTIONS.taps.eyebrow)}</p>
    <h2 tabindex="0">${esc(SECTIONS.taps.title)}</h2>
    <p>${esc(BAR.intro)}</p>
    <h3>Drafts</h3>
    ${DRAFTS.map((g, i) => `<h4>${stop('taps', i, g.title)}</h4><ul>${g.beers.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`).join('')}
    <p>Last Update: ${esc(BAR.lastUpdate)}</p>
    <p>${ext(LINKS.app.url, BAR.app)} · ${ext(LINKS.untappd.url, LINKS.untappd.label)}</p>`,

  citywide: () => `
    <p>${esc(SECTIONS.citywide.eyebrow)}</p>
    <h2 tabindex="0">${esc(CITY_WIDE.title)}</h2>
    <p>${esc(CITY_WIDE.line)}</p>
    <ul>${CITY_WIDE.items.map(i => `<li>${esc(i.detail)} ${esc(i.name)}</li>`).join('')}</ul>`,

  kitchen: () => `
    <p>${esc(SECTIONS.kitchen.eyebrow)}</p>
    <h2 tabindex="0">${esc(SECTIONS.kitchen.title)}</h2>
    ${MENU.map(
      (sec, i) => `<h3>${stop('kitchen', i, sec.title)}</h3>${sec.note ? `<p>${esc(sec.note)}</p>` : ''}
      <ul>${sec.items.map(d => `<li><strong>${esc(d.name)}</strong>${marks(d.marks)} · ${esc(d.price)} — ${esc(d.desc)}</li>`).join('')}</ul>`,
    ).join('')}
    <p>${ext(LINKS.order.url, LINKS.order.label)}</p>`,

  cellar: () => `
    <p>${esc(SECTIONS.cellar.eyebrow)}</p>
    <h2 tabindex="0">${esc(CELLAR_UI.bottles)}</h2>
    ${BOTTLES.map((g, i) => `<h3>${stop('cellar', i, g.title)}</h3><ul>${g.beers.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`).join('')}
    <h2>${esc(SECTIONS.cellar.title)}</h2>
    <h3>${stop('cellar', 3, 'Wine')}</h3>
    <p>${esc(BAR.wine)}</p>
    <ul>${WINE.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
    <h3>${stop('cellar', 4, 'Specialty Cocktails')}</h3>
    <p>${esc(BAR.cocktails)}</p>
    <ul>${COCKTAILS.map(c => `<li><strong>${esc(c.name)}</strong> — ${esc(c.spec)}</li>`).join('')}</ul>`,

  people: () => `
    <p>${esc(SECTIONS.people.eyebrow)}</p>
    <h2 tabindex="0">${esc(SECTIONS.people.title)}</h2>
    ${PEOPLE.map((p, i) => `<h3>${stop('people', i, `${p.name}, ${p.role}`)}</h3>${p.bio.map(b => `<p>${esc(b)}</p>`).join('')}`).join('')}`,

  // the Event Inquiry Form is a real form (src/ui/eventForm.ts): the mount is filled in
  // buildChapterCopy; the events chapter docks it over the scene (anchor 1), the
  // fallback shows it inline. Its last line is the note for parties of more than 10.
  events: () => `
    <p>${esc(SECTIONS.events.eyebrow)}</p>
    <h2 tabindex="0">${esc(EVENTS.title)}</h2>
    ${EVENTS.body.map((b, i) => (i === 0 ? `<p>${stop('events', 0, b)}</p>` : `<p>${esc(b)}</p>`)).join('')}
    <p>${ext(LINKS.events.url, LINKS.events.label, 0)}</p>
    <div class="event-form-mount" data-event-form data-anchor="1"></div>`,

  visit: () => `
    <p>${esc(SECTIONS.visit.eyebrow)}</p>
    <h2 tabindex="0">${esc(SECTIONS.visit.title)}</h2>
    <p>${esc(BRAND.name)} · ${ext(BRAND.mapUrl, `${BRAND.street}, ${BRAND.city}`)}</p>
    <p>Phone: <a href="${esc(BRAND.phoneHref)}">${esc(BRAND.phone)}</a> · Email: <a href="mailto:${esc(BRAND.email)}">${esc(BRAND.email)}</a></p>
    <h3>Hours</h3>
    <ul>${HOURS.map(h => `<li>${esc(h.day)}: ${esc(h.hours)}</li>`).join('')}</ul>
    <h3>Kitchen Hours</h3>
    <ul>${KITCHEN_HOURS.map(h => `<li>${esc(h.day)}: ${esc(h.hours)}</li>`).join('')}</ul>
    <p>${ext(LINKS.reserve.url, LINKS.reserve.label)} · ${ext(LINKS.order.url, LINKS.order.label)} · ${ext(LINKS.giftCards.url, LINKS.giftCards.label)}</p>
    <p>${esc(RESERVATIONS.large)}</p>
    <p>${SOCIALS.map(s => ext(s.url, `${s.name}: ${s.handle}`)).join(' · ')} · ${ext(LINKS.untappd.url, 'Untappd')} · ${ext(LINKS.app.url, 'Mobile App')}</p>
    <p>© ${new Date().getFullYear()} ${esc(BRAND.name)} · ${ext(CREDIT.url, CREDIT.text)}</p>
    <p><a href="#hero" data-land="hero">Back to top</a></p>`,
}

/** Visually hidden, linear copy for one chapter (null for unknown ids). */
export function buildChapterCopy(id: string, visible = false): HTMLElement | null {
  const html = COPY[id]
  if (!html) return null
  const div = document.createElement('div')
  div.className = visible ? 'fallback-copy' : 'sr-copy'
  div.innerHTML = html()
  div.querySelectorAll<HTMLElement>('[data-event-form]').forEach(m => m.append(createEventForm()))
  // in-page links drive the story instead of jumping to an empty section
  div.querySelectorAll<HTMLAnchorElement>('a[data-land]').forEach(a =>
    a.addEventListener('click', e => {
      const target = a.dataset.land!
      const hark = window.__hark
      if (!hark) return
      e.preventDefault()
      if (target === 'hero') hark.land('hero')
      else hark.land(target)
      hark.engine.focusChapter(target)
    }),
  )
  // item stops only steer the story (focus does the work); never follow the hash
  div.querySelectorAll<HTMLAnchorElement>('a[data-anchor][href^="#"]:not([data-land])').forEach(a =>
    a.addEventListener('click', e => {
      e.preventDefault()
      const section = a.closest('section')
      const hark = window.__hark
      if (!section || !hark) return
      const slot = hark.engine.slots.find(s => s.def.id === section.id)
      const at = slot?.chapter.anchors?.[Number(a.dataset.anchor)]
      if (at != null) hark.land(section.id, true, at)
    }),
  )
  div.querySelectorAll<HTMLButtonElement>('[data-copy-email]').forEach(btn =>
    btn.addEventListener('click', async () => {
      const status = div.querySelector<HTMLElement>('[data-copy-status]')
      let ok = false
      try {
        await navigator.clipboard.writeText(BRAND.email)
        ok = true
      } catch {
        const ta = document.createElement('textarea')
        ta.value = BRAND.email
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try {
          ok = document.execCommand('copy')
        } catch {
          ok = false
        }
        ta.remove()
      }
      if (status) {
        status.textContent = ok ? 'Copied' : `Copy failed — the address is ${BRAND.email}`
        window.setTimeout(() => (status.textContent = ''), 2200)
      }
    }),
  )
  return div
}

export const CHAPTER_COPY_IDS = Object.keys(COPY)
