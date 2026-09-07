## Why

生產環境實例（Android，v1.0.67）：使用者輸入 `https://www.tiktok.com/@bingleng8888888?_r=1&_t=...`，「正在解析播放清單資訊…」轉了**數分鐘**才結束。這段期間 `showLoadingToast({ duration: 0, forbidClick: true })` 使整個 App 無法操作，且沒有任何取消途徑。

解析階段在三個層級都沒有時間上限，也沒有任何數量上限：

| 層級 | 現況 |
| --- | --- |
| 前端 `App.vue` | toast `duration: 0`、無逾時、無取消鍵 |
| Windows `DownloadService.parsePlaylist` | `Command.sidecar(...).execute()`，無 timeout、不保留 child |
| Android `YoutubeDlPlugin.parsePlaylist` | `new Thread(...)` + `YoutubeDL.execute(request)`，無 timeout、無 processId |
| 兩端共通 | 無 `--playlist-end`，一次抓完整個帳號 |

**實測結果**（隨附 sidecar `yt-dlp 2026.08.18.122307`）：

| 執行 | 結果 |
| --- | --- |
| 全抓（現行行為） | **2 分 18 秒**，**3247 筆** |
| `--playlist-end 200` | **11 秒**，200 筆 |
| `--playlist-items 201-400` | **19 秒**，200 筆，與前一批**無縫接續**（末筆／首筆 id 相鄰） |
| `--playlist-items 1001-1200` | 24 秒後 HTTP 429（連續測試導致的限流） |

因此症狀的本質是**枚舉整個帳號的「慢成功」**，不是失敗得慢。此路徑同時沒有數量上限，3247 筆會一次灌進一個無虛擬列表的勾選對話框，再一次全部推入任務樹 —— 這正是「之前太多會爆」。

> **同一網址曾出現的 `Unable to extract secondary user ID` 與 HTTP 429 為一時性狀況**，並非該版 extractor 的普遍缺陷。判讀單次執行結果時需留意這一點。

## What Changes

### ① 讓解析快速失敗

解析路徑（非下載路徑）加上 `--socket-timeout 15`、`--extractor-retries 0`、`--retries 2`。兩平台對稱套用。此保護對所有 extractor 故障有效，不限 TikTok。

### ② 讓解析可以被放棄

- 前端對解析設 90 秒硬上限，逾時即視為失敗。
- loading toast 提供明確的取消操作。
- 取消／逾時時確實終止背景行程，不留孤兒。兩平台皆已有現成可複用的機制（見 design）。

### ③ 為非 YouTube 的使用者頁網址補上事前確認

現況不對稱：YouTube 頻道網址有「掃描歷史明細（若頻道影片較多，可能需要較長時間）」確認對話框，而 `tiktok.com/@…`、`douyin.com/user/…` 直接衝進解析。將同等的事前確認擴及這兩類網址。

### ④ 修正 TikTok 項目網址組法（防禦性）

`DownloadService.ts` 與 `YoutubeDlPlugin.java` 在 entry 未帶完整網址時，會組出 `https://www.tiktok.com/video/{id}`。實測此形式**不被 TikTok extractor 接受**（落入 generic extractor 並導向 404），正確形式需帶 `@handle` 區段。

> **這是退化分支，平時不會觸發** —— 實測 yt-dlp 的 TikTok entry 一律帶有正式形式的 `url` 欄位。此項為防禦性補強，非作用中缺陷。
>
> 組 handle 時**只能取 `uploader`**：實測 `channel` 是顯示名稱（`冰冷（小号冲一万）`）、`uploader_id` 是純數字（`7192982787066217474`），拿這兩者組網址都是錯的。
>
> Douyin 不需對應處理 —— 實測 `douyin.com/video/{id}` 可正確進入 `[Douyin]` extractor。

### ⑤ 單次抓取上限與分批續抓

單次解析上限 200 部。超過上限的部分不丟棄，而是記住進度：使用者再次輸入同一個來源，接著抓下一批。

- 事前確認對話框顯示進度（「已抓過前 200 部，這次抓 201–400 部」），並提供「從頭開始」以重置。
- 進度以**正規化後的來源鍵**保存，不受分享網址上易變的追蹤參數（`?_r=1&_t=...`）影響。
- 續抓失敗（例如撞上 429）時**不推進進度**，使用者可原地重試。
- 既有的「已存在則過濾」機制保留，用來吸收批次邊界因新作品上架而產生的位移。

## Capabilities

### New Capabilities

- `playlist-parse-resilience`：播放清單／頻道解析階段的時間界限、取消能力、數量上限與分批續抓、事前確認，以及跨平台的解析行為對稱性。

### Modified Capabilities

（無）`youtube-download` 的三項需求皆描述「解析**成功後**」的嚮導對話框行為，本變更只規範解析階段本身，不改動其需求。

## Impact

**受影響程式碼**

- `src/App.vue` — 新增流程：逾時、取消、事前確認與進度提示、進度推進
- `src/services/DownloadService.ts` — `parsePlaylist`（解析參數、`spawn`/`kill`、批次範圍）、TikTok 項目網址組法
- `android/app/src/main/java/com/mattpocock/avd/YoutubeDlPlugin.java` — `parsePlaylist`、`processEntriesHelper`、新增取消方法
- 新增一項持久化設定：各來源的解析進度

**不受影響**

- 下載路徑的重試策略（`PERMANENT_DOWNLOAD_ERRORS` 等）維持不變 —— 本變更的重試調整只作用於解析。
- 自動追蹤的 RSS 與 yt-dlp 備援路徑（已各有 15 筆／2 筆的上限）。

**非目標（Out of Scope）**

- **子清單展開的重複抓取**：實測 `/channel/{id}` 的頂層回傳 3 筆 `_type: playlist`（Videos／Live／Shorts），且**巢狀 entries 已內含於同一份 JSON**；現行程式碼一律忽略 `entry.entries` 而重打 yt-dlp，同一批資料抓了兩次（共 4 次呼叫）。這是獨立的效率缺陷，修它需要改動遞迴展開的結構，與本變更的時間界限主題正交。
- **批次勾選對話框的虛擬列表**：上限 200 之後渲染壓力已大幅緩解，若日後上限調高再處理。
- **統一兩平台的 yt-dlp 版本**：Windows 為隨包 sidecar、Android 由 `youtubedl-android` 內建且可經 `UpdateChannel.NIGHTLY` 更新。版本分裂會造成同一網址在兩端行為不同，屬獨立決策。
