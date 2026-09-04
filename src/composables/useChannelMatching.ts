/**
 * 頻道新片比對的核心規則。
 *
 * 這些規則是整個自動追蹤功能的判斷依據，且錯一步就會造成使用者可感知的
 * 故障（一加入頻道就被灌入整頁舊片、或永久漏抓新片）。原本揉在
 * `App.vue` 的 `checkAllMonitoredChannels` 裡與網路取用、Toast 混雜，
 * 沒有任何測試保護。
 *
 * 本模組刻意只有無狀態純函式 —— 不提供 `createXxx()` 工廠（沒有需要
 * 持有的狀態），也不依賴 `useTaskStore`（任務 id 由呼叫端傳入）。
 * 網路呼叫（`fetchYouTubeRss`、`checkVideoLiveStatus`）留在 `App.vue`
 * 的迴圈中，不進入本模組。
 */

import { formatPublishTime, buildTaskDisplayTitle } from '../services/displayFormat';
import type { DownloadTask, TaskItem } from './useTaskStore';

/** 追蹤中的頻道。與 `App.vue` 的 `MonitoredChannel` 同構。 */
export interface MonitoredChannelLike {
  channelId: string;
  title: string;
  lastPublishedTime?: number;
  lastCheckTime?: number;
  lastKnownVideoId?: string;
  lastVideoTitle?: string;
}

/** 自 RSS 或 yt-dlp 備援取得的影片。與 `MonitoredVideoResult` 同構。 */
export interface MatchableVideo {
  videoId: string;
  title: string;
  /** `0` 表示來源未提供精確發布時間 —— 不得以當下時間替代 */
  publishedTime: number;
  url: string;
  source: 'rss' | 'fallback';
}

/**
 * 是否為首次追蹤。
 *
 * 判定沿用既有的向下相容鏈 `lastPublishedTime || lastCheckTime || 0`：
 * 兩者皆無值才算首次。此鏈也正是錨點污染會「復活」的途徑 ——
 * 若某次以當下時間寫入 `lastCheckTime`，即使 `lastPublishedTime` 未被
 * 污染，基準仍會被推到未來。故 `nextChannelBaseline` 不推進時，
 * 呼叫端亦不得單獨更新 `lastCheckTime`。
 */
export function isFirstTimeTracking(channel: MonitoredChannelLike): boolean {
  return channelBaseline(channel) === 0;
}

/** 取得頻道目前的時間錨點。 */
export function channelBaseline(channel: MonitoredChannelLike): number {
  return channel.lastPublishedTime || channel.lastCheckTime || 0;
}

/**
 * 影片是否已在任務樹中。
 *
 * 需走訪三層：頂層扁平任務，以及頻道群組 → 播放清單 → 子任務。
 *
 * 比對方式為 `url.includes(videoId)` 的子字串比對。理論上 `videoId`
 * 若為另一支影片 ID 的子字串會誤判，但 YouTube 的 videoId 固定 11 字元
 * 且字元集固定，實際碰撞機率極低。**此處刻意維持原樣、不改為自 URL
 * 解析出 videoId 再精確比對** —— 那屬行為變更（會影響佇列中以其他形式
 * 儲存 URL 的既有任務），應另案評估。此註解用以避免日後誤認為疏漏。
 */
export function isVideoAlreadyQueued(tasks: TaskItem[], videoId: string): boolean {
  if (!videoId) return false;
  return (tasks || []).some((t: any) => {
    if (t.url && typeof t.url === 'string' && t.url.includes(videoId)) return true;
    if (t.playlists && Array.isArray(t.playlists)) {
      return t.playlists.some((pl: any) =>
        pl.subTasks && Array.isArray(pl.subTasks) &&
        pl.subTasks.some((st: any) => st.url && st.url.includes(videoId))
      );
    }
    return false;
  });
}

