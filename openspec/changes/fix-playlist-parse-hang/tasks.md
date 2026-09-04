# 實作任務

## 1. 前置驗證（決定 ④ 的範圍）

- [x] 1.1 實測 `--flat-playlist -J` 對 TikTok 使用者頁的 entry 是否穩定帶有作者欄位（`uploader` / `channel` / `uploader_id`），記錄實際欄位名稱與內容
- [x] 1.2 實測 `douyin.com/video/{id}` 是否確實不被 Douyin extractor 接受（比照 TikTok 的驗證方式：觀察是否落入 `[generic]`）。若未受影響，將 ④ 收斂為 TikTok 單邊修正並更新 design
- [x] 1.3 記錄現行 Windows 端解析一個**正常**大型 YouTube 播放清單的耗時與項目數，作為後續回歸比對的基準

## 2. ① 解析階段快速失敗

- [x] 2.1 `DownloadService.parsePlaylist` 的主解析與子清單展開兩處 args，皆加入 `--socket-timeout 15 --extractor-retries 0 --retries 2`
- [x] 2.2 `YoutubeDlPlugin.parsePlaylist` 與 `processEntriesHelper` 的子清單請求，加入相同三個選項
- [x] 2.3 確認 `download()` 路徑完全未被改動（`PERMANENT_DOWNLOAD_ERRORS` 與既有重試策略維持原狀）
- [x] 2.4 以 1.3 的基準回歸：正常大型清單的項目數不變、耗時無顯著劣化

## 3. ② 解析階段可取消

- [x] 3.1 定義共用的解析逾時常數（90 秒），置於前端單一位置供兩平台分支共用
- [x] 3.2 Windows：`parsePlaylist` 由 `command.execute()` 改為 `command.spawn()`，累積 `stdout` 事件並於 `close` 組合，比照 `DownloadService.ts:471` 的既有寫法；保存 child handle 供終止
- [x] 3.3 Windows：實作終止路徑，取消或逾時時呼叫 `child.kill()`，並清除保存的 handle
- [x] 3.4 Android：`parsePlaylist` 改用 `execute(request, processId, cb)`，processId 由呼叫端傳入或自動產生後回傳；捕捉 `CanceledException` 並以可辨識的結果回覆前端
- [x] 3.5 Android：新增取消解析的 plugin 方法，內部呼叫 `destroyProcessById(processId)`
- [x] 3.6 前端：解析包上 90 秒逾時，逾時即觸發對應平台的終止路徑並以失敗結束
- [x] 3.7 前端：載入提示改為可取消，取消時觸發終止路徑；確保 `closeToast()` 在成功、失敗、逾時、取消四條路徑上都會執行
- [ ] 3.8 確保取消後的狀態乾淨：立即輸入另一網址能正常啟動新解析，不受前次殘留影響

## 4. ③ 使用者頁的事前確認

- [x] 4.1 新增獨立的判定，涵蓋 `tiktok.com/@` 與 `douyin.com/user/`（不擴大 `isStrictChannelUrl`，避免觸發不適用的自動追蹤詢問，見 design D5）
- [x] 4.2 於解析啟動前顯示確認對話框，文案沿用 YouTube 分支「可能需要較長時間」的耗時警告
- [x] 4.3 使用者選擇略過時直接返回，不啟動解析、不顯示載入提示
- [ ] 4.4 確認 YouTube 既有的兩段式流程（加入追蹤 → 掃描明細）未受影響

## 5. ④ TikTok／Douyin 項目網址修正（追加項，可單獨移除）

- [x] 5.1 依 1.1 的結果，於 `DownloadService.ts` 將 TikTok 項目網址改組為 `https://www.tiktok.com/@{handle}/video/{id}`，handle 優先取 entry 作者欄位、退回自輸入網址擷取、兩者皆無則保留現行格式
- [x] 5.2 `YoutubeDlPlugin.processEntriesHelper` 套用相同邏輯，與前端保持一致
- [x] 5.3 依 1.2 的結果決定是否對 Douyin 套用同樣修正
- [x] 5.4 以實際 TikTok 項目網址執行 `--simulate`，確認進入 `[TikTok]` extractor 而非 `[generic]`

## 6. 驗證

- [x] 6.1 Windows：以 App 實際參數對該 TikTok 網址實測，`--playlist-end 200` 為 11 秒（對照全抓 2m18s／3247 筆），遠在 90 秒上限內
- [ ] 6.2 Windows：輸入一個正常大型 YouTube 播放清單，於解析中途按取消，確認介面立即恢復且 yt-dlp 子行程已終止（工作管理員確認）
- [x] 6.3 Windows：以新參數重跑 1.3 的基準來源，各分頁筆數 [117, 23, 332] 與改前完全一致（註：此為 yt-dlp 層級比對，App 內的 spawn 累積路徑仍待 6.2 一併驗證）
- [ ] 6.4 Android 實機：同一個 TikTok 網址，確認等待時間由數分鐘壓至可接受範圍，並記錄失敗訊息原文（回填 design 的 Open Question）
- [ ] 6.5 Android 實機：解析中途取消，確認介面立即恢復、且無殘留的背景解析活動
- [ ] 6.6 Android 實機：TikTok 使用者頁出現事前確認對話框，選擇略過時不啟動解析
- [ ] 6.7 Android 實機：既有的 YouTube 頻道與播放清單批次下載流程完整走一遍，確認未回歸

