/*
 * ?diag — an on-screen boot trace for phones (no devtools needed): every boot
 * phase with its time since page start, plus any error / rejected promise /
 * console.error. Costs nothing without the param.
 */
const ON = typeof location !== 'undefined' && new URLSearchParams(location.search).has('diag')
const lines: string[] = []
let box: HTMLElement | null = null

function paint() {
  if (!box && document.body) {
    box = document.createElement('pre')
    box.style.cssText =
      'position:fixed;left:0;top:0;right:0;z-index:9999;margin:0;padding:6px 8px;max-height:60vh;overflow:auto;' +
      'font:10px/1.35 -apple-system,system-ui,sans-serif;color:#e8f4d8;background:rgba(0,0,0,.78);pointer-events:none;white-space:pre-wrap'
    document.body.appendChild(box)
  }
  if (box) box.textContent = lines.join('\n')
}

/** Record a boot step (no-op unless ?diag). */
export function trace(msg: string) {
  if (!ON) return
  const line = `${(performance.now() / 1000).toFixed(2)}s  ${msg}`
  lines.push(line)
  console.info('[boot]', line)
  paint()
}

/** Time an async step. */
export async function traced<T>(label: string, p: Promise<T> | T): Promise<T> {
  if (!ON) return p
  const t = performance.now()
  try {
    return await p
  } finally {
    trace(`${label} ${Math.round(performance.now() - t)} ms`)
  }
}

export const diag = ON

if (ON) {
  window.addEventListener('error', e => trace(`ERROR ${e.message}`))
  window.addEventListener('unhandledrejection', e => trace(`REJECTED ${String((e as PromiseRejectionEvent).reason).slice(0, 240)}`))
  const ce = console.error.bind(console)
  console.error = (...a: unknown[]) => {
    trace(`console.error ${a.map(x => (x instanceof Error ? x.message : String(x))).join(' ').slice(0, 240)}`)
    ce(...a)
  }
  const ua = navigator.userAgent
  trace(`start  ${innerWidth}x${innerHeight} dpr ${devicePixelRatio}  ${/iPhone|iPad|Android/.test(ua) ? ua.replace(/.*\((.*?)\).*/, '$1') : 'desktop'}`)
}
