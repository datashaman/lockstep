# Lockstep

**Play it:** https://datashaman.github.io/lockstep/

A browser rhythm game where each instrument in a song is its own track. Hit a track's notes to bring that
part in; nail a phrase to lock it and move to the next track. Inspired by the rhythm-action games of the
PS2 era.

Drop any audio file on the title screen and it is split into drums, bass, vocals and harmony
([Demucs](https://github.com/facebookresearch/demucs), run in your browser on WebGPU), then charted
automatically. Your songs never leave your machine: separation runs locally and the result is kept in
the browser's own storage.

No file handy? Pick **Find a song on Audius** on the title screen to browse trending tracks or type to search
[Audius](https://audius.co), then press Enter to add one. Tracks stream straight from Audius and are used under the
[Audius Open Music License](https://openaudiofoundation.org/open-music-license.pdf); each one keeps its artist's
name and a link back to the track.

## Run

```sh
python3 serve.py        # http://127.0.0.1:8642/
```

Any static server works; `serve.py` just stops the browser caching stale modules during development.
The first song you add downloads the ~180 MB separation model once.

## Play

| Key | Title screen | In game |
| --- | --- | --- |
| ↑ ↓ | pick a song (it plays quietly behind the menu) | |
| ← → | difficulty | switch track (also A / D) |
| Enter / Space | play | |
| O | add audio files (or drop them anywhere) | |
| F | find a song on Audius: type to search, ↑ ↓ previews, Enter adds, Esc back | |
| X twice | delete a song | |
| `[` `]` | audio offset | |
| ? | all controls | |
| J K L | | hit lanes |
| Space / Esc | | pause |

Choose a song’s look with **T** or the theme button on its sleeve: **Neon**, **Liquid Dream**, **Paper City** or **Circuit Cathedral**. **Shift+T** (or the default control beneath the sleeve) makes the current look the default for songs without a saved choice. Theme choices stay in this browser and do not change charts or timing.

Space or Esc pauses the song. Resume with Space/Enter and a three-second count-in, restart with R, or return to song selection with Esc. Switching tabs pauses automatically.

Keep the **groove meter** alive: missed notes on your active track drain it, and consecutive misses drain more. Hits restore a little groove; captures restore more. AUTO and unselected tracks neither drain nor refill it. Below 40%, the song and highway slow down; recover to bring them back to tempo. At zero the run ends, with Retry and Song selection available. Failed runs do not save a personal best.

Recorded songs slow with a tape-style pitch drop. The synth demo slows its beat and note scheduling. Both use the same chart clock, while hit windows and timing feedback remain measured in real milliseconds.

Hits outside the perfect window show how many milliseconds early or late they were. Results show average signed timing overall and per instrument; AUTO notes are excluded.

You can move onto captured (AUTO) tracks and back out again; silent tracks are skipped.

The title screen also works with the mouse: click a song to select it and again to play, or click the buttons.
Your best grade and score for each song and difficulty are kept in this browser.

## Offline charting (optional)

`prep.py` does the same separation and charting in Python and writes `songs/<slug>/` for songs served
with the game. Setup: `uv venv && uv pip install demucs librosa soundfile`, plus `ffmpeg` on PATH; run with `.venv/bin/python prep.py song.mp3`.
Do not commit songs you don't own the rights to; `.gitignore` keeps everything but the generated test song out.

## Test

```sh
node analyze.test.mjs   # charting against synthetic stems with a known grid
node separation.test.mjs # chunk tensor cleanup, reconstruction and failure paths
node render.test.mjs    # gameplay and renderer checks
node performance.test.mjs # repeated-play resource checks and chart-work measurements
node materials.test.mjs # bounded texture cache and scenery draw cost
node liquid-shader.test.mjs # shader lifecycle, frame cap and fallbacks
```

## Sharing Audius tracks

Select an imported Audius track and click **Share** (or press **C**) to copy a link to this game with that track selected. Existing Audius imports work too; local files cannot be shared.

The recipient opens the link and clicks **Download & play**. Lockstep resolves the track through Audius, downloads and separates it on their device, then starts playing. Already imported tracks play from their library. Closing the prompt during processing leaves the import running but cancels automatic playback. Unavailable tracks and tracks outside the 30-second–10-minute limit show an error.

Links use the current game's address, so share from a publicly reachable deployment, not localhost. No audio, stems or local filenames are uploaded. The recipient needs a browser capable of running separation; first use downloads the model.

## License

MIT, see [LICENSE](LICENSE). `vendor/demucs-web/` is MIT-licensed third-party code.

Theme materials are generated once at 400×300 and cached: neon scanlines/reflections, liquid caustics, paper grain/folds, and etched circuits/glass facets. They are drawn continuously behind gameplay; shading follows the curved road to keep notes readable. No external texture downloads are needed.

Captures trigger brief theme-specific scenery effects: neon sweeps, water ripples, ink blooms and travelling circuit pulses. Liquid caustics drift slowly; reduced-motion mode freezes that drift and suppresses capture animations. Effects reuse capture timestamps and expire after 1.6 seconds without particle queues.

Liquid Dream additionally uses a single WebGL background pass for flowing colour, caustic light and capture-driven refraction. It renders at 320×240, at most 30 times per second, into a reusable Canvas surface; gameplay and text stay in the original crisp renderer. Neon shares the same renderer for soft light beams, blurred reflections, CRT scanlines and capture sweeps. Switching between supported themes replaces the active program; only one WebGL context and two small surfaces are retained. Reduced motion renders one still shader frame. If WebGL is unavailable, compilation fails or the context is lost, the cached liquid texture remains available; a restored context rebuilds its GPU resources.

Paper City uses the shared shader for stationary paper fibres, directional fold lighting, contact shadows and capture-driven ink blooms. Its light moves gently; reduced motion keeps it fixed.

Circuit Cathedral adds stained-glass facets, dark leading, travelling etched-circuit light and coloured capture shafts through the same bounded renderer. All four themes now have shaders and retain their individual Canvas fallback materials.

## Tablet touch controls

Landscape tablets get a touch dock below the game, keeping fingers away from the timing line. Left / Middle / Right hit the three lanes immediately on touch-down and accept simultaneous touches. Separate Track arrows switch instruments; Pause opens resume, restart and song-selection controls. Rotating into portrait while playing pauses the game.

The dock also offers native song and difficulty selectors, Audius search, file import, theme switching and Audius sharing. Settings contains audio calibration (±10 ms), default theme and the existing two-step song deletion. Keyboard controls remain available. Touch controls appear on devices advertising a coarse pointer; buttons have at least 44-pixel targets and the layout accounts for screen safe areas.

This is the landscape-tablet pass. Phone menus retain the scaled two-panel canvas; portrait shows landscape guidance. Real-device touch/audio latency and mobile stem-separation limits still need testing. Keep the browser foregrounded while importing a track.

Run `node touch.test.mjs` for pointer, cancellation, shared input and calibration checks.
