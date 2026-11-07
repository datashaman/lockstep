#!/usr/bin/env python3
"""Turn a mixed song into a Lockstep song: Demucs stems + beat grid + one note chart per stem.

usage: .venv/bin/python prep.py path/to/song.mp3 [--title "Name"] [--bpm 128] [--density 2]

Writes songs/<slug>/{song.json, drums.mp3, bass.mp3, vocals.mp3, other.mp3} and updates songs/index.json.
Separated WAVs are cached in .cache/<slug>/ so re-charting (e.g. a different --density) skips Demucs.
"""
import argparse, json, re, shutil, subprocess, sys
from pathlib import Path
import numpy as np, librosa

ROOT = Path(__file__).parent
SR, HOP = 22050, 512
# stem, track name, yin pitch range (None = drums, lanes by frequency band)
STEMS = [('drums', 'DRUMS', None), ('bass', 'BASS', (35, 400)), ('vocals', 'VOCALS', (80, 1000)), ('other', 'HARMONY', (80, 2000))]


def separate(src, cache):
    if all((cache / f'{s}.wav').exists() for s, *_ in STEMS):
        return
    out = cache / 'demucs'
    subprocess.run([sys.executable, '-m', 'demucs', '-n', 'htdemucs', '-d', 'cpu', '-o', str(out), str(src)], check=True)
    for s, *_ in STEMS:
        shutil.move(next(out.glob(f'htdemucs/*/{s}.wav')), cache / f'{s}.wav')
    shutil.rmtree(out)


def refine(beats, drums):
    """Straighten the tracker's jittery beats when the tempo is steady, then shift the grid onto real drum attacks
    (librosa's beat times at hop 512 jitter by a frame or two)."""
    k = np.arange(len(beats))
    fit = np.polyval(np.polyfit(k, beats, 1), k)
    if np.abs(fit - beats).max() < 0.04:  # steady studio tempo; a drifting live tempo keeps the tracked beats
        beats = fit
    on = librosa.onset.onset_detect(y=drums, sr=SR, hop_length=128, units='time')  # ~6 ms frames; peaks measured ~7 ms late, backtracking ~25 ms early
    g16 = np.concatenate([np.linspace(a, b, 4, endpoint=False) for a, b in zip(beats[:-1], beats[1:])])
    res = on - g16[np.abs(g16[None, :] - on[:, None]).argmin(1)]
    res = res[np.abs(res) < np.median(np.diff(beats)) / 8]
    return beats + (np.median(res) if len(res) else 0)


def downbeat(drums, beats):
    """Bar phase (0-3) whose beats carry the most low-band (kick) onset energy."""
    low = librosa.onset.onset_strength(y=drums, sr=SR, hop_length=HOP, fmax=150)
    f = librosa.time_to_frames(beats, sr=SR, hop_length=HOP).clip(0, len(low) - 1)
    return int(np.argmax([low[f[p::4]].sum() for p in range(4)]))


