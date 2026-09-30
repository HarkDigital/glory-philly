import * as THREE from 'three'
import { makeBrickWall, makeBarTop } from '../../kit/bar'
import { makeSleeve, makeRecord, SEVEN, REC12, REC7, type Sleeve, type Record as VinylRecord } from '../../kit/vinyl'

/*
 * THE CREW's set: a stretch of Glory's exposed brick with three record-store
 * "now playing" displays on it — a 12" sleeve (the portrait is the cover)
 * standing on a black steel rail, its record half out showing the label —
 * each under a brass picture light; a 7" single (The Glorious Archibald)
 * between two of them; a wooden ledge below (the stout sits there).
 *
 * World layout: the wall is the plane z = 0; display i's sleeve stands on a
 * rail at y = RAIL_Y, centred on x = FRAME_X[i]; the ledge's top is y = 0.
 */

/** where each person's display hangs (the sleeve's centre x) */
export const FRAME_X = [0, 6.6, 13.2]
/** the display rails' height on the wall */
export const RAIL_Y = 1.1
/** world size of a 12" sleeve on this wall */
export const SLEEVE_S = 1.6

let brickBump: THREE.CanvasTexture | null = null
/**
 * A bump map registered to kit/bar.ts brickMap(): same running bond (8 rows,
 * 4 bricks a row, half-brick offset), mortar recessed, brick faces pitted and
 * softly rounded at the arrises, so grazing picture light rakes across real
 * relief.
 */
function brickBumpMap(): THREE.CanvasTexture {
  if (brickBump) return brickBump
  const n = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, n, n)
  let seed = 23
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const rows = 8
  const bh = n / rows
  const bw = n / 4
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? bw / 2 : 0
    for (let c = -1; c < 5; c++) {
      const x = c * bw + off
      const y = row * bh
      // rounded arris: three nested steps up to the face
      const face = 150 + rnd() * 60
      const steps = [
        [3, 0.45],
        [5, 0.75],
        [7, 1],
      ] as const
      for (const [ins, k] of steps) {
        const v = Math.round(face * k)
        g.fillStyle = `rgb(${v},${v},${v})`
        g.fillRect(x + ins, y + ins, bw - ins * 2, bh - ins * 2)
      }
      // pits, spall and a little fired-clay texture
      for (let k = 0; k < 22; k++) {
        const d = rnd() > 0.35
        g.fillStyle = d ? `rgba(0,0,0,${0.18 + rnd() * 0.3})` : `rgba(255,255,255,${0.08 + rnd() * 0.12})`
        const px = x + 7 + rnd() * (bw - 16)
        const py = y + 7 + rnd() * (bh - 16)
        g.beginPath()
        g.arc(px, py, 0.8 + rnd() * rnd() * 4, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  brickBump = new THREE.CanvasTexture(cv)
  brickBump.colorSpace = THREE.NoColorSpace
  brickBump.wrapS = brickBump.wrapT = THREE.RepeatWrapping
  return brickBump
}

/**
 * The kit's brick wall, with slimmer courses (real brick is ~3:1: the UVs'
 * v is stretched on OUR geometry; the cached tile is never touched), deeper
 * relief from the bump above (registered to the same tile), and a darker,
 * drier face so the picture lights do the work.
 */
export function makeWall(w: number, h: number): THREE.Mesh {
  const wall = makeBrickWall(w, h, { tint: '#8a6c60' })
  const uv = wall.geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 1.5)
  uv.needsUpdate = true
  const mat = wall.material as THREE.MeshStandardMaterial
  mat.bumpMap = brickBumpMap()
  mat.bumpScale = 2.2
  mat.roughness = 0.94
  mat.envMapIntensity = 0.25
  return wall
}

const brass = () =>
  new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 1, roughness: 0.32, envMapIntensity: 1.2 })

export interface Lamp {
  /** origin = the backplate on the wall */
  group: THREE.Group
  spot: THREE.SpotLight
  glow: THREE.MeshStandardMaterial
}

/**
 * A brass picture light: a backplate on the wall, an arm out to a half-round
 * hood with a warm tube inside, and a real (weak, shadowless) SpotLight that
 * washes what hangs below it and rakes the brick around it. `drop` = how far
 * below the plate its aim point is.
 */
