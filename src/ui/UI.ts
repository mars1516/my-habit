import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { events } from '../core/Events';
import { MapView } from './MapView';
import { elementIcon, heartPath } from './icons';
import { ELEMENTS, ELEMENT_INFO, type Element } from '../magic/Elements';
import { SKILLS } from '../magic/SkillSystem';
import { ITEMS, RECIPES } from '../interact/items';
import { QUESTS } from '../quests/Quests';
import { regionName, POIS, P } from '../world/WorldGen';
import type { DialogLine } from '../entities/NPCs';
import type { Game } from '../core/Game';
import { writeSave } from '../core/SaveSystem';
import { saveSettings } from '../core/Settings';

type Screen = 'none' | 'title' | 'pause' | 'settings' | 'help' | 'inventory' | 'map' | 'dialog' | 'cooking' | 'statue' | 'dead' | 'ending';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

interface FloatNum {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  life: number;
  vy: number;
}

export class UI {
  root: HTMLElement;
  map: MapView;
  screen: Screen = 'none';
  respawn = new THREE.Vector3(P.temple.x, 0, P.temple.z - 4);
  private hud: HTMLElement;
  private screenEl: HTMLElement;
  private heartsCanvas: HTMLCanvasElement;
  private manaFill: HTMLElement;
  private staminaCanvas: HTMLCanvasElement;
  private minimap: HTMLCanvasElement;
  private regionEl: HTMLElement;
  private clockEl: HTMLElement;
  private questEl: HTMLElement;
  private promptEl: HTMLElement;
  private toastsEl: HTMLElement;
  private pickupsEl: HTMLElement;
  private bannerEl: HTMLElement;
  private crosshair: HTMLElement;
  private chargeEl!: HTMLElement;
  private bossBar: HTMLElement;
  private fpsEl: HTMLElement;
  private hintEl: HTMLElement;
  private lockEl: HTMLElement;
  private statusEl: HTMLElement;
  private slots = new Map<Element, HTMLElement>();
  private eBtn: HTMLElement;
  private qBtn: HTMLElement;
  private numbers: FloatNum[] = [];
  private hpBars: HTMLElement[] = [];
  private lastHearts = '';
  private region = '';
  private minimapTimer = 0;
  private revealTimer = 0;
  private autosaveTimer = 60;
  private bannerQueue: { title: string; sub?: string; color?: string }[] = [];
  private bannerTimer = 0;
  private dialogQueue: DialogLine[] = [];
  private dialogDone?: () => void;
  private typeTimer = 0;
  private typeTarget = '';
  private typePos = 0;
  private dialogTextEl?: HTMLElement;
  private mapView = { cx: 0, cz: 0, zoom: 1 };
  private mapCanvas?: HTMLCanvasElement;
  private deathTimer = 0;
  private invTab: 'bag' | 'magic' | 'quests' | 'log' = 'bag';
  private invSelected = '';
  onStart?: (mode: 'new' | 'continue' | 'free') => void;

  constructor(private game: Game) {
    this.root = document.getElementById('ui-root')!;
    this.map = new MapView();
    this.hud = h('div', 'hud hidden');
    this.screenEl = h('div', 'screen hidden');
    this.root.append(this.hud, this.screenEl);

    // --- top-left: minimap, region, quests ---
    const tl = h('div', 'hud-tl');
    const mm = h('div', 'minimap-wrap');
    this.minimap = h('canvas', 'minimap');
    this.minimap.width = this.minimap.height = 190;
    mm.append(this.minimap, h('div', 'minimap-ring'));
    const line = h('div', 'region-line');
    this.regionEl = h('span', 'region');
    this.clockEl = h('span', 'clock');
    line.append(this.regionEl, this.clockEl);
    this.questEl = h('div', 'quest-tracker');
    tl.append(mm, line, this.questEl);

    // --- bottom-left: hearts & mana ---
    const bl = h('div', 'hud-bl');
    this.heartsCanvas = h('canvas', 'hearts');
    this.heartsCanvas.width = 300;
    this.heartsCanvas.height = 60;
    const mana = h('div', 'mana');
    this.manaFill = h('div', 'mana-fill');
    mana.append(this.manaFill);
    this.statusEl = h('div', 'status-icons');
    bl.append(this.statusEl, this.heartsCanvas, mana);

    this.staminaCanvas = h('canvas', 'stamina');
    this.staminaCanvas.width = this.staminaCanvas.height = 64;

    // --- bottom-right: skills ---
    const br = h('div', 'hud-br');
    const bar = h('div', 'skillbar');
    for (const e of ELEMENTS) {
      const s = h('div', 'slot', `${elementIcon(e, ELEMENT_INFO[e].color)}<span class="key">${ELEMENT_INFO[e].key}</span><span class="lock">🔒</span>`);
      s.style.setProperty('--c', ELEMENT_INFO[e].color);
      s.title = ELEMENT_INFO[e].name;
      bar.append(s);
      this.slots.set(e, s);
    }
    const actions = h('div', 'actions');
    this.eBtn = h('div', 'act e-btn', '<div class="cd"></div><div class="ico"></div><span class="k">E</span><span class="nm"></span>');
    this.qBtn = h('div', 'act q-btn', '<div class="fill"></div><div class="ico"></div><span class="k">Q</span><span class="nm"></span>');
    actions.append(this.eBtn, this.qBtn);
    br.append(actions, bar);

    this.crosshair = h('div', 'crosshair');
    this.chargeEl = h('div', 'charge hidden', '<div class="pips"><i></i><i></i><i></i></div><div class="lv"></div>');
    this.promptEl = h('div', 'prompt hidden');
    this.toastsEl = h('div', 'toasts');
    this.pickupsEl = h('div', 'pickups');
    this.bannerEl = h('div', 'banner hidden');
    this.bossBar = h('div', 'bossbar hidden', '<div class="bname">해골 군주</div><div class="btrack"><div class="bfill"></div></div><div class="bshield"></div>');
    this.fpsEl = h('div', 'fps hidden');
    this.hintEl = h('div', 'hint');
    this.lockEl = h('div', 'lock-reticle hidden');
    this.hud.append(tl, bl, this.staminaCanvas, br, this.crosshair, this.chargeEl, this.promptEl, this.toastsEl, this.pickupsEl, this.bannerEl, this.bossBar, this.fpsEl, this.hintEl, this.lockEl);
    for (let i = 0; i < 14; i++) {
      const b = h('div', 'ehp hidden', '<div class="ename"></div><div class="etrack"><div class="efill"></div></div><div class="ealert">!</div>');
      this.hpBars.push(b);
      this.hud.append(b);
    }

    this.bindEvents();
  }

