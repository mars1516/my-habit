"""캐릭터: 사람, AI '비트', 동물들."""
import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw

from gfx import P, sprite, outline_sprite


# ── 사람 ─────────────────────────────────────────────────────
ARM_POSES = {
    # (왼팔 각도, 오른팔 각도)  0=아래, 90=옆, 180=위   (도 단위, 캐릭터 기준)
    "idle": (12, 12),
    "wave": (12, 160),
    "up": (150, 150),
    "point": (12, 92),
    "shrug": (65, 65),
    "type": (55, 55),
    "hold": (40, 40),
    "think": (12, 150),
    "cross": (40, 40),
    "hug": (95, 95),
    "reach": (12, 120),
}


def _person_img(shirt, pants, skin, hair, hair_style, pose, walk, blink, mouth, extras, look):
    w, h = 22, 32
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = 11
    ink = P["ink"]
    # 다리
    lp = 0 if walk is None else math.sin(walk * math.pi * 2)
    for side, ph in ((-1, lp), (1, -lp)):
        x = cx + side * 2 + round(ph * 1.5)
        d.rectangle([x - 1 if side < 0 else x, 22, x if side < 0 else x + 1, 28], fill=pants)
        d.rectangle([x - 1 if side < 0 else x, 29, x if side < 0 else x + 1, 29], fill=ink)
    if "robe" in extras:
        d.polygon([(cx - 5, 18), (cx + 5, 18), (cx + 7, 29), (cx - 7, 29)], fill=shirt)
    # 몸통
    d.rounded_rectangle([cx - 5, 13, cx + 5, 23], radius=3, fill=shirt)
    d.rectangle([cx - 4, 21, cx + 4, 23], fill=shirt)
    if "tie" in extras:
        d.line([cx, 14, cx, 19], fill=P["red"])
    if "labcoat" in extras:
        d.rounded_rectangle([cx - 5, 13, cx + 5, 24], radius=3, fill=P["white"])
        d.line([cx, 14, cx, 24], fill=P["light"])
    # 팔
    la, ra = ARM_POSES.get(pose, ARM_POSES["idle"])
    for side, ang in ((-1, la), (1, ra)):
        sx, sy = cx + side * 5, 15
        a = math.radians(ang)
        L = 7
        ex = sx + side * math.sin(a) * L
        ey = sy + math.cos(a) * L
        if pose == "think" and side == 1:
            ex, ey = cx + 2, 12
        if pose == "cross":
            ex, ey = cx - side * 2, 18
        d.line([sx, sy, round(ex), round(ey)], fill=shirt if "labcoat" not in extras else P["white"], width=2)
        d.rectangle([round(ex) - (1 if side < 0 else 0), round(ey), round(ex) + (0 if side < 0 else 1), round(ey) + 1], fill=skin)
    # 머리
    hx, hy = cx, 7
    if hair_style == "einstein":
        for dx, dy, r in ((-5, -1, 3), (5, -1, 3), (0, -4, 4), (-4, -4, 3), (4, -4, 3), (-6, 2, 2), (6, 2, 2)):
            d.ellipse([hx + dx - r, hy + dy - r, hx + dx + r, hy + dy + r], fill=hair)
    if hair_style == "long":
        d.rounded_rectangle([hx - 6, hy - 4, hx + 6, hy + 2], radius=4, fill=hair)
        d.rectangle([hx - 6, hy, hx - 4, hy + 8], fill=hair)
        d.rectangle([hx + 4, hy, hx + 6, hy + 8], fill=hair)
    d.ellipse([hx - 5, hy - 5, hx + 5, hy + 5], fill=skin)
    if hair_style in ("short", "long"):
        d.chord([hx - 5, hy - 5, hx + 5, hy + 5], 180, 360, fill=hair)
        d.rectangle([hx - 5, hy - 1, hx - 4, hy + 1], fill=hair)
    elif hair_style == "side":
        d.chord([hx - 5, hy - 5, hx + 5, hy + 5], 170, 370, fill=hair)
    elif hair_style == "bald":
        d.rectangle([hx - 5, hy - 1, hx - 4, hy + 2], fill=hair)
        d.rectangle([hx + 4, hy - 1, hx + 5, hy + 2], fill=hair)
    elif hair_style == "bun":
        d.chord([hx - 5, hy - 5, hx + 5, hy + 5], 180, 360, fill=hair)
        d.ellipse([hx - 2, hy - 9, hx + 2, hy - 5], fill=hair)
    elif hair_style == "helmet":
        d.chord([hx - 6, hy - 6, hx + 6, hy + 4], 180, 360, fill=P["yellow"])
        d.rectangle([hx - 7, hy - 1, hx + 7, hy - 1], fill=P["dgold"])
    if "crown" in extras:
        d.polygon([(hx - 5, hy - 4), (hx - 5, hy - 9), (hx - 3, hy - 6), (hx, hy - 10), (hx + 3, hy - 6),
                   (hx + 5, hy - 9), (hx + 5, hy - 4)], fill=P["gold"])
        d.point((hx, hy - 7), fill=P["red"])
    # 얼굴
    ex = look
    eye_y = hy + 1
    if blink:
        d.line([hx - 3 + ex, eye_y, hx - 2 + ex, eye_y], fill=ink)
        d.line([hx + 2 + ex, eye_y, hx + 3 + ex, eye_y], fill=ink)
    else:
        d.rectangle([hx - 2 + ex, eye_y - 1, hx - 2 + ex, eye_y], fill=ink)
        d.rectangle([hx + 2 + ex, eye_y - 1, hx + 2 + ex, eye_y], fill=ink)
    if "glasses" in extras:
        d.rectangle([hx - 4 + ex, eye_y - 2, hx - 1 + ex, eye_y + 1], outline=ink)
        d.rectangle([hx + 1 + ex, eye_y - 2, hx + 4 + ex, eye_y + 1], outline=ink)
    if "beard" in extras:
        d.chord([hx - 5, hy - 3, hx + 5, hy + 6], 0, 180, fill=hair)
        d.rectangle([hx - 1 + ex, hy + 3, hx + 1 + ex, hy + 3], fill=skin)
    if "mustache" in extras:
        d.line([hx - 2 + ex, hy + 3, hx + 2 + ex, hy + 3], fill=hair)
    if mouth == "smile":
        d.line([hx - 1 + ex, hy + 4, hx + 1 + ex, hy + 4], fill=P["dskin2"])
    elif mouth == "o":
        d.rectangle([hx + ex, hy + 3, hx + ex, hy + 4], fill=P["dskin2"])
    elif mouth == "frown":
        d.point((hx - 1 + ex, hy + 4), fill=P["dskin2"])
        d.point((hx + ex, hy + 3), fill=P["dskin2"])
        d.point((hx + 1 + ex, hy + 4), fill=P["dskin2"])
    if "blush" in extras:
        d.point((hx - 4 + ex, hy + 3), fill=P["pink"])
        d.point((hx + 4 + ex, hy + 3), fill=P["pink"])
    if "sweat" in extras:
        d.rectangle([hx + 6, hy - 2, hx + 6, hy], fill=P["cyan"])
    a = np.array(img)
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    return a


