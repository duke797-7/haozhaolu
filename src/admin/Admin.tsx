import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, currentEmail, hasSession, rpc, signIn, signOut } from '../api';
import { money } from '../format';
import { go, shopUrl } from '../router';
import type { Dashboard, Settings, VariantStat } from '../types';
import { Failure, Icon, Loading, copyText, useLoad, useToast, type IconName } from '../ui/kit';
import { OrdersPage } from './Orders';
import { ProductEditor } from './ProductEditor';
import { ProductsPage } from './Products';

function Login({ onDone, notice }: { onDone: () => void; notice: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page login">
      <div className="login-band">
        <span className="brand-mark" aria-hidden="true">
          預
        </span>
        <h1>預購管理</h1>
        <p>上架商品、接收預購、整理訂單</p>
      </div>
      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>密碼</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '登入中' : '登入'}
        </button>
      </form>
    </main>
  );
}

function groupStats(stats: VariantStat[]) {
  const groups = new Map<string, { name: string; total: number; rows: VariantStat[] }>();
  for (const row of stats) {
    const key = row.product_id ?? `deleted:${row.product_name}`;
    const group = groups.get(key) ?? { name: row.product_name, total: 0, rows: [] };
    group.rows.push(row);
    group.total += row.qty;
    groups.set(key, group);
  }
  return [...groups.values()];
}

const today = () =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' }).format(
    new Date()
  );

