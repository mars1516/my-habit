"""3부: 지능 폭발 — 비트의 자기 개선, 기계의 속도, 지능의 계단"""
import math
import random

from anim import back, bob, clamp01, ease_in, ease_io, ease_out, lerp, prog, shake
from chars import CHICKEN_O, CHIMP_O, ANT_O, draw_bit, draw_person, bit
from gfx import BAYER_FULL, H, P, W, Canvas, mix, stars
from props import (appear, arrow, brain, burst, chip, clipped, curved_arrow, drop, glow, noise_rect, panel, qmark,
                   sparkle, tag, space, bubble, computer)
from .s02_growth import mixview
from . import scene, sfx


def lab_bg(c, t):
    c.fill((18, 22, 54))
    for x in range(0, W, 32):
        c.rect(x, 0, 1, 170, (26, 32, 72))
    for y in range(0, 170, 32):
        c.rect(0, y, W, 1, (26, 32, 72))
    c.rect(0, 170, W, H - 170, (14, 16, 40))
    c.rect(0, 170, W, 1, P["night3"])
    # 바닥 반사 격자
    for i in range(-10, 20):
        c.line(192 + i * 12, 171, 192 + i * 40, H, (22, 26, 60))


# ── 10. 지능 폭발 ─────────────────────────────────────────────
def upgrade_times(S):
    a, b = S.w(2, "조금 더") + 0.4, S.lend(2)
    ts, t, gap = [], a, (b - a) * 0.42
    while t < b and len(ts) < 12:
        ts.append(t)
        t += gap
        gap *= 0.6
    return ts


