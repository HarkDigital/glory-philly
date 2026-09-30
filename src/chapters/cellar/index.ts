import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { BRAND } from '../../content'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { makeBarTop } from '../../kit/bar'
import { StoryClock } from '../../kit/pace'
import { whenRevealed } from '../../kit/images'
import { GEL } from '../../world/World'
import { makeBottleWall, SECTION_X, WALL_Z, ROW_Y, type BottleWall } from './bottles'
import { makeWineTower, type WineTower } from './wine'
import { makeSlot, SPECS, type CocktailSlot } from './cocktails'
import { CellarHud, layoutOf, type BeatState } from './hud'
import { AM, ANCHORS, COCK, HEAD_IN, HEAD_OUT, INTL, LOC, OUT, POUR, SLOT, WINE_T, cocktailPos, intlPage } from './timeline'
import './cellar.css'

/*
 * THE CELLAR — bottles, wine on tap, specialty cocktails (see timeline.ts for
 * the beat sheet). A product film along Glory's back bar: a backlit wall of
 * bottles the camera tracks shelf by shelf while each group's list reads in
 * a card; then the stainless wine tower pours red, white and rosé; then the
 * seven cocktails slide down the bar one at a time as product shots.
 */

const WINE_AT = new THREE.Vector3(12.8, 0, 0.9)
const COCK_AT = new THREE.Vector3(18.6, 0, 1.25)
const COCK_SPACING = 2.8

/* ---------------- camera shots ---------------- */

/** subject point, distance, azimuth (0 = from +z), elevation, lens, screen offset of the subject (sx: +right, sy: +up, in half-frames), tall distance factor */
interface Shot {
  x: number
  y: number
  z: number
  d: number
  az: number
  el: number
  fov: number
  sx: number
  sy: number
  tk: number
}
const KEYS = ['x', 'y', 'z', 'd', 'az', 'el', 'fov', 'sx', 'sy', 'tk'] as const
const S = (x: number, y: number, z: number, d: number, az: number, el: number, fov: number, sx: number, sy = 0, tk = 1.25): Shot => ({ x, y, z, d, az, el, fov, sx, sy, tk })
const Z = WALL_Z
const R0 = ROW_Y[0] + 0.95
const R1 = ROW_Y[1] + 0.95
const R2 = ROW_Y[2] + 1.25
const IX = SECTION_X.international
const AX = SECTION_X.american
/** one International page (= shelf) */
const PG = (INTL[1] - INTL[0]) / 3

const SHOTS: [number, Shot][] = [
  [0.0, S(-7.5, 5.2, Z, 13, 0.42, 0.08, 40, 0.1, 0, 1.2)],
  [HEAD_IN, S(-4, 4.8, Z, 12, 0.22, 0.05, 38, 0.3, 0, 1.25)],
  [HEAD_OUT - 0.01, S(-6.4, 5, Z, 11, 0.12, 0.04, 36, 0.3, 0, 1.25)],
  // American: tilt down its three shelves
  [AM[0] + 0.012, S(AX, R0 - 0.4, Z, 6.6, -0.1, 0.05, 34, 0.45, 0, 1.35)],
  [AM[1] - 0.006, S(AX, R2 - 0.2, Z, 6.8, 0.04, 0.05, 34, 0.45, 0, 1.35)],
  // International: snake the three shelves (row = page = lit column)
  [INTL[0] + 0.15 * PG, S(IX - 3, R0, Z, 6.4, 0.12, 0.04, 34, 0.5, 0, 1.3)],
  [INTL[0] + 0.85 * PG, S(IX + 3, R0, Z, 6.4, -0.1, 0.04, 34, 0.5, 0, 1.3)],
  [INTL[0] + 1.15 * PG, S(IX + 3, R1, Z, 6.4, -0.1, 0.03, 34, 0.5, 0, 1.3)],
  [INTL[0] + 1.85 * PG, S(IX - 3, R1, Z, 6.4, 0.1, 0.03, 34, 0.5, 0, 1.3)],
  [INTL[0] + 2.15 * PG, S(IX - 3, R2, Z, 7.0, 0.1, 0.07, 34, 0.5, 0, 1.3)],
  [INTL[1] - 0.004, S(IX + 3, R2, Z, 7.0, -0.1, 0.07, 34, 0.5, 0, 1.3)],
  // Local: a macro on the two bottles
  [LOC[0] + 0.012, S(SECTION_X.local, ROW_Y[2] + 1.05, Z, 3.6, -0.2, 0.06, 30, 0.35, 0, 1.5)],
  [LOC[1] - 0.004, S(SECTION_X.local, ROW_Y[2] + 1.05, Z, 3.2, -0.32, 0.04, 30, 0.35, 0, 1.5)],
  // wine: the tower pours
  [WINE_T[0] + 0.014, S(WINE_AT.x, 1.5, WINE_AT.z, 7.2, -0.14, 0.1, 32, 0.36, 0, 1.55)],
  [WINE_T[1] - 0.012, S(WINE_AT.x, 1.4, WINE_AT.z, 6.5, 0.08, 0.08, 32, 0.36, 0, 1.55)],
  // cocktails: a slow orbit across the seven
  [COCK[0] + 0.008, S(COCK_AT.x, 0.62, COCK_AT.z, 3.3, -0.14, 0.1, 30, 0.3, 0, 1.2)],
  [OUT - 0.004, S(COCK_AT.x, 0.62, COCK_AT.z, 3.1, 0.14, 0.08, 30, 0.3, 0, 1.2)],
  [1.0, S(COCK_AT.x, 0.66, COCK_AT.z, 2.3, 0.2, 0.06, 30, 0.22, 0, 1.2)],
]

