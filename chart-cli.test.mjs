import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = mkdtempSync(join(tmpdir(), 'lockstep-chart-'));
try {
  for (const name of ['drums', 'bass', 'vocals', 'other']) writeFileSync(join(directory, `${name}.f32`), Buffer.alloc(8));
  for (const [bytes, message] of [[Buffer.alloc(3), /Invalid PCM/], [Buffer.alloc(4), /lengths must match/], [Buffer.from([0, 0, 128, 127, 0, 0, 0, 0]), /Non-finite PCM/]]) {
    writeFileSync(join(directory, 'other.f32'), bytes);
    const result = spawnSync(process.execPath, ['scripts/chart-stems.mjs', directory], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
