## Why

在 Windows 桌面端（Tauri）執行「頻道自動追蹤」檢查新片或點擊「模擬測試」時，前端 WebView 透過瀏覽器原生 `fetch()` 請求 YouTube RSS (`https://www.youtube.com/feeds/videos.xml?channel_id=...`) 會被 YouTube 伺服器之 CORS（跨來源資源共用）政策阻擋，導致拋出 `TypeError: Failed to fetch` 錯誤，無法正常取得頻道新影片。本變更旨在為 Windows 桌面端引入 Rust 原生 HTTP 請求通道，徹底解決跨域阻擋問題。

## What Changes

- **Rust 後端新增原生 HTTP 請求 Command (`fetch_http_text`)**：
  - 在 `src-tauri/src/lib.rs` 中利用已內建的 `ureq` 網路套件實作 `fetch_http_text` 指令。
  - 直接在 Windows 原生網路層發送 GET 請求並回傳文字內容，完全不受瀏覽器 WebView CORS 限制。
- **前端 DownloadService 適配 Rust 原生請求**：
  - 更新 `DownloadService.fetchYouTubeRss`：在 `isTauri()`（Windows 端）環境下改為呼叫 `invoke('fetch_http_text', { url: rssUrl })` 獲取 RSS XML。
  - 更新 `DownloadService.resolveYouTubeChannel`：在網頁爬取 fallback 解析頻道 ID 時，亦改用 `fetch_http_text` 避免 CORS 報錯。

## Capabilities

### New Capabilities
- `windows-native-http-fetch`: 提供 Windows 桌面端 Tauri 原生 HTTP 文字內容抓取能力，用於獲取 YouTube 頻道 RSS 與解析 Handle 網頁內容。

### Modified Capabilities
<!-- 無既有規格修改 -->

## Impact

- 影響檔案：
  - `src-tauri/src/lib.rs`（新增 Tauri Command 並註冊至 Handler）
  - `src/services/DownloadService.ts`（更新 Windows 端網路請求調用）
- 效益：Windows 桌面版可無縫、穩定地進行頻道新片定時排程檢查與一鍵測試模擬，完全杜絕 `Failed to fetch` 錯誤。