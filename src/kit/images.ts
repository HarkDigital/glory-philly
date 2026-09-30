import * as THREE from 'three'

/*
 * Screenshot loading that never janks (lessons from the Town/Press reviews):
 *  - don't await images in init (the site reveal waits for init)
 *  - decode OFF the main thread and resize at decode time
 *    (fetch → blob → createImageBitmap({ resizeWidth, resizeHeight }))
 *  - hand three a CanvasTexture (flipY works; ImageBitmap textures ignore it)
 *  - fall back to <img> + decode() where createImageBitmap resize is missing
 *
 *   const tex = placeholderTexture()           // bind this immediately
 *   whenRevealed().then(() => loadScreenshot(workImage(id), { width: 800 }))
 *     .then(t => { material.map = t; material.needsUpdate = true })
 */

/** Resolves once the loader has finished (window 'hark:reveal'), immediately if it already has. */
export function whenRevealed(): Promise<void> {
  if (document.documentElement.dataset.ready === '1') return Promise.resolve()
  return new Promise(r => window.addEventListener('hark:reveal', () => r(), { once: true }))
}

/** A 1×1 texture to bind until the real image arrives. */
export function placeholderTexture(color = '#1a1d24'): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const x = c.getContext('2d')!
  x.fillStyle = color
  x.fillRect(0, 0, 1, 1)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export interface LoadScreenshotOpts {
  /** output width in px (default 800) */
  width?: number
  /**
   * keep the photo's own aspect ratio (height = width × h/w of the source).
   * Default false: the texture is 16:10 (width × 0.625), as the site's
   * screen-shaped callers expect. Either way `texture.userData.aspect` is w/h.
   */
  keepAspect?: boolean
}

/**
 * Load an image as a texture, decoded off the main thread and resized to
 * `width` — 16:10 by default, or the photo's own aspect with `keepAspect`.
 * Rejects on network errors.
 *
 *   loadScreenshot('photos/wall-sign.webp', { width: 1024, keepAspect: true })
 *     .then(t => { mat.map = t; mesh.scale.y = 1 / t.userData.aspect })
 */
export async function loadScreenshot(url: string, { width = 800, keepAspect = false }: LoadScreenshotOpts = {}): Promise<THREE.Texture> {
  let source: CanvasImageSource
  let w = width
  let h = Math.round(width * 0.625)
  try {
    const blob = await (await fetch(url)).blob()
    if (keepAspect) {
      // width only: the decoder keeps the aspect (and if a browser ignores the
      // hint, the bitmap's own size still gives it)
      const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeQuality: 'high' })
      h = Math.max(1, Math.round((w * bmp.height) / bmp.width))
      source = bmp
    } else {
      const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      source = bmp
    }
  } catch {
    const img = new Image()
    img.src = url
    await img.decode()
    h = Math.round((w * img.naturalHeight) / img.naturalWidth)
    source = img
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(source, 0, 0, w, h)
  if ('close' in source && typeof (source as ImageBitmap).close === 'function') (source as ImageBitmap).close()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.userData.aspect = w / h
  // once on the GPU the canvas is dead weight (~2.6 MB each): shrink it. A lost
  // context reloads the page, so nothing ever needs to re-upload it.
  tex.onUpdate = () => {
    c.width = c.height = 1
    tex.onUpdate = null
  }
  return tex
}
