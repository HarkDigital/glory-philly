import * as THREE from 'three'
import { COVERS, SPINES, coolerMap, ductMaps, galvMaps, glowTexture, grainDetail, rubberData, spineAtlas, walnutMaps } from './textures'

/*
 * ROOM KIT materials. Each kit instance gets its OWN materials (cheap: the
 * programs are shared through customProgramCacheKey; the maps are cached
 * once), because each carries its instance's light POOLS:
 *
 * POOLS are fake point lights evaluated only in the kit's materials — the
 * warm light of each Edison bulb on the walnut, the records, the bottles
 * (diffuse wrap + a satin highlight, bump-mapped). No real lights, no
 * program changes elsewhere in the chapter. Pools live in the kit's local
 * space; the meshes carry them to view space in onBeforeRender, so a chapter
 * may move/scale the kit's group freely.
 */

export const MAX_POOLS = 8
/** the additive halo's strength at glow 1 */
export const HALO_K = 0.55

/**
 * The kit's bounce light (uPoolAmb), linear RGB: nearly neutral on purpose.
 * The bulbs' pools stay warm, but the SHADOWS must not: Khronos PBR Neutral's
 * toe subtracts a black level off the smallest channel, so a warm fill on warm
 * walnut comes out pure orange in the darks (the photos' shadows keep a brown
 * hue, R/B ≈ 2 in sRGB). A warm key over a near-neutral fill keeps both.
 */
export const AMBIENT_TINT = new THREE.Color(1, 0.92, 0.84)

/**
 * How much of Khronos PBR Neutral's toe the kit's OPAQUE materials pre-cancel
 * (0 = none, 1 = the kit displays its linear colour below the shoulder).
 * The toe subtracts a black level taken from the SMALLEST channel, so dim warm
 * surfaces (walnut, brick, LP spines in shadow) lose their blue and come out
 * pure orange, where Mike's photos keep them brown. Pre-lifting by the exact
 * inverse offset keeps their hue — the room reads like the photographs — while
 * everything else in a chapter keeps the site's curve.
 */
export const UNTOE = 0.8

export interface Pool {
  /** kit-local position (metres) */
  pos: THREE.Vector3
  /** reach in metres (the light is windowed to zero there; it falls off as 1/d² long before) */
  radius: number
  color: THREE.Color
  /** intensity multiplier */
  power: number
}

export class PoolSet {
  pools: Pool[] = []
  uniforms = {
    uPoolV: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Vector4(0, 0, 0, 1)) },
    uPoolC: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Color(0, 0, 0)) },
    uPoolR: { value: Array.from({ length: MAX_POOLS }, () => 1) },
    uPoolK: { value: 1 },
    /** the bulbs' light bounced round the room (warm ambient in the kit's materials) */
    uPoolAmb: { value: AMBIENT_TINT.clone().multiplyScalar(0.3) },
    /** the toe pre-cancel on opaque kit materials (see UNTOE) */
    uUntoe: { value: UNTOE },
  }
  private mv = new THREE.Matrix4()
  private v = new THREE.Vector3()
  /** intensity of every pool (drive it; never toggle) */
  set k(v: number) {
    this.uniforms.uPoolK.value = v
  }
  get k() {
    return this.uniforms.uPoolK.value
  }
  add(pos: THREE.Vector3, radius = 3, color: THREE.ColorRepresentation = '#ffe4c8', power = 0.8) {
    if (this.pools.length >= MAX_POOLS) return
    this.pools.push({ pos: pos.clone(), radius, color: new THREE.Color(color), power })
  }
  /** called from each kit mesh's onBeforeRender (object = the kit's root group) */
  sync(camera: THREE.Camera, object: THREE.Object3D) {
    this.mv.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld)
    const s = object.matrixWorld.getMaxScaleOnAxis()
    const V = this.uniforms.uPoolV.value
    const Cc = this.uniforms.uPoolC.value
    for (let i = 0; i < MAX_POOLS; i++) {
      const p = this.pools[i]
      if (!p) {
        Cc[i].setRGB(0, 0, 0)
        continue
      }
      this.v.copy(p.pos).applyMatrix4(this.mv)
      V[i].set(this.v.x, this.v.y, this.v.z, s)
      this.uniforms.uPoolR.value[i] = p.radius
      Cc[i].copy(p.color).multiplyScalar(p.power)
    }
  }
}

