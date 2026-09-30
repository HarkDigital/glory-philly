import * as THREE from 'three'
import type { Frame } from '../core/types'

/*
 * The shared world for GLORY: a product film shot in a beer bar. Resonance's
 * photo studio (a bone-white cyclorama, softbox strips, liquid highlights)
 * crossed with Glory's own room (exposed brick, Edison bulbs, a long bar).
 *
 *  - BACKDROP (a camera-centred dome): a vertical gradient (top/bottom), a
 *    soft STUDIO POOL of light behind the subject (cyc/cycColor/cycX/cycY: the
 *    product-shot sweep), an out-of-focus BRICK wall (world-anchored courses of
 *    running bond with mortar lines, so it parallaxes), a low band of HAZE,
 *    string BULBS in shallow swags, BOKEH of far lights. Beams exist but are
 *    off by default.
 *  - THE SPOT (the ONLY shadow caster): a key light from above and in front.
 *    Chapters aim it every frame (spotPos → spotAt, cone angle). Give props
 *    castShadow / receiveShadow yourself; keep tiny props from casting.
 *  - TWO RIM LIGHTS (no shadows): camera-relative directions (rimADir /
 *    rimBDir: x right, y up, z toward the camera — negative z is BEHIND the
 *    subject), colours rimA/rimB. Rims are what make glass and beer glow.
 *  - FILL: a low warm hemisphere.
 *  - STUDIO REFLECTIONS (PMREM, built at construction): two tall softbox
 *    strips, a big overhead softbox, a row of warm bulbs, brick-red bounce —
 *    so stainless taps, glassware and the beer's meniscus get product-shot
 *    highlights. Sweep them with envTurn.
 *
 * Keep what the engine calls: `object`, `params`, `resetParams()`,
 * `update(frame, camera)`, `warmEnv()`, `envMap`. Chapters set params every
 * frame they care; the engine resets them first; values are damped.
 */

export interface WorldParams {
  /** backdrop gradient (keep near black) */
  top: THREE.ColorRepresentation
  bottom: THREE.ColorRepresentation
  /** 0..1.5 the studio pool: a soft light on the backdrop behind the subject, its colour and screen centre (-1..1) */
  cyc: number
  cycColor: THREE.ColorRepresentation
  cycX: number
  cycY: number
  /** 0..1 out-of-focus brick wall in the backdrop, its colour (the mortar is lighter) */
  brick: number
  brickColor: THREE.ColorRepresentation
  /** 0..1.5 backlit smoke behind the subject, its colour and screen height (-1..1) */
  haze: number
  hazeColor: THREE.ColorRepresentation
  hazeY: number
  /** 0..1.5 stage beams through the haze, their two gel colours, 0..1 sway */
  beams: number
  beamA: THREE.ColorRepresentation
  beamB: THREE.ColorRepresentation
  sway: number
  /** 0..1.5 string lights (world-anchored strands of warm Edison bulbs) and their colour */
  bulbs: number
  bulbColor: THREE.ColorRepresentation
  /** 0..1.5 out-of-focus far lights (world-anchored) and their gels */
  bokeh: number
  bokehA: THREE.ColorRepresentation
  bokehB: THREE.ColorRepresentation
  /** the follow spot: intensity, colour, where it hangs, what it hits, cone (radians), penumbra 0..1 */
  spot: number
  spotColor: THREE.ColorRepresentation
  spotPos: THREE.Vector3
  spotAt: THREE.Vector3
  spotAngle: number
  spotPenumbra: number
  /** rim lights (camera-relative directions they come FROM) */
  rimA: number
  rimAColor: THREE.ColorRepresentation
  rimADir: THREE.Vector3
  rimB: number
  rimBColor: THREE.ColorRepresentation
  rimBDir: THREE.Vector3
  /** hemisphere fill */
  fill: number
  /** stage reflections strength and yaw (sweep the PAR row across lacquer) */
  env: number
  envTurn: number
}

