## Why

生產環境回報一則失敗任務，追查後發現三個彼此相關但嚴重度不同的缺陷：

```
[中廣新聞網] …｜Live 2026-09-02 17:36 (2026/09/01 11:38:42)
已自動重試 3 次仍失敗: ERROR: [youtube] wI6hG7txiCw:
  Requested format is not available.
```

該影片經查證為 YouTube 直播（`live_status = is_live`），且任務標題格式顯示它是由頻道自動追蹤所建立。

**A. Android 端的直播過濾從未實作。** `auto-check-filtering` 規格明訂系統 MUST NOT 將直播或排程首播加入下載佇列，但 `DownloadService.checkVideoLiveStatus` 在非 Tauri 環境下直接 `return false`，註解寫著「Android 目前不支援此功能，預設當作非直播」。Windows 端有正確查詢 `live_status` 並攔截 `is_live` 與 `is_upcoming`，Android 端則完全放行。排程直播在尚未開播時沒有任何可下載的格式，這正是 `Requested format is not available` 的成因。

**B. 被跳過的直播仍會讓時間錨點推進過去，造成永久漏片。** 目前的更新邏輯以 `videos[0]`（最新影片）的發布時間推進 `lastPublishedTime`，而不論該影片是否因直播而被跳過。排程直播一經建立即進入 RSS，其 `publishedTime` 是建立時間而非開播時間，且此值在直播結束轉為存檔影片後**不會改變**。因此錨點一旦推過它，該片即使日後可正常下載，也永遠不會再被判定為新片。這與 `channel-track-by-publish-time` 所要消滅的漏片屬同一類，但先前的修正未涵蓋此路徑。

**D. Android 端單一影片下載的發布時間永遠是午夜。**（後續於驗證 C 時，自同一則任務的標題發現）`YoutubeDlPlugin` 取用 `VideoInfo.getUploadDate()` 後直接串上 `" 00:00:00"`，從未嘗試 `timestamp`。經反編譯 `youtubedl-android 0.18.1` 確認，`VideoInfo` 的 24 個 getter 中沒有任何 timestamp 相關方法 —— 該函式庫的 mapper 把 `timestamp` 欄位丟掉了，因此並非單純寫漏，而是被函式庫的型別封裝擋住。結果是 Windows 端顯示精確時間、Android 端一律午夜，跨平台不一致。

**C. 對確定性錯誤仍重試 3 次。** 下載佇列的重試迴圈只排除了使用者主動中止，其餘一律重試。`Requested format is not available`、`Video unavailable`、`Private video` 等屬於重試必然再失敗的錯誤，白白耗費時間與流量，也讓使用者看到「已自動重試 3 次」這種暗示問題可能是暫時性的訊息。

## What Changes

### A. 讓 Android 具備直播狀態查詢能力

- `YoutubeDlPlugin.java` 新增 `checkVideoLiveStatus` 方法，以 yt-dlp 查詢單支影片的 `live_status`。
- `DownloadService.checkVideoLiveStatus` 的非 Tauri 分支改為呼叫該原生方法，移除永遠回傳 `false` 的樁實作。
- 兩平台的攔截判準一致：`is_live` 或 `is_upcoming` 皆不得加入佇列。

### B. 時間錨點不得推進超過被跳過的影片

- 錨點改為推進至「本次確實處理完畢的影片」中最新者的發布時間 —— 因直播而跳過的影片不計入。
- 若最新影片即為被跳過的直播，錨點僅推進至次新的已處理影片；若無任何已處理影片，錨點維持不變。
- 效果：被跳過的直播在下次檢查時仍會被重新評估，直播結束轉為存檔後即可正常入列。

### C. 區分確定性與暫時性下載錯誤

- 於下載佇列的重試迴圈中辨識確定性錯誤，命中時立即標記失敗、不進行重試。
- 失敗訊息改為說明實際原因（例如「此影片為直播或尚未開播，暫時無法下載」），不再顯示誤導性的「已自動重試 3 次」。

### D. Android 端取得精確的單一影片發布時間

- 以 `--dump-json` 取代 `VideoInfo` 型別封裝，直接解析原始 JSON 以取得被 mapper 丟棄的 `timestamp`。
- 時間解析順序與備援路徑的 `mapFallbackEntry` 一致：`timestamp` → `upload_date`（退回午夜）→ 無。
- 該次呼叫順帶取回 `live_status`，使分享／手動路徑也能得知影片是否為直播，不需額外的網路往返。

## Capabilities

### New Capabilities

- `download-retry-policy`: 下載失敗的重試策略 —— 區分可重試的暫時性錯誤與不可重試的確定性錯誤，並提供對應的使用者訊息。

### Modified Capabilities

- `auto-check-filtering`: 明確要求直播排除須在所有支援的平台上生效，不得因平台而異。
- `channel-auto-monitor`: 補上時間錨點的推進邊界 —— 錨點不得越過本次未被處理（例如因直播而跳過）的影片。

## Impact

- **Android 原生端**：`YoutubeDlPlugin.java` 新增一個 plugin 方法（A），並改寫 `download()` 中的中繼資料提取（D）。
- **前端服務層**：`DownloadService.checkVideoLiveStatus` 的 Android 分支改為實作。
- **前端邏輯**：`App.vue` 的 `checkAllMonitoredChannels`（錨點推進）與 `processQueue`（重試判斷）。
- **使用者可見的行為變更**：Android 端不再出現直播造成的失敗任務；確定性錯誤的失敗訊息更準確且更快出現；Android 端手動與分享下載的任務標題改為顯示實際發布時間，不再一律午夜。
- **不影響**：持久化層、建置與發布流程、既有的 RSS 與備援抓取路徑。
