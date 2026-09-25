import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { P } from '../world/WorldGen';
import { events } from '../core/Events';
import { place, ground } from './Structures';
import { Torch, Campfire, Windmill, Chest } from '../interact/Mechanisms';
import { beaconsLit } from '../quests/Quests';
import { ITEMS } from '../interact/items';
import type { DialogLine } from '../entities/NPCs';

export function buildVillage() {
  const V = ground(P.village.x, P.village.z);
  const at = (a: number, rad: number, dy = 0) => ground(V.x + Math.cos(a) * rad, V.z + Math.sin(a) * rad, dy);
  const faceCenter = (p: THREE.Vector3) => Math.atan2(V.x - p.x, V.z - p.z);

  // plaza
  ctx.terrain.clearGrass(V.x, V.z, 16);
  place('well', V.clone(), 0, 6, { shrink: 0.8 });
  ctx.props.add(new Campfire(at(0.8, 8), 'village', true));
  const market = at(3.0, 11);
  place('market', market, faceCenter(market), 5.5, { shrink: 0.85 });

  const buildings: [string, number, number, number][] = [
    ['church', 1.35, 36, 6.8],
    ['blacksmith', 0.45, 31, 6.2],
    ['house_a', 0.95, 29, 6.5],
    ['house_b', 1.85, 30, 6.2],
    ['tavern', 3.55, 30, 6.4],
    ['house_c', 4.1, 29, 6.5],
    ['house_d', 4.65, 32, 6.2],
    ['house_a', 2.85, 33, 6.5],
    ['house_b', 5.75, 31, 6.2],
  ];
  const bpos: Record<string, THREE.Vector3> = {};
  for (const [name, a, rad, s] of buildings) {
    const p = at(a, rad);
    place(name, p, faceCenter(p), s, { shrink: 0.88 });
    bpos[name] = p;
  }
  // torches around the plaza
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    ctx.props.add(new Torch(at(a, 17), true));
  }
  // clutter
  const clutter: [string, number, number, number][] = [
    ['barrel', 3.3, 14, 5], ['crate_open', 2.8, 13, 5], ['sack', 3.15, 13.5, 6], ['wheelbarrow', 0.2, 19, 5],
    ['lumber', 0.5, 24, 5], ['stone_pile', 5.2, 22, 5], ['bucket', 0.1, 3, 5], ['flag', 1.6, 21, 9], ['flag', 4.9, 21, 9],
  ];
  for (const [name, a, rad, s] of clutter) place(name, at(a, rad), a, s, { shrink: 0.8, collide: name !== 'flag' });
  for (let i = 0; i < 4; i++) ctx.props.dyn(i % 2 ? 'crate' : 'barrel', at(3.4 + i * 0.12, 15 + (i % 2) * 1.5, 0.7));

  // farm to the east: fields, fences, windmills
  const farm = ground(V.x + 58, V.z + 30);
  for (let i = 0; i < 3; i++) place('grain', ground(farm.x - 4 + i * 11, farm.z - 18), 0, 5.5, { collide: false });
  for (let i = 0; i < 6; i++) place('fence_wood', ground(farm.x - 12 + i * 6.2, farm.z - 26), Math.PI / 2, 5.5, { shrink: 1 });
  ctx.props.add(new Windmill(ground(V.x + 72, V.z + 2), -Math.PI / 2, 7));
  ctx.props.add(new Windmill(ground(V.x + 46, V.z + 62), -Math.PI / 3, 7));
  const redMill = ctx.props.add(new Windmill(ground(V.x + 20, V.z - 52), Math.PI, 6.5, true));
  if (!ctx.save.has('sig:village_mill')) redMill.onCharged = () => ctx.props.signal('village_mill');
  new Chest(ground(V.x + 26, V.z - 44), Math.PI, 'village_mill', [{ item: 'apple_pie', n: 1 }, { item: 'crystal', n: 3 }], { hiddenUntil: 'village_mill' });

  // --- villagers ---
  const elderPos = bpos['church'].clone().lerp(V, 0.28);
  ctx.npcs.add({ id: 'elder', name: '엘다', title: '바람골 촌장', model: 'knight', pos: ground(elderPos.x, elderPos.z), yaw: faceCenter(elderPos) + Math.PI, hide: undefined, talk: elderTalk });
  ctx.npcs.add({
    id: 'farmer', name: '브란', title: '농부', model: 'barbarian', pos: ground(farm.x - 16, farm.z - 8), yaw: -Math.PI / 2, talk: farmerTalk,
    route: [ground(farm.x - 16, farm.z - 8), ground(farm.x - 6, farm.z - 30), ground(farm.x + 8, farm.z - 30)],
  });
  const well = V.clone();
  ctx.npcs.add({ id: 'child', name: '미로', title: '마을 아이', model: 'rogue_hooded', scale: 0.72, pos: ground(well.x + 3, well.z - 3), yaw: 0.4, idle: 'Idle', talk: childTalk });
  const smithPos = bpos['blacksmith'].clone().lerp(V, 0.3);
  ctx.npcs.add({ id: 'smith', name: '고르', title: '대장장이', model: 'barbarian', pos: ground(smithPos.x, smithPos.z), yaw: faceCenter(smithPos), talk: smithTalk });
  const merchantPos = market.clone().lerp(V, 0.35);
  ctx.npcs.add({ id: 'merchant', name: '루카', title: '떠돌이 상인', model: 'rogue', pos: ground(merchantPos.x, merchantPos.z), yaw: faceCenter(merchantPos), talk: merchantTalk });
  const gate = ground(V.x - 30, V.z + 26);
  ctx.npcs.add({
    id: 'guard', name: '한스', title: '마을 경비병', model: 'knight', pos: gate, yaw: Math.atan2(-1, 1),
    hide: ['1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield'], talk: guardTalk,
    route: [gate, ground(V.x - 18, V.z + 34), ground(V.x - 36, V.z + 12)],
  });
}

