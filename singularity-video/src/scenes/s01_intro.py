"""1부: 발명의 역사 → 굿의 예언 → 타이틀 → 블랙홀 → 빈지/커즈와일"""
import math
import random

from anim import back, bob, clamp01, ease_io, ease_out, lerp, prog
from chars import draw_bit, draw_person
from gfx import H, P, W, mix, stars
from props import (appear, clipped, arrow, bubble, bulb, computer, drop, fire, glow, mystery_box, noise_rect, panel,
                   qmark, sparkle, tablet, tag, wheel, space, burst)
from . import scene, sfx


# ── 1. 발명의 역사 ───────────────────────────────────────────
INV = [("불", 62, "불"), ("바퀴", 118, "바퀴"), ("글자", 174, "문자"), ("전기", 230, "전기"), ("컴퓨터", 286, "컴퓨터")]
SHIRTS = [P["brown"], P["sand"], P["red"], P["purple"], P["blue"]]


def dusk_bg(c, t, cam):
    c.vgrad(0, 150, (34, 26, 84), (246, 128, 96))
    # 해
    sx, sy = 150 - cam * 0.15, 150
    for i, (r, col) in enumerate(((46, (255, 170, 110)), (36, (255, 196, 120)), (26, P["yellow"]))):
        c.circle(sx, sy, r, col, alpha=0.35 if i == 0 else (0.7 if i == 1 else 1.0))
    # 먼 산 (시차)
    ox = -cam * 0.3
    pts = [(ox - 20, 150)]
    rnd = random.Random(2)
    x = ox - 20
    while x < W + 200:
        pts.append((x, 150 - rnd.randint(8, 26)))
        x += rnd.randint(18, 34)
    pts.append((x, 150))
    c.poly(pts, (92, 52, 110))
    c.rect(0, 150, W, H - 150, (40, 26, 70))
    c.rect(0, 150, W, 1, (120, 70, 120))
    # 길
    c.rect(0, 186, W, 16, (52, 34, 84))
    for i in range(0, W + 40, 12):
        c.rect(i - (cam % 12), 194, 6, 1, (84, 56, 116))


@scene("inventions", trans="cut")
def inventions(c, t, S):
    t_pan0, t_pan1 = S.cue(2), S.cue(2) + 1.6
    cam = 110 * ease_io(prog(t, t_pan0, t_pan1 - t_pan0))
    dusk_bg(c, t, cam)
    c.ox = -cam
    times = [S.w(1, k) - 0.1 for k, _, _ in INV]
    # 사람의 위치: 대사 0 에 걸어 들어오고, 발명품이 나올 때마다 그 앞으로 이동
    xs = [INV[0][1] - 10] + [x for _, x, _ in INV]
    ts = [S.cue(0) + 0.3] + times
    px = 10
    walking = False
    if t < ts[0]:
        px = lerp(-14, xs[0], ease_out(prog(t, 0.2, ts[0] - 0.2)))
        walking = 0.2 < t < ts[0]
    else:
        px = xs[0]
        for k in range(1, len(ts)):
            if t >= ts[k] - 0.55:
                q = prog(t, ts[k] - 0.55, 0.55)
                px = lerp(xs[k - 1], xs[k], ease_io(q))
                walking = q < 1
        if t > t_pan0 + 0.3:
            q = prog(t, t_pan0 + 0.3, 1.6)
            px = lerp(xs[-1], 350, ease_io(q))
            walking = walking or 0 < q < 1
    era = sum(1 for k in range(1, len(ts)) if t >= ts[k] - 0.3)
    era = max(0, min(4, era - 1)) if t >= ts[1] - 0.3 else 0
    # 발명품
    for k, (word, x, lab) in enumerate(INV):
        t0 = times[k]
        dy = drop(t, t0, 18)
        if dy is None:
            continue
        y = 124 + dy + bob(t, 1, 2.2, k)
        c.rect(x - 12, 152, 24, 4, (70, 46, 100))
        c.rect(x - 10, 150, 20, 2, (110, 70, 120))
        if k == 0:
            fire(c, x, 146 + dy, t, 1.0)
        elif k == 1:
            wheel(c, x, y + 4, 12, t)
        elif k == 2:
            tablet(c, x, y + 4)
        elif k == 3:
            bulb(c, x, y + 2, t)
        else:
            computer(c, x, y + 2, t)
        tag(c, lab, x, 160, fg=P["white"], bg=(70, 40, 100), alpha=appear(t, t0 + 0.15))
        burst(c, x, y, t, t0 + 0.2, n=10, col=P["yellow"], speed=40, life=0.5, seed=k)
    # 수수께끼 상자
    box_x = 440
    tb = S.w(2, "발명품") - 0.4
    if t > tb:
        q = prog(t, tb, 1.2)
        by = lerp(-30, 110, back(q, 1.2))
        mystery_box(c, box_x, by + bob(t, 2, 2), t, glow_k=q)
        if q >= 1:
            sparkle(c, box_x - 20, 92, t, P["cyan"], 1.4)
            sparkle(c, box_x + 22, 120, t, P["white"], 1.1, 0.5)
    # 사람
    look_up = t > tb + 0.8
    pose = "idle"
    if not walking and ts[1] - 0.3 < t < t_pan0:
        pose = "point"
    if look_up:
        pose = "up" if (t - tb) % 2.4 < 1.2 else "idle"
    draw_person(c, px, 196, shirt=SHIRTS[era], pants=P["dbrown"] if era == 0 else P["dblue"],
                walk=(t * 1.8) if walking else None, blink=(t % 3.1) < 0.12,
                mouth="o" if look_up else "smile", hair_style="short")
    if look_up:
        qmark(c, px + 2, 152, t)
    c.ox = 0
    # 오프닝 로고 느낌의 연도 라벨
    if t < S.cue(1):
        pass


