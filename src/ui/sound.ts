import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'
import { storeKey } from './prefs'

/*
 * GLORY sound: a record playing in a warm bar room at 126 Chestnut Street
 * after dark (WebAudio only, no files, nothing sampled). Subtle — a bed you
 * notice when it stops.
 *
 *   crackle  VINYL: a pre-rendered 5 s stereo loop of surface noise — dust
 *            ticks (mostly tiny, now and then a fatter pop) over a faint
 *            band-limited hiss and the low rumble of the platter — warm,
 *            under everything, in every chapter.
 *   murmur   the room: soft brown-ish noise through two broad "voice"
 *            formants (≈ 320 Hz and ≈ 950 Hz) whose levels wander on their
 *            own slow random walks, so it rises and falls like a crowd
 *            talking two rooms away. Each chapter sets how busy (the back
 *            room fullest, Last Call emptying out); scroll speed stirs it.
 *   fizz     carbonation: a faint loop of tiny bubble pops, high-passed —
 *            heard most at the taps.
 *   clinks   now and then two glasses touch somewhere in the room: a couple
 *            of inharmonic glass partials (1 : 2.32 : 4.25 : 6.63) with a
 *            contact tick, panned, through a small room reverb. Rate-limited
 *            (never closer than ~3.5 s; usually 6–16 s apart).
 *   cut()    a NEEDLE DROP on a chapter cut: the soft thump of the stylus
 *            meeting the record, a brush of contact noise and a brief swell
 *            of crackle as it settles into the groove — rate-limited to one
 *            per ~1.2 s so a fast run of cuts plays one drop, not a flam.
 *   blip(i)  a small clink for UI (nav, toggles, the menu): one light tap on
 *            a glass, note i of E major pentatonic from E6.
 *   tone()   a pure sine a chapter may ask for (also via 'hark:tone').
 *   Chapters may also dispatch window events:
 *     'hark:tone' {hz, level}                    see tone()
 *     'hark:sfx'  {kind, level?}                 'needle' (a needle drop),
 *                                                'clink' (two glasses), 'tap'
 *                                                (one light tap), 'pour',
 *                                                'glug', 'thud' (a glass set
 *                                                down on the bar), 'fizz' (a
 *                                                burst of bubbles); unknown
 *                                                kinds play a tap
 *
 * CPU: the bed is a handful of always-running nodes; one-shots are a few
 * oscillators / buffer sources each; update() only touches gains ~8×/s. Off
 * by default. Sound only ever starts from a real gesture: the toggle's own
 * click / tap / Enter / Space. A remembered "on" (localStorage, per site)
 * waits for the first real activation (a click or tap, or Enter / Space on a
 * control; never Tab, arrows or scrolling). Faded out and suspended while
 * the tab is hidden. On iOS the audio session is set to "playback" so the
 * silent switch doesn't swallow it. Levels stay low, behind a gentle
 * compressor and a warm low-pass.
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
const MASTER_LEVEL = 0.7
const MURMUR_LEVEL = 0.05
const FIZZ_LEVEL = 0.014
const CRACKLE_LEVEL = 0.06
const NEEDLE_LEVEL = 0.09
const CLINK_LEVEL = 0.035
const BLIP_LEVEL = 0.05
const POUR_LEVEL = 0.06
const REVERB_SEND = 0.3
const TONE_MAX = 0.03

/** E major pentatonic ratios; blips start on E6 */
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3]
const BLIP_ROOT = 1318.5
/** a glass's modes (free-free-ish partial ratios) */
const GLASS = [1, 2.32, 4.25, 6.63]

