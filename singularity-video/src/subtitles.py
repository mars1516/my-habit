"""유튜브 업로드용 한국어 자막(SRT)과 챕터 목록 생성."""
import os
import re

import timeline
from paths import BUILD

MAXLEN = 24  # 한 줄 최대 글자 수


def split_sentences(text):
    parts = re.split(r"(?<=[.?!])\s+", text.strip())
    out = []
    for p in parts:
        if len(p) <= MAXLEN * 2:
            out.append(p)
            continue
        # 너무 길면 쉼표에서 나눈다
        chunks, cur = [], ""
        for seg in re.split(r"(?<=,)\s+", p):
            if cur and len(cur) + 1 + len(seg) > MAXLEN * 2:
                chunks.append(cur)
                cur = seg
            else:
                cur = (cur + " " + seg).strip()
        if cur:
            chunks.append(cur)
        out.extend(chunks)
    return out


def wrap(s):
    if len(s) <= MAXLEN:
        return s
    words = s.split(" ")
    best, bestd = s, 1e9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        d = abs(len(a) - len(b))
        if d < bestd and len(a) <= MAXLEN + 4 and len(b) <= MAXLEN + 4:
            best, bestd = a + "\n" + b, d
    return best


def weight(s):
    return sum(1.0 if ch.isalnum() else 0.3 for ch in s)


def ts(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


CHAPTERS = [
    ("inventions", "마지막 발명품"),
    ("blackhole", "특이점이란?"),
    ("chessboard", "지수적 성장"),
    ("brain", "지능 폭발"),
    ("history", "우리는 지금 어디쯤?"),
    ("utopia", "특이점 너머: 두 개의 미래"),
    ("skeptic", "회의론"),
    ("ending", "결론"),
]


def main():
    scenes = timeline.build()
    cues = []
    for s in scenes:
        for cue, dur, text in zip(s.cues, s.durs, s.texts):
            parts = split_sentences(text)
            tot = sum(weight(p) for p in parts)
            t = s.start + cue
            for p in parts:
                d = dur * weight(p) / tot
                cues.append((t, t + d, wrap(p)))
                t += d
    out = os.path.join(BUILD, "singularity_ko.srt")
    with open(out, "w", encoding="utf-8") as f:
        for i, (a, b, txt) in enumerate(cues, 1):
            nxt = cues[i][0] if i < len(cues) else b + 1
            f.write(f"{i}\n{ts(a)} --> {ts(min(b + 0.3, nxt - 0.04))}\n{txt}\n\n")
    print("wrote", out, len(cues), "cues")
    by_id = {s.id: s for s in scenes}
    lines = []
    for sid, name in CHAPTERS:
        t = by_id[sid].start
        m, sec = divmod(int(t), 60)
        lines.append(f"{m}:{sec:02d} {name}")
    lines[0] = "0:00 " + CHAPTERS[0][1]
    open(os.path.join(BUILD, "chapters.txt"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
