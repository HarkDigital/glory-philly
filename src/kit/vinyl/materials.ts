import * as THREE from 'three'
import { crateDims, type CrateDims, type RecordDims, REC12 } from './geometry'

/*
 * VINYL KIT materials (ported from Resonance's crate). Everything stays
 * MeshStandard (the world's PMREM studio gives product-shot reflections) and
 * is extended with onBeforeCompile. Programs are SHARED: every material of a
 * kind has the same customProgramCacheKey and the same shader source; all
 * per-object differences are uniforms (so 30 sleeves = 1 program).
 *
 *  - sleeves: laminated board. FRONT = `map`, BACK = `uBack` (two canvases),
 *    paper grain + fibres, ring wear from the record inside, scuffed edges.
 *    OPT-IN crate shading (occlusion down inside a crate, and the soft shadow
 *    of a record/sleeve held above it) reads a CrateShade by reference:
 *    `crate.adopt(sleeve)` points the uniforms at the crate's shared values.
 *    The instanced variant (WK_ATLAS) draws background sleeves from a 4x4
 *    cover atlas (per-instance aCell/aInk) — a separate material, never
 *    shared with a plain mesh (engine gotcha).
 *  - vinyl: concentric-groove anisotropic highlights (Kajiya–Kay against the
 *    key + rim; they hold still while the label turns), loud/quiet bands and
 *    track gaps, mirror dead wax, a printed paper label, rotational smear at
 *    speed. Radii are uniforms (12" and 7" share one program). Optional
 *    coloured vinyl.
 *  - crate: black anodized aluminium; the diamond-cut chamfers are bright
 *    polished metal (per-vertex flag), interior occlusion toward the floor.
 *  - turntable: brushed platter with strobe dots (a phase per row: the 33⅓
 *    row reads "locked" at 33⅓), felt mat, chrome, satin black, walnut.
 */

export const NOISE_GLSL = /* glsl */ `
float wkH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wkN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wkH(i), wkH(i + vec2(1.0, 0.0)), f.x), mix(wkH(i + vec2(0.0, 1.0)), wkH(i + vec2(1.0, 1.0)), f.x), f.y);
}
`

let blank: THREE.DataTexture | null = null
/** 1x1 paper-coloured texture to bind until real art arrives */
export function blankTexture() {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([226, 218, 202, 255]), 1, 1)
    blank.colorSpace = THREE.SRGBColorSpace
    blank.needsUpdate = true
  }
  return blank
}

// ─── crate shading (opt-in, shared by reference) ─────────────────────────────

/**
 * What a crate tells the sleeves standing in it. All fields are objects so a
 * sleeve's uniforms can point at them (`uniform.value = shade.box`) and follow
 * every change without a recompile.
 */
export interface CrateShade {
  /** world → crate-local */
  m: THREE.Matrix4
  /** (inner half width, zBack + wall, zFront - wall, floor y) crate-local */
  box: THREE.Vector4
  /** (back rim height, front rim height, occlusion weight 0..1, held object's low y) */
  rim: THREE.Vector4
  /** a held object's shadow down into the crate: (x, z, radius, strength) crate-local */
  lift: THREE.Vector4
}

export function makeCrateShade(C: CrateDims = crateDims()): CrateShade {
  return {
    m: new THREE.Matrix4(),
    box: new THREE.Vector4(C.inner, C.zBack + C.wall, C.zFront - C.wall, C.y0),
    rim: new THREE.Vector4(C.backH, C.frontH, 1, 10),
    lift: new THREE.Vector4(0, 0, 1, 0),
  }
}

/** the "not in a crate" shade (occlusion weight 0) every sleeve starts with */
const NO_CRATE: CrateShade = (() => {
  const s = makeCrateShade()
  s.rim.z = 0
  return s
})()

export interface SleeveUniforms {
  uBack: { value: THREE.Texture }
  uInk: { value: number }
  uEdge: { value: THREE.Color }
  uSeed: { value: number }
  uHole: { value: number }
  uGloss: { value: number }
  uWear: { value: number }
  uCrateM: { value: THREE.Matrix4 }
  uCrateBox: { value: THREE.Vector4 }
  uCrateRim: { value: THREE.Vector4 }
  uLift: { value: THREE.Vector4 }
  uBackCell: { value: number }
}

