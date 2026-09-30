import { holdInert, releaseInert } from './inert'
import { BRAND } from '../content'
import { WORDMARK, roundelSvg } from './mark'
import { calmUi } from './prefs'

/*
 * The boot screen — GLORY: SIDE A, NEEDLE DOWN. A Glory red-label record in
 * a pool of warm light on the dark bar. As the site loads the tonearm swings
 * in off its rest, drops onto the lead-in and travels across the grooves
 * with the progress, while the platter spins up to 33⅓ rpm (never under
 * reduced motion / Motion off: then it simply sits, the arm still moves). An
 * amber ring fills around the label (the beer touch). The label carries the
 * red G roundel and "GLORY · BEER BAR & KITCHEN" set round it. Seven
 * darker bands in the grooves are the seven chapters (tracks). Under it:
 * the roundel, GLORY in Alfa Slab One, "Beer Bar & Kitchen", the address,
 * and "Spinning up · 064%" in Inter Tight caps ("33⅓ rpm" once it's up).
 * All DOM + inline SVG; the spin is one WAAPI rotation whose playbackRate
 * ramps (compositor-only).
 *
 * Exit: the MATCH-CUT onto the hero's record. The hero may publish its
 * record's rect on :root, in CSS px:
 *     --glory-record-x / --glory-record-y   the record's centre on screen,
 *     --glory-record-r                      its radius on screen.
 * When they're there (and the story opens on the hero's landing frame), the
 * spinning record glides and scales onto the hero's while the arm, the words
 * and the light fade and the dark lifts late in the glide; then finish()
 * resolves ('hark:reveal') and the loader's record crossfades into the real
 * one (the loader lingers for that fade, click-through and hidden from
 * assistive tech, then removes itself). Without them, or when the story
 * opens anywhere else: the arm lifts back to its rest as the whole screen
 * fades. Under reduced motion / Motion off: a plain fade. Every change is a
 * single monotone fade or glide: no flash, no strobe.
 *
 * The needle never outruns time: the arm takes at least MIN_MS to cross even
 * on a warm cache.
 *
 * API used by main.ts: createLoader(root, { skip }) → { progress(0..1), finish() }.
 * Rules: shows at least ~1.2s, never hangs (finish() always resolves; every
 * wait is a bounded timer, never a rAF), the page behind — the skip link
 * too — is inert while it's up, skip removes it at once (?nointro).
 */
const MIN_MS = 1200
/** the arm eases toward its target on this ticker (a timer: it runs in hidden tabs too) */
const TICK_MS = 33
/** longest we wait for the arm to arrive after the load lands */
const FILL_MAX_MS = 420
/** up to speed: a beat before the exit */
const HOLD_MS = 360
/** the match-cut: the record's glide onto the hero's, then its let-go */
const FLIGHT_MS = 780
const LETGO_MS = 600
/** no match-cut: the arm lifts, then the dark goes */
const LIFT_MS = 380
const FADE_MS = 420
/** 33⅓ rpm: one turn in 1.8 s */
const REV_MS = 1800

/*
 * The deck, in its SVG frame (viewBox 0 0 250 200): the record centred at
 * (100, 100), radius 98; the tonearm's pivot at (228, 28), the stylus 140
 * out. The arm angle for a stylus r from the centre comes from the law of
 * cosines (the arm swings on the record's near side).
 */
