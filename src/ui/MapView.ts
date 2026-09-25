import { ctx } from '../core/ctx';
import { HALF, WORLD_SIZE, RES, POIS, waterLevelAt, type Poi } from '../world/WorldGen';
import { ELEMENT_INFO } from '../magic/Elements';

const FOG_RES = 128;
const FOG_CELL = WORLD_SIZE / FOG_RES;

export class MapView {
  image: HTMLCanvasElement;
  fog = new Uint8Array(FOG_RES * FOG_RES);
  private fogCanvas: HTMLCanvasElement;
  private fogDirty = true;

  constructor() {
    this.image = document.createElement('canvas');
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = FOG_RES;
    this.buildImage();
  }

  private buildImage() {
    const N = RES + 1;
    const src = document.createElement('canvas');
    src.width = src.height = N;
    const g = src.getContext('2d')!;
    const img = g.createImageData(N, N);
    const t = ctx.terrain;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        const x = -HALF + ix * 2, z = -HALF + iz * 2;
        const h = t.heights[i];
        let r = Math.sqrt(t.colors[i * 3]) * 255, gg = Math.sqrt(t.colors[i * 3 + 1]) * 255, b = Math.sqrt(t.colors[i * 3 + 2]) * 255;
        // hillshade from the NW
        const hl = t.heights[iz * N + Math.max(0, ix - 1)], hu = t.heights[Math.max(0, iz - 1) * N + ix];
        const shade = 1 + ((hl - h) * 0.6 + (hu - h) * 0.6) * 0.06;
        r *= shade; gg *= shade; b *= shade;
        // contour lines
        if (Math.floor(h / 15) !== Math.floor(hl / 15) || Math.floor(h / 15) !== Math.floor(hu / 15)) {
          r *= 0.82; gg *= 0.82; b *= 0.8;
        }
        const wl = waterLevelAt(x, z);
        if (h < wl) {
          const depth = Math.min(1, (wl - h) / 12);
          r = 90 - depth * 55; gg = 190 - depth * 90; b = 210 - depth * 40;
          if (wl - h < 0.8) { r = 190; gg = 230; b = 235; }
        }
        // parchment tone
        r = r * 0.86 + 244 * 0.14; gg = gg * 0.86 + 232 * 0.14; b = b * 0.86 + 200 * 0.14;
        img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.image.width = this.image.height = 1024;
    const g2 = this.image.getContext('2d')!;
    g2.imageSmoothingEnabled = true;
    g2.drawImage(src, 0, 0, 1024, 1024);
  }

