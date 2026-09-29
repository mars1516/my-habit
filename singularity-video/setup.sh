#!/usr/bin/env bash
# 렌더링에 필요한 파이썬 패키지와 음성 모델을 준비한다.
set -euo pipefail
cd "$(dirname "$0")"
pip install pillow numpy scipy soundfile imageio-ffmpeg sherpa-onnx
mkdir -p models
cd models
base=https://github.com/k2-fsa/sherpa-onnx/releases/download
if [ ! -d sherpa-onnx-supertonic-3-tts-int8-2026-05-11 ]; then
  curl -L -o tts.tar.bz2 $base/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2
  tar xjf tts.tar.bz2 && rm tts.tar.bz2
fi
# (선택) 나레이션 발음 검수용 음성인식 모델
if [ ! -d sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17 ]; then
  curl -L -o asr.tar.bz2 $base/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
  tar xjf asr.tar.bz2 && rm asr.tar.bz2
fi
