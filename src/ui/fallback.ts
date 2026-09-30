import { BRAND, CONTACT, MICROCOPY } from '../content'
import { CHAPTER_COPY_IDS, buildChapterCopy } from '../core/srContent'
import { CHAPTERS } from '../chapters/index'
import { WORDMARK, markSvg } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'
import { releaseScene } from './prefs'
import { publishTextures } from './texture'

/*
 * The plain HTML version, for browsers without WebGL2 (and the last resort
 * if boot fails or the GPU context is gone for good): every chapter's copy,
 * in story order, visible — set as a GIG POSTER / SETLIST: one long sheet
 * of cream stock taped to the dark wall of the room. Fraunces for the
 * headlines, the last word of each in the Caveat hand in barn red (a note
 * on a setlist), Instrument Sans for the words, Spline Sans Mono for the
 * small print. Each chapter is a numbered line of the setlist ("03", its
 * name in the hand, a marker rule); numbered lists (the story beats) carry
 * the setlist's numbers. The GJP monogram sits cream on a little black
 * headstock badge, as on the guitar. The numbers, rules, tape and the
 * colophon are decorative (aria-hidden or plainly not claims); the copy is
 * the live site's, verbatim, from srContent (buildChapterCopy). Links stay
 * underlined. Nothing here moves. Landmarks: the header (banner, with the
 * Primary nav) and the footer (contentinfo) sit beside <main> (#track),
 * which holds only the chapters.
 */
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
  publishTextures(['paper'])

  // landmarks: the header (banner) and footer (contentinfo) are <body>'s own
  // children, around <main> (#track), which holds only the chapters
  document.querySelectorAll('body > .fb-top, body > .fb-foot').forEach(n => n.remove())
  const has = (id: string) => CHAPTERS.some(c => c.id === id) && CHAPTER_COPY_IDS.includes(id)
  const nav = [
    ['listen', 'Listen'],
    ['watch', 'Videos'],
    ['story', 'Bio'],
    ['gear', 'Gear'],
  ]
    .filter(([id]) => has(id))
    .map(([id, name]) => `<a href="#${id}">${name}</a>`)
    .join('')
  const header = document.createElement('header')
  header.className = 'fb-top fb-band'
  header.innerHTML = `
    <i class="fb-tape fb-tape--l" aria-hidden="true"></i><i class="fb-tape fb-tape--r" aria-hidden="true"></i>
    <a class="fb-brand" href="#hero" aria-label="${BRAND.name}, top of the page">
      <span class="fb-mark" aria-hidden="true">${markSvg('fb-mark-svg')}</span>
      <span class="fb-brand-text" aria-hidden="true">${WORDMARK}</span>
    </a>
    <nav class="fb-nav" aria-label="Primary">
      ${nav}
      <a class="fb-cta" href="${has('contact') ? '#contact' : CONTACT.href}">Get in touch</a>
    </nav>`
  const footer = document.createElement('footer')
  footer.className = 'fb-foot fb-band'
  // a poster's colophon: what it is set in (true of this page), no claims
  footer.innerHTML = `
    <span class="fb-mark fb-foot-mark" aria-hidden="true">${markSvg('fb-foot-svg')}</span>
    <p class="fb-credit">${MICROCOPY.signalEyebrow}</p>
    <p class="fb-colophon">Set in Fraunces, <em>Caveat</em>, Instrument Sans and Spline Sans Mono.</p>
    <i class="fb-tape fb-tape--b" aria-hidden="true"></i>`
  root.before(header)
  root.after(footer)
  const rooms = CHAPTERS.filter(c => CHAPTER_COPY_IDS.includes(c.id)).length
  root.innerHTML = `<div class="fb fb-band">
    <p class="fb-kicker" aria-hidden="true"><i></i>The setlist · ${String(rooms).padStart(2, '0')}</p>
    <div class="fb-main" id="fb-main" tabindex="-1"></div>
  </div>`

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
    // "Listen", "Get in touch", "Back to top": plain in-page links here (a
    // clone drops the handler that would steer a story that may be gone)
    copy.querySelectorAll<HTMLAnchorElement>('a[data-land]').forEach(a => {
      const plain = a.cloneNode(true) as HTMLAnchorElement
      plain.removeAttribute('data-land')
      plain.removeAttribute('data-anchor')
      a.replaceWith(plain)
    })
    accentHeading(copy)
    // the setlist's numbers for numbered lists — story beats and track
    // listings (decorative: the <ol> already says it)
    copy.querySelectorAll('ol > li').forEach(li => {
      const n = document.createElement('span')
      n.className = 'fb-n'
      n.setAttribute('aria-hidden', 'true')
      n.textContent = String([...li.parentElement!.children].indexOf(li) + 1).padStart(2, '0')
      const h = li.querySelector(':scope > h3')
      if (h) h.prepend(n)
      else {
        li.classList.add('fb-track')
        li.parentElement!.classList.add('fb-tracks')
        li.prepend(n)
      }
    })
    const sec = document.createElement('section')
    sec.className = `fb-room fb-room--${id}`
    sec.id = id
    const heading = copy.querySelector<HTMLElement>('h1, h2')
    if (heading) {
      heading.id = `fb-${id}-title`
      sec.setAttribute('aria-labelledby', heading.id)
    }
    // the setlist line (decorative): "03", then the chapter's name in the hand
    const label = CHAPTERS.find(c => c.id === id)?.label
    const wall = document.createElement('p')
    wall.className = 'fb-wall'
    wall.setAttribute('aria-hidden', 'true')
    wall.innerHTML = `<span class="fb-wall-n">${String(i + 1).padStart(2, '0')}</span>${label ? `<em>${label}</em>` : ''}<i></i>`
    sec.appendChild(wall)
    const body = document.createElement('div')
    body.className = 'fb-room-body'
    body.appendChild(copy)
    sec.appendChild(body)
    main.appendChild(sec)
  })
  window.scrollTo(0, 0)
}

/**
 * The heading's last word becomes the accent: the Caveat hand in barn red
 * ("Greg Jones <em>Project</em>"). Only the markup changes; the heading
 * reads exactly as before.
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
