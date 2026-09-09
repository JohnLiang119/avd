## Context

動機與缺陷成因見 proposal.md - Why。以下為決定實作方式所需的現況與查證結果。

**查證紀錄**（對 `wI6hG7txiCw` 實測）：

```
live_status=is_live | was_live=False | is_live=True | avail=public
```

以任務實際使用的格式字串 `--simulate` 測試該影片，**在直播進行中的當下是成功的**（選到 HLS format 96）。因此格式字串本身並非缺陷來源 —— 失敗發生於該直播尚為 `is_upcoming` 的時段，當時完全不存在任何可下載的格式。RSS 於直播被排程時即收錄該影片（`publishedTime` 為 2026/09/01 11:38，而開播時間為 2026/09/02 17:36），中間超過一天的窗口內，每小時的自動檢查都會嘗試下載它。

**三處落點：**

| 缺陷 | 位置 |
| :--- | :--- |
| A | `DownloadService.checkVideoLiveStatus` 非 Tauri 分支；`YoutubeDlPlugin.java` |
| B | `App.vue` `checkAllMonitoredChannels` 迴圈結束後的錨點推進 |
| C | `App.vue` `processQueue` 的 `catch` 區塊（現行僅排除使用者主動中止） |

**B 的現行結構**：`latestVideo` 取自 `videos[0]`，而直播的跳過發生在內層迴圈的 `continue`，兩者互不知情：

```js
const latestVideo = videos[0];
...
for (const vid of newVideos.reverse()) {
  if (await checkVideoLiveStatus(vid.url)) continue;   // 跳過，但無人記錄
  ...建立任務
}
if (latestVideo.publishedTime) {
  channel.lastPublishedTime = latestVideo.publishedTime;   // 直接用最新者
}
```

## Goals / Non-Goals

**Goals:**

- 讓 `auto-check-filtering` 的既有規格在 Android 上真正生效。
- 消除「跳過直播即永久漏片」這條路徑。
- 讓確定性失敗即時呈現且訊息如實。

**Non-Goals:**

- 不支援下載直播內容本身（不加 `--live-from-start` 之類的能力）。直播的處置就是排除。
- 不改變格式字串。已驗證其對正常影片與進行中的直播皆可運作，問題不在此。
- 不重構 `checkAllMonitoredChannels` 的整體結構 —— 該工作屬 `extract-channel-matching`，本次只做最小修正以免與其衝突。
- 不處理 app 自動更新的重試迴圈（`App.vue` 另一處 `MAX_RETRIES`），其情境與下載佇列不同。

## Decisions

### 決策 1：Android 以獨立 plugin 方法查詢，不共用備援抓取

Android 端新增 `checkVideoLiveStatus(PluginCall)`，以 yt-dlp 查詢單支影片狀態，與 Windows 的 `--print live_status` 對稱。

**替代方案**：改造頻道檢查流程，一次以 `--dump-json` 取回含 `live_status` 的完整資料，省去逐片查詢。否決原因是那會改變 RSS 路徑的形狀（RSS 本身不提供 live_status，得改為對每個頻道跑一次 yt-dlp），屬架構調整而非缺陷修復，且與 `extract-channel-matching` 的抽離範圍重疊。此想法記入 Open Questions 供日後評估。

### 決策 2：以「已處理集合」推導錨點，而非特判直播

不在錨點推進處加上「如果最新的是直播就往下找一個」這類特判，改為在迴圈中累積本次**確實處理完畢**的影片，錨點取其中發布時間的最大值。

```
候選錨點 = max(已處理影片的 publishedTime)
最終錨點 = 候選錨點 > 現有錨點 ? 候選錨點 : 現有錨點
```

「已處理」包含：成功建立任務者、以及因已存在於佇列而被去重濾除者（那些是先前已處理過的，不應阻擋錨點）。

「未處理」包含：因直播而跳過者、以及狀態查詢失敗而無法判定者。

此形式讓規則與「有幾支直播、直播在第幾順位」無關，也直接對應規格中的三個情境。

### 決策 3：確定性錯誤以錯誤訊息比對辨識

yt-dlp 不提供結構化的錯誤代碼，只能比對訊息文字。以不分大小寫的關鍵片語清單判定，初始涵蓋：

- `requested format is not available`
- `video unavailable`
- `private video`
- `members-only` / `join this channel`
- `this live event will begin in`

**取捨**：字串比對會隨 yt-dlp 版本變動而失效。緩解方式是**失效時退回既有行為**（當成暫時性錯誤照常重試），亦即漏判只會回到現況，不會產生新的故障。反之若誤判（把暫時性錯誤當成確定性），使用者會失去自動重試 —— 因此清單只納入語意明確、不可能因網路狀況而出現的訊息。

### 決策 4：直播相關的失敗給予專屬訊息

`requested format is not available` 與 `this live event will begin in` 在本專案的情境中幾乎必然來自直播或尚未開播的影片。針對這兩者給出「此影片為直播或尚未開播，暫時無法下載」的訊息，而非原始的英文錯誤。

