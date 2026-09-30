import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'
import { storeKey } from './prefs'

/*
 * GREG JONES PROJECT sound: an acoustic guitar in a small warm room after
 * dark (WebAudio only, no files).
 *
 *   room     the room tone: a breath of air — soft, dark, band-limited noise,
 *            breathing very slowly, barely there. Each chapter sets how much
 *            (the emptied room at Last Call is the most present); scroll
 *            speed stirs it a touch.
 *   strings  KARPLUS-STRONG steel strings: a pick-shaped noise burst
 *            (low-passed for the pick's brightness, comb-filtered for where
 *            along the string it was picked, with a tiny pick tick)
 *            circulating in a delay loop of one period — a light one-zero
 *            loop filter keeps the steel's shimmer, a fractional all-pass
 *            keeps it in tune — rendered as TWO slightly detuned
 *            polarizations (a quicker and a longer decay: the bloom and
 *            gentle beating of a real string) into a cached AudioBuffer
 *            (a few ms each). Unplugged — no distortion, no speaker: the voices go
 *            through the BODY — the air resonance (~100 Hz), the top's main
 *            mode (~205 Hz), a little mud taken out around 560 Hz, a touch of
 *            pick presence, a soft top end — then a short generated ROOM
 *            reverb (early reflections off close walls, a warm ~1.2 s tail).
 *   tuning   DADGBD. blip(i) plucks note i of D major pentatonic from D4
 *            (D E F♯ A B, up the neck): nav, toggles, the menu.
 *   cut()    a soft open-DADGBD STRUM (D2 A2 D3 G3 B3 D4) — a down-strum
 *            going forward, an up-strum going back — rate-limited to one
 *            per ~1.2 s so a fast scroll through several chapters plays one
 *            chord, not a flam.
 *   tone()   a pure sine a chapter may ask for (also via 'hark:tone' events).
 *   Chapters may also dispatch window events:
 *     'hark:pluck' {midi?, i?, level?}   one string (the hero's tuning:
 *                                        D2=38 A2=45 D3=50 G3=55 B3=59 D4=62);
 *                                        i = a pentatonic step when no midi
 *     'hark:strum' {root?, level?, up?}  the open DADGBD chord (root moves the
 *                                        whole shape, like a capo: root 38 = open)
 *     'hark:sfx'   {kind, level?}        small room sounds: 'knock' (a knuckle
 *                                        on the guitar's top), 'click' / 'detent'
 *                                        / 'switch' / 'latch' / 'plug' (a small
 *                                        mechanical click), 'capo' (a capo's
 *                                        clamp), 'peg' (a tuning peg's tick),
 *                                        'tape' (a tape transport's clunk);
 *                                        unknown kinds play a soft click
 *
 * CPU: the room bed is a handful of always-running nodes; a pluck is one
 * AudioBufferSourceNode; buffers are rendered on first use (and the common
 * ones in idle slices after the sound is switched on); update() only touches
 * gains ~8×/s. Off by default. Sound only ever starts from a real gesture:
 * the toggle's own click / tap / Enter / Space. A remembered "on"
 * (localStorage, per site) waits for the first real activation (a click or
 * tap, or Enter / Space on a control; never Tab, arrows or scrolling). Faded
 * out and suspended while the tab is hidden. On iOS the audio session is set
 * to "playback" so the silent switch doesn't swallow it. Levels stay low,
 * behind a gentle compressor.
 *
 * Keep the API: enabled, onChange, toggle(), update(), cut(), blip(), tone().
 */

const STORE_KEY = storeKey('sound')

