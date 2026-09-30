import * as THREE from 'three'
import { makeBrickWall, makeBarTop } from '../../kit/bar'
import { makePrintMaterial, makeGlintMaterial, type PrintMaterial, type GlintMaterial } from './print'

/*
 * THE CREW's set: a stretch of Glory's exposed brick with framed
 * silver-gelatin prints hung on it, each under a brass picture light, and a
 * wooden ledge below them (the stout sits there).
 *
 * World layout (units ≈ 0.25 m): the wall is the plane z = 0, frames hang
 * with their centres at y = FRAME_Y, x = FRAME_X[i]; the ledge's top is y = 0.
 */

export const FRAME_X = [0, 6.6, 13.2]
export const FRAME_Y = 2.4
export const PRINT_H = 1.9
export const MAT = 0.3
export const MOLD = 0.1
/** the lamp bar sits this far above a frame's top edge */
export const LAMP_ABOVE = 0.24

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

export interface Framed {
  group: THREE.Group
  print: PrintMaterial
  glint: GlintMaterial
  /** outer size of the frame (molding included) */
  width: number
  height: number
  /** the picture light (null for the small prints) */
  lamp: THREE.SpotLight | null
  lampGlow: THREE.MeshStandardMaterial | null
}

const moldMat = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#0c0908',
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.1,
  })

/** A frame molding: outer rect minus the opening, extruded toward +z with a small round-over. */
function moldingGeo(ow: number, oh: number, iw: number, ih: number, depth: number) {
  const s = new THREE.Shape()
  s.moveTo(-ow / 2, -oh / 2)
  s.lineTo(ow / 2, -oh / 2)
  s.lineTo(ow / 2, oh / 2)
  s.lineTo(-ow / 2, oh / 2)
  s.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-iw / 2, -ih / 2)
  hole.lineTo(-iw / 2, ih / 2)
  hole.lineTo(iw / 2, ih / 2)
  hole.lineTo(iw / 2, -ih / 2)
  hole.closePath()
  s.holes.push(hole)
  const bevel = Math.min(0.014, depth * 0.25)
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  })
  geo.translate(0, 0, bevel)
  return geo
}

const brass = () =>
  new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 1, roughness: 0.32, envMapIntensity: 1.2 })

/**
 * A framed print: black satin molding, a cream mat with a bright bevelled
 * window, the print (aspect kept: never stretched), glass that catches the
 * studio strips. With `lamp`, a brass picture light above it (a real, weak
 * SpotLight washing the print and raking the brick around it).
 */
export function makeFramed({
  aspect,
  printH = PRINT_H,
  mat = MAT,
  mold = MOLD,
  lamp = true,
  seed = 0,
}: {
  aspect: number
  printH?: number
  mat?: number
  mold?: number
  lamp?: boolean
  seed?: number
}): Framed {
  const group = new THREE.Group()
  const pw = printH * aspect
  const ph = printH
  const iw = pw + mat * 2
  const ih = ph + mat * 2
  const ow = iw + mold * 2
  const oh = ih + mold * 2
  const depth = mold * 0.8

  // backing board (so the shadow/edge reads as an object, not a sticker)
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(ow - 0.02, oh - 0.02, 0.02),
    new THREE.MeshStandardMaterial({ color: '#15100d', roughness: 0.9 }),
  )
  back.position.z = 0.02
  group.add(back)

  const molding = new THREE.Mesh(moldingGeo(ow, oh, iw, ih, depth), moldMat())
  molding.position.z = 0.01
  molding.castShadow = true
  molding.receiveShadow = true
  group.add(molding)

  // the mat: warm cream, lit by the room
  const matMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(iw, ih),
    new THREE.MeshStandardMaterial({ color: '#d6cebf', roughness: 0.92, envMapIntensity: 0.3 }),
  )
  matMesh.position.z = 0.035
  matMesh.receiveShadow = true
  group.add(matMesh)
  // the mat's bevelled window: a hairline of bare white core round the print
  const bevel = new THREE.Mesh(
    new THREE.PlaneGeometry(pw + 0.035, ph + 0.035),
    new THREE.MeshStandardMaterial({ color: '#fbf7ee', roughness: 0.8, envMapIntensity: 0.3 }),
  )
  bevel.position.z = 0.0355
  group.add(bevel)

  const print = makePrintMaterial(pw / ph, seed)
  const printMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), print.material)
  printMesh.position.z = 0.036
  group.add(printMesh)

  const glint = makeGlintMaterial()
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(iw, ih), glint.material)
  glass.position.z = depth - 0.012
  glass.renderOrder = 2
  group.add(glass)

  let spot: THREE.SpotLight | null = null
  let glowMat: THREE.MeshStandardMaterial | null = null
  if (lamp) {
    const lw = Math.min(ow * 0.62, 1.4)
    const ly = oh / 2 + LAMP_ABOVE
    const lz = 0.5
    const b = brass()
    const bIn = brass()
    bIn.side = THREE.DoubleSide
    // hood: a half-round brass trough, open side down
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, lw, 20, 1, true, -0.35, Math.PI), bIn)
    hood.rotation.z = Math.PI / 2
    hood.position.set(0, ly, lz)
    group.add(hood)
    // end caps
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), bIn)
      cap.rotation.y = (sx * Math.PI) / 2
      cap.position.set((sx * lw) / 2, ly, lz)
      group.add(cap)
    }
    // the warm tube inside the hood (seen from below / at an angle)
    glowMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffc27a', emissiveIntensity: 1.4 })
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, lw * 0.94, 10), glowMat)
    tube.rotation.z = Math.PI / 2
    tube.position.set(0, ly - 0.01, lz)
    group.add(tube)
    // arm: from a backplate on the wall, up and out to the hood
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.03), b)
    plate.position.set(0, oh / 2 + 0.06, 0.015)
    group.add(plate)
    const a0 = new THREE.Vector3(0, oh / 2 + 0.06, 0.02)
    const a1 = new THREE.Vector3(0, ly + 0.02, lz - 0.02)
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, a0.distanceTo(a1), 8), b)
    arm.position.copy(a0).add(a1).multiplyScalar(0.5)
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a1.clone().sub(a0).normalize())
    group.add(arm)

    spot = new THREE.SpotLight('#fff0dc', 0, 0, 0.95, 0.85, 2)
    spot.position.set(0, ly - 0.04, lz + 0.05)
    spot.target.position.set(0, -oh * 0.32, 0)
    group.add(spot, spot.target)
  }

  return { group, print, glint, width: ow, height: oh, lamp: spot, lampGlow: glowMat }
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