@sfx("inventions")
def inventions_sfx(S):
    ev = [(S.w(1, k) - 0.1, "pop", 0.7) for k, _, _ in INV]
    ev.append((S.w(2, "발명품") - 0.4, "shimmer", 0.6))
    ev.append((S.cue(2) + 0.1, "whoosh", 0.35))
    return ev


# ── 2. I. J. 굿 ───────────────────────────────────────────────
QUOTE1 = "최초의 초지능 기계는\n인류가 만들어야 할\n마지막 발명품이\n될 것이다."
QUOTE2 = "…그 기계가 충분히\n온순하다면 말이다."


WIN_STARS = [(32, 36), (47, 50), (40, 70), (66, 64), (80, 34), (84, 76), (61, 38)]


def room_bg(c, t):
    c.fill((30, 44, 86))
    for x in range(0, W, 16):
        c.rect(x, 0, 8, 150, (34, 50, 96))
    # 창문 (밤하늘)
    c.rect(25, 29, 64, 54, P["night0"])
    for i, (x, y) in enumerate(WIN_STARS):
        c.px(x, y, P["white"] if (t * 2 + i) % 3 > 0.6 else P["grey"])
    c.circle(74, 44, 7, P["rice"])
    c.circle(71, 42, 6, P["night0"])


def room_fg(c):
    c.rect(56, 29, 2, 54, P["ink"])
    c.rect(25, 55, 64, 2, P["ink"])
    c.frame(22, 26, 70, 60, P["brown"], 3)
    c.rect(18, 84, 78, 4, (170, 116, 80))
    # 바닥
    c.rect(0, 150, W, H - 150, (60, 40, 50))
    c.rect(0, 150, W, 2, (90, 60, 66))
    # 벽 달력
    c.rect(116, 36, 34, 36, P["white"])
    c.rect(116, 36, 34, 9, P["red"])
    c.text("1965", 133, 48, P["ink"], "g9", align="center")
    for i in range(3):
        for j in range(4):
            c.rect(120 + j * 7, 60 + i * 4, 4, 2, P["light"])


