// GLORY fonts: Alfa Slab One (display — the heavy slab of a painted wall
// sign: GLORY on the brick), Inter Tight for reading, and Inter Tight caps
// for prices, tap numbers and the HUD. No serif/italic accent face and no
// IBM Plex Mono (Mike, 2026-09-30).
import '@fontsource/alfa-slab-one'
import '@fontsource-variable/inter-tight'
import './styles/base.css'
import './ui/ui.css'

import { installPrintPolyfills } from './ui/polyfills'
import { Engine } from './core/Engine'
import { CHAPTERS } from './chapters/index'
import { createLoader } from './ui/loader'
import { createChrome } from './ui/chrome'
import { Sound } from './ui/sound'
import { renderFallback } from './ui/fallback'
import { mountDebug } from './core/debug'
import { trace } from './core/boottrace'
import { publicUrl } from './core/assets'

/*
 * URL params (handy for review + screenshots):
 *   ?nointro            skip the loader animation
 *   ?c=work&l=0.5       jump to a chapter at local progress
 *   ?p=0.42             jump to global progress
 *   ?only=work          init only that chapter (fast dev loop)
 *   ?debug              fps / chapter / progress readout
 */
const params = new URLSearchParams(location.search)

declare global {
  interface Window {
    __hark?: {
      ready: boolean
      engine: Engine
      goto: (p: number) => void
      /** exact jump (screenshots, tests) */
      gotoChapter: (id: string, local?: number) => void
      /** visitor navigation: lands just past the cut on settled copy; long jumps cut */
      land: (id: string, smooth?: boolean, local?: number) => void
    }
  }
}

installPrintPolyfills()

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement
  const track = document.getElementById('track')!
  let stages = document.getElementById('stages')
  if (!stages) {
    stages = document.createElement('div')
    stages.id = 'stages'
    document.body.insertBefore(stages, document.getElementById('chrome'))
  }
  if (!Engine.supported()) {
    canvas.remove()
    document.getElementById('loader')?.remove()
    renderFallback(track)
    return
  }
  const loader = createLoader(document.getElementById('loader')!, { skip: params.has('nointro') })

  const engine = new Engine(canvas, track, stages)
  // the GPU context is gone for good: show the static copy, not an empty canvas
  engine.onContextGone = () => {
    canvas.remove()
    stages?.remove()
    renderFallback(track)
  }
  engine.assets.onProgress = (done, total) => loader.progress(total ? done / total : 0)
  if (document.fonts?.ready) engine.assets.track(document.fonts.ready)
  // lazy boot: build the chapter the visitor lands on first, the rest after the reveal
  const firstChapter = (() => {
    const c = params.get('c')
    if (c && CHAPTERS.some(ch => ch.id === c)) return c
    const h = location.hash.slice(1)
    if (h && CHAPTERS.some(ch => ch.id === h)) return h
    const p = parseFloat(params.get('p') ?? '')
    if (Number.isFinite(p)) {
      const total = CHAPTERS.reduce((a, ch) => a + ch.length, 0)
      let at = 0
      for (const ch of CHAPTERS) if ((at += ch.length) >= p * total) return ch.id
    }
    return CHAPTERS[0].id
  })()
  // Cold phones spend seconds building GPU pipelines for the first room (Safari
  // does it on first draw). Reveal as soon as the hero is built: its live copy
  // runs over a still of its own first frame (public/posters, made with
  // scripts/poster.mjs) while the 3D warms behind, then the canvas takes over.
  const early = firstChapter === 'hero' && !params.get('only')
  let poster: HTMLImageElement | null = null
  if (early) {
    poster = document.createElement('img')
    poster.className = 'boot-poster'
    poster.alt = ''
    poster.decoding = 'async'
    poster.src = publicUrl(innerWidth < innerHeight ? 'posters/hero-port.webp' : 'posters/hero-land.webp')
    canvas.after(poster)
  }
  await engine.load(CHAPTERS, params.get('only'), firstChapter, { early })
  if (poster) {
    const p = poster
    // only while the visitor is still on the hero (it's a still of the hero)
    engine.onFrame.push((_f, st) => p.classList.toggle('is-away', st.index !== 0))
  }

  // skip link mid-story: focus the current chapter's heading (no jump to the hero)
  document.querySelector<HTMLAnchorElement>('.skip-link')?.addEventListener('click', e => {
    const cur = engine.slots[engine.state.index]
    if (!cur) return
    e.preventDefault()
    engine.focusChapter(cur.def.id)
  })

  const sound = new Sound()
  const chrome = createChrome(document.getElementById('chrome')!, engine, sound)
  engine.onFrame.push((f, s) => {
    chrome.update(f, s)
    sound.update(f, s)
  })
  engine.onCut.push((a, b) => sound.cut(a, b))

  const p = params.get('p')
  const c = params.get('c')
  const hash = location.hash.slice(1)
  if (p) engine.goto(parseFloat(p))
  else if (c) engine.gotoChapter(c, parseFloat(params.get('l') ?? '0'))
  else if (hash && CHAPTERS.some(ch => ch.id === hash)) engine.land(hash, false)
  else engine.goto(0)

  trace('engine start')
  engine.start()
  window.__hark = {
    ready: false,
    engine,
    goto: p => engine.goto(p),
    gotoChapter: (id, l = 0) => engine.gotoChapter(id, l),
    land: (id, smooth = true, local) => engine.land(id, smooth, local),
  }
  if (params.has('debug')) mountDebug(engine)

  trace('loader finish…')
  await loader.finish()
  trace('revealed')
  document.documentElement.dataset.ready = '1'
  window.dispatchEvent(new Event('hark:reveal'))
  void engine.bootReady.then(() => {
    trace('first chapter live')
    if (poster) {
      poster.classList.add('is-gone')
      const p = poster
      window.setTimeout(() => p.remove(), 1000)
    }
    return engine.loadRest()
  })
  window.__hark.ready = true
}

boot().catch(err => {
  console.error('[hark] boot failed', err)
  const track = document.getElementById('track')
  if (track) renderFallback(track)
  document.getElementById('loader')?.remove()
})
