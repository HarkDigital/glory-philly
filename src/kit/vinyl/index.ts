import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { World } from '../../world/World'
import { whenRevealed } from '../images'
import {
  CRATE,
  REC12,
  REC7,
  SEVEN,
  SLEEVE,
  adapterGeometry,
  crateDims,
  crateGeometry,
  cleanParts,
  recordGeometry,
  rimAt as rimAtDims,
  roundedBox,
  sleeveGeometry,
  type CrateDims,
  type RecordDims,
} from './geometry'
import {
  VINYL_LIGHTS,
  bindCrateShade,
  blankTexture,
  crateMaterial,
  makeCrateShade,
  platterMaterial,
  recordMaterial,
  shadowMaterial,
  sleeveMaterial,
  turntableMaterials,
  writeRecordLights,
  type CrateShade,
  type PlatterUniforms,
  type RecordUniforms,
  type SleeveMaterialOpts,
  type SleeveUniforms,
} from './materials'
import {
  FONT,
  artCanvas,
  catNo,
  drawCompanySleeve,
  drawCover,
  drawLabel,
  drawTracklist,
  loadCover,
  loadVinylFonts,
  onFonts,
  scheme,
  type CompanySleeveSpec,
  type CoverSource,
  type CoverSpec,
  type LabelSpec,
  type TracklistSpec,
} from './art'

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  GLORY VINYL KIT — records, sleeves, crates and a turntable
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Vinyl is the site's motif. Ported from Resonance's crate (laminated sleeves
 * with grain / ring wear / scuffs, lathed records whose groove highlights hold
 * still while the label turns, a black anodized browser bin with diamond-cut
 * chamfers) and printed in Glory's house style: "Glory Records" GLY-001…
 * (decorative, not claims), the red-ring G roundel, Alfa Slab One titles,
 * Instrument Serif italic subs, IBM Plex Mono numbers. See it all in the lab:
 * ?lab=vinyl&view=all|tt|arm|rim|bin|crate|back|single[&mood=cyc]
 *
 * UNITS: a 12" sleeve is 1 × 1 (1 unit ≈ 12.4"); a 7" is SEVEN (0.586). The
 * turntable, crate and sleeves share this scale. Scale your group to taste.
 * Orientation: every part is built facing +z (the camera side), base on y = 0.
 *
 * ─── the parts ─────────────────────────────────────────────────────────────
 *
 *  makeRecord({ label, size: 12|7, color?, adapter? }) → Record
 *    .group (axis = local +z, side A faces +z) · .disc · .setLabel(tex)
 *    .setSpin(angle) (decreasing = clockwise, like a deck) · .setSmear(rad/s)
 *    label: a texture, or a LabelSpec printed for you ({ title, sub?, side?,
 *    cat?, paper: 'cream'|'red'|'stout'|'amber'|'bone', seven? }).
 *    color: coloured vinyl ('#c8661a' amber, '#8a1a14' ruby…); default black.
 *    Lying flat: rec.group.rotation.x = -Math.PI / 2.
 *
 *  makeSleeve({ front?, back?, size: 12|7, thin?, hole?, ink?, gloss?, wear? }) → Sleeve
 *    .group (PIVOT at the bottom-centre edge, so flips hinge) · .mesh
 *    .setFront(tex) · .setBack(tex). thin = paper (company/inner sleeve);
 *    hole = die-cut centre radius in cover units (0.235 shows a 7" label whole).
 *
 *  makeCrate({ depth?, legend?: ['GLORY RECORDS · THE KITCHEN', '14 × 12"'] }) → Crate
 *    .group (bin on y = 0, low front wall toward +z) · .rimAt(z) · .slotZ(i, n)
 *    .adopt(sleeve) (sleeves standing in it get its occlusion + held shadow)
 *    .setHeld(localCentre, strength). Singles: crate.group.scale.setScalar(SEVEN).
 *
 *  new CrateRig({ crate, sleeves, record?, labels?, fillers?, present?, yaw?, pitch?, onLand? })
 *    Resonance's choreography, driven by ONE number:
 *      rig.update(item, frame, riffle)
 *    item 0..N: while item ∈ [k, k+1) sleeve k is in hand — it lifts out and
 *    turns to camera, its record slides out and spins at 33⅓, holds, slides
 *    home, the sleeve drops back and flips forward onto the stack (physics:
 *    gravity, bounce, the stack recoils; always settles). Phases inside a slot
 *    are RIG_PHASE (copy on at .hudOn = 0.18, off at .hudOff = 0.78; camera
 *    settled .camIn–.camOut). riffle 0..F then flips the background sleeves
 *    (filler j stands face-out while riffle ∈ [j, j+1)). Jumps (> 2 items)
 *    snap to a resolved crate; call rig.reset() in onEnter, rig.kick() for the
 *    jostle wave. Camera: rig.station(k, centre, dir) → { w, h } for frameTo().
 *    rig.k / .s / .lift / .out / .recordShown / .front() / .flipOf(i) /
 *    .heldWorld(v) / .recordWorld(v) for your HUD and callouts.
 *    fillers: { count, atlas: coverAtlas([...]) } — ONE InstancedMesh.
 *
 *  makeTurntable({ finish: 'walnut'|'black', dustCover?, shadows?, contact? }) → Turntable
 *    .setRecord(rec) · .setSpeed(rpm) (33.333 / 45 / 0, damped spin-up/brake)
 *    .setArm(0 rest → 0.5 lead-in → 1 playing) · .setGroove(0 lead-in … 1 run-out)
 *    .setCue(1 lifted … 0 down) · .setCover(0..1) · .setPower(0..1)
 *    .update(frame) every frame (Motion off holds the platter)
 *    .stylus / .mount / .arm / .platter for cameras and callouts; TT = dims.
 *    The platter's strobe dots read "locked" at 33⅓ (and the 45 row at 45).
 *
 * ─── art (all canvas textures; draw now, redraw when the fonts land) ───────
 *
 *  labelTexture(LabelSpec)                 512², the house label
 *  coverTexture({ title, sub?, kicker?, cat?, paper?, photoUrl?, eager?, focus? })
 *        1024²: a full-bleed photo (cover-cropped, never stretched; loaded off-
 *        thread after whenRevealed(), `eager` for your first) with a cream title
 *        band — or, without a photo, a big-slab typographic cover
 *  tracklistTexture({ title, sub?, sides? | tracks?, notes?, numbers?, columns?, flip? })
 *        1024² sleeve BACK: SIDE A / SIDE B (or your group names), numbered
 *        tracks with a right-aligned value on a dotted leader (prices, taps);
 *        auto-fits ~60 lines into 3 columns. flip: true for backs that are read
 *        lying on the crate's stack (pre-rotated to read from the front).
 *  companyTexture({ paper?, hole?, inner? }) 512², the 7" company sleeve (or the 12" inner)
 *  coverAtlas(covers, back?)               2048² 4×4 atlas for CrateRig fillers
 *  catNo(n) → 'GLY-00n' · loadCover(url, { size, square, focus }) · draw*() to paint your own canvases
 *  Art textures FREEZE once settled (fonts + photo): the canvas is freed after
 *  the upload. To change art, make a new texture (and dispose the old one).
 *
 * ─── light ─────────────────────────────────────────────────────────────────
 *
 *  syncVinylLights(ctx.world) once per frame in update(): the groove
 *  highlights follow the world's spot (key) and rim A. Everything else is lit
 *  by the world. Shadows: turntable parts cast the spot's shadow; records,
 *  sleeves and crates receive it (sleeves don't cast by default: the crate
 *  fakes the held sleeve's shadow). Cream board under a spot > ~0.5 starts to
 *  bloom — keep the spot ≈ 0.5 on sleeves or raise post.params.bloomThreshold.
 *
 * ─── copy-paste ────────────────────────────────────────────────────────────
 *
 *   import { makeTurntable, makeRecord, syncVinylLights, catNo } from '../../kit/vinyl'
 *
 *   // a deck spinning a Glory record
 *   const tt = makeTurntable({ finish: 'walnut' })
 *   tt.setRecord(makeRecord({ label: { title: 'On Tap', sub: '36 beers on tap', cat: catNo(2), paper: 'red' } }))
 *   group.add(tt.group)
 *   // update(local, frame, ctx):
 *   syncVinylLights(ctx.world)
 *   tt.setSpeed(local > 0.1 ? 33.333 : 0)
 *   tt.setArm(smoothstep(0.1, 0.3, local))
 *   tt.setCue(1 - smoothstep(0.3, 0.36, local))
 *   tt.update(frame)
 *
 *   // a crate of photo sleeves, the Resonance choreography
 *   const crate = makeCrate({ legend: ['GLORY RECORDS · THE KITCHEN', `${dishes.length} × 12"`] })
 *   const sleeves = dishes.map((d, i) => makeSleeve({
 *     front: coverTexture({ title: d.name, kicker: 'Starters', sub: d.desc, cat: catNo(i + 1), photoUrl: d.photo, eager: i === 0 }),
 *     back: tracklistTexture({ flip: true, title: 'Starters', tracks: items.map(x => ({ name: x.name, value: x.price })) }),
 *   }))
 *   const labels = dishes.map((d, i) => labelTexture({ title: d.name, cat: catNo(i + 1), paper: i % 2 ? 'red' : 'cream' }))
 *   const rig = new CrateRig({ crate, sleeves, labels, fillers: { count: 9, atlas: coverAtlas(moreCovers) } })
 *   group.add(crate.group)
 *   // update: const q = clock.update(local, frame.dt) (StoryClock); item = (q - a) / slot
 *   rig.update(item, frame, riffle)
 *   // camera(): const { w, h } = rig.station(k, c, d); frameTo(out, c, d, w, h, region, W, H, fov)
 *   // onEnter(): rig.reset()
 *
 *   // a 7" single in its company sleeve, the record half out
 *   const sl = makeSleeve({ size: 7, thin: true, hole: 0.235, front: companyTexture({ hole: 0.235 }), back: companyTexture({ hole: 0.235 }) })
 *   const single = makeRecord({ size: 7, label: { title: 'Classic Negroni', sub: 'Campari, Bluecoat Gin', seven: true, paper: 'red' } })
 *   single.group.position.set(0.19, SEVEN / 2, 0)            // centre of the sleeve, slid right
 *   sl.group.add(single.group)
 *
 * PERFORMANCE: one program per kind (sleeve / atlas sleeve / record / crate /
 * platter) however many you make; background sleeves are one InstancedMesh
 * over a 4×4 atlas; groove shading is in the material; the turntable merges
 * its parts per material (~16 draws). Covers 1024², labels 512²: pass a
 * smaller `res` on phones (768 / 384) if you show many.
 */

export {
  SLEEVE,
  SEVEN,
  REC12,
  REC7,
  CRATE,
  crateDims,
  VINYL_LIGHTS,
  FONT,
  catNo,
  loadCover,
  onFonts,
  drawCover,
  drawLabel,
  drawTracklist,
  drawCompanySleeve,
  scheme,
}
export { drawRoundel, ringText, drawCoverImage, INKS, RIM_TEXT } from './art'
export { loadVinylFonts }
export type { CoverSpec, LabelSpec, TracklistSpec, CompanySleeveSpec, CoverSource, RecordDims, CrateDims, CrateShade }
export type { Track, SideSpec, PaperName } from './art'

const TAU = Math.PI * 2
/** 33⅓ rpm in rad/s */
export const RPM33 = (33.333 / 60) * TAU
export const rpmToRad = (rpm: number) => (rpm / 60) * TAU
const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const segment = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const outBack = (t: number, s = 1.2) => {
  const c3 = s + 1
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
}

/** Minimal frame the animated parts need (a chapter's Frame fits). */
export interface VinylFrame {
  dt: number
  time: number
  velocity?: number
  reducedMotion?: boolean
  /** Motion off: ambient spin holds still (scroll-driven motion continues) */
  still?: boolean
}

// ─── lights ─────────────────────────────────────────────────────────────────

const _v = new THREE.Vector3()
/**
 * Point the groove highlights at the world's lights: the key = the follow
 * spot (from spotAt toward spotPos), the rim = rim A's live direction. Call
 * once per frame in update(). Colours follow the gels, weighted by intensity.
 */
export function syncVinylLights(world: World) {
  const p = world.params
  _v.copy(p.spotPos).sub(p.spotAt)
  if (_v.lengthSq() > 1e-6) VINYL_LIGHTS.key.copy(_v).normalize()
  const r = world.rimA
  _v.copy(r.position).sub(r.target.position)
  if (_v.lengthSq() > 1e-6) VINYL_LIGHTS.rim.copy(_v).normalize()
  const k = Math.min(1.4, 0.35 + p.spot * 0.8)
  VINYL_LIGHTS.keyColor.set(p.spotColor).lerp(_white, 0.55).multiplyScalar(k)
  const rk = Math.min(1.2, 0.25 + p.rimA * 0.5)
  VINYL_LIGHTS.rimColor.set(p.rimAColor).lerp(_white, 0.3).multiplyScalar(rk)
}
const _white = new THREE.Color(1, 1, 1)

// ─── texture helpers ────────────────────────────────────────────────────────

export interface ArtTexture extends THREE.CanvasTexture {
  userData: { redraw: () => void; [k: string]: unknown }
}

/** both font signals have fired (the kit's own load race and document.fonts.ready) */
const fontsSettled = () => Promise.all([loadVinylFonts(), document.fonts?.ready ?? Promise.resolve()]).then(() => undefined)

/**
 * A canvas texture that draws now (fallback type), redraws when the faces
 * land, and — once `settled` resolves (fonts + any photo) — does a final draw
 * and frees its canvas after the upload (a 1024² canvas is 4 MB of RAM; the
 * GPU copy is all that's needed from then on).
 */
function artTexture(
  res: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  settled?: Promise<unknown>,
  afterFinal?: () => void,
): ArtTexture {
  const { canvas, ctx, texture } = artCanvas(res, res)
  const t = texture as ArtTexture
  let freed = false
  const redraw = () => {
    if (freed) return
    draw(ctx, res)
    t.needsUpdate = true
  }
  t.userData.redraw = redraw
  redraw()
  onFonts(redraw)
  Promise.all([fontsSettled(), settled]).then(() => {
    redraw()
    afterFinal?.()
    t.onUpdate = () => {
      freed = true
      canvas.width = canvas.height = 1
      t.onUpdate = null
    }
  })
  return t
}

/**
 * A Glory record label (512²). `seven: true` lays it out around a 45's big hole.
 *
 *   labelTexture({ title: 'Wine on Tap', sub: 'Red, white & rosé', side: 'SIDE B', cat: catNo(4), paper: 'stout' })
 */
export function labelTexture(spec: LabelSpec, res = 512): ArtTexture {
  return artTexture(res, (ctx, s) => drawLabel(ctx, 0, 0, s, spec))
}

export interface CoverTextureSpec extends CoverSpec {
  /** a photo to print full-bleed (loaded off-thread after whenRevealed(), unless eager) */
  photoUrl?: string
  eager?: boolean
}

/**
 * A sleeve FRONT (1024²): with `photoUrl`, a full-bleed photo (cover-cropped,
 * never stretched) with a cream title band — a dark placeholder until the
 * photo lands; without one, a typographic cover.
 *
 *   coverTexture({ title: 'Seared Octopus', kicker: 'Starters', cat: catNo(3), photoUrl: 'photos/octopus.webp' })
 */
export function coverTexture(spec: CoverTextureSpec, res = 1024): ArtTexture {
  let photo: CoverSource | null = null
  let got: (() => void) | null = null
  const photoDone = new Promise<void>(r => (got = r))
  const t = artTexture(
    res,
    (ctx, s) => drawCover(ctx, 0, 0, s, { ...spec, photo: photo ?? (spec.photoUrl ? PENDING : spec.photo) }),
    photoDone,
    // the photo is baked into the canvas now: free the decoded bitmap
    () => (photo as ImageBitmap | null)?.close?.(),
  )
  if (spec.photoUrl) {
    const url = spec.photoUrl
    const go = () =>
      loadCover(url, { size: res, focus: spec.focus })
        .then(p => {
          photo = p
          t.userData.redraw()
        })
        .catch(err => console.warn(`[vinyl] cover photo failed: ${url}`, err))
        .finally(() => got?.())
    if (spec.eager) go()
    else whenRevealed().then(go)
  } else got!()
  return t
}

/** a 1×1 stand-in "photo" so the band layout holds while the real one loads */
const PENDING: CoverSource = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const g = c.getContext('2d')!
  g.fillStyle = '#2a1c14'
  g.fillRect(0, 0, 2, 2)
  return c
})()

