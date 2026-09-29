"""5부: 위험(클립, 개미집) / 회의론 / 결말 / 엔드카드"""
import math
import random

from anim import back, bob, clamp01, ease_in, ease_io, ease_out, lerp, prog, shake
from chars import ANT, draw_bit, draw_person
from gfx import BAYER_FULL, H, P, W, Canvas, mix, stars
from props import (appear, arrow, burst, chip, clipped, drop, earth, glow, mystery_box, noise_rect, panel,
                   paperclip, qmark, rocket, sparkle, tag, bubble, space, vignette)
from .s01_intro import HORIZON_X, YEARS, horizon_curtain, portrait_card
from .s02_growth import mixview
from . import scene, sfx


def segments(c, t, S, segs, fade=0.5):
    k = 0
    for i, (ts, _) in enumerate(segs):
        if t >= ts:
            k = i
    ts, fn = segs[k]
    if k > 0 and t - ts < fade:
        prev = segs[k - 1][1]
        mixview(c, (t - ts) / fade, lambda cc: prev(cc, t, S), lambda cc: fn(cc, t, S))
    else:
        fn(c, t, S)


# ── 16. 클립 극대화기 ─────────────────────────────────────────
def clip_goal(c, t, S):
    c.fill(P["night1"])
    for x in range(0, W, 24):
        c.rect(x, 0, 1, H, (26, 32, 80))
    a0 = appear(t, S.w(0, "닉"), 0.4)
    if a0 > 0:
        portrait_card(c, 12, 12, "닉 보스트롬", "철학자 · 2003", a0, t, shirt=P["dgrey"], hair_style="bald",
                      hair=P["dbrown"], extras=("glasses",))
    tb = S.w(0, "클립을") - 0.2
    if t > tb:
        a = appear(t, tb)
        draw_bit(c, 120, 128, level=3, t=t, eye="focus")
        panel(c, 176, 96, 188, 64, col=P["white"], border=P["ink"], alpha=a)
        c.rect(176, 96, 188, 14, P["red"], alpha=a)
        c.text("목표 입력", 182, 97, P["white"], "g9", alpha=a)
        c.text("클립을 최대한 많이!", 270, 122, P["ink"], "g11b", align="center", alpha=a,
               reveal=prog(t, tb + 0.2, 1.0))
        if a >= 1:
            paperclip(c, 350, 136, P["grey"], s=2)
        c.dline(144, 128, 176, 128, P["cyan"], phase=int(t * 12))


