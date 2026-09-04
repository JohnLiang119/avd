## Why

使用者輸入 `https://space.bilibili.com/3493134753335919?spm_id_from=...` 詢問能否一次下載。實測 yt-dlp **完全支援**（`BilibiliSpaceVideo` extractor，2 秒回傳全部 38 筆，每筆皆為完整的 `bilibili.com/video/BV...`），但 AVD 接不到 —— 這暴露出兩個結構性問題。

### 問題一：來源知識散落五處，沒有單一真相

判斷「這個網址是什麼、要怎麼處理」的邏輯目前分散在五個互不相干的位置：

| # | 位置 | Bilibili 空間頁的現況 |
| --- | --- | --- |
| 1 | `App.vue` 的 `isPlaylistUrl` 白名單 | **漏了** —— 七個條件全部落空 |
| 2 | `parseScope.ts` 的 `parseProgressKey` | 剛好可用（mid 在路徑上，`split('?')` 正好切掉 `spm_id_from`） |
| 3 | `App.vue` 的 `isCreatorPageUrl` 事前確認 | 不會觸發 |
| 4 | `DownloadService.ts` 的項目網址組法 | 不需要（entry 已帶完整網址） |
| 5 | flat-playlist 的 metadata 可用性（無人記錄） | **完全沒有** |

每接一個新來源都要記得改這五處，而歷史證明會漏 —— 且不只漏，還會留下假的：`isPlaylistUrl` 中的 `douyin.com/user/` 是一條**死判定**，實測 yt-dlp 根本沒有 Douyin 使用者頁 extractor，命中後只會落入 generic。這份白名單同時漏了真的支援的（Bilibili）、留著假的（Douyin）。

因為 #1 落空，該網址會被當成單一影片推進佇列。下載路徑的輸出樣板為 `-o {uniqueId}.%(ext)s`，不含 `%(id)s` 或 `%(playlist_index)s`，38 支會全部落到同一個檔名互相覆蓋。

### 問題二：部分來源的 flat-playlist 沒有 metadata

Bilibili 空間頁的 entry 只有三個欄位：

```json
{ "ie_key": "BiliBili", "id": "BV181t46eEZm", "_type": "url",
  "url": "https://www.bilibili.com/video/BV181t46eEZm" }
```

對照 TikTok 的 26 個欄位（含 `title`、`timestamp`、`duration`、`uploader`）。後果是勾選對話框顯示 `影片 1`～`影片 38`、無片長，群組名稱退化為 `頻道主 / 播放清單`。

> 值得注意：**下載時標題會補回來** —— 下載路徑各自會再 `--dump-json`（Android）或讀 `.info.json`（Windows）。缺的只是**選片當下的預覽資訊**，下載完的檔名與任務標題是正確的。問題是「選的時候瞎選」，不是「不能用」。

### 實測發現：補齊 metadata 會撞上來源限流

補齊的天真做法（對每支影片跑 `--dump-json`）在 Bilibili 上會被限流打爆。以一次 yt-dlp 呼叫帶 5 個網址實測：

```
耗時 6 秒（5 支）    成功 2 筆
ERROR: [BiliBili] 181t46eEZm: HTTP Error 412: Precondition Failed
ERROR: [BiliBili] 1G4jx6BEtE: HTTP Error 412: Precondition Failed
ERROR: [BiliBili] 1zfLc61Eda: HTTP Error 412: Precondition Failed
```

**速度不是問題（約 1.2 秒／支），成功率才是。** 且 `fix-playlist-parse-hang` 為列表階段訂下的 `--extractor-retries 0` 在此適得其反 —— 412 是暫時性的限流，正是應該退避重試的情況。列表階段與補齊階段需要相反的重試策略。

## What Changes

### ① 來源能力表：把散落五處的判斷收斂為單一註冊表

新增 `src/services/sourceProfiles.ts`，每個來源一筆，宣告其網址樣式、進度鍵取法、是否為多片集合、是否需要事前確認、flat-playlist 的 metadata 完整度、項目網址組法。依序比對、首個命中者生效，未命中則退回單一影片。

上述五處改為向此表查詢，不再各自判斷。加新來源只改一處。

**Douyin 使用者頁標記為 `unsupported`**：不是移除、也不是留著假支援，而是明確表達「已知不支援」，使 App 能給出清楚訊息，而非落入 generic 後產生令人困惑的失敗。

### ② Bilibili 空間頁納入支援

`space.bilibili.com/{mid}`（含 `/video` 變體）視為多片集合。進度鍵取 `bilibili:space:{mid}`，不再倚賴「query 參數剛好都在 `?` 之後」這個巧合。

### ③ 補齊階段：列表之後獨立的第二階段

解析拆為兩階段：

```
階段一  列表（flat）    快、必須成功、受既有的 90 秒上限保護
階段二  補齊（enrich）  慢、允許局部失敗、漸進更新、可跳過
```

