import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// 共用元件：提示訊息、確認視窗、數量加減、載入與錯誤畫面。

const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .4-1.3-1.3.3-2.1-3-1-1 2h-2l-1-2-3 1 .3 2.1L6 8.4 4 8l-1 3 2 1v0l-2 1 1 3 2-.4 1.3 1.3-.3 2.1 3 1 1-2h2l1 2 3-1-.3-2.1 1.3-1.3 2 .4 1-3z',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l13-3v3M16 13h2',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  store: 'M4 10v10h16V10M3 10l2-6h14l2 6zM10 20v-6h4v6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<number>(0);
  const show = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(''), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-slot" role="status" aria-live="polite">
        {message && <div className="toast">{message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function Stepper({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={`${label}的數量`}>
      <button type="button" aria-label="減少一件" disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="增加一件" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function Loading({ text = '載入中' }: { text?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function Failure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-quiet" onClick={onRetry}>
          重新載入
        </button>
      )}
    </div>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} aria-label={title}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

export function Confirm({
  title,
  body,
  action,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="dialog-body">{body}</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          返回
        </button>
        <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
          {action}
        </button>
      </div>
    </Dialog>
  );
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    loader()
      .then((result) => alive && setData(result))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 手機上開啟系統分享面板，不支援時改為複製網址。 */
export async function shareLink(title: string, url: string, toast: (m: string) => void) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  toast((await copyText(url)) ? '已複製網址' : url);
}