_PCACHE = {}


def person(shirt=None, pants=None, skin=None, hair=None, hair_style="short", pose="idle",
           walk=None, blink=False, mouth=None, extras=(), look=0, outline=True):
    """발 중앙이 (11, 29) 인 22x32 RGBA 스프라이트 (외곽선 포함 시 24x34)."""
    shirt = shirt or P["blue"]
    pants = pants or P["dblue"]
    skin = skin or P["skin"]
    hair = hair or P["dbrown"]
    wq = None if walk is None else round((walk % 1.0) * 8) / 8
    key = (shirt, pants, skin, hair, hair_style, pose, wq, blink, mouth, tuple(extras), look, outline)
    if key not in _PCACHE:
        a = _person_img(shirt, pants, skin, hair, hair_style, pose, wq, blink, mouth, extras, look)
        if outline:
            a = outline_sprite(a, P["ink"])
        _PCACHE[key] = a
    return _PCACHE[key]


def draw_person(c, x, y, scale=1, flip=False, alpha=1.0, **kw):
    """(x, y) = 발 중앙."""
    spr = person(**kw)
    oy = 30 if kw.get("outline", True) else 29
    ox = 12 if kw.get("outline", True) else 11
    c.blit(spr, x - ox * scale, y - oy * scale, flip=flip, scale=scale, alpha=alpha)


# ── AI 비트 ──────────────────────────────────────────────────
BIT_RES = {1: 8, 2: 16, 3: 32, 4: 64}
BIT_SCALE = {1: 4, 2: 2, 3: 1, 4: 1}


