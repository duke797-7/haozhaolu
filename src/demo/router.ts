import { useEffect, useState } from 'react';

// 體驗版專用：畫面切換保存在記憶體，不使用網址，體驗頁面的外框也不會受影響。

let current = 'admin';
const listeners = new Set<() => void>();

function setPath(next: string) {
  current = next.replace(/^#?\/?/, '').replace(/\/+$/, '');
  window.scrollTo(0, 0);
  listeners.forEach((fn) => fn());
}

export const currentRoute = () => current;

export function useRoute(): string[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return current ? current.split('/').map(decodeURIComponent) : [];
}

export const go = setPath;
export const productUrl = (slug: string) => `https://你的網址.pages.dev/#/p/${encodeURIComponent(slug)}`;
export const shopUrl = () => 'https://你的網址.pages.dev/#/';

// 正式版用 <a href="#/..."> 與 history.replaceState 換頁，這裡接手處理。
document.addEventListener('click', (e) => {
  const link = (e.target as Element).closest?.('a[href^="#"]');
  if (!link) return;
  e.preventDefault();
  setPath(link.getAttribute('href') ?? '');
});

history.replaceState = (_data, _title, url) => {
  setPath(String(url ?? ''));
};
