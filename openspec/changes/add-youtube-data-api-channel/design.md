## Context

動機見 `proposal.md` 的 Why。行為契約見 `specs/youtube-data-api-channel/spec.md` 與其餘五份 delta。

現況的三個約束決定了本設計的形狀：

- **抓取入口只有一個**：`DownloadService.fetchYouTubeRss(channelId, options)` 內部已把「官方 RSS → yt-dlp 備援」的兩層降級封裝完畢，回傳統一的 `MonitoredVideoResult[]`（帶 `source: 'rss' | 'fallback'` 標記）。上層的 `App.vue` 檢查迴圈只看回傳陣列，不知道通道差異。第三個通道應延續此封裝，而非在上層再分支。
- **兩平台的 HTTP 通道不對稱**：桌面端有通用的 Rust 指令 `fetch_http_text(url)`（`src-tauri/src/lib.rs:144`），可帶任意網址；Android 端只有寫死 RSS 網址的 `YoutubeDlPlugin.fetchChannelRss({ channelId })`，**沒有通用 HTTP GET 方法**。
- **直播狀態查詢目前是逐支的**：`checkVideoLiveStatus(url)` 每支影片各開一個 yt-dlp 子行程（桌面）或呼叫一次原生外掛（Android），且在 `App.vue` 的候選迴圈內同步等待。批次化必須把迴圈改為兩段式。

實測確認的兩項事實（決定了決策 2 與 3）：

- `googleapis.com` 完整支援 CORS：`Access-Control-Allow-Origin` 回應請求的 Origin，OPTIONS 預檢回 200 且 `Access-Control-Allow-Methods` 含 GET。
- 金鑰可經 **`X-goog-api-key` 請求標頭**傳送（實測 API 確實讀到並回報 `API key not valid`），且 CORS 預檢明確回覆 `Access-Control-Allow-Headers: x-goog-api-key`。

## Goals / Non-Goals

**Goals:**

- 讓 API 成為第一通道，且未設金鑰時的行為與現狀逐位元相同。
- 金鑰**永不進入任何網址**，使其無法經由既有的錯誤訊息路徑外流。
- 把逐支直播查詢改為批次，且在無金鑰時仍走既有逐支路徑。
- 配額耗盡與金鑰無效兩種狀態各自只付一次失敗成本，不每輪重複。

**Non-Goals:**

- 不做 OAuth。本能力只讀公開資料，API key 足夠；OAuth 會引入登入流程與 token 更新。
- 不做分頁。每輪只需辨識新片，分頁會使配額隨頻道歷史成長。
- 不以 API 取代下載本身。下載仍由 yt-dlp 執行，API 只供清單與狀態查詢。
- 不代使用者建立 Google Cloud 專案或引導申請流程；設定欄位旁給連結即可。
- 不快取影片清單。每輪都要看最新狀態，快取只會延遲新片發現。

## Decisions

### 1.【D-A】金鑰經 `X-goog-api-key` 標頭傳送，不放 query string

**Decision:** API 請求一律把金鑰放在 `X-goog-api-key` 標頭，網址只含 `part`、`playlistId`／`id`、`maxResults`。

**Rationale:** 這是本設計最重要的安全決策，且它把一個「必須靠遮蔽才安全」的問題變成「結構上不可能外流」。

現行 `fetch_http_text` 的錯誤處理（`src-tauri/src/lib.rs:159-166`）直接把 `ureq` 的錯誤字串塞進 `HTTP_STATUS:{status}:{message}` 前綴，而該字串**包含完整網址**。這些訊息會經 `reportError` 寫進 `avd_error_log`，而錯誤日誌的設計目的就是讓使用者複製出來求助 —— 本次規劃期間使用者即貼出過該日誌內容。若金鑰在網址中，這條路徑就是一次完整外洩。

把金鑰移到標頭後，即使錯誤訊息照樣嵌入網址，也沒有機密可洩。`windows-native-http-fetch` 的 query string 去除需求（見其 delta）因此降為**縱深防禦**，而非唯一防線 —— 兩者都要做，但順序上先做決策 A。

**Alternatives:** 只做遮蔽而金鑰仍放網址 —— 遮蔽是黑名單式防護，任何新增的日誌點、主控台輸出或第三方錯誤字串都可能繞過它；`?key=` 也是 Google 文件的預設寫法，日後容易被「照文件改回去」。放標頭是白名單式，結構上沒有洩漏面。

