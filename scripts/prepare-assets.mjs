// Builds the game-ready asset bundle in public/assets from the KayKit CC0 packs.
// Source packs are cloned next to this repo (see CREDITS.md):
//   ../kaykit-game-assets/kaykit-character-pack-adventures-1.0
//   ../kaykit-game-assets/kaykit-character-pack-skeletons-1.0
//   ../kaykit-game-assets/kaykit-medieval-hexagon-pack-1.0
//   ../kaykit-game-assets/kaykit-dungeon-remastered-1.0
import { NodeIO, Document } from '@gltf-transform/core';
import { mergeDocuments, dedup, prune, unpartition, resample } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.KAYKIT_DIR ?? '../kaykit-game-assets');
const ADV = `${ROOT}/kaykit-character-pack-adventures-1.0/addons/kaykit_character_pack_adventures`;
const SKEL = `${ROOT}/kaykit-character-pack-skeletons-1.0/addons/kaykit_character_pack_skeletons`;
const HEX = `${ROOT}/kaykit-medieval-hexagon-pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf`;
const DUN = `${ROOT}/kaykit-dungeon-remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf`;
const OUT = path.resolve('public/assets');

const io = new NodeIO();
fs.mkdirSync(`${OUT}/characters`, { recursive: true });

const ANIMS = new Set([
  'Idle', 'Idle_B', 'Idle_Combat', 'Unarmed_Idle', 'Walking_A', 'Walking_B', 'Walking_C', 'Walking_D_Skeletons',
  'Walking_Backwards', 'Running_A', 'Running_B', 'Running_C', 'Running_Strafe_Left', 'Running_Strafe_Right',
  'Jump_Start', 'Jump_Idle', 'Jump_Land', 'Jump_Full_Short', 'Jump_Full_Long',
  'Dodge_Forward', 'Dodge_Backward', 'Dodge_Left', 'Dodge_Right',
  'Spellcast_Shoot', 'Spellcast_Raise', 'Spellcast_Long', 'Spellcasting', 'Spellcast_Summon',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab', '1H_Melee_Attack_Jump_Chop',
  '2H_Melee_Attack_Chop', '2H_Melee_Attack_Spin', 'Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Kick',
  '1H_Ranged_Shoot', '1H_Ranged_Aiming', 'Block', 'Blocking', 'Block_Hit', 'Hit_A', 'Hit_B',
  'Death_A', 'Death_A_Pose', 'Death_B', 'Death_C_Skeletons', 'Death_C_Pose',
  'Skeletons_Awaken_Floor', 'Skeletons_Awaken_Standing', 'Skeletons_Inactive_Floor_Pose', 'Skeleton_Inactive_Standing_Pose',
  'Spawn_Ground_Skeletons', 'Taunt', 'Cheer', 'Interact', 'PickUp', 'Use_Item', 'Throw',
  'Sit_Floor_Down', 'Sit_Floor_Idle', 'Sit_Floor_StandUp', 'Sit_Chair_Idle', 'Lie_Idle', 'Lie_Down', 'Lie_StandUp',
]);

function disposeAnimation(a) {
  for (const c of a.listChannels()) c.dispose();
  // Accessors may be shared between clips, so leave them for prune() to collect.
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}

async function writeGlb(doc, file) {
  await doc.transform(resample(), dedup(), prune(), unpartition());
  await io.write(file, doc);
  console.log('wrote', path.relative(process.cwd(), file), (fs.statSync(file).size / 1024).toFixed(0) + 'KB');
}

// --- Characters: meshes + skin only (animations come from the shared libraries) ---
async function character(src, out, dropNodes = []) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) disposeAnimation(a);
  for (const n of root.listNodes()) {
    if (dropNodes.includes(n.getName())) n.dispose();
  }
  await writeGlb(doc, `${OUT}/characters/${out}`);
}

// --- Animation libraries: rig + selected clips, no meshes ---
async function animLibrary(src, out) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!ANIMS.has(a.getName())) disposeAnimation(a);
  for (const n of root.listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null);
  await writeGlb(doc, `${OUT}/characters/${out}`);
}

