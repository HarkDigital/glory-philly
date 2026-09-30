import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../core/types'
import { BRAND } from '../content'
import { catNo, coverTexture, makeRecord, syncVinylLights } from '../kit/vinyl'
import { makeBackBar, makeBarRun, makeCeiling, makeChalkboards, makeRecordColumn, paintedBrickPanel, prepareRoom, type RoomKit } from '../kit/room'

/*
 * ROOM LAB (?lab=room replaces the hero): the room kit assembled as Glory's
 * real bar, with cameras matched to Mike's photos for side-by-sides.
 *
 *   ?lab=room&view=backbar   ref1: the back bar from across the long bar
 *   ?lab=room&view=column    ref4: the record column (one LP face-out)
 *   ?lab=room&view=brick     ref2: "Old 1837" over the bottle shelves
 *   ?lab=room&view=ceiling   the black ceiling, the trunk duct, pendants
 *   ?lab=room&view=trunk     close on the galvanized trunk duct · view=flex the round flex run
 *   ?lab=room&view=all       the whole set
 *   &glow=0.6&amb=0.5        bulb/pool level, the kit's bounce light
 *   &preset=chapter          what a chapter sees: the kit at glow 1 / ambient 1 under
 *                            the world's DEFAULTS (fill, env, backdrop room) plus a
 *                            product spot and a rim on the counter (PBR Neutral, exposure 1)
 *
 * local drives a slow product-film drift across each view (0 → 1); 0.5 is
 * the matched frame.
 */

const params = new URLSearchParams(location.search)
const VIEW = params.get('view') ?? 'backbar'
// per-view exposure (ref1 is a daylight photo: more bounce; ref4 is lit by its bulb)
const EXPOSE: Record<string, [number, number]> = { backbar: [1.2, 1.5], column: [1.3, 1], brick: [1, 0.8], ceiling: [1.1, 1], all: [1.1, 1.1] }
const PRESET = params.get('preset') ?? 'lab'
const CHAPTER = PRESET === 'chapter'
const GLOW = Number(params.get('glow') ?? (CHAPTER ? 1 : (EXPOSE[VIEW] ?? [1, 1])[0]))
const AMB = Number(params.get('amb') ?? (CHAPTER ? 1 : (EXPOSE[VIEW] ?? [1, 1])[1]))

class LabRoom implements Chapter {
  id = 'hero'
  group = new THREE.Group()
  private kits: RoomKit[] = []
  private bar!: RoomKit
  private col!: RoomKit
  private tmp = new THREE.Vector3()

