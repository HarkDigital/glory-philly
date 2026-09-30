import * as THREE from 'three'
import type { ChapterContext } from '../../core/types'
import { nextFrame } from '../../core/yield'
import { BRAND, CITY_WIDE, SECTIONS } from '../../content'
import { makeBacklight } from '../../kit/beer'
import { IN, makeCityWide, makeRyeBottle, makeRyePour, type CityWide, type RyeBottle } from '../../kit/citywide'
import { makeBackBar, makeBarRun, prepareRoom, type RoomKit } from '../../kit/room'
import { catNo, makeRecord, type Record as VinylRecord } from '../../kit/vinyl'
import { Lens } from './lens'

/*
 * THE SET — Glory's real bar (Mike's photos) at the City Wide's scale.
 *
 * Units are kit/beer's (IN = 0.19 = one inch; the can is 0.92 tall), so the
 * room kit (metres) is scaled by S. The long bar's top is y = 0; the can and
 * the shot stand near its customer edge (+z). Across the bartender's aisle,
 * the room kit's back bar (ref1): the brick bay with the painted "Old 1837",
 * the hi-fi with its blue ring and a black deck spinning a red-label 7", a
 * face-out Glory LP, the wide walnut column with its wire-cage sconce, the
 * records bay packed with LPs over the spouted bottle steps, coolers glowing
 * under the counter, the black ceiling with its flex duct and a pendant.
 *
 * Layers (the lens swaps them): FAR = the back bar + what stands on the long
 * bar's far side (a stout pint, Glory's red table tent — ref3's bokeh); FG =
 * the City Wide, the rye bottle and its stream, the rye's backlight, and the
 * lens's own cards. The long bar itself is in both (sharp in the frame, soft
 * in the plate).
 */

/** world units per metre (kit/beer's inch scale) */
export const S = 0.19 / 0.0254

export const SET = {
  /** the long bar: customer edge, depth, its top 1.07 m over the floor */
  barEdge: 1.55,
  barDepth: 0.75 * S,
  floorY: -1.07 * S,
  /** the bartender's aisle, the back counter's depth */
  aisle: 0.85 * S,
  counterD: 0.62 * S,
  /** where the back bar's run sits along x (its hi-fi lands behind the can) */
  backX: -2.4,
  /** the lens backdrop: just in front of the back counter */
  backdropZ: 0,
  wallZ: 0,
}
SET.wallZ = SET.barEdge - SET.barDepth - SET.aisle - SET.counterD
SET.backdropZ = SET.wallZ + SET.counterD + 0.12

export interface CityWideSet {
  group: THREE.Group
  /** the far layer (sharp only in the establishing beat; otherwise it lives in the lens plate) */
  far: THREE.Group
  /** the foreground: products, bottle, stream, backlight (hidden from the plate) */
  fg: THREE.Group
  bar: RoomKit
  back: RoomKit
  cw: CityWide
  bottle: RyeBottle
  pour: ReturnType<typeof makeRyePour>
  backlight: ReturnType<typeof makeBacklight>
  single: VinylRecord
  lens: Lens
  /** the can's contact shadow (kept on the bar while the can is set down) */
  canAO: THREE.Mesh | null
  dispose(): void
}

/** a stout pint someone left on the far side of the bar (ref3's dark glass, behind the shot) — an opaque stand-in: it's only ever seen through the lens */
function makeStoutPint() {
  const g = new THREE.Group()
  const u = IN
  const prof = (pts: [number, number][]) => pts.map(([r, y]) => new THREE.Vector2(r * u, y * u))
  // a nonic pint: 5.9" tall, the bulge near the top
  const glassPts = prof([
    [0, 0], [1.2, 0], [1.28, 0.1], [1.3, 0.5], [1.45, 3.6], [1.6, 4.9], [1.66, 5.15], [1.6, 5.4], [1.62, 5.9], [1.56, 5.92],
  ])
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(glassPts, 40),
    new THREE.MeshPhysicalMaterial({ color: '#150a05', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }),
  )
  g.add(body)
  const head = new THREE.Mesh(new THREE.CylinderGeometry(1.58 * u, 1.6 * u, 0.45 * u, 32), new THREE.MeshStandardMaterial({ color: '#b9906a', roughness: 0.7 }))
  head.position.y = 5.5 * u
  g.add(head)
  return g
}

