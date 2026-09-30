import * as THREE from 'three'
import { drawCover, loadCover, onFonts, scheme, type CoverSource, type CoverSpec } from '../../kit/vinyl'

/*
 * A portrait ALBUM COVER, drawn in the kit's house style (drawCover: the
 * full-bleed photo, the GLORY RECORDS header, the cream band with the name,
 * role and the G roundel) on our own canvas, so the crop is ours to choose.
 *
 * Portraits are never stretched: the photo is loaded keeping its aspect
 * (loadCover square: false) and cover-cropped once, into the cover's photo
 * area, at a per-portrait `focus` chosen so the whole face (hair to chin)
 * sits clear of the header line and the band. A dark stand-in holds the
 * band's layout until the photo lands; the canvas is freed after the final
 * upload (fonts + photo).
 */

const stand = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const g = c.getContext('2d')!
  g.fillStyle = '#1e1714'
  g.fillRect(0, 0, 2, 2)
  return c as CoverSource
})()

export interface PortraitCover {
  texture: THREE.CanvasTexture
  /** start loading the photo (call once: first cover now, the rest after reveal) */
  load(): void
}

/**
 * `foot`: the share of the cover hidden behind a display ledge's lip. The
 * cream band (name, role, roundel) is drawn that much higher, over the foot
 * of the photo, with plain band paper below it, so the name clears the steel.
 */
export function portraitCover(spec: CoverSpec, url: string, res = 1024, foot = 0): PortraitCover {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = res
  const ctx = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  let photo: CoverSource | null = null
  let freed = false
  const draw = () => {
    if (freed) return
    const s = { ...spec, photo: photo ?? stand }
    drawCover(ctx, 0, 0, res, s)
    const lift = Math.round(res * foot)
    if (lift > 0) {
      // the band (drawCover's cream foot, 20.6% of the cover) again, `lift` higher
      const top = Math.floor(res * (1 - 0.206)) - lift
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, top, res, res - lift - top)
      ctx.clip()
      drawCover(ctx, 0, -lift, res, s)
      ctx.restore()
      ctx.fillStyle = scheme(spec.paper ?? 'cream').paper
      ctx.fillRect(0, res - lift, res, lift)
    }
    texture.needsUpdate = true
  }
  draw()
  const fonts = onFonts(draw)
  let photoDone: () => void = () => {}
  const photoP = new Promise<void>(r => (photoDone = r))
  Promise.all([fonts, photoP]).then(() => {
    draw()
    const p = photo as (CoverSource & { close?: () => void }) | null
    p?.close?.()
    texture.onUpdate = () => {
      freed = true
      canvas.width = canvas.height = 1
      texture.onUpdate = null
    }
  })
  let started = false
  return {
    texture,
    load() {
      if (started) return
      started = true
      loadCover(url, { size: Math.min(900, res), square: false })
        .then(p => {
          photo = p
          draw()
        })
        .catch(err => console.warn(`[people] cover photo failed: ${url}`, err))
        .finally(() => photoDone())
    },
  }
}
