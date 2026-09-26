import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ctx } from './ctx';
import { physics } from './Physics';
import { Input } from './Input';
import type { Settings } from './Settings';
import { SaveState } from './Save';
import { Terrain } from '../world/Terrain';
import { Sky } from '../world/Sky';
import { Water } from '../world/Water';
import { Grass } from '../world/Grass';
import { Vegetation } from '../world/Vegetation';
import { FireGrid } from '../world/FireGrid';
import { Weather } from '../world/Weather';
import { World } from '../world/World';
import { Particles, LightPool } from '../fx/Particles';
import { Effects } from '../fx/Effects';
import { Player } from '../player/Player';
import { CameraRig } from '../player/CameraRig';
import { P } from '../world/WorldGen';
import { Interactions } from '../interact/Interactions';
import { Props } from '../interact/Props';
import { SkillSystem } from '../magic/SkillSystem';
import { EnemyManager } from '../entities/EnemyManager';
import { NPCs } from '../entities/NPCs';
import { Quests } from '../quests/Quests';
import { AudioSys } from '../audio/Audio';
import { UI } from '../ui/UI';
import { culler } from './Culler';

export type GameMode = 'loading' | 'title' | 'playing' | 'paused' | 'ui' | 'dead' | 'ending';

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer?: EffectComposer;
  bloom?: UnrealBloomPass;
  mode: GameMode = 'loading';
  private last = performance.now();
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** Extra per-frame hooks registered by gameplay systems. */
  updaters: ((dt: number) => void)[] = [];
  private titleT = 0;

  constructor(public settings: Settings, container: HTMLElement) {
    const q = settings.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.5 : q === 'medium' ? 1.25 : 0.85));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2600);
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    ctx.particles?.setScale(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  async init(onStep: (label: string) => Promise<void>) {
    const q = this.settings.quality;
    ctx.renderer = this.renderer;
    ctx.scene = this.scene;
    ctx.camera = this.camera;
    ctx.settings = this.settings;
    ctx.input = new Input(this.renderer.domElement);
    ctx.time = 0;
    ctx.slowmo = 1;
    ctx.wind = new THREE.Vector2(1, 0.3);
    ctx.save = new SaveState();

    await onStep('물리 엔진 준비 중…');
    await physics.init();

    await onStep('에테리아 대지를 빚는 중…');
    ctx.terrain = new Terrain();
    ctx.terrain.generate();
    this.scene.add(ctx.terrain.group);

    await onStep('하늘과 물을 채우는 중…');
    ctx.sky = new Sky(this.scene);
    ctx.sky.buildClouds();
    ctx.water = new Water(this.scene, ctx.terrain);
    ctx.grass = new Grass(ctx.terrain, q);
    this.scene.add(ctx.grass.mesh);

    await onStep('숲을 기르는 중…');
    ctx.particles = new Particles(q);
    this.scene.add(ctx.particles.group);
    ctx.lights = new LightPool(this.scene, 6);
    ctx.fx = new Effects(this.scene);
    ctx.fire = new FireGrid();
    ctx.world = new World();
    ctx.veg = new Vegetation();
    ctx.veg.generate();
    this.scene.add(ctx.veg.group);
    ctx.weather = new Weather(this.scene);

    await onStep('마법사를 깨우는 중…');
    const start = new THREE.Vector3(P.temple.x, 0, P.temple.z - 4);
    start.y = ctx.terrain.heightAt(start.x, start.z) + 0.2;
    ctx.cam = new CameraRig(this.camera);
    ctx.player = new Player(start);
    ctx.cam.snapTo(start, Math.PI);

    await onStep('세계에 숨결을 불어넣는 중…');
    ctx.interact = new Interactions();
    ctx.props = new Props();
    ctx.skills = new SkillSystem();
    ctx.enemies = new EnemyManager();
    ctx.npcs = new NPCs();
    ctx.quests = new Quests();
    ctx.audio = new AudioSys();
    ctx.ui = new UI(this);
    ctx.ui.respawn.copy(start);

    if (this.settings.bloom && q !== 'low') {
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 2 }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.5, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
    // warm up shader programs so the first frames don't stutter
    this.renderer.compile(this.scene, this.camera);
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 1 / 20);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.tick(dt);
    this.render();
    ctx.input.endFrame();
  };

  tick(dt: number) {
    const playing = this.mode === 'playing';
    if (playing) {
      ctx.time += dt;
      ctx.player.update(dt);
      ctx.skills.update(dt);
      ctx.props.update(dt);
      ctx.interact.update(dt);
      ctx.enemies.update(dt * ctx.slowmo);
      ctx.npcs.update(dt * ctx.slowmo);
      ctx.quests.update(dt);
      for (const u of this.updaters) u(dt);
      ctx.world.update(dt);
      ctx.fire.update(dt);
      ctx.veg.update(dt);
      ctx.weather.update(dt);
      physics.step(dt);
    }
    if (this.mode === 'title') {
      this.titleT += dt * 0.05;
      const c = new THREE.Vector3(P.temple.x, 0, P.temple.z - 40);
      const cy = ctx.terrain.heightAt(c.x, c.z);
      this.camera.position.set(c.x + Math.cos(this.titleT) * 95, cy + 42, c.z + Math.sin(this.titleT) * 95);
      this.camera.lookAt(c.x, cy + 12, c.z);
      ctx.player.char.update(dt);
    } else {
      const aiming = playing && ctx.input.isDown('Mouse2');
      ctx.cam.update(playing ? dt : 0, ctx.player.pos, aiming);
    }
    ctx.sky.update(dt, this.mode === 'title' ? this.camera.position : ctx.player.pos, this.camera, playing || this.mode === 'title' ? 1 : 0);
    this.renderer.toneMappingExposure = 1 + ctx.sky.night * 0.25;
    ctx.water.update(dt, ctx.sky, this.camera);
    ctx.grass.update(dt, this.camera.position, ctx.player.pos, ctx.wind, ctx.sky.night);
    ctx.particles.update(playing || this.mode === 'title' ? dt * (0.35 + ctx.slowmo * 0.65) : 0);
    ctx.lights.update(playing ? dt : 0);
    ctx.fx.update(playing ? dt : 0);
    culler.update(dt, this.camera.position);
    ctx.ui.update(dt);
    ctx.audio.update(dt);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
