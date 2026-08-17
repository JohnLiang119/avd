## Purpose

在 Windows 桌面端提供原生層級的 HTTP 文字內容獲取能力，以繞過 WebView2 瀏覽器環境對 YouTube 頻道 RSS 及相關網頁資源的 CORS 跨域安全限制。

## ADDED Requirements

### Requirement: Windows Native HTTP GET Fetching
Windows 桌面端 (Tauri) SHALL 提供原生 HTTP GET 請求通道，用於獲取任意外部網址的純文字與 XML 內容，而不受瀏覽器 CORS 限制。

#### Scenario: 成功獲取 YouTube 頻道 RSS XML
- **WHEN** 前端傳入 YouTube 頻道 RSS 網址（如 `https://www.youtube.com/feeds/videos.xml?channel_id=UC...`）並調用原生 HTTP 請求
- **THEN** 系統 MUST 成功回傳完整的 XML 文字字串，且狀態碼為 200，不發生 CORS 跨域阻擋

#### Scenario: 頻道自動追蹤排程與模擬測試執行
- **WHEN** 使用者在 Windows 桌面版點擊「立即檢查」或「模擬測試」按鈕
- **THEN** 系統 MUST 能正確解析頻道最新影片列表並加入下載佇列，不拋出 `Failed to fetch` 錯誤