# 實作任務

> **前置條件**：`fix-playlist-parse-hang` 已完成驗證並歸檔。兩者皆改動 `App.vue`
> 的新增流程與 `DownloadService.parsePlaylist`，同時進行會互相踩到。

## 1. 來源能力表

- [ ] 1.1 新增 `src/services/sourceProfiles.ts`，定義 `SourceProfile` 介面與 `SourceKind` / `FlatMetadata` 型別
- [ ] 1.2 為既有來源各建一筆：`youtube-playlist`（`list=`）、`youtube-channel`（`/channel/`、`/c/`）、`youtube-handle`（`youtube.com/@`）、`tiktok-user`、`douyin-user`（`kind: 'unsupported'`）、`douyin-short`（`v.douyin.com`）
- [ ] 1.3 加入 fallback profile（`kind: 'single'`），涵蓋所有未命中的網址
- [ ] 1.4 實作 `resolveSourceProfile(url)`：依序比對、首個命中者生效
- [ ] 1.5 補上 vitest：每個 profile 的命中與不命中、順序敏感案例（`watch?v=x&list=PL...` 必須解析為清單而非單片）、fallback

## 2. 五處改為查表（純重構，行為不變）

- [ ] 2.1 `App.vue` 的 `isPlaylistUrl` 改為 `resolveSourceProfile(url).kind === 'collection'`
- [ ] 2.2 `App.vue` 的 `isCreatorPageUrl` 改為 profile 的 `needsPreParseConfirm`
- [ ] 2.3 `App.vue` 新增 `unsupported` 分支：顯示「此來源目前無法解析」並直接返回
- [ ] 2.4 `parseScope.ts` 的 `parseProgressKey` 改為委派給 profile 的 `progressKey`；原有的 regex 搬進各 profile
- [ ] 2.5 `DownloadService.ts` 兩處項目網址組法改為呼叫 profile 的 `buildItemUrl`（僅 TikTok 有）
- [ ] 2.6 全域搜尋 `includes('tiktok`、`includes('douyin`、`includes('/channel/'`、`includes('list='` 等，確認除註冊表外無殘留判斷
- [ ] 2.7 回歸：既有的 YouTube 頻道／播放清單、TikTok 創作者頁流程行為完全不變（含進度鍵格式）

## 3. ④ 多序列來源的進度定址（自 fix-playlist-parse-hang 併入）

- [ ] 3.1 `SourceProfile` 新增宣告：此來源是否會展開為多個獨立序列
- [ ] 3.2 `youtube-channel` / `youtube-handle` 標為多序列；`youtube-playlist`、`tiktok-user`、`bilibili-space` 為單序列
- [ ] 3.3 進度結構改為可容納序列識別（`yt:channel:UCxxx/videos` 等），單序列來源的鍵格式維持原樣
- [ ] 3.4 續抓只對 `complete: false` 的序列發出請求，各自帶自己的範圍
- [ ] 3.5 所有序列皆 `complete` 時才將該來源標記為已抓完
- [ ] 3.6 首批直接採用頂層回應內嵌的 `entry.entries`，不再為各分頁重打 yt-dlp
      （實測 `--playlist-end 200` 打在頻道網址上時，內嵌結果已各自裁到 200，
      與逐分頁呼叫完全相同 —— 一併結案 fix-playlist-parse-hang 任務 8.6）
- [ ] 3.7 事前確認對話框據實說明各序列的範圍，不報單一合計數字
- [ ] 3.8 舊格式的進度鍵直接忽略、視為無進度，不寫遷移邏輯
- [ ] 3.9 補上 vitest：序列長度不一時的續抓定址、部分序列已完成、全部完成才標記來源完成、舊鍵被忽略
- [ ] 3.10 實測回歸：Lofi Girl 頻道（videos 117／streams 23／shorts 332）
      首批得 340 筆（4 秒、1 次呼叫），第二批 shorts 應得剩餘 132 筆而非 0 筆
- [ ] 3.11 實測：600 筆規模下勾選對話框的渲染表現；若不可接受，將虛擬列表升格為必要工作並更新 design

## 4. Bilibili 空間頁納入支援

- [ ] 4.1 新增 `bilibili-space` profile：`space.bilibili.com/{mid}`（含 `/video` 變體）、`kind: 'collection'`、`flatMetadata: 'none'`、`progressKey` 取 `bilibili:space:{mid}`
- [ ] 4.2 決定是否需要 `needsPreParseConfirm`（實測 38 筆僅 2 秒，可能不需要）
- [ ] 4.3 實測：解析該網址能得到完整項目清單，數量與 `playlist_count` 一致
- [ ] 4.4 實測：帶不同 `spm_id_from` 的同一網址取得相同進度鍵

## 5. 補齊階段