### 2.【D-B】桌面端擴充 `fetch_http_text` 支援選填標頭，不改用瀏覽器 `fetch()`

**Decision:** 為 `fetch_http_text` 增加選填的 `headers` 參數（`Option<HashMap<String, String>>`），既有的 RSS 呼叫不傳即行為不變。桌面端的 API 請求走此通道。

**Rationale:** 決策 A 需要帶標頭，而現行指令只接受網址。雖然實測 `googleapis.com` 支援 CORS、理論上桌面端也能直接用 `fetch()`，但 `windows-native-http-fetch` 這個能力當初存在的理由正是 WebView 的 CORS 阻擋；把新通道押在「這個網域剛好允許」上，等於讓桌面端多一條與既有模式不同、且依賴外部 CORS 政策的路徑。擴充既有指令的成本極低且完全向下相容。

**Alternatives:** 新增獨立的 Rust 指令 —— 會出現兩個幾乎相同的 HTTP 通道，日後修 bug（例如 timeout、UA、query string 遮蔽）要記得改兩處。

### 3.【D-C】Android 端直接用 WebView `fetch()`，不新增原生外掛方法

**Decision:** Android 端的 API 請求以 WebView 的 `fetch()` 發出，不新增 `@PluginMethod`。

**Rationale:** 實測 OPTIONS 預檢回 200 且明確允許 `x-goog-api-key`，`Access-Control-Allow-Origin` 回應 Origin —— CORS 不成立阻擋。新增外掛方法需動 Java、重新編譯、且要同步維護兩套錯誤格式，收益為零。

**這也是兩平台唯一的實作差異**，需在 `DownloadService` 以既有的 `isTauri()` 分支表達，與 `fetchChannelRss` 的分支形式一致。

**Alternatives:** 為對稱而在 Android 也新增原生方法 —— 對稱本身沒有價值，只增加要維護的表面。

### 4.【D-D】`fetchYouTubeRss` 更名為 `fetchChannelVideos`

**Decision:** 把 `DownloadService.fetchYouTubeRss` 更名為 `fetchChannelVideos`，並更新其 4 個呼叫點（檢查迴圈、`addManualChannel`、兩個模擬入口）。

**Rationale:** 加入第三個通道後，這個函式名稱會變成謊言 —— 它可能一次 RSS 請求都沒發。名稱誤導在這個檔案已有前例代價（`MonitoredVideoResult` 的 `source` 欄位就是為了修正「以為都來自 RSS」的假設）。呼叫點僅 4 處，更名是機械性的。

**Alternatives:** 保留舊名 —— 省一次改名，換來每個讀者都要先發現「這個 RSS 函式其實會走 API」。

### 5.【D-E】金鑰存為獨立設定鍵，不放進 `ChannelMonitorConfig`

**Decision:** 以 `storage.defineSetting('avd_youtube_api_key', '')` 存放，沿用 `avd_drive_token` 的既有樣板；`ChannelMonitorConfig` 只放**非機密**的衍生狀態（見決策 6）。

**Rationale:** 規格要求金鑰 MUST NOT 出現在頻道備份中。頻道匯出目前序列化 `monitoredChannels.value`（不含 `monitorConfig`），所以放 `monitorConfig` 目前也不會被匯出 —— 但那是**巧合而非保證**：日後若有人把設定一併納入備份或雲端同步，金鑰就會被順帶帶出去，而且不會有任何測試失敗來提醒。獨立鍵讓「不得匯出」成為結構性事實。

**Alternatives:** 放 `ChannelMonitorConfig` 內比較集中 —— 集中性換來一個沉默的外洩風險，不值得。

### 6.【D-F】配額耗盡以「抑制到下一個太平洋時間午夜」表達，並持久化

**Decision:** 偵測到配額耗盡時，計算下一個太平洋時間（`America/Los_Angeles`）午夜的時間戳，寫入 `ChannelMonitorConfig.apiSuppressedUntil`。該時點之前，所有頻道一律略過 API 通道直接走 RSS。時點過後自動恢復，不需使用者操作。

**Rationale:** 配額是每日額度且於太平洋時間午夜重置。耗盡後在重置前的每一次請求都必然失敗，若不抑制，20 個頻道每小時一輪要白付 20 次失敗往返 —— 這正是 v1.0.84 修 RSS 重試時在解決的同一類浪費。

