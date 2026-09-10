/**
 * YouTube Data API v3 通道的純函式層。
 *
 * 本模組刻意**不匯入任何 `@tauri-apps/*`**，也不自行發出網路請求 ——
 * 需要網路的函式一律以參數注入 `fetchJson`。這使整層邏輯（請求建構、
 * 回應解析、狀態映射、錯誤分類、抑制時點、通道選擇）都能在 vitest 中
 * 直接測試，沿用 `DownloadService.spec.ts` 對 `fetchChannelRssWithRetry`
 * 注入 `request`／`sleep` 的既有模式。
 *
 * 型別以 `import type` 引入，編譯後完全抹除，不產生執行期相依。
 */

import type { LiveCheckResult, MonitoredVideoResult } from './DownloadService';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * API 通道每輪取回的影片數上限，作為 `maxResults` 送出。
 *
 * 取 50（API 單頁上限）而非更小值，是因為視窗越寬、越可能回溯到頻道
 * 目前的時間錨點之前 —— 錨點守門正是以「本輪最舊影片是否已早於錨點」
 * 判定是否需要限制推進，視窗寬則不需限制、錨點可正常推進至最新者。
 */
export const API_ROUND_LIMIT = 50;

/** 單次 `videos.list` 批次可涵蓋的影片數上限（API 規格所限）。 */
export const LIVE_STATUS_BATCH_SIZE = 50;

/** 一個待發出的 API 請求。金鑰只在 `headers`，永不進入 `url`。 */
export interface ApiRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * 建構帶金鑰的請求。
 *
 * 金鑰經 `X-goog-api-key` **標頭**傳送而非 `?key=` query 參數 ——
 * 錯誤訊息路徑會把網址寫進 `avd_error_log`，而錯誤日誌設計上就是要讓
 * 使用者複製出來求助；金鑰若在網址中，貼出日誌即等同公開該金鑰。
 * 放標頭是結構性防護，不倚賴任何遮蔽邏輯是否周全。
 */
function buildRequest(path: string, params: Record<string, string>, apiKey: string): ApiRequest {
  const query = new URLSearchParams(params).toString();
  return {
    url: `${API_BASE}/${path}?${query}`,
    headers: { 'X-goog-api-key': apiKey },
  };
}

/** 取得某 uploads 播放清單最新一頁影片的請求。 */
export function buildPlaylistItemsRequest(playlistId: string, apiKey: string): ApiRequest {
  return buildRequest('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: String(API_ROUND_LIMIT),
  }, apiKey);
}

/** 批次查詢多支影片直播狀態的請求。 */
export function buildVideosRequest(videoIds: string[], apiKey: string): ApiRequest {
  return buildRequest('videos', {
    part: 'snippet,liveStreamingDetails',
    id: videoIds.join(','),
  }, apiKey);
}

/** 查詢頻道的 uploads 播放清單識別碼（前綴推導失敗時的後備）。 */
export function buildChannelUploadsRequest(channelId: string, apiKey: string): ApiRequest {
  return buildRequest('channels', {
    part: 'contentDetails',
    id: channelId,
  }, apiKey);
}

/**
 * 由頻道識別碼推導 uploads 播放清單識別碼（`UC...` → `UU...`）。
 *
 * 這是長期成立的**慣例而非文件保證**，故回傳 `null` 時呼叫端 MUST 改以
 * `channels.list` 查詢，不得逕判該頻道無效。推導本身不花配額。
 */
export function uploadsPlaylistIdFor(channelId: string): string | null {
  if (typeof channelId !== 'string' || !channelId.startsWith('UC') || channelId.length < 3) {
    return null;
  }
  return `UU${channelId.slice(2)}`;
}

/** 自 `channels.list` 回應取出 uploads 播放清單識別碼。 */
export function parseUploadsPlaylistId(json: any): string | null {
  const items = json?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const id = items[0]?.contentDetails?.relatedPlaylists?.uploads;
  return typeof id === 'string' && id ? id : null;
}

/**
 * 解析 `playlistItems` 回應為共用的影片結構。
 *
 * 缺少可解析發布時間者，`publishedTime` 為 `0` —— **不得**以當下時間替代，
 * 那會把頻道錨點推向未來而造成永久漏片。缺影片識別碼者直接略過。
 */
export function parsePlaylistItems(json: any): MonitoredVideoResult[] {
  const items = json?.items;
  if (!Array.isArray(items)) return [];

  const out: MonitoredVideoResult[] = [];
  for (const item of items) {
    const videoId = item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || '';
    if (!videoId || typeof videoId !== 'string') continue;

    const published = item?.contentDetails?.videoPublishedAt || item?.snippet?.publishedAt || '';
    const parsed = published ? Date.parse(published) : NaN;

    out.push({
      videoId,
      title: item?.snippet?.title || '',
      published: typeof published === 'string' ? published : '',
      publishedTime: Number.isFinite(parsed) ? parsed : 0,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      source: 'api',
    });
  }
  return out;
}

