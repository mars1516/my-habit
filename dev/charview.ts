// Dev-only character viewer: /dev/charview.html?anims=Idle,Running_A&t=0.3&chars=mage,knight
import * as THREE from 'three';
import { assets, type CharacterKey } from '../src/core/Assets';
import { Character } from '../src/player/Character';
const q = new URLSearchParams(location.search);
await assets.load('/assets/', () => {});
const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
r.outputColorSpace = THREE.SRGBColorSpace;
r.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8ab');
scene.add(new THREE.HemisphereLight('#fff', '#665', 1.6));
const sun = new THREE.DirectionalLight('#fff', 2.2);
sun.position.set(3, 6, 5);
scene.add(sun);
const grid = new THREE.GridHelper(20, 20);
scene.add(grid);
const chars = (q.get('chars') ?? 'mage,knight,skeleton_minion').split(',') as CharacterKey[];
const anims = (q.get('anims') ?? 'Idle').split(',');
const list: Character[] = [];
let x = 0;
const cols = chars.length * anims.length;
for (const a of anims) for (const c of chars) {
  const ch = new Character(c, c.startsWith('skeleton') ? 'skeleton' : 'adventurer');
  ch.hide(['1H_Sword', '1H_Sword_Offhand', '2H_Sword', 'Round_Shield', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '1H_Axe', '1H_Axe_Offhand', '2H_Axe', 'Mug', '1H_Crossbow', '2H_Crossbow', 'Throwable', 'Knife', 'Knife_Offhand', 'Barbarian_Round_Shield']);
  ch.root.position.x = (x - (cols - 1) / 2) * 1.3;
  ch.root.rotation.y = Number(q.get('yaw') ?? 0);
  if (!q.has('noanim')) ch.play(a, { fade: 0 });
  ch.update(Number(q.get('t') ?? 0));
  scene.add(ch.root);
  list.push(ch);
  x++;
}
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
cam.position.set(0, 1.0, Math.max(5, cols * 1.3));
cam.lookAt(0, 0.85, 0);
r.render(scene, cam);
(window as any).__ready = true;
(window as any).__step = (dt: number) => { for (const c of list) c.update(dt); r.render(scene, cam); };
(window as any).__footSpeed = (name: string) => {
  const ch = new Character('mage', 'adventurer');
  scene.add(ch.root);
  ch.play(name, { fade: 0 });
  const clip = assets.clips.adventurer.find((c) => c.name === name)!;
  const foot = ch.bone('foot.l')!, foot2 = ch.bone('foot.r')!;
  const N = 120, dt = clip.duration / N;
  const zs: number[] = [], ys: number[] = [], z2: number[] = [], y2: number[] = [];
  const v = new THREE.Vector3();
  ch.update(0);
  for (let i = 0; i <= N; i++) {
    ch.root.updateMatrixWorld(true);
    foot.getWorldPosition(v); zs.push(v.z); ys.push(v.y);
    foot2.getWorldPosition(v); z2.push(v.z); y2.push(v.y);
    ch.update(dt);
  }
  // stance = the lowest 35% of foot heights; speed = mean backward z velocity during stance
  const sp = (z: number[], y: number[]) => {
    const sorted = [...y].sort((a, b) => a - b);
    const th = sorted[Math.floor(sorted.length * 0.35)];
    let s = 0, n = 0;
    for (let i = 1; i < z.length; i++) if (y[i] <= th && y[i - 1] <= th) { s += (z[i - 1] - z[i]) / dt; n++; }
    return n ? s / n : 0;
  };
  scene.remove(ch.root);
  return { name, dur: clip.duration, speed: (sp(zs, ys) + sp(z2, y2)) / 2, minY: Math.min(...ys, ...y2) };
};
