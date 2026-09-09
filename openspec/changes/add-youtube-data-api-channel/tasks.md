## 0. 前置條件與測試可行性（先讀，決定每節的驗證方式）

**前置條件（阻擋性）**：`add-channel-subscription-keyword-filter` 尚未歸檔，且已對本 change 相鄰的四條
Requirement 提出 delta。本 change 的第 4 節會改造它才剛修正的錨點守門與關鍵字收斂邏輯。
**開始第 4 節之前 MUST 先歸檔該 change**（見 `proposal.md` 的依賴段落），否則兩者會互相覆寫。
第 1～3 節與該 change 無交集，可先行。

本 change 的可測性比既有的 `App.vue` 改動好很多，任務不得混寫兩者：

- **可自動測試層**：`src/services/__tests__/DownloadService.spec.ts` 已證實能在 vitest 中匯入
  `DownloadService`，並以**注入相依**（`request`、`sleep`）的方式測試 `fetchChannelRssWithRetry`。
  API 通道的回應解析、狀態映射、錯誤辨識、抑制時點計算、通道選擇順序一律比照此模式：
  放進新的 `src/services/youtubeDataApi.ts`（純函式 + 注入 fetch，無 Tauri 相依），
  以 `npx vitest run src/services/__tests__/youtubeDataApi.spec.ts` 驗證。
- **不可自動測試層**：`src/App.vue` 的檢查迴圈、設定 UI 與回饋分支仍寫在 `<script setup>` 的內嵌
  未匯出函式中，且本專案**未安裝 `@vue/test-utils`**，現有 12 個 spec 檔沒有任何一個 mount `App.vue`。
  故第 4～5 節**不得宣稱自動測試覆蓋**，一律以「靜態核對（grep 呈現佈線）＋ 第 6 節指定編號的人工驗證」作為完成方式。
- **Rust 層**：`src-tauri` 無單元測試慣例，第 1 節以 `cargo check` 加第 6 節人工驗證。

## 1. 安全基礎：機密不得進入錯誤訊息（可先行，獨立可驗證）

本節獨立於 API 功能，且**立即改善既有 RSS 的錯誤訊息**，故排在最前。

- [x] 1.1 【D-B】為 `src-tauri/src/lib.rs` 的 `fetch_http_text` 增加選填的 `headers` 參數（`Option<HashMap<String, String>>`），未傳時行為與現況完全一致；完成方式：`cargo check --manifest-path src-tauri/Cargo.toml` 通過，且 `grep -n "fetch_http_text" src/services/DownloadService.ts` 顯示既有 RSS 呼叫點未傳 headers、程式碼未改
  - 三個既有呼叫點（`DownloadService.ts:1378`、`:1475`、`:1576`）皆未傳 headers，程式碼未改。
- [x] 1.2 【縱深防禦】`fetch_http_text` 的錯誤訊息 MUST NOT 包含請求網址的 query string。現行實作把 `ureq` 錯誤字串（含完整網址）直接嵌入 `HTTP_STATUS:{status}:{message}`；改為在組訊息前去除 query string，且 MUST 保留 `HTTP_STATUS:` 與 `NETWORK_ERROR:` 前綴不變 —— `channelRssRetryDelays` 依該前綴分層重試，破壞它會使重試策略失效；完成方式：`cargo check` 通過，並由 6.6 人工驗證錯誤日誌中的 RSS 失敗訊息不再含 `?channel_id=...`
  - 以 query 片段字串比對移除，前綴 `HTTP_STATUS:`／`NETWORK_ERROR:` 保留不變。
- [x] 1.3 確認既有 RSS 重試行為未因 1.2 回歸；完成方式：`npx vitest run src/services/__tests__/DownloadService.spec.ts` 的 7 個既有案例全數綠燈（其斷言以 `HTTP_STATUS:404:` 等前綴為輸入，可直接證明前綴語意未變）
  - `DownloadService.spec.ts` 7 個既有案例全數綠燈，證明前綴語意未變。
