# Keep the current browser runtime

Status: accepted for this refactor; revisit when the screen requirements change.

## Problem

The original application mixed song selection, input handling, scoring, audio scheduling and Canvas drawing in one file. Small changes required understanding unrelated state. A framework rewrite would also require proving that judgement timing, source cleanup, touch handling and saved tracks still behave correctly.

## Decision

Keep native JavaScript modules, Canvas 2D/WebGL, Web Audio and the existing DOM controls. Do not add a UI framework or runtime build step in this stack.

The refactor provides narrower places to change behavior:

| Concern | Owner |
| --- | --- |
| Meaning of keyboard/touch commands | `lib/input-actions.js` |
| Scoring, note judgement, captures and track selection | `lib/gameplay.js` |
| Catalog selection and dialog creation | `lib/song-menu.js` |
| Audius requests and search state | `lib/audius.js` |
| Backdrop, highway/effects and HUD drawing | `lib/scene-renderer.js` |
| Shader lifetime and theme materials | `shader-renderer.js`, `theme-shaders.js` |
| Audio graphs, recorded sources and previews | `lib/audio-engine.js`, `lib/stem-player.js` |
| Storage, imports and timing calculations | Other focused modules in `lib/` |
| Scheduling, animation updates, jobs and screen composition | `app.js` |

The renderer reads an explicit frame; it does not advance scoring or capture state. Audio and storage modules do not import the app. Input interpretation and gameplay calculations can be tested without a browser. Catalog selection and stale-search handling have independent tests.

A UI framework would mainly affect menus, settings and dialogs. It would not replace the performance-sensitive audio, separation or rendering engines. The current screens do not yet justify maintaining both a framework UI and the Canvas UI.

## Limits and next triggers

This is a refactor, not a finished architecture. `app.js` still owns substantial coordination and menu artwork. Its browser project enables strict null checking but still permits implicit `any` for legacy lifecycle state and inferred parameters; the extracted modules, renderer and shaders retain strict checks. Existing integration tests still use a VM harness for application-level behavior.

Revisit a framework when the product needs multiple substantial DOM screens, reusable forms, routing or accessibility behavior that repeatedly requires custom synchronization. First prototype one library/settings screen against the existing menu state. Keep audio scheduling and animation outside framework render cycles. Adopt only if that prototype measurably simplifies changes and preserves keyboard, touch and assistive-technology behavior.

Before another broad extraction, favor specific changes driven by difficulty modifying a feature. Suitable remaining boundaries include import-job lifecycle and pause/resume coordination; do not split files merely to meet a line-count target.

## Validation and rollout

Each stack layer has its own PR and is based on the preceding layer. Merge from input actions upward. No saved-song schema, chart version, assets or deployment process changes in this stack.

Local checks cover input mappings, gameplay counters, catalog/search state, frozen gameplay during rendering, all themes, audio cleanup, timing, imports and worker replies. A headless browser smoke checks native module loading and Canvas output. These checks do not substitute for playing on an iPad or testing memory pressure during real model inference.
