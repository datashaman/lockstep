// One WebGL context and reusable surface, regardless of the selected theme.
const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`;
export function createMaterialShader(fragment, makeCanvas = () => document.createElement('canvas')) {
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
      for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('Material shader could not compile');
      }
      program = gl.createProgram(); shaders.forEach(s => gl.attachShader(program, s)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Material shader could not link');
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
    setFragment(next) {
      if (next === fragment) return;
      release(); fragment = next; failed = false; lastFrame = null;
      if (!lost) setup();
    },
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