function Overview() {
  const { data, error, loading, reload } = useLoad(() => rpc<Dashboard>('admin_dashboard', {}, true), []);
  if (loading && !data) return <Loading />;
  if (error) return <Failure message={error} onRetry={reload} />;
  const d = data!;
  const groups = groupStats(d.stats);
  return (
    <>
      <header className="admin-band">
        <div>
          <h1 className="page-title">總覽</h1>
          <span className="admin-date">{today()}</span>
        </div>
      </header>
      <main className="page overview">
        <ul className="tally" data-testid="tally">
          <li className="tally-main">
            <a href="#/admin/orders">
              <strong>{d.pending_orders}</strong>
              <span>待整理訂單</span>
            </a>
          </li>
          <li>
            <a href="#/admin/orders">
              <strong>{d.today_orders}</strong>
              <span>今日新增訂單</span>
            </a>
          </li>
          <li>
            <a href="#/admin/products">
              <strong>{d.open_count}</strong>
              <span>預購中商品</span>
            </a>
          </li>
          <li>
            <a href="#/admin/products">
              <strong>{d.published_count}</strong>
              <span>已上架商品</span>
            </a>
          </li>
        </ul>

        <a href="#/admin/products/new" className="btn btn-primary btn-block overview-new">
          上架新商品
        </a>

        <h2 className="section-title">各商品預購數量</h2>
        {groups.length === 0 ? (
          <p className="empty">上架商品後，預購數量會顯示在這裡。</p>
        ) : (
          <div className="stats" data-testid="stats">
            {groups.map((group) => (
              <section key={group.name + group.rows[0].variant_label} className="stat-group">
                <h3>
                  <span>{group.name || '未命名商品'}</span>
                  <span className="stat-total">{group.total} 件</span>
                </h3>
                <ul>
                  {group.rows.map((row) => (
                    <li key={row.variant_id ?? row.variant_label}>
                      <div className="stat-line">
                        <span>{row.variant_label}</span>
                        <span>
                          <strong>{row.qty}</strong>
                          {row.qty_limit !== null && ` / ${row.qty_limit}`} 件
                        </span>
                      </div>
                      {row.qty_limit !== null && row.qty_limit > 0 && (
                        <div className="meter" aria-hidden="true">
                          <i style={{ width: `${Math.min(100, (row.qty / row.qty_limit) * 100)}%` }} />
                        </div>
                      )}
                      {row.qty > 0 && (
                        <p className="stat-sub">
                          {row.order_count} 筆訂單，商品金額 {money(row.amount)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function SettingsPage({ onSignedOut }: { onSignedOut: () => void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => rpc<Settings>('admin_get_settings', {}, true), []);
  const [form, setForm] = useState<(Omit<Settings, 'shipping_fee'> & { shipping_fee: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (data) setForm({ ...data, shipping_fee: String(data.shipping_fee) });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <Failure message={error} onRetry={reload} />;
  if (!form) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaveError('');
    try {
      await rpc('admin_save_settings', { p: { ...form, shipping_fee: Number(form.shipping_fee) } }, true);
      toast('已儲存設定');
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <h1 className="page-title">設定</h1>
      <form onSubmit={save}>
        <label className="field">
          <span>商店名稱</span>
          <input
            required
            maxLength={40}
            value={form.shop_name}
            onChange={(e) => setForm({ ...form, shop_name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>品牌標語（選填）</span>
          <input
            maxLength={60}
            placeholder="例如：日本選物，每月開團"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
          />
          <small>顯示在商店頁尾，沒有開團時也會顯示在首頁。</small>
        </label>
        <label className="field">
          <span>客服聯絡方式（選填）</span>
          <input
            maxLength={100}
            placeholder="例如：LINE ID 或 Email"
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
          />
          <small>會公開顯示在商店頁尾。</small>
        </label>
        <label className="field">
          <span>每筆訂單運費（元）</span>
          <input
            required
            type="number"
            min={0}
            inputMode="numeric"
            value={form.shipping_fee}
            onChange={(e) => setForm({ ...form, shipping_fee: e.target.value })}
          />
          <small>只影響新訂單，已成立的訂單金額不變。</small>
        </label>
        <label className="field">
          <span>預設預購注意事項</span>
          <textarea
            rows={4}
            value={form.notice}
            onChange={(e) => setForm({ ...form, notice: e.target.value })}
          />
          <small>商品沒有填寫自己的注意事項時，會顯示這段文字。</small>
        </label>
        {saveError && (
          <p className="error" role="alert">
            {saveError}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '儲存中' : '儲存設定'}
        </button>
      </form>

      <h2 className="section-title">商店網址</h2>
      <p className="muted break">{shopUrl()}</p>
      <button
        type="button"
        className="btn btn-quiet btn-block"
        onClick={async () => toast((await copyText(shopUrl())) ? '已複製網址' : '請長按網址複製')}
      >
        複製商店網址
      </button>

      <h2 className="section-title">加到手機主畫面</h2>
      <p className="muted">
        iPhone：用 Safari 開啟這一頁，點分享按鈕，選「加入主畫面」。
        <br />
        Android：用 Chrome 開啟這一頁，點右上角選單，選「安裝應用程式」或「加到主畫面」。
      </p>

      <h2 className="section-title">帳號</h2>
      <p className="muted">{currentEmail()}</p>
      <button
        type="button"
        className="btn btn-quiet btn-block"
        onClick={async () => {
          await signOut();
          onSignedOut();
        }}
      >
        登出
      </button>
    </main>
  );
}

const TABS: { key: string; label: string; icon: IconName }[] = [
  { key: '', label: '總覽', icon: 'home' },
  { key: 'products', label: '商品', icon: 'box' },
  { key: 'orders', label: '訂單', icon: 'receipt' },
  { key: 'settings', label: '設定', icon: 'gear' },
];

export function AdminApp({ route }: { route: string[] }) {
  const [state, setState] = useState<'checking' | 'signedOut' | 'ready'>(hasSession() ? 'checking' : 'signedOut');
  const [notice, setNotice] = useState('');
  const [offline, setOffline] = useState('');

  const verify = async () => {
    setState('checking');
    setOffline('');
    try {
      const allowed = await rpc<boolean>('is_admin', {}, true);
      if (allowed) {
        setNotice('');
        setState('ready');
      } else {
        await signOut();
        setNotice('這個帳號沒有管理權限');
        setState('signedOut');
      }
    } catch (e) {
      if ((e as ApiError).status === 401) {
        await signOut();
        setNotice('登入已過期，請重新登入');
        setState('signedOut');
      } else {
        setOffline((e as Error).message);
      }
    }
  };

  useEffect(() => {
    if (hasSession()) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (offline) return <Failure message={offline} onRetry={() => void verify()} />;
  if (state === 'checking') return <Loading />;
  if (state === 'signedOut') return <Login onDone={() => void verify()} notice={notice} />;

  const [section = '', sub] = route.slice(1);

  if (section === 'products' && sub) return <ProductEditor key={sub} id={sub === 'new' ? null : sub} />;

  return (
    <div className="admin">
      {section === '' && <Overview />}
      {section === 'products' && <ProductsPage />}
      {section === 'orders' && <OrdersPage />}
      {section === 'settings' && (
        <SettingsPage
          onSignedOut={() => {
            setNotice('');
            setState('signedOut');
            go('/admin');
          }}
        />
      )}
      <nav className="tabs" aria-label="管理選單">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={`#/admin${tab.key ? `/${tab.key}` : ''}`}
            aria-current={section === tab.key ? 'page' : undefined}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