/** framing height of each cocktail's glass (+ garnish) */
const GLASS_H = { coupe: 0.86, rocks: 0.8, collins: 1.5 }
const cocktailH = (pos: number) => {
  const i = Math.floor(pos)
  const a = GLASS_H[SPECS[Math.min(6, i)].glass]
  const b = GLASS_H[SPECS[Math.min(6, i + 1)].glass]
  return lerp(a, b, ease.inOutCubic(pos - i))
}

const _shot = S(0, 0, 0, 1, 0, 0, 30, 0)
function shotAt(q: number, out: Shot) {
  let i = 0
  while (i < SHOTS.length - 2 && q > SHOTS[i + 1][0]) i++
  const [t0, a] = SHOTS[i]
  const [t1, b] = SHOTS[i + 1]
  const s = ease.inOutCubic(clamp((q - t0) / (t1 - t0)))
  for (const k of KEYS) out[k] = lerp(a[k], b[k], s)
  // cocktails: frame the glass on the bar (a tall collins needs more room)
  const c = smoothstep(COCK[0] - 0.012, COCK[0] + 0.004, q)
  if (c > 0) {
    const h = cocktailH(cocktailPos(q))
    out.y = lerp(out.y, 0.08 + h * 0.5, c)
    out.d = lerp(out.d, (1.7 + h * 1.75) * (out.d / 3.2), c)
  }
  return out
}

/* ---------------- the chapter ---------------- */

