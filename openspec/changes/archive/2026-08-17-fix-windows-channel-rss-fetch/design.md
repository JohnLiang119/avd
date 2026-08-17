## Context

請參閱 `proposal.md`。
在 Android 行動端，前端透過 `@capacitor/core` 的 `YoutubeDlPlugin` 呼叫原生 Java 代碼以 `HttpURLConnection` 發送網路請求，天然免疫瀏覽器環境的 CORS 限制。
但在 Windows 桌面版 (Tauri)，先前版本直接於前端執行瀏覽器原生 `fetch()` 抓取 YouTube RSS XML，因 YouTube 伺服器未提供開放的 CORS 標頭，導致 WebView2 攔截請求並拋出 `TypeError: Failed to fetch`。

## Goals / Non-Goals

**Goals:**
- 在 Tauri Rust 後端新增 `fetch_http_text(url: String)` 指令，透過 `ureq` 在本機網路層完成 HTTP GET 並回傳內容。
- 前端 `DownloadService` 在 Windows 環境下調用 `fetch_http_text` 取代直接 `fetch()`。
- 保證 Windows 桌面端「立即檢查」、「模擬測試」以及「加入頻道 @handle 解析」皆能穩定獲取內容。

**Non-Goals:**
- 不變更 Android 端既有 Java 原生外掛邏輯。
- 不引入外部額外的 npm 或 Rust 套件（`src-tauri/Cargo.toml` 已包含 `ureq = "2.10"`）。

## Decisions

### 決策 1：使用現有的 `ureq` Rust 套件實作 Tauri Command
- **方案**：在 `src-tauri/src/lib.rs` 中定義 `fetch_http_text` command，直接使用 `ureq::get(&url)` 獲取文字。
- **原因**：`ureq` 是輕量級、同步且高效的 Rust HTTP 用戶端，專案在處理自動更新下載時已依賴並編譯 `ureq`，無需引入龐大的 `reqwest` 或第三方插件。
- **替代方案**：
  - *使用 `@tauri-apps/plugin-http`*：需額外安裝 npm 套件與修改權限設定檔，增加相依複雜度。
  - *透過 `yt-dlp` 子進程下載 RSS*：啟動子進程需花費數百毫秒，且會消耗額外記憶體；Rust 原生 `ureq` 請求只需數十毫秒。

### 決策 2：前端服務層透明封裝
- **方案**：在 `DownloadService` 中封裝，判斷若為 `isTauri()` 則 `invoke('fetch_http_text', { url })`；若為 Web 或其他環境則降級為 `fetch(url)`。
- **原因**：保持上層 UI 元件（如 `App.vue`）邏輯完全解耦，不需感知平台底層網路請求差異。

## Risks / Trade-offs

- **[網路超時]** → 在 Rust 端設定合理的連線與讀取 Timeout（例如 10 秒），避免網路不佳時請求無限卡住。
- **[User-Agent 被擋]** → 在 `ureq` 請求時附帶標準瀏覽器 User-Agent 標頭（如 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...`）。