import { createPauseSession } from '../lib/pause-session.js';
import { actionForKey } from '../lib/input-actions.js';
import * as gameplay from '../lib/gameplay.js';
import * as songMenu from '../lib/song-menu.js';
import * as audius from '../lib/audius.js';
import { createSceneRenderer } from '../lib/scene-renderer.js';
import { readFileSync } from 'node:fs';
import { createStemPlayer } from '../lib/stem-player.js';
import { createAudioEngine } from '../lib/audio-engine.js';
import { createSongLibrary } from '../lib/song-library.js';
import * as transport from '../lib/transport.js';
import * as beatGrid from '../lib/beat-grid.js';
import * as audioImport from '../lib/audio-import.js';
import { createFrameStats } from '../lib/perf-stats.js';
import { createRelayHost } from '../lib/inference-relay.js';

// Legacy Canvas integration tests still inspect app state in a VM. Extracted
// modules use their real exports here and have separate interface-level tests.
export const appImports = { createFrameStats, createRelayHost, createPauseSession,createSceneRenderer, ...songMenu, ...audius, ...gameplay, actionForKey, createStemPlayer, createAudioEngine, createSongLibrary, ...audioImport, ...transport, ...beatGrid };
export const appSource = '"use strict";\n' + readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace('const trackDialog =', 'let trackDialog =').replace('const resolveSharedTrack =', 'let resolveSharedTrack =').replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '') + `\nObject.defineProperties(globalThis, Object.fromEntries(Object.entries({score:'score',mult:'multiplier',hits:'hits',misses:'misses',strays:'strays',caps:'captures',groove:'groove',missStreak:'missStreak',cur:'currentTrack'}).map(([name, field]) => [name,{configurable:true,get:()=>run[field],set:value=>run[field]=value}])));\nObject.defineProperties(globalThis, Object.fromEntries(Object.entries({library:'library',server:'server',catalog:'entries',sel:'selected'}).map(([name,field])=>[name,{configurable:true,get:()=>menu[field],set:value=>menu[field]=value}])));`;
