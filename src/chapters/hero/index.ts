import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, reveal, rise, setRise } from '../../core/dom'
import { clamp, damp, ease, lerp, smoothstep, window01 } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { BRAND, HERO_UI, LINKS } from '../../content'
import { BEERS, makeBacklight, makeGlass, makePourStream, type Glass } from '../../kit/beer'
import { GEL } from '../../world/World'
import { REC12, syncVinylLights } from '../../kit/vinyl'
import { DECK_ANCHOR, SET, buildSet, type HeroSet } from './set'
import './hero.css'

/*
 * HERO — "This Must Be the Place". Glory after dark: the oiled bar, a
 * stainless tap column, Glory's brick wall and the tall windows onto
 * Chestnut Street. A product film of the first pour.
 *
 *   0.00–0.10  LANDING  the painted sign as type (motto → GLORY / Beer Bar &
 *                       Kitchen → tagline → address → Reserve / See the menu);
 *                       the walnut deck spinning a red-label Glory record, arm
 *                       on its rest; an empty tulip glass under the faucet
 *   0.07–0.20  NEEDLE   the tonearm swings over the lead-in and cues down —
 *                       the needle lands as the beer starts to run
 *   0.10–0.64  POUR     the glass lifts and tilts under the spout, the handle
 *                       pulls, beer streams in, the glass rights itself as it
 *                       fills, the foam rises; carbonation starts; the copy
 *                       slides aside to a compact caption (tagline kept)
 *   0.64–0.76  SET DOWN the full glass is carried onto the red-G coaster and
 *                       lands with a small settle; the beer sloshes, damped
 *   0.76–0.93  PAYOFF   slow orbit; "This must be the place." + the CTAs
 *   0.94–1.00  OUT      push toward the glass → the pour cut (amber)
 *
 * Everything derives from `local`; frame.time only drives idle motion
 * (bubbles, the stream's ripples, a breath of camera drift).
 */

interface Key {
  t: number
  fx: number
  fy: number
  fz: number
  az: number
  el: number
  dist: number
  /** landscape framing: shift the look target along camera right / up, × dist */
  sx: number
  sy: number
  fov: number
}
type Prop = Exclude<keyof Key, 't'>

const PX = SET.pour.x
const PZ = SET.pour.z
const CX = SET.coaster.x
const CZ = SET.coaster.z

// prettier-ignore
const KEYS: Key[] = [
  { t: 0.0,  fx: -1.0,     fy: 1.1,  fz: -0.8, az: 0.3,  el: 0.2,   dist: 12.0, sx: -0.23, sy: -0.02, fov: 34 },
  { t: 0.1,  fx: -0.9,     fy: 1.15, fz: -0.7, az: 0.34, el: 0.18,  dist: 11.2, sx: -0.21, sy: -0.02, fov: 34 },
  { t: 0.24, fx: PX - 0.35, fy: 1.95, fz: PZ, az: 0.55, el: 0.08,  dist: 6.9,  sx: -0.07, sy: 0.0,   fov: 34 },
  { t: 0.42, fx: PX - 0.2, fy: 2.1,  fz: PZ, az: 0.62,  el: 0.0,   dist: 5.8,  sx: -0.06, sy: 0.0,   fov: 34 },
  { t: 0.58, fx: PX,       fy: 2.15, fz: PZ, az: 0.36,  el: 0.04,  dist: 5.9,  sx: -0.08, sy: 0.0,   fov: 34 },
  { t: 0.7,  fx: (PX + CX) / 2, fy: 1.7, fz: (PZ + CZ) / 2, az: 0.12, el: 0.09, dist: 7.4, sx: -0.1, sy: 0.0, fov: 34 },
  { t: 0.8,  fx: 0.3,      fy: 1.3,  fz: -0.2, az: 0.2,   el: 0.16,  dist: 10.2, sx: 0.25,  sy: -0.02, fov: 34 },
  { t: 0.93, fx: 0.3,      fy: 1.3,  fz: -0.2, az: 0.04,  el: 0.16,  dist: 9.8,  sx: 0.25,  sy: -0.02, fov: 34 },
  { t: 1.0,  fx: CX,       fy: 1.75, fz: CZ, az: -0.3,  el: 0.05,  dist: 2.6,  sx: 0.0,   sy: 0.0,   fov: 30 },
]

