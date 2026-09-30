import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

/*
 * Post-processing: Scene (+ Sanitize NaN guard) → Bloom → Output → FIELD → FINAL.
 * Only the scene render is multisampled (its own target, the only one with a
 * depth buffer); the composer's ping-pong targets are single-sampled.
 *
 * Earlier concepts' final passes: Orbit glitch + zoom blur; Resonance ripple;
 * Press riso halftone; Town tilt-shift + cloud wipe; Arcade pixel + CRT;
 * Frost breath fog; Contour flood; Primetime replay stinger; Noir
 * silver-gelatin + blinds; Neon light trails + lights-out; Opal colour field;
 * Riff cab cut; GJP soundhole.
 *
 * GLORY (after Resonance: a clean product-film grade — fine grain, a gentle
 * vignette, a whisper of warmth, never muddy) and THE POUR: approaching a
 * chapter boundary, beer rises up the frame like a glass being filled from the
 * tap — a clear amber body that refracts the scene behind it, streams of
 * carbonation rising, a cream foam head riding the surface with a bright
 * meniscus line. At the boundary the whole frame is the glass: amber lit by
 * the scene's own light (a 1/32-res copy of the frame, held at a steady,
 * modest brightness: never a flash) under a band of foam. Entering the next
 * chapter the glass drains: the level falls down the frame and leaves foam
 * LACING clinging to the glass, which fades as the next scene settles.
 * `beer` (0 pale straw → 0.5 amber → 1 stout) tints the pour per chapter.
 * Calm (reduced motion / Motion off): the engine fades through cream.
 *
 * The final pass runs AFTER the sRGB output pass: it sees display values.
 * Keep the Post API (params / resetParams / setSize / render / compileAsync /
 * setFadeTone) and the uTransition / uFade / uFlash / uGlitch uniforms.
 * uGlitch (params.glitch) is a small SETTLE: a push toward the viewer a
 * chapter can punch when a glass lands on the bar (zeroed under reduced motion).
 */

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** 1/32-res copy of the frame (FIELD pass), bilinear */
    tField: { value: null as THREE.Texture | null },
    uFieldTexel: { value: new THREE.Vector2(1 / 64, 1 / 36) },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    /** 0..1, peaks exactly at a chapter boundary (engine-driven) */
    uTransition: { value: 0 },
    /** +1 leaving a chapter (the glass fills), -1 entering (it drains) */
    uCutSide: { value: 1 },
    /** 0..1 the SETTLE: a small radial push, no cut */
    uGlitch: { value: 0 },
    uAberration: { value: 0 },
    uGrain: { value: 0.045 },
    /** grain re-deal seed (24 fps; held still when calm) */
    uGrainSeed: { value: 0 },
    /** 0 = still bubbles (calm), 1 = rising */
    uMotion: { value: 1 },
    uVignette: { value: 0.3 },
    /** 0..1 wash to white */
    uFlash: { value: 0 },
    /** 0..1 fade to uFadeColor (calm cuts) */
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color('#efe7d8').convertLinearToSRGB() },
    /** 0..1 speed dim: the whole frame dims while the page moves fast (flash safety net) */
    uSpeedDim: { value: 0 },
    /** vibrance (1 = none) and black-point lift (toward uHaze) */
    uSat: { value: 1.04 },
    uLift: { value: 0.01 },
    uHaze: { value: new THREE.Color('#3a2216').convertLinearToSRGB() },
    /** 0..1 a warm product-film grade */
    uWarmth: { value: 0.5 },
    /** 0 pale straw .. 0.5 amber .. 1 stout: the pour's colour */
    uBeer: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tField;
    uniform vec2 uFieldTexel;
    uniform float uTime, uDpr, uTransition, uCutSide, uGlitch, uAberration, uGrain, uGrainSeed, uMotion;
    uniform float uVignette, uFlash, uFade, uSpeedDim, uSat, uLift, uWarmth, uBeer;
    uniform vec2 uResolution;
    uniform vec3 uFadeColor, uHaze;
    varying vec2 vUv;

    const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    // the frame's mean colour (16 taps of the field)
    vec3 fieldMean() {
      vec3 m = vec3(0.0);
      for (int y = 0; y < 4; y++)
        for (int x = 0; x < 4; x++)
          m += texture2D(tField, vec2(0.125 + 0.25 * float(x), 0.125 + 0.25 * float(y))).rgb;
      return m / 16.0;
    }

    // beer colour by style: straw → amber → ruby-brown → stout (display values)
    vec3 beerColor(float k) {
      vec3 straw = vec3(0.96, 0.78, 0.32);
      vec3 amber = vec3(0.86, 0.5, 0.12);
      vec3 brown = vec3(0.42, 0.17, 0.05);
      vec3 stout = vec3(0.1, 0.045, 0.02);
      vec3 c = mix(straw, amber, smoothstep(0.0, 0.5, k));
      c = mix(c, brown, smoothstep(0.5, 0.8, k));
      return mix(c, stout, smoothstep(0.8, 1.0, k));
    }

    // CARBONATION: thin streams of small bubbles rising in columns (a = aspect space)
    float bubbles(vec2 a, float time) {
      float acc = 0.0;
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float cols = 26.0 + 14.0 * fk;
        float cx = floor(a.x * cols);
        float on = step(0.55 - 0.1 * fk, hash(vec2(cx, 3.7 + fk)));
        float x0 = (cx + 0.5 + (hash(vec2(cx, 9.1 + fk)) - 0.5) * 0.5) / cols;
        float speed = 0.16 + 0.12 * hash(vec2(cx, 1.3 + fk)) + 0.05 * fk;
        float sp = 0.035 + 0.02 * fk;
        float y = a.y - time * speed;
        float cy = floor(y / sp);
        float fy = fract(y / sp) - 0.5;
        float wob = sin(cy * 1.7 + time * 3.0 + cx) * 0.18 / cols;
        float r = (0.0022 + 0.0016 * hash(vec2(cx, cy))) * (1.0 - 0.25 * fk);
        vec2 d = vec2(a.x - x0 - wob, fy * sp);
        float dist = length(d);
        float ring = smoothstep(r, r * 0.55, dist) - 0.6 * smoothstep(r * 0.55, r * 0.1, dist);
        acc += max(ring, 0.0) * on * step(0.2, hash(vec2(cx, cy + 5.0)));
      }
      return clamp(acc, 0.0, 1.0);
    }

    // FOAM: dense cream cells (the head), a = aspect space
    float foam(vec2 a, float time) {
      vec2 p = a * 70.0;
      vec2 i = floor(p); vec2 f = fract(p);
      float md = 1.0;
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash(i + g), hash(i + g + 7.3));
          md = min(md, length(g + o - f));
        }
      return smoothstep(0.05, 0.55, md);
    }

    vec3 grade(vec3 col) {
      // a clean product film: lifted cream highlights, slightly warm mids
      float l = dot(col, LUM);
      vec3 tint = mix(vec3(0.99, 0.97, 0.95), vec3(1.02, 1.0, 0.96), smoothstep(0.1, 0.7, l));
      col *= mix(vec3(1.0), tint, uWarmth);
      col = clamp(col, 0.0, 1.0);
      vec3 s = col * col * (3.0 - 2.0 * col);
      return mix(col, s, 0.12 * uWarmth);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      vec2 a = vec2(uv.x * aspect, uv.y);
      float r = length(c * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);

      float t = clamp(uTransition, 0.0, 1.0);
      float e = smoothstep(0.0, 1.0, t);
      float push = 0.03 * clamp(uGlitch, 0.0, 1.0);
      vec2 suv = 0.5 + c * (1.0 - push * (1.0 - 0.7 * r * r));

      // THE POUR — the liquid level in uv.y (0 bottom → 1 top) plus a gentle slosh
      float time = uTime * uMotion;
      float slosh = (sin(uv.x * 5.0 + time * 1.7) * 0.012 + sin(uv.x * 11.0 - time * 2.3) * 0.006) * e;
      float level = mix(-0.08, 1.12, e) + slosh;
      float inBeer = (t > 0.001) ? 1.0 - smoothstep(level - 0.003, level + 0.003, uv.y) : 0.0;

      // under the surface the scene refracts through the glass
      if (inBeer > 0.0) {
        float wv = vnoise(vec2(uv.x * 7.0, uv.y * 4.0 - time * 0.25)) - 0.5;
        suv += vec2(wv * 0.012, wv * 0.006) * inBeer;
      }

      vec3 col = texture2D(tDiffuse, suv).rgb;
      if (uAberration > 0.00001) {
        col.r = texture2D(tDiffuse, suv + c * uAberration).r;
        col.b = texture2D(tDiffuse, suv - c * uAberration).b;
      }
      col = grade(col);

      if (t > 0.001) {
        vec3 m = fieldMean();
        float ml = dot(m, LUM);
        vec3 beer = beerColor(uBeer);
        // a steady, modest brightness for the glass (never a flash)
        float bright = clamp(0.55 + ml * 0.6, 0.6, 1.0);
        // depth: a little darker at the bottom of the glass, glowing where the light comes through
        float depth = mix(0.62, 1.12, smoothstep(0.0, 1.0, uv.y));
        float glow = exp(-dot(c * vec2(aspect * 0.6, 1.2), c * vec2(aspect * 0.6, 1.2)) * 2.2);
        vec3 body = beer * bright * depth * (0.8 + 0.35 * glow);
        // the scene seen through the beer, fading out as the glass fills
        float through = (1.0 - smoothstep(0.35, 0.95, e)) * 0.55;
        vec3 liquid = mix(body, col * beer * 1.25, through);
        // bubbles (lighter than the body)
        float bub = bubbles(a, time);
        liquid += (vec3(1.0, 0.95, 0.85) - liquid) * bub * 0.6;
        // a long vertical highlight: the curve of the glass catching a softbox strip
        float s1 = (uv.x - 0.18) * 24.0; float s2 = (uv.x - 0.86) * 60.0;
        float strip = exp(-s1 * s1) * 0.22 + exp(-s2 * s2) * 0.12;
        liquid += vec3(1.0, 0.96, 0.9) * strip * inBeer;

        // FOAM HEAD riding on the surface (thicker as the glass fills)
        float headH = mix(0.035, 0.16, e);
        float above = uv.y - (level - headH);
        float inHead = smoothstep(-0.004, 0.004, above) * (1.0 - smoothstep(-0.003, 0.003, uv.y - level - 0.004));
        vec3 cream = vec3(0.97, 0.93, 0.84) * clamp(0.82 + ml * 0.3, 0.84, 1.0);
        float cells = foam(a + vec2(0.0, time * 0.004), time);
        vec3 head = cream * (0.9 + 0.1 * cells) - vec3(0.04, 0.05, 0.07) * (1.0 - cells) * 0.6;
        // the foam grades into the beer at its bottom edge
        float fb = smoothstep(0.0, headH * 0.5, above);
        head = mix(mix(beer * bright, cream, 0.55), head, fb);
        // meniscus: a bright line just at the top of the head
        float mz = (uv.y - level) * uResolution.y / (2.0 * uDpr);
        float men = exp(-mz * mz) * 0.35;

        vec3 filled = mix(liquid, head, inHead);
        col = mix(col, filled, max(inBeer, inHead));
        col += vec3(1.0, 0.97, 0.9) * men;

        // LACING: entering a chapter the glass drains and leaves rings of foam
        // lace clinging above the falling level, fading as the scene settles
        if (uCutSide < 0.0) {
          float aboveLevel = smoothstep(level, level + 0.03, uv.y);
          float bands = 0.0;
          for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float by = 0.3 + 0.22 * fk + 0.02 * sin(uv.x * 7.0 + fk * 2.0);
            float bz = (uv.y - by) / (0.006 + 0.004 * hash(vec2(fk, 2.0)));
            float band = exp(-bz * bz);
            // lace: a fine net of foam, open in places
            float lace = smoothstep(0.45, 0.7, vnoise(a * vec2(90.0, 140.0) + fk * 13.0))
              * smoothstep(0.3, 0.6, vnoise(vec2(a.x * 6.0 + fk * 3.0, fk)));
            bands += band * lace;
          }
          float laceA = clamp(bands, 0.0, 1.0) * aboveLevel * smoothstep(0.1, 0.7, t) * 0.45;
          col = mix(col, cream, laceA);
        }
      }

      col *= 1.0 - clamp(uSpeedDim, 0.0, 0.8);
      float l = dot(col, LUM);
      col = max(mix(vec3(l), col, uSat), 0.0);
      col = uLift * uHaze * 3.0 + col * (1.0 - uLift);
      col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
      float v = 1.0 - smoothstep(0.35, 1.1, length(c * vec2(1.0, 0.92)) * 1.42);
      col *= mix(1.0, 0.55 + 0.45 * v, uVignette);

      // fine film grain, strongest in the mids; still when calm
      float px = max(1.0, uDpr);
      vec2 g = gl_FragCoord.xy / px;
      vec2 go = vec2(fract(uGrainSeed * 0.1317) * 173.0, fract(uGrainSeed * 0.2711) * 211.0);
      float n = (vnoise(g / 1.1 + go) - 0.5) * 0.7 + (hash(floor(g) + go) - 0.5) * 0.5;
      float gl = dot(col, LUM);
      col += n * uGrain * (0.5 + 2.0 * gl * (1.0 - gl));

      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