@scene("explosion")
def explosion(c, t, S):
    ups = upgrade_times(S)
    n_up = sum(1 for u in ups if t >= u)
    t_boom = S.w(3, "지능 폭발") - 0.15
    boomed = t >= t_boom
    sx, sy = shake(t, 3 if 0 < t - t_boom < 0.8 else 0)
    c.ox, c.oy = sx, sy
    lab_bg(c, t)
    cx, cy = 192, 110
    level = 1 if n_up == 0 else (2 if n_up == 1 else 3)
    if boomed:
        level = 4
    a0 = appear(t, S.w(0, "AI가") - 0.1, 0.6)
    if a0 > 0:
        glow_k = min(1.0, n_up / 6) + (1 if boomed else 0)
        if glow_k > 0:
            glow(c, cx, cy, 30 + 14 * glow_k, P["cyan"], strength=0.2 + 0.15 * glow_k)
        eye = "happy" if (ups and 0 < t - ups[min(n_up, len(ups)) - 1] < 0.4) else None
        if S.cue(1) < t < S.w(1, "자기") - 0.1:
            eye = "wide"
        draw_bit(c, cx, cy, level=level, t=t, alpha=a0, eye=eye)
        # 이름표
        a1 = appear(t, S.w(0, "비트라고"))
        ver = f"비트 v{n_up + 1}.0" if not boomed else "비트 v∞"
        tag(c, ver, cx, cy + 38 if level < 4 else cy + 50, fg=P["ink"], bg=P["cyan"], fnt="g11", alpha=a1)
    # AI 연구 능력 게이지
    ag = appear(t, S.w(0, "인간만큼") - 0.2)
    if ag > 0 and not boomed:
        panel(c, 16, 16, 120, 38, col=P["night2"], alpha=ag)
        c.text("AI 연구 능력", 22, 20, P["white"], "g9", alpha=ag)
        c.rect(22, 38, 104, 8, P["ink"], alpha=ag)
        k = min(1.0, 0.5 + n_up * 0.1)
        c.rect(23, 39, int(102 * k), 6, P["green"] if n_up == 0 else P["yellow"], alpha=ag)
        c.rect(22 + 51, 34, 1, 14, P["white"], alpha=ag)
        c.text("인간", 22 + 51, 48, P["light"], "g7", align="center", alpha=ag)
    # 자기 개선: 설계도 + 순환 화살표
    t1 = S.w(1, "자기")
    if t1 - 0.2 < t and not boomed:
        a = appear(t, t1 - 0.2)
        spin = t * 2.5
        curved_arrow(c, cx, cy, 44, spin, spin + 4.4, P["yellow"], head=5, width=2, alpha=a)
        panel(c, 262, 60, 100, 76, col=P["dblue"], alpha=a)
        c.text("설계도", 312, 64, P["white"], "g9", align="center", alpha=a)
        for i in range(8):
            c.rect(270 + i * 11, 80, 1, 50, (80, 130, 220), alpha=a)
        for j in range(5):
            c.rect(270, 80 + j * 11, 86, 1, (80, 130, 220), alpha=a)
        if a >= 1:
            spr = bit(min(level, 3), "open")
            c.blit(spr, 312 - spr.shape[1] // 2, 104 - spr.shape[0] // 2, tint=P["white"], alpha=0.8)
        tag(c, "자기 개선", 312, 142, fg=P["ink"], bg=P["yellow"], fnt="g9", alpha=a)
    # 업그레이드 효과
    for i, u in enumerate(ups):
        if 0 <= t - u < 0.35 and not boomed:
            c.ring(cx, cy, 20 + (t - u) * 120, P["white"], width=2)
            c.text("LEVEL UP!", cx, cy - 50, P["yellow"], "g11b", align="center", outline=P["ink"])
        burst(c, cx, cy, t, u, n=12, col=P["cyan"], speed=70, life=0.5, seed=i)
    # 업그레이드 간격 타임라인
    if ups and t > ups[0] - 0.5 and not boomed:
        y = 190
        x0, x1 = 30, 354
        c.rect(x0, y, x1 - x0, 1, P["grey"])
        c.text("업그레이드 간격", x0, y - 14, P["light"], "g9")
        span = ups[-1] - ups[0] + 0.001
        for i, u in enumerate(ups):
            if t >= u:
                x = x0 + (u - ups[0]) / span * (x1 - x0 - 20)
                c.rect(x, y - 4, 2, 9, P["yellow"])
                if i > 0:
                    px = x0 + (ups[i - 1] - ups[0]) / span * (x1 - x0 - 20)
                    c.rect(px + 3, y - 2, max(1, x - px - 4), 4, P["dorange"])
    # 폭발
    if boomed:
        q = t - t_boom
        glow(c, cx, cy, 60 + 20 * math.sin(t * 5), P["cyan"], strength=0.35)
        for i in range(3):
            burst(c, cx, cy, t, t_boom + i * 0.25, n=40, col=[P["cyan"], P["yellow"], P["pink"]][i],
                  speed=220, life=1.4, seed=10 + i, size=2)
        for k in range(12):
            a = k * math.pi / 6 + t * 0.6
            r0, r1 = 52, 52 + 200 * min(1, q * 1.5)
            c.line(cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a) * r1, cy + math.sin(a) * r1,
                   P["cyan"], alpha=0.5)
        draw_bit(c, cx, cy, level=4, t=t, eye="happy" if q > 0.8 else "wide")
        c.text("지능 폭발", cx, 12, P["yellow"], "g11b", align="center", outline=P["ink"], scale=2,
               shadow=P["dorange"])
        c.text("INTELLIGENCE EXPLOSION", cx, 44, P["white"], "g7", align="center")
        if q < 0.25:
            c.dither_to(P["white"], 1 - q / 0.25)
    c.ox = c.oy = 0


@sfx("explosion")
def explosion_sfx(S):
    ev = [(S.w(0, "AI가") - 0.1, "shimmer", 0.6), (S.w(0, "비트라고"), "blip", 0.5),
          (S.w(1, "자기") - 0.2, "power", 0.4)]
    for i, u in enumerate(upgrade_times(S)):
        ev.append((u, "levelup", 0.35 + min(0.3, i * 0.04)))
    ev.append((S.w(3, "지능 폭발") - 0.15, "boom", 1.0))
    return ev