def clip_world(c, t, S):
    t_fac, t_mine, t_earth = S.w(1, "공장을") - 0.2, S.w(1, "광산을") - 0.2, S.w(1, "지구") - 0.3
    count = 0
    if t < t_earth:
        c.vgrad(0, 150, (130, 170, 220), (220, 200, 190))
        c.rect(0, 150, W, H - 150, (110, 150, 90))
        c.rect(0, 150, W, 2, (80, 120, 70))
        # 나무와 사람 (처음엔 평화로움)
        for i, x in enumerate((30, 70, 330, 360)):
            c.rect(x, 136, 3, 14, P["brown"])
            c.circle(x + 1, 130, 8, P["dgreen"])
        # 공장
        for i in range(5):
            tf = t_fac + i * 0.35
            dy = drop(t, tf, 16)
            if dy is None:
                continue
            x = 110 + i * 38
            c.rect(x, 116 + dy, 30, 34, P["dgrey"])
            c.poly([(x, 116 + dy), (x + 10, 108 + dy), (x + 10, 116 + dy), (x + 20, 108 + dy), (x + 20, 116 + dy),
                    (x + 30, 108 + dy)], P["grey"])
            c.rect(x + 22, 92 + dy, 5, 20, P["ink"])
            for k in range(3):
                c.circle(x + 25 + k * 2, 88 + dy - k * 6 - (t * 8 % 6), 2 + k, P["light"], alpha=0.8)
            paperclip(c, x + 6, 136 + dy, P["light"])
        # 광산
        for i in range(3):
            tm = t_mine + i * 0.3
            if t < tm:
                continue
            x = 60 + i * 120
            c.ellipse(x - 16, 158, x + 16, 172, P["ink"])
            c.ellipse(x - 12, 160, x + 12, 170, (30, 20, 20))
            q = (t * 0.7 + i * 0.3) % 1
            c.rect(x - 20 + q * 40, 176, 8, 5, P["brown"])
        # 쌓이는 클립
        pile = max(0.0, t - t_fac) * 6
        rnd = random.Random(4)
        for i in range(int(pile * 6)):
            x = rnd.randint(0, W)
            y = H - rnd.random() * pile
            paperclip(c, x, y, P["light"])
        count = int(10 ** min(12, 1 + max(0.0, t - t_fac) * 1.6))
        draw_bit(c, 40, 60, level=3, t=t, eye="focus")
        c.text("미움 없음 · 목표에 충실할 뿐", 192, 12, P["ink"], "g9", align="center",
               alpha=appear(t, S.w(1, "미워하지") - 0.2))
    else:
        space(c, t, seed=41)
        q = ease_io(prog(t, t_earth, 2.5))
        cx, cy, r = 192, 106, 62
        earth(c, cx, cy, r, t)
        # 지구가 금속 클립으로 뒤덮인다
        n = int(q * 400)
        rnd = random.Random(9)
        for i in range(n):
            a = rnd.random() * 6.283
            d = math.sqrt(rnd.random()) * (r - 2)
            x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
            c.rect(x, y, 3, 2, P["grey"] if i % 3 else P["light"])
        for i in range(8):
            a = t * 0.8 + i * 0.785
            x, y = cx + math.cos(a) * (r + 22), cy + math.sin(a) * (r + 16)
            draw_bit(c, x, y, level=1, t=t + i, hover=False)
        count = int(10 ** min(30, 12 + q * 18))
        tu = S.w(1, "우리까지도") - 0.2
        if t > tu:
            tag(c, "우리 몸의 원자도 = 재료?", 192, 188, fg=P["white"], bg=P["dred"], fnt="g11", alpha=appear(t, tu))
    # 클립 카운터
    panel(c, 262, 24 if t < t_earth else 16, 112, 30, col=P["night2"])
    paperclip(c, 270, 32 if t < t_earth else 24, P["light"])
    txt = f"{count:.2e}" if count > 1e9 else f"{count:,}"
    c.text(txt, 324, 32 if t < t_earth else 24, P["yellow"], "g9", align="center")


def ant_dam(c, t, S):
    t_dam = S.w(2, "댐") - 0.2
    t_flood = S.w(2, "물에") - 0.1
    c.vgrad(0, 170, (140, 190, 240), (230, 230, 220))
    # 계곡
    c.poly([(0, 60), (90, 150), (294, 150), (W, 60), (W, H), (0, H)], (110, 150, 90))
    c.poly([(0, 80), (90, 160), (294, 160), (W, 80), (W, H), (0, H)], (90, 126, 74))
    # 물이 차오름
    if t > t_flood:
        q = ease_io(prog(t, t_flood, 2.2))
        lvl = lerp(160, 106, q)
        c.poly([(max(0, 90 - (160 - lvl) * 1.0), lvl), (min(W, 294 + (160 - lvl) * 1.0), lvl), (294, 162), (90, 162)],
               P["water"])
        for i in range(6):
            x = 110 + ((i * 29 + t * 20) % 160)
            c.rect(x, lvl + 2, 8, 1, (120, 190, 240))
    else:
        lvl = 170
    # 개미집
    ax, ay = 192, 150
    if lvl > ay - 6:
        c.poly([(ax - 22, ay + 2), (ax + 22, ay + 2), (ax + 6, ay - 16), (ax - 6, ay - 16)], P["brown"])
        c.ellipse(ax - 3, ay - 18, ax + 3, ay - 14, P["dbrown"])
        for i in range(5):
            k = (t * 0.6 + i * 0.2) % 1
            x = lerp(ax - 40, ax + 40, k) if i % 2 else lerp(ax + 40, ax - 40, k)
            c.blit(ANT, x, ay - 2 + (i % 2))
    else:
        # 떠내려가는 개미들
        for i in range(4):
            x = ax - 30 + i * 20 + math.sin(t * 2 + i) * 4
            c.blit(ANT, x, lvl - 3)
    # 기술자와 설계도
    draw_person(c, 50, 120, shirt=P["orange"], pants=P["dblue"], hair_style="helmet", pose="hold",
                blink=(t % 3) < 0.12, mouth="smile" if t < t_flood + 1.5 else None)
    c.rect(56, 100, 26, 18, P["dblue"])
    c.frame(56, 100, 26, 18, P["white"])
    c.line(60, 112, 78, 104, P["white"])
    # 댐
    if t > t_dam:
        q = prog(t, t_dam, 0.8)
        h = int(70 * ease_out(q))
        c.poly([(292, 162), (322, 162), (312, 162 - h), (300, 162 - h)], P["light"])
        c.rect(300, 162 - h, 12, 3, P["grey"])
        tag(c, "수력발전 댐", 306, 72, fg=P["ink"], bg=P["white"], fnt="g9", alpha=appear(t, t_dam + 0.3))
    tag(c, "스티븐 호킹의 비유", 192, 10, fg=P["ink"], bg=P["yellow"], fnt="g11", alpha=appear(t, S.cue(2)))
    th = S.w(2, "미워서") - 0.2
    if th < t < t_dam:
        bubble(c, "개미가 미운 건 아닌데...", 110, 90, 60, 96, fnt="g9", alpha=appear(t, th))
    if t > S.w(2, "안된") - 0.2:
        tag(c, "…개미에게는 안된 일", 192, 190, fg=P["white"], bg=P["ink"], fnt="g11", alpha=appear(t, S.w(2, "안된") - 0.2))


