## 0. 先讀：本 change 唯一的靜默故障

四項改動裡只有一項會**靜默**壞掉，其餘壞了都會報錯或看得見：

```
  fields 遮罩涵蓋不足
        |
        v
  該欄位變成 undefined（不拋錯）
        |
        +--> 缺 videoId    -> 影片被略過      -> 「這頻道好像沒新片」
        +--> 缺 publishedAt -> publishedTime=0 -> 錨點永遠不推進
```

所以【D-A】的最小回應夾具測試不是附加品，是這項改動的驗收條件本身。
夾具 MUST 只含遮罩允許的欄位 —— 用手寫的完整回應當夾具，遮罩改錯測試照樣綠燈。

另外三條紅線（皆以測試釘住，不靠人工小心）：

```
  逾時 MUST NOT 被判為裝置離線     否則一個慢頻道會讓整輪其餘頻道全被跳過
  逾時 MUST NOT 被判為配額/金鑰    否則追蹤會無故停擺到太平洋時間午夜
  一輪正常檢查 MUST NOT 產生新紀錄  日誌只留 50 筆，灌雜訊等於刪掉線索
```

## 1. `fields` 遮罩（【D-A】）

- [x] 1.1 盤點四個請求建構函式（`buildPlaylistItemsRequest`、`buildVideosRequest`、`buildChannelUploadsRequest`、`buildChannelSnippetRequest`）各自的回應被哪些程式讀取，逐一列出欄位路徑；完成方式：於本檔記錄該對照表，作為 1.2 遮罩字串與 1.3 夾具的共同依據

  **盤點結果（實作時逐一 grep 確認）：**

  | 請求 | 唯一消費者 | 讀取的欄位路徑 |
  |---|---|---|
  | `buildPlaylistItemsRequest` | `parsePlaylistItems` | `items[].contentDetails.videoId`、`items[].contentDetails.videoPublishedAt`、`items[].snippet.title`、`items[].snippet.publishedAt`（後備）、`items[].snippet.resourceId.videoId`（後備） |
  | `buildVideosRequest` | `resolveLiveStatusesViaApi` + `mapLiveStatus` | `items[].id`、`items[].snippet.liveBroadcastContent` |
  | `buildChannelUploadsRequest` | `parseUploadsPlaylistId` | `items[0].contentDetails.relatedPlaylists.uploads` |
  | `buildChannelSnippetRequest` | `parseChannelTitle` | `items[0].snippet.title` |

  兩點值得記下：
  - `MonitoredVideoResult.published`（ISO 字串）雖被 `parsePlaylistItems` 寫入，但**全專案無任何消費者**；它與 `publishedTime` 同源，故不需為它多索取欄位。
  - `part=snippet,liveStreamingDetails` 中的 `liveStreamingDetails` **從未被任何 production 程式碼讀取**（僅測試夾具含之），已一併自 `part` 移除。
- [x] 1.2 依 1.1 的對照表為四個請求加上 `fields` 遮罩，並將 `buildVideosRequest` 的 `part` 移除未使用的 `liveStreamingDetails`；完成方式：`npx vue-tsc --noEmit` 通過，且遮罩涵蓋的欄位與 1.1 對照表逐項相符
- [x] 1.3 新增最小回應夾具測試：夾具**只含**遮罩允許的欄位，斷言 `parsePlaylistItems` 回傳的 videoId／title／publishedTime 皆完整、`mapLiveStatus` 三態判定正確；完成方式：`npx vitest run src/services/__tests__/youtubeDataApi.spec.ts` 綠燈
- [x] 1.4 新增「遮罩不改變結果」的對照測試：同一份完整回應與其被遮罩裁剪後的版本，解析結果 MUST 完全相同；完成方式：同上測試檔綠燈，且刻意從遮罩移除一個仍在讀的欄位時該測試會失敗（手動確認一次此測試真的會抓到，再改回）

  **已實際驗證測試抓得到**：暫時自 `PLAYLIST_ITEMS_FIELDS` 移除 `snippet/title` 後，
  3 個案例失敗，且失敗形態正是所要防的靜默降級 —— `title` 變成 `''` 而非拋錯
  （`parsePlaylistItems` 有 `|| ''`）。已復原，91 個案例全綠。

  夾具的作法比原訂的「手寫最小夾具」更強：測試內建 `fields` 遮罩的**展開與裁剪工具**，
  夾具由遮罩推導而非手寫 —— 手寫的完整回應當夾具，遮罩改錯測試照樣綠燈。
  工具本身也另加測試，不是盲目信任。

## 2. 請求逾時（【D-B】【D-C】）