- [x] 1.4 【實作階段新增】`fetch_http_text` 於 `Error::Status` 且 `Content-Type` 為 JSON 時，把截斷（500 字元）後的回應 body 附加到錯誤訊息；非 JSON（如 RSS 的 HTML 404 頁）維持不附加。理由：桌面端 `ureq` 的錯誤字串不含 body，而區分配額耗盡與金鑰無效所需的 reason 只在 body 的 JSON 中，單看狀態碼不足（403 兩者皆可能）；Android 端以 `fetch()` 無此問題。完成方式：`cargo check` 通過、`DownloadService.spec.ts` 7 個既有案例仍綠燈（前綴語意未變），並由 6.6 人工驗證 RSS 失敗訊息未混入 HTML
  - 由 3.2 的接線工作揭露的規劃缺口，經使用者選定此解法後補入；design 決策 D-B 已補記。

## 2. API 通道純函式層（可自動測試）

本節全部實作於新檔 `src/services/youtubeDataApi.ts`，測試於
`src/services/__tests__/youtubeDataApi.spec.ts`。除另有註明外，每項完成方式皆為：
`npx vitest run src/services/__tests__/youtubeDataApi.spec.ts` 綠燈且該項指定案例存在。
本節 MUST NOT 引入任何 `@tauri-apps/*` 匯入，否則失去可測性。

- [x] 2.1 【D-A】實作請求建構純函式：金鑰經 `X-goog-api-key` **標頭**傳送，網址只含 `part`／`playlistId` 或 `id`／`maxResults`；完成方式：測試斷言產生的網址字串**不含**金鑰的任何片段（以可辨識的假金鑰如 `AIzaTESTKEY` 驗證），且標頭物件含 `X-goog-api-key`
  - 網址斷言不含 `AIza`／`key=`／完整假金鑰；金鑰只在 `X-goog-api-key` 標頭。
- [x] 2.2 【D-H】實作 uploads 播放清單識別碼推導：`UC` 前綴替換為 `UU`；完成方式：測試驗證 `UCUexfyzlAnIiCIcUqrZDFBA` → `UUUexfyzlAnIiCIcUqrZDFBA`，且非 `UC` 開頭的輸入回傳 `null`（代表需改走 `channels.list` 查詢）
  - 另補 `parseUploadsPlaylistId` 解析 `channels.list` 回應。
- [x] 2.3 實作 `playlistItems` 回應解析為共用的影片結構（影片識別碼、標題、精確發布時間、`source: 'api'`）；【規格】缺少可解析發布時間的影片 MUST NOT 以當下時間替代，其 `publishedTime` 為 `0` 以沿用既有錨點守門；完成方式：測試以固定 JSON 樣本驗證正常解析、缺 `publishedAt` 時 `publishedTime` 為 `0`、缺 `videoId` 的項目被略過
  - 另補「回應非預期形狀回傳空陣列不拋錯」。
- [x] 2.4 【D-J】宣告 API 通道每輪候選上限為 50 並作為 `maxResults`；MUST NOT 實作分頁（不使用 `pageToken`）；完成方式：測試驗證請求網址含 `maxResults=50`、且解析函式對含 `nextPageToken` 的回應**不**發出後續請求（以注入的 fetch 呼叫次數為 1 斷言）
  - 為使「fetch 呼叫次數為 1」可如實斷言（純解析函式無 fetch 可數），一併實作了注入 fetch 的 `fetchChannelVideosViaApi`；該函式本為 3.2 所需，提前至此以取得可測性。
- [x] 2.5 實作 `videos.list` 批次請求建構與回應解析，單批最多 50 個影片識別碼；完成方式：測試驗證 8 支影片產生 1 次請求、120 支產生 3 次請求（50/50/20）
  - 8 支→1 批、120 支→3 批（50/50/20）、空清單→0 批。
- [x] 2.6 【規格：狀態等價】實作直播狀態映射：API 的 `liveBroadcastContent`／`liveStreamingDetails` 映射為既有的 `'live' | 'not_live' | 'unknown'` 三態，語意與 yt-dlp 的 `live_status` 等價（`is_live`／`is_upcoming` → `'live'`）；完成方式：測試驗證進行中直播與排程未開播皆映射為 `'live'`、一般影片與已結束存檔直播映射為 `'not_live'`、缺少狀態欄位映射為 `'unknown'`
  - 已結束存檔直播（帶 `liveStreamingDetails` 但 `liveBroadcastContent` 為 `none`）驗證為 `not_live`。