/**
 * A sleeve BACK as a tracklist (1024²).
 *
 *   tracklistTexture({ title: 'Drafts', sub: 'American', tracks: beers.map((b, i) => ({ name: b, value: String(i + 1).padStart(2, '0') })) })
 */
export function tracklistTexture(spec: TracklistSpec, res = 1024): ArtTexture {
  return artTexture(res, (ctx, s) => drawTracklist(ctx, 0, 0, s, spec))
}

/** A 7" company sleeve (or `inner: true`, the 12" paper inner sleeve), 512². */
export function companyTexture(spec: CompanySleeveSpec = {}, res = 512): ArtTexture {
  return artTexture(res, (ctx, s) => drawCompanySleeve(ctx, 0, 0, s, spec))
}

export interface AtlasCover extends CoverSpec {
  photoUrl?: string
}

/**
 * A 4 × 4 cover atlas for background sleeves (cells 0..14 = fronts, cell 15
 * = the shared back). 2048² (512² cells); pass 1024 on phones. Photos load
 * after whenRevealed().
 */
export function coverAtlas(covers: AtlasCover[], back?: TracklistSpec | CoverSpec, res = 2048): ArtTexture & { userData: { inks: boolean[] } } {
  const photos: (CoverSource | null)[] = covers.map(() => null)
  const cell = res / 4
  let got: (() => void) | null = null
  const photosDone = new Promise<void>(r => (got = r))
  const t = artTexture(res, ctx => {
    covers.slice(0, 15).forEach((c, i) => {
      drawCover(ctx, (i % 4) * cell, Math.floor(i / 4) * cell, cell, { ...c, photo: photos[i] ?? (c.photoUrl ? PENDING : c.photo) })
    })
    // the shared back is only ever seen on the flipped stack: pre-rotated so it reads from the crate's front
    if (back) {
      if ('tracks' in back || 'sides' in back) drawTracklist(ctx, 3 * cell, 3 * cell, cell, { flip: true, ...(back as TracklistSpec) })
      else drawCover(ctx, 3 * cell, 3 * cell, cell, { flip: true, ...(back as CoverSpec) })
    } else drawCover(ctx, 3 * cell, 3 * cell, cell, { title: 'Glory Records', paper: 'cream', flip: true })
  }, photosDone, () => photos.forEach(p => (p as ImageBitmap | null)?.close?.())) as ArtTexture & { userData: { inks: boolean[] } }
  t.userData.inks = covers.map(c => scheme(c.paper).ink && !c.photoUrl)
  whenRevealed().then(async () => {
    for (let i = 0; i < Math.min(15, covers.length); i++) {
      const url = covers[i].photoUrl
      if (!url) continue
      try {
        photos[i] = await loadCover(url, { size: cell, focus: covers[i].focus })
      } catch (err) {
        console.warn(`[vinyl] atlas photo failed: ${url}`, err)
      }
    }
    t.userData.redraw()
    got?.()
  })
  return t
}

