// 體驗版專用：和 ../api.ts 相同的介面，但資料只放在瀏覽器記憶體裡，不連任何雲端服務。
// 下單規則刻意和 supabase/schema.sql 相同，操作結果才會與正式版一致。

export const isConfigured = true;

export class ApiError extends Error {
  status: number;
  hint: string | null;

  constructor(message: string, status = 0, hint: string | null = null) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

const HOUR = 3600e3;
const iso = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function art(bg: string, fg: string, shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000"><defs><radialGradient id="b" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="${bg}" stop-opacity="0"/></radialGradient><filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="26" stdDeviation="26" flood-color="#1b2540" flood-opacity=".28"/></filter></defs><rect width="800" height="1000" fill="${bg}"/><rect width="800" height="1000" fill="url(#b)"/><rect y="840" width="800" height="160" fill="#000" opacity=".05"/><g fill="${fg}" filter="url(#s)">${shape}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SHIRT = '<path d="M290 230l-150 90 60 130 70-40v380h260V410l70 40 60-130-150-90c-30 50-190 50-220 0z"/>';
const TOTE = '<rect x="210" y="400" width="380" height="380" rx="14"/><path d="M300 400c0-210 200-210 200 0h-40c0-150-120-150-120 0z"/>';
const MUG = '<rect x="230" y="370" width="300" height="340" rx="36"/><path d="M530 440h60c70 0 70 200 0 200h-60v-46h52c24 0 24-108 0-108h-52z"/>';

const images: Record<string, string> = {
  'demo/shirt-white.jpg': art('#dfe7ee', '#ffffff', SHIRT),
  'demo/shirt-black.jpg': art('#c9d3dd', '#2b3345', SHIRT),
  'demo/tote.jpg': art('#e9dfcb', '#7a5c38', TOTE),
  'demo/mug.jpg': art('#cfe3dc', '#2f6f62', MUG),
};

interface Variant {
  id: string;
  label: string;
  price: number;
  qty_limit: number | null;
  archived: boolean;
}

interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  ship_estimate: string;
  notice: string;
  created_at: string;
  myship_url: string;
  images: { id: string; path: string }[];
  variants: Variant[];
}

interface Item {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_label: string;
  unit_price: number;
  qty: number;
  line_total: number;
}

interface Order {
  id: string;
  order_no: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  arrival_notified_at: string | null;
  note: string;
  items_total: number;
  shipping_fee: number;
  total: number;
  client_token: string;
  created_at: string;
  items: Item[];
}

const variant = (label: string, price: number, qty_limit: number | null): Variant => ({
  id: uuid(),
  label,
  price,
  qty_limit,
  archived: false,
});

const settings = {
  shop_name: '我的預購小舖',
  tagline: '好物先預購，到貨再付款',
  contact: 'LINE：範例帳號',
  shipping_fee: 38,
  notice: '預購商品恕不接受無故取消。商品到貨後會以 7-ELEVEN 賣貨便寄出，到店取貨時付款。',
};

const shirt: Product = {
  id: uuid(),
  slug: 'demo-shirt',
  name: '範例商品：棉麻寬版襯衫',
  description: '透氣棉麻，寬鬆版型，四季都好穿。\n洗後自然皺褶為正常現象。',
  status: 'published',
  starts_at: iso(-48),
  ends_at: iso(24 * 5 + 6),
  ship_estimate: '12 月中旬',
  notice: '',
  myship_url: '',
  created_at: iso(-50),
  images: [
    { id: uuid(), path: 'demo/shirt-white.jpg' },
    { id: uuid(), path: 'demo/shirt-black.jpg' },
  ],
  variants: [variant('白色 / M', 890, 20), variant('白色 / L', 890, 20), variant('黑色 / M', 990, 5), variant('黑色 / L', 990, 3)],
};

const tote: Product = {
  id: uuid(),
  slug: 'demo-tote',
  name: '範例商品：厚磅帆布托特包',
  description: '12 安士厚帆布，可放 A4 文件與水壺。',
  status: 'published',
  starts_at: iso(-200),
  ends_at: iso(-20),
  ship_estimate: '12 月初',
  notice: '',
  myship_url: '',
  created_at: iso(-210),
  images: [{ id: uuid(), path: 'demo/tote.jpg' }],
  variants: [variant('原色', 490, 30)],
};

const mug: Product = {
  id: uuid(),
  slug: 'demo-mug',
  name: '範例商品：手作陶瓷馬克杯',
  description: '小批量手作，每個紋路都略有不同。',
  status: 'draft',
  starts_at: iso(24),
  ends_at: iso(24 * 8),
  ship_estimate: '',
  notice: '',
  myship_url: '',
  created_at: iso(-3),
  images: [{ id: uuid(), path: 'demo/mug.jpg' }],
  variants: [variant('標準', 650, 40)],
};

let products: Product[] = [shirt, tote, mug];

function seedOrder(no: string, status: string, name: string, phone: string, email: string, picks: [Product, number, number][], hoursAgo: number, note = ''): Order {
  const items = picks.map(([p, index, qty]) => {
    const v = p.variants[index];
    return {
      product_id: p.id,
      variant_id: v.id,
      product_name: p.name,
      variant_label: v.label,
      unit_price: v.price,
      qty,
      line_total: v.price * qty,
    };
  });
  const items_total = items.reduce((sum, i) => sum + i.line_total, 0);
  return {
    id: uuid(),
    order_no: no,
    status,
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    arrival_notified_at: null,
    note,
    items_total,
    shipping_fee: settings.shipping_fee,
    total: items_total + settings.shipping_fee,
    client_token: uuid(),
    created_at: iso(-hoursAgo),
    items,
  };
}

let orders: Order[] = [
  seedOrder('261105-A1B2C3', 'new', '範例顧客甲', '0900000001', 'buyer1@example.com', [[shirt, 0, 2], [shirt, 2, 1]], 1, '週末才能取貨'),
  seedOrder('261105-D4E5F6', 'new', '範例顧客乙', '0900000002', 'buyer2@example.com', [[shirt, 3, 2]], 3),
  seedOrder('261104-0A7B8C', 'confirmed', '範例顧客丙', '0900000003', 'buyer3@example.com', [[shirt, 1, 1]], 27),
  seedOrder('261101-9D8E7F', 'closed', '範例顧客丁', '0900000004', 'buyer4@example.com', [[tote, 0, 3]], 100),
];

let signedIn = true;
let lastEmail = 'demo@example.com';

export const currentEmail = () => lastEmail;
export const hasSession = () => signedIn;

export async function signIn(email: string, password: string): Promise<void> {
  await wait();
  if (!email || !password) throw new ApiError('Email 或密碼不正確', 400);
  lastEmail = email;
  signedIn = true;
}

export async function signOut(): Promise<void> {
  signedIn = false;
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 120));
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fail = (message: string, hint: string | null = null): never => {
  throw new ApiError(message, 400, hint);
};