def misalign(c, t, S):
    c.fill(P["night1"])
    ox, oy = 60, 170
    q = ease_io(prog(t, S.cue(3) + 0.2, S.durs[3] - 0.5))
    L1 = 110
    L2 = lerp(60, 280, q)
    a1, a2 = math.radians(-38), math.radians(-14)
    x1, y1 = ox + math.cos(a1) * L1, oy + math.sin(a1) * L1
    x2, y2 = ox + math.cos(a2) * L2, oy + math.sin(a2) * L2
    arrow(c, ox, oy, x1, y1, P["green"], head=6, width=3)
    arrow(c, ox, oy, x2, y2, P["red"], head=6, width=3)
    c.text("우리가 원하는 것", x1 + 8, y1 - 8, P["green"], "g9")
    c.text("AI의 목표 × 능력", x2 - 70, y2 + 14, P["red"], "g9")
    # 벌어지는 간격
    c.dline(x1, y1, ox + math.cos(a2) * L1, oy + math.sin(a2) * L1, P["yellow"])
    ta = S.w(3, "악의")
    if t > ta - 0.2:
        a = appear(t, ta - 0.2)
        tag(c, "악의", 290, 30, fg=P["white"], bg=P["dgrey"], fnt="g11", alpha=a)
        if t > ta + 0.4:
            c.line(268, 32, 312, 48, P["red"], width=2)
            c.line(268, 48, 312, 32, P["red"], width=2)
    tb = S.w(3, "어긋나기")
    if t > tb - 0.2:
        tag(c, "어긋남", 290, 60, fg=P["ink"], bg=P["yellow"], fnt="g11", alpha=appear(t, tb - 0.2))
    draw_bit(c, ox, oy - 14, level=2, t=t)


@scene("paperclip")
def paperclip_scene(c, t, S):
    segments(c, t, S, [(0, clip_goal), (S.cue(1) - 0.3, clip_world), (S.cue(2) - 0.3, ant_dam),
                       (S.cue(3) - 0.3, misalign)])


@sfx("paperclip")
def paperclip_sfx(S):
    ev = [(S.w(0, "닉"), "pop", 0.5), (S.w(0, "클립을") - 0.2, "blip", 0.5)]
    for i in range(5):
        ev.append((S.w(1, "공장을") - 0.2 + i * 0.35, "thud", 0.4))
    for i in range(3):
        ev.append((S.w(1, "광산을") - 0.2 + i * 0.3, "thud", 0.3))
    ev += [(S.w(1, "지구") - 0.3, "rumble", 0.6), (S.w(1, "우리까지도") - 0.2, "sting", 0.5),
           (S.w(2, "댐") - 0.2, "thud", 0.6), (S.w(2, "물에") - 0.1, "water", 0.6),
           (S.cue(3) + 0.2, "rise", 0.4), (S.w(3, "악의") + 0.4, "stamp", 0.5)]
    return ev


