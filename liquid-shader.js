// A single low-resolution WebGL pass, copied immediately into a reusable 2D surface.
const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`;
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

export function createLiquidShader(makeCanvas = () => document.createElement('canvas')) {
  const canvas = makeCanvas(); canvas.width = 320; canvas.height = 240;
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true });
  if (!gl) return null;
  const surface = makeCanvas(); surface.width = 320; surface.height = 240;
  const copy = surface.getContext('2d');
  if (!copy) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return null; }
  let program, buffer, uniforms, lost = false, failed = false, lastFrame = null;
  function release() {
    if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program);
    buffer = program = null;
  }
  function setup() {
    const shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, LIQUID_FRAGMENT]]) {
        const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('Liquid shader could not compile');
      }
      program = gl.createProgram(); shaders.forEach(s => gl.attachShader(program, s)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Liquid shader could not link');
      gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = { time: gl.getUniformLocation(program, 'time'), energy: gl.getUniformLocation(program, 'energy'), captures: gl.getUniformLocation(program, 'captures') };
      gl.viewport(0, 0, 320, 240); lastFrame = null;
    } catch { release(); failed = true; }
    finally { shaders.forEach(s => { if (s) gl.deleteShader(s); }); }
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; lastFrame = null; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; failed = false; program = buffer = null; setup(); });
  setup();
  if (failed) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return null; }
  const quiet = new Float32Array([-1, -1, -1, -1]);
  return {
    render(seconds, captures, energy, reducedMotion = false) {
      if (lost || failed || gl.isContextLost()) return null;
      const frame = reducedMotion ? 'still' : Math.floor(seconds * 30);
      if (frame !== lastFrame) {
        gl.uniform1f(uniforms.time, reducedMotion ? 0 : seconds * .12 % (Math.PI * 2));
        gl.uniform1f(uniforms.energy, reducedMotion ? 0 : energy);
        gl.uniform4fv(uniforms.captures, reducedMotion ? quiet : captures);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // Copy in the same task: WebGL may discard its drawing buffer after presentation.
        copy.drawImage(canvas, 0, 0); lastFrame = frame;
      }
      return surface;
    },
  };
}