export default function cellar(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.075 })
  let hud: CellarHud
  let wall: BottleWall
  let tower: WineTower
  let slots: CocktailSlot[] = []
  let q = 0
  const tmp = new THREE.Vector3()
  const state: BeatState = { beat: null, page: 0, cocktail: 0, head: false }
  const pour = [0, 0, 0]
  const cards: THREE.Mesh[] = []

  return {
    id: 'cellar',
    group,
    anchors: ANCHORS,
    busy: () => clock.busy,

    async init(ctx: ChapterContext) {
      hud = new CellarHud(ctx.stage)
      wall = await makeBottleWall(ctx.mobile)
      group.add(wall.group)
      // redraw the label atlas in the real faces
      const faces = ['italic 400 40px "Instrument Serif"', '400 40px "Alfa Slab One"']
      Promise.race([Promise.all(faces.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]).then(() => wall.redraw())
      document.fonts?.ready.then(() => wall.redraw())
      await nextFrame()

      // the front bar the wine and the cocktails stand on
      const bar = makeBarTop({ length: 44, depth: 3.4 })
      bar.position.set(6, 0, 1.3)
      group.add(bar)
      // the bar's front face (dark oak), so low shots never see under it
      const front = new THREE.Mesh(new THREE.BoxGeometry(44, 3, 0.1), new THREE.MeshStandardMaterial({ color: '#1c100a', roughness: 0.7 }))
      front.position.set(6, -1.62, 3.0)
      group.add(front)

      tower = makeWineTower()
      tower.group.position.copy(WINE_AT)
      group.add(tower.group)
      await nextFrame()

      // cocktail glass: an additive highlight shell (the liquid and ice inside
      // must stay visible; a transmissive shell would hide other transmissive meshes)
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        roughness: 0.04,
        metalness: 0,
        specularIntensity: 1,
        envMapIntensity: 2.2,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const iceMat = new THREE.MeshPhysicalMaterial({
        color: '#8c9aa0',
        roughness: 0.1,
        envMapIntensity: 2,
        clearcoat: 1,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      })
      const iceMatI = iceMat.clone()
      slots = [makeSlot(glassMat, iceMat, iceMatI, 5), makeSlot(glassMat, iceMat, iceMatI, 9)]
      for (const s of slots) group.add(s.group)
      slots[0].show(0)
      slots[1].show(1)

      // light cards behind the glasses: bright in three's transmission pass (so the
      // liquid glows like a backlit product shot), not drawn in the frame
      const card = (w: number, h: number, at: THREE.Vector3, k: number) => {
        const cv = document.createElement('canvas')
        cv.width = cv.height = 128
        const g2 = cv.getContext('2d')!
        const gr = g2.createRadialGradient(64, 64, 4, 64, 64, 64)
        gr.addColorStop(0, '#fff3dc')
        gr.addColorStop(0.5, '#ffc98a')
        gr.addColorStop(1, '#000000')
        g2.fillStyle = gr
        g2.fillRect(0, 0, 128, 128)
        const tex = new THREE.CanvasTexture(cv)
        tex.colorSpace = THREE.SRGBColorSpace
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(k, k, k), toneMapped: false })
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
        m.position.copy(at)
        m.onBeforeRender = r => {
          const inPass = r.toneMapping === THREE.NoToneMapping
          mat.colorWrite = inPass
          mat.depthWrite = inPass
        }
        group.add(m)
        return m
      }
      cards.push(card(2.4, 2.2, new THREE.Vector3(COCK_AT.x, 0.8, COCK_AT.z - 1.4), 0.9))
      cards.push(card(4.2, 1.8, new THREE.Vector3(WINE_AT.x, 0.95, WINE_AT.z - 1.2), 0.8))

      // the Glory roundel above the Local shelf: a stamp, used once
      const plaqueMat = new THREE.MeshStandardMaterial({ color: '#2a1a14', roughness: 0.5, transparent: true, alphaTest: 0.5 })
      const plaque = new THREE.Mesh(new THREE.CircleGeometry(0.62, 48), plaqueMat)
      plaque.position.set(SECTION_X.local, ROW_Y[2] + 4.3, WALL_Z - 0.2)
      group.add(plaque)
      whenRevealed()
        .then(() => new THREE.TextureLoader().loadAsync(BRAND.roundel))
        .then(t => {
          t.colorSpace = THREE.SRGBColorSpace
          plaqueMat.map = t
          plaqueMat.color.set('#ffffff')
          plaqueMat.emissive.set('#ffffff')
          plaqueMat.emissiveMap = t
          plaqueMat.emissiveIntensity = 0.35
          plaqueMat.needsUpdate = true
        })
        .catch(() => {})
    },

    onEnter() {
      clock.reset()
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      q = clock.update(local, frame.dt)
      const t = frame.still ? 0 : frame.time
      const reduced = frame.reducedMotion

      // ---- beats ----
      state.head = local > HEAD_IN - 0.004 && q < HEAD_OUT && local < HEAD_OUT + 0.01
      state.beat =
        q >= AM[0] && q < AM[1] ? 'american'
        : q >= INTL[0] && q < INTL[1] ? 'international'
        : q >= LOC[0] && q < LOC[1] ? 'local'
        : q >= WINE_T[0] && q < WINE_T[1] ? 'wine'
        : q >= COCK[0] && q < OUT + 0.02 && local < 0.975 ? 'cocktails'
        : null
      state.page = intlPage(q)
      const pos = cocktailPos(q)
      state.cocktail = Math.round(pos)
      hud.update(state, frame.width, frame.height)

      // ---- wine: staggered pours ----
      for (let i = 0; i < 3; i++) {
        const a = POUR[0] + i * 0.012
        pour[i] = clamp((q - a) / (POUR[1] - POUR[0] - 0.024))
      }
      tower.set(pour, t, reduced)

      // ---- cocktails: two slots alternate by parity ----
      const i0 = Math.floor(pos)
      const f = pos - i0
      for (let s = 0; s < 2; s++) {
        const k = i0 % 2 === s ? i0 : i0 + 1
        const slot = slots[s]
        if (k > 6 || (k === i0 + 1 && f <= 0)) {
          slot.group.visible = false
          continue
        }
        slot.group.visible = true
        slot.show(k)
        const off = k - pos
        slot.group.position.set(COCK_AT.x + off * COCK_SPACING, 0, COCK_AT.z + Math.abs(off) * 0.25)
        // a slow turntable within the slot, and a settle wobble as it lands
        const within = (q - COCK[0]) / SLOT - k
        const land = Math.max(0, 1 - Math.abs(off) * 1)
        slot.group.rotation.y = -0.35 + 0.5 * clamp(within, -0.2, 1.2) + (reduced ? 0 : Math.sin(t * 0.35 + k) * 0.05)
        slot.group.rotation.z = off * 0.04 + (1 - land) * 0
        slot.tick(reduced ? 1.3 : t)
      }

      // ---- light ----
      const w = ctx.world.params
      const inBottles = q < WINE_T[0] - 0.01
      const cocktails = q > COCK[0] - 0.012
      w.top = '#0c0706'
      w.bottom = '#040201'
      w.brick = 0.18
      w.brickColor = '#2e140d'
      w.bulbs = 0.32
      w.haze = 0.14
      w.bokeh = 0.12
      w.cyc = 0.25
      w.cycColor = '#4a2414'
      w.fill = 0.16
      w.env = 1.1
      // the softbox strips sweep across the glass as the camera tracks
      w.envTurn = -0.6 + q * 3.2
      shotAt(q, _shot)
      const sub = tmp.set(_shot.x, _shot.y, _shot.z)
      const fin = smoothstep(0.93, 0.99, local)
      w.spot = (inBottles ? 0.75 : cocktails ? 1.05 : 0.95) * (1 - 0.45 * fin)
      w.spotColor = GEL.tungsten
      w.spotAngle = inBottles ? 0.5 : 0.36
      w.spotPenumbra = 0.7
      w.spotPos.set(sub.x + 2.5, sub.y + 7.5, sub.z + 7)
      w.spotAt.copy(sub)
      w.rimA = cocktails ? 1.6 : 1.2
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.8, 0.45, -1)
      w.rimB = cocktails ? 1.0 : 0.7
      w.rimBColor = GEL.cream
      w.rimBDir.set(0.9, 0.35, -1)
      wall.setBacklight(inBottles ? 0.95 : 0.7)
      // no bright finale into the cut: the product-shot card dims as we push in
      if (cards[0]) ((cards[0].material as THREE.MeshBasicMaterial).color.setScalar(0.9 * (1 - 0.55 * smoothstep(0.93, 0.99, local))))

      // ---- post: a ruby pour out ----
      ctx.post.params.beer = lerp(0.62, 0.8, smoothstep(0.3, 0.9, local))
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      const s = shotAt(Number.isFinite(q) ? q : local, _shot)
      const layout = layoutOf(frame.width, frame.height)
      const tall = layout === 'phone' || layout === 'tablet'
      const aspect = frame.width / Math.max(1, frame.height)
      let d = s.d
      let fov = s.fov
      let sx = s.sx
      let sy = s.sy
      if (tall) {
        d *= s.tk
        fov = Math.min(56, fov + 12)
        sx = 0
        // the sheet takes the bottom ~45%: the subject sits in the top half
        sy = layout === 'phone' ? 0.42 : 0.36
      } else if (layout === 'short') {
        d *= 1.08
        sx *= 0.9
      }
      // the cut in: a fast dolly along the wall
      const inT = 1 - smoothstep(0, 0.055, local)
      const outT = smoothstep(0.955, 1, local)
      const drift = frame.reducedMotion || frame.still ? 0 : 1
      const az = s.az + inT * 0.35 + drift * Math.sin(frame.time * 0.11) * 0.012
      const el = s.el + drift * Math.sin(frame.time * 0.08 + 1) * 0.006
      d *= 1 + inT * 0.25 - outT * 0.25
      out.position.set(s.x + Math.sin(az) * Math.cos(el) * d, s.y + Math.sin(el) * d, s.z + Math.cos(az) * Math.cos(el) * d)
      const halfH = Math.tan((fov * Math.PI) / 360) * d
      const halfW = halfH * aspect
      // shift the aim so the subject lands at (sx, sy) of the frame
      const rx = Math.cos(az)
      const rz = -Math.sin(az)
      out.target.set(s.x - rx * sx * halfW, s.y - sy * halfH, s.z - rz * sx * halfW)
      out.fov = fov
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : 0.12
    },
  }
}

