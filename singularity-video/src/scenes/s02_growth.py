"""2부: 지수적 성장 — 체스판, 수련 연못, 무어의 법칙, 변하지 않은 뇌"""
import math
import random

import numpy as np

from anim import back, bob, clamp01, ease_in, ease_io, ease_out, lerp, prog
from chars import draw_person
from gfx import BAYER_FULL, H, P, W, Canvas, mix, stars
from props import (appear, arrow, brain, bulb, burst, chip, computer, drop, gear, glow, panel, qmark, rocket,
                   sparkle, tag, wheel, space, clipped, bubble)
from . import scene, sfx


def mixview(c, p, draw_a, draw_b):
    """두 장면을 디더 디졸브 (p: 0=a, 1=b)"""
    if p <= 0:
        draw_a(c)
        return
    if p >= 1:
        draw_b(c)
        return
    ca = Canvas()
    draw_a(ca)
    draw_b(c)
    m = BAYER_FULL[:H, :W] >= p
    c.a[m] = ca.a[m]


def graph_bg(c):
    c.fill(P["night1"])
    for x in range(0, W, 24):
        c.rect(x, 0, 1, H, (26, 32, 80))
    for y in range(0, H, 24):
        c.rect(0, y, W, 1, (26, 32, 80))


# ── 6. 체스판 ─────────────────────────────────────────────────
BX, BY, SQ = 26, 30, 19


def sq_xy(k):
    r, col = divmod(k - 1, 8)
    return BX + col * SQ, BY + r * SQ


def fmt_big(n):
    return f"{n:,}"


def rice_on_square(c, k, x, y, t, fresh):
    n = 2 ** (k - 1)
    if k <= 7:
        # 낱알로 표시 (최대 64개)
        rnd = random.Random(k)
        cells = [(i, j) for i in range(8) for j in range(8)]
        rnd.shuffle(cells)
        for i, j in cells[:n]:
            c.rect(x + 2 + i * 2, y + 2 + j * 2, 1, 1, P["white"])
    else:
        # 쌀 더미: 칸 수에 따라 로그 스케일로 커짐
        size = min(1.0, (k - 7) / 24)
        h = 4 + size * 10
        w = 8 + size * 8
        cx, by = x + SQ // 2, y + SQ - 3
        c.ellipse(cx - w / 2, by - h, cx + w / 2, by + h * 0.3, P["rice"])
        c.ellipse(cx - w / 2 + 1, by - h + 1, cx, by - h / 2, P["white"])
        if k > 24:
            # 칸 밖으로 넘쳐 솟는 더미
            hh = (k - 24) * 1.4
            c.poly([(cx - w / 2 - 1, by), (cx + w / 2 + 1, by), (cx, by - h - hh)], P["rice"])
            c.line(cx, by - h - hh, cx - w / 3, by, P["sand"])