# ── 11. 기계의 속도 ───────────────────────────────────────────
def neuron(c, x, y, t, fire_rate=1.0):
    c.circle(x, y, 9, (255, 150, 190), outline=P["ink"])
    c.circle(x, y, 3, P["dred"])
    rnd = random.Random(4)
    for i in range(6):
        a = math.pi * 0.5 + i * math.pi / 5 + rnd.uniform(-0.2, 0.2)
        L = rnd.randint(12, 18)
        ex, ey = x - abs(math.cos(a)) * L, y + math.sin(a) * L * 0.9 - 3
        c.line(x, y, ex, ey, (255, 150, 190), width=2)
        c.line(ex, ey, ex - 5, ey - 3, (255, 150, 190))
    # 축삭
    c.rect(x + 9, y - 1, 120, 3, (255, 150, 190))
    for i in range(6):
        c.rrect(x + 16 + i * 18, y - 3, 12, 7, 3, P["light"])
    c.line(x + 129, y, x + 138, y - 6, (255, 150, 190), width=2)
    c.line(x + 129, y, x + 138, y + 6, (255, 150, 190), width=2)


@scene("speed")
def speed(c, t, S):
    def compare(cc):
        cc.fill(P["night1"])
        cc.rect(192, 0, 1, H, P["night3"])
        # 대사 0: 사슬이 끊어지는 비트
        a_split = appear(t, S.cue(1) - 0.3)
        if a_split < 1:
            t_brk = S.w(0, "묶여")
            broken = t > t_brk
            draw_bit(cc, 192, 100, level=3, t=t, eye="focus" if not broken else "happy")
            for i in range(10):
                a = i * math.pi / 5
                d = 26 + (0 if not broken else (t - t_brk) * 90)
                x, y = 192 + math.cos(a) * d, 100 + math.sin(a) * d * 0.9
                cc.ellipse(x - 4, y - 2, x + 4, y + 2, None, outline=P["grey"])
            if broken:
                burst(cc, 192, 100, t, t_brk, n=16, col=P["light"], speed=100, life=0.6)
            if a_split > 0:
                cc.dither_to(P["night1"], a_split)
            return
        cc.text("생물 (뉴런)", 96, 14, P["pink"], "g11", align="center")
        cc.text("기계 (칩)", 288, 14, P["cyan"], "g11", align="center")
        # 뉴런
        neuron(cc, 30, 70, t)
        per = 1.6
        k = ((t - S.cue(1)) % per) / per
        px = 44 + k * 120
        cc.circle(px, 71, 3, P["yellow"])
        cc.circle(px, 71, 5, P["yellow"], alpha=0.3)
        a1 = appear(t, S.w(1, "200번"))
        tag(cc, "초당 최대 ~200회", 96, 104, fg=P["ink"], bg=P["pink"], fnt="g9", alpha=a1)
        a2 = appear(t, S.w(1, "초속"))
        tag(cc, "~120 m/s", 96, 124, fg=P["ink"], bg=P["pink"], fnt="g9", alpha=a2)
        # 칩
        a3 = appear(t, S.cue(2) - 0.2)
        if a3 > 0:
            chip(cc, 288, 72, 18, col=(30, 36, 70))
            for i in range(4):
                y = 60 + i * 8
                cc.rect(200, y, 70, 1, P["dteal"])
                cc.rect(306, y, 70, 1, P["dteal"])
                for j in range(3):
                    ph = (t * 7 + i * 0.37 + j * 0.33) % 1.0
                    xx = 200 + ph * 176
                    if 270 < xx < 306:
                        continue
                    cc.rect(xx, y, 5, 1, P["cyan"])
                    cc.px(xx + 5, y, P["white"])
            a4 = appear(t, S.w(2, "수십억"))
            tag(cc, "초당 수십억 회", 288, 104, fg=P["ink"], bg=P["cyan"], fnt="g9", alpha=a4)
            a5 = appear(t, S.w(2, "빛에"))
            tag(cc, "≈ 빛의 속도", 288, 124, fg=P["ink"], bg=P["cyan"], fnt="g9", alpha=a5)
        # 비교 막대
        if t > S.w(2, "빛에") + 0.4:
            q = ease_out(prog(t, S.w(2, "빛에") + 0.4, 0.8))
            cc.text("속도 차이", 192, 150, P["white"], "g9", align="center")
            cc.rect(40, 170, 2, 8, P["pink"])
            cc.rect(40, 186, int(300 * q), 8, P["cyan"])
            cc.text("뉴런", 36, 170, P["pink"], "g7", align="right")
            cc.text("칩", 36, 186, P["cyan"], "g7", align="right")
            if q >= 1:
                cc.text("수백만 배 →", 344, 186, P["white"], "g7")

    def thinking(cc):
        cc.fill(P["night1"])
        cc.rect(150, 0, 1, H, P["night3"])
        # 사람 얼굴 클로즈업
        fx, fy = 76, 110
        cc.circle(fx, fy, 48, P["skin"], outline=P["ink"])
        cc.poly([(fx - 49, fy - 6), (fx - 44, fy - 30), (fx - 20, fy - 48), (fx + 20, fy - 48), (fx + 44, fy - 30),
                 (fx + 49, fy - 6), (fx + 40, fy - 22), (fx, fy - 30), (fx - 40, fy - 22)], P["dbrown"])
        tb = S.w(3, "깜빡이는") - 0.1
        bk = 0.0
        if tb < t < tb + 1.6:
            q = (t - tb) / 1.6
            bk = math.sin(q * math.pi) if q < 1 else 0
        for ex in (fx - 18, fx + 18):
            cc.ellipse(ex - 10, fy - 4, ex + 10, fy + 10, P["white"], outline=P["ink"])
            cc.circle(ex + 2, fy + 3, 4, P["ink"])
            cc.px(ex + 1, fy + 1, P["white"])
            lid = int(15 * bk)
            if lid > 0:
                cc.rect(ex - 11, fy - 5, 23, lid + 1, P["skin"])
                cc.rect(ex - 11, fy - 5 + lid, 23, 1, P["ink"])
        cc.rect(fx - 8, fy + 26, 16, 2, P["dskin2"])
        cc.text("나", fx, 16, P["light"], "g11", align="center")
        # 비트: 달력이 넘어간다
        bx = 268
        draw_bit(cc, bx, 150, level=3, t=t, eye="focus")
        cc.text("×1,000,000", bx, 176, P["cyan"], "g9", align="center")
        days = 0
        if t > tb:
            days = min(4, int((t - tb) / 1.6 * 4.2))
        if tb - 0.3 < t < S.w(3, "일주일"):
            panel(cc, bx - 28, 40, 56, 60, col=P["white"])
            cc.rect(bx - 28, 40, 56, 14, P["red"])
            cc.text("생각한 날", bx, 42, P["white"], "g9", align="center")
            cc.text(f"{days}일", bx, 62, P["ink"], "g11b", align="center", scale=2)
            if tb < t < tb + 1.6 and int(t * 10) % 2:
                cc.rect(bx - 26, 56, 52, 2, P["light"])
        # 2만 년의 생각: 문명 몽타주
        tw = S.w(3, "일주일")
        if t > tw - 0.2:
            q = prog(t, tw - 0.2, S.lend(3) - tw)
            panel(cc, 176, 18, 196, 104, col=P["night2"])
            cc.text("일주일 = 약 2만 년의 생각", 274, 22, P["yellow"], "g9", align="center")
            years = int(20000 * ease_in(q))
            cc.text(f"{years:,}년", 274, 104, P["white"], "g9", align="center")
            icons = ["pyramid", "castle", "factory", "rocket"]
            for i, ic in enumerate(icons):
                if q > i / 4:
                    draw_era(cc, 206 + i * 46, 80, ic, t)
            if q > 0.05:
                cc.line(186, 90, 362, 90, P["grey"])

    p = ease_io(prog(t, S.cue(3) - 0.4, 0.6))
    mixview(c, p, compare, thinking)


