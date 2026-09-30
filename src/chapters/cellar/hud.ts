import { BAR, BOTTLES, CELLAR_UI, COCKTAILS, SECTIONS, WINE } from '../../content'
import { el, rise, setRise } from '../../core/dom'
import { WINE_DOTS } from './wine'

/*
 * The Cellar's DOM: the headline, one card per beat (three bottle groups,
 * wine, cocktails) docked left on wide screens and as a bottom sheet on
 * portrait. Cards and pages switch by class (CSS transitions ≤ 0.35 s, off
 * under reduced motion); headings rise. Everything is idempotent per frame.
 */

export type Layout = 'wide' | 'short' | 'tablet' | 'phone'

export function layoutOf(w: number, h: number): Layout {
  if (h > w * 1.05) return w >= 700 ? 'tablet' : 'phone'
  if (h < 560) return 'short'
  return 'wide'
}

/** how a group's names are paged / columned per layout */
function plan(id: string, n: number, layout: Layout, all: boolean): { per: number; cols: number } {
  if (id === 'local') return { per: n, cols: 1 }
  if (id === 'american') return layout === 'phone' ? { per: n, cols: 1 } : { per: n, cols: 2 }
  // international: 42 names
  if (layout === 'phone') return { per: 14, cols: 1 }
  if (layout === 'short' || !all) return { per: 14, cols: 2 }
  return { per: n, cols: 3 }
}

export interface BeatState {
  /** 'american' | 'international' | 'local' | 'wine' | 'cocktails' | null */
  beat: string | null
  /** international page (= shelf) 0..2 */
  page: number
  /** active cocktail 0..6 */
  cocktail: number
  /** the headline on screen: the source site's two headings, BOTTLES then WINE & SPECIALTY COCKTAILS */
  head: 'bottles' | 'wine' | null
  /** the item the 3D singles out (the bottle the camera settles on, the wine pouring): its list index, or -1 */
  item: number
}

export class CellarHud {
  root: HTMLElement
  private heads: Record<'bottles' | 'wine', { block: HTMLElement; h2: HTMLElement }>
  private scrim: HTMLElement
  private cards: Record<string, HTMLElement> = {}
  private titles: Record<string, HTMLElement> = {}
  private lists: Record<string, HTMLElement> = {}
  private pagers: Record<string, HTMLElement> = {}
  private pages: Record<string, HTMLElement[]> = {}
  private cockItems: { item: HTMLElement; name: HTMLElement; spec: HTMLElement }[] = []
  private wineItems: HTMLElement[] = []
  private lit: HTMLElement | null = null
  private layout = ''
  private last = { beat: '', page: -1, cocktail: -1, row: -1 }

  constructor(stage: HTMLElement) {
    this.root = el('div', 'cel', undefined, stage)
    this.scrim = el('div', 'cel-scrim', undefined, this.root)
    // the headlines: BOTTLES over the bottle beats (under the chapter's eyebrow),
    // WINE & SPECIALTY COCKTAILS as the wine beat starts (under the rest of it)
    const headline = (eyebrow: string, html: string) => {
      const block = el('div', 'cel-head', undefined, this.root)
      el('p', 'hud-eyebrow', eyebrow, block)
      return { block, h2: rise(el('h2', 'hud-h2 cel-title', undefined, block), html) }
    }
    this.heads = {
      bottles: headline(SECTIONS.cellar.eyebrow, CELLAR_UI.bottles),
      wine: headline(
        SECTIONS.cellar.eyebrow.split(' · ').slice(1).join(' · '),
        SECTIONS.cellar.title.replace('&', '&amp;').replace(/Cocktails$/, '<em>Cocktails</em>'),
      ),
    }

    const dock = el('div', 'cel-dock', undefined, this.root)
    // bottles: one card per group
    for (const g of BOTTLES) {
      const card = el('section', `hud-panel cel-card cel-card--${g.id}`, undefined, dock)
      const top = el('div', 'cel-card-top', undefined, card)
      el('p', 'hud-eyebrow', CELLAR_UI.bottles, top)
      el('span', 'hud-lit cel-count', String(g.beers.length).padStart(2, '0'), top)
      this.titles[g.id] = rise(el('h3', 'cel-h3', undefined, card), g.title)
      this.lists[g.id] = el('div', 'cel-pages', undefined, card)
      this.pagers[g.id] = el('p', 'hud-label cel-pager', undefined, card)
      this.cards[g.id] = card
    }
    // wine
    {
      const card = el('section', 'hud-panel cel-card cel-card--wine', undefined, dock)
      const top = el('div', 'cel-card-top', undefined, card)
      el('p', 'hud-eyebrow', CELLAR_UI.wine, top)
      this.titles.wine = rise(el('h3', 'cel-h3', undefined, card), CELLAR_UI.wineTitle)
      el('p', 'hud-body cel-body', BAR.wine, card)
      const ul = el('ul', 'cel-wine-list', undefined, card)
      WINE.forEach((w, i) => {
        const li = el('li', '', undefined, ul)
        const dot = el('span', 'cel-dot', undefined, li)
        if (i < 3) dot.style.background = WINE_DOTS[i]
        else dot.classList.add('cel-dot--ring')
        el('span', 'cel-name', w, li)
        this.wineItems.push(li)
      })
      this.cards.wine = card
    }
    // cocktails
    {
      const card = el('section', 'hud-panel cel-card cel-card--cocktails', undefined, dock)
      const top = el('div', 'cel-card-top', undefined, card)
      el('p', 'hud-eyebrow', CELLAR_UI.cocktails, top)
      el('p', 'hud-body cel-body cel-cock-intro', BAR.cocktails, card)
      el('hr', 'hud-rule', undefined, card)
      const stack = el('div', 'cel-cock-stack', undefined, card)
      COCKTAILS.forEach((c, i) => {
        const item = el('div', 'cel-cock', undefined, stack)
        el('p', 'hud-lit cel-cock-n', `${String(i + 1).padStart(2, '0')} / ${String(COCKTAILS.length).padStart(2, '0')}`, item)
        const name = rise(el('h3', 'cel-h3 cel-cock-name', undefined, item), c.name)
        const spec = el('p', 'cel-spec', c.spec, item)
        this.cockItems.push({ item, name, spec })
      })
      this.cards.cocktails = card
    }
  }

