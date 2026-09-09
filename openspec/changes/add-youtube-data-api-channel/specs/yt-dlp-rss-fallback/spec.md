## MODIFIED Requirements

### Requirement: yt-dlp RSS 備援擷取
當系統嘗試以其**所有前序通道**擷取頻道新片皆失敗時，系統 SHALL 自動喚醒 yt-dlp 進行 JSON 解析，作為最後順位的備用資料源。前序通道為 YouTube Data API（僅在使用者已設定有效金鑰時）與官方 RSS XML 網址。

yt-dlp MUST（必須）為最後順位 —— 它需啟動子行程、每輪候選視窗最小（僅 2 筆），且 `--flat-playlist` 不帶精確發布時間，成本與資料品質皆劣於前序通道，故 MUST NOT（不得）在任何前序通道仍可用時被優先採用。

#### Scenario: 官方 RSS 成功
- **WHEN** 系統要求獲取某頻道最新影片，且官方 RSS 端點正常回傳 200 OK 且包含有效的 XML
- **THEN** 系統直接解析 XML 並回傳，不觸發 yt-dlp 備援機制

#### Scenario: 官方 RSS 失敗引發備援
- **WHEN** 官方 RSS 端點回傳 404 Not Found 或其他網路錯誤
- **THEN** 系統自動呼叫內建的 `yt-dlp` 執行緒，目標為該頻道的首頁或 /videos 頁面，解析最新的影片資料並轉回內部共用的資料結構，使上層呼叫端無法察覺底層切換。

#### Scenario: 備援機制也失敗
- **WHEN** 官方 RSS 失敗，且 yt-dlp 也無法成功解析該頻道網頁（例如頻道被刪除）
- **THEN** 系統向上層拋出錯誤，觸發頻道錯誤的相關提示或計數。

#### Scenario: API 通道成功時不觸發備援
- **WHEN** 使用者已設定有效的 API 金鑰，且該通道成功回傳該頻道影片
- **THEN** 系統 MUST NOT 啟動 yt-dlp 子行程，亦 MUST NOT 發出官方 RSS 請求

#### Scenario: API 與 RSS 皆失敗才輪到備援
- **WHEN** API 通道失敗、官方 RSS 亦失敗，且使用者已開啟 yt-dlp 備援開關
- **THEN** 系統 MUST 啟動 yt-dlp 備援作為最後嘗試
- **AND** 使用者未開啟該開關時，系統 MUST NOT 啟動 yt-dlp，並依既有規則回報失敗