  // ---------------------------------------------------------------------------
  private bindEvents() {
    events.on('toast', (t) => this.toast(t.text, t.sub, t.kind));
    events.on('banner', (b) => this.bannerQueue.push(b));
    events.on('pickup', (p) => this.pickup(p.icon, p.name, p.count));
    events.on('damageNumber', (d) => this.floatText(d.pos, String(d.amount), d.color, d.big ? 30 : 20));
    events.on('reaction', (r) => this.floatText(r.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), r.name, r.color, 22, true));
    events.on('playerDied', () => {
      this.deathTimer = 2.2;
    });
    events.on('questUpdate', () => this.renderQuest());
    ctx.input.onLockChange = (locked, byUser) => {
      // Esc releases pointer lock natively: treat that as opening the pause menu.
      if (!locked && byUser && this.screen === 'none' && this.game.mode === 'playing' && ctx.input.enabled) this.open('pause');
    };
    this.game.renderer.domElement.addEventListener('mousedown', () => {
      if (this.screen === 'none' && this.game.mode === 'playing') ctx.input.requestLock();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent) {
    const code = e.code;
    if (this.screen === 'dialog') {
      if (['Space', 'Enter', 'KeyF'].includes(code)) this.advanceDialog();
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) this.chooseDialog(n - 1);
      return;
    }
    if (this.screen === 'title' || this.screen === 'dead' || this.screen === 'ending') return;
    if (code === 'Escape') {
      if (this.screen === 'none') this.open('pause');
      else this.close();
      return;
    }
    if (code === 'Tab' || code === 'KeyI') {
      e.preventDefault();
      if (this.screen === 'inventory') this.close();
      else if (this.screen === 'none') this.open('inventory');
      return;
    }
    if (code === 'KeyM') {
      if (this.screen === 'map') this.close();
      else if (this.screen === 'none') this.open('map');
      return;
    }
    if (this.screen === 'none' && code === 'KeyH') this.quickHeal();
    if (this.screen === 'none' && code === 'F3') {
      this.fpsEl.classList.toggle('hidden');
      ctx.settings.showFps = !this.fpsEl.classList.contains('hidden');
    }
  }

  get blocking() {
    return this.screen !== 'none';
  }

  showHud(v: boolean) {
    this.hud.classList.toggle('hidden', !v);
    this.fpsEl.classList.toggle('hidden', !ctx.settings.showFps);
  }

  // ---------------------------------------------------------------------------
  open(s: Screen) {
    this.screen = s;
    this.screenEl.innerHTML = '';
    this.screenEl.className = `screen screen-${s}`;
    this.hud.classList.toggle('in-dialog', s === 'dialog');
    this.hud.classList.toggle('under-map', s === 'map');
    ctx.input.enabled = false;
    ctx.input.exitLock();
    if (s !== 'title') this.game.mode = 'ui';
    events.emit('sound', { name: 'ui_open', volume: 0.4 });
    switch (s) {
      case 'pause':
        return this.renderPause();
      case 'settings':
        return this.renderSettings();
      case 'help':
        return this.renderHelp();
      case 'inventory':
        return this.renderInventory();
      case 'map':
        return this.renderMap();
      case 'dialog':
        return this.renderDialog();
      case 'cooking':
        return this.renderCooking();
      case 'dead':
        return this.renderDead();
      default:
    }
  }

  close() {
    if (this.screen === 'dialog') {
      const cb = this.dialogDone;
      this.dialogDone = undefined;
      this.dialogQueue = [];
      this.screen = 'none';
      cb?.();
      if (this.screen !== 'none') return;
    }
    this.screen = 'none';
    this.screenEl.className = 'screen hidden';
    this.screenEl.innerHTML = '';
    this.hud.classList.remove('in-dialog', 'under-map');
    this.game.mode = 'playing';
    ctx.input.enabled = true;
    ctx.input.clearPressed();
    ctx.input.requestLock();
    events.emit('sound', { name: 'ui_close', volume: 0.3 });
  }

  private panel(title: string, cls = '') {
    const p = h('div', 'panel ' + cls);
    const head = h('div', 'panel-head', `<div class="panel-title">${title}</div>`);
    const x = h('button', 'panel-x', '✕');
    x.onclick = () => this.close();
    head.append(x);
    p.append(head);
    this.screenEl.append(p);
    return p;
  }

  private button(label: string, fn: () => void, cls = '') {
    const b = h('button', 'btn ' + cls, label);
    b.onclick = () => {
      events.emit('sound', { name: 'ui_click', volume: 0.35 });
      fn();
    };
    return b;
  }

  // ---- title -----------------------------------------------------------------
  showTitle(hasSave: boolean) {
    this.screen = 'title';
    this.screenEl.className = 'screen screen-title';
    this.screenEl.innerHTML = '';
    const wrap = h('div', 'title-wrap');
    wrap.append(h('div', 'title-logo', '에테리아'), h('div', 'title-sub', '원소의 손'));
    const menu = h('div', 'title-menu');
    if (hasSave) menu.append(this.button('이어하기', () => this.onStart?.('continue'), 'primary'));
    let armed = false;
    const fresh = this.button(hasSave ? '새로운 여정 (처음부터)' : '새로운 여정', () => {
      // with a save present, ask for a second click instead of a blocking confirm()
      if (hasSave && !armed) {
        armed = true;
        fresh.innerHTML = '한 번 더 누르면 저장을 지우고 시작';
        fresh.classList.add('warn');
        return;
      }
      this.onStart?.('new');
    }, hasSave ? '' : 'primary');
    menu.append(fresh);
    menu.append(this.button('자유 모드 · 모든 마법 해금', () => this.onStart?.('free')));
    menu.append(this.button('조작법', () => this.titleHelp()));
    menu.append(this.button('설정', () => this.titleSettings()));
    wrap.append(menu);
    wrap.append(h('div', 'title-foot', '오른손에 깃든 다섯 원소로 세계를 태우고, 얼리고, 밀어내고, 꿰뚫고, 들어 올려라.<br><span>에셋: KayKit by Kay Lousberg (CC0) · Three.js · Rapier</span>'));
    this.screenEl.append(wrap);
  }

  private titleHelp() {
    const back = () => this.showTitle(!!localStorage.getItem('etheria-save-v1'));
    this.screenEl.innerHTML = '';
    const p = h('div', 'panel help-panel');
    p.append(h('div', 'panel-head', '<div class="panel-title">조작법</div>'));
    p.append(this.helpContent());
    p.append(this.button('돌아가기', back, 'primary'));
    this.screenEl.append(p);
  }