function ordered(variantId: string): number {
  let sum = 0;
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const i of o.items) if (i.variant_id === variantId) sum += i.qty;
  }
  return sum;
}

function phase(p: Product): string {
  const now = Date.now();
  if (p.starts_at && now < new Date(p.starts_at).getTime()) return 'upcoming';
  if (!p.ends_at || now >= new Date(p.ends_at).getTime()) return 'ended';
  return 'open';
}

const liveVariants = (p: Product) => p.variants.filter((v) => !v.archived);

function prices(p: Product) {
  const list = liveVariants(p).map((v) => v.price);
  return { min_price: list.length ? Math.min(...list) : null, max_price: list.length ? Math.max(...list) : null };
}

function adminRow(p: Product) {
  let qty = 0;
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const i of o.items) if (i.product_id === p.id) qty += i.qty;
  }
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    phase: phase(p),
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    cover: p.images[0]?.path ?? null,
    ...prices(p),
    variant_count: liveVariants(p).length,
    ordered_qty: qty,
  };
}

function stats() {
  const rows: Record<string, unknown>[] = [];
  const active = orders.filter((o) => o.status !== 'cancelled');
  const seen = new Set<string>();
  for (const p of [...products].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    for (const v of p.variants) {
      const lines = active.flatMap((o) => o.items.filter((i) => i.variant_id === v.id).map((i) => ({ i, o })));
      if (v.archived && lines.length === 0) continue;
      seen.add(v.id);
      rows.push({
        product_id: p.id,
        product_name: p.name,
        variant_id: v.id,
        variant_label: v.label,
        qty_limit: v.qty_limit,
        qty: lines.reduce((s, l) => s + l.i.qty, 0),
        order_count: new Set(lines.map((l) => l.o.id)).size,
        amount: lines.reduce((s, l) => s + l.i.line_total, 0),
      });
    }
  }
  const gone = new Map<string, Record<string, any>>();
  for (const o of active) {
    for (const i of o.items) {
      if (i.variant_id && seen.has(i.variant_id)) continue;
      const key = `${i.product_name}\n${i.variant_label}`;
      const row = gone.get(key) ?? {
        product_id: null,
        product_name: i.product_name,
        variant_id: null,
        variant_label: i.variant_label,
        qty_limit: null,
        qty: 0,
        order_count: 0,
        amount: 0,
      };
      row.qty += i.qty;
      row.order_count += 1;
      row.amount += i.line_total;
      gone.set(key, row);
    }
  }
  return [...rows, ...gone.values()];
}

