import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, reveal, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { CITY_WIDE, SECTIONS } from '../../content'
import { IN } from '../../kit/citywide'
import { dirOf, frameTo, syncVinylLights, type Region } from '../../kit/vinyl'
import { SET, buildSet, type CityWideSet } from './set'
import './citywide.css'

/*
 * CITY WIDE — "A shot and a beer". Glory's City Wide Special (a can of
 * Hamm's, a shot of Old Overholt Rye, a cube of Swiss cheese on a pick) as
 * a product film on Glory's real bar: the long oiled bar with its black
 * rubber rail, and across the aisle the back bar from Mike's photos (walnut
 * columns, the brick bay with the painted "Old 1837", the hi-fi's blue ring
 * and a deck spinning a red-label 7", LPs packed on the shelf, spouted
 * bottles, wire-cage sconces, the black ceiling and its flex duct). The copy
 * holds on the left (phones: under the product) while the film plays.
 *
 *   0.00–0.14  THE ROOM   the back bar IN FOCUS: the 7" spinning on the deck,
 *                         the records, the sconce; a slow dolly (landing 0.1:
 *                         the headline, the line and the three items)
 *   0.14–0.27  THE CAN    the camera cranes down to the bar as a can of Hamm's
 *                         is set down (a small settle); the focus racks from
 *                         the back bar to the can — the room melts into bokeh
 *   0.28–0.37  THE TAB    close over the lid: the tab lifts and cracks the
 *                         mouth open (a burst of fizz, forward scroll only)
 *   0.38–0.48  THE SHOT   the heavy shot glass slides in across the bar and
 *                         stops beside the can (a small settle)
 *   0.50–0.66  THE POUR   the Old Overholt bottle tips in, the rye runs, the
 *                         shot fills to the photo's level, the bottle lifts out
 *   0.66–0.77  THE CHEESE the cube of Swiss on its bamboo pick is lowered
 *                         across the rim
 *   0.78–0.93  THE SPECIAL Mike's photo (ref3): close, a little above, the
 *                         pair sharp on the oiled planks, the room in bokeh
 *   0.93–1.00  OUT        a calm breath back; the amber pour cut
 *
 * The list lights each item as it arrives. Everything derives from `local`;
 * frame.time only drives idle motion (the 7" spinning, the stream's ripple).
 */

interface Key {
  t: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  /** log of the framed width / height (world units) */
  w: number
  h: number
  fov: number
}
type Prop = Exclude<keyof Key, 't'>

/** can + shot rest positions (the kit's arrangement, inches → units) */
const CAN = new THREE.Vector3(-1.6 * IN, 0, -0.75 * IN)
const SHOT = new THREE.Vector3(1.4 * IN, 0, 1.15 * IN)
/** the can's and the shot's base radii (units): a rocking body pivots on its edge */
const CAN_R = 1.3 * IN
const SHOT_R = 1.02 * IN

/** beats (local) */
const B = {
  landing: 0.1,
  rack: [0.207, 0.266] as const,
  canIn: [0.188, 0.25] as const,
  tab: [0.29, 0.355] as const,
  shotIn: [0.385, 0.47] as const,
  bottleIn: [0.5, 0.545] as const,
  flow: [0.54, 0.612] as const,
  bottleOut: [0.612, 0.66] as const,
  cheese: [0.665, 0.765] as const,
  out: 0.93,
}
/** when each item has arrived (lights its line in the list) */
const ARRIVE = [B.canIn[1], B.flow[0] + 0.012, B.cheese[1] - 0.01]

function makeKeys(E: THREE.Vector3): Key[] {
  const k = (t: number, c: [number, number, number], yaw: number, pitch: number, w: number, h: number, fov: number): Key => ({
    t,
    x: c[0],
    y: c[1],
    z: c[2],
    yaw,
    pitch,
    w: Math.log(w),
    h: Math.log(h),
    fov,
  })
  const C = CAN
  const G = SHOT
  // prettier-ignore
  return [
    k(0.0,  [E.x + 2.2, E.y + 0.3, E.z], 2, 1, 16.5, 13.6, 34),
    k(0.13, [E.x, E.y, E.z], -4, 2, 15.5, 12.8, 34),
    k(0.21, [C.x + 0.35, 1.05, C.z - 0.7], -6, 7, 3.7, 2.9, 36),
    k(0.266, [C.x + 0.12, 0.5, C.z + 0.02], -8, 13, 1.8, 1.5, 36),
    k(0.305, [C.x + 0.02, 0.88, C.z + 0.08], -5, 40, 0.86, 0.72, 34),
    k(0.36, [C.x + 0.02, 0.9, C.z + 0.08], 3, 44, 0.8, 0.68, 34),
    k(0.43, [0.12, 0.46, 0.06], 9, 17, 2.25, 1.65, 38),
    k(0.49, [0.08, 0.5, 0.06], 5, 15, 2.05, 1.6, 38),
    k(0.545, [G.x + 0.3, 0.78, G.z], -2, 9, 1.55, 1.95, 38),
    k(0.615, [G.x + 0.24, 0.72, G.z], -5, 11, 1.5, 1.85, 38),
    k(0.675, [0.13, 0.52, 0.12], -4, 30, 1.4, 1.1, 40),
    k(0.77, [0.12, 0.5, 0.1], -2, 31, 1.36, 1.08, 40),
    k(0.815, [0.03, 0.44, 0.06], -4, 25, 1.46, 1.34, 48),
    k(0.93, [0.02, 0.44, 0.06], -2, 24, 1.4, 1.29, 48),
    k(1.0,  [0.02, 0.5, 0.04], 1, 20, 1.36, 1.25, 48),
  ]
}

