import { actionForKey } from '../lib/input-actions.js';
import { readFileSync } from 'node:fs';
import { createStemPlayer } from '../lib/stem-player.js';
import { createAudioEngine } from '../lib/audio-engine.js';
import { createSongLibrary } from '../lib/song-library.js';
import * as transport from '../lib/transport.js';
import * as beatGrid from '../lib/beat-grid.js';
import * as audioImport from '../lib/audio-import.js';

// Legacy Canvas integration tests still inspect app state in a VM. Extracted
// modules use their real exports here and have separate interface-level tests.
export const appImports = { actionForKey, createStemPlayer, createAudioEngine, createSongLibrary, ...audioImport, ...transport, ...beatGrid };
export const appSource = '"use strict";\n' + readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');
