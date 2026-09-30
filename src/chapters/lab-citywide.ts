import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame, CameraPose } from '../core/types'
import { makeBarTop } from '../kit/bar'
import { makeBacklight } from '../kit/beer'
import { dirOf, frameTo } from '../kit/vinyl'
import { IN, makeCan, makeCityWide, makeRyeBottle, makeRyePour, type CityWide } from '../kit/citywide'

/*
 * CITY WIDE LAB (?lab=citywide replaces the hero): the City Wide Special kit
 * on the bar, lit like Mike's photo (ref3) — close, a little above, the oiled
 * bar top under it, the back bar melting into warm bokeh behind (the hi-fi's
 * blue and green lights, a stout pint, Glory's red table tent).
 *
 *   ?lab=citywide&view=hero|can|top|cheese|shot|all|pour|label
 *
 * local: the tab lifts and the mouth opens (0.08–0.3), the rye fills to the
 * photo's level (0.3–0.5), the cheese on its pick lowers in and settles across
 * the rim (0.5–0.8); 0.8–1 holds the photo.
 */

const params = new URLSearchParams(location.search)
const VIEW = params.get('view') ?? 'hero'
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** the back bar, out of focus: a painted bokeh card (there's no DOF pass; this is the lens) */
function backBarCard(width: number, height: number) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSize: { value: new THREE.Vector2(width, height) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uSize;
      varying vec2 vUv;
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      // a lens disc: flat core, a slightly brighter rim (the bokeh of a phone lens)
      float bokeh(vec2 q, vec2 c, float r) {
        float d = length(q - c) / r;
        float disc = 1.0 - smoothstep(0.78, 1.0, d);
        return disc * (0.8 + 0.35 * smoothstep(0.55, 0.95, d));
      }
      float soft(vec2 q, vec2 c, vec2 h, float s) {
        vec2 d = abs(q - c) - h;
        float e = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
        return 1.0 - smoothstep(-s, s, e);
      }
      void main() {
        // card coords in world units: x across (0 = the pair's middle), y up from the bar
        vec2 q = vec2((vUv.x - 0.5) * uSize.x, vUv.y * uSize.y - 0.25);
        float up = clamp(q.y / 1.8, 0.0, 1.0);
        // near black at the bar line (the bar top fades into it), a warm dark above
        vec3 c = mix(vec3(0.0025, 0.0018, 0.0013), vec3(0.012, 0.008, 0.006), smoothstep(0.0, 0.5, q.y));
        c = mix(c, vec3(0.005, 0.004, 0.005), smoothstep(0.9, 1.8, q.y));
        // the back bar: a dark hi-fi stack upper left, a faint shelf of bottles
        c = mix(c, vec3(0.010, 0.010, 0.013), soft(q, vec2(-0.9, 0.95), vec2(0.8, 0.3), 0.12));
        c += vec3(0.035, 0.022, 0.014) * soft(q, vec2(-0.6, 0.5), vec2(2.6, 0.012), 0.05);
        // the receiver's blue ring display and its blue / green pilot lights
        c += vec3(0.08, 0.20, 0.95) * 0.9 * bokeh(q, vec2(-0.78, 1.05), 0.075);
        c += vec3(0.10, 0.22, 1.00) * 0.7 * bokeh(q, vec2(-0.2, 1.02), 0.06);
        c += vec3(0.30, 0.34, 0.40) * 0.25 * soft(q, vec2(-1.0, 1.12), vec2(0.18, 0.02), 0.04);
        c += vec3(0.10, 0.75, 0.22) * 0.55 * bokeh(q, vec2(-0.05, 0.9), 0.055);
        c += vec3(0.12, 0.80, 0.25) * 0.4 * bokeh(q, vec2(0.1, 0.84), 0.045);
        c += vec3(0.10, 0.20, 0.95) * 0.45 * bokeh(q, vec2(-0.36, 0.84), 0.04);
        c += vec3(0.08, 0.16, 0.9) * 0.4 * bokeh(q, vec2(0.98, 0.2), 0.05);
        // a stout pint behind the shot: dark body, a thin tan head, blue glints at the foot
        float pint = soft(q, vec2(0.62, 0.5), vec2(0.19, 0.5), 0.07);
        c = mix(c, vec3(0.006, 0.004, 0.003), pint * 0.9);
        c += vec3(0.20, 0.14, 0.09) * 0.2 * soft(q, vec2(0.62, 0.99), vec2(0.18, 0.025), 0.05);
        c += vec3(0.12, 0.10, 0.09) * 0.25 * soft(q, vec2(0.45, 0.55), vec2(0.01, 0.4), 0.03);
        c += vec3(0.1, 0.2, 0.9) * 0.3 * bokeh(q, vec2(0.5, 0.1), 0.045);
        // Glory's red table tent, far right, a white box at its top
        float tent = soft(q, vec2(1.65, 0.6), vec2(0.42, 0.62), 0.06);
        c = mix(c, vec3(0.28, 0.03, 0.03), tent);
        c = mix(c, vec3(0.42, 0.38, 0.35), soft(q, vec2(1.58, 1.0), vec2(0.3, 0.15), 0.05) * tent);
        c += vec3(0.3, 0.03, 0.02) * 0.1 * soft(q, vec2(1.65, 0.6), vec2(0.5, 0.72), 0.2);
        // warm far lights: bulbs and bottle glints, big soft discs
        for (int i = 0; i < 14; i++) {
          float fi = float(i);
          vec2 cc = vec2(-3.4 + fi * 0.52 + (hash(vec2(fi, 1.0)) - 0.5) * 0.4, 0.3 + hash(vec2(fi, 2.0)) * 1.0);
          if (abs(cc.x - 0.62) < 0.3 || (cc.x > 1.1 && cc.x < 2.2)) continue;
          float r = 0.05 + hash(vec2(fi, 3.0)) * 0.08;
          float b = 0.08 + hash(vec2(fi, 4.0)) * 0.22;
          c += mix(vec3(1.0, 0.62, 0.26), vec3(1.0, 0.8, 0.5), hash(vec2(fi, 5.0))) * b * bokeh(q, cc, r);
        }
        c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat)
  mesh.position.y = height / 2 - 0.25
  return { mesh, mat }
}

/** the bar top going soft into the dark toward the back bar */
function barFade(width: number, depth: number) {
  const cv = document.createElement('canvas')
  cv.width = 4
  cv.height = 128
  const g = cv.getContext('2d')!
  const gr = g.createLinearGradient(0, 0, 0, 128)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.35, 'rgba(255,255,255,0.8)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 4, 128)
  const t = new THREE.CanvasTexture(cv)
  const mat = new THREE.MeshBasicMaterial({ color: 0x0a0604, alphaMap: t, transparent: true, depthWrite: false })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat)
  m.rotation.x = -Math.PI / 2
  m.position.y = 0.0015
  m.renderOrder = 1
  return m
}

