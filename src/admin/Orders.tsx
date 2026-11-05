import { useEffect, useState } from 'react';
import { rpc } from '../api';
import { dateTime, money } from '../format';
import type { AdminOrder, AdminProductRow, OrderPage, OrderStatus } from '../types';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../types';
import { Failure, Loading, useLoad, useToast } from '../ui/kit';

const PAGE_SIZE = 50;

function OrderCard({ order, onChanged }: { order: AdminOrder; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const change = async (status: OrderStatus) => {
    setBusy(true);
    try {
      await rpc('admin_set_order_status', { p_ids: [order.id], p_status: status }, true);
      toast(`已標記為${ORDER_STATUS_LABELS[status]}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <li className={`order order-${order.status}`} data-testid="order">
      <header>
        <strong className="order-no">{order.order_no}</strong>
        <time>{dateTime(order.created_at)}</time>
      </header>
      <p className="order-who">
        {order.customer_name}
        <a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>
      </p>
      <p className="muted break">{order.customer_email}</p>
      <p className={order.arrival_notified_at ? 'order-flag order-flag-on' : 'order-flag'}>
        {order.arrival_notified_at ? `已通知到貨 ${dateTime(order.arrival_notified_at)}` : '尚未通知到貨'}
      </p>
      <ul className="order-items">
        {order.items.map((item) => (
          <li key={`${item.product_name}-${item.variant_label}`}>
            <span>
              {item.product_name}（{item.variant_label}）× {item.qty}
            </span>
            <span>{money(item.line_total)}</span>
          </li>
        ))}
      </ul>
      <p className="order-total">
        <span>運費 {money(order.shipping_fee)}</span>
        <strong>合計 {money(order.total)}</strong>
      </p>
      {order.note && <p className="order-note pre">備註：{order.note}</p>}
      <label className="order-status">
        <span>訂單狀態</span>
        <select
          value={order.status}
          disabled={busy}
          onChange={(e) => void change(e.target.value as OrderStatus)}
        >
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

export function OrdersPage() {
  const [status, setStatus] = useState('');
  const [productId, setProductId] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(query), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => setLimit(PAGE_SIZE), [status, productId, search]);

  const products = useLoad(() => rpc<AdminProductRow[]>('admin_list_products', {}, true), []);
  const { data, error, loading, reload } = useLoad(
    () =>
      rpc<OrderPage>(
        'admin_list_orders',
        { p: { status, product_id: productId, q: search, limit, offset: 0 } },
        true
      ),
    [status, productId, search, limit]
  );

  return (
    <main className="page">
      <h1 className="page-title">
        訂單{data ? <span className="count"> {data.total} 筆</span> : null}
      </h1>

      <input
        className="search"
        type="search"
        placeholder="搜尋姓名、手機、Email 或訂單編號"
        aria-label="搜尋訂單"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="filters" role="group" aria-label="依訂單狀態篩選">
        <button type="button" aria-pressed={status === ''} onClick={() => setStatus('')}>
          全部
        </button>
        {ORDER_STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {ORDER_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <label className="field">
        <span>商品</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">全部商品</option>
          {products.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || '未命名商品'}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <Failure message={error} onRetry={reload} />
      ) : !data ? (
        loading && <Loading />
      ) : data.rows.length === 0 ? (
        <p className="empty">
          {status || productId || search ? '沒有符合條件的訂單。' : '還沒有訂單。把商品網址分享給顧客後，預購單會出現在這裡。'}
        </p>
      ) : (
        <>
          <ul className="orders">
            {data.rows.map((order) => (
              <OrderCard key={order.id} order={order} onChanged={reload} />
            ))}
          </ul>
          {data.rows.length < data.total && (
            <button
              type="button"
              className="btn btn-quiet btn-block"
              disabled={loading}
              onClick={() => setLimit((n) => Math.min(n + PAGE_SIZE, 200))}
            >
              載入更多
            </button>
          )}
        </>
      )}
    </main>
  );
}
