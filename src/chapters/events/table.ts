import * as THREE from 'three'
import { makeBarTop, woodMaps } from '../../kit/bar'
import { makeGlass, BEERS, type Glass } from '../../kit/beer'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng } from '../../core/math'

/*
 * THE BACK ROOM: one long banquet table set for a party down the middle of
 * Glory's dining room. Units: 1 = 0.254 m (10 in). The table top is y = 0
 * (0.76 m), the floor y = -3; its head (where the prints lie) is at z ≈ +3
 * and it runs to z ≈ -30, toward the back bar (room.ts).
 *
 * Every repeat is an InstancedMesh: plates, black napkins, cutlery, cheap
 * stand-in stemware (additive glints, no transmission), Glory's own chairs
 * (black steel frames, walnut seats and back rests, as at the bar), black
 * steel legs, brass holders, taper candles, flames (one billboard shader: a
 * teardrop core and a soft halo, flickering gently by time), little
 * bouquets. Only THREE glasses near the camera are real transmissive kit
 * glasses (rosé). `lit` hooks a mesh into the pendants' light pools.
 */

export const TABLE = {
  /** z of the head end of the table */
  head: 3.1,
  length: 33.4,
  width: 3.4,
  /** place settings */
  first: -0.9,
  step: 2.3,
  n: 13,
  plateX: 1.12,
  /** the floor under it */
  floor: -3,
}

const settingZ = (i: number) => TABLE.first - i * TABLE.step

export interface BanquetTable {
  group: THREE.Group
  /** candle lights near the head (drive their intensity; never toggle) */
  lights: THREE.PointLight[]
  glasses: Glass[]
  update(time: number, amp: number): void
}

function linenMap(): THREE.Texture {
  const n = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const g = cv.getContext('2d')!
  const id = g.createImageData(n, n)
  const r = rng(21)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // a loose weave: warp and weft threads, a little slub
      const w = 0.5 + 0.5 * Math.sin((x / n) * Math.PI * 2 * 32)
      const f = 0.5 + 0.5 * Math.sin((y / n) * Math.PI * 2 * 32)
      const v = 200 + 22 * (w * 0.5 + f * 0.5) + (r() - 0.5) * 18
      const i = (y * n + x) * 4
      id.data[i] = v
      id.data[i + 1] = v * 0.93
      id.data[i + 2] = v * 0.82
      id.data[i + 3] = 255
    }
  g.putImageData(id, 0, 0)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