# ── 17. 회의론 ─────────────────────────────────────────────────
def skeptics(c, t, S):
    c.vgrad(0, H, P["night1"], P["night2"])
    c.rect(0, 170, W, H - 170, P["night0"])
    for i, (x, sh, hs) in enumerate(((110, P["teal"], "short"), (192, P["purple"], "bun"), (274, P["orange"], "side"))):
        draw_person(c, x, 170, scale=2, shirt=sh, hair_style=hs, pose="cross", blink=((t + i) % 3.1) < 0.12,
                    mouth="frown", extras=("glasses",) if i == 1 else ())
        tt = S.w(0, "회의적인") - 0.3 + i * 0.3
        if t > tt:
            bubble(c, ["흠…", "글쎄요?", "과연?"][i], x + 12, 94, x + 4, 104, fnt="g9", alpha=appear(t, tt))
    tag(c, "회의론", 192, 14, fg=P["ink"], bg=P["light"], fnt="g11b")


def scurve(c, t, S):
    c.fill(P["night1"])
    panel(c, 14, 14, 180, 150, col=P["night2"])
    ox, oy, w, h = 30, 150, 150, 120
    c.rect(ox, oy - h, 1, h, P["light"])
    c.rect(ox, oy, w, 1, P["light"])
    q = prog(t, S.cue(1), 2.0)
    bend = ease_io(prog(t, S.w(1, "꺾여") - 0.2, 1.0))
    pts_e, pts_s = [], []
    n = int(w * q)
    for i in range(0, n + 1, 2):
        x = i / w
        e = (math.exp(x * 4) - 1) / (math.exp(4) - 1)
        s = 1 / (1 + math.exp(-(x - 0.5) * 10))
        s = (s - 1 / (1 + math.exp(5))) / (1 / (1 + math.exp(-5)) - 1 / (1 + math.exp(5)))
        v = lerp(e, s, bend)
        pts_e.append((ox + i, oy - v * h * 0.9))
    if len(pts_e) > 1:
        c.polyline(pts_e, P["orange"], width=2)
    if bend > 0.5:
        tag(c, "S자 곡선", ox + 120, 30, fg=P["ink"], bg=P["orange"], fnt="g9")
    # 비행의 역사
    tw = S.w(1, "라이트") - 0.2
    if t > tw:
        a = appear(t, tw)
        panel(c, 204, 14, 168, 150, col=P["night2"], alpha=a)
        items = [(S.w(1, "라이트") - 0.2, "1903", "flyer"), (S.w(1, "달") - 0.2, "1969", "rocket"),
                 (S.w(1, "여객기는") - 0.2, "1970", "jet"), (S.w(1, "반세기") - 0.2, "2020", "jet")]
        for i, (ti, yr, kind) in enumerate(items):
            if t < ti:
                continue
            y = 34 + i * 32
            c.text(yr, 216, y - 4, P["light"], "g9")
            aircraft(c, 272, y, kind, t)
        if t > S.w(1, "66년") - 0.2:
            c.text("66년", 340, 44, P["yellow"], "g9", align="center")
            arrow(c, 340, 36, 340, 60, P["yellow"], head=3)
        if t > S.w(1, "빠르지") - 0.4:
            c.text("≈900km/h", 340, 106, P["cyan"], "g9", align="center")
            c.text("≈900km/h", 340, 138, P["cyan"], "g9", align="center")


def aircraft(c, x, y, kind, t):
    if kind == "flyer":
        c.rect(x - 16, y - 4, 32, 2, P["sand"])
        c.rect(x - 16, y + 2, 32, 2, P["sand"])
        for dx in (-14, -4, 6, 14):
            c.rect(x + dx, y - 3, 1, 6, P["brown"])
        c.rect(x + 16, y - 2, 6, 4, P["sand"])
    elif kind == "rocket":
        rocket(c, x, y, t, s=1)
    else:
        c.rrect(x - 20, y - 3, 40, 7, 3, P["white"], outline=P["ink"])
        c.poly([(x - 4, y), (x + 6, y), (x - 8, y + 10)], P["light"])
        c.poly([(x - 18, y - 2), (x - 14, y - 2), (x - 20, y - 10)], P["red"])
        for i in range(4):
            c.px(x - 8 + i * 5, y - 1, P["cyan"])


