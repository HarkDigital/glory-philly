import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame, CameraPose } from '../core/types'
import { BOTTLES, BRAND, FEATURED_DISHES, MENU } from '../content'
import { makeBarTop } from '../kit/bar'
import {
  CrateRig,
  SEVEN,
  catNo,
  companyTexture,
  coverAtlas,
  coverTexture,
  dirOf,
  frameTo,
  labelTexture,
  makeCrate,
  makeRecord,
  makeSleeve,
  makeTurntable,
  syncVinylLights,
  tracklistTexture,
  type PaperName,
} from '../kit/vinyl'

/*
 * VINYL LAB (?lab=vinyl replaces the hero): the kit on one bar top, for
 * screenshots and for the chapter agents to see every part lit by the world.
 *
 *   ?lab=vinyl&view=all|tt|arm|rim|bin|crate|back|single   camera
 *   ?lab=vinyl&mood=cyc                            the bone cyclorama instead of the bar after dark
 *   ?lab=vinyl&finish=black&cover=0.6              the black-satin deck, dust cover open 0..1
 *
 * local drives the crate rig (items 0..5 over 0.05–0.8, then the riffle) and
 * the turntable (arm swings over and cues down 0.05–0.3).
 */

const params = new URLSearchParams(location.search)
const VIEW = params.get('view') ?? 'all'
const CYC = params.get('mood') === 'cyc'

const PAPERS: PaperName[] = ['cream', 'red', 'stout', 'cream', 'red']

class LabVinyl implements Chapter {
  id = 'hero'
  group = new THREE.Group()
  private tt = makeTurntable({ finish: params.get('finish') === 'black' ? 'black' : 'walnut', dustCover: params.has('cover') })
  private rig!: CrateRig
  private crate = makeCrate({ legend: ['GLORY RECORDS · THE KITCHEN', '14 × 12"'] })
  private item = 0
  private riffle = 0
  private station = { c: new THREE.Vector3(), d: new THREE.Vector3() }

  init(ctx: ChapterContext) {
    if (CYC) ctx.stage.classList.add('is-light')
    const bar = makeBarTop({ length: 12, depth: 5, thickness: 0.2 })
    this.group.add(bar)

    // the deck, spinning a Glory record
    const tt = this.tt
    tt.group.position.set(-1.35, 0, 0.1)
    tt.group.rotation.y = 0.22
    this.group.add(tt.group)
    const rec = makeRecord({ label: { title: 'Glory', sub: BRAND.motto, side: 'SIDE A', cat: catNo(1), paper: 'red' } })
    tt.setRecord(rec)
    tt.setSpeed(33.333, true)

    // a crate of dish sleeves (5 featured + 9 in the atlas)
    const crate = this.crate
    crate.group.position.set(1.25, 0, -0.35)
    crate.group.rotation.y = -0.38
    this.group.add(crate.group)
    const dishes = FEATURED_DISHES.slice(0, 5)
    const starters = MENU[0]
    // the rig's backs are read lying on the stack (flip: pre-rotated to read from the crate's front)
    const back = tracklistTexture({
      flip: true,
      title: starters.title,
      sub: 'The All Day Menu',
      cat: catNo(10),
      tracks: starters.items.map(d => ({ name: d.name, value: d.price })),
    })
    const sleeves = dishes.map((d, i) =>
      makeSleeve({
        front: coverTexture({ title: d.name, kicker: MENU.find(s => s.items.includes(d))?.title, sub: d.desc, cat: catNo(i + 2), photoUrl: d.photo, eager: true }),
        back,
        seed: i * 3.7,
      }),
    )
    const labels = dishes.map((d, i) => labelTexture({ title: d.name, sub: d.desc.split(',')[0], side: 'SIDE A', cat: catNo(i + 2), paper: PAPERS[i] }))
    const more = FEATURED_DISHES.slice(5).map((d, i) => ({ title: d.name, cat: catNo(7 + i), kicker: 'The Kitchen', photoUrl: d.photo }))
    const typo = [
      { title: 'On Tap', sub: '36 handles', paper: 'red' as PaperName },
      { title: 'Last Call', sub: BRAND.motto, paper: 'stout' as PaperName },
      { title: 'The Back Room', sub: 'Parties & events', paper: 'cream' as PaperName },
      { title: 'Wine on Tap', sub: 'Red, white & rosé', paper: 'amber' as PaperName },
      { title: 'Old City', sub: BRAND.street, paper: 'bone' as PaperName },
    ]
    const atlas = coverAtlas([...more, ...typo.map((t, i) => ({ ...t, cat: catNo(12 + i) }))], {
      title: 'Glory Records',
      sub: 'The house pressings',
      tracks: dishes.map(d => ({ name: d.name, value: d.price })),
    })
    this.rig = new CrateRig({ crate, sleeves, labels, fillers: { count: 9, atlas } })

    // a sleeve standing turned round: the back is the bottle list (the auto-fit stress test)
    const listSleeve = makeSleeve({
      front: coverTexture({ title: 'Bottles', paper: 'stout' }),
      back: tracklistTexture({
        title: 'Bottles',
        sub: 'American · International · Local',
        cat: catNo(30),
        sides: BOTTLES.map(g => ({ name: g.title, tracks: g.beers.map(b => ({ name: b })) })),
        numbers: 'index',
        notes: 'See UNTAPPD for additional info. Duplicates on the source list removed.',
      }),
      seed: 9,
    })
    listSleeve.group.position.set(-0.05, 0, 1.0)
    listSleeve.group.rotation.set(-0.12, Math.PI - 0.12, 0, 'YXZ')
    this.group.add(listSleeve.group)
    this.listSleeve = listSleeve.group

    // a 7" single in its company sleeve, the record half out
    const single = makeSleeve({ size: 7, thin: true, front: companyTexture({ paper: 'cream', hole: 0.235 }), back: companyTexture({ paper: 'cream', hole: 0.235 }), hole: 0.235 })
    single.group.position.set(0.72, 0, 1.15)
    single.group.rotation.set(-0.1, -0.45, 0, 'YXZ')
    this.group.add(single.group)
    const r7 = makeRecord({ size: 7, label: { title: 'Classic Negroni', sub: 'Campari, Bluecoat Gin', seven: true, paper: 'red', cat: catNo(21) } })
    r7.group.position.set(0.19, SEVEN / 2, 0)
    single.group.add(r7.group)
    this.single = single.group
  }
  private listSleeve!: THREE.Object3D
  private single!: THREE.Object3D

