## Why
YouTube 經常更新其阻擋自動化抓取的機制，導致舊版 `yt-dlp` 容易遇到 `403 Forbidden` 錯誤。Android App 已經實作了「每日首次啟動自動更新至 nightly 版」的機制。而 Windows (Tauri) 版本目前缺乏此功能，導致使用者必須等待我們發布新版 App 才能修復。我們需要在 Windows 補上這個自動更新機制，並在設定頁面增加顯示目前版本與手動更新的按鈕。

## What Changes
- 在 Windows (Tauri) 後端實作 `yt-dlp` 的每日自動更新機制。
- 在 `DownloadService.ts` 執行下載前，檢查 `localStorage` 的最後更新日期。如果不是今天，就在背景執行 `yt-dlp --update-to nightly`。
- 更新設定頁面的 UI，顯示目前的 `yt-dlp` 版本以及最後更新時間。
- 在設定頁面加入針對 `yt-dlp` 的「手動更新」按鈕。

## Capabilities

### New Capabilities
- `yt-dlp-auto-update`: 為 Windows 上的 `yt-dlp` 後端加入每日自動更新機制與手動更新的 UI 介面。

### Modified Capabilities

## Impact
- `DownloadService.ts`: 整合更新檢查邏輯，攔截下載指令。
- 設定頁面 UI: 新增 `yt-dlp` 版本資訊與更新按鈕元件。
- 本機儲存 (Local Storage): 儲存 `last_engine_update_check` 日期。
