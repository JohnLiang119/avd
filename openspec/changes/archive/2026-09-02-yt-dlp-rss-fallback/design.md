## Context

見 proposal.md。目前 `fetchYouTubeRss` 在遇到 404 或連線失敗時會直接 throw error。我們專案中已經有 `invoke('fetch_channel_info', ...)` 或類似的機制來呼叫 `yt-dlp` 嗎？
我們知道專案內建了 `yt-dlp` 執行檔，且前端有 `invoke` 可以執行各種 Tauri command。為了實作 fallback，我們可能需要在 `DownloadService.ts` 內呼叫一個 Tauri 指令來執行 `yt-dlp` 取得 JSON。

## Goals / Non-Goals

**Goals:**
- 在 `fetchYouTubeRss` 的 catch 區塊中實作 fallback 邏輯。
- 使用 `yt-dlp --dump-json --flat-playlist --playlist-end 2 "https://www.youtube.com/channel/..."` 來取得最新的兩支影片。
- 解析 `yt-dlp` 的輸出並轉換為 `YouTubeVideo` 陣列（`[{ videoId, title, url, publishedTime }]`）。

**Non-Goals:**
- 不完全取代官方 RSS（官方 RSS 速度極快，仍為 Tier 1 首選）。

## Decisions

### 1. 執行 yt-dlp 的方式
**選擇**：在 Tauri 後端新增一個 command `fetch_channel_videos_fallback(channel_id)`，由前端呼叫。這個指令會執行本機的 `yt-dlp` 執行檔，並回傳 JSON 字串。前端再將其 parsing 為陣列。
**理由**：前端無法直接 spawn process，必須透過 Tauri command。專案已經有執行 `yt-dlp` 的機制（可能已經有類似 `execute_yt_dlp` 的通用函式或特定的 command）。
如果現有的 command 已經支援，可以直接復用。如果沒有，則需要新增。我會在實作時檢查 `src-tauri/src/lib.rs` 或相關檔案來決定是最少改動的作法。

### 2. yt-dlp JSON 欄位對應
**選擇**：
- `id` -> `videoId`
- `title` -> `title`
- `url` -> `url`
- `timestamp` (如果有) -> `publishedTime` (因為 `--flat-playlist` 可能不會回傳精確時間，如果沒有，就用當前時間 `Date.now()`，這對於只看最新影片的排序邏輯也是足夠的，因為 `checkAllMonitoredChannels` 主要是比對 `videoId` 是否改變)。

## Risks / Trade-offs

- [風險] `yt-dlp` 執行速度較慢 (約 2-3 秒)。
  - **緩解**：作為 fallback，只在 RSS 失敗時觸發。且在背景自動排程中，延遲幾秒並無大礙。
- [風險] `--flat-playlist` 無法取得精確上傳時間。
  - **緩解**：`DownloadService` 只需要判斷是不是新影片，主要靠 `videoId` 與前次檢查的 `lastKnownVideoId` 比對。時間戳記可用 `Date.now()` 替代。