/** Glory's red table tent on the bar (ref3, right edge): the brand only — no invented copy */
function makeTableTent() {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 768
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const draw = () => {
    const g = cv.getContext('2d')!
    g.fillStyle = '#c8232a'
    g.fillRect(0, 0, 512, 768)
    // the white plate with the name, as on the real tent
    g.fillStyle = '#f6efe2'
    g.fillRect(56, 70, 400, 250)
    g.fillStyle = '#c8232a'
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    // fit the name and the line inside the plate (360 px)
    const fit = (text: string, font: (px: number) => string, px: number, max: number) => {
      g.font = font(px)
      const w = g.measureText(text).width
      if (w > max) g.font = font(Math.floor((px * max) / w))
    }
    fit(BRAND.short.toUpperCase(), px => `400 ${px}px "Alfa Slab One", Rockwell, Georgia, serif`, 118, 350)
    g.fillText(BRAND.short.toUpperCase(), 256, 218)
    g.fillStyle = '#3a2a22'
    const line = BRAND.name.replace(/^Glory\s+/, '').toUpperCase()
    fit(line, px => `700 ${px}px "Inter Tight Variable", "Inter Tight", system-ui, sans-serif`, 30, 350)
    g.fillText(line, 256, 282)
    // the roundel's ring, low on the card (a stamp, not words)
    g.strokeStyle = '#f6efe2'
    g.lineWidth = 14
    g.beginPath()
    g.arc(256, 560, 74, 0, Math.PI * 2)
    g.stroke()
    tex.needsUpdate = true
  }
  draw()
  const fonts = document.fonts
  if (fonts?.load) {
    void Promise.all([fonts.load('400 60px "Alfa Slab One"'), fonts.load('700 30px "Inter Tight"')])
      .then(draw)
      .catch(() => undefined)
    void fonts.ready.then(draw).catch(() => undefined)
  }
  const w = 4.2 * IN
  const h = 6.2 * IN
  const lean = 0.2
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })
  const back = new THREE.MeshStandardMaterial({ color: '#b01e24', roughness: 0.6 })
  const g = new THREE.Group()
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(w, h), back)
  // an A-frame: two panels leaning together
  const hy = (h / 2) * Math.cos(lean)
  const hz = (h / 2) * Math.sin(lean)
  face.position.set(0, hy, hz)
  face.rotation.x = -lean
  rear.position.set(0, hy, -hz)
  rear.rotation.set(lean, Math.PI, 0)
  g.add(face, rear)
  return { group: g, dispose: () => (tex.dispose(), mat.dispose(), back.dispose(), face.geometry.dispose(), rear.geometry.dispose()) }
}

