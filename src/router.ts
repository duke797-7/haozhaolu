import { useEffect, useState } from 'react';

// 使用網址 # 後方的路徑：放在任何靜態網站空間都能直接運作，不需要設定轉址。

const currentPath = () => location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');

export function useRoute(): string[] {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => {
      setPath(currentPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path ? path.split('/').map(decodeURIComponent) : [];
}

export function go(path: string) {
  location.hash = path;
}

export function productUrl(slug: string): string {
  return `${location.origin}${location.pathname}#/p/${encodeURIComponent(slug)}`;
}

export function shopUrl(): string {
  return `${location.origin}${location.pathname}#/`;
}
