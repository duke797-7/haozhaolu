// 資料庫與權限測試：透過 HTTP 呼叫本機閘道，由 PostgreSQL 實際執行權限檢查。
import { randomUUID } from 'node:crypto';

const API = process.env.API_URL || 'http://127.0.0.1:54330';
const KEY = 'local-anon-key';
let passed = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) { passed += 1; console.log(`  通過  ${name}`); }
  else { failures.push(name); console.log(`  失敗  ${name}`, extra ?? ''); }
}

let ipSeq = 0;
const nextIp = () => `10.1.${Math.floor(ipSeq / 200)}.${(ipSeq++ % 200) + 1}`;

async function call(path, { body, token, ip, method = 'POST' } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: KEY, 'content-type': 'application/json',
      'x-test-ip': ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const rpc = (fn, args, opts = {}) => call(`/rest/v1/rpc/${fn}`, { body: args, ...opts });
const login = async (email, password) =>
  (await call('/auth/v1/token?grant_type=password', { body: { email, password } })).data.access_token;

const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const iso = (hours) => new Date(Date.now() + hours * 3600e3).toISOString();

function order(variantId, qty = 1, extra = {}) {
  return {
    p: {
      client_token: randomUUID(),
      customer_name: '王小明', customer_phone: phone(), customer_email: 'buyer@example.com',
      privacy_accepted: true, items: [{ variant_id: variantId, qty }], ...extra,
    },
  };
}

async function makeProduct(admin, { limit = 5, price = 300, status = 'published', starts = -1, ends = 24 } = {}) {
  const id = randomUUID();
  const saved = await rpc('admin_save_product', {
    p: {
      id, name: '測試商品', description: '介紹', status, starts_at: iso(starts), ends_at: iso(ends),
      ship_estimate: '12 月中', images: [`${id}/a.jpg`],
      variants: [{ label: '白色 M', price, qty_limit: limit }],
    },
  }, { token: admin });
  if (saved.status !== 200) throw new Error(JSON.stringify(saved));
  const detail = await rpc('admin_get_product', { p_id: id }, { token: admin });
  return { id, slug: saved.data.slug, variantId: detail.data.variants[0].id };
}

const admin = await login('admin@example.com', 'admin-pass-123');
const stranger = await login('stranger@example.com', 'stranger-pass-123');

console.log('\n權限：未登入者');
for (const t of ['orders', 'order_items', 'products', 'product_variants', 'admins', 'shop_settings', 'order_throttle']) {
  const r = await call(`/rest/v1/${t}`, { method: 'GET' });
  ok(r.status === 403, `無法直接讀取 ${t}`, r);
}
for (const fn of ['admin_list_orders', 'admin_dashboard', 'admin_list_products', 'admin_get_settings',
  'order_receipt', 'variant_ordered_qty', 'require_admin', 'is_admin', 'admin_variant_stats', 'image_list']) {
  const args = fn === 'order_receipt' ? { p_order_id: randomUUID() }
    : fn === 'variant_ordered_qty' ? { p_variant_id: randomUUID() }
    : fn === 'image_list' ? { p_product_id: randomUUID() } : {};
  const r = await rpc(fn, args);
  ok(r.status === 403, `無法呼叫 ${fn}`, r);
}

console.log('\n權限：登入但不是管理員');
for (const t of ['orders', 'admins', 'products']) {
  const r = await call(`/rest/v1/${t}`, { method: 'GET', token: stranger });
  ok(r.status === 403, `無法直接讀取 ${t}`, r);
}
{
  const r = await rpc('admin_list_orders', { p: {} }, { token: stranger });
  ok(r.status === 403 && r.data.message === '需要管理員權限', '無法查看訂單', r);
  const s = await rpc('admin_save_product', { p: { id: randomUUID(), name: '惡意' } }, { token: stranger });
  ok(s.status === 403, '無法新增商品', s);
  const d = await rpc('admin_delete_product', { p_id: randomUUID() }, { token: stranger });
  ok(d.status === 403, '無法刪除商品', d);
  const st = await rpc('admin_save_settings', { p: { shop_name: 'x', shipping_fee: 0 } }, { token: stranger });
  ok(st.status === 403, '無法修改運費', st);
  const u = await fetch(`${API}/storage/v1/object/product-images/evil/a.jpg`, {
    method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${stranger}`, 'content-type': 'image/jpeg' }, body: 'x',
  });
  ok(u.status === 403, '無法上傳照片', u.status);
  const a = await fetch(`${API}/storage/v1/object/product-images/evil/a.jpg`, {
    method: 'POST', headers: { apikey: KEY, 'content-type': 'image/jpeg' }, body: 'x',
  });
  ok(a.status === 403, '未登入無法上傳照片', a.status);
}

console.log('\n商品顯示規則');
{
  const draft = await makeProduct(admin, { status: 'draft' });
  const pub = await makeProduct(admin);
  const hidden = await makeProduct(admin);
  await rpc('admin_set_product_status', { p_id: hidden.id, p_status: 'hidden' }, { token: admin });
  const list = (await rpc('list_public_products')).data;
  ok(list.some((x) => x.slug === pub.slug), '已上架商品會出現');
  ok(!list.some((x) => x.slug === draft.slug), '草稿不會出現');
  ok(!list.some((x) => x.slug === hidden.slug), '下架商品不會出現');
  ok((await rpc('get_public_product', { p_slug: draft.slug })).data === null, '草稿網址打不開');
  ok((await rpc('get_public_product', { p_slug: hidden.slug })).data === null, '下架商品網址打不開');
  const reopened = await rpc('admin_set_product_status', { p_id: hidden.id, p_status: 'published' }, { token: admin });
  ok(reopened.status === 200 && (await rpc('get_public_product', { p_slug: hidden.slug })).data !== null, '重新上架後網址恢復');
}
{
  const id = randomUUID();
  const base = { id, name: '缺資料', status: 'published', ends_at: iso(1) };
  const noPhoto = await rpc('admin_save_product', { p: { ...base, images: [], variants: [{ label: 'A', price: 1 }] } }, { token: admin });
  ok(noPhoto.status === 400 && noPhoto.data.message.includes('照片'), '沒有照片不能上架', noPhoto);
  const noVar = await rpc('admin_save_product', { p: { ...base, images: ['x.jpg'], variants: [] } }, { token: admin });
  ok(noVar.status === 400 && noVar.data.message.includes('規格'), '沒有規格不能上架', noVar);
  const badTime = await rpc('admin_save_product', {
    p: { ...base, starts_at: iso(5), ends_at: iso(1), images: ['x.jpg'], variants: [{ label: 'A', price: 1 }] },
  }, { token: admin });
  ok(badTime.status === 400 && badTime.data.message.includes('晚於'), '結束時間不能早於開始時間', badTime);
}

console.log('\n下單檢查');
{
  const p = await makeProduct(admin, { limit: 5, price: 300 });
  const good = await rpc('submit_preorder', order(p.variantId, 2));
  ok(good.status === 200 && good.data.total === 638, '金額由資料庫計算：2×300＋38＝638', good);
  ok(good.data.shipping_fee === 38, '預設運費 38 元');
  ok(!JSON.stringify(good.data).includes('王小明') && !('customer_phone' in good.data), '成功回應不含個資');

  const tampered = await rpc('submit_preorder', order(p.variantId, 1, {
    items: [{ variant_id: p.variantId, qty: 1, price: 1, unit_price: 1 }], total: 1,
  }));
  ok(tampered.status === 200 && tampered.data.items[0].unit_price === 300, '竄改前端價格沒有作用', tampered);

  const phoneBad = await rpc('submit_preorder', order(p.variantId, 1, { customer_phone: '12345' }));
  ok(phoneBad.status === 400 && phoneBad.data.message.includes('手機'), '手機格式錯誤會被擋', phoneBad);
  const noMail = await rpc('submit_preorder', order(p.variantId, 1, { customer_email: ' ' }));
  ok(noMail.status === 400 && noMail.data.message.includes('Email'), 'Email 必填', noMail);
  const badMail = await rpc('submit_preorder', order(p.variantId, 1, { customer_email: 'not-an-email' }));
  ok(badMail.status === 400 && badMail.data.message.includes('Email'), 'Email 格式錯誤會被擋', badMail);
  const noConsent = await rpc('submit_preorder', order(p.variantId, 1, { privacy_accepted: false }));
  ok(noConsent.status === 400, '未同意個資告知不能送出', noConsent);
  const bot = await rpc('submit_preorder', order(p.variantId, 1, { website: 'http://spam' }));
  ok(bot.status === 400, '機器人欄位會被擋', bot);
  const zero = await rpc('submit_preorder', order(p.variantId, 0));
  ok(zero.status === 400, '數量 0 會被擋', zero);
  const neg = await rpc('submit_preorder', order(p.variantId, -3));
  ok(neg.status === 400, '負數數量會被擋', neg);
  const over = await rpc('submit_preorder', order(p.variantId, 4));
  ok(over.status === 400 && over.data.hint === 'sold_out' && over.data.message.includes('只剩'), '超過剩餘數量會被擋', over);
  const fake = await rpc('submit_preorder', order(randomUUID(), 1));
  ok(fake.status === 400 && fake.data.hint === 'unavailable', '不存在的規格會被擋', fake);
  const priceShift = await rpc('submit_preorder', order(p.variantId, 1, { expected_total: 100 }));
  ok(priceShift.status === 400 && priceShift.data.hint === 'price_changed', '價格變動時要求重新確認', priceShift);

  const form = order(p.variantId, 1);
  const first = await rpc('submit_preorder', form);
  const again = await rpc('submit_preorder', form);
  ok(first.data.order_no === again.data.order_no, '同一張預購單重送不會變兩筆', [first, again]);
}
{
  const before = await makeProduct(admin, { starts: 2, ends: 24 });
  const r = await rpc('submit_preorder', order(before.variantId));
  ok(r.status === 400 && r.data.message.includes('尚未開放'), '開始時間前不能下單', r);
  const after = await makeProduct(admin, { starts: -5, ends: 1 });
  await rpc('admin_set_product_status', { p_id: after.id, p_status: 'published', p_ends_at: iso(-1) }, { token: admin });
  const r2 = await rpc('submit_preorder', order(after.variantId));
  ok(r2.status === 400 && r2.data.message.includes('已結束'), '結束時間後不能下單', r2);
  await rpc('admin_set_product_status', { p_id: after.id, p_status: 'published', p_ends_at: iso(5) }, { token: admin });
  const r3 = await rpc('submit_preorder', order(after.variantId));
  ok(r3.status === 200, '延長結束時間即可重新開放預購', r3);
  const off = await makeProduct(admin);
  await rpc('admin_set_product_status', { p_id: off.id, p_status: 'hidden' }, { token: admin });
  const r4 = await rpc('submit_preorder', order(off.variantId));
  ok(r4.status === 400, '下架商品不能下單', r4);
}

console.log('\n防超賣：60 人同時搶 5 件');
{
  const p = await makeProduct(admin, { limit: 5 });
  const results = await Promise.all(Array.from({ length: 60 }, () => rpc('submit_preorder', order(p.variantId))));
  const wins = results.filter((r) => r.status === 200).length;
  const soldOut = results.filter((r) => r.data?.hint === 'sold_out').length;
  ok(wins === 5, `剛好成立 5 筆（實際 ${wins} 筆）`, results.filter((r) => r.status !== 200 && r.data?.hint !== 'sold_out').slice(0, 3));
  ok(soldOut === 55, `其餘 55 筆都收到售完訊息（實際 ${soldOut} 筆）`);
  const remaining = (await rpc('get_public_product', { p_slug: p.slug })).data.variants[0].remaining;
  ok(remaining === 0, '顧客頁顯示剩餘 0');
  const stat = (await rpc('admin_dashboard', {}, { token: admin })).data.stats.find((s) => s.variant_id === p.variantId);
  ok(stat.qty === 5 && stat.order_count === 5, '後台統計為 5 件', stat);
}
{
  // 同一張預購單同時送出 8 次，只能成立一筆。
  const p = await makeProduct(admin, { limit: 20 });
  const form = order(p.variantId, 1);
  const results = await Promise.all(Array.from({ length: 8 }, () => rpc('submit_preorder', form)));
  const numbers = new Set(results.filter((r) => r.status === 200).map((r) => r.data.order_no));
  const stat = (await rpc('admin_dashboard', {}, { token: admin })).data.stats.find((s) => s.variant_id === p.variantId);
  ok(numbers.size === 1 && stat.qty === 1, '連點送出 8 次只成立 1 筆', { numbers: [...numbers], stat });
}
{
  // 交錯下單不可造成死結：兩個規格以相反順序同時購買。
  const a = await makeProduct(admin, { limit: 100 });
  const b = await makeProduct(admin, { limit: 100 });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => {
    const items = i % 2
      ? [{ variant_id: a.variantId, qty: 1 }, { variant_id: b.variantId, qty: 1 }]
      : [{ variant_id: b.variantId, qty: 1 }, { variant_id: a.variantId, qty: 1 }];
    return rpc('submit_preorder', order(a.variantId, 1, { items }));
  }));
  ok(results.every((r) => r.status === 200), '交錯下單沒有死結', results.find((r) => r.status !== 200));
}

console.log('\n取消與恢復');
{
  const p = await makeProduct(admin, { limit: 1 });
  const first = await rpc('submit_preorder', order(p.variantId));
  const orders = (await rpc('admin_list_orders', { p: { q: first.data.order_no } }, { token: admin })).data;
  ok(orders.total === 1 && orders.rows[0].customer_phone.startsWith('09'), '管理員可看到完整訂單');
  await rpc('admin_set_order_status', { p_ids: [orders.rows[0].id], p_status: 'cancelled' }, { token: admin });
  const left = (await rpc('get_public_product', { p_slug: p.slug })).data.variants[0].remaining;
  ok(left === 1, '取消後名額釋出');
  const second = await rpc('submit_preorder', order(p.variantId));
  ok(second.status === 200, '釋出的名額可被新訂單使用');
  const restore = await rpc('admin_set_order_status', { p_ids: [orders.rows[0].id], p_status: 'new' }, { token: admin });
  ok(restore.status === 400 && restore.data.hint === 'sold_out', '名額已滿時無法恢復已取消訂單', restore);
  const st = await rpc('admin_set_order_status', { p_ids: [orders.rows[0].id], p_status: 'bogus' }, { token: admin });
  ok(st.status === 400, '不接受不存在的狀態', st);
}

console.log('\n到貨通知');
{
  const p = await makeProduct(admin, { limit: 10 });
  const first = await rpc('submit_preorder', order(p.variantId, 1, { customer_email: 'A@Example.com' }));
  await rpc('submit_preorder', order(p.variantId, 1, { customer_email: 'a@example.com' }));
  await rpc('submit_preorder', order(p.variantId, 1, { customer_email: 'b@example.com' }));
  const cancelled = await rpc('submit_preorder', order(p.variantId, 1, { customer_email: 'c@example.com' }));
  const row = (await rpc('admin_list_orders', { p: { q: cancelled.data.order_no } }, { token: admin })).data.rows[0];
  await rpc('admin_set_order_status', { p_ids: [row.id], p_status: 'cancelled' }, { token: admin });

  const list = (await rpc('admin_arrival_recipients', { p_id: p.id }, { token: admin })).data;
  ok(list.emails.length === 2 && list.emails.includes('a@example.com') && list.emails.includes('b@example.com'), 'Email 不分大小寫去重，已取消的不寄', list.emails);
  ok(list.order_ids.length === 3, '名單含 3 筆有效訂單', list);

  const bad = await rpc('admin_set_myship_url', { p_id: p.id, p_url: 'javascript:alert(1)' }, { token: admin });
  ok(bad.status === 400, '賣場連結必須是 https', bad);
  await rpc('admin_set_myship_url', { p_id: p.id, p_url: 'https://myship.7-11.com.tw/general/detail/GM0000' }, { token: admin });
  await rpc('admin_mark_notified', { p_ids: list.order_ids }, { token: admin });
  await rpc('submit_preorder', order(p.variantId, 1, { customer_email: 'late@example.com' }));
  const again = (await rpc('admin_arrival_recipients', { p_id: p.id }, { token: admin })).data;
  ok(again.emails.length === 1 && again.emails[0] === 'late@example.com' && again.notified_count === 3, '已通知的不再列出，新訂單才進名單', again);
  ok(again.myship_url.startsWith('https://myship'), '賣場連結會記住', again.myship_url);

  const anon = await rpc('admin_arrival_recipients', { p_id: p.id });
  const other = await rpc('admin_arrival_recipients', { p_id: p.id }, { token: stranger });
  ok(anon.status === 403 && other.status === 403, '未授權者拿不到 Email 名單', [anon.status, other.status]);
  ok(!JSON.stringify(first.data).includes('example.com'), '顧客回應不含 Email');
  const url = await rpc('admin_set_myship_url', { p_id: p.id, p_url: 'https://evil.example' });
  const mark = await rpc('admin_mark_notified', { p_ids: list.order_ids }, { token: stranger });
  ok(url.status === 403 && mark.status === 403, '未授權者不能改連結或標記', [url.status, mark.status]);
}

console.log('\n訂單快照');
{
  const p = await makeProduct(admin, { limit: 10, price: 300 });
  const placed = await rpc('submit_preorder', order(p.variantId, 2));
  await rpc('admin_save_product', {
    p: {
      id: p.id, name: '改過的名稱', status: 'published', starts_at: iso(-1), ends_at: iso(24), images: [`${p.id}/a.jpg`],
      variants: [{ id: p.variantId, label: '改過的規格', price: 999, qty_limit: 10 }],
    },
  }, { token: admin });
  const row = (await rpc('admin_list_orders', { p: { q: placed.data.order_no } }, { token: admin })).data.rows[0];
  ok(row.items[0].product_name === '測試商品' && row.items[0].unit_price === 300 && row.total === 638, '改價改名不影響舊訂單', row.items);
  const stats = (await rpc('admin_dashboard', {}, { token: admin })).data.stats;
  const stat = stats.find((s) => s.variant_id === p.variantId);
  ok(stat.qty === 2 && stat.variant_label === '改過的規格', '統計沿用同一規格並顯示新名稱', stat);

  await rpc('admin_save_product', {
    p: {
      id: p.id, name: '改過的名稱', status: 'published', starts_at: iso(-1), ends_at: iso(24), images: [`${p.id}/a.jpg`],
      variants: [{ label: '新規格', price: 100, qty_limit: 3 }],
    },
  }, { token: admin });
  const after = (await rpc('get_public_product', { p_slug: p.slug })).data;
  ok(after.variants.length === 1 && after.variants[0].label === '新規格', '已有訂單的規格移除後，顧客看不到');
  const kept = (await rpc('admin_dashboard', {}, { token: admin })).data.stats.find((s) => s.variant_id === p.variantId);
  ok(kept?.qty === 2, '已移除規格的預購數量仍留在統計', kept);

  const del = await rpc('admin_delete_product', { p_id: p.id }, { token: admin });
  ok(del.status === 200 && del.data.removed_paths.length === 1, '刪除商品會回傳待清除照片', del);
  const gone = (await rpc('admin_list_orders', { p: { q: placed.data.order_no } }, { token: admin })).data.rows[0];
  ok(gone?.items[0].product_name === '測試商品', '刪除商品後訂單仍完整', gone);
  const stay = (await rpc('admin_dashboard', {}, { token: admin })).data.stats.find((s) => s.product_name === '測試商品' && s.variant_label === '白色 M' && s.variant_id === null);
  ok(stay?.qty >= 2, '刪除商品後統計仍保留', stay);
}

console.log('\n頻率限制');
{
  const p = await makeProduct(admin, { limit: 100 });
  const samePhone = phone();
  const res = [];
  for (let i = 0; i < 7; i++) res.push(await rpc('submit_preorder', order(p.variantId, 1, { customer_phone: samePhone })));
  ok(res.filter((r) => r.status === 200).length === 5 && res[6].data.hint === 'rate_limited', '同手機 10 分鐘最多 5 筆', res.map((r) => r.status));
  const ip = '203.0.113.9';
  const fromIp = [];
  for (let i = 0; i < 32; i++) fromIp.push(await rpc('submit_preorder', order(p.variantId), { ip }));
  ok(fromIp.filter((r) => r.status === 200).length === 30, '同網路來源 10 分鐘最多 30 筆', fromIp.map((r) => r.status).join());
}

console.log('\n設定');
{
  const saved = await rpc('admin_save_settings', { p: { shop_name: '小舖', shipping_fee: 60, notice: '注意' } }, { token: admin });
  ok(saved.status === 200, '管理員可修改運費');
  const p = await makeProduct(admin, { limit: 5, price: 100 });
  const r = await rpc('submit_preorder', order(p.variantId));
  ok(r.data.total === 160, '新運費套用到新訂單', r.data);
  await rpc('admin_save_settings', { p: { shop_name: '我的預購小舖', shipping_fee: 38, notice: '預購商品恕不接受無故取消。' } }, { token: admin });
}

console.log(`\n結果：通過 ${passed} 項，失敗 ${failures.length} 項`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
