"""씬에서 공통으로 쓰는 소품/연출 도우미."""
import math
import random

import numpy as np

from anim import back, clamp01, ease_out, prog
from gfx import BAYER_FULL, H, P, W, font, mix, sprite, outline_sprite


# ── 등장 연출 ────────────────────────────────────────────────
def appear(t, t0, d=0.35):
    """디더 페이드 인 알파"""
    return clamp01((t - t0) / d)


def vanish(t, t0, d=0.35):
    return 1 - clamp01((t - t0) / d)


def drop(t, t0, h=14, d=0.45):
    """위에서 톡 떨어지는 y 오프셋 (등장 전에는 None)"""
    if t < t0:
        return None
    return -round(h * (1 - back(prog(t, t0, d), 2.0)))


def pop_scale(t, t0, d=0.3):
    """정수 스케일 팝: 0 → 등장 전, 1 → 보통"""
    return 0 if t < t0 else 1


# ── 배경 ────────────────────────────────────────────────────
def sky(c, top, bottom, y0=0, y1=H):
    c.vgrad(y0, y1, top, bottom)


def space(c, t, seed=1, drift=0.0, n=150):
    from gfx import stars
    c.fill(P["night0"])
    c.vgrad(0, H, P["night0"], P["night1"])
    stars(c, t, seed=seed, n=n, drift=drift)


def glow(c, cx, cy, r, col, strength=0.6, rings=4):
    """디더 동심원 헤일로"""
    for i in range(rings, 0, -1):
        rr = r * i / rings
        c.circle(cx, cy, rr, col, alpha=strength * (1 - (i - 1) / rings) * 0.9)


def vignette(c, amount=0.5, col=None):
    col = col or P["night0"]
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    m = (d - 0.85) * 2.2 * amount > BAYER_FULL[:H, :W]
    c.a[m] = col


def clipped(c, x, y, w, h, fn):
    """fn(tmp) 로 그린 결과 중 (x, y, w, h) 영역만 반영"""
    tmp = c.copy()
    tmp.ox, tmp.oy = c.ox, c.oy
    fn(tmp)
    x, y = int(x + c.ox), int(y + c.oy)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 > x0 and y1 > y0:
        c.a[y0:y1, x0:x1] = tmp.a[y0:y1, x0:x1]


# ── UI 소품 ─────────────────────────────────────────────────
def panel(c, x, y, w, h, col=None, border=None, alpha=1.0, r=3, shadow=True):
    col = col or P["night2"]
    border = border or P["ink"]
    if shadow:
        c.rrect(x + 2, y + 2, w, h, r, P["black"], alpha=alpha * 0.6)
    c.rrect(x, y, w, h, r, col, alpha=alpha, outline=border)


def tag(c, text, x, y, fg=None, bg=None, fnt="g9", align="center", alpha=1.0, pad=3, border=None):
    """알약 모양 라벨. (x, y) = 기준점 (align 에 따라)"""
    fg = fg or P["white"]
    bg = bg or P["ink"]
    f = font(fnt)
    tw = f.width(text)
    th = f.height
    w, h = tw + pad * 2 + 1, th + 2
    if align == "center":
        x0 = x - w // 2
    elif align == "right":
        x0 = x - w
    else:
        x0 = x
    c.rrect(x0, y, w, h, 3, bg, alpha=alpha, outline=border)
    c.text(text, x0 + pad + 1, y + 1, fg, fnt, alpha=alpha)
    return w, h


def bubble(c, text, x, y, tx=None, ty=None, fnt="g9", fg=None, bg=None, alpha=1.0, reveal=None, pad=4):
    """말풍선. (x, y) = 풍선 중앙 하단, (tx, ty) = 꼬리 끝"""
    fg = fg or P["ink"]
    bg = bg or P["white"]
    f = font(fnt)
    tw = f.width(text)
    lines = text.count("\n") + 1
    th = lines * (f.height + 2) - 2
    w, h = tw + pad * 2, th + pad * 2 - 1
    x0, y0 = x - w // 2, y - h
    if tx is not None:
        c.poly([(x - 3, y - 1), (x + 3, y - 1), (tx, ty)], bg, alpha=alpha)
        c.line(x - 3, y, tx, ty, P["ink"], alpha=alpha)
        c.line(x + 3, y, tx, ty, P["ink"], alpha=alpha)
    c.rrect(x0, y0, w, h, 4, bg, alpha=alpha, outline=P["ink"])
    if tx is not None:
        c.line(x - 2, y - 1, x + 2, y - 1, bg, alpha=alpha)
    c.text(text, x0 + pad, y0 + pad - 1, fg, fnt, alpha=alpha, reveal=reveal)


