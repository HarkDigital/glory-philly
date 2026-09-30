import * as THREE from 'three'

/*
 * GLORY KIT: the room's surfaces — the bar top (oiled wood planks), exposed
 * brick, black-painted steel. Procedural canvas maps, built once and shared
 * (small tiles + repeat; see the playbook's "big procedural canvas" note).
 */

let woodTex: THREE.CanvasTexture | null = null
let woodRough: THREE.CanvasTexture | null = null
/** warm oiled planks, grain running along x (tileable, 1024 x 256) */
export function woodMaps() {
  if (woodTex && woodRough) return { map: woodTex, roughnessMap: woodRough }
  const w = 1024
  const h = 256
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  const rc = document.createElement('canvas')
  rc.width = w
  rc.height = h
  const r = rc.getContext('2d')!
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const planks = 4
  for (let p = 0; p < planks; p++) {
    const y0 = (p * h) / planks
    const ph = h / planks
    const base = 0.8 + rnd() * 0.3
    g.fillStyle = `rgb(${Math.round(92 * base)},${Math.round(52 * base)},${Math.round(30 * base)})`
    g.fillRect(0, y0, w, ph)
    // grain: long wavy streaks
    for (let i = 0; i < 90; i++) {
      const yy = y0 + rnd() * ph
      const a = 0.05 + rnd() * 0.12
      g.strokeStyle = rnd() > 0.5 ? `rgba(40,18,8,${a})` : `rgba(150,92,52,${a})`
      g.lineWidth = 0.6 + rnd() * 1.8
      g.beginPath()
      const f = 0.004 + rnd() * 0.01
      const ph0 = rnd() * 6
      for (let x = 0; x <= w; x += 16) {
        const y = yy + Math.sin(x * f + ph0) * (1 + rnd() * 1.5)
        if (x === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
    // a knot now and then
    if (rnd() > 0.5) {
      const kx = rnd() * w
      const ky = y0 + ph * (0.3 + rnd() * 0.4)
      const gr = g.createRadialGradient(kx, ky, 0, kx, ky, 10)
      gr.addColorStop(0, 'rgba(30,12,4,0.8)')
      gr.addColorStop(1, 'rgba(30,12,4,0)')
      g.fillStyle = gr
      g.fillRect(kx - 14, ky - 10, 28, 20)
    }
    // seam
    g.fillStyle = 'rgba(20,8,3,0.85)'
    g.fillRect(0, y0, w, 1.5)
    // roughness: oiled (low) with worn, drier patches
    r.fillStyle = `rgb(${90 + rnd() * 30},0,0)`
    r.fillRect(0, y0, w, ph)
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const gr = r.createRadialGradient(x, y, 0, x, y, 30 + rnd() * 60)
    gr.addColorStop(0, 'rgba(200,200,200,0.25)')
    gr.addColorStop(1, 'rgba(200,200,200,0)')
    r.fillStyle = gr
    r.fillRect(x - 90, y - 90, 180, 180)
  }
  // roughness lives in the green channel
  const id = r.getImageData(0, 0, w, h)
  for (let i = 0; i < id.data.length; i += 4) id.data[i + 1] = id.data[i]
  r.putImageData(id, 0, 0)
  woodTex = new THREE.CanvasTexture(cv)
  woodTex.colorSpace = THREE.SRGBColorSpace
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping
  woodTex.anisotropy = 8
  woodRough = new THREE.CanvasTexture(rc)
  woodRough.colorSpace = THREE.NoColorSpace
  woodRough.wrapS = woodRough.wrapT = THREE.RepeatWrapping
  return { map: woodTex, roughnessMap: woodRough }
}

/** A bar top: a thick slab of oiled planks, top surface at y = 0, centred on x. */
export function makeBarTop({ length = 14, depth = 3, thickness = 0.12 } = {}): THREE.Mesh {
  const { map, roughnessMap } = woodMaps()
  const geo = new THREE.BoxGeometry(length, thickness, depth)
  geo.translate(0, -thickness / 2, 0)
  // world-scaled UVs on the top face: one tile ≈ 3.2 units of grain
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (length / 3.2), uv.getY(i) * (depth / 0.8))
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    roughnessMap,
    roughness: 0.55,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
  })
  const m = new THREE.Mesh(geo, mat)
  m.receiveShadow = true
  return m
}

let brickTex: THREE.CanvasTexture | null = null
/** old Philadelphia brick in running bond with lime mortar (tileable, 512²) */
export function brickMap(): THREE.Texture {
  if (brickTex) return brickTex
  const n = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  g.fillStyle = '#b9ad9a'
  g.fillRect(0, 0, n, n)
  let seed = 5
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const rows = 8
  const bh = n / rows
  const bw = n / 4
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? bw / 2 : 0
    for (let c = -1; c < 5; c++) {
      const x = c * bw + off
      const y = row * bh
      const t = rnd()
      const rC = Math.round(118 + t * 50)
      const gC = Math.round(52 + t * 22)
      const bC = Math.round(38 + t * 14)
      g.fillStyle = `rgb(${rC},${gC},${bC})`
      g.fillRect(x + 3, y + 3, bw - 6, bh - 6)
      // spall + soot
      for (let k = 0; k < 14; k++) {
        g.fillStyle = rnd() > 0.5 ? 'rgba(30,12,8,0.18)' : 'rgba(210,170,140,0.12)'
        g.fillRect(x + 3 + rnd() * (bw - 10), y + 3 + rnd() * (bh - 10), 2 + rnd() * 10, 1 + rnd() * 5)
      }
    }
  }
  brickTex = new THREE.CanvasTexture(cv)
  brickTex.colorSpace = THREE.SRGBColorSpace
  brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping
  return brickTex
}

