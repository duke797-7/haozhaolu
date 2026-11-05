# 個人預購管理 App（第一階段）

手機上架商品、顧客用網址預購、管理員整理訂單。這是 PWA 網頁 App，Android 與 iPhone 都能加到主畫面。
資料存在 Supabase，網站本身是靜態檔案，不需要自己的伺服器。

## 目前的正式環境

- Supabase 專案：`preorder-app`（東京，免費方案），網址 `https://tcgcipmbepepzwkemkgv.supabase.co`
- 網站：`https://duke797-7.github.io/haozhaolu/`（`gh-pages` 分支，推送後自動更新）
- 後台：`https://duke797-7.github.io/haozhaolu/#/admin`
- `dist/config.js` 已填好這個專案的連線資料。
- 資料表、照片空間與多數函式已建立。還要到 SQL Editor 執行一次 `supabase/finish-setup.sql`，
  它會補上三個函式、開放權限，並把目前唯一的帳號設為管理員。
- 下方是從零開始建立新專案時的完整步驟。

## 上線步驟

### 1. 建立資料庫（Supabase）

1. 到 supabase.com 註冊並建立專案。資料中心選離台灣近的地區（例如 Tokyo），資料庫密碼請自行保存。
2. 確認 **Enable Data API** 維持開啟。
3. 開啟左側 **SQL Editor**，貼上 `supabase/schema.sql` 全部內容後按 Run。

### 2. 建立管理員帳號

1. 開啟 **Authentication > Users**，按 Add user，填 Email 與高強度密碼，並勾選 Auto Confirm User。
2. 打開 `supabase/make-admin.sql`，把「改成你的Email」換成剛才的 Email，貼到 SQL Editor 執行。結果應該列出 1 筆帳號。
3. 開啟 **Authentication > Sign In / Providers**，關閉 **Allow new users to sign up**。
   這樣就只有你的帳號能登入。

### 3. 填寫連線設定

打開 `dist/config.js`，填入以下兩個值。都在 Supabase 的 **Settings > API Keys**，或專案首頁的 **Connect** 按鈕裡。

```js
window.APP_CONFIG = {
  supabaseUrl: 'https://你的專案代碼.supabase.co',
  supabaseAnonKey: 'sb_publishable_開頭的金鑰',
};
```

這把 publishable key 可以公開。不要貼 `sb_secret_` 開頭的金鑰或 `service_role` 金鑰。

### 4. 放上網站（Cloudflare Pages）

1. 到 Cloudflare 後台，開啟 **Workers & Pages**。
2. 依序選 **Create application > Get started > Drag and drop your files**。
3. 取一個專案名稱，把整個 `dist` 資料夾拖進去，再按部署。
4. 完成後會得到 `https://專案名稱.pages.dev` 網址。

`dist` 是一般靜態檔案，也可以放到 Netlify、Vercel 或 GitHub Pages。之後更新時，上傳新版本即可，資料不受影響。

### 5. 開始使用

- 管理後台：`https://你的網址/#/admin`
- 顧客商店：`https://你的網址/`
- 商品專屬網址：上架後自動產生，也可以在商品列表按「分享網址」。
- 加到主畫面：iPhone 用 Safari 開後台，點分享按鈕，選「加入主畫面」。Android 用 Chrome 開後台，從選單選「安裝應用程式」或「加到主畫面」。

## 到貨通知怎麼用

1. 顧客預購時留下 Email，不用填門市。
2. 商品到貨後，在賣貨便建立賣場並複製連結。
3. 到後台「商品」按「通知到貨」，貼上賣場連結，按「開啟郵件寄送」，用自己的信箱寄出。
4. 寄出後按「寄出後標記為已通知」。之後再通知時，已通知的訂單不會重複列出。
5. 顧客依信中的連結到賣貨便下單並選擇取貨門市，到店取貨付款。

App 不會自動寄信，也看不到顧客是否已在賣貨便下單，請到賣貨便核對。

## 拍照自動填寫

後台「上架新商品」可以拍照或選照片，由 Gemini 帶入商品名稱、介紹與規格。後端程式在 `supabase/functions/scan-product/`。

- 金鑰存放在 Supabase 的 Edge Functions > Secrets，名稱是 `GEMINI_API_KEY`，不會放進網站。
- 預設模型是 `gemini-3.1-flash-lite`。要更換時，在 Secrets 新增 `GEMINI_MODEL`，不用改程式。Google 公告這個模型最早可能在 2027 年 5 月停用。
- 只有管理員能呼叫。AI 帶入的內容要確認後才會上架。

## 上線後的驗收清單

本機測試使用模擬環境，以下項目請在正式環境用真手機各做一次：

- [ ] iPhone 與 Android 都能登入後台
- [ ] 從手機相簿選多張照片上架，直拍照片方向正確
- [ ] 更換、刪除、調整照片順序後，顧客頁同步更新
- [ ] 用未登入的手機開商品網址，完成一筆預購並看到訂單編號
- [ ] 按「通知到貨」能開啟郵件 App，收件人在密件副本，信件收得到
- [ ] 後台看到該訂單，總覽數量正確
- [ ] 更改訂單狀態為已取消後，名額釋出
- [ ] 用手機加到主畫面，能像 App 一樣開啟

## 使用免費方案要注意

Supabase 免費方案目前包含 500 MB 資料庫與 1 GB 檔案空間，足夠起步。

- **閒置會暫停**：連續一週沒有活動時專案會暫停，顧客頁面會無法載入，需要到 Supabase 後台恢復。
- **沒有自動備份**：每日自動備份需要 Pro 方案（目前每月 25 美元起）。訂單開始變多後，建議升級，或在下一階段完成 CSV 匯出後定期下載。

方案內容可能變動，以 Supabase 官網為準。

## 第一階段包含

管理員登入、商品新增修改刪除、照片上傳更換排序、規格售價數量、預購期限、上架下架與重新開放、商品分享網址、公開商品頁、顧客預購與成功畫面、訂單查看與單筆狀態、依狀態與商品篩選、訂單搜尋、各規格數量統計。

留待下一階段：批次標記、CSV 匯出、依規格與日期篩選。

## 主要設計

- **防超賣**：下單時由資料庫鎖定規格後才計算剩餘數量。取消的訂單不計入，名額會自動釋出。
- **金額可信**：單價、運費與合計都由資料庫計算。顧客看到的金額與實際不同時，訂單不會成立。
- **訂單快照**：明細保存下單當下的商品名稱、規格與單價，之後改價、改名或刪除商品都不影響舊訂單。
- **顧客資料保護**：所有資料表都啟用 Row Level Security 且不開放直接存取。顧客只能呼叫下單與看商品的函式，回應不含任何個資。
- **防濫用**：同一手機 10 分鐘最多 5 筆、同一網路來源 10 分鐘最多 30 筆，並有隱藏欄位攔截機器人，重複送出只會成立一筆。

## 開發

```bash
npm install
npm run build      # 輸出到 dist/
npm run typecheck
```

`tests/` 是本機測試：以真實 PostgreSQL 重現 Supabase 的角色與權限，並用模擬手機瀏覽器操作完整流程。
測試腳本依賴這個開發環境的路徑（`/opt/npm-tools`、PostgreSQL 16），在其他電腦執行前需要調整。