def draw_era(c, cx, by, kind, t):
    if kind == "pyramid":
        c.poly([(cx - 16, by + 8), (cx + 16, by + 8), (cx, by - 14)], P["sand"])
        c.poly([(cx, by - 14), (cx + 16, by + 8), (cx + 4, by + 8)], (200, 160, 100))
    elif kind == "castle":
        c.rect(cx - 12, by - 8, 24, 16, P["grey"])
        for i in range(4):
            c.rect(cx - 12 + i * 7, by - 12, 4, 4, P["grey"])
        c.rect(cx - 3, by, 6, 8, P["ink"])
        c.rect(cx - 1, by - 22, 1, 10, P["light"])
        c.rect(cx, by - 22, 6, 4, P["red"])
    elif kind == "factory":
        c.rect(cx - 14, by - 6, 28, 14, P["brown"])
        c.rect(cx + 6, by - 22, 5, 16, P["dbrown"])
        for i in range(3):
            c.circle(cx + 9 + i * 3, by - 26 - i * 5 - (t * 6 % 5), 2 + i, P["light"])
    elif kind == "rocket":
        from props import rocket
        rocket(c, cx, by - 6, t)


@sfx("speed")
def speed_sfx(S):
    ev = [(S.w(0, "묶여"), "chain", 0.6), (S.cue(1) - 0.3, "whoosh", 0.3)]
    for k in range(4):
        ev.append((S.cue(1) + k * 1.6, "blip", 0.2))
    ev += [(S.cue(2) - 0.2, "zap", 0.5), (S.w(2, "빛에") + 0.4, "rise", 0.4)]
    tb = S.w(3, "깜빡이는") - 0.1
    for k in range(4):
        ev.append((tb + (k + 1) * 1.6 / 4.2, "flip", 0.4))
    ev.append((S.w(3, "일주일") - 0.2, "shimmer", 0.5))
    return ev