const FLAME_VERT = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uAmp;
  uniform float uSize;
  varying vec2 vL;
  varying float vFl;
  void main() {
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float t = uTime;
    float fl = 1.0 + uAmp * (0.07 * sin(t * 5.3 + aPhase * 6.283) + 0.045 * sin(t * 9.7 + aPhase * 17.0) + 0.035 * sin(t * 1.9 + aPhase * 3.1));
    vFl = fl;
    vL = position.xy * uSize;
    // the tip leans a touch in a slow draught
    vec3 p = c.xyz + vec3(position.x * uSize, position.y * uSize, 0.0);
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }
`
const FLAME_FRAG = /* glsl */ `
  uniform float uGlow;
  varying vec2 vL;
  varying float vFl;
  void main() {
    vec2 l = vL;
    float up = step(0.0, l.y);
    float hy = mix(0.034, 0.115 * vFl, up);
    float e = length(vec2(l.x / 0.03, l.y / hy));
    float body = 1.0 - smoothstep(0.55, 1.0, e);
    float core = 1.0 - smoothstep(0.0, 0.62, length(vec2(l.x / 0.016, (l.y + 0.004) / (hy * 0.55))));
    float r2 = dot(l, l);
    float halo = exp(-r2 / 0.02) * 0.2 + exp(-r2 / 0.0016) * 0.4;
    vec3 outer = vec3(1.0, 0.46, 0.12);
    vec3 inner = vec3(1.0, 0.86, 0.62);
    vec3 col = outer * body * 2.2 + inner * core * 1.6 + vec3(1.0, 0.55, 0.2) * halo * uGlow * vFl;
    float a = max(max(col.r, col.g), col.b);
    if (a < 0.002) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`

/**
 * A cheap goblet for the stand-ins: the kit glass's own lathe profile (its
 * outer wall, rim and inner wall), thinned by Ramer–Douglas–Peucker to the
 * points that shape it, turned with `radial` segments (~600 triangles, not
 * the kit shell's 17k).
 */
function standInGoblet(kitShell: THREE.BufferGeometry, radial: number): THREE.BufferGeometry {
  const src = (kitShell as THREE.LatheGeometry).parameters?.points
  if (!src?.length) return new THREE.CylinderGeometry(0.2, 0.14, 0.55, radial).translate(0, 0.28, 0)
  const rdp = (pts: THREE.Vector2[], eps: number): THREE.Vector2[] => {
    if (pts.length < 3) return pts
    const a = pts[0]
    const b = pts[pts.length - 1]
    const ab = b.clone().sub(a)
    const len = ab.length() || 1e-6
    let worst = 0
    let at = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs(ab.x * (pts[i].y - a.y) - ab.y * (pts[i].x - a.x)) / len
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst <= eps) return [a, b]
    return [...rdp(pts.slice(0, at + 1), eps).slice(0, -1), ...rdp(pts.slice(at), eps)]
  }
  let eps = 0.004
  let pts = rdp(src, eps)
  // aim for ~12–18 profile points whatever the kit's smoothing does
  while (pts.length > 18 && eps < 0.05) pts = rdp(src, (eps *= 1.4))
  return new THREE.LatheGeometry(pts, radial)
}

export function makeBanquetTable(mobile: boolean, lit: (m: THREE.Mesh | THREE.InstancedMesh) => void = () => {}): BanquetTable {
  const group = new THREE.Group()
  const R = rng(7)

  // ---- the table (oiled planks, grain along its length)
  const top = makeBarTop({ length: TABLE.length, depth: TABLE.width, thickness: 0.14 })
  top.rotation.y = Math.PI / 2
  top.position.z = TABLE.head - TABLE.length / 2
  top.receiveShadow = true
  group.add(top)

  // ---- runner: loose cream linen down the centre
  const lm = linenMap()
  lm.repeat.set(4, 140)
  const runner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, TABLE.length - 3),
    new THREE.MeshStandardMaterial({ map: lm, color: '#d9cdb8', roughness: 0.96, envMapIntensity: 0.3 }),
  )
  runner.rotation.x = -Math.PI / 2
  runner.position.set(0, 0.003, TABLE.head - 1.5 - (TABLE.length - 3) / 2 - 1.2)
  runner.receiveShadow = true
  group.add(runner)

  const N = TABLE.n
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const S = new THREE.Vector3(1, 1, 1)
  const P = new THREE.Vector3()
  const E = new THREE.Euler()
  const set = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    Q.setFromEuler(E.set(rx, ry, rz))
    im.setMatrixAt(i, M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)))
  }

  // ---- plates: white stoneware, a rim that catches the strips
  const plateGeo = new THREE.LatheGeometry(
    [
      [0, 0.004],
      [0.3, 0.004],
      [0.34, 0.012],
      [0.37, 0.03],
      [0.47, 0.046],
      [0.5, 0.05],
      [0.505, 0.044],
      [0.46, 0.036],
      [0.34, 0.0],
      [0.0, 0.0],
    ]
      .reverse()
      .map(([x, y]) => new THREE.Vector2(x, y)),
    40,
  )
  const plates = new THREE.InstancedMesh(
    plateGeo,
    new THREE.MeshPhysicalMaterial({ color: '#efe9df', roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.12 }),
    N * 2,
  )
  // ---- napkins: black, folded long, laid across each plate
  const napGeo = new THREE.BoxGeometry(0.18, 0.03, 0.62)
  napGeo.translate(0, 0.015, 0)
  const naps = new THREE.InstancedMesh(napGeo, new THREE.MeshStandardMaterial({ color: '#141011', roughness: 0.9 }), N * 2)
  // ---- cutlery: a fork and a knife either side
  const cutGeo = new THREE.BoxGeometry(0.035, 0.008, 0.5)
  cutGeo.translate(0, 0.004, 0)
  const cut = new THREE.InstancedMesh(
    cutGeo,
    new THREE.MeshStandardMaterial({ color: '#d9d5cf', metalness: 1, roughness: 0.22 }),
    N * 4,
  )
  // ---- chairs: Glory's own (ref6) — square black steel frames, walnut seats and
  // back rests. Local: the back plane at z = 0, the seat toward -z (the table),
  // x across the chair; y is the table's (the floor at TABLE.floor).
  const F = TABLE.floor
  const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y, z)
    return g
  }
  const tube = 0.09
  const px = 0.78
  const steelParts = [
    // rear posts from the floor to just over the table edge
    bx(tube, 0.3 - F, tube, -px, (0.3 + F) / 2, 0),
    bx(tube, 0.3 - F, tube, px, (0.3 + F) / 2, 0),
    // a rail under the back rest
    bx(px * 2, 0.08, 0.08, 0, -0.58, 0),
    // front legs up to the seat
    bx(tube, -1.29 - F, tube, -px, (-1.29 + F) / 2, -1.62),
    bx(tube, -1.29 - F, tube, px, (-1.29 + F) / 2, -1.62),
    // stretchers
    bx(0.07, 0.07, 1.62, -px, F + 0.5, -0.81),
    bx(0.07, 0.07, 1.62, px, F + 0.5, -0.81),
    bx(px * 2, 0.07, 0.07, 0, F + 0.75, -1.62),
  ]
  const woodParts = [
    // the back rest: one walnut board across the posts
    bx(1.7, 0.4, 0.075, 0, 0.03, -0.085),
    // the seat
    bx(1.78, 0.1, 1.72, 0, -1.24, -0.84),
  ]
  const chairSteel = mergeGeometries(steelParts)!
  const chairWood = mergeGeometries(woodParts)!
  for (const g of [...steelParts, ...woodParts]) g.dispose()
  const steelMat = new THREE.MeshStandardMaterial({ color: '#141212', roughness: 0.46, metalness: 0.55 })
  const { map: wmap, roughnessMap: wrough } = woodMaps()
  const chairWoodMat = new THREE.MeshStandardMaterial({ map: wmap, roughnessMap: wrough, color: '#b98a66', roughness: 1, envMapIntensity: 0.5 })
  const chairs = new THREE.InstancedMesh(chairSteel, steelMat, N * 2)
  const seats = new THREE.InstancedMesh(chairWood, chairWoodMat, N * 2)
  for (let i = 0; i < N; i++) {
    const z = settingZ(i)
    for (let s = 0; s < 2; s++) {
      const side = s ? 1 : -1
      const k = i * 2 + s
      const x = side * TABLE.plateX
      set(plates, k, x, 0, z)
      set(naps, k, x + side * 0.02, 0.05, z + (R() - 0.5) * 0.04, (R() - 0.5) * 0.06)
      set(cut, k * 2, x, 0, z + 0.62, 0)
      set(cut, k * 2 + 1, x, 0, z - 0.62, 0)
      // the chair pushed in: its back just past the table edge, a little askew
      const cz = z + (R() - 0.5) * 0.1
      const cyaw = side * Math.PI / 2 + (R() - 0.5) * 0.08
      const cxx = side * (2.08 + R() * 0.12)
      set(chairs, k, cxx, 0, cz, cyaw)
      set(seats, k, cxx, 0, cz, cyaw)
    }
  }
  plates.receiveShadow = true
  naps.receiveShadow = true
  group.add(plates, naps, cut, chairs, seats)

  // ---- legs: black steel posts in pairs down the table
  const legGeo = new THREE.BoxGeometry(0.14, -F - 0.14, 0.14)
  legGeo.translate(0, (F - 0.14) / 2, 0)
  // (at the head and between place settings, never where a chair's seat slides under)
  const legZ = [TABLE.head - 0.4]
  for (let i = 2; i < N - 1; i += 3) legZ.push(settingZ(i) - TABLE.step / 2)
  legZ.push(TABLE.head - TABLE.length + 0.4)
  const legs = new THREE.InstancedMesh(legGeo, steelMat, legZ.length * 2)
  legZ.forEach((z, i) => {
    for (let s = 0; s < 2; s++) set(legs, i * 2 + s, (s ? 1 : -1) * (TABLE.width / 2 - 0.3), 0, z)
  })
  // a dark apron under the top's edge
  const apronGeo = new THREE.BoxGeometry(TABLE.width - 0.5, 0.3, TABLE.length - 0.6)
  apronGeo.translate(0, -0.29, TABLE.head - TABLE.length / 2)
  const apron = new THREE.Mesh(apronGeo, new THREE.MeshStandardMaterial({ color: '#171211', roughness: 0.6 }))
  group.add(legs, apron)

  // ---- stemware. The three near glasses are real (transmission, rosé); the rest
  // are cheap stand-ins sharing the goblet's shell: black + additive, so only
  // the reflections and the candle glints show.
  const glasses: Glass[] = []
  const realAt: [number, number][] = [
    [1.55, 0.85], // beside the prints
    [-0.6, settingZ(0) - 0.5],
    [0.6, settingZ(0) - 0.5],
  ]
  for (const [x, z] of realAt) {
    const g = makeGlass({ shape: 'goblet', beer: BEERS.rose, scale: 0.62, fill: 0.55, head: 0 })
    g.group.position.set(x, 0, z)
    group.add(g.group)
    glasses.push(g)
  }
  // (their own low-poly goblet: the kit's shell is a 96-segment lathe, 17k triangles, and 24 of
  // them were over half of every frame here; at 2–20 px on screen ~600 triangles read the same)
  const shell = standInGoblet(glasses[0].glass.geometry, mobile ? 14 : 18)
  const stand = new THREE.InstancedMesh(
    shell,
    new THREE.MeshStandardMaterial({
      color: '#000000',
      roughness: 0.04,
      metalness: 0,
      envMapIntensity: 2.4,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    N * 2,
  )
  let si = 0
  for (let i = 0; i < N; i++) {
    for (let s = 0; s < 2; s++) {
      if (i === 0) continue // the real ones
      const side = s ? 1 : -1
      set(stand, si++, side * 0.6, 0, settingZ(i) - 0.5, 0, 0.62, 0.62, 0.62)
    }
  }
  stand.count = si
  stand.renderOrder = 2
  group.add(stand)

  // ---- candles: clusters of three tapers in brass holders down the runner
  const groups = N
  const cz = (i: number) => settingZ(i) - TABLE.step / 2
  const holderGeo = new THREE.LatheGeometry(
    [
      [0, 0],
      [0.1, 0],
      [0.105, 0.012],
      [0.07, 0.03],
      [0.03, 0.05],
      [0.022, 0.16],
      [0.05, 0.2],
      [0.06, 0.225],
      [0.05, 0.23],
      [0.0, 0.23],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    24,
  )
  const holders = new THREE.InstancedMesh(
    holderGeo,
    new THREE.MeshStandardMaterial({ color: '#c89a52', metalness: 1, roughness: 0.28 }),
    groups * 3,
  )
  const taperGeo = new THREE.CylinderGeometry(0.036, 0.042, 1, 14)
  taperGeo.translate(0, 0.5, 0)
  const tapers = new THREE.InstancedMesh(
    taperGeo,
    new THREE.MeshStandardMaterial({ color: '#efe4cf', roughness: 0.55, emissive: '#b0601e', emissiveIntensity: 0.3 }),
    groups * 3,
  )
  const flameGeo = new THREE.PlaneGeometry(1, 1)
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmp: { value: 1 }, uSize: { value: 0.62 }, uGlow: { value: 1 } },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const flames = new THREE.InstancedMesh(flameGeo, flameMat, groups * 3)
  const phase = new Float32Array(groups * 3)
  const flamePos: THREE.Vector3[] = []
  for (let i = 0; i < groups; i++) {
    const z = cz(i)
    const hs = [0.82 + R() * 0.1, 1.02 + R() * 0.1, 0.9 + R() * 0.1]
    for (let j = 0; j < 3; j++) {
      const k = i * 3 + j
      const x = (j - 1) * 0.2 + (R() - 0.5) * 0.03
      const zz = z + (j === 1 ? -0.08 : 0.06) + (R() - 0.5) * 0.04
      set(holders, k, x, 0.003, zz)
      set(tapers, k, x, 0.2, zz, 0, 1, hs[j], 1)
      const fy = 0.2 + hs[j] + 0.035
      set(flames, k, x, fy, zz)
      phase[k] = R()
      if (i < 3) flamePos.push(new THREE.Vector3(x, fy, zz))
    }
  }
  flameGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1))
  flames.frustumCulled = false
  flames.renderOrder = 5
  group.add(holders, tapers, flames)

  // ---- bouquets: a bud vase and a small dome of blush and cream roses at each setting line
  const vaseGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.26, 16)
  vaseGeo.translate(0, 0.13, 0)
  const vases = new THREE.InstancedMesh(vaseGeo, new THREE.MeshPhysicalMaterial({ color: '#f2eee6', roughness: 0.18, clearcoat: 0.8 }), N)
  const bloomGeo = new THREE.IcosahedronGeometry(0.07, 1)
  const PER = 7
  const blooms = new THREE.InstancedMesh(bloomGeo, new THREE.MeshStandardMaterial({ roughness: 0.75 }), N * PER)
  const leafGeo = new THREE.SphereGeometry(0.05, 8, 6)
  leafGeo.scale(1.6, 0.35, 0.7)
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: '#3c4a2a', roughness: 0.8 }), N * 4)
  const tints = ['#f4ece2', '#f1d6cf', '#e9b7ae', '#fbf6ee', '#e7c3b4']
  const col = new THREE.Color()
  for (let i = 0; i < N; i++) {
    const z = settingZ(i)
    set(vases, i, 0, 0.003, z)
    for (let j = 0; j < PER; j++) {
      const a = (j / PER) * Math.PI * 2 + R()
      const rr = j === 0 ? 0 : 0.09 + R() * 0.03
      const s = 0.85 + R() * 0.35
      set(blooms, i * PER + j, Math.cos(a) * rr, 0.36 + (j === 0 ? 0.06 : 0.01) + R() * 0.03, z + Math.sin(a) * rr, R() * 6, s, s * 0.8, s, R(), 0)
      blooms.setColorAt(i * PER + j, col.set(tints[Math.floor(R() * tints.length)]))
    }
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + R()
      set(leaves, i * 4 + j, Math.cos(a) * 0.16, 0.3, z + Math.sin(a) * 0.16, -a, 1, 1, 1, 0, 0.5)
    }
  }
  group.add(vases, blooms, leaves)

  // the pendants over the table light it too (room kit pools: no real lights)
  for (const m of [top, runner, plates, naps, chairs, seats, tapers, vases, blooms, apron]) lit(m)

  // ---- candle light: three warm points low over the head of the table
  const lights: THREE.PointLight[] = []
  for (let i = 0; i < 3; i++) {
    const L = new THREE.PointLight('#ff9a4a', 0, mobile ? 9 : 12, 2)
    const f = flamePos[i * 3 + 1]
    L.position.set(0, f.y + 0.1, f.z)
    group.add(L)
    lights.push(L)
  }

  return {
    group,
    lights,
    glasses,
    update(time, amp) {
      flameMat.uniforms.uTime.value = time
      flameMat.uniforms.uAmp.value = amp
    },
  }
}
