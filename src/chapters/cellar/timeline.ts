import { COCKTAILS } from '../../content'

/*
 * THE CELLAR's story (local progress; length 8.2 vh in chapters/index.ts):
 *
 *  0.000–0.045  cut in: a fast dolly along the backlit bottle wall
 *  0.045–0.105  the headline over the wall (intro 0.07)
 *  0.105–0.175  BOTTLES · American: the camera tilts down its three shelves
 *  0.175–0.345  BOTTLES · International: three shelves, snaking (one page of
 *               names per shelf on phones; all 42 in three columns on desktop,
 *               the column of the shelf in frame lit)
 *  0.345–0.390  BOTTLES · Local: a macro on the two Ploughman bottles
 *  0.390–0.490  WINE: the stainless wine tower pours red, white and rosé
 *  0.490–0.945  COCKTAILS: seven product shots sliding down the bar
 *  0.945–1.000  push in on the last glass; the ruby pour cut
 *
 * Everything below is in local units; the camera and the active item run on
 * a StoryClock (q), the HUD reveals on q too.
 */

export const LENGTH = 8.2

export const HEAD_IN = 0.045
export const HEAD_OUT = 0.105
export const AM = [0.105, 0.175] as const
export const INTL = [0.175, 0.345] as const
export const LOC = [0.345, 0.39] as const
export const WINE_T = [0.39, 0.49] as const
export const COCK = [0.49, 0.945] as const
export const OUT = 0.945

/** the wine pour (each tap staggered) */
export const POUR = [0.397, 0.467] as const

export const SLOT = (COCK[1] - COCK[0]) / COCKTAILS.length

/** keyboard stops: 0 American · 1 International · 2 Local · 3 wine · 4 cocktails */
export const ANCHORS = [0.13, 0.195, 0.365, 0.445, COCK[0] + SLOT * 0.4]

/** International page (= shelf) at q: 0..2 continuous */
export const intlPage = (q: number) => Math.max(0, Math.min(2.999, ((q - INTL[0]) / (INTL[1] - INTL[0])) * 3))

/**
 * Cocktail position along the bar at q: integer k = cocktail k centred; the
 * slide to the next one rides the last 18% of each slot.
 */
export function cocktailPos(q: number) {
  const u = (q - COCK[0]) / SLOT
  if (u <= 0) return 0
  const n = COCKTAILS.length - 1
  if (u >= n + 0.82) return n
  const i = Math.floor(u)
  const f = u - i
  const t = f < 0.82 ? 0 : (f - 0.82) / 0.18
  const e = t * t * (3 - 2 * t)
  return Math.min(n, i + e)
}
