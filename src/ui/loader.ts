import * as THREE from 'three'
import { holdInert, releaseInert } from './inert'
import { BRAND } from '../content'
import { MONO_ADVANCE, MONO_FONT, MONO_PATHS, MONO_TILE } from './mark'
import { calmUi } from './prefs'

/*
 * The boot screen — GREG JONES PROJECT: TUNING UP. Before the first song, a
 * CLIP-ON TUNER in the dark of the corner stage: a black housing, a warm
 * backlit screen with a cents scale, the needle, and the note it is
 * listening for — D, the low string of DADGBD. As the site
 * loads the needle comes up from flat toward the centre (hunting a little,
 * as a string does while the peg turns; never under reduced motion / Motion
 * off), the ♭ lamp fades as it gets close, and the room warms: a pool of
 * lamplight under the tuner, festoon bulbs far overhead, out of focus. When
 * the load lands the needle settles dead centre and the screen glows IN
 * TUNE (warm amber — no green here): "Tuning up · 100%" in Spline Sans Mono.
 * The tuner's housing carries the GJP monogram (the headstock's, as real
 * outlines from mark.ts). All DOM + inline SVG; no canvas, no fonts to wait
 * for (the D is an outline too).
 *
 * Exit: the MATCH-CUT onto the hero's headstock. The loader's monogram
 * badge is drawn in the headstock decal's own 512x256 frame (mark.ts
 * MONO_TILE: the kit's monogram tile), so it can land on the decal exactly.
 * Where the decal sits on the hero's landing frame comes from:
 *   1. the live scene, when it can be found: the hero chapter's headstock
 *      decal (the kit guitar's 'headstock' group → its 2:1 plane), projected
 *      through the engine's camera — centre, reading direction and both
 *      scales (a tilted headstock foreshortens: the badge follows with a
 *      rotation and a small skew);
 *   2. else the hero's published contract, on <html>, in CSS px:
 *        --hark-mark-x / --hark-mark-y   the decal's centre,
 *        --hark-mark-size                the lettering's on-screen length
 *                                        (canvas measureText('GJP') at the
 *                                        tile's 150px: MONO_ADVANCE),
 *        --hark-mark-font (optional)     the font size's on-screen length
 *                                        across it (MONO_FONT),
 *        --hark-mark-angle (optional)    the reading direction, degrees
 *                                        clockwise (0 = level).
 * The badge glides onto the decal while the tuner dissolves around it and
 * the dark lifts late in the glide; then finish() resolves ('hark:reveal')
 * and the badge lets go over the headstock's own monogram as the stage
 * comes up — a crossfade: the loader lingers for that last fade,
 * click-through and hidden from assistive tech, then removes itself.
 * Without a target (or when the story opens anywhere but the hero's landing
 * frame), or under reduced motion / Motion off, it's a clean fade: the
 * tuner goes first, then the dark. Every change is a single monotone fade
 * or glide: no strike, no dip, no flicker.
 *
 * The tuning never outruns time: it takes at least MIN_MS even on a warm
 * cache, so the needle always visibly comes up to pitch.
 *
 * API used by main.ts: createLoader(root, { skip }) → { progress(0..1), finish() }.
 * Rules: shows at least ~1.2s, never hangs (finish() always resolves; every
 * wait is a bounded timer, never a rAF), the page behind — the skip link
 * too — is inert while it's up, skip removes it at once (?nointro).
 */
const MIN_MS = 1200
/** the needle eases toward its target on this ticker (a timer: it runs in hidden tabs too) */
const TICK_MS = 33
/** longest we wait for the needle to come up after the load lands */
const FILL_MAX_MS = 420
/** in tune: a beat on the lit screen before the exit */
const HOLD_MS = 320
/** the match-cut: the badge's glide onto the headstock's monogram, then its let-go */
const FLIGHT_MS = 760
const LETGO_MS = 700
/** no match-cut: the tuner goes first, then the dark */
const TILE_OUT_MS = 280
const FADE_MS = 400

