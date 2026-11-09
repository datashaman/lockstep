"""Compare both charting paths on the shipped synthetic stems (no Demucs needed)."""
import json
import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import prep


def compare():
    stems = {}
    with tempfile.TemporaryDirectory() as directory:
        for stem, *_ in prep.STEMS:
            y, _ = librosa.load(prep.ROOT / 'songs' / 'synth-test' / f'{stem}.mp3', sr=44100)
            y.astype('<f4').tofile(Path(directory) / f'{stem}.f32')
            stems[stem] = librosa.resample(y, orig_sr=44100, target_sr=prep.SR)
        browser = json.loads(subprocess.check_output(
            ['node', str(prep.ROOT / 'test' / 'chart-browser.mjs'), directory], text=True))
    mix = sum(stems.values())
    _, beats = librosa.beat.beat_track(y=mix, sr=prep.SR, hop_length=prep.HOP, units='time')
    beats = prep.refine(beats, stems['drums'])
    down = prep.downbeat(stems['drums'], beats)
    bars = beats[down::4]
    offline = [prep.chart(stems[stem], beats, bars, pitch, 2) for stem, _, pitch in prep.STEMS]
    browser_beats = np.array(browser['beats'])
    bpm = 60 / np.median(np.diff(beats))
    beat_error = np.max(np.min(np.abs(beats[:, None] - browser_beats[None, :]), axis=1))
    assert abs(bpm - 100) < .5 and abs(browser['bpm'] - 100) < .5
    assert beat_error < .020, f'beat grids differ by {beat_error:.4f}s'
    assert abs(len(beats) - len(browser_beats)) <= 4, 'beat coverage changed'
    assert len(browser['tracks']) == len(offline) == 4
    duration = len(mix) / prep.SR
    for notes in offline + [track['notes'] for track in browser['tracks']]:
        times = [t for t, _ in notes]
        assert times and times == sorted(set(times)), 'notes must be nonempty, sorted and unique'
        assert all(0 <= t <= duration and lane in (0, 1, 2) for t, lane in notes)
    browser_bars = browser_beats[browser['downbeat']::4]
    bar_error = np.max(np.min(np.abs(bars[:, None] - browser_bars[None, :]), axis=1))
    # The algorithms differ: report density/bar phase instead of claiming note-for-note parity.
    print(f'Beat-grid difference: {beat_error * 1000:.1f} ms; bar-grid difference: {bar_error:.3f} s')
    print(f'Beats: Python {len(beats)}, browser {len(browser_beats)}')
    for (_, name, _), notes, track in zip(prep.STEMS, offline, browser['tracks']):
        print(f'{name}: Python {len(notes)}, browser {len(track["notes"])} notes')


if __name__ == '__main__':
    compare()