@scene("chessboard")
def chessboard(c, t, S):
    t_board = S.cue(1) - 0.3

    def intro(cc):
        graph_bg(cc)
        a = appear(t, 0.1)
        panel(cc, 40, 30, 200, 150, col=P["night2"], alpha=a)
        # 축
        ox, oy = 58, 164
        cc.rect(ox, 44, 1, oy - 44, P["light"])
        cc.rect(ox, oy, 170, 1, P["light"])
        q = prog(t, 0.4, max(0.5, S.w(0, "지수적") - 0.4))
        n = int(160 * q)
        pts_l = [(ox + i, oy - i * 0.55) for i in range(0, n + 1, 2)]
        pts_e = [(ox + i, oy - (math.exp(i / 160 * 5.2) - 1) / (math.exp(5.2) - 1) * 118) for i in range(0, n + 1, 2)]
        if len(pts_l) > 1:
            cc.polyline(pts_l, P["grey"], width=2)
        if len(pts_e) > 1:
            cc.polyline(pts_e, P["orange"], width=2)
        if q > 0.8:
            tag(cc, "직감", ox + 150, oy - 96, fg=P["ink"], bg=P["light"], fnt="g9")
            tag(cc, "현실", ox + 128, 38, fg=P["ink"], bg=P["orange"], fnt="g9")
        cc.text("시간 →", 228, 168, P["light"], "g9", align="right")
        # 뇌
        by = 110 + bob(t, 2, 2.5)
        brain(cc, 305, by, s=3)
        if t > 1.0:
            qmark(cc, 336, by - 44, t, scale=2)
        a2 = appear(t, S.w(0, "지수적"))
        if a2 > 0:
            tag(cc, "지수적 성장", 305, 160, fg=P["ink"], bg=P["yellow"], fnt="g11", alpha=a2)

    def board(cc):
        graph_bg(cc)
        panel(cc, BX - 6, BY - 6, SQ * 8 + 12, SQ * 8 + 12, col=P["dbrown"], border=P["ink"])
        for k in range(1, 65):
            x, y = sq_xy(k)
            r, col = divmod(k - 1, 8)
            cc.rect(x, y, SQ, SQ, (178, 128, 88) if (r + col) % 2 == 0 else (118, 74, 50))
        # 각 칸이 채워지는 시각
        tk = fill_times(S)
        cur = 0
        for k in range(1, 65):
            if t >= tk[k]:
                cur = k
        # 64번째 칸 폭발 전까지 더미
        for k in range(1, cur + 1):
            x, y = sq_xy(k)
            rice_on_square(cc, k, x, y, t, t - tk[k] < 0.3)
        # 강조 테두리
        for k, t0, t1, col in ((8, S.cue(2), S.cue(3), P["yellow"]), (32, S.w(3, "20억") - 0.3, S.cue(4), P["yellow"])):
            if t0 <= t < t1:
                x, y = sq_xy(k)
                if int(t * 6) % 2 == 0 or t - t0 > 0.8:
                    cc.frame(x - 1, y - 1, SQ + 2, SQ + 2, col, 2)
        # 카운터 패널
        panel(cc, 200, 30, 170, 72, col=P["night2"])
        if cur >= 1:
            cc.text(f"{cur}번째 칸", 285, 38, P["light"], "g11", align="center")
            n = 2 ** (cur - 1)
            txt = fmt_big(n) + "톨"
            fnt = "g11b" if cur < 40 else ("g9" if cur < 60 else "g7")
            cc.text(txt, 285, 60, P["yellow"], fnt, align="center")
            cc.text(f"2^{cur - 1}", 285, 84, P["grey"], "g9", align="center")
        # 설명 태그
        if S.cue(3) - 0.2 < t:
            if t < S.cue(4) + 0.2:
                tag(cc, "약 21억 톨", 285, 110, fg=P["ink"], bg=P["yellow"], fnt="g11", alpha=appear(t, S.w(3, "20억")))
        # 64번째 칸: 쌀 산이 솟는다
        t64 = tk[64]
        if t > t64 - 0.4:
            q = ease_out(prog(t, t64 - 0.4, 1.8))
            peak = lerp(BY + SQ * 8, 6, q)
            cx = 104
            cc.poly([(cx - 150 * q - 10, H + 5), (cx + 110 * q + 10, H + 5), (cx, peak)], P["rice"])
            cc.poly([(cx, peak), (cx + 110 * q + 10, H + 5), (cx + 30 * q, H + 5)], (220, 212, 190))
            rnd = random.Random(8)
            for i in range(int(120 * q)):
                gy = rnd.uniform(peak + 6, H)
                span = (gy - peak) / (H - peak + 1e-6)
                gx = cx + rnd.uniform(-150 * q, 110 * q) * span
                cc.px(gx, gy, P["sand"])
            a = appear(t, t64 + 0.6)
            if a > 0:
                tag(cc, "이 한 칸 > 세계 쌀 생산 수백 년 치", 285, 120, fg=P["ink"], bg=P["yellow"], fnt="g9",
                    alpha=a)

    p = ease_io(prog(t, t_board - 0.4, 0.6))
    mixview(c, p, intro, board)