def arrow(c, x0, y0, x1, y1, col, head=4, width=1, alpha=1.0):
    c.line(x0, y0, x1, y1, col, width=width, alpha=alpha)
    a = math.atan2(y1 - y0, x1 - x0)
    for s in (-1, 1):
        hx = x1 - head * math.cos(a + s * 0.6)
        hy = y1 - head * math.sin(a + s * 0.6)
        c.line(x1, y1, hx, hy, col, width=width, alpha=alpha)


def curved_arrow(c, cx, cy, r, a0, a1, col, head=4, width=1, alpha=1.0):
    """원호 화살표 (라디안, a0→a1)"""
    n = max(4, int(abs(a1 - a0) * r / 2))
    pts = [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n))
           for i in range(n + 1)]
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        c.line(x0, y0, x1, y1, col, width=width, alpha=alpha)
    x1, y1 = pts[-1]
    x0, y0 = pts[-2]
    a = math.atan2(y1 - y0, x1 - x0)
    for s in (-1, 1):
        c.line(x1, y1, x1 - head * math.cos(a + s * 0.6), y1 - head * math.sin(a + s * 0.6), col,
               width=width, alpha=alpha)


def burst(c, cx, cy, t, t0, n=14, col=None, col2=None, speed=60, life=0.8, seed=3, size=1):
    """방사형 입자 폭발 (t0 에 시작)"""
    dt = t - t0
    if dt < 0 or dt > life:
        return
    rnd = random.Random(seed)
    col = col or P["yellow"]
    col2 = col2 or P["white"]
    for i in range(n):
        a = rnd.random() * 6.283
        v = speed * (0.4 + rnd.random() * 0.8)
        d = v * dt * (1 - dt / (2 * life))
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
        k = dt / life
        cc = col2 if k < 0.3 else col
        if size > 1 and k < 0.6:
            c.rect(x - 1, y - 1, 2, 2, cc)
        else:
            c.px(x, y, cc)


def sparkle(c, x, y, t, col=None, period=1.2, ph=0.0, size=2):
    col = col or P["white"]
    k = ((t + ph) % period) / period
    if k > 0.5:
        return
    s = round(size * math.sin(k / 0.5 * math.pi))
    c.px(x, y, col)
    for i in range(1, s + 1):
        c.px(x + i, y, col)
        c.px(x - i, y, col)
        c.px(x, y + i, col)
        c.px(x, y - i, col)


def counter_text(v):
    """정수를 1,234 식으로"""
    return f"{int(v):,}"


def typewriter(c, text, x, y, col, t, t0, t1, fnt="g11", **kw):
    r = clamp01((t - t0) / max(0.01, t1 - t0))
    c.text(text, x, y, col, fnt, reveal=r, **kw)


def qmark(c, x, y, t, col=None, scale=1, ph=0.0):
    col = col or P["yellow"]
    dy = round(math.sin(t * 3 + ph) * 1.5)
    c.text("?", x, y + dy, col, "g11b", align="center", outline=P["ink"], scale=scale)


def ground(c, y, col, col2=None, h=None):
    h = H - y if h is None else h
    c.rect(0, y, W, h, col)
    if col2:
        c.rect(0, y, W, 1, col2)


def scanlines(c, alpha=0.18):
    c.a[::2] = (c.a[::2].astype(np.float32) * (1 - alpha)).astype(np.uint8)


def noise_rect(c, x, y, w, h, t, cols, density=0.5, fps=12, seed=0):
    """TV 잡음 같은 도트 노이즈"""
    x, y = int(x), int(y)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    rng = np.random.default_rng(int(t * fps) * 7919 + seed)
    r = rng.random((y1 - y0, x1 - x0))
    sub = c.a[y0:y1, x0:x1]
    k = len(cols)
    for i, col in enumerate(cols):
        m = (r < density * (i + 1) / k) & (r >= density * i / k)
        sub[m] = col