const POOL_FRAG_HEAD = /* glsl */ `
  uniform vec4 uPoolV[${MAX_POOLS}];
  uniform vec3 uPoolC[${MAX_POOLS}];
  uniform float uPoolR[${MAX_POOLS}];
  uniform float uPoolK;
  uniform vec3 uPoolAmb;
  uniform float uUntoe;
`
/**
 * After opaque_fragment: pre-lift the colour by the inverse of PBR Neutral's
 * toe offset (x_min → 6.25·x_min² below 0.08; a flat 0.04 above) so the
 * tone-mapped result keeps the linear colour's hue in the darks. Exposure 1.
 */
const UNTOE_FRAG = /* glsl */ `
  {
    vec3 cU = max(gl_FragColor.rgb, vec3(0.0));
    float mU = min(cU.r, min(cU.g, cU.b));
    float lU = mU < 0.04 ? 0.4 * sqrt(mU) - mU : 0.04;
    gl_FragColor.rgb = cU + lU * uUntoe;
  }
`
/** after lights_fragment_end: add each pool's diffuse wrap + a satin lobe */
const POOL_FRAG = /* glsl */ `
  {
    vec3 pp = -vViewPosition;
    vec3 vv = normalize(vViewPosition);
    float shin = mix(8.0, 90.0, 1.0 - material.roughness);
    vec3 pd = vec3(0.0);
    vec3 ps = vec3(0.0);
    vec3 pt = vec3(0.0);
    for (int i = 0; i < ${MAX_POOLS}; i++) {
      vec3 d = uPoolV[i].xyz - pp;
      float dist = length(d);
      vec3 L = d / max(dist, 1e-4);
      // a bulb: inverse square with a soft ~28 cm core (the wall right behind a bulb glows, never blows out), windowed to its range (metres)
      float dm = dist / uPoolV[i].w;
      float fall = 1.0 / (dm * dm + 0.08) * (1.0 - smoothstep(0.55, 1.0, dm / uPoolR[i]));
      float ndl = dot(normal, L);
      float wrap = clamp(ndl * 0.8 + 0.2, 0.0, 1.0);
      pd += uPoolC[i] * fall * wrap;
      float spec = ndl > 0.0 ? exp2(log2(max(dot(normal, normalize(L + vv)), 1e-4)) * shin) : 0.0;
      ps += uPoolC[i] * fall * spec * (shin + 8.0) / 64.0;
      #ifdef ROOM_TRANSMIT
        float thru = max(dot(-vv, L), 0.0);
        pt += uPoolC[i] * fall * thru * thru * thru;
      #endif
    }
    #ifdef ROOM_TRANSMIT
      totalEmissiveRadiance += roomTint * pt * uPoolK * 0.6;
    #endif
    reflectedLight.directDiffuse += material.diffuseColor * pd * uPoolK;
    reflectedLight.indirectDiffuse += material.diffuseColor * uPoolAmb * uPoolK;
    reflectedLight.directSpecular += ps * uPoolK * mix(vec3(0.04), material.specularColor, 0.5) * 2.0 * (1.0 - material.roughness * 0.6);
  }
`

/**
 * Patch a Mesh(Standard|Physical)Material so the pools light it. Extra
 * vertex/fragment edits compose (pass `more` for a material's own patch).
 * `untoe: true` also keeps the material's dark tones' hue through PBR
 * Neutral (see UNTOE) like the kit's own walnut/brick/records — opaque,
 * non-transmissive materials only. Off by default for your own materials.
 */