export function makeLamp(lw: number, drop: number): Lamp {
  const group = new THREE.Group()
  const ly = 0.18
  const lz = 0.5
  const b = brass()
  const bIn = brass()
  bIn.side = THREE.DoubleSide
  // hood: a half-round brass trough, open toward the wall and down
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, lw, 20, 1, true, -0.35, Math.PI), bIn)
  hood.rotation.z = Math.PI / 2
  hood.position.set(0, ly, lz)
  group.add(hood)
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), bIn)
    cap.rotation.y = (sx * Math.PI) / 2
    cap.position.set((sx * lw) / 2, ly, lz)
    group.add(cap)
  }
  const glow = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffc27a', emissiveIntensity: 1.4 })
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, lw * 0.94, 10), glow)
  tube.rotation.z = Math.PI / 2
  tube.position.set(0, ly - 0.01, lz)
  group.add(tube)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.03), b)
  plate.position.set(0, 0, 0.015)
  group.add(plate)
  const a0 = new THREE.Vector3(0, 0, 0.02)
  const a1 = new THREE.Vector3(0, ly + 0.02, lz - 0.02)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, a0.distanceTo(a1), 8), b)
  arm.position.copy(a0).add(a1).multiplyScalar(0.5)
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a1.clone().sub(a0).normalize())
  group.add(arm)
  const spot = new THREE.SpotLight('#fff0dc', 0, 0, 0.95, 0.85, 2)
  spot.position.set(0, ly - 0.04, lz + 0.05)
  spot.target.position.set(0, -drop, 0)
  group.add(spot, spot.target)
  return { group, spot, glow }
}

export interface Display {
  /** origin: the sleeve's bottom-centre on the rail, on the wall plane */
  group: THREE.Group
  sleeve: Sleeve
  record: VinylRecord
  lamp: Lamp | null
  /** extents in display-local units (rail and lamp included) */
  left: number
  right: number
  top: number
  bottom: number
}

const steel = () => new THREE.MeshStandardMaterial({ color: '#131112', metalness: 0.55, roughness: 0.42, envMapIntensity: 0.8 })

/**
 * The record-store "now playing" display: a black steel rail with a front
 * lip on the brick, the sleeve standing on it leaning back a touch, its
 * record half out to the right so the label shows, a picture light above.
 * `scale` = world size of a 12" sleeve; `out` = how far the record's centre
 * sits right of the sleeve's centre (in sleeve units).
 */
export function makeDisplay({
  front,
  label,
  size = 12,
  scale = 1.6,
  out,
  lamp = true,
  wear = 0.25,
  seed = 0,
}: {
  front: THREE.Texture
  label: THREE.Texture
  size?: 12 | 7
  scale?: number
  out?: number
  lamp?: boolean
  wear?: number
  seed?: number
}): Display {
  const group = new THREE.Group()
  const k = size === 7 ? SEVEN : 1
  const R = (size === 7 ? REC7 : REC12).R
  const o = out ?? (size === 7 ? 0.44 : 0.64)
  const S = scale
  const sleeve = makeSleeve({ front, size, wear, seed, gloss: 0.4 })
  sleeve.mesh.castShadow = true
  const record = makeRecord({ label, size, seed: 11 + seed * 3, segments: 128 })
  record.disc.castShadow = true
  // the sleeve + record lean back against the wall from the rail
  const holder = new THREE.Group()
  holder.position.set(0, 0.004, 0.1)
  holder.rotation.x = -0.055
  holder.scale.setScalar(S)
  record.group.position.set(o * k, 0.5 * k, 0)
  record.setSpin(-0.08 - seed * 0.21)
  holder.add(sleeve.group, record.group)
  group.add(holder)

  const left = -0.5 * k * S - 0.08
  const right = (o * k + R) * S + 0.08
  const rw = right - left
  const rx = (left + right) / 2
  const m = steel()
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.035, 0.18), m)
  shelf.position.set(rx, -0.0175, 0.09)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.075, 0.016), m)
  lip.position.set(rx, 0.02, 0.172)
  const back = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.06, 0.012), m)
  back.position.set(rx, -0.04, 0.006)
  for (const r of [shelf, lip, back]) {
    r.castShadow = true
    r.receiveShadow = true
    group.add(r)
  }

  let lampOut: Lamp | null = null
  let top = S * k
  if (lamp) {
    const cx = (left + right) / 2
    lampOut = makeLamp(Math.min(rw * 0.55, 1.4), S * k * 0.5 + 0.12)
    lampOut.group.position.set(cx, S * k + 0.14, 0)
    group.add(lampOut.group)
    top = S * k + 0.14 + 0.28
  }
  return { group, sleeve, record, lamp: lampOut, left, right, top, bottom: -0.06 }
}

/** The ledge below the frames: an oiled plank on black steel brackets. Top at y = 0. */
export function makeLedge(length: number): THREE.Group {
  const g = new THREE.Group()
  const top = makeBarTop({ length, depth: 0.42, thickness: 0.08 })
  top.position.z = 0.21
  top.castShadow = true
  g.add(top)
  const steel = new THREE.MeshStandardMaterial({ color: '#141212', metalness: 0.6, roughness: 0.45 })
  const nb = Math.max(2, Math.round(length / 3.2))
  for (let i = 0; i <= nb; i++) {
    const x = -length / 2 + 0.4 + ((length - 0.8) * i) / nb
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.035), steel)
    v.position.set(x, -0.26, 0.02)
    const hz = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.36), steel)
    hz.position.set(x, -0.1, 0.19)
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.38, 0.035), steel)
    br.position.set(x, -0.25, 0.14)
    br.rotation.x = 0.72
    g.add(v, hz, br)
  }
  return g
}
