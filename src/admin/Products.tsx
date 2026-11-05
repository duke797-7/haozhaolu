import { useState } from 'react';
import { imageUrl, rpc } from '../api';
import { dateTime, fromInput, hoursFromNow, priceRange } from '../format';
import { go, productUrl } from '../router';
import type { AdminProductRow, ArrivalList } from '../types';
import { Dialog, Failure, Loading, copyText, shareLink, useLoad, useToast } from '../ui/kit';

function statusText(p: AdminProductRow): { text: string; tone: string } {
  if (p.status === 'draft') return { text: '草稿', tone: 'quiet' };
  if (p.status === 'hidden') return { text: '已下架', tone: 'quiet' };
  if (p.phase === 'upcoming') return { text: '即將開放', tone: 'wait' };
  if (p.phase === 'ended') return { text: '已結束', tone: 'stop' };
  return { text: '預購中', tone: 'live' };
}

export function ReopenDialog({
  product,
  onClose,
  onDone,
}: {
  product: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(hoursFromNow(24 * 7));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const reopen = async () => {
    const endsAt = fromInput(value);
    if (!endsAt || new Date(endsAt).getTime() <= Date.now()) {
      setError('結束時間要晚於現在');
      return;
    }
    setBusy(true);
    try {
      await rpc('admin_set_product_status', { p_id: product.id, p_status: 'published', p_ends_at: endsAt }, true);
      toast('已重新開放預購');
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="重新開放預購" onClose={onClose}>
      <p className="dialog-body">{product.name}</p>
      <label className="field">
        <span>新的結束時間（台灣時間）</span>
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          返回
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={reopen}>
          重新開放
        </button>
      </div>
    </Dialog>
  );
}

function arrivalMessage(name: string, url: string): string {
  return `您好，您預購的「${name}」已經到貨。\n\n請開啟下方的賣貨便連結，完成下單並選擇取貨門市，到店取貨時付款：\n${url || '（請貼上賣貨便賣場連結）'}\n\n謝謝您的預購。`;
}

const MAILTO_LIMIT = 1800; // 網址太長時，手機郵件 App 可能開不起來

function ArrivalDialog({
  product,
  onClose,
  onDone,
}: {
  product: AdminProductRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data, error, loading } = useLoad(
    () => rpc<ArrivalList>('admin_arrival_recipients', { p_id: product.id }, true),
    [product.id]
  );
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  const link = url ?? data?.myship_url ?? '';
  const subject = `【到貨通知】${product.name}`;
  const body = arrivalMessage(product.name, link);
  const emails = data?.emails ?? [];
  const mailto = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const canMail = emails.length > 0 && link !== '' && mailto.length <= MAILTO_LIMIT;

  const copy = async (text: string, done: string) => toast((await copyText(text)) ? done : '請長按文字複製');

  const markDone = async () => {
    if (!data) return;
    setBusy(true);
    setSaveError('');
    try {
      await rpc('admin_set_myship_url', { p_id: product.id, p_url: link }, true);
      await rpc('admin_mark_notified', { p_ids: data.order_ids }, true);
      toast(`已標記 ${data.order_ids.length} 筆訂單為已通知`);
      onDone();
    } catch (e) {
      setSaveError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="通知顧客到貨" onClose={onClose}>
      <p className="dialog-body">{product.name}</p>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <p className="arrival-count" data-testid="arrival-count">
            待通知 {data!.order_ids.length} 筆訂單，{emails.length} 個 Email
            {data!.notified_count > 0 && `（已通知 ${data!.notified_count} 筆）`}
          </p>
          {data!.order_ids.length > 0 && (
            <>
              <label className="field">
                <span>賣貨便賣場連結</span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://myship.7-11.com.tw/..."
                  value={link}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <p className="arrival-preview pre" data-testid="arrival-preview">
                {body}
              </p>
              {canMail ? (
                <a className="btn btn-primary btn-block" href={mailto}>
                  開啟郵件寄送
                </a>
              ) : (
                <p className="muted arrival-hint">
                  {link === '' ? '貼上賣場連結後即可寄送。' : '人數較多，請用下方按鈕複製到信箱寄送。'}
                </p>
              )}
              <p className="muted arrival-hint">收件人會放在密件副本，顧客看不到彼此的 Email。</p>
              <div className="dialog-actions">
                <button type="button" className="btn btn-quiet" onClick={() => void copy(emails.join(', '), '已複製 Email 名單')}>
                  複製名單
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => void copy(body, '已複製通知內容')}>
                  複製內容
                </button>
              </div>
              {saveError && (
                <p className="error" role="alert">
                  {saveError}
                </p>
              )}
              <button
                type="button"
                className="btn btn-quiet btn-block"
                disabled={busy || link === ''}
                onClick={() => void markDone()}
              >
                寄出後標記為已通知
              </button>
            </>
          )}
        </>
      )}
      <button type="button" className="btn btn-quiet btn-block" onClick={onClose}>
        關閉
      </button>
    </Dialog>
  );
}