function saveProduct(p: any) {
  const name = String(p.name ?? '').trim();
  const status = p.status ?? 'draft';
  const imgs: string[] = p.images ?? [];
  const vars: any[] = p.variants ?? [];
  if (p.starts_at && p.ends_at && new Date(p.ends_at) <= new Date(p.starts_at)) fail('結束時間要晚於開始時間');
  if (status === 'published') {
    if (!name) fail('上架前請填寫商品名稱');
    if (!imgs.length) fail('上架前請至少放一張照片');
    if (!vars.length) fail('上架前請至少設定一個規格');
    if (!p.ends_at) fail('上架前請設定預購結束時間');
  }

  let row = products.find((x) => x.id === p.id);
  if (!row) {
    row = {
      id: p.id,
      slug: uuid().replaceAll('-', '').slice(0, 10),
      name: '',
      description: '',
      status: 'draft',
      starts_at: null,
      ends_at: null,
      ship_estimate: '',
      notice: '',
      myship_url: '',
      created_at: new Date().toISOString(),
      images: [],
      variants: [],
    };
    products = [row, ...products];
  }

  const removed = row.images.map((i) => i.path).filter((path) => !imgs.includes(path));
  const keep = new Set(vars.map((v) => v.id).filter(Boolean));
  const hasOrders = (id: string) => orders.some((o) => o.items.some((i) => i.variant_id === id));

  const next: Variant[] = row.variants
    .filter((v) => !keep.has(v.id) && hasOrders(v.id))
    .map((v) => ({ ...v, archived: true }));
  for (const v of vars) {
    next.push({ id: v.id ?? uuid(), label: String(v.label).trim(), price: v.price, qty_limit: v.qty_limit, archived: false });
  }

  Object.assign(row, {
    name,
    description: p.description ?? '',
    status,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    ship_estimate: String(p.ship_estimate ?? '').trim(),
    notice: p.notice ?? '',
    images: imgs.map((path) => ({ id: uuid(), path })),
    variants: next,
  });
  return { id: row.id, slug: row.slug, removed_paths: removed };
}

function submit(p: any) {
  if (p.website) fail('無法送出預購單');
  const existing = orders.find((o) => o.client_token === p.client_token);
  if (existing) return receipt(existing);

  const name = String(p.customer_name ?? '').trim();
  const phone = String(p.customer_phone ?? '').replace(/\D/g, '');
  const email = String(p.customer_email ?? '').trim().toLowerCase();
  if (!name) fail('請填寫 50 字以內的取貨人姓名');
  if (!/^09\d{8}$/.test(phone)) fail('手機號碼格式不正確，請填寫 09 開頭的 10 碼號碼');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Email 格式不正確，請填寫收得到信的信箱');
  if (!p.privacy_accepted) fail('請先同意個人資料僅用於處理這筆預購');

  const items: Item[] = [];
  for (const line of p.items) {
    const product = products.find((x) => x.variants.some((v) => v.id === line.variant_id));
    const v = product?.variants.find((x) => x.id === line.variant_id);
    if (!product || !v || v.archived || product.status !== 'published') {
      return fail('選擇的商品已下架，請重新整理頁面', 'unavailable');
    }
    if (phase(product) === 'upcoming') fail(`「${product.name}」尚未開放預購`, 'unavailable');
    if (phase(product) === 'ended') fail(`「${product.name}」的預購已結束`, 'unavailable');
    if (v.qty_limit !== null && ordered(v.id) + line.qty > v.qty_limit) {
      fail(`「${v.label}」只剩 ${Math.max(v.qty_limit - ordered(v.id), 0)} 件，請調整數量`, 'sold_out');
    }
    items.push({
      product_id: product.id,
      variant_id: v.id,
      product_name: product.name,
      variant_label: v.label,
      unit_price: v.price,
      qty: line.qty,
      line_total: v.price * line.qty,
    });
  }

  const items_total = items.reduce((sum, i) => sum + i.line_total, 0);
  const total = items_total + settings.shipping_fee;
  if (p.expected_total !== undefined && p.expected_total !== total) {
    fail(`價格剛剛更新，合計已改為 NT$${total}，請確認後再送出`, 'price_changed');
  }

  const d = new Date(Date.now() + 8 * HOUR).toISOString();
  const order: Order = {
    id: uuid(),
    order_no: `${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${uuid().replaceAll('-', '').slice(0, 6).toUpperCase()}`,
    status: 'new',
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    arrival_notified_at: null,
    note: String(p.note ?? '').trim(),
    items_total,
    shipping_fee: settings.shipping_fee,
    total,
    client_token: p.client_token,
    created_at: new Date().toISOString(),
    items,
  };
  orders = [order, ...orders];
  return receipt(order);
}

