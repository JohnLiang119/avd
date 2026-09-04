## Context

動機與實測佐證見 `proposal.md`。本節僅補充實作所需的現況事實。

**關鍵發現：兩個平台都已經有可直接複用的取消機制，只是解析路徑沒用上。**

| 平台 | 下載路徑（已有取消） | 解析路徑（無取消） |
| --- | --- | --- |
| Windows | `command.spawn()` → 保存 child → `child.kill()`<br>`DownloadService.ts:471`、`648` | `command.execute()`<br>`DownloadService.ts:234` |
| Android | `execute(request, processId, cb)` → `destroyProcessById(processId)`<br>`YoutubeDlPlugin.java:788`、`1017` | `execute(request)`，無 processId<br>`YoutubeDlPlugin.java:74` |

已反編譯 `library-0.18.1.aar` 確認 Android 端 API 確實存在：

```
public final boolean destroyProcessById(java.lang.String);
public final YoutubeDLResponse execute(YoutubeDLRequest, String, Function3<...>)
        throws YoutubeDLException, InterruptedException, YoutubeDL$CanceledException;
```

因此 ②（可取消）不是新機制，而是把既有模式套到第二條路徑上。

**現有的 YouTube 事前確認**（`App.vue:2129-2181`）由兩段組成：先問「是否加入自動追蹤」，再問「是否掃描歷史明細」。TikTok／Douyin 沒有自動追蹤能力，只需要第二段。

## Goals / Non-Goals

**Goals**

- 解析階段的最長等待時間可預測，且在任一平台都相同。
- 取消是真的取消：背景行程確實終止，不留孤兒。
- 解析參數在兩平台對稱，消除「Windows 複製不出 Android 症狀」的偵錯障礙。

**Non-Goals（設計層級，proposal 的非目標之外）**

- 不重構 `parsePlaylist` 的子清單遞迴展開邏輯。它與本次病因無關，且是抓取上限那一案的主戰場。
- 不為解析加進度回報。解析沒有可靠的百分比可用，且會擴大 Android 端的改動面。
- 不統一兩平台的 yt-dlp 版本。

## Decisions

### D1. 取消採「終止行程」而非「前端放手」

**選擇**：前端逾時／使用者取消時，實際終止背景行程。

**替代方案**：前端 `Promise.race` 逾時後直接放手，讓背景行程自生自滅。實作只要幾行，但在 Android 上留下的 yt-dlp 行程會持續重試、耗電與流量，而使用者以為已經取消。既然兩平台都已有現成的終止機制（見 Context），沒有理由選擇會留孤兒的做法。

### D2. Windows 端 `execute()` 改為 `spawn()`

`execute()` 一次回傳完整 stdout 但不交出 child handle，無法終止。`spawn()` 交出 child（可 `kill()`），代價是要自行累積 `stdout` 事件並在 `close` 時組合。

`DownloadService.ts:471` 的下載路徑已經是這個寫法，照既有模式實作即可。**風險是大型 JSON 的累積出錯導致截斷**，列入 Risks。

### D3. 時間上限：前端 90 秒硬上限，`--socket-timeout 15` 為輔

兩者層級不同，需並存：

- `--socket-timeout 15` 只約束**單次連線**，一個會反覆重試或持續分頁的解析仍可跑很久。
- 前端 90 秒是**總時長**的唯一保證，也是使用者實際感受到的那個數字。

**90 秒的成立前提是 D7 的數量上限。** 實測全抓那個 TikTok 帳號要 2 分 18 秒 —— 沒有數量上限的話，90 秒逾時等於讓正常流程必然失敗。加上 200 筆上限後首批只要 11 秒，90 秒才是充裕的保護而非阻礙。兩者必須同時存在，不可只取其一。

**為何是 90 而非更短**：續抓的批次會越來越慢（實測第二批 19 秒），且 YouTube 大型頻道的解析本來就可能數十秒。90 秒對「上限之內」的解析留足餘裕。定為單一常數，兩平台共用。