  update(l: number, f: Frame, ctx: ChapterContext) {
    const w = ctx.world.params
    if (CYC) {
      w.top = '#ece6da'
      w.bottom = '#d9d1c2'
      w.brick = 0
      w.cyc = 1
      w.cycColor = '#fff6ea'
      w.bulbs = 0
      w.bokeh = 0
      w.haze = 0
      w.fill = 0.45
      // judge the kit, not the bloom veil of a white cyc
      ctx.post.params.bloomThreshold = 1.4
    }
    w.spot = 0.5
    w.spotPos.set(-2.5, 7.5, 5.5)
    w.spotAt.set(0, 0.4, 0)
    w.spotAngle = 0.55
    w.rimA = 1.1
    w.rimADir.set(-0.9, 0.5, -1)
    w.rimB = 0.7
    w.rimBDir.set(1, 0.35, -1)
    w.fill = CYC ? 0.45 : 0.22
    syncVinylLights(ctx.world)

    // turntable: arm swings over and cues down
    const tt = this.tt
    const s = (a: number, b: number) => Math.min(1, Math.max(0, (l - a) / (b - a)))
    tt.setSpeed(33.333)
    tt.setArm(VIEW === 'arm' ? 1 : s(0.05, 0.22))
    tt.setCue(VIEW === 'arm' ? 0 : 1 - s(0.22, 0.3))
    tt.setCover(Number(params.get('cover') ?? 0))
    tt.update(f)

    // crate: five items over 0.05..0.8, then the riffle
    this.item = Math.max(0, Math.min(5, ((l - 0.05) / 0.75) * 5))
    this.riffle = Math.max(0, ((l - 0.8) / 0.18) * 9)
    this.rig.update(this.item, f, this.riffle)
  }

  camera(l: number, f: Frame, out: CameraPose) {
    const portrait = f.height > f.width
    const W = f.width
    const H = f.height
    const fov = portrait ? 38 : 30
    out.fov = fov
    out.parallax = 0
    out.roll = 0
    const full = { x0: W * 0.05, x1: W * 0.95, y0: H * 0.1, y1: H * 0.9 }
    const d = new THREE.Vector3()
    const c = new THREE.Vector3()
    if (VIEW === 'tt' || VIEW === 'arm') {
      this.tt.group.updateWorldMatrix(true, true)
      if (VIEW === 'arm') {
        c.set(0.15, 0.3, 0.0).applyMatrix4(this.tt.group.matrixWorld)
        dirOf(-38, 30, d)
        frameTo(out, c, d, 0.9, 0.55, full, W, H, fov)
      } else {
        c.set(0, 0.2, 0).applyMatrix4(this.tt.group.matrixWorld)
        dirOf(-18, 38, d)
        frameTo(out, c, d, 1.6, 1.25, full, W, H, fov)
      }
    } else if (VIEW === 'bin') {
      // Resonance's crate-digger three-quarter view
      this.crate.group.updateWorldMatrix(true, false)
      c.set(0.02, 0.5, 0.12).applyMatrix4(this.crate.group.matrixWorld)
      dirOf(24 - 21.8, 33, d)
      frameTo(out, c, d, 1.66, 1.62, full, W, H, fov)
    } else if (VIEW === 'rim') {
      // low, onto the platter's strobe dots
      this.tt.group.updateWorldMatrix(true, true)
      c.set(-0.35, 0.23, 0.4).applyMatrix4(this.tt.group.matrixWorld)
      dirOf(-30, 6, d)
      frameTo(out, c, d, 0.5, 0.22, full, W, H, fov)
    } else if (VIEW === 'crate') {
      const k = Math.min(4, Math.max(0, Math.floor(this.item)))
      const sz = this.rig.station(k, this.station.c, this.station.d)
      frameTo(out, this.station.c, this.station.d, sz.w, sz.h, full, W, H, fov)
    } else if (VIEW === 'back') {
      this.listSleeve.updateWorldMatrix(true, false)
      c.set(0, 0.5, 0).applyMatrix4(this.listSleeve.matrixWorld)
      dirOf(-7, 8, d)
      frameTo(out, c, d, 1.05, 1.05, full, W, H, fov)
    } else if (VIEW === 'single') {
      this.single.updateWorldMatrix(true, false)
      c.set(0.1, SEVEN * 0.5, 0).applyMatrix4(this.single.matrixWorld)
      dirOf(-20, 16, d)
      frameTo(out, c, d, 0.95, 0.66, full, W, H, fov)
    } else {
      c.set(0, 0.75, 0.2)
      dirOf(-6, 22, d)
      frameTo(out, c, d, portrait ? 3.4 : 4.6, 2.4, full, W, H, fov)
    }
  }

  onEnter() {
    this.rig?.reset()
  }
}

export default function create(): Chapter {
  return new LabVinyl()
}
