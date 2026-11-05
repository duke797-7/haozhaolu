import { createRoot } from 'react-dom/client';
import { isConfigured } from './api';
import { AdminApp } from './admin/Admin';
import { useRoute } from './router';
import { ProductRoute, ShopHome, Thanks } from './shop/Shop';
import './styles.css';
import { ToastProvider } from './ui/kit';

function Setup() {
  return (
    <main className="page login">
      <h1>尚未連接資料庫</h1>
      <p className="muted">請開啟網站檔案裡的 config.js，填入 Supabase 的 Project URL 與 publishable key。</p>
    </main>
  );
}

function App() {
  const route = useRoute();
  if (!isConfigured) return <Setup />;
  if (route[0] === 'admin') return <AdminApp route={route} />;
  if (route[0] === 'p' && route[1]) return <ProductRoute key={route[1]} slug={route[1]} step={route[2]} />;
  if (route[0] === 'thanks') return <Thanks />;
  return <ShopHome />;
}

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