### D4. 重試參數只加在解析路徑

新增 `--socket-timeout 15 --extractor-retries 0 --retries 2`，只加在兩端的 `parsePlaylist`，`download()` 完全不動。

**為何 `--extractor-retries 0` 但 `--retries 2`**：兩個旗標管的不是同一件事。`--extractor-retries`（預設 3）重試的是**整個 extractor 流程**，包含 TikTok 那個昂貴的 JS challenge —— 這才是數分鐘的來源，且 extractor 層級的失敗通常是永久性的，重試沒有意義。`--retries` 是 HTTP／片段層級，完全關閉會讓正常的大型清單在單次網路抖動下就失敗，故保留 2 次。

### D5. 事前確認只取用 YouTube 分支的第二段

不把 `isStrictChannelUrl` 直接擴大涵蓋 TikTok／Douyin —— 那會連帶觸發「加入自動追蹤」的詢問，而這兩個平台沒有追蹤能力，且 `resolveYouTubeChannel` 對它們也不適用。

改為獨立的判定與對話框，只問「是否掃描」，文案沿用同樣的耗時警告以保持一致。

### D6. TikTok 項目網址只取 `uploader`，退回輸入網址的 handle

目標形式 `https://www.tiktok.com/@{handle}/video/{id}`。

**實測修正（任務 1.1 期間發現）**：原訂的後備鏈 `uploader → channel → uploader_id` 是錯的。實測同一筆 entry：

```
uploader     = "bingleng8888888"                  ← 正確的 handle
channel      = "冰冷（小号冲一万）"                  ← 顯示名稱
uploader_id  = "7192982787066217474"              ← 純數字 id
```

用後兩者組出的網址都是壞的。改為：`uploader` → 自輸入網址擷取 `@handle` → 皆無則保留現行格式（不比現況更糟）。

**同時發現此分支平時不會觸發**：yt-dlp 的 `TikTokUserIE` 以 `_create_url()` 產生完整網址，entry 一律帶有 `url = https://www.tiktok.com/@{user}/video/{id}`。故 ④ 是防禦性補強而非作用中缺陷，proposal 已據此改寫。

**Douyin 無須對應處理**：實測 `douyin.com/video/{id}` 可正確進入 `[Douyin]` extractor（僅因缺 cookie 而無法下載，屬另一議題）。附帶發現 `douyin.com/user/` 落入 `[generic]` —— yt-dlp 沒有 Douyin 使用者頁 extractor，該分支本就無法產出正常清單。

### D7. 數量上限 200，超出部分以「來源進度」分批續抓

**上限值 200**：實測 `--playlist-end 200` 為 11 秒，對照全抓 3247 筆的 2 分 18 秒。200 同時是渲染與儲存的合理邊界（勾選對話框無虛擬列表）。

**續抓以 `--playlist-items {start}-{end}` 實作**。實測邊界乾淨：

```
--playlist-end 200         → 末筆 id ...7665854812214283528
--playlist-items 201-400   → 首筆 id ...7665854674003561736    無縫接續
```

**進度以正規化的來源鍵保存**，不能直接用輸入網址當鍵 —— 分享出來的網址帶有每次都不同的追蹤參數（`?_r=1&_t=ZS-99RJ3WEDUOH`），用原字串當鍵會讓每次分享都被當成新來源。正規化取穩定識別：TikTok 取 `@handle`、YouTube 取 `list=` 或 `/channel/{id}`、Douyin 取 user id，其餘退回去除 query 的網址。

**進度只在解析成功後推進**，推進量為本批實際回傳的筆數（非使用者勾選的筆數 —— 沒勾也算看過了）。續抓失敗時不動進度，使用者可原地重試。

**回傳筆數少於上限即視為抵達結尾**，記錄之，下次告知使用者已無更多內容。

