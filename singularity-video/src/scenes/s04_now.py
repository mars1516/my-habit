"""4부: 지금 우리는 어디에? — 딥 블루, 알파고, 2020년대, 설문 / 좋은 미래 / 미다스 왕"""
import math
import random

import numpy as np

from anim import back, bob, clamp01, ease_in, ease_io, ease_out, lerp, prog
from chars import bit, draw_bit, draw_person
from gfx import BAYER_FULL, H, P, W, Canvas, mix, stars
from props import (appear, arrow, burst, chip, clipped, curved_arrow, drop, glow, noise_rect, panel, qmark,
                   sparkle, tag, space, bubble, rocket, scanlines, earth)
from .s01_intro import horizon_curtain
from .s02_growth import mixview
from . import scene, sfx


# ── 13. 역사 ──────────────────────────────────────────────────
def rewind(c, t, S):
    c.fill(P["night0"])
    q = ease_io(prog(t, S.w(0, "돌아봅시다") - 0.4, 1.2))
    year = int(round(lerp(2026, 1997, q)))
    c.text(str(year), 192, 70, P["white"], "g11b", align="center", scale=4, outline=P["ink"])
    if 0 < q < 1:
        c.text("◀◀", 192, 150, P["yellow"], "g11b", align="center", scale=2)
        rnd = random.Random(int(t * 24))
        for i in range(4):
            y = rnd.randint(0, H - 4)
            noise_rect(c, 0, y, W, 2, t, [P["light"], P["grey"]], 0.5, seed=i)
    else:
        qmark(c, 192, 150, t, scale=2)
    scanlines(c, 0.25)


def deep_blue(c, t, S):
    c.vgrad(0, H, (24, 26, 60), (40, 44, 90))
    c.rect(0, 150, W, H - 150, (28, 30, 64))
    c.rect(0, 150, W, 1, P["night3"])
    # 조명
    for x in (110, 274):
        c.poly([(x - 6, 0), (x + 6, 0), (x + 44, 150), (x - 44, 150)], (50, 56, 110), alpha=0.35)
    # 딥 블루 캐비닛
    for i in range(2):
        x = 34 + i * 34
        c.rect(x, 56, 30, 96, P["ink"])
        c.rect(x + 2, 58, 26, 92, (22, 26, 48))
        for j in range(6):
            c.rect(x + 4, 62 + j * 14, 22, 3, P["dblue"])
            if (int(t * 6) + i * 3 + j) % 5 == 0:
                c.px(x + 24, 66 + j * 14, P["green"])
    c.text("DEEP BLUE", 64, 44, P["blue"], "g9", align="center")
    # 체스 테이블
    c.rect(130, 118, 124, 6, P["brown"])
    c.rect(150, 124, 6, 28, P["dbrown"])
    c.rect(228, 124, 6, 28, P["dbrown"])
    for i in range(8):
        for j in range(3):
            c.rect(160 + i * 8, 108 + j * 3, 8, 3, P["white"] if (i + j) % 2 else P["ink"])
    c.rect(170, 100, 3, 8, P["ink"])
    c.rect(206, 102, 3, 6, P["white"])
    # 모니터 (딥 블루의 수)
    c.rrect(100, 90, 24, 18, 2, P["grey"], outline=P["ink"])
    c.rect(103, 93, 18, 12, P["dteal"])
    c.text("Qe7", 112, 94, P["green"], "g7", align="center")
    # 카스파로프
    won = t > S.w(1, "이겼습니다") - 0.1
    draw_person(c, 292, 152, scale=2, shirt=P["ink"], pants=P["ink"], hair_style="short", hair=P["ink"],
                pose="think" if won else "hold", blink=(t % 3) < 0.12, mouth="frown" if won else None,
                flip=True, extras=("tie",))
    tag(c, "1997", 192, 12, fg=P["ink"], bg=P["yellow"], fnt="g11b")
    c.text("딥 블루", 64, 160, P["light"], "g9", align="center")
    c.text("가리 카스파로프", 292, 160, P["light"], "g9", align="center")
    if won:
        tag(c, "컴퓨터 승리!", 192, 34, fg=P["white"], bg=P["red"], fnt="g11", alpha=appear(t, S.w(1, "이겼습니다") - 0.1))
    ta = S.w(1, "체스는")
    if t > ta - 0.2:
        bubble(c, "체스는 계산일 뿐!", 110, 196, 96, 204, fnt="g9", alpha=appear(t, ta - 0.2))
    tb = S.w(1, "바둑은")
    if t > tb - 0.2:
        bubble(c, "바둑은 다를걸?", 280, 196, 300, 204, fnt="g9", alpha=appear(t, tb - 0.2))


