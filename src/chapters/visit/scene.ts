import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeBrickWall } from '../../kit/bar'

/*
 * LAST CALL — the set: the front of the house at night, seen from inside.
 *
 *   - the brick front wall (running bond, world-anchored so the pieces line
 *     up) with a tall window opening cut into it,
 *   - the painted wall sign on the brick beside the window (drawn in Alfa
 *     Slab One on a canvas, whitewash that sinks into the mortar and wears
 *     off in places — the photo is too skewed to use as a texture),
 *   - Glory's tall black-framed window (two sashes of small panes and a
 *     transom), with a glass that only adds reflections,
 *   - and outside: Chestnut Street out of focus (a shader, not a photo):
 *     warm brick facades lit by lanterns and a shop window, wet cobbles with
 *     long reflections, and now and then a car's lights sliding past.
 *
 * World units: the window opening spans x 0.7..4.3, y 0.9..7.7; the wall
 * is the plane z = 0 facing +z; the sill top is y = 0.9.
 */

export const WIN = { x0: 0.7, x1: 4.3, y0: 0.9, y1: 7.7, depth: 0.34 }
/** the plane the street is painted on */
export const STREET_Z = -9
/** the floor of the room */
const FLOOR = -2.2
/** brick tile size (8 courses per tile) and one course */
const TILE = 1.3
export const COURSE = TILE / 8
export const SIGN = { x0: -3.05, x1: 0.25, y0: COURSE * 21, y1: COURSE * 31 }

/** A brick piece whose courses line up with every other piece (texture offset = world position). */
function brickPiece(x0: number, x1: number, y0: number, y1: number): THREE.Mesh {
  const w = x1 - x0
  const h = y1 - y0
  const m = makeBrickWall(w, h)
  const mat = m.material as THREE.MeshStandardMaterial
  mat.map!.repeat.set(w / TILE, h / TILE)
  mat.map!.offset.set(x0 / TILE, y0 / TILE)
  mat.color.set('#8c7468')
  m.position.set(x0 + w / 2, y0 + h / 2, 0)
  return m
}

export function makeWall(): THREE.Group {
  const g = new THREE.Group()
  const { x0, x1, y0, y1 } = WIN
  g.add(brickPiece(-10, x0, FLOOR, 12), brickPiece(x1, 11, FLOOR, 12), brickPiece(x0, x1, y1, 12), brickPiece(x0, x1, FLOOR, y0 - 0.14))
  // a black-painted skirting board and the old floorboards, dark
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(21, 0.34, 0.05), new THREE.MeshStandardMaterial({ color: '#0f0c0b', roughness: 0.5 }))
  skirt.position.set(0.5, FLOOR + 0.17, 0.025)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: '#0b0705', roughness: 0.92 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0.5, FLOOR, 15)
  floor.receiveShadow = true
  g.add(skirt, floor)
  return g
}

// ─── the window ─────────────────────────────────────────────────────────────

