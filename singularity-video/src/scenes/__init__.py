"""씬 레지스트리.

각 씬은 `@scene("id")` 로 등록된 draw(c, t, S) 함수다.
  c: gfx.Canvas,  t: 씬 로컬 시간(초),  S: timeline.Scene (cue/w/p 헬퍼)
씬 함수는 t 에 대한 순수 함수여야 한다 (멀티프로세스 렌더링).
효과음은 `@sfx("id")` 로 등록한 함수가 [(로컬시각, 이름, 볼륨), ...] 을 돌려준다.
"""
REG = {}
SFX = {}
TRANS_IN = {}


def scene(sid, trans="dissolve"):
    def deco(fn):
        REG[sid] = fn
        TRANS_IN[sid] = trans
        return fn
    return deco


def sfx(sid):
    def deco(fn):
        SFX[sid] = fn
        return fn
    return deco


from . import s01_intro, s02_growth, s03_explosion, s04_now, s05_future  # noqa: E402,F401