// ─── records ────────────────────────────────────────────────────────────────

export interface Record {
  /** position/orient this: the record's axis is local +z (side A faces +z) */
  group: THREE.Group
  /** the spinning disc (child of group) */
  disc: THREE.Mesh
  uniforms: RecordUniforms
  dims: RecordDims
  size: 12 | 7
  setLabel(tex: THREE.Texture): void
  /** spin angle in radians about the axis (records turn clockwise seen from side A: pass a decreasing angle) */
  setSpin(angle: number): void
  /** angular speed (rad/s) → label smear (0 = sharp) */
  setSmear(omega: number): void
  dispose(): void
}

const recGeoCache = new Map<string, THREE.BufferGeometry>()
function recGeo(d: RecordDims, seg: number) {
  const key = `${d.R}:${d.hole}:${seg}`
  let g = recGeoCache.get(key)
  if (!g) {
    g = recordGeometry(d, seg)
    recGeoCache.set(key, g)
  }
  return g
}

export interface RecordOpts {
  /** a label texture, or a LabelSpec to print one (512²) */
  label?: THREE.Texture | LabelSpec
  size?: 12 | 7
  /** coloured vinyl (e.g. '#c8661a' amber, '#8a1a14' ruby); default black */
  color?: THREE.ColorRepresentation
  seed?: number
  /** lathe segments (default 128; 96 on small/far records) */
  segments?: number
  /** 7" only: the three-spoke 45 adapter in the big hole (colour or false) */
  adapter?: THREE.ColorRepresentation | false
}

let recSeed = 1
export function makeRecord(opts: RecordOpts = {}): Record {
  const size = opts.size ?? 12
  const dims = size === 7 ? REC7 : REC12
  const label =
    opts.label instanceof THREE.Texture ? opts.label : labelTexture({ title: 'Glory', seven: size === 7, ...(opts.label ?? {}) } as LabelSpec)
  const seed = opts.seed ?? recSeed++ * 1.37
  const { material, uniforms } = recordMaterial(label, { seed, dims, color: opts.color ?? null })
  const disc = new THREE.Mesh(recGeo(dims, opts.segments ?? 128), material)
  disc.receiveShadow = true
  disc.onBeforeRender = (_r, _s, cam) => writeRecordLights(uniforms, cam)
  const group = new THREE.Group()
  group.add(disc)
  let adapter: THREE.Mesh | null = null
  if (size === 7 && opts.adapter !== false) {
    adapter = new THREE.Mesh(
      adapterGeometry(dims),
      new THREE.MeshPhysicalMaterial({ color: opts.adapter ?? '#d8272e', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    )
    disc.add(adapter)
  }
  return {
    group,
    disc,
    uniforms,
    dims,
    size,
    setLabel(tex) {
      uniforms.uLabel.value = tex
    },
    setSpin(angle) {
      disc.rotation.z = angle
    },
    setSmear(omega) {
      uniforms.uBlur.value = Math.min(2.6, Math.abs(omega) / 64)
    },
    dispose() {
      material.dispose()
      if (adapter) {
        adapter.geometry.dispose()
        ;(adapter.material as THREE.Material).dispose()
      }
    },
  }
}

// ─── sleeves ────────────────────────────────────────────────────────────────

export interface Sleeve {
  /** pivot at the bottom-centre edge (flips hinge on it); faces +z (front) */
  group: THREE.Group
  mesh: THREE.Mesh
  uniforms: SleeveUniforms
  material: THREE.MeshStandardMaterial
  size: 12 | 7
  /** world-unit edge length (1 for 12", SEVEN for 7") */
  scale: number
  setFront(tex: THREE.Texture): void
  setBack(tex: THREE.Texture): void
  dispose(): void
}

const sleeveGeos = new Map<number, THREE.BufferGeometry>()
/** board thickness per kind, so a record inside is always hidden by the faces (a 7" is scaled by SEVEN) */
function sleeveGeoFor(size: 12 | 7, thin: boolean) {
  const t = size === 7 ? (thin ? 0.0125 : 0.016) : thin ? 0.0075 : SLEEVE.t
  let g = sleeveGeos.get(t)
  if (!g) {
    g = sleeveGeometry(t)
    sleeveGeos.set(t, g)
  }
  return g
}

export interface SleeveOpts extends SleeveMaterialOpts {
  front?: THREE.Texture
  size?: 12 | 7
  /** paper sleeve (thin: company/inner sleeves) */
  thin?: boolean
}

export function makeSleeve(opts: SleeveOpts = {}): Sleeve {
  const size = opts.size ?? 12
  const scale = size === 7 ? SEVEN : 1
  const geo = sleeveGeoFor(size, !!opts.thin)
  const { material, uniforms } = sleeveMaterial('plain', opts.front ?? blankTexture(), {
    ...opts,
    wear: opts.wear ?? (opts.thin ? 0.4 : 1),
    gloss: opts.gloss ?? (opts.thin ? 0.62 : 0.42),
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.scale.setScalar(scale)
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return {
    group,
    mesh,
    uniforms,
    material,
    size,
    scale,
    setFront(tex) {
      material.map = tex
    },
    setBack(tex) {
      uniforms.uBack.value = tex
    },
    dispose() {
      material.dispose()
    },
  }
}

// ─── crate ──────────────────────────────────────────────────────────────────

export interface Crate {
  /** the bin: floor at y = 0, centred on x, low front wall toward +z */
  group: THREE.Group
  mesh: THREE.Mesh
  dims: CrateDims
  shade: CrateShade
  /** crate-local rim height at depth z */
  rimAt(z: number): number
  /** make a sleeve (or an instanced atlas material's uniforms) take this crate's occlusion + held shadow */
  adopt(target: Sleeve | SleeveUniforms): void
  /** a held object's soft shadow down into the crate (crate-local centre, 0..1 strength) */
  setHeld(center: THREE.Vector3 | null, strength?: number): void
  /** refresh the world → crate matrix (call after moving the crate; also runs before each draw) */
  update(): void
  /** standing-slot depth for sleeve i of n (front = 0) */
  slotZ(i: number, n: number): number
}

export interface CrateOpts {
  /** inner front-to-back length (default 1.2: ~16 sleeves + a flipped stack) */
  depth?: number
  color?: THREE.ColorRepresentation
  /** silver-ink legend on the front wall, e.g. ['GLORY RECORDS · THE KITCHEN', '14 × 12"'] (left, right) */
  legend?: [string, string?]
  /** a soft contact shadow quad under the bin (default true) */
  shadow?: boolean
}

export function makeCrate(opts: CrateOpts = {}): Crate {
  const dims = crateDims(opts.depth ?? 1.2)
  const shade = makeCrateShade(dims)
  const group = new THREE.Group()
  const mesh = new THREE.Mesh(crateGeometry(dims), crateMaterial(dims, opts.color))
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  if (opts.shadow !== false) {
    const outer = dims.inner + dims.wall
    group.add(contactShadow(outer, (dims.zFront - dims.zBack) / 2 + dims.wall, 0.03))
  }
  if (opts.legend) {
    const [left, right] = opts.legend
    const { ctx, texture } = artCanvas(1024, 96, 'rgba(0,0,0,0)')
    const draw = () => {
      ctx.clearRect(0, 0, 1024, 96)
      ctx.fillStyle = 'rgba(214,211,204,0.9)'
      ctx.textBaseline = 'middle'
      ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '6px'
      ctx.font = `500 22px ${FONT.mono}`
      ctx.textAlign = 'left'
      ctx.fillText(left, 40, 48)
      if (right) {
        ctx.textAlign = 'right'
        ctx.fillText(right, 984, 48)
      }
      texture.needsUpdate = true
    }
    draw()
    onFonts(draw)
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.0844),
      new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 0.4, metalness: 0.3 }),
    )
    plate.position.set(0, Math.min(0.172, dims.frontH * 0.62), dims.zFront + 0.0009)
    group.add(plate)
  }
  const inv = shade.m
  const update = () => {
    group.updateWorldMatrix(true, false)
    inv.copy(group.matrixWorld).invert()
  }
  mesh.onBeforeRender = () => inv.copy(group.matrixWorld).invert()
  return {
    group,
    mesh,
    dims,
    shade,
    rimAt: z => rimAtDims(z, dims),
    adopt(target) {
      bindCrateShade('uniforms' in target ? target.uniforms : target, shade)
    },
    setHeld(center, strength = 1) {
      if (!center || strength <= 0) {
        shade.lift.w = 0
        return
      }
      shade.lift.set(center.x * 0.5, center.z - 0.72, 1.05, clamp(strength))
      shade.rim.w = center.y - 0.35
    },
    update,
    slotZ(i, n) {
      const front = dims.zFront - 0.58
      const room = front - (dims.zBack + dims.wall + 0.03)
      const step = Math.min(0.034, room / Math.max(1, n - 1))
      return front - i * step
    },
  }
}

