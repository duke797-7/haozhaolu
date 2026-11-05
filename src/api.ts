import type { ScanResult } from './types';

// 與 Supabase 溝通的唯一入口。只用瀏覽器內建的 fetch，不需要額外套件。
// 這裡只會用到可公開的 publishable（舊稱 anon）key，放在 apikey 標頭；
// Authorization 標頭只放管理員登入後的權杖。secret / service_role key 絕對不能放進前端。

interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

declare global {
  interface Window {
    APP_CONFIG?: AppConfig;
  }
}

const config = window.APP_CONFIG ?? { supabaseUrl: '', supabaseAnonKey: '' };
const BASE = config.supabaseUrl.replace(/\/+$/, '');
const KEY = config.supabaseAnonKey;
const BUCKET = 'product-images';
const SESSION_KEY = 'preorder.session';

export const isConfigured = BASE.startsWith('http') && KEY.length > 10;

export class ApiError extends Error {
  status: number;
  hint: string | null;

  constructor(message: string, status = 0, hint: string | null = null) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  email: string;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // 私密瀏覽模式可能無法寫入，登入狀態就只維持到關閉頁面。
  }
}

let session = loadSession();
let refreshing: Promise<Session | null> | null = null;

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError('連線失敗，請檢查網路後再試一次');
  }
}

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function applyAuth(data: any, fallbackEmail = ''): Session {
  const next: Session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    email: data.user?.email ?? fallbackEmail,
  };
  session = next;
  saveSession(next);
  return next;
}

async function refreshSession(): Promise<Session | null> {
  if (!session) return null;
  if (!refreshing) {
    const current = session;
    refreshing = (async () => {
      try {
        const res = await request(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: current.refresh_token }),
        });
        if (!res.ok) {
          session = null;
          saveSession(null);
          return null;
        }
        return applyAuth(await parse(res), current.email);
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function validToken(): Promise<string | null> {
  if (!session) return null;
  if (session.expires_at - Date.now() / 1000 < 60) await refreshSession();
  return session?.access_token ?? null;
}

export const currentEmail = () => session?.email ?? '';
export const hasSession = () => session !== null;

export async function signIn(email: string, password: string): Promise<void> {
  const res = await request(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parse(res);
  if (!res.ok) {
    const invalid = data?.error_code === 'invalid_credentials' || data?.error === 'invalid_grant';
    throw new ApiError(
      invalid ? 'Email 或密碼不正確' : res.status === 429 ? '嘗試次數太多，請稍後再試' : '登入失敗，請稍後再試',
      res.status
    );
  }
  applyAuth(data, email);
}

export async function signOut(): Promise<void> {
  const token = session?.access_token;
  session = null;
  saveSession(null);
  if (token) {
    await fetch(`${BASE}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
}

/** 呼叫資料庫函式。admin 為 true 時會帶上登入身分。 */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}, admin = false): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = { apikey: KEY, 'Content-Type': 'application/json' };
    if (admin) {
      const token = await validToken();
      if (!token) throw new ApiError('登入已過期，請重新登入', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    return request(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  };

  let res = await send();
  if (admin && res.status === 401 && (await refreshSession())) res = await send();

  const data = await parse(res);
  if (!res.ok) {
    if (res.status === 401) throw new ApiError('登入已過期，請重新登入', 401);
    const friendly = data?.code === 'P0001' || res.status === 403;
    throw new ApiError(friendly ? data.message : '操作沒有完成，請稍後再試', res.status, data?.hint ?? null);
  }
  return data as T;
}

/** 把商品照片交給後端辨識，回傳建議的名稱、介紹與規格。AI 金鑰只存在後端。 */
export async function scanProduct(blob: Blob): Promise<ScanResult> {
  const token = await validToken();
  if (!token) throw new ApiError('登入已過期，請重新登入', 401);
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new ApiError('照片讀取失敗，請再試一次'));
    reader.readAsDataURL(blob);
  });
  const res = await request(`${BASE}/functions/v1/scan-product`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, mime: blob.type }),
  });
  const data = await parse(res);
  if (res.status === 404) throw new ApiError('拍照辨識尚未開通', 404);
  if (!res.ok) throw new ApiError(data?.message ?? '辨識沒有完成，請再試一次或手動填寫', res.status);
  return data as ScanResult;
}

export const imageUrl = (path: string) => `${BASE}/storage/v1/object/public/${BUCKET}/${path}`;

export async function uploadImage(path: string, blob: Blob): Promise<void> {
  const token = await validToken();
  if (!token) throw new ApiError('登入已過期，請重新登入', 401);
  const res = await request(`${BASE}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': blob.type,
      'Cache-Control': 'max-age=31536000',
    },
    body: blob,
  });
  if (!res.ok) {
    throw new ApiError(res.status === 413 ? '照片檔案太大' : '照片上傳失敗，請再試一次', res.status);
  }
}

/** 清除不再使用的照片。失敗不影響商品資料，所以不往外丟錯誤。 */
export async function removeImages(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const token = await validToken();
  if (!token) return;
  await fetch(`${BASE}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => undefined);
}

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
