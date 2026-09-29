"""효과음 · 칩튠 배경음악 합성, 그리고 나레이션과의 믹싱.

  python3 audio.py            → build/mix.wav (스테레오 48kHz, 라우드니스 -14 LUFS)
"""
import json
import math
import os
import random
import subprocess

import numpy as np
import soundfile as sf
from scipy.signal import butter, lfilter, sosfilt

import timeline
from paths import BUILD
from scenes import SFX

SR = 44100


# ── 기본 신호 ────────────────────────────────────────────────
def tt(n):
    return np.arange(n) / SR


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def osc(kind, f, n, duty=0.5, vib=0.0, vib_rate=5.0):
    t = tt(n)
    if np.ndim(f) == 0:
        phase = f * t
    else:
        phase = np.cumsum(f) / SR
    if vib:
        phase = phase + vib * np.sin(2 * np.pi * vib_rate * t) / (2 * np.pi * vib_rate)
    ph = phase % 1.0
    if kind == "pulse":
        return np.where(ph < duty, 1.0, -1.0)
    if kind == "tri":
        return 4 * np.abs(ph - 0.5) - 1
    if kind == "saw":
        return 2 * ph - 1
    return np.sin(2 * np.pi * ph)


def env(n, a=0.005, d=0.1, s=0.0, r=0.05):
    e = np.zeros(n)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = max(1, min(na, n))
    e[:na] = np.linspace(0, 1, na)
    k = na
    nd2 = max(0, min(nd, n - k))
    e[k:k + nd2] = np.linspace(1, s, nd2) if nd2 else e[k:k + nd2]
    k += nd2
    if k < n:
        e[k:] = s
    nr = min(nr, n)
    if nr > 0:
        e[n - nr:] *= np.linspace(1, 0, nr)
    return e


def expdecay(n, tau):
    return np.exp(-tt(n) / tau)


def noise(n, seed=0):
    return np.random.default_rng(seed).uniform(-1, 1, n)


def lp(x, fc, order=2):
    b, a = butter(order, min(0.99, fc / (SR / 2)), "low")
    return lfilter(b, a, x)


def hp(x, fc, order=2):
    b, a = butter(order, min(0.99, fc / (SR / 2)), "high")
    return lfilter(b, a, x)


def bp(x, f0, f1, order=2):
    sos = butter(order, [f0 / (SR / 2), min(0.99, f1 / (SR / 2))], "band", output="sos")
    return sosfilt(sos, x)


def sweep(f0, f1, n, curve="exp"):
    k = np.linspace(0, 1, n)
    if curve == "exp":
        return f0 * (f1 / f0) ** k
    return f0 + (f1 - f0) * k


def secs(s):
    return int(s * SR)


# ── 효과음 ──────────────────────────────────────────────────
def sfx_pop():
    n = secs(0.09)
    return osc("sine", sweep(500, 1300, n), n) * expdecay(n, 0.03) * 0.8


def sfx_blip():
    a = osc("pulse", 988, secs(0.05), 0.25) * env(secs(0.05), 0.002, 0.05, 0.3, 0.01)
    b = osc("pulse", 1319, secs(0.08), 0.25) * env(secs(0.08), 0.002, 0.08, 0.0, 0.02)
    return lp(np.concatenate([a, b]), 5000) * 0.35


def sfx_tick():
    n = secs(0.03)
    return lp(osc("pulse", 2200, n, 0.5) * expdecay(n, 0.006), 6000) * 0.4


def sfx_whoosh():
    n = secs(0.6)
    x = noise(n, 3)
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 2
    fc = sweep(300, 3500, n)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    out = np.zeros(n)
    y = 0.0
    for i in range(n):
        y += a[i] * (x[i] - y)
        out[i] = y
    return out * e * 0.9


def sfx_shimmer():
    out = np.zeros(secs(1.2))
    for i, m in enumerate((84, 88, 91, 96, 100)):
        n = secs(0.9)
        s = secs(0.05 * i)
        out[s:s + n] += osc("tri", midi(m), n) * expdecay(n, 0.25) * 0.25
    return out


