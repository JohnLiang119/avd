## Why

官方 YouTube RSS 端點（`/feeds/videos.xml`）會回傳**隨機的假 404**，2026-09-09 實測一度達 100% 失敗且持續二十分鐘以上，靜置十分鐘後複測仍失敗；同一時間 yt-dlp 從同一個 IP 取用同一頻道完全正常，證實故障限於該端點而非 YouTube 整體或本機網路。現有兩層通道皆有硬限制：RSS 不可靠，yt-dlp 備援每輪僅取 2 筆且 `--flat-playlist` 不帶精確發布時間。YouTube Data API v3 是唯一有服務水準的官方通道，免費配額 10,000 units/日、無按次計費，以本專案的用量僅佔約 5%。

## What Changes

- 新增 YouTube Data API v3 作為頻道追蹤的第三個抓取通道，以使用者自填的 API key 啟用；**未填 key 時行為與現狀完全一致**。
- 抓取通道順序改為 **API → 官方 RSS → yt-dlp 備援**。已填 key 時 API 優先，可省下 RSS 假 404 的重試等待（現行每個失敗頻道約 1.1 秒）。
- 直播狀態驗證由「逐支影片各開一個 yt-dlp 行程」改為 `videos.list` 批次查詢（單次最多 50 支、僅 1 unit），並以 `liveStreamingDetails` 與 `snippet.liveBroadcastContent` 判定，取代 yt-dlp 的 `live_status` 字串。
- API 通道的候選視窗為每輪最多 50 筆（RSS 約 15、備援 2 筆），既有的「候選視窗達上限即限制錨點推進」規則需認得此新上限。
- 配額耗盡（HTTP 403 `quotaExceeded`）時降級至 RSS → yt-dlp，並在該日內不再重試 API，避免每輪白打；回饋須讓使用者知道正在降級而非「沒有新影片」。
- **API key 為機密**：MUST NOT 出現在任何錯誤訊息、錯誤日誌、Toast 或匯出的備份中。現行 `fetch_http_text` 的錯誤訊息會嵌入完整網址（含 query string），若不修正會把 key 寫進 `avd_error_log` —— 使用者貼日誌求助時即外洩。
- 不新增第三方依賴：API 為純 HTTP JSON，且實測 `googleapis.com` 完整支援 CORS（`Access-Control-Allow-Origin` 回應 Origin、OPTIONS 預檢 200），兩平台皆可直接以 `fetch()` 呼叫，Android 端不需新增原生外掛方法。

## Capabilities

### New Capabilities

- `youtube-data-api-channel`: 以使用者自填的 YouTube Data API v3 key 提供頻道新片擷取與批次直播狀態查詢；涵蓋 key 的設定、驗證、機密保護、uploads 播放清單解析、配額耗盡的降級與當日抑制。

### Modified Capabilities

- `channel-auto-monitor`: `Optional Fallback Mechanism and Source Transparency` —— 通道由兩層變三層且順序為 API 優先；來源標註須涵蓋第三種來源；「RSS 失敗且未開備援」的情境在已填 API key 時不再成立。
- `yt-dlp-rss-fallback`: `yt-dlp RSS 備援擷取` —— 觸發條件由「官方 RSS 失敗」改為「其前序通道皆失敗」，yt-dlp 由第二順位降為最後順位。

### Added-only Capabilities

下列能力**只新增** Requirement、不改動既有條文 —— 其既有行為未變，且刻意避開未歸檔的
`add-channel-subscription-keyword-filter` 所擁有的 Requirement，以免兩者互相覆寫：

- `auto-check-filtering`: 新增「直播狀態判定來源的等價對應」（yt-dlp `live_status` 與 API `liveStreamingDetails`／`liveBroadcastContent` 的映射）與「批次查詢部分失敗時，未能判定的影片一律視為狀態未知」。既有的「排除直播」行為不變 —— 逐支或批次查詢屬實作方式，不影響可觀察行為。
- `channel-check-feedback`: 新增「API 配額耗盡已降級」與「API key 無效」兩種回饋狀態，既有的成功／失敗分支不變。
- `windows-native-http-fetch`: 新增「錯誤訊息不得包含請求網址的 query string」。

## Impact

- `src/services/DownloadService.ts`：新增 API 通道的擷取與解析，改寫 `fetchYouTubeRss` 的通道選擇順序，並將 `checkVideoLiveStatus` 擴充為可批次的形式。
- `src-tauri/src/lib.rs`：`fetch_http_text` 的錯誤訊息需去除 query string（同時受益於 RSS 路徑）。
- `src/App.vue`：設定 UI 新增 API key 輸入（沿用既有 `avd_drive_token` 的 `van-field` 樣板）、`ChannelMonitorConfig` 新增欄位、檢查迴圈改用批次直播查詢、回饋新增降級分支。
- `src/composables/useChannelMatching.ts`：候選視窗上限需新增 API 的 50 筆一級（現行 `FALLBACK_ROUND_LIMIT` 僅有備援的 2 筆）。
- Android 端**不需**改動原生外掛（API 支援 CORS，WebView 可直接 `fetch()`）；`YoutubeDlPlugin.checkVideoLiveStatus` 在未填 key 時仍為直播查詢的實作，不移除。
- 使用者需自行於 Google Cloud Console 建立專案、啟用 YouTube Data API v3 並產生 API key。免費、不需信用卡；額外配額無法付費購買，僅能經人工審核的 Quota Extension Form 申請。

## 配額與公開發布的取捨

配額綁 Google Cloud 專案而非使用者。本專案以 GitHub Release 公開散布，若把單一 key 內嵌於安裝檔：所有使用者共用同一份 10,000 units/日（每人 20 頻道每小時一輪約需 500 units，約 20 個使用者即耗盡），且 key 可自安裝檔取出被盜用。故 key **必須**為使用者自填的選填設定，各自使用自己的專案配額；未填者維持現有 RSS → yt-dlp 行為，不因此喪失任何既有功能。

## 與其他 change 的依賴

- **`add-channel-subscription-keyword-filter` 尚未歸檔，且已對 `channel-auto-monitor`、`auto-check-filtering`、`channel-check-feedback` 提出 delta —— 正是本 change 五個 Modified 中的三個。** 該 change 的程式已實作完成並通過五項建置驗證，僅待人工驗證。本 change 的 delta MUST 以其歸檔後的主規格文字為基底撰寫；**建議先歸檔該 change，再實作本 change**。若順序顛倒，兩者會互相覆寫對方在同一條 Requirement 上的修改。
- **本 change 刻意不修改該 change 擁有的 Requirement**，以避免覆寫：`Periodic Check & New Video Matching`、
  `時間錨點的推進邊界`、`Exclude Live Streams from Queue`、`頻道檢查結果須區分成功與失敗狀態` 四條皆不列入本 change 的 delta。
- 錨點的候選視窗規則本身是**通用**的（「本輪取回筆數已達該資料來源每輪候選上限時」），故本 change 只需在新能力中
  宣告「API 通道每輪候選上限為 50 筆」，既有規則即自動適用，無須重寫該條。
  唯一遺留：該條括號內列舉的來源（「備援來源每輪 2 筆、官方 RSS 約 15 筆」）會少了 API 一級。
  這屬文件完整性而非行為缺口，**待 keyword change 歸檔後另以一行 MODIFIED 補上**，已列入 tasks。
- 該 change 也把直播狀態驗證的對象收斂為「通過關鍵字篩選的候選影片」；本 change 的批次查詢 MUST 沿用該收斂，只批次查詢命中關鍵字的候選影片。
