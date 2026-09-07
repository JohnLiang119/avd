## ADDED Requirements

### Requirement: Network-Aware Failure Classification & Backoff Retry

系統在頻道 RSS 檢查失敗時 MUST（必須）依失敗性質分為三類：裝置端網路層錯誤（尚未連上伺服器即失敗，例如 DNS 解析失敗、連線逾時、連線被拒）、伺服器層錯誤（伺服器已回應但為非成功狀態碼）、以及內容層錯誤（已取得回應但內容無法解析為有效 RSS）。針對網路層與伺服器層錯誤，系統 MUST（必須）套用退避重試（間隔遞增，最多 3 次）後才視為該次檢查失敗；僅退避重試耗盡仍失敗時，系統才將該頻道計入本輪失敗數並寫入錯誤日誌。內容層錯誤不適用退避重試。

#### Scenario: 網路層或伺服器層錯誤於退避重試期間自行恢復
- **WHEN** 檢查頻道時發生裝置端網路層錯誤或伺服器層錯誤，且退避重試期間該錯誤消失
- **THEN** 系統視為本次檢查成功，不將該頻道計入本輪失敗數，也不寫入錯誤日誌

#### Scenario: 網路層或伺服器層錯誤於重試耗盡後才記錄
- **WHEN** 檢查頻道時發生網路層或伺服器層錯誤，且達到退避重試上限後仍然失敗
- **THEN** 系統將該頻道計入本輪失敗數，並將原始錯誤訊息（含錯誤層級判定與原文）寫入錯誤日誌

#### Scenario: 內容層錯誤不套用退避重試
- **WHEN** 檢查頻道時已取得伺服器回應，但回應內容無法解析為有效的 RSS
- **THEN** 系統不套用退避重試，直接依既有邏輯處理該次失敗（回報錯誤，或於已啟用備援時轉為 yt-dlp 備援）

## MODIFIED Requirements

### Requirement: Optional Fallback Mechanism and Source Transparency
系統 MUST 將 yt-dlp flat-playlist 首頁備援機制預設為關閉狀態，並在頻道監控設定中提供開關供使用者自由切換。當檢查頻道與建立任務時，系統 MUST 明確標註資料來源通道（官方 RSS 或 yt-dlp 備援）。

#### Scenario: RSS failure with fallback disabled
- **WHEN** 官方 RSS 於退避重試耗盡後仍判定為伺服器層或內容層錯誤，且使用者未開啟 yt-dlp 備援開關（預設狀態）
- **THEN** 系統不啟動 yt-dlp 子行程，直接回報官方 RSS 連線失敗提示，並提醒可於設定中開啟備援

#### Scenario: Network-layer failure does not suggest fallback
- **WHEN** 官方 RSS 於退避重試耗盡後仍判定為裝置端網路層錯誤（尚未連上伺服器）
- **THEN** 系統回報「目前無法連線（裝置未連上網路）」性質的提示，且不建議使用者開啟 yt-dlp 備援 —— 該機制同樣需要網路連線，此建議對此類錯誤無效

#### Scenario: Fallback enabled when RSS fails
- **WHEN** 官方 RSS 於退避重試耗盡後仍失敗，且使用者已於設定中開啟 yt-dlp 備援開關
- **THEN** 系統自動切換至 yt-dlp 爬取頻道首頁，並在回傳資料與任務排隊狀態中明確標註來源為備援通道 (`fallback`)

#### Scenario: Task and notification transparency
- **WHEN** 新影片被加入下載佇列或完成頻道檢查
- **THEN** 系統在任務狀態文字（`line`）與通知提示中明確標記資料來源通道（如 `【自動追蹤 (RSS)】` 或 `【自動追蹤 (yt-dlp 備援)】`）