def chart(y, beats, bars, pitch, density):
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    on = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    on = on[(on < len(rms)) & (rms[on.clip(max=len(rms) - 1)] > 0.1 * np.percentile(rms, 95))]  # drop bleed in quiet parts
    if not len(on):
        return []
    # snap to the 16th grid, then keep the strongest onset per 1/density beat
    g16 = np.concatenate([np.linspace(a, b, 4, endpoint=False) for a, b in zip(beats[:-1], beats[1:])])
    times = librosa.frames_to_time(on, sr=SR, hop_length=HOP)
    slot = np.abs(g16[None, :] - times[:, None]).argmin(1)
    best = {}
    for s, fr in zip(slot, on):
        w = s // (4 // density)
        if w not in best or env[fr] > env[best[w][1]]:
            best[w] = (s, fr)
    picks = sorted(best.values())
    frames = np.array([fr for _, fr in picks]).clip(max=len(env) - 3) + 2  # read features just after the attack
    ts = g16[[s for s, _ in picks]]

    if pitch is None:  # drums: low / mid / high band, each normalised so hats can win against kicks
        S = np.abs(librosa.stft(y, hop_length=HOP))
        fq = librosa.fft_frequencies(sr=SR)
        bands = np.stack([S[fq < 150].sum(0), S[(fq >= 150) & (fq < 2000)].sum(0), S[fq >= 5000].sum(0)])
        bands /= np.percentile(bands, 90, axis=1, keepdims=True) + 1e-9
        lanes = bands[:, frames.clip(max=bands.shape[1] - 1)].argmax(0)
    else:  # pitched: lane = low / mid / high relative to the other notes in the same 2-bar phrase
        f0 = librosa.yin(y, fmin=pitch[0], fmax=pitch[1], sr=SR, hop_length=HOP)
        m = librosa.hz_to_midi(f0[frames.clip(max=len(f0) - 1)])
        phrase = np.searchsorted(bars, ts, side='right') // 2
        lanes = np.ones(len(ts), int)
        for p in np.unique(phrase):
            i = phrase == p
            lo, hi = np.percentile(m[i], [33, 67])
            if hi - lo >= 1:  # less than a semitone of movement: leave it all in the middle lane
                lanes[i] = (m[i] > lo).astype(int) + (m[i] > hi)
    return [[round(float(t), 4), int(l)] for t, l in zip(ts, lanes)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', type=Path)
    ap.add_argument('--title')
    ap.add_argument('--bpm', type=float, help='force tempo if beat tracking picks half/double time')
    ap.add_argument('--density', type=int, default=2, choices=[1, 2, 4], help='max notes per beat per track')
    a = ap.parse_args()
    title = a.title or a.src.stem
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    cache, out = ROOT / '.cache' / slug, ROOT / 'songs' / slug
    cache.mkdir(parents=True, exist_ok=True); out.mkdir(parents=True, exist_ok=True)

    separate(a.src, cache)
    mix, _ = librosa.load(a.src, sr=SR)
    kw = {'bpm': a.bpm} if a.bpm else {}
    tempo, beats = librosa.beat.beat_track(y=mix, sr=SR, hop_length=HOP, units='time', **kw)
    stems = {s: librosa.load(cache / f'{s}.wav', sr=SR)[0] for s, *_ in STEMS}
    beats = refine(beats, stems['drums'])
    down = downbeat(stems['drums'], beats)
    bars = beats[down::4]

    tracks = []
    for s, name, pitch in STEMS:
        notes = chart(stems[s], beats, bars, pitch, a.density)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(cache / f'{s}.wav'), '-b:a', '192k', str(out / f'{s}.mp3')], check=True)
        tracks.append({'name': name, 'stem': f'{s}.mp3', 'notes': notes})
        print(f'{name:8} {len(notes):4} notes')

    duration = round(len(mix) / SR, 3)
    song = {'title': title, 'duration': duration, 'beats': [round(float(b), 4) for b in beats], 'downbeat': down, 'tracks': tracks}
    for tr in tracks:  # self-check
        ts = [t for t, _ in tr['notes']]
        assert ts == sorted(ts) and len(set(ts)) == len(ts) and all(0 <= t <= duration for t in ts), tr['name']
        assert all(l in (0, 1, 2) for _, l in tr['notes']), tr['name']
    (out / 'song.json').write_text(json.dumps(song, separators=(',', ':')))

    idx_path = ROOT / 'songs' / 'index.json'
    idx = [e for e in (json.loads(idx_path.read_text()) if idx_path.exists() else []) if e['slug'] != slug]
    idx_path.write_text(json.dumps(idx + [{'slug': slug, 'title': title}], indent=1))
    print(f'{title}: {float(np.atleast_1d(tempo)[0]):.1f} BPM, {len(beats)} beats, downbeat phase {down} -> {out}')


if __name__ == '__main__':
    main()