export async function buildSet(ctx: ChapterContext): Promise<CityWideSet> {
  const group = new THREE.Group()
  const far = new THREE.Group()
  const fg = new THREE.Group()
  group.add(far, fg)

  // the room kit's maps, sliced across frames
  await prepareRoom({ backBar: {} })

  // THE LONG BAR (ref1's foreground): oiled planks + the black rubber rail
  const bar = makeBarRun({ length: 6, depth: 0.75, scale: S, mobile: ctx.mobile, ambient: 0.35 })
  bar.group.position.set(0, SET.floorY, SET.barEdge - SET.barDepth / 2)
  group.add(bar.group)
  // closer grain for a product close-up: the planks ~5" wide (as in the photo), the grain tile ~1 m
  bar.group.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !(m.geometry instanceof THREE.BoxGeometry)) return
    const p = m.geometry.parameters
    if (Math.abs(p.width - 6) > 1e-3 || Math.abs(p.depth - 0.75) > 1e-3 || !(m.material as THREE.MeshPhysicalMaterial).map) return
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.6)
    uv.needsUpdate = true
    // honey-brown oiled planks (ref3); PBR Neutral's toe over-saturates a dim orange
    ;(m.material as THREE.MeshPhysicalMaterial).color.setRGB(1.5, 1.42, 1.36)
  })
  await nextFrame()

  // THE BACK BAR (ref1): brick with "Old 1837", hi-fi + deck, records, bottles, sconces, ceiling
  const back = makeBackBar({
    scale: S,
    turntable: true,
    tv: false,
    ceiling: true,
    mobile: ctx.mobile,
    records: { rows: 1, singles: 0.42 },
    ambient: 0.4,
  })
  back.group.position.set(SET.backX, SET.floorY, SET.wallZ)
  far.add(back.group)
  // the kit's builder re-poses added objects from its own matrix (identity), which drops the deck
  // to the kit's origin at full size: seat it on the receiver as the kit intends (12" deck = 0.315 m)
  if (back.turntable && back.anchors.turntable) {
    back.turntable.group.position.copy(back.anchors.turntable)
    back.turntable.group.quaternion.identity()
    back.turntable.group.scale.setScalar(0.315)
    // its contact-shadow quad is padded far past the plinth (it would hang in the air over the
    // counter and cut the face-out LP beside it): the deck sits flush on the receiver without it
    for (const c of back.turntable.group.children) {
      const m = c as THREE.Mesh
      if (m.isMesh && (m.material as THREE.Material).type === 'ShaderMaterial' && m.geometry.type === 'PlaneGeometry') m.visible = false
    }
  }
  // a red-label 7" on the deck (the vinyl nod): it spins at 45
  const single = makeRecord({
    size: 7,
    label: { title: CITY_WIDE.title.replace(/\s+Special$/, ''), sub: SECTIONS.citywide.eyebrow, side: 'SIDE A', cat: catNo(45), paper: 'red', seven: true },
    segments: 96,
  })
  back.turntable?.setRecord(single)
  back.turntable?.setSpeed(45, true)
  back.turntable?.setArm(1)
  back.turntable?.setCue(0)
  back.turntable?.setGroove(0.35)
  await nextFrame()

  // what stands on the far side of the long bar (ref3's bokeh): a stout pint, the red table tent
  const pint = makeStoutPint()
  pint.name = 'cw-pint'
  pint.position.set(0.95, 0.001, -2.25)
  far.add(pint)
  const tent = makeTableTent()
  tent.group.name = 'cw-tent'
  tent.group.position.set(2.1, 0, -2.3)
  tent.group.rotation.y = -0.3
  far.add(tent.group)

  // THE CITY WIDE (kit): can left/back, the shot right/forward
  const cw = makeCityWide({ open: 0, fill: 0, cheese: 0, labelRes: ctx.mobile ? 1024 : 2048 })
  fg.add(cw.group)
  // the can's contact shadow: it rides with the can, so it's kept on the bar while the can comes down
  let canAO: THREE.Mesh | null = null
  for (const c of cw.can.group.children) {
    const m = c as THREE.Mesh
    const mat = m.material as THREE.MeshBasicMaterial | undefined
    if (m.isMesh && m.geometry instanceof THREE.PlaneGeometry && mat?.alphaMap) canAO = m
  }
  await nextFrame()

  // the rye bottle (uncapped, full: its whiskey is a stand-in that can't level) and its stream
  const bottle = makeRyeBottle({ fill: 1, cap: false })
  bottle.group.visible = false
  fg.add(bottle.group)
  const pour = makeRyePour()
  fg.add(pour.mesh)

  // the rye glows when there's light behind it in the transmission buffer
  const backlight = makeBacklight({ width: 0.7, height: 0.9, hdr: 2.2, isFrameTarget: rt => ctx.post.isFrameTarget(rt) })
  backlight.mesh.rotation.x = -Math.PI / 2
  fg.add(backlight.mesh)

  // THE LENS: the far layer, softly out of focus
  const lens = new Lens({ backdrop: { width: 260, height: 140 }, overlay: { width: 46, depth: SET.barDepth + 0.1 } })
  lens.backdrop.position.set(0, 20, SET.backdropZ)
  lens.overlay.position.set(0, 0.13, SET.barEdge - SET.barDepth / 2)
  fg.add(lens.backdrop, lens.overlay)

  return {
    group,
    far,
    fg,
    bar,
    back,
    cw,
    bottle,
    pour,
    backlight,
    single,
    lens,
    canAO,
    dispose() {
      bar.dispose()
      back.dispose()
      cw.dispose()
      bottle.dispose()
      pour.dispose()
      backlight.dispose()
      lens.dispose()
      tent.dispose()
      pint.traverse(o => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      })
    },
  }
}