/** Point a sleeve's uniforms at a crate's shade (or back to none). */
export function bindCrateShade(u: SleeveUniforms, shade: CrateShade | null) {
  const s = shade ?? NO_CRATE
  u.uCrateM.value = s.m
  u.uCrateBox.value = s.box
  u.uCrateRim.value = s.rim
  u.uLift.value = s.lift
}

export interface SleeveMaterialOpts {
  /** back cover (default: blank board) */
  back?: THREE.Texture
  /** dark board (black/stout sleeves): edges and wear go light instead of dark */
  ink?: boolean
  /** board edge colour (default: derived from ink) */
  edge?: THREE.ColorRepresentation
  seed?: number
  /** die-cut centre hole radius in cover units (0..0.5), e.g. 0.19 for a 7" company sleeve */
  hole?: number
  /** laminate roughness of the front (0.3 glossy .. 0.6 matte board) */
  gloss?: number
  /** ring wear + scuffs, 0..1.5 */
  wear?: number
}

/**
 * kind 'plain': front = map, back = opts.back. kind 'atlas' (InstancedMesh
 * only): 4x4 cover atlas in `map`, per-instance aCell (0..14 fronts) / aInk,
 * all backs from cell `uBackCell` (15).
 */
export function sleeveMaterial(kind: 'plain' | 'atlas', map: THREE.Texture, opts: SleeveMaterialOpts = {}) {
  const ink = !!opts.ink
  const u: SleeveUniforms = {
    uBack: { value: opts.back ?? blankTexture() },
    uInk: { value: ink ? 1 : 0 },
    uEdge: { value: new THREE.Color(opts.edge ?? (ink ? '#242022' : '#b9ad97')) },
    uSeed: { value: opts.seed ?? 0 },
    uHole: { value: opts.hole ?? 0 },
    uGloss: { value: opts.gloss ?? 0.42 },
    uWear: { value: opts.wear ?? 1 },
    uCrateM: { value: NO_CRATE.m },
    uCrateBox: { value: NO_CRATE.box },
    uCrateRim: { value: NO_CRATE.rim },
    uLift: { value: NO_CRATE.lift },
    uBackCell: { value: 15 },
  }
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.5, metalness: 0 })
  m.defines = { GV_SLEEVE: '' }
  if (kind === 'atlas') m.defines.GV_ATLAS = ''
  m.customProgramCacheKey = () => `gv-sleeve-${kind}`
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vSLocal;
        varying vec3 vSNormal;
        varying vec3 vSWorld;
        #ifdef GV_ATLAS
          attribute float aCell;
          attribute float aInk;
          varying float vCell;
          varying float vInk;
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vSLocal = position;
        vSNormal = normal;
        #ifdef USE_INSTANCING
          vSWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vSWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif
        #ifdef GV_ATLAS
          vCell = aCell;
          vInk = aInk;
        #endif`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        ${NOISE_GLSL}
        varying vec3 vSLocal;
        varying vec3 vSNormal;
        varying vec3 vSWorld;
        uniform sampler2D uBack;
        uniform float uInk, uSeed, uHole, uBackCell, uGloss, uWear;
        uniform mat4 uCrateM;
        uniform vec4 uCrateBox, uCrateRim, uLift;
        uniform vec3 uEdge;
        #ifdef GV_ATLAS
          varying float vCell;
          varying float vInk;
        #endif
        float gvFace = 0.0;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 fuv = vec2(vSLocal.x + 0.5, vSLocal.y);
        gvFace = vSNormal.z;
        // every derivative up front, in uniform control flow (before the hole's
        // discard and the per-face branches); the samples take explicit gradients
        vec2 fdx = dFdx(fuv);
        vec2 fdy = dFdy(fuv);
        float fw = (abs(fdx.x) + abs(fdy.x) + abs(fdx.y) + abs(fdy.y)) * 520.0;
        float ink = uInk;
        float seed = uSeed;
        vec3 edgeCol = uEdge;
        #ifdef GV_ATLAS
          ink = vInk;
          seed = vCell * 7.13;
          edgeCol = mix(vec3(0.62, 0.58, 0.52), vec3(0.035), vInk);
        #endif
        if (uHole > 0.0 && abs(gvFace) > 0.5 && length(fuv - 0.5) < uHole) discard;
        vec3 col;
        if (gvFace > 0.5) {
          #ifdef GV_ATLAS
            vec2 cell = vec2(mod(vCell, 4.0), floor(vCell / 4.0 + 0.001));
            col = textureGrad(map, (vec2(cell.x, 3.0 - cell.y) + fuv) / 4.0, fdx * 0.25, fdy * 0.25).rgb;
          #else
            col = textureGrad(map, fuv, fdx, fdy).rgb;
          #endif
        } else if (gvFace < -0.5) {
          #ifdef GV_ATLAS
            vec2 cellB = vec2(mod(uBackCell, 4.0), floor(uBackCell / 4.0 + 0.001));
            col = textureGrad(map, (vec2(cellB.x, 3.0 - cellB.y) + vec2(1.0 - fuv.x, fuv.y)) / 4.0, fdx * vec2(-0.25, 0.25), fdy * vec2(-0.25, 0.25)).rgb;
          #else
            col = textureGrad(uBack, vec2(1.0 - fuv.x, fuv.y), fdx * vec2(-1.0, 1.0), fdy * vec2(-1.0, 1.0)).rgb;
          #endif
        } else {
          col = edgeCol * (0.92 + 0.08 * wkN(vSLocal.xy * vec2(600.0, 600.0)));
        }
        if (abs(gvFace) > 0.5) {
          // board grain + fibres, faded out before they alias (fw: hoisted above)
          float grain = (wkN(fuv * 520.0 + seed) - 0.5) * (1.0 - smoothstep(0.5, 1.4, fw));
          float fib = wkN(fuv * vec2(46.0, 380.0) + seed * 3.1) - 0.5;
          col *= 1.0 + grain * 0.075 + fib * 0.035 * (1.0 - smoothstep(0.8, 2.0, fw));
          // ring wear from the record inside
          vec2 q = fuv - 0.5;
          float rr = length(q);
          float ang = atan(q.y, q.x);
          float band = smoothstep(0.418, 0.438, rr) * (1.0 - smoothstep(0.462, 0.48, rr));
          float wear = band * smoothstep(0.3, 0.85, wkN(vec2(ang * 4.0, rr * 24.0) + seed)) * uWear;
          col = mix(col, mix(col * 0.9, col * 1.12 + 0.05, ink), wear * 0.45);
          // scuffed edges
          float ed = min(min(fuv.x, 1.0 - fuv.x), min(fuv.y, 1.0 - fuv.y));
          float scuff = (1.0 - smoothstep(0.0, 0.007, ed)) * (0.35 + 0.65 * wkN(fuv * 90.0 + seed)) * min(1.0, uWear);
          col = mix(col, mix(col * 0.86, vec3(0.34), ink), scuff * 0.7);
        }
        // crate shading (opt-in: uCrateRim.z is the weight), all in crate-local space
        vec3 cp = (uCrateM * vec4(vSWorld, 1.0)).xyz;
        float inX = 1.0 - smoothstep(uCrateBox.x - 0.03, uCrateBox.x + 0.03, abs(cp.x));
        float inZ = step(uCrateBox.y - 0.01, cp.z) * (1.0 - smoothstep(uCrateBox.z - 0.02, uCrateBox.z + 0.02, cp.z));
        float rim = mix(uCrateRim.x, uCrateRim.y, clamp((cp.z - uCrateBox.y) / (uCrateBox.z - uCrateBox.y), 0.0, 1.0));
        float occ = mix(1.0, mix(0.34, 1.0, smoothstep(uCrateBox.w, rim + 0.22, cp.y)), inX * inZ * uCrateRim.z);
        // the record held above throws a soft shadow down into the crate
        float dl = length((cp.xz - uLift.xy) * vec2(1.0, 1.25));
        occ *= 1.0 - uLift.w * 0.7 * (1.0 - smoothstep(uLift.z * 0.3, uLift.z, dl)) * (1.0 - smoothstep(uCrateRim.w - 0.25, uCrateRim.w, cp.y));
        // (board albedo tops out a touch under white so a hot key doesn't bloom the print)
        diffuseColor.rgb = col * occ * 0.92;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = gvFace > 0.5 ? uGloss : (gvFace < -0.5 ? 0.58 : 0.9);`,
      )
  }
  return { material: m, uniforms: u }
}

// ─── vinyl ──────────────────────────────────────────────────────────────────

export interface RecordUniforms {
  uLabel: { value: THREE.Texture }
  /** rotational smear of the label (radians of arc) */
  uBlur: { value: number }
  /** view-space directions TO the key and the rim (written per draw) */
  uL1: { value: THREE.Vector3 }
  uL2: { value: THREE.Vector3 }
  uC1: { value: THREE.Color }
  uC2: { value: THREE.Color }
  uSpec: { value: number }
  /** weight of the broad groove sheen (the sharp glints stay) */
  uSheen: { value: number }
  uSeed: { value: number }
  /** (labelR, wax, lead, R) */
  uRad: { value: THREE.Vector4 }
  /** coloured vinyl: rgb (linear) + weight */
  uVinyl: { value: THREE.Vector4 }
}

/**
 * The lights the groove highlights answer to (world directions TO the light,
 * and colours). `syncVinylLights(world)` points them at the world's spot and
 * rim A every frame; set them yourself for a custom rig.
 */
export const VINYL_LIGHTS = {
  key: new THREE.Vector3(-0.55, 0.62, 0.56).normalize(),
  rim: new THREE.Vector3(0.75, 0.25, 0.3).normalize(),
  keyColor: new THREE.Color(1, 0.94, 0.86),
  rimColor: new THREE.Color(1, 0.8, 0.6),
}

export function recordMaterial(label: THREE.Texture, opts: { seed?: number; dims?: RecordDims; color?: THREE.ColorRepresentation | null } = {}) {
  const d = opts.dims ?? REC12
  const vc = opts.color != null ? new THREE.Color(opts.color) : null
  const u: RecordUniforms = {
    uLabel: { value: label },
    uBlur: { value: 0 },
    uL1: { value: new THREE.Vector3(0, 0, 1) },
    uL2: { value: new THREE.Vector3(0, 0, 1) },
    uC1: { value: VINYL_LIGHTS.keyColor },
    uC2: { value: VINYL_LIGHTS.rimColor },
    uSpec: { value: 1 },
    uSheen: { value: 1 },
    uSeed: { value: opts.seed ?? 0 },
    uRad: { value: new THREE.Vector4(d.labelR, d.wax, d.lead, d.R) },
    uVinyl: { value: vc ? new THREE.Vector4(vc.r, vc.g, vc.b, 1) : new THREE.Vector4(0, 0, 0, 0) },
  }
  const m = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.34, metalness: 0 })
  m.customProgramCacheKey = () => 'gv-record'
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vRec;
        varying vec3 vRadV;
        varying float vFaceZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vRec = position.xy;
        vRadV = (modelViewMatrix * vec4(position.xy, 0.0, 0.0)).xyz;
        vFaceZ = normal.z;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        ${NOISE_GLSL}
        varying vec2 vRec;
        varying vec3 vRadV;
        varying float vFaceZ;
        uniform sampler2D uLabel;
        uniform float uBlur, uSpec, uSheen, uSeed;
        uniform vec3 uL1, uL2, uC1, uC2;
        uniform vec4 uRad, uVinyl;
        float gvAniso = 0.0;
        float gvRough = 0.34;
        float gvGap = 0.0;
        float gvBand = 1.0;
        float gvFineW = 0.0;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        float r = length(vRec);
        float face = step(0.55, abs(vFaceZ));
        // derivatives in uniform control flow; the label taps use explicit gradients
        vec2 luv = vRec / (2.0 * uRad.x);
        luv.x *= vFaceZ < 0.0 ? -1.0 : 1.0;
        vec2 ldx = dFdx(luv);
        vec2 ldy = dFdy(luv);
        // groove density scales with the record (a 7" has the same pitch)
        float gd = 2400.0 * 0.476 / uRad.w;
        gvFineW = fwidth(r * gd);
        vec3 base = mix(vec3(0.0085), uVinyl.rgb * 0.55, uVinyl.w);
        if (face > 0.5 && r < uRad.x) {
          vec3 lab = vec3(0.0);
          if (uBlur > 0.02) {
            for (int k = 0; k < 7; k++) {
              float a = (float(k) / 6.0 - 0.5) * uBlur;
              float c = cos(a), s = sin(a);
              mat2 rot = mat2(c, s, -s, c);
              lab += textureGrad(uLabel, rot * luv + 0.5, rot * ldx, rot * ldy).rgb;
            }
            lab /= 7.0;
          } else lab = textureGrad(uLabel, luv + 0.5, ldx, ldy).rgb;
          // paper label: faint fibre, a hair of emboss at the rim
          lab *= 0.96 + 0.06 * wkN(vRec * 900.0);
          lab *= 1.0 - 0.25 * smoothstep(uRad.x - 0.006, uRad.x, r);
          base = lab;
          gvRough = 0.7;
          gvAniso = 0.0;
        } else if (face > 0.5 && r < uRad.y) {
          // dead wax: mirror-smooth
          gvRough = 0.1;
          gvAniso = 0.3;
        } else if (face > 0.5 && r < uRad.z) {
          // the programme: loud/quiet bands, four track gaps
          float x = (r - uRad.y) / (uRad.z - uRad.y);
          gvBand = 0.6 + 0.4 * wkN(vec2(x * 46.0 + uSeed * 11.0, uSeed));
          gvBand *= 0.8 + 0.2 * wkN(vec2(x * 190.0, uSeed + 3.0));
          for (int k = 1; k <= 4; k++) {
            float g = float(k) / 5.0 + (wkH(vec2(float(k), uSeed)) - 0.5) * 0.09;
            gvGap = max(gvGap, 1.0 - smoothstep(0.0, 0.0042, abs(x - g)));
          }
          gvRough = mix(0.3, 0.09, gvGap);
          gvAniso = mix(1.0, 0.25, gvGap);
        } else {
          gvRough = 0.2;
          gvAniso = face > 0.5 ? 0.55 : 0.2;
        }
        diffuseColor.rgb = base;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = gvRough;`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        if (gvAniso > 0.0) {
          vec3 Nv = normalize(normal);
          vec3 Rv = vRadV - Nv * dot(vRadV, Nv);
          Rv = Rv / max(length(Rv), 1e-5);
          vec3 Tv = cross(Nv, Rv);
          vec3 V = normalize(vViewPosition);
          vec3 H1 = normalize(uL1 + V);
          vec3 H2 = normalize(uL2 + V);
          float t1 = dot(Tv, H1);
          float t2 = dot(Tv, H2);
          float s1 = max(1.0 - t1 * t1, 0.0);
          float s2 = max(1.0 - t2 * t2, 0.0);
          // s1, s2 are clamped >= 0 above: pow never sees a negative base
          float k1 = pow(s1, 36.0) * 0.16 * uSheen + pow(s1, 320.0) * 1.35;
          float k2 = pow(s2, 30.0) * 0.1 * uSheen + pow(s2, 260.0) * 0.7;
          float lit1 = smoothstep(-0.1, 0.4, dot(Nv, uL1));
          float lit2 = smoothstep(-0.1, 0.4, dot(Nv, uL2));
          // fine grooves shimmer until they get too fine to resolve
          float fg = r * gd;
          float aa = 1.0 - smoothstep(0.6, 1.6, gvFineW);
          float fine = 1.0 + 0.28 * sin(fg) * aa;
          outgoingLight += (uC1 * k1 * lit1 + uC2 * k2 * lit2) * gvAniso * gvBand * fine * uSpec;
        }
        #include <opaque_fragment>`,
      )
  }
  return { material: m, uniforms: u }
}