def sfx_type():
    n = secs(0.04)
    return (hp(noise(n, 7), 2000) * expdecay(n, 0.004) * 0.6 + osc("sine", 180, n) * expdecay(n, 0.01) * 0.3)


def sfx_ding():
    n = secs(1.2)
    return (osc("sine", 2093, n) * 0.4 + osc("sine", 3136, n) * 0.2) * expdecay(n, 0.35) * 0.5


def sfx_glitch():
    rnd = random.Random(5)
    parts = []
    for i in range(8):
        n = secs(rnd.uniform(0.015, 0.04))
        parts.append(osc("pulse", rnd.choice([110, 220, 440, 880, 1760, 3520]), n, 0.25) * 0.35)
        if rnd.random() < 0.3:
            parts.append(np.zeros(secs(0.01)))
    x = np.concatenate(parts)
    return np.round(x * 4) / 4


def sfx_title():
    n = secs(2.4)
    out = np.zeros(n)
    for m in (48, 55, 60, 64, 67, 72):
        out += osc("pulse", midi(m), n, 0.25) * 0.12 + osc("saw", midi(m) * 1.003, n) * 0.06
    out = lp(out, 2400) * env(n, 0.01, 0.3, 0.6, 1.8)
    sub = osc("sine", 65.4, n) * expdecay(n, 0.6) * 0.5
    riser = hp(noise(n, 1), 3000) * np.exp(-tt(n) / 0.4) * 0.15
    return out + sub + riser


def sfx_rumble():
    n = secs(2.0)
    x = lp(noise(n, 2), 90, 2) * 3 + osc("sine", 42, n) * 0.4
    return x * env(n, 0.3, 0.5, 0.6, 1.0) * 0.8


def sfx_thud():
    n = secs(0.3)
    return (osc("sine", sweep(120, 45, n), n) * expdecay(n, 0.08) * 0.9 +
            lp(noise(n, 4), 800) * expdecay(n, 0.02) * 0.4)


def sfx_rewind():
    n = secs(0.9)
    f = 600 + 400 * np.sin(2 * np.pi * 7 * tt(n)) + np.linspace(400, -200, n)
    return lp(osc("pulse", np.maximum(f, 80), n, 0.3), 4000) * env(n, 0.02, 0.1, 0.7, 0.2) * 0.25


def sfx_sting():
    n = secs(1.4)
    out = np.zeros(n)
    for m in (45, 48, 52, 57):
        out += osc("pulse", midi(m) * sweep(1.0, 0.97, n, "lin"), n, 0.5) * 0.1
    return lp(out, 1800) * env(n, 0.005, 0.2, 0.5, 1.0)


def sfx_power():
    n = secs(0.6)
    return lp(osc("pulse", sweep(180, 900, n), n, 0.25), 5000) * env(n, 0.01, 0.1, 0.8, 0.15) * 0.25


def sfx_error():
    a = osc("pulse", 220, secs(0.12), 0.5) * env(secs(0.12), 0.002, 0.05, 0.7, 0.02)
    b = osc("pulse", 165, secs(0.22), 0.5) * env(secs(0.22), 0.002, 0.1, 0.6, 0.05)
    return lp(np.concatenate([a, np.zeros(secs(0.04)), b]), 3000) * 0.3


def sfx_levelup():
    parts = []
    for m in (72, 76, 79, 84):
        n = secs(0.045)
        parts.append(osc("pulse", midi(m), n, 0.25) * env(n, 0.001, 0.04, 0.6, 0.005))
    n = secs(0.25)
    parts.append(osc("pulse", midi(88), n, 0.25) * expdecay(n, 0.08))
    return lp(np.concatenate(parts), 6000) * 0.3


def sfx_boom():
    n = secs(3.0)
    body = lp(noise(n, 9), 300, 2) * np.exp(-tt(n) / 0.7) * 2.2
    sub = osc("sine", sweep(90, 28, n), n) * np.exp(-tt(n) / 0.9) * 0.9
    crack = hp(noise(n, 10), 2000) * np.exp(-tt(n) / 0.08) * 0.5
    chord = np.zeros(n)
    for m in (40, 47, 52, 59, 64):
        chord += osc("saw", midi(m), n) * 0.06
    chord = lp(chord, 1500) * env(n, 0.01, 0.4, 0.5, 2.0)
    return body + sub + crack + chord


