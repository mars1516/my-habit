import * as THREE from 'three';
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Minimal PNG decoder (8-bit grey/RGB/RGBA/palette, non-interlaced).
 * Embedded glTF images are normally decoded through blob: URLs, which sandboxed
 * hosts with a strict CSP refuse — the model then renders plain white. Decoding the
 * bytes ourselves and uploading a DataTexture works everywhere.
 */
export function decodePng(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const tag = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      depth = bytes[p + 16];
      type = bytes[p + 17];
      interlace = bytes[p + 20];
    } else if (tag === 'PLTE') palette = data;
    else if (tag === 'tRNS') trns = data;
    else if (tag === 'IDAT') idat.push(data);
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported png (depth ${depth}, interlace ${interlace})`);
  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) {
    z.set(c, o);
    o += c.length;
  }
  const raw = unzlibSync(z);
  const ch = type === 6 ? 4 : type === 2 ? 3 : type === 4 ? 2 : 1;
  const stride = w * ch;
  const px = new Uint8Array(w * h * ch);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v;
    }
    prev = cur;
  }
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    let r: number, g: number, b: number, a = 255;
    if (type === 6) [r, g, b, a] = [px[j], px[j + 1], px[j + 2], px[j + 3]];
    else if (type === 2) [r, g, b] = [px[j], px[j + 1], px[j + 2]];
    else if (type === 4) [r, g, b, a] = [px[j], px[j], px[j], px[j + 1]];
    else if (type === 3 && palette) {
      const k = px[j];
      [r, g, b] = [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]];
      if (trns && k < trns.length) a = trns[k];
    } else [r, g, b] = [px[j], px[j], px[j]];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return { width: w, height: h, data: out };
}

/** GLTFLoader plugin: decode embedded PNG textures without blob URLs. */
export class PngTexturePlugin implements GLTFLoaderPlugin {
  name = 'png_datatexture';
  private cache = new Map<number, Promise<THREE.Texture>>();
  constructor(private parser: GLTFParser) {}

  loadTexture(textureIndex: number) {
    const json = this.parser.json;
    const tex = json.textures[textureIndex];
    const img = json.images?.[tex.source];
    if (!img || img.bufferView === undefined || (img.mimeType && img.mimeType !== 'image/png')) return null;
    let pr = this.cache.get(textureIndex);
    if (pr) return pr;
    pr = this.parser.getDependency('bufferView', img.bufferView).then((buf: ArrayBuffer) => {
      const png = decodePng(new Uint8Array(buf));
      const t = new THREE.DataTexture(png.data, png.width, png.height, THREE.RGBAFormat);
      t.flipY = false;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      const sampler = json.samplers?.[tex.sampler ?? -1] ?? {};
      const wrap = (m?: number) =>
        m === 33071 ? THREE.ClampToEdgeWrapping : m === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      t.wrapS = wrap(sampler.wrapS);
      t.wrapT = wrap(sampler.wrapT);
      if (sampler.magFilter === 9728) t.magFilter = THREE.NearestFilter;
      t.name = img.name ?? '';
      t.needsUpdate = true;
      this.parser.associations.set(t, { textures: textureIndex });
      return t;
    });
    this.cache.set(textureIndex, pr);
    return pr;
  }
}
