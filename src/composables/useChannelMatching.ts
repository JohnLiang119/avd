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

import * as OpenCC from 'opencc-js';
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
  /**
   * 標題關鍵字篩選。未設定、`undefined` 或非陣列皆等同「無篩選」（全量追蹤）。
   * 一律經 `normalizeChannelKeywords` 正規化後才寫入。
   */
  keywords?: string[];
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

/** 每個頻道的關鍵字數量上限。 */
export const KEYWORD_MAX_COUNT = 20;

/** 單一關鍵字的長度上限（以 Unicode 碼位計，非 UTF-16 單元）。 */
export const KEYWORD_MAX_LENGTH = 100;

/**
 * yt-dlp 備援每輪取回的影片數上限。
 *
 * 對應 `src-tauri` 以 `--playlist-end 2` 限制的解析數量。官方 RSS 每輪
 * 約 15 筆，不套用此上限。
 */
export const FALLBACK_ROUND_LIMIT = 2;

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
 * 三道獨立的守門條件：
 *
 * 1. **必須取得精確發布時間**。備援模式下 `publishedTime` 可能為 `0`；
 *    以當下時間替代會把基準推到未來，使該時點之前發布的影片永久漏抓。
 *
 * 2. **不得越過任何未處理影片**（因直播而跳過，或直播狀態查詢失敗而無從
 *    判定者）。排程直播的 `publishedTime` 是「建立時間」，在直播結束轉為
 *    存檔後並不會改變 —— 錨點一旦推過它，該片即使日後可正常下載也永遠
 *    不會再被判定為新片。
 *
 *    此處刻意是**上限**而非「把未處理影片排除在候選之外」：後者只在
 *    「未處理影片恰為最新」時等價。一旦引入關鍵字篩選，「較新的未命中
 *    影片」會大量出現，排除式作法會把錨點推到那支未命中影片、連帶越過
 *    較舊的未處理直播影片，使直播守門靜默失效。
 *
 *    未命中關鍵字的影片**不屬於**未處理影片 —— 那是使用者明確要求永久
 *    略過的項目，錨點必須能越過，否則每輪都會重新比對整個 Feed。
 *
 * 3. **不得越過本輪未取回的較舊影片**。當本輪影片全數來自 yt-dlp 備援
 *    且筆數已達每輪上限（`--playlist-end 2`），代表可能還有更舊的影片
 *    未被取回也未經比對，錨點至多推進至本輪最舊影片的發布時間。
 *
 * @param unhandledVideoIds 本次未被實際處理的影片 ID。首次追蹤時傳入
 *   空集合 —— 該情境本就不下載任何既有內容，不套用第二道守門。
 */
export function nextChannelBaseline(
  videos: MatchableVideo[],
  currentBaseline: number,
  unhandledVideoIds: ReadonlySet<string> = new Set()
): ChannelAnchor | null {
  const list = videos || [];
  const timed = list.filter(v => v.publishedTime);

  // 守門 2：未處理影片的最早發布時間為上限（嚴格小於，不得等於或越過）。
  // 只有帶精確時間的未處理影片能構成上限 —— 無精確時間者無從定位。
  const unhandledTimes = timed
    .filter(v => unhandledVideoIds.has(v.videoId))
    .map(v => v.publishedTime);
  const exclusiveCap = unhandledTimes.length ? Math.min(...unhandledTimes) : Infinity;

  // 守門 3：候選視窗達上限時，錨點至多等於本輪最舊影片的發布時間。
  const windowCapped =
    timed.length >= FALLBACK_ROUND_LIMIT && list.every(v => v.source === 'fallback');
  const inclusiveCap = windowCapped ? Math.min(...timed.map(v => v.publishedTime)) : Infinity;

  const anchor = timed
    .filter(v =>
      !unhandledVideoIds.has(v.videoId) &&
      v.publishedTime < exclusiveCap &&
      v.publishedTime <= inclusiveCap
    )
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

// ============================================================================
// 頻道標題關鍵字篩選
// ============================================================================

/**
 * 比對用的字形正規化管線：NFKC → 折算到簡體字形域 → 轉小寫。
 *
 * **兩側（關鍵字與影片標題）必須各自經過同一管線**，否則結果不穩定：
 * 影片標題在入庫前已被整串啟發式的簡繁轉換改寫（標題只要含任一繁體
 * 專屬字就整串保持原狀，否則整串簡轉繁），同一個詞在不同標題中會以
 * 不同字形入庫 —— 使用者設「學習」時一支命中、另一支漏抓，設「学习」
 * 則完全相反，而使用者無從理解原因。
 *
 * 轉換器刻意在本模組自行建立，**不從 `DownloadService.ts` 匯入** ——
 * 該檔帶 Tauri 執行期相依，匯入會使本模組無法在單元測試中載入。
 * 設定沿用該檔的 `{ from: 't', to: 'cn' }`（標準繁體轉簡體），避開
 * 台灣標準對「么」的強制校正。
 */
const _toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });

