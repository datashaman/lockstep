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

export const THEME_FRAGMENTS = { liquid: LIQUID_FRAGMENT, neon: NEON_FRAGMENT };
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
