import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

/*
 * THE LENS — a two-layer depth of field for the City Wide product film.
 *
 * There's no DOF pass in the engine, and Mike's photo (ref3) is all about it:
 * the can and the shot sharp on the bar, Glory's back bar melted into bokeh
 * (the hi-fi's blue ring and pilot lights, bottles, the red table tent).
 *
 *  1. PLATE: from post.preRender (the frame's real camera, before the
 *     composer), the FAR layer — the room kit's back bar, the long bar, the
 *     props standing on its far side — renders alone into a half-res HDR
 *     target (mipmapped).
 *  2. BLUR: a golden-angle disc (a lens's bokeh, not a gaussian: bright
 *     points open into round discs with a slightly brighter rim), sampled
 *     from the plate's mips so 40 taps stay smooth at any radius.
 *  3. COMPOSITE: the far layer is hidden from the frame and drawn instead by
 *     two screen-mapped cards: a BACKDROP standing in front of the back
 *     counter (opaque, so the rye's transmission buffer refracts the bokeh)
 *     and a far-bar OVERLAY lying just over the bar top whose opacity ramps
 *     with distance behind the focus — the oiled planks go soft as they run
 *     away from the glass.
 *
 * Rack focus: `focus` 0 draws the far layer directly (sharp, full res); as
 * it rises the backdrop fades in over the sharp room while the disc opens,
 * then the room is hidden from the frame. Nothing toggles a light.
 */

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSize;
  uniform float uR;
  uniform float uBoost;
  varying vec2 vUv;
  void main() {
    const int N = 40;
    // tap spacing → a mip whose texels overlap the neighbours' (no dotted discs from hot points)
    float spacing = uR * 1.7725 / sqrt(float(N));
    float lod = max(0.0, log2(max(spacing, 1.0)) + 0.6);
    // each pixel turns the spiral by its own angle (interleaved gradient noise): no pattern survives
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    for (int i = 0; i < N; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / float(N));
      float th = fi * 2.3999632 + jit;
      vec2 off = vec2(cos(th), sin(th)) * r * uR / uSize;
      vec3 c = min(textureLod(tSrc, vUv + off, lod).rgb, vec3(24.0));
      // bright sources open into brighter discs (a lens's highlights)
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= 1.0 + uBoost * smoothstep(0.6, 2.4, l);
      // a slightly brighter rim, like real bokeh
      float w = 0.82 + 0.36 * r * r;
      acc += c * w;
      ws += w;
    }
    gl_FragColor = vec4(acc / ws, 1.0);
  }
`
const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const CARD_VERT = /* glsl */ `
  varying vec4 vClip;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vClip = projectionMatrix * viewMatrix * w;
    gl_Position = vClip;
  }
`
const BACKDROP_FRAG = /* glsl */ `
  uniform sampler2D tBlur;
  uniform float uAlpha;
  varying vec4 vClip;
  varying vec3 vW;
  void main() {
    vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;
    gl_FragColor = vec4(texture2D(tBlur, uv).rgb, uAlpha);
  }
`
const OVERLAY_FRAG = /* glsl */ `
  uniform sampler2D tBlur;
  uniform float uK;
  /** far ramp: distance behind the focus plane (world −z) where the planks start / finish going soft */
  uniform vec2 uFar;
  varying vec4 vClip;
  varying vec3 vW;
  void main() {
    vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;
    float a = smoothstep(uFar.x, uFar.y, -vW.z) * uK;
    gl_FragColor = vec4(texture2D(tBlur, uv).rgb, a);
  }