/**
 * 零寬字元。`String.prototype.trim()` **不會**移除這些字元，若不另行
 * 處理，使用者貼上帶零寬字元的字串會產生一個永不命中的關鍵字。
 * 全形空白 U+3000 屬 Unicode 空白，`trim()` 已涵蓋。
 */
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

/** 去除零寬字元與前後空白，作為關鍵字的顯示文字。 */
function cleanKeywordText(raw: string): string {
  return raw.replace(ZERO_WIDTH_RE, '').trim();
}

/** 將文字折算為比對用的正規化形式。關鍵字與影片標題共用。 */
export function normalizeForMatching(text: string): string {
  if (!text) return '';
  return _toSimplified(text.normalize('NFKC')).toLowerCase();
}

/** 關鍵字正規化的結果。`rejections` 為可直接顯示於 UI 的拒絕原因。 */
export interface KeywordNormalizeResult {
  keywords: string[];
  rejections: string[];
}

/**
 * 正規化一組關鍵字輸入。
 *
 * 規則：限字串 → 去零寬字元與前後空白 → 移除空項 → 依**正規化值**去除
 * 重複，保留第一個對應項目的**原始大小寫**作為顯示文字 → 套用數量與
 * 長度上限。
 *
 * 超出上限一律**拒絕並回報原因**，MUST NOT 靜默截斷 —— 使用者若不知道
 * 輸入被丟棄，會以為關鍵字已生效而困惑於漏抓。
 *
 * 非字串、`undefined` 與非陣列輸入皆得到空清單（既有訂閱與舊版備份
 * 缺少該欄位時即走此路徑，等同「無篩選」的全量追蹤）。
 */
export function normalizeChannelKeywords(input: unknown): KeywordNormalizeResult {
  const keywords: string[] = [];
  const rejections: string[] = [];
  if (!Array.isArray(input)) return { keywords, rejections };

  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const text = cleanKeywordText(raw);
    if (!text) continue;

    if ([...text].length > KEYWORD_MAX_LENGTH) {
      rejections.push(`關鍵字「${text.slice(0, 12)}…」超過 ${KEYWORD_MAX_LENGTH} 字元上限，未加入`);
      continue;
    }

    const key = normalizeForMatching(text);
    if (seen.has(key)) continue;

    if (keywords.length >= KEYWORD_MAX_COUNT) {
      rejections.push(`關鍵字「${text}」超過每個頻道 ${KEYWORD_MAX_COUNT} 個的上限，未加入`);
      continue;
    }

    seen.add(key);
    keywords.push(text);
  }

  return { keywords, rejections };
}

/**
 * 取得頻道目前生效的關鍵字清單。
 *
 * 供反序列化與各檢查入口共用 —— 缺少欄位、`undefined` 或非陣列一律
 * 得到 `[]`，呼叫端不必反覆處理這些形態。
 */
export function channelKeywords(channel: MonitoredChannelLike): string[] {
  return normalizeChannelKeywords(channel?.keywords).keywords;
}

/**
 * 影片標題是否命中關鍵字清單（OR，任一命中即可）。
 *
 * 空清單一律視為命中 —— 未設定關鍵字的頻道維持既有全量追蹤行為。
 */
export function matchesChannelKeywords(title: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const target = normalizeForMatching(title || '');
  return keywords.some(k => {
    const needle = normalizeForMatching(k);
    return !!needle && target.includes(needle);
  });
}

/** 依關鍵字把影片分為命中與未命中兩組。順序皆與輸入一致。 */
export interface KeywordPartition<T> {
  matched: T[];
  missed: T[];
}

