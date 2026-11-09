# Working on Lockstep

Lockstep is still a static site. `index.html` loads `app.js` as a native JavaScript module; no bundle or build step is needed to run or publish the game. TypeScript and Prettier are development tools only.

## Where changes belong

| Change | File | Check |
| --- | --- | --- |
| Library saving, deletion, re-chart persistence | `lib/song-library.js` | `audit.test.mjs` |
| Import duration/size limits and download reading | `lib/audio-import.js` | `audit.test.mjs` |
| Synth instruments, count-in, capture sounds, echo and master volume | `lib/audio-engine.js` | `audio.test.mjs`, `performance.test.mjs` |
| Recorded stems and looping menu previews | `lib/stem-player.js` | `stem-player.test.mjs`, `performance.test.mjs` |
| Tempo slowdown and song/audio time conversion | `lib/transport.js` | `timing.test.mjs`, `render.test.mjs` |
| Beat positions and difficulty thinning | `lib/beat-grid.js` | `timing.test.mjs`, `performance.test.mjs` |
| Stored chart, PCM and tempo data types | `lib/song.ts` | `npm run typecheck` |
| Native controls and page layout | `index.html`, `styles.css` | `touch.test.mjs` |
| Playback coordination and screen composition | `app.js` | renderer, touch, materials and performance tests |
| Stem separation and worker messages | `separator.js`, `vendor/demucs-web/processor.js` | separation and audit tests |
| Automatic note chart generation | `analyze.js` | `analyze.test.mjs` |
| GPU materials | `shader-renderer.js`, `theme-shaders.js`, `liquid-shader.js` | shader and materials tests |

| Keyboard/touch action meanings | `lib/input-actions.js` | `input-actions.test.mjs` |
| Scoring, captures, misses and track selection | `lib/gameplay.js` | `gameplay.test.mjs` |
| Catalog selection, Audius requests and search state | `lib/song-menu.js`, `lib/audius.js` | `menu-flow.test.mjs` |
| Canvas backdrop, highway/effects and HUD | `lib/scene-renderer.js` | render, materials and performance tests |

## Module rules

- The library module owns IndexedDB. Callers ask it to list, load audio, save, update a chart or remove a song; they do not name object stores or manage transactions. Both audio and metadata commit together. Updating a chart never recreates a deleted entry.
- Import helpers own validation and metadata/download resources. They report errors to the caller; they do not change the selected song or show toasts.
- The audio engine owns its master/echo graph and transient synthesized sounds. The app owns the AudioContext, pause/resume, and absolute scheduling times. Sound methods take times in audio-clock seconds; `stopSounds()` disconnects temporary graphs but preserves the reusable master graph. The stem players connect to `audio.output`.
- Each stem player owns one group of recorded sources and gains. Gameplay and preview use separate players. Starting a group replaces the previous group; stopping or natural completion releases nodes. The app supplies loop bounds and scheduling times, and still owns pause/resume of the shared context.
- Timing modules are pure calculations. They receive the beat grid or tempo segments explicitly and never read an audio context, DOM node or global game state. Time is measured in seconds.
- The renderer reads a frame snapshot and owns only drawing resources. Animation state advances in the app; scoring and track mutations belong to gameplay rules. Menu/results overlays are composition callbacks.
- Input adapters translate browser events into actions before dispatch. Song-menu state preserves selection across catalog rebuilds; Audius search discards stale responses.
- `app.js` coordinates these modules. Song storage and timing must not import the app or renderer.
- Stored PCM is signed 16-bit stereo at 44.1 kHz, in chart-track order. Separation still runs on float audio in its worker. Do not retain both full representations on the main thread.

## Types and checks

```sh
npm ci
npm run typecheck
npm test
npm run format:check
python3 prep_test.py
```

GitHub Actions runs these checks on pull requests and pushes to `main`, using Node 24 and Python 3.13. The workflow uses commit-pinned official actions and a read-only repository token.

`lib/song.ts` defines shared data shapes. The modules in `lib/`, including the scene renderer and its shader dependencies, use JSDoc references and strict TypeScript. `tsconfig.browser.json` additionally checks every first-party browser/worker entry point that starts with `// @ts-check`; it leaves `checkJs` off so vendor code stays unchecked, and `typecheck-coverage.test.mjs` requires the pragma on every root `.js` file. Strict null checking is enabled for these entry points too. Inferred parameters and some legacy state still use implicit `any`; this is not a claim that the entry point is fully strict. Vendor implementation code is excluded from checking. `lib/worker.ts` defines the request/reply protocol on both sides, and `lib/scene.ts` defines the renderer frame. JavaScript remains the browser source, with no generated files.

Run `npm run format` after changing the entry point, page, styles or library modules. Readability is intentional: expand state transitions into steps and prefer descriptive names over reducing line count.

New module tests should import the real module and exercise its public interface. `test/app-harness.mjs` preserves the existing Canvas integration tests during migration; it injects the real module exports into their VM. Those tests still inspect application state and should shrink as the remaining systems become independent.

## Remaining migration

The refactor separates storage, import validation, timing calculations, synthesized audio and recorded-stem playback from application coordination. Input routing, gameplay rules, catalog/search state and scene rendering now have explicit interfaces. The app still coordinates playback, import jobs, animation and screen composition. The remaining type work is to replace the entry point’s remaining implicit `any` lifecycle state and inferred parameters with explicit types; the existing strict library check must stay enabled.

Keep the existing browser runtime for now. [The framework decision](FRAMEWORK-DECISION.md) records the rationale, current limits and concrete triggers for reconsidering a framework for DOM screens.