  private titleSettings() {
    this.screenEl.innerHTML = '';
    const p = h('div', 'panel settings-panel');
    p.append(h('div', 'panel-head', '<div class="panel-title">설정</div>'));
    p.append(this.settingsContent());
    p.append(this.button('돌아가기', () => this.showTitle(!!localStorage.getItem('etheria-save-v1')), 'primary'));
    this.screenEl.append(p);
  }

  /** Full-screen overlays (e.g. the Sandevistan tint). */
  setScreenFx(name: string, on: boolean) {
    let el = document.getElementById('fx-' + name);
    if (!el && on) {
      el = document.createElement('div');
      el.id = 'fx-' + name;
      el.className = 'screen-fx ' + name;
      document.getElementById('ui-root')!.appendChild(el);
    }
    el?.classList.toggle('on', on);
  }

  hideTitle() {
    this.screen = 'none';
    this.screenEl.className = 'screen hidden';
    this.screenEl.innerHTML = '';
  }

  // ---- pause / settings / help ------------------------------------------------
  private renderPause() {
    const p = this.panel('일시정지', 'pause-panel');
    const list = h('div', 'menu-list');
    list.append(
      this.button('계속하기', () => this.close(), 'primary'),
      this.button('저장하기', () => {
        this.autosave(true);
      }),
      this.button('지도 (M)', () => this.open('map')),
      this.button('가방 (Tab)', () => this.open('inventory')),
      this.button('설정', () => this.open('settings')),
      this.button('조작법', () => this.open('help')),
      this.button('타이틀로', () => {
        this.autosave(false);
        location.reload();
      }),
    );
    p.append(list);
    const s = ctx.save;
    p.append(h('div', 'pause-stats', `플레이 시간 ${fmtTime(s.playTime)} · 봉화 ${['wind', 'ice', 'kinesis', 'lightning'].filter((e) => s.has('beacon:' + e)).length}/4 · 정령의 씨앗 ${[...s.flags].filter((f) => f.startsWith('seed:')).length}`));
  }

  private settingsContent() {
    const st = ctx.settings;
    const box = h('div', 'settings');
    const row = (label: string, input: HTMLElement) => {
      const r = h('label', 'set-row', `<span>${label}</span>`);
      r.append(input);
      box.append(r);
    };
    const range = (min: number, max: number, step: number, val: number, on: (v: number) => void) => {
      const i = h('input') as HTMLInputElement;
      i.type = 'range';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(val);
      i.oninput = () => {
        on(parseFloat(i.value));
        saveSettings(st);
      };
      return i;
    };
    const check = (val: boolean, on: (v: boolean) => void) => {
      const i = h('input') as HTMLInputElement;
      i.type = 'checkbox';
      i.checked = val;
      i.onchange = () => {
        on(i.checked);
        saveSettings(st);
      };
      return i;
    };
    const q = h('select') as HTMLSelectElement;
    for (const [v, l] of [['low', '낮음'], ['medium', '중간'], ['high', '높음']]) {
      const o = h('option') as HTMLOptionElement;
      o.value = v;
      o.textContent = l;
      if (st.quality === v) o.selected = true;
      q.append(o);
    }
    q.onchange = () => {
      st.quality = q.value as typeof st.quality;
      saveSettings(st);
      this.toast('그래픽 품질은 다시 시작하면 적용됩니다', undefined, 'info');
    };
    row('그래픽 품질', q);
    row('블룸 효과 (재시작 시 적용)', check(st.bloom, (v) => (st.bloom = v)));
    row('마우스 감도', range(0.2, 3, 0.05, st.sensitivity, (v) => (st.sensitivity = v)));
    row('마우스 상하 반전', check(st.invertY, (v) => (st.invertY = v)));
    row('효과음 볼륨', range(0, 1, 0.05, st.volume, (v) => {
      st.volume = v;
      ctx.audio?.setVolume(v, st.music);
    }));
    row('음악 볼륨', range(0, 1, 0.05, st.music, (v) => {
      st.music = v;
      ctx.audio?.setVolume(st.volume, v);
    }));
    row('FPS 표시 (F3)', check(st.showFps, (v) => {
      st.showFps = v;
      this.fpsEl.classList.toggle('hidden', !v);
    }));
    return box;
  }

  private renderSettings() {
    const p = this.panel('설정', 'settings-panel');
    p.append(this.settingsContent());
    p.append(this.button('돌아가기', () => this.open('pause'), 'primary'));
  }

  private helpContent() {
    const rows: [string, string][] = [
      ['WASD', '이동'], ['Shift', '달리기 / 빠르게 헤엄'], ['Space', '점프 · 공중에서 활공 · 벽에서 도약'], ['C / Alt', '회피 (무적 시간)'],
      ['마우스', '시점 회전 · 휠: 거리 조절'], ['우클릭 (누르기)', '조준 모드'], ['휠 클릭 / T', '적 주목 (락온)'], ['좌클릭', '기본 마법 (오른손)'], ['E', '원소 스킬'], ['Q', '원소 폭발 (에너지 가득 찰 때)'],
      ['1 ~ 5 / R', '원소 선택: 화염 · 빙결 · 바람 · 번개 · 염동력'], ['F', '줍기 · 대화 · 열기 · 조사'], ['Tab / I', '가방'], ['M', '지도 · 텔레포트'], ['H', '빠른 회복 (음식)'], ['Esc', '메뉴'],
    ];
    const box = h('div', 'help');
    const t = h('div', 'help-grid');
    for (const [k, v] of rows) t.append(h('div', 'hk', k), h('div', 'hv', v));
    box.append(t);
    box.append(h('div', 'help-tips', `
      <b>원소 상호작용</b><br>
      🔥 화염: 풀과 나무를 태운다 · 화로/모닥불 점화 · 얼음 녹이기 · 불타는 풀 위는 상승 기류<br>
      ❄️ 빙결: 물 위를 얼려 길 만들기 · 빙주로 높은 곳 오르기 · 불 끄기 · 적 빙결<br>
      🌪️ 바람: 물체·적 밀쳐내기 · 풍차 돌리기 · 불을 바람 방향으로 번지게 · 상승 기류<br>
      ⚡ 번개: 연쇄 공격 · 번개 수정 활성화 · 물/젖은 적에게 감전 · 금 간 바위 파괴(낙뢰)<br>
      ✋ 염동력: 상자·바위·돌 블록 옮기기 · 던지기 · 발판 퍼즐<br>
      <b>원소 반응</b> 융해 · 증발 · 빙결 · 감전 · 과부하 · 확산 · 초전도 · 파쇄`));
    return box;
  }

  private renderHelp() {
    const p = this.panel('조작법', 'help-panel');
    p.append(this.helpContent());
    p.append(this.button('돌아가기', () => this.open('pause'), 'primary'));
  }

