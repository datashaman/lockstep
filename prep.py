#!/usr/bin/env python3
"""Turn a mixed song into a Lockstep song: Demucs stems + beat grid + one note chart per stem.

usage: .venv/bin/python prep.py path/to/song.mp3 [--title "Name"] [--bpm 128] [--density 2]

Writes songs/<slug>/{song.json, drums.mp3, bass.mp3, vocals.mp3, other.mp3} and updates songs/index.json.
Separated WAVs are cached by source hash in .cache/<sha256>/ so re-charting (e.g. a different --density) skips Demucs.
"""
import argparse, hashlib, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path
import numpy as np, librosa

ROOT = Path(__file__).parent
SR = 44100
STEMS = ('drums', 'bass', 'vocals', 'other')


def separate(src, cache):
    if all((cache / f'{s}.wav').exists() for s in STEMS):
        return
    out = cache / 'demucs'
    subprocess.run([sys.executable, '-m', 'demucs', '-n', 'htdemucs', '-d', 'cpu', '-o', str(out), str(src)], check=True)
    for s in STEMS:
        shutil.move(next(out.glob(f'htdemucs/*/{s}.wav')), cache / f'{s}.wav')
    shutil.rmtree(out)


def chart_stems(stems, bpm=None, density=2):
    """Use the browser analyzer; only decoding/separation and output files belong to Python."""
    options = {'density': density}
    if bpm is not None:
        options['bpm'] = bpm
    with tempfile.TemporaryDirectory() as directory:
        for stem in STEMS:
            np.asarray(stems[stem], dtype='<f4').tofile(Path(directory) / f'{stem}.f32')
        result = subprocess.run(
            ['node', str(ROOT / 'scripts' / 'chart-stems.mjs'), directory, json.dumps(options)],
            check=True, stdout=subprocess.PIPE, text=True)
    return json.loads(result.stdout)


def source_paths(src, title):
    with src.open('rb') as audio:
        digest = hashlib.file_digest(audio, 'sha256').hexdigest()
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-') or 'song'
    out = ROOT / 'songs' / slug
    marker = out / 'source.sha256'
    if out.exists() and any(out.iterdir()) and (not marker.exists() or marker.read_text().strip() != digest):
        raise ValueError(f'{out} belongs to another or unknown source; choose a different --title')
    cache = ROOT / '.cache' / digest
    cache.mkdir(parents=True, exist_ok=True); out.mkdir(parents=True, exist_ok=True)
    marker.write_text(digest)
    return slug, cache, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', type=Path)
    ap.add_argument('--title')
    ap.add_argument('--bpm', type=float, help='force tempo if beat tracking picks half/double time')
    ap.add_argument('--density', type=int, default=2, choices=[1, 2, 4], help='max notes per beat per track')
    a = ap.parse_args()
    if not shutil.which("node"):
        ap.error("Node.js is required for the shared chart analyzer.")
    if a.bpm is not None and not 20 <= a.bpm <= 400:
        ap.error("BPM must be between 20 and 400.")
    title = a.title or a.src.stem
    slug, cache, out = source_paths(a.src, title)

    separate(a.src, cache)
    stems = {s: librosa.load(cache / f'{s}.wav', sr=SR)[0] for s in STEMS}
    song = chart_stems(stems, a.bpm, a.density)
    song['title'] = title
    tracks, duration = song['tracks'], song['duration']
    for track in tracks:
        stem = track['stem']
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(cache / f'{stem}.wav'), '-b:a', '192k', str(out / f'{stem}.mp3')], check=True)
        track['stem'] = f'{stem}.mp3'
        print(f'{track["name"]:8} {len(track["notes"]):4} notes')

    for tr in tracks:  # self-check
        ts = [t for t, _ in tr['notes']]
        assert ts == sorted(ts) and len(set(ts)) == len(ts) and all(0 <= t <= duration for t in ts), tr['name']
        assert all(l in (0, 1, 2) for _, l in tr['notes']), tr['name']
    (out / 'song.json').write_text(json.dumps(song, separators=(',', ':')))

    idx_path = ROOT / 'songs' / 'index.json'
    idx = [e for e in (json.loads(idx_path.read_text()) if idx_path.exists() else []) if e['slug'] != slug]
    idx_path.write_text(json.dumps(idx + [{'slug': slug, 'title': title}], indent=1))
    print(f'{title}: {song["bpm"]:.1f} BPM, {len(song["beats"])} beats, downbeat phase {song["downbeat"]} -> {out}')


if __name__ == '__main__':
    main()