/** smooth monotone cubic through the keys (Fritsch–Carlson slopes: no overshoot) */
function sample(keys: Key[], t: number, prop: Prop): number {
  const n = keys.length
  if (t <= keys[0].t) return keys[0][prop]
  if (t >= keys[n - 1].t) return keys[n - 1][prop]
  let i = 0
  while (i < n - 2 && t > keys[i + 1].t) i++
  const k0 = keys[i]
  const k1 = keys[i + 1]
  const h = k1.t - k0.t
  const s = (t - k0.t) / h
  const slope = (j: number) => {
    if (j <= 0 || j >= n - 1) return 0
    const a = keys[j - 1]
    const b = keys[j]
    const c = keys[j + 1]
    const d0 = (b[prop] - a[prop]) / (b.t - a.t)
    const d1 = (c[prop] - b[prop]) / (c.t - b.t)
    if (d0 * d1 <= 0) return 0
    return (2 * d0 * d1) / (d0 + d1)
  }
  const m0 = slope(i) * h
  const m1 = slope(i + 1) * h
  const s2 = s * s
  const s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * k0[prop] + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * k1[prop] + (s3 - s2) * m1
}

/** the can being set down: height above the bar, lean, and the settle after contact */
function canState(l: number, reduced: boolean) {
  const t = clamp((l - B.canIn[0]) / (B.canIn[1] - B.canIn[0]))
  // lowered by hand: quick at first, slowing to a gentle touch
  const down = ease.outCubic(t)
  let y = 2.9 * (1 - down)
  let lean = 0.07 * (1 - t) * (1 - t)
  if (!reduced && l > B.canIn[1]) {
    // a tiny rock on the rim, damped out in ~0.02 of local
    const s = l - B.canIn[1]
    lean += 0.028 * Math.exp(-s * 160) * Math.sin(s * 520)
    y += 0.006 * Math.exp(-s * 200) * Math.abs(Math.sin(s * 420))
  }
  // a tipped can stands on its rim's edge, never through the bar
  y += CAN_R * Math.abs(Math.sin(lean))
  return { y, lean, visible: l > B.canIn[0] - 0.005 }
}

