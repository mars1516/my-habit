"""유튜브 썸네일 (1920x1080 PNG)."""
import math
import os

from PIL import Image

from chars import draw_bit, draw_person
from gfx import H, P, SCALE, W, Canvas
from paths import BUILD
from props import glow, space, sparkle
from scenes.s01_intro import black_hole


def main():
    c = Canvas()
    t = 1.3
    space(c, t, seed=4, n=220)
    black_hole(c, 262, 112, t, r=30, disk_w=150, disk_h=22)
    glow(c, 262, 112, 70, P["cyan"], strength=0.25)
    draw_bit(c, 262, 112, level=4, t=0.0, eye="wide", hover=False)
    for i in range(6):
        a = i * 1.05
        sparkle(c, 262 + math.cos(a) * 70, 112 + math.sin(a) * 50, 0.1, P["white"], 1.0)
    # 올려다보는 작은 사람
    c.rect(0, 196, W, H - 196, P["night0"])
    draw_person(c, 70, 198, scale=2, shirt=P["blue"], pose="up", mouth="o", extras=("sweat",), look=1)
    # 제목
    c.text("기술적", 20, 18, P["white"], "g11b", outline=P["ink"], scale=3, shadow=P["dpurple"])
    c.text("특이점", 20, 58, P["yellow"], "g11b", outline=P["ink"], scale=3, shadow=P["dorange"])
    c.rrect(20, 104, 138, 20, 4, P["red"], outline=P["ink"])
    c.text("인류의 마지막 발명?", 89, 108, P["white"], "g11", align="center")
    out = os.path.join(BUILD, "thumbnail.png")
    Image.fromarray(c.a).resize((W * SCALE, H * SCALE), Image.NEAREST).save(out, optimize=True)
    print(out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
