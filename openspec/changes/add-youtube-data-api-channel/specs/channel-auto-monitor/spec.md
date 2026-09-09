## MODIFIED Requirements

### Requirement: Optional Fallback Mechanism and Source Transparency
系統 MUST 將 yt-dlp flat-playlist 首頁備援機制預設為關閉狀態，並在頻道監控設定中提供開關供使用者自由切換。當檢查頻道與建立任務時，系統 MUST 明確標註資料來源通道（YouTube Data API、官方 RSS 或 yt-dlp 備援）。

擷取通道 MUST（必須）依下列順序嘗試：**YouTube Data API（僅在使用者已設定有效金鑰時）→ 官方 RSS → yt-dlp 備援（僅在使用者已開啟該開關時）**。系統 MUST（必須）在前一順位確定失敗後才嘗試下一順位，且 MUST NOT（不得）在同一輪對同一頻道同時使用多個通道。

來源標註 MUST（必須）涵蓋全部三種通道 —— 使用者需能自任務狀態文字與通知辨認資料實際來自哪個通道，否則無從判斷抓取品質（各通道的候選視窗與發布時間精確度並不相同）。

#### Scenario: RSS failure with fallback disabled
- **WHEN** 官方 RSS 連線異常、使用者未設定 API 金鑰，且未開啟 yt-dlp 備援開關（預設狀態）
- **THEN** 系統不啟動 yt-dlp 子行程，直接回報官方 RSS 連線失敗提示，並提醒可於設定中開啟備援

#### Scenario: Fallback enabled when RSS fails
- **WHEN** 官方 RSS 連線異常且使用者已於設定中開啟 yt-dlp 備援開關
- **THEN** 系統自動切換至 yt-dlp 爬取頻道首頁，並在回傳資料與任務排隊狀態中明確標註來源為備援通道 (`fallback`)

#### Scenario: Task and notification transparency
- **WHEN** 新影片被加入下載佇列或完成頻道檢查
- **THEN** 系統在任務狀態文字（`line`）與通知提示中明確標記資料來源通道（如 `【自動追蹤 (RSS)】`、`【自動追蹤 (yt-dlp 備援)】` 或 API 通道的對應標記）

#### Scenario: 已設定 API 金鑰時 API 為第一通道
- **WHEN** 使用者已設定有效的 YouTube Data API 金鑰且該通道可用
- **THEN** 系統 MUST 以 API 通道擷取該頻道影片，MUST NOT 發出官方 RSS 請求，亦 MUST NOT 啟動 yt-dlp
- **AND** 建立的任務與通知 MUST 標註來源為 API 通道

#### Scenario: API 失敗後依序降級
- **WHEN** 已設定 API 金鑰但該通道本輪失敗（配額耗盡、金鑰無效或網路錯誤）
- **THEN** 系統 MUST 改以官方 RSS 擷取該頻道
- **AND** 官方 RSS 亦失敗時，MUST 依既有規則決定是否啟用 yt-dlp 備援
- **AND** 最終成功的通道 MUST 被正確標註，MUST NOT 沿用先前失敗通道的來源標記