export function withPools<T extends THREE.MeshStandardMaterial>(
  mat: T,
  pools: PoolSet,
  key: string,
  more?: (s: THREE.WebGLProgramParametersWithUniforms) => void,
  { untoe = false }: { untoe?: boolean } = {},
): T {
  const prev = mat.onBeforeCompile
  const prevKey = mat.customProgramCacheKey?.bind(mat)
  // (decided per compile: glass, halos and transmissive materials never get it)
  const useUntoe = () => untoe && !mat.transparent && !((mat as unknown as THREE.MeshPhysicalMaterial).transmission > 0)
  mat.onBeforeCompile = (s, r) => {
    prev?.call(mat, s, r)
    more?.(s)
    Object.assign(s.uniforms, pools.uniforms)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${POOL_FRAG_HEAD}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${POOL_FRAG}`)
    if (useUntoe()) s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${UNTOE_FRAG}`)
  }
  const base = prevKey ? prevKey() : ''
  mat.customProgramCacheKey = () => `room-${key}${useUntoe() ? '-u' : ''}|${base}`
  return mat
}

/** the kit's own materials: pools + the hue-keeping toe pre-cancel */
export function kitPools<T extends THREE.MeshStandardMaterial>(mat: T, pools: PoolSet, key: string, more?: (s: THREE.WebGLProgramParametersWithUniforms) => void): T {
  return withPools(mat, pools, key, more, { untoe: true })
}

/** hook a mesh so its material's pools follow it into view space */
export function poolHook(mesh: THREE.Object3D, pools: PoolSet, root: THREE.Object3D) {
  const prev = mesh.onBeforeRender
  mesh.onBeforeRender = (r, s, cam, g, m, gr) => {
    prev.call(mesh, r, s, cam, g, m, gr)
    pools.sync(cam, root)
  }
}

// ─── the material set of one kit instance ───────────────────────────────────

export interface RoomMaterials {
  pools: PoolSet
  walnut: THREE.MeshStandardMaterial
  /** black-painted steel (ledges, brackets, cages, cooler frames) */
  steel: THREE.MeshStandardMaterial
  /** aged brass (sconce plates, arms, sockets) */
  brass: THREE.MeshStandardMaterial
  chrome: THREE.MeshStandardMaterial
  /** the back counter top: ebonised, satin */
  counter: THREE.MeshStandardMaterial
  /** black ceiling paint */
  ceiling: THREE.MeshStandardMaterial
  mirror: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
  duct: THREE.MeshStandardMaterial
  /** galvanized sheet steel (the rectangular trunk duct on the ceiling, ref1) */
  galv: THREE.MeshStandardMaterial
  /** Edison bulb envelope (transparent, faintly lit) */
  bulb: THREE.MeshStandardMaterial
  /** the filament (HDR, blooms) */
  filament: THREE.MeshBasicMaterial
  /** instanced additive halo (billboards) */
  glow: THREE.ShaderMaterial
  /** instanced LPs: spines + generic covers from the atlas */
  records: THREE.MeshStandardMaterial
  /** instanced liquor bottles (glass/label/cap parts, per-instance colours) */
  bottles: THREE.MeshStandardMaterial
  /** the liquor's inner glow (drive it) */
  bottleGlow: { value: number }
  /** lit cooler interiors (cool, gentle) */
  coolerLight: THREE.MeshBasicMaterial
  /** instanced pour spouts (vertex colours: black cork, chrome tube) */
  spouts: THREE.MeshStandardMaterial
  /** instanced glassware stand-ins (non-transmissive) */
  glassware: THREE.MeshStandardMaterial
  /** cooler door glass */
  coolerGlass: THREE.MeshStandardMaterial
  /** all materials this set created (dispose) */
  list: THREE.Material[]
  dispose(): void
}

