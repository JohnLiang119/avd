## Context

見 proposal.md - Why。補充實測與程式碼現況：

- Android 端 `YoutubeDlPlugin.fetchChannelRss`（`android/app/src/main/java/com/mattpocock/avd/YoutubeDlPlugin.java:653-692`）目前只有單一 `catch (Exception e)`，非 200 狀態碼會先 `call.reject("HTTP " + code + ": 無法獲取頻道 RSS")`，其餘例外（含 `UnknownHostException`）一律落入同一句 `"獲取頻道 RSS 失敗: " + e.getMessage()`。
- Windows/Tauri 端 `fetch_http_text`（`src-tauri/src/lib.rs:119-142`）使用 `ureq` crate，`.call()` 回傳的 `ureq::Error` 直接以 `format!("HTTP 請求失敗: {}", e)` 轉字串丟給前端 —— 這會把 `ureq::Error::Status`（伺服器已回應非 2xx）與 `ureq::Error::Transport`（DNS 解析失敗、連線逾時等，尚未觸及伺服器）兩種完全不同性質的錯誤，壓成同一種文字格式。兩平台對同一類錯誤（沒有網路）產生的原始文字完全不同（Java 的 `UnknownHostException` 訊息 vs. `ureq` 的 Transport 錯誤訊息），無法用同一組關鍵字比對兩邊。
- `src/services/DownloadService.ts` 的 `fetchYouTubeRss`（約 1312-1410 行）目前對錯誤只有二分：有無啟用備援，沒有任何重試。
- 專案已有 `src/services/rateLimit.ts` 的退避重試模式（`isRateLimited`/`isThrottleSymptom`/`shouldBackoff`/`rateLimitBackoffMs`，2s→4s→8s 共 3 次），但目前只接在下載/解析路徑，未接到頻道檢查路徑。
- 實測（`curl` 直接打 YouTube feeds 端點）證實：乾淨 channelId 回 200，帶入額外查詢字串的 ID 回 404。但本次稽核已確認前端 `resolveChannel` 的正則固定擷取 22 碼，不會讓分享連結的 `?si=...` 污染 channelId ——故 12:51 那批 404/500 的成因仍是未知的伺服器端狀況（可能為暫時性限流），本次設計以「視為可能暫時性、套用退避重試」處理，不假定成因。

## Goals / Non-Goals

**Goals:**
- 讓 Windows 與 Android 兩端都能可靠區分「裝置端網路層錯誤」「伺服器層錯誤（HTTP 狀態碼）」「內容層錯誤（RSS 解析失敗）」三類。
- 對網路層與伺服器層錯誤套用退避重試，重試耗盡才計入失敗與寫入日誌。
- 依錯誤層級調整使用者看到的訊息，網路層錯誤不再建議開啟 yt-dlp 備援。
- 沿用 `rateLimit.ts` 既有的退避重試常數與模式，不重造一套機制。

**Non-Goals:**
- 不新增裝置網路狀態監聽（如 Android `ConnectivityManager`／`navigator.onLine`）作為排程是否執行的前置判斷——那是「從源頭避免觸發」的另一種方案，本次只處理「觸發後如何分類與呈現」，範圍更小、風險更低。
- 不改變 `lastPublishedTime` 時間錨點的既有規則（本次已確認失敗頻道不會推進錨點，資料完整性不受影響，見 proposal.md - Impact）。
- 不新增「連續失敗 N 輪視為永久性故障」的頻道健康度追蹤機制——目前證據只涵蓋單一時間點的一批日誌，尚不足以支撐這類設計，留待未來有更多實據再議。
- 不變更 `downloadErrors.ts` 既有的下載錯誤分類（那是 yt-dlp 下載/解析路徑的既定契約，與本次的 RSS 檢查路徑是不同呼叫端）。

## Decisions

### 1. 由我方邊界程式碼組裝分類前綴，不比對第三方錯誤文字

**決策**：在 Rust 的 `fetch_http_text` 與 Java 的 `fetchChannelRss` 內，明確依例外/錯誤類型分流，各自組裝成專案自訂、雙平台一致的前綴字串再傳給前端：
- `NETWORK_ERROR:<原始訊息>` —— 尚未連上伺服器（Java: `UnknownHostException`、`ConnectException`、`SocketTimeoutException`；Rust: `ureq::Error::Transport`）
- `HTTP_STATUS:<code>:<原始訊息>` —— 伺服器已回應非成功狀態碼（Java: 既有的非 200 判斷分支；Rust: `ureq::Error::Status`）
- 其餘情況（例如 XML 為空、DOMParser 解析失敗）維持現狀，在 `DownloadService.ts` 內以既有邏輯判定為內容層錯誤

`DownloadService.ts` 新增一個分類函式（沿用 `rateLimit.ts` 檔案內既有的純函式風格，同檔新增或緊鄰新增，不另開新模組）解析這個前綴，決定要不要進入退避重試迴圈、以及最終呈現哪種訊息。

**替代方案考慮**：延續現有模式，直接比對 `e.message` 內的關鍵字（如 `"Unable to resolve host"`）。
**否決理由**：這正是 `rateLimit.ts` 開頭註解承認的既有局限——「yt-dlp 不提供結構化的錯誤代碼，只能比對訊息文字」，那是因為 yt-dlp 是外部工具、我方無法控制其輸出格式，比對文字是不得已的妥協。但 `fetch_http_text` 與 `fetchChannelRss` 是我方自己寫的邊界程式碼，`ureq::Error` 的 `Display` 文字與 Java 例外訊息本來就分屬兩個完全不同的字串格式，且都可能隨函式庫版本、系統語言而改變。與其比對兩份不受控又互不相同的第三方文字，不如由我方在最靠近錯誤發生處明確分流、組裝一份雙平台共用的前綴——這是我方可以測試、可以保證穩定的契約。

