import * as THREE from 'three'
import type { Frame } from '../core/types'
import { nextFrame } from '../core/yield'

/*
 * The shared world for GLORY: a product film shot in a beer bar. Resonance's
 * photo studio (a bone-white cyclorama, softbox strips, liquid highlights)
 * crossed with Glory's own room (exposed brick, Edison bulbs, a long bar).
 *
 *  - BACKDROP (a camera-centred dome): a vertical gradient (top/bottom), a
 *    soft STUDIO POOL of light behind the subject (cyc/cycColor/cycX/cycY: the
 *    product-shot sweep), GLORY'S ROOM out of focus (room/walnutColor/
 *    ceilingColor: the real bar from Mike's photos — a BLACK CEILING with
 *    long galvanized trunk ducts, reclaimed-walnut walls with boxy clad columns and a
 *    warm sconce pool on each), an out-of-focus BRICK accent (world-anchored
 *    running bond with dark mortar: panels between the columns while `room`
 *    is up, the whole wall when it's 0), a low band of HAZE, wire-cage EDISON
 *    PENDANTS hanging from the ceiling (`bulbs`; `strings` 1 brings back the
 *    old swagged strands), BOKEH of far lights. Beams exist but are off by
 *    default.
 *  - THE SPOT (the ONLY shadow caster): a key light from above and in front.
 *    Chapters aim it every frame (spotPos → spotAt, cone angle). Give props
 *    castShadow / receiveShadow yourself; keep tiny props from casting.
 *  - TWO RIM LIGHTS (no shadows): camera-relative directions (rimADir /
 *    rimBDir: x right, y up, z toward the camera — negative z is BEHIND the
 *    subject), colours rimA/rimB. Rims are what make glass and beer glow.
 *  - FILL: a low warm hemisphere.
 *  - ROOM REFLECTIONS (PMREM, built a frame after construction — so the
 *    loader paints first — or on first use of `envMap`): Glory's room as a
 *    reflection — Edison pendants hanging from a black ceiling, the tall
 *    black-framed front windows on Chestnut Street (the long highlights on
 *    stainless and glass), the glowing back bar (a warm band at bar height),
 *    walnut walls with sconces, a warm floor — so taps, glassware and the
 *    beer's meniscus reflect the bar, not a studio. Sweep with envTurn.
 *
 * Keep what the engine calls: `object`, `params`, `resetParams()`,
 * `update(frame, camera)`, `warmEnv()`, `envMap`. Chapters set params every
 * frame they care; the engine resets them first; values are damped.
 */

export interface WorldParams {
  /** backdrop gradient (keep near black) */
  top: THREE.ColorRepresentation
  bottom: THREE.ColorRepresentation
  /** 0..1.5 the studio pool: a soft light on the backdrop behind the subject, its colour and screen centre (-1..1) */
  cyc: number
  cycColor: THREE.ColorRepresentation
  cycX: number
  cycY: number
  /** 0..1 out-of-focus brick in the backdrop, its colour (with `room` up: panels between the columns) */
  brick: number
  brickColor: THREE.ColorRepresentation
  /** 0..1.5 Glory's room in the backdrop: black ceiling + duct, walnut walls, clad columns with sconce pools */
  room: number
  /** the walnut's lit colour (keep it dim: it's out of focus behind the subject) */
  walnutColor: THREE.ColorRepresentation
  /** the ceiling paint (near black) */
  ceilingColor: THREE.ColorRepresentation
  /** 0..1.5 backlit smoke behind the subject, its colour and screen height (-1..1) */
  haze: number
  hazeColor: THREE.ColorRepresentation
  hazeY: number
  /** 0..1.5 stage beams through the haze, their two gel colours, 0..1 sway */
  beams: number
  beamA: THREE.ColorRepresentation
  beamB: THREE.ColorRepresentation
  sway: number
  /** 0..1.5 Edison bulbs out of focus (world-anchored pendants hanging from the ceiling) and their colour */
  bulbs: number
  bulbColor: THREE.ColorRepresentation
  /** 0..1 the bulbs as the old swagged strands instead of pendants (0 = pendants, the real room) */
  strings: number
  /** 0..1.5 out-of-focus far lights (world-anchored) and their gels */
  bokeh: number
  bokehA: THREE.ColorRepresentation
  bokehB: THREE.ColorRepresentation
  /** the follow spot: intensity, colour, where it hangs, what it hits, cone (radians), penumbra 0..1 */
  spot: number
  spotColor: THREE.ColorRepresentation
  spotPos: THREE.Vector3
  spotAt: THREE.Vector3
  spotAngle: number
  spotPenumbra: number
  /** rim lights (camera-relative directions they come FROM) */
  rimA: number
  rimAColor: THREE.ColorRepresentation
  rimADir: THREE.Vector3
  rimB: number
  rimBColor: THREE.ColorRepresentation
  rimBDir: THREE.Vector3
  /** hemisphere fill */
  fill: number
  /** stage reflections strength and yaw (sweep the PAR row across lacquer) */
  env: number
  envTurn: number
}