const _m3 = new THREE.Matrix4()
/** view-space light directions for the groove highlights (call per draw) */
export function writeRecordLights(u: RecordUniforms, camera: THREE.Camera) {
  _m3.copy(camera.matrixWorldInverse)
  u.uL1.value.copy(VINYL_LIGHTS.key).transformDirection(_m3)
  u.uL2.value.copy(VINYL_LIGHTS.rim).transformDirection(_m3)
}

// ─── crate ──────────────────────────────────────────────────────────────────

export function crateMaterial(C: CrateDims = crateDims(), color: THREE.ColorRepresentation = 0x141416) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.46, metalness: 0.55 })
  m.customProgramCacheKey = () => 'gv-crate'
  const u = { uCrate: { value: new THREE.Vector4(C.inner, C.zBack + C.wall, C.zFront - C.wall, C.y0) } }
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aChamfer;
        varying float vCh;
        varying vec3 vCPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vCh = aChamfer;
        vCPos = position;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        ${NOISE_GLSL}
        varying float vCh;
        varying vec3 vCPos;
        uniform vec4 uCrate;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // interior faces darken toward the floor and the corners
        float inside = step(abs(vCPos.x), uCrate.x + 0.002) * step(uCrate.y - 0.002, vCPos.z) * step(vCPos.z, uCrate.z + 0.002);
        float ao = mix(1.0, mix(0.45, 1.0, smoothstep(uCrate.w, uCrate.w + 0.4, vCPos.y)), inside);
        diffuseColor.rgb *= ao * (0.94 + 0.06 * wkN(vCPos.xz * 140.0 + vCPos.y * 90.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.6, 0.62), vCh);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.2, vCh);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 1.0, vCh);`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        // the polished edges mirror the studio's HDR bulb row: cap them just under
        // the bloom threshold so they read as bright metal, not a glowing halo
        outgoingLight = mix(outgoingLight, min(outgoingLight, vec3(0.85)), vCh);
        #include <opaque_fragment>`,
      )
  }
  return m
}