/** how flat the string starts (cents = degrees on the scale) */
const START_FLAT = 46
/** the scale's pivot (below the screen: only the needle's tip half shows) */
const PX = 120
const PY = 158

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)))
const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** WAAPI when it's there (it ignores the reduced-motion CSS that zeroes transitions; a fade is not motion) */
function play(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  if (!el) return
  try {
    el.animate(frames, { fill: 'forwards', ...opts })
  } catch {
    const last = frames[frames.length - 1]
    if (el instanceof HTMLElement || el instanceof SVGElement)
      for (const [k, v] of Object.entries(last)) if (k !== 'offset' && k !== 'easing') el.style.setProperty(k, String(v))
  }
}

/** the D on the screen: Fraunces (opsz 144, wght 600, SOFT 60) as an outline, baseline at 0, cap height 28 */
const NOTE_D =
  'M1.24 -0.86Q1.24 -1.53 1.93 -1.79L3.22 -2.06Q3.69 -2.22 3.88 -2.48Q4.07 -2.73 4.07 -3.19V-24.79Q4.07 -25.27 3.88 -25.52Q3.68 -25.78 3.22 -25.94L1.92 -26.21Q1.24 -26.48 1.24 -27.15Q1.24 -27.56 1.5 -27.78Q1.75 -28 2.22 -28H11.87Q15.39 -28 18.29 -26.92Q21.19 -25.85 23.28 -23.85Q25.37 -21.85 26.5 -19.07Q27.63 -16.3 27.63 -12.9Q27.63 -9.07 25.94 -6.16Q24.25 -3.26 21.13 -1.63Q18.01 0 13.68 0H2.22Q1.74 0 1.49 -0.22Q1.24 -0.45 1.24 -0.86ZM13.42 -1.76Q15.93 -1.76 17.82 -3.04Q19.7 -4.32 20.75 -6.88Q21.8 -9.44 21.8 -13.25Q21.8 -16.23 21.09 -18.62Q20.38 -21.02 19.04 -22.73Q17.7 -24.43 15.82 -25.33Q13.95 -26.24 11.61 -26.24H9.68V-3.5Q9.68 -2.61 10.1 -2.19Q10.52 -1.76 11.33 -1.76Z'

/** the cents scale: a tick every 5 cents from −50 to +50 (1 cent = 1°), longer every 10 */
function scaleTicks() {
  let d = ''
  for (let c = -50; c <= 50; c += 5) {
    if (c === 0) continue
    const a = (c * Math.PI) / 180
    const major = c % 10 === 0
    const r0 = Math.abs(c) === 50 ? 86 : major ? 90 : 94
    const r1 = 99
    const s = Math.sin(a)
    const k = Math.cos(a)
    d += `M${f2(PX + r0 * s)} ${f2(PY - r0 * k)}L${f2(PX + r1 * s)} ${f2(PY - r1 * k)}`
  }
  return d
}

