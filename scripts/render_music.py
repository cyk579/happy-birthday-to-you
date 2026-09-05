"""Render the gift's original piano arrangement; the website only needs the MP3.

Requires Python + NumPy and FFmpeg. Piano recordings: Alexander Holm,
Salamander Grand Piano, CC BY 3.0; see assets/piano/ATTRIBUTION.md.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
RATE = 44100
BPM = 56
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 40
FRAMES = round(BARS * BAR * RATE)
RNG = np.random.default_rng(579)

# D major, with shared tones between the warm extended chords.
CHORDS = [
    (38, [57, 61, 64, 66]),  # Dmaj9
    (37, [57, 59, 61, 64]),  # Aadd9/C#
    (35, [54, 57, 62, 66]),  # Bm7
    (31, [54, 57, 59, 62]),  # Gmaj9
    (30, [57, 62, 64, 66]),  # Dadd9/F#
    (40, [55, 59, 62, 66]),  # Em9
    (31, [54, 59, 62, 66]),  # Gmaj7
    (33, [57, 59, 61, 64]),  # Aadd9
]

# Beat, MIDI pitch, held beats. These two phrases are composed for this page;
# neither quotes the birthday song nor relies on random note selection.
PHRASE_A = [
    [(0.75, 66, 1.0), (2.25, 69, 1.1), (3.5, 73, 0.5)],
    [(0.5, 71, 1.7), (2.75, 69, 1.0)],
    [(0.75, 66, 1.3), (2.5, 64, 1.2)],
    [(0.5, 62, 2.4)],
    [(0.75, 66, 1.0), (2.0, 69, 1.0), (3.25, 74, 0.6)],
    [(0.5, 71, 1.5), (2.75, 69, 0.9)],
    [(0.75, 66, 1.6), (3.0, 64, 0.8)],
    [(0.5, 61, 1.5), (2.75, 64, 1.0)],
]
PHRASE_B = [
    [(0.5, 74, 1.6), (2.75, 73, 0.9)],
    [(0.75, 71, 1.4), (2.5, 69, 0.7), (3.5, 64, 0.4)],
    [(0.5, 66, 1.3), (2.25, 69, 1.3)],
    [(0.75, 71, 2.3)],
    [(0.5, 74, 1.3), (2.25, 76, 0.8), (3.5, 74, 0.5)],
    [(0.75, 71, 1.5), (2.75, 69, 0.8)],
    [(0.5, 66, 2.2)],
    [(0.75, 64, 1.4), (2.75, 61, 0.9)],
]


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    args = parser.parse_args()
    samples = {}
    for octave in range(2, 6):
        decoded = subprocess.check_output([
            args.ffmpeg, '-v', 'error', '-i', str(ROOT / f'assets/piano/C{octave}.mp3'),
            '-f', 'f32le', '-ar', str(RATE), '-ac', '2', 'pipe:1',
        ])
        data = np.frombuffer(decoded, dtype='<f4').reshape(-1, 2)
        onset = np.flatnonzero(np.max(np.abs(data), axis=1) > 0.001)
        samples[12 * (octave + 1)] = data[max(0, onset[0] - 100):]

    piano = np.zeros((FRAMES, 2), dtype=np.float32)
    pad = np.zeros_like(piano)
    pitched = {}
    score = []

    def wrap_add(track, start, signal):
        # Write note/reverb tails around the boundary for a genuinely seamless loop.
        offset = round(start * RATE) % FRAMES
        first = min(len(signal), FRAMES - offset)
        track[offset:offset + first] += signal[:first]
        if first < len(signal):
            track[:len(signal) - first] += signal[first:]

    def note(start, midi, held, velocity):
        if midi not in pitched:
            source = min(samples, key=lambda key: abs(key - midi))
            step = 2 ** ((midi - source) / 12)
            sample = samples[source]
            positions = np.arange(0, min(len(sample) - 1, RATE * 9 * step), step)
            pitched[midi] = np.stack([
                np.interp(positions, np.arange(len(sample)), sample[:, channel])
                for channel in range(2)
            ], axis=1).astype(np.float32)
        release = 2.3
        count = min(len(pitched[midi]), round((held + release) * RATE))
        time = np.arange(count, dtype=np.float32) / RATE
        envelope = np.minimum(time / 0.004, 1)
        decay = np.clip((time - held) / release, 0, 1)
        envelope *= (1 - decay) ** 2
        signal = pitched[midi][:count] * (envelope * velocity)[:, None]
        wrap_add(piano, start, signal)
        score.append({'time': round(start, 3), 'midi': midi, 'hold': round(held, 3)})

    for bar in range(BARS):
        section, harmony = divmod(bar, 8)
        bass, chord = CHORDS[harmony]
        origin = bar * BAR
        energy = [0.80, 0.94, 0.86, 1.0, 0.78][section]
        note(origin + 0.03, bass, BAR * 0.7, 0.27 * energy)
        order = [0, 2, 1, 3] if section % 2 == 0 else [0, 1, 3, 2]
        for step, index in enumerate(order):
            onset = origin + (0.2 + step * 0.92) * BEAT + RNG.uniform(-0.022, 0.022)
            note(onset, chord[index], BEAT * 0.72, RNG.uniform(0.15, 0.21) * energy)
        phrase = PHRASE_B if section in (2, 3) else PHRASE_A
        # Sparse introduction and closing section leave space around the melody.
        melody = phrase[harmony]
        if section == 0 and harmony < 2:
            melody = melody[:1]
        if section == 4:
            melody = melody[:2]
        for beat, midi, held in melody:
            note(origin + beat * BEAT + RNG.uniform(-0.018, 0.018), midi,
                 held * BEAT, RNG.uniform(0.36, 0.43) * energy)

        # A quiet, warm pad with slow attack/release, no percussion or bright chimes.
        length = BAR + 2.5
        time = np.arange(round(length * RATE), dtype=np.float32) / RATE
        envelope = np.sin(np.minimum(time / 1.2, 1) * np.pi / 2) ** 2
        envelope *= np.cos(np.clip((time - BAR + 0.6) / 3.1, 0, 1) * np.pi / 2) ** 2
        for midi in chord[:3]:
            frequency = 440 * 2 ** ((midi - 69) / 12)
            wave = np.zeros((len(time), 2), dtype=np.float32)
            for channel, detune in enumerate([0.9996, 1.0004]):
                phase = 2 * np.pi * frequency * detune * time
                tone = np.sin(phase) + 0.12 * np.sin(phase * 2)
                wave[:, channel] = tone * envelope * 0.004 * energy
            wrap_add(pad, origin, wave)

    # Diffuse stereo reflections, intentionally softer than the piano's direct sound.
    mix = piano + pad
    for delay, level in [(0.071, .13), (.137, .11), (.229, .09), (.347, .075),
                         (.503, .06), (.733, .046), (1.013, .032), (1.471, .02)]:
        shift = round(delay * RATE)
        mix[:, 0] += np.roll(piano[:, 1], shift) * level
        mix[:, 1] += np.roll(piano[:, 0], shift + 193) * level
    mix -= np.mean(mix, axis=0)
    mix *= 0.55 / np.max(np.abs(mix))
    output = ROOT / 'assets/starlight-piano.mp3'
    subprocess.run([
        args.ffmpeg, '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '2',
        '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k',
        '-metadata', 'title=Starlight - A Birthday Moment',
        '-metadata', 'artist=Original arrangement for the birthday gift',
        '-metadata', 'comment=Piano: Alexander Holm, Salamander Grand Piano, CC BY 3.0',
        str(output),
    ], input=mix.astype('<f4').tobytes(), check=True)
    rms = float(np.sqrt(np.mean(mix ** 2)))
    report = {'durationSeconds': FRAMES / RATE, 'bpm': BPM, 'bars': BARS,
              'notes': len(score), 'peak': float(np.max(np.abs(mix))),
              'rms': rms, 'rmsDbFS': 20 * np.log10(rms),
              'boundaryStep': np.abs(mix[0] - mix[-1]).tolist(),
              'bytes': output.stat().st_size}
    artifacts = ROOT / 'artifacts'
    artifacts.mkdir(exist_ok=True)
    (artifacts / 'music-render.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    run()
