## Context
Windows 後端目前依賴打包內建的 `yt-dlp` 執行檔。由於 YouTube 頻繁變更加密簽章與防機器人機制，此執行檔很容易過期失效，並導致 HTTP 403 Forbidden 錯誤。目前的解法需要手動更新執行檔並發布新的 App 版本。然而，Android App 已經在每日首次啟動時透過呼叫 `updateYoutubeDL` 來迴避了這個問題。

## Goals / Non-Goals
**Goals:**
- 為 Windows 後端實作與 Android 類似的每日自動更新機制。
- 在設定頁面的 UI 中，向使用者提供手動更新功能與版本檢查資訊。

**Non-Goals:**
- 不包含整個 App 的跨平台自動更新（僅針對 yt-dlp 執行檔）。
- 不自動更新 `ffmpeg` 或其他附加程式 (sidecars)。

## Decisions
1. **由前端觸發更新 vs 後端 Cron Job：** 我們將由前端 (`DownloadService.ts`) 觸發更新檢查，而不是在 Rust 後端寫一個常駐排程。這能與 Android 的作法保持一致，避免在 Rust 中建立複雜的背景服務，並集中管理邏輯。
2. **使用 `localStorage` 記錄日期：** 最後檢查更新的日期將會存放在 `localStorage` 中，鍵名為 `yt_dlp_last_update_check`。這種作法簡單且能永久保存。
3. **Rust 更新指令：** 我們將使用 Tauri 的 `Command` API 呼叫 `yt-dlp` 附加程式，並帶上 `--update-to nightly` 參數。
4. **取得版本資訊：** 我們將執行 `yt-dlp --version` 來萃取目前版本號，並顯示在設定頁面上。

## Risks / Trade-offs
- [Risk] 更新指令可能因為網路問題或 GitHub API 限制而失敗。
  - Mitigation: 妥善捕捉錯誤，並退回使用目前舊版的 `yt-dlp` 繼續運行，避免因網路不穩而徹底阻擋使用者的下載。
