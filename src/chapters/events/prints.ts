import * as THREE from 'three'
import { clamp, ease, lerp, smoothstep } from '../../core/math'

/*
 * THE PRINTS: the site's party photographs as a stack of lab prints (white
 * borders, semi-gloss) at the head of the banquet table. The story state `s`
 * (0 = the top print presented … n-1 = the last) comes from a StoryClock:
 * as s passes k → k+1, print k is laid down onto the pile on the left while
 * print k+1 lifts off the stack on the right and turns up to the camera.
 * Everything is a pure function of s (no state across frames). Under reduced
 * motion the prints never fly: they sit in the presented pose and cross-fade.
 */

export const LONG = 1.0
const BORDER = 0.055
const GAP = 0.006
/** card stock thickness */
const THICK = 0.0045
/** ~1 mm (1 unit = 0.254 m): how far a moving print keeps clear of where it rested */
const CLEAR = 0.004

export interface PrintSpec {
  url: string
  /** width / height of the photograph */
  aspect: number
}

export interface PrintStack {
  group: THREE.Group
  prints: { group: THREE.Group; card: THREE.Mesh; photo: THREE.Mesh; w: number; h: number }[]
  /** where the presented print sits (its centre), world */
  present: THREE.Vector3
  /** tilt (radians about x) of the presented print toward the camera */
  tilt: number
  setTexture(i: number, tex: THREE.Texture): void
  update(s: number, reduced: boolean): void
}