`

export class Lens {
  plate: THREE.WebGLRenderTarget
  blur: THREE.WebGLRenderTarget
  /** stands in front of the back counter; covers everything behind the long bar */
  backdrop: THREE.Mesh
  /** lies over the bar top: the far planks going soft */
  overlay: THREE.Mesh
  /** 0 the room sharp (drawn directly) … 1 the room in the plate, fully open */
  focus = 0
  /** disc radius at focus 1, in CSS px */
  radius = 24
  /** highlight boost in the blur (0 = energy-true averaging) */
  boost = 1.4
  private quad: FullScreenQuad
  private blurMat: THREE.ShaderMaterial
  private backMat: THREE.ShaderMaterial
  private overMat: THREE.ShaderMaterial
  private w = 0
  private h = 0
  private clear = new THREE.Color()

  constructor({ backdrop, overlay }: { backdrop: { width: number; height: number }; overlay: { width: number; depth: number } }) {
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
    } as const
    this.plate = new THREE.WebGLRenderTarget(8, 8, {
      ...opts,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    })
    this.blur = new THREE.WebGLRenderTarget(8, 8, { ...opts, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: this.plate.texture }, uSize: { value: new THREE.Vector2(8, 8) }, uR: { value: 1 }, uBoost: { value: this.boost } },
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.blurMat)

    this.backMat = new THREE.ShaderMaterial({
      uniforms: { tBlur: { value: this.blur.texture }, uAlpha: { value: 1 } },
      vertexShader: CARD_VERT,
      fragmentShader: BACKDROP_FRAG,
      depthWrite: true,
      transparent: false,
      toneMapped: false,
      fog: false,
    })
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(backdrop.width, backdrop.height), this.backMat)
    this.backdrop.frustumCulled = false
    this.backdrop.castShadow = false
    this.backdrop.receiveShadow = false

    this.overMat = new THREE.ShaderMaterial({
      uniforms: { tBlur: { value: this.blur.texture }, uK: { value: 1 }, uFar: { value: new THREE.Vector2(0.6, 1.9) } },
      vertexShader: CARD_VERT,
      fragmentShader: OVERLAY_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
    const g = new THREE.PlaneGeometry(overlay.width, overlay.depth)
    g.rotateX(-Math.PI / 2)
    this.overlay = new THREE.Mesh(g, this.overMat)
    this.overlay.frustumCulled = false
    this.overlay.renderOrder = 2
  }

  /** where the far planks start / finish going soft (distance behind the focus plane, world −z) */
  setFarRamp(a: number, b: number) {
    ;(this.overMat.uniforms.uFar.value as THREE.Vector2).set(a, b)
  }

  /** CSS size of the frame (the plate is half of it; independent of DPR) */
  setSize(w: number, h: number) {
    const pw = Math.max(64, Math.round(w * 0.5))
    const ph = Math.max(64, Math.round(h * 0.5))
    if (pw === this.w && ph === this.h) return
    this.w = pw
    this.h = ph
    this.plate.setSize(pw, ph)
    this.blur.setSize(pw, ph)
    ;(this.blurMat.uniforms.uSize.value as THREE.Vector2).set(pw, ph)
  }

  /** 0..1 of the rack: how much of the backdrop covers the directly drawn room */
  get cover() {
    return smooth(0, 0.35, this.focus)
  }

  /** is the plate needed this frame? */
  get active() {
    return this.focus > 0.004
  }

  /** is the far layer drawn directly into the frame (under / instead of the backdrop)? */
  get direct() {
    return this.cover < 0.999
  }

  /** per frame (from update): the cards' state */
  sync() {
    const cover = this.cover
    this.backdrop.visible = this.active
    this.overlay.visible = this.active
    this.backMat.uniforms.uAlpha.value = cover
    const transparent = cover < 0.999
    if (this.backMat.transparent !== transparent) {
      this.backMat.transparent = transparent
      this.backMat.depthWrite = !transparent
    }
    this.overMat.uniforms.uK.value = smooth(0.15, 1, this.focus)
  }

  /**
   * Render the far layer and blur it (from post.preRender). `solo(true)`
   * must show ONLY the far layer (+ the room backdrop) and `solo(false)`
   * restore the frame's own visibility.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, solo: (on: boolean) => void) {
    if (!this.active) return
    const prevRT = renderer.getRenderTarget()
    const prevAuto = renderer.shadowMap.autoUpdate
    const prevAlpha = renderer.getClearAlpha()
    renderer.getClearColor(this.clear)
    renderer.shadowMap.autoUpdate = false
    solo(true)
    try {
      renderer.setRenderTarget(this.plate)
      renderer.setClearColor(0x000000, 1)
      renderer.clear()
      renderer.render(scene, camera)
      // the disc: its radius in plate px (the plate is half the CSS frame)
      const r = Math.max(0.6, this.radius * 0.5 * smooth(0, 1, this.focus))
      this.blurMat.uniforms.uR.value = r
      this.blurMat.uniforms.uBoost.value = this.boost
      renderer.setRenderTarget(this.blur)
      this.quad.render(renderer)
    } finally {
      solo(false)
      renderer.setRenderTarget(prevRT)
      renderer.setClearColor(this.clear, prevAlpha)
      renderer.shadowMap.autoUpdate = prevAuto
    }
  }

  /** compile the blur program ahead (no first-use stall) */
  warm(renderer: THREE.WebGLRenderer) {
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.blur)
    this.quad.render(renderer)
    renderer.setRenderTarget(prev)
  }

  dispose() {
    this.plate.dispose()
    this.blur.dispose()
    this.quad.dispose()
    this.blurMat.dispose()
    this.backMat.dispose()
    this.overMat.dispose()
    this.backdrop.geometry.dispose()
    this.overlay.geometry.dispose()
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