# ── 12. 지능의 계단 ───────────────────────────────────────────
STEP_W, STEP_H = 64, 26
N_STEPS = 16


def step_xy(i):
    return 8 + i * STEP_W * 0.62, 184 - i * STEP_H


def cam_focus_step(S, t):
    c1, c2, c3, c4 = S.cue(1) + 0.8, S.cue(2), S.cue(3), S.cue(4)
    if t < c1:
        return 2.0
    if t < c2:
        return lerp(2.0, 2.6, ease_io(prog(t, c1, 1.0)))
    if t < c3 - 0.2:
        return lerp(2.6, 10.0, ease_io(prog(t, c2, S.durs[2])))
    if t < c3 + 0.6:
        return lerp(10.0, 2.0, ease_io(prog(t, c3 - 0.2, 0.8)))
    return max(2.0, bit_climb(S, min(t, c4)))


def staircase_cam(S, t):
    """(ox, oy) 카메라 오프셋"""
    s = cam_focus_step(S, t)
    i = int(s)
    f = s - i
    xa, ya = step_xy(i)
    xb, yb = step_xy(i + 1)
    fx, fy = lerp(xa, xb, f) + 32, lerp(ya, yb, f) - 20
    return min(0.0, 152 - fx), max(0.0, 120 - fy)


def bit_climb(S, t):
    c3 = S.cue(3)
    q = prog(t, c3 + 0.4, S.durs[3] - 0.4)
    # 계단 번호(실수) — 처음엔 천천히, 인간 칸을 스치고, 점점 빨라짐
    s = 14.5 * (q ** 1.6)
    return s


def bit_world(S, t):
    s = bit_climb(S, t)
    i = int(s)
    f = s - i
    xa, ya = step_xy(i)
    xb, yb = step_xy(i + 1)
    return lerp(xa, xb, f) + STEP_W * 0.5, lerp(ya, yb, f) - 20 - math.sin(f * math.pi) * 10