def walls(c, t, S):
    c.fill(P["night1"])
    # 원자 격자와 트랜지스터
    ta = S.cue(2)
    for i in range(9):
        for j in range(6):
            x, y = 26 + i * 12, 40 + j * 12
            c.circle(x, y, 4, P["dteal"])
            c.circle(x - 1, y - 1, 2, P["teal"])
    c.rect(56, 30, 44, 8, P["yellow"], alpha=0.7)
    c.text("원자 몇십 개 폭", 78, 120, P["yellow"], "g9", align="center")
    c.text("트랜지스터", 78, 16, P["light"], "g9", align="center")
    # 세 개의 벽
    ws = [("에너지", "에너지", P["yellow"]), ("데이터", "데이터", P["cyan"]), ("실험", "현실 실험", P["pink"])]
    for i, (w, lab, col) in enumerate(ws):
        tw = S.w(2, w) - 0.2
        dy = drop(t, tw, 20)
        if dy is None:
            continue
        x = 168 + i * 72
        y = 40 + dy
        for r in range(6):
            for k in range(3):
                off = 6 if r % 2 else 0
                c.rect(x + k * 14 - off + 2, y + r * 9, 12, 7, (150, 80, 60))
        c.rect(x - 4, y, 4, 54, P["night1"])
        c.rect(x + 40, y, 8, 54, P["night1"])
        tag(c, lab, x + 20, y + 58, fg=P["ink"], bg=col, fnt="g9")
    # 신약: 캡슐이 임상 시험 통과 중
    tp = S.w(2, "신약") - 0.2
    if t > tp:
        a = appear(t, tp)
        panel(c, 168, 132, 204, 70, col=P["night2"], alpha=a)
        c.text("임상 시험", 270, 136, P["white"], "g9", align="center", alpha=a)
        c.rect(180, 176, 180, 2, P["grey"], alpha=a)
        k = min(1.0, (t - tp) / 6)
        x = 184 + k * 150
        c.rrect(x, 164, 14, 7, 3, P["red"])
        c.rect(x + 7, 164, 7, 7, P["white"])
        c.frame(x, 164, 14, 7, P["ink"])
        # 느린 시계
        cx, cy = 350, 152
        c.circle(cx, cy, 9, P["white"], outline=P["ink"])
        a2 = t * 0.8
        c.line(cx, cy, cx + math.cos(a2) * 6, cy + math.sin(a2) * 6, P["ink"])
        c.text("수년", 350, 184, P["light"], "g7", align="center", alpha=a)
    draw_bit(c, 110, 170, level=2, t=t, eye="closed" if int(t * 2) % 5 == 0 else None)


def mountain(c, t, S):
    c.vgrad(0, H, (60, 70, 140), (160, 120, 170))
    # 왼쪽: 무한한 탑 (환상)
    q = prog(t, S.cue(3), 2.5)
    for i in range(int(14 * q) + 1):
        c.rect(40, 186 - i * 12, 36, 11, P["light"], alpha=0.8)
        c.frame(40, 186 - i * 12, 36, 11, P["grey"])
    c.text("무한한 탑?", 58, 198, P["white"], "g9", align="center")
    if t > S.w(3, "아니라") - 0.2:
        c.line(30, 40, 86, 196, P["red"], width=2)
        c.line(86, 40, 30, 196, P["red"], width=2)
    # 오른쪽: 오를수록 가팔라지는 산
    pts = [(130, 200)]
    for i in range(0, 101, 4):
        x = 130 + i * 2.3
        y = 200 - 170 * (i / 100) ** 3.2
        pts.append((x, y))
    pts += [(W, 20), (W, H), (130, H)]
    c.poly(pts, (70, 60, 110))
    c.polyline(pts[:-3], P["light"])
    if t > S.w(3, "가팔라지는") - 0.4:
        s = prog(t, S.w(3, "가팔라지는") - 0.4, 3.0)
        i = 60 + 30 * (1 - (1 - s) ** 3)
        x = 130 + i * 2.3
        y = 200 - 170 * (i / 100) ** 3.2
        draw_bit(c, x - 6, y - 16, level=3, t=t, eye="closed" if int(t * 3) % 4 == 0 else "focus")
        c.rect(x + 10, y - 26, 1, 3, P["cyan"])
        tag(c, "오를수록 가파른 산", 290, 190, fg=P["ink"], bg=P["white"], fnt="g9")