/**
 * Contact shadow for a rounded rectangle footprint (XZ, in the quad's own
 * local space): tight contact line, soft ambient falloff, and a cast lobe
 * pushed away from the key. Put it on the floor under a crate or turntable.
 */
export function shadowMaterial(halfSize: THREE.Vector2, radius: number, strength = 1) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uHalf: { value: halfSize },
      uR: { value: radius },
      uOff: { value: new THREE.Vector2(0.16, -0.12) },
      uStrength: { value: strength },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uHalf, uOff;
      uniform float uR, uStrength;
      varying vec2 vP;
      float sdRB(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main() {
        float d = sdRB(vP, uHalf, uR);
        float contact = 1.0 - smoothstep(-0.02, 0.03, d);
        float ao = 1.0 - smoothstep(-0.08, 0.34, d);
        float castS = 1.0 - smoothstep(-0.2, 0.62, sdRB(vP - uOff, uHalf * 1.04, uR + 0.12));
        float a = contact * 0.62 + ao * ao * 0.36 + castS * 0.24;
        gl_FragColor = vec4(vec3(0.05, 0.035, 0.03), clamp(a, 0.0, 0.9) * uStrength);
      }
    `,
  })
}

// ─── turntable ──────────────────────────────────────────────────────────────

export interface PlatterUniforms {
  /** strobe row phases (radians, platter-local), rows 0/1 */
  uStrobe: { value: THREE.Vector2 }
  /** dots per row */
  uDots: { value: THREE.Vector2 }
  /** (outer radius, top y, bottom y) of the platter */
  uPl: { value: THREE.Vector3 }
}

/**
 * Brushed aluminium platter with two rows of strobe dots on its rim. The dots
 * are drawn at platter angle + row phase, so a row whose phase cancels the
 * spin holds still in the world ("locked") — the turntable drives it.
 */
export function platterMaterial(R: number, yTop: number, yBot: number, dots: [number, number]) {
  const u: PlatterUniforms = {
    uStrobe: { value: new THREE.Vector2() },
    uDots: { value: new THREE.Vector2(dots[0], dots[1]) },
    uPl: { value: new THREE.Vector3(R, yTop, yBot) },
  }
  const m = new THREE.MeshStandardMaterial({ color: '#c3c6ca', metalness: 1, roughness: 0.3 })
  m.customProgramCacheKey = () => 'gv-platter'
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPP;\nvarying vec3 vPN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPP = position;\nvPN = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        ${NOISE_GLSL}
        varying vec3 vPP;
        varying vec3 vPN;
        uniform vec2 uStrobe, uDots;
        uniform vec3 uPl;
        float gvDot = 0.0;
        float gvSide = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float pr = length(vPP.xz);
        float pa = atan(vPP.z, vPP.x);
        gvSide = (1.0 - step(0.45, abs(vPN.y))) * step(uPl.x - 0.02, pr);
        // the rim: two rows of machined dots between polished bands
        float h = (vPP.y - uPl.z) / (uPl.y - uPl.z);
        float dots = 0.0;
        for (int i = 0; i < 2; i++) {
          float n = i == 0 ? uDots.x : uDots.y;
          float ph = i == 0 ? uStrobe.x : uStrobe.y;
          float yc = i == 0 ? 0.68 : 0.36;
          float cell = fract((pa + ph) * n / 6.2831853) - 0.5;
          float dx = cell * 6.2831853 * uPl.x / n;
          float dy = (h - yc) * (uPl.y - uPl.z);
          float rr = 0.0058 * 0.5;
          float d = length(vec2(dx, dy * 1.05));
          float aaw = fwidth(d) + 1e-5;
          dots = max(dots, 1.0 - smoothstep(rr - aaw, rr + aaw, d));
        }
        gvDot = dots * gvSide;
        // brushed: fine circular streaks on the top ring, vertical lay on the rim
        float streak = gvSide > 0.5 ? wkN(vec2(pa * 900.0, h * 6.0)) : wkN(vec2(pr * 1400.0, pa * 3.0));
        diffuseColor.rgb *= 0.9 + 0.12 * streak;
        // the dot rows sit in a darker satin band; dots are bright polished
        float bandY = smoothstep(0.2, 0.24, h) * (1.0 - smoothstep(0.84, 0.88, h));
        diffuseColor.rgb *= mix(1.0, 0.62, bandY * gvSide);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.97, 0.95), gvDot);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, gvDot);`,
      )
  }
  return { material: m, uniforms: u }
}