/**
 * A soft contact shadow under a rounded-rect footprint (local XZ, half sizes),
 * a flat quad just above y = 0. Use under props standing on a floor/bar.
 */
export function contactShadow(halfW: number, halfD: number, radius = 0.03, strength = 1, pad = 0.9): THREE.Mesh {
  const g = new THREE.PlaneGeometry((halfW + pad) * 2, (halfD + pad) * 2)
  g.rotateX(-Math.PI / 2)
  const m = new THREE.Mesh(g, shadowMaterial(new THREE.Vector2(halfW, halfD), radius, strength))
  m.position.y = 0.0006
  m.renderOrder = -1
  return m
}

// ─── the crate rig (Resonance's choreography, packaged) ─────────────────────

/** Phases inside one item's slot (0..1) — use them to time your copy. */
export const RIG_PHASE = {
  rise: [0, 0.22] as const,
  out: [0.12, 0.3] as const,
  /** copy on / off */
  hudOn: 0.18,
  hudOff: 0.78,
  home: [0.66, 0.79] as const,
  fall: [0.8, 0.915] as const,
  flip: 0.905,
  /** the camera should be settled on the presentation between these */
  camIn: 0.22,
  camOut: 0.8,
}

export interface CrateRigOpts {
  crate: Crate
  /** featured sleeves, front → back (12"). The rig parents them to the crate. */
  sleeves: Sleeve[]
  /** the record that slides out (default: a new 12" record) */
  record?: Record
  /** a label per sleeve (swapped onto the record while it's out) */
  labels?: THREE.Texture[]
  /** background sleeves behind the featured ones: a count (blank board) or an atlas */
  fillers?: number | { count: number; atlas?: THREE.Texture; inks?: boolean[] }
  /** crate-local presentation point (default (0, 1.88, 0.78)) */
  present?: THREE.Vector3
  /** degrees; per item (cycled). The sleeve faces a camera looking along this yaw/pitch. */
  yaw?: number[]
  pitch?: number
  /** how far the record slides out to the sleeve's right (default 0.56) */
  slide?: number
  /** called when a flipping sleeve lands on the stack (i = slot, v = impact) — sfx, LEDs */
  onLand?: (i: number, v: number) => void
}

interface Kick {
  i: number
  at: number
  v: number
}

/**
 * THE CRATE CHOREOGRAPHY. Drive it with one number:
 *
 *   rig.update(item, frame, riffle)
 *
 * `item` runs 0..N (N = featured sleeves). While item ∈ [k, k+1) sleeve k is
 * the one in hand: it lifts straight up out of its slot and turns to camera
 * (0–0.22 of the slot), the record slides out to its right and spins at 33⅓
 * (0.12–0.3), holds, slides home (0.66–0.79), the sleeve drops back
 * (0.8–0.915) and flips forward onto the stack with real-time physics
 * (gravity, bounce, the stack recoils) that always settle. `riffle` (0..F)
 * then flips the background sleeves one by one (filler j stands face-out at
 * the front while riffle ∈ [j, j+1)).
 *
 * Scroll decides where every sleeve SHOULD be; flips are physics, so small
 * scrubs animate and big jumps (> 2 items / 3 fillers, or after reset())
 * snap straight to the settled crate — any local renders a resolved frame.
 */
export class CrateRig {
  crate: Crate
  sleeves: Sleeve[]
  record: Record
  labels: THREE.Texture[]
  fillers: THREE.InstancedMesh | null = null
  /** featured count / filler count / all slots */
  nf: number
  nr: number
  n: number
  present: THREE.Vector3
  yaw: number[]
  pitch: number
  slide: number
  onLand?: (i: number, v: number) => void

  /** current item in hand (-1 none), its slot phase 0..1, lift 0..1, record slide 0..1 */
  k = -1
  s = 0
  lift = 0
  out = 0
  /** the held sleeve's centre + orientation (crate-local) */
  held = { center: new THREE.Vector3(), q: new THREE.Quaternion() }
  /** the record's centre (crate-local) */
  recordCenter = new THREE.Vector3()
  /** true while the record is out of its sleeve */
  recordShown = false

  private flip: Float32Array
  private flipV: Float32Array
  private wob: Float32Array
  private wobV: Float32Array
  private jx: Float32Array
  private lean: Float32Array
  private tgt: Uint8Array
  private kicks: Kick[] = []
  private spin = 0
  private spinBoost = 0
  private time = 0
  private lastItem = NaN
  private lastRiffle = NaN
  private snapNext = true
  private m4 = new THREE.Matrix4()
  private m4b = new THREE.Matrix4()
  private pivotDown = new THREE.Matrix4().makeTranslation(0, -0.5, 0)
  private q = new THREE.Quaternion()
  private q2 = new THREE.Quaternion()
  private qSpin = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private v2 = new THREE.Vector3()
  private v3 = new THREE.Vector3()
  private D = new THREE.Vector3()
  private e = new THREE.Euler()
  private one = new THREE.Vector3(1, 1, 1)
  private y0: number
  private th0: number