/** the housing, the screen and everything on it (viewBox 0 0 240 212) */
function tunerSvg() {
  // a hand-drawn flat and sharp for the screen's two lamps
  const flat = `M60 104v15M60 119c4.6-1.6 6.6-4.1 6.6-6.3 0-2.1-1.6-3.2-3.5-3.2-1.5 0-2.4.5-3.1 1.3`
  const sharp = `M177.6 103.4v16.4M182.4 102.4v16.4M174.2 109.8l11.6-2.9M174.2 115.4l11.6-2.9`
  return `<svg class="ld-body" viewBox="0 0 240 212" focusable="false">
    <defs>
      <linearGradient id="ld-shell" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2f2824"/><stop offset="0.42" stop-color="#191412"/><stop offset="1" stop-color="#0d0a09"/>
      </linearGradient>
      <radialGradient id="ld-shine" cx="0.5" cy="0" r="0.75">
        <stop offset="0" stop-color="#fff2de" stop-opacity="0.13"/><stop offset="1" stop-color="#fff2de" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="ld-glass" cx="0.5" cy="0.95" r="0.95">
        <stop offset="0" stop-color="#3b220e"/><stop offset="0.5" stop-color="#1d1108"/><stop offset="1" stop-color="#0c0704"/>
      </radialGradient>
      <radialGradient id="ld-lamp" cx="0.5" cy="0.9" r="0.8">
        <stop offset="0" stop-color="#ffc98a" stop-opacity="0.6"/><stop offset="0.5" stop-color="#e59a4a" stop-opacity="0.22"/><stop offset="1" stop-color="#e59a4a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ld-sheen" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stop-color="#fff6e6" stop-opacity="0.09"/><stop offset="0.36" stop-color="#fff6e6" stop-opacity="0.035"/><stop offset="0.46" stop-color="#fff6e6" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="ld-screen"><rect x="38" y="32" width="164" height="106" rx="11"/></clipPath>
    </defs>
    <rect x="14" y="8" width="212" height="196" rx="46" fill="url(#ld-shell)"/>
    <rect x="14" y="8" width="212" height="196" rx="46" fill="url(#ld-shine)"/>
    <rect x="14.6" y="8.6" width="210.8" height="194.8" rx="45.4" fill="none" stroke="#fff0dc" stroke-opacity="0.12" stroke-width="1.2"/>
    <rect x="30" y="24" width="180" height="122" rx="18" fill="#050302"/>
    <rect x="30.5" y="24.5" width="179" height="121" rx="17.5" fill="none" stroke="#000" stroke-opacity="0.8"/>
    <g clip-path="url(#ld-screen)">
      <rect x="38" y="32" width="164" height="106" fill="url(#ld-glass)"/>
      <rect class="ld-lamp" x="38" y="32" width="164" height="106" fill="url(#ld-lamp)" opacity="0"/>
      <path class="ld-ticks" d="${scaleTicks()}" fill="none" stroke="#f4e8d2" stroke-opacity="0.5" stroke-width="1.4" stroke-linecap="round"/>
      <path class="ld-zero-halo" d="M${PX} ${PY - 82}V${PY - 101}" fill="none" stroke="#ffc98a" stroke-width="7" stroke-linecap="round" opacity="0"/>
      <path class="ld-zero" d="M${PX} ${PY - 82}V${PY - 101}" fill="none" stroke="#f4e8d2" stroke-width="2.2" stroke-linecap="round"/>
      <path class="ld-flat" d="${flat}" fill="none" stroke="#ffc98a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="ld-sharp" d="${sharp}" fill="none" stroke="#f4e8d2" stroke-opacity="0.28" stroke-width="1.8" stroke-linecap="round"/>
      <path class="ld-note" d="${NOTE_D}" transform="translate(${f2(PX - 14.44 * 1.12)} 132) scale(1.12)" fill="#f4e8d2"/>
      <g class="ld-needle" transform="rotate(${-START_FLAT} ${PX} ${PY})">
        <path class="ld-needle-halo" d="M${PX} ${PY - 64}V${PY - 103}" stroke="#ffc98a" stroke-width="7" stroke-linecap="round" opacity="0"/>
        <path d="M${PX} ${PY - 64}V${PY - 103}" stroke="#fff4e2" stroke-width="2.2" stroke-linecap="round"/>
      </g>
      <rect x="38" y="32" width="164" height="106" fill="url(#ld-sheen)"/>
    </g>
  </svg>`
}