function receipt(o: Order) {
  return {
    order_no: o.order_no,
    items_total: o.items_total,
    shipping_fee: o.shipping_fee,
    total: o.total,
    created_at: o.created_at,
    items: o.items.map(({ product_name, variant_label, unit_price, qty }) => ({ product_name, variant_label, unit_price, qty })),
  };
}

function setOrderStatus(ids: string[], status: string) {
  const targets = orders.filter((o) => ids.includes(o.id) && o.status !== status);
  if (status !== 'cancelled') {
    for (const o of targets) {
      if (o.status !== 'cancelled') continue;
      for (const i of o.items) {
        const v = products.flatMap((p) => p.variants).find((x) => x.id === i.variant_id);
        if (v?.qty_limit != null && ordered(v.id) + i.qty > v.qty_limit) {
          fail(`「${v.label}」的名額已被其他訂單使用，無法恢復這筆訂單`, 'sold_out');
        }
      }
    }
  }
  for (const o of targets) o.status = status;
  return { updated: targets.length };
}

function listOrders(p: any) {
  const q = String(p.q ?? '').trim().toLowerCase();
  const rows = orders
    .filter((o) => !p.status || o.status === p.status)
    .filter((o) => !p.product_id || o.items.some((i) => i.product_id === p.product_id))
    .filter((o) => !q || [o.order_no, o.customer_name, o.customer_phone, o.customer_email].some((x) => x.toLowerCase().includes(q)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { total: rows.length, rows: rows.slice(0, p.limit ?? 50) };
}

function call(fn: string, a: any): unknown {
  const today = new Date(Date.now() + 8 * HOUR).toISOString().slice(0, 10);
  switch (fn) {
    case 'is_admin':
      return signedIn;
    case 'get_shop_info':
      return { ...settings, server_now: new Date().toISOString() };
    case 'list_public_products':
      return products
        .filter((p) => p.status === 'published')
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          starts_at: p.starts_at,
          ends_at: p.ends_at,
          phase: phase(p),
          cover: p.images[0]?.path ?? null,
          ...prices(p),
          remaining: liveVariants(p).some((v) => v.qty_limit === null)
            ? null
            : liveVariants(p).reduce((sum, v) => sum + Math.max((v.qty_limit ?? 0) - ordered(v.id), 0), 0),
          sold_out: !liveVariants(p).some((v) => v.qty_limit === null || v.qty_limit > ordered(v.id)),
        }));
    case 'get_public_product': {
      const p = products.find((x) => x.slug === a.p_slug && x.status === 'published');
      if (!p) return null;
      return {
        ...p,
        phase: phase(p),
        variants: liveVariants(p).map((v) => ({
          id: v.id,
          label: v.label,
          price: v.price,
          remaining: v.qty_limit === null ? null : Math.max(v.qty_limit - ordered(v.id), 0),
        })),
        server_now: new Date().toISOString(),
      };
    }
    case 'submit_preorder':
      return submit(a.p);
    case 'admin_dashboard':
      return {
        published_count: products.filter((p) => p.status === 'published').length,
        open_count: products.filter((p) => p.status === 'published' && phase(p) === 'open').length,
        today_orders: orders.filter((o) => new Date(new Date(o.created_at).getTime() + 8 * HOUR).toISOString().slice(0, 10) === today).length,
        pending_orders: orders.filter((o) => o.status === 'new').length,
        stats: stats(),
      };
    case 'admin_list_products':
      return [...products].sort((x, y) => y.created_at.localeCompare(x.created_at)).map(adminRow);
    case 'admin_get_product': {
      const p = products.find((x) => x.id === a.p_id);
      if (!p) return null;
      return { ...p, variants: liveVariants(p).map((v) => ({ ...v, ordered: ordered(v.id) })) };
    }
    case 'admin_save_product':
      return saveProduct(a.p);
    case 'admin_set_product_status': {
      const p = products.find((x) => x.id === a.p_id);
      if (!p) return fail('找不到這個商品');
      const ends = a.p_ends_at ?? p.ends_at;
      if (a.p_status === 'published') {
        if (!p.name.trim()) fail('上架前請填寫商品名稱');
        if (!p.images.length) fail('上架前請至少放一張照片');
        if (!liveVariants(p).length) fail('上架前請至少設定一個規格');
        if (!ends) fail('上架前請設定預購結束時間');
      }
      p.status = a.p_status;
      p.ends_at = ends;
      return { id: p.id, status: p.status, ends_at: ends };
    }
    case 'admin_delete_product': {
      const p = products.find((x) => x.id === a.p_id);
      products = products.filter((x) => x.id !== a.p_id);
      const ids = new Set(p?.variants.map((v) => v.id));
      for (const o of orders) {
        for (const i of o.items) {
          if (i.product_id === a.p_id) i.product_id = null;
          if (i.variant_id && ids.has(i.variant_id)) i.variant_id = null;
        }
      }
      return { removed_paths: p?.images.map((i) => i.path) ?? [] };
    }
    case 'admin_list_orders':
      return listOrders(a.p ?? {});
    case 'admin_set_order_status':
      return setOrderStatus(a.p_ids, a.p_status);
    case 'admin_arrival_recipients': {
      const p = products.find((x) => x.id === a.p_id);
      if (!p) return null;
      const target = orders.filter((o) => o.status !== 'cancelled' && o.items.some((i) => i.product_id === p.id));
      const pending = target.filter((o) => !o.arrival_notified_at);
      return {
        name: p.name,
        myship_url: p.myship_url,
        order_ids: pending.map((o) => o.id),
        emails: [...new Set(pending.map((o) => o.customer_email).filter(Boolean))],
        notified_count: target.length - pending.length,
      };
    }
    case 'admin_set_myship_url': {
      const url = String(a.p_url ?? '').trim();
      if (url && !/^https:\/\//i.test(url)) fail('賣場連結要以 https:// 開頭');
      const p = products.find((x) => x.id === a.p_id);
      if (p) p.myship_url = url;
      return { myship_url: url };
    }
    case 'admin_mark_notified': {
      let updated = 0;
      for (const o of orders) {
        if (a.p_ids.includes(o.id) && !o.arrival_notified_at) {
          o.arrival_notified_at = new Date().toISOString();
          updated += 1;
        }
      }
      return { updated };
    }
    case 'admin_get_settings':
      return { ...settings };
    case 'admin_save_settings': {
      const name = String(a.p.shop_name ?? '').trim();
      if (!name) fail('請填寫商店名稱');
      if (!(a.p.shipping_fee >= 0)) fail('運費請填寫 0 以上的數字');
      Object.assign(settings, {
        shop_name: name,
        tagline: String(a.p.tagline ?? '').trim(),
        contact: String(a.p.contact ?? '').trim(),
        shipping_fee: a.p.shipping_fee,
        notice: a.p.notice ?? '',
      });
      return { ...settings };
    }
    default:
      throw new ApiError('操作沒有完成，請稍後再試', 404);
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  await wait();
  return copy(call(fn, args)) as T;
}

export const imageUrl = (path: string) => images[path] ?? '';

export async function uploadImage(path: string, blob: Blob): Promise<void> {
  images[path] = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError('照片上傳失敗，請再試一次'));
    reader.readAsDataURL(blob);
  });
}

export async function removeImages(paths: string[]): Promise<void> {
  for (const path of paths) delete images[path];
}