  constructor(o: CrateRigOpts) {
    this.crate = o.crate
    this.sleeves = o.sleeves
    this.nf = o.sleeves.length
    const f = o.fillers ?? 0
    this.nr = typeof f === 'number' ? f : f.count
    this.n = this.nf + this.nr
    this.present = o.present?.clone() ?? new THREE.Vector3(0, 1.88, 0.78)
    this.yaw = o.yaw ?? [9, -6, 8, -8, 6, -4]
    this.pitch = o.pitch ?? 16
    this.slide = o.slide ?? 0.56
    this.onLand = o.onLand
    this.record = o.record ?? makeRecord()
    this.labels = o.labels ?? []
    const n = this.n
    this.flip = new Float32Array(n)
    this.flipV = new Float32Array(n)
    this.wob = new Float32Array(n)
    this.wobV = new Float32Array(n)
    this.jx = new Float32Array(n)
    this.lean = new Float32Array(n)
    this.tgt = new Uint8Array(n)
    const C = this.crate.dims
    this.y0 = C.y0
    this.th0 = Math.atan((C.zFront - C.wall - (C.zFront - 0.44)) / (C.frontH - C.y0)) - 0.016
    for (let i = 0; i < n; i++) {
      const h = Math.sin(i * 91.7 + 3.1) * 43758.5453
      const r = h - Math.floor(h)
      const h2 = Math.sin(i * 37.3 + 1.7) * 23421.631
      const r2 = h2 - Math.floor(h2)
      this.jx[i] = (r - 0.5) * 0.018
      this.lean[i] = -0.03 + (r2 - 0.5) * 0.024
    }
    const g = this.crate.group
    for (const s of this.sleeves) {
      s.group.matrixAutoUpdate = false
      g.add(s.group)
      this.crate.adopt(s)
    }
    g.add(this.record.group)
    if (this.nr > 0) {
      const atlas = typeof f === 'number' ? undefined : f.atlas
      const inks = typeof f === 'number' ? undefined : f.inks ?? (atlas?.userData?.inks as boolean[] | undefined)
      const { material, uniforms } = sleeveMaterial('atlas', atlas ?? blankTexture())
      this.crate.adopt(uniforms)
      const geo = sleeveGeometry()
      const cells = new Float32Array(this.nr)
      const ink = new Float32Array(this.nr)
      for (let j = 0; j < this.nr; j++) {
        cells[j] = j % 15
        ink[j] = inks?.[j % 15] ? 1 : 0
      }
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1))
      geo.setAttribute('aInk', new THREE.InstancedBufferAttribute(ink, 1))
      this.fillers = new THREE.InstancedMesh(geo, material, this.nr)
      this.fillers.frustumCulled = false
      this.fillers.receiveShadow = true
      g.add(this.fillers)
    }
    this.update(0, { dt: 0, time: 0 })
  }

  /** forget the past: the next update snaps every sleeve to where it belongs (onEnter) */
  reset() {
    this.snapNext = true
  }

  /** the jostle wave from a cut: every sleeve wobbles, front to back (onEnter) */
  kick(strength = 1) {
    for (let i = 0; i < this.n; i++)
      this.kicks.push({ i, at: this.time + 0.05 + i * 0.026, v: (1.5 - i * 0.05) * (this.flip[i] > 0.5 ? 0.35 : 1) * strength })
  }

  /** a push on the spinning record (a tap) */
  boost(v = 14) {
    this.spinBoost = Math.min(this.spinBoost + v, 30)
  }

  /** slot phase helpers for copy timing */
  hudOn() {
    return this.k >= 0 && this.s > RIG_PHASE.hudOn && this.s < RIG_PHASE.hudOff
  }

  /** index of the first sleeve still standing (0..nf-1 featured, nf.. fillers; n when all are down) */
  front() {
    for (let i = 0; i < this.n; i++) if (this.flip[i] < 0.5 && !(i === this.k && this.lift > 0.05)) return i
    return this.n
  }

  /** flip state of slot i (0 standing .. 1 on the stack) */
  flipOf(i: number) {
    return this.flip[i]
  }

  /**
   * World centre of item k's presentation (sleeve + record out beside it) and
   * the direction a camera should look along (for framing: `frameTo`).
   */
  station(k: number, center: THREE.Vector3, dir: THREE.Vector3) {
    this.crate.group.updateWorldMatrix(true, false)
    dirOf(this.yaw[k % this.yaw.length], this.pitch, dir)
    const r = this.v3.crossVectors(dir, UP).normalize()
    center.copy(this.present).addScaledVector(r, (this.slide + this.record.dims.R - 0.5) / 2)
    const mw = this.crate.group.matrixWorld
    center.applyMatrix4(mw)
    dir.transformDirection(mw)
    const k7 = this.record.size === 7 ? 1 / this.crate.group.scale.x : 1
    const sc = this.crate.group.scale.x
    return { w: (0.5 + this.slide + this.record.dims.R * k7) * sc, h: 1.06 * sc }
  }

  /** world-space centre of the held sleeve / the record */
  heldWorld(out: THREE.Vector3) {
    return out.copy(this.held.center).applyMatrix4(this.crate.group.matrixWorld)
  }
  recordWorld(out: THREE.Vector3) {
    return out.copy(this.recordCenter).applyMatrix4(this.crate.group.matrixWorld)
  }

  update(item: number, frame: VinylFrame, riffle = 0) {
    this.time = frame.time
    const nf = this.nf
    let k = -1
    let s = 0
    if (item >= 0 && item < nf) {
      k = Math.min(nf - 1, Math.floor(item))
      s = item - k
    }
    const pUp = k >= 0 ? outBack(segment(s, RIG_PHASE.rise[0], RIG_PHASE.rise[1]), 0.9) : 0
    const pDown = k >= 0 ? inOutCubic(segment(s, RIG_PHASE.fall[0], RIG_PHASE.fall[1])) : 0
    const lift = k >= 0 ? (s < RIG_PHASE.fall[0] ? pUp : 1 - pDown) : 0
    const slide = k >= 0 ? outBack(segment(s, RIG_PHASE.out[0], RIG_PHASE.out[1]), 1.1) * (1 - inOutCubic(segment(s, RIG_PHASE.home[0], RIG_PHASE.home[1]))) : 0
    this.k = k
    this.s = s
    this.lift = lift
    this.out = slide

    // targets
    const tgt = this.tgt
    for (let i = 0; i < nf; i++) tgt[i] = item > i + RIG_PHASE.flip ? 1 : 0
    for (let j = 0; j < this.nr; j++) tgt[nf + j] = item >= nf && riffle > j + 1 ? 1 : 0
    if (k >= 0 && lift > 0.01) tgt[k] = 0
    const jump =
      this.snapNext ||
      !Number.isFinite(this.lastItem) ||
      Math.abs(item - this.lastItem) > 2 ||
      Math.abs(riffle - this.lastRiffle) > 3
    this.lastItem = item
    this.lastRiffle = riffle
    this.snapNext = false
    if (jump) {
      for (let i = 0; i < this.n; i++) {
        this.flip[i] = tgt[i]
        this.flipV[i] = 0
      }
    } else this.stepPhysics(frame)

    // featured sleeves
    for (let i = 0; i < nf; i++) {
      const g = this.sleeves[i].group
      if (i === k && lift > 0.0005) this.presentMatrix(i, lift, g.matrix)
      else this.crateMatrix(i, g.matrix)
      g.matrixWorldNeedsUpdate = true
    }
    // fillers
    if (this.fillers) {
      for (let j = 0; j < this.nr; j++) {
        this.crateMatrix(nf + j, this.m4)
        this.fillers.setMatrixAt(j, this.m4)
      }
      this.fillers.instanceMatrix.needsUpdate = true
    }

    // the record
    const rec = this.record
    // in its sleeve the record is collapsed, not hidden: it keeps drawing (one
    // cheap call) so its program compiles at prewarm and never hitches later
    const shown = k >= 0 && slide > 0.002 && lift > 0.5
    this.recordShown = shown
    rec.group.visible = true
    // a 7" record's dims are absolute: undo a crate scaled down to singles (crate.group.scale = SEVEN)
    const rs = this.record.size === 7 ? 1 / this.crate.group.scale.x : 1
    rec.group.scale.setScalar(shown ? rs : 1e-4)
    if (!shown) rec.group.position.set(0, -1, 0)
    if (shown) {
      const lab = this.labels[k]
      if (lab && rec.uniforms.uLabel.value !== lab) rec.setLabel(lab)
      rec.uniforms.uSeed.value = k * 1.37 + 0.5
      this.recordCenter.copy(this.held.center).add(this.v.set(this.slide * slide, 0, 0).applyQuaternion(this.held.q))
      rec.group.position.copy(this.recordCenter)
      rec.group.quaternion.copy(this.held.q)
      const speed = frame.reducedMotion ? RPM33 * 0.5 : RPM33
      this.spinBoost *= Math.exp(-frame.dt * 1.6)
      const omega = speed * smoothstep(0.15, 0.85, slide) + (frame.velocity ?? 0) * 5 + this.spinBoost
      if (!frame.still) this.spin -= omega * frame.dt
      rec.setSpin(this.spin)
      rec.setSmear(omega)
    }
    // the held sleeve's shadow down into the crate
    this.crate.setHeld(lift > 0.05 ? this.held.center : null, clamp(lift * 1.2))
  }

  private stepPhysics(f: VinylFrame) {
    const n = this.n
    const tgt = this.tgt
    // physical order: a sleeve can't fall until the one in front is out of the
    // way, and can't stand back up while the one lying on it is still down;
    // a backlog (a fast flick) riffles through faster
    let backlog = 0
    for (let i = 0; i < n; i++) if (tgt[i] !== (this.flip[i] > 0.5 ? 1 : 0)) backlog++
    const hurry = backlog > 2 ? 1 : 0
    const gate = hurry ? 0.3 : 0.5
    for (let i = 1; i < n; i++) if (tgt[i] && this.flip[i - 1] < gate) tgt[i] = 0
    for (let i = n - 2; i >= 0; i--) if (!tgt[i] && this.flip[i + 1] > 1 - gate) tgt[i] = 1
    const G = hurry ? 120 : 58

    for (let q = this.kicks.length - 1; q >= 0; q--) {
      const kk = this.kicks[q]
      if (this.time >= kk.at) {
        this.wobV[kk.i] += kk.v
        this.kicks.splice(q, 1)
      }
    }

    const dt = Math.min(f.dt, 1 / 20)
    const steps = Math.max(1, Math.ceil(dt / 0.006))
    const h = dt / steps
    const reduced = !!f.reducedMotion
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < n; i++) {
        let x = this.flip[i]
        let v = this.flipV[i]
        if (tgt[i]) {
          if (!reduced && x < 0.985 && v >= -0.05) {
            // released: a nudge, then gravity torque that grows as it leans
            if (x < 0.02 && v < 1.1) v = 1.1
            v += (G * (0.14 + x) - 1.2 * v) * h
          } else {
            const K = reduced ? 120 : 280
            v += (-K * (x - 1) - (reduced ? 22 : 13) * v) * h
          }
          x += v * h
          if (!reduced && x > 1.03 && v > 0) {
            const impact = v
            x = 1.03
            v = -v * 0.3
            // the stack beneath recoils
            for (let j = i - 1, d = 0; j >= 0 && d < 5; j--, d++) if (this.flip[j] > 0.9) this.wobV[j] += impact * 0.05 * Math.pow(0.6, d)
            for (let j = i + 1; j < Math.min(n, i + 4); j++) if (this.flip[j] < 0.1) this.wobV[j] -= impact * 0.02
            this.onLand?.(i, impact)
          }
        } else {
          const K0 = hurry ? 320 : 150
          v += (-K0 * x - 2 * Math.sqrt(K0) * v) * h
          x += v * h
          if (x < 0) {
            x = 0
            v = 0
          }
        }
        this.flip[i] = x
        this.flipV[i] = v
        let w = this.wob[i]
        let wv = this.wobV[i]
        wv += (-240 * w - 5.2 * wv) * h
        w += wv * h
        this.wob[i] = w
        this.wobV[i] = wv
      }
    }
  }

  private zUp(i: number) {
    return this.crate.slotZ(i, this.n)
  }
  private zStack(i: number) {
    const C = this.crate.dims
    const step = Math.min(0.024, 0.9 / Math.max(1, this.n))
    return C.zFront - 0.44 - i * step
  }
  private thStack(i: number) {
    return Math.atan(Math.tan(this.th0) + i * Math.min(0.045, 1.6 / Math.max(1, this.n)))
  }

  /** In-crate transform: upright in its slot ↔ lying forward on the stack. */
  private crateMatrix(i: number, out: THREE.Matrix4) {
    const x = this.flip[i]
    const xs = clamp(x)
    const sm = xs * xs * (3 - 2 * xs)
    const z = lerp(this.zUp(i), this.zStack(i), sm)
    const a = lerp(this.lean[i], this.thStack(i), x) + this.wob[i] * (1 - 0.6 * xs)
    this.e.set(a, 0, (this.jx[i] * 2 - 0.004) * (1 - xs))
    this.q.setFromEuler(this.e)
    out.compose(this.v.set(this.jx[i], this.y0, z), this.q, this.one)
  }

  /**
   * Out of the crate and into the hand: straight up out of the slot, then over
   * to the presentation point, turning to face the lens.
   */
  private presentMatrix(i: number, p: number, out: THREE.Matrix4) {
    const at = this.present
    const slot = this.v.set(this.jx[i], this.y0 + 0.5, this.zUp(i))
    const ctrl = this.v2.set(slot.x, at.y - 0.12, slot.z)
    const t = Math.max(0, p)
    const u1 = 1 - t
    const c = this.held.center
    if (t <= 1) {
      c.copy(slot).multiplyScalar(u1 * u1).addScaledVector(ctrl, 2 * u1 * t).addScaledVector(at, t * t)
    } else {
      this.v3.copy(at).sub(ctrl).multiplyScalar(2 * (t - 1))
      c.copy(at).add(this.v3)
    }
    // idle float once presented
    c.y += Math.sin(this.time * 1.1 + i) * 0.006 * clamp(t)
    this.e.set(this.lean[i], 0, 0)
    this.q.setFromEuler(this.e)
    dirOf(this.yaw[i % this.yaw.length], this.pitch, this.D)
    this.m4b.lookAt(c, this.v3.copy(c).add(this.D), UP)
    this.q2.setFromRotationMatrix(this.m4b)
    const r = smoothstep(0.15, 1, t)
    const hq = this.held.q
    hq.copy(this.q).slerp(this.q2, r)
    // a little hand-held tilt on the way
    const tilt = Math.sin(clamp(t) * Math.PI) * 0.07
    this.q.setFromAxisAngle(this.v3.set(0, 0, 1), tilt * (i % 2 ? 1 : -1))
    hq.multiply(this.q)
    out.compose(c, hq, this.one).multiply(this.pivotDown)
  }
}

