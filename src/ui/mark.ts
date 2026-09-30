/*
 * The Glory brand for the DOM layer (chrome, loader, menu, rotate card,
 * fallback): the red G ROUNDEL and the WORDMARK.
 *
 * The roundel is the site icon (public/photos/g-roundel.png) redrawn as crisp
 * vector: a white disc, a thin Glory-red ring just inside its edge and a
 * heavy black geometric G — one closed contour (outer bowl, the flat stem
 * and crossbar at the right, the inner counter), so it never waits for a
 * font and stays sharp at any size. viewBox 0 0 100 100.
 */

/** the heavy G: outer bowl from the upper-right cut the long way round to the stem, the bar in, the counter back */
const G_PATH =
  'M73.75 30.07A31 31 0 1 0 81 50V45H51V57H63.27A15 15 0 1 1 61.49 40.36Z'

/**
 * Inline SVG for the roundel. With a title it is an image (role="img");
 * without, decorative (aria-hidden).
 */
export function roundelSvg(className = '', title?: string) {
  const a11y = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true" focusable="false"'
  return `<svg class="${className}" viewBox="0 0 100 100" ${a11y} xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="49" fill="#fffdf8"/><circle cx="50" cy="50" r="44.5" fill="none" stroke="#d8272e" stroke-width="3.4"/><path d="${G_PATH}" fill="#0d0806"/></svg>`
}

/**
 * The wordmark, after the painted wall sign: "Glory" in Alfa Slab One over
 * "Beer Bar & Kitchen" in small tracked mono caps. Reads as one name
 * ("Glory Beer Bar & Kitchen") for copy/paste and find-in-page. Styled by
 * the .wm rules in ui.css.
 */
export const WORDMARK = `<span class="wm"><span class="wm-a">Glory</span> <span class="wm-b">Beer Bar &amp; Kitchen</span></span>`