@scene("good_quote")
def good_quote(c, t, S):
    room_bg(c, t)
    worried = t > S.w(2, "온순") - 0.2
    # 창밖에서 엿보는 비트 (복선) — 창문 영역으로 클리핑
    if worried:
        q = prog(t, S.w(2, "온순") - 0.2, 0.8)
        clipped(c, 25, 29, 64, 54, lambda cc: draw_bit(cc, 44, 98 - int(30 * ease_out(q)), level=1, t=t,
                                                       hover=False, look=(1, 0)))
    room_fg(c)
    # 인물 (책상 뒤, 2배)
    typing = S.cue(1) - 0.2 < t < S.lend(2)
    pose = "type" if typing and int(t * 8) % 2 == 0 else ("hold" if typing else "idle")
    draw_person(c, 66, 182, scale=2, shirt=(120, 96, 80), pants=P["dbrown"], hair_style="side",
                hair=P["ink"], extras=("glasses", "tie") + (("sweat",) if worried else ()),
                pose=pose, blink=(t % 3.4) < 0.12, mouth="frown" if worried else None, look=1)
    # 책상 (앞판으로 다리를 가림)
    c.rect(20, 150, 150, 8, P["brown"])
    c.rect(20, 150, 150, 2, (170, 116, 80))
    c.rect(26, 158, 138, 40, P["dbrown"])
    c.rect(26, 158, 138, 2, (60, 36, 30))
    c.frame(34, 164, 50, 26, (110, 70, 50))
    c.frame(106, 164, 50, 26, (110, 70, 50))
    c.rect(56, 176, 6, 2, P["gold"])
    c.rect(128, 176, 6, 2, P["gold"])
    # 타자기
    c.rrect(100, 132, 50, 18, 3, P["dgrey"], outline=P["ink"])
    c.rect(106, 126, 38, 6, P["grey"])
    c.frame(106, 126, 38, 6, P["ink"])
    for i in range(5):
        c.rect(106 + i * 8, 142, 5, 3, P["light"])
    # 타자기에서 올라오는 종이
    c.rect(110, 116, 30, 10, P["rice"])
    for i in range(3):
        c.rect(113, 118 + i * 3, 20 - i * 5, 1, P["grey"])
    # 라벨
    a0 = appear(t, S.cue(0) + 0.1)
    tag(c, "1965년 · 수학자 어빙 존 굿", 100, 10, fg=P["yellow"], bg=P["ink"], fnt="g9", alpha=a0)
    # 인용문 종이
    a1 = appear(t, S.cue(1) - 0.35)
    if a1 > 0:
        panel(c, 200, 22, 170, 150, col=P["rice"], border=P["ink"], alpha=a1)
        c.rect(200, 22, 170, 12, (226, 214, 180), alpha=a1)
        c.text("I. J. Good, 1965", 285, 24, P["grey"], "g7", align="center", alpha=a1)
        t0, t1 = S.cue(1), S.lend(1) - 0.2
        c.text(QUOTE1, 212, 42, P["ink"], "g11", reveal=clamp01((t - t0) / (t1 - t0)))
        t2, t3 = S.w(2, "그 기계가"), S.lend(2) - 0.2
        if t > t2:
            c.text(QUOTE2, 212, 116, P["red"], "g11", reveal=clamp01((t - t2) / (t3 - t2)))
        # 강조 밑줄
        if t > S.w(1, "마지막") + 0.3:
            k = prog(t, S.w(1, "마지막") + 0.3, 0.4)
            c.rect(212, 97, int(76 * k), 1, P["orange"])


@sfx("good_quote")
def good_quote_sfx(S):
    ev = [(S.cue(0) + 0.1, "blip", 0.5)]
    # 타자기 소리: 인용문이 타이핑되는 동안
    for (a, b) in ((S.cue(1), S.lend(1) - 0.2), (S.w(2, "그 기계가"), S.lend(2) - 0.2)):
        n = int((b - a) * 9)
        rnd = random.Random(int(a * 100))
        for i in range(n):
            ev.append((a + i / 9 + rnd.random() * 0.03, "type", 0.35))
        ev.append((b + 0.05, "ding", 0.4))
    ev.append((S.w(2, "온순") - 0.2, "glitch", 0.3))
    return ev