  async init(ctx: ChapterContext) {
    const t0 = performance.now()
    // the shared maps, built across frames (no long task), then the sync makers are instant
    await prepareRoom({ backBar: {} })
    const tp = performance.now()
    const g = this.group
    // ref1's back bar along the back wall (z = 0), the long bar in front of it
    const bar = makeBackBar({ turntable: true, tv: params.get('tv') === 'off' ? 'off' : 'on', mobile: ctx.mobile })
    this.bar = bar
    const t1 = performance.now()
    g.add(bar.group)
    const run = makeBarRun({ length: 7.5, depth: 0.78, mobile: ctx.mobile })
    run.group.position.set(-0.4, 0, 2.55)
    g.add(run.group)
    // ref1: the duct runs in at the far left over the glass bay; a pendant hangs over the long bar
    const ceil = makeCeiling({
      width: 12,
      depth: 5.2,
      height: 3.45,
      mobile: ctx.mobile,
      // ref1 top-left: a long straight galvanized trunk tight under the ceiling, ending over the glass bay
      // (+ a strapped run of the round silver flex behind the camera, for the ceiling view)
      ducts: [
        { pts: [new THREE.Vector3(-7, 0, 1.25), new THREE.Vector3(-2.35, 0, 1.25)], size: [0.62, 0.34] },
        { pts: [new THREE.Vector3(-6, 2.93, 4.1), new THREE.Vector3(0, 2.91, 4.12), new THREE.Vector3(6, 2.94, 4.1)], shape: 'flex', radius: 0.2 },
      ],
      pendants: [
        { x: 0.6, z: 2.5, drop: 0.58 },
        { x: -2.6, z: 2.6, drop: 0.7 },
        { x: 3.6, z: 2.2, drop: 0.6 },
      ],
    })
    g.add(ceil.group)
    // the black end wall with the tap chalkboards (ref1 far left, ref6)
    const boards = makeChalkboards({ mobile: ctx.mobile })
    boards.group.position.set(-4.35, 0, 1.6)
    boards.group.rotation.y = Math.PI / 2
    g.add(boards.group)
    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.6), new THREE.MeshStandardMaterial({ color: '#141212', roughness: 0.85 }))
    endWall.rotation.y = Math.PI / 2
    endWall.position.set(-4.36, 1.8, 2.4)
    g.add(endWall)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.55 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, 0, 3)
    g.add(floor)

    // ref4's record column, around the corner to the right (its own wall)
    const col = makeRecordColumn({
      cover: coverTexture({ title: BRAND.short, kicker: `${BRAND.neighborhood} · Philadelphia`, cat: catNo(7), paper: 'red' }),
      mobile: ctx.mobile,
      seed: 21,
    })
    col.group.position.set(9, 0, 0)
    g.add(col.group)
    const rec = makeRecord({ label: { title: 'Glory', sub: BRAND.motto, side: 'SIDE A', cat: catNo(7), paper: 'red' } })
    col.turntable?.setRecord(rec)
    bar.turntable?.setRecord(makeRecord({ label: { title: 'Glory', side: 'SIDE B', cat: catNo(8), paper: 'cream' } }))
    this.col = col

    // a standalone brick panel test (ref2 is the back bar's brick bay; this one checks the maker)
    const brick = paintedBrickPanel(1.2, 1.4, { lines: 'old1837', seed: 9 })
    brick.group.position.set(9, 0.6, -3)
    g.add(brick.group)

    this.kits = [bar, run, ceil, boards, col, brick]
    for (const k of this.kits) {
      k.setGlow(GLOW)
      k.setAmbient(AMB)
    }
    if (params.has('debug')) {
      console.log(`[room] init ${Math.round(performance.now() - t0)} ms (prepareRoom ${Math.round(tp - t0)} ms across frames; back bar ${Math.round(t1 - tp)} ms)`)
      const tris = (k: RoomKit) => {
        let t = 0
        k.group.traverse(o => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          const g = m.geometry
          const n = (g.index ? g.index.count : g.attributes.position.count) / 3
          t += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1)
        })
        return Math.round(t)
      }
      const names = ['backbar', 'barRun', 'ceiling', 'boards', 'column', 'brick']
      console.log('[room] ' + JSON.stringify(this.kits.map((k, i) => ({ kit: names[i], draws: k.draws, tris: tris(k), lights: k.lights.length }))))
    }
  }

  update(_l: number, f: Frame, ctx: ChapterContext) {
    const w = ctx.world.params
    if (CHAPTER) {
      // the world as a chapter leaves it (defaults), plus a product spot + rim on the back counter
      w.spot = 0.6
      w.spotPos.set(1.2, 3.1, 3.2)
      w.spotAt.set(0, 0.95, 0.4)
      w.rimA = 0.5
      syncVinylLights(ctx.world)
      for (const tt of [this.bar.turntable, this.col.turntable]) {
        if (!tt) continue
        tt.setSpeed(33.333)
        tt.setArm(1)
        tt.setCue(0)
        tt.update(f)
      }
      return
    }
    w.top = '#060404'
    w.bottom = '#0a0605'
    w.cyc = 0.15
    w.brick = 0
    w.bulbs = 0.5
    w.bokeh = 0.15
    w.haze = 0.1
    w.spot = 0
    w.rimA = 0
    w.rimB = 0
    w.fill = 0.3
    w.env = 0.9
    syncVinylLights(ctx.world)
    for (const tt of [this.bar.turntable, this.col.turntable]) {
      if (!tt) continue
      tt.setSpeed(33.333)
      tt.setArm(1)
      tt.setCue(0)
      tt.update(f)
    }
  }

  camera(l: number, f: Frame, out: CameraPose) {
    const portrait = f.height > f.width
    const aspect = f.width / f.height
    const drift = (l - 0.5) * (f.reducedMotion ? 0 : 1)
    out.parallax = 0
    out.roll = 0
    const colX = 9
    if (VIEW === 'column') {
      // ref4 (solved from 6 landmarks): seated low at the bar, looking up at the LP on its ledge
      out.position.set(colX - 0.062 + drift * 0.3, 1.218, 1.706)
      out.target.set(colX + 0.086 + drift * 0.3, 2.682, -2.014)
      out.fov = vfov(65, aspect, 1073 / 1400)
    } else if (VIEW === 'brick') {
      // ref2: straight at "Old 1837" over the two bottle shelves, colB's sconce at the left edge
      out.position.set(-0.04 + drift * 0.2, 2.2, 2.05)
      out.target.set(-0.04 + drift * 0.2, 2.2, 0)
      out.fov = vfov(51, aspect, 1)
    } else if (VIEW === 'trunk') {
      // close on the galvanized trunk tight under the ceiling (ref1 top-left)
      out.position.set(-1.6 + drift * 0.3, 1.75, 3.3)
      out.target.set(-4.2 + drift * 0.3, 3.0, 1.25)
      out.fov = portrait ? 70 : 50
    } else if (VIEW === 'flex') {
      // the strapped run of round flex (behind the ref1 camera)
      out.position.set(1.2 + drift * 0.3, 1.7, 1.9)
      out.target.set(-0.8 + drift * 0.3, 2.95, 4.1)
      out.fov = portrait ? 70 : 50
    } else if (VIEW === 'ceiling') {
      out.position.set(0.5 + drift, 1.6, 4.4)
      out.target.set(-0.6 + drift, 3.05, 1.2)
      out.fov = portrait ? 70 : 55
    } else if (VIEW === 'all') {
      out.position.set(1.2 + drift, 1.9, 7.2)
      out.target.set(-0.2, 1.55, 0.4)
      out.fov = vfov(62, aspect, 1.6)
    } else {
      // ref1 (solved from 7 landmarks, 24 px rms): seated at the long bar, looking left along the back bar
      out.position.set(2.94 + drift * 0.4, 1.53, 3.215)
      out.target.set(0.171 + drift * 0.4, 1.939, 0.358)
      out.fov = vfov(50, aspect, portrait ? 0.8 : 4 / 3)
    }
    void this.tmp
  }
}

/**
 * The vertical fov that keeps a reference photo's framing: `v` is the photo's
 * vertical fov at its own aspect `ref`; narrower screens widen it so the
 * photo's horizontal coverage still fits.
 */
function vfov(v: number, aspect: number, ref: number) {
  if (aspect >= ref) return v
  const h = 2 * Math.atan(Math.tan((v * Math.PI) / 360) * ref)
  return Math.min(95, (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI)
}

export default function create(): Chapter {
  return new LabRoom()
}