export function ProductsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(
    () => rpc<AdminProductRow[]>('admin_list_products', {}, true),
    []
  );
  const [reopening, setReopening] = useState<AdminProductRow | null>(null);
  const [notifying, setNotifying] = useState<AdminProductRow | null>(null);
  const [busyId, setBusyId] = useState('');

  if (loading && !data) return <Loading />;
  if (error) return <Failure message={error} onRetry={reload} />;

  const setStatus = async (p: AdminProductRow, status: 'published' | 'hidden') => {
    setBusyId(p.id);
    try {
      await rpc('admin_set_product_status', { p_id: p.id, p_status: status }, true);
      toast(status === 'hidden' ? '已下架' : '已上架');
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
    setBusyId('');
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">商品</h1>
        <a href="#/admin/products/new" className="btn btn-primary btn-small">
          上架新商品
        </a>
      </div>

      {data!.length === 0 ? (
        <p className="empty">還沒有商品。按「上架新商品」，選幾張照片就能開始。</p>
      ) : (
        <ul className="product-rows">
          {data!.map((p) => {
            const status = statusText(p);
            const canShare = p.status === 'published';
            return (
              <li key={p.id} className="product-row" data-testid="product-row">
                <button type="button" className="product-row-main" onClick={() => go(`/admin/products/${p.id}`)}>
                  {p.cover ? <img src={imageUrl(p.cover)} alt="" /> : <span className="thumb-empty">無照片</span>}
                  <span className="product-row-text">
                    <strong>{p.name || '未命名商品'}</strong>
                    <span className={`chip chip-${status.tone}`}>{status.text}</span>
                    <span className="muted">
                      {priceRange(p.min_price, p.max_price)}，已預購 {p.ordered_qty} 件
                    </span>
                    {p.ends_at && <span className="muted">結單 {dateTime(p.ends_at)}</span>}
                  </span>
                </button>
                <div className="product-row-actions">
                  {p.ordered_qty > 0 && (
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => setNotifying(p)}>
                      通知到貨
                    </button>
                  )}
                  {canShare && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-small"
                      onClick={() => void shareLink(p.name, productUrl(p.slug), toast)}
                    >
                      分享網址
                    </button>
                  )}
                  {p.status === 'published' && p.phase === 'ended' && (
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => setReopening(p)}>
                      重新開放
                    </button>
                  )}
                  {p.status === 'published' && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-small"
                      disabled={busyId === p.id}
                      onClick={() => void setStatus(p, 'hidden')}
                    >
                      下架
                    </button>
                  )}
                  {p.status === 'hidden' && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-small"
                      disabled={busyId === p.id}
                      onClick={() => (p.phase === 'ended' ? setReopening(p) : void setStatus(p, 'published'))}
                    >
                      {p.phase === 'ended' ? '重新開放' : '重新上架'}
                    </button>
                  )}
                  {p.status === 'draft' && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-small"
                      onClick={() => go(`/admin/products/${p.id}`)}
                    >
                      繼續編輯
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {notifying && (
        <ArrivalDialog
          product={notifying}
          onClose={() => setNotifying(null)}
          onDone={() => {
            setNotifying(null);
            reload();
          }}
        />
      )}
      {reopening && (
        <ReopenDialog
          product={reopening}
          onClose={() => setReopening(null)}
          onDone={() => {
            setReopening(null);
            reload();
          }}
        />
      )}
    </main>
  );
}