**必須持久化**而不能只放記憶體：桌面版與手機版都會重啟，重啟後若忘記抑制狀態，就會重新開始每輪白打。時區換算以 `Intl.DateTimeFormat` 搭配 `timeZone: 'America/Los_Angeles'` 取得，WebView 原生支援，不需引入時區函式庫。

**Alternatives:**
- 固定抑制 N 小時 —— 會在重置後仍抑制（浪費配額窗口）或提早解除（繼續白打），兩頭皆不準。
- 只在記憶體抑制 —— 重啟即失效，而使用者關開 app 很頻繁。

### 7.【D-G】金鑰無效的抑制綁定「金鑰內容變更」而非時間

**Decision:** 金鑰被 API 拒絕時，於 `ChannelMonitorConfig` 記錄被拒金鑰的**指紋**（不可還原的短摘要，非金鑰本身），並在該指紋與當前金鑰相符時抑制 API 請求。使用者更換金鑰後指紋不符，抑制自動解除。

**Rationale:** 無效金鑰不會因時間而變有效，用時間抑制沒有意義；但「使用者改了金鑰」是明確可偵測的解除條件。記指紋而非布林旗標，是為了避免「使用者改了金鑰但旗標還在」導致的永久抑制，也避免「清空再貼回同一把壞金鑰」時重新開始白打。

存指紋而非金鑰本身，是因為 `ChannelMonitorConfig` 的機密風險比獨立金鑰鍵高（見決策 5 的匯出顧慮）—— 指紋外流無害。

**Alternatives:** 布林旗標 + 監看金鑰變更事件 —— 依賴事件正確觸發，而 `useStorage` 的還原時序曾是既有問題來源（`config-persistence` 的能力就是為此建立的）。比對指紋是無狀態的，不倚賴事件。

### 8.【D-H】uploads 播放清單以前綴慣例推導，失敗才查詢，且結果快取於訂閱

**Decision:** 先以 `UC` → `UU` 的前綴替換推導 uploads 播放清單識別碼（零配額）。若該清單回報不存在，才以 `channels.list?part=contentDetails` 取得正確識別碼（1 unit），並把結果寫入該頻道的訂閱物件，之後不再查詢。

**Rationale:** 前綴慣例對絕大多數頻道成立且不花配額，但它是**慣例而非文件保證**，不能當作唯一路徑 —— 規格明訂推導失敗時 MUST NOT 逕判頻道無效。快取於訂閱物件是因為 uploads 清單識別碼終生不變，每頻道查一次即可。

**注意**：此欄位屬頻道訂閱資料，會被頻道備份帶出。它不是機密（可由頻道 ID 推得），無須遮蔽；但還原舊備份時該欄位可能缺失，須依既有的「缺欄位視為未設定」模式處理，回到前綴推導。

**Alternatives:** 一律先查 `channels.list` —— 每頻道多 1 unit 的一次性成本其實可忽略，但也讓每個新頻道的第一次檢查多一次往返；前綴優先在絕大多數情況下更快且等價。

### 9.【D-I】直播狀態查詢抽象為「解析一組影片」，批次與逐支各為其實作

**Decision:** 把 `App.vue` 檢查迴圈的直播判定改為兩段式：先收集通過關鍵字篩選的候選影片，一次交給 `resolveLiveStatuses(videos)` 取得 `Map<videoId, LiveCheckResult>`，再走訪候選建立任務。該函式在 API 可用時分批（每批 50 支、單一請求），否則退回既有的逐支 `checkVideoLiveStatus`。

**Rationale:** 批次的本質是「把 N 次查詢換成 ⌈N/50⌉ 次」，而現行迴圈把查詢與建立任務交織在同一輪走訪中，無法批次。抽出「解析一組」的介面後，兩種實作對上層等價，且**上層不需要知道是否有金鑰** —— 這與決策 D 的封裝原則一致。

批次的部分失敗必須逐支保守處置（見 `auto-check-filtering` delta）：回應未涵蓋的影片一律 `unknown`，整批失敗則全部 `unknown`。這點在 `Map` 的介面下很自然 —— 查不到就是 `unknown`，不需要特別的錯誤路徑。

**Alternatives:** 只在有金鑰時走兩段式、無金鑰時保留舊迴圈 —— 兩條迴圈要各自維護關鍵字收斂、未處理集合與錨點守門，而那三者剛在 `add-channel-subscription-keyword-filter` 中才修正過，複製一份等於製造下一個漂移點。

