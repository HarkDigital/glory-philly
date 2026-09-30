import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { BRAND } from '../../content'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { whenRevealed } from '../../kit/images'
import { GEL } from '../../world/World'
import { makeBottleWall, planBottles, LOCAL_Y, LP_X, SECTION_X, WALL_Z, ROW_Y, type BottleWall } from './bottles'
import { BRICK_TOP_Y, K, WZ, kx, ky, kz, makeCellarBar, prepareCellarBar, type CellarBar } from './backbar'
import { makeBottlesLP, makeSingle, singlesArt, SINGLE_TOP, type Single } from './records'
import { leanAgainst, onFonts, syncVinylLights } from '../../kit/vinyl'
import { makeWineTower, type WineTower } from './wine'
import { makeSlot, SPECS, type CocktailSlot } from './cocktails'
import { CellarHud, layoutOf, type BeatState } from './hud'
import { AM, ANCHORS, COCK, HEAD_IN, HEAD_OUT, INTL, LOC, OUT, POUR0, POUR_DUR, POUR_STEP, SLOT, WINE_CARD, WINE_T, cocktailPos, intlPage } from './timeline'
import './cellar.css'

/*
 * THE CELLAR — bottles, wine on tap, specialty cocktails (see timeline.ts for
 * the beat sheet). A product film along Glory's REAL back bar (backbar.ts,
 * the room kit, Mike's photos): the sooty brick bay and its walnut shelves
 * (American), the wide walnut bay under a shelf packed with
 * LPs (International), the Local shelf with the "Bottles" LP and the hi-fi
 * below, ref4's record column, then the spouted liquor steps over the mirror
 * strip — the camera tracks shelf by shelf while each group's list reads in
 * a card; then the stainless wine tower pours red, white and rosé on the
 * long oiled bar; then the seven cocktails slide down it as product shots.
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
const LX = SECTION_X.local
/** the bare brick over the American top shelf (world y) */
const PY = ky(BRICK_TOP_Y)
/** a cut between two shots (local units): one frame's worth at the clock's max rate */
const CUT = 0.0004
/** one International page (= shelf) */
const PG = (INTL[1] - INTL[0]) / 3