- [x] 2.7 【規格：批次部分失敗】實作批次結果為 `Map<videoId, LiveCheckResult>`：回應未涵蓋的影片一律 `'unknown'`，整批請求失敗時該批所有影片一律 `'unknown'`，MUST NOT 預設為 `'not_live'`；完成方式：測試驗證送 10 支但回應僅 8 支時另 2 支為 `'unknown'`、整批拋錯時 10 支全為 `'unknown'`
  - 另補「一批失敗不影響其餘批次」。
- [x] 2.8 實作 API 錯誤分類純函式，區分「配額耗盡」、「金鑰無效／服務未啟用」與「其他錯誤」三類；完成方式：測試以固定錯誤 JSON 樣本驗證 403 `quotaExceeded` 歸為配額耗盡、400 `API key not valid` 與 403 `accessNotConfigured` 歸為金鑰問題、5xx 與網路錯誤歸為其他
  - 另補「配額與金鑰兩類不得互相誤判」。
- [x] 2.9 【D-F】實作配額抑制時點計算：回傳下一個太平洋時間（`America/Los_Angeles`）午夜的時間戳，以 `Intl.DateTimeFormat` 換算，MUST NOT 引入時區函式庫；完成方式：測試以固定時間戳釘住三個邊界 —— 太平洋日中、太平洋午夜前一分鐘，以及**日光節約時間切換日**；有疑義時取較晚時點（過長只是不用配額，過短會恢復白打）
  - **原先的 DST 測試是空測並已修正**：轉換發生在當地 02:00，故從「換日日前一天中午」到「換日日午夜」不跨越轉換，天真 +24h 也會正確。真實邊界是 `now` 落在換日日 00:00–02:00 之間 —— 實測秋季回撥日 00:30 PDT 時天真實作落在 23:00 PST（差一小時），本實作校正至隔日 00:00；春季前撥日落在 01:00 PDT（偏晚），依設計刻意不往回修。
- [x] 2.10 【D-G】實作金鑰指紋純函式（不可還原的短摘要）與抑制判定：當記錄的被拒指紋與當前金鑰指紋相符時抑制；完成方式：測試驗證同一金鑰得到相同指紋、不同金鑰得到不同指紋、指紋**不含**金鑰任何片段（以假金鑰子字串斷言）、金鑰更換後抑制判定為 false
  - 指紋為 FNV-1a（非安全雜湊，僅供變更偵測，已於註解說明）；斷言不含金鑰任何片段且格式為 8 位十六進位。
- [x] 2.11 實作通道選擇純函式：依「有無有效金鑰、是否處於配額抑制、是否處於金鑰無效抑制」決定本輪第一通道；完成方式：測試驗證無金鑰→RSS、有金鑰且未抑制→API、配額抑制中→RSS、金鑰無效抑制中→RSS、抑制時點已過→恢復 API
  - 五種狀態組合皆有案例。
- [x] 2.12 【範圍調整】實作當日用量計數純函式：累計單位並於配額重置時點歸零，重置時點 MUST 與 2.9 的 `nextQuotaResetTime` 為同一計算，兩者不得各自為政；完成方式：測試驗證同一配額日內累加、跨越重置時點後自零起算、缺少既有狀態時視為零、且重置時點與 `nextQuotaResetTime(now)` 相符
  - 重置時點重用 `nextQuotaResetTime`，與配額耗盡抑制同一計算，避免「抑制已解除但計數未歸零」的矛盾狀態。另補 `currentApiUnitsUsed` 供顯示使用 —— 直接讀 `used` 會在跨日後殘留昨日數字。6 個測試。

## 3. 通道接線與更名（`DownloadService`）

