import * as THREE from 'three'
import type { Chapter } from '../core/types'
import { el, rise, setRise, reveal } from '../core/dom'
import { smoothstep } from '../core/math'
import { makeGlass, BEERS, type BeerStyle } from '../kit/beer'
import { makeBarTop } from '../kit/bar'

/*
 * PLACEHOLDER scene shared by the scaffold's chapters: one glass on the bar
 * in the studio light, with the chapter's eyebrow + headline. Each chapter's
 * build replaces its own index.ts; this file goes away once none import it.
 */
export function placeholder(id: string, eyebrow: string, title: string, beer: BeerStyle = BEERS.amber, anchors: number[] = []): Chapter {
  const group = new THREE.Group()
  const bar = makeBarTop({ length: 16, depth: 4 })
  const g = makeGlass({ shape: 'tulip', beer, scale: 2.2 })
  group.add(bar, g.group)
  let copy: HTMLElement, h: HTMLElement
  return {
    id,
    group,
    anchors,
    init(ctx) {
      copy = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', eyebrow, copy)
      h = rise(el('h2', id === 'hero' ? 'hud-title' : 'hud-h2', undefined, copy), title)
    },
    update(local, frame, ctx) {
      g.group.rotation.y = frame.time * 0.15
      g.setFill(0.35 + 0.6 * smoothstep(0.05, 0.5, local))
      g.setHead(0.08 + 0.06 * smoothstep(0.3, 0.6, local))
      reveal(copy, smoothstep(0.03, 0.08, local) * (1 - smoothstep(0.93, 0.97, local)))
      setRise(h, local > 0.04 && local < 0.95)
      const w = ctx.world.params
      w.spot = 1
      w.spotPos.set(3, 9, 6)
      w.spotAt.set(0, 1, 0)
      w.rimA = 1.2
      w.rimB = 0.8
      w.rimADir.set(-0.8, 0.4, -1)
      w.rimBDir.set(0.9, 0.3, -1)
      w.fill = 0.25
    },
    camera(local, frame, out) {
      const portrait = frame.height > frame.width
      const d = portrait ? 9 : 6.5
      out.position.set(portrait ? 0 : -1.8 + local * 0.6, 2.4, d)
      out.target.set(portrait ? 0 : -1.2, 1.3, 0)
      out.fov = 35
      out.parallax = 0.2
    },
  }
}