export function makePrints(specs: PrintSpec[], at: { stack: THREE.Vector3; pile: THREE.Vector3; present: THREE.Vector3 }): PrintStack {
  const group = new THREE.Group()
  const n = specs.length
  const cardGeo = new THREE.BoxGeometry(1, 1, 1)
  cardGeo.translate(0, -0.5, 0)
  const photoGeo = new THREE.PlaneGeometry(1, 1)
  photoGeo.rotateX(-Math.PI / 2)
  const prints: PrintStack['prints'] = []
  // hand-laid: each print a little off square on the stack and on the pile
  const stackYaw = [0.05, -0.07, 0.03, -0.04, 0.08, -0.02, 0.06, -0.06, 0.02]
  const pileYaw = [-0.16, 0.1, -0.05, 0.2, -0.12, 0.04, -0.2, 0.14, -0.08]
  const pileOff = [
    [0.02, 0.01],
    [-0.05, 0.03],
    [0.04, -0.03],
    [-0.02, -0.05],
    [0.06, 0.02],
    [-0.04, 0.05],
    [0.03, -0.01],
    [-0.06, -0.02],
    [0.01, 0.04],
  ]
  for (let i = 0; i < n; i++) {
    const a = specs[i].aspect
    const pw = a >= 1 ? LONG : LONG * a
    const ph = a >= 1 ? LONG / a : LONG
    const w = pw + BORDER * 2
    const h = ph + BORDER * 2 + (a >= 1 ? 0 : 0.02)
    const g = new THREE.Group()
    const card = new THREE.Mesh(
      cardGeo,
      new THREE.MeshStandardMaterial({ color: '#f1ebe0', roughness: 0.62, transparent: true, envMapIntensity: 0.6 }),
    )
    card.scale.set(w, THICK, h)
    card.castShadow = true
    card.receiveShadow = true
    const photo = new THREE.Mesh(
      photoGeo,
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.72,
        transparent: true,
        emissive: '#ffffff',
        emissiveIntensity: 0.4,
      }),
    )
    photo.scale.set(pw, 1, ph)
    // a lab print's wider bottom border on portrait prints
    photo.position.set(0, 0.0006, a >= 1 ? 0 : -0.01)
    photo.receiveShadow = true
    g.add(card, photo)
    group.add(g)
    prints.push({ group: g, card, photo, w, h })
  }

  const tilt = 0.62
  const Pa = new THREE.Vector3()
  const Pb = new THREE.Vector3()
  const E = new THREE.Euler()
  const Q = new THREE.Quaternion()
  const V = new THREE.Vector3()
  /** the card's lowest corner below the group origin (its top face centre) in the current pose */
  const lowest = (g: THREE.Group, w: number, h: number) => {
    Q.setFromEuler(g.rotation)
    let m = Infinity
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) for (const y of [0, -THICK]) m = Math.min(m, V.set(sx * w, y, sz * h).applyQuaternion(Q).y)
    return m
  }
  /**
   * A print turns about its centre, so as it tips up its near edge swings DOWN
   * (and a yawed or rolled corner further) faster than the arc lifts it: keep
   * its lowest corner at or above where it rests (the gatefold, the print
   * under it), plus `CLEAR` once it's moving. 0 once it's clear of the album.
   */
  const keepAbove = (g: THREE.Group, w: number, h: number, restY: number, away: number) => {
    const floor = restY - THICK + CLEAR * smoothstep(0, 0.08, away)
    const low = g.position.y + lowest(g, w, h)
    if (low < floor) g.position.y += floor - low
  }

  return {
    group,
    prints,
    present: at.present,
    tilt,
    setTexture(i, tex) {
      const m = prints[i].photo.material as THREE.MeshStandardMaterial
      m.map = tex
      m.emissiveMap = tex
      m.needsUpdate = true
    },
    update(s, reduced) {
      for (let k = 0; k < n; k++) {
        const pr = prints[k]
        const g = pr.group
        const cm = pr.card.material as THREE.MeshStandardMaterial
        const pm = pr.photo.material as THREE.MeshStandardMaterial
        // lower prints draw first (the stack is nearly coplanar)
        pr.card.renderOrder = k < s && !reduced ? k : 2 * n - k
        pr.photo.renderOrder = pr.card.renderOrder + 0.5
        if (reduced) {
          // a still stack in the presented pose: the front print fades to the next
          const off = (k - s) * 0.004
          g.position.copy(at.present).add(Pa.set(0, -Math.cos(tilt) * off, -Math.sin(tilt) * off))
          g.rotation.set(tilt, 0, 0)
          const o = k < s ? 1 - clamp(s - k) : k <= Math.floor(s) + 1 ? 1 : 0
          cm.opacity = o
          pm.opacity = o
          g.visible = o > 0.002
          continue
        }
        cm.opacity = 1
        pm.opacity = 1
        g.visible = true
        // up: 0 → 1 as print k lifts off the stack (s: k-1 → k); down: 0 → 1 as it goes to the pile (s: k → k+1)
        const up = k === 0 ? 1 : ease.inOutCubic(smoothstep(0, 1, s - (k - 1)))
        const down = ease.inOutCubic(smoothstep(0, 1, s - k))
        // stack pose (k = 0 on top)
        const stackY = (n - 1 - k) * GAP + THICK
        Pa.set(at.stack.x, at.stack.y + stackY, at.stack.z)
        const stackRot = stackYaw[k % stackYaw.length]
        // pile pose (the earliest print at the bottom)
        const po = pileOff[k % pileOff.length]
        Pb.set(at.pile.x + po[0], at.pile.y + k * GAP + THICK, at.pile.z + po[1])
        const pileRot = pileYaw[k % pileYaw.length]
        if (down <= 0) {
          // stack → presented: rise, drift over, turn up
          const t = up
          const arc = Math.sin(t * Math.PI) * 0.12
          g.position.set(lerp(Pa.x, at.present.x, t), lerp(Pa.y, at.present.y, t) + arc, lerp(Pa.z, at.present.z, t))
          g.rotation.copy(E.set(tilt * ease.outCubic(t), lerp(stackRot, 0, t), 0))
          keepAbove(g, pr.w, pr.h, Pa.y, t)
        } else {
          // presented → pile: tip down and slide left, landing flat with a small settle
          const t = down
          const arc = Math.sin(t * Math.PI) * 0.18
          const land = t > 0.85 ? Math.sin(((t - 0.85) / 0.15) * Math.PI) * 0.01 : 0
          g.position.set(lerp(at.present.x, Pb.x, t), lerp(at.present.y, Pb.y, t) + arc + land, lerp(at.present.z, Pb.z, t))
          g.rotation.copy(E.set(tilt * (1 - ease.inOutCubic(t)), lerp(0, pileRot, t), Math.sin(t * Math.PI) * 0.12))
          keepAbove(g, pr.w, pr.h, Pb.y, 1 - t)
        }
      }
    },
  }
}

/**
 * Load a photo as a texture keeping its aspect (kit loadScreenshot forces
 * 16:10): decoded off the main thread, drawn to a canvas once, canvas freed
 * after upload.
 */
export async function loadPhoto(url: string, width: number): Promise<THREE.Texture> {
  let source: CanvasImageSource
  let w = width
  let h = width
  try {
    const blob = await (await fetch(url)).blob()
    const probe = await createImageBitmap(blob)
    h = Math.round((w * probe.height) / probe.width)
    probe.close()
    source = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
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
  tex.anisotropy = 8
  tex.onUpdate = () => {
    c.width = c.height = 1
    tex.onUpdate = null
  }
  return tex
}
