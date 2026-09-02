## Why

在 Android 行動版 App 中，使用傳統網頁的 `<a>` 標籤與 Blob URL 進行「匯出本地備份」時，因為 WebView 的安全性限制，會導致檔案下載被攔截且忽略。雖然畫面顯示匯出成功，但實際上檔案並未寫入手機儲存空間。為了解決這個問題，並讓使用者能將備份檔存入 Google Drive、Line 或裝置中，需要導入 Capacitor Share 原生分享功能。

## What Changes

- 加入 `@capacitor/share` 外掛。
- 修改 `src/App.vue` 中的 `exportChannelsJson` 方法。
- 當處於 Android (Capacitor) 環境時，先將備份 JSON 寫入暫存檔，再呼叫 Capacitor Share 彈出原生分享選單。
- 在 Windows (Tauri) 環境下保留原有的 Blob 下載方式。
- （可選）為能寫入暫存檔以供 Share 使用，可能需要一併加入 `@capacitor/filesystem`。

## Capabilities

### New Capabilities
- `capacitor-share-export`: 使用 Capacitor Share 取代隱藏的 Blob 下載，讓 Android 裝置能夠成功匯出與分享備份檔。

### Modified Capabilities

## Impact

- `package.json`：新增 Capacitor 依賴。
- `src/App.vue`：變更匯出邏輯。
- Android 權限與設定：同步 Capacitor 外掛。