# 알파고 대국: 바둑판 위에 돌이 쌓여 간다
_rng = random.Random(19)
GO_MOVES = []
_taken = set()
while len(GO_MOVES) < 120:
    gx, gy = _rng.randint(0, 18), _rng.randint(0, 18)
    if (gx, gy) not in _taken:
        _taken.add((gx, gy))
        GO_MOVES.append((gx, gy))


def go_board(c, t, S):
    c.fill((30, 26, 40))
    c.rect(0, 0, W, H, (36, 30, 46))
    bx, by, cell = 24, 22, 9
    size = cell * 18
    c.rect(bx - 8, by - 8, size + 16, size + 16, (206, 160, 90))
    c.frame(bx - 8, by - 8, size + 16, size + 16, P["dbrown"])
    for i in range(19):
        c.rect(bx + i * cell, by, 1, size + 1, (120, 80, 40))
        c.rect(bx, by + i * cell, size + 1, 1, (120, 80, 40))
    for i in (3, 9, 15):
        for j in (3, 9, 15):
            c.rect(bx + i * cell - 1, by + j * cell - 1, 3, 3, (120, 80, 40))
    q = prog(t, S.cue(2), S.durs[2] * 0.8)
    n = int(len(GO_MOVES) * q)
    for k, (gx, gy) in enumerate(GO_MOVES[:n]):
        col = P["ink"] if k % 2 == 0 else P["white"]
        c.circle(bx + gx * cell, by + gy * cell, 3, col, outline=P["ink"] if k % 2 else None)
    # 오른쪽: 스코어보드
    panel(c, 212, 20, 160, 110, col=P["night2"])
    tag(c, "2016 · 서울", 292, 26, fg=P["ink"], bg=P["cyan"], fnt="g9")
    c.text("알파고", 250, 50, P["white"], "g11", align="center")
    c.text("이세돌 9단", 334, 50, P["white"], "g11", align="center")
    ts = S.w(2, "4대")
    if t > ts - 0.3:
        c.text("4", 250, 68, P["cyan"], "g11b", align="center", scale=2)
        c.text(":", 292, 68, P["light"], "g11b", align="center", scale=2)
        c.text("1", 334, 68, P["yellow"], "g11b", align="center", scale=2)
    for g in range(5):
        x = 232 + g * 15
        tg = S.cue(2) + 0.4 + g * 0.35
        if t > tg:
            human = g == 3
            c.circle(x + 14, 112, 5, P["yellow"] if human else P["cyan"], outline=P["ink"])
            c.text(str(g + 1), x + 14, 108, P["ink"], "g7", align="center")
    if t > S.w(2, "유일한") - 0.2:
        tag(c, "인간의 유일한 승리", 292, 140, fg=P["ink"], bg=P["yellow"], fnt="g9",
            alpha=appear(t, S.w(2, "유일한") - 0.2))
    # 신의 한 수
    t78 = S.w(2, "신의")
    if t > t78 - 0.3:
        gx, gy = 11, 8
        x, y = bx + gx * cell, by + gy * cell
        a = appear(t, t78 - 0.3)
        glow(c, x, y, 12 + 2 * math.sin(t * 6), P["yellow"], strength=0.5 * a)
        c.circle(x, y, 3, P["white"], outline=P["ink"])
        tag(c, "제4국 · 78수 '신의 한 수'", x, y + 8, fg=P["ink"], bg=P["yellow"], fnt="g9", alpha=a)
    # 사람 둘 (작게)
    draw_person(c, 250, 196, shirt=P["ink"], pants=P["ink"], hair_style="short", hair=P["ink"],
                blink=(t % 3) < 0.12, extras=("tie",))
    draw_bit(c, 334, 178, level=2, t=t)