  /** Reveal a circle of the fog of war. */
  reveal(x: number, z: number, r: number) {
    const cx = (x + HALF) / FOG_CELL, cz = (z + HALF) / FOG_CELL, cr = r / FOG_CELL;
    let changed = false;
    for (let j = Math.floor(cz - cr); j <= Math.ceil(cz + cr); j++)
      for (let i = Math.floor(cx - cr); i <= Math.ceil(cx + cr); i++) {
        if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) continue;
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz);
        if (d > cr) continue;
        const k = j * FOG_RES + i;
        if (!this.fog[k]) {
          this.fog[k] = 1;
          changed = true;
        }
      }
    if (changed) this.fogDirty = true;
    return changed;
  }

  revealed(x: number, z: number) {
    const i = Math.floor((x + HALF) / FOG_CELL), j = Math.floor((z + HALF) / FOG_CELL);
    if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) return false;
    return this.fog[j * FOG_RES + i] === 1;
  }

  fogToString() {
    let s = '';
    for (let i = 0; i < this.fog.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte |= (this.fog[i + b] ? 1 : 0) << b;
      s += String.fromCharCode(byte);
    }
    return btoa(s);
  }

  fogFromString(str: string) {
    try {
      const s = atob(str);
      for (let i = 0; i < s.length; i++) {
        const byte = s.charCodeAt(i);
        for (let b = 0; b < 8; b++) this.fog[i * 8 + b] = (byte >> b) & 1;
      }
      this.fogDirty = true;
    } catch {
      /* ignore */
    }
  }

  private updateFog() {
    if (!this.fogDirty) return;
    this.fogDirty = false;
    const g = this.fogCanvas.getContext('2d')!;
    const img = g.createImageData(FOG_RES, FOG_RES);
    for (let i = 0; i < this.fog.length; i++) {
      const n = ((i * 2654435761) >>> 24) / 255;
      img.data[i * 4] = 205 + n * 20;
      img.data[i * 4 + 1] = 196 + n * 18;
      img.data[i * 4 + 2] = 170 + n * 15;
      img.data[i * 4 + 3] = this.fog[i] ? 0 : 238;
    }
    g.putImageData(img, 0, 0);
  }

  /** Draws the map region into a 2D context; transform maps world metres to pixels. */
  private drawWorld(g: CanvasRenderingContext2D) {
    this.updateFog();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.image, -HALF, -HALF, WORLD_SIZE, WORLD_SIZE);
    g.drawImage(this.fogCanvas, -HALF, -HALF, WORLD_SIZE, WORLD_SIZE);
  }

  poiVisible(p: Poi) {
    return this.revealed(p.x, p.z) || ctx.save.has('wp:' + p.id) || ctx.save.has('tower:' + p.id);
  }

  drawIcons(g: CanvasRenderingContext2D, scale: number, rotate = 0) {
    const s = 1 / scale; // pixel-size helpers in world units
    for (const p of POIS) {
      if (!this.poiVisible(p)) continue;
      g.save();
      g.translate(p.x, p.z);
      g.rotate(rotate);
      g.scale(s, s);
      drawPoiIcon(g, p);
      g.restore();
    }
    // quest markers
    for (const m of ctx.quests.markers()) {
      g.save();
      g.translate(m.pos.x, m.pos.z);
      g.rotate(rotate);
      g.scale(s, s);
      const pulse = 1 + Math.sin(ctx.time * 4) * 0.15;
      g.beginPath();
      g.arc(0, 0, 9 * pulse, 0, Math.PI * 2);
      g.strokeStyle = m.main ? '#ffcf4a' : '#7ef0c0';
      g.lineWidth = 2.5;
      g.stroke();
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(5, 0);
      g.lineTo(0, 6);
      g.lineTo(-5, 0);
      g.closePath();
      g.fillStyle = m.main ? '#ffcf4a' : '#7ef0c0';
      g.fill();
      g.restore();
    }
  }

  drawPlayer(g: CanvasRenderingContext2D, scale: number, yaw: number) {
    const p = ctx.player.pos;
    g.save();
    g.translate(p.x, p.z);
    g.scale(1 / scale, 1 / scale);
    g.rotate(-yaw + Math.PI);
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.fillStyle = '#fff';
    g.strokeStyle = '#1b1d2a';
    g.lineWidth = 2;
    g.fill();
    g.stroke();
    g.restore();
  }

  drawMinimap(canvas: HTMLCanvasElement, yaw: number) {
    const g = canvas.getContext('2d')!;
    const w = canvas.width;
    const radius = 110; // metres shown
    const scale = w / (radius * 2);
    g.clearRect(0, 0, w, w);
    g.save();
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgb(64,118,174)';
    g.fillRect(0, 0, w, w);
    g.translate(w / 2, w / 2);
    g.rotate(yaw - Math.PI);
    g.scale(scale, scale);
    const p = ctx.player.pos;
    g.translate(-p.x, -p.z);
    this.drawWorld(g);
    this.drawIcons(g, scale, -(yaw - Math.PI));
    g.restore();
    // player arrow always points up
    g.save();
    g.translate(w / 2, w / 2);
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fillStyle = '#fff';
    g.strokeStyle = '#1b1d2a';
    g.lineWidth = 2;
    g.fill();
    g.stroke();
    g.restore();
    // north indicator
    const na = yaw - Math.PI;
    const nx = w / 2 + Math.sin(na) * (w / 2 - 12), ny = w / 2 - Math.cos(na) * (w / 2 - 12);
    g.fillStyle = '#e9c979';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny);
  }

  drawFull(canvas: HTMLCanvasElement, view: { cx: number; cz: number; zoom: number }) {
    const g = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    g.fillStyle = 'rgb(64,118,174)';
    g.fillRect(0, 0, w, h);
    const scale = (Math.min(w, h) / WORLD_SIZE) * view.zoom;
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(scale, scale);
    g.translate(-view.cx, -view.cz);
    this.drawWorld(g);
    this.drawIcons(g, scale);
    this.drawPlayer(g, scale, ctx.cam.yaw);
    g.restore();
    return scale;
  }

  worldFromScreen(canvas: HTMLCanvasElement, view: { cx: number; cz: number; zoom: number }, sx: number, sy: number) {
    const scale = (Math.min(canvas.width, canvas.height) / WORLD_SIZE) * view.zoom;
    return { x: (sx - canvas.width / 2) / scale + view.cx, z: (sy - canvas.height / 2) / scale + view.cz };
  }
}

