# windows-native-http-fetch Specification

## Purpose
為 Windows 桌面端（Tauri）提供繞過瀏覽器 CORS 限制的原生 HTTP GET 通道，使前端能直接取得 YouTube 頻道 RSS 等外部純文字與 XML 資源，確保頻道自動追蹤的定時輪詢與模擬測試在桌面版能與 Android 端行為一致，不因跨域阻擋而失敗。

## Requirements

### Requirement: Windows Native HTTP GET Fetching
Windows 桌面端 (Tauri) SHALL 提供原生 HTTP GET 請求通道，用於獲取任意外部網址的純文字與 XML 內容，而不受瀏覽器 CORS 限制。

#### Scenario: 成功獲取 YouTube 頻道 RSS XML
- **WHEN** 前端傳入 YouTube 頻道 RSS 網址（如 `https://www.youtube.com/feeds/videos.xml?channel_id=UC...`）並調用原生 HTTP 請求
- **THEN** 系統 MUST 成功回傳完整的 XML 文字字串，且狀態碼為 200，不發生 CORS 跨域阻擋

#### Scenario: 頻道自動追蹤排程與模擬測試執行
- **WHEN** 使用者在 Windows 桌面版點擊「立即檢查」或「模擬測試」按鈕
- **THEN** 系統 MUST 能正確解析頻道最新影片列表並加入下載佇列，不拋出 `Failed to fetch` 錯誤

### Requirement: 錯誤訊息不得包含請求網址的 query string

原生 HTTP 通道產生的錯誤訊息 MUST NOT（不得）包含請求網址的 query string。訊息得保留狀態碼、錯誤分類前綴與主機／路徑，但 query string MUST（必須）被去除或以遮蔽字樣取代。

此為**安全需求**：該通道承載的請求網址可能於 query string 中帶有機密（例如 YouTube Data API 金鑰），而此處產生的錯誤訊息會被寫入錯誤日誌，而錯誤日誌設計上就是要讓使用者複製出來求助。機密一旦寫入日誌，使用者貼出日誌時即等同公開該機密。

去除 query string MUST NOT（不得）改變既有的錯誤分類前綴語意 —— 依錯誤性質分層重試的規則倚賴該前綴，破壞它會使重試策略失效。

#### Scenario: 帶機密參數的請求失敗

- **WHEN** 經由原生 HTTP 通道請求一個 query string 含機密參數的網址，且該請求以非成功狀態碼失敗
- **THEN** 產生的錯誤訊息 MUST NOT 包含該 query string 或其中任何參數值
- **AND** 該訊息 MUST 仍包含可辨識的錯誤分類前綴與狀態碼

#### Scenario: 錯誤分類前綴不受影響

- **WHEN** 原生 HTTP 通道分別發生非成功狀態碼與傳輸層錯誤
- **THEN** 兩者 MUST 仍各自帶有既有的錯誤分類前綴，使上層能依錯誤性質決定重試策略
- **AND** 依該前綴分層的重試行為 MUST 與去除 query string 之前一致

#### Scenario: 頻道 RSS 失敗訊息亦不含 query string

- **WHEN** 官方頻道 RSS 請求失敗（其網址的 query string 含頻道識別碼）
- **THEN** 產生的錯誤訊息 MUST NOT 包含該 query string
- **AND** 使用者仍 MUST 能自錯誤日誌的上下文辨認是哪一個頻道失敗