export function roomMaterials({ glow = 1 } = {}): RoomMaterials {
  const pools = new PoolSet()
  const list: THREE.Material[] = []
  const P = <T extends THREE.MeshStandardMaterial>(m: T, key: string, more?: (s: THREE.WebGLProgramParametersWithUniforms) => void) => {
    list.push(m)
    return kitPools(m, pools, key, more)
  }
  const wm = walnutMaps()
  const walnut = P(
    new THREE.MeshStandardMaterial({
      map: wm.map,
      roughnessMap: wm.data,
      bumpMap: wm.data,
      bumpScale: 1.8,
      roughness: 1,
      envMapIntensity: 0.5,
    }),
    'walnut',
    s => {
      // close-range grain: a fine streak map (~20 × 17 cm per tile; the plank map is 2 : 1),
      // soft, faded out with distance so it never adds a pattern of its own
      s.uniforms.uGrain = { value: grainDetail() }
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uGrain;')
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          {
            vec2 gu = vMapUv * vec2(12.0, 7.0);
            float fw = length(fwidth(gu));
            float gd = texture2D(uGrain, gu).r;
            diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * gd, 1.0 - smoothstep(0.02, 0.12, fw));
          }`,
        )
    },
  )
  const steel = P(new THREE.MeshStandardMaterial({ color: '#141414', metalness: 0.55, roughness: 0.42, envMapIntensity: 0.9 }), 'steel')
  // oil-rubbed, aged brass: dark (a bulb 12 cm away would turn bright brass into a glowing disc)
  const brass = P(new THREE.MeshStandardMaterial({ color: '#35281a', metalness: 1, roughness: 0.6, envMapIntensity: 1 }), 'brass')
  const chrome = P(new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.14 }), 'chrome')
  const counter = P(
    new THREE.MeshStandardMaterial({ color: '#171312', roughness: 0.34, metalness: 0.05, roughnessMap: wm.data, envMapIntensity: 0.8 }),
    'counter',
  )
  const ceiling = P(new THREE.MeshStandardMaterial({ color: '#0f0e0e', roughness: 0.9, metalness: 0, envMapIntensity: 0.3 }), 'ceiling')
  const mirror = P(new THREE.MeshStandardMaterial({ color: '#7a746c', metalness: 1, roughness: 0.08, envMapIntensity: 1 }), 'mirror')
  const rubber = P(
    new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.85, bumpMap: rubberData(), bumpScale: 2, envMapIntensity: 0.5 }),
    'rubber',
  )
  const dm = ductMaps()
  const duct = P(
    new THREE.MeshStandardMaterial({ map: dm.map, roughnessMap: dm.data, bumpMap: dm.data, bumpScale: 2.4, color: '#dcdcd8', metalness: 0.9, roughness: 1, envMapIntensity: 1.1 }),
    'duct',
  )
  const gm = galvMaps()
  const galv = P(
    new THREE.MeshStandardMaterial({ map: gm.map, roughnessMap: gm.data, bumpMap: gm.data, bumpScale: 0.4, metalness: 0.8, roughness: 1, envMapIntensity: 1.1 }),
    'galv',
  )
  const bulb = new THREE.MeshStandardMaterial({
    color: '#fff1dc',
    emissive: new THREE.Color('#ff9a45'),
    emissiveIntensity: 1.5 * glow,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    envMapIntensity: 1.6,
  })
  list.push(bulb)
  const filament = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb56a').multiplyScalar(5.5 * glow) })
  list.push(filament)

  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: glowTexture() }, uK: { value: HALO_K * glow } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        // pull the halo toward the camera ALONG ITS RAY (so walls behind never slice it
        // and it stays centred on the bulb from any angle), shrunk to keep its apparent size
        float L = length(c.xyz);
        float k = max(L - s * 0.5, L * 0.5) / max(L, 1e-4);
        c.xyz *= k;
        c.xy += position.xy * s * k;
        gl_Position = projectionMatrix * c;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uK;
      varying vec2 vUv;
      varying vec3 vCol;
      void main() {
        // (canvas alpha: its RGB is un-premultiplied white)
        float g = texture2D(uMap, vUv).a;
        // tight: a glow round the glass, not a wash over the wall behind it…
        float a = g;
        g = g * g * sqrt(g);
        // …plus an HDR core the size of the glass (~2 cm): the bulb reads hot and blooms
        float core = a * a * a;
        gl_FragColor = vec4(vCol * (g + core * 5.0) * uK, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  list.push(glowMat)

  // LPs: spine faces + cover faces from the atlas, per-instance art cell
  const records = P(
    new THREE.MeshStandardMaterial({ map: spineAtlas(), roughness: 0.62, envMapIntensity: 0.5 }),
    'records',
    s => {
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          attribute float aKind;
          attribute vec2 aArt;`,
        )
        .replace(
          '#include <uv_vertex>',
          /* glsl */ `#include <uv_vertex>
          if (aKind < 0.5) {
            vMapUv = vec2((aArt.x + uv.x) / ${SPINES.toFixed(1)}, 0.5 + uv.y * 0.5);
          } else {
            float cx = mod(aArt.y, 8.0);
            float cy = floor(aArt.y / 8.0 + 0.001);
            vMapUv = vec2((cx + uv.x) / 8.0, (3.0 - cy + uv.y) / 4.0 * 0.5);
          }`,
        )
    },
  )
  void COVERS

  // bottles: glass / label / neck foil, per-instance colours, a liquid glow
  const bottleGlowU = { value: 0.12 }
  const bottles = P(
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, metalness: 0, envMapIntensity: 1.25 }),
    'bottles',
    s => {
      s.uniforms.uBottleGlow = bottleGlowU
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          attribute float aPart;
          attribute float aLabelV;
          attribute vec3 aGlass;
          attribute vec3 aLabel;
          attribute float aSeed;
          attribute float aAround;
          attribute float aFill;
          varying float vFill;
          varying float vBY;
          varying float vPart;
          varying float vLabelV;
          varying vec3 vGlass;
          varying vec3 vLabel;
          varying float vSeed;
          varying vec2 vBUv;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          vPart = aPart; vLabelV = aLabelV; vGlass = aGlass; vLabel = aLabel; vSeed = aSeed; vBUv = vec2(aAround, 0.0); vFill = aFill; vBY = position.y;`,
        )
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform float uBottleGlow;
          varying float vPart;
          varying float vLabelV;
          varying vec3 vGlass;
          varying vec3 vLabel;
          varying float vSeed;
          varying vec2 vBUv;
          varying float vFill;
          varying float vBY;
          float bPart;
          float bEmpty;
          vec3 roomTint;`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          // u = 0 faces +z (the front)
          float au = abs(fract(vBUv.x + 0.5) - 0.5) * 2.0;
          float sd = abs(vSeed);
          float s1 = fract(sd * 3.71);
          float s2 = fract(sd * 7.13);
          float s3 = fract(sd * 11.7);
          float s4 = fract(sd * 5.31);
          // each bottle wears its own label: a slice of the band, its own width
          float lo = 0.32 * s1 * step(0.3, s2);
          float hi = 1.0 - 0.28 * s3 * step(0.5, s1);
          float wid = 0.3 + 0.26 * s2;
          float onLabel = step(0.5, vPart) * step(vPart, 1.5) * step(lo, vLabelV) * step(vLabelV, hi) * step(au, wid) * step(s4, 0.93);
          bPart = vPart > 1.5 ? 2.0 : onLabel;
          // a spouted bottle (negative seed) shows glass where the foil would be
          if (bPart > 1.5 && vSeed < 0.0) bPart = 0.0;
          bEmpty = step(vFill, vBY);
          vec3 bc;
          roomTint = vec3(0.0);
          if (bPart > 1.5) {
            bc = vec3(0.025);
            bc = mix(bc, vec3(0.3, 0.045, 0.035), step(0.8, s3));
            bc = mix(bc, vec3(0.5, 0.38, 0.2), step(0.92, s1));
          } else if (bPart > 0.5) {
            // a generic printed label (no marks, no words): blocks, rules, a roundel
            float v = (vLabelV - lo) / max(hi - lo, 0.05);
            float x = au / wid;
            bc = vLabel;
            float lum = dot(vLabel, vec3(0.3, 0.59, 0.11));
            vec3 inkC = lum > 0.2 ? mix(vec3(0.06, 0.05, 0.04), vec3(0.32, 0.05, 0.04), step(0.72, s2)) : vec3(0.62, 0.52, 0.34);
            float st = floor(s3 * 4.0);
            float m = 0.0;
            if (st < 0.5) {
              m = step(0.44, v) * step(v, 0.68) * step(x, 0.72);
              m += (1.0 - smoothstep(0.0, 0.015, abs(v - 0.26))) + (1.0 - smoothstep(0.0, 0.015, abs(v - 0.86)));
              m += step(0.5, fract(v * 30.0)) * step(0.08, v) * step(v, 0.2) * step(x, 0.5) * 0.4;
            } else if (st < 1.5) {
              m = step(0.74, v) * 0.9;
              m += step(0.55, fract(v * 22.0)) * step(0.2, v) * step(v, 0.55) * step(x, 0.6) * 0.45;
            } else if (st < 2.5) {
              float rr = length(vec2(x * 1.3, (v - 0.56) * 2.2));
              m = (1.0 - smoothstep(0.0, 0.05, abs(rr - 0.42))) + step(rr, 0.2) * 0.8;
              m += step(v, 0.14) * step(x, 0.55) * 0.7;
            } else {
              m = (1.0 - smoothstep(0.0, 0.02, abs(v - 0.2))) + (1.0 - smoothstep(0.0, 0.02, abs(v - 0.8)));
              m += step(0.4, v) * step(v, 0.56) * step(x, 0.42);
            }
            bc = mix(bc, inkC, clamp(m, 0.0, 1.0) * 0.82);
            bc *= 0.78 + 0.22 * (1.0 - smoothstep(0.7, 1.0, x));
          } else {
            // glass: next to no diffuse — its colour comes through it (below) and off it (reflections)
            vec3 liquid = mix(vGlass, vGlass * 0.2 + vec3(0.015), bEmpty);
            bc = liquid * 0.14;
            roomTint = liquid * 1.6;
          }
          diffuseColor.rgb = bc;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `#include <roughnessmap_fragment>
          roughnessFactor = bPart > 1.5 ? 0.3 : (bPart > 0.5 ? 0.6 : 0.05);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          /* glsl */ `#include <metalnessmap_fragment>
          metalnessFactor = bPart > 1.5 ? 0.6 * step(0.92, fract(abs(vSeed) * 3.71)) : 0.0;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          if (bPart < 0.5) {
            // the back bar's light passing through the liquid: brightest face-on, dark at the rims
            float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
            totalEmissiveRadiance += roomTint * uBottleGlow * (0.08 + 0.92 * facing * facing);
          }`,
        )
    },
  )
  bottles.defines = { ROOM_TRANSMIT: '' }

  const spouts = P(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, metalness: 1, roughness: 0.16 }), 'spouts')
  const glassware = new THREE.MeshStandardMaterial({
    color: '#dfe6e4',
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    envMapIntensity: 2.2,
  })
  withPools(glassware, pools, 'glassware')
  list.push(glassware)
  const coolerGlass = new THREE.MeshStandardMaterial({
    color: '#0c0f0f',
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    envMapIntensity: 1.3,
  })
  withPools(coolerGlass, pools, 'coolerglass')
  list.push(coolerGlass)

  const coolerLight = new THREE.MeshBasicMaterial({ map: coolerMap(), color: new THREE.Color('#d6ecff').multiplyScalar(0.95) })
  list.push(coolerLight)

  return {
    pools,
    walnut,
    steel,
    brass,
    chrome,
    counter,
    ceiling,
    mirror,
    rubber,
    duct,
    galv,
    bulb,
    filament,
    glow: glowMat,
    records,
    bottles,
    bottleGlow: bottleGlowU,
    coolerLight,
    spouts,
    glassware,
    coolerGlass,
    list,
    dispose() {
      for (const m of list) m.dispose()
    },
  }
}