其餘確定性錯誤則保留原始訊息，僅移除「已自動重試 N 次」的前綴。

### 決策 5：D 不新增規格 delta —— 屬既有規格的未實作，與 A 同類

`channel-track-by-publish-time` 待歸檔的 delta 已涵蓋此行為：

> **Scenario: Task title with publish time on main queue**
> **WHEN** 系統將任何影片建立、進行下載或完成為下載任務並於主畫面佇列呈現（**包含使用者手動單一加入**、自動追蹤或播放清單解析）
> **THEN** 系統產生的任務標題…始終穩定包含該影片之發布時間格式化資訊 (YYYY/MM/DD HH:mm:ss)

Android 顯示午夜屬於未達成該要求的**實作缺口**，與 A（`auto-check-filtering` 規格已要求、Android 未實作）是同一類。

刻意不在本變更為此新增規格，原因是該情境目前歸屬於 `channel-track-by-publish-time` 的 MODIFIED 區塊。若本變更也對同一條需求提出 MODIFIED，兩個未歸檔變更會爭奪同一個需求區塊，歸檔順序將決定內容是否遺失 —— 那正是 `optional-ytdlp-fallback` 曾被工具擋下的情況。

### 決策 6：以 `--dump-json` 取代 `VideoInfo`，而非新增一次查詢

`VideoInfo` 是 `youtubedl-android` 的型別化 mapper，反編譯 0.18.1 版確認其 24 個 getter 中沒有任何 timestamp 相關方法。要取得精確時間只能繞過該封裝。

選擇改寫既有的 `getInfo()` 呼叫為 `--dump-json --skip-download` 並以 `org.json` 解析，而非在其之外「再打一次」：

- `getInfo()` 內部本就是 `--dump-json`，改寫後**網路往返次數不變**。
- 同一份 JSON 可一併取得 `live_status`，使分享／手動路徑的直播判定變成免費 —— 呼應 design 的 Open Question（是否以單次 `--dump-json` 取代逐片查詢），此處先在單一影片路徑上落實。
- `org.json` 在該檔案中已被使用（`parsePlaylist`、`fetchChannelVideosFallback`），不引入新相依。

時間解析順序與 `mapFallbackEntry` 一致：`timestamp`（秒×1000）→ `upload_date`（退回午夜）→ 不提供。三處採同一策略可避免日後各自漂移。

## Risks / Trade-offs

**[Android 端逐片查詢直播狀態會增加檢查耗時]** → 僅對「通過時間比對與去重的新影片」查詢，數量通常為 0 至 2 支，與 Windows 端現行行為相同。不會對每次輪詢造成固定成本。

**[錨點改為由已處理集合推導，可能使錨點長期停滯]** → 只要有任何一支影片被處理，錨點就會推進。長期停滯只發生在「該頻道連續多次檢查的新影片全為直播」，此時停滯正是預期行為（不可越過它們）。且去重機制會避免重複建立任務。

**[去重濾除者計入「已處理」的邊界情況]** → 若某影片曾被下載、其任務後來因保留上限而被裁切，則它既不在佇列中、也可能低於錨點，行為與現況一致（不會重複下載，因為錨點已在其之後）。此變更不改變該情況。

**[錯誤訊息比對隨 yt-dlp 版本失效]** → 見決策 3，失效方向是安全的（退回重試）。實作時將關鍵片語集中於單一常數，便於日後調整。

**[改寫 `getInfo()` 為手動 JSON 解析，可能遺漏原 mapper 已處理的欄位]** → 原程式碼自 `VideoInfo` 只取用三個欄位（`title`、`uploader`、`uploadDate`），改寫後逐一對應即可，不涉及其餘 21 個 getter。實作後以實際影片比對標題與頻道名稱是否與改寫前一致。

**[`--dump-json` 對某些站台可能回傳多行或非預期結構]** → 單一影片 URL 的 `--dump-json` 回傳單一 JSON 物件。解析失敗時退回原有行為（欄位留空、由下載流程後續補齊），不中斷下載。

**[與 `extract-channel-matching` 的改動區域重疊]** → 本次對 `checkAllMonitoredChannels` 的修改刻意保持最小且集中，該變更抽離時會將此邏輯一併帶入純函式並補上測試。實作後應於 `extract-channel-matching` 的 tasks 補記需涵蓋錨點邊界規則。

## Open Questions

- **是否改以單次 `--dump-json` 取代逐片的直播狀態查詢？** 備援路徑已在取用完整 JSON，其中本就含 `live_status`；若 RSS 路徑也改為此形式，可省去逐片查詢並讓兩條路徑一致。但這會使每次頻道檢查都需執行一次 yt-dlp（RSS 路徑目前不需要），是效能與一致性的取捨。屬架構調整，建議待 `extract-channel-matching` 完成、比對邏輯已有測試保護後再評估。