@scene("staircase")
def staircase(c, t, S):
    camx, cam = staircase_cam(S, t)
    # 하늘: 올라갈수록 어두워지고 별이 보인다
    h = clamp01(cam / 300)
    top = mix((90, 150, 230), P["night0"], h)
    bot = mix((190, 220, 250), P["night2"], h)
    c.vgrad(0, H, top, bot)
    if h > 0.3:
        stars(c, t, seed=21, n=int(140 * (h - 0.3) / 0.7) + 1)
    # 구름
    rnd = random.Random(5)
    for i in range(8):
        cx = rnd.randint(0, W)
        cy = rnd.randint(-300, 100) + cam * 0.7
        cx = (cx + camx * 0.5) % (W + 60) - 30
        c.ellipse(cx - 30, cy - 6, cx + 30, cy + 6, (240, 244, 255), alpha=0.8 - h * 0.5)
    c.ox, c.oy = camx, cam
    # 계단
    for i in range(N_STEPS):
        x, y = step_xy(i)
        col = mix((120, 110, 200), (60, 60, 150), i / N_STEPS)
        c.rect(x, y, STEP_W, H + 400, col)
        c.rect(x, y, STEP_W, 3, mix(col, P["white"], 0.35))
        c.rect(x, y + 3, 1, H + 400, mix(col, P["ink"], 0.4))
        if 4 <= i and t > S.cue(1) + 0.8:
            qx, qy = x + STEP_W // 2, y - 14
            if t < S.cue(3) - 0.3 or i > bit_climb(S, t) + 1:
                c.text("?", qx, qy + bob(t, 1, 3, i), P["white"], "g9", align="center", alpha=0.6)
    # 동물과 사람
    labels = [("개미", 0), ("닭", 1), ("침팬지", 2), ("평범한", 3)]
    times = [S.w(0, w) - 0.2 for w, _ in labels]
    x0, y0 = step_xy(0)
    if t > times[0]:
        c.blit(ANT_O, x0 + 26, y0 - 6)
        tag(c, "개미", x0 + 30, y0 + 8, fg=P["ink"], bg=P["white"], fnt="g9", alpha=appear(t, times[0]))
    x1, y1 = step_xy(1)
    if t > times[1]:
        dy = drop(t, times[1], 10) or 0
        c.blit(CHICKEN_O, x1 + 24, y1 - 17 + dy)
        tag(c, "닭", x1 + 30, y1 + 8, fg=P["ink"], bg=P["white"], fnt="g9", alpha=appear(t, times[1]))
    x2, y2 = step_xy(2)
    chimp_pos = (x2 + 22, y2 - 19)
    if t > times[2] and t < S.cue(4) + 0.1:
        dy = drop(t, times[2], 10) or 0
        c.blit(CHIMP_O, chimp_pos[0], chimp_pos[1] + dy)
        tag(c, "침팬지", x2 + 30, y2 + 8, fg=P["ink"], bg=P["white"], fnt="g9", alpha=appear(t, times[2]))
    x3, y3 = step_xy(3)
    if t > times[3]:
        dy = drop(t, times[3], 10) or 0
        draw_person(c, x3 + 18, y3 + dy, shirt=P["blue"], blink=(t % 3.1) < 0.12)
        te = S.w(0, "아인슈타인") - 0.2
        if t > te:
            dy2 = drop(t, te, 10) or 0
            draw_person(c, x3 + 42, y3 + dy2, shirt=P["grey"], hair=P["white"], hair_style="einstein",
                        extras=("mustache",), blink=(t % 2.7) < 0.12)
        tag(c, "사람", x3 + 32, y3 + 8, fg=P["ink"], bg=P["white"], fnt="g9", alpha=appear(t, times[3]))
    # 같은 칸 강조
    if S.w(1, "같은") - 0.2 < t < S.cue(3):
        a = appear(t, S.w(1, "같은") - 0.2)
        c.frame(x3 + 4, y3 - 38, 52, 40, P["yellow"], alpha=a)
        tag(c, "사실상 같은 칸!", x3 + 30, y3 - 54, fg=P["ink"], bg=P["yellow"], fnt="g9", alpha=a)
    # 비트가 계단을 오른다
    if S.cue(3) + 0.2 < t:
        s = bit_climb(S, t)
        i = int(s)
        f = s - i
        xa, ya = step_xy(i)
        xb, yb = step_xy(i + 1)
        bx = lerp(xa, xb, f) + STEP_W * 0.5
        by = lerp(ya, yb, f) - 20 - math.sin(f * math.pi) * 10
        level = 1 if s < 2.5 else (2 if s < 4 else (3 if s < 8 else 4))
        if level == 4:
            glow(c, bx, by, 40, P["cyan"], strength=0.3)
        # 잔상
        for k in range(1, 4):
            ss = max(0.0, s - k * 0.25)
            ii, ff = int(ss), ss - int(ss)
            xa2, ya2 = step_xy(ii)
            xb2, yb2 = step_xy(ii + 1)
            c.circle(lerp(xa2, xb2, ff) + STEP_W * 0.5, lerp(ya2, yb2, ff) - 20, 6 - k, P["cyan"], alpha=0.4)
        draw_bit(c, bx, by, level=level, t=t, eye="happy" if 3 <= s <= 4 else None)
        if 3.0 <= s <= 4.2:
            bubble(c, "안녕!", bx + 4, by - 22, bx, by - 14, fnt="g9")
    c.ox = c.oy = 0
    # 마지막 대사: 침팬지와 인터넷 / 올려다보는 사람
    t4 = S.cue(4)
    if t > t4 - 0.2:
        a = appear(t, t4 - 0.2, 0.4)
        c.dither_to(P["night0"], a)
        if a >= 1:
            tu = S.w(4, "우리도") - 0.2
            if t < tu:
                chimp_internet(c, t)
            else:
                looking_up(c, t, S, tu)


