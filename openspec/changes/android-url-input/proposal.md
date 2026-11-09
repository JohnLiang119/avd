## Why

Android 版（APK）的主畫面沒有網址輸入框 —— 那一列自初版起就包在 `v-if="isTauri()"` 裡，只在 Windows 顯示。手機上要下載影片，唯一的入口是從 YouTube 等 App 按「分享」選 AVD；網址若來自 LINE 訊息、網頁或剪貼簿，就沒有地方貼上。下載本身在 Android 早已支援任意網址（分享進來的網址走的就是同一條 `addTask` → `DownloadService.download` 流程），缺的只是入口。

連帶地，`add-youtube-keyword-search` 規格要求兩平台提供一致的關鍵字搜尋，但 Android 沒有輸入框，實際上用不到。

## What Changes

- **Android 主畫面顯示網址輸入框與送出鈕**：與 Windows 同一個欄位（「輸入影音網址，或關鍵字搜尋 YouTube」），貼上影片網址按送出即加入下載佇列；輸入非網址文字則照既有流程徵詢後以 YouTube 搜尋。
- 「開啟資料夾」「連結 Drive」兩顆按鈕仍只在 Windows 顯示（前者依賴桌面檔案總管，後者為 Rclone 設定入口）。
- TV 模式維持隱藏整個輸入區（既有 `v-show="!isTvMode"`）。
- 不改下載、解析與分享流程，不新增依賴。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `youtube-download`: 新增「主畫面網址輸入」需求 —— Windows 與 Android 主畫面皆提供網址輸入框，送出即加入下載佇列。

## Impact

- **前端**：`src/App.vue` 主畫面輸入列的平台判斷（輸入框與送出鈕改為兩平台皆顯示，兩顆 Windows 專屬按鈕另包 `v-if="isTauri()"`）。
- **原生端**：無。
- **版本進版**：依工作區規範同步七處版號並更新 `avd_s/publish_all.ps1` 預設發布說明。