/** how busy the room is in each chapter: murmur, fizz, clink rate, crackle */
const ROOM: Record<string, [number, number, number, number]> = {
  hero: [0.8, 0.8, 0.8, 1.1],
  taps: [1.1, 1.5, 1.2, 0.9],
  kitchen: [1, 0.7, 1, 0.9],
  cellar: [0.8, 0.9, 1.1, 1],
  people: [0.85, 0.6, 0.8, 1],
  events: [1.25, 0.7, 1.35, 0.9],
  visit: [0.6, 0.5, 0.6, 1.2],
}
/** a chapter must hold this long before the room follows it */
const SETTLE_S = 0.7
const CUT_GAP_S = 1.2
const BLIP_GAP_S = 0.07
const CLINK_MIN_S = 3.5

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

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private fx!: GainNode
  private murmur!: GainNode
  private voiceA!: GainNode
  private voiceB!: GainNode
  private fizz!: GainNode
  private crackle!: GainNode
  private noise: AudioBuffer | null = null
  private toneOsc: OscillatorNode | null = null
  private toneGain: GainNode | null = null

  private chapter = 'hero'
  private slotIds: string[] = []
  private roomKey = ''
  private pendingKey = 'hero'
  private pendingSince = 0
  private lastCut = -10
  private lastBlip = -10
  private lastClink = -10
  private lastSpeedAt = -10
  private speed = 0
  private suspendTimer = 0
  private walkTimer = 0
  private clinkTimer = 0
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
    window.addEventListener('hark:sfx', e => {
      const d = (e as CustomEvent<{ kind?: string; level?: number }>).detail ?? {}
      const ctx = this.live()
      if (!ctx) return
      this.sfx(ctx, ctx.currentTime + 0.005, String(d.kind ?? 'tap'), clamp01(d.level ?? 1))
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

  /** Follow the story: each chapter sets how busy the room is (once it holds); scroll speed stirs it. */
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
    // ≈ 8×/s: a little more fizz and chatter while the story slides past
    if (now - this.lastSpeedAt > 0.12) {
      this.lastSpeedAt = now
      const s = clamp01(Math.abs(frame.velocity || 0) / 3)
      if (Math.abs(s - this.speed) > 0.04) {
        this.speed = s
        const r = ROOM[this.roomKey] ?? ROOM.hero
        const tc = s > 0.1 ? 0.2 : 0.8
        this.fizz.gain.setTargetAtTime(FIZZ_LEVEL * r[1] * (1 + 0.9 * s), now, tc)
        this.murmur.gain.setTargetAtTime(MURMUR_LEVEL * r[0] * (1 + 0.3 * s), now, tc)
      }
    }
  }

  /** A chapter cut: a needle drop (a touch lighter going back). */
  cut(from: number, to: number) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    const toId = this.slotIds[to]
    if (toId) {
      this.pendingKey = toId
      this.pendingSince = now
    }
    // a fast run of cuts: one drop, then the record waits for the story to settle
    if (now - this.lastCut < CUT_GAP_S) return
    this.lastCut = now
    this.needle(ctx, now + 0.012, NEEDLE_LEVEL * (to < from ? 0.75 : 1))
  }

  /** A small clink (nav, toggles): note i of E major pentatonic from E6. No-op while off. */
  blip(pitch = 0) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBlip < BLIP_GAP_S) return
    this.lastBlip = now
    const p = Math.max(0, Math.min(14, Math.round(Number.isFinite(pitch) ? pitch : 0)))
    const f = BLIP_ROOT * PENTA[p % 5] * Math.pow(2, Math.floor(p / 5)) * 0.5
    this.strike(ctx, now + 0.004, f, BLIP_LEVEL, 0.5, rand(-0.2, 0.2), 0.12)
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  /* ------------------------------------------------------------ internals */

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
        console.warn('[glory] audio unavailable', err)
      }
    }
    this.applyRunning()
    for (const fn of this.onChange) fn(on)
  }

  /** Resume + fade in, or fade out + suspend, from enabled / hidden. */
  private applyRunning() {
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
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, 0.4)
          this.pendingKey = this.chapter
          this.roomKey = ''
          this.setRoom(this.chapter, ctx, 0.6)
          this.startWalk()
          this.scheduleClink(rand(2, 5))
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.25)
      clearTimeout(this.walkTimer)
      clearTimeout(this.clinkTimer)
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
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) throw new Error('no WebAudio')
    const ctx = new AC({ latencyHint: 'playback' })
    this.ctx = ctx
    const sr = ctx.sampleRate

    // master → warm low-pass → gentle compressor → out
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const warm = ctx.createBiquadFilter()
    warm.type = 'lowpass'
    warm.frequency.value = 9000
    warm.Q.value = 0.5
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -22
    comp.knee.value = 12
    comp.ratio.value = 3
    comp.attack.value = 0.01
    comp.release.value = 0.3
    this.master.connect(warm).connect(comp).connect(ctx.destination)

    // one-shots: dry + a small room reverb
    this.fx = ctx.createGain()
    this.fx.connect(this.master)
    const verb = ctx.createConvolver()
    verb.buffer = this.roomImpulse(ctx, 1.1)
    const send = ctx.createGain()
    send.gain.value = REVERB_SEND
    this.fx.connect(send).connect(verb).connect(this.master)

    // shared noise (3 s, brown-tinted white) for the murmur and the pours
    const len = Math.floor(sr * 3)
    const nb = ctx.createBuffer(1, len, sr)
    const nd = nb.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      last = last * 0.6 + w * 0.4
      nd[i] = last * 1.4
    }
    this.noise = nb

    // murmur: noise → two broad voice formants, each wandering → a soft low-pass
    const src = ctx.createBufferSource()
    src.buffer = nb
    src.loop = true
    this.murmur = ctx.createGain()
    this.murmur.gain.value = 0
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1500
    const mk = (f: number, q: number) => {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = q
      const g = ctx.createGain()
      g.gain.value = 0.6
      src.connect(bp).connect(g).connect(lp)
      return g
    }
    this.voiceA = mk(320, 0.8)
    this.voiceB = mk(950, 1.1)
    lp.connect(this.murmur).connect(this.master)
    src.start()

    // fizz: a pre-rendered loop of bubble pops over a whisper of hiss
    const flen = Math.floor(sr * 4)
    const fb = ctx.createBuffer(2, flen, sr)
    for (let c = 0; c < 2; c++) {
      const d = fb.getChannelData(c)
      for (let i = 0; i < flen; i++) d[i] = (Math.random() * 2 - 1) * 0.02
      const pops = 260
      for (let k = 0; k < pops; k++) {
        const at = Math.floor(Math.random() * flen)
        const f = rand(2500, 7000)
        const dur = Math.floor(sr * rand(0.002, 0.007))
        const a = rand(0.08, 0.35)
        for (let j = 0; j < dur; j++) {
          const i = (at + j) % flen
          d[i] += a * Math.exp((-j / dur) * 5) * Math.sin((2 * Math.PI * f * j) / sr)
        }
      }
    }
    const fsrc = ctx.createBufferSource()
    fsrc.buffer = fb
    fsrc.loop = true
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2200
    this.fizz = ctx.createGain()
    this.fizz.gain.value = 0
    fsrc.connect(hp).connect(this.fizz).connect(this.master)
    fsrc.start()

    // vinyl: dust ticks and pops over surface hiss and platter rumble
    const clen = Math.floor(sr * 5)
    const cb = ctx.createBuffer(2, clen, sr)
    for (let c = 0; c < 2; c++) {
      const d = cb.getChannelData(c)
      let lpv = 0
      for (let i = 0; i < clen; i++) {
        lpv = lpv * 0.82 + (Math.random() * 2 - 1) * 0.18
        // surface hiss (soft, band-limited) + a slow rumble at the platter's turn (0.56 Hz, periodic in the loop)
        d[i] = lpv * 0.05 + Math.sin((2 * Math.PI * 0.6 * i) / sr) * Math.sin((2 * Math.PI * 38 * i) / sr) * 0.012
      }
      const ticks = 520
      for (let k = 0; k < ticks; k++) {
        const at = Math.floor(Math.random() * clen)
        // mostly tiny, now and then a fatter pop
        const big = Math.random() < 0.05
        const a = (big ? rand(0.35, 0.7) : rand(0.03, 0.2)) * (Math.random() < 0.5 ? -1 : 1)
        const dur = Math.floor(sr * (big ? rand(0.0012, 0.003) : rand(0.0002, 0.0009)))
        for (let j = 0; j < dur; j++) {
          const i = (at + j) % clen
          d[i] += a * Math.exp((-j / dur) * 4) * (j === 0 ? 1 : 0.6 * Math.cos(j * 1.3))
        }
      }
    }
    const csrc = ctx.createBufferSource()
    csrc.buffer = cb
    csrc.loop = true
    const chp = ctx.createBiquadFilter()
    chp.type = 'highpass'
    chp.frequency.value = 30
    const clp = ctx.createBiquadFilter()
    clp.type = 'lowpass'
    clp.frequency.value = 5200
    this.crackle = ctx.createGain()
    this.crackle.gain.value = 0
    csrc.connect(chp).connect(clp).connect(this.crackle).connect(this.master)
    csrc.start()

    this.applyTone()
  }

  /** a short, warm room: decaying stereo noise with a few early reflections */
  private roomImpulse(ctx: AudioContext, seconds: number) {
    const sr = ctx.sampleRate
    const len = Math.floor(sr * seconds)
    const b = ctx.createBuffer(2, len, sr)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      let lpv = 0
      for (let i = 0; i < len; i++) {
        const t = i / len
        lpv = lpv * 0.55 + (Math.random() * 2 - 1) * 0.45
        d[i] = lpv * Math.pow(1 - t, 2.4) * 0.6
      }
      for (const ms of [11, 17, 23, 31, 43]) {
        const i = Math.floor((ms + c * 3) * 0.001 * sr)
        if (i < len) d[i] += rand(0.2, 0.4) * (Math.random() < 0.5 ? -1 : 1)
      }
    }
    return b
  }

  private setRoom(id: string, ctx: AudioContext, tc: number) {
    this.roomKey = id
    const r = ROOM[id] ?? ROOM.hero
    const now = ctx.currentTime
    this.murmur.gain.setTargetAtTime(MURMUR_LEVEL * r[0], now, tc)
    this.fizz.gain.setTargetAtTime(FIZZ_LEVEL * r[1], now, tc)
    this.crackle.gain.setTargetAtTime(CRACKLE_LEVEL * r[3], now, tc)
  }

  /** the crowd's two voices wander on their own slow random walks */
  private startWalk() {
    clearTimeout(this.walkTimer)
    const step = () => {
      const ctx = this.live()
      if (!ctx) return
      const now = ctx.currentTime
      this.voiceA.gain.setTargetAtTime(rand(0.35, 1), now, rand(0.4, 1.2))
      this.voiceB.gain.setTargetAtTime(rand(0.2, 0.85), now, rand(0.3, 1))
      this.walkTimer = window.setTimeout(step, rand(450, 1100))
    }
    step()
  }

  /** somewhere in the room two glasses touch; next one in a while */
  private scheduleClink(inS: number) {
    clearTimeout(this.clinkTimer)
    this.clinkTimer = window.setTimeout(() => {
      const ctx = this.live()
      if (!ctx) return
      const now = ctx.currentTime
      const rate = (ROOM[this.roomKey] ?? ROOM.hero)[2]
      if (now - this.lastClink >= CLINK_MIN_S) {
        this.lastClink = now
        this.clink(ctx, now + 0.01, CLINK_LEVEL * rand(0.45, 1), rand(-0.7, 0.7))
      }
      this.scheduleClink(rand(6, 16) / rate)
    }, inS * 1000)
  }

  /* ------------------------------------------------------------ voices */

  /** one strike on a glass: its partials ring out, with a tiny contact tick */
  private strike(ctx: AudioContext, t: number, f: number, level: number, ring: number, pan: number, wet = 1) {
    const out = ctx.createGain()
    out.gain.value = 1
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null
    if (p) {
      p.pan.value = Math.max(-1, Math.min(1, pan))
      out.connect(p).connect(this.fx)
    } else out.connect(this.fx)
    // a drier strike for UI: most of it bypasses the reverb send
    let head: GainNode = out
    let dry: GainNode | null = null
    if (wet < 1) {
      out.gain.value = wet
      head = ctx.createGain()
      dry = ctx.createGain()
      dry.gain.value = 1 - wet
      head.connect(out)
      head.connect(dry).connect(this.master)
    }
    this.partials(ctx, t, f, level, ring, head)
    // contact tick
    if (this.noise) {
      const n = ctx.createBufferSource()
      n.buffer = this.noise
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 5000
      const g = ctx.createGain()
      g.gain.setValueAtTime(level * 0.5, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012)
      n.connect(hp).connect(g).connect(head)
      n.start(t, Math.random() * 2, 0.02)
    }
    window.setTimeout(() => {
      out.disconnect()
      head.disconnect()
      dry?.disconnect()
    }, (ring * 2 + 0.5) * 1000)
  }

  private partials(ctx: AudioContext, t: number, f: number, level: number, ring: number, dest: AudioNode) {
    GLASS.forEach((r, k) => {
      const hz = f * r * rand(0.997, 1.003)
      if (hz > 16000) return
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz
      const g = ctx.createGain()
      const a = level / (1 + k * 1.4)
      const dur = ring / (1 + k * 0.9)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(a, t + 0.002)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g).connect(dest)
      o.start(t)
      o.stop(t + dur + 0.02)
    })
  }

  /** two glasses touch: a pair of strikes a few ms apart, a little apart in pitch */
  private clink(ctx: AudioContext, t: number, level: number, pan: number) {
    const f = rand(1500, 2600)
    this.strike(ctx, t, f, level, rand(0.6, 1.1), pan)
    this.strike(ctx, t + rand(0.008, 0.03), f * rand(1.07, 1.22), level * 0.8, rand(0.5, 0.9), pan + rand(-0.1, 0.1))
  }

  /** a short pour: the stream's pitch climbs as the glass fills, and it glugs */
  private pour(ctx: AudioContext, t: number, level: number, dur: number) {
    if (!this.noise) return
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 2.2
    bp.frequency.setValueAtTime(520, t)
    bp.frequency.exponentialRampToValueAtTime(1500, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.07)
    g.gain.setTargetAtTime(level * 0.7, t + 0.1, 0.3)
    g.gain.setTargetAtTime(0.0001, t + dur - 0.08, 0.08)
    n.connect(bp).connect(g).connect(this.fx)
    n.start(t, Math.random() * 1.5, dur + 0.6)
    // glugs: a few rising bubble chirps, higher as it fills
    const count = 3 + Math.floor(Math.random() * 2)
    for (let i = 0; i < count; i++) this.glug(ctx, t + 0.08 + (i / count) * dur * 0.8 + rand(0, 0.05), 240 + i * 70 + rand(-20, 20), level * 0.7)
  }

  private glug(ctx: AudioContext, t: number, f: number, level: number) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f, t)
    o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.05)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075)
    o.connect(g).connect(this.fx)
    o.start(t)
    o.stop(t + 0.1)
  }

  /** the stylus meets the record: a soft low thump, a brush of contact, a swell of crackle */
  private needle(ctx: AudioContext, t: number, level: number) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(72, t)
    o.frequency.exponentialRampToValueAtTime(38, t + 0.14)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + 0.25)
    if (this.noise) {
      const n = ctx.createBufferSource()
      n.buffer = this.noise
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1800
      bp.Q.value = 0.8
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.0001, t)
      ng.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.004)
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
      n.connect(bp).connect(ng).connect(this.master)
      n.start(t, Math.random() * 2, 0.12)
    }
    const base = CRACKLE_LEVEL * (ROOM[this.roomKey] ?? ROOM.hero)[3]
    this.crackle.gain.setTargetAtTime(base * 2.2, t, 0.02)
    this.crackle.gain.setTargetAtTime(base, t + 0.25, 0.35)
  }

  /** a glass set down on the bar: a soft low knock */
  private thud(ctx: AudioContext, t: number, level: number) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(70, t + 0.09)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g).connect(this.fx)
    o.start(t)
    o.stop(t + 0.2)
    this.strike(ctx, t, rand(900, 1200), level * 0.25, 0.25, 0)
  }

  private sfx(ctx: AudioContext, t: number, kind: string, level: number) {
    switch (kind) {
      case 'needle':
        return this.needle(ctx, t, NEEDLE_LEVEL * level)
      case 'clink':
        return this.clink(ctx, t, CLINK_LEVEL * 1.3 * level, rand(-0.3, 0.3))
      case 'pour':
        return this.pour(ctx, t, POUR_LEVEL * level, 0.95)
      case 'glug':
        return this.glug(ctx, t, rand(220, 380), POUR_LEVEL * 0.8 * level)
      case 'thud':
        return this.thud(ctx, t, 0.08 * level)
      case 'fizz': {
        const now = ctx.currentTime
        const base = FIZZ_LEVEL * (ROOM[this.roomKey] ?? ROOM.hero)[1]
        this.fizz.gain.setTargetAtTime(base * (1 + 2 * level), now, 0.05)
        this.fizz.gain.setTargetAtTime(base, now + 0.6, 0.5)
        return
      }
      default:
        return this.strike(ctx, t, rand(1700, 2300), BLIP_LEVEL * level, 0.45, rand(-0.2, 0.2), 0.3)
    }
  }

  private applyTone() {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    if (this.toneLevel > 0 && !this.toneOsc) {
      this.toneOsc = ctx.createOscillator()
      this.toneOsc.type = 'sine'
      this.toneGain = ctx.createGain()
      this.toneGain.gain.value = 0
      this.toneOsc.connect(this.toneGain).connect(this.master)
      this.toneOsc.start()
    }
    if (!this.toneOsc || !this.toneGain) return
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.05)
    this.toneGain.gain.setTargetAtTime(TONE_MAX * this.toneLevel, now, 0.12)
  }
}