def _bit_img(n, eye, look, glow, shell, flame):
    """설계 공간(32)을 n 해상도로 그린다. 해상도가 곧 지능!"""
    k = n / 32.0
    pad = max(1, n // 8)
    N = n + 2 * pad
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def S(v):
        return round(v * k) + pad

    ink = P["ink"]
    shell_c = shell or P["white"]
    shade_c = P["light"]
    screen = (16, 18, 44)
    eyec = P["cyan"] if glow is None else glow
    # 안테나
    d.line([S(16), S(1.5), S(16), S(6)], fill=P["grey"], width=max(1, round(1.5 * k)))
    r = max(1, 2.2 * k)
    d.ellipse([S(16) - r, S(1.5) - r, S(16) + r, S(1.5) + r], fill=eyec)
    # 귀
    d.rounded_rectangle([S(1), S(12), S(4), S(20)], radius=max(0, round(1 * k)), fill=P["grey"])
    d.rounded_rectangle([S(28), S(12), S(31), S(20)], radius=max(0, round(1 * k)), fill=P["grey"])
    # 몸체
    d.rounded_rectangle([S(3), S(5), S(29), S(27)], radius=max(1, round(7 * k)), fill=ink)
    d.rounded_rectangle([S(3) + max(1, round(k)), S(5) + max(1, round(k)), S(29) - max(1, round(k)),
                         S(27) - max(1, round(k))], radius=max(1, round(6 * k)), fill=shell_c)
    if n >= 16:
        d.rounded_rectangle([S(5), S(23), S(27), S(26)], radius=max(1, round(2 * k)), fill=shade_c)
    if n >= 32:
        d.line([S(7), S(8), S(12), S(8)], fill=P["white"])
        d.point((S(6), S(9)), fill=P["white"])
    # 화면(얼굴)
    d.rounded_rectangle([S(7), S(9), S(25), S(22)], radius=max(0, round(3 * k)), fill=screen)
    # 눈
    lx, ly = look
    ex1, ex2, ey = 12.5 + lx, 19.5 + lx, 15.5 + ly
    if eye == "open":
        rr = 2.2 * k
        for ex in (ex1, ex2):
            if n <= 8:
                d.point((S(ex), S(ey)), fill=eyec)
            else:
                d.rounded_rectangle([S(ex) - rr, S(ey) - rr * 1.3, S(ex) + rr, S(ey) + rr * 1.3],
                                    radius=max(0, round(rr)), fill=eyec)
                if n >= 32:
                    d.point((S(ex) - 1, S(ey) - 2), fill=P["white"])
    elif eye == "happy":
        for ex in (ex1, ex2):
            if n <= 8:
                d.point((S(ex), S(ey)), fill=eyec)
            else:
                d.line([S(ex - 2.5), S(ey + 1), S(ex), S(ey - 1.5), S(ex + 2.5), S(ey + 1)], fill=eyec,
                       width=max(1, round(k)))
    elif eye == "closed":
        for ex in (ex1, ex2):
            d.line([S(ex - 2), S(ey), S(ex + 2), S(ey)], fill=eyec, width=max(1, round(k * 0.8)))
    elif eye == "wide":
        rr = 3.2 * k
        for ex in (ex1, ex2):
            if n <= 8:
                d.point((S(ex), S(ey)), fill=eyec)
            else:
                d.ellipse([S(ex) - rr, S(ey) - rr, S(ex) + rr, S(ey) + rr], fill=eyec)
                d.ellipse([S(ex) - rr / 3, S(ey) - rr / 3, S(ex) + rr / 3, S(ey) + rr / 3], fill=screen)
    elif eye == "focus":
        for ex in (ex1, ex2):
            d.rectangle([S(ex - 2), S(ey - 0.5), S(ex + 2), S(ey + 1)], fill=eyec)
    if n >= 64:
        # 고해상도 디테일: 회로 무늬
        for i, (x0, y0, x1, y1) in enumerate(((5, 24, 12, 24), (20, 24, 27, 24), (16, 22, 16, 26))):
            d.line([S(x0), S(y0), S(x1), S(y1)], fill=P["cyan"])
        d.ellipse([S(15), S(23.5), S(17), S(25.5)], fill=P["yellow"])
    # 추진 불꽃
    if flame:
        fl = flame
        d.polygon([(S(13), S(27.5)), (S(19), S(27.5)), (S(16), S(27.5 + 3.5 * fl))], fill=P["orange"])
        if n >= 16:
            d.polygon([(S(14.5), S(27.5)), (S(17.5), S(27.5)), (S(16), S(27.5 + 2 * fl))], fill=P["yellow"])
    a = np.array(img)
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    return a


_BIT1 = {
    "open": [
        "...cc...",
        ".kkkkkk.",
        "kwwwwwwk",
        "kwddddwk",
        "kwcddcwk",
        "kwddddwk",
        "kwwwwwwk",
        ".kkkkkk.",
    ],
}
_BIT1["closed"] = [r.replace("c", "d") if i == 4 else r for i, r in enumerate(_BIT1["open"])]
_BIT2 = {
    "top": [
        ".......cc.......",
        ".......gg.......",
        "...kkkkkkkkkk...",
        "..kwwwwwwwwwwk..",
        ".kwwddddddddwwk.",
        "gkwddddddddddwkg",
    ],
    "open": ["gkwddcddddcddwkg", "gkwddcddddcddwkg"],
    "closed": ["gkwddddddddddwkg", "gkwdcccddcccdwkg"],
    "happy": ["gkwddcddddcddwkg", "gkwdcdcddcdcdwkg"],
    "wide": ["gkwdccddddccdwkg", "gkwdccddddccdwkg"],
    "bottom": [
        "gkwddddddddddwkg",
        ".kwwddddddddwwk.",
        ".kwwwwwwwwwwwwk.",
        ".kllllllllllllk.",
        "..kkkkkkkkkkkk..",
    ],
}


def _bit_low(level, eye, glow, flame):
    eyec = P["cyan"] if glow is None else glow
    leg = {"k": P["ink"], "w": P["white"], "d": (16, 18, 44), "c": eyec, "g": P["grey"],
           "l": P["light"], "o": P["orange"], "y": P["yellow"]}
    if level == 1:
        rows = list(_BIT1["closed" if eye == "closed" else "open"])
        rows.append("...oo..." if flame > 0.3 else "........")
    else:
        e = eye if eye in _BIT2 else "open"
        rows = _BIT2["top"] + _BIT2[e] + _BIT2["bottom"]
        rows += ["......oooo......", ".......yy......." if flame > 0.6 else ".......oo......."] if flame > 0.2 \
            else ["................", "................"]
    return sprite(rows, leg)


_BCACHE = {}


def bit(level=1, eye="open", look=(0, 0), glow=None, shell=None, flame=0.0):
    fq = round(flame * 4) / 4
    key = (level, eye, look, glow, shell, fq)
    if key not in _BCACHE:
        n = BIT_RES[level]
        a = _bit_low(level, eye, glow, fq) if level <= 2 else _bit_img(n, eye, look, glow, shell, fq)
        s = BIT_SCALE[level]
        if s != 1:
            a = np.repeat(np.repeat(a, s, 0), s, 1)
        _BCACHE[key] = a
    return _BCACHE[key]


def draw_bit(c, cx, cy, level=1, t=0.0, eye=None, look=(0, 0), glow=None, alpha=1.0, flame=None,
             hover=True, blink_ph=0.0):
    """(cx, cy) 중심에 비트를 그린다. 둥실둥실 떠다님."""
    if eye is None:
        eye = "closed" if ((t + blink_ph) % 3.3) < 0.12 else "open"
    fy = round(math.sin(t * 2.4) * 2) if hover else 0
    fl = flame if flame is not None else (0.6 + 0.4 * math.sin(t * 20)) if hover else 0.0
    spr = bit(level, eye, look, glow, None, fl)
    c.blit(spr, cx - spr.shape[1] // 2, cy - spr.shape[0] // 2 + fy, alpha=alpha)
    return spr.shape[0]


# ── 동물 ─────────────────────────────────────────────────────
ANT = sprite([
    ".k...k.",
    "..k.k..",
    ".kkkkkk",
    "kkkkkk.",
    "k.k.k..",
], {"k": P["ink"]})

CHICKEN = sprite([
    "...rr.......",
    "..rwwr......",
    "..wwwkw.....",
    "..wwwwoo....",
    "..wwwwo.....",
    "..rwww......",
    "..wwwww...ww",
    ".wwwwwwwwwww",
    ".wwwwlwwwww.",
    ".wwwwwlllww.",
    "..wwwwwwww..",
    "...wwwwww...",
    "....o..o....",
    "....o..o....",
    "...oo.oo....",
], {"r": P["red"], "w": P["white"], "k": P["ink"], "o": P["orange"], "l": P["light"]})

CHIMP = sprite([
    ".....bbbbb......",
    "....bbbbbbb.....",
    "...bbffffbbb....",
    "..fbfkffkfbf....",
    "..fbffffffbf....",
    "...bffnnffb.....",
    "....ffmmff......",
    ".....bbbb.......",
    "...bbbbbbbb.....",
    "..bbbbbbbbbb....",
    ".bb.bbbbbb.bb...",
    ".bb.bbbbbb.bb...",
    ".ff.bbbbbb.ff...",
    "....bbbbbb......",
    "....bb..bb......",
    "....bb..bb......",
    "...ffb..bff.....",
], {"b": P["dbrown"], "f": P["sand"], "k": P["ink"], "n": P["dskin2"], "m": P["dskin"]})

ANT_O = outline_sprite(ANT, P["white"])
CHICKEN_O = outline_sprite(CHICKEN, P["ink"])
CHIMP_O = outline_sprite(CHIMP, P["ink"])
