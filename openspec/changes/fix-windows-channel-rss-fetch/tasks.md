## 1. Rust 後端新增原生 HTTP 指令

- [x] 1.1 在 `src-tauri/src/lib.rs` 中實作 `fetch_http_text` 指令（設定 Timeout 10s 與標準 User-Agent）
- [x] 1.2 將 `fetch_http_text` 註冊至 Tauri 的 `generate_handler!` 清單中

## 2. 前端 DownloadService 適配

- [x] 2.1 更新 `src/services/DownloadService.ts` 中的 `fetchYouTubeRss`，在 `isTauri()` 環境下調用 `fetch_http_text`
- [x] 2.2 更新 `src/services/DownloadService.ts` 中的 `resolveYouTubeChannel` 網頁爬取 fallback，在 `isTauri()` 環境下調用 `fetch_http_text`

## 3. 編譯與驗證

- [x] 3.1 執行 `npm run build` 確認前端 TypeScript 編譯無誤
- [x] 3.2 執行 Tauri 開發或打包，驗證頻道 RSS 抓取與模擬測試不再報錯