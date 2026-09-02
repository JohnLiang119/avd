## 1. 後端 yt-dlp 指令實作

- [x] 1.1 在 `src-tauri/src/main.rs` 中實作 `update_yt_dlp` 指令，使用 Tauri Sidecar API 執行 `yt-dlp --update-to nightly`。
- [x] 1.2 在 `src-tauri/src/main.rs` 中實作 `get_yt_dlp_version` 指令，執行 `yt-dlp --version` 並回傳版本字串。

## 2. 前端自動更新邏輯

- [x] 2.1 在 `DownloadService.ts`（或新的 API wrapper）中新增 `updateYtDlp` 與 `getYtDlpVersion` 的封裝函式。
- [x] 2.2 修改 `DownloadService.ts` 攔截下載任務的開頭，檢查 `localStorage.getItem('yt_dlp_last_update_check')`。
- [x] 2.3 若日期不是今天，呼叫更新指令，將 `localStorage` 的鍵值更新為今天的日期，然後繼續執行原下載。

## 3. 設定頁面 UI 整合

- [x] 3.1 更新 `App.vue`（設定分頁），顯示目前的 `yt-dlp` 版本與更新時間。
- [x] 3.2 在設定 UI 中加入一個可以手動觸發 `updateYtDlp` 的按鈕。
- [x] 3.3 在手動更新期間顯示載入中動畫 (Spinner)，並於成功/失敗時跳出提示 (Toast)。