/** camera view direction for a yaw/pitch (degrees): yaw 0 looks along -z, pitch > 0 looks down */
export const dirOf = (yaw: number, pitch: number, out: THREE.Vector3) =>
  out.set(-Math.sin(yaw * DEG) * Math.cos(pitch * DEG), -Math.sin(pitch * DEG), -Math.cos(yaw * DEG) * Math.cos(pitch * DEG))

/** a screen region in px */
export interface Region {
  x0: number
  x1: number
  y0: number
  y1: number
}

const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
/**
 * Place a camera looking along `dir` so a subject of span w × h (world, in
 * the view plane) centred on `center` fills screen region `reg` (px of a
 * W × H frame) at vertical fov (degrees). Writes out.position/target.
 */
export function frameTo(
  out: { position: THREE.Vector3; target: THREE.Vector3; fov?: number },
  center: THREE.Vector3,
  dir: THREE.Vector3,
  w: number,
  h: number,
  reg: Region,
  W: number,
  H: number,
  fov: number,
) {
  const aspect = W / H
  const tanH = Math.tan((fov * DEG) / 2)
  const fw = Math.max(0.05, (reg.x1 - reg.x0) / W)
  const fh = Math.max(0.05, (reg.y1 - reg.y0) / H)
  const cx = ((reg.x0 + reg.x1) / 2 / W) * 2 - 1
  const cy = 1 - ((reg.y0 + reg.y1) / 2 / H) * 2
  const dist = Math.max(w / 2 / (fw * tanH * aspect), h / 2 / (fh * tanH))
  const hh = dist * tanH
  const hw = hh * aspect
  _r.crossVectors(dir, UP).normalize()
  _u.crossVectors(_r, dir).normalize()
  out.position.copy(center).addScaledVector(dir, -dist).addScaledVector(_r, -cx * hw).addScaledVector(_u, -cy * hh)
  out.target.copy(out.position).addScaledVector(dir, dist)
  out.fov = fov
  return out
}

// ─── turntable ──────────────────────────────────────────────────────────────

/** Turntable dimensions (local units; 12" sleeve = 1). Base on y = 0, front toward +z. */
export const TT = {
  w: 1.46,
  d: 1.16,
  /** top of the deck plate */
  top: 0.2,
  /** platter centre (x, z) */
  px: -0.18,
  pz: -0.03,
  platterR: 0.49,
  platterTop: 0.26,
  matTop: 0.266,
  /** where a record's centre plane sits */
  recordY: 0.2682,
  /** tonearm pivot (x, z) and tube height */
  ax: 0.42,
  az: -0.36,
  armY: 0.3286,
  /** effective arm length (pivot → stylus) */
  armL: 0.73,
  /** stylus drop below the tube axis */
  drop: 0.058,
}

export interface Turntable {
  group: THREE.Group
  /** the spinning platter (records ride on it) */
  platter: THREE.Group
  /** the stylus tip (world position via getWorldPosition) */
  stylus: THREE.Object3D
  /** the tonearm (yaw) group */
  arm: THREE.Group
  /** where a record sits on the mat (local +z is UP here: rec.group.position.z lifts it off the platter) */
  mount: THREE.Object3D
  /** current spin angle (rad) and speed (rad/s) */
  readonly angle: number
  readonly omega: number
  /** put a record on the platter (null takes it off) */
  setRecord(rec: Record | null): void
  /** target speed in rpm (0, 33.33, 45); damped by time unless immediate */
  setSpeed(rpm: number, immediate?: boolean): void
  /** 0 on the rest → 0.5 over the lead-in → 1 at the play position */
  setArm(a: number): void
  /** where "playing" is: 0 lead-in … 1 run-out groove (default 0.3) */
  setGroove(g: number): void
  /** 1 lifted (cue up) … 0 lowered */
  setCue(c: number): void
  /** dust cover open 0..1 (only with dustCover: true) */
  setCover(open: number): void
  /** pilot light 0..1 (default on) */
  setPower(on: number): void
  /** per frame: pass the chapter's Frame (or dt in seconds). With frame.still (Motion off) the platter holds. */
  update(f: number | { dt: number; still?: boolean }): void
  dispose(): void
}

export interface TurntableOpts {
  finish?: 'walnut' | 'black'
  dustCover?: boolean
  /** plinth, platter and arm cast the world spot's shadow (default true) */
  shadows?: boolean
  /** a soft contact shadow under the feet (default true) */
  contact?: boolean
}

/**
 * A premium deck, product-film style: walnut (or black satin) plinth with a
 * brushed black deck plate, brushed aluminium platter with strobe dots on the
 * rim (the 33⅓ row reads "locked" at 33⅓, the 45 row at 45), a felt mat,
 * chrome spindle, an S-shaped tonearm with counterweight, headshell and a
 * Glory-red cartridge, arm rest, cueing lever, start/stop + 33/45 buttons, a
 * red pilot light and a strobe lamp. Base on y = 0; front (buttons) toward +z.
 */
