## Why

使用者從錯誤日誌中發現：50 筆紀錄裡有 38 筆是「Unable to resolve host」（裝置端 DNS 解析失敗，代表當下根本沒有網路），卻被系統一律包裝成「官方 RSS 連線失敗」並建議「開啟 yt-dlp 備援」——備援同樣需要網路，這個建議對真正的成因毫無幫助，只會讓使用者更加確信「YouTube RSS 壞了」而誤判。另有 11 筆屬於伺服器端 HTTP 404/500，且觀察到同一輪次內失敗集中在請求序列尾端（連續多個頻道全滅），呈現暫時性、疑似節流的特徵，但目前對這類錯誤同樣是零重試、立即記入日誌。三種性質不同的失敗被同一句訊息、同一種處置方式抹平，日誌因此被暫時性噪音塞滿（環狀上限僅 50 筆），也讓使用者難以看出真正需要處理的問題。

## What Changes

- 在 `fetchYouTubeRss` 的錯誤路徑中辨識錯誤的**層級**：裝置端網路層錯誤（DNS 解析失敗、連線逾時、連線被拒）、伺服器層錯誤（HTTP 狀態碼）、以及內容解析錯誤（RSS XML 無法解析），不再一律歸因為「官方 RSS 連線異常」。
- 網路層錯誤與可能為暫時性節流的伺服器錯誤（HTTP 404/500/429 等）套用既有 `rateLimit.ts` 的退避重試模式（2s → 4s → 8s，最多 3 次），沿用其「暫時性狀況應自行解除」的既定原則，而非新增另一套機制。
- 只有退避重試全部耗盡後仍然失敗，才計入 `failedCount` 並寫入錯誤日誌；多數暫時性斷網或短暫節流會在重試中自行恢復，不再產生日誌噪音。
- 依錯誤層級提供對應措辭：裝置端網路層錯誤不再建議「開啟 yt-dlp 備援」（備援同樣需要網路，此建議對此成因無效），僅在確認為伺服器/RSS 內容層級的錯誤時才保留該建議。
- Android 端 `fetchChannelRss` 的例外處理需區分 `UnknownHostException`（網路層）與其他 `IOException`／HTTP 非 200（伺服器層），並將區分後的資訊傳遞給前端。
- Windows/Tauri 端透過 `fetch_http_text` 拋出的錯誤訊息同樣需要被前端依相同規則分類（Rust 端訊息格式現況為何，於 design.md 中確認後決定分類方式）。

## Capabilities

### New Capabilities
（無新增能力，本次為既有能力的行為修正）

### Modified Capabilities
- `channel-auto-monitor`: 新增「錯誤分級與退避重試」需求；修改既有「Optional Fallback Mechanism and Source Transparency」需求下與 RSS 連線失敗相關的情境，使備援建議僅於適用時出現。

## Impact

- `src/services/DownloadService.ts`：`fetchYouTubeRss` 的 catch 區塊需要重構為分級判斷 + 退避重試迴圈。
- `src/services/rateLimit.ts`：可能需要擴充判斷函式以辨識網路層錯誤訊息特徵（沿用既有 `shouldBackoff` 模式，不另建新檔）。
- `android/app/src/main/java/com/mattpocock/avd/YoutubeDlPlugin.java`：`fetchChannelRss` 例外處理需區分 `UnknownHostException` 與其他失敗，並將分類資訊回傳給前端。
- `src/App.vue`：`checkAllMonitoredChannels` 的錯誤日誌寫入時機（現於每次失敗立即寫入，需改為退避耗盡後才寫入）與總結 Toast 措辭（依錯誤層級調整備援建議的出現條件）。
- 不影響任務佇列、時間錨點（`lastPublishedTime`）等既有資料完整性邏輯——本次修改只涉及錯誤的分類、重試與呈現方式。
