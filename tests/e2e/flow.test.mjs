// 完整流程測試：以模擬手機實際點按，資料寫入真實 PostgreSQL。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/opt/npm-tools/');
const { chromium, devices } = require('playwright');
const sharp = require('sharp');

const APP = 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS || '/var/tmp/preorder-shots';
const PHOTOS = '/var/tmp/preorder-photos';
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PHOTOS, { recursive: true });

let passed = 0;
const failures = [];
const ok = (cond, name, extra) => {
  if (cond) { passed += 1; console.log(`  通過  ${name}`); }
  else { failures.push(name); console.log(`  失敗  ${name}`, extra ?? ''); }
};

// 模擬手機相機拍的大尺寸照片
async function photo(name, hue, ext = 'jpg') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3024" height="4032">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},55%,78%)"/><stop offset="1" stop-color="hsl(${hue + 30},45%,42%)"/>
    </linearGradient></defs>
    <rect width="3024" height="4032" fill="url(#g)"/>
    <circle cx="1512" cy="1900" r="880" fill="hsl(${hue},60%,88%)"/>
    <rect x="980" y="1300" width="1064" height="1300" rx="120" fill="hsl(${hue + 180},30%,30%)"/>
  </svg>`;
  const file = path.join(PHOTOS, `${name}.${ext}`);
  const img = sharp(Buffer.from(svg));
  await (ext === 'png' ? img.png() : img.jpeg({ quality: 92 })).toFile(file);
  return file;
}

const files = {
  a: await photo('a', 210),
  b: await photo('b', 35),
  c: await photo('c', 150, 'png'),
  d: await photo('d', 320),
};
fs.writeFileSync(path.join(PHOTOS, 'broken.jpg'), 'not an image');

const browser = await chromium.launch();
const problems = [];

async function phone(device, label) {
  const ctx = await browser.newContext({ ...devices[device], locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' }).catch(() => {});
  const page = await ctx.newPage();
  page.on('console', (m) => {
    // 登入失敗與下單被擋本來就會回 4xx，瀏覽器會自動記錄，不算程式錯誤。
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${label}: ${e.message}`));
  return page;
}

const shot = (page, name, fullPage = true) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });

async function noOverflow(page, name) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(r.sw <= r.cw, `${name}：沒有左右溢出`, r);
}