// ---------------------------------------------------------------------------
function elderTalk(): DialogLine[] {
  const E = '엘다';
  if (!ctx.save.has('talk:elder')) {
    return [
      { who: E, text: '오오… 그 오른손의 빛. 설마 「원소의 손」을 지닌 마법사인가?' },
      { who: E, text: '백 년 전, 해골 군주가 섬 중앙의 원소의 제단을 차지한 뒤로 에테리아의 네 봉화가 모두 꺼져 버렸다네.' },
      { who: E, text: '봉화의 빛이 사라지자 잠들어 있던 해골들이 깨어나 땅을 떠돌기 시작했지.' },
      { who: E, text: '섬 곳곳의 원소의 사당에서 새로운 힘을 얻고, 봉화를 다시 밝혀 주게. 네 봉화가 모두 타오르면 제단의 결계가 풀릴 걸세.' },
      { who: E, text: '사당은 동쪽 바람 절벽, 서쪽 서리 호수의 섬, 남서쪽 속삭임의 숲, 그리고 북쪽 뇌운산 꼭대기에 있다네.' },
      {
        who: E,
        text: '관측탑에 오르면 지도가 밝혀지고, 텔레포트 지점을 깨우면 언제든 돌아올 수 있지. 정령의 씨앗은 여신상에 바치게나.',
        choices: [
          {
            text: '맡겨 주세요.',
            action: () => {
              ctx.save.set('talk:elder');
              ctx.quests.start('main');
              ctx.quests.evaluate();
            },
          },
        ],
      },
    ];
  }
  const n = beaconsLit();
  if (ctx.save.has('boss:defeated')) return [{ who: E, text: '에테리아의 하늘이 다시 맑아졌네. 고맙네, 원소의 손이여. 자네의 이야기는 오래도록 전해질 걸세.' }];
  if (n >= 4) return [{ who: E, text: '네 봉화가 모두 타오르는군! 제단의 결계가 풀렸을 걸세. 해골 군주는 네 원소의 방패를 두르고 있다고 하니… 방패의 반대 원소로 맞서게!' }];
  return [
    { who: E, text: `봉화가 ${n}개 밝혀졌군. ${4 - n}개 남았네. 서두르지 말고, 이 땅을 천천히 둘러보게나.` },
    { who: E, text: '막히면 이것을 기억하게. 불은 번지고, 물은 얼고, 바람은 밀어내고, 번개는 흐르지. 세상은 자네의 마법에 응답한다네.' },
  ];
}

function farmerTalk(): DialogLine[] {
  const F = '브란';
  const q = ctx.quests;
  if (q.complete('farmer')) return [{ who: F, text: '바람이 좋으니 올해 농사는 풍년이겠어. 파이는 맛있었나?' }];
  if (q.step('farmer') === 1)
    return [
      {
        who: F,
        text: '오! 덤불이 싹 사라졌군! 우리 집 특제 사과 파이야, 받아 줘!',
        choices: [{ text: '고마워요!', action: () => { ctx.save.add('apple_pie', 3); events.emit('pickup', { id: 'apple_pie', name: ITEMS.apple_pie.name, count: 3, icon: ITEMS.apple_pie.icon }); ctx.save.set('done:farmer'); } }],
      },
    ];
  if (q.active('farmer')) return [{ who: F, text: `밭 동쪽에 마른 덤불이 아직 남았어. (${ctx.save.counters['drybush'] ?? 0}/9) 밭까지 태우진 말고!` }];
  return [
    { who: F, text: '어이, 마법사 양반! 밭 옆에 마른 덤불이 잔뜩 자라서 골치야.' },
    {
      who: F,
      text: '불 마법으로 싹 태워줄 수 있겠나? 바람 방향만 조심하면 될 거야.',
      choices: [
        { text: '맡겨 주세요.', action: () => q.start('farmer') },
        { text: '나중에요.' },
      ],
    },
  ];
}

