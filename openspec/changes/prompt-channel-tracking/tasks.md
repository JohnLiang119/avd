## 1. URL Validation

- [x] 1.1 在 `App.vue` 的 `addTask` 方法開頭，加入 `isStrictChannelUrl` 判斷邏輯，過濾出純頻道網址（排除 `/watch` 與 `/playlist`）。

## 2. Channel Tracking Check & UI Prompt

- [x] 2.1 若判定為頻道網址，呼叫 `DownloadService.resolveYouTubeChannel` 解析出 `channelId` 與 `title`。
- [x] 2.2 檢查 `monitoredChannels` 中是否已存在該 `channelId`。
- [x] 2.3 若不存在，使用 `showConfirmDialog` 顯示「發現新頻道...是否要一併加入追蹤清單？」的提示對話框。

## 3. Action Handling

- [x] 3.1 處理 Confirm (加入並下載) 行為：將頻道資訊建立為 `MonitoredChannel` 物件並寫入 `monitoredChannels`，同時儲存至 localStorage，隨後繼續原本的 `parsePlaylist` 下載流程。
- [x] 3.2 處理 Cancel (僅下載) 行為：不更動 `monitoredChannels`，直接繼續原本的 `parsePlaylist` 下載流程。