def fill_times(S):
    """칸 k 가 채워지는 로컬 시각"""
    tk = [0.0] * 65
    tk[1] = S.w(1, "한 톨")
    tk[2] = S.w(1, "두 톨")
    tk[3] = S.w(1, "네 톨")
    a, b = S.w(1, "칸마다"), S.lend(1)
    for k in range(4, 8):
        tk[k] = lerp(a, b, (k - 4) / 4)
    tk[8] = S.w(2, "128")
    a, b = S.cue(3), S.w(3, "20억") - 0.3
    for k in range(9, 33):
        tk[k] = lerp(a, b, ease_in((k - 9) / 23) * 0.7 + (k - 9) / 23 * 0.3)
    a, b = S.cue(4) + 0.2, S.w(4, "생산")
    for k in range(33, 65):
        tk[k] = lerp(a, b, (k - 33) / 31)
    return tk


@sfx("chessboard")
def chessboard_sfx(S):
    tk = fill_times(S)
    ev = [(0.4, "whoosh", 0.3), (S.w(0, "지수적"), "blip", 0.5)]
    for k in range(1, 65):
        if k <= 8 or k % 3 == 0:
            ev.append((tk[k], "tick", 0.25 + min(0.3, k / 100)))
    ev += [(S.w(2, "128"), "blip", 0.5), (S.w(3, "20억") - 0.3, "blip", 0.6), (tk[64] - 0.4, "rumble", 0.9)]
    return ev


# ── 7. 수련 연못 ───────────────────────────────────────────────
PCX, PCY, PRX, PRY = 146, 112, 124, 82
CELL = 8