/** A brick wall plane facing +z, w × h world units, bricks at a real-ish scale (mortar recessed by a bump). */
export function makeBrickWall(w = 20, h = 10, { bump = 0.9, tint = '#ffffff' as THREE.ColorRepresentation } = {}): THREE.Mesh {
  const map = brickMap()
  const geo = new THREE.PlaneGeometry(w, h)
  // scale the UVs (never clone the cached tile to change its repeat)
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 2.4, (uv.getY(i) * h) / 2.4)
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: tint,
    roughness: 0.92,
    bumpMap: map,
    // the mortar is lighter than the brick: a negative scale sinks it
    bumpScale: -bump,
  })
  const m = new THREE.Mesh(geo, mat)
  m.receiveShadow = true
  return m
}

// ─── stainless ───────────────────────────────────────────────────────────────

/** Brushed stainless (taps, faucets, drip trays): long soft highlights from the studio strips. */
export function stainless({ roughness = 0.24, color = '#b9bec2' as THREE.ColorRepresentation, env = 1 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 1,
    roughness,
    anisotropy: 0.55,
    envMapIntensity: env,
  })
}

export interface Faucet {
  group: THREE.Group
  /** the nozzle's tip: where a pour stream starts (world position via getWorldPosition) */
  spout: THREE.Object3D
  /** the tap handle's pivot (rotation.x < 0 pulls it forward) */
  handle: THREE.Group
  /** 0 shut .. 1 pulled fully forward (pouring) */
  setPull(k: number): void
  dispose(): void
}

/**
 * A stainless beer faucet on a short shank, spout down, a tall black handle
 * with a steel ferrule on top. Built facing +z (the shank runs from the tower
 * face at the origin toward +z). Units match makeGlass (scale them together).
 */
export function makeFaucet({ scale = 1, handleColor = '#141010' as THREE.ColorRepresentation } = {}): Faucet {
  const group = new THREE.Group()
  const steel = stainless()
  const dark = new THREE.MeshPhysicalMaterial({ color: handleColor, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.8 })
  const geos: THREE.BufferGeometry[] = []
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group) => {
    geos.push(geo)
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true
    parent.add(m)
    return m
  }
  // flange on the tower face, the shank, the body
  const flange = add(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 40), steel)
  flange.rotation.x = Math.PI / 2
  flange.position.z = 0.015
  const shank = add(new THREE.CylinderGeometry(0.032, 0.034, 0.3, 32), steel)
  shank.rotation.x = Math.PI / 2
  shank.position.z = 0.17
  // the faucet body: a lathed barrel lying along z
  const bodyPts = [
    [0.0, -0.1], [0.05, -0.1], [0.062, -0.085], [0.066, -0.02], [0.064, 0.06], [0.058, 0.1], [0.0, 0.11],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const body = add(new THREE.LatheGeometry(bodyPts, 40), steel)
  body.rotation.x = Math.PI / 2
  body.position.z = 0.4
  // the coupling nut
  const nut = add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6), steel)
  nut.rotation.x = Math.PI / 2
  nut.position.z = 0.29
  // the spout: down from the front of the body, a slight flare at the nozzle
  const spoutPts = [
    [0.0, 0.0], [0.022, 0.0], [0.026, 0.01], [0.024, 0.05], [0.028, 0.14], [0.034, 0.18], [0.036, 0.2], [0.0, 0.2],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const sp = add(new THREE.LatheGeometry(spoutPts, 32), steel)
  sp.rotation.x = Math.PI
  sp.position.set(0, -0.02, 0.44)
  const spout = new THREE.Object3D()
  spout.position.set(0, -0.225, 0.44)
  group.add(spout)
  // the handle: lever pivot on top of the body; a steel collar + ferrule, the black tapered handle
  const handle = new THREE.Group()
  handle.position.set(0, 0.06, 0.4)
  group.add(handle)
  add(new THREE.CylinderGeometry(0.03, 0.036, 0.07, 24).translate(0, 0.035, 0), steel, handle)
  add(new THREE.CylinderGeometry(0.036, 0.03, 0.05, 24).translate(0, 0.095, 0), steel, handle)
  const hPts = [
    [0.0, 0.0], [0.034, 0.0], [0.038, 0.06], [0.05, 0.3], [0.056, 0.44], [0.05, 0.47], [0.0, 0.48],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  add(new THREE.LatheGeometry(hPts, 32).translate(0, 0.12, 0), dark, handle)
  group.scale.setScalar(scale)
  return {
    group,
    spout,
    handle,
    setPull(k) {
      handle.rotation.x = k * 0.45
    },
    dispose() {
      for (const g of geos) g.dispose()
      steel.dispose()
      dark.dispose()
    },
  }
}

/** A stainless drip tray with a slotted grate, top at y = 0 (w × d). */
export function makeDripTray(w = 1.6, d = 0.7): THREE.Group {
  const g = new THREE.Group()
  const steel = stainless({ roughness: 0.4, color: '#8d9296', env: 0.7 })
  const tray = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), steel)
  tray.position.y = -0.025
  tray.receiveShadow = true
  g.add(tray)
  const slots = Math.round(w / 0.06)
  const slotGeo = new THREE.BoxGeometry(0.018, 0.012, d * 0.8)
  const slotMat = new THREE.MeshStandardMaterial({ color: '#050404', roughness: 0.6 })
  const inst = new THREE.InstancedMesh(slotGeo, slotMat, slots)
  const m = new THREE.Matrix4()
  for (let i = 0; i < slots; i++) {
    m.makeTranslation(-w / 2 + 0.08 + ((w - 0.16) * i) / (slots - 1), -0.004, 0)
    inst.setMatrixAt(i, m)
  }
  g.add(inst)
  return g
}
