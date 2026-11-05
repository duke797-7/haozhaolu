// 手機相關細節：照片方向、小螢幕、長文字、PWA 安裝條件與離線開啟。
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/opt/npm-tools/');
const { chromium, devices } = require('playwright');
const sharp = require('sharp');

const APP = 'http://127.0.0.1:4173/';
const API = 'http://127.0.0.1:54330';
const KEY = 'local-anon-key';
const SHOTS = process.env.SHOTS || '/var/tmp/preorder-shots';
const PHOTOS = '/var/tmp/preorder-photos';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PHOTOS, { recursive: true });

let passed = 0;
const failures = [];
const ok = (cond, name, extra) => {
  if (cond) { passed += 1; console.log(`  通過  ${name}`); }
  else { failures.push(name); console.log(`  失敗  ${name}`, extra ?? ''); }
};

async function rpc(fn, args, token) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(args),
  });
  return res.json();
}

const token = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'admin-pass-123' }),
})).json()).access_token;

const browser = await chromium.launch();

async function adminPage(device) {
  const ctx = await browser.newContext({ ...devices[device], locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  const page = await ctx.newPage();
  await page.goto(`${APP}#/admin`);
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('密碼').fill('admin-pass-123');
  await page.getByRole('button', { name: '登入' }).click();
  await page.getByRole('heading', { name: '總覽' }).waitFor();
  return page;
}

console.log('\n照片方向');
{
  // 相機常見存法：感光元件是橫的 4032×3024，再用 EXIF 標記「向右轉 90 度」。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4032" height="3024">
    <rect width="4032" height="3024" fill="#3b6"/><rect width="600" height="3024" fill="#c33"/></svg>`;
  const file = path.join(PHOTOS, 'portrait-exif.jpg');
  await sharp(Buffer.from(svg)).withMetadata({ orientation: 6 }).jpeg().toFile(file);

  const page = await adminPage('iPhone 14');
  await page.getByRole('link', { name: '上架新商品' }).click();
  await page.getByRole('heading', { name: '上架新商品' }).waitFor();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}/02-editor-empty.png` });
  await page.getByTestId('add-photos').setInputFiles(file);
  await page.locator('.photo img').waitFor();
  const dim = await page.evaluate(async () => {
    const img = document.querySelector('.photo img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    return {
      w: img.naturalWidth, h: img.naturalHeight,
      top: [...x.getImageData(c.width / 2, 20, 1, 1).data], bottom: [...x.getImageData(c.width / 2, c.height - 20, 1, 1).data],
    };
  });
  ok(dim.h > dim.w && dim.h === 1600, `直拍照片保持直向（${dim.w}×${dim.h}）`, dim);
  ok(dim.top[0] > 150 && dim.top[1] < 110, '照片內容也正確轉正（紅邊在上）', dim);

  await page.getByLabel('商品名稱').fill('售價驗證');
  const row = page.getByTestId('variant-row').first();
  await row.getByLabel('售價（元）').fill('12.5');
  await page.getByRole('button', { name: '存草稿' }).click();
  await page.getByRole('alert').filter({ hasText: '整數' }).waitFor();
  ok(true, '售價填小數時有明確提示');

  await row.getByLabel('售價（元）').fill('100');
  await page.getByRole('textbox', { name: '結束時間' }).fill('2020-01-01T12:00');
  await page.getByRole('button', { name: '上架', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '結束時間已經過了' }).waitFor();
  ok(true, '結束時間已過不能上架');

  await page.getByRole('button', { name: '商品列表' }).click();
  await page.getByRole('dialog').getByText('放棄這次修改').waitFor();
  ok(true, '離開未儲存的編輯會先確認');
  await page.context().close();
}