/** far overhead: a festoon string of bulbs, out of focus (bokeh), warming with the room */
function bulbsSvg() {
  let discs = ''
  const n = 11
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    const x = 40 + u * 920
    // the swag: a shallow catenary between two posts
    const y = 34 + 58 * (1 - Math.pow(2 * u - 1, 2))
    const r = 15 + ((i * 7) % 5) * 1.6
    discs += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="url(#ld-bokeh)" opacity="${(0.55 + ((i * 5) % 4) * 0.12).toFixed(2)}"/>`
  }
  return `<svg class="ld-bulbs" viewBox="0 0 1000 170" focusable="false">
    <defs>
      <radialGradient id="ld-bokeh">
        <stop offset="0" stop-color="#ffd9a0" stop-opacity="0.55"/><stop offset="0.72" stop-color="#f0a95a" stop-opacity="0.34"/>
        <stop offset="0.9" stop-color="#e8964a" stop-opacity="0.4"/><stop offset="1" stop-color="#e8964a" stop-opacity="0"/>
      </radialGradient>
    </defs>${discs}
  </svg>`
}

/** where the headstock's monogram sits on screen: its centre, and the screen vectors of one tile px across (u) and down (v) */
interface HeroMark {
  cx: number
  cy: number
  u: [number, number]
  v: [number, number]
}

const tv = new THREE.Vector3()

/** shown, all the way up the tree */
function isShown(o: THREE.Object3D | null) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false
  return true
}

/**
 * 1. the live scene: the hero's headstock decal (the kit guitar's 'headstock'
 * group → its 2:1 plane) through the engine's camera. With more than one
 * guitar in the chapter, the decal nearest the published centre (else the
 * biggest on screen) wins.
 */
function sceneMark(hint: HeroMark | null): HeroMark | null {
  const eng = window.__hark?.engine
  const st = eng?.state
  const slot = st?.slots[st.index]
  if (!eng || !slot) return null
  const decals: THREE.Mesh[] = []
  slot.chapter.group.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh || o.parent?.name !== 'headstock') return
    const g = m.geometry as THREE.PlaneGeometry
    const p = g?.parameters
    if (g?.type === 'PlaneGeometry' && p && p.height > 0 && Math.abs(p.width / p.height - 2) < 0.02 && isShown(m)) decals.push(m)
  })
  if (!decals.length) return null
  const cam = eng.camera
  cam.updateMatrixWorld()
  const r = eng.renderer.domElement.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return null
  let best: HeroMark | null = null
  let bestScore = Infinity
  for (const d of decals) {
    const { width: W, height: H } = (d.geometry as THREE.PlaneGeometry).parameters
    d.updateWorldMatrix(true, false)
    const px = (x: number, y: number): [number, number] => {
      tv.set(x, y, 0).applyMatrix4(d.matrixWorld).project(cam)
      return [r.left + (tv.x * 0.5 + 0.5) * r.width, r.top + (0.5 - tv.y * 0.5) * r.height]
    }
    tv.set(0, 0, 0).applyMatrix4(d.matrixWorld).project(cam)
    if (tv.z > 1 || tv.z < -1) continue
    const c = px(0, 0)
    const le = px(-W / 2, 0)
    const ri = px(W / 2, 0)
    const tp = px(0, H / 2)
    const bt = px(0, -H / 2)
    // the tile is 512 x 256 px across the plane; its y runs down the decal (local −y)
    const m: HeroMark = { cx: c[0], cy: c[1], u: [(ri[0] - le[0]) / 512, (ri[1] - le[1]) / 512], v: [(bt[0] - tp[0]) / 256, (bt[1] - tp[1]) / 256] }
    const score = hint ? Math.hypot(m.cx - hint.cx, m.cy - hint.cy) : -Math.hypot(m.u[0], m.u[1])
    if (score < bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

/** 2. the hero's published contract (see the header) */
function cssMark(): HeroMark | null {
  const cs = getComputedStyle(document.documentElement)
  const num = (k: string) => parseFloat(cs.getPropertyValue(k))
  const cx = num('--hark-mark-x')
  const cy = num('--hark-mark-y')
  const size = num('--hark-mark-size')
  if (![cx, cy, size].every(Number.isFinite) || size < 8) return null
  const font = num('--hark-mark-font')
  const deg = num('--hark-mark-angle')
  const a = ((Number.isFinite(deg) ? deg : 0) * Math.PI) / 180
  const ku = size / MONO_ADVANCE
  const kv = Number.isFinite(font) && font > 2 ? font / MONO_FONT : ku
  return { cx, cy, u: [Math.cos(a) * ku, Math.sin(a) * ku], v: [-Math.sin(a) * kv, Math.cos(a) * kv] }
}

/**
 * The hero's monogram on screen — null when it can't be found, is off
 * screen, or the story isn't on the hero's landing frame (a deep link to
 * #listen, ?c=…, or a scroll during the load lands elsewhere).
 */
function heroMark(): HeroMark | null {
  try {
    const st = window.__hark?.engine?.state
    const slot = st?.slots[st.index]
    if (!st || !slot || slot.def.id !== 'hero' || st.local > 0.02) return null
    const published = cssMark()
    const m = sceneMark(published) ?? published
    if (!m) return null
    const across = Math.hypot(m.u[0], m.u[1]) * 512
    const ok = [m.cx, m.cy, ...m.u, ...m.v].every(Number.isFinite)
    if (!ok || m.cx < 0 || m.cy < 0 || m.cx > innerWidth || m.cy > innerHeight) return null
    if (across < 16 || across > 3 * Math.max(innerWidth, innerHeight)) return null
    return m
  } catch {
    return null
  }
}

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  const start = performance.now()
  const calm = calmUi()
  let target = 0
  let shown = 0
  let shownPct = -1
  let ticker = 0
  let needle: SVGGElement | null = null
  let flatEl: SVGPathElement | null = null
  let lamp: SVGRectElement | null = null
  let lit: HTMLElement | null = null
  let room: HTMLElement[] = []
  let bulbs: SVGSVGElement | null = null
  let pct: HTMLElement | null = null

  if (skip) root.remove()
  else {
    const glyphs = MONO_PATHS.map(d => `<path d="${d}"/>`).join('')
    root.innerHTML = `
      <div class="ld${calm ? ' is-calm' : ''}">
        <div class="ld-bg" aria-hidden="true"><div class="ld-bg-glow"></div>${bulbsSvg()}</div>
        <p class="sr-only" role="status">Loading ${BRAND.name}</p>
        <div class="ld-stage" aria-hidden="true">
          <div class="ld-pool"></div>
          <div class="ld-tuner">
            <div class="ld-case">${tunerSvg()}</div>
            <svg class="ld-badge" viewBox="${MONO_TILE}" focusable="false"><g fill="#efe4c8">${glyphs}</g></svg>
          </div>
          <p class="ld-read"><i class="ld-bulb"><i class="ld-bulb-lit"></i></i><span>Tuning up</span><i class="ld-rule"></i><b><span data-pct>000</span>%</b></p>
        </div>
      </div>`
    // the whole page sleeps under the loader, the skip link too (it would take
    // focus unseen, under the dark)
    holdInert('loader', [
      document.querySelector<HTMLElement>('.skip-link'),
      document.getElementById('track'),
      document.getElementById('stages'),
      document.getElementById('chrome'),
    ])
    needle = root.querySelector<SVGGElement>('.ld-needle')
    flatEl = root.querySelector<SVGPathElement>('.ld-flat')
    lamp = root.querySelector<SVGRectElement>('.ld-lamp')
    lit = root.querySelector<HTMLElement>('.ld-bulb-lit')
    room = [...root.querySelectorAll<HTMLElement>('.ld-pool, .ld-bg-glow')]
    bulbs = root.querySelector<SVGSVGElement>('.ld-bulbs')
    pct = root.querySelector<HTMLElement>('[data-pct]')
    paint(0, 0)
    ticker = window.setInterval(tick, TICK_MS)
  }

  /** the string is `v` (0..1) of the way up to pitch; `t` seconds in (the needle hunts a little) */
  function paint(v: number, t: number) {
    // flat → centre: slow at first, settling as it arrives
    let cents = -START_FLAT * Math.pow(1 - v, 1.6)
    // hunting while the peg turns: two slow sines, dying away near pitch
    if (!calm && v < 1) cents += (Math.sin(t * 5.4) * 2.2 + Math.sin(t * 13.1 + 1.3) * 0.7) * Math.pow(1 - v, 0.7)
    needle?.setAttribute('transform', `rotate(${f2(cents)} ${PX} ${PY})`)
    // the ♭ lamp: lit while clearly flat, fading as the needle comes in
    flatEl?.setAttribute('opacity', (0.22 + 0.78 * smooth(3, 12, -cents)).toFixed(3))
    // the screen's backlight warms with the room
    lamp?.setAttribute('opacity', (0.15 + 0.45 * v).toFixed(3))
    if (lit) lit.style.opacity = (v * v * v).toFixed(3)
    const warm = (v * v).toFixed(3)
    for (const el of room) el.style.opacity = warm
    if (bulbs) bulbs.style.opacity = (0.25 + 0.75 * v * v).toFixed(3)
    const n = Math.round(v * 100)
    if (pct && n !== shownPct) {
      shownPct = n
      pct.textContent = String(n).padStart(3, '0')
    }
  }

  function tick() {
    const now = performance.now()
    // never ahead of the real load, never faster than MIN_MS end to end
    const time = Math.min(1, (now - start) / MIN_MS)
    const goal = Math.min(target, time)
    const next = shown + (goal - shown) * 0.2
    shown = goal - next < 0.002 ? goal : next
    paint(shown, (now - start) / 1000)
  }

  return {
    progress(p: number) {
      const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
      if (v > target) target = v
    },
    async finish(): Promise<void> {
      if (skip) return
      const ld = root.querySelector<HTMLElement>('.ld')
      const bg = root.querySelector<HTMLElement>('.ld-bg')
      const tunerCase = root.querySelector<HTMLElement>('.ld-case')
      const badge = root.querySelector<SVGSVGElement>('.ld-badge')
      /** the last fade runs on after finish() resolves (the loader lingers, click-through) */
      let linger = 0
      try {
        await wait(MIN_MS - (performance.now() - start))
        target = 1
        // let the needle come up (bounded)
        const t0 = performance.now()
        while (shown < 0.999 && performance.now() - t0 < FILL_MAX_MS) await wait(TICK_MS)
        clearInterval(ticker)
        shown = 1
        paint(1, 0)
        // in tune: the centre lights, the screen glows
        ld?.classList.add('is-lit')
        await wait(HOLD_MS)
        // the page wakes as the loader lifts, so the first Tab lands in it
        releaseInert('loader')
        const extras = [...root.querySelectorAll('.ld-read, .ld-pool, .ld-bg-glow, .ld-bulbs')]
        const to = calm ? null : heroMark()
        const from = badge?.getBoundingClientRect()
        if (to && badge && from && from.width > 4 && from.height > 4) {
          // the match-cut: the monogram glides onto the headstock's while the
          // tuner dissolves around it; the dark lifts late in the glide
          const fx = from.left + from.width / 2
          const fy = from.top + from.height / 2
          // the badge's px per tile px → the decal's screen vectors per tile px
          const s0 = from.width / 512
          const m = [to.u[0] / s0, to.u[1] / s0, to.v[0] / s0, to.v[1] / s0].map(n => n.toFixed(5)).join(', ')
          badge.style.transformOrigin = '50% 50%'
          for (const x of extras) play(x, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out' })
          play(tunerCase, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], {
            duration: FLIGHT_MS * 0.5,
            easing: 'cubic-bezier(0.3, 0, 0.4, 1)',
          })
          play(
            badge,
            [
              { transform: 'translate(0px, 0px) matrix(1, 0, 0, 1, 0, 0)' },
              { transform: `translate(${f1(to.cx - fx)}px, ${f1(to.cy - fy)}px) matrix(${m}, 0, 0)` },
            ],
            { duration: FLIGHT_MS, easing: 'cubic-bezier(0.6, 0, 0.22, 1)' },
          )
          play(bg, [{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS * 0.58, delay: FLIGHT_MS * 0.42, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' })
          await wait(FLIGHT_MS)
          // the let-go crossfades with the hero's own light coming up: finish()
          // resolves now ('hark:reveal') while the badge fades into the decal
          play(badge, [{ opacity: 1 }, { opacity: 0 }], { duration: LETGO_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' })
          linger = LETGO_MS
        } else {
          // no match-cut (or calm): a clean fade — the tuner goes first, then
          // the dark lifts while the story's own light comes up
          const tuner = root.querySelector<HTMLElement>('.ld-tuner')
          play(tuner, [{ opacity: 1 }, { opacity: 0 }], { duration: TILE_OUT_MS, easing: 'ease-out' })
          for (const x of extras) play(x, [{ opacity: 1 }, { opacity: 0 }], { duration: TILE_OUT_MS, easing: 'ease-out' })
          await wait(TILE_OUT_MS * 0.7)
          play(bg, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in-out' })
          linger = FADE_MS
        }
      } catch {
        /* never hold the page hostage */
        linger = 0
      } finally {
        clearInterval(ticker)
        releaseInert('loader')
        if (linger > 0) {
          root.style.pointerEvents = 'none'
          root.setAttribute('aria-hidden', 'true')
          window.setTimeout(() => root.remove(), linger + 40)
        } else root.remove()
      }
    },
  }
}