function drawPoiIcon(g: CanvasRenderingContext2D, p: Poi) {
  const S = ctx.save;
  g.lineWidth = 2;
  g.strokeStyle = '#1b1d2a';
  switch (p.kind) {
    case 'waypoint': {
      const on = S.has('wp:' + p.id);
      g.beginPath();
      g.moveTo(0, -9);
      g.lineTo(7, 0);
      g.lineTo(0, 9);
      g.lineTo(-7, 0);
      g.closePath();
      g.fillStyle = on ? '#4ab8ff' : '#8a8f98';
      g.fill();
      g.stroke();
      break;
    }
    case 'tower': {
      const on = S.has('tower:' + p.id);
      g.beginPath();
      g.moveTo(0, -11);
      g.lineTo(7, 8);
      g.lineTo(-7, 8);
      g.closePath();
      g.fillStyle = on ? '#e9c979' : '#8a8f98';
      g.fill();
      g.stroke();
      break;
    }
    case 'shrine': {
      const el = p.element!;
      const lit = S.has('beacon:' + el);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = i % 2 ? 5 : 11;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fillStyle = ELEMENT_INFO[el].color;
      g.globalAlpha = lit ? 1 : 0.75;
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
      if (lit) {
        g.beginPath();
        g.arc(0, 0, 14, 0, Math.PI * 2);
        g.strokeStyle = ELEMENT_INFO[el].color;
        g.stroke();
      }
      break;
    }
    case 'statue':
      g.beginPath();
      g.arc(0, -4, 4, 0, Math.PI * 2);
      g.moveTo(-6, 8);
      g.lineTo(0, -1);
      g.lineTo(6, 8);
      g.closePath();
      g.fillStyle = '#fff2c0';
      g.fill();
      g.stroke();
      break;
    case 'camp': {
      const cleared = S.has('camp:' + p.id);
      g.beginPath();
      g.arc(0, -1, 7, 0, Math.PI * 2);
      g.fillStyle = cleared ? '#8a8f98' : '#e0564a';
      g.fill();
      g.stroke();
      g.fillStyle = '#1b1d2a';
      g.fillRect(-3.5, -3, 2.5, 2.5);
      g.fillRect(1, -3, 2.5, 2.5);
      g.fillRect(-2.5, 2.5, 5, 1.5);
      break;
    }
    case 'village':
      g.beginPath();
      g.moveTo(-9, 1);
      g.lineTo(0, -9);
      g.lineTo(9, 1);
      g.lineTo(9, 9);
      g.lineTo(-9, 9);
      g.closePath();
      g.fillStyle = '#f0b060';
      g.fill();
      g.stroke();
      break;
    case 'altar':
      g.beginPath();
      g.arc(0, 0, 11, 0, Math.PI * 2);
      g.fillStyle = S.has('boss:defeated') ? '#e9c979' : '#6a3a8a';
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 5, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      break;
    case 'temple':
      g.fillStyle = '#c8b8a0';
      g.fillRect(-8, -6, 16, 12);
      g.strokeRect(-8, -6, 16, 12);
      break;
    case 'braziers':
      g.beginPath();
      g.arc(0, 0, 5, 0, Math.PI * 2);
      g.fillStyle = S.has('sig:' + p.id) ? '#ff9a40' : '#8a7060';
      g.fill();
      g.stroke();
      break;
    default:
      break;
  }
}