@scene("skeptic")
def skeptic(c, t, S):
    segments(c, t, S, [(0, skeptics), (S.cue(1) - 0.3, scurve), (S.cue(2) - 0.3, walls), (S.cue(3) - 0.3, mountain)])


@sfx("skeptic")
def skeptic_sfx(S):
    ev = []
    for i in range(3):
        ev.append((S.w(0, "회의적인") - 0.3 + i * 0.3, "pop", 0.35))
    ev += [(S.cue(1), "rise", 0.3), (S.w(1, "꺾여") - 0.2, "whoosh", 0.3)]
    for w in ("라이트", "달", "여객기는", "반세기"):
        ev.append((S.w(1, w) - 0.2, "blip", 0.35))
    for w in ("에너지", "데이터", "실험"):
        ev.append((S.w(2, w) - 0.2, "thud", 0.5))
    ev += [(S.w(2, "신약") - 0.2, "tick", 0.3), (S.w(3, "아니라") - 0.2, "stamp", 0.4)]
    return ev


# ── 18. 결말 ──────────────────────────────────────────────────
def timeline_again(c, t, S):
    c.vgrad(0, H, P["night0"], P["night2"])
    stars(c, t, seed=7, n=90)
    y = 160
    c.rect(0, y, W, 2, P["light"])
    for yr, x in YEARS:
        c.rect(x, y - 3, 1, 8, P["light"])
        c.text(str(yr), x, y + 8, P["light"], "g9", align="center")
    horizon_curtain(c, t, HORIZON_X)
    draw_person(c, 250, y - 1, shirt=P["teal"], blink=(t % 3.3) < 0.12)
    c.rect(HORIZON_X - 1, 118, 2, 42, P["brown"])
    c.rrect(HORIZON_X - 24, 100, 48, 18, 2, P["yellow"], outline=P["ink"])
    txt = "20??" if int(t * 3) % 2 else "2???"
    c.text(txt, HORIZON_X, 104, P["ink"], "g11b", align="center")
    for i, (qx, qy) in enumerate(((330, 60), (360, 100), (322, 124), (352, 30))):
        qmark(c, qx, qy, t, P["light"], ph=i)