  private build(layout: Layout, all: boolean) {
    for (const g of BOTTLES) {
      const { per, cols } = plan(g.id, g.beers.length, layout, all)
      const host = this.lists[g.id]
      host.replaceChildren()
      const pages: HTMLElement[] = []
      for (let p = 0; p * per < g.beers.length; p++) {
        const names = g.beers.slice(p * per, p * per + per)
        const ul = el('ul', 'cel-list', undefined, host)
        ul.style.setProperty('--cols', String(cols))
        ul.style.setProperty('--rows', String(Math.ceil(names.length / cols)))
        names.forEach((n, i) => {
          const li = el('li', '', undefined, ul)
          li.dataset.col = String(Math.floor(i / Math.ceil(names.length / cols)))
          el('span', 'cel-n', String(p * per + i + 1).padStart(2, '0'), li)
          el('span', 'cel-name', n, li)
        })
        pages.push(ul)
      }
      this.pages[g.id] = pages
      this.pagers[g.id].style.display = pages.length > 1 ? '' : 'none'
    }
    this.root.dataset.layout = layout
    this.last = { beat: '', page: -1, cocktail: -1, row: -1 }
    this.lit = null
  }

  update(s: BeatState, w: number, h: number) {
    const layout = layoutOf(w, h)
    // all 42 International names at once only where three columns fit
    const all = layout === 'tablet' || (layout === 'wide' && w >= 1200 && h >= 780)
    const key = `${layout}:${all}`
    if (key !== this.layout) {
      this.layout = key
      this.build(layout, all)
      this.root.classList.toggle('is-paged', !all)
    }
    for (const k of ['bottles', 'wine'] as const) {
      const on = s.head === k
      setRise(this.heads[k].h2, on)
      this.heads[k].block.classList.toggle('is-on', on)
    }
    this.scrim.classList.toggle('is-on', !!s.head || !!s.beat)
    this.scrim.classList.toggle('is-head', !!s.head)
    for (const k of Object.keys(this.cards)) {
      const on = s.beat === k
      this.cards[k].classList.toggle('is-on', on)
      if (this.titles[k]) setRise(this.titles[k], on)
    }
    // international pages (paged layouts) or the lit column (all at once)
    const pages = this.pages.international
    const page = Math.max(0, Math.min(2, Math.floor(s.page)))
    if (pages && (page !== this.last.page || s.beat !== this.last.beat)) {
      this.last.page = page
      if (pages.length > 1) {
        pages.forEach((p, i) => p.classList.toggle('is-on', i === page))
        const per = pages[0].children.length
        this.pagers.international.textContent = `${page * per + 1}–${Math.min(42, page * per + per)} / ${BOTTLES[1].beers.length}`
      } else {
        pages[0].classList.add('is-on')
        pages[0].querySelectorAll('li').forEach(li => li.classList.toggle('is-row', (li as HTMLElement).dataset.col === String(page)))
      }
    }
    for (const id of ['american', 'local']) this.pages[id]?.forEach(p => p.classList.add('is-on'))
    this.last.beat = s.beat ?? ''
    // the item the 3D singles out, amber in its list (one at a time; fades by CSS)
    let lit: HTMLElement | null = null
    if (s.item >= 0) {
      if (s.beat === 'wine') lit = this.wineItems[s.item] ?? null
      else if (s.beat === 'american' || s.beat === 'international' || s.beat === 'local') {
        const all = this.pages[s.beat]?.flatMap(p => [...p.querySelectorAll<HTMLElement>('li')]) ?? []
        lit = all[s.item] ?? null
      }
    }
    if (lit !== this.lit) {
      this.lit?.classList.remove('is-on')
      lit?.classList.add('is-on')
      this.lit = lit
    }
    // cocktails
    this.cockItems.forEach((c, i) => {
      const on = s.beat === 'cocktails' && i === s.cocktail
      c.item.classList.toggle('is-on', on)
      setRise(c.name, on)
    })
  }
}
