## MODIFIED Requirements

### Requirement: Windows Native HTTP GET Fetching
Windows 桌面端 (Tauri) SHALL 提供原生 HTTP GET 請求通道，用於獲取任意外部網址的純文字內容（含 JSON 與 XML），並支援選填的請求標頭，而不受瀏覽器 CORS 限制。

支援選填請求標頭 MUST（必須）視為此通道的一部分，而非附加功能：頻道追蹤所用的 YouTube Data API 以 `X-goog-api-key` 標頭傳送金鑰，使金鑰不進入網址 —— 那是金鑰不經錯誤訊息外流的結構性保障，見本能力的「錯誤訊息不得包含請求網址的 query string」。

#### Scenario: 成功獲取 YouTube 頻道 RSS XML
- **WHEN** 前端傳入任意外部資源網址並調用原生 HTTP 請求
- **THEN** 系統 MUST 成功回傳完整的回應文字，且狀態碼為 200，不發生 CORS 跨域阻擋
- **AND** 此通道 MUST NOT（不得）限定回應的內容型別，JSON 與 XML MUST（必須）同樣支援

#### Scenario: 頻道自動追蹤排程與模擬測試執行
- **WHEN** 使用者在 Windows 桌面版點擊「立即檢查」或「模擬測試」按鈕
- **THEN** 系統 MUST 能正確解析頻道最新影片列表並加入下載佇列，不拋出 `Failed to fetch` 錯誤

#### Scenario: 帶選填標頭的請求
- **WHEN** 前端傳入請求標頭（例如 API 金鑰標頭）並調用原生 HTTP 請求
- **THEN** 系統 MUST（必須）將該標頭原樣送出
- **AND** 未傳入標頭時，行為 MUST（必須）與加入此參數之前完全一致
