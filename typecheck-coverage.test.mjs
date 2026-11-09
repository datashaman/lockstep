import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
// tsconfig.browser.json sets checkJs:false so vendor/ stays unchecked; root entry points opt in with the pragma.
for (const file of readdirSync('.').filter((name) => name.endsWith('.js')))
  assert.match(readFileSync(file, 'utf8'), /^\/\/ @ts-check\n/, `${file} must start with // @ts-check`);