/** The gels: the palette of stage light every chapter draws from. */
export const GEL = {
  /** Glory red (the sign, the G roundel) */
  glory: '#d8272e',
  /** beer */
  amber: '#e89a2c',
  straw: '#f2c45a',
  stout: '#1a0d07',
  /** foam, cyclorama, cream */
  cream: '#f3ead8',
  bone: '#ece6da',
  brick: '#7a3524',
  tungsten: '#ffc88a',
  bulb: '#ffb45e',
  candle: '#ff9a3c',
  dusk: '#6f8fc4',
  red: '#ff3a26',
  oxblood: '#9a1f16',
  magenta: '#ff3d7a',
  steel: '#8fb0ff',
  white: '#fff4e6',
}

export const WORLD_DEFAULTS = {
  top: '#0c0807',
  bottom: '#050302',
  cyc: 0.5,
  cycColor: '#5a2e1c',
  cycX: 0.25,
  cycY: 0.05,
  brick: 0.55,
  brickColor: '#3a1a12',
  room: 0.85,
  walnutColor: '#4a2a16',
  ceilingColor: '#060505',
  haze: 0.25,
  hazeColor: '#9a5a2e',
  hazeY: -0.15,
  beams: 0,
  beamA: GEL.amber,
  beamB: GEL.tungsten,
  sway: 0.3,
  bulbs: 0.8,
  bulbColor: GEL.bulb,
  strings: 0,
  bokeh: 0.2,
  bokehA: GEL.amber,
  bokehB: GEL.candle,
  spot: 0,
  spotColor: GEL.tungsten,
  spotAngle: 0.42,
  spotPenumbra: 0.55,
  rimA: 0,
  rimAColor: GEL.amber,
  rimB: 0,
  rimBColor: GEL.dusk,
  fill: 0.1,
  env: 1,
  envTurn: 0,
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uCycC, uBrickC, uWalnutC, uCeilC;
  uniform float uCyc, uCycX, uCycY, uBrick, uRoom, uStrings;
  uniform vec3 uTop, uBottom, uHazeC, uBeamA, uBeamB, uBokehA, uBokehB, uBulbC;
  uniform float uHaze, uHazeY, uBeams, uSway, uBokeh, uBulbs, uTime, uMobile;
  uniform vec2 uRes;
  varying vec3 vDir;

  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  // PBR Neutral pre-cancel (as in the room kit): lift by the toe's inverse offset
  // so the out-of-focus walnut keeps its brown instead of crushing to orange
  vec3 untoe(vec3 c, float k) {
    c = max(c, vec3(0.0));
    float m = min(c.r, min(c.g, c.b));
    float l = m < 0.04 ? 0.4 * sqrt(m) - m : 0.04;
    return c + l * k;
  }
  float smoke(vec2 p) {
    float t = uTime * 0.035;
    float n = noise(p * 1.3 + vec2(t, -t * 0.6)) * 0.55;
    n += noise(p * 2.7 - vec2(t * 1.4, t * 0.3)) * 0.3;
    n += noise(p * 5.3 + vec2(-t, t * 2.0)) * 0.15;
    return n;
  }

  void main() {
    vec3 dir = normalize(vDir);
    // screen space (aspect-corrected, y up)
    vec2 s = gl_FragCoord.xy / uRes * 2.0 - 1.0;
    float aspect = uRes.x / uRes.y;
    s.x *= aspect;

    vec3 c = mix(uBottom, uTop, smoothstep(-1.1, 1.0, s.y));
    float sm = smoke(s * 0.9 + dir.xz * 0.6);

    // GLORY'S ROOM (out of focus, direction-anchored): a walnut-clad wall on a
    // cylinder around the camera — boxy columns with wide vertical boards and a
    // warm sconce pool, horizontal planks between — under a black ceiling with
    // galvanized trunk duct. Metres on the wall: x along it, y above the eye.
    float roomBay = 0.0;
    float roomCol = 0.0;
    float roomY = 0.0;
    float roomX = 0.0;
    if (uRoom > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      float R = 8.0;
      roomX = phi * R;
      roomY = tan(clamp(el, -1.25, 1.25)) * R;
      float bayW = 3.4;
      float bx = mod(roomX + 0.9, bayW) - bayW * 0.5;
      float bayId = floor((roomX + 0.9) / bayW);
      roomCol = 1.0 - smoothstep(0.3, 0.4, abs(bx));
      roomBay = bayId;
      // planks: ~14 cm boards, long (2.6 m between staggered butt joints); soft seams (defocus)
      float bh = 0.14;
      float row = floor(roomY / bh);
      float fy = fract(roomY / bh);
      float seg = floor(roomX / 2.6 + hash(vec2(row, 7.0)) * 3.0);
      float tone = hash(vec2(row, seg));
      float seamY = 1.0 - smoothstep(0.0, 0.34, min(fy, 1.0 - fy));
      // columns: vertical boards ~20 cm, darker returns at the edges
      float vb = floor((bx + 0.4) / 0.2);
      float ctone = hash(vec2(vb, bayId + 3.0));
      float seamX = 1.0 - smoothstep(0.0, 0.3, min(fract((bx + 0.4) / 0.2), 1.0 - fract((bx + 0.4) / 0.2)));
      float t = mix(tone, ctone, roomCol);
      float seam = mix(seamY, seamX, roomCol);
      // one walnut family: boards differ by ±12 %, never a patchwork
      vec3 wal = uWalnutC * (0.86 + 0.26 * t) * (1.0 - 0.16 * seam);
      wal *= mix(1.0, 1.0 - 0.5 * smoothstep(0.24, 0.38, abs(bx)), roomCol);
      // light: each column's sconce throws a pool; the wall falls off upward
      vec2 sp = vec2(bx, roomY - 0.55);
      float pool = exp(-dot(sp, sp * vec2(1.6, 0.7)) * 1.4);
      float fall = mix(1.0, 0.35, smoothstep(0.2, 2.0, roomY)) * mix(0.55, 1.0, smoothstep(-2.4, -0.6, roomY));
      wal = wal * fall + uWalnutC * pool * (1.1 + 0.6 * roomCol);
      // the sconce itself, a small hot core on the column
      float sd = length(vec2(bx, roomY - 0.62) * vec2(1.0, 0.8));
      wal += uBulbC * exp(-sd * sd * 90.0) * 0.55;
      float ceilY = 2.1;
      float wallM = smoothstep(-3.2, -1.4, roomY) * (1.0 - smoothstep(ceilY - 0.12, ceilY + 0.05, roomY));
      wal = untoe(wal, 0.8);
      c = mix(c, wal, wallM * clamp(uRoom, 0.0, 1.0));
      c += wal * wallM * max(uRoom - 1.0, 0.0);
      // the ceiling: black paint, long straight galvanized trunk ducts tight under it (ref1)
      float ceilM = smoothstep(ceilY - 0.1, ceilY + 0.25, roomY);
      vec3 ceilc = uCeilC;
      if (dir.y > 0.05) {
        vec2 cp = dir.xz / dir.y * 2.3;
        for (int k = 0; k < 2; k++) {
          float fk = float(k);
          float zc = fk < 0.5 ? -2.6 : 3.4;
          float dz = abs(cp.y - zc);
          float hw = 0.34;
          // a flat underside with darker sides (defocused box section), joint flanges every ~1.2 m
          float inD = 1.0 - smoothstep(hw * 0.85, hw * 1.08, dz);
          float face = 1.0 - 0.45 * smoothstep(hw * 0.55, hw, dz);
          float fl = 1.0 - 0.2 * smoothstep(0.455, 0.49, abs(fract(cp.x / 1.2) - 0.5));
          vec3 galv = vec3(0.075, 0.077, 0.08) * face * fl + uWalnutC * 0.1 * face;
          ceilc = mix(ceilc, galv, inD * (1.0 - smoothstep(10.0, 22.0, length(cp))));
        }
      }
      c = mix(c, ceilc, ceilM * clamp(uRoom, 0.0, 1.0));
    }

    // BRICK: running bond seen out of focus, world-anchored (azimuth/elevation)
    if (uBrick > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      vec2 b = vec2(phi * 9.0, el * 22.0);
      float row = floor(b.y);
      b.x += mod(row, 2.0) * 0.5;
      vec2 cell = floor(b);
      vec2 f = fract(b);
      // soft mortar (out of focus): distance to the cell edge
      float edge = min(min(f.x, 1.0 - f.x) * 2.2, min(f.y, 1.0 - f.y));
      float mortar = 1.0 - smoothstep(0.0, 0.16, edge);
      float tone = 0.72 + 0.5 * hash(cell + 3.1) + 0.18 * (noise(b * vec2(1.3, 0.7)) - 0.5);
      vec3 bc = uBrickC * tone;
      bc = mix(bc, mix(uBrickC * 1.9 + vec3(0.03, 0.025, 0.02), uBrickC * 0.45, clamp(uRoom, 0.0, 1.0)), mortar * 0.55);
      // a painted-over, lime-washed patch here and there
      bc = mix(bc, uBrickC * 2.6, smoothstep(0.62, 0.9, noise(vec2(phi * 1.4, el * 2.0) + 4.0)) * 0.35);
      // with the room up, brick shows as panels between the columns (every other bay, over the counter)
      float panel = 1.0;
      if (uRoom > 0.001) {
        float inBay = (1.0 - roomCol) * step(0.5, mod(roomBay, 2.0));
        float band = smoothstep(-0.2, 0.1, roomY) * (1.0 - smoothstep(1.7, 1.95, roomY));
        panel = mix(1.0, inBay * band, clamp(uRoom, 0.0, 1.0));
      }
      c = mix(c, bc, uBrick * smoothstep(-0.55, -0.2, el) * panel);
    }

    // STUDIO POOL: the product-shot sweep of light on the backdrop
    if (uCyc > 0.001) {
      vec2 d = (s - vec2(uCycX * aspect, uCycY)) / vec2(1.25 * max(aspect, 1.0), 1.05);
      float pool = exp(-dot(d, d) * 1.6);
      c += uCycC * pool * uCyc;
    }

    // HAZE: a band of backlit smoke behind the subject
    if (uHaze > 0.001) {
      float band = exp(-(s.y - uHazeY) * (s.y - uHazeY) / 0.42);
      float side = exp(-s.x * s.x / (2.2 * aspect));
      c += uHazeC * uHaze * band * side * (0.35 + 0.9 * sm) * 0.42;
    }

    // BEAMS: fanned from sources above the frame, only visible in the smoke
    if (uBeams > 0.001) {
      float b = 0.0;
      vec3 bc = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float sx = (fi - 2.5) * 0.62 * aspect * 0.55;
        vec2 src = vec2(sx, 1.35);
        vec2 v = s - src;
        float ang = atan(v.x, -v.y);
        float aim = -sx * 0.32 + uSway * 0.22 * sin(uTime * 0.23 + fi * 1.7);
        float w = 0.055 + 0.02 * fract(fi * 0.37);
        float beam = exp(-(ang - aim) * (ang - aim) / (w * w));
        float fall = 1.0 / (1.0 + dot(v, v) * 0.55);
        float k = beam * fall * smoothstep(0.0, 0.3, -v.y);
        b += k;
        bc += k * (mod(fi, 2.0) < 1.0 ? uBeamA : uBeamB);
      }
      c += bc * uBeams * (0.25 + 0.95 * sm) * 0.34;
    }

    // BOKEH: out-of-focus truss lights, anchored to the world
    if (uBokeh > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      vec2 g = vec2(phi * 5.0, el * 5.0 - 0.4);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash(id + 7.1);
      if (id.y >= 0.0 && id.y <= 3.0 && h > 0.35) {
        vec2 o = vec2(hash(id + 1.3), hash(id + 5.9)) - 0.5;
        float r = mix(0.12, 0.26, hash(id + 3.3));
        float d = length(f - o * 0.25) / r;
        float disc = 1.0 - smoothstep(0.86, 1.0, d);
        float rim = smoothstep(0.7, 0.97, d) * disc;
        float bright = mix(0.4, 1.0, hash(id + 9.7)) * (0.85 + 0.15 * sin(uTime * 0.6 + h * 30.0));
        vec3 col = hash(id + 2.2) > 0.5 ? uBokehA : uBokehB;
        c += col * (disc * 0.55 + rim * 0.5) * bright * uBokeh * 0.5 * (1.0 - 0.25 * id.y / 3.0);
      }
    }

    // PENDANTS: wire-cage Edison bulbs hanging from the black ceiling, out of
    // focus — round bokeh discs with a hot filament core, a faint cage ring,
    // far ones smaller and dimmer. World-anchored on a grid over the room.
    if (uBulbs * (1.0 - uStrings) > 0.001 && dir.y > 0.015) {
      float hb = 1.25;
      vec2 p = dir.xz / dir.y * hb;
      vec2 cellSz = vec2(2.7, 3.1);
      vec2 cell = floor(p / cellSz);
      vec3 acc = vec3(0.0);
      for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
          vec2 id = cell + vec2(float(i), float(j));
          float h = hash(id + 17.0);
          if (h < 0.28) continue;
          vec2 o = vec2(hash(id + 1.7), hash(id + 4.3)) - 0.5;
          vec2 bxz = (id + 0.5 + o * 0.55) * cellSz;
          float by = hb + (hash(id + 8.1) - 0.5) * 0.5;
          vec3 B = vec3(bxz.x, by, bxz.y);
          float dist = length(B);
          if (dist < 2.2) continue;
          vec3 nb = B / dist;
          float rad = clamp(0.2 / dist, 0.006, 0.05);
          float d = length(dir - nb) / rad;
          float disc = 1.0 - smoothstep(0.8, 1.0, d);
          float ring = smoothstep(0.62, 0.8, d) * disc;
          float core = exp(-d * d * 7.0);
          float far = 1.0 / (1.0 + dist * 0.07);
          float flick = 0.95 + 0.05 * sin(uTime * 1.1 + h * 40.0);
          acc += (disc * 0.32 + ring * 0.12 + core * 1.05) * far * flick;
        }
      }
      c += uBulbC * acc * uBulbs * (1.0 - uStrings) * 0.7 * smoothstep(0.015, 0.08, dir.y);
    }

    // STRINGS (legacy): strands of warm bulbs in shallow swags, out of focus
    if (uBulbs * uStrings > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        // each strand: swags between posts every ~0.9 rad of azimuth
        float span = 0.9 + 0.25 * fk;
        float off = fk * 0.37;
        float u = (phi + off) / span;
        float sw = fract(u) - 0.5;
        float yEl = 0.34 + 0.13 * fk - 0.11 * (0.25 - sw * sw) * 4.0;
        // bulbs along the strand, evenly spaced
        float sp = 0.085 + 0.02 * fk;
        float bi = floor((phi + off * 0.5) / sp + 0.5);
        float bphi = bi * sp - off * 0.5;
        float bu = (bphi + off) / span;
        float bsw = fract(bu) - 0.5;
        float bEl = 0.34 + 0.13 * fk - 0.11 * (0.25 - bsw * bsw) * 4.0 - 0.012;
        vec2 dd = vec2((phi - bphi) * cos(el), el - bEl);
        float r = 0.02 + 0.012 * fk;
        float d = length(dd) / r;
        float disc = 1.0 - smoothstep(0.75, 1.0, d);
        float core = exp(-d * d * 5.0);
        float flick = 0.92 + 0.08 * sin(uTime * 1.3 + bi * 2.1 + fk);
        float far = 1.0 - 0.28 * fk;
        c += uBulbC * (disc * 0.45 + core * 0.9) * uBulbs * uStrings * flick * far * 0.55;
        // the wire, very faint
        c += uBulbC * 0.02 * uBulbs * uStrings * (1.0 - smoothstep(0.0, 0.0035, abs(el - yEl))) * far;
      }
    }

    c += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding
    gl_FragColor = vec4(c, 1.0);
  }
