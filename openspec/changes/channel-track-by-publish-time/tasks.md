## 1. 資料模型與狀態型別更新

- [x] 1.1 更新 `src/App.vue` 中的 `MonitoredChannel` 介面，新增 `lastPublishedTime` 欄位並維持 `lastCheckTime` 向下相容
- [x] 1.2 更新手動新增頻道 (`addManualChannel`) 邏輯，在初次加入時將基準時點設定為最新影片的實際 `publishedTime`

## 2. 核心比對與時點更新機制重構

- [x] 2.1 重構 `checkAllMonitoredChannels` 中的新影片過濾邏輯，改以 `lastPublishedTime` 嚴格大於上次發布時間進行判定
- [x] 2.2 更新檢查完成後的時點寫入邏輯，將最新影片之實際發布時間寫入 `channel.lastPublishedTime`
- [x] 2.3 在頻道卡片 UI 介面（頻道名稱後方或最新影片欄位）加入格式化之最新發布時間展示 (YYYY/MM/DD HH:mm:ss)
- [x] 2.4 在建立影片下載任務時（包含使用者手動單一輸入加入、自動追蹤、模擬測試或播放清單解析），於主畫面任務標題（抬頭）後方自動附帶發布時間標記 (YYYY/MM/DD HH:mm:ss)

## 3. 備份還原與邊界相容性驗證

- [x] 3.1 檢查並更新備份匯出/還原 (`exportChannelsJson` / `confirmRestoreChannels`) 中的時間欄位相容處理
- [x] 3.2 驗證既有舊資料（僅有 `lastCheckTime`）的平滑過渡與測試模擬功能 (`simulateNewVideo`)

## 4. 結構化發布時間欄位與下載生命週期防覆蓋保護 (方案 A)

- [x] 4.1 在 `src/App.vue` 的 `DownloadTask` 型別定義中新增 `publishTimeStr`、`channelPrefix`、`rawTitle` 等結構化屬性
- [x] 4.2 實作統一標題合成輔助函式 `buildTaskDisplayTitle(rawTitle, channelPrefix, publishTimeStr)`
- [x] 4.3 重構各任務建立來源（手動加入、頻道追蹤、播放清單、測試模擬），寫入結構化欄位並透過 Helper 產生初始標題
- [x] 4.4 重構 `downloadProgress` 監聽器，當收到 `info.title` 時更新 `rawTitle` 並重新合成，防止抹除既有前綴與發布時間
- [x] 4.5 重構 `processQueue` 下載完成時的標題更新邏輯，確保優先以結構化欄位合成最終標題，防止正則還原失敗
- [x] 4.6 驗證所有任務在 pending -> downloading -> success 完整生命週期中發布時間標記穩定不消失

## 5. Android 原生外掛單一影片發布時間提取支援

- [x] 5.1 在 Android 原生端 `YoutubeDlPlugin.java` 的 `download()` 方法中，針對 YouTube 提取 `upload_date` / `timestamp` 與 `uploader` 並格式化為標準時間字串
- [x] 5.2 針對 TikTok 專屬解析通道提取 `create_time`（秒級 Unix timestamp）並轉換為格式化時間字串
- [x] 5.3 在 `downloadProgress` 通知與下載完成 `JSObject ret` 回傳中封裝 `publishTimeStr` 與 `channelPrefix`
- [x] 5.4 在前端 `DownloadService.download` 與 `App.vue` 監聽接收端完成資料對接與標題自動補齊


## 6. 備援機制完整修正（雙平台精確時間 + Live 過濾）

- [x] 6.1 Windows Rust 端：修改 `src-tauri/src/lib.rs` 的 `fetch_channel_videos_fallback`，移除 `--flat-playlist`，新增 `--skip-download`，使 yt-dlp 回傳精確 `timestamp` 與 `upload_date`
  - 參數改為 `["--dump-json", "--skip-download", "--playlist-end", "2", &url]`，URL 維持 `/channel/{id}`。已加註解說明不用 `--flat-playlist` 的原因。`cargo check` 通過。
  - **實測驗證**（以 `UCSJ4gkVC6NrvII8umztf0Ow` 為對象）：新參數確實回傳精確時間，`timestamp: 1788195606`、`upload_date: 20260831`，design 的核心假設成立。耗時 5.6 秒，落在 design 預估的 5~10 秒內。
  - **實測推翻 design 的一項過濾條件**：`--playlist-end 2` 回傳 4 筆（Videos 分頁 2 筆 + Live 分頁 2 筆），分頁確實由 `playlist` 欄位識別（`"Lofi Girl - Videos"` / `"Lofi Girl - Live"`）。但 **Live 分頁影片的 `was_live` 為 `false`**，因此 design 所寫的「`was_live === true`」條件對 Live 分頁完全無效，只有 `playlist` 欄位的判斷有作用。此點影響任務 6.4 的實作，已記入 design。
  - 附帶觀察：該頻道只有 Videos 與 Live 兩個分頁，未出現 Shorts。分頁組成因頻道而異，過濾邏輯不應假設固定分頁數。
- [x] 6.2 Android Java 端：在 `YoutubeDlPlugin.java` 新增專用備援方法 `fetchChannelVideosFallback`，使用 `--dump-json --skip-download --playlist-end 2`（不加 `--flat-playlist`），回傳 NDJSON 格式
  - 新增於 `startLocalServer` 之前，回傳 `JSObject` 帶 `ndjson` 欄位（沿用 `fetchChannelRss` 回傳單一字串欄位的既有慣例）。
  - 未重用 `parsePlaylist`：後者以 `--flat-playlist` 執行，正是造成時間污染的來源，已於方法註解說明。
  - `addOption("--playlist-end", "2")` 使用字串引數，與檔案內既有呼叫（第 283 行）的型別一致。
  - `./gradlew :app:compileDebugJavaWithJavac` 編譯通過。