class LabCityWide implements Chapter {
  id = 'hero'
  group = new THREE.Group()
  private cw!: CityWide
  private card!: ReturnType<typeof backBarCard>
  private backlight!: ReturnType<typeof makeBacklight>
  private closed = makeCan({ labelRes: 1024, mouthYaw: -0.4 })
  private bottle = makeRyeBottle(VIEW === 'pour' ? { fill: 1, cap: false } : { fill: 0.85 })
  private pour = makeRyePour()
  private labelPlane: THREE.Mesh | null = null
  private v = new THREE.Vector3()
  private w = new THREE.Vector3()
  private keyDir = new THREE.Vector3()
  private camPos = new THREE.Vector3(0, 1, 3)

  init(ctx: ChapterContext) {
    const bar = makeBarTop({ length: 12, depth: 4.8, thickness: 0.2 })
    // wider planks for this close shot (the tile is shared; only these uvs change)
    const uv = bar.geometry.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.45, uv.getY(i) * 0.4)
    bar.position.z = 0.1
    this.group.add(bar)
    const fade = barFade(12, 1.5)
    fade.position.z = -1.55
    this.group.add(fade)

    const cw = (this.cw = makeCityWide({ open: 0, fill: 0, cheese: 0, labelRes: ctx.mobile ? 1024 : 2048 }))
    this.group.add(cw.group)

