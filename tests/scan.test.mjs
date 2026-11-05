// 拍照辨識後端測試：以假的 Supabase 與 Gemini 回應，驗證權限、錯誤處理與資料清理。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/npm-tools/');
const esbuild = require('esbuild');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let handler;
const env = { SUPABASE_URL: 'https://example.supabase.co', GEMINI_API_KEY: 'test-key' };
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } };

const built = await esbuild.build({
  entryPoints: [path.join(ROOT, 'supabase/functions/scan-product/index.ts')],
  bundle: true, write: false, format: 'esm', target: 'es2022',
});
await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

let passed = 0;
const failures = [];
const ok = (c, n, x) => { if (c) { passed += 1; console.log(`  通過  ${n}`); } else { failures.push(n); console.log(`  失敗  ${n}`, x ?? ''); } };

let admin = true;
let gemini = () => new Response('{}');
let geminiCalls = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/rest/v1/rpc/is_admin')) return new Response(JSON.stringify(admin));
  geminiCalls.push({ url: String(url), init });
  return gemini();
};

const auth = { authorization: 'Bearer user-token', apikey: 'pub', 'content-type': 'application/json' };
const post = (body = { image: 'aGVsbG8=', mime: 'image/jpeg' }, headers = auth) =>
  handler(new Request('https://x/', { method: 'POST', headers, body: JSON.stringify(body) }));
const ai = (payload, status = 200) => () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status });

{
  const r = await handler(new Request('https://x/', { method: 'OPTIONS' }));
  ok(r.status === 200 && r.headers.get('access-control-allow-headers').includes('apikey'), '瀏覽器預檢請求放行');
  ok((await handler(new Request('https://x/'))).status === 405, 'GET 不接受');
}
{
  ok((await post(undefined, { 'content-type': 'application/json' })).status === 403, '沒登入被拒絕');
  admin = false; geminiCalls = [];
  ok((await post()).status === 403 && geminiCalls.length === 0, '非管理員被拒絕，也不會呼叫 Gemini');
  admin = true;
}
{
  delete env.GEMINI_API_KEY;
  const r = await post();
  ok(r.status === 503 && (await r.json()).message.includes('尚未開通'), '還沒設定金鑰時明確提示');
  env.GEMINI_API_KEY = 'test-key';
}
{
  ok((await post({ image: 'x', mime: 'application/pdf' })).status === 400, '不接受非圖片格式');
  ok((await post({ image: 'a'.repeat(8_000_001), mime: 'image/jpeg' })).status === 413, '照片過大被拒絕');
}
{
  geminiCalls = [];
  gemini = ai({ name: ' 燙金紅包袋 ', description: '加厚紙材', variants: [
    { label: '長款', price: 120 }, { label: '方款', price: null }, { label: '猜的', price: 12.5 }, { label: '負數', price: -1 }, { label: '   ', price: 1 },
  ] });
  const r = await post();
  const d = await r.json();
  ok(r.status === 200 && d.name === '燙金紅包袋', '成功辨識並整理名稱', d);
  ok(d.variants.length === 4 && d.variants[0].price === 120, '保留有效規格，移除空白規格', d.variants);
  ok(d.variants[1].price === null && d.variants[2].price === null && d.variants[3].price === null, '不確定或異常的售價一律留空', d.variants);
  const call = geminiCalls[0];
  const sent = JSON.parse(call.init.body);
  ok(call.url.includes('gemini-3.1-flash-lite:generateContent'), '使用指定模型');
  ok(call.init.headers['x-goog-api-key'] === 'test-key' && !call.url.includes('test-key'), '金鑰放在標頭，不放網址');
  ok(sent.contents[0].parts[1].inlineData.data === 'aGVsbG8=', '照片有送出');
}
{
  env.GEMINI_MODEL = 'gemini-3.5-flash-lite'; geminiCalls = [];
  gemini = ai({ name: 'A', description: '', variants: [] });
  const d = await (await post()).json();
  ok(geminiCalls[0].url.includes('gemini-3.5-flash-lite'), '可用設定更換模型，不用改程式');
  ok(d.variants.length === 1 && d.variants[0].label === '標準', '沒有規格時給標準規格', d);
  delete env.GEMINI_MODEL;
}
{
  gemini = ai({ name: 'x'.repeat(500), description: 'y'.repeat(5000), variants: Array.from({ length: 50 }, (_, i) => ({ label: `v${i}`, price: 1 })) });
  const d = await (await post()).json();
  ok(d.name.length === 80 && d.description.length === 1000 && d.variants.length === 20, '過長內容會被截斷');
}
{
  gemini = ai({ name: '', description: '', variants: [] });
  ok((await post()).status === 422, '看不出商品時要求換照片');
  gemini = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '不是 JSON' }] } }] }));
  ok((await post()).status === 422, 'AI 回傳格式錯誤時不會當掉');
  gemini = () => new Response(JSON.stringify({ candidates: [] }));
  ok((await post()).status === 422, 'AI 沒有回應內容時不會當掉');
  const quiet = console.error; console.error = () => {};
  gemini = () => new Response('quota', { status: 429 });
  const q = await post();
  ok(q.status === 429 && (await q.json()).message.includes('額度'), '額度用完有明確提示');
  gemini = () => new Response('bad key test-key', { status: 403 });
  const b = await post();
  const text = await b.text();
  ok(b.status === 502 && text.includes('金鑰') && !text.includes('test-key'), '金鑰錯誤有提示，且不外洩內容');
  gemini = () => new Response('down', { status: 503 });
  ok((await post()).status === 502, 'AI 服務異常時回覆可理解的訊息');
  gemini = () => { throw new Error('timeout'); };
  ok((await post()).status === 504, '逾時有提示');
  console.error = quiet;
}

console.log(`\n結果：通過 ${passed} 項，失敗 ${failures.length} 項`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
