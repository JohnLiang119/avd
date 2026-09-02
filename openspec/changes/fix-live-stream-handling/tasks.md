## 1. A —— Android 直播狀態查詢

- [x] 1.1 於 `YoutubeDlPlugin.java` 新增 `checkVideoLiveStatus(PluginCall)`，以 yt-dlp 查詢單支影片的 `live_status`，回傳該狀態字串
  - 以 `--print live_status --skip-download --no-warnings` 查詢，回傳 `JSObject` 帶 `liveStatus` 原始字串，由前端統一判定，與 Windows 端對稱。
- [x] 1.2 `DownloadService.checkVideoLiveStatus` 的非 Tauri 分支改為呼叫該原生方法，移除永遠回傳 `false` 的樁實作
  - 兩分支統一取得 `live_status` 字串後共用同一套判定，不再有平台差異。Windows 端順帶補上 `--skip-download`（原本缺少，查詢時可能觸發不必要的下載準備）。
- [x] 1.3 確認兩平台的判準一致（`is_live` 或 `is_upcoming` 皆回傳 true），並保留「查詢失敗時不阻斷流程」的行為
  - 判定邏輯集中於單一處。查詢失敗仍回傳 `false` 不阻斷流程，但已於註解載明：此情況下該影片未被實際處理，呼叫端不應讓錨點越過它（由任務 2.3 落實）。
- [x] 1.4 Android 端 `./gradlew :app:compileDebugJavaWithJavac` 編譯通過

## 2. B —— 時間錨點的推進邊界

- [x] 2.1 於 `checkAllMonitoredChannels` 中辨識本次「未處理」的影片
  - **實作採反向記錄**：原規劃累積「已處理」集合，實作時改為累積 `unhandledVideoIds`（未處理者）。原因是未處理的情況只有兩種且都發生在同一個 `continue` 點（直播、狀態查詢失敗），而「已處理」散落在多處（成功建立、去重濾除、時間早於錨點），反向記錄的漏記風險低得多。
  - 錨點候選 = `videos` 中排除 `unhandledVideoIds` 後、發布時間最大者。
- [x] 2.2 錨點改為推進至已處理影片中發布時間的最大值，且不得低於現有錨點
  - 以 `reduce` 取最大值，並加上 `anchorVideo.publishedTime > channelLastPub` 的守門，確保錨點只前進不後退。`lastKnownVideoId` 與 `lastVideoTitle` 改為取自同一支錨點影片，不再與 `videos[0]` 脫鉤。
- [x] 2.3 因直播而跳過、或狀態查詢失敗而未能判定的影片，不計入已處理集合
  - **需要先改 API**：原 `checkVideoLiveStatus` 回傳布林，查詢失敗時回傳 `false`，與「確定不是直播」無法區分，規格要求的「查詢失敗時錨點不得越過」因此無法實作。
  - 已將其改為三態 `LiveCheckResult = 'live' | 'not_live' | 'unknown'`。全專案僅一個呼叫點，改動安全。`'live'` 與 `'unknown'` 皆記入未處理集合。
- [x] 2.4 本次無任何影片被處理時，錨點及其相關欄位維持不變
  - `anchorVideo` 為 `null` 時整個更新區塊不執行，四個欄位皆保持原值。
- [x] 2.5 確認此修改與既有的「無精確發布時間則不推進」規則相容，兩者為獨立的守門條件
  - 兩道守門併存且互不干擾：候選過濾條件為 `v.publishedTime && !unhandledVideoIds.has(v.videoId)`，前半承接 `channel-track-by-publish-time` 任務 6.7 的規則，後半為本次新增。
  - 首次追蹤分支（`channelLastPub === 0`）維持使用 `videos[0]`，未套用未處理集合。這是刻意的：首次追蹤本就不下載任何既有內容，將錨點設在最新影片是預期行為，把當時已存在的直播排除在外反而與「不灌入歷史內容」的意圖相違。

## 3. C —— 重試策略

