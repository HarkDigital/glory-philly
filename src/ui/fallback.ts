import { BRAND, EVENTS, FEATURED_DISHES, LINKS, MASCOT, PEOPLE, PHOTOS } from '../content'
import { CHAPTER_COPY_IDS, buildChapterCopy } from '../core/srContent'
import { CHAPTERS, NAV_NAMES } from '../chapters/index'
import { WORDMARK, roundelSvg } from './mark'
import { hoursSummary } from './chrome'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'
import { releaseScene } from './prefs'
import { publishTextures } from './texture'

/*
 * The plain HTML version, for browsers without WebGL2 (and the last resort
 * if boot fails or the GPU context is gone for good): every chapter's copy,
 * in story order, visible — set like Glory itself: cream type on stout
 * black, Alfa Slab One headings (the painted wall sign), the accent word in
 * the same slab in beer amber, Inter Tight for reading and, in caps,
 * for the small print, the red G roundel as the stamp. Each chapter is a
 * numbered room ("03 · The Kitchen") on the brick; the house's own photos sit
 * where they belong (the wall sign on the welcome, the plates beside the
 * menu, the crew beside their bios, the room beside the events). The copy is
 * the live site's, verbatim, from srContent (buildChapterCopy); photo alt
 * text is the dish / person name from content.ts. Links stay underlined.
 * Nothing here moves. Landmarks: the header (banner, with the Primary nav)
 * and the footer (contentinfo) sit beside <main> (#track), which holds only
 * the chapters.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const img = (src: string, alt: string, cls = '') =>
  `<img class="fb-img ${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`

/** the photos for each room (rendered beside / inside its copy) */
function photosFor(id: string): string {
  switch (id) {
    case 'hero':
      return `<figure class="fb-hero-fig">${img(PHOTOS.wallSign, `${BRAND.name}: the painted wall sign, “${BRAND.motto}”`, 'fb-hero-img')}</figure>`
    case 'kitchen':
      return `<div class="fb-plates">${FEATURED_DISHES.slice(0, 6)
        .map(d => `<figure class="fb-plate">${img(d.photo!, d.name)}<figcaption>${esc(d.name)}</figcaption></figure>`)
        .join('')}</div>`
    case 'cellar':
      return `<figure class="fb-side-fig">${img(PHOTOS.diningRoom, `The dining room at ${BRAND.name}`)}</figure>`
    case 'events':
      return `<div class="fb-strip">${EVENTS.photos
        .slice(0, 4)
        .map((p, i) => img(p, `${EVENTS.title}, photo ${i + 1} of ${EVENTS.photos.length}`))
        .join('')}</div>`
    case 'visit':
      return `<figure class="fb-side-fig">${img(PHOTOS.sidewalk, `A sidewalk table outside ${BRAND.name}, ${BRAND.street}`)}</figure>`
    default:
      return ''
  }
}

