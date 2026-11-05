import { useEffect, useRef, useState } from 'react';
import { imageUrl, removeImages, rpc, scanProduct, uploadImage, uuid } from '../api';
import { fromInput, hoursFromNow, money, toInput } from '../format';
import { compressImage } from '../image';
import { go, productUrl } from '../router';
import type { AdminProduct, ProductStatus } from '../types';
import { Confirm, Dialog, Failure, Icon, Loading, copyText, shareLink, useToast } from '../ui/kit';

const MAX_PHOTOS = 10;

interface Photo {
  key: string;
  path: string | null; // 已上傳的路徑；新選的照片在儲存時才上傳
  blob: Blob | null;
  preview: string;
}

interface VariantDraft {
  key: string;
  id: string | null;
  label: string;
  price: string;
  qty: string;
  ordered: number;
}

interface Draft {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: ProductStatus;
  startsAt: string;
  endsAt: string;
  shipEstimate: string;
  notice: string;
}

const newVariant = (price = '', qty = '', label = ''): VariantDraft => ({
  key: uuid(),
  id: null,
  label,
  price,
  qty,
  ordered: 0,
});

export function ProductEditor({ id }: { id: string | null }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [published, setPublished] = useState<{ name: string; slug: string } | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const swapInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const [scanned, setScanned] = useState(false);
  const [scanNotice, setScanNotice] = useState('');

  useEffect(() => {
    let alive = true;
    if (!id) {
      setDraft({
        id: uuid(),
        slug: '',
        name: '',
        description: '',
        status: 'draft',
        startsAt: hoursFromNow(0),
        endsAt: hoursFromNow(24 * 7),
        shipEstimate: '',
        notice: '',
      });
      setVariants([newVariant('', '', '標準')]);
      return;
    }
    rpc<AdminProduct | null>('admin_get_product', { p_id: id }, true)
      .then((p) => {
        if (!alive) return;
        if (!p) {
          setLoadError('找不到這個商品，可能已經刪除。');
          return;
        }
        setDraft({
          id: p.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          status: p.status,
          startsAt: toInput(p.starts_at),
          endsAt: toInput(p.ends_at),
          shipEstimate: p.ship_estimate,
          notice: p.notice,
        });
        setPhotos(p.images.map((i) => ({ key: i.id, path: i.path, blob: null, preview: imageUrl(i.path) })));
        setVariants(
          p.variants.map((v) => ({
            key: v.id,
            id: v.id,
            label: v.label,
            price: String(v.price),
            qty: v.qty_limit === null ? '' : String(v.qty_limit),
            ordered: v.ordered,
          }))
        );
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  if (loadError) {
    return (
      <main className="page">
        <Failure message={loadError} />
        <a className="btn btn-quiet btn-block" href="#/admin/products">
          回到商品列表
        </a>
      </main>
    );
  }
  if (!draft) return <Loading />;

  const touch = () => setDirty(true);
  const patch = (changes: Partial<Draft>) => {
    setDraft({ ...draft, ...changes });
    touch();
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PHOTOS - photos.length;
    const chosen = [...files].slice(0, room);
    if (files.length > room) toast(`每個商品最多 ${MAX_PHOTOS} 張照片`);
    setBusy('處理照片中');
    setError('');
    const added: Photo[] = [];
    for (const file of chosen) {
      try {
        const blob = await compressImage(file);
        added.push({ key: uuid(), path: null, blob, preview: URL.createObjectURL(blob) });
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setPhotos((list) => [...list, ...added]);
    setBusy('');
    touch();
  };

  const scan = async (file: File | undefined) => {
    if (!file) return;
    setBusy('AI 辨識中');
    setError('');
    setScanned(false);
    try {
      const blob = await compressImage(file);
      if (photos.length < MAX_PHOTOS) {
        setPhotos((list) => [...list, { key: uuid(), path: null, blob, preview: URL.createObjectURL(blob) }]);
      }
      const result = await scanProduct(blob);
      // 只填空白欄位，不覆蓋你已經打好的內容。
      setDraft((d) =>
        d && {
          ...d,
          name: d.name.trim() ? d.name : result.name,
          description: d.description.trim() ? d.description : result.description,
        }
      );
      const found = result.variants.map((v) => newVariant(v.price === null ? '' : String(v.price), '', v.label));
      setVariants((list) => {
        if (found.length === 0) return list;
        const untouched = list.length === 1 && !list[0].id && list[0].price === '' && list[0].qty === '';
        return untouched ? found : [...list, ...found];
      });
      setScanned(true);
      setScanNotice(result.notice ?? '');
      touch();
      window.setTimeout(() => document.querySelector('.scan-note')?.scrollIntoView({ block: 'center' }), 50);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy('');
  };

  const swapPhoto = async (file: File | undefined) => {
    if (!file || !selected) return;
    setBusy('處理照片中');
    setError('');
    try {
      const blob = await compressImage(file);
      const replacement: Photo = { key: uuid(), path: null, blob, preview: URL.createObjectURL(blob) };
      setPhotos((list) => list.map((p) => (p.key === selected ? replacement : p)));
      setSelected(replacement.key);
      touch();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy('');
  };

  const movePhoto = (delta: number) => {
    const from = photos.findIndex((p) => p.key === selected);
    const to = delta === -Infinity ? 0 : from + delta;
    if (from < 0 || to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setPhotos(next);
    touch();
  };

  const deletePhoto = () => {
    setPhotos(photos.filter((p) => p.key !== selected));
    setSelected(null);
    touch();
  };

  const setVariant = (key: string, changes: Partial<VariantDraft>) => {
    setVariants(variants.map((v) => (v.key === key ? { ...v, ...changes } : v)));
    touch();
  };

  const addVariant = () => {
    const last = variants[variants.length - 1];
    setVariants([...variants, newVariant(last?.price ?? '', last?.qty ?? '')]);
    touch();
  };

  const save = async (status: ProductStatus) => {
    setError('');
    if (status === 'published' && !draft.name.trim()) return setError('上架前請填寫商品名稱');
    if (status === 'published' && photos.length === 0) return setError('上架前請至少放一張照片');
    if (status === 'published' && draft.status !== 'published') {
      const ends = fromInput(draft.endsAt);
      if (!ends) return setError('上架前請設定預購結束時間');
      if (new Date(ends).getTime() <= Date.now()) return setError('結束時間已經過了，請改成未來的時間');
    }
    const wholeNumber = (text: string) => Number.isInteger(Number(text)) && Number(text) >= 0;
    for (const v of variants) {
      const name = v.label.trim() || '規格';
      if (!v.label.trim()) return setError('請填寫規格名稱');
      if (v.price === '' || !wholeNumber(v.price)) return setError(`「${name}」的售價請填 0 以上的整數`);
      if (v.qty !== '' && !wholeNumber(v.qty)) return setError(`「${name}」的可預購數量請填 0 以上的整數`);
      if (v.qty !== '' && Number(v.qty) < v.ordered) {
        return setError(`「${name}」已有 ${v.ordered} 件預購，可預購數量不能少於這個數字`);
      }
    }

    setBusy('儲存中');
    try {
      // 先上傳新照片，全部成功才寫入商品資料。重試時已上傳的不會重傳。
      const list = [...photos];
      let done = 0;
      const pending = list.filter((p) => !p.path).length;
      for (let i = 0; i < list.length; i++) {
        const photo = list[i];
        if (photo.path || !photo.blob) continue;
        done += 1;
        setBusy(`上傳照片 ${done} / ${pending}`);
        const path = `${draft.id}/${uuid()}.jpg`;
        await uploadImage(path, photo.blob);
        list[i] = { ...photo, path };
        setPhotos([...list]);
      }

      setBusy('儲存中');
      const result = await rpc<{ slug: string; removed_paths: string[] }>(
        'admin_save_product',
        {
          p: {
            id: draft.id,
            name: draft.name,
            description: draft.description,
            status,
            starts_at: fromInput(draft.startsAt),
            ends_at: fromInput(draft.endsAt),
            ship_estimate: draft.shipEstimate,
            notice: draft.notice,
            images: list.map((p) => p.path),
            variants: variants.map((v) => ({
              id: v.id,
              label: v.label,
              price: Number(v.price),
              qty_limit: v.qty === '' ? null : Number(v.qty),
            })),
          },
        },
        true
      );
      await removeImages(result.removed_paths);
      setDirty(false);
      setBusy('');
      if (status === 'published' && draft.status !== 'published') {
        setPublished({ name: draft.name, slug: result.slug });
      } else {
        toast(status === 'hidden' ? '已下架' : status === 'draft' ? '已存成草稿' : '已儲存變更');
        go('/admin/products');
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  };

  const remove = async () => {
    setAskDelete(false);
    setBusy('刪除中');
    try {
      const result = await rpc<{ removed_paths: string[] }>('admin_delete_product', { p_id: draft.id }, true);
      await removeImages(result.removed_paths);
      setDirty(false);
      toast('已刪除商品');
      go('/admin/products');
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  };

  const leave = () => (dirty ? setAskLeave(true) : go('/admin/products'));
  const selectedIndex = photos.findIndex((p) => p.key === selected);
  const isLive = draft.status === 'published';

  return (
    <div className="editor">
      <header className="editor-head">
        <button type="button" className="link-back" onClick={leave}>
          商品列表
        </button>
        <h1>{id ? '編輯商品' : '上架新商品'}</h1>
      </header>

      <main className="page">
        {!id && (
          <section className="scan-card" aria-label="拍照自動填寫">
            <h2>拍照自動填寫</h2>
            <p>拍商品或包裝，名稱、介紹和規格會自動帶入，你只要填數量。</p>
            <div className="scan-actions">
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => cameraInput.current?.click()}>
                <Icon name="camera" />
                {busy === 'AI 辨識中' ? busy : '拍照'}
              </button>
              <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => albumInput.current?.click()}>
                <Icon name="image" />
                從相簿選
              </button>
            </div>
            <input
              ref={cameraInput}
              data-testid="scan-camera"
              className="file"
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="拍攝商品照片"
              onChange={(e) => {
                void scan(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={albumInput}
              data-testid="scan-album"
              className="file"
              type="file"
              accept="image/*"
              aria-label="從相簿選擇商品照片"
              onChange={(e) => {
                void scan(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </section>
        )}
        {scanned && (
          <div className="scan-note" role="status">
            <strong>已自動填寫，請確認內容</strong>
            <span>填好標示的欄位後，按下方「上架」。</span>
            {scanNotice && <span className="scan-demo">{scanNotice}</span>}
          </div>
        )}

        <section aria-label="商品照片">
          <div className="photo-grid">
            {photos.map((photo, i) => (
              <button
                key={photo.key}
                type="button"
                className={`photo${photo.key === selected ? ' photo-on' : ''}`}
                aria-pressed={photo.key === selected}
                aria-label={`第 ${i + 1} 張照片`}
                onClick={() => setSelected(photo.key === selected ? null : photo.key)}
              >
                <img src={photo.preview} alt="" />
                {i === 0 && <span className="photo-cover">封面</span>}
              </button>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button type="button" className="photo-add" onClick={() => addInput.current?.click()}>
                <span aria-hidden="true">+</span>
                {photos.length === 0 ? '選擇照片' : '加照片'}
              </button>
            )}
          </div>
          <input
            ref={addInput}
            data-testid="add-photos"
            className="file"
            type="file"
            accept="image/*"
            multiple
            aria-label="從相簿選擇照片"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={swapInput}
            data-testid="swap-photo"
            className="file"
            type="file"
            accept="image/*"
            aria-label="選擇替換的照片"
            onChange={(e) => {
              void swapPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {selected && selectedIndex >= 0 && (
            <div className="photo-tools">
              <button type="button" disabled={selectedIndex === 0} onClick={() => movePhoto(-Infinity)}>
                設為封面
              </button>
              <button type="button" disabled={selectedIndex === 0} onClick={() => movePhoto(-1)}>
                往前
              </button>
              <button type="button" disabled={selectedIndex === photos.length - 1} onClick={() => movePhoto(1)}>
                往後
              </button>
              <button type="button" onClick={() => swapInput.current?.click()}>
                更換
              </button>
              <button type="button" className="danger" onClick={deletePhoto}>
                刪除
              </button>
            </div>
          )}
        </section>

        <label className="field">
          <span>商品名稱</span>
          <input maxLength={80} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>商品介紹</span>
          <textarea
            rows={5}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>

        <h2 className="section-title">規格、售價與數量</h2>
        <ul className="variant-editor">
          {variants.map((v) => (
            <li key={v.key} data-testid="variant-row">
              <label className="field">
                <span>規格名稱</span>
                <input
                  maxLength={60}
                  placeholder="例如：白色 / M"
                  value={v.label}
                  onChange={(e) => setVariant(v.key, { label: e.target.value })}
                />
              </label>
              <div className="field-pair">
                <label className={`field${scanned && v.price === '' ? ' field-need' : ''}`}>
                  <span>售價（元）</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={v.price}
                    onChange={(e) => setVariant(v.key, { price: e.target.value })}
                  />
                </label>
                <label className={`field${scanned && v.qty === '' ? ' field-need' : ''}`}>
                  <span>可預購數量</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="不限"
                    value={v.qty}
                    onChange={(e) => setVariant(v.key, { qty: e.target.value })}
                  />
                </label>
              </div>
              <div className="variant-foot">
                <span className="muted">
                  {v.ordered > 0 ? `已預購 ${v.ordered} 件` : v.price ? `顧客看到 ${money(Number(v.price))}` : ''}
                </span>
                {variants.length > 1 && (
                  <button
                    type="button"
                    className="text-danger"
                    onClick={() => {
                      setVariants(variants.filter((x) => x.key !== v.key));
                      touch();
                    }}
                  >
                    移除規格
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-quiet btn-block" onClick={addVariant}>
          新增規格
        </button>

        <h2 className="section-title">預購期限（台灣時間）</h2>
        <label className="field">
          <span>開始時間</span>
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(e) => patch({ startsAt: e.target.value })}
          />
        </label>
        <label className="field">
          <span>結束時間</span>
          <input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(e) => patch({ endsAt: e.target.value })}
          />
        </label>
        <div className="presets" role="group" aria-label="快速設定結束時間">
          {[3, 7, 14].map((days) => (
            <button key={days} type="button" onClick={() => patch({ endsAt: hoursFromNow(days * 24) })}>
              {days} 天後結單
            </button>
          ))}
        </div>

        <label className="field">
          <span>預計出貨時間</span>
          <input
            maxLength={60}
            placeholder="例如：12 月中旬"
            value={draft.shipEstimate}
            onChange={(e) => patch({ shipEstimate: e.target.value })}
          />
        </label>
        <label className="field">
          <span>這個商品的注意事項（選填）</span>
          <textarea
            rows={3}
            placeholder="留白會顯示設定頁的預設內容"
            value={draft.notice}
            onChange={(e) => patch({ notice: e.target.value })}
          />
        </label>

        {id && (
          <button type="button" className="btn btn-quiet-danger btn-block" onClick={() => setAskDelete(true)}>
            刪除商品
          </button>
        )}
      </main>

      <footer className="savebar">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="savebar-actions">
          {isLive ? (
            <>
              <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void save('hidden')}>
                下架
              </button>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void save('published')}>
                {busy || '儲存變更'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-quiet"
                disabled={!!busy}
                onClick={() => void save(draft.status === 'hidden' ? 'hidden' : 'draft')}
              >
                {draft.status === 'hidden' ? '儲存' : '存草稿'}
              </button>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void save('published')}>
                {busy || (draft.status === 'hidden' ? '重新上架' : '上架')}
              </button>
            </>
          )}
        </div>
      </footer>

      {askLeave && (
        <Confirm
          title="放棄這次修改？"
          body="還沒儲存的內容會消失。"
          action="放棄修改"
          danger
          onClose={() => setAskLeave(false)}
          onConfirm={() => go('/admin/products')}
        />
      )}
      {askDelete && (
        <Confirm
          title="刪除這個商品？"
          body="商品與照片會永久刪除，顧客網址也會失效。已成立的訂單會保留。"
          action="刪除商品"
          danger
          onClose={() => setAskDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
      {published && (
        <Dialog title="商品已上架" onClose={() => go('/admin/products')}>
          <p className="dialog-body">{published.name}</p>
          <p className="share-url" data-testid="share-url">
            {productUrl(published.slug)}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => void shareLink(published.name, productUrl(published.slug), toast)}
          >
            分享網址
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-block"
            onClick={async () => toast((await copyText(productUrl(published.slug))) ? '已複製網址' : '請長按網址複製')}
          >
            複製網址
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => go('/admin/products')}>
            回到商品列表
          </button>
        </Dialog>
      )}
    </div>
  );
}
