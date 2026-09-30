import * as THREE from 'three'
import { makeBarTop } from '../../kit/bar'
import { makeGlass, BEERS, type Glass } from '../../kit/beer'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng } from '../../core/math'

/*
 * THE BACK ROOM: one long banquet table set for a party, receding into the
 * dark. Units: 1 ≈ 10 in. The table top is y = 0; its head (where the prints
 * lie) is at z ≈ +3 and it runs to z ≈ -43.
 *
 * Every repeat is an InstancedMesh: plates, black napkins, cutlery, cheap
 * stand-in stemware (additive glints, no transmission), bentwood chair backs,
 * brass holders, taper candles, flames (one billboard shader: a teardrop core
 * and a soft halo, flickering gently by time), little bouquets. Only THREE
 * glasses near the camera are real transmissive kit glasses (rosé).
 */

export const TABLE = {
  /** z of the head end of the table */
  head: 3.1,
  length: 46,
  width: 3.4,
  /** place settings */
  first: -0.9,
  step: 2.3,
  n: 19,
  plateX: 1.12,
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

export function makeBanquetTable(mobile: boolean): BanquetTable {
  const group = new THREE.Group()
  const R = rng(7)

  // ---- the table (oiled planks, grain along its length)
  const top = makeBarTop({ length: TABLE.length, depth: TABLE.width, thickness: 0.14 })
  top.rotation.y = Math.PI / 2
  top.position.z = TABLE.head - TABLE.length / 2
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
  // ---- chairs: the bentwood backs rise just above the table edge
  const arc = new THREE.TorusGeometry(0.3, 0.032, 8, 20, Math.PI)
  arc.translate(0, 0.12, 0)
  const postL = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8)
  postL.translate(-0.3, 0.12 - 0.75, 0)
  const postR = postL.clone()
  postR.translate(0.6, 0, 0)
  const rail = new THREE.TorusGeometry(0.3, 0.02, 6, 20, Math.PI)
  rail.translate(0, -0.12, 0)
  const seat = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20)
  seat.translate(0, -1.35, -0.36)
  const chairGeo = mergeGeometries([arc, postL, postR, rail, seat])!
  const chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: '#17100c', roughness: 0.5 }), N * 2)
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
      // chair back: an arch facing along x (the diner's back), top at y ≈ 0.42
      set(chairs, k, side * 2.0, 0.08, z + (R() - 0.5) * 0.08, side * Math.PI / 2 + (R() - 0.5) * 0.12)
    }
  }
  plates.receiveShadow = true
  naps.receiveShadow = true
  group.add(plates, naps, cut, chairs)

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
  const shell = glasses[0].glass.geometry
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