    this.card = backBarCard(10, 2.6)
    this.card.mesh.position.z = -2.32
    this.group.add(this.card.mesh)

    this.backlight = makeBacklight({
      width: 0.7,
      height: 0.9,
      hdr: 2.2,
      isFrameTarget: rt => ctx.post.isFrameTarget(rt),
    })
    this.group.add(this.backlight.mesh)

    if (VIEW === 'all' || VIEW === 'pour') {
      this.closed.group.position.set(VIEW === 'pour' ? -0.95 : -1.15, 0, -0.25)
      this.closed.group.rotation.y = -0.5
      this.group.add(this.closed.group)
      this.bottle.group.position.set(1.25, 0, -0.55)
      this.bottle.group.rotation.y = -0.2
      this.group.add(this.bottle.group)
      this.group.add(this.pour.mesh)
    }
    if (VIEW === 'label') {
      const map = (cw.can.body.material as THREE.MeshPhysicalMaterial).map
      this.labelPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicMaterial({ map, toneMapped: false }))
      this.group.add(this.labelPlane)
    }
  }

  update(l: number, f: Frame, ctx: ChapterContext) {
    const w = ctx.world.params
    w.top = '#0c0806'
    w.bottom = '#040302'
    w.cyc = 0
    w.brick = 0
    w.haze = 0.05
    w.bulbs = 0.15
    w.bokeh = 0.15
    // the key: warm, from the front left and above (the photo's bar pendant)
    w.spot = 0.16
    w.spotColor = '#ffd2a0'
    w.spotPos.set(-2.2, 3.4, 2.4)
    w.spotAt.set(0.1, 0.25, 0)
    w.spotAngle = 0.42
    w.spotPenumbra = 0.8
    // rims: warm from behind left (glass edges, the rye), cool blue behind right (the hi-fi's glow on the can)
    w.rimA = 0.32
    w.rimAColor = '#ffb46a'
    w.rimADir.set(-0.8, 0.45, -1)
    w.rimB = 0.42
    w.rimBColor = '#6f8fff'
    w.rimBDir.set(1, 0.3, -0.8)
    w.fill = 0.28
    w.env = 1
    ctx.post.params.bloomThreshold = 0.95
    ctx.post.params.vignette = 0.38

    const cw = this.cw
    const all = VIEW === 'label'
    cw.setCanOpen(VIEW === 'top' ? Number(params.get('open') ?? 1) : all ? 1 : sstep(0.08, 0.3, l))
    cw.setShotFill(0.55 * sstep(0.3, 0.5, l))
    cw.setCheese(VIEW === 'shot' ? 0 : sstep(0.5, 0.8, l))
    this.keyDir.copy(w.spotPos).sub(w.spotAt).normalize()
    cw.setLight(this.keyDir)
    cw.update(f)

    // a pool of light on the bar behind the shot, seen only THROUGH the rye
    // (the transmission buffer): the whiskey glows amber
    cw.shot.group.getWorldPosition(this.v)
    this.backlight.mesh.position.set(this.v.x, 0.004, this.v.z - 0.5)
    this.backlight.mesh.rotation.set(-Math.PI / 2, 0, 0)
    this.backlight.set(0.2)
    this.card.mat.uniforms.uTime.value = f.time

    if (VIEW === 'pour') {
      // the bottle held over the glass, tipped past level: the lip ~0.9" above the rim
      // (clear of it), the body rising away to the right; the stream lands in the rye
      const t = sstep(0.28, 0.34, l) * (1 - sstep(0.5, 0.56, l))
      const tilt = 1.86 + 0.14 * t
      const h = 10.85 * IN
      const sx = this.v.x + 0.25 * IN
      const sy = cw.shot.rimTop + 0.95 * IN
      const sz = this.v.z
      this.bottle.group.rotation.set(0, 0, tilt)
      this.bottle.group.position.set(sx + h * Math.sin(tilt), sy - h * Math.cos(tilt), sz)
      this.bottle.group.updateMatrixWorld(true)
      this.bottle.lip(this.w)
      cw.anchors.rye.getWorldPosition(this.v)
      this.pour.set(this.w, this.v, t)
      this.pour.update(f.time)
    } else this.pour.set(this.v, this.v, 0)
  }

  camera(l: number, f: Frame, out: CameraPose) {
    this.frame(l, f, out)
    this.camPos.copy(out.position)
  }

  private frame(_l: number, f: Frame, out: CameraPose) {
    const portrait = f.height > f.width
    const W = f.width
    const H = f.height
    const fov = VIEW === 'hero' ? (portrait ? 56 : 50) : portrait ? 40 : 30
    out.fov = fov
    out.roll = 0
    out.parallax = 0.012
    const full = { x0: W * 0.06, x1: W * 0.94, y0: H * 0.12, y1: H * 0.9 }
    const c = new THREE.Vector3()
    const d = new THREE.Vector3()
    const cw = this.cw
    if (VIEW === 'can') {
      cw.anchors.can.getWorldPosition(c)
      dirOf(3, 9, d)
      frameTo(out, c, d, 3.4 * IN, 5.6 * IN, full, W, H, fov)
    } else if (VIEW === 'top') {
      cw.anchors.canTop.getWorldPosition(c)
      c.y += 0.2 * IN
      dirOf(-8, 30, d)
      frameTo(out, c, d, 3.0 * IN, 2.1 * IN, full, W, H, fov)
    } else if (VIEW === 'cheese') {
      cw.anchors.cheese.getWorldPosition(c)
      c.x -= 0.35 * IN
      dirOf(-6, 26, d)
      frameTo(out, c, d, 3.4 * IN, 2.4 * IN, full, W, H, fov)
    } else if (VIEW === 'shot') {
      cw.anchors.shot.getWorldPosition(c)
      dirOf(0, 16, d)
      frameTo(out, c, d, 3.2 * IN, 3.2 * IN, full, W, H, fov)
    } else if (VIEW === 'all' || VIEW === 'pour') {
      c.set(0.05, 0.42, 0)
      dirOf(-4, 17, d)
      frameTo(out, c, d, portrait ? 2.1 : 3.3, 1.5, full, W, H, fov)
    } else if (VIEW === 'label') {
      this.labelPlane?.position.set(0, 1, 0.6)
      c.set(0, 1, 0.6)
      dirOf(0, 0, d)
      frameTo(out, c, d, 2.05, 1.05, full, W, H, fov)
    } else {
      // Mike's photo: close, a little above, the pair filling the frame
      c.set(0.05, 0.4, 0.05)
      dirOf(-3, 24, d)
      if (portrait) {
        // the photo's own crop: close, the pair filling the width
        c.set(0.02, 0.38, 0.06)
        dirOf(-4, 26, d)
        frameTo(out, c, d, 1.36, 1.0, { x0: W * 0.03, x1: W * 0.97, y0: H * 0.12, y1: H * 0.84 }, W, H, fov)
      } else {
        // keep the tab clear of the chrome bands (short landscape has less room)
        const short = H < 500
        frameTo(out, c, d, 1.4, 1.26, { x0: W * 0.22, x1: W * 0.78, y0: H * (short ? 0.2 : 0.14), y1: H * (short ? 0.88 : 0.92) }, W, H, fov)
      }
    }
  }
}

export default function create(): Chapter {
  return new LabCityWide()
}