- [x] 2.1 於 API 通道的平台分支加入 10 秒逾時（Android 走 `AbortController`），並拋出自成前綴的可辨識錯誤；完成方式：`grep` 呈現 `AbortController` 已存在於該分支，`npx vue-tsc --noEmit` 通過
- [x] 2.2 新增逾時辨識函式；完成方式：單元測試驗證逾時錯誤可被辨識，而 `HTTP_STATUS:` 與 `NETWORK_ERROR:` 皆不被誤判為逾時
- [x] 2.3 【紅線】測試三類錯誤互斥：逾時錯誤 MUST NOT 使 `isDeviceOfflineError` 為真、MUST NOT 被 `classifyApiError` 歸為 `quota` 或 `key`；完成方式：`npx vitest run src/services/__tests__` 綠燈，且三個斷言各自獨立成案例（不併成一個）
- [x] 2.4 確認逾時在檢查迴圈中被計為該頻道的失敗、不觸發提早停止、且不推進錨點；完成方式：靜態核對迴圈的 catch 分支，確認 `isDeviceOfflineError` 為偽時走的是 `failedCount++` 而非 `break`
- [x] 2.5 確認桌面端 Rust 既有的 10 秒逾時所拋的錯誤前綴與前端的辨識一致；若已一致則不改任何 Rust 程式碼並於本檔記錄結論；完成方式：`cargo check --manifest-path src-tauri/Cargo.toml` 通過（若未改動則僅需記錄）

  **結論：並不一致，已修（既有 bug）。** `ureq` 把 DNS 失敗、連線被拒與
  連線／讀取逾時全歸為 `Error::Transport`，而 `fetch_http_text` 一律映射為
  `NETWORK_ERROR:` —— 於是桌面端的**讀取逾時會被 `isDeviceOfflineError` 判為
  裝置離線而中止整輪**，並對使用者宣稱「裝置目前無法連線」。這正是【D-C】
  的紅線，且早於本 change 就存在。

  修法：新增純函式 `is_timeout_transport_message`，逾時改拋 `REQUEST_TIMEOUT:`
  前綴。以訊息文字判定而非 `ErrorKind` —— `ErrorKind::Io` 同時涵蓋逾時與其他
  I/O 失敗，單看 kind 分不出來。誤判代價不對稱：漏判會靜默跳過整輪，誤判只是
  少一次提早停止，故偏向後者。已加 Rust 單元測試（`cargo test` 7 passed）。

## 3. 逐頻道進度回饋（【D-D】）

- [x] 3.1 新增進度狀態（已完成數／總數／當前頻道名稱），並於檢查迴圈每個頻道開始前更新；完成方式：`grep` 呈現該狀態於迴圈內被更新，`npx vue-tsc --noEmit` 通過

  進度在該頻道**開始前**更新（而非完成後），卡住時停留的正是那個頻道的名稱。
  更新後加一次 `await nextTick()` —— 否則整段同步走完前畫面不會重繪，
  進度會一次跳到底而完全失去意義。
- [x] 3.2 於頻道管理彈窗「立即檢查」按鈕鄰近處呈現進度；檢查結束時 MUST 讓位給既有的結果回饋而不殘留；完成方式：靜態核對呈現條件與清除時機，由 5.3 人工驗證
- [x] 3.3 自動輪詢同樣更新進度狀態，但 MUST NOT 為其額外彈出提示；完成方式：靜態核對 `isManual` 的判斷未包住進度更新，且未新增任何 Toast
- [x] 3.4 進度文案 MUST NOT 包含金鑰任何片段；完成方式：文案由不接受金鑰參數的純函式產生，並加測試斷言不含假金鑰片段

## 4. 錯誤入帳（【D-E】）

- [x] 4.1 實作「只記轉換」的純函式：依「上次已入帳的狀況」與「當前狀況」決定本次是否寫入，並區分開始／解除／原因改變三種轉換；完成方式：單元測試驗證持續同一狀況只寫一次、原因改變會再寫、由停擺轉正常會寫解除、而啟動時本來就正常 MUST NOT 憑空寫解除
- [x] 4.2 整輪開頭即停擺（未設金鑰／金鑰無效／配額耗盡）改為經 4.1 寫入日誌；記憶**不持久化**，與既有的 Toast 抑制旗標分開兩份；完成方式：`grep` 呈現兩個旗標為不同變數，靜態核對寫入點
- [x] 4.3 直播狀態批次查詢失敗改為上報給呼叫端並寫入日誌（現況只有 `console.warn`）；完成方式：`grep -n "直播狀態批次查詢有" src/services/DownloadService.ts` 呈現該處已改為回報而非僅記主控台

  4.3～4.5 共用新增的 `ChannelApiOptions.onFailure`（回報**未經截斷的原文**）
  與 `App.vue` 的 `journalOnly`（只寫日誌、不彈提示）。與既有的 `onError`
  刻意分開：後者只給分類供抑制判斷，前者給原文供事後追查。
