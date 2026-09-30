import * as THREE from 'three'
import { diag, trace } from './boottrace'
import Lenis from 'lenis'
import { Post } from './post'
import { Assets } from './assets'
import { World } from '../world/World'
import { clamp, damp } from './math'
import { buildChapterCopy } from './srContent'
import { nextFrame } from './yield'
import { Residency, TEX_CAP } from './residency'
import type { CameraPose, Chapter, ChapterContext, ChapterDef, Frame } from './types'

export interface ChapterSlot {
  def: ChapterDef
  chapter: Chapter
  ctx: ChapterContext
  /** scroll range in viewport heights */
  start: number
  end: number
  section: HTMLElement
  stage: HTMLElement
  failed: boolean
  /** true once the chapter is initialised and its shaders warmed (lazy boot) */
  ready: boolean
}

export interface EngineState {
  index: number
  local: number
  slots: ChapterSlot[]
  /** total scroll length in viewport heights */
  total: number
}

/** Scroll distance (in vh) on each side of a cut where the glitch ramps. */
const CUT_WINDOW = 0.18
/*
 * NAV JUMPS (land() beyond smooth range) are a time-driven pour:
 *   in   — the cover climbs (JUMP_IN s; linear and a little slower when calm)
 *   hold — full cover: swap to the target, and stay covered until JUMP_HOLD s
 *          after the LAST target, so a burst of Tabs / pip clicks reads as ONE
 *          pour in and one out (every new target meanwhile swaps under cover)
 *   out  — the drain (JUMP_OUT s). A near target meanwhile smooth-scrolls
 *          under the lacing; a far one climbs back, never sooner than
 *          ONSET_GAP s after the last climb began (pin: the cover waits)
 * WCAG 2.3.1: a Tab every 0.3–0.6 s used to re-pour 4–5 times a second.
 */
const JUMP_IN = 0.26
const JUMP_IN_CALM = 0.3
const JUMP_OUT = 0.5
const JUMP_HOLD = 0.35
const ONSET_GAP = 0.8
/** land() smooth-scrolls only short steps: forward ≤ 1.5 vh, back ≤ 0.6 vh */
const nearStep = (d: number) => d >= -0.6 && d <= 1.5
/**
 * Scroll cut hold: after a boundary peak the cover holds (no decay) for
 * PEAK_GRACE s, and a scroll reversal within REVERSE_ZONE vh of a boundary
 * soon after a peak (a hesitating trackpad) keeps holding it until 0.5 s
 * pass with no new peak or reversal: the level never bobs with the wiggle.
 */
const PEAK_GRACE = 0.2
const REVERSE_ZONE = 0.6
/** calm (reduced motion / Motion off): the cut is a dark fade, capped, with a damped attack */
const CALM_FADE = 0.85
const CALM_ATTACK = 0.25
/** Render-pixel budget: 4K/5K windows would otherwise push 15+ MP through bloom. */
const PIXEL_BUDGET = 6e6
/**
 * device pixels of three's glass (transmission) buffer on desktop; it only
 * ever shrinks with the frame (Frost's lesson). three r186 makes that target
 * 4x MSAA half-float with mipmaps whatever we ask, so every pixel costs ~52
 * bytes: 0.8 MP is ~0.79 of a 1440x900 DPR-1 frame (~45 MB instead of ~73)
 * and ~0.39 at DPR 2 — thin glass refracting a soft room shows no difference.
 */
const GLASS_BUDGET = 0.8e6

type JumpPhase = 'in' | 'hold' | 'out' | 'pin'
interface Jump {
  id: string
  local: number
  phase: JumpPhase
  /** progress through the current climb / drain, 0..1 */
  p: number
  /** current cover 0..1 */
  cover: number
  /** seconds (performance.now) of the latest target */
  lastTarget: number
}

function emptyChapter(id: string): Chapter {
  return {
    id,
    group: new THREE.Group(),
    init() {},
    update() {},
    camera(_l, _f, out) {
      out.position.set(0, 0, 10)
      out.target.set(0, 0, 0)
    },
  }
}