- [ ] 5.1 `DownloadService` 新增補齊方法：接受一組網址，以單次 yt-dlp 呼叫帶多個網址、`--dump-json --skip-download`，解析 NDJSON 逐筆回呼
- [ ] 5.2 **先驗證**：Android 的 `execute(request, processId, Function3)` 回呼第三參數是否為 stdout 行。可行則逐行回呼；不可行則退回「每塊一次 plugin 呼叫」
- [ ] 5.3 補齊採與列表階段相反的重試策略：對 412／429 退避重試，不套用 `--extractor-retries 0`
- [ ] 5.4 分塊執行並於塊間節流，初值每塊 5 支、間隔 1 秒
- [ ] 5.5 實測調整塊大小與間隔：以 Bilibili 38 筆為樣本，記錄不同組合的成功率與總耗時，擇一為預設值並寫回 design
- [ ] 5.6 補齊有自有時間預算，超出即停止並保留已取得的結果
- [ ] 5.7 補齊可取消：對話框關閉或取消新增時停止並終止背景行程

## 6. 漸進回填

- [ ] 6.1 解析完成後立即顯示對話框；`flatMetadata === 'none'` 時於其後啟動補齊
- [ ] 6.2 補齊結果依 `id` 就地更新 `parsedPlaylistItems`，不替換整個陣列為新的 id 序列
- [ ] 6.3 確認 `YouTubeBatchModal` 的 `:key="item.id"` 穩定，更新期間既有勾選狀態不變
- [ ] 6.4 補齊失敗的項目保留退化標籤，仍可勾選與下載
- [ ] 6.5 補上 vitest：就地更新後 id 序列不變、部分失敗時的結果合併

## 7. ⑤ 來源限流的辨識與退避

- [x] 7.1 新增 `src/services/rateLimit.ts`：`isRateLimited(message)` 辨識 429／412 等限流片語
- [x] 7.2 實作 `rateLimitBackoffMs(attempt)`：指數退避 2s → 4s → 8s，上限 3 次
- [x] 7.3 實作 `describeRateLimit()`：回傳給使用者看的「來源暫時限流，請稍後再試」訊息
- [x] 7.4 補上 vitest：限流片語命中與不命中、與 `matchPermanentError` 互斥（429／412 不得落入確定性清單）、退避序列、次數上限
- [x] 7.5 列表階段：`runParseCommand` 失敗且判定為限流時退避重試，維持 `--extractor-retries 0` 不變
- [ ] 7.6 補齊階段沿用同一套退避（與第 5 組整合，不另寫一份）—— 待第 5 組實作時一併完成
- [x] 7.7 退避的累計等待受 `PARSE_TIMEOUT_MS` 約束，不得使等待無限延長
- [x] 7.8 呈現層改寫訊息；`reportError` 寫入日誌的仍為原始訊息全文
- [x] 7.9 Android 端 `YoutubeDlPlugin` 的解析路徑套用同一退避
- [ ] 7.10 實測：以連續請求觸發 TikTok 或 Bilibili 的限流，確認會退避重試、最終訊息為友善版本、日誌留有原文

## 8. 建置與驗證

- [ ] 8.1 `npm run build`、`npx vue-tsc --noEmit`、`npm test`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過
- [ ] 8.2 `openspec validate source-profile-registry --strict` 通過
- [ ] 8.3 Windows：貼上 Bilibili 空間頁，確認 2 秒內出現對話框，標題隨後陸續補上
- [ ] 8.4 Windows：補齊進行中關閉對話框，確認背景行程已終止
- [ ] 8.5 Windows：補齊進行中即勾選並開始下載，確認下載正常且檔名正確
- [ ] 8.6 Windows：貼上抖音使用者頁，確認得到「目前無法解析」的明確訊息
- [ ] 8.7 Android 實機：Bilibili 空間頁完整流程
- [ ] 8.8 Android 實機：既有的 YouTube 與 TikTok 流程未回歸

## 9. 收尾

- [ ] 9.1 將實測所推翻或修正的設計假設回填 design.md（特別是 6.2 與 6.5 的結果）
- [ ] 9.2 若實測顯示各來源的限流特性差異大，將塊大小與節流間隔移入 `SourceProfile` 並記於 design

## 10. 實作進度說明（第 7 組先行）

- [x] 10.1 第 7 組（限流）先於其餘組別實作。理由：使用者於 Android v1.0.71
      實機撞到 TikTok 429，是當下正在痛的問題；且此組主要是新增
      `rateLimit.ts` 並在 `runParseCommand` 外層加一層退避，與
      `fix-playlist-parse-hang` 待驗的程式碼糾纏最少。
- [x] 10.2 第 2～6 組**尚未開始**。那些會大幅改寫 `App.vue` 的新增流程與
      `DownloadService.parsePlaylist`，正是 `fix-playlist-parse-hang` 仍待
      實機驗證的區域；若驗證發現問題需要修改，重構會擋路。待其驗證完成
      並歸檔後再動。
- [x] 10.3 第 7 組的實作細節：
      - 維持 `--extractor-retries 0` 不變，改由我們這一層辨識限流後重跑
        整個呼叫。兩種失敗各走各的路徑，不需在 yt-dlp 旗標裡表達細緻分類。
      - 退避可被取消打斷（`sleepUnlessCancelled` 每 200ms 檢查一次），
        不會讓使用者按了取消還空等 8 秒。
      - 訊息改寫只在呈現層（`reportError`），寫入錯誤紀錄的仍是原文。
      - Android 端以 `executeParseWithBackoff` 對稱實作，主解析與子清單
        展開兩處皆已接上。