/** minimum seconds between two white-flash onsets (WCAG 2.3.1) */
const FLASH_GAP = 0.4

export type PostParams = {
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  aberration: number
  grain: number
  vignette: number
  /** the SETTLE 0..1: a small radial push (a glass landing on the bar) */
  glitch: number
  /** white wash 0..1 */
  flash: number
  exposure: number
  /** vibrance (1 = none) */
  saturation: number
  /** black-point lift 0..0.15, toward the warm haze colour */
  lift: number
  /** 0..1 the warm product-film grade */
  warmth: number
  /** 0 pale straw .. 0.5 amber .. 1 stout: the colour of the pour cut */
  beer: number
}

/**
 * Bloom only on the hot stuff: Edison filaments, glints on steel and glass,
 * the meniscus. Keep the threshold high (UnrealBloom is expensive and veils
 * a bright studio).
 */
export const POST_DEFAULTS: PostParams = {
  bloomStrength: 0.35,
  bloomRadius: 0.45,
  bloomThreshold: 0.92,
  aberration: 0,
  grain: 0.045,
  vignette: 0.3,
  glitch: 0,
  flash: 0,
  exposure: 1,
  saturation: 1.04,
  lift: 0.01,
  warmth: 0.5,
  beer: 0.45,
}

/**
 * Scrubs NaN/Inf and clamps runaway HDR right after the scene render. A single
 * bad fragment would otherwise smear across the whole frame through bloom.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }
  `,
}

/**
 * Renders the scene into its OWN target — the only multisampled one and the
 * only one with depth — then sanitizes (NaN guard) into the composer's
 * single-sampled read buffer. Multisampled ping-pong targets cost 2–3x per
 * post pass (Frost's lesson), so MSAA lives here only.
 */
