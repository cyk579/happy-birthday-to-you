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
BPM = 104
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 64
FRAMES = round(BARS * BAR * RATE)
RNG = np.random.default_rng(579)

# Bright D-major harmony: sixths and added ninths keep the groove warm.
CHORDS = [
    (38, [57, 59, 62, 66]),  # D6
    (33, [57, 59, 61, 64]),  # Aadd9
    (35, [54, 57, 62, 66]),  # Bm7
    (31, [55, 59, 62, 64]),  # G6
    (30, [57, 62, 64, 66]),  # Dadd9/F#
    (31, [54, 59, 62, 66]),  # Gmaj7
    (40, [55, 59, 62, 64]),  # Em7
    (33, [57, 61, 64, 66]),  # A6
]

# Beat, MIDI pitch, held beats. These two phrases are composed for this page;
# neither quotes the birthday song nor relies on random note selection.
PHRASE_A = [
    [(0, 69, .35), (.75, 74, .4), (1.5, 78, .65), (2.5, 76, .3), (3, 74, .55)],
    [(.25, 73, .4), (1, 76, .4), (1.75, 73, .35), (2.5, 71, .6), (3.5, 69, .3)],
    [(0, 74, .4), (.75, 78, .65), (2, 76, .3), (2.75, 74, .6)],
    [(.25, 71, .55), (1.25, 69, .35), (2, 67, 1.0)],
    [(0, 69, .35), (.75, 74, .4), (1.5, 78, .6), (2.5, 76, .35), (3.5, 74, .25)],
    [(.25, 74, .6), (1.5, 76, .35), (2.25, 71, .5), (3.25, 67, .4)],
    [(0, 67, .4), (.75, 71, .4), (1.5, 76, .65), (2.75, 74, .4), (3.5, 71, .25)],
    [(.25, 73, .6), (1.5, 71, .35), (2.25, 69, 1.0), (3.75, 66, .15)],
]
PHRASE_B = [
    [(.25, 66, .35), (1, 69, .4), (1.75, 71, .4), (2.5, 74, 1.0)],
    [(0, 76, .45), (.75, 73, .35), (1.5, 71, .6), (2.75, 69, .7)],
    [(.25, 66, .35), (1, 69, .4), (1.75, 74, .4), (2.5, 78, .8)],
    [(0, 76, .45), (.75, 74, .35), (1.5, 71, .7), (2.75, 69, .65)],
    [(.25, 74, .4), (1, 78, .6), (2, 76, .35), (2.75, 74, .75)],
    [(0, 71, .5), (1, 74, .4), (1.75, 76, .4), (2.5, 74, 1.0)],
    [(.25, 71, .4), (1, 69, .4), (1.75, 67, .4), (2.5, 64, .8)],
    [(0, 66, .4), (.75, 69, .4), (1.5, 73, .4), (2.25, 76, .7), (3.5, 73, .25)],
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
    rhythm = np.zeros_like(piano)
    bass_track = np.zeros_like(piano)
    pitched = {}
    score = []

    def wrap_add(track, start, signal):
        # Write note/reverb tails around the boundary for a genuinely seamless loop.
        offset = round(start * RATE) % FRAMES
        first = min(len(signal), FRAMES - offset)
        track[offset:offset + first] += signal[:first]
        if first < len(signal):
            track[:len(signal) - first] += signal[first:]

    def note(start, midi, held, velocity, release=0.8):
        if midi not in pitched:
            source = min(samples, key=lambda key: abs(key - midi))
            step = 2 ** ((midi - source) / 12)
            sample = samples[source]
            positions = np.arange(0, min(len(sample) - 1, RATE * 9 * step), step)
            pitched[midi] = np.stack([
                np.interp(positions, np.arange(len(sample)), sample[:, channel])
                for channel in range(2)
            ], axis=1).astype(np.float32)
        count = min(len(pitched[midi]), round((held + release) * RATE))
        time = np.arange(count, dtype=np.float32) / RATE
        envelope = np.minimum(time / 0.004, 1)
        decay = np.clip((time - held) / release, 0, 1)
        envelope *= (1 - decay) ** 2
        signal = pitched[midi][:count] * (envelope * velocity)[:, None]
        wrap_add(piano, start, signal)
        score.append({'time': round(start, 3), 'midi': midi, 'hold': round(held, 3)})

    def centered(signal):
        return np.repeat(signal[:, None], 2, axis=1).astype(np.float32)

    def bass_note(start, midi, held, level):
        time = np.arange(round((held + .14) * RATE), dtype=np.float32) / RATE
        frequency = 440 * 2 ** ((midi - 69) / 12)
        phase = 2 * np.pi * frequency * time
        # Rounded fundamental plus quiet harmonics that remain audible on phones.
        wave = np.sin(phase) + .36 * np.sin(phase * 2) + .14 * np.sin(phase * 3)
        envelope = np.minimum(time / .008, 1) * np.exp(-time * 2.4)
        envelope *= np.clip((held + .14 - time) / .14, 0, 1) ** 2
        wrap_add(bass_track, start, centered(wave * envelope * level))

    # The percussion is synthesized here, with no additional sample dependencies.
    time = np.arange(round(.22 * RATE), dtype=np.float32) / RATE
    kick_phase = 2 * np.pi * (52 * time + 1.35 * (1 - np.exp(-time * 42)))
    kick = np.sin(kick_phase) * np.minimum(time / .003, 1) * np.exp(-time * 24)
    kick *= np.clip((.22 - time) / .045, 0, 1)
    time = np.arange(round(.19 * RATE), dtype=np.float32) / RATE
    noise = RNG.normal(size=len(time)).astype(np.float32)
    clap_noise = np.convolve(noise, np.ones(9) / 9, 'same')
    clap_noise -= np.convolve(noise, np.ones(71) / 71, 'same')
    clap_envelope = sum(np.where(time >= offset, np.exp(-np.maximum(0, time - offset) * 85), 0)
                        for offset in [.002, .013, .025])
    clap = clap_noise * clap_envelope * np.clip((.19 - time) / .06, 0, 1)

    def shaker(start, level, pan):
        time = np.arange(round(.075 * RATE), dtype=np.float32) / RATE
        noise = RNG.normal(size=len(time)).astype(np.float32)
        noise -= np.convolve(noise, np.ones(12) / 12, 'same')
        envelope = np.sin(np.pi * time / .075) ** 2 * np.exp(-time * 28)
        signal = noise * envelope * level
        stereo = np.stack([signal * (1 - pan * .25), signal * (1 + pan * .25)], axis=1)
        wrap_add(rhythm, start, stereo.astype(np.float32))

    for bar in range(BARS):
        section, harmony = divmod(bar, 8)
        bass, chord = CHORDS[harmony]
        origin = bar * BAR
        energy = [.82, .94, .9, 1.0, .74, .94, 1.0, .85][section]
        sparse = section == 4 and harmony < 4
        # Short syncopated chord stabs and a separate, buoyant bass line.
        for beat, indices in [(0, [0, 2]), (.75, [1, 3]), (1.5, [0, 2, 3]), (2.75, [1, 2, 3])]:
            if sparse and beat == .75:
                continue
            for voice, index in enumerate(indices):
                onset = origin + beat * BEAT + .018 + voice * .012
                note(onset, chord[index], BEAT * .24, RNG.uniform(.10, .14) * energy, .35)
        for beat, pitch, held in [(0, bass, .7), (1.5, bass + 7, .35), (2, bass + 12, .55), (3.25, bass + 7, .38)]:
            bass_note(origin + beat * BEAT, pitch, held * BEAT, .07 * energy)
        phrase = PHRASE_B if section in (2, 4, 5) else PHRASE_A
        melody = phrase[harmony]
        if sparse:
            melody = melody[::2]
        for beat, midi, held in melody:
            note(origin + .015 + beat * BEAT + RNG.uniform(-.01, .01), midi,
                 held * BEAT, RNG.uniform(.36, .44) * energy)

        for beat in ([0, 2] if sparse else [0, 1.75, 2.5]):
            wrap_add(rhythm, origin + beat * BEAT, centered(kick * .105 * energy))
        if not sparse:
            for beat in [1, 3]:
                wrap_add(rhythm, origin + beat * BEAT + .009, centered(clap * .075 * energy))
        for eighth in range(8):
            swing = .028 if eighth % 2 else 0
            level = (.009 if eighth % 2 else .0055) * energy
            shaker(origin + (eighth / 2 + swing) * BEAT, level, -1 if eighth % 2 else 1)

        # A very quiet pad retains the starfield's space behind the rhythm.
        length = BAR + 1.2
        time = np.arange(round(length * RATE), dtype=np.float32) / RATE
        envelope = np.sin(np.minimum(time / .6, 1) * np.pi / 2) ** 2
        envelope *= np.cos(np.clip((time - BAR + .3) / 1.5, 0, 1) * np.pi / 2) ** 2
        for midi in chord[:3]:
            frequency = 440 * 2 ** ((midi - 69) / 12)
            wave = np.zeros((len(time), 2), dtype=np.float32)
            for channel, detune in enumerate([0.9996, 1.0004]):
                phase = 2 * np.pi * frequency * detune * time
                tone = np.sin(phase) + 0.12 * np.sin(phase * 2)
                wave[:, channel] = tone * envelope * .0025 * energy
            wrap_add(pad, origin, wave)

    # Shorter reflections preserve the groove and the piano's articulation.
    mix = piano + pad + bass_track + rhythm
    for delay, level in [(.071, .10), (.137, .07), (.229, .045), (.347, .025)]:
        shift = round(delay * RATE)
        mix[:, 0] += np.roll(piano[:, 1], shift) * level
        mix[:, 1] += np.roll(piano[:, 0], shift + 193) * level
    mix -= np.mean(mix, axis=0)
    # Gentle peak rounding keeps the groove audible at a low playback volume.
    mix = np.tanh(mix * 1.25)
    mix *= .64 / np.max(np.abs(mix))
    output = ROOT / 'assets/starlight-piano.mp3'
    subprocess.run([
        args.ffmpeg, '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '2',
        '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k',
        '-metadata', 'title=Starlight - A Little Celebration',
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