階段二僅對 `flatMetadata` 宣告為不完整的來源啟動。它在勾選對話框**已經顯示之後**執行，逐塊回填標題、片長與發布時間，因此不延後使用者看到清單的時間，也不受階段一的 90 秒上限約束。

補齊失敗的項目保留其退化標籤（`影片 N`），**不視為錯誤** —— 補齊是增益，不是前提。

針對限流採與列表階段相反的策略：分塊、塊間節流、對 412／429 退避重試。

### ④ 多序列來源的進度定址（自 `fix-playlist-parse-hang` 併入）

`fix-playlist-parse-hang` 的分批續抓對 YouTube 頻道會**永久漏片**。根因是單位不一致：進度是全域計數，但批次範圍套用在**每個分頁上**。

以 Lofi Girl 頻道（videos 117／streams 23／shorts 332）實測：

```
第一批  --playlist-end 200        每分頁各取 200
        117 + 23 + 200 = 340 筆   →  進度推進 fetched = 340

第二批  --playlist-items 341-540  同樣套在每個分頁上
        videos 0 / streams 0 / shorts 0（341 已超過 332）
        合計 0 筆  →  標記為已抓完

        shorts 剩下的 132 部永遠拿不到
```

直接打 shorts 分頁驗證：

```
--playlist-end 200         →  200 筆
--playlist-items 201-400   →  132 筆   ← 正確的續抓
--playlist-items 341-540   →    0 筆   ← 程式實際送出的
```

一個頻道是**三個獨立序列**，單一純量進度無法定址進三個序列。這正是本變更所建抽象要處理的形狀，故併入而非在 `fix-playlist-parse-hang` 內修補。

改為**每個序列各記進度**：註冊表宣告一個來源是否會展開為多序列，進度鍵隨之帶上序列識別。

附帶解掉一個效率缺陷：實測 `--playlist-end 200` 打在頻道網址上時，**內嵌的 entries 已各自被裁到 200**（117／23／200，4 秒）—— 與逐分頁呼叫的結果完全相同。現行程式碼卻忽略 `entry.entries` 一律重打 yt-dlp，同一批資料抓了兩次（共 4 次呼叫）。首批改用內嵌結果即可，僅續抓需要逐分頁送 `--playlist-items`。

> **「單次上限 200」對多序列來源的意義是「每序列 200」**，故一個三分頁頻道的首批可達 600 筆。這是刻意的取捨：唯有每序列各自設限，續抓才定址得進去。

## Capabilities

### New Capabilities

- `media-source-profiles`：媒體來源的辨識與能力宣告 —— 網址樣式、進度鍵、集合與否、事前確認、metadata 完整度、已知不支援的來源。
- `playlist-metadata-enrichment`：清單項目 metadata 的補齊階段 —— 觸發條件、漸進更新、局部失敗的容忍，以及面對來源限流的行為。

### Modified Capabilities

（無）

> `fix-playlist-parse-hang` 的 `playlist-parse-resilience` 尚未歸檔，其規格只存在於該變更的 delta 中。刻意**不**對它提出 MODIFIED —— 兩個未歸檔變更爭奪同一需求區塊會使歸檔順序決定內容存亡（`optional-ytdlp-fallback` 曾踩過）。補齊階段本就是列表階段之後的獨立行為，另立能力在語意上也更貼切。

## Impact

**受影響程式碼**

- 新增 `src/services/sourceProfiles.ts` — 來源能力表與查詢函式
- `src/App.vue` — `isPlaylistUrl`、`isCreatorPageUrl` 改為查表；勾選對話框開啟後啟動補齊
- `src/services/parseScope.ts` — `parseProgressKey` 改為查表；進度結構改為可容納多序列
- `src/services/DownloadService.ts` — 項目網址組法改為查表；新增補齊用的解析方法
- `android/.../YoutubeDlPlugin.java` — 新增補齊用的 plugin 方法
- `src/components/YouTubeBatchModal.vue` — 支援項目資料在對話框開啟後被就地更新

**不受影響**

- 下載路徑的行為與檔名規則（`fix-filename-collision` 的範圍）
- 自動追蹤的 RSS 與備援路徑
- 列表階段既有的時間上限、取消與分批續抓（`fix-playlist-parse-hang` 的範圍）

**依賴**

- 本變更假設 `fix-playlist-parse-hang` 已落地（`PARSE_TIMEOUT_MS`、`parseProgressKey`、批次範圍皆來自該變更）。兩者程式碼有重疊，**應在 `fix-playlist-parse-hang` 完成驗證後再開始實作**。

**非目標**

- **不改動下載階段的 metadata 取得**：下載時本就會各自取得完整資訊，行為正確，不需要改。
- **不做清單的虛擬列表**：200 筆上限之後渲染壓力已緩解。
- **不為 Bilibili 加入自動追蹤**：追蹤機制目前綁定 YouTube 的 RSS，擴及其他平台是獨立議題。
- **不解決 Douyin 使用者頁**：yt-dlp 上游未支援，本變更只是把它標記清楚。