function stored(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const CONTROL = 'a[href], button, [role="button"], [role="switch"], summary, input, select, textarea'

/* levels (linear gain, before the master) */
const MASTER_LEVEL = 0.6
const ROOM_LEVEL = 0.006
const BLIP_LEVEL = 0.1
const PLUCK_LEVEL = 0.12
const STRUM_LEVEL = 0.07
const SFX_LEVEL = 0.1
const REVERB_SEND = 0.24
const TONE_MAX = 0.03

/** D major pentatonic (semitones above D): D E F♯ A B */
const PENTA = [0, 2, 4, 7, 9]
/** blips start on D4 */
const BLIP_ROOT = 62
/** Greg's tuning, low string first (MIDI): D2 A2 D3 G3 B3 D4 */
export const OPEN_DADGBD = [38, 45, 50, 55, 59, 62]
/** how present the room tone is in each chapter */
/** the lo-fi tape bed (hiss + crackle), linear gain before the master */
const TAPE_BED = 0.05
const ROOM: Record<string, number> = { hero: 1, listen: 0.8, watch: 0.9, story: 0.75, gear: 0.85, contact: 1.25 }
/** a chapter must hold this long before the room follows it */
const SETTLE_S = 0.7
const CUT_GAP_S = 1.2
const BLIP_GAP_S = 0.07
const PLUCK_GAP_S = 0.045
const MAX_BUFFERS = 48

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function setAudioSession(type: string) {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = type
  } catch {
    /* not supported */
  }
}

/** a small seeded PRNG so a note sounds the same every time it's rendered */
function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * One polarization of a Karplus-Strong steel string into `out` (added in).
 * `S` is the loop's one-zero weight (0.5 = the classic, darkest; lower keeps
 * more of the steel's highs), `cents` a small detune.
 */
function ksInto(out: Float32Array, sr: number, f: number, t60: number, exc: Float32Array, S: number, cents: number, gain: number) {
  const fr = f * Math.pow(2, cents / 1200)
  const period = sr / fr
  // the one-zero filter delays S samples; the all-pass takes the fraction
  const loop = period - S
  const ni = Math.max(2, Math.floor(loop - 0.1))
  const frac = loop - ni
  const c = (1 - frac) / (1 + frac)
  // per-trip loss so the fundamental falls 60 dB in t60 (|H(f)| of the one-zero folded in)
  const w = (2 * Math.PI * fr) / sr
  const mag = Math.sqrt((1 - S) * (1 - S) + S * S + 2 * S * (1 - S) * Math.cos(w))
  const g = Math.min(0.99995, Math.pow(10, -3 / (t60 * fr)) / Math.max(0.5, mag))
  const len = out.length
  const y = new Float32Array(len)
  const n0 = Math.min(ni, exc.length)
  let apIn = 0
  let apOut = 0
  for (let i = 0; i < len; i++) {
    const d1 = i >= ni ? y[i - ni] : 0
    const d2 = i >= ni + 1 ? y[i - ni - 1] : 0
    const v = g * ((1 - S) * d1 + S * d2)
    const ap = c * v + apIn - c * apOut
    apIn = v
    apOut = ap
    y[i] = (i < n0 ? exc[i] : 0) + ap
    out[i] += y[i] * gain
  }
}

/**
 * A steel string, plucked: `midi`, seconds to -60 dB, pick brightness 0..1.
 * Two polarizations (a quicker bloom and a longer ring, a hair apart in
 * pitch), a pick-shaped burst and a tiny pick tick. Peak-normalized to 0.9.
 * Pure (no AudioContext): exported for the offline checks.
 */