def sfx_chain():
    out = np.zeros(secs(0.6))
    rnd = random.Random(8)
    for i in range(5):
        n = secs(0.12)
        s = secs(i * 0.07 + rnd.uniform(0, 0.02))
        x = bp(noise(n, 20 + i), 2500, 7000) * expdecay(n, 0.03)
        x += osc("sine", rnd.uniform(3000, 4500), n) * expdecay(n, 0.05) * 0.3
        out[s:s + n] += x * 0.5
    return out


def sfx_zap():
    n = secs(0.25)
    return lp(osc("pulse", sweep(2400, 200, n), n, 0.25), 6000) * expdecay(n, 0.1) * 0.3


def sfx_rise():
    n = secs(1.4)
    x = hp(noise(n, 12), 1500) * np.linspace(0, 1, n) ** 2 * 0.25
    x += osc("tri", sweep(200, 1200, n), n) * np.linspace(0, 1, n) ** 2 * 0.2
    x[-secs(0.05):] *= np.linspace(1, 0, secs(0.05))
    return x


def sfx_flip():
    n = secs(0.07)
    return bp(noise(n, 13), 1500, 6000) * env(n, 0.005, 0.06, 0.0, 0.01) * 0.6


def sfx_hop():
    n = secs(0.08)
    return lp(osc("pulse", sweep(350, 800, n), n, 0.25), 5000) * env(n, 0.002, 0.07, 0.0, 0.01) * 0.25


def sfx_stone():
    n = secs(0.08)
    return (bp(noise(n, 14), 1500, 5000) * expdecay(n, 0.006) * 0.8 +
            osc("sine", 1250, n) * expdecay(n, 0.02) * 0.3)


def sfx_chime():
    n = secs(2.0)
    out = np.zeros(n)
    for i, m in enumerate((72, 79, 84, 88)):
        s = secs(i * 0.06)
        k = n - s
        out[s:] += osc("tri", midi(m), k) * expdecay(k, 0.6) * 0.18
    return out


def sfx_hum():
    n = secs(2.0)
    return lp(osc("saw", 110, n, vib=3, vib_rate=4), 500) * env(n, 0.4, 0.2, 0.8, 0.8) * 0.15


def sfx_stamp():
    return np.concatenate([sfx_thud() * 1.2, np.zeros(secs(0.05))]) + \
        np.pad(lp(noise(secs(0.12), 15), 2500) * expdecay(secs(0.12), 0.03) * 0.5, (0, secs(0.23)))


def sfx_gold():
    out = np.zeros(secs(1.0))
    for i, m in enumerate((88, 91, 96, 100, 103)):
        n = secs(0.6)
        s = secs(i * 0.035)
        out[s:s + n] += osc("sine", midi(m), n) * expdecay(n, 0.15) * 0.2
    return out


def sfx_water():
    n = secs(2.6)
    x = lp(noise(n, 16), 700, 2) * 1.5
    x *= 0.6 + 0.4 * np.sin(2 * np.pi * 1.3 * tt(n)) ** 2
    return x * env(n, 0.6, 0.5, 0.7, 1.0) * 0.6


SFX_FN = {k[4:]: v for k, v in globals().items() if k.startswith("sfx_")}


# ── 음악 ────────────────────────────────────────────────────
C = {
    "Am": [57, 60, 64], "F": [53, 57, 60], "C": [48, 52, 55], "G": [55, 59, 62], "Dm": [50, 53, 57],
    "Bb": [46, 50, 53], "Gm": [55, 58, 62], "A": [57, 61, 64], "Em": [52, 55, 59], "D": [50, 54, 57],
    "E": [52, 56, 59], "Fmaj7": [53, 57, 60, 64], "Cmaj7": [48, 52, 55, 59], "Am7": [57, 60, 64, 67],
    "Em7": [52, 55, 59, 62], "Dm7": [50, 53, 57, 60], "Gsus": [55, 60, 62], "Bbmaj7": [46, 50, 53, 57],
}