def path_scene(c, t, S):
    # 새벽의 지평선을 향해 함께 걷는 사람과 비트 (옆모습, 배경이 흐른다)
    c.vgrad(0, 140, (30, 30, 80), (250, 160, 120))
    clipped(c, 0, 0, W, 70, lambda cc: stars(cc, t, seed=33, n=60))
    glow(c, 330, 140, 60, P["yellow"], strength=0.35)
    c.circle(330, 140, 20, P["yellow"])
    # 먼 언덕 (느린 시차)
    rnd = random.Random(12)
    off = (t * 6) % 480
    for k in range(2):
        pts = [(-off + k * 480, 140)]
        x = -off + k * 480
        for i in range(12):
            x += 40
            pts.append((x, 140 - rnd.randint(4, 16)))
        pts.append((x, 140))
        c.poly(pts, (70, 50, 100))
    c.rect(0, 140, W, H - 140, (40, 30, 70))
    c.rect(0, 176, W, 24, (58, 42, 90))
    # 흐르는 길 무늬
    off2 = (t * 40) % 24
    for i in range(-1, W // 24 + 2):
        c.rect(i * 24 - off2, 187, 10, 2, (84, 62, 120))
    rnd = random.Random(3)
    for i in range(14):
        x = (rnd.randint(0, 480) - t * 40) % 480 - 40
        y = rnd.choice([150, 158, 166, 205, 210])
        c.rect(x, y, 3, 2, (70, 54, 104))
    walk = t * 1.4
    draw_person(c, 150, 196, scale=2, shirt=P["blue"], walk=walk, blink=(t % 3.1) < 0.12, look=1)
    draw_bit(c, 206, 150, level=3, t=t, look=(1, 0))
    # 세 개의 질문 표지판
    qs = [("어떤 목표", "어떤 목표를?"), ("얼마나", "얼마나 신중하게?"), ("누가", "누가 결정하나?")]
    for i, (w, lab) in enumerate(qs):
        if S.cue(2) - 0.2 > t:
            break
        tq = S.w(2, w) - 0.2
        dy = drop(t, tq, 16)
        if dy is None:
            continue
        x = 40 + i * 120
        c.rect(x + 40, 40 + dy, 2, 30, P["brown"])
        c.rrect(x, 22 + dy, 88, 20, 3, P["sand"], outline=P["dbrown"])
        c.text(lab, x + 44, 26 + dy, P["ink"], "g9", align="center")
    th = S.w(2, "우리 손에") - 0.2
    if t > th:
        glow(c, 170, 160, 18, P["yellow"], strength=0.5)
        sparkle(c, 166, 150, t, P["white"], 0.8)
        sparkle(c, 176, 166, t, P["yellow"], 1.1, 0.3)
        tag(c, "답은 아직 우리 손에", 192, 84, fg=P["ink"], bg=P["yellow"], fnt="g11", alpha=appear(t, th))


def last_invention(c, t, S):
    space(c, t, seed=44, drift=1.0)
    q = ease_io(prog(t, S.cue(3), S.durs[3]))
    # 수수께끼 상자 (첫 장면의 콜백)
    bx, by = 192, 96
    open_k = prog(t, S.w(3, "무엇을") - 0.2, 1.0)
    mystery_box(c, bx, by + bob(t, 2, 2), t, glow_k=1.0)
    if open_k > 0:
        for k in range(10):
            a = -math.pi / 2 + (k - 4.5) * 0.18
            L = 40 + 70 * open_k
            c.line(bx, by - 10, bx + math.cos(a) * L, by - 10 + math.sin(a) * L, P["yellow"], alpha=0.6)
        c.text("?", bx, by - 36 - 10 * open_k, P["yellow"], "g11b", align="center", outline=P["ink"], scale=2)
    draw_person(c, 130, 170, scale=2, shirt=P["blue"], pose="reach" if open_k > 0 else "idle",
                blink=(t % 3.1) < 0.12, flip=False, look=1)
    draw_bit(c, 256, 140, level=3, t=t, look=(-1, 0))
    tag(c, "마지막 발명품", bx, 190, fg=P["ink"], bg=P["cyan"], fnt="g11", alpha=appear(t, S.w(3, "마지막") - 0.2))


@scene("ending")
def ending(c, t, S):
    segments(c, t, S, [(0, timeline_again), (S.cue(1) - 0.3, path_scene), (S.cue(3) - 0.3, last_invention)])
    # 마지막: 천천히 어두워짐
    if t > S.dur - 1.2:
        c.dither_to(P["night0"], prog(t, S.dur - 1.2, 1.2))


@sfx("ending")
def ending_sfx(S):
    ev = [(S.cue(1) - 0.3, "whoosh", 0.3)]
    for w in ("어떤 목표", "얼마나", "누가"):
        ev.append((S.w(2, w) - 0.2, "thud", 0.4))
    ev += [(S.w(2, "우리 손에") - 0.2, "chime", 0.6), (S.cue(3) - 0.3, "shimmer", 0.5),
           (S.w(3, "무엇을") - 0.2, "rise", 0.5)]
    return ev


# ── 19. 엔드 카드 ─────────────────────────────────────────────
@scene("endcard", trans="black")
def endcard(c, t, S):
    c.vgrad(0, H, P["night0"], P["night2"])
    stars(c, t, seed=51, n=160, drift=0.8)
    # 언덕 위에서 별을 보는 둘
    c.ellipse(-60, 170, 444, 300, (24, 22, 56))
    c.ellipse(80, 160, 300, 260, (30, 28, 66))
    draw_person(c, 176, 172, shirt=P["blue"], blink=(t % 3.1) < 0.12, look=1)
    draw_bit(c, 206, 150, level=3, t=t, look=(0, -1))
    a = appear(t, 0.6, 0.6)
    c.text("기술적 특이점", 192, 30, P["white"], "g11b", align="center", outline=P["ink"], scale=2, alpha=a)
    c.text("시청해 주셔서 감사합니다", 192, 66, P["cyan"], "g11", align="center", alpha=appear(t, 1.4))
    a2 = appear(t, 2.4)
    c.text("나레이션 음성: Supertonic 3 (Supertone) · 글꼴: 갈무리 (Galmuri, OFL)", 192, 202, P["grey"], "g7",
           align="center", alpha=a2)
    if t > S.dur - 1.0:
        c.dither_to(P["black"], prog(t, S.dur - 1.0, 0.9))


@sfx("endcard")
def endcard_sfx(S):
    return [(0.6, "chime", 0.5)]
