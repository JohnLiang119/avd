## Why

自動追蹤頻道檢查目前是逐一跑完所有已啟用頻道，即使裝置根本沒有網路連線，也會讓每個頻道各自跑完退避重試（`channel-check-network-resilience` 引入的 2s→4s→8s，最壞 14 秒）才記一筆失敗，才輪到下一個頻道。2026-09-08 的實測（11 個頻道、跨約 5 分鐘）證實：第一筆失敗就是 `NETWORK_ERROR`（TCP 連線失敗），後續 10 個頻道逐一跑滿重試後仍全數失敗——裝置／出口網路顯然已經不通，卻仍讓使用者多等好幾分鐘、產生一長串幾乎必然重複的失敗紀錄。`channel-check-network-resilience` 的 design.md 已將此列為 Open Question，本次接續解決。

## What Changes

- 頻道檢查迴圈新增「提早停止」判斷：本輪只要有任一頻道的錯誤被分類為 `network`（裝置端網路層錯誤，如 DNS 解析失敗、連線逾時、連線被拒），立即停止檢查本輪剩餘的頻道，不再逐一跑完退避重試。
- 提早停止時，錯誤日誌與總結提示 MUST 明確標註「本輪已提早結束，尚有 N 個頻道未檢查」，不得讓使用者誤以為那些頻道也「檢查後失敗」。
- 被跳過的頻道本輪不觸碰其時間錨點（`lastPublishedTime`），效果等同於本輪未執行到它——與現有「頻道檢查失敗不推進錨點」的既有規則一致，不需要新邏輯。
- 僅網路層（`network`）錯誤觸發提早停止；伺服器層（`server`，即 HTTP 404/500 等）與內容層（`content`，如 XML 解析失敗）錯誤維持現行逐頻道處理，不觸發提早停止——因為伺服器層錯誤有可能只是單一頻道或短暫狀況，裝置端網路層錯誤才是「這台裝置現在確定連不上網」的明確訊號。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `channel-auto-monitor`: 頻道自動追蹤的檢查迴圈新增「偵測到裝置網路層錯誤即提早停止本輪剩餘頻道」的行為。

## Impact

- `src/App.vue`：`checkAllMonitoredChannels`（約 1620-1720 行）的頻道檢查迴圈新增提早停止判斷與對應的總結提示文案。
- 依賴 `channel-check-network-resilience` 已引入的 `classifyChannelRssError`（`src/services/rateLimit.ts`），不重造分類邏輯。
- 不影響 Rust／Java 邊界層或 RSS 擷取邏輯本身；純屬前端檢查迴圈的控制流程調整。