let veneer: THREE.CanvasTexture | null = null
/** walnut veneer (tileable along x, 1024 x 256): straight grain + a cathedral figure */
export function walnutMap(): THREE.Texture {
  if (veneer) return veneer
  const w = 1024
  const h = 256
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  g.fillStyle = '#4a2c1a'
  g.fillRect(0, 0, w, h)
  let seed = 23
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 220; i++) {
    const y0 = rnd() * h
    const a = 0.04 + rnd() * 0.14
    g.strokeStyle = rnd() > 0.45 ? `rgba(26,12,6,${a})` : `rgba(122,76,44,${a})`
    g.lineWidth = 0.5 + rnd() * 2.2
    g.beginPath()
    const f = (Math.PI * 2 * (1 + Math.floor(rnd() * 3))) / w
    const ph = rnd() * 6
    const amp = 2 + rnd() * 9
    for (let x = 0; x <= w; x += 8) {
      // cathedral arches: the grain bows around a centre line
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.25
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  // pores
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = `rgba(18,8,4,${0.08 + rnd() * 0.18})`
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 5, 0.8)
  }
  veneer = new THREE.CanvasTexture(cv)
  veneer.colorSpace = THREE.SRGBColorSpace
  veneer.wrapS = veneer.wrapT = THREE.RepeatWrapping
  veneer.anisotropy = 8
  return veneer
}