/** 把影片識別碼切成符合單批上限的多批。 */
export function chunkVideoIds(ids: string[], size: number = LIVE_STATUS_BATCH_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < (ids || []).length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

/**
 * 把 API 的直播欄位映射為既有的三態，語意與 yt-dlp 的 `live_status` 等價。
 *
 * `liveBroadcastContent` 為 `live`（進行中）或 `upcoming`（排程未開播）時，
 * 影片當下不存在可下載的格式，一律視為 `'live'` —— 與 yt-dlp 的
 * `is_live` / `is_upcoming` 對應。已結束並轉為存檔的直播其
 * `liveBroadcastContent` 為 `none`，屬 `'not_live'`，可正常下載。
 *
 * 缺少可辨識欄位時回傳 `'unknown'`，MUST NOT 樂觀視為 `'not_live'` ——
 * 錯放一支未開播的直播進佇列，下載必然失敗。
 */
export function mapLiveStatus(item: any): LiveCheckResult {
  const broadcast = item?.snippet?.liveBroadcastContent;
  if (typeof broadcast !== 'string' || !broadcast) return 'unknown';

  const normalized = broadcast.toLowerCase();
  if (normalized === 'live' || normalized === 'upcoming') return 'live';
  if (normalized === 'none') return 'not_live';
  return 'unknown';
}

/**
 * 批次解析一組影片的直播狀態。
 *
 * 保守處置是本函式的重點：回應**未涵蓋**的影片（已刪除、設為私人，或回應
 * 僅含部分項目）逐支為 `'unknown'`；整批請求失敗時該批全部為 `'unknown'`。
 * MUST NOT 因單次請求失敗而讓多支影片被當作 `'not_live'` 放行入佇列。
 *
 * @param fetchJson 注入的請求執行函式，使本模組不依賴任何平台通道。
 */
export async function resolveLiveStatusesViaApi(
  videoIds: string[],
  apiKey: string,
  fetchJson: (request: ApiRequest) => Promise<any>,
  onBatchError?: (error: unknown) => void
): Promise<Map<string, LiveCheckResult>> {
  const result = new Map<string, LiveCheckResult>();
  const ids = (videoIds || []).filter(Boolean);
  // 先全部預設為 unknown，回應涵蓋到的才覆寫 —— 未涵蓋者自然保持保守值
  for (const id of ids) result.set(id, 'unknown');

  for (const batch of chunkVideoIds(ids)) {
    let json: any;
    try {
      json = await fetchJson(buildVideosRequest(batch, apiKey));
    } catch (e) {
      // 整批失敗：該批全部維持 unknown，繼續處理其餘批次。
      //
      // 但錯誤本身 MUST 上報 —— 若在此靜默吞掉，配額耗盡與金鑰無效
      // 就永遠不會觸發抑制，每輪都會對每個批次重打一次必然失敗的請求。
      // 呼叫端據此決定抑制，並可改以逐支查詢完成本輪。
      onBatchError?.(e);
      continue;
    }
    const items = json?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const id = item?.id;
      if (typeof id === 'string' && result.has(id)) {
        result.set(id, mapLiveStatus(item));
      }
    }
  }

  return result;
}

/** API 錯誤的三種處置類別。 */
export type ApiErrorKind = 'quota' | 'key' | 'other';

/**
 * 分類 API 錯誤。
 *
 * `quota` 與 `key` 的處置完全不同：前者只需等待每日重置，後者需使用者
 * 修正設定。混為一談會讓使用者對著無法解決的提示乾等，或反之。
 */
export function classifyApiError(error: unknown): ApiErrorKind {
  const text = (() => {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    try { return JSON.stringify(error); } catch { return String(error); }
  })().toLowerCase();

  if (text.includes('quotaexceeded') || text.includes('dailylimitexceeded')) return 'quota';
  if (
    text.includes('api key not valid') ||
    text.includes('api_key_invalid') ||
    text.includes('keyinvalid') ||
    text.includes('accessnotconfigured') ||
    text.includes('forbidden: method doesn')
  ) return 'key';
  return 'other';
}

/** 取得某時間戳在太平洋時區的當地日期與時間欄位。 */
function pacificParts(timestamp: number): { day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(timestamp));

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
  // Intl 在 hour12:false 下可能把午夜表示為 24，統一折回 0
  const hour = get('hour') % 24;
  return { day: get('day'), hour, minute: get('minute'), second: get('second') };
}