  // ---- inventory -------------------------------------------------------------
  private renderInventory() {
    const p = this.panel('가방', 'inv-panel');
    const tabs = h('div', 'tabs');
    const tabDefs: [typeof this.invTab, string][] = [['bag', '가방'], ['magic', '마법'], ['quests', '의뢰'], ['log', '기록']];
    for (const [id, label] of tabDefs) {
      const t = this.button(label, () => {
        this.invTab = id;
        this.open('inventory');
      }, 'tab' + (this.invTab === id ? ' active' : ''));
      tabs.append(t);
    }
    p.append(tabs);
    const body = h('div', 'inv-body');
    p.append(body);
    const pl = ctx.player;
    if (this.invTab === 'bag') {
      const grid = h('div', 'item-grid');
      const detail = h('div', 'item-detail');
      const items = Object.entries(ctx.save.inventory).filter(([, n]) => n > 0);
      if (!items.length) grid.append(h('div', 'empty', '가방이 비어 있다.'));
      const showDetail = (id: string) => {
        this.invSelected = id;
        const def = ITEMS[id];
        detail.innerHTML = `<div class="d-icon">${def?.icon ?? '❔'}</div><div class="d-name">${def?.name ?? id}</div><div class="d-desc">${def?.desc ?? ''}</div><div class="d-count">보유: ${ctx.save.count(id)}</div>`;
        if (def?.kind === 'food') detail.append(this.button('먹기', () => {
          this.eat(id);
          this.open('inventory');
        }, 'primary'));
        grid.querySelectorAll('.item').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.id === id));
      };
      for (const [id, n] of items) {
        const def = ITEMS[id];
        const it = h('div', 'item', `<div class="i-icon">${def?.icon ?? '❔'}</div><div class="i-n">${n}</div>`);
        it.dataset.id = id;
        it.title = def?.name ?? id;
        it.onclick = () => showDetail(id);
        grid.append(it);
      }
      body.append(grid, detail);
      if (items.length) showDetail(items.find(([id]) => id === this.invSelected)?.[0] ?? items[0][0]);
      body.append(h('div', 'inv-stats', `❤️ ${(pl.hp / 4).toFixed(2).replace(/\.?0+$/, '')}/${pl.hearts} · 🟢 기력 ${Math.round(pl.maxStamina)} · 🔷 마력 ${Math.round(pl.maxMana)}`));
    } else if (this.invTab === 'magic') {
      const list = h('div', 'magic-list');
      for (const e of ELEMENTS) {
        const owned = ctx.save.skills.has(e);
        const d = SKILLS[e];
        const row = h('div', 'magic-row' + (owned ? '' : ' locked'));
        row.style.setProperty('--c', ELEMENT_INFO[e].color);
        row.innerHTML = `<div class="m-icon">${elementIcon(e, ELEMENT_INFO[e].color)}</div>
          <div class="m-body"><div class="m-name">${ELEMENT_INFO[e].name} <small>[${ELEMENT_INFO[e].key}]</small></div>
          ${owned ? `<div class="m-skills">좌클릭 <b>${d.name}</b> · E <b>${d.skillName}</b> · Q <b>${d.burstName}</b></div><div class="m-desc">${d.desc}</div>` : `<div class="m-desc">아직 깨닫지 못한 힘. 원소의 사당에서 얻을 수 있다.</div>`}</div>`;
        list.append(row);
      }
      body.append(list);
    } else if (this.invTab === 'quests') {
      const list = h('div', 'quest-list');
      for (const q of QUESTS) {
        const s = ctx.quests.step(q.id);
        if (s < 0) continue;
        const done = s >= q.steps.length;
        const row = h('div', 'quest-row' + (done ? ' done' : '') + (ctx.quests.tracked === q.id ? ' tracked' : ''));
        row.innerHTML = `<div class="q-title">${q.main ? '★ ' : ''}${q.title}</div><div class="q-step">${done ? '완료' : q.steps[s].text()}</div>`;
        if (!done)
          row.onclick = () => {
            ctx.quests.tracked = q.id;
            this.renderQuest();
            this.open('inventory');
          };
        list.append(row);
      }
      if (!list.children.length) list.append(h('div', 'empty', '진행 중인 의뢰가 없다.'));
      body.append(list);
    } else {
      const s = ctx.save;
      const count = (prefix: string) => [...s.flags].filter((f) => f.startsWith(prefix)).length;
      const stats: [string, string][] = [
        ['봉화', `${count('beacon:')}/4`],
        ['관측탑', `${count('tower:')}/${POIS.filter((p) => p.kind === 'tower').length}`],
        ['텔레포트 지점', `${count('wp:')}/${POIS.filter((p) => p.kind === 'waypoint').length}`],
        ['소탕한 야영지', `${count('camp:')}/${POIS.filter((p) => p.kind === 'camp').length}`],
        ['찾은 정령의 씨앗', `${count('seed:')}`],
        ['연 보물상자', `${count('chest:')}`],
        ['플레이 시간', fmtTime(s.playTime)],
        ['모드', s.freeMode ? '자유 모드' : '이야기 모드'],
      ];
      const t = h('div', 'log-grid');
      for (const [k, v] of stats) t.append(h('div', 'lk', k), h('div', 'lv', v));
      body.append(t);
    }
  }

  eat(id: string) {
    const def = ITEMS[id];
    if (!def || def.kind !== 'food' || !ctx.save.take(id)) return;
    const p = ctx.player;
    if (def.heal) p.heal(def.heal);
    if (def.mana) p.mana = Math.min(p.maxMana, p.mana + def.mana);
    if (def.stamina) {
      p.stamina = Math.min(p.maxStamina, p.stamina + def.stamina);
      p.exhausted = false;
    }
    events.emit('sound', { name: 'eat', volume: 0.6 });
    this.toast(`${def.icon} ${def.name}을(를) 먹었다`, undefined, 'good');
    ctx.particles.emit({ pos: p.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), count: 14, spread: 1.5, vel: new THREE.Vector3(0, 1.5, 0), life: [0.5, 1], size: [0.3, 0.05], color: '#ff9aa8' });
  }

  quickHeal() {
    const p = ctx.player;
    if (p.hp >= p.hearts * 4) {
      this.toast('이미 건강하다', undefined, 'info');
      return;
    }
    const need = p.hearts * 4 - p.hp;
    const foods = Object.keys(ctx.save.inventory).filter((id) => ITEMS[id]?.heal && ctx.save.count(id) > 0);
    if (!foods.length) {
      this.toast('먹을 것이 없다', undefined, 'warn');
      return;
    }
    foods.sort((a, b) => Math.abs((ITEMS[a].heal ?? 0) - need) - Math.abs((ITEMS[b].heal ?? 0) - need));
    this.eat(foods[0]);
  }

  // ---- cooking ---------------------------------------------------------------
  openCooking() {
    this.open('cooking');
  }

  private renderCooking() {
    const p = this.panel('모닥불 요리', 'cook-panel');
    const list = h('div', 'recipe-list');
    for (const r of RECIPES) {
      const out = ITEMS[r.out];
      const can = Object.entries(r.needs).every(([id, n]) => ctx.save.count(id) >= n);
      const needs = Object.entries(r.needs).map(([id, n]) => `<span class="${ctx.save.count(id) >= n ? 'ok' : 'no'}">${ITEMS[id].icon} ${ITEMS[id].name} ${ctx.save.count(id)}/${n}</span>`).join(' ');
      const row = h('div', 'recipe' + (can ? '' : ' disabled'), `<div class="r-icon">${out.icon}</div><div class="r-body"><div class="r-name">${out.name}</div><div class="r-desc">${out.desc}</div><div class="r-needs">${needs}</div></div>`);
      const b = this.button('요리', () => {
        for (const [id, n] of Object.entries(r.needs)) ctx.save.take(id, n);
        ctx.save.add(r.out, 1);
        events.emit('sound', { name: 'cook', volume: 0.7 });
        this.pickup(out.icon, out.name, 1);
        this.open('cooking');
      }, 'small');
      b.disabled = !can;
      row.append(b);
      list.append(row);
    }
    p.append(list);
    p.append(h('div', 'cook-note', '재료는 숲과 들판, 나무(바람이나 충격으로 흔들면 사과가 떨어진다), 해골 야영지에서 얻을 수 있다.'));
  }

  // ---- statue ----------------------------------------------------------------
  openStatue(name: string) {
    this.open('statue');
    const p = this.panel(name, 'statue-panel');
    const seeds = ctx.save.count('spirit_seed');
    p.append(h('div', 'statue-text', `여신상이 따스하게 빛난다. 체력과 기력이 회복되었다.<br>정령의 씨앗 3개를 바치면 힘을 얻을 수 있다. <b>(보유: 🌰 ${seeds})</b>`));
    const row = h('div', 'statue-choices');
    const heart = this.button('생명의 결정<br><small>최대 하트 +1</small>', () => {
      if (!ctx.save.take('spirit_seed', 3)) return;
      ctx.player.hearts += 1;
      ctx.player.heal(999);
      events.emit('banner', { title: '최대 하트 +1', sub: '여신의 축복', color: '#ff7a8a' });
      events.emit('sound', { name: 'skill_unlock', volume: 0.7 });
      this.close();
    }, 'primary big');
    const stam = this.button('인내의 결정<br><small>최대 기력 +20</small>', () => {
      if (!ctx.save.take('spirit_seed', 3)) return;
      ctx.player.maxStamina += 20;
      ctx.player.stamina = ctx.player.maxStamina;
      events.emit('banner', { title: '최대 기력 +20', sub: '여신의 축복', color: '#8fe89a' });
      events.emit('sound', { name: 'skill_unlock', volume: 0.7 });
      this.close();
    }, 'primary big');
    heart.disabled = stam.disabled = seeds < 3;
    row.append(heart, stam);
    p.append(row);
    p.append(this.button('떠나기', () => this.close()));
  }

  // ---- map -------------------------------------------------------------------
  openMap() {
    this.open('map');
  }

  revealMap(x: number, z: number, r: number) {
    this.map.reveal(x, z, r);
  }

  private renderMap() {
    const wrap = h('div', 'map-wrap');
    const canvas = h('canvas', 'map-canvas');
    const w = Math.min(window.innerWidth - 40, 1400), hh = window.innerHeight - 40;
    canvas.width = w;
    canvas.height = hh;
    this.mapCanvas = canvas;
    this.mapView = { cx: ctx.player.pos.x, cz: ctx.player.pos.z, zoom: 1.6 };
    const tip = h('div', 'map-tip hidden');
    const legend = h('div', 'map-legend', `<b>지도</b><br>휠: 확대/축소 · 드래그: 이동<br>활성화된 <span style="color:#4ab8ff">◆ 텔레포트 지점</span>을 클릭하면 이동<br><span style="color:#e9c979">▲ 관측탑</span> · <span style="color:#e0564a">● 해골 야영지</span> · ✦ 원소의 사당 · <span style="color:#ffcf4a">◈ 목표</span>`);
    const x = h('button', 'panel-x map-x', '✕');
    x.onclick = () => this.close();
    wrap.append(canvas, legend, tip, x);
    this.screenEl.append(wrap);
    let drag: { x: number; y: number; cx: number; cz: number } | null = null;
    let moved = false;
    canvas.onmousedown = (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.mapView.cx, cz: this.mapView.cz };
      moved = false;
    };
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (drag) {
        const scale = (Math.min(canvas.width, canvas.height) / 1024) * this.mapView.zoom;
        const dx = (e.clientX - drag.x) / scale, dz = (e.clientY - drag.y) / scale;
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) moved = true;
        this.mapView.cx = drag.cx - dx;
        this.mapView.cz = drag.cz - dz;
      }
      const wp = this.map.worldFromScreen(canvas, this.mapView, e.clientX - rect.left, e.clientY - rect.top);
      const hit = this.poiAt(wp.x, wp.z);
      if (hit) {
        tip.classList.remove('hidden');
        tip.style.left = e.clientX - rect.left + 16 + 'px';
        tip.style.top = e.clientY - rect.top + 10 + 'px';
        tip.innerHTML = `${hit.name}${hit.kind === 'waypoint' ? (ctx.save.has('wp:' + hit.id) ? '<br><small>클릭하여 이동</small>' : '<br><small>미활성</small>') : ''}`;
      } else tip.classList.add('hidden');
    };
    window.addEventListener('mouseup', () => (drag = null), { once: true });
    canvas.onmouseup = (e) => {
      drag = null;
      if (moved) return;
      const rect = canvas.getBoundingClientRect();
      const wp = this.map.worldFromScreen(canvas, this.mapView, e.clientX - rect.left, e.clientY - rect.top);
      const hit = this.poiAt(wp.x, wp.z);
      if (hit && hit.kind === 'waypoint' && ctx.save.has('wp:' + hit.id)) this.fastTravel(hit.id, hit.x, hit.z, hit.name);
    };
    canvas.onwheel = (e) => {
      e.preventDefault();
      this.mapView.zoom = Math.min(8, Math.max(0.8, this.mapView.zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
    };
  }

  private poiAt(x: number, z: number) {
    const tol = 18 / this.mapView.zoom;
    let best: (typeof POIS)[number] | null = null;
    let bd = tol;
    for (const p of POIS) {
      if (!this.map.poiVisible(p)) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private fastTravel(id: string, x: number, z: number, name: string) {
    this.close();
    const pos = new THREE.Vector3(x, ctx.terrain.heightAt(x, z) + 0.6, z + 3);
    ctx.player.teleport(pos);
    ctx.fx.sphere(pos.clone().add(new THREE.Vector3(0, 1, 0)), '#6fd0ff', 4, 0.8);
    events.emit('sound', { name: 'teleport', volume: 0.8 });
    this.toast(`${name}(으)로 이동했다`, undefined, 'info');
    void id;
  }

  // ---- dialog ----------------------------------------------------------------
  showDialog(lines: DialogLine[], onDone?: () => void) {
    if (!lines.length) {
      onDone?.();
      return;
    }
    this.dialogQueue = [...lines];
    this.dialogDone = onDone;
    this.open('dialog');
  }

  private renderDialog() {
    const line = this.dialogQueue[0];
    if (!line) {
      this.close();
      return;
    }
    this.screenEl.innerHTML = '';
    const box = h('div', 'dialog');
    box.append(h('div', 'd-who', line.who));
    const text = h('div', 'd-text');
    this.dialogTextEl = text;
    this.typeTarget = line.text;
    this.typePos = 0;
    this.typeTimer = 0;
    box.append(text);
    if (line.choices) {
      const cs = h('div', 'd-choices');
      line.choices.forEach((c, i) => {
        const b = this.button(`<span class="n">${i + 1}</span> ${c.text}`, () => this.chooseDialog(i), 'choice');
        cs.append(b);
      });
      box.append(cs);
    } else box.append(h('div', 'd-next', '▼ 클릭 / Space'));
    box.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.choice')) return;
      this.advanceDialog();
    };
    this.screenEl.append(box);
  }

  private advanceDialog() {
    if (this.typePos < this.typeTarget.length) {
      this.typePos = this.typeTarget.length;
      if (this.dialogTextEl) this.dialogTextEl.textContent = this.typeTarget;
      return;
    }
    const line = this.dialogQueue[0];
    if (line?.choices) return;
    this.dialogQueue.shift();
    events.emit('sound', { name: 'ui_click', volume: 0.25 });
    if (this.dialogQueue.length) this.renderDialog();
    else this.close();
  }

  private chooseDialog(i: number) {
    const line = this.dialogQueue[0];
    const c = line?.choices?.[i];
    if (!c) return;
    this.dialogQueue.shift();
    c.action?.();
    if (c.next) this.dialogQueue.unshift(...c.next);
    if (this.dialogQueue.length && this.screen === 'dialog') this.renderDialog();
    else if (this.screen === 'dialog') this.close();
  }

  // ---- death / ending --------------------------------------------------------
  private renderDead() {
    const wrap = h('div', 'dead-wrap');
    wrap.append(h('div', 'dead-title', '쓰러졌다…'), h('div', 'dead-sub', '원소의 빛이 다시 너를 일으킨다'));
    wrap.append(this.button('다시 일어서기', () => {
      this.close();
      ctx.player.revive(this.respawn.clone().setY(ctx.terrain.heightAt(this.respawn.x, this.respawn.z) + 0.5));
    }, 'primary'));
    this.screenEl.append(wrap);
  }

  showEnding() {
    ctx.world.after(2.5, () => {
      this.open('ending');
      const wrap = h('div', 'ending-wrap');
      wrap.innerHTML = `<div class="end-title">에테리아에 빛이 돌아왔다</div>
        <div class="end-text">해골 군주가 무너지자 네 봉화의 빛이 제단으로 모여 하늘로 솟구쳤다.<br>
        잠들어 있던 원소들이 깨어나고, 섬의 바람은 다시 노래하기 시작했다.<br><br>
        그러나 원소의 손을 지닌 마법사의 여정은 끝나지 않았다.<br>아직 찾지 못한 정령의 씨앗과 보물이 섬 곳곳에서 기다리고 있다.</div>
        <div class="credits"><b>에테리아: 원소의 손</b><br>3D 모델 · 애니메이션: KayKit (Kay Lousberg, CC0)<br>엔진: Three.js · 물리: Rapier · 폰트: Pretendard, Gowun Batang<br>지형 · 셰이더 · 효과 · 사운드: 절차적 생성</div>`;
      wrap.append(this.button('계속 탐험하기', () => this.close(), 'primary'));
      this.screenEl.append(wrap);
      this.autosave(false);
    });
  }

  // ---- misc ------------------------------------------------------------------
  setRespawn(p: THREE.Vector3) {
    this.respawn.copy(p);
  }

  autosave(notify = false) {
    if (!ctx.player || !ctx.save) return;
    const ok = writeSave();
    if (notify) this.toast(ok ? '저장했다' : '저장에 실패했다', undefined, ok ? 'good' : 'warn');
    else if (ok) this.flashSaveIcon();
  }

  private flashSaveIcon() {
    const el = h('div', 'save-icon', '✦ 저장됨');
    this.hud.append(el);
    setTimeout(() => el.remove(), 1800);
  }

  toast(text: string, sub?: string, kind: 'info' | 'good' | 'warn' = 'info') {
    const el = h('div', 'toast ' + kind, `${sub ? `<small>${sub}</small>` : ''}${text.replace(/\n/g, '<br>')}`);
    this.toastsEl.append(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
  }

  private pickup(icon: string, name: string, n: number) {
    const el = h('div', 'pick', `<span class="pi">${icon}</span>${name}${n > 1 ? ` ×${n}` : ''}`);
    this.pickupsEl.append(el);
    while (this.pickupsEl.children.length > 6) this.pickupsEl.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  private floatText(pos: THREE.Vector3, text: string, color: string, size: number, reaction = false) {
    let f = this.numbers.find((n) => n.life <= 0);
    if (!f) {
      if (this.numbers.length > 40) return;
      const el = h('div', 'fnum') as HTMLDivElement;
      this.hud.append(el);
      f = { el, pos: new THREE.Vector3(), life: 0, vy: 0 };
      this.numbers.push(f);
    }
    f.el.textContent = text;
    f.el.style.color = color;
    f.el.style.fontSize = size + 'px';
    f.el.classList.toggle('reaction', reaction);
    f.pos.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6));
    f.life = reaction ? 1.4 : 1;
    f.vy = reaction ? 0.8 : 1.6;
    f.el.style.display = 'block';
  }

  private project(p: THREE.Vector3) {
    const v = p.clone().project(ctx.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  private renderQuest() {
    const id = ctx.quests.active(ctx.quests.tracked) ? ctx.quests.tracked : ctx.quests.active('main') ? 'main' : null;
    if (!id) {
      this.questEl.innerHTML = '';
      return;
    }
    const q = ctx.quests.def(id);
    const st = ctx.quests.current(id);
    this.questEl.innerHTML = `<div class="qt-title">${q.main ? '★ ' : '◆ '}${q.title}</div><div class="qt-step">${st?.text() ?? ''}</div>`;
  }

  private drawHearts() {
    const p = ctx.player;
    const key = `${p.hp}/${p.hearts}`;
    if (key === this.lastHearts) return;
    this.lastHearts = key;
    const c = this.heartsCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const path = new Path2D(heartPath);
    const size = 26;
    for (let i = 0; i < p.hearts; i++) {
      const x = (i % 10) * (size + 2), y = Math.floor(i / 10) * (size + 2);
      g.save();
      g.translate(x + 1, y + 1);
      g.scale(size / 24, size / 24);
      g.fillStyle = 'rgba(20,20,30,0.6)';
      g.fill(path);
      const fill = Math.max(0, Math.min(4, p.hp - i * 4)) / 4;
      if (fill > 0) {
        g.save();
        g.beginPath();
        g.rect(0, 0, 24 * fill, 24);
        g.clip();
        g.fillStyle = '#ff4d5e';
        g.fill(path);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.ellipse(7, 8, 3, 2, -0.6, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.strokeStyle = '#fff4e0';
      g.lineWidth = 1.6;
      g.stroke(path);
      g.restore();
    }
  }

  private drawStamina() {
    const p = ctx.player;
    const c = this.staminaCanvas;
    const show = p.stamina < p.maxStamina - 0.5 || p.exhausted;
    c.style.opacity = show ? '1' : '0';
    if (!show) return;
    const pos = this.project(p.pos.clone().add(new THREE.Vector3(0, 1.4, 0)));
    if (pos) {
      c.style.left = pos.x + 48 + 'px';
      c.style.top = pos.y - 70 + 'px';
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 64, 64);
    const frac = p.stamina / p.maxStamina;
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(20,30,20,0.55)';
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = p.exhausted ? '#ff5a4a' : frac < 0.3 ? '#ffd24a' : '#7ee07a';
    g.beginPath();
    g.arc(32, 32, 24, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    g.stroke();
    if (p.maxStamina > 100) {
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(126,224,122,0.5)';
      g.beginPath();
      g.arc(32, 32, 15, -Math.PI / 2, -Math.PI / 2 + ((p.maxStamina - 100) / 100) * Math.PI * 2);
      g.stroke();
    }
  }

  private updateSkills() {
    const sk = ctx.skills;
    const sel = sk.selected;
    for (const [e, el] of this.slots) {
      el.classList.toggle('sel', e === sel);
      el.classList.toggle('locked', !sk.unlocked(e));
    }
    const info = ELEMENT_INFO[sel];
    const cd = sk.cooldown(sel);
    const eIco = this.eBtn.querySelector('.ico') as HTMLElement;
    if (eIco.dataset.el !== sel) {
      eIco.dataset.el = sel;
      eIco.innerHTML = elementIcon(sel, info.color);
      (this.qBtn.querySelector('.ico') as HTMLElement).innerHTML = elementIcon(sel, '#fff');
      (this.eBtn.querySelector('.nm') as HTMLElement).textContent = sel === 'kinesis' && sk.held ? '던지기' : SKILLS[sel].skillName;
      (this.qBtn.querySelector('.nm') as HTMLElement).textContent = SKILLS[sel].burstName;
    }
    this.eBtn.style.setProperty('--c', info.color);
    const k = cd.skillMax > 0 ? cd.skill / cd.skillMax : 0;
    (this.eBtn.querySelector('.cd') as HTMLElement).style.background = k > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${k * 360}deg, transparent 0)` : 'transparent';
    this.eBtn.classList.toggle('ready', k <= 0);
    const en = sk.energy / 100;
    this.qBtn.style.setProperty('--c', info.color);
    (this.qBtn.querySelector('.fill') as HTMLElement).style.background = `conic-gradient(${info.color} ${en * 360}deg, rgba(0,0,0,0.5) 0)`;
    this.qBtn.classList.toggle('ready', en >= 1);
    // E charge stages
    const ch = sk.charge;
    this.chargeEl.classList.toggle('hidden', !ch);
    if (ch) {
      this.chargeEl.style.setProperty('--c', ELEMENT_INFO[ch.el].color);
      const pips = this.chargeEl.querySelectorAll('i');
      pips.forEach((pe, i) => {
        const f = i === 0 ? 1 : Math.min(1, Math.max(0, ch.t - (i - 1)));
        const on = ch.level > i;
        (pe as HTMLElement).style.setProperty('--f', String(on ? 1 : Math.min(0.92, f)));
        pe.classList.toggle('on', on);
      });
      const lv = this.chargeEl.querySelector('.lv') as HTMLElement;
      const txt = `${ch.level}단계`;
      if (lv.textContent !== txt) {
        lv.textContent = txt;
        lv.classList.remove('pop');
        void lv.offsetWidth;
        lv.classList.add('pop');
      }
    }
    this.manaFill.style.width = (ctx.player.mana / ctx.player.maxMana) * 100 + '%';
    (this.manaFill.parentElement as HTMLElement).style.width = 150 + ctx.player.maxMana + 'px';
  }

  private updateHint() {
    const p = ctx.player;
    let t = '';
    if (ctx.skills.held) t = '마우스로 이동 · 휠: 거리 · <b>E</b> 던지기 · <b>좌클릭</b> 놓기';
    else if (p.state === 'climb') t = '<b>WASD</b> 오르기 · <b>Space</b> 도약 · <b>S+Space</b> 놓기';
    else if (p.state === 'glide') t = '<b>Space</b> 활공 해제 · 불 위의 상승 기류를 타자';
    else if (p.state === 'air' && p.airTime > 0.15 && p.stamina > 0) t = '<b>Space</b> 활공';
    else if (p.state === 'swim') t = '<b>Shift</b> 빠르게 헤엄 · <b>Space</b> 뛰어오르기';
    if (this.hintEl.innerHTML !== t) this.hintEl.innerHTML = t;
    // status icons
    const s = p.status;
    const icons = [s.burning > 0 ? '<span class="st fire">🔥 화상</span>' : '', s.wet > 0 ? '<span class="st wet">💧 젖음</span>' : '', s.frozen > 0 ? '<span class="st ice">❄️ 빙결</span>' : '', s.shocked > 0 ? '<span class="st shock">⚡ 감전</span>' : ''].join('');
    if (this.statusEl.innerHTML !== icons) this.statusEl.innerHTML = icons;
  }

  private updateEnemyBars() {
    let i = 0;
    const cam = ctx.camera.position;
    for (const e of ctx.enemies.list) {
      if (i >= this.hpBars.length) break;
      if (!e.alive || e.kind === 'lord') continue;
      const inCombat = e.hpShow > 0 || e.alertIcon > 0 || e.state === 'chase' || e.state === 'attack';
      if (!inCombat || e.pos.distanceTo(cam) > 40) continue;
      const sp = this.project(e.head().add(new THREE.Vector3(0, 0.45, 0)));
      if (!sp) continue;
      const b = this.hpBars[i++];
      b.classList.remove('hidden');
      b.style.transform = `translate(${sp.x - 40}px, ${sp.y - 20}px)`;
      (b.querySelector('.efill') as HTMLElement).style.width = (e.hp / e.maxHp) * 100 + '%';
      (b.querySelector('.ename') as HTMLElement).textContent = e.name;
      (b.querySelector('.ealert') as HTMLElement).style.opacity = e.alertIcon > 0 ? '1' : '0';
      const st = e.status;
      b.dataset.st = st.frozen > 0 ? 'ice' : st.burning > 0 ? 'fire' : st.shocked > 0 ? 'shock' : st.wet > 0 ? 'wet' : '';
    }
    for (; i < this.hpBars.length; i++) this.hpBars[i].classList.add('hidden');
    // boss
    const boss = ctx.enemies.boss;
    this.bossBar.classList.toggle('hidden', !boss || !boss.alive);
    if (boss && boss.alive) {
      (this.bossBar.querySelector('.bfill') as HTMLElement).style.width = (boss.hp / boss.maxHp) * 100 + '%';
      const sh = this.bossBar.querySelector('.bshield') as HTMLElement;
      sh.innerHTML = boss.shieldElement ? `${elementIcon(boss.shieldElement, ELEMENT_INFO[boss.shieldElement].color)} ${ELEMENT_INFO[boss.shieldElement].name}의 방패 ${'◆'.repeat(boss.shieldHp)}` : '<span class="exposed">방패 없음 — 지금이다!</span>';
    }
  }

  // ---------------------------------------------------------------------------
  update(dt: number) {
    const playing = this.game.mode === 'playing' || this.game.mode === 'ui';
    if (!playing || this.screen === 'title') return;
    const p = ctx.player;
    this.drawHearts();
    this.drawStamina();
    this.updateSkills();
    this.updateHint();
    this.updateEnemyBars();

    // minimap
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 1 / 20;
      this.map.drawMinimap(this.minimap, ctx.cam.yaw);
    }
    this.revealTimer -= dt;
    if (this.revealTimer <= 0) {
      this.revealTimer = 0.5;
      this.map.reveal(p.pos.x, p.pos.z, 55);
      const reg = regionName(p.pos.x, p.pos.z);
      if (reg !== this.region) {
        const first = this.region === '';
        this.region = reg;
        this.regionEl.textContent = reg;
        if (!first) this.bannerQueue.push({ title: reg, color: '#f4f1e8' });
      }
      this.renderQuest();
      const hr = Math.floor(ctx.sky.time), mn = Math.floor((ctx.sky.time % 1) * 60);
      this.clockEl.textContent = `${ctx.sky.night > 0.5 ? '☾' : '☀'} ${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}${ctx.weather.raining ? ' · ☂' : ''}`;
      if (ctx.settings.showFps) this.fpsEl.textContent = `${this.game.fps.toFixed(0)} FPS`;
    }

    // prompt
    const it = ctx.interact.current;
    if (it && this.screen === 'none') {
      this.promptEl.classList.remove('hidden');
      const html = `<span class="pk">F</span><span class="pv">${it.verb()}</span><span class="pn">${it.name()}</span>`;
      if (this.promptEl.innerHTML !== html) this.promptEl.innerHTML = html;
    } else this.promptEl.classList.add('hidden');

    // lock-on reticle
    const lock = ctx.cam.lock;
    const lp = lock ? this.project(lock.chest()) : null;
    this.lockEl.classList.toggle('hidden', !lp);
    if (lp) this.lockEl.style.transform = `translate(${lp.x}px, ${lp.y}px) translate(-50%, -50%) rotate(${ctx.time * 60}deg)`;

    // crosshair
    const aiming = ctx.input.isDown('Mouse2') || ctx.skills.selected === 'kinesis';
    this.crosshair.classList.toggle('on', aiming && this.screen === 'none');
    this.crosshair.style.setProperty('--c', ELEMENT_INFO[ctx.skills.selected].color);

    // floating numbers
    for (const f of this.numbers) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.pos.y += f.vy * dt;
      const sp = this.project(f.pos);
      if (!sp || f.life <= 0) {
        f.el.style.display = 'none';
        if (f.life <= 0) f.life = 0;
        continue;
      }
      f.el.style.display = 'block';
      f.el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, f.life * 2.5));
    }

    // banners
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0 && this.bannerQueue.length) {
      const b = this.bannerQueue.shift()!;
      this.bannerEl.innerHTML = `<div class="b-title" style="color:${b.color ?? '#fff'}">${b.title}</div>${b.sub ? `<div class="b-sub">${b.sub}</div>` : ''}`;
      this.bannerEl.classList.remove('hidden');
      this.bannerEl.classList.remove('show');
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('show');
      this.bannerTimer = 3.2;
    }
    if (this.bannerTimer <= 0 && !this.bannerQueue.length) this.bannerEl.classList.add('hidden');

    // dialog typewriter
    if (this.screen === 'dialog' && this.dialogTextEl && this.typePos < this.typeTarget.length) {
      this.typeTimer += dt;
      const n = Math.floor(this.typeTimer * 55);
      if (n > this.typePos) {
        this.typePos = Math.min(this.typeTarget.length, n);
        this.dialogTextEl.textContent = this.typeTarget.slice(0, this.typePos);
      }
    }

    // map screen redraw
    if (this.screen === 'map' && this.mapCanvas) this.map.drawFull(this.mapCanvas, this.mapView);

    // death
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0 && this.screen === 'none') this.open('dead');
    }

    // autosave
    if (this.game.mode === 'playing') {
      ctx.save.playTime += dt;
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = 90;
        if (p.alive && p.state === 'ground') this.autosave(false);
      }
    }
  }
}

function fmtTime(s: number) {
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
  return hh > 0 ? `${hh}시간 ${mm}분` : `${mm}분`;
}