- [x] 3.1 定義確定性錯誤的關鍵片語清單（集中為單一常數，便於日後調整）
  - `PERMANENT_DOWNLOAD_ERRORS` 六項：requested format is not available、video unavailable、private video、members-only、join this channel、this live event will begin in。另有 `LIVE_RELATED_ERRORS` 兩項用於挑出直播相關者。比對以 `toLowerCase()` 進行。
- [x] 3.2 於 `processQueue` 的 `catch` 區塊中辨識確定性錯誤，命中時立即標記失敗並跳出重試迴圈
  - 以 `matchPermanentError()` 回傳 `{ permanent, liveRelated }`，命中時設定狀態後 `break`，不進入 `attempt++`。
- [x] 3.3 直播／尚未開播相關的錯誤給予專屬訊息「此影片為直播或尚未開播，暫時無法下載」
- [x] 3.4 其餘確定性錯誤保留原始訊息，但不加上「已自動重試 N 次」前綴
- [x] 3.5 暫時性錯誤維持既有的重試行為與訊息不變
  - 未命中確定性清單時完全走原路徑，`attempt++` 與兩種訊息皆未更動。
- [x] 3.6 確認 `processQueue` 既有的「使用者主動中止」判斷仍優先於確定性錯誤判斷
  - 已檢視實際順序：中止判斷在 `catch` 區塊最前，命中即 `break`，確定性錯誤的判斷在其之後。

## 4. 驗證

- [x] 4.1 `vue-tsc` 型別檢查與 `npm run build` 通過
- [x] 4.2 `npm test` 既有 28 個測試全數通過
  - 本次不新增測試：三項修正皆位於尚未抽離的 `App.vue` 與平台層（Android plugin）。C 的 `matchPermanentError` 本身是純函式、可測，但它宣告於 `App.vue` 內，需待抽離後才能被測試檔引用。已於任務 5.1 記入後續。
- [ ] 4.3 手動驗證 A：於 Android 上對含進行中直播的頻道執行手動檢查，確認直播未被加入佇列
- [ ] 4.4 手動驗證 B：直播被跳過後，確認該頻道卡片顯示的時間未推進至該直播的發布時間
- [ ] 4.5 手動驗證 C：對一支直播中的影片手動加入下載，確認立即失敗且訊息為「此影片為直播或尚未開播」，非「已自動重試 3 次」

## 5. 收尾

- [x] 5.1 於 `extract-channel-matching` 的 tasks.md 補記
  - 任務 2.5 改寫：錨點函式需同時滿足兩道守門（無精確時間不推進、不越過未處理影片），且簽章需能接收未處理影片集合而非僅單一 `latestVideo`；並註明首次追蹤分支刻意不套用第二道守門。
  - 新增測試項 4.7b（錨點不越過未處理影片）與 4.7c（`matchPermanentError` 的三種情境）。後者為本次新增的純函式，因宣告於 `App.vue` 而暫時無法被測試引用，抽離時一併移入可測模組。
- [x] 5.2 記錄本次未涵蓋的範圍與 Open Question

  **本次未涵蓋**

  - 不新增自動化測試：三項修正分別位於 Android 原生層、`DownloadService` 的平台分支，以及尚未抽離的 `App.vue`。唯一可測的純函式 `matchPermanentError` 因宣告位置而無法被測試檔引用，已轉交 `extract-channel-matching` 的 4.7c。
  - 不支援下載直播內容本身。直播的處置就是排除。
  - 不改變格式字串 —— 已驗證其對正常影片與進行中的直播皆可運作。
  - 首次追蹤分支不套用「不越過未處理影片」規則（刻意）。
  - `App.vue` 另一處重試迴圈（app 自動更新，約 919 行）未納入，其情境與下載佇列不同。

  **Open Question（留待 `extract-channel-matching` 完成後評估）**

  - 是否改以單次 `--dump-json` 取代逐片的直播狀態查詢？備援路徑已在取用完整 JSON，其中本就含 `live_status`。若 RSS 路徑也改為此形式可省去逐片查詢並讓兩條路徑一致，但會使每次頻道檢查都需執行一次 yt-dlp（RSS 路徑目前不需要），屬效能與一致性的取捨。
