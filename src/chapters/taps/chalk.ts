import * as THREE from 'three'
import { woodMaps } from '../../kit/bar'

/*
 * The chalkboard at the end of the tap wall: "Drafts / Last Update /
 * 2026-09-28" in chalk on slate, in an oiled-wood frame. Canvas text:
 * redraw() after fonts load and again on document.fonts.ready.
 */

const CW = 1024
const CH = 720

export interface Chalkboard {
  group: THREE.Group
  redraw(): void
  dispose(): void
}

export function makeChalkboard({ w = 1.5, title, label, date, count }: { w?: number; title: string; label: string; date: string; count: string }): Chalkboard {
  const h = (w * CH) / CW
  const group = new THREE.Group()
  const cv = document.createElement('canvas')
  cv.width = CW
  cv.height = CH
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  const redraw = () => {
    const g = cv.getContext('2d')!
    // slate with old chalk haze
    g.fillStyle = '#1b1c1a'
    g.fillRect(0, 0, CW, CH)
    let seed = 17
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 26; i++) {
      const x = rnd() * CW
      const y = rnd() * CH
      const r = 60 + rnd() * 200
      const gr = g.createRadialGradient(x, y, 0, x, y, r)
      gr.addColorStop(0, 'rgba(230,226,214,0.07)')
      gr.addColorStop(1, 'rgba(230,226,214,0)')
      g.fillStyle = gr
      g.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // chalk type
    g.fillStyle = '#f1ece0'
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.font = 'italic 400 128px "Instrument Serif", Georgia, serif'
    g.fillText(title, CW / 2, 190)
    g.fillStyle = '#f0a53a'
    g.fillRect(CW / 2 - 150, 232, 300, 5)
    g.fillStyle = '#f1ece0'
    g.font = '600 40px "Inter Tight Variable", "Inter Tight", system-ui, sans-serif'
    g.fillText(label.toUpperCase().split('').join(' '), CW / 2, 340)
    g.font = '400 118px "Alfa Slab One", Georgia, serif'
    g.fillText(date, CW / 2, 480)
    g.font = 'italic 400 64px "Instrument Serif", Georgia, serif'
    g.fillStyle = '#e8c07a'
    g.fillText(count, CW / 2, 610)
    // chalk grain: knock specks out of everything drawn
    g.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.3})`
      g.fillRect(rnd() * CW, rnd() * CH, 1 + rnd() * 2.5, 1 + rnd() * 1.5)
    }
    g.globalCompositeOperation = 'destination-over'
    g.fillStyle = '#1b1c1a'
    g.fillRect(0, 0, CW, CH)
    g.globalCompositeOperation = 'source-over'
    tex.needsUpdate = true
  }
  redraw()

  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, color: '#8c8a86', roughness: 0.95, envMapIntensity: 0.2 }))
  board.receiveShadow = true
  const { map } = woodMaps()
  const frameMat = new THREE.MeshStandardMaterial({ map, roughness: 0.5, color: '#b08868' })
  const t = 0.07
  const bars: [number, number, number, number][] = [
    [0, h / 2 + t / 2, w + 2 * t, t],
    [0, -h / 2 - t / 2, w + 2 * t, t],
    [-w / 2 - t / 2, 0, t, h],
    [w / 2 + t / 2, 0, t, h],
  ]
  for (const [x, y, bw, bh] of bars) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.05), frameMat)
    b.position.set(x, y, 0.015)
    b.castShadow = true
    group.add(b)
  }
  // chalk ledge
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.03, 0.09), frameMat)
  ledge.position.set(0, -h / 2 - t - 0.01, 0.04)
  group.add(board, ledge)

  return {
    group,
    redraw,
    dispose() {
      group.traverse(o => (o as THREE.Mesh).geometry?.dispose())
      ;(board.material as THREE.Material).dispose()
      frameMat.dispose()
      tex.dispose()
    },
  }
}