### 2. HTTP 404 與 500 都視為可退避重試的候選，不當作確定性錯誤

**決策**：伺服器層錯誤（含 404、500）一律先套用退避重試，不在此路徑新增「404 必然是永久性錯誤」的判斷。

**理由**：本次稽核的實測日誌顯示，同一輪次 19 個頻道中有 8 個成功、11 個以 404/500 混合失敗，且失敗集中在請求序列尾端——這個形狀與漸進式節流的特徵相符，且已知同一個頻道（`程劈`）在 09/07 稍早成功、稍晚又失敗過，代表 404/500 在本專案的情境中不是穩定可重現的確定性錯誤。`downloadErrors.ts` 對 yt-dlp 下載路徑的確定性錯誤清單刻意只收「語意明確、不可能因網路狀況出現」的訊息（如 `Video unavailable`）——單純的 HTTP 404/500 不具備這種明確性，不應比照辦理。

**替代方案考慮**：把 HTTP 404 視為確定性錯誤（頻道被刪除／ID 失效），不重試、直接記錄。
**否決理由**：會與已觀測到的「同頻道時好時壞」證據矛盾，且會讓使用者對暫時性的伺服器狀況重新看到本次要解決的那種噪音。

### 3. 退避重試迴圈的位置：包在 `fetchYouTubeRss` 內、既有備援邏輯之前

**決策**：重試迴圈包住現有「取得 XML」那一段（Android 呼叫 `YoutubeDlPlugin.fetchChannelRss` 或 Windows 呼叫 `invoke('fetch_http_text')`），對網路層與伺服器層錯誤重試最多 3 次（沿用 `rateLimit.ts` 的 `RATE_LIMIT_MAX_RETRIES`、`rateLimitBackoffMs`）。重試全部耗盡後，才進入現有的「未啟用備援則拋錯／已啟用備援則轉 yt-dlp」邏輯，該段既有邏輯本身不變。

**理由**：改動面最小——呼叫端（`checkAllMonitoredChannels`、`addManualChannel`、`simulateNewVideo` 等）完全不需要修改，錯誤日誌的寫入時機與內容也不用動，只是「進到 catch 之前，系統已經自己多試了幾次」。

### 4. 訊息呈現：新增一個依分類回傳文案的純函式

**決策**：在 `App.vue` 的總結 Toast 組字邏輯之前，新增一個純函式（放在 `DownloadService.ts` 或緊鄰 `rateLimit.ts`，依錯誤分類回傳對應文案），取代目前寫死的三元判斷字串。網路層錯誤回傳「目前無法連線（裝置未連上網路），請確認網路後再試」，不含備援建議；伺服器層/內容層錯誤維持現有措辭（含備援建議）。

## Risks / Trade-offs

- **[Risk]** 19 個頻道循序檢查，若多個頻道同時遇上網路層錯誤，每個都要跑滿 3 次退避（最壞情況每頻道多等 14 秒），總檢查時間可能顯著拉長。
  → **Mitigation**：這與 `rateLimit.ts` 現有文件的立場一致（14 秒退避在 90 秒解析逾時內仍有餘裕）；且退避發生時使用者原本就處於無網路狀態，實際體感影響有限，也沒有其他前景操作在等待這個背景排程完成。是否需要「單輪內第一次偵測到網路層錯誤就快速跳過剩餘頻道」的最佳化留在 Open Questions。

- **[Risk]** 伺服器層錯誤一律重試 3 次，若某頻道真的因頻道被刪除等原因而永久 404，使用者仍需等待重試耗盡才會看到日誌，且日誌不會標註「這是重複發生的」。
  → **Mitigation**：本次刻意不做健康度追蹤（見 Non-Goals），因為現有證據不足以支撐這類設計；重試耗盡後的日誌仍保留完整原始 HTTP 狀態碼與錯誤層級，使用者或未來的分析仍讀得到「這裡持續是 404」的線索，只是不會被系統主動標記。

- **[Risk]** Rust `ureq::Error::Transport` 與 Java 各類網路例外的實際型別覆蓋範圍需要在實作時逐一確認（例如 Rust 端 DNS 失敗、TCP 連線被拒、TLS 握手失敗是否都落在 `Transport` 變體），若漏判某個子類型，該類錯誤會被誤分類為伺服器層或內容層。
  → **Mitigation**：實作階段需針對 `ureq::Error` 的 `Kind` 逐一核對官方文件與原始碼，並在 tasks.md 中列為明確查核項；即使初版分類有遺漏，最壞情況只是退回目前的行為（該錯誤仍會被記錄與呈現，只是措辭less精準），不會產生新的功能性故障。

## Migration Plan

無資料遷移。純行為變更，依專案既有版本進版規範（`CLAUDE.md`）走：完成後同步更新 Windows 與 Android 雙端版號，並在完整建置與測試通過後進版。不涉及使用者資料格式或既有設定欄位的改變。

## Open Questions

- 單輪檢查中，一旦第一個頻道就偵測到網路層錯誤，是否應該快速失敗（跳過剩餘頻道的重試，直接判定整輪為無網路），以縮短總等待時間？此決策不影響 spec 定義的對外可觀察行為（使用者仍會看到「暫時性錯誤最終自行恢復、不產生日誌噪音」的結果），可留待 tasks 階段依實作與實測手感決定，不影響現有規格與設計方向。
