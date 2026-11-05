import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, imageUrl, rpc, uuid } from '../api';
import { dateTime, money, priceRange, remainingText } from '../format';
import { go } from '../router';
import type { PublicCard, PublicProduct, PublicVariant, Receipt, ShopInfo } from '../types';
import { Failure, Icon, Loading, Stepper, copyText, useLoad, useToast } from '../ui/kit';

const PAYMENT_TEXT = '7-ELEVEN 賣貨便貨到付款';
const LAST_ORDER_KEY = 'preorder.lastOrder';
const MAX_PER_VARIANT = 99;

type Selection = Record<string, number>;

function useNow(serverNow: string | undefined) {
  const offset = useMemo(() => (serverNow ? new Date(serverNow).getTime() - Date.now() : 0), [serverNow]);
  const [now, setNow] = useState(Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const t = window.setInterval(() => setNow(Date.now() + offset), 15000);
    return () => window.clearInterval(t);
  }, [offset]);
  return now;
}

function currentPhase(p: PublicProduct, now: number) {
  if (p.starts_at && now < new Date(p.starts_at).getTime()) return 'upcoming';
  if (!p.ends_at || now >= new Date(p.ends_at).getTime()) return 'ended';
  return 'open';
}

/** 所有顧客頁共用的公告列、頁首與頁尾 */
function StoreChrome({ home, children }: { home?: boolean; children: ReactNode }) {
  const { data: shop } = useLoad(() => rpc<ShopInfo>('get_shop_info'), []);
  const name = shop?.shop_name ?? '';
  return (
    <div className="store">
      <p className="notice-bar">先預購不用付款，到貨後 7-ELEVEN 取貨付款</p>
      <header className="store-head">
        <a href="#/" className="brand" aria-label="回到商店首頁">
          <span className="brand-mark" aria-hidden="true">
            {name.slice(0, 1) || '預'}
          </span>
          {home ? <h1>{name || ' '}</h1> : <span className="brand-name">{name}</span>}
        </a>
        <a href="#/" className="store-nav">
          所有商品
        </a>
      </header>
      {children}
      <footer className="store-foot">
        <p className="foot-name">{name}</p>
        {shop?.tagline && <p>{shop.tagline}</p>}
        {shop?.contact && <p className="pre">客服聯絡：{shop.contact}</p>}
        <p className="foot-small">付款與配送皆使用 7-ELEVEN 賣貨便。顧客資料僅用於處理預購與出貨。</p>
      </footer>
    </div>
  );
}

function Tape({ product, now }: { product: PublicProduct; now: number }) {
  const phase = currentPhase(product, now);
  const soldOut = product.variants.every((v) => v.remaining === 0);
  let text = '預購已結束';
  if (phase === 'upcoming') text = `${dateTime(product.starts_at)} 開放預購`;
  else if (phase === 'open' && soldOut) text = '已額滿';
  else if (phase === 'open') text = `再 ${remainingText(new Date(product.ends_at!).getTime() - now)}結單`;
  return (
    <div className={`tape${phase === 'open' && !soldOut ? '' : ' tape-off'}`} data-testid="tape">
      {text}
    </div>
  );
}

