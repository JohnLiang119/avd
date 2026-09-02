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

- [ ] 6.1 Windows Rust 端：修改 `src-tauri/src/lib.rs` 的 `fetch_channel_videos_fallback`，移除 `--flat-playlist`，新增 `--skip-download`，使 yt-dlp 回傳精確 `timestamp` 與 `upload_date`
- [ ] 6.2 Android Java 端：在 `YoutubeDlPlugin.java` 新增專用備援方法 `fetchChannelVideosFallback`，使用 `--dump-json --skip-download --playlist-end 2`（不加 `--flat-playlist`），回傳 NDJSON 格式
- [ ] 6.3 前端 `DownloadService.ts` Android 備援分支：改為呼叫新的 `fetchChannelVideosFallback` 方法，解析 NDJSON 並提取 `timestamp`、`upload_date`、`title`、`id`
- [ ] 6.4 前端 `DownloadService.ts` 雙平台備援結果：新增 Live 分頁過濾邏輯（`was_live === true` 或 `playlist` 包含 `"Live"`），保留 Videos + Shorts 對齊 RSS 涵蓋範圍
- [ ] 6.5 前端 `DownloadService.ts` 備援時間解析：修正時間 fallback 策略，優先 `timestamp`（秒×1000）→ `upload_date`（YYYYMMDD→Date）→ 若兩者皆無則不更新 `lastPublishedTime` 基準（避免 `Date.now()` 污染）
- [ ] 6.6 驗證備援模式下完整生命週期：RSS 異常 → 備援抓取 → 精確時間比對 → RSS 恢復後基準正常銜接