- [x] 3.1 【D-D】將 `DownloadService.fetchYouTubeRss` 更名為 `fetchChannelVideos`，並更新其 4 個呼叫點（`App.vue` 的檢查迴圈、`addManualChannel`、`simulateNewVideo`、`simulateGlobalNewVideo`）；完成方式：`grep -rn "fetchYouTubeRss" src/` 無殘留，且 `npx vue-tsc --noEmit` 通過
  - 7 處更名（`DownloadService.ts` 1、`App.vue` 5、`useChannelMatching.ts` 註解 1），`grep -rn "fetchYouTubeRss" src/` 無殘留，`vue-tsc --noEmit` 通過。
- [x] 3.2 在 `fetchChannelVideos` 內接上三層降級鏈 **API → RSS → yt-dlp**，以 2.11 的通道選擇決定起點；【規格】未設金鑰時 MUST NOT 發出任何 API 請求；【D-C】桌面端 API 請求走 1.1 的 `fetch_http_text`（帶標頭），Android 端直接用 WebView `fetch()`；完成方式：`grep -n "isTauri()" -A 6 src/services/DownloadService.ts` 呈現兩平台分支，並由 6.2 人工驗證未設金鑰時無任何 `googleapis.com` 請求
  - 三層鏈封裝於 `fetchChannelVideos`；平台差異收斂於單一的 `fetchApiJson`（桌面走帶標頭的 `fetch_http_text`，Android 走 WebView `fetch()`）。未提供 `api` 選項或金鑰為空時完全不觸碰 API。
- [x] 3.3 為 `MonitoredVideoResult.source` 增加 `'api'`，並確認任務狀態文字與通知的來源標註涵蓋三種通道；完成方式：`npx vue-tsc --noEmit` 通過（型別聯集變更會迫使所有 `source` 分支處補齊），並由 6.5 人工驗證任務 `line` 顯示 API 來源標記
  - 型別加寬**未**觸發編譯錯誤（`source === 'fallback' ? A : B` 非窮盡），故手動找齊三處標註點並集中為 `channelSourceLabel()`，避免下次新增通道再漏。`MatchableVideo.source` 一併加寬。
- [x] 3.4 【D-J】【實作階段修訂】`src/composables/useChannelMatching.ts` 的候選視窗上限判定，由「取回筆數是否達該來源每輪上限」改為「本輪最舊影片是否仍晚於目前錨點」；尚未建立錨點時不套用。完成方式：`useChannelMatching.spec.ts` 新增案例驗證 RSS 15 筆的實際形狀不會鎖住錨點、備援未回溯至錨點時取本輪最舊者、上限與來源無關、最舊者恰等於錨點時視為已覆蓋、尚未建立錨點時不設限
  - **原任務要求的「依本輪來源查其對應上限（API 50、RSS 約 15、備援 2）」會造成實際故障**：RSS 固定回傳約 15 筆且橫跨數月，以筆數判定使上限恆成立，而上限（本輪最舊者）早於現有錨點，`anchor.publishedTime <= currentBaseline` 隨即成立而回傳 `null` —— 錨點永遠無法推進，每輪重新比對整個 Feed。經使用者選定改以「視窗是否回溯至錨點」判定。
  - 該判定與來源及筆數無關，自動涵蓋三種通道，並修正了 keyword change 規格（要求 RSS 套用）與其任務 1.7（寫明不套用）之間的矛盾。
  - `FALLBACK_ROUND_LIMIT` 因此成為死碼並已移除；`API_ROUND_LIMIT` 的註解（原稱其兼作錨點守門上限）已修正為僅作 `maxResults`。
  - 4 個既有測試的設定不現實（feed 未回溯至錨點、或錨點為 0）而失敗，已改為現實情境並保留原意；`useChannelMatching.spec.ts` 由 56 增至 59 個案例。
  - 已於本 change 的 `specs/channel-auto-monitor/spec.md` 補上該 Requirement 的 MODIFIED（含三個新 Scenario），`openspec validate --strict` 通過。