# ── 블랙홀 그리기 (타이틀/블랙홀 씬 공용) ────────────────────
def black_hole(c, cx, cy, t, r=26, disk_w=86, disk_h=14, bright=1.0):
    cols = [P["dred"], P["dorange"], P["orange"], P["yellow"], P["white"]]
    glow(c, cx, cy, r * 2.6, (70, 40, 120), strength=0.5)
    # 뒤쪽 원반 (위로 렌즈된 호)
    for i in range(5):
        rr = r + 4 + i * 2
        col = cols[min(4, i + 1)] if i < 3 else cols[1]
        c.ellipse(cx - rr, cy - rr, cx + rr, cy + rr, None, outline=col, alpha=0.9 - i * 0.15)
    # 원반 뒤쪽 절반
    _disk(c, cx, cy, t, disk_w, disk_h, back_half=True, cols=cols)
    # 사건의 지평선
    c.circle(cx, cy, r, (0, 0, 0))
    c.ring(cx, cy, r + 1, P["white"])
    c.ring(cx, cy, r + 2, P["yellow"], alpha=0.6)
    # 원반 앞쪽 절반
    _disk(c, cx, cy, t, disk_w, disk_h, back_half=False, cols=cols)


def _disk(c, cx, cy, t, w, h, back_half, cols):
    for band in range(7):
        k = band / 6
        rw = w * (0.45 + 0.55 * k)
        rh = h * (0.45 + 0.55 * k)
        n = int(rw * 3)
        for i in range(n):
            a = i / n * 2 * math.pi
            s = math.sin(a)
            if back_half != (s < 0):
                continue
            x = cx + math.cos(a) * rw
            y = cy + s * rh
            if back_half and (x - cx) ** 2 + (y - cy) ** 2 < 27 ** 2:
                continue
            ph = (a * 3 - t * (2.2 - k) * 2 + band) % 6.283
            ci = int(4 - k * 3 + math.sin(ph) * 1.2)
            ci = max(0, min(4, ci))
            c.px(x, y, cols[ci])
            if band % 2 == 0:
                c.px(x, y + 1, cols[max(0, ci - 1)])


# ── 3. 타이틀 ─────────────────────────────────────────────────
@scene("title")
def title(c, t, S):
    space(c, t, seed=4, drift=1.5)
    black_hole(c, 192, 118, t, r=22, disk_w=110, disk_h=16)
    t0 = S.w(0, "기술적") - 0.15
    a = appear(t, t0, 0.5)
    if a > 0:
        # 글리치 등장
        jitter = 0 if t > t0 + 0.5 else random.Random(int(t * 30)).randint(-3, 3)
        c.text("기술적 특이점", 192 + jitter, 26, P["white"], "g11b", align="center", outline=P["ink"],
               scale=3, alpha=a, shadow=P["dpurple"])
        c.text("THE  TECHNOLOGICAL  SINGULARITY", 192, 68, P["cyan"], "g7", align="center", alpha=appear(t, t0 + 0.4))
    if t > t0 + 0.6:
        sparkle(c, 60, 40, t, P["cyan"], 1.7)
        sparkle(c, 330, 70, t, P["white"], 1.3, 0.4)


@sfx("title")
def title_sfx(S):
    return [(S.w(0, "기술적") - 0.15, "title", 0.8)]


# ── 4. 블랙홀 ─────────────────────────────────────────────────
FORMULAS = ["E=mc²", "F=ma", "G", "∞", "ħ", "c"]