# ── 아이콘 ──────────────────────────────────────────────────
def fire(c, cx, by, t, s=1.0):
    fl = [math.sin(t * 17 + i) for i in range(3)]
    c.poly([(cx - 7 * s, by), (cx + 7 * s, by), (cx + 2 * s, by - (14 + fl[0] * 2) * s), (cx - 1 * s, by - 8 * s),
            (cx - 3 * s, by - (12 + fl[1] * 2) * s)], P["orange"])
    c.poly([(cx - 4 * s, by), (cx + 4 * s, by), (cx + 1 * s, by - (9 + fl[2] * 2) * s), (cx - 2 * s, by - 6 * s)],
           P["yellow"])
    c.rect(cx - 8 * s, by, 16 * s, 2, P["brown"])
    c.rect(cx - 6 * s, by + 2, 12 * s, 1, P["dbrown"])


def wheel(c, cx, cy, r, t, col=None):
    col = col or P["brown"]
    c.circle(cx, cy, r, P["ink"])
    c.circle(cx, cy, r - 1, col)
    c.circle(cx, cy, r - 3, P["dbrown"])
    c.circle(cx, cy, r - 4, col)
    a0 = t * 3
    for i in range(4):
        a = a0 + i * math.pi / 2
        c.line(cx, cy, cx + math.cos(a) * (r - 3), cy + math.sin(a) * (r - 3), P["dbrown"])
    c.circle(cx, cy, 2, P["dbrown"])


def tablet(c, cx, cy):
    c.rrect(cx - 9, cy - 11, 18, 22, 2, P["sand"], outline=P["dbrown"])
    for i in range(5):
        y = cy - 7 + i * 4
        for j in range(3):
            x = cx - 6 + j * 5
            c.line(x, y, x + 2, y + 1, P["dbrown"])
            c.px(x + 1, y + 2, P["dbrown"])


def bulb(c, cx, cy, t, on=True):
    if on:
        c.circle(cx, cy - 2, 13, P["yellow"], alpha=0.25)
    c.circle(cx, cy - 2, 7, P["ink"])
    c.circle(cx, cy - 2, 6, P["yellow"] if on else P["light"])
    c.px(cx - 3, cy - 5, P["white"])
    c.px(cx - 2, cy - 6, P["white"])
    c.rect(cx - 3, cy + 4, 7, 5, P["grey"])
    c.frame(cx - 3, cy + 4, 7, 5, P["ink"])
    c.line(cx - 3, cy + 6, cx + 3, cy + 6, P["ink"])
    c.line(cx - 1, cy, cx - 1, cy + 3, P["dorange"])
    c.line(cx + 1, cy, cx + 1, cy + 3, P["dorange"])


def computer(c, cx, cy, t, screen=None):
    screen = screen or P["dteal"]
    c.rrect(cx - 13, cy - 11, 26, 20, 2, P["light"], outline=P["ink"])
    c.rect(cx - 10, cy - 8, 20, 13, screen)
    for i in range(3):
        w = [12, 8, 15][i]
        if (t * 2 + i) % 3 < 2.2:
            c.rect(cx - 8, cy - 6 + i * 4, w, 1, P["green"])
    if int(t * 3) % 2:
        c.rect(cx - 8 + 4, cy + 2, 2, 1, P["green"])
    c.rect(cx - 5, cy + 9, 10, 2, P["grey"])
    c.rrect(cx - 12, cy + 11, 24, 4, 1, P["light"], outline=P["ink"])


def mystery_box(c, cx, cy, t, open_k=0.0, glow_k=1.0):
    g = 0.5 + 0.5 * math.sin(t * 3)
    if glow_k > 0:
        glow(c, cx, cy, 30 + 3 * g, P["cyan"], strength=0.35 * glow_k)
    c.rrect(cx - 14, cy - 12, 28, 26, 3, P["ink"])
    c.rrect(cx - 13, cy - 11, 26, 24, 2, P["night2"])
    c.frame(cx - 13, cy - 11, 26, 24, P["cyan"])
    c.rect(cx - 13, cy - 3, 26, 1, P["dteal"])
    c.text("?", cx, cy - 8, mix(P["cyan"], P["white"], g), "g11b", align="center")


def chip(c, cx, cy, s=12, col=None, t=0.0, lit=0.0):
    col = col or P["dgrey"]
    for i in range(-s + 3, s - 2, 3):
        c.rect(cx + i, cy - s - 2, 1, 2, P["light"])
        c.rect(cx + i, cy + s, 1, 2, P["light"])
        c.rect(cx - s - 2, cy + i, 2, 1, P["light"])
        c.rect(cx + s, cy + i, 2, 1, P["light"])
    c.rect(cx - s, cy - s, 2 * s, 2 * s, P["ink"])
    c.rect(cx - s + 1, cy - s + 1, 2 * s - 2, 2 * s - 2, col)
    if lit > 0:
        c.rect(cx - s + 3, cy - s + 3, 2 * s - 6, 2 * s - 6, P["cyan"], alpha=lit)


