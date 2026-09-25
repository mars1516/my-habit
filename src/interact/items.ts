export interface ItemDef {
  name: string;
  icon: string;
  desc: string;
  /** Hearts restored in quarter units. */
  heal?: number;
  mana?: number;
  stamina?: number;
  kind: 'food' | 'material' | 'key' | 'special';
}

export const ITEMS: Record<string, ItemDef> = {
  apple: { name: '사과', icon: '🍎', desc: '달콤한 사과. 하트 ½개 회복.', heal: 2, kind: 'food' },
  roasted_apple: { name: '구운 사과', icon: '🍏', desc: '불에 구워 더 달콤해진 사과. 하트 1개 회복.', heal: 4, kind: 'food' },
  mushroom: { name: '숲버섯', icon: '🍄', desc: '숲에서 자라는 통통한 버섯. 하트 ½개 회복.', heal: 2, kind: 'food' },
  glow_mushroom: { name: '빛버섯', icon: '✨', desc: '어둠 속에서 빛나는 버섯. 마력을 회복한다.', heal: 1, mana: 40, kind: 'food' },
  herb: { name: '바람초', icon: '🌿', desc: '상쾌한 향의 약초. 기력을 조금 회복한다.', heal: 1, stamina: 30, kind: 'food' },
  apple_pie: { name: '사과 파이', icon: '🥧', desc: '바람골 농부의 명물 파이. 하트 3개 회복.', heal: 12, kind: 'food' },
  skewer: { name: '버섯 꼬치', icon: '🍢', desc: '모닥불에 구운 버섯 꼬치. 하트 2개 회복.', heal: 8, kind: 'food' },
  herb_soup: { name: '약초 수프', icon: '🍲', desc: '따뜻한 수프. 하트 2개 + 기력 완전 회복.', heal: 8, stamina: 999, kind: 'food' },
  feast: { name: '에테리아 정식', icon: '🍱', desc: '온갖 재료를 넣은 요리. 하트 완전 회복 + 마력 회복.', heal: 999, mana: 999, kind: 'food' },
  mana_tea: { name: '마나 차', icon: '🍵', desc: '빛버섯을 우린 차. 마력 완전 회복.', mana: 999, heal: 2, kind: 'food' },
  charcoal: { name: '숯', icon: '⚫', desc: '불탄 나무에서 나온 숯. 요리의 불쏘시개.', kind: 'material' },
  bone: { name: '해골 뼈', icon: '🦴', desc: '해골 병사가 남긴 뼈. 대장장이가 모으고 있다.', kind: 'material' },
  crystal: { name: '원소 결정', icon: '💎', desc: '원소의 힘이 굳은 결정. 상인과 거래할 수 있다.', kind: 'material' },
  spirit_seed: { name: '정령의 씨앗', icon: '🌰', desc: '숲의 정령이 남긴 씨앗. 여신상에 3개를 바치면 힘을 얻는다.', kind: 'special' },
  doll: { name: '헝겊 인형', icon: '🧸', desc: '바람골 마을 아이 미로의 인형.', kind: 'key' },
};

export interface Recipe {
  id: string;
  out: string;
  needs: Record<string, number>;
}

export const RECIPES: Recipe[] = [
  { id: 'roast', out: 'roasted_apple', needs: { apple: 1 } },
  { id: 'skewer', out: 'skewer', needs: { mushroom: 2 } },
  { id: 'soup', out: 'herb_soup', needs: { herb: 2, mushroom: 1 } },
  { id: 'tea', out: 'mana_tea', needs: { glow_mushroom: 2 } },
  { id: 'feast', out: 'feast', needs: { apple: 2, mushroom: 2, herb: 1, charcoal: 1 } },
];
