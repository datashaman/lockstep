import { createMaterialShader } from './shader-renderer.js';
import { LIQUID_FRAGMENT } from './liquid-shader.js';

export const NEON_FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform float time;
uniform float energy;
uniform vec4 captures;
void main() {
  vec2 p = vec2(uv.x * 1.3333, uv.y);
  vec3 color = vec3(.012, .008, .035);
  float scan = .92 + .08 * sin(uv.y * 750.);
  for (int i = 0; i < 4; i++) {
    float x = .22 + float(i) * .30;
    vec3 tint = i == 0 ? vec3(1., .16, .38) : i == 1 ? vec3(1., .66, .08) : i == 2 ? vec3(.15, .9, .66) : vec3(.18, .6, 1.);
    float bend = sin(p.y * 4. + time + float(i)) * .045;
    float d = abs(p.x - x - bend);
    float beam = exp(-d * 100.) + exp(-d * 18.) * .22;
    float reflection = exp(-abs(p.x - x + bend) * 14.) * (1. - uv.y) * .18;
    float hit = 0.;
    if (captures[i] >= 0. && captures[i] < 1.6) {
      float age = captures[i];
      hit = exp(-abs(uv.y - .8 + age * .6) * 25.) * (1. - age / 1.6);
    }
    color += tint * (beam * (.14 + energy * .1) + reflection + hit * .3);
  }
  color *= scan;
  gl_FragColor = vec4(color, 1.);
}
`;

export const PAPER_FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform float time;
uniform float energy;
uniform vec4 captures;
float grain(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}
void main() {
  float fold = fract(uv.x * 5. + uv.y * .65);
  float slope = fold < .5 ? -1. : 1.;
  vec3 normal = normalize(vec3(slope * .45, .12, 1.));
  vec3 lamp = normalize(vec3(-.55 + sin(time) * .22, .65, .8));
  float light = .45 + max(0., dot(normal, lamp)) * .55;
  float shadow = .7 + .3 * smoothstep(0., .13, fold);
  float edge = exp(-abs(fold - .5) * 100.) * .1;
  float fiber = sin(uv.x * 630. + sin(uv.y * 120.) * 3.) * .015;
  float noise = (grain(floor(uv * vec2(320., 240.))) - .5) * .06;
  vec3 paper = mix(vec3(.12, .16, .20), vec3(.42, .34, .24), uv.y * .75 + .1);
  vec3 color = paper * light * shadow + edge + fiber + noise;
  for (int i = 0; i < 4; i++) {
    if (captures[i] >= 0. && captures[i] < 1.6) {
      float age = captures[i];
      vec2 delta = (uv - vec2(.2 + float(i) * .2, .65)) * vec2(1.333, 1.);
      float radius = .025 + sqrt(age) * .15;
      float ragged = grain(floor(uv * 90.)) * .025;
      float ink = (1. - smoothstep(radius - .02, radius + ragged, length(delta))) * (1. - age / 1.6);
      vec3 tint = i == 0 ? vec3(.36, .12, .09) : i == 1 ? vec3(.35, .26, .07) : i == 2 ? vec3(.06, .25, .18) : vec3(.12, .15, .3);
      color = mix(color, tint, ink * .55);
    }
  }
  color *= 1. + energy * .12;
  gl_FragColor = vec4(max(color, vec3(0.)), 1.);
}
`;

export const CIRCUIT_FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform float time;
uniform float energy;
uniform vec4 captures;
vec3 glass(float index) {
  if (index < 1.) return vec3(.75, .17, .32);
  if (index < 2.) return vec3(.8, .58, .15);
  if (index < 3.) return vec3(.13, .65, .43);
  return vec3(.22, .38, .8);
}
void main() {
  vec2 p = uv * vec2(6., 4.);
  vec2 cell = fract(p);
  float diagonal = abs(cell.x + cell.y - 1.) * .707;
  float seam = min(min(cell.x, 1. - cell.x), min(min(cell.y, 1. - cell.y), diagonal));
  float index = mod(floor(p.x) + floor(p.y) * 3., 4.);
  vec3 tint = glass(index);
  float facet = cell.x + cell.y < 1. ? .7 : 1.;
  float shimmer = .8 + .2 * sin(time + uv.x * 5. - uv.y * 3.);
  vec3 color = vec3(.015, .02, .055) + tint * facet * shimmer * .13 * smoothstep(.012, .05, seam);
  float trace = exp(-abs(seam - .055) * 160.);
  float travel = pow(.5 + .5 * sin((p.x + p.y) * 6.28318 - time * 4.), 12.);
  color += tint * trace * (.08 + travel * .24 + energy * .1);
  for (int i = 0; i < 4; i++) {
    float capture = 0.;
    if (captures[i] >= 0. && captures[i] < 1.6) {
      float age = captures[i];
      capture = (1. - age / 1.6) * exp(-abs(uv.y - .85 + age * .5) * 12.);
    }
    float beam = exp(-abs(uv.x - (.12 + float(i) * .25) + (1. - uv.y) * .18) * 24.);
    color += glass(float(i)) * beam * (.08 + capture * .7) * (.4 + .6 * uv.y);
    if (abs(index - float(i)) < .5) color += tint * capture * (trace * .5 + .09);
  }
  gl_FragColor = vec4(color, 1.);
}
`;

export const THEME_FRAGMENTS = { liquid: LIQUID_FRAGMENT, neon: NEON_FRAGMENT, paper: PAPER_FRAGMENT, circuit: CIRCUIT_FRAGMENT };
export function createThemeShader(makeCanvas) {
  const renderer = createMaterialShader(LIQUID_FRAGMENT, makeCanvas);
  if (!renderer) return null;
  return {
    select(key) { if (Object.hasOwn(THEME_FRAGMENTS, key)) renderer.setFragment(THEME_FRAGMENTS[key]); },
    render(key, seconds, captures, energy, reducedMotion) {
      if (!Object.hasOwn(THEME_FRAGMENTS, key)) return null;
      this.select(key); return renderer.render(seconds, captures, energy, reducedMotion);
    },
  };
}
