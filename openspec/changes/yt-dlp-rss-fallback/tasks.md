## 1. Tauri Backend 實作 (Rust)

- [x] 1.1 在 `src-tauri/src/lib.rs` 中尋找或新增一個執行 `yt-dlp` 的 command (例如 `fetch_channel_videos_fallback`)
- [x] 1.2 該 command 需帶入參數：`--dump-json --flat-playlist --playlist-end 2 "https://www.youtube.com/channel/{channel_id}"`
- [x] 1.3 捕獲並整理 `yt-dlp` 輸出的 JSON line，回傳給前端（可能是字串陣列）

## 2. Frontend 實作 (TypeScript)

- [x] 2.1 在 `src/services/DownloadService.ts` 內尋找 `fetchYouTubeRss` 函式
- [x] 2.2 在 XML 解析失敗的 `catch` 區塊中，呼叫 Tauri command `fetch_channel_videos_fallback`
- [x] 2.3 將回傳的 JSON 解析並映射至 `YouTubeVideo` 型別 (`{ videoId: id, title, url, publishedTime: Date.now() }`)
- [x] 2.4 若 fallback 也失敗，則正式 throw error。

## 3. 驗證與進版

- [x] 3.1 手動測試一組已知會回傳 404 的頻道 ID，確保 fallback 機制能正確抓取影片。
- [x] 3.2 確保專案順利編譯。
- [x] 3.3 修改版號至 `1.0.50` (`package.json`, `tauri.conf.json`, `build.gradle`)。
