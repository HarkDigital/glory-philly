import type { ChapterDef } from '../core/types'
import { CITY_WIDE } from '../content'

/**
 * The scroll story, in order. `length` is scroll distance in viewport
 * heights; `landing` is where nav jumps land (local progress, on settled
 * copy — keep it clear of the ~6% cut window at each end); `intro` is where
 * the section headline shows. Each chapter lives in src/chapters/<id>/ and
 * default-exports a factory returning a Chapter.
 *
 * GLORY: a product film of a night at Glory Beer Bar & Kitchen, 126 Chestnut
 * Street — This Must Be the Place (the brick wall, the sign, the first pour),
 * On Tap (the 36-handle tap tower: drafts by American / International /
 * Local), The Kitchen (the All Day Menu, plates on the bar), The Cellar
 * (bottles, wine on tap, cocktails), The Crew (Dave, Chef Kevin, Pier), The
 * Back Room (parties & corporate events), Last Call (visit: hours, address,
 * reservations). Lengths follow the reading-pace lessons (~0.6 vh per item).
 * The ids are shared with src/core/srContent.ts (its anchor contract) and the
 * chrome's names.
 */
/** ?lab=vinyl | room | citywide swaps the hero for a kit lab (src/chapters/lab-*.ts) */
const LAB = new URLSearchParams(location.search).get('lab')

export const CHAPTERS: ChapterDef[] = [
  { id: 'hero', label: 'This Must Be the Place', length: 2.4, landing: 0, intro: 0, load: () =>
      LAB === 'vinyl' ? import('./lab-vinyl') : LAB === 'room' ? import('./lab-room') : LAB === 'citywide' ? import('./lab-citywide') : import('./hero/index') },
  { id: 'taps', label: 'On Tap', length: 5.6, landing: 0.07, intro: 0.07, load: () => import('./taps/index') },
  { id: 'citywide', label: CITY_WIDE.title, length: 3.0, landing: 0.1, intro: 0.1, load: () => import('./citywide/index') },
  { id: 'kitchen', label: 'The Kitchen', length: 9.6, landing: 0.07, intro: 0.07, load: () => import('./kitchen/index') },
  { id: 'cellar', label: 'The Cellar', length: 8.2, landing: 0.07, intro: 0.07, load: () => import('./cellar/index') },
  { id: 'people', label: 'The Crew', length: 3.8, landing: 0.07, intro: 0.07, load: () => import('./people/index') },
  { id: 'events', label: 'The Back Room', length: 3.6, landing: 0.1, intro: 0.1, load: () => import('./events/index') },
  { id: 'visit', label: 'Last Call', length: 1.8, landing: 0.3, intro: 0.3, load: () => import('./visit/index') },
]

/** Plain business names for navigation (chrome nav, pips, menu). */
export const NAV_NAMES: Record<string, string> = {
  hero: 'Home',
  taps: 'Bar',
  citywide: 'City Wide',
  kitchen: 'Kitchen',
  cellar: 'Bottles & Cocktails',
  people: 'About',
  events: 'Events',
  visit: 'Visit',
}
