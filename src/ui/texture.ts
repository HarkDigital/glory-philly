/*
 * Small tiles for the DOM layer (the menu dialog, the rotate card, the event
 * form's card, the fallback page), so the UI and the 3D room share one
 * language:
 *
 *   brick   OLD PHILADELPHIA BRICK after dark: running bond, dusty red-brown
 *           bricks, recessed mortar (opaque; CSS washes it dark). 320 x 160,
 *           meant at 160 x 80 CSS px.
 *   paper   MENU-CARD STOCK: the fibre and speckle of an uncoated cream card,
 *           as a transparent overlay on a flat cream. 160 x 160.
 *
 * They are BAKED files (tiles/*.webp, lossless; the procedural painter is
 * tiles/bake.ts, dev only): painting them per pixel and PNG-encoding at boot
 * cost ~35–60 ms of main thread (review P20). CSS reads them as --tx-brick /
 * --tx-paper and falls back to its flat colour until (or unless) they load.
 */
import brickUrl from './tiles/brick.webp'
import paperUrl from './tiles/paper.webp'

type Tile = 'brick' | 'paper'
const TILES: Record<Tile, string> = { brick: brickUrl, paper: paperUrl }

/** `url("…")` for CSS, or 'none' when there is no file. */
export const cssUrl = (u: string) => (u ? `url("${u}")` : 'none')

/** fetch + decode the published tiles once the story is up (idle time), so the menu opens on its brick */
const warmed = new Set<Tile>()
function warm(k: Tile) {
  if (warmed.has(k)) return
  warmed.add(k)
  const go = () => {
    const img = new Image()
    img.decoding = 'async'
    img.src = TILES[k]
  }
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  const later = () => (idle ? idle(go, { timeout: 4000 }) : window.setTimeout(go, 1500))
  if (document.documentElement.dataset.ready === '1') later()
  else window.addEventListener('hark:reveal', later, { once: true })
}

/**
 * Publish the tiles as CSS custom properties on :root (--tx-brick,
 * --tx-paper), in a <style> of their own — not on <html>'s inline style,
 * which the hero writes its glass rect to. No canvas work: just the URLs.
 */
export function publishTextures(which: Tile[]) {
  let el = document.getElementById('glory-textures') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'glory-textures'
    document.head.appendChild(el)
  }
  const have = el.textContent ?? ''
  let add = ''
  for (const k of which) {
    const name = `--tx-${k}`
    if (have.includes(`${name}:`) || add.includes(`${name}:`)) continue
    add += `${name}:${cssUrl(TILES[k])};`
    warm(k)
  }
  if (add) el.textContent = `${have}:root{${add}}`
}
