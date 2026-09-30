import * as THREE from 'three'
import { makeGlass, type BeerStyle, type Glass } from '../../kit/beer'
import { clamp, smoothstep } from '../../core/math'

/*
 * WINE ON TAP: "a dedicated tap system to red, white and rosé wine" — a
 * stainless tower (two columns, a cross tube, three faucets with short lever
 * handles) over a drip tray, pouring into three stemmed glasses (the kit's
 * goblet, drawn taller and narrower; no foam).
 */

export const WINES: BeerStyle[] = [
  { color: '#a3122a', depth: 0.2, foam: '#a3122a' },
  { color: '#f6e7a4', depth: 2.2, foam: '#f4ecd0' },
  { color: '#ff9c9c', depth: 0.8, foam: '#f7dada' },
]
/** display colours for the HUD dots */
export const WINE_DOTS = ['#8a1a26', '#e9d58a', '#f29a9a']

export const TAP_X = [-0.85, 0, 0.85]
const TUBE_Y = 2.25
const TOWER_Z = -0.3
const SHANK = 0.3
const TRAY_TOP = 0.07
const GLASS_S = { x: 0.9, y: 1.12 }

export interface WineTower {
  group: THREE.Group
  glasses: Glass[]
  /** pour progress per tap 0..1 (fills, streams, handles) */
  set(pour: number[], time: number, reduced: boolean): void
  /** world position of glass i's bowl */
  glassPos(i: number, out: THREE.Vector3): THREE.Vector3
}

export function makeWineTower(): WineTower {
  const group = new THREE.Group()
  const steel = new THREE.MeshPhysicalMaterial({ color: '#dfe3e6', metalness: 1, roughness: 0.14, envMapIntensity: 1.35, clearcoat: 0.3 })
  const brushed = new THREE.MeshPhysicalMaterial({ color: '#b9bec2', metalness: 1, roughness: 0.34, envMapIntensity: 1.1 })
  const black = new THREE.MeshStandardMaterial({ color: '#0f0c0b', roughness: 0.35, metalness: 0.2 })

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = shadow
    m.receiveShadow = true
    group.add(m)
    return m
  }
  // drip tray with a slotted grate
  add(new THREE.BoxGeometry(2.9, 0.06, 1.0), brushed, 0, 0.03, 0.05)
  for (let i = 0; i < 22; i++) add(new THREE.BoxGeometry(0.035, 0.012, 0.86), black, -1.3 + (i * 2.6) / 21, 0.062, 0.05, false)
  // columns + feet
  for (const sx of [-1.3, 1.3]) {
    add(new THREE.CylinderGeometry(0.075, 0.075, TUBE_Y, 24), steel, sx, TUBE_Y / 2, TOWER_Z)
    add(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 28), steel, sx, 0.025, TOWER_Z)
  }
  // cross tube with end caps
  const tube = add(new THREE.CylinderGeometry(0.1, 0.1, 2.9, 32), steel, 0, TUBE_Y, TOWER_Z)
  tube.rotation.z = Math.PI / 2
  for (const sx of [-1.45, 1.45]) add(new THREE.SphereGeometry(0.1, 20, 12), steel, sx, TUBE_Y, TOWER_Z)

  const handles: THREE.Group[] = []
  const streams: THREE.Mesh[] = []
  const glasses: Glass[] = []
  const streamMats: THREE.MeshPhysicalMaterial[] = []
  TAP_X.forEach((x, i) => {
    // shank toward the viewer, faucet body, spout
    const sh = add(new THREE.CylinderGeometry(0.038, 0.038, SHANK, 20), steel, x, TUBE_Y, TOWER_Z + SHANK / 2)
    sh.rotation.x = Math.PI / 2
    const fz = TOWER_Z + SHANK
    add(new THREE.CylinderGeometry(0.058, 0.05, 0.36, 24), steel, x, TUBE_Y - 0.12, fz)
    add(new THREE.SphereGeometry(0.058, 20, 10), steel, x, TUBE_Y + 0.06, fz)
    add(new THREE.CylinderGeometry(0.03, 0.022, 0.1, 16), steel, x, TUBE_Y - 0.35, fz)
    // lever handle: pivots at the faucet top, pulls toward the viewer
    const h = new THREE.Group()
    h.position.set(x, TUBE_Y + 0.1, fz)
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.5, 16), black)
    lever.position.y = 0.27
    lever.castShadow = true
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 16), steel)
    collar.position.y = 0.035
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), steel)
    knob.position.y = 0.54
    h.add(lever, collar, knob)
    group.add(h)
    handles.push(h)
    // the glass under the spout
    const g = makeGlass({ shape: 'goblet', beer: WINES[i], fill: 0, head: 0 })
    g.group.scale.set(GLASS_S.x, GLASS_S.y, GLASS_S.x)
    g.group.position.set(x, TRAY_TOP, fz)
    g.setHead(0)
    group.add(g.group)
    glasses.push(g)
    // the pour: a thin column of wine (not transmissive: cheap)
    const sm = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(WINES[i].color).multiplyScalar(i === 0 ? 1.4 : 0.9),
      roughness: 0.1,
      clearcoat: 1,
      envMapIntensity: 1.4,
      emissive: new THREE.Color(WINES[i].color),
      emissiveIntensity: i === 0 ? 0.35 : 0.2,
    })
    streamMats.push(sm)
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 1, 12, 1, true), sm)
    s.geometry.translate(0, -0.5, 0)
    s.position.set(x, TUBE_Y - 0.4, fz)
    s.visible = false
    group.add(s)
    streams.push(s)
  })

  // glass geometry (goblet): bowl floor 0.44, rim 0.92 in glass units
  const FLOOR = 0.44
  const H = 0.92
  return {
    group,
    glasses,
    set(pour, time, reduced) {
      pour.forEach((pRaw, i) => {
        const p = clamp(pRaw)
        const fill = 0.62 * smoothstep(0.08, 1, p)
        glasses[i].setFill(fill)
        glasses[i].setHead(0)
        // handle: forward while pouring, springs back
        const on = smoothstep(0, 0.08, p) * (1 - smoothstep(0.9, 1, p))
        handles[i].rotation.x = on * 0.62
        // stream from the spout to the liquid (or the bowl floor)
        const s = streams[i]
        s.visible = on > 0.02
        if (s.visible) {
          const topY = TRAY_TOP + (FLOOR + (H - 0.02 - FLOOR) * fill) * GLASS_S.y
          const len = TUBE_Y - 0.4 - topY
          const wob = reduced ? 0 : Math.sin(time * 9 + i * 2) * 0.04
          s.scale.set(on * (1 + wob), Math.max(0.01, len), on * (1 - wob))
        }
      })
    },
    glassPos(i, out) {
      return out.set(TAP_X[i], TRAY_TOP + 0.75 * GLASS_S.y, TOWER_Z + SHANK).applyMatrix4(group.matrixWorld)
    },
  }
}
