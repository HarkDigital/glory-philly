import * as THREE from 'three'

/*
 * KITCHEN props: a dessert plate and a fork for the Sweets still life.
 */

/** A white dessert plate (base on y = 0). */
export function makePlate(r = 0.62): THREE.Mesh {
  const pts = [
    [0, 0.0],
    [r * 0.55, 0.0],
    [r * 0.58, 0.012],
    [r * 0.6, 0.03],
    [r * 0.82, 0.045],
    [r * 0.98, 0.075],
    [r, 0.085],
    [r * 0.97, 0.09],
    [r * 0.8, 0.06],
    [r * 0.6, 0.04],
    [0, 0.035],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const m = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 72),
    new THREE.MeshPhysicalMaterial({ color: 0xd9d1c3, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
  )
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** A dessert fork lying flat (length along x, tines toward +x). */
export function makeFork(len = 1.05): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6e8ec, metalness: 0.85, roughness: 0.34, envMapIntensity: 2.6 })
  const handle = new THREE.Shape()
  const hl = len * 0.62
  handle.moveTo(0, -0.035)
  handle.quadraticCurveTo(hl * 0.5, -0.05, hl, -0.022)
  handle.lineTo(hl + len * 0.1, -0.06)
  handle.lineTo(hl + len * 0.1, 0.06)
  handle.lineTo(hl, 0.022)
  handle.quadraticCurveTo(hl * 0.5, 0.05, 0, 0.035)
  handle.quadraticCurveTo(-0.04, 0, 0, -0.035)
  const geo = new THREE.ExtrudeGeometry(handle, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 })
  geo.rotateX(-Math.PI / 2)
  const h = new THREE.Mesh(geo, mat)
  g.add(h)
  const tineGeo = new THREE.BoxGeometry(len * 0.28, 0.014, 0.018)
  tineGeo.translate(len * 0.14, 0, 0)
  const tines = new THREE.InstancedMesh(tineGeo, new THREE.MeshStandardMaterial({ color: 0xe6e8ec, metalness: 0.85, roughness: 0.34, envMapIntensity: 2.6 }), 4)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 4; i++) {
    m.makeTranslation(hl + len * 0.095, 0.006, -0.045 + i * 0.03)
    tines.setMatrixAt(i, m)
  }
  g.add(tines)
  g.traverse(o => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true
  })
  return g
}