WORKS = [("글을", "doc"), ("그림을", "art"), ("코드를", "code"), ("칩", "chip"), ("더 나은", "ai")]


def work_card(c, kind, x, y, t):
    panel(c, x, y, 70, 50, col=P["white"], border=P["ink"])
    c.rect(x + 1, y + 1, 68, 8, P["light"])
    for i in range(3):
        c.px(x + 4 + i * 4, y + 4, [P["red"], P["yellow"], P["green"]][i])
    if kind == "doc":
        for i in range(5):
            c.rect(x + 6, y + 14 + i * 7, 56 - (i * 11) % 20, 2, P["grey"])
    elif kind == "art":
        c.rect(x + 5, y + 12, 60, 34, (120, 190, 250))
        c.circle(x + 50, y + 20, 5, P["yellow"])
        c.poly([(x + 5, y + 46), (x + 25, y + 24), (x + 42, y + 46)], P["dgreen"])
        c.poly([(x + 28, y + 46), (x + 48, y + 30), (x + 65, y + 46)], P["green"])
    elif kind == "code":
        c.rect(x + 3, y + 11, 64, 37, P["ink"])
        cols = [P["pink"], P["cyan"], P["yellow"], P["green"], P["light"]]
        for i in range(6):
            ind = (i % 3) * 4
            c.rect(x + 6 + ind, y + 14 + i * 5, 10 + (i * 7) % 16, 2, cols[i % 5])
            c.rect(x + 20 + ind + (i * 7) % 16, y + 14 + i * 5, 8, 2, cols[(i + 2) % 5])
    elif kind == "chip":
        c.rect(x + 3, y + 11, 64, 37, (20, 40, 30))
        for i in range(8):
            c.line(x + 6 + i * 7, y + 14, x + 6 + i * 7, y + 44, P["dgreen"])
        for j in range(5):
            c.line(x + 6, y + 15 + j * 7, x + 62, y + 15 + j * 7, P["green"])
        c.rect(x + 26, y + 22, 18, 14, P["yellow"])
    elif kind == "ai":
        c.rect(x + 3, y + 11, 64, 37, P["dblue"])
        spr = bit(2, "open")
        c.blit(spr, x + 35 - spr.shape[1] // 2, y + 14, tint=P["white"])
        c.text("v2", x + 58, y + 38, P["white"], "g7", align="center")


def ai_2020s(c, t, S):
    c.vgrad(0, H, P["night1"], P["dpurple"])
    stars(c, t, seed=31, n=50)
    tag(c, "2020년대", 192, 10, fg=P["ink"], bg=P["yellow"], fnt="g11b")
    cx, cy = 192, 118
    draw_bit(c, cx, cy, level=2, t=t, eye="focus")
    pos = [(28, 34), (286, 34), (28, 140), (286, 140), (157, 156)]
    for i, (w, kind) in enumerate(WORKS):
        tw = S.w(3, w) - 0.1
        dy = drop(t, tw, 12)
        if dy is None:
            continue
        x, y = pos[i]
        c.dline(cx, cy, x + 35, y + 25, P["cyan"], phase=int(t * 10))
        work_card(c, kind, x, y + dy, t)
    labels = ["글", "그림", "코드", "칩 설계", "더 나은 AI"]
    for i, (w, _) in enumerate(WORKS):
        tw = S.w(3, w)
        if t > tw:
            x, y = pos[i]
            tag(c, labels[i], x + 35, y - 12 if y > 100 else y + 52, fg=P["ink"], bg=P["cyan"], fnt="g9",
                alpha=appear(t, tw))


def loop_view(c, t, S):
    c.fill(P["night1"])
    cx, cy, R = 192, 104, 62
    q = prog(t, S.cue(4), S.durs[4])
    gap = lerp(1.1, 0.35, ease_io(q))    # 고리의 빈틈(라디안)
    a0 = -math.pi / 2 + gap / 2
    a1 = -math.pi / 2 + 2 * math.pi - gap / 2
    curved_arrow(c, cx, cy, R, a0, a1, P["cyan"], head=6, width=3)
    nodes = [("AI", -math.pi / 2 + 2.1), ("AI 연구", -math.pi / 2 + 4.2), ("더 나은 AI", -math.pi / 2 + 0.9)]
    for lab, a in nodes:
        x, y = cx + math.cos(a) * R, cy + math.sin(a) * R
        tag(c, lab, x, y - 7, fg=P["ink"], bg=P["white"], fnt="g9")
    draw_bit(c, cx, cy, level=2, t=t)
    # 빈틈을 메우는 사람의 손
    gx, gy = cx, cy - R
    draw_person(c, gx, gy + 30, shirt=P["orange"], pose="up", blink=(t % 3) < 0.12)
    tag(c, "사람의 손", gx, gy + 34, fg=P["ink"], bg=P["orange"], fnt="g9")
    c.text("스스로를 개선하는 고리", 192, 196, P["light"], "g11", align="center")


def survey(c, t, S):
    c.fill(P["night1"])
    panel(c, 16, 14, 352, 188, col=P["night2"])
    c.text("인간 수준 기계 지능은 언제?", 192, 20, P["white"], "g11", align="center")
    c.text("2023 · AI 연구자 수천 명 설문 (개념도)", 192, 36, P["grey"], "g9", align="center")
    x0, x1, y0 = 36, 300, 170
    c.rect(x0, y0, x1 - x0 + 50, 1, P["light"])
    for yr, lab in ((2030, "2030"), (2050, "2050"), (2070, "2070"), (2090, "2090")):
        x = x0 + (yr - 2025) / 75 * (x1 - x0)
        c.rect(x, y0, 1, 3, P["light"])
        c.text(lab, x, y0 + 6, P["light"], "g7", align="center")
    c.text("불가능", x1 + 32, y0 + 6, P["light"], "g7", align="center")
    rnd = random.Random(7)
    q = prog(t, S.cue(5) + 0.4, S.durs[5] * 0.55)
    n_total = 170
    n = int(n_total * q)
    bins = {}
    for i in range(n_total):
        v = 2025 + math.exp(rnd.gauss(math.log(22), 0.75))
        never = rnd.random() < 0.06
        if i >= n:
            continue
        if never or v > 2100:
            b = "never"
        else:
            b = int((v - 2025) / 3)
        bins[b] = bins.get(b, 0) + 1
        k = bins[b]
        if b == "never":
            x = x1 + 32 + (k % 5) * 3 - 6
            y = y0 - 3 - (k // 5) * 3
        else:
            x = x0 + b * 3 / 75 * (x1 - x0) + 1
            y = y0 - 3 * k
        c.rect(x, y, 2, 2, P["cyan"] if b != "never" else P["grey"])
    tm = S.w(5, "2040년대")
    if t > tm - 0.2:
        a = appear(t, tm - 0.2)
        x = x0 + (2047 - 2025) / 75 * (x1 - x0)
        c.dline(x, 60, x, y0, P["yellow"])
        tag(c, "중간 예측: 2040년대", x + 4, 56, fg=P["ink"], bg=P["yellow"], fnt="g9", align="left", alpha=a)
    if t > S.w(5, "몇 년") - 0.2:
        tag(c, "몇 년 안", x0 + 14, 140, fg=P["ink"], bg=P["cyan"], fnt="g7", alpha=appear(t, S.w(5, "몇 년") - 0.2))
    if t > S.w(5, "불가능하다는") - 0.2:
        tag(c, "절대 불가능", x1 + 32, 124, fg=P["ink"], bg=P["light"], fnt="g7",
            alpha=appear(t, S.w(5, "불가능하다는") - 0.2))


@scene("history")
def history(c, t, S):
    segs = [(0, rewind), (S.cue(1) - 0.3, deep_blue), (S.cue(2) - 0.3, go_board), (S.cue(3) - 0.3, ai_2020s),
            (S.cue(4) - 0.3, loop_view), (S.cue(5) - 0.3, survey)]
    k = 0
    for i, (ts, _) in enumerate(segs):
        if t >= ts:
            k = i
    ts, fn = segs[k]
    if k > 0 and t - ts < 0.5:
        prev = segs[k - 1][1]
        mixview(c, (t - ts) / 0.5, lambda cc: prev(cc, t, S), lambda cc: fn(cc, t, S))
    else:
        fn(c, t, S)


@sfx("history")
def history_sfx(S):
    ev = [(S.w(0, "돌아봅시다") - 0.4, "rewind", 0.6), (S.w(1, "이겼습니다") - 0.1, "sting", 0.5),
          (S.w(1, "체스는") - 0.2, "pop", 0.4), (S.w(1, "바둑은") - 0.2, "pop", 0.4)]
    for i in range(0, 30, 2):
        ev.append((S.cue(2) + i * S.durs[2] * 0.8 / 30, "stone", 0.3))
    ev += [(S.w(2, "4대") - 0.3, "blip", 0.5), (S.w(2, "신의") - 0.3, "chime", 0.6)]
    for w, _ in WORKS:
        ev.append((S.w(3, w) - 0.1, "pop", 0.45))
    ev += [(S.cue(4), "hum", 0.3), (S.cue(5) + 0.4, "tick", 0.3), (S.w(5, "2040년대") - 0.2, "blip", 0.5)]
    return ev


# ── 14. 좋은 미래 ─────────────────────────────────────────────
def city(c, t, bright=1.0):
    c.vgrad(0, 150, (120, 210, 250), (250, 236, 200))
    c.circle(300, 46, 18, P["yellow"])
    glow(c, 300, 46, 34, P["yellow"], strength=0.3)
    # 먼 건물
    rnd = random.Random(4)
    x = 0
    while x < W:
        w = rnd.randint(14, 28)
        h = rnd.randint(30, 80)
        c.rect(x, 150 - h, w, h, (150, 190, 220))
        x += w + rnd.randint(2, 8)
    # 가까운 건물 (둥근 미래형 + 식물)
    rnd = random.Random(9)
    x = 4
    while x < W:
        w = rnd.randint(22, 38)
        h = rnd.randint(40, 100)
        col = rnd.choice([(250, 250, 255), (220, 240, 250), (200, 230, 240)])
        c.rrect(x, 160 - h, w, h + 20, 8, col, outline=(120, 160, 190))
        for j in range(3, h - 6, 10):
            c.rect(x + 4, 160 - h + j, w - 8, 3, (110, 200, 230))
            c.rect(x + 2, 160 - h + j + 4, w - 4, 2, P["green"])
        x += w + rnd.randint(4, 10)
    c.rect(0, 160, W, H - 160, (120, 200, 120))
    c.rect(0, 160, W, 2, P["dgreen"])
    for i in range(6):
        x = (i * 71 + t * 30) % (W + 40) - 20
        y = 60 + (i * 17) % 50
        c.rrect(x, y, 12, 4, 2, P["white"], outline=P["dgrey"])
        c.px(x + 12, y + 2, P["cyan"])
    # 풍력 발전기
    for x in (40, 350):
        c.rect(x, 110, 2, 50, P["white"])
        for k in range(3):
            a = t * 3 + k * 2.094
            c.line(x + 1, 110, x + 1 + math.cos(a) * 14, 110 + math.sin(a) * 14, P["white"], width=2)


@scene("utopia")
def utopia(c, t, S):
    t_open = S.w(0, "상상해") - 0.1

    def curtain(cc):
        cc.fill(P["night0"])
        horizon_curtain(cc, t, -4)
        draw_person(cc, 150, 170, shirt=P["blue"], blink=(t % 3) < 0.12)
        draw_bit(cc, 190, 150, level=3, t=t)
        qmark(cc, 150, 128, t)
        qmark(cc, 196, 110, t, ph=1)
        if t > t_open:
            q = ease_in(prog(t, t_open, 1.0))
            w = int(W * q)
            cc.rect(192 - w // 2, 0, w, H, (255, 250, 230))

    def bright(cc):
        city(cc, t)
        draw_bit(cc, 192, 108 + bob(t, 2, 1.5), level=3, t=t, eye="happy")
        draw_person(cc, 160, 196, shirt=P["orange"], pose="wave", blink=(t % 3) < 0.12, mouth="smile")
        draw_person(cc, 226, 196, shirt=P["teal"], hair_style="long", pose="up", mouth="smile", blink=(t % 2.7) < 0.1)
        # 풀리는 문제들
        if S.cue(1) < t < S.cue(2):
            rnd = random.Random(3)
            for i in range(8):
                x, y = rnd.randint(30, 350), rnd.randint(20, 90)
                tq = S.cue(1) + 0.5 + i * (S.durs[1] - 1.0) / 8
                if t < tq:
                    c_ = P["red"]
                    cc.text("?", x, y, c_, "g11b", align="center", outline=P["ink"])
                else:
                    check(cc, x, y + 6)
        # 약속들
        if t > S.cue(2) - 0.2:
            items = [("질병", "치료", P["red"]), ("노화", "늦추고", P["purple"]), ("깨끗한", "에너지", P["yellow"]),
                     ("다른 별", "우주", P["cyan"])]
            for i, (w, lab, col) in enumerate(items):
                tw = S.w(2, w) - 0.1
                dy = drop(t, tw, 12)
                if dy is None:
                    continue
                x = 48 + i * 96
                panel(cc, x - 30, 16 + dy, 60, 46, col=P["white"], border=P["ink"])
                icon(cc, i, x, 36 + dy, t)
                cc.text(["질병 치료", "노화 늦추기", "청정 에너지", "다른 별로"][i], x, 50 + dy, P["ink"], "g9",
                        align="center")
            tb = S.w(2, "가난")
            if t > tb - 0.2:
                book(cc, 192, 140, t, prog(t, tb + 0.8, 0.6))

    p = ease_io(prog(t, S.cue(1) - 0.5, 0.5))
    mixview(c, p, curtain, bright)


def check(c, x, y, col=None):
    col = col or P["green"]
    for dx, dy in ((0, 0), (1, 0), (0, 1)):
        c.line(x - 5 + dx, y + dy, x - 1 + dx, y + 4 + dy, P["ink"], width=1)
    c.line(x - 5, y - 1, x - 1, y + 3, col, width=3)
    c.line(x - 1, y + 3, x + 6, y - 6, col, width=3)


def icon(c, i, x, y, t):
    if i == 0:
        c.rect(x - 2, y - 7, 5, 15, P["red"])
        c.rect(x - 7, y - 2, 15, 5, P["red"])
    elif i == 1:
        c.poly([(x - 6, y - 8), (x + 6, y - 8), (x, y)], P["sand"])
        c.poly([(x - 6, y + 8), (x + 6, y + 8), (x, y)], P["sand"])
        c.rect(x - 7, y - 9, 15, 1, P["dbrown"])
        c.rect(x - 7, y + 8, 15, 1, P["dbrown"])
        c.rect(x, y - 1, 1, 7, P["yellow"])
    elif i == 2:
        c.circle(x, y, 5, P["yellow"])
        for k in range(8):
            a = k * math.pi / 4 + t
            c.px(x + math.cos(a) * 8, y + math.sin(a) * 8, P["orange"])
    else:
        rocket(c, x, y, t, s=1)


def book(c, cx, cy, t, close_q):
    w = int(lerp(90, 46, ease_io(close_q)))
    c.rect(cx - w, cy - 24, w * 2, 48, P["brown"])
    c.rect(cx - w + 3, cy - 21, w * 2 - 6, 42, P["rice"])
    c.rect(cx, cy - 21, 1, 42, P["sand"])
    if close_q < 0.5:
        c.text("역사책", cx - w / 2, cy - 18, P["dbrown"], "g9", align="center")
        c.text("가난", cx + w / 2, cy - 6, P["ink"], "g11b", align="center")
        c.rect(cx + w / 2 - 14, cy - 12, 28, 1, P["grey"])
    else:
        c.text("역사책", cx, cy - 6, P["dbrown"], "g11b", align="center")


@sfx("utopia")
def utopia_sfx(S):
    ev = [(S.w(0, "상상해") - 0.1, "rise", 0.6), (S.cue(1) - 0.5, "chime", 0.6)]
    for i in range(8):
        ev.append((S.cue(1) + 0.5 + i * (S.durs[1] - 1.0) / 8, "blip", 0.25))
    for w in ("질병", "노화", "깨끗한", "다른 별"):
        ev.append((S.w(2, w) - 0.1, "pop", 0.45))
    ev.append((S.w(2, "가난") + 0.8, "thud", 0.5))
    return ev


# ── 15. 미다스 왕 ─────────────────────────────────────────────
def killer_robot(c, t, S):
    c.fill((20, 10, 20))
    # 영화 스크린 (필름 테두리)
    c.rect(40, 20, 304, 160, (40, 16, 24))
    for i in range(0, 304, 16):
        c.rect(44 + i, 24, 8, 6, (80, 60, 70))
        c.rect(44 + i, 170, 8, 6, (80, 60, 70))
    c.vgrad(34, 166, (90, 20, 30), (30, 10, 20), x0=48, x1=336)
    # 무시무시한 로봇
    cx = 192
    c.rect(cx - 30, 70, 60, 70, P["dgrey"])
    c.rect(cx - 22, 40, 44, 34, P["grey"])
    c.rect(cx - 18, 50, 36, 10, P["ink"])
    for ex in (cx - 10, cx + 10):
        c.rect(ex - 3, 53, 6, 4, P["red"])
        glow(c, ex, 55, 8, P["red"], strength=0.5)
    c.rect(cx - 50, 76, 20, 50, P["dgrey"])
    c.rect(cx + 30, 76, 20, 50, P["dgrey"])
    c.text("살인 로봇의 습격", 192, 146, P["red"], "g11b", align="center", outline=P["ink"])
    tx = S.w(0, "아닙니다") - 0.2
    if t > tx:
        q = prog(t, tx, 0.25)
        k = int(80 * q)
        c.line(cx - k, 100 - k, cx + k, 100 + k, P["red"], width=8)
        c.line(cx + k, 100 - k, cx - k, 100 + k, P["red"], width=8)
    if t > S.w(0, "미묘") - 0.2:
        tag(c, "진짜 문제는 더 미묘하다", 192, 186, fg=P["ink"], bg=P["yellow"], fnt="g11",
            alpha=appear(t, S.w(0, "미묘") - 0.2))


def palace(c, t, S):
    c.vgrad(0, 160, (250, 214, 160), (240, 170, 120))
    for x in (20, 100, 284, 364):
        c.rect(x - 8, 30, 16, 130, (250, 240, 220))
        for k in range(3):
            c.rect(x - 5 + k * 4, 36, 1, 118, (220, 200, 170))
        c.rect(x - 11, 26, 22, 6, (250, 240, 220))
        c.rect(x - 11, 156, 22, 6, (250, 240, 220))
    c.rect(0, 20, W, 8, (230, 210, 180))
    c.rect(0, 162, W, H - 162, (170, 110, 90))
    c.rect(0, 162, W, 2, (200, 140, 110))
    t_food, t_water, t_girl = S.w(1, "음식도") - 0.1, S.w(1, "물도") - 0.1, S.w(1, "딸까지도") - 0.4
    # 탁자
    c.rect(160, 138, 90, 5, P["brown"])
    c.rect(168, 143, 4, 20, P["dbrown"])
    c.rect(238, 143, 4, 20, P["dbrown"])
    gold_a = t > t_food
    c.circle(180, 130, 6, P["gold"] if gold_a else P["red"], outline=P["dgold"] if gold_a else P["dred"])
    c.rect(180, 121, 1, 3, P["dbrown"])
    c.px(182, 122, P["green"] if not gold_a else P["dgold"])
    if gold_a:
        sparkle(c, 186, 124, t, P["white"], 0.9)
    gold_w = t > t_water
    cup = P["gold"] if gold_w else P["light"]
    c.poly([(214, 118), (230, 118), (227, 134), (217, 134)], cup)
    c.rect(220, 134, 4, 3, cup)
    c.rect(216, 137, 12, 1, cup)
    if not gold_w:
        c.rect(216, 120, 12, 3, P["water"])
    else:
        sparkle(c, 230, 120, t, P["white"], 1.1, 0.3)
    # 미다스 왕
    wished = t > S.w(1, "빌었습니다") - 0.2
    sad = t > t_girl + 0.8
    draw_person(c, 110, 190, scale=2, shirt=P["red"], pants=P["dred"], hair_style="short", hair=P["dbrown"],
                extras=("crown", "robe"), pose="up" if wished and not gold_a else ("reach" if not sad else "idle"),
                blink=(t % 3.2) < 0.12, mouth="frown" if sad else ("smile" if wished else None), flip=False)
    tag(c, "미다스 왕", 110, 12, fg=P["ink"], bg=P["gold"], fnt="g11")
    if wished and t < t_food:
        for i in range(6):
            sparkle(c, 110 + math.cos(i + t * 3) * 30, 110 + math.sin(i + t * 3) * 30, t, P["gold"], 0.8, i * 0.13)
    # 딸
    if t > t_girl:
        q = prog(t, t_girl, 0.7)
        gx = lerp(400, 290, ease_out(q))
        golden = t > t_girl + 0.8
        spr_kw = dict(shirt=P["pink"], pants=P["pink"], hair_style="long", hair=P["brown"],
                      pose="hug", blink=False, mouth="smile", extras=("robe",))
        if golden:
            from chars import person
            spr = person(**spr_kw)
            c.blit(spr, gx - 12 * 2, 190 - 30 * 2, scale=2, flip=True, tint=P["gold"])
            sparkle(c, gx - 6, 150, t, P["white"], 0.8)
            sparkle(c, gx + 10, 170, t, P["white"], 1.0, 0.4)
        else:
            from chars import draw_person as dp
            dp(c, gx, 190, scale=2, flip=True, walk=t * 2 if q < 1 else None, **spr_kw)


def venn(c, t, S):
    c.fill(P["night1"])
    q = ease_io(prog(t, S.cue(2), 1.0))
    d = lerp(90, 56, q)
    ca, cb = (192 - d / 2, 96), (192 + d / 2, 96)
    c.circle(*ca, 56, P["blue"], alpha=0.55)
    c.circle(*cb, 56, P["pink"], alpha=0.55)
    c.ring(*ca, 56, P["blue"], width=2)
    c.ring(*cb, 56, P["pink"], width=2)
    c.text("우리가\n말한 것", ca[0] - 22, 86, P["white"], "g9", align="center")
    c.text("우리가\n원한 것", cb[0] + 22, 86, P["white"], "g9", align="center")
    ta = S.w(2, "정렬")
    if t > ta - 0.2:
        a = appear(t, ta - 0.2)
        tag(c, "정렬 문제 (Alignment Problem)", 192, 176, fg=P["ink"], bg=P["yellow"], fnt="g11", alpha=a)


@scene("midas")
def midas(c, t, S):
    segs = [(0, killer_robot), (S.cue(1) - 0.3, palace), (S.cue(2) - 0.3, venn)]
    k = 0
    for i, (ts, _) in enumerate(segs):
        if t >= ts:
            k = i
    ts, fn = segs[k]
    if k > 0 and t - ts < 0.5:
        prev = segs[k - 1][1]
        mixview(c, (t - ts) / 0.5, lambda cc: prev(cc, t, S), lambda cc: fn(cc, t, S))
    else:
        fn(c, t, S)


@sfx("midas")
def midas_sfx(S):
    return [(S.w(0, "아닙니다") - 0.2, "stamp", 0.8), (S.w(1, "빌었습니다") - 0.2, "shimmer", 0.6),
            (S.w(1, "음식도") - 0.1, "gold", 0.6), (S.w(1, "물도") - 0.1, "gold", 0.6),
            (S.w(1, "딸까지도") + 0.4, "gold", 0.7), (S.w(1, "딸까지도") + 0.6, "sting", 0.5),
            (S.w(2, "정렬") - 0.2, "blip", 0.6)]