export function renderString(sr: number, midi: number, t60: number, bright: number) {
  const f = mtof(midi)
  const len = Math.ceil(sr * Math.min(4.6, t60 * 1.05 + 0.2))
  const out = new Float32Array(len)
  const r = seeded(midi * 131 + Math.round(bright * 97) + Math.round(t60 * 10))
  const n = Math.max(2, Math.floor(sr / f))
  // the pick: a noise burst, low-passed (a softer pick is darker) …
  const exc = new Float32Array(n)
  let lp = 0
  const a = 0.16 + 0.74 * clamp01(bright)
  for (let i = 0; i < n; i++) {
    lp += a * (r() * 2 - 1 - lp)
    exc[i] = lp
  }
  // … comb-filtered for where along the string it was picked (~1/6 from the bridge) …
  const pp = Math.max(1, Math.round(n * 0.16))
  for (let i = n - 1; i >= pp; i--) exc[i] -= exc[i - pp]
  // … and without DC (no thump from the loop)
  let mean = 0
  for (let i = 0; i < n; i++) mean += exc[i]
  mean /= n
  for (let i = 0; i < n; i++) exc[i] -= mean
  // a treble string makes many more trips a second: a lighter loop filter keeps its steel shimmer
  const S = midi < 50 ? 0.34 : midi < 58 ? 0.28 : 0.22
  ksInto(out, sr, f, t60 * 0.55, exc, S, -0.7, 0.62)
  ksInto(out, sr, f, t60 * 1.15, exc, S + 0.04, 0.45, 0.45)
  // the pick's tick on steel: 1.5 ms of bright noise
  const tick = Math.floor(sr * 0.0015)
  let hp = 0
  let prev = 0
  for (let i = 0; i < tick && i < len; i++) {
    const x = r() * 2 - 1
    hp = 0.6 * (hp + x - prev)
    prev = x
    out[i] += hp * 0.18 * (1 - i / tick) * (0.4 + clamp01(bright))
  }
  let peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]))
  const norm = peak > 0 ? 0.9 / peak : 1
  // a 2 ms fade in (no click from the burst's first sample) and 60 ms out
  const fin = Math.floor(sr * 0.002)
  const fade = Math.floor(sr * 0.06)
  for (let i = 0; i < len; i++) {
    const e = (i < fin ? i / fin : 1) * (i > len - fade ? (len - i) / fade : 1)
    out[i] *= norm * e
  }
  return out
}

/**
 * The guitar's BODY and the ROOM, built on any context (the live one, or an
 * OfflineAudioContext for checks): returns the input to play strings into.
 */
export function buildVoiceChain(ctx: BaseAudioContext, out: AudioNode) {
  const input = ctx.createGain()
  input.gain.value = 1
  const node = (type: BiquadFilterType, freq: number, q: number, gain = 0) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    f.gain.value = gain
    return f
  }
  // the body: low guard, air resonance, the top's main mode, less mud, pick presence, a soft top
  const chain = [
    node('highpass', 62, 0.7),
    node('peaking', 101, 3.2, 4.5),
    node('peaking', 204, 2.4, 3.2),
    node('peaking', 560, 1.1, -2.2),
    node('peaking', 2500, 0.9, 1.8),
    node('highshelf', 7000, 0.7, -2),
    node('lowpass', 10500, 0.5),
  ]
  const body = ctx.createGain()
  body.gain.value = 1.4
  let at: AudioNode = input
  for (const f of chain) at = at.connect(f)
  at.connect(body).connect(out)
  // the room: a short stereo reverb
  const room = ctx.createConvolver()
  room.buffer = roomIR(ctx)
  const send = ctx.createGain()
  send.gain.value = REVERB_SEND
  body.connect(send).connect(room).connect(out)
  return input
}

/** a small warm room: early reflections off near walls, then a darkening ~1.2 s tail (stereo) */
function roomIR(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * 1.5)
  const ir = ctx.createBuffer(2, len, sr)
  const r = seeded(1977)
  const pre = Math.floor(sr * 0.011)
  // early reflections (the same pattern, a little different per ear)
  const taps = [
    [0.0, 0.62],
    [0.0043, 0.44],
    [0.0091, 0.38],
    [0.0137, 0.3],
    [0.0192, 0.27],
    [0.0254, 0.2],
    [0.0318, 0.16],
    [0.0405, 0.12],
  ]
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / sr
      // the tail darkens as it decays (the room's soft furnishings)
      const k = 0.35 + 0.55 * Math.min(1, t / 0.9)
      lp = lp * k + (r() * 2 - 1) * (1 - k)
      const onset = i < pre ? 0 : Math.min(1, (i - pre) / (sr * 0.03))
      d[i] = lp * Math.exp(-t / 0.3) * 0.55 * onset
    }
    for (const [dt, a] of taps) {
      const at = pre + Math.floor(sr * (dt + (c ? 0.0017 : 0) + r() * 0.0008))
      if (at < len) d[at] += a * (r() < 0.5 ? -1 : 1) * 0.6
      if (at + 1 < len) d[at + 1] += a * 0.25
    }
  }
  return ir
}

