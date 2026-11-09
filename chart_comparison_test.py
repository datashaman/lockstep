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
        for stem in prep.STEMS:
            y, _ = librosa.load(prep.ROOT / 'songs' / 'synth-test' / f'{stem}.mp3', sr=prep.SR)
            y.astype('<f4').tofile(Path(directory) / f'{stem}.f32')
            stems[stem] = y
        browser = json.loads(subprocess.check_output(
            ['node', str(prep.ROOT / 'test' / 'chart-browser.mjs'), directory], text=True))
    offline = prep.chart_stems(stems)
    assert offline == browser, 'offline and browser charts must match, including lanes and bar phase'
    assert abs(offline['bpm'] - 100) < .5
    assert len(offline['tracks']) == 4
    for track in offline['tracks']:
        times = [t for t, _ in track['notes']]
        assert times == sorted(set(times))
        assert all(0 <= t <= offline['duration'] and lane in (0, 1, 2) for t, lane in track['notes'])
    for density in (1, 4):
        forced = prep.chart_stems(stems, bpm=120, density=density)
        assert forced['bpm'] == 120
        assert np.allclose(np.diff(forced['beats']), .5, atol=.0001)
    print('Exact chart parity: beats, bar phase, notes, lanes and chart version; BPM/density overrides pass')


if __name__ == '__main__':
    compare()
