import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { smoothstep } from '../../core/math'
import { CITY_WIDE, SECTIONS } from '../../content'

// PLACEHOLDER — replaced by the City Wide build (the can, the shot, the cheese on the bar).
export default function create(): Chapter {
  const group = new THREE.Group()
  let copy: HTMLElement, h: HTMLElement
  return {
    id: 'citywide',
    group,
    init(ctx) {
      copy = el('div', 'ph-copy', undefined, ctx.stage)
      el('p', 'hud-eyebrow', SECTIONS.citywide.eyebrow, copy)
      h = rise(el('h2', 'hud-h2', undefined, copy), 'City Wide <em>Special</em>')
      el('p', 'hud-body', CITY_WIDE.line, copy)
    },
    update(local) {
      reveal(copy, smoothstep(0.05, 0.1, local) * (1 - smoothstep(0.93, 0.97, local)))
      setRise(h, local > 0.06 && local < 0.95)
    },
    camera(_l, _f, out) {
      out.position.set(0, 2, 7)
      out.target.set(0, 1, 0)
      out.fov = 35
      out.parallax = 0.1
    },
  }
}