/**
 * 分割命中與未命中的影片。
 *
 * 這是「未命中影片不得觸發直播狀態查詢」在純函式層的可測試部分：
 * 呼叫端只走 `matched`，`missed` 既不查詢直播狀態也不建立任務，且
 * 不列入未處理影片（錨點得以越過）。
 */
export function partitionByKeywords<T extends { title: string }>(
  videos: T[],
  keywords: string[]
): KeywordPartition<T> {
  const matched: T[] = [];
  const missed: T[] = [];
  for (const v of videos || []) {
    (matchesChannelKeywords(v.title, keywords) ? matched : missed).push(v);
  }
  return { matched, missed };
}

// ============================================================================
// 檢查結果回饋
// ============================================================================

/**
 * 一輪檢查中，各計數的定義（三者互斥，同一支影片不重複計入）：
 *
 * - **N**：實際建立下載任務的影片數。
 * - **K**：符合既有新片條件（發布時間晚於錨點且不在佇列中）、但未命中
 *   該頻道任一有效關鍵字而未建立任務的影片數。
 * - **M**：抓取失敗的啟用頻道數。
 *
 * 命中關鍵字但因直播／首播／狀態未知或佇列去重而未建立任務者，
 * **N 與 K 皆不計入** —— 其回饋沿用既有的成功／失敗分支。
 *
 * 以下沿用 `services/rateLimit.ts` 的慣例：純函式只產生**訊息片段**，
 * 由 `App.vue` 與既有的來源標記、失敗分級、降級提示等片段組裝成 Toast。
 * 刻意不在此處產生整則訊息 —— 那會把既有分支中的來源標記與失敗說明洗掉。
 */

/**
 * 本輪沒有任何影片建立任務、但有 K 部被關鍵字篩除時的主文案。
 *
 * 用來**取代**「目前沒有新影片」：`channel-check-feedback` 這個能力
 * 當初就是為了避免假陽性的「沒有新影片」誤導，而「抓到 12 支新片但
 * 全部不命中」正是同一類誤導。
 */
export function describeKeywordFilteredRound(filteredCount: number): string {
  return `已檢查完成：本輪有 ${filteredCount} 部新影片，但都不符合關鍵字設定，未加入佇列`;
}

/**
 * 已建立任務（N 大於零）且另有 K 部被篩除時，附加於主文案後的補充片段。
 * K 為零時回傳空字串，使既有訊息完全不變。
 */
export function describeKeywordFilteredSuffix(filteredCount: number): string {
  return filteredCount > 0 ? `（另有 ${filteredCount} 部新影片不符合關鍵字設定）` : '';
}

/**
 * 單一頻道檢查或模擬新片測試時，本輪影片全部未命中關鍵字的專用提示。
 *
 * 與 `describeCheckOutcome` 分開：單頻道情境沒有 M，且措辭需點名頻道，
 * 不得退回「目前沒有新影片」或抓取失敗類訊息。
 */
export function describeChannelKeywordMiss(channelTitle: string, missedCount: number): string {
  const name = channelTitle || '該頻道';
  return `「${name}」本輪有 ${missedCount} 部影片，但都不符合關鍵字設定，未加入佇列`;
}

// ============================================================================
// 備份還原
// ============================================================================

/**
 * 還原頻道清單時的時間錨點保守選擇：兩方皆有值時取**較舊**者。
 *
 * 關鍵字改變了錨點的語意 —— 本 change 之後，錨點推進不再只代表
 * 「已下載」，也代表「已略過（未命中）」。A 裝置設了關鍵字、快速把錨點
 * 推到最新，備份還原到未設關鍵字的 B 裝置時，若直接採用較新的錨點，
 * B 裝置會永久漏掉那批影片 —— 而使用者的預期恰好相反。
 *
 * 任一方缺值時採用另一方；兩方皆無則回傳 `undefined`，維持未初始化
 * 狀態，MUST NOT 以當下時間建立錨點。
 */
export function conservativeAnchor(
  localTime?: number,
  backupTime?: number
): number | undefined {
  const local = localTime || 0;
  const backup = backupTime || 0;
  if (local && backup) return Math.min(local, backup);
  return local || backup || undefined;
}
