import type * as THREE from 'three';
import type { Terrain } from '../world/Terrain';
import type { Sky } from '../world/Sky';
import type { Water } from '../world/Water';
import type { Grass } from '../world/Grass';
import type { Vegetation } from '../world/Vegetation';
import type { FireGrid } from '../world/FireGrid';
import type { Weather } from '../world/Weather';
import type { Particles, LightPool } from '../fx/Particles';
import type { Effects } from '../fx/Effects';
import type { Player } from '../player/Player';
import type { CameraRig } from '../player/CameraRig';
import type { SkillSystem } from '../magic/SkillSystem';
import type { Props } from '../interact/Props';
import type { Interactions } from '../interact/Interactions';
import type { EnemyManager } from '../entities/EnemyManager';
import type { NPCs } from '../entities/NPCs';
import type { Quests } from '../quests/Quests';
import type { UI } from '../ui/UI';
import type { AudioSys } from '../audio/Audio';
import type { Input } from './Input';
import type { SaveState } from './Save';
import type { Settings } from './Settings';
import type { World } from '../world/World';

export interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: Input;
  terrain: Terrain;
  sky: Sky;
  water: Water;
  grass: Grass;
  veg: Vegetation;
  fire: FireGrid;
  weather: Weather;
  particles: Particles;
  lights: LightPool;
  fx: Effects;
  player: Player;
  cam: CameraRig;
  skills: SkillSystem;
  props: Props;
  interact: Interactions;
  enemies: EnemyManager;
  npcs: NPCs;
  quests: Quests;
  ui: UI;
  audio: AudioSys;
  save: SaveState;
  settings: Settings;
  world: World;
  /** Seconds since game start (unpaused). */
  time: number;
  /** Global wind direction (xz) used by grass, fire spread and clouds. */
  wind: THREE.Vector2;
  debug: boolean;
  /** Time scale for everything except the player (Sandevistan slow motion). */
  slowmo: number;
}

export const ctx = {} as Ctx;