function Gallery({ product, now }: { product: PublicProduct; now: number }) {
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const onScroll = () => {
    const el = ref.current;
    if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const show = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' });
    setIndex(i);
  };
  return (
    <>
      <div className="gallery">
        <div className="gallery-track" ref={ref} onScroll={onScroll} tabIndex={0} aria-label="商品照片，可左右滑動">
          {product.images.map((img, i) => (
            <img
              key={img.id}
              src={imageUrl(img.path)}
              alt={`${product.name} 第 ${i + 1} 張照片`}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
        {product.images.length > 1 && (
          <span className="gallery-count">
            {index + 1} / {product.images.length}
          </span>
        )}
        <Tape product={product} now={now} />
      </div>
      {product.images.length > 1 && (
        <div className="thumbs" role="group" aria-label="切換商品照片">
          {product.images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              aria-label={`看第 ${i + 1} 張照片`}
              aria-current={i === index}
              onClick={() => show(i)}
            >
              <img src={imageUrl(img.path)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function VariantRow({
  variant,
  qty,
  disabled,
  onChange,
}: {
  variant: PublicVariant;
  qty: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const left = variant.remaining;
  const soldOut = left === 0;
  const max = Math.min(left ?? MAX_PER_VARIANT, MAX_PER_VARIANT);
  return (
    <li className={`variant${soldOut ? ' variant-out' : ''}${qty > 0 ? ' variant-on' : ''}`}>
      <div className="variant-text">
        <strong>{variant.label}</strong>
        <span className="variant-price">{money(variant.price)}</span>
        {soldOut && <span className="variant-left">已額滿</span>}
        {!soldOut && left !== null && left <= 10 && <span className="variant-left">剩 {left} 件</span>}
      </div>
      {!soldOut && !disabled && <Stepper value={qty} max={max} onChange={onChange} label={variant.label} />}
    </li>
  );
}

function Terms({ product, shop }: { product: PublicProduct; shop: ShopInfo }) {
  const notice = product.notice.trim() || shop.notice;
  return (
    <dl className="terms">
      <div>
        <dt>付款方式</dt>
        <dd>{PAYMENT_TEXT}</dd>
      </div>
      <div>
        <dt>運費</dt>
        <dd>{money(shop.shipping_fee)}</dd>
      </div>
      <div>
        <dt>預計出貨</dt>
        <dd>{product.ship_estimate || '結單後另行通知'}</dd>
      </div>
      <div>
        <dt>預購期限</dt>
        <dd>
          {product.starts_at ? `${dateTime(product.starts_at)} 至 ` : '至 '}
          {dateTime(product.ends_at)}
        </dd>
      </div>
      {notice && (
        <div>
          <dt>注意事項</dt>
          <dd className="pre">{notice}</dd>
        </div>
      )}
    </dl>
  );
}

function Totals({ items, fee }: { items: number; fee: number }) {
  return (
    <dl className="totals">
      <div>
        <dt>商品金額</dt>
        <dd>{money(items)}</dd>
      </div>
      <div>
        <dt>運費</dt>
        <dd>{money(fee)}</dd>
      </div>
      <div className="totals-sum">
        <dt>合計（取貨時付款）</dt>
        <dd data-testid="grand-total">{money(items + fee)}</dd>
      </div>
    </dl>
  );
}

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const labels = ['選擇商品', '填預購單', '預購完成'];
  return (
    <ol className="steps" aria-label="預購進度">
      {labels.map((label, i) => (
        <li key={label} aria-current={current === i + 1 ? 'step' : undefined} className={i + 1 <= current ? 'done' : ''}>
          <span>{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function OrderSlip({
  product,
  shop,
  selection,
  onBack,
  onStale,
}: {
  product: PublicProduct;
  shop: ShopInfo;
  selection: Selection;
  onBack: () => void;
  onStale: () => void;
}) {
  const toast = useToast();
  const lines = product.variants.filter((v) => selection[v.id] > 0);
  const itemsTotal = lines.reduce((sum, v) => sum + v.price * selection[v.id], 0);
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '', website: '' });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const token = useRef(uuid()); // 同一張單重送時沿用，資料庫才能辨識為同一筆

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const receipt = await rpc<Receipt>('submit_preorder', {
        p: {
          client_token: token.current,
          customer_name: form.name,
          customer_phone: form.phone,
          customer_email: form.email,
          note: form.note,
          website: form.website,
          privacy_accepted: agreed,
          expected_total: itemsTotal + shop.shipping_fee,
          items: lines.map((v) => ({ variant_id: v.id, qty: selection[v.id] })),
        },
      });
      try {
        sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ receipt, slug: product.slug }));
      } catch {
        // 無法暫存時，成功畫面仍會顯示下方的記憶體備份。
      }
      lastOrderMemory = { receipt, slug: product.slug, email: form.email.trim() };
      go('/thanks');
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message);
      if (['sold_out', 'price_changed', 'unavailable'].includes(apiError.hint ?? '')) {
        token.current = uuid();
        toast(apiError.message); // 規格售完時會自動回商品頁，用提示留住原因
        onStale();
      }
      setBusy(false);
    }
  };

  return (
    <main className="page page-slip">
      <Steps current={2} />
      <button type="button" className="link-back" onClick={onBack}>
        返回商品
      </button>
      <form className="slip" onSubmit={submit}>
        <h1>預購單</h1>
        <p className="slip-product">{product.name}</p>

        <ul className="slip-lines">
          {lines.map((v) => (
            <li key={v.id}>
              <span>
                {v.label} × {selection[v.id]}
              </span>
              <span>{money(v.price * selection[v.id])}</span>
            </li>
          ))}
        </ul>

        <Totals items={itemsTotal} fee={shop.shipping_fee} />

        <dl className="slip-facts">
          <div>
            <dt>付款方式</dt>
            <dd>{PAYMENT_TEXT}</dd>
          </div>
          <div>
            <dt>預計出貨</dt>
            <dd>{product.ship_estimate || '結單後另行通知'}</dd>
          </div>
        </dl>

        <label className="field">
          <span>取貨人姓名</span>
          <input required maxLength={50} autoComplete="name" value={form.name} onChange={set('name')} />
          <small>取貨時要出示證件，請填真實姓名</small>
        </label>
        <label className="field">
          <span>手機號碼</span>
          <input
            required
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            pattern="09[0-9\- ]{8,12}"
            title="請填寫 09 開頭的 10 碼手機號碼"
            placeholder="0912345678"
            value={form.phone}
            onChange={set('phone')}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            required
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            placeholder="name@example.com"
            value={form.email}
            onChange={set('email')}
          />
          <small>請填你收得到信的信箱，到貨通知和賣貨便下單連結會寄到這裡。</small>
        </label>
        <label className="field">
          <span>備註（選填）</span>
          <textarea rows={2} maxLength={300} value={form.note} onChange={set('note')} />
        </label>

        {/* 給機器人的隱藏欄位，真人看不到也不會填 */}
        <label className="trap" aria-hidden="true">
          網站
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
        </label>

        <label className="check">
          <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>我同意姓名、手機與 Email 僅用於處理這筆預購、到貨通知與出貨。</span>
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || lines.length === 0}>
          {busy ? '送出中' : '送出預購單'}
        </button>
        <p className="slip-foot">這裡只登記預購，不會收款。</p>
      </form>
    </main>
  );
}

let lastOrderMemory: { receipt: Receipt; slug: string; email?: string } | null = null;

export function Thanks() {
  const toast = useToast();
  let saved = lastOrderMemory;
  if (!saved) {
    try {
      const raw = sessionStorage.getItem(LAST_ORDER_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
  }
  if (!saved) {
    return (
      <StoreChrome>
        <main className="page">
          <Failure message="找不到這筆預購紀錄。" />
          <a className="btn btn-quiet btn-block" href="#/">
            逛逛其他商品
          </a>
        </main>
      </StoreChrome>
    );
  }
  const { receipt, slug, email } = saved;
  return (
    <StoreChrome>
      <main className="page page-slip">
        <Steps current={3} />
        <section className="slip">
          <h1>預購成功</h1>
          <p className="thanks-label">訂單編號</p>
          <p className="thanks-no" data-testid="order-no">
            {receipt.order_no}
          </p>
          <button
            type="button"
            className="btn btn-quiet btn-block"
            onClick={async () => toast((await copyText(receipt.order_no)) ? '已複製訂單編號' : '請長按編號複製')}
          >
            複製訂單編號
          </button>
          <ul className="slip-lines">
            {receipt.items.map((item) => (
              <li key={`${item.product_name}-${item.variant_label}`}>
                <span>
                  {item.product_name}（{item.variant_label}）× {item.qty}
                </span>
                <span>{money(item.unit_price * item.qty)}</span>
              </li>
            ))}
          </ul>
          <Totals items={receipt.items_total} fee={receipt.shipping_fee} />
          <h2 className="next-title">接下來</h2>
          <ol className="next-steps">
            <li>請截圖保存訂單編號。</li>
            <li>商品到貨後，我們會寄 Email{email ? ` 到 ${email}` : ''}。</li>
            <li>依信中的賣貨便連結完成下單並選擇取貨門市，到店取貨時付款。</li>
          </ol>
        </section>
        <a className="btn btn-quiet btn-block" href={`#/p/${encodeURIComponent(slug)}`}>
          回到商品
        </a>
      </main>
    </StoreChrome>
  );
}

export function ProductRoute({ slug, step }: { slug: string; step?: string }) {
  const { data, error, loading, reload } = useLoad(
    () =>
      Promise.all([
        rpc<PublicProduct | null>('get_public_product', { p_slug: slug }),
        rpc<ShopInfo>('get_shop_info'),
      ]),
    [slug]
  );
  const [selection, setSelection] = useState<Selection>({});
  const product = data?.[0] ?? null;
  const shop = data?.[1];
  const now = useNow(product?.server_now);

  // 重新載入後，把選購數量限制在最新的剩餘數量內。
  useEffect(() => {
    if (!product) return;
    setSelection((prev) => {
      const next: Selection = {};
      for (const v of product.variants) {
        if (prev[v.id]) next[v.id] = Math.min(prev[v.id], v.remaining ?? MAX_PER_VARIANT);
      }
      return next;
    });
    if (product.variants.length === 1 && product.variants[0].remaining !== 0) {
      setSelection((prev) => (prev[product.variants[0].id] ? prev : { [product.variants[0].id]: 1 }));
    }
  }, [product]);

  // 重新整理或商品額滿後，預購單沒有可送出的內容，回到商品頁重新選擇。
  const selectedCount = Object.values(selection).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (step === 'order' && product && selectedCount === 0) {
      history.replaceState(null, '', `#/p/${encodeURIComponent(slug)}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }, [step, product, selectedCount, slug]);

  if (loading && !data) return <Loading />;
  if (error) return <Failure message={error} onRetry={reload} />;
  if (!product || !shop) {
    return (
      <StoreChrome>
        <main className="page">
          <Failure message="這個商品目前沒有開放預購。" />
          <a className="btn btn-quiet btn-block" href="#/">
            看看其他商品
          </a>
        </main>
      </StoreChrome>
    );
  }

  const phase = currentPhase(product, now);
  const canOrder = phase === 'open';
  const count = selectedCount;
  const itemsTotal = product.variants.reduce((sum, v) => sum + v.price * (selection[v.id] ?? 0), 0);
  const allOut = product.variants.every((v) => v.remaining === 0);

  if (step === 'order' && count > 0 && canOrder) {
    return (
      <StoreChrome>
        <OrderSlip
          product={product}
          shop={shop}
          selection={selection}
          onBack={() => go(`/p/${encodeURIComponent(slug)}`)}
          onStale={reload}
        />
      </StoreChrome>
    );
  }

  return (
    <StoreChrome>
      <div className="product">
        <nav className="crumbs" aria-label="目前位置">
          <a href="#/">所有商品</a>
          <span aria-hidden="true">/</span>
          <span className="crumb-now">{product.name}</span>
        </nav>
        <Gallery product={product} now={now} />
        <main className="page product-body">
          <h1 className="product-name">{product.name}</h1>
          <p className="product-price">
            {priceRange(
              Math.min(...product.variants.map((v) => v.price)),
              Math.max(...product.variants.map((v) => v.price))
            )}
          </p>

          <ul className="perks">
            <li>
              <Icon name="wallet" />
              先預購不用付款
            </li>
            <li>
              <Icon name="mail" />
              到貨 Email 通知
            </li>
            <li>
              <Icon name="store" />
              7-ELEVEN 取貨付款
            </li>
          </ul>

          <h2 className="section-title">{product.variants.length > 1 ? '選擇規格與數量' : '選擇數量'}</h2>
          <ul className="variants">
            {product.variants.map((v) => (
              <VariantRow
                key={v.id}
                variant={v}
                qty={selection[v.id] ?? 0}
                disabled={!canOrder}
                onChange={(next) => setSelection((s) => ({ ...s, [v.id]: next }))}
              />
            ))}
          </ul>

          {product.description && (
            <>
              <h2 className="section-title">商品介紹</h2>
              <p className="product-desc pre">{product.description}</p>
            </>
          )}

          <h2 className="section-title">預購資訊</h2>
          <Terms product={product} shop={shop} />
        </main>

        <div className="buybar">
          {canOrder && !allOut ? (
            <>
              {count > 0 ? (
                <div className="buybar-sum">
                  <span>
                    商品 {money(itemsTotal)}＋運費 {money(shop.shipping_fee)}
                  </span>
                  <strong>{money(itemsTotal + shop.shipping_fee)}</strong>
                </div>
              ) : (
                <p className="buybar-hint">先選擇規格與數量</p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={count === 0}
                onClick={() => go(`/p/${encodeURIComponent(slug)}/order`)}
              >
                填寫預購單
              </button>
            </>
          ) : (
            <p className="buybar-closed">
              {allOut && phase === 'open' ? '這個商品已額滿' : phase === 'upcoming' ? '尚未開放預購' : '預購已結束'}
            </p>
          )}
        </div>
      </div>
    </StoreChrome>
  );
}

function ProductCard({ card, now }: { card: PublicCard; now: number }) {
  const flag =
    card.phase === 'upcoming' ? '即將開放' : card.phase === 'ended' ? '已結單' : card.sold_out ? '已額滿' : '';
  const left = card.ends_at ? new Date(card.ends_at).getTime() - now : 0;
  return (
    <li>
      <a href={`#/p/${encodeURIComponent(card.slug)}`} className="shop-card">
        <span className="shop-photo">
          {card.cover && <img src={imageUrl(card.cover)} alt="" loading="lazy" />}
          {flag && <span className="shop-flag">{flag}</span>}
        </span>
        <span className="shop-title">{card.name}</span>
        <span className="shop-price">{priceRange(card.min_price, card.max_price)}</span>
        {card.phase === 'open' && !card.sold_out && (
          <span className="shop-clock">
            再 {remainingText(left)}結單
            {card.remaining !== null && card.remaining <= 10 && `，剩 ${card.remaining} 件`}
          </span>
        )}
      </a>
    </li>
  );
}

function Hero({ card, shop, now }: { card: PublicCard | undefined; shop: ShopInfo; now: number }) {
  if (!card) {
    return (
      <section className="hero hero-plain">
        <h2>{shop.tagline || '喜歡的商品，先預購再取貨付款'}</h2>
        <p>新的預購商品準備中，開放後會在這裡看到。</p>
      </section>
    );
  }
  return (
    <section className="hero" aria-label="本檔主打">
      <a href={`#/p/${encodeURIComponent(card.slug)}`} className="hero-link">
        <span className="hero-photo">
          {card.cover && <img src={imageUrl(card.cover)} alt="" />}
          {card.ends_at && (
            <span className="tape hero-tape">再 {remainingText(new Date(card.ends_at).getTime() - now)}結單</span>
          )}
        </span>
        <span className="hero-panel">
          <span className="hero-label">本檔主打</span>
          <span className="hero-name">{card.name}</span>
          <span className="hero-buy">
            <span className="hero-price">{priceRange(card.min_price, card.max_price)}</span>
            <span className="hero-cta">立即預購</span>
          </span>
        </span>
      </a>
    </section>
  );
}

function Shelf({ title, cards, now }: { title: string; cards: PublicCard[]; now: number }) {
  if (cards.length === 0) return null;
  return (
    <section className="shelf">
      <h2>{title}</h2>
      <ul className="shop-grid">
        {cards.map((c) => (
          <ProductCard key={c.slug} card={c} now={now} />
        ))}
      </ul>
    </section>
  );
}

export function ShopHome() {
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([rpc<PublicCard[]>('list_public_products'), rpc<ShopInfo>('get_shop_info')]),
    []
  );
  const now = useNow(data?.[1].server_now);
  const body = (() => {
    if (loading && !data) return <Loading />;
    if (error) return <Failure message={error} onRetry={reload} />;
    const [cards, shop] = data!;
    const open = cards.filter((c) => c.phase === 'open' && !c.sold_out);
    const featured = [...open].sort((a, b) => (a.ends_at ?? '').localeCompare(b.ends_at ?? ''))[0];
    return (
      <>
        <Hero card={featured} shop={shop} now={now} />
        <main className="store-main">
          <Shelf title="預購中" cards={cards.filter((c) => c.phase === 'open')} now={now} />
          <Shelf title="即將開放" cards={cards.filter((c) => c.phase === 'upcoming')} now={now} />
          <Shelf title="已結單" cards={cards.filter((c) => c.phase === 'ended')} now={now} />
          {cards.length === 0 && <p className="empty">目前沒有開放中的預購商品。</p>}
        </main>
        <section className="how">
          <h2>怎麼預購</h2>
          <ol>
            <li>
              <strong>選好商品送出預購單</strong>
              <span>這一步不用付款，名額會先幫你保留。</span>
            </li>
            <li>
              <strong>到貨後收到 Email 通知</strong>
              <span>信中會附上賣貨便下單連結。</span>
            </li>
            <li>
              <strong>到 7-ELEVEN 取貨付款</strong>
              <span>每筆運費 {money(shop.shipping_fee)}，取貨時一起付款。</span>
            </li>
          </ol>
        </section>
        {shop.notice && (
          <section className="faq">
            <h2>預購須知</h2>
            <p className="pre">{shop.notice}</p>
          </section>
        )}
      </>
    );
  })();
  return <StoreChrome home>{body}</StoreChrome>;
}
