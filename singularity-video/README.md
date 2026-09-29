# 기술적 특이점 — 8분 도트 애니메이션 설명 영상

쿠르츠게작트식 교양 영상을 **도트(픽셀) 애니메이션**으로 만든 프로젝트입니다.
그림·애니메이션·음악·효과음은 전부 파이썬 코드로 생성하고, 한국어 나레이션은 오픈 가중치 TTS(Supertonic 3)로 합성합니다.

- 대본과 연출 노트: [`script.md`](script.md)
- 유튜브 제목·설명·챕터·태그: [`youtube.md`](youtube.md)

## 컨셉

**"이 세계에서는 해상도가 곧 지능이다."**
AI 캐릭터 **비트**는 8×8 도트로 태어나 스스로를 개선할 때마다 16×16 → 32×32 → 64×64로 선명해집니다.
첫 장면에 내려온 '?' 상자(인류의 마지막 발명품)가 마지막 장면에서 열리는 수미상관 구조입니다.

| | |
|---|---|
| 해상도 | 384×216 논리 픽셀 → 5배 nearest 확대 → 1920×1080 |
| 프레임 | 24fps (스프라이트는 8fps 느낌으로 스텝) |
| 팔레트 | 약 40색 고정 팔레트, 반투명·그라데이션은 베이어 디더 |
| 글꼴 | 갈무리 (BDF 비트맵을 직접 파싱해 도트 그대로 출력) |
| 음악 | 펄스·삼각파·노이즈로 만든 칩튠, 11개 섹션, 나레이션 사이드체인 덕킹 |
| 음성 | Supertonic 3 (sid 8, 속도 1.1) + SenseVoice ASR로 발음 자동 검수·재합성 |

## 빌드

```bash
./setup.sh                      # 패키지 + 음성 모델 내려받기
cd src
python3 narration.py --asr      # 나레이션 합성 → build/voice (ASR 검수·재합성 포함)
python3 audio.py                # 효과음 + 음악 + 믹스 → build/mix.wav (-14 LUFS)
python3 subtitles.py            # 자막 SRT + 챕터
python3 thumbnail.py            # 썸네일
python3 render.py --full        # 최종 영상 → build/singularity.mp4
```

미리보기:

```bash
python3 render.py --list                 # 씬 타임라인
python3 render.py --sheet staircase      # 씬 콘택트시트 PNG
python3 render.py --clip staircase       # 씬 하나만 mp4
python3 render.py --frame 123.4          # 특정 시각 한 장
```

### 목소리 바꾸기

- 다른 합성 목소리: `python3 narration.py --sid 6` (대략 0–4 여성, 5–9 남성 목소리), 속도는 `--speed`.
- 직접 녹음: `build/voice/NNN.wav`(44.1kHz)를 같은 번호로 덮어쓰고 `python3 narration.py --reindex` 후
  `audio.py` → `render.py --full`. 씬 길이와 애니메이션 타이밍이 새 녹음 길이에 맞춰 자동으로 다시 계산됩니다.

## 구조

```
src/
  script.py        대사 (자막 텍스트 / TTS 발음 텍스트)
  narration.py     TTS 합성 + ASR 검수
  timeline.py      나레이션 길이 → 씬·대사 타이밍, 단어 단위 큐(S.w)
  gfx.py           도트 캔버스, 팔레트, 디더, BDF 글꼴
  chars.py         사람, AI 비트(해상도 레벨 1–4), 동물
  props.py         소품·연출 도우미
  scenes/          19개 씬 (s01 도입 … s05 결말)
  audio.py         효과음·음악 합성, 믹스, 라우드니스
  render.py        멀티프로세스 렌더 → ffmpeg
  subtitles.py     SRT/챕터
  thumbnail.py     썸네일
```

## 크레딧 · 라이선스

- 나레이션 음성: [Supertonic 3](https://github.com/supertone-inc/supertonic) (Supertone Inc., 모델 OpenRAIL-M) — [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 로 실행
- 발음 검수: SenseVoice (FunAudioLLM) — sherpa-onnx
- 글꼴: [갈무리 Galmuri](https://github.com/quiple/galmuri) © Lee Minseo, SIL Open Font License 1.1 (`assets/fonts/ofl.md`)
- 그 밖의 그림·애니메이션·음악·효과음: 이 저장소의 코드로 생성