export class Engine {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000)
  post: Post
  world: World
  assets: Assets
  lenis: Lenis
  slots: ChapterSlot[] = []
  state: EngineState = { index: 0, local: 0, slots: this.slots, total: 1 }
  frame: Frame
  pose: CameraPose = {
    position: new THREE.Vector3(0, 0, 10),
    target: new THREE.Vector3(),
    fov: 45,
    roll: 0,
    parallax: 0,
  }
  /** Listeners run after each frame's chapter update (HUD chrome, sound…). */
  onFrame: ((frame: Frame, state: EngineState) => void)[] = []
  onCut: ((from: number, to: number) => void)[] = []

  /** scroll-track viewport height (keyed on innerHeight so mobile URL bars don't relayout) */
  private vh = window.innerHeight
  private vw = window.innerWidth
  /** drawing size = the canvas's CSS box (100lvh on phones, stable while toolbars slide) */
  private cw = 0
  private ch = 0
  private dpr = 0
  private timer = new THREE.Timer()
  private lastScrollVh = 0
  private running = false
  private mobile: boolean
  private reducedMotion: boolean
  /** adaptive resolution: multiplier on the device pixel ratio, lowered when frames run long */
  private dprScale = 1
  private perfEma = 1 / 60
  private cadence: number[] = []
  private cadenceTick = 0
  private cadenceSorted = new Float32Array(120)
  private baseline = 1 / 60
  private slowFor = 0
  private fastFor = 0
  private perfCooldown = 0
  /** after a step up: the scale we came from, and how long to watch for a relapse */
  private upFrom = 0
  private upWatch = 0
  /** no stepping up past this until `ceilFor` runs out (a step up that relapsed) */
  private dprCeil = 1
  private ceilFor = 0
  /** time-driven cut used for long nav jumps (so we never scrub through five chapters) */
  private jump: Jump | null = null
  /** seconds (performance.now) the last jump climb began */
  private lastOnset = -1e9
  /** GPU texture residency (textures that can reload are freed while far away) */
  private residency: Residency
  /** true while something (e.g. the rotate gate) covers the scene — skip rendering */
  paused = false
  /** every chapter initialised and warmed (screenshot/test tools wait for this) */
  allReady = false
  /**
   * The first chapter is showing (DOM copy live) but its shaders are still
   * warming: tick() runs chapters and copy but skips the GPU draw, so the
   * page stays responsive over main.ts's poster frame.
   */
  holdDraw = false
  /** resolves when the first chapter can draw (always resolved after load() without `early`) */
  bootReady: Promise<void> = Promise.resolve()
  private restStarted = false
  private cutHold = 0
  private cutCss = -1
  private rapidUntil = 0
  private cutOutState = 0
  private cutPeakAt = -1e9
  /** scroll-boundary hold (see PEAK_GRACE): last scroll direction, last reversal near a boundary, hold-until */
  private scrollDir = 0
  private sustainUntil = 0
  /** the calm fade as shown (rate-limited attack) */
  private calmFade = 0
  /**
   * Ambient motion on/off. When off, frame.time holds still once the intro
   * reveal has had time to play (3 s after 'hark:reveal').
   */
  motion = true
  private revealAt = -1
  /** called when the GPU context is gone for good (main.ts shows the fallback) */
  onContextGone: (() => void) | null = null
  private listenerFailed = new WeakSet<object>()
  private suppressFocusLand = false
  private tmpRight = new THREE.Vector3()
  private tmpUp = new THREE.Vector3()
  /**
   * Still-frame idling: with Motion off the picture is frozen, so once the
   * scroll, pointer and cuts have settled (~1.5 s) the engine only redraws at
   * a 2 fps heartbeat; any input wakes it.
   */
  private wakeAt = 0
  private beatAt = 0
  private idleScroll = -1
  private idlePx = 0
  private idlePy = 0
  /** the pose actually shown: time-damped toward the chapter's pose (snaps on cuts/jumps) */
  private shown = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45, init: false, index: -1 }
  /** ?cam=px,py,pz,tx,ty,tz[,fov] — a fixed debug camera for scouting shots */
  private debugCam: number[] | null = (() => {
    const v = new URLSearchParams(location.search).get('cam')
    const n = v ? v.split(',').map(Number) : null
    return n && n.length >= 6 && n.every(Number.isFinite) ? n : null
  })()

  constructor(
    private canvas: HTMLCanvasElement,
    private track: HTMLElement,
    private stages: HTMLElement,
  ) {
    this.mobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768
    // phones (and any device we've had to scale down) drop CSS backdrop-filter
    document.documentElement.classList.toggle('lowfx', this.mobile)
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    })
    // THEME: clear colour, tone mapping and shadows.
    //   NeutralToneMapping suits bright/product scenes, ACES suits dark
    //   cinematic ones, NoToneMapping suits stylised post passes (palette
    //   snaps, ink densities). Shadows cost real GPU time — enable only if
    //   the look needs them (then keep the shadow frustum tight).
    // Glory: a product film (after Resonance), so Khronos PBR Neutral — beer,
    // food photos and the red of the sign stay true instead of bleaching like
    // ACES. Shadows ON for ONE light only (the world's key spot): a glass's
    // contact shadow on the bar sells the product shots.
    this.renderer.setClearColor(0x0a0605, 1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // three's glass (transmission) buffer: half-res on phones; desktop sizing below
    this.renderer.transmissionResolutionScale = this.mobile ? 0.5 : 1
    this.renderer.toneMappingExposure = 1
    this.renderer.info.autoReset = false
    this.renderer.debug.checkShaderErrors = !import.meta.env.PROD

    this.world = new World(this.scene, this.mobile, this.renderer)
    this.scene.add(this.world.object)
    this.assets = new Assets(this.renderer)
    this.residency = new Residency(this.renderer)
    // MSAA only where it pays: 1x desktop screens. Retina is already supersampled,
    // and multisampled half-float ping-pong targets cost ~1 GB of VRAM there.
    const msaa = !this.mobile && (window.devicePixelRatio || 1) < 1.5
    this.post = new Post(this.renderer, this.scene, this.camera, !msaa)
    // phones get the 6-pass bloom from the start (adaptResolution extends it to scaled-down desktops)
    this.post.setLite(this.mobile)

    this.frame = {
      time: 0,
      dt: 0.016,
      progress: 0,
      velocity: 0,
      pointer: new THREE.Vector2(),
      pointerRaw: new THREE.Vector2(),
      width: this.vw,
      height: this.vh,
      mobile: this.mobile,
      reducedMotion: this.reducedMotion,
    }

    this.lenis = new Lenis({
      autoRaf: false,
      lerp: this.reducedMotion ? 1 : 0.09,
      wheelMultiplier: 0.85,
      touchMultiplier: 1.4,
      smoothWheel: !this.reducedMotion,
    })

    this.resize(true)
    window.addEventListener('resize', () => {
      this.wake()
      this.resize()
    })
    for (const ev of ['keydown', 'wheel', 'touchstart', 'pointerdown'] as const) window.addEventListener(ev, () => this.wake(), { passive: true })
    const toNdc = (e: PointerEvent) =>
      this.frame.pointerRaw.set((e.clientX / this.cw) * 2 - 1, -(e.clientY / this.ch) * 2 + 1)
    window.addEventListener('pointermove', toNdc)
    window.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement
      if (t.closest('a, button, input, textarea, select, label')) return
      toNdc(e)
      const slot = this.slots[this.state.index]
      slot?.chapter.onPointerDown?.(this.frame, slot.ctx)
    })

    // A lost context takes every baked texture/PMREM with it; a reload is the
    // only honest recovery.
    let lostTimer = 0
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      // if the GPU never gives the context back, reload once rather than
      // leave an empty sky with floating labels
      lostTimer = window.setTimeout(() => {
        // reload at most once a minute; a repeat loss shows the static copy
        // instead of an empty canvas under a live HUD
        let recent = false
        try {
          const last = Number(sessionStorage.getItem('hark:ctx-reload') || 0)
          recent = Date.now() - last < 60_000
          if (!recent) sessionStorage.setItem('hark:ctx-reload', String(Date.now()))
        } catch {
          /* storage blocked */
        }
        if (!recent) {
          location.reload()
          return
        }
        this.running = false
        try {
          this.lenis?.destroy()
        } catch {
          /* not started */
        }
        this.onContextGone?.()
      }, 3000)
    })
    canvas.addEventListener('webglcontextrestored', () => {
      window.clearTimeout(lostTimer)
      location.reload()
    })

    // Scrolling by wheel/touch after focusing an item stop in the copy layer
    // would leave a stale focus pill on screen — drop that focus.
    const dropCopyFocus = () => {
      const a = document.activeElement as HTMLElement | null
      if (a && a.closest('.sr-copy')) a.blur()
    }
    window.addEventListener('wheel', dropCopyFocus, { passive: true })
    window.addEventListener('touchmove', dropCopyFocus, { passive: true })
    // …and keyboard page scrolling (PageDown/Space/arrows): the pill would keep
    // naming an item that's no longer on screen (Enter would open it)
    const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '])
    window.addEventListener('keydown', e => {
      if (!SCROLL_KEYS.has(e.key) || e.defaultPrevented) return
      const a = document.activeElement as HTMLElement | null
      // Space activates a focused button: leave buttons alone
      if (e.key === ' ' && a?.tagName === 'BUTTON') return
      dropCopyFocus()
    })
  }

  /** Is WebGL2 available at all? */
  static supported() {
    try {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2')
      if (!gl) return false
      // the post chain renders into half-float targets: without a float colour
      // buffer the page would be black, so take the static copy instead
      const ok = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
      // give the probe context back (browsers cap live contexts)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      return ok
    } catch {
      return false
    }
  }

  /**
   * Import and init every chapter. A chapter that throws is replaced with an
   * empty placeholder so one bad scene can never take the whole site down.
   * Inits run one per frame so the loader keeps animating.
   * `only` (debug) inits a single chapter and stubs the rest.
   */
  async load(defs: ChapterDef[], only?: string | null, first?: string | null, opts: { early?: boolean } = {}) {
    let cursor = 0
    for (const def of defs) {
      // the accessible, linear copy of the chapter lives in its scroll section;
      // the stage is the visual layer only
      const section = document.createElement('section')
      section.className = 'chapter'
      section.id = def.id
      section.dataset.chapter = def.id
      const copy = buildChapterCopy(def.id)
      if (copy) {
        section.appendChild(copy)
        const heading = copy.querySelector<HTMLElement>('h1, h2')
        if (heading) {
          heading.id ||= `${def.id}-title`
          section.setAttribute('aria-labelledby', heading.id)
        }
      }
      section.addEventListener('focusin', e => {
        if (this.suppressFocusLand) return
        // items (a project, a service, a quote…) can drive the timeline directly
        const target = e.target as HTMLElement
        const a = target.closest<HTMLElement>('[data-anchor]')
        const slot = this.slots.find(x => x.def.id === def.id)
        const anchor = a && slot?.chapter.anchors?.[Number(a.dataset.anchor)]
        // the section heading is a stop too: it lands on the chapter's intro beat
        if (/^H[12]$/.test(target.tagName) && def.intro != null) this.land(def.id, true, def.intro)
        else if (anchor != null) this.land(def.id, true, anchor)
        else if (this.slots[this.state.index]?.def.id !== def.id) this.land(def.id)
      })
      this.track.appendChild(section)

      const stage = document.createElement('div')
      stage.className = `stage stage-${def.id}`
      stage.dataset.chapter = def.id
      stage.setAttribute('aria-hidden', 'true')
      stage.inert = true
      this.stages.appendChild(stage)

      const ctx: ChapterContext = {
        renderer: this.renderer,
        camera: this.camera,
        world: this.world,
        post: this.post,
        assets: this.assets,
        stage,
        mobile: this.mobile,
        reducedMotion: this.reducedMotion,
        texRes: (px, scale = 1) => Math.max(1, Math.round(Math.min(px, (this.mobile ? TEX_CAP.mobile : TEX_CAP.desktop) * scale))),
      }
      const slot: ChapterSlot = {
        def,
        chapter: emptyChapter(def.id),
        ctx,
        start: cursor,
        end: cursor + def.length,
        section,
        stage,
        failed: false,
        ready: false,
      }
      cursor += def.length
      this.slots.push(slot)
    }
    // one extra viewport so the last chapter can reach local = 1
    const tail = document.createElement('div')
    tail.className = 'track-tail'
    this.track.appendChild(tail)
    this.state.total = cursor
    this.layoutTrack()

    // LAZY BOOT: a cold phone spends ~35 s compiling/warming shaders for all
    // eight rooms (measured in iOS Safari), so only the chapter the visitor
    // lands on is built before the reveal; loadRest() builds the others in the
    // background, nearest first, while they read.
    const firstIdx = Math.max(0, this.slots.findIndex(s => s.def.id === (only ?? first)))
    const boot = only ? this.slots.filter(s => s.def.id === only) : [this.slots[firstIdx]]
    trace(`load: ${boot.map(s => s.def.id).join(', ')} first (${this.slots.length} chapters)`)
    for (const s of this.slots) if (!boot.includes(s)) s.stage.classList.add('is-loading')
    // every boot step is tracked up front, so the loader's bar only reaches 100% at the end
    const step = () => {
      let done!: () => void
      this.assets.track(new Promise<void>(r => (done = r)))
      return done
    }
    const steps = boot.map(() => ({ init: step(), warm: step() }))
    const compileStep = step()
    for (let i = 0; i < boot.length; i++) {
      await this.initSlot(boot[i])
      steps[i].init()
      await nextFrame()
    }
    this.onBootCompiled = compileStep
    const warm = async () => {
      trace('prewarm start')
      await this.prewarm(boot, true, () => steps.forEach(x => x.warm()))
      for (const slot of boot) slot.ready = true
      if (only) this.allReady = true
      this.holdDraw = false
      trace('prewarm done')
    }
    if (opts.early) {
      // reveal now: the first chapter's copy runs over main.ts's poster while
      // its shaders warm (the draw is held until they have)
      this.holdDraw = true
      compileStep()
      steps.forEach(x => x.warm())
      this.bootReady = warm()
      return
    }
    await warm()
  }

  private onBootCompiled: (() => void) | null = null

  /** Build one chapter: import, create, init, add to the scene. Failures become an empty chapter. */
  private async initSlot(slot: ChapterSlot) {
    try {
      const mod = await slot.def.load()
      const chapter = mod.default()
      const t0 = performance.now()
      await Promise.resolve(chapter.init(slot.ctx))
      trace(`init ${slot.def.id} ${Math.round(performance.now() - t0)} ms`)
      chapter.group.visible = false
      this.scene.remove(slot.chapter.group)
      slot.chapter = chapter
    } catch (err) {
      console.error(`[hark] chapter "${slot.def.id}" failed to load`, err)
      slot.failed = true
      slot.chapter = emptyChapter(slot.def.id)
      slot.stage.replaceChildren()
    }
    slot.chapter.group.visible = false
    this.scene.add(slot.chapter.group)
    this.keyboardViaCopyLayer(slot.stage)
  }

  /**
   * After the reveal: build and warm the remaining chapters one at a time,
   * nearest to where the visitor is first, each step waiting for a calm
   * moment (no fast scroll, no jump) so the one-off compile stalls land while
   * they read rather than mid-gesture. A chapter still loading when reached
   * shows the room backdrop and a small spinning record until it's ready.
   */
  async loadRest() {
    if (this.restStarted || this.allReady) return
    this.restStarted = true
    const pending = () => this.slots.filter(s => !s.ready)
    while (pending().length) {
      const here = this.state.index
      const next = pending().sort((a, b) => Math.abs(this.slots.indexOf(a) - here) - Math.abs(this.slots.indexOf(b) - here))[0]
      const urgent = this.slots.indexOf(next) === here
      // wait for a calm moment unless the visitor is already waiting on this chapter
      for (let t = 0; !urgent && t < 90 && (Math.abs(this.frame.velocity) > 0.25 || this.jump); t++) await nextFrame()
      next.stage.classList.add('is-loading')
      await this.initSlot(next)
      await nextFrame()
      await this.prewarm([next], false)
      next.ready = true
      next.stage.classList.remove('is-loading')
      await nextFrame()
    }
    this.allReady = true
    trace('all chapters ready')
  }
  /**
   * Stages are aria-hidden visuals; keyboard and screen-reader users drive the
   * story through the linear copy in #track instead. Keep stage controls out
   * of the tab order (mouse/touch still work), including ones added later.
   */
  private keyboardViaCopyLayer(stage: HTMLElement) {
    const sweep = () =>
      stage
        .querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')
        .forEach(el => {
          if (el.tabIndex !== -1) el.tabIndex = -1
        })
    sweep()
    new MutationObserver(sweep).observe(stage, { childList: true, subtree: true })
  }

  /**
   * Compile shaders against the REAL render target (HDR, linear, no tone
   * mapping) in parallel, then render each chapter at a few points so lazily
   * built materials, geometry and textures upload before the reveal.
   */
  private async prewarm(list: ChapterSlot[], boot: boolean, onCompiled?: () => void) {
    // chapters' sound cues (hark:sfx) are ignored while a warm-up drives them
    document.documentElement.dataset.warming = '1'
    try {
      await this.prewarmInner(list, boot)
    } finally {
      delete document.documentElement.dataset.warming
    }
    onCompiled?.()
  }

  private async prewarmInner(list: ChapterSlot[], boot: boolean) {
    // lit programs key on the environment map: give the scene its real one first
    ;(this.world as unknown as { warmEnv?: () => void }).warmEnv?.()
    const target = this.post.sceneTarget
    // Compile each chapter with ONLY its own group (and lights) visible:
    // three keys programs on the visible light set, so compiling everything at
    // once builds variants no chapter ever uses and the real ones link later,
    // synchronously, on first entry.
    const compiles: Promise<unknown>[] = []
    this.renderer.setRenderTarget(target)
    const wasVisible = this.slots.map(s => s.chapter.group.visible)
    for (const slot of list) {
      const tc = performance.now()
      for (const other of this.slots) other.chapter.group.visible = other === slot
      for (const l of [0.5, 0.04, 0.92]) {
        try {
          slot.chapter.update(l, this.frame, slot.ctx)
          // compile against this chapter's lights only: take the group out of the
          // scene (three gathers lights from both the scene and the object)
          const g = slot.chapter.group
          const probe = new THREE.Group()
          this.scene.remove(g)
          probe.add(g, this.world.object)
          compiles.push(this.renderer.compileAsync(probe, this.camera, this.scene).catch(() => {}))
          this.scene.add(g, this.world.object)
        } catch (err) {
          console.error(`[hark] chapter "${slot.def.id}" failed during compile`, err)
        }
      }
      trace(`compile ${slot.def.id} (sync) ${Math.round(performance.now() - tc)} ms`)
      // put the live view back before yielding: a background warm-up must never
      // leave the visitor's chapter hidden (or the warming one shown) for a frame
      this.slots.forEach((s, i) => (s.chapter.group.visible = boot ? false : wasVisible[i]))
      // program setup is synchronous inside compileAsync: yield per chapter so
      // boot never becomes one long task (the compiles still run in parallel)
      await nextFrame()
      this.renderer.setRenderTarget(target)
    }
    this.slots.forEach((s, i) => (s.chapter.group.visible = boot ? false : wasVisible[i]))
    if (boot) compiles.push(this.post.compileAsync())
    const tw = performance.now()
    await Promise.all(compiles)
    trace(`compiles settled ${Math.round(performance.now() - tw)} ms`)
    if (boot) this.onBootCompiled?.()
    await nextFrame()

    if (boot) {
      // the composer's own passes — with a cut on screen, so the colour-field
      // pass and the final pass's field branch link now, not on the first cut
      this.post.transition = 0.5
      this.post.render(0.016, 0)
      this.post.transition = 0
      this.post.render(0.016, 0)
      await nextFrame()
    }

    // Render each chapter at a few points so geometry/textures upload and the
    // GPU builds pipelines for the real attachment format (incl. MSAA).
    const rt = new THREE.WebGLRenderTarget(64, 64, {
      type: THREE.HalfFloatType,
      samples: target.samples,
    })
    const before = diag ? new Set((this.renderer.info.programs ?? []).map(p => p.cacheKey)) : null
    // the active chapter (if any) must not be drawn into the warm-up target
    const live = this.slots.filter(s => s.chapter.group.visible)
    for (const s of live) s.chapter.group.visible = false
    for (const slot of list) {
      const tr = performance.now()
      try {
        slot.chapter.group.visible = true
        // first a few objects at a time across frames (WebKit builds a GPU
        // pipeline per program on its first draw — seconds for a whole room —
        // so this keeps the page responsive), then whole-frame passes
        await this.warmChunks(slot, rt, live)
        slot.chapter.group.visible = true
        for (const s of live) s.chapter.group.visible = false
        for (const l of [0.04, 0.92, 0.5]) {
          slot.chapter.update(l, this.frame, slot.ctx)
          slot.chapter.camera(l, this.frame, this.pose)
          this.applyCamera(0)
          // let the world take this chapter's state too (world-owned objects
          // that only show in some chapters compile here, not on first entry).
          // Not after the reveal: the world damps toward its params, so a
          // background warm-up would tug the visitor's lighting.
          if (boot) this.world.update(this.frame, this.camera)
          this.renderer.setRenderTarget(rt)
          this.renderer.render(this.scene, this.camera)
        }
      } catch (err) {
        console.error(`[hark] chapter "${slot.def.id}" failed during prewarm`, err)
      } finally {
        slot.chapter.group.visible = false
      }
      trace(`warm render ${slot.def.id} ${Math.round(performance.now() - tr)} ms`)
      // restore the live view before yielding (see the compile loop)
      this.renderer.setRenderTarget(null)
      for (const s of live) s.chapter.group.visible = true
      await nextFrame()
      for (const s of live) s.chapter.group.visible = false
    }
    this.renderer.setRenderTarget(null)
    rt.dispose()
    for (const s of live) s.chapter.group.visible = true
    if (before) {
      const fresh = (this.renderer.info.programs ?? []).filter(p => !before.has(p.cacheKey))
      trace(`warm-only programs: ${fresh.length} (of ${this.renderer.info.programs?.length})`)
      for (const p of fresh) console.info('[warm-only]', p.name || '-', p.cacheKey.slice(0, 300))
    }
  }

  /**
   * Draw a chapter's objects into the warm-up target a handful at a time,
   * yielding a frame between batches (with the live view restored), so the
   * one-off pipeline builds never freeze the page for seconds. Every object
   * is drawn regardless of the camera (frustum culling off for the batch),
   * with every light on so the program variants match the real frames.
   */
  private async warmChunks(slot: ChapterSlot, rt: THREE.WebGLRenderTarget, live: ChapterSlot[]) {
    const L = 31
    const objs: THREE.Object3D[] = []
    slot.chapter.update(0.5, this.frame, slot.ctx)
    slot.chapter.camera(0.5, this.frame, this.pose)
    this.applyCamera(0)
    slot.chapter.group.traverse(o => {
      const r = o as THREE.Mesh
      if ((r.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) && !o.layers.isEnabled(L)) objs.push(o)
    })
    const lights: THREE.Object3D[] = []
    this.scene.traverse(o => {
      if ((o as THREE.Light).isLight && !o.layers.isEnabled(L)) lights.push(o)
    })
    const size = this.mobile ? 4 : 12
    const mask = this.camera.layers.mask
    for (const l of lights) l.layers.enable(L)
    try {
      for (let i = 0; i < objs.length; i += size) {
        const batch = objs.slice(i, i + size)
        const culled = batch.map(o => o.frustumCulled)
        for (const o of batch) {
          o.layers.enable(L)
          o.frustumCulled = false
        }
        try {
          this.camera.layers.set(L)
          this.renderer.setRenderTarget(rt)
          this.renderer.render(this.scene, this.camera)
        } catch {
          /* a bad object only loses its warm-up */
        } finally {
          this.camera.layers.mask = mask
          batch.forEach((o, k) => {
            o.layers.disable(L)
            o.frustumCulled = culled[k]
          })
        }
        // yield with the live view restored
        this.renderer.setRenderTarget(null)
        slot.chapter.group.visible = false
        for (const s of live) s.chapter.group.visible = true
        await nextFrame()
        for (const s of live) s.chapter.group.visible = false
        slot.chapter.group.visible = true
        slot.chapter.camera(0.5, this.frame, this.pose)
        this.applyCamera(0)
      }
    } finally {
      this.camera.layers.mask = mask
      for (const l of lights) l.layers.disable(L)
    }
  }

  private layoutTrack() {
    for (const slot of this.slots) {
      slot.section.style.height = `${slot.def.length * this.vh}px`
      // the chapter's accessible copy sits inside its settled range, so a
      // screen-reader cursor or Find in page scrolls the story to this chapter
      const copy = slot.section.querySelector<HTMLElement>('.sr-copy')
      if (copy) {
        const at = slot.def.intro ?? slot.def.landing ?? 0.1
        const top = Math.max(0, Math.min(at * slot.def.length + 1, slot.def.length - 1.2))
        copy.style.top = `${top * this.vh}px`
      }
    }
    const tail = this.track.querySelector<HTMLElement>('.track-tail')
    if (tail) tail.style.height = `${this.vh}px`
  }

  private resize(force = false) {
    const iw = window.innerWidth
    const ih = window.innerHeight
    // mobile URL bars change innerHeight constantly; only relayout the scroll
    // track on real changes so the page doesn't jump
    if (force || iw !== this.vw || Math.abs(ih - this.vh) > this.vh * 0.25) {
      // keep the visitor at the same point of the story across a relayout
      const progress = this.lenis && this.state.total > 0 ? this.lenis.scroll / (this.state.total * this.vh) : 0
      this.vw = iw
      this.vh = ih
      this.layoutTrack()
      this.lenis?.resize()
      if (!force && this.lenis && progress > 0) {
        this.lenis.scrollTo(progress * this.state.total * this.vh, { immediate: true, force: true })
      }
    }

    const w = this.canvas.clientWidth || iw
    const h = this.canvas.clientHeight || ih
    const base = Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2)
    const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h))
    const dpr = Math.max(this.mobile ? 1 : 0.75, Math.min(base, budget) * this.dprScale)
    if (!force && w === this.cw && h === this.ch && Math.abs(dpr - this.dpr) < 1e-3) return
    this.cw = w
    this.ch = h
    this.dpr = dpr
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.post.setSize(w, h, dpr)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.frame.width = w
    this.frame.height = h
  }

  /** Where a nav jump should land inside a chapter: just past its cut, on settled copy. */
  landingFor(id: string) {
    const slot = this.slots.find(s => s.def.id === id)
    if (!slot) return 0
    return slot.def.landing ?? Math.min(0.2, Math.max(0.06, 0.34 / slot.def.length))
  }

  /**
   * Navigate to a chapter the way a visitor should see it. Neighbours scroll
   * smoothly; longer jumps cut (pour in, jump, drain) instead of scrubbing
   * through every chapter in between. See JUMP_IN for the jump's phases.
   */
  land(id: string, smooth = true, at?: number) {
    const target = this.slots.findIndex(s => s.def.id === id)
    if (target < 0) return
    const local = at ?? this.landingFor(id)
    if (!smooth) return this.gotoChapter(id, local)
    const dest = this.slots[target].start + clamp(local) * this.slots[target].def.length
    const calm = this.reducedMotion || !this.motion
    const now = performance.now() / 1000
    // a jump already in flight (a burst of Tabs / pip / nav clicks): fold the
    // new target into it, so the burst reads as ONE pour in and one out
    const j = this.jump
    if (j) {
      const prev = this.jumpDest(j)
      j.id = id
      j.local = local
      j.lastTarget = now
      if (j.phase === 'hold') {
        // fully covered: go straight there (the hold restarts from now)
        this.scrollToVh(dest)
      } else if (j.phase === 'out') {
        if (nearStep(dest - prev)) {
          // close to what the drain is revealing: move there under the lacing
          this.scrollToVh(dest, !calm)
        } else if (now - this.lastOnset >= ONSET_GAP) {
          // far: climb back from the current cover…
          j.phase = 'in'
          j.p = calm ? j.cover : Math.sqrt(j.cover)
          this.lastOnset = now
        } else {
          // …but never two climbs within ONSET_GAP: the cover waits where it is
          j.phase = 'pin'
        }
      }
      // 'in' / 'pin': still covering — the swap goes to the new target
      return
    }
    // Smooth scroll only for a short step: forward up to 1.5 vh (the next
    // chapter's landing), back up to 0.6 vh (Shift+Tab through items). Anything
    // else cuts: a long smooth scroll pans the camera past lit items (a flash),
    // and backwards, time-paced chapters (StoryClock) would replay every item
    // in reverse before the target shows. Measured from where the scroll is
    // HEADING, so a Tab chain of short steps stays a chain of short steps.
    const d = dest - this.lenis.targetScroll / this.vh
    if (Math.abs(d) < 0.01) return
    if (calm && target === this.state.index) {
      // calm, within the chapter (Tab through its items): a plain cut with the
      // copy cross-faded — no fade through dark per stop (that doubled every
      // change into a dip and a rise)
      this.scrollToVh(dest)
      this.softenStage()
      return
    }
    if (!calm && nearStep(d)) return this.scrollToVh(dest, true)
    this.jump = { id, local, phase: 'in', p: 0, cover: 0, lastTarget: now }
    this.lastOnset = now
  }

  /** the scroll position (vh) a jump lands on */
  private jumpDest(j: Jump) {
    const slot = this.slots.find(s => s.def.id === j.id)
    return slot ? slot.start + clamp(j.local) * slot.def.length : this.lenis.scroll / this.vh
  }

  /** scroll to a track position in vh (+1 px so the chapter owning it is unambiguous) */
  private scrollToVh(vh: number, smooth = false) {
    this.lenis.scrollTo(vh * this.vh + 1, smooth ? { duration: 1.8, force: true } : { immediate: true, force: true })
  }

  /** calm in-chapter cut: the stage copy fades back in over 0.15 s instead of popping */
  private softenStage() {
    try {
      this.stages.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
    } catch {
      /* no WAAPI */
    }
  }

  /**
   * Move keyboard focus to a chapter's heading in the copy layer (after an
   * in-page jump) without re-triggering the focus→land behaviour.
   */
  focusChapter(id: string) {
    const slot = this.slots.find(s => s.def.id === id)
    const heading = slot?.section.querySelector<HTMLElement>('h1, h2')
    if (!heading) return
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
    this.suppressFocusLand = true
    heading.focus({ preventScroll: true })
    this.suppressFocusLand = false
  }

  /** Jump to global progress 0..1 (no smoothing). */
  goto(p: number) {
    this.jump = null
    const y = clamp(p) * this.state.total * this.vh
    this.lenis.scrollTo(y, { immediate: true, force: true })
  }

  /** Jump into a chapter at an exact local progress 0..1. */
  gotoChapter(id: string, local = 0, smooth = false) {
    const slot = this.slots.find(s => s.def.id === id)
    if (!slot) return
    if (!smooth) this.jump = null
    const y = (slot.start + clamp(local) * slot.def.length) * this.vh + 1
    this.lenis.scrollTo(y, smooth ? { duration: 1.8, force: true } : { immediate: true, force: true })
  }

  private startedAt = 0

  start() {
    if (this.running) return
    this.running = true
    this.startedAt = performance.now()
    let reported = false
    const loop = (ms: number) => {
      if (!this.running) return
      // re-arm first: one bad frame must never stop scrolling or rendering
      requestAnimationFrame(loop)
      this.timer.update(ms)
      this.lenis.raf(ms)
      if (this.paused) return
      if (this.idle(ms)) return
      try {
        this.tick()
      } catch (err) {
        if (!reported) console.error('[hark] frame failed', err)
        reported = true
      }
    }
    requestAnimationFrame(loop)
  }

  /** true when this frame can be skipped: Motion off, nothing moving, not a heartbeat */
  private idle(now: number) {
    const frozen = !this.motion && this.revealAt >= 0 && performance.now() - this.revealAt > 3000
    const s = this.lenis.scroll
    const p = this.frame.pointerRaw
    const busy = !!this.slots[this.state.index]?.chapter.busy?.()
    if (!frozen || busy || this.jump || s !== this.idleScroll || p.x !== this.idlePx || p.y !== this.idlePy || this.cutCss > 0) {
      this.idleScroll = s
      this.idlePx = p.x
      this.idlePy = p.y
      this.wakeAt = now
      return false
    }
    if (now - this.wakeAt < 1500) return false
    if (now - this.beatAt >= 500) {
      this.beatAt = now
      return false
    }
    return true
  }

  /** wake the idle heartbeat (keys, touches, resizes) */
  wake() {
    this.wakeAt = performance.now()
  }

  /**
   * Keep the frame rate up on weaker GPUs: drop the render resolution in
   * steps while frames run long relative to the display's own cadence (so a
   * 30 fps Low Power Mode cap is not mistaken for a slow GPU), and creep back
   * up once there's headroom.
   */
  private adaptResolution(raw: number, dt: number) {
    // wall clock, not frame.time: with Motion off frame.time freezes (~3 s) and
    // adaptive resolution would never engage for reduced-motion visitors
    if (document.hidden || performance.now() - this.startedAt < 4000 || this.jump) return
    this.cadence.push(raw)
    if (this.cadence.length > 120) this.cadence.shift()
    if (this.cadence.length >= 60 && ++this.cadenceTick % 20 === 0) {
      const sorted = this.cadenceSorted.subarray(0, this.cadence.length)
      sorted.set(this.cadence)
      sorted.sort()
      // the display's own interval — but never learn a GPU-bound rate as "the
      // display": anything slower than ~45 fps is treated as a slow frame
      this.baseline = Math.min(1 / 45, Math.max(1 / 144, sorted[Math.floor(sorted.length * 0.1)]))
    }
    this.perfEma += (raw - this.perfEma) * 0.05
    this.perfCooldown -= dt
    this.ceilFor -= dt
    if (this.ceilFor <= 0) this.dprCeil = 1
    // a step up that pushes frames past the cadence again is reverted at once
    // and capped for a minute (otherwise it can settle between the thresholds)
    if (this.upWatch > 0) {
      this.upWatch -= dt
      if (this.upWatch < 2.5 && this.perfEma > this.baseline * 1.12) {
        this.dprCeil = this.upFrom
        this.ceilFor = 60
        this.dprScale = this.upFrom
        this.upWatch = 0
        this.perfCooldown = 6
        this.resize()
        return
      }
    }
    const slow = this.perfEma > Math.min(1 / 45, Math.max(this.baseline * 1.25, 1 / 58))
    const fast = this.perfEma < Math.min(this.baseline * 1.1, 1 / 55)
    this.slowFor = slow ? this.slowFor + dt : 0
    this.fastFor = fast ? this.fastFor + dt : 0
    if (this.slowFor > 1.5 && this.dprScale > 0.5) {
      this.dprScale = Math.max(0.5, this.dprScale - 0.15)
      this.slowFor = 0
      this.upWatch = 0
      this.perfCooldown = 6
      this.resize()
    } else if (this.fastFor > 8 && this.dprScale < Math.min(1, this.dprCeil) && this.perfCooldown <= 0) {
      this.upFrom = this.dprScale
      this.dprScale = Math.min(1, this.dprCeil, this.dprScale + 0.1)
      this.fastFor = 0
      this.upWatch = 3
      this.perfEma = this.baseline
      this.resize()
    }
    const low = this.mobile || this.dprScale < 0.99
    document.documentElement.classList.toggle('lowfx', low)
    this.post.setLite(low)
  }

  private applyCamera(parallax: number) {
    const cam = this.camera
    const pose = this.pose
    cam.position.copy(pose.position)
    cam.up.set(0, 1, 0)
    cam.lookAt(pose.target)
    if (parallax) {
      this.tmpRight.setFromMatrixColumn(cam.matrixWorld, 0)
      this.tmpUp.setFromMatrixColumn(cam.matrixWorld, 1)
      cam.position
        .addScaledVector(this.tmpRight, this.frame.pointer.x * parallax)
        .addScaledVector(this.tmpUp, this.frame.pointer.y * parallax * 0.6)
      cam.lookAt(pose.target)
    }
    if (pose.roll) cam.rotateZ(pose.roll)
    if (cam.fov !== pose.fov) {
      cam.fov = pose.fov
      cam.updateProjectionMatrix()
    }
  }

  /** 0..1 cover of a time-driven jump cut in progress (long nav jumps; see JUMP_IN). */
  private jumpStep(dt: number) {
    const j = this.jump
    if (!j) return 0
    const calm = this.reducedMotion || !this.motion
    const now = performance.now() / 1000
    if (j.phase === 'pin') {
      if (now - this.lastOnset < ONSET_GAP) return j.cover
      j.phase = 'in'
      j.p = calm ? j.cover : Math.sqrt(j.cover)
      this.lastOnset = now
    }
    if (j.phase === 'in') {
      // calm climbs linearly (the dark fade's attack is rate-limited anyway)
      j.p = Math.min(1, j.p + dt / (calm ? JUMP_IN_CALM : JUMP_IN))
      j.cover = calm ? j.p : j.p * j.p
      if (j.p < 1) return j.cover
      // full cover: swap to the (latest) target
      j.phase = 'hold'
      this.scrollToVh(this.jumpDest(j))
    }
    if (j.phase === 'hold') {
      j.cover = 1
      if (now - j.lastTarget < JUMP_HOLD) return 1
      j.phase = 'out'
      j.p = 0
      return 1
    }
    // out: the drain
    j.p = Math.min(1, j.p + dt / JUMP_OUT)
    j.cover = 1 - j.p * j.p * (3 - 2 * j.p)
    if (j.p >= 1) this.jump = null
    return j.cover
  }

  private tick() {
    const f = this.frame
    const raw = Math.max(this.timer.getDelta(), 0)
    f.dt = Math.min(raw, 1 / 20)
    if (this.revealAt < 0 && document.documentElement.dataset.ready === '1') this.revealAt = performance.now()
    const idle = this.motion || this.revealAt < 0 || performance.now() - this.revealAt < 3000
    if (idle) f.time += f.dt
    f.still = !idle
    this.adaptResolution(Math.min(raw, 0.1), f.dt)
    f.pointer.x = damp(f.pointer.x, f.pointerRaw.x, 3.5, f.dt)
    f.pointer.y = damp(f.pointer.y, f.pointerRaw.y, 3.5, f.dt)

    const fx = this.jumpStep(f.dt)

    const scrollVh = this.lenis.scroll / this.vh
    const dScroll = scrollVh - this.lastScrollVh
    const vel = dScroll / Math.max(f.dt, 1e-3)
    this.lastScrollVh = scrollVh
    // a nav jump teleports the scroll; don't let it register as warp speed
    f.velocity = this.jump ? damp(f.velocity, 0, 8, f.dt) : damp(f.velocity, vel, 8, f.dt)
    f.progress = clamp(scrollVh / this.state.total)

    // which chapter owns this scroll position?
    let index = this.slots.length - 1
    for (let i = 0; i < this.slots.length; i++) {
      if (scrollVh < this.slots[i].end) {
        index = i
        break
      }
    }
    const slot = this.slots[index]
    if (!slot) return
    const local = clamp((scrollVh - slot.start) / slot.def.length)
    // one site-wide glass buffer from a device-pixel budget (GLASS_BUDGET);
    // never resized per chapter, and only shrinks with adaptive DPR
    const ts = this.mobile ? 0.5 : clamp(Math.sqrt(GLASS_BUDGET / Math.max(1, this.cw * this.ch * this.dpr * this.dpr)), 0.35, 1)
    if (this.renderer.transmissionResolutionScale !== ts) this.renderer.transmissionResolutionScale = ts

    // the pour rises approaching any internal boundary and drains after it
    let d = Infinity
    for (let i = 1; i < this.slots.length; i++) d = Math.min(d, Math.abs(scrollVh - this.slots[i].start))
    const tr = clamp(1 - d / CUT_WINDOW)
    const edge = tr * tr * (3 - 2 * tr)
    // cut budget (WCAG 2.3.1): while boundaries come fast (a quick scroll or
    // a cut peaked < 0.5 s ago) hold the transition so they merge into one
    // continuous sheet instead of a train of full-frame dips
    const now = performance.now()
    if (edge > 0.9) {
      this.cutPeakAt = now
      if (now < this.sustainUntil) this.sustainUntil = now + 500
    }
    // a scroll reversal close to a boundary soon after its peak (a hesitating
    // trackpad rocking over the cut): hold the cover instead of letting it
    // decay and re-rise with every rock (the level bobbed 3–5 times a second)
    if (!this.jump && Math.abs(dScroll) > 0.002 && Math.abs(dScroll) < 0.5) {
      const dir = Math.sign(dScroll)
      if (this.scrollDir && dir !== this.scrollDir && d < REVERSE_ZONE && now - this.cutPeakAt < 900) this.sustainUntil = now + 500
      this.scrollDir = dir
    }
    const holding = now - this.cutPeakAt < PEAK_GRACE * 1000 || now < this.sustainUntil
    this.cutHold = holding ? Math.max(this.cutHold, edge) : Math.max(this.cutHold * Math.exp(-f.dt / 0.45), edge)
    // "rapid" latches for 400 ms (a reduced-motion wheel moves the scroll in
    // single-frame steps, so velocity flickers across the threshold), and the
    // cut never drops to zero in one frame: it can only fall at a 0.2 s rate
    if (holding || now - this.cutPeakAt < 500 || Math.abs(f.velocity) > 3) this.rapidUntil = now + 400
    const rapid = now < this.rapidUntil
    const edgeTarget = rapid ? Math.max(edge, this.cutHold) : edge
    this.cutOutState = Math.max(edgeTarget, this.cutOutState * Math.exp(-f.dt / 0.2))
    // a nav jump's own cover (time-driven: it holds and drains by itself)
    const cutOut = Math.max(this.cutOutState, fx)
    // the chapter's DOM copy fades while the cut covers the frame; CSS reads --cut
    const cutCss = Math.round(cutOut * 50) / 50
    if (cutCss !== this.cutCss) {
      this.cutCss = cutCss
      this.stages.style.setProperty('--cut', String(cutCss))
    }
    const calm = this.reducedMotion || !this.motion
    this.post.calm = calm
    // the speed dim follows the scroll (post.ts)
    this.post.velocity = this.jump ? 0 : f.velocity
    // which side of the nearest boundary we're on (+1 leaving a chapter, -1 entering one)
    this.post.cutSide = local > 0.5 ? 1 : -1
    if (calm) {
      // no pour: a calm fade through the dark of the room (never toward a
      // light colour — over a dark scene that was a full-frame flash), capped,
      // and its attack rate-limited so a wheel notch can't slam it shut
      this.post.transition = 0
      const target = cutOut * CALM_FADE
      this.calmFade = target > this.calmFade ? Math.min(target, this.calmFade + (CALM_FADE / CALM_ATTACK) * f.dt) : target
      this.post.fade = this.calmFade
    } else {
      this.post.transition = cutOut
      this.post.fade = 0
      this.calmFade = 0
    }

    if (index !== this.state.index || !slot.chapter.group.visible) {
      const prev = this.slots[this.state.index]
      if (prev && prev !== slot) {
        prev.chapter.group.visible = false
        prev.stage.classList.remove('is-active')
        prev.stage.inert = true
        prev.chapter.onLeave?.(prev.ctx)
      }
      slot.chapter.group.visible = true
      slot.stage.classList.add('is-active')
      slot.stage.inert = false
      slot.chapter.onEnter?.(slot.ctx)
      const from = this.state.index
      this.state.index = index
      // scrolled into another chapter by keyboard/scrollbar while a copy-layer
      // stop of a different chapter still has focus: move focus along (no pill
      // left over the wrong scene, and the next Tab continues from here)
      const ae = document.activeElement as HTMLElement | null
      const sec = ae?.closest<HTMLElement>('.chapter')
      if (!this.jump && ae && ae.closest('.sr-copy') && sec && sec.dataset.chapter !== slot.def.id) this.focusChapter(slot.def.id)
      document.documentElement.dataset.chapter = slot.def.id
      if (from !== index) {
        const url = index === 0 ? location.pathname + location.search : `#${slot.def.id}`
        try {
          history.replaceState(null, '', url)
        } catch {
          /* sandboxed */
        }
        for (const fn of this.onCut) fn(from, index)
      }
    }
    this.state.local = local

    this.post.resetParams()
    this.world.resetParams()
    this.pose.parallax = 0
    this.pose.roll = 0
    try {
      slot.chapter.update(local, f, slot.ctx)
      slot.chapter.camera(local, f, this.pose)
    } catch (err) {
      if (!slot.failed) console.error(`[hark] chapter "${slot.def.id}" crashed in update`, err)
      slot.failed = true
    }
    // film-smooth camera: damp the pose ~0.1 s so a fast scroll can't swing a
    // hard key light or a lit window across the frame several times a second;
    // snap on a new chapter, a nav jump, or a big teleport (screenshots / goto)
    {
      const sh = this.shown
      const far = sh.init && sh.position.distanceTo(this.pose.position) > 40
      if (!sh.init || sh.index !== index || this.jump || far || this.reducedMotion) {
        sh.position.copy(this.pose.position)
        sh.target.copy(this.pose.target)
        sh.fov = this.pose.fov
        sh.init = true
        sh.index = index
      } else {
        const k = 1 - Math.exp(-10 * f.dt)
        sh.position.lerp(this.pose.position, k)
        sh.target.lerp(this.pose.target, k)
        sh.fov += (this.pose.fov - sh.fov) * k
      }
      this.pose.position.copy(sh.position)
      this.pose.target.copy(sh.target)
      this.pose.fov = sh.fov
    }
    if (this.debugCam) {
      const c = this.debugCam
      this.pose.position.set(c[0], c[1], c[2])
      this.pose.target.set(c[3], c[4], c[5])
      if (c[6]) this.pose.fov = c[6]
      this.pose.parallax = 0
      this.pose.roll = 0
    }
    if (this.reducedMotion || !this.motion) {
      this.post.params.flash = Math.min(this.post.params.flash, 0.08)
      this.post.params.glitch = 0
    }
    this.applyCamera(this.reducedMotion || !this.motion ? 0 : this.pose.parallax)
    this.world.update(f, this.camera)

    for (const fn of this.onFrame) {
      try {
        fn(f, this.state)
      } catch (err) {
        if (!this.listenerFailed.has(fn)) console.error('[hark] frame listener failed', err)
        this.listenerFailed.add(fn)
      }
    }
    // free / rebuild reloadable textures by distance from the chapter on screen
    // (after the reveal: prewarm has uploaded everything once by then)
    if (this.revealAt >= 0) {
      const target = this.jump ? this.slots.findIndex(s => s.def.id === this.jump!.id) : -1
      this.residency.update(
        () => this.slots.map(s => s.chapter.group),
        this.world.object,
        index,
        target,
      )
    }
    this.renderer.info.reset()
    if (!this.holdDraw) this.post.render(f.dt, f.time)
  }
}
