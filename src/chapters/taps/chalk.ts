import * as THREE from 'three'
import { FONT } from '../../kit/vinyl'

/*
 * The "Last Update" chalkboard that hangs on the last column of the tap wall:
 * "DRAFTS / LAST UPDATE / 2026-09-28 / 36 TAPS" in chalk on slate, in a
 * reclaimed-walnut frame (the room kit's planks). Type follows Mike's rules:
 * the title and the date in the sign's slab (Alfa Slab One), the labels in
 * Inter Tight tracked caps — no italic serif anywhere.
 *
 * This is the slate face only, in METRES (the room kit's unit): the chapter
 * hangs it inside the room kit's builder, which frames it in walnut (the
 * kit's planks) and lets the bulbs' light pools reach it. Canvas text:
 * redraw() after fonts load and again on document.fonts.ready.
 */

const CW = 1024
const CH = 720

export interface Chalkboard {
  group: THREE.Group
  /** the meshes whose materials the room's light pools should reach */
  meshes: THREE.Mesh[]
  materials: THREE.MeshStandardMaterial[]
  /** the slate's size (metres; the frame goes round it) */
  width: number
  height: number
  redraw(): void
  dispose(): void
}

export function makeChalkboard({ w = 0.36, title, label, date, count }: { w?: number; title: string; label: string; date: string; count: string }): Chalkboard {
  const h = (w * CH) / CW
  const group = new THREE.Group()
  const cv = document.createElement('canvas')
  cv.width = CW
  cv.height = CH
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  const tracked = (g: CanvasRenderingContext2D, px: number) => {
    ;(g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`
  }
  const redraw = () => {
    const g = cv.getContext('2d')!
    // slate with old chalk haze
    g.fillStyle = '#171816'
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
    // chalk type: slab title and date, Inter Tight tracked caps for the labels
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.fillStyle = '#f1ece0'
    tracked(g, 2)
    g.font = `400 112px ${FONT.display}`
    g.fillText(title, CW / 2, 172)
    g.fillStyle = '#f0a53a'
    g.fillRect(CW / 2 - 150, 214, 300, 5)
    g.fillStyle = '#f1ece0'
    tracked(g, 14)
    g.font = `600 40px ${FONT.sans}`
    g.fillText(label.toUpperCase(), CW / 2 + 7, 318)
    tracked(g, 0)
    g.font = `400 124px ${FONT.display}`
    g.fillText(date, CW / 2, 468)
    g.fillStyle = '#e8c07a'
    tracked(g, 12)
    g.font = `600 44px ${FONT.sans}`
    g.fillText(count.toUpperCase(), CW / 2 + 6, 604)
    tracked(g, 0)
    // chalk grain: knock specks out of everything drawn
    g.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.3})`
      g.fillRect(rnd() * CW, rnd() * CH, 1 + rnd() * 2.5, 1 + rnd() * 1.5)
    }
    g.globalCompositeOperation = 'destination-over'
    g.fillStyle = '#171816'
    g.fillRect(0, 0, CW, CH)
    g.globalCompositeOperation = 'source-over'
    tex.needsUpdate = true
  }
  redraw()

  const boardMat = new THREE.MeshStandardMaterial({ map: tex, color: '#9a9690', roughness: 0.92, envMapIntensity: 0.2 })
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), boardMat)
  board.position.z = 0.012
  group.add(board)
  return {
    group,
    meshes: [board],
    materials: [boardMat],
    width: w,
    height: h,
    redraw,
    dispose() {
      board.geometry.dispose()
      boardMat.dispose()
      tex.dispose()
    },
  }
}