/** The gels: the palette of stage light every chapter draws from. */
export const GEL = {
  /** Glory red (the sign, the G roundel) */
  glory: '#d8272e',
  /** beer */
  amber: '#e89a2c',
  straw: '#f2c45a',
  stout: '#1a0d07',
  /** foam, cyclorama, cream */
  cream: '#f3ead8',
  bone: '#ece6da',
  brick: '#7a3524',
  tungsten: '#ffc88a',
  bulb: '#ffb45e',
  candle: '#ff9a3c',
  dusk: '#6f8fc4',
  red: '#ff3a26',
  oxblood: '#9a1f16',
  magenta: '#ff3d7a',
  steel: '#8fb0ff',
  white: '#fff4e6',
}

export const WORLD_DEFAULTS = {
  top: '#140c09',
  bottom: '#050302',
  cyc: 0.5,
  cycColor: '#5a2e1c',
  cycX: 0.25,
  cycY: 0.05,
  brick: 0.55,
  brickColor: '#3a1a12',
  haze: 0.25,
  hazeColor: '#9a5a2e',
  hazeY: -0.15,
  beams: 0,
  beamA: GEL.amber,
  beamB: GEL.tungsten,
  sway: 0.3,
  bulbs: 0.8,
  bulbColor: GEL.bulb,
  bokeh: 0.2,
  bokehA: GEL.amber,
  bokehB: GEL.candle,
  spot: 0,
  spotColor: GEL.tungsten,
  spotAngle: 0.42,
  spotPenumbra: 0.55,
  rimA: 0,
  rimAColor: GEL.amber,
  rimB: 0,
  rimBColor: GEL.dusk,
  fill: 0.1,
  env: 1,
  envTurn: 0,
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uCycC, uBrickC;
  uniform float uCyc, uCycX, uCycY, uBrick;
  uniform vec3 uTop, uBottom, uHazeC, uBeamA, uBeamB, uBokehA, uBokehB, uBulbC;
  uniform float uHaze, uHazeY, uBeams, uSway, uBokeh, uBulbs, uTime, uMobile;
  uniform vec2 uRes;
  varying vec3 vDir;

  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float smoke(vec2 p) {
    float t = uTime * 0.035;
    float n = noise(p * 1.3 + vec2(t, -t * 0.6)) * 0.55;
    n += noise(p * 2.7 - vec2(t * 1.4, t * 0.3)) * 0.3;
    n += noise(p * 5.3 + vec2(-t, t * 2.0)) * 0.15;
    return n;
  }

  void main() {
    vec3 dir = normalize(vDir);
    // screen space (aspect-corrected, y up)
    vec2 s = gl_FragCoord.xy / uRes * 2.0 - 1.0;
    float aspect = uRes.x / uRes.y;
    s.x *= aspect;

    vec3 c = mix(uBottom, uTop, smoothstep(-1.1, 1.0, s.y));
    float sm = smoke(s * 0.9 + dir.xz * 0.6);

    // BRICK: running bond seen out of focus, world-anchored (azimuth/elevation)
    if (uBrick > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      vec2 b = vec2(phi * 9.0, el * 22.0);
      float row = floor(b.y);
      b.x += mod(row, 2.0) * 0.5;
      vec2 cell = floor(b);
      vec2 f = fract(b);
      // soft mortar (out of focus): distance to the cell edge
      float edge = min(min(f.x, 1.0 - f.x) * 2.2, min(f.y, 1.0 - f.y));
      float mortar = 1.0 - smoothstep(0.0, 0.16, edge);
      float tone = 0.72 + 0.5 * hash(cell + 3.1) + 0.18 * (noise(b * vec2(1.3, 0.7)) - 0.5);
      vec3 bc = uBrickC * tone;
      bc = mix(bc, uBrickC * 1.9 + vec3(0.03, 0.025, 0.02), mortar * 0.55);
      // a painted-over, lime-washed patch here and there
      bc = mix(bc, uBrickC * 2.6, smoothstep(0.62, 0.9, noise(vec2(phi * 1.4, el * 2.0) + 4.0)) * 0.35);
      c = mix(c, bc, uBrick * smoothstep(-0.55, -0.2, el));
    }

    // STUDIO POOL: the product-shot sweep of light on the backdrop
    if (uCyc > 0.001) {
      vec2 d = (s - vec2(uCycX * aspect, uCycY)) / vec2(1.25 * max(aspect, 1.0), 1.05);
      float pool = exp(-dot(d, d) * 1.6);
      c += uCycC * pool * uCyc;
    }

    // HAZE: a band of backlit smoke behind the subject
    if (uHaze > 0.001) {
      float band = exp(-(s.y - uHazeY) * (s.y - uHazeY) / 0.42);
      float side = exp(-s.x * s.x / (2.2 * aspect));
      c += uHazeC * uHaze * band * side * (0.35 + 0.9 * sm) * 0.42;
    }

    // BEAMS: fanned from sources above the frame, only visible in the smoke
    if (uBeams > 0.001) {
      float b = 0.0;
      vec3 bc = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float sx = (fi - 2.5) * 0.62 * aspect * 0.55;
        vec2 src = vec2(sx, 1.35);
        vec2 v = s - src;
        float ang = atan(v.x, -v.y);
        float aim = -sx * 0.32 + uSway * 0.22 * sin(uTime * 0.23 + fi * 1.7);
        float w = 0.055 + 0.02 * fract(fi * 0.37);
        float beam = exp(-(ang - aim) * (ang - aim) / (w * w));
        float fall = 1.0 / (1.0 + dot(v, v) * 0.55);
        float k = beam * fall * smoothstep(0.0, 0.3, -v.y);
        b += k;
        bc += k * (mod(fi, 2.0) < 1.0 ? uBeamA : uBeamB);
      }
      c += bc * uBeams * (0.25 + 0.95 * sm) * 0.34;
    }

    // BOKEH: out-of-focus truss lights, anchored to the world
    if (uBokeh > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      vec2 g = vec2(phi * 5.0, el * 5.0 - 0.4);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash(id + 7.1);
      if (id.y >= 0.0 && id.y <= 3.0 && h > 0.35) {
        vec2 o = vec2(hash(id + 1.3), hash(id + 5.9)) - 0.5;
        float r = mix(0.12, 0.26, hash(id + 3.3));
        float d = length(f - o * 0.25) / r;
        float disc = 1.0 - smoothstep(0.86, 1.0, d);
        float rim = smoothstep(0.7, 0.97, d) * disc;
        float bright = mix(0.4, 1.0, hash(id + 9.7)) * (0.85 + 0.15 * sin(uTime * 0.6 + h * 30.0));
        vec3 col = hash(id + 2.2) > 0.5 ? uBokehA : uBokehB;
        c += col * (disc * 0.55 + rim * 0.5) * bright * uBokeh * 0.5 * (1.0 - 0.25 * id.y / 3.0);
      }
    }

    // BULBS: strands of warm bulbs in shallow swags, out of focus
    if (uBulbs > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        // each strand: swags between posts every ~0.9 rad of azimuth
        float span = 0.9 + 0.25 * fk;
        float off = fk * 0.37;
        float u = (phi + off) / span;
        float sw = fract(u) - 0.5;
        float yEl = 0.34 + 0.13 * fk - 0.11 * (0.25 - sw * sw) * 4.0;
        // bulbs along the strand, evenly spaced
        float sp = 0.085 + 0.02 * fk;
        float bi = floor((phi + off * 0.5) / sp + 0.5);
        float bphi = bi * sp - off * 0.5;
        float bu = (bphi + off) / span;
        float bsw = fract(bu) - 0.5;
        float bEl = 0.34 + 0.13 * fk - 0.11 * (0.25 - bsw * bsw) * 4.0 - 0.012;
        vec2 dd = vec2((phi - bphi) * cos(el), el - bEl);
        float r = 0.02 + 0.012 * fk;
        float d = length(dd) / r;
        float disc = 1.0 - smoothstep(0.75, 1.0, d);
        float core = exp(-d * d * 5.0);
        float flick = 0.92 + 0.08 * sin(uTime * 1.3 + bi * 2.1 + fk);
        float far = 1.0 - 0.28 * fk;
        c += uBulbC * (disc * 0.45 + core * 0.9) * uBulbs * flick * far * 0.55;
        // the wire, very faint
        c += uBulbC * 0.02 * uBulbs * (1.0 - smoothstep(0.0, 0.0035, abs(el - yEl))) * far;
      }
    }

    c += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding
    gl_FragColor = vec4(c, 1.0);
  }