# 씬 묶음별 음악 설정
SECTIONS = [
    dict(scenes=("inventions", "good_quote"), bpm=88, chords=["Am7", "Fmaj7", "C", "G"], bars=1,
         pad=0.8, arp=0.5, arp_div=2, bass=0.5, drums=0, bell=0.5),
    dict(scenes=("title",), bpm=88, chords=["Am"], bars=4, pad=1.0, arp=0.0, bass=0.3, drums=0, bell=0.0),
    dict(scenes=("blackhole", "vinge"), bpm=72, chords=["Dm7", "Bbmaj7", "Gm", "A"], bars=1,
         pad=1.0, arp=0.45, arp_div=2, bass=0.5, drums=0, bell=0.6, dark=True),
    dict(scenes=("chessboard", "lilypond", "moore", "brain"), bpm=108, chords=["C", "G", "Am", "F"], bars=1,
         pad=0.6, arp=0.55, arp_div=4, bass=0.7, drums=1, bell=0.3),
    dict(scenes=("explosion", "speed"), bpm=116, chords=["Em", "C", "G", "D"], bars=1,
         pad=0.7, arp=0.6, arp_div=4, bass=0.8, drums=1, bell=0.3, ramp=True),
    dict(scenes=("staircase",), bpm=116, chords=["C", "D", "Em", "G"], bars=1,
         pad=0.8, arp=0.6, arp_div=4, bass=0.7, drums=2, bell=0.4),
    dict(scenes=("history",), bpm=100, chords=["Am", "G", "F", "E"], bars=1,
         pad=0.6, arp=0.5, arp_div=4, bass=0.8, drums=1, bell=0.2),
    dict(scenes=("utopia",), bpm=96, chords=["Fmaj7", "C", "G", "Am7"], bars=1,
         pad=0.9, arp=0.55, arp_div=4, bass=0.6, drums=1, bell=0.6),
    dict(scenes=("midas", "paperclip"), bpm=76, chords=["Dm", "Bb", "Gm", "A"], bars=1,
         pad=0.9, arp=0.35, arp_div=2, bass=0.8, drums=3, bell=0.2, dark=True),
    dict(scenes=("skeptic",), bpm=90, chords=["Am", "Em", "F", "C"], bars=1,
         pad=0.7, arp=0.4, arp_div=2, bass=0.5, drums=0, bell=0.4),
    dict(scenes=("ending", "endcard"), bpm=76, chords=["Fmaj7", "G", "Em7", "Am7"], bars=1,
         pad=1.0, arp=0.45, arp_div=2, bass=0.5, drums=0, bell=0.7, final=True),
]


def delay(x, sec, fb=0.35, mix=0.3):
    d = secs(sec)
    y = x.copy()
    for k in range(1, 5):
        g = mix * fb ** (k - 1)
        if d * k >= len(x):
            break
        y[d * k:] += x[:-d * k] * g
    return y


