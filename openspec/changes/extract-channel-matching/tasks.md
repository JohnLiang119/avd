## 1. 前置確認

- [ ] 1.1 確認 `channel-track-by-publish-time` 已完成並歸檔（`openspec list` 中不再列出），特別是任務 6.7 已修正 `App.vue` 的錨點污染點
- [ ] 1.2 讀取歸檔後的 `openspec/specs/channel-auto-monitor/spec.md`，以其中的錨點推進規則作為本次測試的依據（而非以當下程式碼為準）
- [ ] 1.3 確認 `npm test` 與 `npm run build` 於現況下皆通過，作為重構前的基準

## 2. 抽出純函式

- [ ] 2.1 建立 `src/composables/useChannelMatching.ts`，採無狀態純函式模組形式（不提供工廠函式）
- [ ] 2.2 實作 `isFirstTimeTracking(channel)`：`lastPublishedTime` 與 `lastCheckTime` 皆無值時為首次追蹤
- [ ] 2.3 實作 `isVideoAlreadyQueued(tasks, videoId)`：走訪扁平任務與頻道群組 → 播放清單 → 子任務三層，沿用既有的 `url.includes(videoId)` 比對方式（不改為精確比對，理由見 design 決策 2，並於程式碼註解說明避免誤認為疏漏）
- [ ] 2.4 實作 `selectNewVideos(videos, baseline, tasks)`：篩選發布時間晚於錨點且未在佇列中的影片
- [ ] 2.5 實作 `nextChannelBaseline(current, latestVideo)`：回傳應採用的錨點值；無精確發布時間時回傳原值
- [ ] 2.6 實作 `buildChannelVideoTask(video, channel, nextId)`：建構下載任務，涵蓋標題組裝、發布時間字串、來源標記（RSS / yt-dlp 備援）、子資料夾名稱字元清洗
- [ ] 2.7 逐一比對每個抽出函式與原始程式碼的邏輯等價性，特別確認 `newVideos.reverse()` 的順序語意與 `formatPublishTime` 的 fallback 未失真

## 3. App.vue 接線

- [ ] 3.1 `checkAllMonitoredChannels` 改為呼叫抽出的純函式，保留迴圈編排、錯誤計數與 Toast
- [ ] 3.2 確認 `DownloadService.fetchYouTubeRss` 與 `checkVideoLiveStatus` 兩處網路呼叫仍留在 `App.vue` 的迴圈中，未被誤搬入純函式模組
- [ ] 3.3 任務 id 由呼叫端執行 `taskStore.nextTaskId()` 後傳入，`useChannelMatching` 不依賴 `useTaskStore`
- [ ] 3.4 確認 `vue-tsc` 型別檢查與 `npm run build` 皆通過

## 4. 單元測試

- [ ] 4.1 測試首次追蹤：無錨點時判定為首次，且該情境下不應產生任何任務
- [ ] 4.2 測試錨點初始化：首次追蹤後錨點被設為最新影片的發布時間
- [ ] 4.3 測試去重（扁平）：佇列中已有相同影片 ID 的扁平任務時不重複建立
- [ ] 4.4 測試去重（巢狀）：影片已存在於頻道群組底下的播放清單子任務中時不重複建立
- [ ] 4.5 測試新片篩選：僅回傳發布時間晚於錨點且未在佇列中的影片
- [ ] 4.6 測試錨點推進：有精確發布時間時錨點更新為該時間
- [ ] 4.7 測試錨點保留：無精確發布時間時錨點維持原值，不被推進至當下時間
- [ ] 4.8 測試任務建構：標題含頻道前綴與發布時間、來源標記正確區分 RSS 與備援、子資料夾名稱已移除檔案系統不接受的字元

## 5. 驗證與收尾

- [ ] 5.1 手動驗證自動追蹤完整流程：新增一個頻道 → 首次檢查只初始化不下載 → 待有新片後檢查應正確插隊下載
- [ ] 5.2 手動驗證去重：對同一頻道連續執行兩次手動檢查，第二次不應重複建立任務
- [ ] 5.3 確認 `npm test` 全數通過、`npm run build` 成功
- [ ] 5.4 記錄收尾數據：`App.vue` 行數變化、新增的測試數量、`useChannelMatching.ts` 行數，並明確標示本次未涵蓋的範圍（佇列引擎狀態機與其餘 6 個領域）
