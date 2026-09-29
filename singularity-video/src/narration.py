"""Supertonic 3 (sherpa-onnx) 로 대사별 한국어 나레이션을 합성한다.

사용법:  python3 narration.py [--sid 8] [--speed 1.15] [--steps 16] [--asr]
결과:    build/voice/NNN.wav + build/voice/index.json
직접 녹음한 목소리를 쓰려면 같은 이름의 wav 로 덮어쓴 뒤
`python3 narration.py --reindex` 를 실행하면 길이 정보만 다시 계산한다.
"""
import argparse
import hashlib
import json
import os
import re

import numpy as np
import soundfile as sf

import script
from paths import BUILD, MODELS

VOICE_DIR = os.path.join(BUILD, "voice")
SR = 44100
TTS_DIR = os.path.join(MODELS, "sherpa-onnx-supertonic-3-tts-int8-2026-05-11")
ASR_DIR = os.path.join(MODELS, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17")


def make_tts(threads=4):
    import sherpa_onnx
    d = TTS_DIR
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
                duration_predictor=f"{d}/duration_predictor.int8.onnx",
                text_encoder=f"{d}/text_encoder.int8.onnx",
                vector_estimator=f"{d}/vector_estimator.int8.onnx",
                vocoder=f"{d}/vocoder.int8.onnx",
                tts_json=f"{d}/tts.json",
                unicode_indexer=f"{d}/unicode_indexer.bin",
                voice_style=f"{d}/voice.bin",
            ),
            num_threads=threads,
            provider="cpu",
        )
    )
    return sherpa_onnx.OfflineTts(cfg)


def make_asr():
    import sherpa_onnx
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=f"{ASR_DIR}/model.int8.onnx", tokens=f"{ASR_DIR}/tokens.txt",
        language="ko", use_itn=True, num_threads=4)


def trim(x, rel=0.02, pad=0.06):
    """앞뒤 무음을 잘라내고 약간의 여유를 남긴다 (최대 음량 대비 상대 임계값)."""
    env = np.convolve(np.abs(x), np.ones(441) / 441, mode="same")
    idx = np.where(env > rel * env.max())[0]
    if len(idx) == 0:
        return x
    p = int(pad * SR)
    return x[max(0, idx[0] - p): min(len(x), idx[-1] + p)]


def normalize(x, target_rms=0.085, peak=0.95):
    voiced = x[np.abs(x) > 0.01]
    rms = np.sqrt(np.mean(voiced ** 2)) if len(voiced) else 1.0
    x = x * (target_rms / rms)
    m = np.abs(x).max()
    if m > peak:
        x = x * (peak / m)
    return x


def fade(x, ms=12):
    n = int(SR * ms / 1000)
    x = x.copy()
    x[:n] *= np.linspace(0, 1, n)
    x[-n:] *= np.linspace(1, 0, n)
    return x


def transcribe(asr, x, sr):
    s = asr.create_stream()
    s.accept_waveform(sr, x)
    asr.decode_stream(s)
    return s.result.text


def cer(ref, hyp):
    norm = lambda s: re.sub(r"[^가-힣0-9a-zA-Z]", "", s)
    a, b = norm(ref), norm(hyp)
    dp = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, dp[0] = dp[0], i
        for j, cb in enumerate(b, 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (ca != cb))
            prev = cur
    return dp[-1] / max(1, len(a))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", type=int, default=8)
    ap.add_argument("--speed", type=float, default=1.1)
    ap.add_argument("--steps", type=int, default=16)
    ap.add_argument("--asr", action="store_true", help="ASR 로 발음 검수 (+ 재합성)")
    ap.add_argument("--tries", type=int, default=4)
    ap.add_argument("--reindex", action="store_true", help="합성 없이 길이만 재계산")
    ap.add_argument("--out", default=VOICE_DIR)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    tts = None if args.reindex else make_tts()
    asr = make_asr() if args.asr else None
    index, total, cers = [], 0.0, []
    for n, (sid, i, sub, say) in enumerate(script.lines()):
        path = os.path.join(args.out, f"{n:03d}.wav")
        key = hashlib.sha1(f"{say}|{args.sid}|{args.speed}|{args.steps}".encode()).hexdigest()[:12]
        meta = path + ".key"
        if tts is not None and not (os.path.exists(path) and os.path.exists(meta)
                                    and open(meta).read() == key):
            import sherpa_onnx
            g = sherpa_onnx.GenerationConfig()
            g.sid, g.num_steps, g.speed = args.sid, args.steps, args.speed
            g.extra["lang"] = "ko"
            # 합성은 매번 조금씩 달라서, ASR 로 검수해 가장 정확한 테이크를 고른다.
            best = None
            for attempt in range(args.tries):
                a = tts.generate(say, g)
                x = np.asarray(a.samples, dtype=np.float32)
                assert a.sample_rate == SR, a.sample_rate
                x = fade(normalize(trim(x)))
                if asr is None:
                    best = (0, x)
                    break
                hyp = transcribe(asr, x, SR)
                e = min(cer(say, hyp), cer(sub, hyp))
                if best is None or e < best[0]:
                    best = (e, x)
                if e <= 0.06:
                    break
            x = best[1]
            sf.write(path, x, SR, subtype="PCM_16")
            open(meta, "w").write(key)
        x, sr = sf.read(path, dtype="float32")
        if x.ndim > 1:
            x = x.mean(1)
        dur = len(x) / sr
        total += dur
        rec = {"n": n, "scene": sid, "i": i, "text": sub, "file": os.path.basename(path), "dur": round(dur, 3)}
        if asr is not None:
            hyp = transcribe(asr, x, sr)
            rec["asr"] = hyp
            rec["cer"] = round(min(cer(say, hyp), cer(sub, hyp)), 3)
            cers.append(rec["cer"])
            flag = "  <-- 확인" if rec["cer"] > 0.12 else ""
            print(f"{n:03d} {dur:5.2f}s CER {rec['cer']:.2f} | {hyp}{flag}", flush=True)
        else:
            print(f"{n:03d} {dur:5.2f}s | {sub}")
        index.append(rec)
    json.dump(index, open(os.path.join(args.out, "index.json"), "w"), ensure_ascii=False, indent=1)
    print(f"total speech {total:.1f}s ({total/60:.2f} min), lines {len(index)}")
    if cers:
        print(f"mean CER {np.mean(cers):.3f}")


if __name__ == "__main__":
    main()
