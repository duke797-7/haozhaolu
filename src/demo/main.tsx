import { createRoot } from 'react-dom/client';
import { AdminApp } from '../admin/Admin';
import { ProductRoute, ShopHome, Thanks } from '../shop/Shop';
import '../styles.css';
import { ToastProvider } from '../ui/kit';
import { go, useRoute } from './router';

function DemoBar({ inAdmin }: { inAdmin: boolean }) {
  return (
    <div className="demo-bar">
      <p>體驗版：資料是範例，重新整理會還原</p>
      <div role="group" aria-label="切換畫面">
        <button type="button" aria-pressed={inAdmin} onClick={() => go('/admin')}>
          管理後台
        </button>
        <button type="button" aria-pressed={!inAdmin} onClick={() => go('/')}>
          顧客頁
        </button>
      </div>
    </div>
  );
}

function App() {
  const route = useRoute();
  const inAdmin = route[0] === 'admin';
  return (
    <>
      <DemoBar inAdmin={inAdmin} />
      {inAdmin ? (
        <AdminApp route={route} />
      ) : route[0] === 'p' && route[1] ? (
        <ProductRoute key={route[1]} slug={route[1]} step={route[2]} />
      ) : route[0] === 'thanks' ? (
        <Thanks />
      ) : (
        <ShopHome />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
