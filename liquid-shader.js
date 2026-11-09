// @ts-check
import { createMaterialShader } from "./shader-renderer.js";

export const LIQUID_FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform float time;
uniform float energy;
uniform vec4 captures;
void main() {
  vec2 p = vec2(uv.x * 1.3333, uv.y);
  vec2 warp = vec2(sin(p.y * 7. + time), cos(p.x * 6. - time));
  p += warp * .09;
  for (int i = 0; i < 4; i++) {
    float age = captures[i];
    if (age >= 0. && age < 1.6) {
      vec2 delta = p - vec2(.27 + float(i) * .26, .67);
      float d = length(delta);
      float ring = sin(d * 55. - age * 10.) * exp(-pow(d - age * .23, 2.) * 90.);
      p += delta / max(d, .01) * ring * .025 * (1. - age / 1.6);
    }
  }
  float flow = sin(p.x * 8. + sin(p.y * 6. + time)) + cos(p.y * 9. - time * 2. + p.x * 3.);
  float veins = abs(sin(p.x * 13. + flow) * cos(p.y * 12. - flow + time));
  float caustic = pow(1. - veins, 12.);
  vec3 deep = vec3(.015, .045, .10);
  vec3 teal = vec3(.06, .36, .38);
  vec3 pearl = vec3(.56, .85, .77);
  vec3 color = mix(deep, teal, smoothstep(-1.7, 1.7, flow));
  color += pearl * caustic * (.16 + energy * .13);
  color += vec3(.12, .06, .16) * pow(max(0., flow * .5), 3.);
  color *= .65 + .35 * uv.y;
  gl_FragColor = vec4(color, 1.);
}
`;

/** @param {()=>HTMLCanvasElement} [makeCanvas] */
export const createLiquidShader = (makeCanvas) =>
  createMaterialShader(LIQUID_FRAGMENT, makeCanvas);
