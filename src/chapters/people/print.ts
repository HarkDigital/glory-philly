import * as THREE from 'three'
import { placeholderTexture } from '../../kit/images'

/*
 * The prints and their glass.
 *
 * PRINT: the photo exactly as shot (grayscale portraits stay untouched: no
 * warping, no filters on the faces), "cover"-fitted to the print's aspect so a
 * mismatched file is cropped, never stretched. The only grading is the light
 * that falls on a print on a wall: a picture light's gentle top-to-bottom
 * falloff and the lamp's level (uLit), and a whisper of warm paper tone.
 *
 * GLASS: an additive, specular-only layer (never transmission: cheap) that
 * reflects two tall studio softbox strips. Its highlights are view-dependent,
 * so a strip slides across each glass as the camera glides past and clears it
 * when the camera settles in front of a print.
 */

export interface PrintMaterial {
  material: THREE.ShaderMaterial
  /** swap in a loaded photo (image aspect w/h) */
  setImage(tex: THREE.Texture, aspect: number): void
  /** 0..1 the photo fading in over the paper after it arrives */
  has: number
  loaded: boolean
}

export function makePrintMaterial(planeAspect: number, seed = 0): PrintMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: placeholderTexture('#1c1a18') },
      uCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHas: { value: 0 },
      uLit: { value: 1 },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec4 uCrop;
      uniform float uHas, uLit, uSeed;
      varying vec2 vUv;
      void main() {
        vec3 photo = texture2D(map, uCrop.xy + vUv * uCrop.zw).rgb;
        // unexposed paper until the photo arrives (a dark, even grey)
        vec3 paper = vec3(0.018, 0.017, 0.016);
        vec3 c = mix(paper, photo, uHas);
        // silver-gelatin paper: the faintest warm tone in the lights
        c *= vec3(1.0, 0.99, 0.965);
        // the picture light above: brighter at the top, a soft falloff down
        // and toward the sides (a real lamp on a real print)
        float dx = vUv.x - 0.5;
        float pl = mix(0.86, 1.03, smoothstep(0.0, 1.0, vUv.y)) * (1.0 - 0.22 * dx * dx);
        c *= uLit * pl;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const api: PrintMaterial = {
    material,
    has: 0,
    loaded: false,
    setImage(tex, aspect) {
      const crop = material.uniforms.uCrop.value as THREE.Vector4
      if (aspect > planeAspect) {
        const s = planeAspect / aspect
        crop.set((1 - s) / 2, 0, s, 1)
      } else {
        const s = aspect / planeAspect
        crop.set(0, (1 - s) / 2, 1, s)
      }
      material.uniforms.map.value = tex
      api.loaded = true
    },
  }
  return api
}

export interface GlintMaterial {
  material: THREE.ShaderMaterial
  /** overall strength of the reflections */
  set(amount: number): void
}

export function makeGlintMaterial(): GlintMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAmt: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmt;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, normalize(vN));
        // two tall softbox strips standing in the room, up high: left + right
        float up = smoothstep(-0.12, 0.2, R.y);
        float a = (R.x + 0.30) / 0.055;
        float b = (R.x - 0.40) / 0.035;
        float strips = exp(-a * a) * up + 0.55 * exp(-b * b) * up;
        // soft shoulders round each strip (the diffuser's glow)
        float a2 = (R.x + 0.30) / 0.16;
        strips += 0.12 * exp(-a2 * a2) * up;
        // a faint fixed sheen across the top-left corner (over the mat)
        float d = vUv.x + (1.0 - vUv.y) * 0.9;
        float sheen = smoothstep(0.05, 0.16, d) * (1.0 - smoothstep(0.16, 0.3, d));
        // glass is ~4% reflective head-on, more at grazing angles
        float fres = 0.04 + 0.96 * (1.0 - abs(dot(V, normalize(vN)))) * (1.0 - abs(dot(V, normalize(vN)))) * 0.5;
        vec3 col = vec3(1.0, 0.95, 0.88) * (strips * 0.2 + sheen * 0.022) * (0.6 + fres * 10.0) * uAmt;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  return {
    material,
    set(amount) {
      material.uniforms.uAmt.value = amount
    },
  }
}

/**
 * Load a photo as a texture WITHOUT changing its aspect (kit/images.ts
 * loadScreenshot resizes to 16:10, which would squash a portrait). Decoded off
 * the main thread where createImageBitmap exists; the canvas is shrunk after
 * upload. Resolves the texture and the image's aspect (w/h).
 */
export async function loadPhoto(url: string, maxW = 900): Promise<{ tex: THREE.Texture; aspect: number }> {
  let source: CanvasImageSource
  let sw: number
  let sh: number
  try {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    source = bmp
    sw = bmp.width
    sh = bmp.height
  } catch {
    const img = new Image()
    img.src = url
    await img.decode()
    source = img
    sw = img.naturalWidth
    sh = img.naturalHeight
  }
  const w = Math.min(maxW, sw)
  const h = Math.round((w * sh) / sw)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(source, 0, 0, w, h)
  if ('close' in source && typeof (source as ImageBitmap).close === 'function') (source as ImageBitmap).close()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.onUpdate = () => {
    c.width = c.height = 1
    tex.onUpdate = null
  }
  return { tex, aspect: sw / sh }
}