const SHOTS: [number, Shot][] = [
  // the run of the back bar from its left end: the brick bay, its sconces, the LPs
  [0.0, S(AX + 7, 6.6, Z, 27, -0.74, -0.03, 42, 0.1, 0, 1.2)],
  [HEAD_IN, S(AX + 6, 6.8, Z, 25, -0.68, -0.05, 40, 0.3, 0, 1.25)],
  [HEAD_OUT - 0.01, S(AX + 4, 6.9, Z, 21, -0.58, -0.03, 38, 0.3, 0, 1.25)],
  // American: from the brick, tilt down its three shelves
  [AM[0] + 0.012, S(AX, (PY + R0 * 3) / 4 + 0.35, Z, 8.4, -0.12, 0.04, 34, 0.45, 0, 1.35)],
  [AM[1] - 0.006, S(AX, R2 - 0.2, Z, 6.8, 0.04, 0.05, 34, 0.45, 0, 1.35)],
  // International: snake the three shelves (row = page = lit column)
  [INTL[0] + 0.15 * PG, S(IX - 3, R0, Z, 6.4, 0.12, 0.04, 34, 0.5, 0, 1.3)],
  [INTL[0] + 0.85 * PG, S(IX + 3, R0, Z, 6.4, -0.1, 0.04, 34, 0.5, 0, 1.3)],
  [INTL[0] + 1.15 * PG, S(IX + 3, R1, Z, 6.4, -0.1, 0.03, 34, 0.5, 0, 1.3)],
  [INTL[0] + 1.85 * PG, S(IX - 3, R1, Z, 6.4, 0.1, 0.03, 34, 0.5, 0, 1.3)],
  [INTL[0] + 2.15 * PG, S(IX - 3, R2, Z, 7.0, 0.1, 0.07, 34, 0.5, 0, 1.3)],
  [LOC[0] - CUT, S(IX + 3, R2, Z, 7.0, -0.1, 0.07, 34, 0.5, 0, 1.3)],
  // Local: a cut WITH the card (the engine's ~0.1 s camera damping makes it a
  // quick glide past the walnut column), onto the whole Local bay — so no
  // settled frame shows the column close up, or one bay under the other's card…
  [LOC[0], S(LX, LOCAL_Y + 0.85, Z, 9.0, -0.14, 0.05, 32, 0.45, 0, 1.25)],
  // …then a macro on the two bottles, and out to the "Bottles" LP beside them
  [LOC[0] + 0.012, S(LX - 0.18, LOCAL_Y + 1.02, Z, 3.6, -0.16, 0.06, 30, 0.35, 0, 1.5)],
  [LOC[1] - 0.004, S((LX + LP_X) / 2 + 0.2, LOCAL_Y + 1.1, Z, 7.4, -0.2, 0.05, 30, 0.4, 0, 1.6)],
  // wine: the tower pours
  [WINE_T[0] + 0.014, S(WINE_AT.x, 1.5, WINE_AT.z, 7.2, -0.14, 0.1, 32, 0.36, 0, 1.55)],
  [WINE_T[1] - 0.012, S(WINE_AT.x, 1.4, WINE_AT.z, 6.5, 0.08, 0.08, 32, 0.36, 0, 1.55)],
  // cocktails: a slow orbit across the seven
  [COCK[0] + 0.008, S(COCK_AT.x, 0.62, COCK_AT.z, 3.3, -0.14, 0.1, 30, 0.38, 0, 1.2)],
  [OUT - 0.004, S(COCK_AT.x, 0.62, COCK_AT.z, 3.1, 0.14, 0.08, 30, 0.38, 0, 1.2)],
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

/**
 * Portrait: the run seen from the left is mostly the long bar's front at this
 * aspect, so the headline beat frames the brick bay itself — the bare brick
 * under the headline, the American shelves below.
 */
const SHOTS_TALL: [number, Shot][] = [
  [0.0, S(AX + 1.5, PY + 0.6, Z, 19, -0.36, 0.1, 40, 0, 0, 1.25)],
  [HEAD_IN, S(AX + 0.8, PY + 0.4, Z, 17.6, -0.26, 0.09, 38, 0, 0, 1.25)],
  [HEAD_OUT - 0.01, S(AX + 0.4, PY + 0.1, Z, 16.5, -0.2, 0.08, 38, 0, 0, 1.25)],
  ...SHOTS.slice(3),
]

const _shot = S(0, 0, 0, 1, 0, 0, 30, 0)
function shotAt(q: number, out: Shot, tall = false) {
  const shots = tall ? SHOTS_TALL : SHOTS
  let i = 0
  while (i < shots.length - 2 && q > shots[i + 1][0]) i++
  const [t0, a] = shots[i]
  const [t1, b] = shots[i + 1]
  const s = ease.inOutCubic(clamp((q - t0) / (t1 - t0)))
  for (const k of KEYS) out[k] = lerp(a[k], b[k], s)
  // cocktails: frame the glass on the bar (a tall collins needs more room)
  const c = smoothstep(COCK[0] - 0.012, COCK[0] + 0.004, q)
  if (c > 0) {
    // …and the 7" single standing on its easel beside it (behind-right)
    const h = Math.max(cocktailH(cocktailPos(q)), SINGLE_TOP + 0.05)
    out.x += c * (tall ? 0.3 : 0.5)
    out.y = lerp(out.y, 0.08 + h * 0.5, c)
    out.d = lerp(out.d, (1.2 + h * 1.75) * (out.d / 3.2), c)
  }
  return out
}

/* ---------------- the chapter ---------------- */

export default function cellar(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.075 })
  let hud: CellarHud
  let wall: BottleWall
  let room: CellarBar
  let tower: WineTower
  let slots: CocktailSlot[] = []
  let singles: Single[] = []
  let tallNow = false
  let q = 0
  const tmp = new THREE.Vector3()
  const state: BeatState = { beat: null, page: 0, cocktail: 0, head: null, item: -1 }
  const litAt = new THREE.Vector3()
  const pour = [0, 0, 0]
  const cards: THREE.Mesh[] = []

  return {
    id: 'cellar',
    group,
    anchors: ANCHORS,
    busy: () => clock.busy,

    async init(ctx: ChapterContext) {
      hud = new CellarHud(ctx.stage)
      // Glory's back bar (the room kit) around the named bottles, and the long bar
      const plan = planBottles()
      await prepareCellarBar()
      room = makeCellarBar(plan.rows, ctx.mobile)
      group.add(room.group)
      await nextFrame()
      room.group.updateMatrixWorld(true)
      wall = await makeBottleWall(plan, ctx.mobile, { set: room.kit.materials.pools, root: room.kit.group })
      group.add(wall.group)
      // redraw the label atlas once the house faces land (Alfa Slab One + Inter Tight)
      onFonts(() => wall.redraw(ctx.renderer))
      // box-cull the shelves against the camera about to render (a long shelf's
      // bounding sphere grazes shots that never see it, e.g. the wine tower's)
      wall.group.updateMatrixWorld(true)
      ctx.post.preRender.push((_r, _s, cam) => {
        if (group.visible) wall.cull(cam)
      })
      await nextFrame()

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
      // a 7" single per slot, beside the glass (not on its turntable)
      const art = singlesArt(ctx.mobile)
      const easelSteel = new THREE.MeshStandardMaterial({ color: '#16110e', metalness: 0.7, roughness: 0.38 })
      singles = [makeSingle(art, easelSteel), makeSingle(art, easelSteel)]
      singles.forEach((sg, i) => {
        sg.group.name = `cellar-single-${i}`
        group.add(sg.group)
      })
      await nextFrame()

      // the "Bottles" LP leaning on the Local shelf's walnut, its back (the whole
      // list) to the room: turned round in a holder, posed from its real bounds
      // so no corner reaches the wall or dips into the shelf
      const lp = makeBottlesLP(ctx.mobile)
      const holder = new THREE.Group()
      holder.name = 'cellar-bottles-lp'
      lp.group.rotation.y = Math.PI
      holder.add(lp.group)
      group.add(holder)
      holder.scale.setScalar(0.315 * K)
      leanAgainst(holder, { wallZ: kz(WZ), floorY: LOCAL_Y, x: LP_X, lean: 0.13, yaw: -0.05 })
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

      // the Glory roundel above the Local shelf: a stamp, used once. It is built
      // with its final maps (1×1 stand-ins until the roundel lands) so prewarm
      // compiles the program it draws with; the load only swaps textures.
      const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
      blank.colorSpace = THREE.SRGBColorSpace
      blank.needsUpdate = true
      const plaqueMat = new THREE.MeshStandardMaterial({
        color: '#2a1a14',
        roughness: 0.5,
        transparent: true,
        alphaTest: 0.5,
        map: blank,
        emissive: '#000000',
        emissiveMap: blank,
        emissiveIntensity: 0.35,
      })
      const plaque = new THREE.Mesh(new THREE.CircleGeometry(0.62, 48), plaqueMat)
      plaque.scale.setScalar(0.72)
      plaque.position.set(kx(1.825), ky(2.47), kz(WZ) + 0.02)
      group.add(plaque)
      whenRevealed()
        .then(() => new THREE.TextureLoader().loadAsync(BRAND.roundel))
        .then(t => {
          t.colorSpace = THREE.SRGBColorSpace
          plaqueMat.map = t
          plaqueMat.emissiveMap = t
          plaqueMat.color.set('#ffffff')
          plaqueMat.emissive.set('#ffffff')
          blank.dispose()
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
      state.head =
        local > HEAD_IN - 0.004 && q < HEAD_OUT && local < HEAD_OUT + 0.01 ? 'bottles'
        : q >= WINE_T[0] && q < WINE_CARD ? 'wine'
        : null
      state.beat =
        q >= AM[0] && q < AM[1] ? 'american'
        : q >= INTL[0] && q < INTL[1] ? 'international'
        : q >= LOC[0] && q < LOC[1] ? 'local'
        : q >= WINE_CARD && q < WINE_T[1] ? 'wine'
        : q >= COCK[0] && q < OUT + 0.02 && local < 0.975 ? 'cocktails'
        : null
      state.page = intlPage(q)
      const pos = cocktailPos(q)
      state.cocktail = Math.round(pos)
      // ---- wine: the taps pour in turn ----
      for (let i = 0; i < 3; i++) pour[i] = clamp((q - (POUR0 + i * POUR_STEP)) / POUR_DUR)
      tower.set(pour, t, reduced)
      // ---- the item the 3D singles out (amber in its list, the key light on it) ----
      shotAt(q, _shot)
      state.item = -1
      const g = state.beat
      if (g === 'american' || g === 'international' || g === 'local') {
        // the bottle the camera settles on: the named one nearest the shot's subject
        let best = Infinity
        wall.named[g].forEach((v, i) => {
          if (!v) return
          const dx = v.x - _shot.x
          const dy = (v.y - _shot.y) * 2
          const d = dx * dx + dy * dy
          if (d < best) {
            best = d
            state.item = i
            litAt.copy(v)
          }
        })
      } else if (g === 'wine') {
        // the wine pouring (the last tap to start)
        for (let i = 0; i < 3; i++) if (q >= POUR0 + i * POUR_STEP) state.item = i
      }
      hud.update(state, frame.width, frame.height)

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
        // the single: arrives with the glass, the record rises out of its
        // sleeve once the glass has landed, turns slowly, sinks back before it leaves
        const sg = singles[s]
        sg.group.visible = true
        sg.show(k)
        sg.group.position.set(slot.group.position.x + (tallNow ? 0.5 : 1.0), 0, slot.group.position.z + (tallNow ? -0.7 : -0.4))
        sg.group.rotation.y = tallNow ? -0.12 : -0.3
        const out = smoothstep(0.08, 0.4, within) * (1 - smoothstep(0.76, 0.92, within))
        sg.set(out, -within * 1.4 - t * 0.35)
      }
      for (let s = 0; s < 2; s++) if (!slots[s].group.visible) singles[s].group.visible = false

      // ---- light ----
      const w = ctx.world.params
      const inBottles = q < WINE_T[0] - 0.01
      const cocktails = q > COCK[0] - 0.012
      // the room is built (backbar.ts): the world backdrop only rounds it off
      w.top = '#0c0807'
      w.bottom = '#040201'
      w.brick = 0
      w.room = 0.5
      w.strings = 0
      w.bulbs = 0.3
      w.haze = 0.04
      w.bokeh = 0
      w.cyc = 0.12
      w.cycColor = '#4a2414'
      w.fill = 0.16
      w.env = 1.1
      // the softbox strips sweep across the glass as the camera tracks
      w.envTurn = -0.6 + q * 3.2
      const sub = tmp.set(_shot.x, _shot.y, _shot.z)
      const onBottle = state.item >= 0 && (g === 'american' || g === 'international' || g === 'local')
      const fin = smoothstep(0.93, 0.99, local)
      // cream sleeves bloom under a hot key: keep it ≈ 0.5–0.7 near the vinyl
      const nearLP = q > LOC[0] - 0.01 && q < LOC[1] + 0.004
      // in the bottle beats the key picks out the bottle the list lights (a tight pool, damped by the world)
      w.spot = (onBottle ? 0.5 : nearLP ? 0.32 : inBottles ? 0.42 : cocktails ? 0.72 : 0.7) * (1 - 0.45 * fin)
      w.spotColor = GEL.tungsten
      w.spotAngle = onBottle ? 0.13 : inBottles ? 0.5 : 0.36
      w.spotPenumbra = onBottle ? 0.85 : 0.7
      if (onBottle) sub.copy(litAt)
      w.spotPos.set(sub.x + 2.5, sub.y + 7.5, sub.z + 7)
      w.spotAt.copy(sub)
      w.rimA = cocktails ? 1.6 : 1.2
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.8, 0.45, -1)
      w.rimB = cocktails ? 1.0 : 0.7
      w.rimBColor = GEL.cream
      w.rimBDir.set(0.9, 0.35, -1)
      // light through the bottles' glass (the sconces beside them), the room's bulbs + bounce
      wall.setBacklight(0.05)
      // bright filaments, gentler pools (the labels near the sconces stay readable)
      room.set(1 - 0.25 * fin, 0.7)
      room.kit.materials.pools.k = (inBottles ? 0.55 : cocktails ? 0.4 : 0.5) - 0.12 * fin
      if (room.turntable) {
        room.turntable.setSpeed(reduced ? 0 : 33.33, true)
        room.turntable.update(frame)
      }
      syncVinylLights(ctx.world)
      // no bright finale into the cut: the product-shot card dims as we push in
      if (cards[0]) ((cards[0].material as THREE.MeshBasicMaterial).color.setScalar(0.9 * (1 - 0.55 * smoothstep(0.93, 0.99, local))))

      // ---- post: a ruby pour out; bloom only on the filaments and the pours ----
      ctx.post.params.beer = lerp(0.62, 0.8, smoothstep(0.3, 0.9, local))
      ctx.post.params.bloomThreshold = inBottles ? 1.08 : 1.04
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      const layout = layoutOf(frame.width, frame.height)
      const tall = layout === 'phone' || layout === 'tablet'
      tallNow = tall
      const s = shotAt(Number.isFinite(q) ? q : local, _shot, tall)
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
      } else if (layout === 'wide') {
        // squarer screens (1024×768): the card is a bigger share of the width
        sx += clamp((1.6 - aspect) * 0.4, 0, 0.14) * smoothstep(COCK[0] - 0.012, COCK[0] + 0.004, Number.isFinite(q) ? q : local)
      } else if (layout === 'short') {
        d *= 1.08
        // the compact card takes ~half the width: push the cocktail shots right
        sx = sx * 0.9 + 0.2 * smoothstep(COCK[0] - 0.012, COCK[0] + 0.004, Number.isFinite(q) ? q : local)
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