### 10.【D-J】新通道的 `source` 標記為 `'api'`，並沿用既有候選視窗守門

**Decision:** `MonitoredVideoResult.source` 增加 `'api'`。錨點的候選視窗上限沿用既有的通用規則，API 通道宣告其每輪上限為 50 筆。

**Rationale:** `add-channel-subscription-keyword-filter` 已把該規則寫成通用形式（「本輪取回筆數已達該資料來源每輪候選上限時」），因此新通道只需宣告自己的上限，不需重寫該條 Requirement —— 這也是本 change 能避開與該未歸檔 change 衝突的關鍵（見 proposal 的依賴段落）。

`useChannelMatching.ts` 現行只有 `FALLBACK_ROUND_LIMIT = 2` 這一級，且 `nextChannelBaseline` 內以 `list.every(v => v.source === 'fallback')` 判定是否套用上限。加入第三種來源後，該判定須改為「依本輪來源查其對應上限」，而非再多一個 `every`。

**Alternatives:** 讓 API 通道也只取 15 筆以沿用 RSS 的一級 —— 白白放棄 API 單次可取 50 筆的優勢，且 50 筆對每小時一輪而言是實質更強的漏片保護。

## Risks / Trade-offs

- **[金鑰仍可能經其他路徑外流]** → 決策 A 移除了網址這條主要路徑，`windows-native-http-fetch` 的 query string 去除為縱深防禦。但主控台輸出、未來新增的日誌點仍需自律；實作時 MUST NOT 對 API 請求物件整體做 `console.log`。
- **[配額抑制的時區換算出錯會使抑制過長或過短]** → 以 `Intl` 換算並在單元測試中以固定時間戳釘住跨日邊界（含日光節約時間切換日）。過長的代價是白白不用配額，過短是恢復白打 —— 前者較安全，換算有疑義時取較晚的時點。
- **[批次改造動到剛修好的錨點與關鍵字邏輯]** → 這是本 change 最高的回歸風險。`add-channel-subscription-keyword-filter` 才剛修正錨點守門與關鍵字收斂，且其人工驗證尚未完成。緩解：**先歸檔該 change**（見 proposal），並在改造前確認其 56 個單元測試綠燈，改造後全數重跑。
- **[使用者取得金鑰的門檻]** → 需自行建立 Google Cloud 專案。緩解：金鑰為選填，未填者功能完整不受損；設定欄位旁提供說明與連結。
- **[API 亦可能故障，屆時三層全失敗]** → 三層降級鏈已涵蓋，且 API 故障時仍退回今日的現狀（RSS + yt-dlp），不會比不做本 change 更差。
- **[`monitorConfig` 新增三個欄位（抑制時點、被拒指紋、以及 uploads 清單快取所在的訂閱欄位）增加還原時的相容面]** → 三者皆為選填且缺失時語意明確（未抑制／未被拒／回到前綴推導），沿用 `monitorConfig` 既有的 `{ ...defaultValue, ...parsed }` 合併模式即可。

## Migration Plan

1. 先做安全基礎：`fetch_http_text` 支援選填標頭並去除錯誤訊息中的 query string（此步獨立可驗證，且立即改善既有 RSS 錯誤訊息）。
2. 加入 API 通道的純函式層（回應解析、狀態映射、配額與金鑰錯誤辨識、抑制時點計算），全部以單元測試覆蓋 —— 這些無需網路即可測。
3. 接入 `DownloadService` 的通道選擇與更名，未設金鑰路徑須先確認行為不變。
4. 改造 `App.vue` 檢查迴圈為兩段式直播判定，重跑既有測試。
5. 加入設定 UI 與回饋分支。
6. 執行五項建置驗證後進版；發布腳本由使用者手動執行。

**回滾**：清空金鑰即完全回到現狀行為；程式層面本 change 的每一步都保留了「未設金鑰即走舊路徑」的分支，無資料遷移需回滾。`monitorConfig` 新增的選填欄位可被舊版忽略。

## Open Questions

- 配額用量是否需要在 UI 呈現（例如「今日已用 480/10000」）？API 不提供查詢用量的端點，只能自行累計估算，而估算與實際可能不符。此問題不影響本 change 的規格、通道順序或任務拆解 —— 若日後要做，是獨立的顯示功能。
