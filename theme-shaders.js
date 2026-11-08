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

export const THEME_FRAGMENTS = { liquid: LIQUID_FRAGMENT, neon: NEON_FRAGMENT, paper: PAPER_FRAGMENT };
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