/** Shared turntable finishes (one instance each: plain meshes only). */
export function turntableMaterials(finish: 'walnut' | 'black') {
  const plinth =
    finish === 'walnut'
      ? new THREE.MeshPhysicalMaterial({ map: walnutMap(), roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.22, color: '#ffffff' })
      : new THREE.MeshPhysicalMaterial({ color: '#0e0d0d', roughness: 0.48, metalness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.4 })
  return {
    plinth,
    deck: new THREE.MeshPhysicalMaterial({ color: '#141416', metalness: 0.35, roughness: 0.52, anisotropy: 0.4, clearcoat: 0.18, clearcoatRoughness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#c4c7cb', metalness: 1, roughness: 0.17 }),
    satin: new THREE.MeshStandardMaterial({ color: '#b8bbbf', metalness: 1, roughness: 0.32 }),
    black: new THREE.MeshStandardMaterial({ color: '#111112', metalness: 0.3, roughness: 0.42 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#0b0b0b', metalness: 0, roughness: 0.88 }),
    felt: new THREE.MeshStandardMaterial({ color: '#141314', metalness: 0, roughness: 0.96 }),
    cart: new THREE.MeshPhysicalMaterial({ color: '#b3161d', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    pilot: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a').multiplyScalar(3.2), toneMapped: true }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(2.2) }),
  }
}
