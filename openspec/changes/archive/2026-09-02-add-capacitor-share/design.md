## Context

目前的匯出機制使用 HTML5 `<a download>`，但 Android WebView 不支援這種純前端的 Blob 隱藏下載。為了在 Capacitor (Android) 環境提供真正的檔案輸出功能，將導入 Capacitor 的 Filesystem 與 Share 外掛。

## Goals / Non-Goals

**Goals:**
- Android 點擊「匯出本地備份」後，能成功產生 JSON 實體檔案並彈出系統分享對話框。
- 保持 Windows (Tauri) 環境原有的隱藏式下載機制不變。

**Non-Goals:**
- 不改變備份 JSON 的資料結構。
- 不實作客製化的雲端 API（延續原本的分享選單讓使用者自行決定傳送至 Google Drive 或儲存到裝置）。

## Decisions

- **安裝 `@capacitor/filesystem` 與 `@capacitor/share`**:
  為了透過系統分享對話框傳送「檔案」，必須先將字串寫入到手機的暫存儲存區。因此需要 `Filesystem` 將 JSON 寫入 `Directory.Cache`，接著將產生的檔案 URI 傳給 `Share.share({ url: ... })`。
- **跨平台判斷**:
  使用現有的 `isTauri()` 判斷式。若為 false，則視為 Capacitor 環境並執行 Share 邏輯；若為 true，則執行原本的 `a.download` 邏輯。

## Risks / Trade-offs

- **外掛相容性風險**: 新增 Capacitor 外掛後，需要執行 `npx cap sync` 同步至 Android 專案，可能會短暫影響開發環境的編譯。
  *Mitigation*: 在 `tasks.md` 中明確加入 `npm install` 與 `npx cap sync` 的步驟。
