export type Phase = 'upcoming' | 'open' | 'ended';
export type ProductStatus = 'draft' | 'published' | 'hidden';
export type OrderStatus = 'new' | 'confirmed' | 'closed' | 'processing' | 'shipped' | 'completed' | 'cancelled';

export interface ShopInfo {
  shop_name: string;
  tagline: string;
  contact: string;
  shipping_fee: number;
  notice: string;
  server_now: string;
}

export interface PublicCard {
  slug: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  phase: Phase;
  cover: string | null;
  min_price: number | null;
  max_price: number | null;
  remaining: number | null;
  sold_out: boolean;
}

export interface PublicVariant {
  id: string;
  label: string;
  price: number;
  remaining: number | null;
}

export interface PublicProduct {
  slug: string;
  name: string;
  description: string;
  starts_at: string | null;
  ends_at: string | null;
  phase: Phase;
  ship_estimate: string;
  notice: string;
  images: { id: string; path: string }[];
  variants: PublicVariant[];
  server_now: string;
}

export interface Receipt {
  order_no: string;
  items_total: number;
  shipping_fee: number;
  total: number;
  created_at: string;
  items: { product_name: string; variant_label: string; unit_price: number; qty: number }[];
}

export interface AdminProductRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  phase: Phase;
  starts_at: string | null;
  ends_at: string | null;
  cover: string | null;
  min_price: number | null;
  max_price: number | null;
  variant_count: number;
  ordered_qty: number;
}

export interface AdminVariant {
  id: string;
  label: string;
  price: number;
  qty_limit: number | null;
  ordered: number;
}

export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: ProductStatus;
  starts_at: string | null;
  ends_at: string | null;
  ship_estimate: string;
  notice: string;
  images: { id: string; path: string }[];
  variants: AdminVariant[];
}

export interface VariantStat {
  product_id: string | null;
  product_name: string;
  variant_id: string | null;
  variant_label: string;
  qty_limit: number | null;
  qty: number;
  order_count: number;
  amount: number;
}

export interface Dashboard {
  published_count: number;
  open_count: number;
  today_orders: number;
  pending_orders: number;
  stats: VariantStat[];
}

export interface AdminOrder {
  id: string;
  order_no: string;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  arrival_notified_at: string | null;
  note: string;
  items_total: number;
  shipping_fee: number;
  total: number;
  created_at: string;
  items: { product_name: string; variant_label: string; unit_price: number; qty: number; line_total: number }[];
}

export interface ArrivalList {
  name: string;
  myship_url: string;
  order_ids: string[];
  emails: string[];
  notified_count: number;
}

export interface OrderPage {
  total: number;
  rows: AdminOrder[];
}

export interface Settings {
  shop_name: string;
  tagline: string;
  contact: string;
  shipping_fee: number;
  notice: string;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: '新訂單',
  confirmed: '已確認',
  closed: '已結單',
  processing: '處理中',
  shipped: '已出貨',
  completed: '已完成',
  cancelled: '已取消',
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];
