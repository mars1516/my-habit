import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/gowun-batang/korean-400.css';
import '@fontsource/gowun-batang/korean-700.css';
import './ui/style.css';
import { assets } from './core/Assets';
import { Game } from './core/Game';
import { loadSettings, type Quality } from './core/Settings';
import { ctx } from './core/ctx';
import { installDebug } from './core/Debug';
import { SaveState } from './core/Save';
import { applySaveEarly, applySaveLate } from './core/SaveSystem';
import { buildContent } from './content/Content';
import { autoCull } from './core/Culler';

const params = new URLSearchParams(location.search);
const settings = loadSettings();
const qp = params.get('quality');
if (qp === 'low' || qp === 'medium' || qp === 'high') settings.quality = qp as Quality;
if (params.has('nobloom')) settings.bloom = false;

const fill = document.getElementById('loading-fill')!;
const text = document.getElementById('loading-text')!;
const setProgress = (p: number, label?: string) => {
  fill.style.width = `${Math.round(p * 100)}%`;
  if (label) text.textContent = label;
};
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let started = false;

function beginSession(game: Game, mode: 'new' | 'continue' | 'free') {
  if (started) return;
  started = true;
  const data = mode === 'continue' ? SaveState.load() : null;
  if (mode !== 'continue') SaveState.clear();
  applySaveEarly(data, mode === 'free');
  const before = ctx.scene.children.length;
  buildContent();
  autoCull(ctx.scene, before);
  applySaveLate(data);
  ctx.ui.hideTitle();
  ctx.ui.showHud(true);
  game.mode = 'playing';
  ctx.input.enabled = true;
  ctx.input.requestLock();
  if (!data) {
    ctx.quests.start('main');
    if (mode === 'free') {
      ctx.ui.showDialog([
        { who: '원소의 목소리', text: '자유 모드: 다섯 원소의 힘이 모두 오른손에 깃들었다.' },
        { who: '원소의 목소리', text: '[1]~[5]로 원소를 바꾸고, 좌클릭·E·Q로 마법을 쓰라. 세상의 모든 것이 너의 마법에 응답한다.' },
      ]);
    } else {
      ctx.ui.showDialog([
        { who: '원소의 목소리', text: '…깨어났구나, 원소의 손을 지닌 이여.' },
        { who: '원소의 목소리', text: '해골 군주가 원소의 제단을 차지한 뒤, 에테리아의 네 봉화가 모두 꺼졌다.' },
        { who: '원소의 목소리', text: '오른손에 깃든 불꽃을 느껴 보아라. 좌클릭으로 화염탄을, E로 화염 폭발구를 쏠 수 있다.' },
        { who: '원소의 목소리', text: '사원의 봉인문은 두 개의 불꽃을 기억한다. 화로에 불을 붙여 길을 열어라.' },
      ]);
    }
  } else {
    ctx.ui.toast('여정을 이어간다', undefined, 'good');
  }
}

async function boot() {
  await assets.load('./assets/', (p) => setProgress(p * 0.45, '에셋을 불러오는 중…'));
  const game = new Game(settings, document.getElementById('app')!);
  let step = 0;
  await game.init(async (label) => {
    step++;
    setProgress(0.45 + step * 0.075, label);
    await nextFrame();
  });
  setProgress(1, '준비 완료');
  installDebug(game, params);
  ctx.debug = params.has('debug');
  ctx.ui.onStart = (mode) => beginSession(game, mode);
  document.getElementById('loading')!.classList.add('hidden');
  game.mode = 'title';
  ctx.input.enabled = false;
  ctx.ui.showTitle(SaveState.exists());
  game.start();
  const auto = params.get('start');
  if (auto === 'new' || auto === 'free' || auto === 'continue') {
    beginSession(game, auto);
    if (params.has('skipintro')) ctx.ui.close();
    const pos = params.get('pos');
    if (pos) {
      const [x, z] = pos.split(',').map(Number);
      (window as unknown as { __game: { tp: (x: number, z: number) => void } }).__game.tp(x, z);
    }
  }
}

boot().catch((e) => {
  console.error(e);
  text.textContent = '오류가 발생했습니다: ' + (e?.message ?? e);
  text.style.color = '#ff8080';
});
