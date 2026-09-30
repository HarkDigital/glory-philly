// Capture the first chapter's landing frame WITHOUT any DOM (copy, chrome) as
// the boot poster main.ts shows while the 3D warms on a cold visit.
//   node scripts/poster.mjs [port]   (serve a production build: npx vite build && npx vite preview --port <port>)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
const port = process.argv[2] || '7080'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] })
for (const [name, vp] of [
  ['hero-land', { width: 1440, height: 900, deviceScaleFactor: 1 }],
  ['hero-port', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const p = await b.newPage()
  await p.setViewport(vp)
  await p.goto(`http://localhost:${port}/?nointro&c=hero&l=0`, { waitUntil: 'load' })
  await p.waitForFunction('window.__hark && window.__hark.ready && window.__hark.engine.allReady', { timeout: 240000 })
  await p.addStyleTag({ content: '#stages,#chrome,#loader,.skip-link,.boot-poster{opacity:0!important}' })
  await new Promise(r => setTimeout(r, 2500))
  const png = `/tmp/${name}.png`
  await p.screenshot({ path: png })
  execFileSync('python3', ['-c', `from PIL import Image; Image.open('${png}').convert('RGB').save('public/posters/${name}.webp', quality=74, method=6)`])
  console.log('saved public/posters/' + name + '.webp')
  await p.close()
}
await b.close()
