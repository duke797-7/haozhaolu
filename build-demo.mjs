// 產生體驗版：同一套畫面，資料改放瀏覽器記憶體，輸出成單一 HTML。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodePaths = (process.env.NODE_PATH || '').split(':').filter(Boolean);
const esbuild = require(require.resolve('esbuild', { paths: [process.cwd(), ...nodePaths] }));

const OUT = process.argv[2] || 'demo-dist/預購小舖體驗版.html';
const swap = {
  name: 'demo-swap',
  setup(build) {
    build.onResolve({ filter: /\/(api|router)$/ }, (args) => {
      const name = path.basename(args.path);
      return { path: path.resolve(`src/demo/${name}.ts`) };
    });
  },
};

const result = await esbuild.build({
  entryPoints: ['src/demo/main.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  charset: 'utf8',
  write: false,
  outdir: 'demo-tmp',
  nodePaths,
  plugins: [swap],
  define: { 'process.env.NODE_ENV': '"production"' },
});

const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text.replaceAll('</script', '<\\/script');
const css = result.outputFiles.find((f) => f.path.endsWith('.css')).text;
const extra = readFileSync('src/demo/demo.css', 'utf8');

const html = `<title>預購小舖體驗版</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700;900&display=swap">
<style>${css}
${extra}</style>
<div id="root"></div>
<script>${js}</script>
`;

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`體驗版完成：${OUT}，${(html.length / 1024).toFixed(0)} KB`);