def chimp_internet(c, t):
    c.fill((40, 34, 60))
    c.rect(0, 150, W, H - 150, (70, 50, 40))
    c.blit(CHIMP_O, 100, 110, scale=2)
    # 노트북
    c.rrect(200, 88, 84, 58, 3, P["light"], outline=P["ink"])
    c.rect(206, 94, 72, 46, P["white"])
    c.rect(206, 94, 72, 8, P["blue"])
    c.text("www", 210, 94, P["white"], "g7")
    for i in range(5):
        c.rect(210, 106 + i * 6, 40 + (i * 13) % 25, 2, P["grey"])
    c.poly([(190, 146), (294, 146), (300, 152), (184, 152)], P["grey"])
    qmark(c, 124, 88, t, scale=2)
    qmark(c, 150, 76, t, scale=1, ph=1.0)


def looking_up(c, t, S, tu):
    c.vgrad(0, H, P["night0"], P["night2"])
    stars(c, t, seed=22, n=120)
    # 거대한 비트 + 사건의 지평선 소용돌이
    cx, cy = 250, 58
    for i in range(3):
        r = 46 + i * 8 + math.sin(t * 2 + i) * 2
        n = 60
        for k in range(n):
            a = k / n * 2 * math.pi + t * (0.6 + i * 0.2) * (1 if i % 2 else -1)
            if (k + i) % 3:
                c.px(cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8, [P["purple"], P["dpurple"], P["cyan"]][i])
    glow(c, cx, cy, 44, P["cyan"], strength=0.3)
    draw_bit(c, cx, cy, level=4, t=t)
    noise_rect(c, cx - 60, cy + 40, 120, 8, t, [P["dpurple"], P["night2"]], 0.4)
    # 작은 사람
    c.rect(0, 190, W, H - 190, P["night0"])
    draw_person(c, 80, 192, shirt=P["blue"], pose="idle", blink=(t % 3) < 0.1, look=1)
    qmark(c, 84, 150, t)
    th = S.w(4, "사건의")
    a = appear(t, th - 0.1)
    if a > 0:
        tag(c, "사건의 지평선", cx, 124, fg=P["ink"], bg=P["cyan"], fnt="g11", alpha=a)


@sfx("staircase")
def staircase_sfx(S):
    ev = []
    for w in ("개미", "닭", "침팬지", "평범한", "아인슈타인"):
        ev.append((S.w(0, w) - 0.2, "pop", 0.5))
    ev += [(S.w(1, "같은") - 0.2, "blip", 0.5), (S.cue(2), "rise", 0.4)]
    # 비트 점프
    c3 = S.cue(3)
    last = -1
    for k in range(200):
        tt = c3 + 0.2 + k * 0.03
        if tt > S.lend(3):
            break
        s = bit_climb(S, tt)
        if int(s) != last and s < 9:
            ev.append((tt, "hop", 0.35))
            last = int(s)
    ev += [(S.cue(4) - 0.2, "whoosh", 0.4), (S.w(4, "우리도") - 0.2, "whoosh", 0.3),
           (S.w(4, "사건의") - 0.1, "shimmer", 0.6)]
    return ev