- [x] 3.5 API 錯誤發生時寫入抑制狀態（配額→時點、金鑰無效→指紋）至 `ChannelMonitorConfig` 的新選填欄位，沿用其既有的 `{ ...defaultValue, ...parsed }` 合併模式；完成方式：`grep -n "interface ChannelMonitorConfig" -A 10 src/App.vue` 呈現三個新選填欄位，並由 6.3、6.4 人工驗證抑制在重啟後仍生效
  - `ChannelMonitorConfig` 新增 `apiQuotaSuppressedUntil`、`apiRejectedKeyFingerprint` 兩個選填欄位；`MonitoredChannel` 新增 `uploadsPlaylistId`（終生不變故查得即快取，非機密）。
  - 抑制狀態由共用的 `buildApiOptions()` 產生器供**四個**呼叫點使用（檢查迴圈、加入頻道、單頻道模擬、全頻道模擬），避免模擬入口在配額已耗盡時仍逐一白打 API。金鑰為空時回傳 `undefined`，`fetchChannelVideos` 完全不觸碰 API。
  - `'other'`（5xx／網路錯誤）刻意不抑制 —— 屬暫時性狀況，下輪值得再試。

## 4. 兩段式直播判定（`App.vue`／人工驗證）

**開始本節前 MUST 已歸檔 `add-channel-subscription-keyword-filter`**（見第 0 節）。
本節改造它才剛修正的迴圈，`grep` 之外不宣稱自動測試覆蓋。

- [ ] 4.1 開工前確認基線：`npx vitest run src/composables/__tests__/useChannelMatching.spec.ts` 的 56 個案例全數綠燈；完成方式：測試輸出顯示 56 passed（若非 56，先確認 keyword change 已歸檔且未被改動）
- [ ] 4.2 【D-I】將檢查迴圈的直播判定改為兩段式：先收集通過關鍵字篩選的候選影片，一次呼叫 `resolveLiveStatuses(videos)` 取得 `Map<videoId, LiveCheckResult>`，再走訪候選建立任務；該函式在 API 可用時走 2.5／2.7 的批次，否則退回既有逐支 `checkVideoLiveStatus`；完成方式：`grep -n "checkVideoLiveStatus\|resolveLiveStatuses" src/App.vue` 呈現迴圈內**不再**有 `await checkVideoLiveStatus`，且該呼叫只出現在 `resolveLiveStatuses` 的逐支實作中
- [ ] 4.3 確認關鍵字收斂與未處理集合的語意未變：未命中關鍵字的影片 MUST NOT 進入批次查詢、MUST NOT 列入未處理集合；命中但狀態為 `'live'` 或 `'unknown'` 者仍列入未處理集合；完成方式：`grep -n "partitionByKeywords\|unhandledVideoIds" -A 4 src/App.vue` 呈現分割仍在直播判定之前、未處理集合只收命中影片，並由 6.7 人工驗證錨點守門行為不變
- [ ] 4.4 重跑既有測試確認未回歸；完成方式：`npm test` 全數通過，且 `useChannelMatching.spec.ts` 的案例數不減（4.1 的基線加上 3.4 新增者）

## 5. 設定 UI 與檢查結果回饋（`App.vue`／人工驗證）

- [x] 5.1 【D-E】以 `storage.defineSetting('avd_youtube_api_key', '')` 新增金鑰設定，沿用 `avd_drive_token` 的 `van-field` 樣板；【規格】金鑰 MUST NOT 被頻道備份帶出；完成方式：`grep -n "avd_youtube_api_key" src/App.vue` 呈現為獨立設定鍵（非 `ChannelMonitorConfig` 欄位），且 `grep -n "channels: monitoredChannels.value" src/App.vue` 確認匯出仍只序列化頻道清單，並由 6.5 人工驗證匯出的 JSON 不含金鑰
  - `avd_youtube_api_key` 為獨立設定鍵（`App.vue:1583`，緊接 `monitorConfig` 以使宣告順序與使用順序一致）；匯出仍只序列化 `monitoredChannels`，結構上不含金鑰。