/** smooth monotone cubic through the keys (no stops at each key) */
function sample(t: number, prop: Prop): number {
  const n = KEYS.length
  if (t <= KEYS[0].t) return KEYS[0][prop]
  if (t >= KEYS[n - 1].t) return KEYS[n - 1][prop]
  let i = 0
  while (i < n - 2 && t > KEYS[i + 1].t) i++
  const k0 = KEYS[i]
  const k1 = KEYS[i + 1]
  const h = k1.t - k0.t
  const s = (t - k0.t) / h
  const slope = (j: number) => {
    if (j <= 0 || j >= n - 1) return 0
    const a = KEYS[j - 1]
    const b = KEYS[j]
    const c = KEYS[j + 1]
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

/** 0 landscape .. 1 tall portrait */
const portraitQ = (aspect: number) => clamp((1.25 - aspect) / 0.7)

/** the pour, as a function of local (every value derived, nothing accumulated) */
function pourState(l: number) {
  const up = smoothstep(0.1, 0.2, l)
  const tiltMax = 0.78
  const tilt = tiltMax * up * (1 - smoothstep(0.3, 0.57, l))
  const pull = smoothstep(0.17, 0.205, l) * (1 - smoothstep(0.6, 0.635, l))
  const flow = smoothstep(0.195, 0.215, l) * (1 - smoothstep(0.615, 0.64, l))
  // the stream: reaches down from the spout, then breaks off at the top and falls
  const tail = smoothstep(0.196, 0.222, l)
  const head = smoothstep(0.615, 0.652, l)
  const liquid = ease.outQuad(smoothstep(0.215, 0.62, l)) * 0.85 + 0.15 * smoothstep(0.215, 0.62, l)
  // foam: little while tilted, it kicks up as the glass rights, then settles
  const kick = smoothstep(0.4, 0.62, l)
  const settle = smoothstep(0.62, 0.8, l)
  const sx = Math.max(0, l - 0.62)
  const bob = Math.exp(-sx * 26) * Math.sin(sx * 70) * 0.012 * kick
  const foam = 0.006 * smoothstep(0.3, 0.4, l) + 0.15 * kick - 0.05 * settle + bob
  const poured = smoothstep(0.2, 0.235, l)
  const fill = poured * Math.min(0.955, 0.015 + 0.78 * liquid + foam * 0.95 * smoothstep(0.215, 0.3, l))
  // the carry to the coaster, landing at 0.745
  const carry = ease.inOutCubic(smoothstep(0.648, 0.745, l))
  return { poured, up, tilt, tiltMax, pull, flow, tail, head, liquid, foam, fill, carry }
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let set: HeroSet
  let glass: Glass
  let stream: ReturnType<typeof makePourStream>
  let back: ReturnType<typeof makeBacklight>
  let reduced = false

  // DOM
  let copy: HTMLElement
  let glory: HTMLElement
  let pourCap: HTMLElement
  let payoff: HTMLElement
  let motto: HTMLElement

  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const spoutW = new THREE.Vector3()
  const landW = new THREE.Vector3()
  const box = new THREE.Box3()
  let lastRect = ''
  let lastRec = ''
  // the tonearm's damped pose (targets derive from local; this only smooths)
  let armD = 0
  let cueD = 1
  let fresh = true
  let prevL = 0
  let needleAt = -1e9
  let prevCue = 1
  const recW = new THREE.Vector3()
  const camRight = new THREE.Vector3()

  return {
    id: 'hero',
    group,
    anchors: [],

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      set = buildSet(ctx.mobile)
      group.add(set.group)
      await nextFrame()

      glass = makeGlass({ shape: 'tulip', beer: BEERS.amber, scale: SET.glassScale, fill: 0, head: 0, bubbles: ctx.mobile ? 110 : 200 })
      glass.group.position.copy(SET.pour)
      glass.setBubbles(0)
      group.add(glass.group)
      stream = makePourStream(BEERS.amber, 0.05)
      group.add(stream.mesh)
      back = makeBacklight({ width: 1.9, height: 3.0, color: '#ffd29a', hdr: 1.5, isFrameTarget: rt => ctx.post.isFrameTarget(rt) })
      group.add(back.mesh)
      await nextFrame()

      // STAGE COPY (visual layer; the accessible h1 lives in srContent)
      const stage = ctx.stage
      stage.classList.add('hero-stage')
      copy = el('div', 'hero-copy', undefined, stage)
      el('p', 'hud-eyebrow hero-eyebrow', BRAND.motto, copy)
      const name = el('div', 'hero-name', undefined, copy)
      glory = rise(el('span', 'hero-glory', undefined, name), BRAND.short)
      const plate = el('span', 'hero-plate', undefined, name)
      el('span', 'hero-bbk', BRAND.name.replace(/^Glory\s+/, ''), plate)
      el('p', 'hud-body hero-tag', BRAND.tagline, copy)
      el('p', 'hud-label hero-addr', `${BRAND.street} · ${BRAND.neighborhood} · ${BRAND.city}`, copy)
      const ctas = el('div', 'hero-ctas', undefined, copy)
      const cta = (parent: HTMLElement) => {
        const a = el('a', 'hud-btn', LINKS.reserve.label, parent)
        a.href = LINKS.reserve.url
        a.target = '_blank'
        a.rel = 'noopener'
        const b = el('button', 'hud-btn hud-btn--ghost', HERO_UI.menu, parent)
        b.type = 'button'
        b.addEventListener('click', () => window.__hark?.land('kitchen'))
      }
      cta(ctas)

      pourCap = el('div', 'hero-pourcap', undefined, stage)
      el('p', 'hud-label hero-pourcap-k', HERO_UI.pour, pourCap)
      el('p', 'hero-pourcap-name', BRAND.short, pourCap)
      el('p', 'hud-body hero-pourcap-tag', BRAND.tagline, pourCap)

      payoff = el('div', 'hero-payoff', undefined, stage)
      el('p', 'hud-eyebrow', BRAND.name, payoff)
      motto = rise(el('p', 'hud-title hero-motto', undefined, payoff), BRAND.motto.replace(/place\.$/, '<em>place.</em>'))
      el('p', 'hud-label hero-addr', `${BRAND.street} · ${BRAND.neighborhood}`, payoff)
      cta(el('div', 'hero-ctas', undefined, payoff))
    },

    onEnter() {
      lastRect = ''
      lastRec = ''
      fresh = true
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      const l = local
      const t = frame.time
      const s = pourState(l)
      const G = SET.glassScale

      // THE FAUCET + THE GLASS
      set.faucet.setPull(s.pull)
      glass.setTilt(s.tilt)
      glass.setFill(s.fill)
      glass.setHead(Math.max(0, s.foam) * s.poured)
      // hold the tilted glass so the stream lands on its low inner wall, then
      // (upright) in the middle of the foam
      const upright = 1 - s.tilt / s.tiltMax
      const hitY = 0.74
      const hitX = lerp(-0.3, 0.0, upright)
      const cs = Math.cos(s.tilt)
      const sn = Math.sin(s.tilt)
      const offX = (hitX * cs - hitY * sn) * G
      set.faucet.spout.getWorldPosition(spoutW)
      const pourX = lerp(SET.pour.x, spoutW.x - offX, s.up)
      const pourY = SET.pour.y + 0.28 * s.up
      const pourZ = SET.pour.z
      // the carry: an arc from the tap onto the coaster
      const c = s.carry
      const gx = lerp(pourX, SET.coaster.x, c)
      const gz = lerp(pourZ, SET.coaster.z, c)
      const gy = lerp(pourY, SET.coaster.y + 0.035, c) + Math.sin(c * Math.PI) * 0.35
      glass.group.position.set(gx, gy, gz)
      // slosh: the carry's acceleration, then a damped ring after it lands
      const land = Math.max(0, l - 0.745)
      const ring = l > 0.745 ? Math.exp(-land * 32) * Math.sin(land * 150) * 0.07 : 0
      const accel = Math.sin(c * Math.PI * 2) * 0.06 * (c > 0 && c < 1 ? 1 : 0)
      const idle = reduced ? 0 : Math.sin(t * 1.3) * 0.004 * smoothstep(0.75, 0.8, l)
      glass.setSlosh(0, (-accel + ring + idle) * (reduced ? 0.3 : 1))
      // the strip highlights curl on a tilted bowl: calm them while it leans
      glass.setStrips(1 - 0.65 * (s.tilt / s.tiltMax))
      glass.setBubbles(smoothstep(0.3, 0.55, l))
      glass.setGlow(0.28 + 0.16 * smoothstep(0.55, 0.8, l))
      glass.update(t)

      // THE DECK: spinning from the start; the arm swings over the lead-in
      // and cues down as the pour begins (targets from local, damped by time)
      const tt = set.tt
      syncVinylLights(ctx.world)
      const armT = smoothstep(0.07, 0.15, l)
      const cueT = 1 - smoothstep(0.15, 0.195, l)
      if (fresh) {
        armD = armT
        cueD = cueT
        tt.setSpeed(33.333, true)
      } else {
        armD = damp(armD, armT, 7, frame.dt)
        cueD = damp(cueD, cueT, 9, frame.dt)
      }
      tt.setSpeed(33.333)
      tt.setArm(armD)
      tt.setCue(cueD)
      tt.setGroove(0.03 + 0.25 * smoothstep(0.2, 1, l))
      tt.update(frame)
      // the needle lands: one drop sound, forward scroll only, rate-limited
      const nowS = performance.now() / 1000
      if (!fresh && cueT < 0.5 && prevCue >= 0.5 && l > prevL && nowS - needleAt > 2.5) {
        needleAt = nowS
        window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind: 'needle' } }))
      }
      prevCue = cueT
      prevL = l
      fresh = false

      // THE STREAM: straight down from the spout to the wall it hits / the foam
      glass.group.updateMatrixWorld(true)
      tmp.set(hitX, hitY, 0)
      glass.pivot.localToWorld(tmp)
      // the foam's top on the axis (the level is world-horizontal)
      const top = 0.4 + (glass.height - 0.02 - 0.4) * s.fill
      tmp2.set(0, top, 0)
      glass.pivot.localToWorld(tmp2)
      landW.set(spoutW.x, Math.max(tmp.y, tmp2.y) - 0.02, spoutW.z)
      stream.set(spoutW, landW, s.flow, s.head, s.tail)
      stream.update(t)

      // THE BACKLIGHT: a softbox behind the glass, facing the camera
      const cam = ctx.camera
      glass.mouth(tmp)
      tmp.y -= 0.9
      tmp2.copy(tmp).sub(cam.position).setY(0).normalize()
      back.mesh.position.copy(tmp).addScaledVector(tmp2, 1.5)
      back.mesh.lookAt(cam.position)
      back.set(0.55 + 0.45 * smoothstep(0.2, 0.6, l))

      // THE ROOM (world): bar after dark, brick, bulbs; the key on the glass
      const w = ctx.world.params
      w.top = '#130b08'
      w.bottom = '#050302'
      w.brick = 0.25
      w.bulbs = 0.9
      w.bokeh = 0.25
      w.haze = 0.18
      w.cyc = 0.35
      w.cycX = 0.3
      w.cycY = 0.1
      w.spot = 0.75
      w.spotColor = GEL.tungsten
      w.spotPos.set(gx - 3.2, 10, gz + 5.5)
      w.spotAt.set(gx, 1.1, gz)
      w.spotAngle = 0.34
      w.spotPenumbra = 0.7
      w.rimA = 1.1
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.9, 0.5, -1)
      w.rimB = 0.55
      w.rimBColor = '#9fb4dc'
      w.rimBDir.set(1, 0.35, -0.8)
      w.fill = 0.14
      w.env = 1
      w.envTurn = 0.25 + 0.4 * smoothstep(0.1, 0.9, l) + (reduced ? 0 : Math.sin(t * 0.07) * 0.05)
      set.wash.intensity = 60

      // POST: a small settle as the glass lands; the amber pour cut at the end
      const p = ctx.post.params
      const settleK = l > 0.745 && l < 0.8 ? Math.exp(-(l - 0.745) * 90) : 0
      p.glitch = reduced ? 0 : 0.35 * settleK
      p.beer = 0.45
      p.bloomStrength = 0.32
      p.bloomThreshold = 1.05
      p.vignette = 0.36

      // DOM
      const vCopy = 1 - smoothstep(0.11, 0.17, l)
      reveal(copy, vCopy, 0)
      copy.style.transform = `translate3d(${(-(1 - vCopy) * 70).toFixed(1)}px,0,0)`
      setRise(glory, reduced || l < 0.15)
      reveal(pourCap, window01(l, 0.17, 0.7, 0.04))
      const vPay = window01(l, 0.745, 0.955, 0.035)
      reveal(payoff, vPay)
      setRise(motto, l > 0.75 && l < 0.95)

      // loader → hero match cut: the glass's first-frame rect as CSS vars
      if (l < 0.02) {
        box.setFromObject(glass.glass)
        let x0 = Infinity
        let x1 = -Infinity
        let y0 = Infinity
        let y1 = -Infinity
        for (let i = 0; i < 8; i++) {
          tmp.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam)
          const sx = (tmp.x * 0.5 + 0.5) * frame.width
          const sy = (-tmp.y * 0.5 + 0.5) * frame.height
          x0 = Math.min(x0, sx)
          x1 = Math.max(x1, sx)
          y0 = Math.min(y0, sy)
          y1 = Math.max(y1, sy)
        }
        if (Number.isFinite(x0 + x1 + y0 + y1)) {
          const key = `${Math.round((x0 + x1) / 2)}|${Math.round((y0 + y1) / 2)}|${Math.round(y1 - y0)}`
          if (key !== lastRect) {
            lastRect = key
            const r = document.documentElement.style
            r.setProperty('--glory-hero-x', `${Math.round((x0 + x1) / 2)}px`)
            r.setProperty('--glory-hero-y', `${Math.round((y0 + y1) / 2)}px`)
            r.setProperty('--glory-hero-h', `${Math.round(y1 - y0)}px`)
          }
        }
        // the record (the loader's spinning record match-cuts onto it): its
        // centre and its on-screen radius (the flat disc's horizontal half-axis)
        set.record.group.getWorldPosition(recW)
        const R = REC12.R * DECK_ANCHOR.scale
        camRight.setFromMatrixColumn(cam.matrixWorld, 0).normalize()
        tmp.copy(recW).project(cam)
        tmp2.copy(recW).addScaledVector(camRight, R).project(cam)
        const cx = (tmp.x * 0.5 + 0.5) * frame.width
        const cy = (-tmp.y * 0.5 + 0.5) * frame.height
        const rr = Math.abs(tmp2.x - tmp.x) * 0.5 * frame.width
        if (Number.isFinite(cx + cy + rr)) {
          const key = `${Math.round(cx)}|${Math.round(cy)}|${Math.round(rr)}`
          if (key !== lastRec) {
            lastRec = key
            const r = document.documentElement.style
            r.setProperty('--glory-record-x', `${Math.round(cx)}px`)
            r.setProperty('--glory-record-y', `${Math.round(cy)}px`)
            r.setProperty('--glory-record-r', `${Math.round(rr)}px`)
          }
        }
      }
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      const l = local
      const q = portraitQ(frame.width / frame.height)
      const S = (p: Prop) => sample(l, p)
      const drift = reduced ? 0 : Math.sin(frame.time * 0.11) * 0.015
      const az = S('az') + drift
      const el = S('el') + q * 0.04
      // portrait: step back (the frame is narrow) and hold the subject high, the copy beneath
      const payoffQ = window01(l, 0.72, 0.97, 0.06)
      const dist = S('dist') * lerp(1, lerp(l < 0.16 ? 1.72 : 1.55, 1.45, payoffQ) * (1 - 0.35 * smoothstep(0.93, 1, l)), q)
      const fov = S('fov') + 6 * q
      // portrait: the landing centres the record + glass pair; the payoff centres the glass
      const landQ = 1 - smoothstep(0.1, 0.24, l)
      const F = tmp.set(S('fx') + q * (-0.45 * landQ + 1.5 * payoffQ), S('fy'), S('fz') + q * 0.6 * payoffQ)
      out.position.set(F.x + Math.sin(az) * Math.cos(el) * dist, F.y + Math.sin(el) * dist, F.z + Math.cos(az) * Math.cos(el) * dist)
      // the framing shift: along camera right / up
      const rx = Math.cos(az)
      const rz = -Math.sin(az)
      const sx = lerp(S('sx'), 0, q)
      const syPortrait = lerp(-0.2, lerp(-0.08, -0.17, payoffQ), smoothstep(0.1, 0.24, l))
      const sy = lerp(S('sy'), syPortrait * (1 - smoothstep(0.93, 1, l)), q)
      out.target.set(F.x + rx * sx * dist, F.y + sy * dist, F.z + rz * sx * dist)
      out.fov = fov
      out.roll = 0
      out.parallax = reduced ? 0 : 0.12
    },
  }
}