**批次邊界的位移由既有去重吸收**：新作品上架會讓整份清單往後推，使 `201-400` 漏掉或重複一兩筆。既有的 `existingUrls` 過濾已能吸收重複；漏掉的情形由「從頭開始」處理。刻意不做重疊抓取 —— 那會讓每一批都多付出前一批的時間成本。

**替代方案**：在勾選對話框內做「載入更多」。體驗較好，但需在對話框開啟期間維持解析狀態並支援對話框內再次呼叫 yt-dlp，改動面遠大於本方案；且使用者的需求本就描述為「下次再給一次 list」，與本方案的心智模型一致。

## Risks / Trade-offs

- **[Risk] Windows 改 `spawn()` 後 stdout 累積出錯，大型清單的 JSON 被截斷** → Mitigation：以既有的大型 YouTube 播放清單做回歸測試，比對改動前後的項目數量一致。
- **[Risk] Android 的 `destroyProcessById` 對「解析」行程未必如「下載」行程一樣有效** → Mitigation：同一 API，但下載路徑才實際驗證過。任務中安排單點驗證，取消後確認行程確實消失（觀察後續是否仍有網路活動或日誌輸出）。
- **[Risk] `--extractor-retries 0` 使偶發性的 YouTube 解析失敗率上升** → Mitigation：extractor 層級的失敗多為永久性；HTTP 層的抖動由 `--retries 2` 保留承接。若實測發現 YouTube 解析變得不穩，可單獨把此旗標調回 1 而不影響其餘設計。
- **[Trade-off] 90 秒對「真的很大的清單」可能不夠** → 這是刻意的取捨：可預測的失敗優於不可預測的凍結。若日後出現正當的長解析需求，正確解法是加進度回報或分頁抓取，而非放寬上限。
- **[Risk] `@handle` 兩條來源都取不到** → Mitigation：保留現行格式，不比現況更糟。
- **[Risk] 續抓越深越慢，且可能撞上來源限流** → 實測第一批 11 秒、第二批 19 秒；測 `1001-1200` 時遇到 HTTP 429。Mitigation：失敗不推進進度，使用者可稍後原地重試；90 秒上限確保失敗會迅速回報而非拖著。深度續抓遲早會超過 90 秒上限 —— 這是刻意的邊界，屆時使用者會得到明確的逾時訊息而非無盡等待。
- **[Risk] 上限 200 讓使用者以為「這個帳號只有 200 部」** → Mitigation：事前確認對話框必須明講本次抓取的範圍與已抓進度，這是 D7 的必要組成而非附帶說明。
- **[Trade-off] 批次邊界可能因新作品上架而漏掉一兩筆** → 接受。代價是「從頭開始」重抓一次，遠低於每批都做重疊抓取的固定成本。

## Migration Plan

純行為修正，無資料格式、無設定項、無儲存結構變動，不需要遷移步驟。回退即 `git revert`。

四個項目彼此獨立，可分批合入：①③ 最單純，②動到兩端的行程管理，④取決於實測結果。若 ④ 的實測顯示 Douyin 並未受影響，則 ④ 收斂為 TikTok 單邊修正。

## Open Questions

- **Android 上「數分鐘」的組成尚未拆解。** Windows 端已確認全抓需 2 分 18 秒，故枚舉本身足以解釋使用者看到的等待；至於那次為何以失敗收場，Windows 端重測時遇到的一時性 `Unable to extract secondary user ID` 與 HTTP 429 都是候選。這不影響本設計 —— D3 的時間上限與 D7 的數量上限對「慢成功」與「慢失敗」同樣有效。實機驗證時記錄失敗訊息原文即可補上這一塊。
- **上限 200 是否該開放為設定項。** 目前寫死。若實際使用中發現常需續抓多輪，再考慮開放；提前做會多一個需要驗證的設定路徑，且與 D7 的其餘部分正交，日後補上不需改動既有設計。