def render_section(sec, t0, t1):
    """t0~t1 (초) 구간의 음악. 앞뒤로 여유를 두고 페이드."""
    pre, post = 1.0, 2.0
    start = t0 - pre
    n = secs(t1 - start + post)
    L = np.zeros(n)
    R = np.zeros(n)
    beat = 60.0 / sec["bpm"]
    bar = beat * 4
    chords = [C[c] for c in sec["chords"]]
    nb = int(math.ceil((t1 - t0 + post) / bar)) + 1
    dark = sec.get("dark", False)
    for b in range(-1, nb):
        ch = chords[(b // sec.get("bars", 1)) % len(chords)] if b >= 0 else chords[-1]
        bt = t0 + b * bar
        s = secs(bt - start)
        if s >= n:
            break
        ramp = 1.0
        if sec.get("ramp"):
            ramp = 0.5 + 0.5 * min(1.0, max(0.0, (bt - t0) / max(1.0, t1 - t0)))
        # 패드
        if sec["pad"] > 0:
            k = secs(bar * 1.25)
            pad = np.zeros(k)
            for m in ch:
                f = midi(m)
                pad += osc("pulse", f, k, 0.5) * 0.5 + osc("pulse", f * 1.006, k, 0.35) * 0.5
            pad = lp(pad, 900 if dark else 1400) * env(k, 0.35, 0.3, 0.8, 0.5) * 0.05 * sec["pad"]
            _add(L, s, pad)
            _add(R, s, pad)
        # 베이스
        if sec["bass"] > 0:
            root = ch[0]
            while root > 47:
                root -= 12
            while root < 36:
                root += 12
            for i in range(8):
                if sec["drums"] == 3 and i % 4 != 0:
                    continue
                k = secs(beat / 2 * 0.9)
                note = root + (12 if i % 4 == 3 and not dark else 0)
                x = osc("tri", midi(note), k) * env(k, 0.005, 0.1, 0.6, 0.03) * 0.22 * sec["bass"]
                _add(L, s + secs(i * beat / 2), x)
                _add(R, s + secs(i * beat / 2), x)
        # 아르페지오 (스테레오 딜레이)
        if sec["arp"] > 0:
            div = sec.get("arp_div", 4)
            steps = 4 * div
            tones = ch + [ch[0] + 12, ch[1] + 12]
            for i in range(steps):
                m = tones[[0, 1, 2, 3, 2, 1, 4, 3][i % 8] % len(tones)] + 12
                k = secs(beat / div * 1.6)
                x = osc("pulse", midi(m), k, 0.125) * env(k, 0.002, beat / div, 0.15, 0.05)
                x = lp(x, 3200) * 0.05 * sec["arp"] * ramp
                pos = s + secs(i * beat / div)
                _add(L, pos, x)
                _add(R, pos + secs(0.012), x * 0.8)
        # 벨 (마디 첫 박)
        if sec.get("bell", 0) > 0:
            k = secs(bar * 1.2)
            m = ch[-1] + 24
            x = osc("tri", midi(m), k) * expdecay(k, 0.8) * 0.06 * sec["bell"]
            x += osc("sine", midi(m) * 2, k) * expdecay(k, 0.3) * 0.02 * sec["bell"]
            _add(L, s, x * 0.9)
            _add(R, s + secs(0.02), x)
        # 드럼
        d = sec["drums"]
        if d:
            for i in range(8):
                pos = s + secs(i * beat / 2)
                if d in (1, 2) and i in (0, 4):
                    _add_both(L, R, pos, _kick() * 0.5 * ramp)
                if d == 2 and i in (3, 6):
                    _add_both(L, R, pos, _kick() * 0.35)
                if d in (1, 2) and i in (2, 6):
                    _add_both(L, R, pos, _snare() * 0.25 * ramp)
                if d in (1, 2):
                    _add_both(L, R, pos, _hat() * (0.12 if i % 2 else 0.07) * ramp)
                if d == 3 and i in (0, 1):
                    _add_both(L, R, pos + (secs(0.18) if i == 1 else 0), _kick() * 0.4)
    # 섹션 페이드
    fade_in, fade_out = secs(pre), secs(post)
    g = np.ones(n)
    g[:fade_in] = np.linspace(0, 1, fade_in)
    g[-fade_out:] = np.linspace(1, 0, fade_out)
    if sec.get("final"):
        g[-fade_out:] = 1.0
    L = delay(L * g, beat * 0.75, 0.35, 0.22)
    R = delay(R * g, beat * 0.75 + 0.03, 0.35, 0.22)
    return start, L, R


_DRUM = {}


def _kick():
    if "k" not in _DRUM:
        n = secs(0.25)
        _DRUM["k"] = osc("sine", sweep(150, 45, n), n) * expdecay(n, 0.07)
    return _DRUM["k"]


def _snare():
    if "s" not in _DRUM:
        n = secs(0.18)
        _DRUM["s"] = bp(noise(n, 30), 1200, 7000) * expdecay(n, 0.05) + osc("tri", 190, n) * expdecay(n, 0.03) * 0.4
    return _DRUM["s"]


def _hat():
    if "h" not in _DRUM:
        n = secs(0.05)
        _DRUM["h"] = hp(noise(n, 31), 7000) * expdecay(n, 0.012)
    return _DRUM["h"]


def _add(buf, pos, x):
    if pos >= len(buf) or pos + len(x) <= 0:
        return
    a = max(0, pos)
    b = min(len(buf), pos + len(x))
    buf[a:b] += x[a - pos: b - pos]


def _add_both(L, R, pos, x):
    _add(L, pos, x)
    _add(R, pos, x)


# ── 믹스 ────────────────────────────────────────────────────
def build_mix(voice_dir=None, out=None):
    scenes = timeline.build(voice_dir)
    total = timeline.total(scenes)
    n = secs(total) + SR
    by_id = {s.id: s for s in scenes}
    # 나레이션
    voice = np.zeros(n)
    for s in scenes:
        for cue, f in zip(s.cues, s.files):
            x, sr = sf.read(f, dtype="float32")
            if x.ndim > 1:
                x = x.mean(1)
            if sr != SR:  # 직접 녹음한 파일 등
                from math import gcd
                from scipy.signal import resample_poly
                g = gcd(SR, sr)
                x = resample_poly(x, SR // g, sr // g)
            _add(voice, secs(s.start + cue), x.astype(np.float64))
    # 효과음
    fx = np.zeros(n)
    events = []
    for s in scenes:
        fn = SFX.get(s.id)
        if not fn:
            continue
        for lt, name, vol in fn(s):
            events.append((max(0.0, s.start + lt), name, vol))
    cache = {}
    for t, name, vol in events:
        if name not in cache:
            cache[name] = SFX_FN[name]().astype(np.float64)
        _add(fx, secs(t), cache[name] * vol)
    fx = lp(fx, 9000)
    # 음악
    mL = np.zeros(n)
    mR = np.zeros(n)
    for sec in SECTIONS:
        t0 = by_id[sec["scenes"][0]].start
        t1 = by_id[sec["scenes"][-1]].end
        st, L, R = render_section(sec, t0, t1)
        if sec.get("final"):
            k = min(len(L), n - secs(st))
            tail = np.linspace(1, 0, secs(3.0))
            end = secs(total - st)
            L = L[:end]
            R = R[:end]
            L[-len(tail):] *= tail
            R[-len(tail):] *= tail
        _add(mL, secs(st), L)
        _add(mR, secs(st), R)
    # 나레이션 사이드체인 덕킹
    envv = np.abs(voice)
    win = secs(0.05)
    envv = np.convolve(envv, np.ones(win) / win, mode="same")
    envv = np.clip(envv / 0.05, 0, 1)
    # 느린 릴리즈
    rel = secs(0.4)
    envv = np.convolve(envv, np.ones(rel) / rel, mode="same")
    duck = 1.0 - 0.5 * np.clip(envv * 1.5, 0, 1)
    music_gain = 0.42
    fx = np.tanh(fx * 0.7 / 0.8) * 0.8   # 효과음 버스 소프트 리미터
    L = voice + fx + mL * duck * music_gain
    R = voice + fx + mR * duck * music_gain
    st = np.stack([L, R], 1)
    peak = np.abs(st).max()
    st = st / max(1.0, peak / 0.98)
    raw = os.path.join(BUILD, "mix_raw.wav")
    sf.write(raw, st.astype(np.float32), SR, subtype="FLOAT")
    # 개별 스템도 저장 (재편집용)
    sf.write(os.path.join(BUILD, "stem_voice.wav"), voice.astype(np.float32), SR, subtype="FLOAT")
    sf.write(os.path.join(BUILD, "stem_music.wav"), np.stack([mL, mR], 1).astype(np.float32), SR, subtype="FLOAT")
    sf.write(os.path.join(BUILD, "stem_sfx.wav"), fx.astype(np.float32), SR, subtype="FLOAT")
    out = out or os.path.join(BUILD, "mix.wav")
    loudnorm(raw, out)
    print("wrote", out, f"{total:.2f}s", "events", len(events))


def loudnorm(src, dst, I=-14.0, TP=-1.5, LRA=11.0):
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    p = subprocess.run([ff, "-hide_banner", "-i", src, "-af", f"loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    txt = p.stderr
    js = json.loads(txt[txt.rindex("{"): txt.rindex("}") + 1])
    af = (f"loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
          f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}:"
          f"linear=true")
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-af", af, "-ar", "48000", dst],
                   check=True)
    print("loudness in:", js["input_i"], "LUFS →", I)


if __name__ == "__main__":
    build_mix()