def _pond_cells():
    cells = []
    for gy in range(int((PCY - PRY) // CELL), int((PCY + PRY) // CELL) + 1):
        for gx in range(int((PCX - PRX) // CELL), int((PCX + PRX) // CELL) + 1):
            x, y = gx * CELL + CELL / 2, gy * CELL + CELL / 2
            if ((x - PCX) / (PRX - 5)) ** 2 + ((y - PCY) / (PRY - 5)) ** 2 < 1:
                cells.append((x, y))
    rnd = random.Random(11)
    seeds = [(PCX - 60, PCY - 20), (PCX + 40, PCY + 30), (PCX + 70, PCY - 40)]

    def key(p):
        d = min(math.hypot(p[0] - sx, p[1] - sy) for sx, sy in seeds)
        return d + rnd.uniform(0, 26)
    cells.sort(key=key)
    return cells


CELLS = _pond_cells()


def pond(c, t, coverage):
    # 풀밭
    c.fill(P["dgreen"])
    rnd = random.Random(3)
    for i in range(220):
        x, y = rnd.randint(0, W), rnd.randint(0, H)
        c.px(x, y, P["green"] if i % 3 else P["ddgreen"])
        c.px(x, y - 1, P["green"] if i % 3 else P["ddgreen"])
    # 연못
    c.ellipse(PCX - PRX - 3, PCY - PRY - 3, PCX + PRX + 3, PCY + PRY + 3, P["sand"])
    c.ellipse(PCX - PRX, PCY - PRY, PCX + PRX, PCY + PRY, P["dwater"])
    c.ellipse(PCX - PRX + 6, PCY - PRY + 5, PCX + PRX - 6, PCY + PRY - 5, P["water"])
    for i in range(10):
        y = PCY - 60 + i * 13
        x = PCX - 80 + ((i * 37 + t * 12) % 140)
        c.rect(x, y, 8, 1, (90, 170, 230))
    n = int(round(len(CELLS) * coverage))
    for i, (x, y) in enumerate(CELLS[:n]):
        r = 4 if i % 5 else 5
        c.circle(x, y, r, P["dgreen"])
        c.circle(x - 1, y - 1, r - 1, P["green"])
        c.line(x, y, x + r - 1, y - 1, P["dgreen"])
        if i % 17 == 3:
            c.px(x - 1, y - 2, P["pink"])
            c.px(x, y - 2, P["white"])


def day_curve(S, t):
    """(day, coverage) 반환"""
    a0, a1 = S.cue(0) + 0.3, S.w(0, "30일") + 0.1
    if t < S.cue(1) + 0.1:
        q = prog(t, a0, a1 - a0)
        day = 1 + int(29 * q)
        return day, 2.0 ** (day - 30)
    tb = S.w(1, "바로")
    if t < tb:
        return None, 1.0
    if t < S.cue(2) - 0.1:
        return 29, 0.5
    tf = S.w(2, "닷새")
    if t < tf:
        return 25, 2.0 ** -5
    k = min(5, int((t - tf) / 0.38) + 1)
    return 25 + k, 2.0 ** (25 + k - 30)


@scene("lilypond")
def lilypond(c, t, S):
    day, cov = day_curve(S, t)
    pond(c, t, cov)
    # 정보 패널
    panel(c, 284, 20, 90, 96, col=P["night2"])
    c.text("DAY", 329, 26, P["light"], "g9", align="center")
    c.text(f"{day}일" if day else "?일", 329, 42, P["yellow"] if day != 30 else P["red"], "g11b", align="center",
           scale=2)
    c.text(f"{cov * 100:.0f}%" if cov >= 0.01 else f"{cov * 100:.1f}%", 329, 76, P["green"], "g11", align="center")
    c.text("덮인 면적", 329, 94, P["grey"], "g9", align="center")
    # 되감기 표시
    if S.w(1, "바로") - 0.3 < t < S.w(1, "바로") + 0.5 and int(t * 8) % 2:
        c.text("◀◀", 329, 124, P["white"], "g11b", align="center")
    if S.cue(2) - 0.1 < t < S.w(2, "닷새"):
        tag(c, "맑은 물 97%", 329, 124, fg=P["ink"], bg=P["cyan"], fnt="g9", alpha=appear(t, S.w(2, "97")))
    # 낚시하는 사람 (오른쪽 아래 둑)
    tf = S.w(2, "닷새")
    shocked = day == 30 and t > tf
    sx, sy = 296, 200
    draw_person(c, sx, sy, shirt=P["orange"], pants=P["dblue"], hair_style="short",
                pose="up" if shocked else "hold", blink=(t % 3.2) < 0.12,
                mouth="o" if shocked else "smile", extras=("sweat",) if shocked else (), flip=True)
    if not shocked:
        c.line(sx - 8, sy - 16, sx - 40, sy - 44, P["dbrown"])
        c.line(sx - 40, sy - 44, sx - 46, sy - 20 + bob(t, 1, 2), P["light"])
        c.px(sx - 46, sy - 19 + bob(t, 1, 2), P["red"])
    if S.cue(2) < t < tf and day == 25:
        c.text("♪", sx + 12, sy - 42 + bob(t, 2, 3), P["white"], "g11", outline=P["ink"])
    if shocked:
        c.text("!", sx + 12, sy - 44, P["red"], "g11b", outline=P["ink"], scale=2)


@sfx("lilypond")
def lilypond_sfx(S):
    ev = []
    a0, a1 = S.cue(0) + 0.3, S.w(0, "30일") + 0.1
    for d in range(2, 31):
        ev.append((a0 + (a1 - a0) * (d - 1) / 29, "tick", 0.2))
    ev.append((S.w(1, "바로") - 0.3, "rewind", 0.5))
    tf = S.w(2, "닷새")
    for k in range(5):
        ev.append((tf + k * 0.38, "pop", 0.35 + k * 0.1))
    ev.append((tf + 4 * 0.38 + 0.1, "sting", 0.6))
    return ev


# ── 8. 무어의 법칙 ────────────────────────────────────────────
CHIPS = [(1971, 2.3e3), (1978, 2.9e4), (1985, 2.75e5), (1993, 3.1e6), (2000, 4.2e7), (2006, 2.9e8),
         (2010, 1.17e9), (2016, 7.2e9), (2020, 1.6e10), (2022, 1.14e11), (2024, 2.08e11)]
GX0, GY0, GX1, GY1 = 60, 176, 250, 40


def gxy(yr, n):
    x = GX0 + (yr - 1968) / (2026 - 1968) * (GX1 - GX0)
    y = GY0 - (math.log10(n) - 3) / (11.5 - 3) * (GY0 - GY1)
    return x, y


def moore_graph(c, t, S):
    graph_bg(c)
    panel(c, 30, 24, 232, 176, col=P["night2"])
    c.rect(GX0, GY1 - 4, 1, GY0 - GY1 + 4, P["light"])
    c.rect(GX0, GY0, GX1 - GX0 + 4, 1, P["light"])
    for yr in (1970, 1990, 2010):
        x, _ = gxy(yr, 1e3)
        c.rect(x, GY0, 1, 3, P["light"])
        c.text(str(yr), x, GY0 + 5, P["light"], "g7", align="center")
    for n, lab in ((1e3, "천"), (1e6, "백만"), (1e9, "10억"), (1e11, "천억")):
        _, y = gxy(1968, n)
        c.rect(GX0 - 3, y, 3, 1, P["light"])
        c.text(lab, GX0 - 5, y - 4, P["light"], "g7", align="right")
    c.text("칩 하나의 트랜지스터 수", 146, 28, P["white"], "g9", align="center")
    q = prog(t, S.w(0, "트랜지스터") - 0.4, 2.8)
    n = int(len(CHIPS) * q + 0.999) if q > 0 else 0
    # 추세선
    if q > 0:
        x0, y0 = gxy(1971, 2.3e3)
        x1, y1 = gxy(2024, 2.3e3 * 2 ** ((2024 - 1971) / 2.1))
        c.line(x0, y0, lerp(x0, x1, q), lerp(y0, y1, q), P["orange"], width=1)
    for i, (yr, v) in enumerate(CHIPS[:n]):
        x, y = gxy(yr, v)
        c.circle(x, y, 2, P["yellow"], outline=P["ink"])
    if q >= 1:
        tag(c, "약 2년마다 ×2", 150, 70, fg=P["ink"], bg=P["orange"], fnt="g9")
    a1 = appear(t, S.w(1, "1971"))
    if a1 > 0:
        x, y = gxy(1971, 2.3e3)
        c.ring(x, y, 5, P["cyan"], alpha=a1)
        tag(c, "1971 · 약 2,300개", x + 8, y - 22, fg=P["ink"], bg=P["cyan"], fnt="g9", align="left", alpha=a1)
    a2 = appear(t, S.w(1, "오늘날"))
    if a2 > 0:
        x, y = gxy(2024, 2.08e11)
        c.ring(x, y, 5, P["pink"], alpha=a2)
        tag(c, "오늘 · 수백억 개", x - 6, y + 10, fg=P["ink"], bg=P["pink"], fnt="g9", align="right", alpha=a2)
    # 오른쪽: 칩 비교
    a3 = appear(t, S.w(1, "1971"))
    if a3 > 0:
        chip(c, 306, 70, 12, col=P["dgrey"])
        for i in range(3):
            c.rect(300 + i * 5, 64, 3, 12, P["grey"], alpha=a3)
        c.text("4004", 306, 88, P["light"], "g9", align="center", alpha=a3)
    if a2 > 0:
        chip(c, 306, 140, 20, col=(30, 36, 70))
        rnd = random.Random(1)
        for yy in range(122, 158, 2):
            for xx in range(288, 324, 2):
                if rnd.random() < 0.5 + 0.3 * math.sin(t * 4 + xx * 0.3 + yy * 0.2):
                    c.px(xx, yy, P["cyan"] if rnd.random() < 0.3 else P["dteal"])
        c.text("오늘의 칩", 306, 166, P["light"], "g9", align="center")
    # 무어 카드
    a0 = appear(t, S.w(0, "고든"))
    if a0 > 0 and t < S.w(1, "1971"):
        panel(c, 270, 20, 104, 30, col=P["night2"], alpha=a0)
        c.text("고든 무어", 322, 24, P["white"], "g11", align="center", alpha=a0)
        c.text("1965 · 인텔 공동창업자", 322, 38, P["cyan"], "g7", align="center", alpha=a0)


def agc(c, cx, cy):
    c.rrect(cx - 30, cy - 22, 60, 44, 2, P["grey"], outline=P["ink"])
    c.rect(cx - 26, cy - 18, 24, 16, (20, 40, 30))
    for i in range(3):
        c.rect(cx - 24, cy - 16 + i * 5, 18, 3, P["green"])
    for i in range(3):
        for j in range(4):
            c.rect(cx + 2 + j * 6, cy - 18 + i * 7, 5, 5, P["light"])
            c.frame(cx + 2 + j * 6, cy - 18 + i * 7, 5, 5, P["ink"])
    for i in range(6):
        c.rect(cx - 26 + i * 9, cy + 4, 7, 12, P["dgrey"])


def phone(c, cx, cy, t):
    c.rrect(cx - 13, cy - 24, 26, 48, 4, P["ink"])
    c.rrect(cx - 11, cy - 22, 22, 44, 3, P["dblue"])
    for i in range(3):
        for j in range(3):
            col = [P["red"], P["green"], P["yellow"], P["cyan"], P["pink"], P["orange"]][(i * 3 + j) % 6]
            c.rrect(cx - 9 + j * 7, cy - 18 + i * 8, 5, 5, 1, col)
    c.rect(cx - 4, cy + 18, 8, 1, P["light"])
    glow(c, cx, cy, 30, P["cyan"], strength=0.2 + 0.1 * math.sin(t * 3), rings=2)


def moon_view(c, t, S):
    space(c, t, seed=12)
    c.circle(330, 40, 26, P["light"])
    c.circle(322, 34, 5, P["grey"])
    c.circle(338, 50, 4, P["grey"])
    c.circle(340, 30, 3, P["grey"])
    rocket(c, 280 + t * 3 % 20, 70, t, s=1)
    agc(c, 92, 110)
    c.text("아폴로 유도 컴퓨터", 92, 140, P["white"], "g9", align="center")
    c.text("1969", 92, 152, P["grey"], "g9", align="center")
    phone(c, 262, 112, t)
    c.text("스마트폰", 262, 144, P["white"], "g9", align="center")
    a = appear(t, S.w(2, "수백만"))
    if a > 0:
        arrow(c, 136, 110, 222, 110, P["yellow"], head=5, width=2, alpha=a)
        tag(c, "× 1,000,000+", 179, 92, fg=P["ink"], bg=P["yellow"], fnt="g11b", alpha=a)


@scene("moore")
def moore(c, t, S):
    p = ease_io(prog(t, S.cue(2) - 0.3, 0.6))
    mixview(c, p, lambda cc: moore_graph(cc, t, S), lambda cc: moon_view(cc, t, S))


@sfx("moore")
def moore_sfx(S):
    ev = [(S.w(0, "고든"), "pop", 0.5)]
    t0 = S.w(0, "트랜지스터") - 0.4
    for i in range(len(CHIPS)):
        ev.append((t0 + 2.8 * i / len(CHIPS), "tick", 0.3))
    ev += [(S.w(1, "1971"), "blip", 0.5), (S.w(1, "오늘날"), "blip", 0.5), (S.cue(2) - 0.3, "whoosh", 0.3),
           (S.w(2, "수백만"), "power", 0.5)]
    return ev


# ── 9. 변하지 않은 뇌 ─────────────────────────────────────────
TOOLS = ["axe", "wheel", "bulb", "gear", "computer", "rocket", "chip"]


def axe(c, cx, cy):
    c.line(cx - 6, cy + 8, cx + 4, cy - 6, P["brown"], width=2)
    c.poly([(cx + 1, cy - 8), (cx + 9, cy - 4), (cx + 6, cy + 2), (cx, cy - 3)], P["grey"])


def draw_tool(c, name, x, y, t):
    if name == "axe":
        axe(c, x, y)
    elif name == "wheel":
        wheel(c, x, y, 9, t)
    elif name == "bulb":
        bulb(c, x, y, t)
    elif name == "gear":
        gear(c, x, y, 8, t)
    elif name == "computer":
        computer(c, x, y, t)
    elif name == "rocket":
        rocket(c, x, y, t)
    elif name == "chip":
        chip(c, x, y, 8)


@scene("brain")
def brain_scene(c, t, S):
    def designers(cc):
        cc.vgrad(0, H, P["night1"], P["dpurple"])
        stars(cc, t, seed=13, n=60)
        cx, cy = 192, 118
        glow(cc, cx, cy, 44, P["pink"], strength=0.25)
        brain(cc, cx, cy + bob(t, 2, 2), s=3)
        for i, name in enumerate(TOOLS):
            a = math.pi + i * math.pi / (len(TOOLS) - 1)
            tx, ty = cx + math.cos(a) * 120, cy + 10 + math.sin(a) * 78
            t0 = 0.4 + i * (S.w(0, "도구") - 0.4) / len(TOOLS)
            dy = drop(t, t0, 10)
            if dy is None:
                continue
            k = prog(t, t0, 0.5)
            arrow(cc, cx + math.cos(a) * 44, cy + math.sin(a) * 34, lerp(cx, tx, k) - math.cos(a) * 14,
                  lerp(cy, ty, k) - math.sin(a) * 12, P["light"])
            draw_tool(cc, name, tx, ty + dy, t)
        a2 = appear(t, S.w(0, "인간의"))
        if a2 > 0:
            tag(cc, "설계자: 인간의 뇌", cx, 176, fg=P["ink"], bg=P["pink"], fnt="g11", alpha=a2)

    def upgrade(cc):
        cc.vgrad(0, H, P["night1"], P["night2"])
        cc.rect(0, 170, W, H - 170, P["night0"])
        cc.rect(0, 170, W, 1, P["night3"])
        # 원시인과 현대인
        draw_person(cc, 80, 170, scale=2, shirt=P["brown"], pants=P["dbrown"], hair_style="long", hair=P["ink"],
                    pose="hold", blink=(t % 3.1) < 0.12)
        axe(cc, 104, 128)
        draw_person(cc, 304, 170, scale=2, shirt=P["blue"], pants=P["ink"], hair_style="short",
                    pose="hold", blink=(t % 2.8) < 0.12, flip=True)
        phone_small(cc, 280, 128)
        cc.text("5만 년 전", 80, 180, P["light"], "g11", align="center")
        cc.text("오늘", 304, 180, P["light"], "g11", align="center")
        for x in (80, 304):
            brain(cc, x, 42, s=2)
            tag(cc, "v1.0", x, 62, fg=P["ink"], bg=P["pink"], fnt="g9")
        # 업데이트 확인 대화상자
        t0 = S.w(1, "업그레이드") - 1.2
        a = appear(t, t0, 0.2)
        if a > 0:
            panel(cc, 128, 70, 128, 62, col=P["light"], border=P["ink"], alpha=a)
            cc.rect(129, 71, 126, 13, P["dblue"], alpha=a)
            cc.text("뇌 업데이트", 133, 72, P["white"], "g9", alpha=a)
            q = prog(t, t0 + 0.2, 1.4)
            if q < 1:
                cc.text("업데이트 확인 중...", 192, 90, P["ink"], "g9", align="center", alpha=a)
                cc.rect(140, 108, 104, 8, P["grey"], alpha=a)
                cc.rect(141, 109, int(102 * q), 6, P["green"], alpha=a)
            else:
                cc.text("최신 버전입니다.", 192, 88, P["ink"], "g9", align="center")
                cc.text("(마지막 업데이트:\n약 5만 년 전)", 192, 102, P["dgrey"], "g9", align="center")

    p = ease_io(prog(t, S.cue(1) - 0.3, 0.6))
    mixview(c, p, designers, upgrade)


def phone_small(c, cx, cy):
    c.rrect(cx - 4, cy - 7, 8, 14, 1, P["ink"])
    c.rect(cx - 3, cy - 5, 6, 9, P["cyan"])


@sfx("brain")
def brain_sfx(S):
    ev = []
    for i in range(len(TOOLS)):
        ev.append((0.4 + i * (S.w(0, "도구") - 0.4) / len(TOOLS), "pop", 0.4))
    ev.append((S.cue(1) - 0.3, "whoosh", 0.3))
    t0 = S.w(1, "업그레이드") - 1.2
    ev += [(t0, "blip", 0.5), (t0 + 1.6, "error", 0.5)]
    return ev