@scene("blackhole")
def blackhole(c, t, S):
    space(c, t, seed=4, drift=1.5)
    zoom = ease_io(prog(t, S.cue(1), 2.0))
    r = int(22 + 10 * zoom)
    cx, cy = 192, 108
    black_hole(c, cx, cy, t, r=r, disk_w=110 + 50 * zoom, disk_h=16 + 6 * zoom)
    # 라벨: 특이점
    a0 = appear(t, S.w(0, "특이점"))
    if a0 > 0 and t < S.cue(2) + 0.2:
        c.px(cx, cy, P["white"])
        if int(t * 4) % 2:
            c.circle(cx, cy, 1, P["white"])
        arrow(c, cx + 52, cy - 50, cx + 4, cy - 4, P["white"], alpha=a0)
        tag(c, "특이점 (Singularity)", cx + 56, cy - 62, fg=P["ink"], bg=P["yellow"], fnt="g9", align="left",
            alpha=a0)
    # 물리 법칙이 빨려 들어가며 깨진다
    if S.cue(1) < t < S.cue(2) + 1.0:
        for i, f in enumerate(FORMULAS):
            t0 = S.cue(1) + 0.3 + i * 0.35
            q = prog(t, t0, 2.2)
            if q <= 0 or q >= 1:
                continue
            a = i * 1.05 + q * 2.5
            d = (1 - ease_io(q)) * 120 + 4
            x, y = cx + math.cos(a) * d, cy + math.sin(a) * d * 0.7
            col = P["cyan"] if q < 0.6 else P["red"]
            if q > 0.6 and int(t * 20) % 2:
                noise_rect(c, x - 6, y - 4, 14, 8, t, [P["red"], P["white"]], 0.4, seed=i)
            else:
                c.text(f, x, y, col, "g9", align="center", valign="center", outline=P["ink"])
        tag(c, "밀도 = ∞", cx - 90, cy + 40, fg=P["white"], bg=P["dred"], fnt="g11",
            alpha=appear(t, S.w(1, "무한대")))
        tag(c, "물리 법칙 오류!", cx + 90, cy + 40, fg=P["ink"], bg=P["red"], fnt="g9",
            alpha=appear(t, S.w(1, "통하지")) * (1 if int(t * 4) % 2 else 0.6))
    # 사건의 지평선
    a2 = appear(t, S.w(2, "사건의"))
    if a2 > 0:
        R = r + 12
        ph = int(t * 8)
        for i in range(64):
            if (i + ph) % 4 < 2:
                a = i / 64 * 2 * math.pi
                c.px(cx + math.cos(a) * R, cy + math.sin(a) * R, P["cyan"])
        tag(c, "사건의 지평선", cx - 110, cy - 64, fg=P["ink"], bg=P["cyan"], fnt="g9", alpha=a2)
        c.line(cx - 72, cy - 54, cx - R * 0.72, cy - R * 0.72, P["cyan"], alpha=a2)
        # 빛 알갱이가 빨려 들어감
        for i in range(6):
            t0 = S.w(2, "빛조차") - 0.8 + i * 0.45
            q = prog(t, t0, 1.2)
            if 0 < q < 1:
                y0 = cy - 30 + i * 12
                x = lerp(-10, cx, q)
                bend = (q ** 3) * (cy - y0)
                c.px(x, y0 + bend, P["yellow"])
                c.px(x - 1, y0 + bend, P["orange"])
                c.px(x - 2, y0 + bend - (q ** 2), P["dorange"])
    # 우주비행사
    ta = S.cue(2) + 1.0
    if t > ta:
        q = prog(t, ta, 1.2)
        x = lerp(420, 318, ease_out(q))
        y = 150 + bob(t, 2, 1.5)
        draw_person(c, x, y, shirt=P["white"], pants=P["light"], hair_style="helmet", pose="shrug",
                    blink=(t % 2.9) < 0.12, mouth="o", flip=True)
        if q >= 1:
            qmark(c, x - 2, y - 44, t)


@sfx("blackhole")
def blackhole_sfx(S):
    return [(S.w(0, "특이점"), "blip", 0.5), (S.cue(1), "rumble", 0.5), (S.w(1, "통하지"), "glitch", 0.4),
            (S.w(2, "사건의"), "shimmer", 0.5)]


# ── 5. 빈지와 커즈와일 ────────────────────────────────────────
YEARS = [(1950, 34), (1975, 104), (2000, 174), (2025, 244)]
HORIZON_X = 300


