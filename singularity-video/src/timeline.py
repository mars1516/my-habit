"""나레이션 길이로부터 씬/대사 타임라인을 만든다."""
import json
import os

import script
from paths import BUILD

FPS = 24
GAP = 0.42          # 대사 사이 기본 간격 (초)
TRANS = 0.5         # 씬 전환 디더 디졸브 길이

# 씬별 연출 여유: lead(첫 대사 전), tail(마지막 대사 후), gap(대사 i 뒤 추가 간격)
SCENE_CFG = {
    "inventions": dict(lead=1.4, tail=1.0, gap={1: 0.4}),
    "good_quote": dict(lead=0.9, tail=1.1, gap={0: 0.2, 1: 0.6}),
    "title": dict(lead=0.5, tail=2.6),
    "blackhole": dict(lead=0.8, tail=0.9),
    "vinge": dict(lead=0.6, tail=1.0),
    "chessboard": dict(lead=0.6, tail=1.6, gap={0: 0.3, 1: 0.5, 3: 0.3}),
    "lilypond": dict(lead=0.8, tail=1.4, gap={0: 0.6, 1: 0.5}),
    "moore": dict(lead=0.6, tail=1.0),
    "brain": dict(lead=0.6, tail=1.3),
    "explosion": dict(lead=0.6, tail=1.6, gap={2: 0.6}),
    "speed": dict(lead=0.6, tail=1.2),
    "staircase": dict(lead=0.6, tail=1.4, gap={3: 0.4}),
    "history": dict(lead=0.6, tail=1.0, gap={2: 0.3}),
    "utopia": dict(lead=0.6, tail=1.0),
    "midas": dict(lead=0.6, tail=1.0, gap={1: 0.5}),
    "paperclip": dict(lead=0.6, tail=1.0, gap={2: 0.5}),
    "skeptic": dict(lead=0.6, tail=1.0),
    "ending": dict(lead=0.8, tail=2.2, gap={2: 0.5}),
    "endcard": dict(lead=0.0, tail=9.0),
}


class Scene:
    def __init__(self, sid, start, dur, cues, durs, texts, files):
        self.id, self.start, self.dur = sid, start, dur
        self.cues, self.durs, self.texts, self.files = cues, durs, texts, files

    @property
    def end(self):
        return self.start + self.dur

    # 로컬 시간(씬 시작 = 0) 기준 헬퍼
    def cue(self, i):
        return self.cues[i] if i < len(self.cues) else self.dur

    def lend(self, i):
        return self.cues[i] + self.durs[i]

    def p(self, t, i, d=0.5, off=0.0):
        """대사 i 시작 + off 부터 d 초 동안 0→1"""
        x = (t - self.cue(i) - off) / d if d > 0 else 1.0
        return 0.0 if x < 0 else 1.0 if x > 1 else x

    def w(self, i, word, which=0):
        """대사 i 안에서 word 가 발화되는 대략적인 시각 (글자 비율 기반)"""
        txt = self.texts[i]
        idx = -1
        for _ in range(which + 1):
            idx = txt.find(word, idx + 1)
        if idx < 0:
            raise ValueError(f"{self.id}[{i}] 에 '{word}' 없음")
        # 공백/문장부호를 제외한 음절 비율
        def weight(s):
            return sum(1.0 if ch.isalnum() else (0.6 if ch in ",.?!" else 0.15) for ch in s)
        return self.cues[i] + self.durs[i] * weight(txt[:idx]) / max(1e-6, weight(txt))

    def line_at(self, t):
        for i in range(len(self.cues) - 1, -1, -1):
            if t >= self.cues[i]:
                return i
        return -1


def build(voice_dir=None):
    voice_dir = voice_dir or os.path.join(BUILD, "voice")
    index = json.load(open(os.path.join(voice_dir, "index.json")))
    by_scene = {}
    for rec in index:
        by_scene.setdefault(rec["scene"], []).append(rec)
    scenes, t = [], 0.0
    for sid, _ in script.SCENES:
        cfg = SCENE_CFG.get(sid, {})
        lead, tail, gaps = cfg.get("lead", 0.6), cfg.get("tail", 1.0), cfg.get("gap", {})
        recs = by_scene.get(sid, [])
        cues, durs, texts, files = [], [], [], []
        cur = lead
        for i, r in enumerate(recs):
            cues.append(cur)
            durs.append(r["dur"])
            texts.append(r["text"])
            files.append(os.path.join(voice_dir, r["file"]))
            cur += r["dur"]
            if i < len(recs) - 1:
                cur += GAP + gaps.get(i, 0.0)
        dur = cur + tail
        scenes.append(Scene(sid, t, dur, cues, durs, texts, files))
        t += dur
    return scenes


def total(scenes):
    return scenes[-1].end


if __name__ == "__main__":
    sc = build()
    for s in sc:
        m, sec = divmod(s.start, 60)
        print(f"{int(m):02d}:{sec:05.2f}  {s.id:12s} {s.dur:6.2f}s  lines={len(s.cues)}")
    m, sec = divmod(total(sc), 60)
    print(f"TOTAL {int(m)}:{sec:05.2f}")