`

export class World {
  object = new THREE.Group()
  /** stage reflections (PMREM); materials may use it directly */
  envMap: THREE.Texture
  spot: THREE.SpotLight
  rimA: THREE.DirectionalLight
  rimB: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  params: WorldParams
  private dome: THREE.Mesh
  private scene: THREE.Scene
  private cur = {
    top: new THREE.Color(),
    bottom: new THREE.Color(),
    cycColor: new THREE.Color(),
    brickColor: new THREE.Color(),
    hazeColor: new THREE.Color(),
    beamA: new THREE.Color(),
    beamB: new THREE.Color(),
    bokehA: new THREE.Color(),
    bokehB: new THREE.Color(),
    bulbColor: new THREE.Color(),
    spotColor: new THREE.Color(),
    rimAColor: new THREE.Color(),
    rimBColor: new THREE.Color(),
    spotPos: new THREE.Vector3(),
    spotAt: new THREE.Vector3(),
    n: {} as Record<string, number>,
  }
  private first = true
  private uniforms = {
    uCycC: { value: new THREE.Color() },
    uBrickC: { value: new THREE.Color() },
    uCyc: { value: 0 },
    uCycX: { value: 0 },
    uCycY: { value: 0 },
    uBrick: { value: 0 },
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uHazeC: { value: new THREE.Color() },
    uBeamA: { value: new THREE.Color() },
    uBeamB: { value: new THREE.Color() },
    uBokehA: { value: new THREE.Color() },
    uBokehB: { value: new THREE.Color() },
    uBulbC: { value: new THREE.Color() },
    uBulbs: { value: 0 },
    uHaze: { value: 0 },
    uHazeY: { value: 0 },
    uBeams: { value: 0 },
    uSway: { value: 0 },
    uBokeh: { value: 0 },
    uTime: { value: 0 },
    uMobile: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  }
  private tmpC = new THREE.Color()
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private fwd = new THREE.Vector3()

  constructor(scene: THREE.Scene, mobile: boolean, renderer?: THREE.WebGLRenderer) {
    this.scene = scene
    this.params = World.defaults()
    this.uniforms.uMobile.value = mobile ? 1 : 0

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    )
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    this.object.add(this.dome)

    // THE FOLLOW SPOT — the only shadow caster. Never toggle it: drive intensity.
    this.spot = new THREE.SpotLight(GEL.tungsten, 0, 0, 0.42, 0.55, 1.2)
    this.spot.castShadow = true
    this.spot.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
    this.spot.shadow.bias = -0.00025
    this.spot.shadow.normalBias = 0.012
    this.spot.shadow.radius = 2
    this.spot.shadow.camera.near = 0.5
    this.spot.shadow.camera.far = 80
    this.object.add(this.spot, this.spot.target)

    this.rimA = new THREE.DirectionalLight(GEL.amber, 0)
    this.rimB = new THREE.DirectionalLight(GEL.red, 0)
    this.object.add(this.rimA, this.rimA.target, this.rimB, this.rimB.target)
    this.hemi = new THREE.HemisphereLight(0xffd6b0, 0x1a0c08, WORLD_DEFAULTS.fill)
    this.object.add(this.hemi)

    this.envMap = renderer ? buildStageEnv(renderer) : new THREE.Texture()
    scene.environment = this.envMap
    scene.environmentIntensity = WORLD_DEFAULTS.env
  }

  static defaults(): WorldParams {
    return {
      ...WORLD_DEFAULTS,
      spotPos: new THREE.Vector3(2, 14, 10),
      spotAt: new THREE.Vector3(0, 0, 0),
      rimADir: new THREE.Vector3(-0.8, 0.7, -1),
      rimBDir: new THREE.Vector3(0.9, 0.5, -1),
    }
  }

  /** the engine calls this before prewarm: lit programs key on the environment */
  warmEnv() {
    this.scene.environment = this.envMap
  }

  resetParams() {
    const p = this.params
    const spotPos = p.spotPos.set(2, 14, 10)
    const spotAt = p.spotAt.set(0, 0, 0)
    const a = p.rimADir.set(-0.8, 0.7, -1)
    const b = p.rimBDir.set(0.9, 0.5, -1)
    Object.assign(p, WORLD_DEFAULTS)
    p.spotPos = spotPos
    p.spotAt = spotAt
    p.rimADir = a
    p.rimBDir = b
  }

  update(frame: Frame, camera: THREE.Camera) {
    const p = this.params
    const c = this.cur
    const n = c.n
    const colors = ['top', 'bottom', 'cycColor', 'brickColor', 'hazeColor', 'beamA', 'beamB', 'bokehA', 'bokehB', 'bulbColor', 'spotColor', 'rimAColor', 'rimBColor'] as const
    const nums = ['cyc', 'cycX', 'cycY', 'brick', 'haze', 'hazeY', 'beams', 'sway', 'bokeh', 'bulbs', 'spot', 'spotAngle', 'spotPenumbra', 'rimA', 'rimB', 'fill', 'env', 'envTurn'] as const
    const k = this.first ? 1 : 1 - Math.exp(-5 * frame.dt)
    for (const key of colors) c[key].lerp(this.tmpC.set(p[key]), k)
    for (const key of nums) n[key] = this.first ? p[key] : n[key] + (p[key] - n[key]) * k
    // the spot's aim follows faster (it tracks a performer)
    const ks = this.first ? 1 : 1 - Math.exp(-9 * frame.dt)
    c.spotPos.lerp(p.spotPos, ks)
    c.spotAt.lerp(p.spotAt, ks)
    this.first = false

    const u = this.uniforms
    u.uTop.value.copy(c.top)
    u.uBottom.value.copy(c.bottom)
    u.uCycC.value.copy(c.cycColor)
    u.uBrickC.value.copy(c.brickColor)
    u.uCyc.value = n.cyc
    u.uCycX.value = n.cycX
    u.uCycY.value = n.cycY
    u.uBrick.value = n.brick
    u.uHazeC.value.copy(c.hazeColor)
    u.uBeamA.value.copy(c.beamA)
    u.uBeamB.value.copy(c.beamB)
    u.uBokehA.value.copy(c.bokehA)
    u.uBokehB.value.copy(c.bokehB)
    u.uBulbC.value.copy(c.bulbColor)
    u.uBulbs.value = n.bulbs
    u.uHaze.value = n.haze
    u.uHazeY.value = n.hazeY
    u.uBeams.value = n.beams
    u.uSway.value = frame.reducedMotion ? 0 : n.sway
    u.uBokeh.value = n.bokeh
    u.uTime.value = frame.time
    u.uRes.value.set(frame.width, frame.height)

    // the dome follows the camera; the lights live in world space
    this.dome.position.copy(camera.position)

    const s = this.spot
    s.intensity = n.spot * 120
    s.color.copy(c.spotColor)
    s.angle = n.spotAngle
    s.penumbra = n.spotPenumbra
    s.position.copy(c.spotPos)
    s.target.position.copy(c.spotAt)
    s.target.updateMatrixWorld()
    // no shadow render while the spot is dark (the program keys stay the same)
    s.shadow.autoUpdate = n.spot > 0.002
    // fit the shadow depth range to the throw: with near 0.5 / far 80 the bias
    // swallowed occluders within ~0.4 units (strings 0.035 above the board)
    {
      const d = c.spotPos.distanceTo(c.spotAt)
      const near = Math.max(0.5, Math.round((d - 13) * 4) / 4)
      const far = Math.round((d + 22) * 4) / 4
      const sc = s.shadow.camera
      if (sc.near !== near || sc.far !== far) {
        sc.near = near
        sc.far = far
        sc.updateProjectionMatrix()
      }
    }

    // rim lights: directions relative to the camera's orientation
    camera.getWorldQuaternion(this.tmpQ)
    const fwd = camera.getWorldDirection(this.fwd)
    const rim = (l: THREE.DirectionalLight, dir: THREE.Vector3, amount: number, col: THREE.Color) => {
      l.intensity = amount * 3
      l.color.copy(col)
      this.tmpV.copy(dir).normalize().applyQuaternion(this.tmpQ)
      l.target.position.copy(camera.position).addScaledVector(fwd, 10)
      l.position.copy(l.target.position).addScaledVector(this.tmpV, 30)
      l.target.updateMatrixWorld()
    }
    rim(this.rimA, p.rimADir, n.rimA, c.rimAColor)
    rim(this.rimB, p.rimBDir, n.rimB, c.rimBColor)

    this.hemi.intensity = n.fill
    this.scene.environmentIntensity = n.env
    this.scene.environmentRotation.set(0, n.envTurn, 0)
  }
}

/**
 * The studio as a reflection: warm dark, two strands of bulbs across the
 * ceiling (glassware catches them as a row of hot dots), a big overhead
 * softbox and two tall strips (the long product-shot highlights on steel and
 * glass), brick-red bounce, a faint dusk window.
 */
function buildStageEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene()
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#0a0605'), side: THREE.BackSide }),
  )
  env.add(room)
  const lamp = (color: string, power: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) })
  const bulbGeo = new THREE.SphereGeometry(0.32, 12, 8)
  const bulbMat = lamp('#ffb45e', 16)
  for (const [z, y0, n] of [
    [9, 12, 11],
    [-6, 13, 9],
  ] as [number, number, number][]) {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5
      const b = new THREE.Mesh(bulbGeo, bulbMat)
      b.position.set(u * 34, y0 - 2.2 * (0.25 - u * u) * 4 * 0.5, z)
      env.add(b)
    }
  }
  // Resonance's product studio: a big overhead softbox and two tall strips
  const soft = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), lamp('#fff1de', 2.2))
  soft.position.set(2, 22, 6)
  soft.lookAt(0, 0, 0)
  env.add(soft)
  for (const [x, z, pw] of [
    [-16, 10, 3.2],
    [17, 4, 2.4],
  ] as [number, number, number][]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 22), lamp('#fff6ea', pw))
    strip.position.set(x, 3, z)
    strip.lookAt(0, 3, 0)
    env.add(strip)
  }
  const wash = (color: string, power: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 22), lamp(color, power))
    m.position.set(x, 2, z)
    m.lookAt(0, 2, 0)
    env.add(m)
  }
  wash('#7a3524', 0.4, -30, 4)
  wash('#5a2616', 0.3, 30, 0)
  wash('#40567e', 0.1, 0, -32)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), lamp('#2a160a', 1))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -8
  env.add(floor)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(env, 0.02)
  pmrem.dispose()
  env.traverse(o => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
  })
  return rt.texture
}
