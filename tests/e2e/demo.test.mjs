// 體驗版檢查：上架、下單、後台收單一輪，並確認沒有對外連線。
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/opt/npm-tools/');
const { chromium, devices } = require('playwright');

const FILE = process.argv[2];
const SHOTS = process.argv[3];
const WRAP = `/var/tmp/demo-wrap.html`;
fs.writeFileSync(WRAP, `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${fs.readFileSync(FILE, 'utf8')}</body></html>`);

let passed = 0;
const failures = [];
const ok = (cond, name, extra) => {
  if (cond) { passed += 1; console.log(`  通過  ${name}`); } else { failures.push(name); console.log(`  失敗  ${name}`, extra ?? ''); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
const page = await ctx.newPage();
const problems = [];
const external = [];
// 測試環境連不到 Google 字型，瀏覽器會改用備用字型，不算錯誤。
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(e.message));
page.on('request', (r) => /^https?:/.test(r.url()) && !/fonts\.(googleapis|gstatic)\.com/.test(r.url()) && external.push(r.url()));

await page.goto(`file://${WRAP}`);
await page.getByRole('heading', { name: '總覽' }).waitFor();
ok(true, '打開就進入管理後台總覽');
await page.waitForTimeout(100);
await page.screenshot({ path: `${SHOTS}/demo-1-overview.png` });

await page.getByRole('link', { name: '上架新商品' }).click();
await page.getByRole('heading', { name: '上架新商品' }).waitFor();
await page.getByTestId('add-photos').setInputFiles('/var/tmp/preorder-photos/a.jpg');
await page.locator('.photo img').waitFor();
await page.getByLabel('商品名稱').fill('測試上架商品');
const row = page.getByTestId('variant-row').first();
await row.getByLabel('售價（元）').fill('500');
await row.getByLabel('可預購數量').fill('1');
await page.getByRole('button', { name: '上架', exact: true }).click();
await page.getByRole('heading', { name: '商品已上架' }).waitFor();
ok(true, '可以選照片並上架');
await page.getByRole('button', { name: '回到商品列表' }).click();
await page.getByTestId('product-row').first().waitFor();
await page.waitForFunction(() => !document.querySelector('dialog[open]'));

await page.getByRole('button', { name: '顧客頁' }).click();
await page.locator('.shop-card').filter({ hasText: '測試上架商品' }).click();
await page.getByRole('heading', { name: '測試上架商品' }).waitFor();
await page.waitForFunction(() => document.querySelector('.gallery img')?.naturalWidth > 0);
ok(true, '顧客頁看得到新商品與照片');
await page.getByRole('button', { name: '填寫預購單' }).click();
await page.getByLabel('取貨人姓名').fill('測試者');
await page.getByLabel('手機號碼', { exact: true }).fill('0911222333');
await page.getByRole('textbox', { name: /^Email/ }).fill('tester@example.com');
await page.getByRole('checkbox').check();
await page.getByRole('button', { name: '送出預購單' }).click();
await page.getByRole('heading', { name: '預購成功' }).waitFor();
ok(true, '可以完成預購');

await page.getByRole('link', { name: '回到商品' }).click();
await page.getByText('已額滿').first().waitFor();
ok(true, '買完最後一件會顯示已額滿');

await page.getByRole('button', { name: '管理後台' }).click();
await page.getByRole('link', { name: '訂單', exact: true }).click();
await page.getByTestId('order').filter({ hasText: '測試者' }).waitFor();
ok(await page.getByTestId('order').count() === 5, '後台收到新訂單，共 5 筆');
await page.waitForTimeout(100);
await page.screenshot({ path: `${SHOTS}/demo-2-orders.png` });

await page.getByRole('link', { name: '商品', exact: true }).click();
const shirtRow = page.getByTestId('product-row').filter({ hasText: '棉麻' });
await shirtRow.getByRole('button', { name: '通知到貨' }).click();
await page.getByTestId('arrival-count').waitFor();
ok((await page.getByTestId('arrival-count').textContent()).includes('待通知 3 筆'), '通知名單列出 3 筆');
await page.getByLabel('賣貨便賣場連結').fill('https://myship.7-11.com.tw/general/detail/GM0000000000');
ok((await page.getByTestId('arrival-preview').textContent()).includes('https://myship.7-11.com.tw'), '通知內容帶入賣場連結');
ok((await page.getByRole('link', { name: '開啟郵件寄送' }).getAttribute('href')).startsWith('mailto:?bcc='), '收件人放在密件副本');
await page.waitForTimeout(100);
await page.screenshot({ path: `${SHOTS}/demo-4-arrival.png` });
await page.getByRole('button', { name: '寄出後標記為已通知' }).click();
await page.getByText('已標記 3 筆訂單為已通知').waitFor();
await page.getByRole('link', { name: '訂單', exact: true }).click();
await page.getByText('已通知到貨').first().waitFor();
ok(true, '標記後訂單顯示已通知到貨');

await page.getByRole('link', { name: '商品', exact: true }).click();
await page.getByRole('link', { name: '上架新商品' }).click();
await page.getByRole('heading', { name: '上架新商品' }).waitFor();
await page.waitForTimeout(100);
await page.screenshot({ path: `${SHOTS}/demo-5-scan-start.png` });
await page.getByTestId('scan-album').setInputFiles('/var/tmp/preorder-photos/a.jpg');
await page.locator('.scan-note').waitFor();
ok((await page.getByLabel('商品名稱').inputValue()).includes('紅包袋'), '拍照後自動填入商品名稱');
ok(await page.getByTestId('variant-row').count() === 2, '自動帶入 2 個規格');
ok(await page.locator('.photo').count() === 1, '拍的照片自動放進商品照片');
ok((await page.getByTestId('variant-row').first().getByLabel('售價（元）').inputValue()) === '120', '看得到的售價自動填入');
ok((await page.locator('.scan-note').textContent()).includes('沒有真的辨識'), '體驗版標明是範例');
await page.waitForTimeout(100);
await page.screenshot({ path: `${SHOTS}/demo-6-scan-done.png`, fullPage: true });
await page.getByTestId('variant-row').first().getByLabel('可預購數量').fill('50');
await page.getByTestId('variant-row').nth(1).getByLabel('售價（元）').fill('100');
await page.getByTestId('variant-row').nth(1).getByLabel('可預購數量').fill('30');
await page.getByRole('button', { name: '上架', exact: true }).click();
await page.getByRole('heading', { name: '商品已上架' }).waitFor();
ok(true, '只補數量就能上架');
await page.getByRole('button', { name: '回到商品列表' }).click();
await page.waitForFunction(() => !document.querySelector('dialog[open]'));

await page.getByRole('button', { name: '顧客頁' }).click();
await page.locator('.shop-card').filter({ hasText: '棉麻' }).click();
await page.getByRole('heading', { name: /棉麻/ }).waitFor();
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/demo-3-product.png` });
const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
ok(r.sw <= r.cw, '手機寬度沒有左右溢出', r);

ok(external.length === 0, '沒有任何對外連線', external);
ok(problems.length === 0, '沒有程式錯誤', problems);
await browser.close();
console.log(`\n結果：通過 ${passed} 項，失敗 ${failures.length} 項`);
if (failures.length) process.exit(1);
