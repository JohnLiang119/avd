## Context

目前系統允許在主畫面網址列輸入單一影片、播放清單或頻道網址。當輸入頻道網址時，會觸發 `addTask` 下的 `parsePlaylist` 邏輯並直接加入下載佇列。使用者先前確認：僅在輸入「頻道網址」（而非單一影片或播放清單）時，才觸發「是否加入追蹤清單」的提示。

## Goals / Non-Goals

**Goals:**
- 精準判斷使用者輸入的是「頻道網址」而非其他類型。
- 透過 UI 彈跳視窗引導使用者將未追蹤的頻道加入清單。
- 整合現有 `addManualChannel` 的核心邏輯或直接利用 `monitoredChannels` 的存取機制。

**Non-Goals:**
- 不改變原本單一影片、播放清單的下載流程。
- 不改變 `monitoredChannels` 的底層背景執行機制。

## Decisions

### 1. 判定頻道網址的條件
**Rationale:** 必須排除 `/watch` (單一影片) 以及 `/playlist` (播放清單)，僅針對真正的頻道首頁或 Handle。
**Approach:** 在 `addTask` 的開頭，使用簡單的字串比對：
```typescript
const isStrictChannelUrl = 
  (urlToAdd.includes('/channel/') || urlToAdd.includes('/c/') || urlToAdd.includes('youtube.com/@')) 
  && !urlToAdd.includes('/watch') 
  && !urlToAdd.includes('/playlist');
```

### 2. 攔截時機與詢問邏輯
**Rationale:** 在 `addTask` 中，當判定為 `isStrictChannelUrl` 時，先解析頻道基本資訊 (取得 `channelId`) 以便與 `monitoredChannels` 比對。若發現尚未追蹤，則使用 Vant 的 `showConfirmDialog`。
**Alternatives:** 
- 可以先呼叫 `DownloadService.resolveYouTubeChannel(urlToAdd)` 來取得 `channelId` 與 `title`。如果已追蹤，直接走原本的 `parsePlaylist` 流程下載。
- 如果未追蹤，跳出對話框：
  - **Confirm (加入並下載):** 將頻道資訊 push 進 `monitoredChannels.value` 並儲存至 localStorage，然後繼續 `parsePlaylist` 下載。
  - **Cancel (僅下載):** 直接繼續 `parsePlaylist` 下載流程。

## Risks / Trade-offs

- [Risk] 對話框可能會打斷習慣快速連貼網址的使用者流程。
  → Mitigation: 僅在「未追蹤」時跳出，一旦加入後就不再跳出，對重度使用者的干擾有限。
- [Risk] 解析頻道 ID 可能會因為網路延遲造成一點等待。
  → Mitigation: 在發送檢查前可以顯示 Loading 提示，或與原先的 `parsePlaylist` 合併優化 (若 `parsePlaylist` 有回傳完整的 `channelId`)。
