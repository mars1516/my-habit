"""도트(픽셀) 그래픽 엔진.

384x216 논리 해상도에서 그리고, 인코딩 단계에서 5배(nearest)로 1920x1080 확대한다.
모든 도형은 안티앨리어싱 없이 그려지고, 반투명은 베이어(Bayer) 디더로 표현한다.
"""
import math
import os
import pickle
import random

import numpy as np
from PIL import Image, ImageDraw

from paths import ASSETS, BUILD

W, H = 384, 216
SCALE = 5

# ── 팔레트 ────────────────────────────────────────────────────
P = dict(
    black=(8, 8, 20),
    night0=(11, 13, 38), night1=(20, 24, 66), night2=(33, 40, 100), night3=(52, 64, 140),
    ink=(24, 20, 44),
    white=(244, 244, 250), light=(196, 204, 226), grey=(120, 128, 160), dgrey=(64, 68, 98),
    cyan=(94, 231, 255), teal=(46, 196, 182), dteal=(18, 110, 120),
    blue=(60, 130, 246), dblue=(36, 72, 170),
    yellow=(255, 214, 64), orange=(255, 150, 40), dorange=(208, 92, 30),
    red=(239, 71, 111), dred=(150, 30, 60),
    pink=(255, 120, 170), purple=(150, 96, 255), dpurple=(84, 52, 176),
    green=(62, 220, 140), dgreen=(28, 132, 84), ddgreen=(16, 74, 56),
    brown=(140, 90, 60), dbrown=(88, 54, 40), sand=(232, 196, 140),
    skin=(246, 190, 150), skin2=(196, 128, 96), dskin=(160, 100, 70), dskin2=(112, 66, 46),
    gold=(255, 204, 60), dgold=(196, 138, 30),
    rice=(250, 244, 222), water=(40, 120, 200), dwater=(24, 76, 150),
)

BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16.0
BAYER8 = np.array([
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]], np.float32) / 64.0
BAYER_FULL = np.tile(BAYER8, (H // 8 + 2, W // 8 + 2))


def bayer(h, w, ox=0, oy=0):
    return BAYER_FULL[oy % 8: oy % 8 + h, ox % 8: ox % 8 + w]


def mix(c0, c1, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(c0, c1))


def shade(c, k):
    """k<1 어둡게, k>1 밝게"""
    if k < 1:
        return tuple(int(v * k) for v in c)
    return mix(c, (255, 255, 255), k - 1)


# ── 폰트 (BDF) ───────────────────────────────────────────────
class BDFFont:
    def __init__(self, path):
        cache = os.path.join(BUILD, "fontcache", os.path.basename(path) + ".pkl")
        if os.path.exists(cache):
            self.__dict__.update(pickle.load(open(cache, "rb")))
            return
        glyphs, ascent, descent = {}, 0, 0
        with open(path, encoding="latin-1") as f:
            enc = dw = bbx = None
            rows = None
            for line in f:
                if line.startswith("FONT_ASCENT"):
                    ascent = int(line.split()[1])
                elif line.startswith("FONT_DESCENT"):
                    descent = int(line.split()[1])
                elif line.startswith("ENCODING"):
                    enc = int(line.split()[1])
                elif line.startswith("DWIDTH"):
                    dw = int(line.split()[1])
                elif line.startswith("BBX"):
                    bbx = tuple(int(v) for v in line.split()[1:5])
                elif line.startswith("BITMAP"):
                    rows = []
                elif line.startswith("ENDCHAR"):
                    bw, bh, bx, by = bbx
                    bits = np.zeros((bh, bw), bool)
                    for r, hexrow in enumerate(rows):
                        v = int(hexrow, 16)
                        nb = len(hexrow) * 4
                        for cidx in range(bw):
                            bits[r, cidx] = (v >> (nb - 1 - cidx)) & 1
                    glyphs[enc] = (bits, bx, by, dw)
                    rows = None
                elif rows is not None:
                    rows.append(line.strip())
        self.glyphs, self.ascent, self.descent = glyphs, ascent, descent
        self.height = ascent + descent
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        pickle.dump(self.__dict__, open(cache, "wb"))

    def mask(self, s, spacing=0):
        """문자열 → bool 마스크 (height x width). 줄바꿈 지원."""
        lines = s.split("\n")
        masks = [self._line(l, spacing) for l in lines]
        w = max(m.shape[1] for m in masks) if masks else 0
        lh = self.height + 2
        out = np.zeros((lh * len(masks) - 2, max(1, w)), bool)
        for i, m in enumerate(masks):
            out[i * lh: i * lh + m.shape[0], : m.shape[1]] |= m
        return out

    def _line(self, s, spacing):
        x = 0
        items = []
        for ch in s:
            g = self.glyphs.get(ord(ch)) or self.glyphs.get(ord("?"))
            items.append((x, g))
            x += g[3] + spacing
        w = max(1, x - spacing)
        m = np.zeros((self.height, w + 2), bool)
        for x0, (bits, bx, by, dw) in items:
            bh, bw = bits.shape
            top = self.ascent - by - bh
            xx = x0 + bx
            if bw == 0 or bh == 0:
                continue
            y0, y1 = max(0, top), min(self.height, top + bh)
            x0c, x1c = max(0, xx), min(m.shape[1], xx + bw)
            m[y0:y1, x0c:x1c] |= bits[y0 - top: y1 - top, x0c - xx: x1c - xx]
        return m[:, :w]

    def width(self, s, spacing=0):
        return max(self._line(l, spacing).shape[1] for l in s.split("\n"))


_FONTS = {}


def font(name):
    files = {"g7": "Galmuri7.bdf", "g9": "Galmuri9.bdf", "g11": "Galmuri11.bdf",
             "g11b": "Galmuri11-Bold.bdf"}
    if name not in _FONTS:
        _FONTS[name] = BDFFont(os.path.join(ASSETS, "fonts", files[name]))
    return _FONTS[name]


def dilate(m, r=1):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx == 0 and dy == 0:
                continue
            sh = np.zeros_like(m)
            ys = slice(max(0, dy), m.shape[0] + min(0, dy))
            yd = slice(max(0, -dy), m.shape[0] + min(0, -dy))
            xs = slice(max(0, dx), m.shape[1] + min(0, dx))
            xd = slice(max(0, -dx), m.shape[1] + min(0, -dx))
            sh[ys, xs] = m[yd, xd]
            out |= sh
    return out


_DISKS = {}


def disk(r):
    if r not in _DISKS:
        img = Image.new("1", (2 * r + 1, 2 * r + 1), 0)
        ImageDraw.Draw(img).ellipse([0, 0, 2 * r, 2 * r], fill=1)
        _DISKS[r] = np.asarray(img, dtype=bool)
    return _DISKS[r]


# ── 캔버스 ───────────────────────────────────────────────────
class Canvas:
    def __init__(self, w=W, h=H, bg=None):
        self.w, self.h = w, h
        self.a = np.zeros((h, w, 3), np.uint8)
        if bg is not None:
            self.a[:] = bg
        self.ox = 0  # 카메라 오프셋 (그리기 좌표에 더해짐)
        self.oy = 0

    # 내부: PIL 을 쓰는 도형은 마스크를 만든 뒤 numpy 로 합성
    def _mask_draw(self, fn):
        img = Image.new("1", (self.w, self.h), 0)
        fn(ImageDraw.Draw(img))
        return np.asarray(img, dtype=bool)

    def _apply(self, mask, col, alpha=1.0):
        if alpha < 1.0:
            if alpha <= 0:
                return
            mask = mask & (BAYER_FULL[: self.h, : self.w] < alpha)
        self.a[mask] = col

    def _xy(self, x, y):
        return int(round(x + self.ox)), int(round(y + self.oy))

    def fill(self, col):
        self.a[:] = col

    def rect(self, x, y, w, h, col, alpha=1.0):
        x, y = self._xy(x, y)
        w, h = int(round(w)), int(round(h))
        x0, y0, x1, y1 = max(0, x), max(0, y), min(self.w, x + w), min(self.h, y + h)
        if x1 <= x0 or y1 <= y0:
            return
        if alpha >= 1:
            self.a[y0:y1, x0:x1] = col
        else:
            m = BAYER_FULL[y0:y1, x0:x1] < alpha
            self.a[y0:y1, x0:x1][m] = col

    def frame(self, x, y, w, h, col, t=1, alpha=1.0):
        self.rect(x, y, w, t, col, alpha)
        self.rect(x, y + h - t, w, t, col, alpha)
        self.rect(x, y + t, t, h - 2 * t, col, alpha)
        self.rect(x + w - t, y + t, t, h - 2 * t, col, alpha)

    def px(self, x, y, col):
        x, y = self._xy(x, y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = col

    def pxs(self, pts, col):
        for x, y in pts:
            self.px(x, y, col)

    def circle(self, cx, cy, r, col, alpha=1.0, outline=None):
        cx, cy = self._xy(cx, cy)
        r = int(round(r))
        if r <= 0:
            if r == 0 and 0 <= cx < self.w and 0 <= cy < self.h:
                self.a[cy, cx] = col
            return
        if cx + r < 0 or cx - r >= self.w or cy + r < 0 or cy - r >= self.h:
            return
        m = disk(r)
        self._mask_at(m, cx - r, cy - r, col, alpha)
        if outline is not None:
            self._mask_at(m & ~self._erode(m), cx - r, cy - r, outline, alpha)

    def ring(self, cx, cy, r, col, width=1, alpha=1.0):
        cx, cy = self._xy(cx, cy)
        r = int(round(r))
        if r <= 0:
            return
        m = self._mask_draw(lambda d: d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=1, width=width))
        self._apply(m, col, alpha)

    def ellipse(self, x0, y0, x1, y1, col, alpha=1.0, outline=None, width=1):
        x0, y0 = self._xy(x0, y0)
        x1, y1 = self._xy(x1, y1)
        if x1 < x0 or y1 < y0:
            return
        if outline is None:
            m = self._mask_draw(lambda d: d.ellipse([x0, y0, x1, y1], fill=1))
            self._apply(m, col, alpha)
        else:
            m = self._mask_draw(lambda d: d.ellipse([x0, y0, x1, y1], outline=1, width=width))
            self._apply(m, outline, alpha)

    def poly(self, pts, col, alpha=1.0):
        pts = [self._xy(x, y) for x, y in pts]
        m = self._mask_draw(lambda d: d.polygon(pts, fill=1))
        self._apply(m, col, alpha)

    def line(self, x0, y0, x1, y1, col, width=1, alpha=1.0):
        x0, y0 = self._xy(x0, y0)
        x1, y1 = self._xy(x1, y1)
        if width == 1:
            # 브레젠험 (끝점 포함, 깔끔한 도트 라인)
            dx, dy = abs(x1 - x0), -abs(y1 - y0)
            sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
            err = dx + dy
            n = 0
            while True:
                if 0 <= x0 < self.w and 0 <= y0 < self.h:
                    if alpha >= 1 or BAYER_FULL[y0, x0] < alpha:
                        self.a[y0, x0] = col
                if x0 == x1 and y0 == y1:
                    break
                e2 = 2 * err
                if e2 >= dy:
                    err += dy
                    x0 += sx
                if e2 <= dx:
                    err += dx
                    y0 += sy
                n += 1
                if n > 4000:
                    break
        else:
            m = self._mask_draw(lambda d: d.line([x0, y0, x1, y1], fill=1, width=width))
            self._apply(m, col, alpha)

    def dline(self, x0, y0, x1, y1, col, dash=3, gap=2, phase=0):
        """점선"""
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1:
            return
        n = int(L)
        for i in range(n + 1):
            if ((i + phase) % (dash + gap)) < dash:
                self.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, col)

    def polyline(self, pts, col, width=1, alpha=1.0):
        for (a, b), (c, d) in zip(pts[:-1], pts[1:]):
            self.line(a, b, c, d, col, width, alpha)

    def rrect(self, x, y, w, h, r, col, alpha=1.0, outline=None, owidth=1):
        x, y = self._xy(x, y)
        w, h = int(round(w)), int(round(h))
        if w <= 0 or h <= 0:
            return
        m = self._mask_draw(lambda d: d.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=r, fill=1))
        self._apply(m, col, alpha)
        if outline is not None:
            e = m & ~self._erode(m, owidth)
            self._apply(e, outline, alpha)

    @staticmethod
    def _erode(m, r=1):
        p = np.pad(m, r)
        return (~dilate(~p, r))[r:-r, r:-r]

    # 세로 그라데이션 (디더된 밴드)
    def vgrad(self, y0, y1, c0, c1, x0=0, x1=None, steps=None):
        x1 = self.w if x1 is None else x1
        y0i, y1i = int(y0 + self.oy), int(y1 + self.oy)
        for y in range(max(0, y0i), min(self.h, y1i)):
            t = (y - y0i) / max(1, (y1i - y0i - 1))
            if steps:
                t = round(t * steps) / steps
            # 두 색 사이를 4단계 디더로
            k = t * 4
            lo = math.floor(k) / 4
            hi = min(1.0, lo + 0.25)
            ca, cb = mix(c0, c1, lo), mix(c0, c1, hi)
            frac = k - math.floor(k)
            row = self.a[y, max(0, x0):min(self.w, x1)]
            row[:] = ca
            m = BAYER_FULL[y, max(0, x0):min(self.w, x1)] < frac
            row[m] = cb

    # 스프라이트 (RGBA ndarray: h x w x 4, alpha 0/255)
    def blit(self, spr, x, y, flip=False, alpha=1.0, scale=1, tint=None):
        if spr is None:
            return
        if flip:
            spr = spr[:, ::-1]
        if scale != 1:
            spr = np.repeat(np.repeat(spr, scale, 0), scale, 1)
        x, y = self._xy(x, y)
        h, w = spr.shape[:2]
        x0, y0, x1, y1 = max(0, x), max(0, y), min(self.w, x + w), min(self.h, y + h)
        if x1 <= x0 or y1 <= y0:
            return
        sub = spr[y0 - y: y1 - y, x0 - x: x1 - x]
        m = sub[..., 3] > 127
        if alpha < 1:
            m &= BAYER_FULL[y0:y1, x0:x1] < alpha
        if tint is not None:
            self.a[y0:y1, x0:x1][m] = tint
        else:
            self.a[y0:y1, x0:x1][m] = sub[..., :3][m]

    def blit_c(self, spr, cx, cy, **kw):
        """중심 기준 blit"""
        s = kw.get("scale", 1)
        self.blit(spr, cx - spr.shape[1] * s // 2, cy - spr.shape[0] * s // 2, **kw)

    def blit_b(self, spr, cx, by, **kw):
        """하단 중앙 기준 blit"""
        s = kw.get("scale", 1)
        self.blit(spr, cx - spr.shape[1] * s // 2, by - spr.shape[0] * s, **kw)

    # 텍스트
    def text(self, s, x, y, col, fnt="g11", align="left", valign="top", outline=None,
             shadow=None, scale=1, spacing=0, alpha=1.0, reveal=None):
        """reveal: 0..1 이면 앞에서부터 글자 수 비율만큼만 표시 (타자기 효과)"""
        if reveal is not None:
            n = int(round(len(s) * max(0.0, min(1.0, reveal))))
            full_w = font(fnt).width(s, spacing)
            s = s[:n]
            if not s:
                return
        else:
            full_w = None
        f = font(fnt)
        m = f.mask(s, spacing)
        if scale != 1:
            m = np.repeat(np.repeat(m, scale, 0), scale, 1)
        h, w = m.shape
        ww = (full_w * scale) if full_w is not None else w
        if align == "center":
            x = x - ww // 2
        elif align == "right":
            x = x - ww
        if valign == "center":
            y = y - h // 2
        elif valign == "bottom":
            y = y - h
        pad = 2
        big = np.zeros((h + 2 * pad, w + 2 * pad), bool)
        big[pad:pad + h, pad:pad + w] = m
        X, Y = int(round(x + self.ox)) - pad, int(round(y + self.oy)) - pad
        if shadow is not None:
            self._mask_at(big, X + 1, Y + 1, shadow, alpha)
            if outline is None:
                self._mask_at(big, X + 1, Y, shadow, alpha)
        if outline is not None:
            self._mask_at(dilate(big, 1), X, Y, outline, alpha)
        self._mask_at(big, X, Y, col, alpha)
        return w

    def _mask_at(self, m, X, Y, col, alpha=1.0):
        h, w = m.shape
        x0, y0, x1, y1 = max(0, X), max(0, Y), min(self.w, X + w), min(self.h, Y + h)
        if x1 <= x0 or y1 <= y0:
            return
        sub = m[y0 - Y: y1 - Y, x0 - X: x1 - X]
        if alpha < 1:
            sub = sub & (BAYER_FULL[y0:y1, x0:x1] < alpha)
        self.a[y0:y1, x0:x1][sub] = col

    def mask_blit(self, m, x, y, col, alpha=1.0):
        self._mask_at(m, int(round(x + self.ox)), int(round(y + self.oy)), col, alpha)

    # 효과
    def darken(self, k, alpha=1.0):
        if alpha >= 1:
            self.a[:] = (self.a.astype(np.float32) * k).astype(np.uint8)
        else:
            m = BAYER_FULL[: self.h, : self.w] < alpha
            self.a[m] = (self.a[m].astype(np.float32) * k).astype(np.uint8)

    def dither_to(self, col, amount):
        m = BAYER_FULL[: self.h, : self.w] < amount
        self.a[m] = col

    def copy(self):
        c = Canvas(self.w, self.h)
        c.a = self.a.copy()
        return c


# ── 스프라이트 유틸 ─────────────────────────────────────────
def sprite(rows, legend):
    """ASCII 도트 → RGBA ndarray.  '.' 또는 ' ' 는 투명."""
    h = len(rows)
    w = max(len(r) for r in rows)
    a = np.zeros((h, w, 4), np.uint8)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in ". ":
                continue
            col = legend[ch]
            a[y, x, :3] = col
            a[y, x, 3] = 255
    return a


def pil_sprite(w, h, fn):
    """PIL 로 작은 RGBA 스프라이트를 그린다 (안티앨리어싱 없음)."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    fn(ImageDraw.Draw(img))
    a = np.array(img)
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    return a


def outline_sprite(spr, col):
    """스프라이트 외곽에 1px 테두리를 더한다."""
    h, w = spr.shape[:2]
    out = np.zeros((h + 2, w + 2, 4), np.uint8)
    m = np.zeros((h + 2, w + 2), bool)
    m[1:-1, 1:-1] = spr[..., 3] > 127
    d = dilate(m, 1) & ~m
    out[d, :3] = col
    out[d, 3] = 255
    out[1:-1, 1:-1][spr[..., 3] > 127] = spr[spr[..., 3] > 127]
    return out


# ── 별 배경 ─────────────────────────────────────────────────
_STARS = {}


def stars(c, t, seed=1, n=140, drift=0.0, cols=None, parallax=1.0):
    if (seed, n) not in _STARS:
        rnd = random.Random(seed)
        _STARS[(seed, n)] = [(rnd.random() * W, rnd.random() * H, rnd.random(), rnd.random() * 6.28, rnd.random())
                             for _ in range(n)]
    cols = cols or [P["night3"], P["light"], P["white"], P["cyan"]]
    for x, y, b, ph, sz in _STARS[(seed, n)]:
        xx = (x + drift * t * (0.3 + b) - c.ox * (parallax - 1) * b) % W
        yy = y
        tw = 0.5 + 0.5 * math.sin(t * (1 + b * 2) + ph)
        if b < 0.55:
            col = cols[0] if tw < 0.6 else cols[1]
            c.px(xx - c.ox, yy - c.oy, col)
        elif b < 0.9:
            c.px(xx - c.ox, yy - c.oy, cols[1] if tw < 0.5 else cols[2])
        else:
            col = cols[2] if sz < 0.7 else cols[3]
            c.px(xx - c.ox, yy - c.oy, col)
            if tw > 0.6:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    c.px(xx + dx - c.ox, yy + dy - c.oy, cols[1])
