import * as THREE from 'three';
import { ctx } from '../core/ctx';

interface Transient {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update?: (k: number, dt: number) => void;
  dispose?: () => void;
}

function runeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  g.strokeStyle = 'white';
  g.fillStyle = 'white';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 118, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(0, 0, 100, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 58, 0, Math.PI * 2);
  g.stroke();
  // star
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i * 4 * Math.PI) / 6 - Math.PI / 2;
    const r = 96;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.stroke();
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i * 4 * Math.PI) / 6 + Math.PI / 6;
    const r = 96;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.stroke();
  // glyphs
  g.font = 'bold 16px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.fillText(glyphs[i], 0, -109);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialTexture(stops: [number, string][], size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Irregular scorch mark for fire impacts. */
function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 34;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 10 + rnd() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

const domeVert = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const domeFrag = `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(uColor * (0.4 + f * 1.8), (0.08 + f) * uOpacity); }`;

export class Effects {
  private items: Transient[] = [];
  runeTex = runeTexture();
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
  private sphereGeo = new THREE.IcosahedronGeometry(1, 2);
  private planeGeo = new THREE.PlaneGeometry(1, 1);
  private flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private shockTex = radialTexture([[0, 'rgba(255,255,255,0)'], [0.62, 'rgba(255,255,255,0.05)'], [0.86, 'rgba(255,255,255,0.9)'], [0.93, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  private flareTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.85)'], [0.45, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]);
  private scorchTex = scorchTexture();
  private domeGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);

  constructor(private scene: THREE.Scene) {}

  add(obj: THREE.Object3D, life: number, update?: Transient['update'], dispose?: () => void) {
    this.scene.add(obj);
    this.items.push({ obj, t: 0, life, update, dispose });
  }

  /** Jagged lightning bolt between two points. */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, life = 0.22, width = 0.35, branches = true) {
    const pts = this.jagged(from, to, 1.4);
    const group = new THREE.Group();
    const core = this.ribbon(pts, width * 0.35, new THREE.Color(color).multiplyScalar(3), 1);
    const glow = this.ribbon(pts, width * 1.6, new THREE.Color(color), 0.45);
    group.add(glow, core);
    if (branches) {
      for (let i = 2; i < pts.length - 2; i += 3) {
        if (Math.random() < 0.5) continue;
        const dir = to.clone().sub(from).normalize();
        const end = pts[i].clone().add(dir.multiplyScalar(2 + Math.random() * 3)).add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4));
        const bp = this.jagged(pts[i], end, 0.9);
        group.add(this.ribbon(bp, width * 0.25, new THREE.Color(color).multiplyScalar(2), 0.8));
      }
    }
    this.add(
      group,
      life,
      (k) => {
        const flicker = Math.random() < 0.3 ? 0.3 : 1;
        group.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m) m.opacity = (1 - k) * flicker * (m.userData.base ?? 1);
        });
      },
      () => group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      }),
    );
  }

  private jagged(from: THREE.Vector3, to: THREE.Vector3, step: number) {
    const len = from.distanceTo(to);
    const n = Math.max(2, Math.ceil(len / step));
    const dir = to.clone().sub(from);
    const perpA = new THREE.Vector3(1, 0, 0).cross(dir).normalize();
    if (perpA.lengthSq() < 0.1) perpA.set(0, 0, 1);
    const perpB = dir.clone().cross(perpA).normalize();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = from.clone().lerp(to, t);
      if (i > 0 && i < n) {
        const amp = Math.sin(t * Math.PI) * Math.min(1.4, len * 0.06);
        p.addScaledVector(perpA, (Math.random() - 0.5) * 2 * amp).addScaledVector(perpB, (Math.random() - 0.5) * 2 * amp);
      }
      pts.push(p);
    }
    return pts;
  }

  /** Camera-facing strip through points. */
  private ribbon(pts: THREE.Vector3[], width: number, color: THREE.Color, opacity: number) {
    const cam = ctx.camera.position;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const prev = pts[Math.max(i - 1, 0)];
      const tangent = next.clone().sub(prev).normalize();
      const toCam = cam.clone().sub(p).normalize();
      const side = tangent.clone().cross(toCam).normalize().multiplyScalar(width * 0.5);
      pos.push(p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z);
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    mat.userData.base = opacity;
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
  }

  /** Expanding ground shockwave: a soft bright rim that races outward. */
  ring(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius: number, life = 0.5) {
    const mat = new THREE.MeshBasicMaterial({ map: this.shockTex, color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const m = new THREE.Mesh(this.flatGeo, mat);
    m.position.copy(pos).add(new THREE.Vector3(0, 0.2, 0));
    this.add(m, life, (k) => {
      m.scale.setScalar(0.4 + radius * 2 * (1 - Math.pow(1 - k, 2.2)));
      mat.opacity = Math.pow(1 - k, 1.3);
    }, () => mat.dispose());
  }

  /** Thin crisp ring (UI-like accents). */
  thinRing(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius: number, life = 0.5) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
    this.add(m, life, (k) => {
      m.scale.setScalar(0.2 + radius * Math.sqrt(k));
      mat.opacity = 1 - k;
    }, () => mat.dispose());
  }

  /** Expanding hemispherical shock dome with a bright fresnel rim. */
  dome(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius: number, life = 0.45) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
      vertexShader: domeVert,
      fragmentShader: domeFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.domeGeo, mat);
    m.position.copy(pos);
    this.add(m, life, (k) => {
      const e = 1 - Math.pow(1 - k, 2.5);
      m.scale.set(radius * e + 0.3, radius * 0.7 * e + 0.3, radius * e + 0.3);
      mat.uniforms.uOpacity.value = 1 - k;
    }, () => mat.dispose());
  }

  /** Big soft glow burst (impact flash). */
  flare(pos: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life = 0.25) {
    const mat = new THREE.SpriteMaterial({ map: this.flareTex, color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(pos);
    this.add(sp, life, (k) => {
      sp.scale.setScalar(size * (0.6 + k * 0.8));
      mat.opacity = Math.pow(1 - k, 1.5);
    }, () => mat.dispose());
  }

  /** Burn mark / frost patch on the ground that fades out slowly. */
  decal(pos: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life = 8, additive = false) {
    const mat = new THREE.MeshBasicMaterial({ map: this.scorchTex, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -3, fog: true });
    const m = new THREE.Mesh(this.flatGeo, mat);
    m.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
    m.rotation.y = Math.random() * Math.PI * 2;
    m.scale.setScalar(size);
    this.add(m, life, (k) => {
      mat.opacity = k < 0.05 ? k / 0.05 : 1 - Math.max(0, k - 0.6) / 0.4;
    }, () => mat.dispose());
  }

  /** Rising spiral ribbons of wind around a point. */
  windSwirl(pos: THREE.Vector3, radius: number, level = 1) {
    const arms = 3 + level;
    for (let a = 0; a < arms; a++) {
      const pts: THREE.Vector3[] = [];
      const phase = (a / arms) * Math.PI * 2;
      for (let i = 0; i <= 26; i++) {
        const t = i / 26;
        const ang = phase + t * Math.PI * 1.6;
        const r = 1.2 + t * radius * 0.55;
        pts.push(new THREE.Vector3(Math.cos(ang) * r, 0.3 + t * (2 + level), Math.sin(ang) * r));
      }
      const rib = this.ribbon(pts, 0.35 + level * 0.1, new THREE.Color('#dffff2').multiplyScalar(1.3), 0.7);
      const g = new THREE.Group();
      g.add(rib);
      g.position.copy(pos);
      const mat = rib.material as THREE.MeshBasicMaterial;
      this.add(g, 0.7, (k, dt) => {
        g.rotation.y += dt * 5;
        g.scale.setScalar(0.5 + k * 1.1);
        mat.opacity = 0.7 * (1 - k);
      }, () => {
        rib.geometry.dispose();
        mat.dispose();
      });
    }
  }

  /** Expanding translucent sphere (explosions, bursts). */
  sphere(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius: number, life = 0.4) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(this.sphereGeo, mat);
    m.position.copy(pos);
    this.add(m, life, (k) => {
      m.scale.setScalar(0.3 + radius * Math.pow(k, 0.5));
      mat.opacity = (1 - k) * 0.7;
    }, () => mat.dispose());
  }

  /** Rotating rune circle (spell casting). */
  rune(pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life = 0.6, follow?: () => THREE.Vector3) {
    const mat = new THREE.MeshBasicMaterial({ map: this.runeTex, color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.planeGeo, mat);
    m.position.copy(pos);
    m.lookAt(pos.clone().add(normal));
    this.add(m, life, (k, dt) => {
      if (follow) m.position.copy(follow());
      m.rotateZ(dt * 3);
      const s = size * (k < 0.15 ? k / 0.15 : 1);
      m.scale.setScalar(s);
      mat.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
    }, () => mat.dispose());
    return m;
  }

  update(dt: number) {
    for (const it of this.items) {
      it.t += dt;
      const k = Math.min(1, it.t / it.life);
      it.update?.(k, dt);
    }
    const alive: Transient[] = [];
    for (const it of this.items) {
      if (it.t >= it.life) {
        it.obj.removeFromParent();
        it.dispose?.();
      } else alive.push(it);
    }
    this.items = alive;
  }
}
