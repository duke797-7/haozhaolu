// 金額與時間格式。時間一律以台灣時間（UTC+8，無日光節約）顯示與輸入，
// 不受手機時區設定影響。

const TZ_OFFSET = 8 * 3600e3;

export const money = (n: number) => `NT$${n.toLocaleString('zh-TW')}`;

export function priceRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return '尚未定價';
  return min === max ? money(min) : `${money(min)} 起`;
}

function parts(iso: string) {
  const d = new Date(new Date(iso).getTime() + TZ_OFFSET);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

export function dateTime(iso: string | null): string {
  if (!iso) return '未設定';
  const p = parts(iso);
  return `${p.y}/${p.m}/${p.d} ${p.time}`;
}

export function shortDateTime(iso: string): string {
  const p = parts(iso);
  return `${p.m}/${p.d} ${p.time}`;
}

/** 轉成 datetime-local 輸入框的格式 */
export function toInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + TZ_OFFSET).toISOString().slice(0, 16);
}

/** 把輸入框的台灣時間轉回 ISO 時間 */
export function fromInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}:00+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function hoursFromNow(hours: number): string {
  return toInput(new Date(Date.now() + hours * 3600e3).toISOString());
}

export function remainingText(ms: number): string {
  if (ms <= 0) return '已結束';
  const minutes = Math.ceil(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小時` : `${days} 天`;
  if (hours > 0) return mins > 0 ? `${hours} 小時 ${mins} 分` : `${hours} 小時`;
  return `${mins} 分鐘`;
}