/** the shot sliding in across the bar: 0 far back-right … 1 at rest */
function shotState(l: number, reduced: boolean) {
  const t = clamp((l - B.shotIn[0]) / (B.shotIn[1] - B.shotIn[0]))
  // friction: uniform deceleration
  const k = 1 - (1 - t) * (1 - t)
  let wob = 0
  if (!reduced && l > B.shotIn[1]) {
    const s = l - B.shotIn[1]
    wob = 0.035 * Math.exp(-s * 150) * Math.sin(s * 480)
  }
  // rocking on the heavy base's edge: lift by the base radius so no edge dips into the bar
  return { k, wob, lift: SHOT_R * Math.abs(Math.sin(wob)), visible: l > B.shotIn[0] - 0.005 }
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let set: CityWideSet
  let keys: Key[] = []
  let reduced = false

  // DOM
  let copy: HTMLElement
  let title: HTMLElement
  let items: HTMLElement[] = []
  let region = { W: 0, H: 0, copyL: 0, copyR: 0, copyT: 0, copyB: 0 }
  let measured = ''

  const v = new THREE.Vector3()
  const w2 = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const focusAt = new THREE.Vector3()
  const keyDir = new THREE.Vector3()
  const shotRest = new THREE.Vector3()
  /** the establishing frame's centre on tall screens (the brick bay + the deck) */
  const tallE = new THREE.Vector3()
  let canAOopacity = 0.75
  // sounds: forward scroll only, rate-limited by time
  let prevL = -1
  const lastSfx: Record<string, number> = {}
  const sfx = (kind: string, at: number, l: number, level = 1) => {
    if (prevL < 0 || !(prevL < at && l >= at) || l - prevL > 0.08) return
    const now = performance.now() / 1000
    if (now - (lastSfx[kind] ?? -1e9) < 2.5) return
    lastSfx[kind] = now
    window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind, level } }))
  }

  const layout = (W: number, H: number) => (H < 500 && W > H ? 'short' : H >= W ? 'tall' : 'wide')

  /** measure the copy block once per size (no per-frame layout reads) */
  const measure = (W: number, H: number) => {
    const key = `${W}x${H}`
    if (key === measured || !copy) return
    measured = key
    const r = copy.getBoundingClientRect()
    const sr = copy.parentElement?.getBoundingClientRect()
    const ox = sr?.left ?? 0
    const oy = sr?.top ?? 0
    region = { W, H, copyL: r.left - ox, copyR: r.right - ox, copyT: r.top - oy, copyB: r.bottom - oy }
  }

  /** the product's screen region for this layout (px) */
  const productRegion = (W: number, H: number): Region => {
    const lay = layout(W, H)
    const gut = Math.max(16, Math.min(48, W * 0.034))
    const safeT = lay === 'short' ? 52 : Math.min(112, Math.max(80, H * 0.105))
    const safeB = lay === 'short' ? 52 : Math.min(110, Math.max(82, H * 0.105))
    if (lay === 'tall') {
      const bottom = region.W === W && region.copyT > 0 ? region.copyT - 14 : H * 0.5
      return { x0: gut, x1: W - gut, y0: safeT + 6, y1: Math.max(safeT + 140, bottom) }
    }
    const left = region.W === W && region.copyR > 0 ? region.copyR + (lay === 'short' ? 16 : 36) : W * 0.44
    return { x0: Math.min(W * 0.56, Math.max(W * 0.4, left)), x1: W - gut, y0: safeT + (lay === 'short' ? 4 : 10), y1: H - safeB - (lay === 'short' ? 4 : 10) }
  }

  return {
    id: 'citywide',
    group,
    anchors: [],

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      set = await buildSet(ctx)
      group.add(set.group)
      // for clearance checks from the console / screenshot scripts
      group.userData.citywide = set
      shotRest.copy(set.cw.shot.group.position)
      if (set.canAO) canAOopacity = (set.canAO.material as THREE.MeshBasicMaterial).opacity
      // the establishing frame: the brick bay's hi-fi + deck, the column with its sconce, the records
      const tt = set.back.worldAnchor('turntable')
      const paint = set.back.worldAnchor('paint')
      const sconce = set.back.worldAnchor('sconceC')
      const E = new THREE.Vector3(lerp(paint.x, sconce.x, 0.85), lerp(tt.y, paint.y, 0.47), SET.wallZ + 1.0)
      keys = makeKeys(E)
      const lp = set.back.worldAnchor('sleeve')
      tallE.set(lerp(paint.x, lp.x, 0.3), lerp(tt.y, paint.y, 0.5) + 0.2, E.z)

      // the lens renders the far layer before the composer, with the frame's real camera
      ctx.post.preRender.push((r, scene, cam) => {
        if (!group.visible) return
        set.lens.render(r, scene, cam, solo => {
          set.far.visible = solo ? true : set.lens.direct
          set.fg.visible = !solo
        })
      })
      set.lens.setSize(Math.max(64, window.innerWidth), Math.max(64, window.innerHeight))
      set.lens.warm(ctx.renderer)
      await nextFrame()

      // STAGE COPY (visual layer; the accessible copy lives in srContent)
      const stage = ctx.stage
      stage.classList.add('cw-stage')
      el('div', 'cw-scrim', undefined, stage)
      copy = el('div', 'cw-copy', undefined, stage)
      el('p', 'hud-eyebrow cw-eyebrow', SECTIONS.citywide.eyebrow, copy)
      title = rise(el('h2', 'hud-h2 cw-title', undefined, copy), CITY_WIDE.title.replace(/(\S+)$/, '<em>$1</em>'))
      el('p', 'cw-line', CITY_WIDE.line, copy)
      const list = el('ol', 'cw-items', undefined, copy)
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => (measured = '')).observe(copy)
      items = CITY_WIDE.items.map(it => {
        const li = el('li', 'cw-item', undefined, list)
        el('span', 'cw-mark', undefined, li)
        el('span', 'cw-detail', it.detail, li)
        el('span', 'cw-name', it.name, li)
        return li
      })
    },

    onEnter() {
      prevL = -1
      measured = ''
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      const l = local
      const t = frame.time
      const cw = set.cw

      // THE CAN: set down on the bar, then the tab
      const cs = canState(l, reduced)
      cw.can.group.visible = cs.visible
      cw.can.group.position.set(CAN.x, cs.y, CAN.z)
      cw.can.group.rotation.set(0, 0.12, cs.lean)
      if (set.canAO) {
        // the contact shade stays on the bar, softening as the can rises off it
        set.canAO.position.y = 0.0008 - cs.y
        const k = 1 - smoothstep(0, 1.4, cs.y)
        ;(set.canAO.material as THREE.MeshBasicMaterial).opacity = canAOopacity * k
        set.canAO.scale.setScalar(1 + cs.y * 0.5)
      }
      const open = smoothstep(B.tab[0], B.tab[1], l)
      cw.setCanOpen(open)

      // THE SHOT: slides in from the back right, stops beside the can
      const ss = shotState(l, reduced)
      cw.shot.group.visible = ss.visible
      cw.shot.group.position.set(shotRest.x + (1 - ss.k) * 1.9, ss.lift, shotRest.z - (1 - ss.k) * 2.6)
      cw.shot.group.rotation.set(0, 0, ss.wob)

      // THE POUR: the rye bottle tips in over the glass, the rye runs, it lifts out
      const inK = ease.inOutCubic(smoothstep(B.bottleIn[0], B.bottleIn[1], l))
      const outK = ease.inOutCubic(smoothstep(B.bottleOut[0], B.bottleOut[1], l))
      const flowT = smoothstep(B.flow[0], B.flow[1], l)
      const flow = smoothstep(B.flow[0], B.flow[0] + 0.008, l) * (1 - smoothstep(B.flow[1] - 0.008, B.flow[1], l))
      const bottleOn = l > B.bottleIn[0] - 0.002 && l < B.bottleOut[1] + 0.002
      set.bottle.group.visible = bottleOn
      const rimTop = cw.shot.rimTop
      if (bottleOn) {
        const away = Math.max(1 - inK, outK)
        const tilt = lerp(1.86 + 0.16 * flowT, 1.05, away)
        const h = 10.85 * IN
        const sx = shotRest.x + 0.25 * IN + away * 1.3
        const sy = rimTop + 0.95 * IN + away * 1.6
        const sz = shotRest.z - away * 0.2
        set.bottle.group.rotation.set(0, 0, tilt)
        set.bottle.group.position.set(sx + h * Math.sin(tilt), sy - h * Math.cos(tilt), sz)
      }
      cw.setShotFill(0.55 * ease.outQuad(smoothstep(B.flow[0] + 0.004, B.flow[1], l)))

      // THE CHEESE: lowered across the rim on its pick
      const cheeseK = smoothstep(B.cheese[0], B.cheese[1], l)
      cw.setCheese(cheeseK)

      // the world key (the photo's bar pendant: warm, front left, above)
      const w = ctx.world.params
      keyDir.set(-2.2, 3.4, 2.4).normalize()
      cw.setLight(keyDir)
      cw.update(frame)

      // the stream: from the bottle's lip to the rye's surface
      set.group.updateMatrixWorld(true)
      if (bottleOn && flow > 0.001) {
        set.bottle.lip(v)
        cw.anchors.rye.getWorldPosition(w2)
        w2.y = Math.max(w2.y, 0.6 * IN)
        const head = smoothstep(B.flow[1] - 0.012, B.flow[1] + 0.002, l)
        const tail = smoothstep(B.flow[0], B.flow[0] + 0.012, l)
        set.pour.set(v, w2, flow, head, tail)
      } else set.pour.set(v.set(0, -10, 0), v, 0)
      set.pour.update(t)

      // the backlight pool behind the shot (seen only through the rye)
      cw.shot.group.getWorldPosition(v)
      set.backlight.mesh.position.set(v.x, 0.004, v.z - 0.5)
      set.backlight.set(ss.visible ? 0.22 : 0)

      // THE ROOM: the deck spins the 7"; bulbs + pools
      const tt = set.back.turntable
      if (tt) {
        tt.setSpeed(45)
        tt.setArm(1)
        tt.setCue(0)
        tt.update(frame)
      }
      syncVinylLights(ctx.world)
      set.back.setGlow(1.05)
      set.back.setAmbient(0.9)
      set.bar.setGlow(1)
      set.bar.setAmbient(1)

      // THE LENS: the rack from the back bar to the can; the disc opens with a closer focus
      const W = frame.width
      const H = frame.height
      set.lens.setSize(W, H)
      measure(W, H)
      // scroll-mapped (not timed): the blur opens with the scroll, reduced motion included
      const rack = smoothstep(B.rack[0], B.rack[1], l)
      set.lens.focus = rack
      focusAt.set(sample(keys, l, 'x'), sample(keys, l, 'y'), sample(keys, l, 'z'))
      const dist = ctx.camera.position.distanceTo(focusAt)
      const base = Math.min(W, H * 1.4) * 0.03
      set.lens.radius = clamp(base * Math.pow(2.6 / Math.max(0.6, dist), 0.55), base * 0.6, base * 1.8)
      set.lens.sync()
      set.far.visible = set.lens.direct

      // WORLD: the bar after dark; the key on the pair, rims to make the rye and glass glow
      w.top = '#0c0806'
      w.bottom = '#040302'
      w.cyc = 0
      w.brick = 0
      w.room = 0.6
      w.haze = 0.04
      w.bulbs = 0.2
      w.bokeh = 0.1
      w.spot = 0.2
      w.spotColor = '#ffd2a0'
      w.spotPos.set(-2.2, 3.4, 2.4)
      w.spotAt.set(0.1, 0.25, 0)
      w.spotAngle = 0.42
      w.spotPenumbra = 0.8
      w.rimA = 0.32
      w.rimAColor = '#ffb46a'
      w.rimADir.set(-0.8, 0.45, -1)
      // the cool rim is for the glass and the rye; it stays off the back bar in the establishing beat
      w.rimB = 0.4 * smoothstep(0.16, 0.26, l)
      w.rimBColor = '#6f8fff'
      w.rimBDir.set(1, 0.3, -0.8)
      w.fill = 0.26
      w.env = 1
      w.envTurn = 0.1 + 0.25 * smoothstep(0.2, 0.9, l)

      // POST: a small settle as the can and the shot land; the amber cut
      const p = ctx.post.params
      const settle = (at: number, k: number) => (l > at && l < at + 0.05 ? k * Math.exp(-(l - at) * 90) : 0)
      p.glitch = reduced ? 0 : Math.max(settle(B.canIn[1], 0.3), settle(B.shotIn[1], 0.16))
      p.beer = 0.35
      p.bloomStrength = 0.3
      p.bloomThreshold = 0.95
      p.vignette = 0.38

      // SOUND (forward scroll only)
      sfx('thud', B.canIn[1], l, 0.9)
      sfx('fizz', lerp(B.tab[0], B.tab[1], 0.45), l, 1)
      sfx('thud', B.shotIn[1] + 0.0001, l, 0.6)
      sfx('pour', B.flow[0] + 0.004, l, 0.5)
      prevL = l

      // DOM: the copy rises at the landing and holds; each item lights as it arrives
      const vCopy = smoothstep(0.055, 0.085, l) * (1 - smoothstep(0.95, 0.975, l))
      reveal(copy, vCopy)
      setRise(title, l > 0.06 && l < 0.965)
      items.forEach((li, i) => {
        const on = l >= ARRIVE[i]
        if (li.classList.contains('is-on') !== on) li.classList.toggle('is-on', on)
      })
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      const l = local
      const W = frame.width
      const H = frame.height
      const S = (p: Prop) => sample(keys, l, p)
      const lay = layout(W, H)
      // a breath of drift in the holds (none under reduced motion)
      const drift = reduced ? 0 : Math.sin(frame.time * 0.13) * 0.6
      const yaw = S('yaw') + drift
      const pitch = S('pitch') + (lay === 'tall' ? 2 : 0)
      dirOf(yaw, pitch, dir)
      focusAt.set(S('x'), S('y'), S('z'))
      let fw = Math.exp(S('w'))
      let fh = Math.exp(S('h'))
      // the establishing frame is wide: portrait and short screens frame the deck + the column
      const wide = 1 - smoothstep(0.13, 0.24, l)
      if (lay === 'tall') {
        // the brick bay from "Old 1837" down to the deck and the LP, above the copy
        fw = lerp(fw, 11.5, wide)
        fh = lerp(fh, 15.5, wide)
        focusAt.lerp(tallE, wide)
      }
      if (lay === 'short') {
        fh = lerp(fh, 14.5, wide)
        focusAt.y -= 0.9 * wide
      }
      const fov = S('fov') + (lay === 'tall' ? 8 : 0)
      frameTo(out, focusAt, dir, fw, fh, productRegion(W, H), W, H, fov)
      out.roll = 0
      out.parallax = reduced ? 0 : 0.02
    },
  }
}