`

export class World {
  object = new THREE.Group()
  spot: THREE.SpotLight
  rimA: THREE.DirectionalLight
  rimB: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  params: WorldParams
  private dome: THREE.Mesh
  private scene: THREE.Scene
  private cur = {
    top: new THREE.Color(),
    bottom: new THREE.Color(),
    cycColor: new THREE.Color(),
    brickColor: new THREE.Color(),
    walnutColor: new THREE.Color(),
    ceilingColor: new THREE.Color(),
    hazeColor: new THREE.Color(),
    beamA: new THREE.Color(),
    beamB: new THREE.Color(),
    bokehA: new THREE.Color(),
    bokehB: new THREE.Color(),
    bulbColor: new THREE.Color(),
    spotColor: new THREE.Color(),
    rimAColor: new THREE.Color(),
    rimBColor: new THREE.Color(),
    spotPos: new THREE.Vector3(),
    spotAt: new THREE.Vector3(),
    n: {} as Record<string, number>,
  }
  private first = true
  private uniforms = {
    uCycC: { value: new THREE.Color() },
    uBrickC: { value: new THREE.Color() },
    uWalnutC: { value: new THREE.Color() },
    uCeilC: { value: new THREE.Color() },
    uRoom: { value: 0 },
    uStrings: { value: 0 },
    uCyc: { value: 0 },
    uCycX: { value: 0 },
    uCycY: { value: 0 },
    uBrick: { value: 0 },
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uHazeC: { value: new THREE.Color() },
    uBeamA: { value: new THREE.Color() },
    uBeamB: { value: new THREE.Color() },
    uBokehA: { value: new THREE.Color() },
    uBokehB: { value: new THREE.Color() },
    uBulbC: { value: new THREE.Color() },
    uBulbs: { value: 0 },
    uHaze: { value: 0 },
    uHazeY: { value: 0 },
    uBeams: { value: 0 },
    uSway: { value: 0 },
    uBokeh: { value: 0 },
    uTime: { value: 0 },
    uMobile: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  }
  private env: THREE.Texture | null = null
  private renderer: THREE.WebGLRenderer | null
  private tmpC = new THREE.Color()
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private fwd = new THREE.Vector3()

  constructor(scene: THREE.Scene, mobile: boolean, renderer?: THREE.WebGLRenderer) {
    this.scene = scene
    this.params = World.defaults()
    this.uniforms.uMobile.value = mobile ? 1 : 0

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    )
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    this.object.add(this.dome)

    // THE FOLLOW SPOT — the only shadow caster. Never toggle it: drive intensity.
    this.spot = new THREE.SpotLight(GEL.tungsten, 0, 0, 0.42, 0.55, 1.2)
    this.spot.castShadow = true
    this.spot.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
    this.spot.shadow.bias = -0.00025
    this.spot.shadow.normalBias = 0.012
    this.spot.shadow.radius = 2
    this.spot.shadow.camera.near = 0.5
    this.spot.shadow.camera.far = 80
    this.object.add(this.spot, this.spot.target)

    this.rimA = new THREE.DirectionalLight(GEL.amber, 0)
    this.rimB = new THREE.DirectionalLight(GEL.red, 0)
    this.object.add(this.rimA, this.rimA.target, this.rimB, this.rimB.target)
    // warm bulb light from above, walnut bounce from below
    this.hemi = new THREE.HemisphereLight(0xffd6b0, 0x2a150b, WORLD_DEFAULTS.fill)
    this.object.add(this.hemi)

    // the room reflections: built a frame from now, in two steps a frame apart (the
    // loader paints before this ~0.1–0.5 s of PMREM work), unless a chapter's init or
    // warmEnv() asks for them first — then they're built on the spot
    this.renderer = renderer ?? null
    scene.environmentIntensity = WORLD_DEFAULTS.env
    if (renderer) void this.buildEnvLater(renderer)
    else this.setEnv(new THREE.Texture())
  }

  /** stage reflections (PMREM); materials may use it directly (built on first use if not yet) */
  get envMap(): THREE.Texture {
    if (!this.env) this.setEnv(this.renderer ? pmremEnv(this.renderer, stageEnvScene()) : new THREE.Texture())
    return this.env!
  }

  private setEnv(t: THREE.Texture) {
    this.env = t
    this.scene.environment = t
  }

  private async buildEnvLater(renderer: THREE.WebGLRenderer) {
    await nextFrame()
    if (this.env) return
    const env = stageEnvScene()
    await nextFrame()
    if (this.env) disposeEnvScene(env)
    else this.setEnv(pmremEnv(renderer, env))
  }

  static defaults(): WorldParams {
    return {
      ...WORLD_DEFAULTS,
      spotPos: new THREE.Vector3(2, 14, 10),
      spotAt: new THREE.Vector3(0, 0, 0),
      rimADir: new THREE.Vector3(-0.8, 0.7, -1),
      rimBDir: new THREE.Vector3(0.9, 0.5, -1),
    }
  }

  /** the engine calls this before prewarm: lit programs key on the environment */
  warmEnv() {
    this.scene.environment = this.envMap
  }

  resetParams() {
    const p = this.params
    const spotPos = p.spotPos.set(2, 14, 10)
    const spotAt = p.spotAt.set(0, 0, 0)
    const a = p.rimADir.set(-0.8, 0.7, -1)
    const b = p.rimBDir.set(0.9, 0.5, -1)
    Object.assign(p, WORLD_DEFAULTS)
    p.spotPos = spotPos
    p.spotAt = spotAt
    p.rimADir = a
    p.rimBDir = b
  }

  update(frame: Frame, camera: THREE.Camera) {
    const p = this.params
    const c = this.cur
    const n = c.n
    const colors = ['top', 'bottom', 'cycColor', 'brickColor', 'walnutColor', 'ceilingColor', 'hazeColor', 'beamA', 'beamB', 'bokehA', 'bokehB', 'bulbColor', 'spotColor', 'rimAColor', 'rimBColor'] as const
    const nums = ['cyc', 'cycX', 'cycY', 'brick', 'room', 'strings', 'haze', 'hazeY', 'beams', 'sway', 'bokeh', 'bulbs', 'spot', 'spotAngle', 'spotPenumbra', 'rimA', 'rimB', 'fill', 'env', 'envTurn'] as const
    const k = this.first ? 1 : 1 - Math.exp(-5 * frame.dt)
    for (const key of colors) c[key].lerp(this.tmpC.set(p[key]), k)
    for (const key of nums) n[key] = this.first ? p[key] : n[key] + (p[key] - n[key]) * k
    // the spot's aim follows faster (it tracks a performer)
    const ks = this.first ? 1 : 1 - Math.exp(-9 * frame.dt)
    c.spotPos.lerp(p.spotPos, ks)
    c.spotAt.lerp(p.spotAt, ks)
    this.first = false

    const u = this.uniforms
    u.uTop.value.copy(c.top)
    u.uBottom.value.copy(c.bottom)
    u.uCycC.value.copy(c.cycColor)
    u.uBrickC.value.copy(c.brickColor)
    u.uCyc.value = n.cyc
    u.uCycX.value = n.cycX
    u.uCycY.value = n.cycY
    u.uBrick.value = n.brick
    u.uWalnutC.value.copy(c.walnutColor)
    u.uCeilC.value.copy(c.ceilingColor)
    // the room fades out as a chapter goes to the bone cyclorama (bright top/bottom)
    const lum = Math.max(c.top.r * 0.3 + c.top.g * 0.59 + c.top.b * 0.11, c.bottom.r * 0.3 + c.bottom.g * 0.59 + c.bottom.b * 0.11)
    u.uRoom.value = n.room * (1 - Math.min(1, Math.max(0, (lum - 0.05) / 0.25)))
    u.uStrings.value = Math.min(1, Math.max(0, n.strings))
    u.uHazeC.value.copy(c.hazeColor)
    u.uBeamA.value.copy(c.beamA)
    u.uBeamB.value.copy(c.beamB)
    u.uBokehA.value.copy(c.bokehA)
    u.uBokehB.value.copy(c.bokehB)
    u.uBulbC.value.copy(c.bulbColor)
    u.uBulbs.value = n.bulbs
    u.uHaze.value = n.haze
    u.uHazeY.value = n.hazeY
    u.uBeams.value = n.beams
    u.uSway.value = frame.reducedMotion ? 0 : n.sway
    u.uBokeh.value = n.bokeh
    u.uTime.value = frame.time
    u.uRes.value.set(frame.width, frame.height)

    // the dome follows the camera; the lights live in world space
    this.dome.position.copy(camera.position)

    const s = this.spot
    s.intensity = n.spot * 120
    s.color.copy(c.spotColor)
    s.angle = n.spotAngle
    s.penumbra = n.spotPenumbra
    s.position.copy(c.spotPos)
    s.target.position.copy(c.spotAt)
    s.target.updateMatrixWorld()
    // no shadow render while the spot is dark (the program keys stay the same)
    s.shadow.autoUpdate = n.spot > 0.002
    // fit the shadow depth range to the throw: with near 0.5 / far 80 the bias
    // swallowed occluders within ~0.4 units (strings 0.035 above the board)
    {
      const d = c.spotPos.distanceTo(c.spotAt)
      const near = Math.max(0.5, Math.round((d - 13) * 4) / 4)
      const far = Math.round((d + 22) * 4) / 4
      const sc = s.shadow.camera
      if (sc.near !== near || sc.far !== far) {
        sc.near = near
        sc.far = far
        sc.updateProjectionMatrix()
      }
    }

    // rim lights: directions relative to the camera's orientation
    camera.getWorldQuaternion(this.tmpQ)
    const fwd = camera.getWorldDirection(this.fwd)
    const rim = (l: THREE.DirectionalLight, dir: THREE.Vector3, amount: number, col: THREE.Color) => {
      l.intensity = amount * 3
      l.color.copy(col)
      this.tmpV.copy(dir).normalize().applyQuaternion(this.tmpQ)
      l.target.position.copy(camera.position).addScaledVector(fwd, 10)
      l.position.copy(l.target.position).addScaledVector(this.tmpV, 30)
      l.target.updateMatrixWorld()
    }
    rim(this.rimA, p.rimADir, n.rimA, c.rimAColor)
    rim(this.rimB, p.rimBDir, n.rimB, c.rimBColor)

    this.hemi.intensity = n.fill
    this.scene.environmentIntensity = n.env
    this.scene.environmentRotation.set(0, n.envTurn, 0)
  }
}

/**
 * Glory's room as a reflection (Mike's photos): a black ceiling hung with
 * Edison pendants (glassware catches them as rows of hot dots), the tall
 * black-framed front windows on Chestnut Street (the long highlights on
 * stainless and glass: two sashes of panes), the lit back bar (a warm band at
 * bar height: bottles glowing over the mirror), walnut walls with a sconce on
 * each column, a warm floor. Energy is kept close to the old studio so every
 * chapter's glass and steel still read.
 */
function stageEnvScene(): THREE.Scene {
  const env = new THREE.Scene()
  const room = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.MeshBasicMaterial({ map: roomEnvMap(), side: THREE.BackSide }))
  env.add(room)
  const lamp = (color: string, power: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) })
  // pendants: bulbs on cords at a few heights over the room
  const bulbGeo = new THREE.SphereGeometry(0.3, 12, 8)
  const bulbMat = lamp('#ffb45e', 16)
  const cordMat = lamp('#050404', 1)
  const cordGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 4)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2
    const r = 7 + rnd() * 16
    const y = 9 + rnd() * 5
    const b = new THREE.Mesh(bulbGeo, bulbMat)
    b.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
    env.add(b)
    const cord = new THREE.Mesh(cordGeo, cordMat)
    cord.scale.y = 17 - y
    cord.position.set(b.position.x, y + (17 - y) / 2, b.position.z)
    env.add(cord)
  }
  // sconces on the walnut walls (eye height)
  const sconceMat = lamp('#ffb060', 12)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3
    const b = new THREE.Mesh(bulbGeo, sconceMat)
    b.position.set(Math.cos(a) * 30, 3.5, Math.sin(a) * 30)
    env.add(b)
  }
  // the front windows: two tall sashes of panes, black mullions (the long highlights)
  const winMat = lamp('#fff3e4', 1)
  for (const [x, z, pw] of [
    [-16, 10, 3.0],
    [17, 4, 2.2],
  ] as [number, number, number][]) {
    const sash = new THREE.Group()
    const mat = winMat.clone()
    mat.color.multiplyScalar(pw)
    for (let cx = 0; cx < 2; cx++)
      for (let cy = 0; cy < 5; cy++) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 3.9), mat)
        pane.position.set((cx - 0.5) * 1.1, (cy - 2) * 4.3, 0)
        sash.add(pane)
      }
    sash.position.set(x, 3, z)
    sash.lookAt(0, 3, 0)
    env.add(sash)
  }
  // the back bar, lit: a long warm band at bar height (bottles over the mirror), a cooler's cool strip under it
  const backbar = new THREE.Mesh(new THREE.PlaneGeometry(34, 3.2), lamp('#ffb070', 1.35))
  backbar.position.set(0, 1.2, -24)
  backbar.lookAt(0, 1.2, 0)
  env.add(backbar)
  const coolers = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.2), lamp('#cfe6ff', 0.5))
  coolers.position.set(0, -2.4, -23.5)
  coolers.lookAt(0, -2.4, 0)
  env.add(coolers)
  // walnut bounce (was brick-red) + a faint dusk through the far glass
  const wash = (color: string, power: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 22), lamp(color, power))
    m.position.set(x, 2, z)
    m.lookAt(0, 2, 0)
    env.add(m)
  }
  wash('#7a4a2a', 0.42, -30, 4)
  wash('#6a3c22', 0.32, 30, 0)
  wash('#40567e', 0.1, 0, 32)
  // a soft warm overhead glow (the bulbs' light on the black ceiling; much dimmer than the old softbox)
  const soft = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), lamp('#ffe2c0', 0.9))
  soft.position.set(2, 22, 6)
  soft.lookAt(0, 0, 0)
  env.add(soft)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), lamp('#2e1a0c', 1))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -8
  env.add(floor)
  return env
}

/** the env scene → a PMREM texture (the scene is disposed) */
function pmremEnv(renderer: THREE.WebGLRenderer, env: THREE.Scene): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(env, 0.02)
  pmrem.dispose()
  disposeEnvScene(env)
  return rt.texture
}

function disposeEnvScene(env: THREE.Scene) {
  const mats = new Set<THREE.Material>()
  const geos = new Set<THREE.BufferGeometry>()
  env.traverse(o => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      geos.add(m.geometry)
      mats.add(m.material as THREE.Material)
    }
  })
  for (const g of geos) g.dispose()
  for (const m of mats) {
    ;(m as THREE.MeshBasicMaterial).map?.dispose()
    m.dispose()
  }
}

/**
 * The room band for the reflection sphere (equirect on the sphere's UVs):
 * black ceiling with a silver duct, walnut walls (planks, clad columns) around
 * the horizon, a dark warm floor. LDR: it's the bounce, the lamps are meshes.
 */
function roomEnvMap(): THREE.Texture {
  const W = 512
  const H = 256
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  // v = 1 at the top (canvas row 0)
  g.fillStyle = '#070605'
  g.fillRect(0, 0, W, H)
  // two ducts across the ceiling
  for (const y of [H * 0.12, H * 0.24]) {
    const gr = g.createLinearGradient(0, y - 7, 0, y + 7)
    gr.addColorStop(0, 'rgba(60,58,55,0)')
    gr.addColorStop(0.5, 'rgba(92,90,86,1)')
    gr.addColorStop(1, 'rgba(60,58,55,0)')
    g.fillStyle = gr
    g.fillRect(0, y - 7, W, 14)
  }
  // walnut band: planks + columns
  const y0 = Math.round(H * 0.36)
  const y1 = Math.round(H * 0.62)
  for (let y = y0; y < y1; y += 4) {
    let x = -rnd() * 60
    while (x < W) {
      const len = 30 + rnd() * 70
      const t = 0.6 + rnd() * 0.6
      g.fillStyle = `rgb(${Math.round(64 * t)},${Math.round(38 * t)},${Math.round(22 * t)})`
      g.fillRect(x, y, len, 3.4)
      x += len + 0.6
    }
  }
  for (let x = 20; x < W; x += 64) {
    g.fillStyle = 'rgba(96,60,34,0.8)'
    g.fillRect(x, y0, 9, y1 - y0)
    g.fillStyle = 'rgba(20,12,7,0.8)'
    g.fillRect(x + 9, y0, 2, y1 - y0)
  }
  const fl = g.createLinearGradient(0, y1, 0, H)
  fl.addColorStop(0, '#20140b')
  fl.addColorStop(1, '#120b06')
  g.fillStyle = fl
  g.fillRect(0, y1, W, H - y1)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
