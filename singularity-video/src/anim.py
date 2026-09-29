"""애니메이션 보조 함수 (이징, 타이밍)."""
import math


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def lerp(a, b, t):
    return a + (b - a) * t


def ease_out(t):
    t = clamp01(t)
    return 1 - (1 - t) ** 3


def ease_in(t):
    t = clamp01(t)
    return t ** 3


def ease_io(t):
    t = clamp01(t)
    return 3 * t * t - 2 * t * t * t


def ease_io5(t):
    t = clamp01(t)
    return t * t * t * (t * (t * 6 - 15) + 10)


def back(t, s=1.7):
    t = clamp01(t)
    t -= 1
    return t * t * ((s + 1) * t + s) + 1


def bounce_in(t):
    """위에서 떨어져 톡 튀는 등장 (0→1, 약간 넘침)"""
    return back(t, 2.2)


def prog(t, t0, d):
    return clamp01((t - t0) / d) if d > 0 else (1.0 if t >= t0 else 0.0)


def bob(t, amp=1.0, speed=2.0, ph=0.0):
    return round(amp * math.sin(t * speed + ph))


def step(t, fps=8):
    """도트 애니메이션용 프레임 번호 (on twos 느낌)"""
    return int(t * fps)


def blink(t, period=3.7, ph=0.0, dur=0.12):
    return ((t + ph) % period) < dur


def pulse(t, speed=4.0):
    return 0.5 + 0.5 * math.sin(t * speed)


def shake(t, amp, seed=0):
    return (round(amp * math.sin(t * 53 + seed)), round(amp * math.sin(t * 41 + seed * 2.3)))