- [x] 4.4 `fetchChannelTitle` 失敗寫入日誌（現況只有 `console.warn`）；完成方式：`grep -n "fetchChannelTitle failed" src/services/DownloadService.ts` 無殘留，改為經呼叫端入帳
- [x] 4.5 全頻道模擬的逐頻道失敗寫入日誌（現況只有 `console.warn`）；完成方式：`grep -n "模擬抓取頻道" src/App.vue` 呈現該處已入帳
- [ ] 4.6 【紅線】確認一輪**正常**檢查不產生任何新日誌紀錄；完成方式：由 5.3 人工驗證 —— 檢查前後比對日誌筆數不變

## 5. 驗證

- [x] 5.1 執行五項建置驗證全數通過：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml`、`gradlew :app:compileDebugJavaWithJavac`
- [ ] 5.2 人工驗證【遮罩未改變擷取結果】：於實機對同一頻道檢查，確認取回的影片筆數、標題與發布時間皆與遮罩前一致；**特別確認發布時間不是 0 或當下時間** —— 那正是遮罩涵蓋不足的表徵
- [ ] 5.3 人工驗證【進度與日誌】：按下「立即檢查」，確認進度顯示已完成數／總數／當前頻道名稱且隨頻道推進、結束後不殘留；並確認該輪正常檢查前後的日誌筆數不變
- [ ] 5.4 人工驗證【Android 實機速度】：記錄按下「立即檢查」到結果回饋出現的實際耗時，以及進度停在各頻道的時間；**此數據即 design 兩個 Open Question 的判斷依據**，於本檔記錄
- [ ] 5.5 人工驗證【逾時】：造出一個不會回應的情境（例如檢查中切斷網路），確認該頻道在 10 秒內被中止、進度繼續推進至下一個頻道、且 MUST NOT 出現「裝置目前無法連線」而中止整輪
- [ ] 5.6 人工驗證【停擺入帳】：清空金鑰後等待自動排程反覆到期數次，確認日誌只有**一筆**停擺紀錄而非每分鐘一筆；填回金鑰後確認出現一筆解除紀錄
- [ ] 5.7 【實作中發現，原任務未涵蓋】人工驗證【遮罩不影響錯誤分類】：`fields` 是否會一併裁剪**錯誤回應**的 body 未經證實，而 `classifyApiError` 正是靠 body 內的 `quotaExceeded`／`accessNotConfigured` 區分「配額耗盡」與「金鑰無效」—— 若錯誤 body 被裁剪，兩者都會退化為 `other`，使 `api-only-channel-tracking` 明訂的抑制與持續狀態指示失效。完成方式：於實機填入一把無效金鑰後手動檢查，確認頻道管理介面顯示的是「金鑰無效」而非泛用的擷取失敗；若確認被裁剪，則自四個遮罩改為只對成功路徑套用（或移除遮罩並於本檔記錄取捨）

## 6. 提交與版本進版

- [x] 6.1 建立功能修正 commit，並以 `git status --short` 與 commit diff 確認只包含本 change 的程式、測試及 OpenSpec 任務進度
- [x] 6.2 將 avd 下一版版號同步更新至七處：`package.json`、`package-lock.json`（2 處）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（以 `cargo update --workspace --offline` 同步）、`android/app/build.gradle` 的 `versionName`／`versionCode`（皆須遞增）
- [x] 6.3 更新 `avd_s/publish_all.ps1` 的預設 `$Message` 為描述本次改動且版號正確的新文字（該檔屬 `C:\JohnLiang` 工作區 repo，非 avd repo，故獨立提交）；完成方式：訊息內嵌版號與 `package.json` 相符，發布腳本的防呆不會擋下
- [x] 6.4 重新執行五項建置驗證全數通過後，建立獨立的版本進版 commit（與 6.1 分開）；**提交與進版期間 MUST NOT 併行執行發布腳本** —— 工作區乾淨且已推送後，才由使用者手動執行

  **已同步至 v1.0.92**（`versionCode` 128 → 129）。發布腳本未執行 ——
  依規範由使用者手動執行。5.2～5.7 的人工驗證需要一個可安裝的版本，
  故進版先於驗證；若驗證發現問題，以後續 commit 修正。

## 7. 歸檔順序

- [ ] 7.1 本 change 與 `api-only-channel-tracking` 修改的是不同的 Requirement，歸檔順序不受限；但 `api-only-channel-tracking` 仍有 7.4～7.7 人工驗證未完成，歸檔前須先完成之。完成方式：歸檔前確認兩者的主規格合併結果無 TBD 佔位符、亦無彼此覆寫