class ScenePass extends Pass {
  target: THREE.WebGLRenderTarget
  material: THREE.ShaderMaterial
  private quad: FullScreenQuad
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    samples: number,
  ) {
    super()
    this.needsSwap = false
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples })
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SanitizeShader.uniforms),
      vertexShader: SanitizeShader.vertexShader,
      fragmentShader: SanitizeShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.material)
  }
  setSize(w: number, h: number) {
    this.target.setSize(w, h)
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.target)
    renderer.clear()
    renderer.render(this.scene, this.camera)
    this.material.uniforms.tDiffuse.value = this.target.texture
    renderer.setRenderTarget(this.renderToScreen ? null : read)
    this.quad.render(renderer)
  }
}

/**
 * FIELD: a 1/32-res copy of the frame for the colour-field cut, made in two
 * box-filtered steps (1/8, then 1/32). Doesn't touch the ping-pong buffers
 * (needsSwap false); skipped entirely when no cut is on screen.
 */
const DownShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 o = uTexel;
      vec3 c = texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb
        + texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb + texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }
  `,
}

class FieldPass extends Pass {
  a = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: false })
  b = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: false })
  material = new THREE.ShaderMaterial({ ...DownShader, uniforms: THREE.UniformsUtils.clone(DownShader.uniforms), depthTest: false, depthWrite: false })
  private quad = new FullScreenQuad(this.material)
  active = false
  constructor() {
    super()
    this.needsSwap = false
  }
  setSize(w: number, h: number) {
    this.a.setSize(Math.max(8, Math.round(w / 8)), Math.max(8, Math.round(h / 8)))
    this.b.setSize(Math.max(4, Math.round(w / 32)), Math.max(4, Math.round(h / 32)))
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.active) return
    const u = this.material.uniforms
    u.tDiffuse.value = read.texture
    u.uTexel.value.set(1 / read.width, 1 / read.height).multiplyScalar(2)
    renderer.setRenderTarget(this.a)
    this.quad.render(renderer)
    u.tDiffuse.value = this.a.texture
    u.uTexel.value.set(1 / this.a.width, 1 / this.a.height).multiplyScalar(1.5)
    renderer.setRenderTarget(this.b)
    this.quad.render(renderer)
  }
}

export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  final: ShaderPass
  private scenePass: ScenePass
  /**
   * Chapters write targets here every frame (the engine resets them to
   * defaults first); values are damped so nothing pops at a cut.
   */
  params: PostParams = { ...POST_DEFAULTS }
  private current: PostParams = { ...POST_DEFAULTS }
  transition = 0
  fade = 0
  /** engine: reduced motion or the visitor's Motion switch is off */
  calm = false
  /** engine: smoothed scroll velocity in viewport heights per second (signed) */
  velocity = 0
  /** engine: +1 when the nearest boundary is ahead (leaving a chapter), -1 when behind (entering) */
  cutSide = 1
  private speedDim = 0
  private field: FieldPass
  /**
   * Run right before the scene renders each frame, at the TOP level (camera
   * already placed, its matrixWorld updated). Mirrors/reflectors render here
   * instead of from Mesh.onBeforeRender: a nested render makes every lit
   * material re-resolve its program twice a frame. Check your own group's
   * visibility inside the hook (it runs whichever chapter is active).
   */
  preRender: ((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void)[] = []
  private lastFlashAt = -1e9
  private flashLive = false
  private flashOk = true

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    /** skip MSAA (retina / mobile: already supersampled; MSAA half-float targets are huge) */
    noMsaa: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 0,
      depthBuffer: false,
    })
    this.composer = new EffectComposer(renderer, rt)
    this.scenePass = new ScenePass(scene, camera, noMsaa ? 0 : 4)
    this.composer.addPass(this.scenePass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), POST_DEFAULTS.bloomStrength, POST_DEFAULTS.bloomRadius, POST_DEFAULTS.bloomThreshold)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.field = new FieldPass()
    this.composer.addPass(this.field)
    this.final = new ShaderPass(FinalShader)
    this.final.uniforms.tField.value = this.field.b.texture
    this.composer.addPass(this.final)
  }

  /** The scene's render target (HDR, linear; multisampled on 1x desktops) — prewarm compiles against it. */
  get sceneTarget() {
    return this.scenePass.target
  }

  /** true when `rt` is the frame's own scene target (not a mirror / transmission pass) */
  isFrameTarget(rt: THREE.WebGLRenderTarget | null) {
    return rt === this.scenePass.target || rt === this.composer.renderTarget1 || rt === this.composer.renderTarget2
  }

  /** THEME: the colour the calm fade passes through. */
  setCutColor(color: THREE.ColorRepresentation) {
    // display values (the final pass runs after the sRGB output pass)
    ;(this.final.uniforms.uFadeColor.value as THREE.Color).set(color).convertLinearToSRGB()
  }

  /** Engine hook (kept for compatibility; themes may tint the fade by scene tone). */
  setFadeTone(_tone: number) {}

  resetParams() {
    Object.assign(this.params, POST_DEFAULTS)
  }

  /**
   * Compile every post-processing shader in parallel so the first composer
   * render doesn't block on synchronous links.
   */
  compileAsync(): Promise<unknown> {
    // the same attribute set as FullScreenQuad (position + uv, no normal): a
    // PlaneGeometry compiles a different program variant that's never used
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2))
    const quad = new THREE.Mesh(geo)
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const b = this.bloom as unknown as Record<string, unknown>
    const mats: THREE.Material[] = []
    const add = (m: unknown) => {
      if (m && (m as THREE.Material).isMaterial) mats.push(m as THREE.Material)
    }
    for (const pass of this.composer.passes) add((pass as unknown as { material?: unknown }).material)
    for (const m of (b.separableBlurMaterials as unknown[]) ?? []) add(m)
    add(b.compositeMaterial)
    add(b.blendMaterial)
    add(b.materialHighPassFilter)
    add(b.copyMaterial)
    return Promise.all(mats.map(m => this.renderer.compileAsync(new THREE.Mesh(quad.geometry, m), cam).catch(() => {})))
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2)
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr)
    this.final.uniforms.uDpr.value = dpr
    this.final.uniforms.uFieldTexel.value.set(1 / this.field.b.width, 1 / this.field.b.height)
  }

  render(dt: number, time: number) {
    const k = 1 - Math.exp(-6 * dt)
    const c = this.current
    const p = this.params
    for (const key of Object.keys(p) as (keyof PostParams)[]) {
      // flash & glitch respond instantly so chapters can punch them
      c[key] = key === 'flash' || key === 'glitch' ? p[key] : c[key] + (p[key] - c[key]) * k
    }
    // flash budget (WCAG 2.3.1): a flash starting within FLASH_GAP of the last is dropped
    if (c.flash > 0.02) {
      if (!this.flashLive) {
        this.flashLive = true
        this.flashOk = time - this.lastFlashAt >= FLASH_GAP
        if (this.flashOk) this.lastFlashAt = time
      }
      if (!this.flashOk) c.flash = 0
    } else this.flashLive = false
    // speed dim (WCAG 2.3.1 safety net): the frame dims as the page moves fast,
    // attack ~0.2 s, release ~0.6 s — slow enough that wheel notches under
    // reduced motion (instant scroll, spiky velocity) read as one steady dim
    {
      const v = Math.abs(this.velocity)
      const x = Math.max(0, Math.min(1, (v - 1.1) / 2.4))
      const target = x * x * (3 - 2 * x) * 0.5
      const tau = target > this.speedDim ? 0.2 : 0.6
      this.speedDim += (target - this.speedDim) * (1 - Math.exp(-dt / tau))
    }
    // chapters zero bloom where nothing crosses the threshold: skip the pass entirely
    this.bloom.enabled = c.bloomStrength > 0.01
    this.bloom.strength = c.bloomStrength
    this.bloom.radius = c.bloomRadius
    this.bloom.threshold = c.bloomThreshold
    this.renderer.toneMappingExposure = c.exposure
    const u = this.final.uniforms
    u.uTime.value = time
    u.uTransition.value = this.transition
    u.uCutSide.value = this.cutSide
    u.uGlitch.value = c.glitch
    u.uAberration.value = c.aberration
    u.uGrain.value = c.grain
    // grain re-deals at 24 fps; bubbles still when calm (reduced motion /
    // Motion off) — and frame time itself freezes with Motion off
    u.uGrainSeed.value = this.calm ? 0 : Math.floor(time * 24)
    u.uMotion.value = this.calm ? 0 : 1
    u.uVignette.value = c.vignette
    u.uFlash.value = c.flash
    u.uFade.value = this.fade
    u.uSpeedDim.value = this.speedDim
    u.uSat.value = c.saturation
    u.uLift.value = c.lift
    u.uWarmth.value = c.warmth
    u.uBeer.value = c.beer
    // the field only feeds the pour's brightness
    this.field.active = this.transition > 0.001
    if (this.preRender.length) {
      this.camera.updateMatrixWorld()
      for (const fn of this.preRender) fn(this.renderer, this.scene, this.camera)
    }
    this.composer.render(dt)
  }
}
