## Context

請參閱 `proposal.md`。
目前 AVD 支援 YouTube 頻道定時自動追蹤新片（`monitoredChannels`），但資料僅留存於裝置本機儲存中。當換機或跨平台使用時，缺乏頻道資料匯出與同步回復機制。此外，頂部控制列按鈕在追蹤頻道存在時會呈現藍色，使用者期望維持完全純灰色的極簡一致風格。

## Goals / Non-Goals

**Goals:**
- 在頻道管理彈窗中加入「備份與還原」卡片，提供「本地檔案匯出/匯入」與「雲端硬碟 (Google Drive / Rclone) 上傳/下載」雙軌機制。
- 支援還原時的「覆蓋」與「智慧去重合併」兩種策略。
- 統一頂部「頻道」按鈕為常態純灰色，消除視覺色差。
- 將專案全平台升級至 `1.0.31`。

**Non-Goals:**
- 不涉及下載中實體影片/音訊檔案的自動雲端備份（僅備份頻道配置 metadata）。

## Decisions

### 決策 1：本地備份採用標準 Blob 下載與 HTML5 File Input 讀取
- **方案**：匯出時以 `Blob` 產生 `avd_channels_backup.json` 並透過 `<a>` 標籤觸發下載；匯入時使用隱藏 `<input type="file" accept=".json">` 進行解析。
- **原因**：跨 Web、Android WebView 與 Windows Tauri 通用，不依賴額外複雜的外掛，極度穩定。

### 決策 2：雲端備份復用既有 Drive / Rclone 通道
- **方案**：
  - Windows 端：透過 `Command.sidecar('bin/rclone', ['copyto', ...])` 上傳/下載備份檔。
  - Android / Web 端：透過既有的 `driveToken` 呼叫 Google Drive API 進行小檔案（<5KB）傳輸；若未取得 Token 則引導使用本地匯出/匯入。

## Risks / Trade-offs

- **[檔案格式不合法]** → 匯入時進行嚴格 JSON 解析與頻道物件 schema 驗證，防止惡意或毀損檔案造成程式崩潰。