export function makeWindow(): { group: THREE.Group; frameMat: THREE.MeshStandardMaterial; glassMat: THREE.MeshStandardMaterial } {
  const { x0, x1, y0, y1, depth } = WIN
  const group = new THREE.Group()
  const geos: THREE.BufferGeometry[] = []
  const box = (cx: number, cy: number, cz: number, w: number, h: number, d: number) => {
    const b = new THREE.BoxGeometry(w, h, d)
    b.translate(cx, cy, cz)
    geos.push(b)
  }
  const zf = -depth + 0.06
  // the reveal: black-painted linings of the opening (jambs + head)
  box(x0 + 0.015, (y0 + y1) / 2, -depth / 2, 0.03, y1 - y0, depth)
  box(x1 - 0.015, (y0 + y1) / 2, -depth / 2, 0.03, y1 - y0, depth)
  box((x0 + x1) / 2, y1 - 0.015, -depth / 2, x1 - x0, 0.03, depth)
  // the outer frame
  const F = 0.15
  box(x0 + F / 2, (y0 + y1) / 2, zf, F, y1 - y0, 0.14)
  box(x1 - F / 2, (y0 + y1) / 2, zf, F, y1 - y0, 0.14)
  box((x0 + x1) / 2, y1 - F / 2, zf, x1 - x0, F, 0.14)
  box((x0 + x1) / 2, y0 + 0.1, zf, x1 - x0, 0.2, 0.14)
  // two sashes meeting at a centre stile, a transom rail above them
  const xm = (x0 + x1) / 2
  const ty = y1 - 1.25
  box(xm, (y0 + ty) / 2, zf + 0.01, 0.16, ty - y0, 0.13)
  box((x0 + x1) / 2, ty, zf + 0.01, x1 - x0, 0.14, 0.13)
  // sash stiles (each sash has its own frame line, so the pair reads as doors)
  for (const sx of [x0 + F + 0.04, xm - 0.12, xm + 0.12, x1 - F - 0.04]) box(sx, (y0 + 0.2 + ty) / 2, zf + 0.02, 0.07, ty - y0 - 0.2, 0.1)
  // muntins: each sash 2 panes across, 5 down; the transom 2 + 2
  const M = 0.045
  const sashes: [number, number][] = [
    [x0 + F + 0.075, xm - 0.155],
    [xm + 0.155, x1 - F - 0.075],
  ]
  const yb = y0 + 0.2
  for (const [a, b] of sashes) {
    box((a + b) / 2, (yb + ty) / 2, zf + 0.03, M, ty - yb, 0.07)
    for (let r = 1; r < 5; r++) {
      const yy = yb + ((ty - 0.07 - yb) * r) / 5
      box((a + b) / 2, yy, zf + 0.03, b - a, M, 0.07)
    }
    box((a + b) / 2, (ty + y1 - F) / 2, zf + 0.03, M, y1 - F - ty, 0.07)
  }
  const frameGeo = mergeGeometries(geos)!
  geos.forEach(g => g.dispose())
  // black-painted wood: satin, so it catches the studio strips along its edges
  const frameMat = new THREE.MeshStandardMaterial({ color: '#0f0c0b', roughness: 0.55, metalness: 0, envMapIntensity: 0.6 })
  const frame = new THREE.Mesh(frameGeo, frameMat)
  frame.castShadow = false
  frame.receiveShadow = true
  group.add(frame)

  // the glass: black + additive, so it only ADDS its reflections (cheap, no transmission)
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#000000',
    roughness: 0.06,
    metalness: 0,
    envMapIntensity: 0.35,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, y1 - y0 - 0.1), glassMat)
  glass.position.set(xm, (y0 + y1) / 2, zf - 0.02)
  group.add(glass)
  return { group, frameMat, glassMat }
}

// ─── the street outside (out of focus) ──────────────────────────────────────