interface PluckOpts {
  /** seconds to -60 dB */
  t60?: number
  /** pick brightness 0..1 */
  bright?: number
  pan?: number
}

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private voice!: AudioNode
  private room!: GainNode
  private fx!: GainNode
  private toneOsc: OscillatorNode | null = null
  private toneGain: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private click: AudioBuffer | null = null

  private chapter = 'hero'
  private slotIds: string[] = []
  private roomKey = ''
  private pendingKey = 'hero'
  private pendingSince = 0
  private lastCut = -10
  private lastBlip = -10
  private lastPluck = -10
  private lastSpeedAt = -10
  private speed = 0
  private suspendTimer = 0
  private warmTimer = 0
  private hidden = typeof document !== 'undefined' && document.hidden
  /** a remembered "on" waiting for the first real gesture */
  private armed = false
  private gestureBound = false
  private toneHz = 440
  private toneLevel = 0

  constructor() {
    this.armed = stored() === true
    if (this.armed) this.waitForGesture()
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.applyRunning()
    })
    window.addEventListener('hark:tone', e => {
      const d = (e as CustomEvent<{ hz?: number; level?: number }>).detail
      if (d && typeof d.hz === 'number') this.tone(d.hz, d.level ?? 0)
    })
    window.addEventListener('hark:pluck', e => {
      const d = (e as CustomEvent<{ i?: number; midi?: number; level?: number }>).detail ?? {}
      const ctx = this.live()
      if (!ctx) return
      const now = ctx.currentTime
      // a burst of plucks (a fast scrub through the tuning) plays as a few, not a buzz
      if (now - this.lastPluck < PLUCK_GAP_S) return
      this.lastPluck = now
      const midi = typeof d.midi === 'number' && Number.isFinite(d.midi) ? Math.max(28, Math.min(88, Math.round(d.midi))) : this.scaleNote(d.i ?? 0)
      this.pluck(now + 0.005, midi, PLUCK_LEVEL * clamp01(d.level ?? 1), {
        t60: this.ringFor(midi),
        bright: 0.5,
        pan: Math.max(-0.35, Math.min(0.35, (midi - 50) / 40)),
      })
    })
    window.addEventListener('hark:strum', e => {
      const d = (e as CustomEvent<{ root?: number; level?: number; up?: boolean }>).detail ?? {}
      const ctx = this.live()
      if (!ctx) return
      const shift = typeof d.root === 'number' && Number.isFinite(d.root) ? Math.round(d.root) - OPEN_DADGBD[0] : 0
      this.strum(ctx.currentTime + 0.01, shift, STRUM_LEVEL * clamp01(d.level ?? 1), !!d.up, 3)
    })
    window.addEventListener('hark:sfx', e => {
      const d = (e as CustomEvent<{ kind?: string; level?: number }>).detail ?? {}
      const ctx = this.live()
      if (!ctx) return
      this.sfx(ctx, ctx.currentTime + 0.005, String(d.kind ?? 'click'), clamp01(d.level ?? 1))
    })
    // the static page took over (no GPU): silence, without touching the stored choice
    window.addEventListener('hark:fallback', () => this.setEnabled(false))
  }

  /** was sound on last visit? (it still needs a gesture to start) */
  get remembered() {
    return stored() === true
  }

  /** Flip the sound on/off. Call from a user gesture (click / key). */
  toggle() {
    this.armed = false
    this.setEnabled(!this.enabled)
    try {
      localStorage.setItem(STORE_KEY, this.enabled ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  /** Follow the story: each chapter sets the room tone (once it holds); scroll speed stirs the air. */
  update(frame: Frame, state: EngineState) {
    const slot = state.slots[state.index]
    if (slot) this.chapter = slot.def.id
    if (this.slotIds.length !== state.slots.length) this.slotIds = state.slots.map(s => s.def.id)
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (this.chapter !== this.pendingKey) {
      this.pendingKey = this.chapter
      this.pendingSince = now
    }
    if (this.pendingKey !== this.roomKey && now - this.pendingSince > SETTLE_S) this.setRoom(this.pendingKey, ctx, 1.4)
    // ≈ 8×/s: a little more air while the story slides past
    if (now - this.lastSpeedAt > 0.12) {
      this.lastSpeedAt = now
      const s = clamp01(Math.abs(frame.velocity || 0) / 3)
      if (Math.abs(s - this.speed) > 0.04) {
        this.speed = s
        this.room.gain.setTargetAtTime(ROOM_LEVEL * (ROOM[this.roomKey] ?? 1) * (1 + 0.8 * s), now, s > 0.1 ? 0.2 : 0.8)
      }
    }
  }

  /** A chapter cut: a soft open-DADGBD strum (down going forward, up going back). */
  cut(from: number, to: number) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    const toId = this.slotIds[to]
    if (toId) {
      this.pendingKey = toId
      this.pendingSince = now
    }
    // a fast run of cuts: one chord, then the guitar waits for the story to settle
    if (now - this.lastCut < CUT_GAP_S) return
    this.lastCut = now
    this.strum(now + 0.012, 0, STRUM_LEVEL, to < from, 2.8)
  }

  /** A plucked note (nav, toggles): note i of D major pentatonic from D4. No-op while off. */
  blip(pitch = 0) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBlip < BLIP_GAP_S) return
    this.lastBlip = now
    this.pluck(now + 0.004, this.scaleNote(pitch), BLIP_LEVEL, { t60: 1.6, bright: 0.55, pan: rand(-0.2, 0.2) })
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  /* ------------------------------------------------------------ internals */

  private scaleNote(i: number) {
    const p = Math.max(0, Math.min(14, Math.round(Number.isFinite(i) ? i : 0)))
    return BLIP_ROOT + PENTA[p % 5] + 12 * Math.floor(p / 5)
  }

  /** low strings ring longer */
  private ringFor(midi: number) {
    return Math.max(1.8, Math.min(4, 4 - (midi - 38) * 0.075))
  }

  private live() {
    const ctx = this.ctx
    if (!ctx || !this.enabled || this.hidden || ctx.state !== 'running') return null
    return ctx
  }

  private setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    setAudioSession(on ? 'playback' : 'auto')
    if (on) {
      try {
        this.ensureGraph()
      } catch (err) {
        console.warn('[gjp] audio unavailable', err)
      }
    }
    this.applyRunning(true)
    for (const fn of this.onChange) fn(on)
  }

  /** Resume + fade in, or fade out + suspend, from enabled / hidden. */
  private applyRunning(greet = false) {
    const ctx = this.ctx
    if (!ctx) return
    clearTimeout(this.suspendTimer)
    const now = ctx.currentTime
    if (this.enabled && !this.hidden) {
      ctx
        .resume()
        .then(() => {
          if (!this.enabled || this.hidden) return
          if (ctx.state !== 'running') return this.waitForGesture()
          const t = ctx.currentTime
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setValueAtTime(this.master.gain.value, t)
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, 0.3)
          this.pendingKey = this.chapter
          this.roomKey = ''
          this.setRoom(this.chapter, ctx, 0.9)
          this.applyTone()
          this.warmUp()
          // the sound comes on: one open string rings, the D in the middle of the neck
          if (greet) this.pluck(t + 0.03, 50, BLIP_LEVEL, { t60: 3, bright: 0.45 })
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.25)
      this.suspendTimer = window.setTimeout(
        () => {
          if (!this.enabled || this.hidden) ctx.suspend().catch(() => {})
        },
        this.hidden ? 300 : 1400,
      )
    }
  }

  /** Start audio on the first real gesture (a remembered "on", or a blocked resume). */
  private waitForGesture() {
    if (this.gestureBound) return
    this.gestureBound = true
    let sx = 0
    let sy = 0
    const events = ['click', 'keydown', 'touchstart', 'touchend'] as const
    const handler = (e: Event) => {
      if (e.type === 'touchstart') {
        const t = (e as TouchEvent).touches[0]
        if (t) {
          sx = t.clientX
          sy = t.clientY
        }
        return
      }
      if (e.type === 'touchend') {
        // a tap, not a scroll or a swipe
        const t = (e as TouchEvent).changedTouches[0]
        if (!t || Math.hypot(t.clientX - sx, t.clientY - sy) > 12) return
      }
      // keyboard: only Enter / Space on a control is "play"; Tab and friends are just moving around
      if (e instanceof KeyboardEvent) {
        if (!ACTIVATE_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
        if (!(e.target as Element | null)?.closest?.(CONTROL)) return
      }
      for (const ev of events) window.removeEventListener(ev, handler, true)
      this.gestureBound = false
      const onToggle = (e.target as Element | null)?.closest?.('[data-sound-toggle]')
      if (this.armed) {
        this.armed = false
        // the toggle's own click decides for itself
        if (!onToggle) this.setEnabled(true)
      } else if (this.enabled) this.applyRunning()
    }
    for (const ev of events) window.addEventListener(ev, handler, { capture: true, passive: true })
  }

  /* ------------------------------------------------------------ the graph */

  private ensureGraph() {
    if (this.ctx) return
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'interactive' })
    this.ctx = ctx
    const sr = ctx.sampleRate

    // master → rumble guard → gentle compression → out
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 36
    hp.Q.value = 0.5
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.knee.value = 14
    comp.ratio.value = 2.6
    comp.attack.value = 0.006
    comp.release.value = 0.35
    // LO-FI TAPE: master → wow & flutter (a modulated short delay) → a rolled-off
    // top (a worn cassette) → soft saturation → rumble guard → compression → out
    const wowDelay = ctx.createDelay(0.05)
    wowDelay.delayTime.value = 0.012
    const wow = ctx.createOscillator()
    wow.frequency.value = 0.55
    const wowAmt = ctx.createGain()
    wowAmt.gain.value = 0.0016
    wow.connect(wowAmt).connect(wowDelay.delayTime)
    const flutter = ctx.createOscillator()
    flutter.frequency.value = 6.8
    const flutterAmt = ctx.createGain()
    flutterAmt.gain.value = 0.00022
    flutter.connect(flutterAmt).connect(wowDelay.delayTime)
    wow.start()
    flutter.start()
    const tapeLp = ctx.createBiquadFilter()
    tapeLp.type = 'lowpass'
    tapeLp.frequency.value = 3600
    tapeLp.Q.value = 0.45
    const warm = ctx.createBiquadFilter()
    warm.type = 'lowshelf'
    warm.frequency.value = 180
    warm.gain.value = 2.5
    const sat = ctx.createWaveShaper()
    {
      const n = 1024
      const curve = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1
        curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6)
      }
      sat.curve = curve
      sat.oversample = '2x'
    }
    this.master.connect(wowDelay).connect(tapeLp).connect(warm).connect(sat).connect(hp).connect(comp).connect(ctx.destination)

    // the tape bed: hiss and the odd crackle, very quiet, under everything
    {
      const len = Math.floor(sr * 6)
      const bed = ctx.createBuffer(2, len, sr)
      for (let c = 0; c < 2; c++) {
        const d = bed.getChannelData(c)
        let pink = 0
        for (let i = 0; i < len; i++) {
          pink = pink * 0.96 + (Math.random() * 2 - 1) * 0.04
          d[i] = pink * 0.35
        }
        const clicks = Math.floor(6 * 9)
        for (let k = 0; k < clicks; k++) {
          const at = Math.floor(Math.random() * (len - 64))
          const amp = (0.25 + Math.random() * 0.75) * (Math.random() < 0.5 ? -1 : 1)
          const w = 6 + Math.floor(Math.random() * 26)
          for (let j = 0; j < w; j++) d[at + j] += amp * Math.exp(-j / (w * 0.35)) * (j % 2 ? -0.6 : 1)
        }
        const x = Math.floor(sr * 0.05)
        for (let i = 0; i < x; i++) {
          const kk = i / x
          d[i] = d[i] * kk + d[len - x + i] * (1 - kk)
        }
      }
      const bedSrc = ctx.createBufferSource()
      bedSrc.buffer = bed
      bedSrc.loop = true
      bedSrc.loopEnd = bed.duration - 0.05
      const bedHp = ctx.createBiquadFilter()
      bedHp.type = 'highpass'
      bedHp.frequency.value = 900
      const bedGain = ctx.createGain()
      bedGain.gain.value = TAPE_BED
      bedSrc.connect(bedHp).connect(bedGain).connect(this.master)
      bedSrc.start(0, rand(0, 3))
    }

    // THE GUITAR: strings → body → room
    this.voice = buildVoiceChain(ctx, this.master)

    // THE ROOM TONE: soft, dark, band-limited air, breathing slowly
    const noise = ctx.createBuffer(2, Math.floor(sr * 4), sr)
    for (let c = 0; c < 2; c++) {
      const nd = noise.getChannelData(c)
      // brown-ish: integrated white noise, leaky
      let b = 0
      for (let i = 0; i < nd.length; i++) {
        b = b * 0.985 + (Math.random() * 2 - 1) * 0.12
        nd[i] = b
      }
      // seamless loop: fade the seam
      const x = Math.floor(sr * 0.05)
      for (let i = 0; i < x; i++) {
        const k = i / x
        nd[i] = nd[i] * k + nd[nd.length - x + i] * (1 - k)
      }
    }
    this.room = ctx.createGain()
    this.room.gain.value = 0
    const roomSrc = ctx.createBufferSource()
    roomSrc.buffer = noise
    roomSrc.loop = true
    roomSrc.loopEnd = noise.duration - 0.05
    const roomHp = ctx.createBiquadFilter()
    roomHp.type = 'highpass'
    roomHp.frequency.value = 70
    roomHp.Q.value = 0.5
    const roomLp = ctx.createBiquadFilter()
    roomLp.type = 'lowpass'
    roomLp.frequency.value = 820
    roomLp.Q.value = 0.4
    const breath = ctx.createGain()
    breath.gain.value = 1
    roomSrc.connect(roomHp).connect(roomLp).connect(breath).connect(this.room).connect(this.master)
    roomSrc.start(0, rand(0, 2))
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.055
    const lfoAmt = ctx.createGain()
    lfoAmt.gain.value = 0.25
    lfo.connect(lfoAmt).connect(breath.gain)
    lfo.start()

    // a small mechanical click (a short, band-passed noise burst) for the sfx
    const cl = Math.floor(sr * 0.018)
    this.click = ctx.createBuffer(1, cl, sr)
    const cd = this.click.getChannelData(0)
    let lp = 0
    for (let i = 0; i < cl; i++) {
      lp += 0.35 * (Math.random() * 2 - 1 - lp)
      cd[i] = lp * Math.pow(1 - i / cl, 4) * 2
    }

    // sfx go through the room (not the body), a touch dry
    this.fx = ctx.createGain()
    this.fx.gain.value = 1
    this.fx.connect(this.master)

    this.toneOsc = ctx.createOscillator()
    this.toneOsc.type = 'sine'
    this.toneOsc.frequency.value = this.toneHz
    this.toneGain = ctx.createGain()
    this.toneGain.gain.value = 0
    this.toneOsc.connect(this.toneGain).connect(this.master)
    this.toneOsc.start()
  }

  /** the room tone for a chapter */
  private setRoom(id: string, ctx: AudioContext, tc: number) {
    this.roomKey = id
    this.room.gain.setTargetAtTime(ROOM_LEVEL * (ROOM[id] ?? 1), ctx.currentTime, tc)
  }

  /** after the sound comes on, render the notes it will need first, in idle slices */
  private warmUp() {
    clearTimeout(this.warmTimer)
    const todo: [number, number, number][] = []
    for (let i = 0; i < 8; i++) todo.push([this.scaleNote(i), 1.6, 0.55])
    for (const m of OPEN_DADGBD) todo.push([m, 2.8, 0.42], [m, this.ringFor(m), 0.5])
    const step = () => {
      const ctx = this.ctx
      if (!ctx || !this.enabled) return
      const next = todo.shift()
      if (!next) return
      this.buffer(ctx, next[0], next[1], next[2])
      this.warmTimer = window.setTimeout(step, 30)
    }
    this.warmTimer = window.setTimeout(step, 120)
  }

  /* ------------------------------------------------------------ voices */

  private buffer(ctx: AudioContext, midi: number, t60: number, bright: number) {
    const key = `${midi}|${t60.toFixed(2)}|${bright.toFixed(2)}`
    const hit = this.buffers.get(key)
    if (hit) return hit
    const data = renderString(ctx.sampleRate, midi, t60, bright)
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate)
    buf.getChannelData(0).set(data)
    if (this.buffers.size >= MAX_BUFFERS) {
      const first = this.buffers.keys().next().value
      if (first !== undefined) this.buffers.delete(first)
    }
    this.buffers.set(key, buf)
    return buf
  }

  /** one string through the body */
  private pluck(t: number, midi: number, level: number, { t60 = 2, bright = 0.5, pan = 0 }: PluckOpts = {}) {
    const ctx = this.ctx
    if (!ctx || level <= 0) return
    const src = ctx.createBufferSource()
    src.buffer = this.buffer(ctx, midi, t60, bright)
    const g = ctx.createGain()
    g.gain.value = level
    src.connect(g)
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      g.connect(p).connect(this.voice)
    } else g.connect(this.voice)
    src.start(t)
  }

  /** the open DADGBD chord (shifted `shift` semitones, like a capo), strummed down or up */
  private strum(t: number, shift: number, level: number, up: boolean, t60: number) {
    const notes = OPEN_DADGBD.map(m => m + shift)
    if (up) notes.reverse()
    let at = t
    notes.forEach((m, i) => {
      // bass strings a touch fuller; a down-strum lands a little harder at the start, an up-strum at the top
      const w = 0.78 + 0.22 * (up ? i / 5 : 1 - i / 5)
      this.pluck(at, m, level * w, { t60: t60 * (m < 50 ? 1.15 : 1), bright: up ? 0.46 : 0.4, pan: ((m - shift - 50) / 12) * 0.14 })
      at += 0.017 + Math.random() * 0.007
    })
  }

  /** small sounds of the room (see the header) */
  private sfx(ctx: AudioContext, t: number, kind: string, level: number) {
    const L = SFX_LEVEL * level
    switch (kind) {
      case 'knock':
        // a knuckle on the top: a short low sine through the body, and a soft tap
        this.thud(ctx, t, 118, 0.09, L * 1.2, this.voice)
        this.clack(ctx, t, L * 0.5, 900, 0.8)
        break
      case 'capo':
        this.clack(ctx, t, L, 2400, 1.25)
        this.clack(ctx, t + 0.055, L * 0.7, 1800, 1.1)
        break
      case 'peg':
        this.clack(ctx, t, L * 0.4, 3600, 1.8)
        break
      case 'tape':
        this.thud(ctx, t, 72, 0.12, L * 1.1, this.fx)
        this.clack(ctx, t + 0.008, L * 0.8, 1200, 0.9)
        break
      default:
        // click / detent / switch / latch / plug and anything unknown
        this.clack(ctx, t, L * 0.8, 2000, 1.4)
    }
  }

  /** a short mechanical click: the click burst, high-passed */
  private clack(ctx: AudioContext, t: number, level: number, hp: number, rate: number) {
    if (!this.click) return
    const s = ctx.createBufferSource()
    s.buffer = this.click
    s.playbackRate.value = rate
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = hp
    const g = ctx.createGain()
    g.gain.value = level
    s.connect(f).connect(g).connect(this.fx)
    s.start(t)
  }

  /** a soft low thud (a falling sine) */
  private thud(ctx: AudioContext, t: number, hz: number, dur: number, level: number, dest: AudioNode) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(hz, t)
    o.frequency.exponentialRampToValueAtTime(hz * 0.7, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 2.2)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + dur * 2.4)
  }

  private applyTone() {
    const ctx = this.ctx
    if (!ctx || !this.toneOsc || !this.toneGain) return
    const now = ctx.currentTime
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.08)
    this.toneGain.gain.setTargetAtTime(this.toneLevel * TONE_MAX, now, 0.12)
  }
}
