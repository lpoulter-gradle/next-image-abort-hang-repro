// Generates public/hero.webp (synthetic 2560x1440) so the optimizer has real work to do.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const w = 2560;
const h = 1440;
const buf = Buffer.alloc(w * h * 3);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    buf[i] = (x * 255) / w;
    buf[i + 1] = (y * 255) / h;
    buf[i + 2] = (x ^ y) & 255;
  }
}
mkdirSync('public', { recursive: true });
const info = await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
  .webp({ quality: 90 })
  .toFile('public/hero.webp');
console.log('public/hero.webp', info.size, 'bytes');