const CX = 100
const CY = 100
const PX = 228
const PY = 28
const ARM = 140
const D = Math.hypot(CX - PX, CY - PY)
const PHI = (Math.atan2(CY - PY, CX - PX) * 180) / Math.PI
const armAngle = (r: number) => {
  const c = (D * D + ARM * ARM - r * r) / (2 * D * ARM)
  return PHI - (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
}
/** radii: parked on the rest (off the record), the lead-in, the run-out */
const R_REST = 118
const R_LEAD = 95
const R_END = 44

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

/** the record itself (it spins): grooves, seven track bands, the red label (viewBox -100 -100 200 200) */
function recordSvg() {
  let grooves = ''
  for (let r = 38.5; r < 96; r += 1.35) {
    const a = (0.028 + 0.022 * Math.sin(r * 1.7)).toFixed(3)
    grooves += `<circle r="${f2(r)}" stroke-opacity="${a}"/>`
  }
  // seven tracks between the lead-in (95) and the run-out (40): six gaps + the edges
  let bands = ''
  const tracks = 7
  for (let i = 1; i < tracks; i++) {
    const r = 95 - (i * (95 - 42)) / tracks
    bands += `<circle r="${f2(r)}"/>`
  }
  const G = roundelSvg('', undefined).replace('<svg class=""', '<svg x="-11" y="-11" width="22" height="22"')
  return `<svg class="ld-rec-svg" viewBox="-100 -100 200 200" focusable="false" aria-hidden="true">
    <defs>
      <path id="ld-arc-top" d="M-25.5 0A25.5 25.5 0 0 1 25.5 0"/>
      <path id="ld-arc-bot" d="M-29.2 0A29.2 29.2 0 0 0 29.2 0"/>
      <radialGradient id="ld-vinyl" r="0.5">
        <stop offset="0.35" stop-color="#16110f"/><stop offset="0.92" stop-color="#0b0807"/><stop offset="1" stop-color="#1c1714"/>
      </radialGradient>
    </defs>
    <circle r="98" fill="url(#ld-vinyl)"/>
    <g fill="none" stroke="#fff4e4" stroke-width="0.5">${grooves}</g>
    <g fill="none" stroke="#050403" stroke-width="1.3">${bands}</g>
    <circle r="96.6" fill="none" stroke="#fff4e4" stroke-opacity="0.12" stroke-width="0.8"/>
    <circle r="34" fill="#d8272e"/>
    <circle r="33.2" fill="none" stroke="#a51a20" stroke-width="0.8"/>
    <circle r="31" fill="none" stroke="#fffaf0" stroke-opacity="0.55" stroke-width="0.5"/>
    <text class="ld-lab-t" font-size="5.6" fill="#fffaf0" letter-spacing="1.1" text-anchor="middle"><textPath href="#ld-arc-top" startOffset="50%">GLORY · BEER BAR &amp; KITCHEN</textPath></text>
    <text class="ld-lab-t" font-size="4.4" fill="#fffaf0" fill-opacity="0.85" letter-spacing="1" text-anchor="middle"><textPath href="#ld-arc-bot" startOffset="50%">SIDE A · 33⅓ RPM · OLD CITY</textPath></text>
    ${G}
    <circle r="1.7" fill="#0d0806"/>
  </svg>`
}

/** what doesn't turn: the platter's rim, the sheen, the amber ring and the tonearm (viewBox 0 0 250 200) */
function deckSvg() {
  const ringR = 36.5
  const circ = 2 * Math.PI * ringR
  return `<svg class="ld-deck-svg" viewBox="0 0 250 200" focusable="false" aria-hidden="true">
    <defs>
      <linearGradient id="ld-chrome" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f1ece4"/><stop offset="0.35" stop-color="#8d867e"/><stop offset="0.6" stop-color="#d8d2c9"/><stop offset="1" stop-color="#48433e"/>
      </linearGradient>
    </defs>
    <circle class="ld-ring" cx="${CX}" cy="${CY}" r="${ringR}" fill="none" stroke="#f0a53a" stroke-width="2.2" stroke-linecap="round"
      stroke-dasharray="${f2(circ)}" stroke-dashoffset="${f2(circ)}" transform="rotate(-90 ${CX} ${CY})"/>
    <g class="ld-rest"><circle cx="${f1(PX + ARM * Math.cos((armAngle(R_REST) * Math.PI) / 180))}" cy="${f1(PY + ARM * Math.sin((armAngle(R_REST) * Math.PI) / 180))}" r="4" fill="#2a2522" stroke="#6a635c" stroke-width="0.8"/></g>
    <circle cx="${PX}" cy="${PY}" r="13" fill="#1d1916" stroke="#5d5751" stroke-width="1"/>
    <g class="ld-arm" transform="translate(${PX} ${PY}) rotate(${f2(armAngle(R_REST))})">
      <rect x="-26" y="-6" width="14" height="12" rx="2.5" fill="url(#ld-chrome)"/>
      <path d="M-12 0H${ARM - 16}" stroke="#2b2724" stroke-width="4.2" stroke-linecap="round"/>
      <path d="M-12 0H${ARM - 16}" stroke="#d9d2c8" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M-12 -0.6H${ARM - 16}" stroke="#fffaf0" stroke-opacity="0.7" stroke-width="0.7" stroke-linecap="round"/>
      <path d="M${ARM - 17} -4.5H${ARM + 2}L${ARM + 1} 4.5H${ARM - 17}Z" fill="#26211e" stroke="#a49d95" stroke-width="0.8"/>
      <circle cx="${ARM}" cy="0" r="1.4" fill="#f0a53a"/>
    </g>
    <circle cx="${PX}" cy="${PY}" r="5.5" fill="url(#ld-chrome)"/>
  </svg>`
}

/** the hero's published record rect (see the header), or null */
function heroRecord(): { cx: number; cy: number; r: number } | null {
  try {
    const st = window.__hark?.engine?.state
    const slot = st?.slots[st.index]
    if (!st || !slot || slot.def.id !== 'hero' || st.local > 0.02) return null
    const cs = getComputedStyle(document.documentElement)
    const num = (k: string) => parseFloat(cs.getPropertyValue(k))
    const cx = num('--glory-record-x')
    const cy = num('--glory-record-y')
    const r = num('--glory-record-r')
    if (![cx, cy, r].every(Number.isFinite)) return null
    if (r < 12 || r > innerHeight || cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return null
    return { cx, cy, r }
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
  let arm: SVGGElement | null = null
  let ring: SVGCircleElement | null = null
  let glow: HTMLElement | null = null
  let pct: HTMLElement | null = null
  let spin: Animation | null = null
  /** the arm's angle now (the lift eases it back to the rest) */
  let armDeg = armAngle(R_REST)

  if (skip) root.remove()
  else {
    root.innerHTML = `
      <div class="ld${calm ? ' is-calm' : ''}">
        <div class="ld-bg" aria-hidden="true"><div class="ld-glow"></div></div>
        <p class="sr-only" role="status">Loading ${BRAND.name}</p>
        <div class="ld-stage" aria-hidden="true">
          <div class="ld-deck">
            <div class="ld-rec"><div class="ld-spin">${recordSvg()}</div><i class="ld-sheen"></i></div>
            ${deckSvg()}
          </div>
          <div class="ld-words">
            <p class="ld-brand"><span class="ld-mark">${roundelSvg('ld-mark-svg')}</span>${WORDMARK}</p>
            <p class="ld-addr">${BRAND.street} · ${BRAND.neighborhood} · Philadelphia</p>
            <p class="ld-read"><span data-ld-state>Spinning up</span><i class="ld-rule"><i class="ld-rule-fill"></i></i><b><span data-pct>000</span>%</b></p>
          </div>
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
    arm = root.querySelector<SVGGElement>('.ld-arm')
    ring = root.querySelector<SVGCircleElement>('.ld-ring')
    glow = root.querySelector<HTMLElement>('.ld-glow')
    pct = root.querySelector<HTMLElement>('[data-pct]')
    if (!calm) {
      try {
        spin =
          root.querySelector('.ld-spin')?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
            duration: REV_MS,
            iterations: Infinity,
          }) ?? null
        if (spin) spin.playbackRate = 0.0001
      } catch {
        spin = null
      }
    }
    paint(0)
    ticker = window.setInterval(tick, TICK_MS)
  }

  /** `v` (0..1): how far the needle has travelled; the platter comes up to speed early */
  function paint(v: number) {
    // off the rest and down onto the lead-in over the first stretch, then across the grooves
    const drop = smooth(0, 0.14, v)
    const across = smooth(0.12, 1, v)
    const r = v < 0.14 ? R_REST + (R_LEAD - R_REST) * drop : R_LEAD + (R_END - R_LEAD) * across
    armDeg = armAngle(r)
    arm?.setAttribute('transform', `translate(${PX} ${PY}) rotate(${f2(armDeg)})`)
    if (spin) spin.playbackRate = Math.max(0.0001, smooth(0.02, 0.5, v))
    if (ring) {
      const c = 2 * Math.PI * 36.5
      ring.setAttribute('stroke-dashoffset', f2(c * (1 - v)))
    }
    if (glow) glow.style.opacity = (0.4 + 0.6 * v).toFixed(3)
    const n = Math.round(v * 100)
    if (pct && n !== shownPct) {
      shownPct = n
      pct.textContent = String(n).padStart(3, '0')
      root.querySelector<HTMLElement>('.ld-rule-fill')?.style.setProperty('transform', `scaleX(${(n / 100).toFixed(2)})`)
    }
  }

  function tick() {
    const now = performance.now()
    // never ahead of the real load, never faster than MIN_MS end to end
    const time = Math.min(1, (now - start) / MIN_MS)
    const goal = Math.min(target, time)
    const next = shown + (goal - shown) * 0.2
    shown = goal - next < 0.002 ? goal : next
    paint(shown)
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
      const rec = root.querySelector<HTMLElement>('.ld-rec')
      /** the last fade runs on after finish() resolves (the loader lingers, click-through) */
      let linger = 0
      try {
        await wait(MIN_MS - (performance.now() - start))
        target = 1
        // let the arm arrive (bounded)
        const t0 = performance.now()
        while (shown < 0.999 && performance.now() - t0 < FILL_MAX_MS) await wait(TICK_MS)
        clearInterval(ticker)
        shown = 1
        paint(1)
        ld?.classList.add('is-full')
        const state = root.querySelector('[data-ld-state]')
        if (state) state.textContent = '33⅓ rpm'
        await wait(HOLD_MS)
        // the page wakes as the loader lifts, so the first Tab lands in it
        releaseInert('loader')
        const extras = [...root.querySelectorAll('.ld-words, .ld-deck-svg, .ld-glow')]
        const to = calm ? null : heroRecord()
        const box = rec?.getBoundingClientRect()
        if (to && rec && box && box.width > 8) {
          // the match-cut: the spinning record lands on the hero's
          const cx = box.left + box.width / 2
          const cy = box.top + box.height / 2
          const s = to.r / ((box.width / 2) * 0.98)
          rec.style.transformOrigin = '50% 50%'
          for (const x of extras) play(x, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' })
          play(
            rec,
            [
              { transform: 'translate(0px, 0px) scale(1)' },
              { transform: `translate(${f1(to.cx - cx)}px, ${f1(to.cy - cy)}px) scale(${s.toFixed(4)})` },
            ],
            { duration: FLIGHT_MS, easing: 'cubic-bezier(0.6, 0, 0.22, 1)' },
          )
          play(bg, [{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS * 0.58, delay: FLIGHT_MS * 0.42, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' })
          await wait(FLIGHT_MS)
          // the let-go crossfades with the hero's own record: finish() resolves
          // now ('hark:reveal') while the loader's record fades into it
          play(rec, [{ opacity: 1 }, { opacity: 0 }], { duration: LETGO_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' })
          linger = LETGO_MS
        } else if (!calm) {
          // no match-cut: the arm lifts back to its rest as the words go, then the dark lifts
          const words = root.querySelector('.ld-words')
          play(words, [{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-out' })
          const from = armDeg
          const tL = performance.now()
          while (performance.now() - tL < LIFT_MS * 0.7) {
            const k = smooth(0, 1, (performance.now() - tL) / (LIFT_MS * 0.7))
            arm?.setAttribute('transform', `translate(${PX} ${PY}) rotate(${f2(from + (armAngle(R_REST) - from) * k)})`)
            await wait(TICK_MS)
          }
          play(ld, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in-out' })
          linger = FADE_MS
        } else {
          // calm: one plain fade
          play(ld, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in-out' })
          linger = FADE_MS
        }
      } catch {
        /* never hold the page hostage */
        linger = 0
      } finally {
        clearInterval(ticker)
        releaseInert('loader')
        const end = () => {
          spin?.cancel()
          root.remove()
        }
        if (linger > 0) {
          root.style.pointerEvents = 'none'
          root.setAttribute('aria-hidden', 'true')
          window.setTimeout(end, linger + 40)
        } else end()
      }
    },
  }
}
