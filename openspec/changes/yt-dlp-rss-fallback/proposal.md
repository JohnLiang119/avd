## Why

YouTube 官方的 RSS feed (`feeds/videos.xml`) 偶爾會發生不穩定、被限流或針對某些頻道回傳 404 Not Found 的狀況。當 RSS 失敗時，我們的頻道自動追蹤功能會完全停擺。為了確保頻道的自動監控不受官方 RSS 阻擋影響，我們需要一個強健的備援（Fallback）機制。

## What Changes

- 當 `DownloadService.fetchYouTubeRss` 嘗試使用官方 RSS 發生失敗（例如 404）時，自動切換至備援模式。
- 備援模式將呼叫內建的 `yt-dlp` (`--dump-json --flat-playlist --playlist-end 2`) 直接解析頻道首頁以獲取最新影片。
- 將 `yt-dlp` 取回的 JSON 資料轉換為與原本 XML 相同的 `YouTubeVideo` 資料結構，讓上層邏輯無縫銜接。

## Capabilities

### New Capabilities
- `yt-dlp-rss-fallback`: 當官方 YouTube RSS 失敗時，使用 yt-dlp 作為抓取頻道最新影片的備援方案。

### Modified Capabilities
<!-- 無修改既有 spec -->

## Impact

- 影響檔案：`src/services/DownloadService.ts` 及 `src-tauri/src/lib.rs` (若需新增 tauri command 來呼叫 yt-dlp 取得 JSON，或可直接用現有 command)。
- 只在發生錯誤時執行，不影響正常 RSS 請求的效能。
