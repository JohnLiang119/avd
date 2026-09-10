## Why

以排程直播為主的頻道會使時間錨點**永久卡死**，導致每輪檢查把錨點之後的所有影片重新判定為新片；平常靠「已在下載佇列中」的去重擋著，使用者一旦清空佇列，數十支舊影片立刻全部重新入列。

2026-09-10 於使用者實機確認的實例（中廣新聞網，`UCkqrvXuqW7dN3E2_4v8Ha5Q`）：

```
RSS 14 筆，跨度 09-09 02:06 → 09-10 01:03
  09-09 02:06  一般影片                  <- 錨點只能停在這裡
  09-09 03:15  排程直播 Live  [未處理]   <- 錨點被釘在它之前
  09-09 03:55  排程直播 Live  [未處理]
  09-09 03:57  排程直播 Live  [未處理]
  09-09 04:14 ~ 09-10 01:03  其餘 10 支  <- 每輪重新判定為新片
```

該頻道每日固定節目（中廣新聞宴、17追新聞、午間新聞）都會提前數小時至數日建立 `is_upcoming` 的直播項目，因此 feed 中**永遠存在**未處理影片，錨點永遠追不上。實機上錨點停在 09-07 11:06、而最後檢查時間為 09-10 10:55，佇列中 32 個任務全數來自此單一頻道。

根因是 `add-channel-subscription-keyword-filter` 的決策 D-B：錨點守門由「把未處理影片剔除後取最大值」改為「錨點不得晚於所有未處理影片中最早者」。該修正本身有正當理由（避免較新的未命中影片把錨點推過較舊的直播），但未考慮「未處理影片永遠存在」的頻道。同一個 feed 在兩版規則下的差異：

| 版本 | 錨點結果 | 後果 |
|---|---|---|
| v1.0.86 之前 | 09-10 01:03（最新） | 正常 |
| v1.0.87 起 | 09-09 02:06 | 其後 10 支每輪重判 |

另一個使問題無法自癒的因素：`checkVideoLiveStatus` 以 `yt-dlp --print live_status --skip-download` 查詢，對排程直播會**直接報錯**（`This live event will begin in 6 hours`），因此回傳 `'unknown'` 而非可辨識的「排程直播」。系統於是無法區分「已知是排程直播、決定跳過」與「查詢失敗、稍後應重試」，只能一律保守地壓住錨點。

## What Changes

- **已知為直播或排程未開播的影片，不再阻擋時間錨點推進。** 它們仍 MUST NOT 被加入下載佇列，但錨點得以越過 —— 與未命中關鍵字的影片同樣視為「使用者明確不要的項目」。
- **僅「狀態無法判定」（`unknown`）的影片繼續阻擋錨點。** 該狀態代表暫時性的查詢失敗，且此類影片會隨其離開 feed 而自然停止阻擋，不會造成永久卡死。
- **`checkVideoLiveStatus` 須能辨識 yt-dlp 對排程直播的錯誤訊息**（`This live event will begin in ...`），將其判定為「直播」而非「狀態無法判定」。否則排程直播仍會落入 `unknown` 而繼續壓住錨點，本修正等同無效。
- **BREAKING（行為變更）**：先前因直播而被跳過的影片，在直播結束轉為存檔後**不再**會被自動下載。這是使用者於 2026-09-10 明確要求的取捨 —— 新聞台的每日排程直播並非想要的內容，而為了將來可能下載它們而讓錨點卡死、每輪空轉並在清空佇列時湧入數十支舊片，代價過高。

## Capabilities

### Modified Capabilities

- `auto-check-filtering`: `Exclude Live Streams from Queue` —— 直播與排程未開播的影片不再阻擋錨點；新增「排程直播的狀態須可辨識，不得因查詢工具報錯而退化為狀態未知」的要求。排除於佇列之外的行為本身不變。
- `channel-auto-monitor`: `時間錨點的推進邊界` —— 「未處理影片」的定義由「因屬直播、首播或狀態查詢失敗而未建立任務者」收斂為**僅**「狀態無法判定者」；已知為直播者改與未命中關鍵字的影片同列，錨點得以越過。

## Impact

- `src/services/DownloadService.ts`：`checkVideoLiveStatus` 須辨識 yt-dlp 對排程直播的錯誤訊息並回傳 `'live'`。API 通道（`youtubeDataApi.ts` 的 `mapLiveStatus`）已能自 `liveBroadcastContent: 'upcoming'` 正確判定，無須改動。
- `src/App.vue`：檢查迴圈中僅 `'unknown'` 加入 `unhandledVideoIds`，`'live'` 不加入。
- `src/composables/useChannelMatching.ts`：`nextChannelBaseline` 的演算法**不需改動** —— 它只認 `unhandledVideoIds` 的內容，收斂該集合即可。既有的 59 個測試應全數維持綠燈。
- Android 端 `YoutubeDlPlugin.checkVideoLiveStatus` 的錯誤處理需比照，否則兩平台行為不一致。
- 無資料模型變更，無備份相容性問題。

## 已考慮但未採用的替代方案

- **回退 D-B**：一行改動，但會換回 D-B 所修的漏抓（較新的未命中影片把錨點推過較舊的直播），且該情境已有單元測試釘住。
- **僅對 `unknown` 放寬**：看似等同本方案，但在**不修正 yt-dlp 錯誤辨識的前提下無效** —— 本案的排程直播正好回傳 `unknown`。兩者必須同時做，故合為一個 change。
- **錨點壓制設時限**（未處理影片超過 N 天即放行）：治標。N 天內仍會空轉，且門檻值缺乏原則性依據。
- **`deferredVideoIds`（以影片 ID 記住待重看者，錨點正常前進）**：可同時保住「直播結束後仍能下載」與「錨點不卡死」，是通用解。但使用者明確表示不要那些排程直播，該方案的主要好處因此消失，而它需要新增資料模型、逾期清理規則與備份相容處理 —— 複雜度不再划算。若日後需求改變（例如希望抓取某些頻道的直播存檔），這是應回頭採用的方向。

## 與其他 change 的依賴

- `add-youtube-data-api-channel` 已完成 45/45 但**尚未歸檔**。兩者皆修改 `channel-auto-monitor`，但目標 Requirement 不同（該 change 動 `Optional Fallback Mechanism and Source Transparency` 與 `Periodic Check & New Video Matching`，本 change 動 `時間錨點的推進邊界`），故不會互相覆寫。
- 本 change 的 delta 以目前主規格（`add-channel-subscription-keyword-filter` 已於 2026-09-10 歸檔後的文字）為基底撰寫。
