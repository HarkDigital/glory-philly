import * as THREE from 'three'

/*
 * KITCHEN props: the pass (a stainless shelf on posts along the back of the
 * bar, heat-lamp tubes glowing under it, a ticket rail with blank tickets),
 * a dessert plate and a fork for Sweets.
 */

export function steel(rough = 0.28) {
  return new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: rough, envMapIntensity: 1.1 })
}

export interface Pass {
  group: THREE.Group
  /** 0..1.5 glow of the heat lamps */
  setHeat(v: number): void
}

/** The pass shelf: runs along x from x0 to x1, at depth z, shelf underside at height y. */
export function makePass(x0: number, x1: number, z: number, y: number, postEvery: number): Pass {
  const group = new THREE.Group()
  const len = x1 - x0
  const cx = (x0 + x1) / 2
  const shelfMat = steel(0.32)
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 1.1), shelfMat)
  shelf.position.set(cx, y + 0.03, z)
  shelf.castShadow = false
  group.add(shelf)
  // a folded front lip
  const lip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.03), shelfMat)
  lip.position.set(cx, y - 0.02, z + 0.55)
  group.add(lip)

  // posts (instanced)
  const n = Math.floor(len / postEvery) + 1
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, y, 12)
  postGeo.translate(0, y / 2, 0)
  const posts = new THREE.InstancedMesh(postGeo, steel(0.22), n * 2)
  const m = new THREE.Matrix4()
  for (let i = 0; i < n; i++) {
    const x = x0 + i * postEvery
    m.makeTranslation(x, 0, z - 0.45)
    posts.setMatrixAt(i, m)
  }
  posts.count = n
  group.add(posts)

  // heat-lamp housing + two glowing tubes under the shelf
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(len, 0.07, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x141112, metalness: 0.6, roughness: 0.45 }),
  )
  housing.position.set(cx, y - 0.04, z + 0.05)
  group.add(housing)
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x220806, emissive: new THREE.Color('#ff5a1e'), emissiveIntensity: 1.2, roughness: 0.4 })
  const tubeGeo = new THREE.CylinderGeometry(0.03, 0.03, len, 12)
  tubeGeo.rotateZ(Math.PI / 2)
  for (const dz of [-0.09, 0.09]) {
    const t = new THREE.Mesh(tubeGeo, tubeMat)
    t.position.set(cx, y - 0.1, z + 0.05 + dz)
    group.add(t)
  }

  // ticket rail with blank tickets
  const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), shelfMat)
  rail.position.set(cx, y + 0.42, z + 0.52)
  group.add(rail)
  const tickets = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.28, 0.46),
    new THREE.MeshStandardMaterial({ color: 0xf2ecde, roughness: 0.9, side: THREE.DoubleSide }),
    Math.ceil(len / 1.3),
  )
  let seed = 9
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const s = new THREE.Vector3(1, 1, 1)
  const p = new THREE.Vector3()
  let count = 0
  for (let x = x0 + 0.6; x < x1 && count < tickets.count; x += 0.9 + rnd() * 1.4) {
    e.set(-0.05 + rnd() * 0.1, 0, -0.06 + rnd() * 0.12)
    q.setFromEuler(e)
    s.set(1, 0.8 + rnd() * 0.5, 1)
    p.set(x, y + 0.42 - 0.23 * s.y, z + 0.555)
    m.compose(p, q, s)
    tickets.setMatrixAt(count++, m)
  }
  tickets.count = count
  group.add(tickets)

  return {
    group,
    setHeat(v: number) {
      tubeMat.emissiveIntensity = v
    },
  }
}

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
