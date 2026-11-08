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
| Esc | | back to title |

The title screen also works with the mouse: click a song to select it and again to play, or click the buttons.
Your best grade and score for each song and difficulty are kept in this browser.

## Offline charting (optional)

`prep.py` does the same separation and charting in Python and writes `songs/<slug>/` for songs served
with the game. Setup: `uv venv && uv pip install demucs librosa soundfile`, plus `ffmpeg` on PATH; run with `.venv/bin/python prep.py song.mp3`.
Do not commit songs you don't own the rights to; `.gitignore` keeps everything but the generated test song out.

## Test

```sh
node analyze.test.mjs   # charting against synthetic stems with a known grid
```

## License

MIT, see [LICENSE](LICENSE). `vendor/demucs-web/` is MIT-licensed third-party code.