## 7. 收尾

- [x] 7.1 `npm run build`、`npm test`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 四項全數通過
- [x] 7.2 `openspec validate fix-playlist-parse-hang --strict` 通過
- [x] 7.3 將實測所推翻或修正的設計假設回填 design.md（特別是 1.1／1.2 的結果與 D6）

## 8. 實測發現（任務 1 執行後追記，推翻部分設計前提）

- [x] 8.1 記錄：`tiktok:user` extractor **並未普遍損壞**。提案所引的 `Unable to
      extract secondary user ID` 為一時性狀況（另一次執行遇到 HTTP 429）。以同一
      網址重測成功回傳 **3247 筆**，耗時 **2 分 18 秒**。
- [x] 8.2 記錄：因此使用者遇到的並非「失敗得很慢」，而是**枚舉整個帳號的慢成功**。
      提案「時間花在重試而非枚舉」的推論不成立，`抓取上限` 由「非目標」變為
      本症狀的正解。
- [x] 8.3 記錄：TikTok entry **確實帶有 `url` 欄位**且為正式形式
      （`https://www.tiktok.com/@bingleng8888888/video/7681249578942795015`）。
      故 ④ 的退化分支平時不會觸發 —— 屬防禦性補強，非作用中缺陷。
      提案「每一筆都是死連結」的敘述不成立。
- [x] 8.4 記錄：entry 的 `channel` 為顯示名稱（`冰冷（小号冲一万）`）、
      `uploader_id` 為純數字（`7192982787066217474`），只有 `uploader` 才是 handle。
      design D6 原訂的三段式後備會組出錯誤網址，已改為 `uploader` → 輸入網址擷取。
- [x] 8.5 記錄：`douyin.com/video/{id}` 可正確進入 `[Douyin]` extractor，
      ④ 收斂為 TikTok 單邊。另發現 `douyin.com/user/` 落入 `[generic]`，
      yt-dlp 無 Douyin 使用者頁 extractor。
- [x] 8.6 記錄：`/channel/{id}` 的頂層回傳 3 筆 `_type: playlist`（Videos 117／
      Live 23／Shorts 332），且**巢狀 entries 已內含於同一份 JSON**。現行程式碼
      忽略 `entry.entries` 一律重打 yt-dlp，等於同一批資料抓兩次（共 4 次呼叫）。
      屬 `抓取上限` 那一案的範疇，本變更不處理。

## 9. 已決（原待決事項）

- [x] 9.1 **PARSE_TIMEOUT_MS 與實測衝突已解決**：採「加入抓取上限」。實測
      `--playlist-end 200` 為 11 秒，90 秒逾時因而成為充裕的保護而非阻礙。
      使用者另要求超出上限的部分可分批補抓，遂新增第 ⑤ 項（見第 10 組）。
      實測 `--playlist-items 201-400` 為 19 秒且與前一批無縫接續，
      `--playlist-items 1001-1200` 於 24 秒後遇 HTTP 429（連續測試導致的限流）。

## 10. ⑤ 單次抓取上限與分批續抓

- [x] 10.1 定義 `PARSE_BATCH_SIZE = 200` 常數，與 `PARSE_TIMEOUT_MS` 並置
- [x] 10.2 實作來源鍵正規化：TikTok 取 `@handle`、YouTube 取 `list=` 或
      `/channel/{id}`、Douyin 取 user id，其餘退回去除 query 的網址
- [x] 10.3 新增持久化設定保存各來源的解析進度（已抓筆數、是否已達結尾），
      經 `storage.defineSetting` 納入既有持久化機制
- [x] 10.4 `DownloadService.parsePlaylist` 接受批次範圍參數，首批送
      `--playlist-end N`、續抓送 `--playlist-items {start}-{end}`
- [x] 10.5 `YoutubeDlPlugin.parsePlaylist` 接受並套用相同的批次範圍參數
- [x] 10.6 子清單展開沿用同一批次範圍（避免 YouTube 頻道的分頁展開繞過上限）
- [x] 10.7 事前確認對話框顯示本次抓取範圍與已抓進度，並提供「從頭開始」
- [x] 10.8 解析成功後依實際回傳筆數推進進度；回傳筆數少於上限時標記已達結尾
- [x] 10.9 解析失敗、逾時或取消時不推進進度
- [x] 10.10 為來源鍵正規化與進度推進邏輯補上 vitest 單元測試
- [ ] 10.11 實機驗證：同一 TikTok 網址連續送出三次，確認抓到 1-200、201-400、
      401-600，且第二、三次的網址帶不同追蹤參數仍被視為同一來源
- [ ] 10.12 實機驗證：對已有進度的來源選擇「從頭開始」，確認自第一批重抓

## 11. 追記（實作期間發現）

- [x] 11.1 純函式抽離至 `src/services/parseScope.ts`：`DownloadService` 匯入
      `@tauri-apps/*` 與 `@capacitor/core`，函式宣告在其中會讓 vitest 引用不到
      （與先前 `matchPermanentError` 同一問題）。`DownloadService` 轉出這些
      符號以維持既有匯入路徑。
- [x] 11.2 `.java` 不可加 BOM：以腳本改寫時誤用 `utf-8-sig`，javac 直接以
      `illegal character: '﻿'` 中斷編譯。已補進 CLAUDE.md 的編碼規範。
