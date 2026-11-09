import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, STEMS } from '../analyze.js';

// prep.py writes mono, little-endian float32 at 44.1 kHz.
const [directory, options = '{}'] = process.argv.slice(2);
let length;
const stems = Object.fromEntries(STEMS.map(([name]) => {
  const bytes = readFileSync(join(directory, `${name}.f32`));
  if (!bytes.length || bytes.length % 4) throw new Error(`Invalid PCM for ${name}`);
  const mono = new Float32Array(bytes.length / 4);
  for (let i = 0; i < mono.length; i++) mono[i] = bytes.readFloatLE(i * 4);
  if (!mono.every(Number.isFinite)) throw new Error(`Non-finite PCM for ${name}`);
  length ??= mono.length;
  if (mono.length !== length) throw new Error('Stem lengths must match');
  return [name, { left: mono, right: mono }];
}));
console.log(JSON.stringify(analyze(stems, JSON.parse(options))));