const STREET_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const STREET_FRAG = /* glsl */ `
  uniform float uTime, uCar, uCarX, uLevel;
  uniform vec2 uBack;
  uniform vec3 uSky, uBrick, uLamp, uShop, uCobble, uHead, uTail;
  varying vec2 vP;

  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  // a soft (defocused) box: 1 inside, falling off over b
  float sbox(vec2 p, vec2 c, vec2 h, float b) {
    vec2 d = abs(p - c) - h;
    float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    return 1.0 - smoothstep(-b, b, o);
  }
  float disc(vec2 p, vec2 c, float r, float b) { return 1.0 - smoothstep(r - b, r + b, length(p - c)); }

  void main() {
    // the design sits a little low: from inside, the sill hides most of the road
    vec2 p = vP + vec2(0.0, 1.1);
    // ---- night sky over the cornice
    vec3 c = uSky * (0.55 + 0.45 * smoothstep(16.0, 10.0, p.y));

    // ---- two colonial lanterns on posts along the far sidewalk
    vec2 L1 = vec2(5.6, 4.9);
    vec2 L2 = vec2(-2.6, 4.9);
    float glow = exp(-dot(p - L1, p - L1) * 0.09) + exp(-dot(p - L2, p - L2) * 0.09);

    // ---- the facade across the street: old brick in shadow, warmed by the lanterns
    float facade = 1.0 - smoothstep(10.2, 10.5, p.y);
    float courses = 0.85 + 0.15 * noise(p * vec2(0.9, 5.0));
    vec3 fc = uBrick * courses * (0.1 + 0.9 * glow) + vec3(0.004, 0.006, 0.014);
    // cornice
    fc = mix(fc, vec3(0.006, 0.006, 0.01), sbox(p, vec2(0.0, 10.05), vec2(40.0, 0.14), 0.12));
    // upper floors: a window every 1.6, two rows; some lit warm, the rest dark glass with the sky in them
    if (p.y > 4.9 && p.y < 9.8) {
      vec2 cell = vec2(floor((p.x + 0.8) / 1.6), floor((p.y - 5.0) / 2.35));
      vec2 wc = vec2(cell.x * 1.6 + 0.0, 5.0 + cell.y * 2.35 + 0.8);
      float w = sbox(p, wc, vec2(0.34, 0.66), 0.12);
      float lit = step(0.6, hash(cell + 7.0));
      vec3 dark = uSky * 0.35 + uLamp * 0.035 * glow;
      vec3 room = uShop * (0.07 + 0.16 * hash(cell + 2.0)) * (0.75 + 0.25 * smoothstep(wc.y + 0.6, wc.y - 0.6, p.y));
      // the sash bar and a half-drawn blind in some
      w *= 1.0 - 0.7 * sbox(p, wc, vec2(0.36, 0.035), 0.03);
      room *= 1.0 - 0.6 * step(0.5, hash(cell + 4.0)) * smoothstep(wc.y + 0.1, wc.y + 0.2, p.y);
      fc = mix(fc, mix(dark, room, lit), w);
      // a stone lintel and sill catch the lantern
      fc += uLamp * 0.05 * glow * (sbox(p, wc + vec2(0.0, 0.76), vec2(0.42, 0.06), 0.05) + sbox(p, wc - vec2(0.0, 0.74), vec2(0.4, 0.04), 0.05));
    }
    // ground floor: a sign band, a lit shop window, a door, a darker shop
    fc = mix(fc, vec3(0.012, 0.01, 0.01), sbox(p, vec2(2.6, 4.45), vec2(6.0, 0.22), 0.06));
    float shopA = sbox(p, vec2(1.5, 2.95), vec2(1.2, 0.95), 0.06);
    float shopB = sbox(p, vec2(6.4, 2.95), vec2(1.1, 0.95), 0.06);
    float door = sbox(p, vec2(3.45, 2.75), vec2(0.4, 1.15), 0.05);
    vec3 shopC = uShop * 0.42 * (0.7 + 0.3 * smoothstep(2.0, 3.9, p.y));
    // inside the shop: pendant bokeh and dark shapes
    float bk = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      bk += disc(p, vec2(0.55 + fi * 0.5, 3.55 - 0.08 * mod(fi, 2.0)), 0.13, 0.05) * (0.6 + 0.4 * hash(vec2(fi, 3.0)));
    }
    shopC += uLamp * bk * 0.7;
    shopC *= 1.0 - 0.55 * sbox(p, vec2(1.9, 2.3), vec2(0.5, 0.35), 0.15);
    // mullions of the shop window
    shopC *= 1.0 - 0.8 * max(sbox(p, vec2(1.5, 2.95), vec2(0.03, 1.0), 0.02), sbox(p, vec2(1.5, 3.45), vec2(1.25, 0.03), 0.02));
    fc = mix(fc, shopC, shopA);
    fc = mix(fc, uShop * 0.08 + uLamp * 0.03, shopB);
    fc = mix(fc, vec3(0.01, 0.008, 0.008) + uShop * 0.3 * sbox(p, vec2(3.45, 3.75), vec2(0.36, 0.12), 0.04), door);
    c = mix(c, fc, facade);

    // ---- the sidewalk, an iron railing, the curb
    float walk = smoothstep(1.7, 1.5, p.y);
    vec3 wk = vec3(0.022, 0.022, 0.028) + uShop * 0.06 * sbox(p, vec2(1.5, 1.4), vec2(1.6, 0.3), 0.4) + uLamp * 0.06 * glow;
    c = mix(c, wk, walk);
    float rail = sbox(vec2(fract(p.x * 5.0) - 0.5, p.y), vec2(0.0, 1.95), vec2(0.06, 0.45), 0.04);
    rail = max(rail, sbox(p, vec2(0.0, 2.38), vec2(40.0, 0.03), 0.02));
    rail *= 1.0 - smoothstep(3.0, 3.4, abs(p.x - 1.4));
    c = mix(c, vec3(0.004), rail * 0.85);
    c = mix(c, vec3(0.03, 0.03, 0.035) + uLamp * 0.04 * glow, sbox(p, vec2(0.0, 1.0), vec2(40.0, 0.07), 0.03));

    // ---- wet cobbles: rounded setts, glossy, with long reflections
    float street = smoothstep(0.98, 0.9, p.y);
    vec2 cs = p * vec2(3.2, 5.6);
    cs.x += mod(floor(cs.y), 2.0) * 0.5;
    vec2 cf = fract(cs) - 0.5;
    float stone = (1.0 - smoothstep(0.1, 0.55, length(cf * vec2(0.9, 1.15)))) * 0.5 + 0.5 * noise(p * vec2(1.5, 6.0));
    float gloss = stone * (0.4 + 0.6 * hash(floor(cs)));
    float refl = sbox(vec2(p.x, 0.0), vec2(1.5, 0.0), vec2(1.1, 1.0), 0.3) * 0.5;
    refl += sbox(vec2(p.x, 0.0), vec2(6.4, 0.0), vec2(1.0, 1.0), 0.3) * 0.12;
    float lampR = exp(-(p.x - L1.x) * (p.x - L1.x) * 2.5) + exp(-(p.x - L2.x) * (p.x - L2.x) * 2.5);
    float wet = 0.35 + 0.65 * noise(p * vec2(0.8, 7.0));
    vec3 cob = uCobble * (0.8 + 0.2 * stone) + (uShop * refl * 0.4 + uLamp * lampR * 0.4) * mix(wet, gloss, 0.25) * smoothstep(-3.0, 0.9, p.y);
    c = mix(c, cob, street);

    // ---- a lit bay window straight behind the pint (from the resting camera),
    // so the beer always has warm light to glow against
    {
      vec2 q = vP - uBack;
      float bay = sbox(q, vec2(0.0, 0.2), vec2(1.6, 1.6), 0.6);
      float bars = 1.0 - 0.35 * sbox(vec2(q.x, 0.0), vec2(0.0), vec2(0.04, 9.0), 0.08);
      c = mix(c, uShop * 0.8 * bars * (0.8 + 0.2 * smoothstep(-1.0, 1.4, q.y)), bay * 0.9);
    }

    // ---- lantern posts and the lanterns themselves, out of focus
    c = mix(c, vec3(0.006), sbox(p, vec2(L1.x, 2.6), vec2(0.06, 2.0), 0.05) * 0.9);
    c = mix(c, vec3(0.006), sbox(p, vec2(L2.x, 2.6), vec2(0.06, 2.0), 0.05) * 0.9);
    c += uLamp * (disc(p, L1, 0.34, 0.1) * 1.7 + exp(-dot(p - L1, p - L1) * 2.2) * 0.5);
    c += uLamp * (disc(p, L2, 0.34, 0.1) * 1.4 + exp(-dot(p - L2, p - L2) * 2.2) * 0.45);
    // far lights down the street: small warm bokeh
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 bc = vec2(-6.0 + fi * 2.3 + 0.7 * sin(fi * 3.7), 1.8 + 3.5 * hash(vec2(fi, 9.0)));
      c += uLamp * disc(p, bc, 0.12 + 0.08 * hash(vec2(fi, 1.0)), 0.05) * 0.18 * (1.0 - facade * 0.6);
    }

    // ---- a car sliding past (uCar 0..1, uCarX its nose along the street)
    if (uCar > 0.001) {
      float fx = uCarX;
      float body = max(sbox(p, vec2(fx - 1.5, 0.62), vec2(1.55, 0.3), 0.14), sbox(p, vec2(fx - 1.7, 1.02), vec2(0.9, 0.22), 0.14));
      c = mix(c, vec3(0.006, 0.006, 0.008), body * 0.9 * uCar);
      // glass of the car picks up the shop light
      c += uShop * 0.05 * sbox(p, vec2(fx - 1.7, 1.02), vec2(0.8, 0.16), 0.08) * uCar;
      vec3 head = uHead * disc(p, vec2(fx - 0.05, 0.62), 0.12, 0.06) * 1.4;
      head += uHead * exp(-dot(p - vec2(fx + 0.6, 0.55), p - vec2(fx + 0.6, 0.55)) * 1.4) * 0.35;
      vec3 tail = uTail * disc(p, vec2(fx - 3.0, 0.7), 0.09, 0.05) * 0.9;
      // its headlight wash thrown ahead on the stones
      float wash = exp(-((p.x - fx - 2.0) * (p.x - fx - 2.0)) * 0.25) * smoothstep(0.9, 0.2, p.y) * gloss;
      c += (head + tail + uHead * wash * 0.3) * uCar;
    }

    gl_FragColor = vec4(c * uLevel, 1.0);
  }
`

