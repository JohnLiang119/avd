## 1. 示意圖（先於正式畫面）

- [x] 1.1 建立 `openspec/changes/show-network-status/mockups/network-status.html`：可獨立以瀏覽器開啟，以按鈕切換 `checking`／`online`／`degraded`／`offline` 四態，並可切換手機／桌面寬度預覽版面
- [x] 1.2 示意圖中同時呈現「網際網路狀態」與既有「LAN 快傳伺服器狀態」兩個獨立區塊，確認離線時兩者不互相覆蓋
- [x] 1.3 請使用者檢視示意圖並確認版面與四態文案後，才開始下一節的正式實作

## 2. 狀態判定核心邏輯（純函式，可獨立測試）

- [x] 2.1 新增 `useNetworkStatus` composable（或等價命名），定義 `checking`／`online`／`degraded`／`offline` 四態與狀態轉換純函式，探測函式與 timer 皆可注入以利測試
- [x] 2.2 實作探測序號機制：每次探測配置遞增序號，完成時僅序號最新者可回寫狀態；撰寫單元測試驗證「探測結果回傳順序顛倒」情境（對應 spec 的同名 Scenario）不會讓過期結果覆蓋
- [x] 2.3 撰寫單元測試涵蓋：初次進入為 `checking`、`navigator.onLine` 離線事件立即切換 `offline`、恢復連線事件先轉 `checking` 再依探測結果收斂、手動重新檢查觸發新一輪探測
- [x] 2.4 集中定義常數（可見期間探測間隔 30 秒、單次探測逾時 4 秒），確認頁面隱藏時停止週期探測、恢復可見時立即刷新，並撰寫測試驗證卸載時事件與 timer 均被清除

## 3. 平台探測邊界

- [x] 3.1 Windows/Tauri：新增輕量 command，使用既有 `ureq`、停用重新導向、設定連線與讀取逾時，對固定 HTTPS `generate_204` 端點執行 GET 並僅在取得預期 204 時回傳成功；執行 `cargo check` 確認編譯通過
- [x] 3.2 Android：在既有 `YoutubeDlPlugin` 新增對應 method，使用 `HttpURLConnection`、停用重新導向、設定相同逾時與判定邏輯；執行 `gradlew :app:compileDebugJavaWithJavac` 確認編譯通過，並確認 `.java` 檔為 UTF-8 無 BOM
- [x] 3.3 確認兩平台探測皆不下載端點內容、不新增 npm／Cargo／Gradle 相依套件

## 4. Vue 主畫面整合

- [x] 4.1 依示意圖版面，在非 TV 模式主畫面的「重整、清除、刪除、設定」控制按鈕列新增網路狀態元件；`online`／`checking` 為緊貼該列最左側的精簡標籤（按鈕維持 `justify-content: flex-end` 靠右對齊），`degraded`／`offline` 於該按鈕列正上方展開全寬提示列並提供「重新檢查」按鈕；所有狀態同時使用圖示與文字
- [x] 4.1a 版面調整：將元件從「網址輸入區上方獨立一列」改為併入「重整」控制列最左側，並同步更新示意圖 `mockups/network-status.html`、`design.md`、`specs/network-status/spec.md`
- [x] 4.1b 版面再調整：標籤改為與「重整」「音訊」兩排等高（垂直置中，非僅第一排同高）；`online` 移除綠色圓點圖示，僅保留文字「網路正常」；同步更新示意圖與 `design.md`、`specs/network-status/spec.md`
- [x] 4.2 確認 TV 接收模式不渲染此元件（對應 spec 的「TV 模式不顯示一般主畫面狀態」Scenario）
- [x] 4.3 串接 `useNetworkStatus` 至 `App.vue` 生命週期：掛載時啟動、進入前景時刷新、卸載時清理；人工核對元件不阻擋既有網址輸入、下載控制、頻道管理與快傳控制的操作
- [x] 4.4 確認網際網路狀態提示與既有 LAN 快傳伺服器狀態卡片在畫面上為獨立區塊，兩者同時異常時各自呈現不合併（對應 spec 的「Internet 不可用但區域網路仍可用」Scenario）

## 5. 整合驗證

- [x] 5.1 執行 `npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過
- [ ] 5.2 Windows 端：正常網路下確認顯示為精簡綠色標籤；斷開網路後確認立即（不等定期探測）切換為紅色離線提示，並可用「重新檢查」手動觸發
- [ ] 5.3 Windows 端：以防火牆規則或 hosts 阻擋探測端點但保留其餘連線，確認顯示為橘色「網路不穩定」而非直接判定離線
- [ ] 5.4 Android 實機：比照 5.2、5.3 驗證兩種情境下的狀態與文案，並確認 App 回到前景時會刷新狀態
- [ ] 5.5 人工核對主畫面在四種狀態下的垂直空間變化符合示意圖設計，且離線／不穩定狀態下仍可正常操作既有下載、頻道檢查與快傳功能

## 6. 版本進版

- [x] 6.1 全面同步 avd 專案版號（`package.json`、`package-lock.json` 兩處、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`android/app/build.gradle` 的 `versionName` 與 `versionCode`）：1.0.79 → 1.0.80 → 1.0.81（versionCode 116 → 117 → 118）
- [ ] 6.2 確認第 5 節全部驗證通過後，建立獨立於功能修正的進版 commit