await character(`${ADV}/Characters/gltf/Mage.glb`, 'mage.glb', ['2H_Staff', '1H_Wand', 'Spellbook', 'Spellbook_open']);
await character(`${ADV}/Characters/gltf/Knight.glb`, 'knight.glb');
await character(`${ADV}/Characters/gltf/Barbarian.glb`, 'barbarian.glb');
await character(`${ADV}/Characters/gltf/Rogue.glb`, 'rogue.glb');
await character(`${ADV}/Characters/gltf/Rogue_Hooded.glb`, 'rogue_hooded.glb');
for (const s of ['Minion', 'Warrior', 'Rogue', 'Mage']) {
  await character(`${SKEL}/Characters/gltf/Skeleton_${s}.glb`, `skeleton_${s.toLowerCase()}.glb`);
}
await animLibrary(`${ADV}/Characters/gltf/Mage.glb`, 'anims_adventurer.glb');
await animLibrary(`${SKEL}/Characters/gltf/Skeleton_Minion.glb`, 'anims_skeleton.glb');

// --- Environment / prop library: every model becomes one named root node in env.glb ---
const ENV = {
  // village (hexagon pack)
  house_a: `${HEX}/buildings/blue/building_home_A_blue.gltf`,
  house_b: `${HEX}/buildings/blue/building_home_B_blue.gltf`,
  house_c: `${HEX}/buildings/red/building_home_A_red.gltf`,
  house_d: `${HEX}/buildings/yellow/building_home_B_yellow.gltf`,
  windmill: `${HEX}/buildings/blue/building_windmill_blue.gltf`,
  windmill_red: `${HEX}/buildings/red/building_windmill_red.gltf`,
  watermill: `${HEX}/buildings/blue/building_watermill_blue.gltf`,
  tavern: `${HEX}/buildings/blue/building_tavern_blue.gltf`,
  church: `${HEX}/buildings/blue/building_church_blue.gltf`,
  market: `${HEX}/buildings/blue/building_market_blue.gltf`,
  blacksmith: `${HEX}/buildings/blue/building_blacksmith_blue.gltf`,
  well: `${HEX}/buildings/blue/building_well_blue.gltf`,
  tower: `${HEX}/buildings/blue/building_tower_A_blue.gltf`,
  tower_b: `${HEX}/buildings/green/building_tower_B_green.gltf`,
  tower_base: `${HEX}/buildings/blue/building_tower_base_blue.gltf`,
  bridge: `${HEX}/buildings/neutral/building_bridge_A.gltf`,
  ruin: `${HEX}/buildings/neutral/building_destroyed.gltf`,
  grain: `${HEX}/buildings/neutral/building_grain.gltf`,
  scaffolding: `${HEX}/buildings/neutral/building_scaffolding.gltf`,
  tent: `${HEX}/decoration/props/tent.gltf`,
  barrel: `${HEX}/decoration/props/barrel.gltf`,
  crate: `${HEX}/decoration/props/crate_A_big.gltf`,
  crate_small: `${HEX}/decoration/props/crate_B_small.gltf`,
  crate_open: `${HEX}/decoration/props/crate_open.gltf`,
  sack: `${HEX}/decoration/props/sack.gltf`,
  fence_wood: `${HEX}/buildings/neutral/fence_wood_straight.gltf`,
  fence_stone: `${HEX}/buildings/neutral/fence_stone_straight.gltf`,
  flag: `${HEX}/decoration/props/flag_blue.gltf`,
  flag_red: `${HEX}/decoration/props/flag_red.gltf`,
  ladder: `${HEX}/decoration/props/ladder.gltf`,
  lumber: `${HEX}/decoration/props/resource_lumber.gltf`,
  stone_pile: `${HEX}/decoration/props/resource_stone.gltf`,
  target: `${HEX}/decoration/props/target.gltf`,
  weaponrack: `${HEX}/decoration/props/weaponrack.gltf`,
  wheelbarrow: `${HEX}/decoration/props/wheelbarrow.gltf`,
  bucket: `${HEX}/decoration/props/bucket_water.gltf`,
  pallet: `${HEX}/decoration/props/pallet.gltf`,
  rock_a: `${HEX}/decoration/nature/rock_single_A.gltf`,
  rock_b: `${HEX}/decoration/nature/rock_single_B.gltf`,
  rock_c: `${HEX}/decoration/nature/rock_single_C.gltf`,
  rock_d: `${HEX}/decoration/nature/rock_single_D.gltf`,
  rock_e: `${HEX}/decoration/nature/rock_single_E.gltf`,
  tree_a: `${HEX}/decoration/nature/tree_single_A.gltf`,
  tree_b: `${HEX}/decoration/nature/tree_single_B.gltf`,
  tree_a_cut: `${HEX}/decoration/nature/tree_single_A_cut.gltf`,
  tree_b_cut: `${HEX}/decoration/nature/tree_single_B_cut.gltf`,
  cloud_big: `${HEX}/decoration/nature/cloud_big.gltf`,
  cloud_small: `${HEX}/decoration/nature/cloud_small.gltf`,
  waterlily_a: `${HEX}/decoration/nature/waterlily_A.gltf`,
  waterlily_b: `${HEX}/decoration/nature/waterlily_B.gltf`,
  waterplant_a: `${HEX}/decoration/nature/waterplant_A.gltf`,
  waterplant_b: `${HEX}/decoration/nature/waterplant_B.gltf`,
  // ruins, loot and lights (dungeon pack)
  chest: `${DUN}/chest.glb`,
  chest_gold: `${DUN}/chest_gold.glb`,
  torch: `${DUN}/torch.gltf.glb`,
  torch_lit: `${DUN}/torch_lit.gltf.glb`,
  pillar: `${DUN}/pillar.gltf.glb`,
  pillar_deco: `${DUN}/pillar_decorated.gltf.glb`,
  column: `${DUN}/column.gltf.glb`,
  rubble: `${DUN}/rubble_large.gltf.glb`,
  rubble_half: `${DUN}/rubble_half.gltf.glb`,
  barrel_large: `${DUN}/barrel_large.gltf.glb`,
  box_large: `${DUN}/box_large.gltf.glb`,
  box_small: `${DUN}/box_small.gltf.glb`,
  floor_tile: `${DUN}/floor_tile_large.gltf.glb`,
  floor_tile_rocks: `${DUN}/floor_tile_large_rocks.gltf.glb`,
  stairs: `${DUN}/stairs.gltf.glb`,
  wall_arched: `${DUN}/wall_arched.gltf.glb`,
  stone_wall: `${HEX}/buildings/neutral/wall_straight.gltf`,
  wall_broken: `${DUN}/wall_broken.gltf.glb`,
  wall_doorway: `${DUN}/wall_doorway.glb`,
  banner: `${DUN}/banner_patternA_blue.gltf.glb`,
  candle: `${DUN}/candle_triple.gltf.glb`,
  coin_stack: `${DUN}/coin_stack_large.gltf.glb`,
  key: `${DUN}/key.gltf.glb`,
  sword_shield: `${DUN}/sword_shield_broken.gltf.glb`,
  table: `${DUN}/table_medium_decorated_A.gltf.glb`,
  stool: `${DUN}/stool.gltf.glb`,
  keg: `${DUN}/keg_decorated.gltf.glb`,
  // skeleton gear
  sk_blade: `${SKEL}/Assets/gltf/Skeleton_Blade.gltf`,
  sk_axe: `${SKEL}/Assets/gltf/Skeleton_Axe.gltf`,
  sk_staff: `${SKEL}/Assets/gltf/Skeleton_Staff.gltf`,
  sk_shield: `${SKEL}/Assets/gltf/Skeleton_Shield_Small_A.gltf`,
  sk_shield_large: `${SKEL}/Assets/gltf/Skeleton_Shield_Large_A.gltf`,
  sk_crossbow: `${SKEL}/Assets/gltf/Skeleton_Crossbow.gltf`,
  // villager gear
  sword: `${ADV}/Assets/gltf/sword_1handed.gltf`,
  mug: `${ADV}/Assets/gltf/mug_full.gltf`,
  spellbook: `${ADV}/Assets/gltf/spellbook_open.gltf`,
};

const lib = new Document();
const libScene = lib.createScene('library');
lib.createBuffer();
for (const [key, file] of Object.entries(ENV)) {
  if (!fs.existsSync(file)) { console.warn('missing', file); continue; }
  const src = await io.read(file);
  for (const a of src.getRoot().listAnimations()) disposeAnimation(a);
  const map = mergeDocuments(lib, src);
  const srcScene = src.getRoot().listScenes()[0];
  const scene = map.get(srcScene);
  const holder = lib.createNode(key);
  for (const child of scene.listChildren()) holder.addChild(child);
  libScene.addChild(holder);
  scene.dispose();
}
lib.getRoot().setDefaultScene(libScene);
await writeGlb(lib, `${OUT}/env.glb`);
