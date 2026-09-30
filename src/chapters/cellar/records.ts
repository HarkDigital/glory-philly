import * as THREE from 'three'
import { BOTTLES, CELLAR_UI, COCKTAILS, LINKS } from '../../content'
import {
  SEVEN,
  catNo,
  companyTexture,
  coverTexture,
  labelTexture,
  makeRecord,
  makeSleeve,
  tracklistTexture,
  type PaperName,
  type Record,
  type Sleeve,
} from '../../kit/vinyl'

/*
 * THE CELLAR's vinyl (the site's motif, used the Cellar's own way):
 *  - a "Bottles" LP leaning on the Local shelf, turned round so its back —
 *    the whole bottle list as a tracklist — faces the room (decorative; the
 *    DOM panels are the readable truth)
 *  - one 7" single per cocktail on a small steel easel beside the glass: a
 *    company sleeve with the record half out the top, its label printing the
 *    cocktail's name (and its spec as the sub line), turning slowly
 * Catalogue numbers GLY-041 … GLY-047 (singles) and GLY-040 (the LP) are
 * decorative, like the rest of the house pressings.
 */

/** world size of the 7": the kit's SEVEN (0.586) scaled to sit beside the glasses */
export const SINGLE_SCALE = 1.45
/** the height a single reaches on its easel with the record out (world units) */
export const SINGLE_TOP = (SEVEN / 2 + 0.44 + 0.283) * SINGLE_SCALE
/** the easel: the sleeve's lean back, its board thickness (a thin 7"), the backrest bar's depth and its gap behind the sleeve */
export const EASEL_LEAN = 0.2
export const SINGLE_T = 0.0125 * SEVEN
export const STRUT_D = 0.014
export const STRUT_GAP = 0.006

const PAPERS: PaperName[] = ['cream', 'red', 'amber']
const LABEL_PAPERS: PaperName[] = ['red', 'cream', 'stout', 'amber', 'bone', 'stout', 'cream']

export interface SinglesArt {
  labels: THREE.Texture[]
  sleeves: THREE.Texture[]
}

export function singlesArt(mobile: boolean): SinglesArt {
  const res = mobile ? 384 : 512
  return {
    labels: COCKTAILS.map((c, i) =>
      labelTexture({ title: c.name, sub: c.spec, side: 'SIDE A', cat: catNo(41 + i), paper: LABEL_PAPERS[i], seven: true }, res),
    ),
    sleeves: PAPERS.map(p => companyTexture({ paper: p, hole: 0.235 }, res)),
  }
}

export interface Single {
  group: THREE.Group
  sleeve: Sleeve
  record: Record
  /** configure for cocktail k (idempotent) */
  show(k: number): void
  /** out 0 (in the sleeve) .. 1 (half out the top); spin angle (radians) */
  set(out: number, spin: number): void
}

/** a 7" in its company sleeve on a small black-steel easel (base at y = 0, facing +z) */
export function makeSingle(art: SinglesArt, steel: THREE.Material): Single {
  const group = new THREE.Group()
  group.scale.setScalar(SINGLE_SCALE)
  // the easel: a ledge with a lip; the sleeve leans back on a flat backrest
  // bar that tips with it, 6 mm (kit units) behind its back face — so neither
  // the bar nor the ledge ever passes through the sleeve or the record in it
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(SEVEN * 1.08, 0.022, 0.1), steel)
  ledge.position.set(0, 0.011, 0.02)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(SEVEN * 1.08, 0.05, 0.012), steel)
  lip.position.set(0, 0.03, 0.068)
  const lean = EASEL_LEAN
  const t = SINGLE_T
  const frame = new THREE.Group()
  // the sleeve's pivot is its bottom-centre edge: lift it so the back corner stays on the ledge
  frame.position.set(0, 0.022 + (t / 2) * Math.sin(lean) + 0.0008, 0.03)
  frame.rotation.x = -lean
  const strutH = SEVEN * 0.62
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, strutH, STRUT_D), steel)
  strut.position.set(0, 0.012 + strutH / 2, -t / 2 - STRUT_GAP - STRUT_D / 2)
  frame.add(strut)
  frame.name = 'easel-frame'
  strut.name = 'easel-strut'
  ledge.name = 'easel-ledge'
  lip.name = 'easel-lip'
  for (const m of [ledge, lip, strut]) {
    m.castShadow = true
    m.receiveShadow = true
    if (m !== strut) group.add(m)
  }
  group.add(frame)
  const sleeve = makeSleeve({ size: 7, thin: true, hole: 0.235, front: art.sleeves[0], back: art.sleeves[0], seed: 3 })
  sleeve.group.name = 'easel-sleeve'
  frame.add(sleeve.group)
  const record = makeRecord({ size: 7, label: art.labels[0], segments: 96 })
  record.group.name = 'easel-record'
  sleeve.group.add(record.group)
  let shown = -1
  return {
    group,
    sleeve,
    record,
    show(k) {
      if (shown === k) return
      shown = k
      const s = art.sleeves[k % art.sleeves.length]
      sleeve.setFront(s)
      sleeve.setBack(s)
      record.setLabel(art.labels[k])
    },
    set(out, spin) {
      record.group.position.set(0, SEVEN / 2 + 0.44 * out, 0)
      record.setSpin(spin)
    },
  }
}

/** the "Bottles" LP: stout typographic front, the full bottle list on the back */
export function makeBottlesLP(mobile: boolean): Sleeve {
  const res = mobile ? 768 : 1024
  return makeSleeve({
    front: coverTexture({ title: CELLAR_UI.bottles, sub: BOTTLES.map(g => g.title).join(' · '), cat: catNo(40), paper: 'stout' }, res),
    back: tracklistTexture(
      {
        title: CELLAR_UI.bottles,
        sub: BOTTLES.map(g => g.title).join(' · '),
        cat: catNo(40),
        sides: BOTTLES.map(g => ({ name: g.title, tracks: g.beers.map(b => ({ name: b })) })),
        numbers: 'index',
        notes: LINKS.untappd.label,
      },
      res,
    ),
    seed: 12,
  })
}
