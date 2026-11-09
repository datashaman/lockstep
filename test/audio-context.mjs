// A graph/clock recorder, not an audio renderer. Tests assert public operations
// against node connections and scheduled automation, never private engine state.
export function createAudioHarness() {
  const nodes = [];
  const parameter = () => ({
    value: 0,
    events: [],
    setValueAtTime(...args) { this.events.push(['set', ...args]); },
    setTargetAtTime(...args) { this.events.push(['target', ...args]); },
    exponentialRampToValueAtTime(...args) { this.events.push(['ramp', ...args]); },
    cancelScheduledValues(...args) { this.events.push(['cancel', ...args]); },
  });
  class Node {
    constructor(kind) {
      this.kind = kind;
      nodes.push(this);
      this.edges = new Set();
      this.starts = [];
      this.offsets = [];
      this.stops = [];
      for (const name of ['gain', 'frequency', 'detune', 'Q', 'delayTime', 'threshold', 'ratio', 'playbackRate']) this[name] = parameter();
    }
    connect(target) { this.edges.add(target); return target; }
    disconnect() { this.edges.clear(); }
    start(when, offset) { this.starts.push(when); this.offsets.push(offset); }
    stop(when) { this.stops.push(when); }
  }
  class AudioContext {
    currentTime = 0;
    sampleRate = 44100;
    state = 'running';
    destination = {};
    createGain() { return new Node('gain'); }
    createBufferSource() { return new Node('buffer'); }
    createOscillator() { return new Node('oscillator'); }
    createBiquadFilter() { return new Node('filter'); }
    createDelay() { return new Node('delay'); }
    createDynamicsCompressor() { return new Node('compressor'); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length), copyToChannel() {} }; }
  }
  return { AudioContext, nodes, countEdges: () => nodes.reduce((sum, node) => sum + node.edges.size, 0) };
}