- [x] 5.2 【規格】設定介面在金鑰已設定時給出可辨識的狀態指示，且 MUST NOT 預設以明文完整顯示金鑰；欄位旁提供取得金鑰的說明（免費、需自建 Google Cloud 專案）；完成方式：由 6.5 人工驗證已設定狀態可見、金鑰未預設明文顯示、說明文字存在
  - 設定列顯示「● 已設定 / ○ 未設定」；對話框輸入預設 `type="password"`，可手動切換顯示；說明含「免費、不需信用卡、需自建 Google Cloud 專案、金鑰不入備份與日誌」；並在配額抑制或金鑰被拒時於對話框內顯示對應狀態。
- [x] 5.3 【D-F/D-G】新增「配額耗盡已降級」與「金鑰無效」兩種檢查結果回饋，沿用 `services/rateLimit.ts` 的「純函式產生訊息片段、由 `App.vue` 組裝 Toast」慣例；【規格】兩者文案 MUST 互異、MUST NOT 被「目前沒有新影片」或既有連線失敗文案覆蓋、MUST NOT 包含金鑰片段；金鑰無效 MUST NOT 每頻道每輪重複提示；完成方式：訊息片段純函式於 2.x 所在檔案加測試驗證兩種文案互異且不含假金鑰片段，佈線由 6.3、6.4 人工驗證
  - 片段置於 `youtubeDataApi.ts`（4 個測試驗證兩者互異、不含金鑰片段、不與配額混淆）；金鑰無效優先於配額耗盡。抑制生效後續輪不再呼叫 API，`onError` 不再觸發，故提示自然只出現一次 —— 滿足「MUST NOT 每頻道或每輪重複」。
- [x] 5.4 【規格】配額耗盡與「部分頻道抓取失敗」同時發生時，兩者在同一則訊息中各自可辨識；完成方式：訊息片段測試驗證兩者並存時皆出現，並由 6.4 人工驗證
  - `apiHint` 附加於全部 7 個回饋分支之後，與既有的失敗提示、關鍵字篩除片段並存（`App.vue:2212` 可見兩者同時出現）。
- [x] 5.5 【範圍調整】於金鑰對話框顯示當日用量估算（已用／10,000），並明確標示為估算值；未設金鑰時不顯示；每分鐘配額不顯示。計數在請求送達服務後累計（含服務回報錯誤者），傳輸層錯誤不計入；狀態持久化於 `ChannelMonitorConfig`，重啟不歸零；完成方式：`grep -n "apiUnitsUsedToday" src/App.vue src/services/DownloadService.ts` 呈現計數點與顯示點，並由 6.11 人工驗證
  - 計數在 `DownloadService` 以 `countedFetch` 包住每次請求；傳輸層錯誤（`NETWORK_ERROR:` 或 `TypeError`）不計入，其餘含配額耗盡的 403 皆計入。顯示於金鑰對話框，明示為估算值並指向 Console 為權威數字；未設金鑰時整塊不顯示。

## 6. 整合與跨平台驗證

6.1 為根 `CLAUDE.md`「版本進版規範」第 3 條要求的五項建置驗證，全數通過才可進版。