/**
 * 計算配額抑制的解除時點：下一個太平洋時間午夜。
 *
 * YouTube 的每日配額於太平洋時間午夜重置。以 `Intl` 換算而不引入時區
 * 函式庫。日光節約時間使某些日子為 23 或 25 小時，單純加 24 小時會偏差
 * 一小時，故加完後依當地時針校正。
 *
 * **偏差時一律取較晚的時點**：抑制過長只是少用一段配額窗口，抑制過短則
 * 會恢復每輪對每個頻道白打一次必然失敗的請求 —— 後者代價明顯較高。
 */
export function nextQuotaResetTime(now: number): number {
  const here = pacificParts(now);
  const msIntoDay = ((here.hour * 60 + here.minute) * 60 + here.second) * 1000;
  const candidate = now - (now % 1000) + (86400000 - msIntoDay);

  const there = pacificParts(candidate);
  // 落在當地午夜之前（例如秋季 25 小時日）：補足到午夜
  if (there.hour >= 12) return candidate + (24 - there.hour) * 3600000;
  // 落在午夜之後（例如春季 23 小時日）：刻意不往回修，較晚才是安全方向
  return candidate;
}

/**
 * 金鑰指紋：供「金鑰是否被換過」的判定使用。
 *
 * **這不是安全雜湊**，也不需要是 —— 它唯一的用途是比對兩把金鑰是否相同，
 * 攻擊者取得指紋也無法還原金鑰或推進任何攻擊。採用 FNV-1a 是因為它同步、
 * 無相依、且對本用途足夠；改用 Web Crypto 會讓所有呼叫點被迫非同步。
 *
 * 回傳值 MUST NOT 包含金鑰的任何片段。
 */