async function tapTargets(page, name, min = 40) {
  const small = await page.evaluate((limit) => {
    const out = [];
    for (const el of document.querySelectorAll('button, a.btn, .tabs a, select, input:not(.file):not([type=checkbox]), textarea')) {
      if (el.closest('.trap')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (r.height < limit || r.width < limit)) {
        out.push(`${el.tagName} "${(el.textContent || el.placeholder || '').trim().slice(0, 14)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  }, min);
  ok(small.length === 0, `${name}：按鈕都適合手指點按`, small);
}

const admin = await phone('iPhone 14', '管理員');
const customer = await phone('Pixel 7', '顧客');

console.log('\n登入');
await admin.goto(`${APP}#/admin`);
await admin.getByLabel('Email').fill('admin@example.com');
await admin.getByLabel('密碼').fill('wrong-password');
await admin.getByRole('button', { name: '登入' }).click();
await admin.getByRole('alert').filter({ hasText: 'Email 或密碼不正確' }).waitFor();
ok(true, '密碼錯誤會提示');
await shot(admin, '01-login');

await admin.getByLabel('Email').fill('stranger@example.com');
await admin.getByLabel('密碼').fill('stranger-pass-123');
await admin.getByRole('button', { name: '登入' }).click();
await admin.getByRole('alert').filter({ hasText: '這個帳號沒有管理權限' }).waitFor();
ok(true, '非管理員帳號無法進入後台');

await admin.getByLabel('Email').fill('admin@example.com');
await admin.getByLabel('密碼').fill('admin-pass-123');
await admin.getByRole('button', { name: '登入' }).click();
await admin.getByRole('heading', { name: '總覽' }).waitFor();
ok(true, '管理員可登入');

console.log('\n上架商品');
await admin.getByRole('link', { name: '上架新商品' }).click();
await admin.getByRole('heading', { name: '上架新商品' }).waitFor();
await shot(admin, '02-editor-empty');

await admin.getByTestId('add-photos').setInputFiles(path.join(PHOTOS, 'broken.jpg'));
await admin.getByRole('alert').filter({ hasText: '無法讀取' }).waitFor();
ok(true, '壞掉的圖片檔會明確提示');

await admin.getByTestId('add-photos').setInputFiles([files.a, files.b, files.c]);
await admin.locator('.photo').nth(2).waitFor();
ok(await admin.locator('.photo').count() === 3, '一次從相簿選 3 張照片（含 PNG）');

await admin.getByRole('button', { name: '第 3 張照片' }).click();
await admin.getByRole('button', { name: '設為封面' }).click();
ok(await admin.locator('.photo').first().locator('.photo-cover').count() === 1, '第 3 張改成封面');
await admin.getByRole('button', { name: '更換' }).click({ noWaitAfter: true }).catch(() => {});
await admin.getByTestId('swap-photo').setInputFiles(files.d);
await admin.waitForFunction(() => document.querySelector('.photo-on img')?.src.startsWith('blob:'));
ok(await admin.locator('.photo').count() === 3, '更換照片後張數不變');
await admin.getByRole('button', { name: '往後' }).click();
await shot(admin, '03-editor-photos', false);

await admin.getByLabel('商品名稱').fill('日系棉麻寬版襯衫');
await admin.getByLabel('商品介紹').fill('透氣棉麻，寬鬆版型。\n洗後自然皺褶為正常現象。');
const rows = admin.getByTestId('variant-row');
await rows.nth(0).getByLabel('規格名稱').fill('白色 / M');
await rows.nth(0).getByLabel('售價（元）').fill('890');
await rows.nth(0).getByLabel('可預購數量').fill('3');
await admin.getByRole('button', { name: '新增規格' }).click();
ok(await rows.nth(1).getByLabel('售價（元）').inputValue() === '890', '新增規格自動帶入上一個售價');
await rows.nth(1).getByLabel('規格名稱').fill('黑色 / L');
await rows.nth(1).getByLabel('售價（元）').fill('990');
await rows.nth(1).getByLabel('可預購數量').fill('2');
await admin.getByRole('button', { name: '14 天後結單' }).click();
await admin.getByLabel('預計出貨時間').fill('12 月中旬');
await noOverflow(admin, '商品編輯頁');
await tapTargets(admin, '商品編輯頁');
await shot(admin, '04-editor-filled');

await admin.getByRole('button', { name: '上架', exact: true }).click();
const shareEl = admin.getByTestId('share-url');
await shareEl.waitFor({ timeout: 20000 });
const shareUrl = await shareEl.textContent();
ok(/#\/p\/[0-9a-f]{10}$/.test(shareUrl), '上架後產生商品專屬網址', shareUrl);
await shot(admin, '05-published', false);
await admin.getByRole('button', { name: '回到商品列表' }).click();
await admin.getByTestId('product-row').first().waitFor();
await tapTargets(admin, '商品列表');
await shot(admin, '06-products');

console.log('\n顧客下單');
await customer.goto(shareUrl);
await customer.getByRole('heading', { name: '日系棉麻寬版襯衫' }).waitFor();
await customer.waitForFunction(() => {
  const img = document.querySelector('.gallery img');
  return img && img.complete && img.naturalWidth > 0;
});
const size = await customer.evaluate(() => {
  const img = document.querySelector('.gallery img');
  return Math.max(img.naturalWidth, img.naturalHeight);
});
ok(size === 1600, `照片從雲端載入，並壓縮到 1600px（實際 ${size}）`);
const body = await customer.textContent('body');
for (const text of ['7-ELEVEN 賣貨便貨到付款', 'NT$38', '12 月中旬', '預購期限', '注意事項', '洗後自然皺褶']) {
  ok(body.includes(text), `商品頁顯示：${text}`);
}
ok((await customer.getByTestId('tape').textContent()).includes('結單'), '顯示預購倒數');
await customer.waitForTimeout(200);
await shot(customer, '07-product', false);
await shot(customer, '08-product-full');
await noOverflow(customer, '商品頁');
await tapTargets(customer, '商品頁');

ok(await customer.getByRole('button', { name: '填寫預購單' }).isDisabled(), '沒選數量時不能往下');
const white = customer.locator('.variant').filter({ hasText: '白色 / M' });
await white.getByRole('button', { name: '增加一件' }).click();
await white.getByRole('button', { name: '增加一件' }).click();
const black = customer.locator('.variant').filter({ hasText: '黑色 / L' });
await black.getByRole('button', { name: '增加一件' }).click();
await black.getByRole('button', { name: '增加一件' }).click();
ok(await black.getByRole('button', { name: '增加一件' }).isDisabled(), '數量不能超過可預購數量');
await black.getByRole('button', { name: '減少一件' }).click();
ok((await customer.locator('.buybar-sum strong').textContent()) === 'NT$2,808', '底部即時顯示合計 2,808 元');
await customer.getByRole('button', { name: '填寫預購單' }).click();

await customer.getByRole('heading', { name: '預購單' }).waitFor();
ok((await customer.getByTestId('grand-total').textContent()) === 'NT$2,808', '預購單合計：890×2＋990＋38');
await customer.getByLabel('取貨人姓名').fill('林小美');
await customer.getByLabel('手機號碼', { exact: true }).fill('0912-345-678');
await customer.getByRole('textbox', { name: /^Email/ }).fill('lin@example.com');
await customer.getByLabel('備註（選填）').fill('週末才能取貨');
await noOverflow(customer, '預購單');
await tapTargets(customer, '預購單');
await shot(customer, '09-slip');

await customer.getByRole('button', { name: '送出預購單' }).click();
ok(await customer.getByRole('heading', { name: '預購單' }).isVisible(), '未勾選個資同意不能送出');
await customer.getByRole('checkbox').check();
await customer.getByRole('button', { name: '送出預購單' }).click();
await customer.getByRole('heading', { name: '預購成功' }).waitFor();
const orderNo = await customer.getByTestId('order-no').textContent();
ok(/^\d{6}-[0-9A-F]{6}$/.test(orderNo), '顯示預購成功與訂單編號', orderNo);
await customer.waitForTimeout(100);
await shot(customer, '10-success');
await customer.reload();
await customer.getByRole('heading', { name: '預購成功' }).waitFor();
ok((await customer.getByTestId('order-no').textContent()) === orderNo, '重新整理後仍看得到訂單編號');
await noOverflow(customer, '成功頁');

console.log('\n管理員查看');
await admin.getByRole('link', { name: '訂單' }).click();
const card = admin.getByTestId('order').filter({ hasText: orderNo });
await card.waitFor();
const cardText = await card.textContent();
for (const text of ['林小美', '0912345678', 'lin@example.com', '白色 / M', '× 2', '黑色 / L', 'NT$2,808', '週末才能取貨']) {
  ok(cardText.includes(text), `訂單顯示：${text}`);
}
await tapTargets(admin, '訂單頁');
await noOverflow(admin, '訂單頁');
await shot(admin, '11-orders');

await card.getByLabel('訂單狀態').selectOption('confirmed');
await admin.getByText('已標記為已確認').waitFor();
await admin.getByRole('button', { name: '新訂單' }).click();
await admin.getByText('沒有符合條件的訂單').waitFor();
ok(true, '狀態更新後，新訂單篩選不再出現這筆');
await admin.getByRole('button', { name: '已確認' }).click();
await card.waitFor();
await admin.getByRole('button', { name: '全部' }).click();
await admin.getByLabel('搜尋訂單').fill('0912345678');
await card.waitFor();
await admin.getByLabel('搜尋訂單').fill('查無此人');
await admin.getByText('沒有符合條件的訂單').waitFor();
ok(true, '可依手機搜尋訂單');
await admin.getByLabel('搜尋訂單').fill('');

await admin.getByRole('link', { name: '總覽' }).click();
const stats = admin.getByTestId('stats');
await stats.waitFor();
const statText = await stats.textContent();
ok(statText.includes('3 件') && statText.includes('2 / 3 件') && statText.includes('1 / 2 件'), '總覽統計：共 3 件，白 2/3、黑 1/2', statText);
await noOverflow(admin, '總覽');
await tapTargets(admin, '總覽');
await shot(admin, '12-overview');

console.log('\n修改商品');
await admin.getByRole('link', { name: '商品', exact: true }).click();
await admin.getByTestId('product-row').first().locator('.product-row-main').click();
await admin.getByRole('heading', { name: '編輯商品' }).waitFor();
await admin.getByTestId('variant-row').first().getByLabel('規格名稱').waitFor();
const firstRow = admin.getByTestId('variant-row').first();
await firstRow.getByLabel('可預購數量').fill('1');
await admin.getByRole('button', { name: '儲存變更' }).click();
await admin.getByRole('alert').filter({ hasText: '已有 2 件預購' }).waitFor();
ok(true, '數量不能改到低於已預購數');
await firstRow.getByLabel('可預購數量').fill('3');
await firstRow.getByLabel('售價（元）').fill('790');
await admin.getByRole('button', { name: '第 1 張照片' }).click();
await admin.getByRole('button', { name: '刪除', exact: true }).click();
ok(await admin.locator('.photo').count() === 2, '可刪除照片');
await admin.getByRole('button', { name: '儲存變更' }).click();
await admin.getByText('已儲存變更').waitFor();
ok(true, '修改照片與售價後儲存成功');

await customer.goto(shareUrl);
await customer.reload();
await customer.getByRole('heading', { name: '日系棉麻寬版襯衫' }).waitFor();
ok((await customer.locator('.variant').filter({ hasText: '白色 / M' }).textContent()).includes('NT$790'), '顧客頁立刻看到新售價');
ok(await customer.locator('.gallery img').count() === 2, '顧客頁照片同步減少');

await admin.getByRole('link', { name: '訂單' }).click();
await card.waitFor();
ok((await card.textContent()).includes('NT$2,808'), '舊訂單金額不受改價影響');

console.log('\n售完與時間差');
const rival = await phone('Pixel 7', '另一位顧客');
await rival.goto(shareUrl);
await rival.locator('.variant').filter({ hasText: '白色 / M' }).getByRole('button', { name: '增加一件' }).click();
await rival.getByRole('button', { name: '填寫預購單' }).click();
await rival.getByLabel('取貨人姓名').fill('陳大文');
await rival.getByLabel('手機號碼', { exact: true }).fill('0922333444');
await rival.getByRole('textbox', { name: /^Email/ }).fill('chen@example.com');
await rival.getByRole('checkbox').check();

// 這位顧客填單期間，最後一件被別人買走。
await customer.locator('.variant').filter({ hasText: '白色 / M' }).getByRole('button', { name: '增加一件' }).click();
await customer.getByRole('button', { name: '填寫預購單' }).click();
await customer.getByLabel('取貨人姓名').fill('張三');
await customer.getByLabel('手機號碼', { exact: true }).fill('0933444555');
await customer.getByRole('textbox', { name: /^Email/ }).fill('zhang@example.com');
await customer.getByRole('checkbox').check();
await customer.getByRole('button', { name: '送出預購單' }).click();
await customer.getByRole('heading', { name: '預購成功' }).waitFor();

await rival.getByRole('button', { name: '送出預購單' }).click();
await rival.waitForURL(/#\/p\/[0-9a-f]{10}$/, { timeout: 8000 }).catch(() => {});
await rival.locator('.variant').filter({ hasText: '白色 / M' }).getByText('已額滿').waitFor();
ok(true, '填單途中被買走時，不會成立訂單，並顯示已額滿');
await shot(rival, '13-sold-out', false);

console.log('\n下架與重新開放');
await admin.getByRole('link', { name: '商品', exact: true }).click();
await admin.getByTestId('product-row').first().waitFor();
await admin.getByRole('button', { name: '下架' }).click();
await admin.getByText('已下架').first().waitFor();
await customer.goto(shareUrl);
await customer.reload();
await customer.getByText('這個商品目前沒有開放預購').waitFor();
ok(true, '下架後顧客網址顯示未開放');
await admin.getByRole('button', { name: '重新上架' }).click();
await admin.getByText('已上架').first().waitFor();
await customer.reload();
await customer.getByRole('heading', { name: '日系棉麻寬版襯衫' }).waitFor();
ok(true, '重新上架後顧客可再次開啟');

console.log('\n換手機與保存');
const second = await phone('iPhone 14', '第二支手機');
await second.goto(`${APP}#/admin/orders`);
await second.getByLabel('Email').fill('admin@example.com');
await second.getByLabel('密碼').fill('admin-pass-123');
await second.getByRole('button', { name: '登入' }).click();
await second.getByTestId('order').filter({ hasText: orderNo }).waitFor();
ok(true, '換一支手機登入，訂單都還在');
await admin.reload();
await admin.getByTestId('product-row').first().waitFor();
ok(true, '重新開啟 App 後維持登入');

console.log('\n權限與個資');
const stranger = await phone('Pixel 7', '路人');
await stranger.goto(`${APP}#/admin/orders`);
await stranger.getByLabel('Email').waitFor();
ok(!(await stranger.textContent('body')).includes('林小美'), '未登入開訂單頁只會看到登入畫面');
const html = await (await fetch(APP)).text();
ok(!/service_role|secret/i.test(html), '網頁裡沒有 service_role 金鑰');

console.log('\n設定與刪除');
await admin.getByRole('link', { name: '設定' }).click();
await admin.getByLabel('商店名稱').fill('小美的預購舖');
await admin.getByRole('button', { name: '儲存設定' }).click();
await admin.getByText('已儲存設定').waitFor();
await tapTargets(admin, '設定頁');
await noOverflow(admin, '設定頁');
await shot(admin, '14-settings');
await customer.goto(APP);
await customer.getByRole('heading', { name: '小美的預購舖' }).waitFor();
await customer.locator('.shop-card').first().waitFor();
await customer.waitForTimeout(200);
await shot(customer, '15-shop-home');
await noOverflow(customer, '商店首頁');
ok(true, '商店首頁顯示新名稱與商品');

await admin.getByRole('link', { name: '商品', exact: true }).click();
await admin.getByTestId('product-row').first().locator('.product-row-main').click();
await admin.getByRole('heading', { name: '編輯商品' }).waitFor();
await admin.getByRole('button', { name: '刪除商品' }).click();
await shot(admin, '16-delete-confirm', false);
await admin.getByRole('dialog').getByRole('button', { name: '刪除商品' }).click();
await admin.getByText('已刪除商品').waitFor();
await admin.getByRole('link', { name: '訂單' }).click();
await card.waitFor();
ok((await card.textContent()).includes('日系棉麻寬版襯衫'), '刪除商品後，訂單仍保留商品名稱');
const left = fs.readdirSync('/var/tmp/preorder-files/product-images', { recursive: true }).filter((f) => f.endsWith('.jpg'));
ok(left.length === 0, '刪除商品後，雲端照片一併清除', left);

ok(problems.length === 0, '全程沒有程式錯誤', problems);
await browser.close();

console.log(`\n結果：通過 ${passed} 項，失敗 ${failures.length} 項`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