- [x] 6.1 執行五項建置驗證全數通過：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml`、`gradlew :app:compileDebugJavaWithJavac`
  - 1.0.88 下重跑：`npm run build` ✓、`npm test` 309 個測試 ✓（原 303）
  - `npm run build` ✓、`npm test` 303 個測試 ✓、`vue-tsc --noEmit` ✓、`cargo check` ✓、`gradlew :app:compileDebugJavaWithJavac` BUILD SUCCESSFUL ✓
- [ ] 6.2 人工驗證【未設金鑰行為不變】：清空金鑰後執行立即檢查，於開發者工具 Network 確認**沒有任何 `googleapis.com` 請求**，且行為與導入本 change 前一致（無錯誤、無要求設定金鑰的提示）
- [ ] 6.3 人工驗證【配額耗盡降級與抑制】：以額度已用盡的專案金鑰（或暫時撤銷配額）觸發，確認①該頻道降級至 RSS②本輪其餘頻道不再發出 API 請求③**重啟應用程式後仍不發出** API 請求④回饋明確告知已降級而非「沒有新影片」
- [ ] 6.4 人工驗證【金鑰無效】：填入一把無效金鑰，確認①提示可辨識為金鑰問題且與配額耗盡文案不同②降級至 RSS 後功能正常③不每頻道每輪重複提示④更換為有效金鑰後下次檢查恢復走 API
- [ ] 6.5 人工驗證【設定與機密】：金鑰輸入、已設定狀態指示、未預設明文顯示、說明文字；匯出頻道備份並檢視 JSON **不含金鑰**；還原備份後本機金鑰未被覆寫或清除；任務 `line` 顯示 API 來源標記
- [ ] 6.6 人工驗證【機密不入日誌】（安全關鍵）：分別造出 API 請求失敗與 RSS 請求失敗，開啟錯誤日誌並**完整檢視每一筆**，確認①無任何金鑰片段②RSS 失敗訊息不再含 `?channel_id=...` query string③仍能自日誌的頻道名稱上下文辨認是哪個頻道失敗
- [ ] 6.7 人工驗證【錨點與關鍵字未回歸】：構造「較新的未命中關鍵字影片 + 較舊的命中但屬直播影片」，確認該直播影片下一輪仍被視為新片（錨點未越過它）；並確認設有關鍵字的頻道，未命中影片**沒有**進入批次查詢（Network 中批次請求的 `id` 參數不含該影片）
- [ ] 6.8 人工驗證【批次生效】：對設有金鑰且有多支新片的頻道執行檢查，於 Network 確認直播狀態查詢為**單一批次請求**（而非逐支多次），且 `id` 參數含多個以逗號分隔的影片識別碼
- [ ] 6.9 人工驗證【Android 端】：於 Android 實機重複 6.2、6.5、6.8，確認 WebView 的 `fetch()` 未被 CORS 阻擋（【D-C】的關鍵假設）
- [ ] 6.10 人工驗證【候選視窗 50 筆】：對上傳影片超過 50 支且長期未檢查的頻道執行檢查，確認錨點未跨過本輪未取回的較舊影片（下一輪仍能發現更舊的新片）
- [ ] 6.11 人工驗證【用量估算】：填入金鑰後執行數輪檢查，確認①對話框顯示的已用單位隨檢查次數增加②重啟應用程式後數值不歸零③與 Google Cloud Console「配額和系統限制」的實際數字比對，差距應可由「多裝置共用同一金鑰」或「同專案被其他工具使用」解釋 —— 若 app 的數字明顯**高於** Console，代表有多餘的呼叫（例如不慎分頁），須回報

## 7. 提交與版本進版

- [ ] 7.1 建立功能修正 commit，並以 `git status --short` 與 commit diff 確認只包含本 change 的程式、測試及 OpenSpec 任務進度
- [x] 7.2 【已於 3.4 完成】候選視窗規則的 MODIFIED 已寫入本 change 的 `specs/channel-auto-monitor/spec.md`。原任務只打算補上括號內的來源列舉，但 3.4 發現該規則的判定條件本身有誤（會使 RSS 錨點永久停滯），故整條規則已改寫，列舉降為說明性文字。`openspec validate add-youtube-data-api-channel --strict` 通過
  - 歸檔順序限制不變：本條 delta 以 keyword change 歸檔後的文字為基底，**須待其歸檔後才可歸檔本 change**。

- [ ] 7.3 將 avd 下一版版號同步更新至七處：`package.json`、`package-lock.json`（2 處）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（以 `cargo update --workspace --offline` 同步）、`android/app/build.gradle` 的 `versionName`／`versionCode`（皆須遞增），並更新 `avd_s/publish_all.ps1` 的版本化預設發布說明；以跨檔比對確認七處一致
- [ ] 7.4 重新執行五項建置驗證全數通過後，建立獨立的版本進版 commit（與 7.1 分開，保留可單獨 revert 的空間）；**提交與進版期間 MUST NOT 併行執行發布腳本** —— 該腳本的版號防呆在啟動時讀取 `package.json` 與 `$Message`，而打包與 `git add .` 發生在數十秒後，工作區若在其間變動會產生內容與訊息不符的發布（v1.0.85 即因此作廢）。工作區乾淨且已推送後，才由使用者手動執行發布腳本