export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  document.documentElement.classList.remove('is-rotate', 'motion-off')
  unmountRotateGate()
  // boot can fail while the loader or the menu still holds the page inert: let go
  releaseInert('loader')
  releaseInert('menu')
  releaseScene('menu')
  document.getElementById('loader')?.remove()
  document.getElementById('gl')?.remove()
  // the live chrome drives a story that is no longer there
  document.getElementById('chrome')?.replaceChildren()
  window.dispatchEvent(new Event('hark:fallback'))
  root.style.pointerEvents = 'auto'
  root.inert = false
  root.removeAttribute('aria-hidden')
  publishTextures(['brick', 'paper'])

  // landmarks: the header (banner) and footer (contentinfo) are <body>'s own
  // children, around <main> (#track), which holds only the chapters
  document.querySelectorAll('body > .fb-top, body > .fb-foot').forEach(n => n.remove())
  const has = (id: string) => CHAPTERS.some(c => c.id === id) && CHAPTER_COPY_IDS.includes(id)
  const nav = ['taps', 'kitchen', 'events', 'visit']
    .filter(has)
    .map(id => `<a href="#${id}">${esc(NAV_NAMES[id] ?? id)}</a>`)
    .join('')
  const header = document.createElement('header')
  header.className = 'fb-top'
  header.innerHTML = `
    <a class="fb-brand" href="#hero" aria-label="${esc(BRAND.name)}, top of the page">
      <span class="fb-mark" aria-hidden="true">${roundelSvg('fb-mark-svg')}</span>
      <span class="fb-brand-text" aria-hidden="true">${WORDMARK}</span>
    </a>
    <nav class="fb-nav" aria-label="Primary">
      ${nav}
      <a class="fb-cta" href="${esc(LINKS.reserve.url)}" target="_blank" rel="noopener">${esc(LINKS.reserve.label)}<span class="sr-note"> (opens in a new tab)</span></a>
    </nav>`
  const footer = document.createElement('footer')
  footer.className = 'fb-foot'
  footer.innerHTML = `
    <span class="fb-mark fb-foot-mark" aria-hidden="true">${roundelSvg('fb-mark-svg')}</span>
    <div class="fb-foot-body">
      <p class="fb-foot-name">${esc(BRAND.name)}</p>
      <p><a href="${esc(BRAND.mapUrl)}" target="_blank" rel="noopener">${esc(BRAND.street)}, ${esc(BRAND.city)}<span class="sr-note"> (opens in a new tab)</span></a> · <a href="${esc(BRAND.phoneHref)}">${esc(BRAND.phone)}</a></p>
      <p class="fb-foot-hours">${hoursSummary()
        .map(h => `${esc(h.days)} ${esc(h.hours)}`)
        .join(' · ')}</p>
    </div>
    <figure class="fb-mascot">${img(MASCOT.photo, MASCOT.name)}</figure>`
  root.before(header)
  root.after(footer)
  root.innerHTML = `<div class="fb"><div class="fb-main" id="fb-main" tabindex="-1"></div></div>`

  // a fresh skip link: the live one's handler focuses a chapter heading that is gone
  const skip = document.querySelector<HTMLAnchorElement>('.skip-link')
  if (skip) {
    const fresh = skip.cloneNode(true) as HTMLAnchorElement
    fresh.href = '#fb-main'
    skip.replaceWith(fresh)
  }

  const main = root.querySelector<HTMLElement>('#fb-main')!
  // story order (the chapters' order), then any copy the story doesn't use
  const order = CHAPTERS.map(c => c.id).filter(id => CHAPTER_COPY_IDS.includes(id))
  for (const id of CHAPTER_COPY_IDS) if (!order.includes(id)) order.push(id)
  order.forEach((id, i) => {
    const copy = buildChapterCopy(id, true)
    if (!copy) return
    // heading Tab stops only drive the live story
    copy.querySelectorAll('h1[tabindex], h2[tabindex]').forEach(h => h.removeAttribute('tabindex'))
    // item "stops" only steer the live story; here they're just text
    copy.querySelectorAll<HTMLAnchorElement>('a[data-anchor][href^="#"]:not([data-land])').forEach(a => {
      const span = document.createElement('span')
      span.textContent = a.textContent
      a.replaceWith(span)
    })
    // "See the menu", "Back to top": plain in-page links here (a clone drops
    // the handler that would steer a story that may be gone)
    copy.querySelectorAll<HTMLAnchorElement>('a[data-land]').forEach(a => {
      const plain = a.cloneNode(true) as HTMLAnchorElement
      plain.removeAttribute('data-land')
      plain.removeAttribute('data-anchor')
      a.replaceWith(plain)
    })
    // the external reservation link reads as the red pill
    copy.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
      if (a.getAttribute('href') === LINKS.reserve.url) a.classList.add('fb-pill')
    })
    accentHeading(copy)
    // the crew: each bio gets its portrait
    if (id === 'people')
      copy.querySelectorAll('h3').forEach((h, k) => {
        const p = PEOPLE[k]
        if (!p) return
        const fig = document.createElement('figure')
        fig.className = 'fb-person'
        fig.innerHTML = img(p.photo, `${p.name}, ${p.role}`)
        h.before(fig)
      })
    const sec = document.createElement('section')
    sec.className = `fb-room fb-room--${id}`
    sec.id = id
    const heading = copy.querySelector<HTMLElement>('h1, h2')
    if (heading) {
      heading.id = `fb-${id}-title`
      sec.setAttribute('aria-labelledby', heading.id)
    }
    // the room's number and name (decorative): "03 · The Kitchen"
    const label = CHAPTERS.find(c => c.id === id)?.label
    if (id !== 'hero') {
      const wall = document.createElement('p')
      wall.className = 'fb-wall'
      wall.setAttribute('aria-hidden', 'true')
      wall.innerHTML = `<span class="fb-wall-n">${String(i + 1).padStart(2, '0')}</span>${label ? `<span>${esc(label)}</span>` : ''}<i></i>`
      sec.appendChild(wall)
    }
    const body = document.createElement('div')
    body.className = 'fb-room-body'
    body.appendChild(copy)
    const pics = photosFor(id)
    if (pics) {
      const holder = document.createElement('div')
      holder.className = 'fb-pics'
      holder.innerHTML = pics
      if (id === 'hero') sec.appendChild(holder)
      // the plates and the room right under their headline
      else if ((id === 'kitchen' || id === 'events') && heading) heading.after(holder)
      else body.appendChild(holder)
    }
    sec.appendChild(body)
    main.appendChild(sec)
  })
  window.scrollTo(0, 0)
}

/**
 * The heading's last word becomes the accent: the same slab in beer amber
 * ("All Day <em>Menu</em>") — never an italic serif. Only the markup changes; the
 * heading reads exactly as before.
 */
function accentHeading(copy: HTMLElement) {
  const h = copy.querySelector<HTMLElement>('h1, h2')
  if (!h || h.children.length) return
  const text = h.textContent ?? ''
  const m = text.match(/^(.*\s)(\S+)\s*$/)
  if (!m) return
  h.textContent = m[1]
  const em = document.createElement('em')
  em.textContent = m[2]
  h.appendChild(em)
}