export interface Street {
  mesh: THREE.Mesh
  uniforms: {
    uTime: THREE.IUniform<number>
    uCar: THREE.IUniform<number>
    uCarX: THREE.IUniform<number>
    uLevel: THREE.IUniform<number>
    uBack: THREE.IUniform<THREE.Vector2>
  }
}

export function makeStreet(): Street {
  const uniforms = {
    uTime: { value: 0 },
    uCar: { value: 0 },
    uCarX: { value: -10 },
    uLevel: { value: 1 },
    uBack: { value: new THREE.Vector2(2.6, 1.0) },
    uSky: { value: new THREE.Color('#0b1430') },
    uBrick: { value: new THREE.Color('#4a2418') },
    uLamp: { value: new THREE.Color('#ffc27a') },
    uShop: { value: new THREE.Color('#ffb869') },
    uCobble: { value: new THREE.Color('#10121a') },
    uHead: { value: new THREE.Color('#fff0d8') },
    uTail: { value: new THREE.Color('#ff2a1a') },
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: STREET_VERT,
    fragmentShader: STREET_FRAG,
    uniforms,
    toneMapped: false,
    fog: false,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(44, 26), mat)
  mesh.position.set(2.5, 5, STREET_Z)
  return { mesh, uniforms }
}

// ─── the painted wall sign ──────────────────────────────────────────────────