def horizon_curtain(c, t, x0, alpha=1.0, top=0):
    # 예측 불가 영역: 잡음 + 어둠
    noise_rect(c, x0 + 3, top, W - x0, H - top, t, [P["night1"], P["dpurple"], P["night2"]], 0.35, fps=10)
    c.rect(x0 + 3, top, W - x0, H - top, P["black"], alpha=0.55 * alpha)
    for i in range(0, H - top, 2):
        wob = round(math.sin(t * 5 + i * 0.3) * 1.5)
        c.px(x0 + wob, top + i, P["cyan"])
        c.px(x0 + wob + 1, top + i + 1, P["purple"])
    glow(c, x0, (top + H) // 2, 16, P["purple"], strength=0.25, rings=2)


def portrait_card(c, x, y, name, sub, alpha, t, **person_kw):
    panel(c, x, y, 112, 48, col=P["night2"], border=P["ink"], alpha=alpha)
    c.rect(x + 4, y + 4, 36, 40, P["night1"], alpha=alpha)
    if alpha >= 0.99:
        clipped(c, x + 4, y + 4, 36, 40, lambda cc: draw_person(
            cc, x + 22, y + 72, scale=2, blink=(t % 3.3) < 0.12, **person_kw))
    c.text(name, x + 46, y + 10, P["white"], "g11", alpha=alpha)
    c.text(sub, x + 46, y + 28, P["cyan"], "g9", alpha=alpha)


@scene("vinge")
def vinge(c, t, S):
    c.vgrad(0, H, P["night0"], P["night2"])
    stars(c, t, seed=7, n=90)
    # 시간축
    y = 160
    c.rect(0, y, W, 2, P["light"])
    for yr, x in YEARS:
        c.rect(x, y - 3, 1, 8, P["light"])
        c.text(str(yr), x, y + 8, P["light"], "g9", align="center")
    # 걸어가는 사람
    px = lerp(20, 262, ease_io(prog(t, 0.2, S.dur - 1.2)))
    walking = 0.2 < t < S.dur - 1.0
    draw_person(c, px, y - 1, shirt=P["teal"], pants=P["dblue"], walk=t * 1.6 if walking else None,
                blink=(t % 3.3) < 0.12)
    # 특이점 커튼
    a1 = appear(t, S.w(1, "인간보다") - 0.2, 0.6)
    if a1 > 0:
        x0 = int(lerp(W + 4, HORIZON_X, ease_out(a1)))
        horizon_curtain(c, t, x0, alpha=a1)
        if a1 >= 1:
            tag(c, "특이점", HORIZON_X, 184, fg=P["ink"], bg=P["cyan"], fnt="g9")
            for i, (qx, qy) in enumerate(((330, 60), (360, 100), (322, 124), (352, 30))):
                if t > S.w(1, "이해할") - 0.4 + i * 0.25:
                    qmark(c, qx, qy, t, P["light"], ph=i)
    # 빈지 카드
    a0 = appear(t, S.w(0, "버너"), 0.4)
    if a0 > 0:
        portrait_card(c, 12, 12, "버너 빈지", "1993 · SF 작가", a0, t,
                      shirt=P["dgreen"], hair_style="short", hair=P["grey"], extras=("beard", "glasses"))
    # 커즈와일 카드 + 2045 표지판
    a2 = appear(t, S.w(2, "레이"), 0.4)
    if a2 > 0:
        portrait_card(c, 140, 12, "레이 커즈와일", "미래학자", a2, t,
                      shirt=P["ink"], hair_style="bald", hair=P["dbrown"], extras=("glasses",))
    a3 = appear(t, S.w(2, "2045"), 0.3)
    if a3 > 0:
        dy = drop(t, S.w(2, "2045"), 20) or 0
        c.rect(HORIZON_X - 1, 118 + dy, 2, 42 - dy, P["brown"])
        c.rrect(HORIZON_X - 24, 100 + dy, 48, 18, 2, P["yellow"], outline=P["ink"])
        c.text("2045?", HORIZON_X, 104 + dy, P["ink"], "g11b", align="center")


@sfx("vinge")
def vinge_sfx(S):
    return [(S.w(0, "버너"), "pop", 0.6), (S.w(1, "인간보다") - 0.2, "glitch", 0.35),
            (S.w(2, "레이"), "pop", 0.6), (S.w(2, "2045"), "thud", 0.6)]