function childTalk(): DialogLine[] {
  const C = '미로';
  const q = ctx.quests;
  if (q.complete('doll') || ctx.save.has('done:doll')) return [{ who: C, text: '인형이랑 매일 같이 자! 마법사님도 잘 자요!' }];
  if (ctx.save.count('doll') > 0)
    return [
      {
        who: C,
        text: '내 인형이다!! 고마워요, 마법사님! 이건… 숲에서 주운 반짝이는 씨앗이에요. 선물!',
        choices: [{ text: '잘 간직해.', action: () => { ctx.save.take('doll'); ctx.save.add('spirit_seed', 2); events.emit('pickup', { id: 'spirit_seed', name: ITEMS.spirit_seed.name, count: 2, icon: ITEMS.spirit_seed.icon }); ctx.save.set('done:doll'); } }],
      },
    ];
  if (q.active('doll')) return [{ who: C, text: '숲 쪽 해골 야영지… 무섭지만 마법사님이라면 괜찮겠죠?' }];
  return [
    { who: C, text: '흑흑… 숲에 놀러 갔다가 해골들한테 인형을 빼앗겼어요…' },
    { who: C, text: '숲 쪽 해골 야영지의 상자에 넣어두는 걸 봤어요. 찾아 주실 수 있어요?', choices: [{ text: '꼭 찾아 줄게.', action: () => q.start('doll') }, { text: '미안, 지금은 바빠.' }] },
  ];
}

function smithTalk(): DialogLine[] {
  const S = '고르';
  const q = ctx.quests;
  if (q.complete('smith') || ctx.save.has('done:smith')) return [{ who: S, text: '팔찌는 잘 맞나? 해골 뼈에 깃든 원소의 잔재가 마력을 붙잡아 주지.' }];
  if (q.active('smith') && ctx.save.count('bone') >= 6)
    return [
      {
        who: S,
        text: '오, 좋은 뼈로군! 자, 마력의 팔찌다. 네 오른손이 더 많은 마력을 담을 수 있을 거야.',
        choices: [{ text: '고맙습니다!', action: () => { ctx.save.take('bone', 6); ctx.player.maxMana += 25; ctx.player.mana = ctx.player.maxMana; ctx.save.set('done:smith'); events.emit('banner', { title: '최대 마력 증가', sub: '마력의 팔찌', color: '#9fc8ff' }); } }],
      },
    ];
  if (q.active('smith')) return [{ who: S, text: `뼈는 해골을 쓰러뜨리면 떨어진다. 지금 ${ctx.save.count('bone')}/6개로군.` }];
  return [
    { who: S, text: '해골 병사의 뼈는 단단해서 좋은 재료가 되지.' },
    { who: S, text: '여섯 개만 가져다주면 네 마력을 담을 팔찌를 만들어 주마.', choices: [{ text: '모아 올게요.', action: () => q.start('smith') }, { text: '다음에요.' }] },
  ];
}

const SHOP: { item: string; n: number; price: number }[] = [
  { item: 'apple', n: 3, price: 2 },
  { item: 'skewer', n: 1, price: 3 },
  { item: 'herb_soup', n: 1, price: 5 },
  { item: 'mana_tea', n: 1, price: 5 },
];

function merchantTalk(): DialogLine[] {
  const M = '루카';
  const have = ctx.save.count('crystal');
  return [
    {
      who: M,
      text: `어서 와! 원소 결정만 있으면 뭐든 팔지. (보유: 💎 ${have})`,
      choices: [
        ...SHOP.map((s) => ({
          text: `${ITEMS[s.item].icon} ${ITEMS[s.item].name}${s.n > 1 ? ' ×' + s.n : ''} — 💎${s.price}`,
          action: () => {
            if (!ctx.save.take('crystal', s.price)) {
              events.emit('toast', { text: '원소 결정이 부족하다', kind: 'warn' });
              return;
            }
            ctx.save.add(s.item, s.n);
            events.emit('pickup', { id: s.item, name: ITEMS[s.item].name, count: s.n, icon: ITEMS[s.item].icon });
            events.emit('sound', { name: 'buy', volume: 0.6 });
          },
        })),
        { text: '그냥 구경할게요.' },
      ],
    },
  ];
}

const TIPS = [
  '불타는 풀밭 위에서 활공하면 뜨거운 공기가 몸을 높이 띄워준다더군.',
  '해골들은 비를 맞으면 젖어서 번개에 아주 약해지지.',
  '얼어붙은 적에게 무거운 걸 던지면 산산조각 난다네. 「파쇄」라고 하지.',
  '밤이 되면 호숫가와 숲에 빛버섯이 빛난다는 소문이 있어.',
  '바람으로 불길을 밀면 그쪽으로 번진다네. 적 야영지 쪽으로 밀어 보게!',
  '해골 야영지의 빨간 통은 불이나 번개에 닿으면 터진다. 조심… 아니, 활용하게.',
  '얼음 위에 서 있는 적에게 불을 쓰면 「융해」로 큰 피해를 줄 수 있지.',
];

function guardTalk(): DialogLine[] {
  return [{ who: '한스', text: TIPS[Math.floor(Math.random() * TIPS.length)] }];
}
