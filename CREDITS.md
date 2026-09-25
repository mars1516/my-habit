# 크레딧 / Credits

## 3D 모델 · 애니메이션 (CC0 1.0)

모든 3D 모델과 캐릭터 애니메이션은 **Kay Lousberg**의 KayKit 팩을 사용했습니다.
CC0(퍼블릭 도메인)이라 출처 표기 의무는 없지만, 감사의 뜻으로 밝힙니다. — https://kaylousberg.com

| 팩 | 사용처 |
| --- | --- |
| [KayKit Character Pack: Adventurers 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | 주인공 마법사(지팡이·완드·마법서 제거), 마을 NPC, 여신상, 애니메이션 |
| [KayKit Character Pack: Skeletons 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | 해골 졸병·전사·궁수·마법사, 해골 군주, 무기, 애니메이션 |
| [KayKit Medieval Hexagon Pack 1.0](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0) | 마을 건물, 풍차, 나무, 바위, 구름, 울타리, 소품 |
| [KayKit Dungeon Remastered 1.0](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | 보물상자, 횃불, 기둥, 벽·봉인문, 바닥 타일 |

`scripts/prepare-assets.mjs`가 원본 팩에서 필요한 모델만 골라 `public/assets/`로 변환합니다
(애니메이션은 캐릭터별로 중복되지 않도록 공유 라이브러리 두 개로 분리).

## 폰트 (SIL Open Font License 1.1)

- [Pretendard](https://github.com/orioncactus/pretendard) — UI 본문
- [Gowun Batang](https://fonts.google.com/specimen/Gowun+Batang) (@fontsource) — 제목

## 라이브러리

- [three.js](https://threejs.org) (MIT) — 렌더링
- [Rapier](https://rapier.rs) (Apache-2.0) — 물리
- [simplex-noise](https://github.com/jwagner/simplex-noise.js) (MIT) — 지형 생성
- [Vite](https://vitejs.dev) (MIT) — 빌드

## 절차적 생성

지형, 하늘, 물, 풀, 불·연기·마법 파티클, 번개, 마법진, UI 아이콘, 효과음과 배경음악은
외부 파일 없이 코드로 생성합니다.
