// 產生 PWA 圖示：藍底上一條貼歪的黃色封箱膠帶，呼應顧客頁的結單膠帶。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/npm-tools/');
const sharp = require('sharp');
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');

const art = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${s}" height="${s}">
  <rect width="512" height="512" fill="#10234f"/>
  <g transform="rotate(-8 256 256)">
    <rect x="-40" y="186" width="592" height="140" fill="#ffd23f"/>
    <rect x="-40" y="186" width="592" height="5" fill="#e9b800"/>
    <rect x="-40" y="321" width="592" height="5" fill="#e9b800"/>
    <g stroke="#ffffff" stroke-opacity=".28" stroke-width="7">
      ${Array.from({ length: 16 }, (_, i) => `<path d="M${-30 + i * 40} 191V321"/>`).join('')}
    </g>
    <path d="M196 256l44 44 84-92" fill="none" stroke="#10234f" stroke-width="34" stroke-linecap="square"/>
  </g>
</svg>`;

for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['icon-maskable-512', 512], ['apple-touch-icon', 180]]) {
  await sharp(Buffer.from(art(size))).png().toFile(`${out}/${name}.png`);
}
console.log('icons done');