- [x] 6.3 前端 `DownloadService.ts` Android 備援分支：改為呼叫新的 `fetchChannelVideosFallback` 方法，解析 NDJSON
  - Android 分支自 `this.parsePlaylist(...)` 改為 `YoutubeDlPlugin.fetchChannelVideosFallback({ channelId })`，並以共用的 `parseFallbackNdjson()` 解析。
  - 原分支一律填入 `publishedTime: Date.now()`（因 `--flat-playlist` 拿不到時間），是 Android 端基準污染的直接來源，已消除。
  - 雙平台備援現在走完全相同的解析路徑，行為一致。
- [x] 6.4 前端 `DownloadService.ts` 雙平台備援結果：新增 Live 分頁過濾邏輯，保留 Videos + Shorts 對齊 RSS 涵蓋範圍
  - 實作為 `isLiveTabEntry(entry)`，判準為 `playlist` 欄位符合 `/\s-\sLive$/`。
  - **偏離原任務描述的兩點，皆有實測或推理依據**：
    1. **不採用 `was_live === true`**。任務 6.1 實測顯示 Live 分頁影片的 `was_live` 為 `false`，該條件對此用途無效。更重要的是，`was_live` 指的是「該影片是否為已結束的直播存檔」—— 這類影片若出現在 Videos 分頁，官方 RSS 是涵蓋的，濾掉反而與 RSS 範圍不一致，與本任務目標相反。
    2. **不使用 `playlist.includes("Live")`**，改為比對分頁名後綴。`playlist` 格式為「{頻道名} - {分頁名}」，頻道名本身含 "Live" 時（如 `Live Music - Videos`）會被 `includes` 誤殺。
  - 過濾後改為依 `publishedTime` 由新至舊排序再取前 2 筆。原實作直接 `slice(0, 2)` 取原始順序，而 yt-dlp 是按分頁分組輸出（Videos 全部、再 Live、再 Shorts），若最新內容位於 Shorts 分頁就會取錯。
- [x] 6.5 前端 `DownloadService.ts` 備援時間解析：優先 `timestamp`（秒×1000）→ `upload_date`（YYYYMMDD→Date）→ 兩者皆無則不推進基準
  - 實作為 `mapFallbackEntry(entry)`，兩者皆無時回傳 `publishedTime: 0`（而非 `Date.now()`）。
  - `MonitoredVideoResult.publishedTime` 的型別註解已載明「`0` 表示來源未提供精確發布時間，呼叫端不得以當下時間替代」。
  - `timestamp` 增加 `> 0` 與型別檢查，`upload_date` 增加 `Number.isFinite` 檢查，避免異常值被當成有效時間。
  - **此項只完成了服務層。** 呼叫端 `App.vue` 仍有 `|| now` 會把基準推進至當下，須由任務 6.7 一併修正，6.5 的目標才實際生效。
- [ ] 6.6 驗證備援模式下完整生命週期：RSS 異常 → 備援抓取 → 精確時間比對 → RSS 恢復後基準正常銜接
- [x] 6.7 修正 `App.vue` 中的基準污染點，使 6.5 的目標實際生效
  - **缺口說明**：6.5 的範圍標在 `DownloadService.ts`，但 `Date.now()` 污染的實際發生點在 `App.vue`。即使 `DownloadService` 正確回傳 `publishedTime: undefined`，下列兩行的 `|| now` 仍會把基準推進到當下時間，使 6.5 的目標無法達成：
    - `App.vue:1469`（`checkAllMonitoredChannels` 內）
    - `App.vue:1534`（新片入列後更新基準處）
  - 兩處皆為 `channel.lastPublishedTime = latestVideo.publishedTime || now;`
  - 應改為僅在 `publishedTime` 有值時才更新基準，無值時保留原基準不動
  - 完成後需確認：備援模式下若某影片無精確時間，該頻道的 `lastPublishedTime` 不被改動，RSS 恢復後仍能正確銜接

  **實作結果**

  - 兩處（現行行號 1474 / 1545）皆改為 `if (latestVideo.publishedTime) { ... }` 條件式更新，`|| now` 已完全清除。
  - **一併擋住 `||` 鏈的復活路徑**：原本只擋 `lastPublishedTime` 並不足夠 —— 比對基準取自 `channel.lastPublishedTime || channel.lastCheckTime || 0`，若仍設 `lastCheckTime = now`，污染會從鏈的第二段回來。因此無精確時間時，`lastCheckTime`、`lastKnownVideoId`、`lastVideoTitle` 一併不更新，整組錨點欄位保持原狀。
  - 查證 `lastCheckTime` 的所有用途後確認此作法安全：它僅被第 1192 行的舊資料遷移讀取（`lastPublishedTime || lastCheckTime || 0`），UI 顯示的是 `lastPublishedTime`，排程則使用 `monitorConfig.lastGlobalCheckTime`，皆不受影響。
  - **行為說明**：既有頻道在備援期間保住原基準；全新頻道則維持未初始化狀態，下次檢查重新嘗試錨定 —— 這是自我修復的，一旦取得精確時間即正常開始追蹤，期間不會漏抓任何影片。
  - `vue-tsc` 與 `npm run build` 皆通過，`now` 變數仍有三處使用，無未使用變數殘留。


