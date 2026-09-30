import type * as THREE from 'three'

/*
 * TEXTURE BUDGET (site-wide; review3 P04). Everything used to stay on the GPU
 * for the whole session: ~600 MB of textures on a desktop, ~400 MB on a phone
 * after visiting every chapter, which is close to iOS's WebContent limit (a
 * context loss reloads the page). The policy:
 *
 *  1. SIZE — ask `ctx.texRes(px)` for every art / photo / canvas size: it caps
 *     at TEX_CAP (1024 desktop, 512 phones). A full-frame subject may ask for
 *     `ctx.texRes(px, 2)`. Budget: ~250 MB of textures on phones.
 *  2. FREE THE SOURCE after the final upload (kit/images.ts loadScreenshot and
 *     kit/vinyl artTexture shrink their canvas in `texture.onUpdate`).
 *  3. RESIDENCY — a producer that can rebuild a texture registers it:
 *       reloadable(texture, () => redrawOrRedecodeInto(texture))
 *     (the callback puts fresh pixels in texture.image; the engine sets
 *     needsUpdate). The engine frees the GPU copy while every chapter using
 *     it is more than NEAR chapters from the one on screen (and it isn't
 *     shared with a nearer chapter or the world), and calls the reload as a
 *     chapter using it comes back within NEAR, or a nav jump heads there —
 *     seconds ahead at any scroll speed. Unregistered textures stay resident.
 *     The scene is only walked when the chapter window changes AND something
 *     is registered (a walk costs ~1.5 ms desktop, ~9 ms on a slow phone).
 */

/** max texture edge for art / photos / canvases: desktop, phones */
export const TEX_CAP = { desktop: 1024, mobile: 512 } as const
/** chapters within this many of the one on screen keep their textures on the GPU */
export const NEAR = 2

type Reload = () => Promise<void> | void
const registry = new Map<THREE.Texture, Reload>()

/** Register a texture its producer can rebuild (see RESIDENCY above). Returns the texture. */
export function reloadable<T extends THREE.Texture>(texture: T, reload: Reload): T {
  registry.set(texture, reload)
  texture.addEventListener('dispose', function forget() {
    // disposed by its owner (not by the residency): stop tracking it
    if (!Residency.evicting) {
      registry.delete(texture)
      texture.removeEventListener('dispose', forget)
    }
  })
  return texture
}

/** material slots that can hold a texture (three r186), plus ShaderMaterial uniforms */
const SLOTS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap', 'lightMap', 'metalnessMap',
  'normalMap', 'roughnessMap', 'specularMap', 'gradientMap', 'matcap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap',
  'specularColorMap', 'specularIntensityMap', 'thicknessMap', 'transmissionMap', 'anisotropyMap',
] as const

/** the registered textures a subtree's materials reference */
function registeredIn(root: THREE.Object3D, out: Set<THREE.Texture>) {
  const add = (v: unknown) => {
    if (v && registry.has(v as THREE.Texture)) out.add(v as THREE.Texture)
  }
  root.traverse(obj => {
    const m = (obj as THREE.Mesh).material
    if (!m) return
    for (const mat of Array.isArray(m) ? m : [m]) {
      const rec = mat as unknown as Record<string, unknown>
      for (const k of SLOTS) add(rec[k])
      const u = (mat as THREE.ShaderMaterial).uniforms
      if (u) for (const k in u) add(u[k]?.value)
    }
  })
  return out
}

export class Residency {
  /** true while the residency itself disposes a texture (it stays registered) */
  static evicting = false
  private evicted = new Set<THREE.Texture>()
  private pending = new Set<THREE.Texture>()
  private lastKey = ''

  constructor(private renderer: THREE.WebGLRenderer) {}

  /**
   * Call once a frame; it only acts when the chapter window changes.
   * `groups()` lists the chapters' groups in story order, `active` is the
   * chapter on screen, `target` a nav jump's destination or -1.
   */
  update(groups: () => THREE.Object3D[], world: THREE.Object3D, active: number, target: number) {
    const key = `${active}|${target}|${registry.size}`
    if (key === this.lastKey) return
    this.lastKey = key
    if (!registry.size) return
    const near = (i: number) => Math.abs(i - active) <= NEAR || (target >= 0 && Math.abs(i - target) <= 1)
    const keep = registeredIn(world, new Set())
    const far = new Set<THREE.Texture>()
    groups().forEach((g, i) => registeredIn(g, near(i) ? keep : far))
    // back within range (or a jump heads there): rebuild what was freed
    for (const t of this.evicted) {
      if (!keep.has(t) || this.pending.has(t)) continue
      this.pending.add(t)
      Promise.resolve()
        .then(() => registry.get(t)?.())
        .catch(err => console.warn('[hark] texture reload failed', err))
        .finally(() => {
          this.pending.delete(t)
          this.evicted.delete(t)
          t.needsUpdate = true
          // upload now, one texture per finished reload, not all at once on
          // the frame the chapter first shows
          try {
            this.renderer.initTexture(t)
          } catch {
            /* uploads on first use instead */
          }
        })
    }
    // out of range everywhere it's used: free the GPU copy (the reload rebuilds it)
    const p = this.renderer.properties
    for (const t of far) {
      if (keep.has(t) || this.evicted.has(t)) continue
      // only what is actually on the GPU (three keeps its handle in properties)
      if (!p.has(t) || !(p.get(t) as { __webglInit?: boolean }).__webglInit) continue
      Residency.evicting = true
      t.dispose()
      Residency.evicting = false
      this.evicted.add(t)
    }
  }
}