def brain(c, cx, cy, s=1, col=None, col2=None):
    col = col or P["pink"]
    col2 = col2 or (206, 80, 130)
    spr = BRAIN_O
    k = s
    c.blit(spr, cx - spr.shape[1] * k // 2, cy - spr.shape[0] * k // 2, scale=k)


BRAIN = sprite([
    "....pppp.pppp....",
    "..ppppqpppqpppp..",
    ".ppqppppqpppqppp.",
    "pppppqqpppqqppppp",
    "ppqppppppppppqppp",
    "pppqqppqpqpppqqpp",
    "ppppppqpppqpppppp",
    ".pppqppppppqppp..",
    "..pppppqqpppppp..",
    "....ppppp.ppp....",
    "........pp.......",
], {"p": P["pink"], "q": (200, 70, 130)})
BRAIN_O = outline_sprite(BRAIN, P["ink"])


def paperclip(c, x, y, col=None, s=1):
    col = col or P["light"]
    pts = [(x, y + 8 * s), (x, y + 1 * s), (x + 1 * s, y), (x + 3 * s, y), (x + 4 * s, y + 1 * s),
           (x + 4 * s, y + 10 * s), (x + 3 * s, y + 11 * s), (x + 2 * s, y + 11 * s), (x + 1 * s, y + 10 * s),
           (x + 1 * s, y + 3 * s), (x + 2 * s, y + 2 * s), (x + 3 * s, y + 3 * s), (x + 3 * s, y + 8 * s)]
    c.polyline(pts, col)


def gear(c, cx, cy, r, t, col=None, teeth=8):
    col = col or P["grey"]
    a0 = t
    for i in range(teeth):
        a = a0 + i * 2 * math.pi / teeth
        c.circle(cx + math.cos(a) * r, cy + math.sin(a) * r, max(1, r // 4), col)
    c.circle(cx, cy, r - 1, col)
    c.circle(cx, cy, max(1, r // 3), P["ink"])


def rocket(c, cx, cy, t, s=1, flame=True):
    if flame:
        fl = 3 + 2 * math.sin(t * 25)
        c.poly([(cx - 3 * s, cy + 8 * s), (cx + 3 * s, cy + 8 * s), (cx, cy + (8 + fl + 4) * s)], P["orange"])
        c.poly([(cx - 1 * s, cy + 8 * s), (cx + 1 * s, cy + 8 * s), (cx, cy + (8 + fl) * s)], P["yellow"])
    c.poly([(cx - 4 * s, cy + 3 * s), (cx - 7 * s, cy + 9 * s), (cx - 3 * s, cy + 8 * s)], P["red"])
    c.poly([(cx + 4 * s, cy + 3 * s), (cx + 7 * s, cy + 9 * s), (cx + 3 * s, cy + 8 * s)], P["red"])
    c.rrect(cx - 4 * s, cy - 6 * s, 8 * s + 1, 15 * s, 3 * s, P["white"], outline=P["ink"])
    c.poly([(cx - 4 * s, cy - 5 * s), (cx + 4 * s, cy - 5 * s), (cx, cy - 12 * s)], P["red"])
    c.circle(cx, cy - 1 * s, 2 * s, P["cyan"], outline=P["ink"])


def earth(c, cx, cy, r, t, alpha=1.0):
    c.circle(cx, cy, r + 1, P["ink"], alpha=alpha)
    c.circle(cx, cy, r, P["water"], alpha=alpha)
    rnd = random.Random(5)
    for i in range(7):
        a = rnd.random() * 6.28 + t * 0.2
        d = rnd.random() * r * 0.7
        x = cx + math.cos(a) * d
        y = cy + math.sin(a * 1.3) * d * 0.8
        if (x - cx) ** 2 + (y - cy) ** 2 < (r - 3) ** 2:
            c.circle(x, y, max(2, r // 4 + rnd.randint(-1, 2)), P["green"], alpha=alpha)
    c.circle(cx - r * 0.35, cy - r * 0.35, max(1, r // 6), P["white"], alpha=alpha * 0.6)