/**
 * 篩選出應下載的新影片：發布時間晚於錨點，且尚未在佇列中。
 *
 * 回傳順序與輸入一致（由新至舊）。呼叫端若要依由舊至新的順序建立任務，
 * 需自行反轉 —— 既有流程以 `newVideos.reverse()` 達成，使較舊的影片先
 * 進入佇列、較新者最後 `unshift` 而位於最前。
 */
export function selectNewVideos(
  videos: MatchableVideo[],
  baseline: number,
  tasks: TaskItem[]
): MatchableVideo[] {
  return (videos || []).filter(
    v => v.publishedTime > baseline && !isVideoAlreadyQueued(tasks, v.videoId)
  );
}

/** 錨點推進的結果。`null` 表示本次不推進。 */
export interface ChannelAnchor {
  publishedTime: number;
  videoId: string;
  title: string;
}

/**
 * 計算頻道時間錨點的下一個值。回傳 `null` 表示不應推進。
 *
 * 兩道獨立的守門條件：
 *
 * 1. **必須取得精確發布時間**。備援模式下 `publishedTime` 可能為 `0`；
 *    以當下時間替代會把基準推到未來，使該時點之前發布的影片永久漏抓。
 *
 * 2. **不得越過本次未被實際處理的影片**（因直播而跳過，或直播狀態查詢
 *    失敗而無從判定者）。排程直播的 `publishedTime` 是「建立時間」，
 *    在直播結束轉為存檔後並不會改變 —— 錨點一旦推過它，該片即使日後
 *    可正常下載也永遠不會再被判定為新片。
 *
 * 因此取「已處理影片中發布時間最大者」，而非逕取 `videos[0]`。
 *
 * @param unhandledVideoIds 本次未被實際處理的影片 ID。首次追蹤時傳入
 *   空集合 —— 該情境本就不下載任何既有內容，不套用第二道守門。
 */
export function nextChannelBaseline(
  videos: MatchableVideo[],
  currentBaseline: number,
  unhandledVideoIds: ReadonlySet<string> = new Set()
): ChannelAnchor | null {
  const anchor = (videos || [])
    .filter(v => v.publishedTime && !unhandledVideoIds.has(v.videoId))
    .reduce<MatchableVideo | null>(
      (best, v) => (!best || v.publishedTime > best.publishedTime ? v : best),
      null
    );

  if (!anchor || anchor.publishedTime <= currentBaseline) return null;

  return {
    publishedTime: anchor.publishedTime,
    videoId: anchor.videoId,
    title: anchor.title,
  };
}

/**
 * 由影片與頻道資訊建構下載任務。
 *
 * id 由呼叫端執行 `taskStore.nextTaskId()` 後傳入，使本模組不依賴
 * `useTaskStore` —— 兩者應是同層的獨立模組。
 */
export function buildChannelVideoTask(
  video: MatchableVideo,
  channel: MonitoredChannelLike,
  nextId: number
): DownloadTask {
  // 無精確發布時間時退回當下時間，僅用於「顯示」。
  // 這與錨點推進的規則不同 —— 錨點寧可不推進也不得用當下時間替代。
  const pubTimeStr = formatPublishTime(video.publishedTime) || formatPublishTime(Date.now());

  return {
    id: nextId,
    type: 'file',
    isGroup: false,
    url: video.url,
    title: buildTaskDisplayTitle(video.title, channel.title, pubTimeStr),
    rawTitle: video.title,
    publishTimeStr: pubTimeStr,
    channelPrefix: channel.title,
    status: 'pending',
    progress: 0,
    eta: '',
    line: video.source === 'fallback'
      ? '【自動追蹤 (yt-dlp 備援)】排隊優先下載中...'
      : '【自動追蹤 (RSS)】排隊優先下載中...',
    path: '',
    errorMsg: '',
    mediaUri: '',
    isAudio: false,
    subFolder: channel.title ? channel.title.replace(/[\/\\:*?"<>|]/g, '_') : '',
  } as DownloadTask;
}
