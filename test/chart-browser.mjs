import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, STEMS } from '../analyze.js';

const stems = Object.fromEntries(STEMS.map(([name]) => {
  const bytes = readFileSync(join(process.argv[2], `${name}.f32`));
  const mono = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return [name, { left: mono, right: mono }];
}));
console.log(JSON.stringify(analyze(stems)));
