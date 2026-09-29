# 완성본 (유튜브 업로드용)

| 파일 | 내용 |
|---|---|
| `singularity.mp4.001`, `singularity.mp4.002` | 본 영상 원본을 둘로 나눈 조각 (합치면 1920×1080 · 24fps · 7분 59초 · H.264/AAC · 약 147MB) |
| `singularity.mp4.sha256` | 합친 파일 검증용 해시 |
| `singularity_ko.srt` | 한국어 자막 |
| `thumbnail.png` | 썸네일 (1920×1080) |

깃허브는 파일 하나당 100MB까지만 올릴 수 있어서 원본을 바이트 그대로 둘로 나눴습니다. 두 조각을 받아 합치면 원본과 똑같은 파일이 됩니다.

## 합치는 방법

**Windows (명령 프롬프트)**
```
copy /b singularity.mp4.001 + singularity.mp4.002 singularity.mp4
```
또는 7-Zip에서 `singularity.mp4.001` 우클릭 → 7-Zip → 파일 합치기(Combine files).

**macOS / Linux**
```
cat singularity.mp4.001 singularity.mp4.002 > singularity.mp4
shasum -a 256 -c singularity.mp4.sha256   # 또는 sha256sum -c
```