export function apiKeyFingerprint(apiKey: string): string {
  const text = (apiKey || '').trim();
  if (!text) return '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 決定第一通道所需的狀態。 */
export interface ChannelSelectionState {
  apiKey: string;
  now: number;
  /** 配額耗盡的抑制解除時點；未抑制時為 undefined 或 0 */
  quotaSuppressedUntil?: number;
  /** 被 API 拒絕的金鑰指紋；與當前金鑰相符時抑制 */
  rejectedKeyFingerprint?: string;
}

/**
 * 決定本輪的第一通道。
 *
 * 回傳 `'rss'` 代表跳過 API 直接走既有的 RSS → yt-dlp 鏈。未設金鑰時
 * 一律 `'rss'`，且呼叫端 MUST NOT 因此顯示任何錯誤或提示 —— 那是完全
 * 正常的預設狀態。
 */
export function selectFirstChannel(state: ChannelSelectionState): 'api' | 'rss' {
  const key = (state.apiKey || '').trim();
  if (!key) return 'rss';

  // 配額抑制：時點未到之前一律不打 API；時點已過自動恢復，不需使用者操作
  if (state.quotaSuppressedUntil && state.now < state.quotaSuppressedUntil) return 'rss';

  // 金鑰無效抑制：綁定金鑰內容而非時間 —— 無效金鑰不會因時間而變有效，
  // 但「使用者換了金鑰」是明確可偵測的解除條件
  if (state.rejectedKeyFingerprint && state.rejectedKeyFingerprint === apiKeyFingerprint(key)) {
    return 'rss';
  }

  return 'api';
}

/**
 * 以 API 取得某頻道最新一頁影片。
 *
 * uploads 播放清單識別碼優先以前綴慣例推導（零配額）；該清單回報不存在時，
 * 才以 `channels.list` 查詢正確識別碼並重試一次（1 unit）——
 * 前綴是慣例而非文件保證，不得因推導失敗就逕判頻道無效。
 *
 * **不分頁**：每輪只需辨識新片，分頁會使配額消耗隨頻道歷史長度成長。
 * 回應中的 `nextPageToken` 刻意忽略。
 *
 * @param resolvedPlaylistId 已知的 uploads 播放清單識別碼（來自先前查詢的快取）；
 *   有值時直接使用，省去推導與後備查詢。
 * @param fetchJson 注入的請求執行函式，使本模組不依賴任何平台通道。
 * @returns 影片清單，以及本次確定的 uploads 播放清單識別碼（供呼叫端快取）。
 */
export async function fetchChannelVideosViaApi(
  channelId: string,
  apiKey: string,
  fetchJson: (request: ApiRequest) => Promise<any>,
  resolvedPlaylistId?: string
): Promise<{ videos: MonitoredVideoResult[]; uploadsPlaylistId: string }> {
  const derived = resolvedPlaylistId || uploadsPlaylistIdFor(channelId);

  if (derived) {
    try {
      const json = await fetchJson(buildPlaylistItemsRequest(derived, apiKey));
      return { videos: parsePlaylistItems(json), uploadsPlaylistId: derived };
    } catch (e) {
      // 只有「清單不存在」才值得改走後備查詢；配額、金鑰與網路錯誤
      // 換個清單識別碼也不會成功，直接上拋讓呼叫端分類處置。
      if (classifyApiError(e) !== 'other' || !isPlaylistNotFound(e)) throw e;
    }
  }

  // 後備：查詢頻道詳細資料取得正確的 uploads 播放清單識別碼
  const channelJson = await fetchJson(buildChannelUploadsRequest(channelId, apiKey));
  const uploads = parseUploadsPlaylistId(channelJson);
  if (!uploads) {
    // 查詢確認該頻道不存在，才視為頻道層級錯誤
    throw new Error(`API_CHANNEL_NOT_FOUND:${channelId}`);
  }

  const json = await fetchJson(buildPlaylistItemsRequest(uploads, apiKey));
  return { videos: parsePlaylistItems(json), uploadsPlaylistId: uploads };
}

/** 錯誤是否為「播放清單不存在」（值得改走 `channels.list` 後備）。 */
function isPlaylistNotFound(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return text.includes('playlistnotfound') || text.includes('http_status:404');
}

// ============================================================================
// 檢查結果回饋（訊息片段）
// ============================================================================
//
// 沿用 `services/rateLimit.ts` 的慣例：純函式只產生**訊息片段**，由 `App.vue`
// 與既有的來源標記、失敗分級等片段組裝成 Toast。刻意不產生整則訊息 ——
// 那會把既有分支中的資訊洗掉。

/**
 * 配額耗盡而降級的告知。
 *
 * 必須讓使用者知道本輪的抓取品質與平常不同（降級後候選視窗變窄、
 * 備援還不帶精確發布時間），否則會誤判漏片原因。同時明說會自動恢復，
 * 避免使用者去做無效的手動處理。
 */
export function describeApiQuotaDegraded(): string {
  return '（⚠️ 今日 API 配額已用盡，暫時改用官方 RSS，太平洋時間午夜重置後自動恢復）';
}

/**
 * 金鑰無效的告知。
 *
 * 與配額耗盡刻意用不同措辭：前者只需等待重置，後者需使用者修正設定。
 * MUST NOT 包含金鑰的任何片段 —— 本函式不接受金鑰參數即結構性保證。
 */
export function describeApiKeyRejected(): string {
  return '（⚠️ API 金鑰無效或該專案未啟用 YouTube Data API v3，已改用官方 RSS，請於頻道設定中檢查金鑰）';
}

// ============================================================================
// 當日用量估算
// ============================================================================

/** 每日配額上限（單位）。 */
export const DAILY_QUOTA_UNITS = 10000;

/** 當日用量的累計狀態。 */
export interface ApiUnitCounter {
  /** 本配額日已消耗的單位估算值 */
  used: number;
  /** 本次計數週期的結束時點（下一個太平洋時間午夜） */
  resetAt: number;
}

/**
 * 累計當日用量，跨越重置時點時自零起算。
 *
 * **這是估算值，不是權威數字。** API 不提供查詢自身用量的端點；Console 上的
 * 數字走 Service Usage／Cloud Monitoring，需 OAuth 的 `cloud-platform` 權限，
 * 非 API 金鑰可得。下列情形會使估算**低於**實際：同一 Google Cloud 專案被
 * 其他工具使用、同一把金鑰用於多台裝置、以及失敗請求是否計費的不確定性。
 *
 * 重置時點刻意重用 `nextQuotaResetTime` —— 與配額耗盡抑制採同一計算，
 * 兩者若各自為政，會出現「抑制已解除但計數還沒歸零」之類的矛盾狀態。
 */
export function addApiUnits(
  counter: ApiUnitCounter | undefined,
  units: number,
  now: number
): ApiUnitCounter {
  const amount = Math.max(0, units || 0);
  if (!counter || !counter.resetAt || now >= counter.resetAt) {
    return { used: amount, resetAt: nextQuotaResetTime(now) };
  }
  return { used: Math.max(0, counter.used || 0) + amount, resetAt: counter.resetAt };
}

/**
 * 取得當前有效的已用單位數；已跨越重置時點時回傳 0。
 *
 * 供顯示使用 —— 未經此函式直接讀 `used` 會在跨日後仍顯示昨日的數字。
 */
export function currentApiUnitsUsed(counter: ApiUnitCounter | undefined, now: number): number {
  if (!counter || !counter.resetAt || now >= counter.resetAt) return 0;
  return Math.max(0, counter.used || 0);
}