export function makeTurntable(opts: TurntableOpts = {}): Turntable {
  const M = turntableMaterials(opts.finish ?? 'walnut')
  const shadows = opts.shadows !== false
  const group = new THREE.Group()
  const geos: THREE.BufferGeometry[] = []
  // parts are posed like meshes, then merged per (parent, material, shadow) at
  // the end: ~45 parts → ~16 draw calls (and as many fewer in the shadow pass)
  const parts: { m: THREE.Mesh; parent: THREE.Object3D; cast: boolean }[] = []
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group, cast = shadows) => {
    const m = new THREE.Mesh(geo, mat)
    parts.push({ m, parent, cast })
    return m
  }
  const flush = () => {
    const buckets = new Map<string, { parent: THREE.Object3D; mat: THREE.Material; cast: boolean; list: THREE.BufferGeometry[] }>()
    for (const { m, parent, cast } of parts) {
      const mat = m.material as THREE.Material
      const key = `${parent.uuid}|${mat.uuid}|${cast}`
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { parent, mat, cast, list: [] }))
      m.updateMatrix()
      b.list.push(m.geometry.clone().applyMatrix4(m.matrix))
      m.geometry.dispose()
    }
    for (const b of buckets.values()) {
      const g = b.list.length === 1 ? cleanParts(b.list)[0] : mergeGeometries(cleanParts(b.list), false)!
      g.computeBoundingSphere()
      geos.push(g)
      const m = new THREE.Mesh(g, b.mat)
      m.castShadow = b.cast
      m.receiveShadow = true
      b.parent.add(m)
    }
  }
  const { w, d, top } = TT

  // feet
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const f = mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.04, 32), M.rubber, group, false)
    f.position.set(sx * (w / 2 - 0.15), 0.02, sz * (d / 2 - 0.14))
    const ring = mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.008, 32), M.satin, group, false)
    ring.position.set(sx * (w / 2 - 0.15), 0.036, sz * (d / 2 - 0.14))
  }
  // plinth + deck plate
  {
    const pg = roundedBox(w, top - 0.046, d, 0.022, 4)
    const p = mesh(pg, M.plinth)
    p.position.y = 0.04 + (top - 0.046) / 2
    // walnut grain along x on every face: scale the box's per-face UVs to world units
    const uv = pg.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 0.35)
    const deck = mesh(roundedBox(w - 0.03, 0.012, d - 0.03, 0.005, 2), M.deck)
    deck.position.y = top - 0.006
  }
  // printed deck legends
  {
    const cw = 1024
    const ch = Math.round((cw * d) / w)
    const { canvas, ctx, texture } = artCanvas(cw, ch, 'rgba(0,0,0,0)')
    ctx.clearRect(0, 0, cw, ch)
    const px = (x: number) => ((x + w / 2) / w) * cw
    const pz = (z: number) => ((z + d / 2) / d) * ch
    const draw = () => {
      ctx.clearRect(0, 0, cw, ch)
      ctx.fillStyle = 'rgba(214,210,202,0.8)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `500 ${cw * 0.0115}px ${FONT.mono}`
      ctx.fillText('START · STOP', px(-0.6), pz(0.535))
      ctx.fillText('33', px(-0.43), pz(0.54))
      ctx.fillText('45', px(-0.34), pz(0.54))
      ctx.fillText('PITCH', px(0.62), pz(0.02))
      ctx.fillText('+', px(0.66), pz(0.08))
      ctx.fillText('−', px(0.66), pz(0.44))
      ctx.textAlign = 'left'
      ctx.font = `400 ${cw * 0.02}px ${FONT.display}`
      ctx.fillStyle = 'rgba(236,230,218,0.86)'
      ctx.fillText('GLORY', px(0.2), pz(0.5))
      ctx.font = `500 ${cw * 0.0095}px ${FONT.mono}`
      ctx.fillStyle = 'rgba(214,210,202,0.6)'
      ctx.fillText('DIRECT DRIVE · QUARTZ LOCK', px(0.2), pz(0.535))
      texture.needsUpdate = true
    }
    draw()
    onFonts(draw)
    void canvas
    const legend = mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      group,
      false,
    )
    legend.position.y = top + 0.0004
  }

  // platter (spins)
  const platter = new THREE.Group()
  platter.position.set(TT.px, 0, TT.pz)
  group.add(platter)
  const pBot = top + 0.008
  const pTop = TT.platterTop
  const R = TT.platterR
  const dotsN: [number, number] = [108, 80]
  let platterU: PlatterUniforms
  {
    // bottom → up the rim → across the top (lathe normals face out this way)
    const prof = [
      [0.12, pBot - 0.004],
      [R - 0.03, pBot - 0.004],
      [R - 0.03, pBot],
      [R - 0.006, pBot],
      [R, pBot + 0.005],
      [R, pTop - 0.005],
      [R - 0.006, pTop],
      [0.02, pTop],
    ].map(([x, y]) => new THREE.Vector2(x, y))
    const g = new THREE.LatheGeometry(prof, 180)
    const { material, uniforms } = platterMaterial(R, pTop, pBot, dotsN)
    platterU = uniforms
    mesh(g, material, platter)
    // mat
    const mat = mesh(new THREE.CylinderGeometry(R - 0.018, R - 0.018, TT.matTop - pTop, 120, 1), M.felt, platter, false)
    mat.position.y = (TT.matTop + pTop) / 2
    // spindle
    const sp = mesh(new THREE.CylinderGeometry(0.0112, 0.0112, 0.03, 24), M.chrome, platter, false)
    sp.position.y = TT.matTop + 0.015
    const tip = mesh(new THREE.SphereGeometry(0.0112, 16, 8, 0, TAU, 0, Math.PI / 2), M.chrome, platter, false)
    tip.position.y = TT.matTop + 0.03
  }
  const recordMount = new THREE.Object3D()
  recordMount.position.y = TT.recordY
  recordMount.rotation.x = -Math.PI / 2
  platter.add(recordMount)

  // tonearm base (static)
  const A = new THREE.Vector3(TT.ax, 0, TT.az)
  {
    const b = mesh(new THREE.CylinderGeometry(0.09, 0.094, 0.012, 48), M.satin)
    b.position.set(A.x, top + 0.006, A.z)
    const col = mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 48), M.black)
    col.position.set(A.x, top + 0.037, A.z)
    const ringg = mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.01, 48), M.satin)
    ringg.position.set(A.x, top + 0.048, A.z)
    const pil = mesh(new THREE.CylinderGeometry(0.026, 0.03, TT.armY - top - 0.075, 32), M.satin)
    pil.position.set(A.x, (top + 0.062 + TT.armY - 0.013) / 2, A.z)
    // anti-skate dial
    const as = mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.016, 32), M.satin)
    as.position.set(A.x - 0.1, top + 0.008, A.z - 0.07)
    // arm rest
    const rx = A.x + 0.047
    const rz = A.z + 0.45
    const post = mesh(new THREE.CylinderGeometry(0.009, 0.012, TT.armY - top - 0.016, 16), M.satin)
    post.position.set(rx, (top + TT.armY - 0.016) / 2, rz)
    const cradle = mesh(new THREE.BoxGeometry(0.036, 0.008, 0.02), M.rubber)
    cradle.position.set(rx, TT.armY - 0.016, rz)
  }
  // cue lever
  const cueLever = new THREE.Group()
  cueLever.position.set(A.x + 0.1, top + 0.03, A.z + 0.02)
  group.add(cueLever)
  {
    const blk = mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), M.black)
    blk.position.set(A.x + 0.1, top + 0.025, A.z + 0.02)
    const rod = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 12), M.chrome, cueLever, false)
    rod.rotation.x = Math.PI / 2
    rod.position.z = 0.035
    const knob = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.022, 16), M.black, cueLever, false)
    knob.position.z = 0.07
  }

  // tonearm (yaw → pitch)
  const arm = new THREE.Group()
  arm.position.set(A.x, TT.armY, A.z)
  group.add(arm)
  const pitch = new THREE.Group()
  arm.add(pitch)
  {
    // gimbal
    const gim = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 32), M.black, arm)
    gim.position.y = -0.005
    const brg = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 20), M.chrome, pitch)
    brg.rotation.z = Math.PI / 2
    // the S tube
    const hs = -0.384 // headshell offset (rad)
    const P = new THREE.Vector3(0 - 0.07 * Math.sin(hs), 0, TT.armL - 0.07 * Math.cos(hs))
    const end = P.clone().add(new THREE.Vector3(Math.sin(hs), 0, Math.cos(hs)).multiplyScalar(-0.011))
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -0.07),
      new THREE.Vector3(0, 0, 0.1),
      new THREE.Vector3(0.026, 0, 0.3),
      new THREE.Vector3(0.05, 0, 0.46),
      new THREE.Vector3(0.046, 0, 0.57),
      end,
    ])
    mesh(new THREE.TubeGeometry(curve, 96, 0.0105, 14, false), M.chrome, pitch)
    // rear stub + counterweight
    const stub = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.16, 16), M.chrome, pitch)
    stub.rotation.x = Math.PI / 2
    stub.position.z = -0.14
    const cw = mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.07, 40), M.black, pitch)
    cw.rotation.x = Math.PI / 2
    cw.position.z = -0.17
    const cwr = mesh(new THREE.CylinderGeometry(0.0445, 0.0445, 0.012, 40), M.satin, pitch)
    cwr.rotation.x = Math.PI / 2
    cwr.position.z = -0.13
    // headshell
    const head = new THREE.Group()
    head.position.copy(P)
    head.rotation.y = hs
    pitch.add(head)
    const collar = mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.024, 20), M.chrome, head)
    collar.rotation.x = Math.PI / 2
    collar.position.z = -0.006
    const plate = mesh(roundedBox(0.05, 0.006, 0.1, 0.002, 2), M.black, head)
    plate.position.set(0, -0.006, 0.05)
    const lift = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 8), M.chrome, head, false)
    lift.rotation.z = Math.PI / 2 - 0.3
    lift.position.set(0.045, 0.004, 0.07)
    const cart = mesh(roundedBox(0.032, 0.04, 0.052, 0.004, 2), M.cart, head)
    cart.position.set(0, -0.009 - 0.02, 0.064)
    const cant = mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.014, 6), M.chrome, head, false)
    cant.rotation.x = 0.9
    cant.position.set(0, -0.052, 0.074)
  }
  const stylus = new THREE.Object3D()
  stylus.position.set(0, -TT.drop, TT.armL)
  pitch.add(stylus)

  // controls
  {
    const ss = mesh(roundedBox(0.14, 0.02, 0.08, 0.006, 2), M.satin)
    ss.position.set(-0.6, top + 0.006, 0.46)
    for (const x of [-0.43, -0.34]) {
      const b = mesh(roundedBox(0.06, 0.014, 0.036, 0.004, 2), M.satin)
      b.position.set(x, top + 0.004, 0.49)
    }
    // pilot light + strobe lamp
    const pl = mesh(new THREE.SphereGeometry(0.009, 16, 8, 0, TAU, 0, Math.PI / 2), M.pilot, group, false)
    pl.position.set(-0.5, top + 0.001, 0.46)
    const lampBody = mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 24), M.black)
    lampBody.position.set(-0.6, top + 0.025, 0.28)
    const lampLens = mesh(new THREE.SphereGeometry(0.02, 16, 8), M.lamp, group, false)
    lampLens.position.set(-0.585, top + 0.04, 0.265)
    // pitch fader
    const slot = mesh(new THREE.BoxGeometry(0.03, 0.004, 0.4), M.rubber, group, false)
    slot.position.set(0.62, top + 0.001, 0.26)
    const knob = mesh(roundedBox(0.06, 0.03, 0.035, 0.006, 2), M.satin)
    knob.position.set(0.62, top + 0.015, 0.26)
  }

  // dust cover (off by default)
  let cover: THREE.Group | null = null
  if (opts.dustCover) {
    cover = new THREE.Group()
    cover.position.set(0, top, -d / 2 + 0.01)
    group.add(cover)
    const H = 0.3
    const parts: THREE.BufferGeometry[] = []
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
      g.translate(x, y, z)
      parts.push(g)
    }
    add(new THREE.BoxGeometry(w - 0.01, 0.006, d - 0.02), 0, H, (d - 0.02) / 2)
    add(new THREE.BoxGeometry(w - 0.01, H, 0.006), 0, H / 2, d - 0.02)
    add(new THREE.BoxGeometry(0.006, H, d - 0.02), -(w - 0.01) / 2, H / 2, (d - 0.02) / 2)
    add(new THREE.BoxGeometry(0.006, H, d - 0.02), (w - 0.01) / 2, H / 2, (d - 0.02) / 2)
    add(new THREE.BoxGeometry(w - 0.01, H, 0.006), 0, H / 2, 0)
    const cg = mergeGeometries(parts, false)!
    geos.push(cg)
    const cm = new THREE.Mesh(
      cg,
      new THREE.MeshPhysicalMaterial({ color: '#2a2624', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, clearcoat: 1, depthWrite: false }),
    )
    cover.add(cm)
  }

  flush()
  if (opts.contact !== false) group.add(contactShadow(w / 2, d / 2, 0.06, 0.9, 0.6))

  // ---- state
  let target = 0
  let omega = 0
  let angle = 0
  let armA = 0
  let groove = 0.3
  let cue = 1
  let record: Record | null = null
  const strobe = [0, 0]
  const F = 60 // the virtual strobe lamp (Hz)

  /** arm yaw ψ (0 = on the rest) that puts the stylus at radius r from the spindle */
  const spX = TT.px - A.x
  const spZ = TT.pz - A.z
  const psiFor = (r: number) => {
    let lo = 0
    let hi = 1.3
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2
      const sx = -TT.armL * Math.sin(mid)
      const sz = TT.armL * Math.cos(mid)
      const dd = Math.hypot(sx - spX, sz - spZ)
      if (dd > r) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const psiLead = psiFor(REC12.lead + 0.012)
  const psiIn = psiFor(REC12.lead - 0.004)
  const psiOut = psiFor(REC12.wax + 0.006)
  const applyArm = () => {
    const playPsi = lerp(psiIn, psiOut, groove)
    const psi = armA <= 0.5 ? lerp(0, psiLead, smoothstep(0, 1, armA / 0.5)) : lerp(psiLead, playPsi, (armA - 0.5) / 0.5)
    arm.rotation.y = -psi
    // cue: lifted 0.03 at the stylus; on the rest the arm sits on the cradle
    const onRecord = armA > 0.3 ? 1 : 0
    const lifted = cue * 0.045 + (1 - onRecord) * 0.012
    pitch.rotation.x = -lifted
    cueLever.rotation.x = -0.5 + cue * 0.8
  }
  applyArm()

  const tt: Turntable = {
    group,
    platter,
    stylus,
    arm,
    mount: recordMount,
    get angle() {
      return angle
    },
    get omega() {
      return omega
    },
    setRecord(rec) {
      if (record) recordMount.remove(record.group)
      record = rec
      if (rec) {
        rec.group.position.set(0, 0, 0)
        rec.group.quaternion.identity()
        rec.setSpin(0)
        recordMount.add(rec.group)
      }
    },
    setSpeed(rpm, immediate = false) {
      target = rpmToRad(rpm)
      if (immediate) omega = target
    },
    setArm(a) {
      armA = clamp(a)
      applyArm()
    },
    setGroove(g) {
      groove = clamp(g)
      applyArm()
    },
    setCue(c) {
      cue = clamp(c)
      applyArm()
    },
    setCover(open) {
      if (cover) cover.rotation.x = -clamp(open) * 1.15
    },
    setPower(on) {
      M.pilot.color.setRGB(1, 0.16, 0.1).multiplyScalar(0.25 + clamp(on) * 3)
      M.lamp.color.setRGB(1, 0.85, 0.63).multiplyScalar(0.15 + clamp(on) * 2.1)
    },
    update(f) {
      const dt = typeof f === 'number' ? f : f.still ? 0 : f.dt
      // quartz direct drive: spins up in ~0.7 s, brakes a little slower
      const k = target > omega ? 5 : 2.4
      omega += (target - omega) * (1 - Math.exp(-k * dt))
      if (Math.abs(target - omega) < 1e-3) omega = target
      angle += omega * dt
      angle %= TAU * 1000
      // records turn clockwise seen from above
      platter.rotation.y = -angle
      // strobe rows: the apparent drift of each row under a 60 Hz lamp
      for (let i = 0; i < 2; i++) {
        const s = TAU / dotsN[i]
        let step = (omega / F) % s
        if (step > s / 2) step -= s
        strobe[i] = (strobe[i] + step * F * dt) % TAU
      }
      // dots are drawn at platter angle + phase; world angle = local − rotation.y
      platterU.uStrobe.value.set(-(strobe[0] - angle), -(strobe[1] - angle))
      if (record) record.setSmear(omega)
    },
    dispose() {
      for (const g of geos) g.dispose()
      for (const m of Object.values(M)) (m as THREE.Material).dispose()
    },
  }
  tt.setPower(1)
  return tt
}

/** Re-export for chapters that build their own crates. */
export { rimAtDims as rimAt, sleeveMaterial, recordMaterial, crateMaterial, shadowMaterial, labelFor }

/** Shorthand: a label spec for catalogue n in a paper. */
function labelFor(n: number, title: string, paper: 'cream' | 'red' | 'stout' = 'cream', side = 'SIDE A'): LabelSpec {
  return { title, cat: catNo(n), paper, side }
}
