"""프레임 렌더링 + 인코딩.

  python3 render.py --list                    타임라인 출력
  python3 render.py --sheet blackhole         씬 미리보기 콘택트시트(PNG)
  python3 render.py --clip blackhole          씬 하나만 mp4 로
  python3 render.py --full                    전체 영상 (오디오 포함)
"""
import argparse
import math
import multiprocessing as mp
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image

import timeline
from gfx import BAYER_FULL, H, SCALE, W, Canvas
from paths import BUILD
from scenes import REG, TRANS_IN

FPS = timeline.FPS
SCENES = None


def ffmpeg_bin():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def scene_index(t):
    for k, s in enumerate(SCENES):
        if t < s.end:
            return k
    return len(SCENES) - 1


def draw_scene(s, lt):
    c = Canvas()
    REG[s.id](c, lt, s)
    return c


def render_at(t):
    k = scene_index(t)
    s = SCENES[k]
    lt = t - s.start
    c = draw_scene(s, lt)
    kind = TRANS_IN.get(s.id, "dissolve")
    tr = timeline.TRANS
    if k > 0 and lt < tr and kind != "cut":
        prev = SCENES[k - 1]
        cp = draw_scene(prev, t - prev.start)
        p = lt / tr
        if kind == "dissolve":
            m = BAYER_FULL[:H, :W] < p
            c.a = np.where(m[..., None], c.a, cp.a)
        elif kind == "black":
            # 이전 씬 → 검정 → 다음 씬
            if p < 0.5:
                cp.dither_to((8, 8, 20), p * 2)
                c.a = cp.a
            else:
                c.dither_to((8, 8, 20), (1 - p) * 2)
        elif kind == "white":
            if p < 0.5:
                cp.dither_to((244, 244, 250), p * 2)
                c.a = cp.a
            else:
                c.dither_to((244, 244, 250), (1 - p) * 2)
    # 영상 맨 처음 페이드 인
    if t < 0.6:
        c.dither_to((8, 8, 20), 1 - t / 0.6)
    return c.a


def _frame(fi):
    return render_at(fi / FPS).tobytes()


def init(voice_dir):
    global SCENES
    SCENES = timeline.build(voice_dir)


def sheet(sid, n=12, out=None, times=None):
    s = next(x for x in SCENES if x.id == sid)
    if times is None:
        times = [s.dur * (i + 0.5) / n for i in range(n)]
    cols = 3
    rows = math.ceil(len(times) / cols)
    k = 2
    img = Image.new("RGB", (cols * W * k + (cols - 1) * 6, rows * H * k + (rows - 1) * 6), (255, 255, 255))
    for j, lt in enumerate(times):
        a = render_at(s.start + lt)
        im = Image.fromarray(a).resize((W * k, H * k), Image.NEAREST)
        img.paste(im, ((j % cols) * (W * k + 6), (j // cols) * (H * k + 6)))
    out = out or os.path.join(BUILD, "preview", f"{sid}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print(out, [round(x, 2) for x in times])


def encode(frames, out, audio=None, crf=16, preset="medium", workers=4):
    cmd = [ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if audio:
        cmd += ["-i", audio]
    cmd += ["-vf", f"scale={W * SCALE}:{H * SCALE}:flags=neighbor", "-c:v", "libx264", "-preset", preset,
            "-crf", str(crf), "-tune", "animation", "-pix_fmt", "yuv420p", "-r", str(FPS)]
    if audio:
        cmd += ["-c:a", "aac", "-b:a", "256k", "-shortest"]
    cmd += ["-movflags", "+faststart", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    ctx = mp.get_context("fork")
    with ctx.Pool(workers) as pool:
        for j, buf in enumerate(pool.imap(_frame, frames, chunksize=12)):
            p.stdin.write(buf)
            if j % (FPS * 20) == 0:
                el = time.time() - t0
                print(f"  frame {j}/{len(frames)}  {el:.0f}s", flush=True)
    p.stdin.close()
    p.wait()
    print(f"wrote {out} in {time.time() - t0:.0f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=os.path.join(BUILD, "voice"))
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--sheet", nargs="*")
    ap.add_argument("--clip", nargs="*")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--audio", default=os.path.join(BUILD, "mix.wav"))
    ap.add_argument("--out", default=os.path.join(BUILD, "singularity.mp4"))
    ap.add_argument("--frame", type=float, help="특정 시각(초) 한 장 PNG")
    ap.add_argument("--n", type=int, default=12)
    args = ap.parse_args()
    init(args.voice)
    if args.list:
        for s in SCENES:
            m, sec = divmod(s.start, 60)
            print(f"{int(m):02d}:{sec:05.2f} {s.id:12s} {s.dur:6.2f}s")
        print("TOTAL", timeline.total(SCENES))
    if args.sheet is not None:
        for sid in (args.sheet or [s.id for s in SCENES]):
            sheet(sid, n=args.n)
    if args.frame is not None:
        a = render_at(args.frame)
        out = os.path.join(BUILD, "preview", f"frame_{args.frame:.2f}.png")
        Image.fromarray(a).resize((W * SCALE, H * SCALE), Image.NEAREST).save(out)
        print(out)
    if args.clip:
        for sid in args.clip:
            s = next(x for x in SCENES if x.id == sid)
            f0, f1 = int(s.start * FPS), int(s.end * FPS)
            encode(list(range(f0, f1)), os.path.join(BUILD, "preview", f"{sid}.mp4"), crf=20, preset="veryfast")
    if args.full:
        n = int(math.ceil(timeline.total(SCENES) * FPS))
        audio = args.audio if os.path.exists(args.audio) else None
        encode(list(range(n)), args.out, audio=audio, preset="slow")


if __name__ == "__main__":
    main()
