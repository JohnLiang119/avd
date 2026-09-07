## Context

見 proposal.md - Why。AVD 的非 TV 主畫面目前依序呈現快傳伺服器卡片（僅啟用時）、網址輸入列、兩排控制按鈕與任務清單；沒有全域網際網路狀態。既有快傳卡片描述的是 LAN 服務與本機 IP，不能代表 Internet 可用。

`channel-check-network-resilience` 已處理 RSS 請求失敗後的分類與重試，且刻意將裝置網路狀態監聽列為 Non-Goal。本 change 接續該邊界，僅新增主畫面可見的連線狀態，不改寫任何下載或頻道檢查決策。

## Goals / Non-Goals

**Goals:**

- 在 Windows/Tauri 與 Android/Capacitor 上提供一致的四態網路模型。
- 以裝置連線訊號快速反應離線，再以短逾時主動探測區分「正常」與「已連線但 Internet 不可用」。
- 將狀態生命週期、競態處理與文案映射集中成可單元測試的模組。
- 先以獨立 HTML 示意圖確認版面，再將同一視覺結構整合至 Vue。

**Non-Goals:**

- 不以網路狀態預先阻擋或取消任何工作。
- 不取代各來源、RSS、更新或下載流程既有的錯誤分類與重試。
- 不把單一探測結果當作所有網站皆可存取的保證。
- 不變更快傳伺服器、Wi-Fi QR Code 或 TV 接收模式的行為。

## Decisions

### 1. 使用四態模型，區分「離線」與「不穩定」

狀態定義為 `checking`、`online`、`degraded`、`offline`。裝置明確回報無連線時為 `offline`；裝置仍回報已連線但主動探測失敗或逾時時為 `degraded`。這可避免僅憑一次遠端探測失敗就斷言 Wi-Fi／行動網路完全中斷。

替代方案是只使用 `navigator.onLine` 的二態結果。其優點是零遠端流量，但 Wi-Fi 已連上卻沒有 Internet 時通常仍會回報 online，無法解決使用者最需要辨識的情境，因此不採用。

### 2. 被動事件加原生 204 探測，不新增第三方套件

前端先使用 `navigator.onLine` 與 `online`／`offline` 事件取得立即訊號。當裝置並非明確離線時，透過平台邊界對固定的 HTTPS `generate_204` 端點執行短逾時 GET，只有取得預期 204 才判定為 `online`：

- Windows/Tauri 新增輕量 command，使用現有 `ureq`、停用重新導向並設定連線／讀取逾時。
- Android 在既有 `YoutubeDlPlugin` 新增對應 method，使用 `HttpURLConnection`、停用重新導向並設定相同逾時。

探測端點不下載內容，也不新增 npm、Cargo 或 Gradle dependency。若端點被區域政策、DNS 或 captive portal 阻擋，狀態落在 `degraded` 而非 `offline`。

替代方案是由 WebView 直接 `fetch(..., mode: 'no-cors')`。跨來源 opaque response 無法可靠確認 204，且 Windows WebView、Android WebView 與 CSP 行為可能不同，因此選擇平台原生探測。

### 3. 將狀態控制封裝為 composable，純邏輯獨立測試

新增 `useNetworkStatus`（或等價命名）負責狀態、手動刷新、事件註冊、前景恢復與定期探測。狀態判定與顯示文案採純函式，平台探測函式與 timer 可注入，讓單元測試不接觸真實網路。

每次探測配置遞增序號；完成時只有序號仍為最新者可以回寫。composable 卸載時移除事件與 timer，頁面隱藏時停止週期探測，回到可見狀態立即刷新。建議可見期間每 30 秒探測一次、單次逾時 4 秒；這些值集中為常數。

### 4. 正常狀態收斂為標籤，異常狀態才展開

元件置於網址輸入列正上方、快傳伺服器卡片下方。`online` 使用靠右的小型綠色標籤；`checking` 使用中性標籤與進度提示；`degraded`／`offline` 展開為全寬橘色／紅色提示列並顯示重新檢查按鈕。所有狀態同時使用圖示與文字，避免只靠顏色。

第一個實作產物放在 `openspec/changes/show-network-status/mockups/network-status.html`，以按鈕切換四態和手機／桌面寬度。使用者確認示意圖後，才開始修改正式 Vue 畫面。

## Risks / Trade-offs

- **[Risk] 固定探測端點本身故障或在特定網路被封鎖，造成 degraded 誤判。** → 使用短逾時並誠實顯示「網路不穩定」；不據此阻擋功能，各功能仍以自身請求結果為準。
- **[Risk] 定期探測增加少量網路與電量使用。** → 使用無內容的 204 端點、僅在頁面可見時每 30 秒執行，離線事件則直接更新而不探測。
- **[Risk] 多次事件或手動點擊造成結果競態。** → 使用探測序號，只允許最新請求更新狀態，並停用檢查中的重複按鈕操作。
- **[Risk] 主畫面垂直空間更擁擠。** → 正常狀態只顯示精簡標籤，只有需要處理的狀態才展開完整提示列。

## Migration Plan

此變更不涉及持久化資料。先交付並確認獨立 HTML 示意圖，再加入可測試的狀態模組、兩平台探測邊界與 Vue 元件；完整測試通過後同步版本。若需回退，可移除主畫面元件與探測註冊，既有下載、頻道監控與快傳資料不受影響。