/** Draw text with manual letter spacing (canvas letterSpacing isn't in Safari), centred on cx, fitted to maxW. */
function spaced(g: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number, track: number, maxW: number, family: string) {
  let s = size
  const measure = () => {
    g.font = `400 ${s}px ${family}`
    let w = 0
    for (const ch of text) w += g.measureText(ch).width + track * s
    return w - track * s
  }
  let w = measure()
  if (w > maxW) {
    s *= maxW / w
    w = measure()
  }
  let x = cx - w / 2
  for (const ch of text) {
    g.fillText(ch, x, y)
    x += g.measureText(ch).width + track * s
  }
}

/**
 * The sign as a canvas: whitewash letters and rules on transparent, worn
 * through where the paint sat on the mortar and in scuffs here and there.
 * 640 px per world unit; the brick courses fall every 0.3 units from the
 * sign's bottom edge (it sits on a course line).
 */
export function drawSign(cv: HTMLCanvasElement) {
  const W = cv.width
  const H = cv.height
  const g = cv.getContext('2d')!
  g.clearRect(0, 0, W, H)
  const paint = 'rgba(238, 229, 211, 0.94)'
  g.fillStyle = paint
  g.strokeStyle = paint
  const alfa = '"Alfa Slab One", Rockwell, Georgia, serif'
  // outer rule
  g.lineWidth = 12
  g.strokeRect(34, 34, W - 68, H - 68)
  g.textBaseline = 'alphabetic'
  // GLORY
  spaced(g, 'GLORY', W / 2, H * 0.47, 400, 0.08, W - 200, alfa)
  // BEER BAR & KITCHEN
  spaced(g, 'BEER BAR & KITCHEN', W / 2, H * 0.64, 118, 0.1, W - 260, alfa)
  // inner box + THIS MUST BE THE PLACE
  g.lineWidth = 8
  const bx = 120
  const by = H * 0.7
  g.strokeRect(bx, by, W - bx * 2, H * 0.2)
  spaced(g, 'THIS MUST BE THE PLACE', W / 2, by + H * 0.2 * 0.72, 84, 0.12, W - bx * 2 - 90, alfa)

  // wear: the paint thins over the mortar courses, and scuffs off in patches
  g.globalCompositeOperation = 'destination-out'
  const row = (H * COURSE) / (SIGN.y1 - SIGN.y0)
  for (let y = H; y > 0; y -= row) {
    const grad = g.createLinearGradient(0, y - 14, 0, y + 14)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(0.5, 'rgba(0,0,0,0.6)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, y - 14, W, 28)
  }
  let seed = 23
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W
    const y = rnd() * H
    const r = 2 + rnd() * rnd() * 22
    g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.6})`
    g.beginPath()
    g.ellipse(x, y, r * (1 + rnd() * 2), r, rnd() * 0.4, 0, Math.PI * 2)
    g.fill()
  }
  // a few long, soft worn streaks
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W
    const y = rnd() * H
    const grd = g.createRadialGradient(x, y, 0, x, y, 120 + rnd() * 200)
    grd.addColorStop(0, `rgba(0,0,0,${0.3 + rnd() * 0.35})`)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(x - 330, y - 330, 660, 660)
  }
  g.globalCompositeOperation = 'source-over'
}

export function makeSign(): { mesh: THREE.Mesh; tex: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const { x0, x1, y0, y1 } = SIGN
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  drawSign(canvas)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: 0.95,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    color: '#f4ecdd',
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), mat)
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.004)
  mesh.receiveShadow = true
  return { mesh, tex, canvas }
}

// ─── the G roundel coaster ──────────────────────────────────────────────────

export function makeCoaster(roundelUrl: string): THREE.Mesh {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 512
  const g = cv.getContext('2d')!
  const paintRing = () => {
    g.strokeStyle = '#d8272e'
    g.lineWidth = 22
    g.beginPath()
    g.arc(256, 256, 226, 0, Math.PI * 2)
    g.stroke()
  }
  g.fillStyle = '#f1e8d6'
  g.beginPath()
  g.arc(256, 256, 256, 0, Math.PI * 2)
  g.fill()
  paintRing()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const img = new Image()
  img.onload = () => {
    g.save()
    g.beginPath()
    g.arc(256, 256, 214, 0, Math.PI * 2)
    g.clip()
    g.imageSmoothingQuality = 'high'
    // the roundel's G sits inside its own ring: draw it large, clip the ring off
    g.drawImage(img, 256 - 250, 256 - 250, 500, 500)
    g.restore()
    g.fillStyle = 'rgba(241,232,214,1)'
    g.beginPath()
    g.arc(256, 256, 256, 0, Math.PI * 2)
    g.arc(256, 256, 214, 0, Math.PI * 2, true)
    g.fill()
    paintRing()
    tex.needsUpdate = true
  }
  img.src = roundelUrl
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
  const side = new THREE.MeshStandardMaterial({ color: '#d9cdb6', roughness: 0.9 })
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.025, 48), [side, top, side])
  m.receiveShadow = true
  return m
}

// ─── a votive on the sill ───────────────────────────────────────────────────

export function makeVotive(): { group: THREE.Group; flame: THREE.Sprite; flameMat: THREE.SpriteMaterial; jarMat: THREE.MeshStandardMaterial } {
  const group = new THREE.Group()
  const jarMat = new THREE.MeshStandardMaterial({
    color: '#3a1c0a',
    emissive: new THREE.Color('#ff8a2a'),
    emissiveIntensity: 0.5,
    roughness: 0.25,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.155, 0.26, 32, 1, true), jarMat)
  jar.position.y = 0.13
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.03, 32), new THREE.MeshStandardMaterial({ color: '#2a160c', roughness: 0.6 }))
  base.position.y = 0.015
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')!
  const gr = g.createRadialGradient(32, 38, 0, 32, 38, 30)
  gr.addColorStop(0, 'rgba(255,236,200,0.75)')
  gr.addColorStop(0.22, 'rgba(255,170,80,0.45)')
  gr.addColorStop(1, 'rgba(255,120,30,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  const ft = new THREE.CanvasTexture(cv)
  ft.colorSpace = THREE.SRGBColorSpace
  const flameMat = new THREE.SpriteMaterial({ map: ft, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })
  const flame = new THREE.Sprite(flameMat)
  flame.scale.set(0.16, 0.24, 1)
  flame.position.y = 0.34
  flame.renderOrder = 2
  group.add(base, jar, flame)
  return { group, flame, flameMat, jarMat }
}
