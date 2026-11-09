# Working on Lockstep

Lockstep is still a static site. `index.html` loads `app.js` as a native JavaScript module; no bundle or build step is needed to run or publish the game. TypeScript and Prettier are development tools only.

## Where changes belong

| Change | File | Check |
| --- | --- | --- |
| Library saving, deletion, re-chart persistence | `lib/song-library.js` | `audit.test.mjs` |
| Import duration/size limits and download reading | `lib/audio-import.js` | `audit.test.mjs` |
| Tempo slowdown and song/audio time conversion | `lib/transport.js` | `timing.test.mjs`, `render.test.mjs` |
| Beat positions and difficulty thinning | `lib/beat-grid.js` | `timing.test.mjs`, `performance.test.mjs` |
| Stored chart, PCM and tempo data types | `lib/song.ts` | `npm run typecheck` |
| Native controls and page layout | `index.html`, `styles.css` | `touch.test.mjs` |
| Screen flow, current run state, input, Canvas drawing and audio nodes | `app.js` | renderer, touch, materials and performance tests |
| Stem separation and worker messages | `separator.js`, `vendor/demucs-web/processor.js` | separation and audit tests |
| Automatic note chart generation | `analyze.js` | `analyze.test.mjs` |
| GPU materials | `shader-renderer.js`, `theme-shaders.js`, `liquid-shader.js` | shader and materials tests |

## Module rules

- The library module owns IndexedDB. Callers ask it to list, load audio, save, update a chart or remove a song; they do not name object stores or manage transactions. Both audio and metadata commit together. Updating a chart never recreates a deleted entry.
- Import helpers own validation and metadata/download resources. They report errors to the caller; they do not change the selected song or show toasts.
- Timing modules are pure calculations. They receive the beat grid or tempo segments explicitly and never read an audio context, DOM node or global game state. Time is measured in seconds.
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

`lib/song.ts` defines shared data shapes. The modules in `lib/` use JSDoc references to those types and are checked with strict TypeScript. JavaScript remains the browser's source, so there is no generated directory to keep synchronized. `app.js` and the older renderer/worker files are not yet fully type-checked.

Run `npm run format` after changing the entry point, page, styles or library modules. Readability is intentional: expand state transitions into steps and prefer descriptive names over reducing line count.

New module tests should import the real module and exercise its public interface. `test/app-harness.mjs` preserves the existing Canvas integration tests during migration; it injects the real module exports into their VM. Those tests still inspect application state and should shrink as the remaining systems become independent.

## Remaining migration

This first extraction removes storage, import validation and timing calculations from the application. The Canvas renderer, audio node lifecycle, menu flow and input routing still share application state. Move those one at a time with their existing regression checks; do not split them into files that silently share globals.

A UI framework can be evaluated when the library/search/settings screens have an independent state model. It is not needed for the Canvas or audio engines, and no framework migration is part of this change.
