// 上傳前先在手機上壓縮：加快上傳、節省雲端空間，也避免 10MB 的相機原圖拖慢顧客頁面。
// 一律輸出 JPEG，因為 iPhone 的 Safari 無法輸出 WebP。
// 透過 <img> 解碼，瀏覽器才會依照相片的方向資訊轉正，直拍照片不會躺著。

const MAX_SIDE = 1600;
const QUALITY = 0.85;

async function decode(file: File): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`「${file.name}」無法讀取，請改選 JPG 或 PNG 照片`);
  }
  return { image, release: () => URL.revokeObjectURL(url) };
}

export async function compressImage(file: File): Promise<Blob> {
  const { image, release } = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    release();
    throw new Error('這支手機無法處理照片，請換一個瀏覽器再試');
  }
  ctx.fillStyle = '#fff'; // 去背 PNG 轉成 JPEG 時用白底
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  release();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('照片處理失敗，請再試一次'))),
      'image/jpeg',
      QUALITY
    );
  });
}
