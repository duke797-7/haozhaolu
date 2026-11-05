// 建置網站：輸出到 dist/，把 dist/ 裡的檔案上傳到任何靜態網站空間即可。
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodePaths = (process.env.NODE_PATH || '').split(':').filter(Boolean);
const esbuild = require(require.resolve('esbuild', { paths: [process.cwd(), ...nodePaths] }));

const DIST = 'dist';
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const result = await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  charset: 'utf8',
  entryNames: 'app-[hash]',
  outdir: DIST,
  metafile: true,
  nodePaths,
  define: { 'process.env.NODE_ENV': '"production"' },
});

const outputs = Object.keys(result.metafile.outputs).map((p) => path.basename(p));
const js = outputs.find((f) => f.endsWith('.js'));
const css = outputs.find((f) => f.endsWith('.css'));

cpSync('public', DIST, { recursive: true });

const html = readFileSync(`${DIST}/index.html`, 'utf8').replace('__CSS__', css).replace('__JS__', js);
writeFileSync(`${DIST}/index.html`, html);

const version = createHash('sha256').update(js + css).digest('hex').slice(0, 10);
const shell = ['./', './index.html', `./${js}`, `./${css}`, './config.js', './manifest.webmanifest', './icons/icon-192.png'];
const sw = readFileSync(`${DIST}/sw.js`, 'utf8')
  .replace('__VERSION__', version)
  .replace('__SHELL__', JSON.stringify(shell));
writeFileSync(`${DIST}/sw.js`, sw);

const kb = (f) => `${(statSync(`${DIST}/${f}`).size / 1024).toFixed(0)} KB`;
console.log(`建置完成：${js} ${kb(js)}，${css} ${kb(css)}，共 ${readdirSync(DIST).length} 個項目`);