console.log('\n小螢幕與長文字（320px）');
{
  const id = randomUUID();
  const longName = '超長商品名稱測試日本進口有機棉麻混紡寬版長袖襯衫附贈同色系腰帶與收納袋限量版本';
  const longUnbroken = 'SUPERLONGVARIANTLABELWITHOUTANYSPACESATALL1234567890';
  const pngPath = path.join(PHOTOS, 'a.jpg');
  const up = await fetch(`${API}/storage/v1/object/product-images/${id}/cover.jpg`, {
    method: 'POST',
    headers: { apikey: KEY, authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
    body: await sharp(pngPath).resize(800).jpeg().toBuffer(),
  });
  ok(up.status === 200, '測試照片上傳', up.status);
  const saved = await rpc('admin_save_product', {
    p: {
      id, name: longName, description: 'x'.repeat(200), status: 'published',
      starts_at: new Date(Date.now() - 3600e3).toISOString(),
      ends_at: new Date(Date.now() + 86400e3).toISOString(),
      ship_estimate: '收到貨後兩週內陸續寄出，實際時間以通知為準，感謝耐心等候',
      images: [`${id}/cover.jpg`],
      variants: [
        { label: longUnbroken, price: 1234567, qty_limit: 9 },
        { label: '白色 / M', price: 890, qty_limit: 0 },
      ],
    },
  }, token);

  const ctx = await browser.newContext({
    viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW',
  });
  const page = await ctx.newPage();
  const noOverflow = async (name) => {
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok(r.sw <= r.cw, `${name}：320px 沒有左右溢出`, r);
  };
  await page.goto(`${APP}#/p/${saved.slug}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await noOverflow('商品頁');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/17-narrow-product.png`, fullPage: true });
  ok(await page.locator('.variant').filter({ hasText: '白色 / M' }).getByText('已額滿').isVisible(), '數量為 0 的規格顯示已額滿');
  ok((await page.locator('.buybar-hint').textContent()).includes('先選擇'), '尚未選數量時提示先選擇，不顯示誤導的合計');

  await page.locator('.variant').first().getByRole('button', { name: '增加一件' }).click();
  await page.getByRole('button', { name: '填寫預購單' }).click();
  await page.getByRole('heading', { name: '預購單' }).waitFor();
  await noOverflow('預購單');
  await page.reload();
  await page.getByRole('heading', { level: 1 }).waitFor();
  ok(/#\/p\/[0-9a-f]+$/.test(page.url()), '預購單重新整理後回到商品頁，不會卡在空白單', page.url());

  const order = await rpc('submit_preorder', {
    p: {
      client_token: randomUUID(), customer_name: '很長很長的名字'.repeat(5), customer_phone: '0988777666',
      customer_email: 'a-very-long-address-for-layout-testing@sub.example.com', note: '備註'.repeat(100), privacy_accepted: true,
      items: [{ variant_id: (await rpc('get_public_product', { p_slug: saved.slug })).variants[0].id, qty: 2 }],
    },
  });
  ok(Boolean(order.order_no), '長文字訂單成立');
  await ctx.close();

  const admin = await adminPage('iPhone SE');
  await admin.getByRole('link', { name: '訂單', exact: true }).click();
  await admin.getByTestId('order').first().waitFor();
  const r = await admin.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(r.sw <= r.cw, '訂單頁：iPhone SE 沒有左右溢出', r);
  await admin.getByRole('link', { name: '總覽', exact: true }).click();
  await admin.getByTestId('stats').waitFor();
  await admin.screenshot({ path: `${SHOTS}/18-narrow-overview.png`, fullPage: true });
  await rpc('admin_delete_product', { p_id: id }, token);
  await admin.context().close();
}

console.log('\nPWA');
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'zh-TW' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load|ERR_INTERNET/.test(m.text()) && logs.push(m.text()));
  await page.goto(APP);
  const href = await page.getAttribute('link[rel=manifest]', 'href');
  const manifest = await (await fetch(new URL(href, APP))).json();
  ok(manifest.display === 'standalone', '以獨立 App 視窗開啟');
  ok(manifest.start_url.includes('#/admin'), '從主畫面開啟會進管理後台');
  ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), '有 Android 自適應圖示');
  for (const icon of manifest.icons) {
    const res = await fetch(new URL(icon.src, APP));
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    ok(res.status === 200 && `${meta.width}x${meta.height}` === icon.sizes, `圖示 ${icon.sizes} 尺寸正確`);
  }
  const apple = await page.getAttribute('link[rel=apple-touch-icon]', 'href');
  ok((await fetch(new URL(apple, APP))).status === 200, '有 iPhone 主畫面圖示');
  ok(await page.getAttribute('meta[name=apple-mobile-web-app-capable]', 'content') === 'yes', 'iPhone 可全螢幕開啟');

  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active;
    if (worker.state !== 'activated') {
      await new Promise((done) => worker.addEventListener('statechange', () => worker.state === 'activated' && done()));
    }
    return worker.state;
  });
  ok(active === 'activated', 'Service Worker 已啟用', active);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.goto(`${APP}#/admin`).catch(() => {});
  await page.reload().catch(() => {});
  await page.locator('#root > *').first().waitFor({ timeout: 5000 });
  const text = await page.textContent('body');
  ok(text.includes('登入') || text.includes('連線失敗'), '離線時 App 仍能開啟，不會白畫面', text.slice(0, 80));
  await page.screenshot({ path: `${SHOTS}/19-offline.png` });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const all = [];
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) all.push(r.url);
    return all;
  });
  ok(cached.every((u) => u.startsWith(APP)), '快取裡只有網站檔案，沒有訂單資料', cached.filter((u) => !u.startsWith(APP)));
  ok(logs.length === 0, '沒有程式錯誤', logs);
  await ctx.close();
}

await browser.close();
console.log(`\n結果：通過 ${passed} 項，失敗 ${failures.length} 項`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
