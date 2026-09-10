import { registerPlugin } from '@capacitor/core';
import { Command, open } from '@tauri-apps/plugin-shell';
import { downloadDir, tempDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readTextFile, writeTextFile, rename, remove, exists, stat } from '@tauri-apps/plugin-fs';
import * as OpenCC from 'opencc-js';
import { PARSE_CANCELLED, buildPlaylistRangeArgs } from './parseScope';
import { formatPublishTime } from './displayFormat';
import { resolveSourceProfile } from './sourceProfiles';
import {
  chunkUrls, parseEnrichNdjson, withinBudget,
  ENRICH_CHUNK_SIZE, ENRICH_THROTTLE_MS, ENRICH_BUDGET_MS,
  type EnrichedItem
} from './enrichment';
import {
  shouldBackoff, rateLimitBackoffMs, RATE_LIMIT_MAX_RETRIES,
  API_REQUEST_TIMEOUT_MS, requestTimeoutError,
} from './rateLimit';
import { buildDownloadFileName, nextAvailableName } from './fileNaming';
import {
  channelTrackingStatus,
  trackingUnavailableError,
  fetchChannelVideosViaApi,
  resolveLiveStatusesViaApi,
  buildChannelSnippetRequest,
  parseChannelTitle,
  classifyApiError,
  type ApiRequest,
  type ApiErrorKind,
  type ChannelTrackingBlocked,
} from './youtubeDataApi';

// 改用 t (標準繁體) 轉 cn，避開台灣標準對「么」的強制校正
const _t2cn = OpenCC.Converter({ from: 't', to: 'cn' });
const _cn2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });

const convertCnToTw = (text: string): string => {
  if (!text) return text;
  // 若嘗試把繁體轉簡體時發生了改變，代表原文【含有繁體專屬字】
  // 這時我們判斷原文「已經是繁體」，就不做任何轉換，保持原狀（避免「岳」被過度轉換成「嶽」）
  if (_t2cn(text) !== text) {
    return text;
  }
  // 如果裡面完全沒有繁體專屬字，我們就當作它是簡體或中性字，進行簡轉繁
  return _cn2tw(text);
};

const YoutubeDlPlugin = registerPlugin<any>('YoutubeDl');

export const isTauri = () => {
  return typeof window !== 'undefined' && window.hasOwnProperty('__TAURI_INTERNALS__');
};

// formatPublishTime 已移至 displayFormat.ts（純函式，可被測試引用），此處轉出以維持既有匯入路徑。
export { formatPublishTime } from './displayFormat';

let activeChildProcess: any = null;
let activeRcloneChildProcess: any = null;
let isManualCancelling = false;
let currentAndroidProcessId = '';

// ---- 解析階段（非下載階段）的行程管理與時間界限 ----

// 解析階段的界限、進度鍵與批次範圍計算集中於 parseScope.ts（純函式，可被測試引用），
// 此處轉出以維持既有的匯入路徑。
export {
  PARSE_TIMEOUT_MS,
  PARSE_CANCELLED,
  PARSE_BATCH_SIZE,
  parseProgressKey,
  buildPlaylistRangeArgs,
  advanceParseProgress,
  type ParseProgress
} from './parseScope';

/**
 * 解析階段專用的 yt-dlp 選項，用意是讓失敗迅速浮現而非堆疊重試。
 *
 * - `--extractor-retries 0`：extractor 層級的失敗多為永久性，重試只是把等待拉長。
 *   TikTok 的 JS challenge 每一輪都要重跑，正是「數分鐘後才失敗」的主因。
 * - `--retries 2`：HTTP／片段層級仍保留少量重試，避免正常的大型清單因單次
 *   網路抖動就整批失敗。
 * - `--socket-timeout 15`：只約束單次連線；總時長仍由 PARSE_TIMEOUT_MS 保證。
 *
 * 下載路徑刻意不套用此組選項，其重試策略維持原狀。
 */
const PARSE_RESILIENCE_ARGS = [
  '--socket-timeout', '15',
  '--extractor-retries', '0',
  '--retries', '2'
];

/**
 * 組出項目的完整網址。
 *
 * 有專屬規則的來源（目前只有 TikTok）由能力表提供；其餘沿用依網域判斷的
 * 預設規則。多數來源的 entry 本就帶完整網址，走不到這裡。
 */
function resolveItemUrl(rawId: string, entry: any, sourceUrl: string): string {
  const profile = resolveSourceProfile(sourceUrl);
  if (profile.buildItemUrl) return profile.buildItemUrl(rawId, entry, sourceUrl);
  return `https://www.youtube.com/watch?v=${rawId}`;
}

/** YouTube 頻道底下的分頁名，用於自網址還原分頁根。 */
const CHANNEL_TAB_SEGMENTS = ['videos', 'streams', 'shorts', 'playlists', 'live', 'featured'];

/** 自子清單 entry 取出序列識別（分頁名），如 videos / streams / shorts。 */
function sequenceKeyOf(entry: any, index: number): string {
  const wp = String(entry?.webpage_url || entry?.url || '');
  const seg = wp.split('?')[0].replace(/\/+$/, '').split('/').pop() || '';
  return seg || `seq${index}`;
}

/** 組出某序列（分頁）的網址，供續抓單獨抓取。 */
function sequenceUrl(sourceUrl: string, sequence: string): string {
  const base = sourceUrl.split('?')[0].replace(/\/+$/, '');
  const tabPattern = new RegExp(`/(${CHANNEL_TAB_SEGMENTS.join('|')})$`);
  return `${base.replace(tabPattern, '')}/${sequence}`;
}

/** 解析中的 yt-dlp 子行程（主清單與子清單展開可能同時各有一個）。 */
const activeParseChildren = new Set<any>();
let isParseCancelling = false;
/** Android 端本次解析的 processId，取消時用來對應 destroyProcessById。 */
let currentAndroidParseId = '';

/**
 * 以 spawn 執行解析用的 yt-dlp，並保存 child handle 供取消使用。
 *
 * 刻意不用 execute()：後者一次回傳 stdout 但不交出 child，無法中止，
 * 正是解析階段無法取消的根因（見 design D2）。
 */
async function runParseCommandOnce(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = Command.sidecar('bin/yt-dlp', [...PARSE_RESILIENCE_ARGS, ...args], { encoding: 'utf-8' });

  let stdout = '';
  let stderr = '';
  command.stdout.on('data', (line: string) => { stdout += line; });
  command.stderr.on('data', (line: string) => { stderr += line + '\n'; });

  const exitPromise = new Promise<number>((resolve, reject) => {
    command.on('close', (data: any) => resolve(data?.code ?? -1));
    command.on('error', (err: any) => reject(new Error('yt-dlp error: ' + err)));
  });

  const child = await command.spawn();
  activeParseChildren.add(child);
  try {
    const code = await exitPromise;
    if (isParseCancelling) throw new Error(PARSE_CANCELLED);
    return { code, stdout, stderr };
  } finally {
    activeParseChildren.delete(child);
  }
}

/** 可被取消打斷的等待。取消時立即拋出，不空等完整的退避時間。 */
async function sleepUnlessCancelled(ms: number): Promise<void> {
  const step = 200;
  for (let waited = 0; waited < ms; waited += step) {
    if (isParseCancelling) throw new Error(PARSE_CANCELLED);
    await new Promise(r => setTimeout(r, Math.min(step, ms - waited)));
  }
  if (isParseCancelling) throw new Error(PARSE_CANCELLED);
}


/**
 * 執行解析用的 yt-dlp；遭遇來源限流時退避重試。
 *
 * 這是「列表階段快速失敗」的明確例外，且僅適用於限流：其餘 extractor
 * 失敗仍立即回報。實作上維持 `--extractor-retries 0`（不讓 yt-dlp 自己
 * 亂重試），改由這一層辨識限流後重跑整個呼叫 —— 兩種失敗各走各的路徑，
 * 不需要在 yt-dlp 的旗標裡表達細緻的分類。
 *
 * 累計退避 14 秒，遠低於 PARSE_TIMEOUT_MS 的 90 秒，退避本身不會撐爆逾時。
 */
async function runParseCommand(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let last = await runParseCommandOnce(args);

  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    if (last.code === 0 || !shouldBackoff(last.stderr)) return last;

    const delay = rateLimitBackoffMs(attempt);
    if (!delay) break;
    console.warn(`[解析] 來源限流，${delay / 1000} 秒後重試（第 ${attempt} 次）`);
    await sleepUnlessCancelled(delay);
    last = await runParseCommandOnce(args);
  }

  return last;
}

/** 補齊中的 yt-dlp 子行程。與列表階段分開 —— 取消補齊不應波及解析。 */
const activeEnrichChildren = new Set<any>();
let isEnrichCancelling = false;
/** Android 端本次補齊的 processId。 */
let currentAndroidEnrichId = '';

/** 補齊被取消時拋出的錯誤訊息。 */
export const ENRICH_CANCELLED = 'ENRICH_CANCELLED_BY_USER';

/**
 * 補齊階段專用的 yt-dlp 選項。
 *
 * **刻意不含 `--extractor-retries 0`** —— 那是列表階段「快速失敗」的設定。
 * 補齊面對的主要失敗是來源限流（412／429），那是暫時性的，正該退避重試；
 * 重試由我們這一層負責（見下方 runEnrichChunk）。
 */
const ENRICH_ARGS = [
  '--dump-json',
  '--skip-download',
  '--no-warnings',
  '--socket-timeout', '15',
  '--retries', '2'
];

/** 可被取消打斷的等待。 */
async function sleepUnlessEnrichCancelled(ms: number): Promise<void> {
  const step = 200;
  for (let waited = 0; waited < ms; waited += step) {
    if (isEnrichCancelling) throw new Error(ENRICH_CANCELLED);
    await new Promise(r => setTimeout(r, Math.min(step, ms - waited)));
  }
  if (isEnrichCancelling) throw new Error(ENRICH_CANCELLED);
}

/** 以單次呼叫帶多個網址取得 NDJSON。平台分支只有這一層。 */
async function fetchEnrichNdjson(urls: string[]): Promise<string> {
  if (!isTauri()) {
    currentAndroidEnrichId = 'avd_enrich_' + Date.now();
    const res = await YoutubeDlPlugin.enrichItems({ urls, processId: currentAndroidEnrichId });
    return res?.ndjson || '';
  }

  const command = Command.sidecar('bin/yt-dlp', [...ENRICH_ARGS, ...urls], { encoding: 'utf-8' });
  let stdout = '';
  command.stdout.on('data', (line: string) => { stdout += line + String.fromCharCode(10); });

  const exitPromise = new Promise<void>((resolve, reject) => {
    command.on('close', () => resolve());
    command.on('error', (err: any) => reject(new Error('yt-dlp error: ' + err)));
  });

  const child = await command.spawn();
  activeEnrichChildren.add(child);
  try {
    await exitPromise;
    if (isEnrichCancelling) throw new Error(ENRICH_CANCELLED);
    return stdout;
  } finally {
    activeEnrichChildren.delete(child);
  }
}

/** 抓取單一塊，對限流退避重試。 */
async function runEnrichChunk(urls: string[]): Promise<EnrichedItem[]> {
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = rateLimitBackoffMs(attempt);
      if (!delay) break;
      console.warn(`[補齊] 來源限流，${delay / 1000} 秒後重試（第 ${attempt} 次）`);
      await sleepUnlessEnrichCancelled(delay);
    }
    try {
      const ndjson = await fetchEnrichNdjson(urls);
      const parsed = parseEnrichNdjson(ndjson);
      // 整塊都沒解析出東西，且訊息像限流 —— 退避後再試一次。
      if (parsed.length > 0) return parsed;
    } catch (e: any) {
      if (e?.message === ENRICH_CANCELLED) throw e;
      if (!shouldBackoff(e?.message || String(e))) {
        // 非限流的失敗：這一塊補不到就算了，不重試也不中斷其餘的塊。
        console.warn('[補齊] 本塊失敗', e);
        return [];
      }
    }
  }
  return [];
}

// Mock event emitter for Tauri
type Listener = (info: any) => void;
const listeners: Record<string, Listener[]> = {
  downloadProgress: [],
  serverUploadSpeed: [],
  driveUploadProgress: []
};

function emitEvent(eventName: string, data: any) {
  if (listeners[eventName]) {
    listeners[eventName].forEach(fn => fn(data));
  }
}

if (isTauri()) {
  try {
    listen('serverUploadSpeed', (event: any) => {
      emitEvent('serverUploadSpeed', event.payload);
    });
  } catch (e) {
    console.error('Failed to listen for serverUploadSpeed', e);
  }
}

export interface PlaylistItem {
  id: string;
  url: string;
  title: string;
  durationStr?: string;
}

export interface PlaylistResult {
  channelTitle: string;
  playlistTitle: string;
  items: PlaylistItem[];
  /**
   * 多序列來源本批各序列的回傳筆數（如 `{ videos: 117, shorts: 200 }`）。
   * 單序列來源為 undefined。呼叫端據此逐序列推進進度。
   */
  sequenceReturns?: Record<string, number>;
}

/**
 * 直播狀態查詢結果。
 * `unknown` 表示查詢失敗、無從判定 —— 與「確定不是直播」語意不同，
 * 呼叫端不得將其視為已處理完畢。
 */
export type LiveCheckResult = 'live' | 'not_live' | 'unknown';

export interface MonitoredVideoResult {
  videoId: string;
  title: string;
  published: string;
  /**
   * 影片發布時間（毫秒）。
   * `0` 表示來源未提供精確發布時間 —— 呼叫端不得以當下時間替代，
   * 否則會將頻道的追蹤基準推進至未來而造成永久漏片。
   */
  publishedTime: number;
  url: string;
  /**
   * 資料來源通道。頻道追蹤只有 YouTube Data API 一條通道，故此欄位恆為
   * `'api'`。欄位本身保留而不移除：既有佇列中的任務已序列化此欄位，
   * 移除會牽動持久化與型別，收益卻只是少一個單值欄位。
   */
  source: 'api';
}

/**
 * 執行一次 API 請求並回傳解析後的 JSON。
 *
 * 這是 API 通道**唯一**的平台分支。Android 端直接用 WebView 的 `fetch()` ——
 * 實測 `googleapis.com` 的 OPTIONS 預檢回 200 且明確允許 `x-goog-api-key`，
 * CORS 不成立阻擋，故不需新增原生外掛方法。
 *
 * 兩條路徑的錯誤都以 `HTTP_STATUS:{code}:{body}` 形式拋出，使
 * `classifyApiError` 能自 body 的 JSON 區分配額耗盡與金鑰無效 ——
 * 單看狀態碼不足，403 兩者皆可能。
 */
/**
 * API 通道的呼叫端選項。`fetchChannelVideos`、`resolveLiveStatuses` 與
 * `fetchChannelTitle` 共用，使抑制狀態、用量計數與錯誤回報在各路徑上一致。
 */
export interface ChannelApiOptions {
  apiKey: string;
  now?: number;
  /** 配額耗盡的抑制解除時點 */
  quotaSuppressedUntil?: number;
  /** 被拒金鑰的指紋；與當前金鑰相符時跳過 API */
  rejectedKeyFingerprint?: string;
  /** 已知的 uploads 播放清單識別碼（快取），省去推導與後備查詢 */
  uploadsPlaylistId?: string;
  /** API 成功時回報確定的 uploads 清單識別碼，供呼叫端快取 */
  onResolved?: (uploadsPlaylistId: string) => void;
  /** API 失敗時回報錯誤類別，供呼叫端寫入抑制狀態與回饋 */
  onError?: (kind: ApiErrorKind) => void;
  /**
   * 失敗的原文回報，供呼叫端寫入錯誤日誌。
   *
   * 與 `onError` 刻意分開：後者只給分類（供抑制判斷），前者給**未經截斷的
   * 原文**（供事後追查）。這裡回報的是那些**不會向使用者提示**、但確實改變
   * 了結果的失敗 —— 直播狀態查詢失敗會使影片停在狀態未定而阻擋錨點、
   * 頻道名稱查詢失敗會使頻道停留在以網址為名。使用者事後只看得到「沒有新
   * 影片」或「名稱不對」，日誌裡卻沒有任何線索。
   */
  onFailure?: (context: string, error: unknown) => void;
  /** 每次請求送達服務後回報其配額成本，供呼叫端累計當日用量估算 */
  onUnitsConsumed?: (units: number) => void;
}

/**
 * 本輪頻道追蹤是否可運作；不可運作時回傳停擺原因。
 *
 * 移除備援後這不再是「選哪條通道」而是「能不能追蹤」—— 回傳非 `null` 時
 * 呼叫端 MUST 拋出可辨識的錯誤，MUST NOT 靜默回傳空清單。
 */
function trackingBlockedReason(api?: ChannelApiOptions): ChannelTrackingBlocked | null {
  const status = channelTrackingStatus({
    apiKey: api?.apiKey ?? '',
    now: api?.now ?? Date.now(),
    quotaSuppressedUntil: api?.quotaSuppressedUntil,
    rejectedKeyFingerprint: api?.rejectedKeyFingerprint,
  });
  return status === 'ok' ? null : status;
}

/**
 * 包出一個會累計用量的請求執行函式。
 *
 * 計數時機為「請求已送達服務」：傳輸層錯誤未達 Google 故不計入，
 * 其餘（含配額耗盡的 403）一律計入 —— 那些請求確實被服務處理過。
 */
function countedApiFetch(api: ChannelApiOptions) {
  return async (request: ApiRequest) => {
    try {
      const json = await fetchApiJson(request);
      api.onUnitsConsumed?.(1);
      return json;
    } catch (e: any) {
      const message = e?.message || String(e);
      const isTransport = /^NETWORK_ERROR:/i.test(message) || e instanceof TypeError;
      if (!isTransport) api.onUnitsConsumed?.(1);
      throw e;
    }
  };
}

async function fetchApiJson(request: ApiRequest): Promise<any> {
  if (isTauri()) {
    // 桌面端的逾時由 Rust 的 ureq agent 負責（連線與讀取各 10 秒），
    // 並於該處拋出 REQUEST_TIMEOUT: 前綴，與此處的 Android 路徑一致。
    const text = await invoke<string>('fetch_http_text', {
      url: request.url,
      headers: request.headers,
    });
    return JSON.parse(text);
  }

  // WebView 的 fetch() 沒有內建逾時 —— 少了這道界限，一個不回應的請求會
  // **無限期**擋住整輪檢查，而使用者看到的是永不結束的進行中狀態。
  // 移除備援後追蹤只剩單一通道，那比明確失敗更糟：無法察覺，也無從排查。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(request.url, { headers: request.headers, signal: controller.signal });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP_STATUS:${res.status}:${body.slice(0, 500)}`);
    }
    return JSON.parse(body);
  } catch (e) {
    // 中止旗標優先於原始錯誤：abort 會讓 fetch 拋出 AbortError，
    // 而那個錯誤本身不帶「這是我們主動因逾時中止」的資訊。
    if (controller.signal.aborted) throw requestTimeoutError(API_REQUEST_TIMEOUT_MS);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const DownloadService = {
  addListener(eventName: string, callback: Listener) {
    if (isTauri()) {
      listeners[eventName].push(callback);
    } else {
      YoutubeDlPlugin.addListener(eventName, (info: any) => {
        if (info) {
          if (info.title) info.title = convertCnToTw(info.title);
          if (info.line) info.line = convertCnToTw(info.line);
          if (info.channel) info.channel = convertCnToTw(info.channel);
          if (info.channelPrefix) info.channelPrefix = convertCnToTw(info.channelPrefix);
        }
        callback(info);
      });

    }
  },

  /**
   * 解析播放清單／頻道網址。
   *
   * @param options.fetched 此來源先前已抓過的筆數；用來決定本批的抓取範圍。
   *                        0（或省略）代表首批。
   */
  /**
   * 解析播放清單／頻道網址。
   *
   * @param options.fetched   單序列來源已抓過的筆數
   * @param options.sequences 多序列來源各序列已抓過的筆數。給定且非空時走
   *                          續抓路徑：只對這些序列各自發出請求，各帶自己的
   *                          範圍。以合計筆數定址是原本的漏片根因。
   */
  async parsePlaylist(
    url: string,
    options?: { fetched?: number; sequences?: Record<string, number> }
  ): Promise<PlaylistResult> {
    // 每次解析都重置取消旗標，避免前一次的取消殘留影響本次。
    isParseCancelling = false;

    const seqFetched = options?.sequences;
    if (seqFetched && Object.keys(seqFetched).length > 0) {
      // 續抓：逐序列各抓一次。此路徑平台無關 —— 每次都只是對某個分頁網址
      // 做一次普通解析，兩端的既有實作都能處理。
      const merged: PlaylistItem[] = [];
      const returns: Record<string, number> = {};
      let channelTitle = '';
      let playlistTitle = '';

      for (const [sequence, fetched] of Object.entries(seqFetched)) {
        const res = await this.parsePlaylist(sequenceUrl(url, sequence), { fetched });
        if (!channelTitle && res?.channelTitle) channelTitle = res.channelTitle;
        if (!playlistTitle && res?.playlistTitle) playlistTitle = res.playlistTitle;
        returns[sequence] = res?.items?.length || 0;
        if (res?.items) merged.push(...res.items);
      }

      return {
        channelTitle: channelTitle || '頻道主',
        playlistTitle: playlistTitle || '播放清單',
        items: merged,
        sequenceReturns: returns
      };
    }

    const rangeArgs = buildPlaylistRangeArgs(options?.fetched ?? 0);

    if (!isTauri()) {
      currentAndroidParseId = 'avd_parse_' + Date.now();
      const res = await YoutubeDlPlugin.parsePlaylist({
        url,
        processId: currentAndroidParseId,
        rangeArgs
      });
      if (res) {
        if (res.channelTitle) res.channelTitle = convertCnToTw(res.channelTitle);
        if (res.playlistTitle) res.playlistTitle = convertCnToTw(res.playlistTitle);
        if (res.items) {
          res.items.forEach((item: any) => {
            if (item.title) item.title = convertCnToTw(item.title);
          });
        }
      }
      return res;
    }

    try {
      const args = [
        '--extractor-args', 'youtube:player_client=web_creator,default',
        '--rm-cache-dir',
        '--flat-playlist',
        ...rangeArgs,
        '-J',
        url
      ];

      const output = await runParseCommand(args);

      if (output.code !== 0) {
        throw new Error('解析播放清單失敗: ' + output.stderr);
      }

      const data = JSON.parse(output.stdout);
      const channelTitle = convertCnToTw(data.uploader || data.channel || data.uploader_id || '頻道主');
      const playlistTitle = convertCnToTw(data.title || '播放清單');

      // 各分頁本批的回傳筆數，僅記錄頂層的子清單（分頁），不含更深的巢狀。
      const sequenceReturns: Record<string, number> = {};

      const processEntries = async (entriesData: any[], isTopLevel = false): Promise<PlaylistItem[]> => {
        const result: PlaylistItem[] = [];

        for (let index = 0; index < entriesData.length; index++) {
          const entry = entriesData[index];
          const entryUrl = entry.url || entry.webpage_url || '';
          const entryId = entry.id || '';
          const ieKey = entry.ie_key || '';
          const entryType = entry._type || '';

          const isSubPlaylist = entryType === 'playlist' ||
                                entryType === 'multi_video' ||
                                ieKey === 'YoutubePlaylist' ||
                                ieKey === 'YoutubeTab' ||
                                (entryUrl && (entryUrl.includes('list=PL') || entryUrl.includes('/playlist?list='))) ||
                                (entryId && typeof entryId === 'string' && entryId.startsWith('PL'));

          if (isSubPlaylist && (entryUrl || entryId)) {
            // 內嵌 entries 優先：實測 `--playlist-end N` 打在頻道網址上時，
            // 各分頁的內嵌結果已各自被裁到 N，與逐分頁呼叫完全相同。
            // 現行程式碼原本一律重打，等於同一批資料抓兩次（共 4 次呼叫）。
            const inline = Array.isArray(entry.entries) ? entry.entries : null;
            if (inline && inline.length > 0) {
              const subItems = await processEntries(inline);
              if (isTopLevel) sequenceReturns[sequenceKeyOf(entry, index)] = subItems.length;
              result.push(...subItems);
              continue;
            }

            try {
              const subUrl = entryUrl.startsWith('http')
                ? entryUrl
                : `https://www.youtube.com/playlist?list=${entryId || entryUrl}`;
              // 子清單沿用同一批次範圍，否則 YouTube 頻道的分頁展開會繞過上限。
              const subArgs = [
                '--extractor-args', 'youtube:player_client=web_creator,default',
                '--rm-cache-dir',
                '--flat-playlist',
                ...rangeArgs,
                '-J',
                subUrl
              ];
              const subOut = await runParseCommand(subArgs);
              if (subOut.code === 0) {
                const subData = JSON.parse(subOut.stdout);
                if (subData.entries && subData.entries.length > 0) {
                  const subItems = await processEntries(subData.entries);
                  if (isTopLevel) sequenceReturns[sequenceKeyOf(entry, index)] = subItems.length;
                  result.push(...subItems);
                  continue;
                }
              }
            } catch (e: any) {
              // 取消必須向外傳遞，否則會被當成「這個子清單展開失敗」而繼續跑下一個。
              if (e?.message === PARSE_CANCELLED) throw e;
              console.warn('Expanding sub-playlist failed:', entryUrl, e);
            }
          }

          const itemTitle = convertCnToTw(entry.title || entry.fulltitle || `影片 ${index + 1}`);
          const videoId = entry.id || entry.url || String(index);
          let itemUrl = entry.url || entry.webpage_url || '';
          if (itemUrl && !itemUrl.startsWith('http')) {
            itemUrl = resolveItemUrl(itemUrl, entry, url);
          }
          if (!itemUrl) {
            itemUrl = resolveItemUrl(videoId, entry, url);
          }

          let durationStr = '';
          if (typeof entry.duration === 'number') {
            const mins = Math.floor(entry.duration / 60);
            const secs = Math.floor(entry.duration % 60);
            durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          }

          let entryPubTimeStr = '';
          if (entry.timestamp) {
            entryPubTimeStr = formatPublishTime(entry.timestamp * 1000);
          } else if (entry.upload_date && String(entry.upload_date).length === 8) {
            const str = String(entry.upload_date);
            const y = str.slice(0, 4);
            const m = str.slice(4, 6);
            const d = str.slice(6, 8);
            entryPubTimeStr = `${y}/${m}/${d} 00:00:00`;
          }

          let finalItemTitle = itemTitle;
          if (entryPubTimeStr && !finalItemTitle.includes(entryPubTimeStr)) {
            finalItemTitle = `${finalItemTitle} (${entryPubTimeStr})`;
          }

          result.push({
            id: String(videoId),
            url: itemUrl,
            title: finalItemTitle,
            durationStr
          });
        }
        return result;
      };

      let initialEntries = data.entries || [];
      if (!initialEntries.length && (data.id || data.url)) {
        initialEntries = [data];
      }

      const items = await processEntries(initialEntries, true);

      return {
        channelTitle,
        playlistTitle,
        items,
        sequenceReturns: Object.keys(sequenceReturns).length > 0 ? sequenceReturns : undefined
      };
    } catch (e: any) {
      throw new Error('播放清單解析失敗: ' + (e.message || String(e)));
    }
  },

  async download(options: { url: string; mp3: boolean; subFolder?: string }) {
    if (!isTauri()) {
      currentAndroidProcessId = 'process_' + Date.now() + Math.random().toString().slice(2, 8);
      const res = await YoutubeDlPlugin.download({ ...options, processId: currentAndroidProcessId });
      if (res) {
        if (res.title) res.title = convertCnToTw(res.title);
        if (res.channelPrefix) res.channelPrefix = convertCnToTw(res.channelPrefix);
      }
      return res;
    }


    try {
      // 每日自動更新檢查
      const today = new Date().toISOString().split('T')[0];
      const lastCheck = localStorage.getItem('yt_dlp_last_update_check');
      if (today !== lastCheck) {
        emitEvent('downloadProgress', { line: '檢查並更新核心引擎 (每日首次)...' });
        try {
          await this.updateYtDlp();
          localStorage.setItem('yt_dlp_last_update_check', today);
        } catch (updateErr) {
          console.warn('yt-dlp auto update failed, continuing with current version', updateErr);
        }
      }

      const rawDownDir = await downloadDir();
      const downDir = rawDownDir.replace(/[/\\]+$/, '');
      const avdDir = `${downDir}/AVD`;
      
      const sanitizeFolder = options.subFolder ? options.subFolder.replace(/[\/\\:*?"<>|]/g, '_').trim() : '';
      const targetDirPath = sanitizeFolder ? `${avdDir}/${sanitizeFolder}` : avdDir;

      // 產生一個隨機 ID 來當作唯一檔名
      const uniqueId = Date.now().toString() + '_' + Math.floor(Math.random() * 1000);

      const args = [
        '--extractor-args', 'youtube:player_client=web_creator,default',
        '--rm-cache-dir',
        '--retries', '3',
        '--fragment-retries', '3',
        '--extractor-retries', '3',
        '--newline',
        '-q',              // 靜默模式：只輸出 ASCII 進度，不輸出中文訊息
        '--progress',
        '--write-info-json', // 將影片標題等中繼資料寫入 .info.json（UTF-8 格式）
        '-o', `${targetDirPath}/${uniqueId}.%(ext)s`  // 使用唯一 ID 儲存，確保不衝突
      ];

      if (options.mp3) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      } else {
        // 強制下載 H.264 影片與 M4A 音訊，打包成 mp4 (iPad/iPhone 最高相容性)
        args.push('-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
        args.push('--merge-output-format', 'mp4');
      }

      args.push(options.url);

      isManualCancelling = false;
      const command = Command.sidecar('bin/yt-dlp', args, { encoding: 'utf-8' });

      let stderrOutput = '';

      command.stdout.on('data', (line: string) => {
        // 進度行是純 ASCII，可以安全解析
        if (line.includes('[download]') && line.includes('%')) {
          const progressMatch = line.match(/(\d+\.?\d*)%/);
          const speedMatch = line.match(/at\s+([0-9.]+[a-zA-Z]+\/s)/);
          const etaMatch = line.match(/ETA\s+([0-9:]+)/);
          
          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]);
            emitEvent('downloadProgress', {
              progress: progress,
              speed: speedMatch ? speedMatch[1] : '',
              eta: etaMatch ? etaMatch[1] : ''
            });
          }
        }
      });

      command.stderr.on('data', (line: string) => {
        stderrOutput += line + '\n';
      });

      const exitPromise = new Promise<void>((resolve, reject) => {
        command.on('close', (data) => {
          activeChildProcess = null;
          if (isManualCancelling) {
            reject(new Error('CANCELLED_BY_USER'));
            return;
          }
          if (data.code === 0) {
            resolve();
          } else {
            reject(new Error('yt-dlp failed with code ' + data.code + ': ' + stderrOutput));
          }
        });
        command.on('error', (err) => {
          activeChildProcess = null;
          if (isManualCancelling) {
            reject(new Error('CANCELLED_BY_USER'));
            return;
          }
          reject(new Error('yt-dlp error: ' + err));
        });
      });

      const child = await command.spawn();
      activeChildProcess = child;
      await exitPromise;

      const ext = options.mp3 ? 'mp3' : 'mp4';
      let logs: string[] = [];
      let rawTitle = '';
      let uploadDate = '';
      let timestampNum = 0;
      let uploader = '';
      const tempFilePath = `${targetDirPath}/${uniqueId}.${ext}`;
      const infoPath = `${targetDirPath}/${uniqueId}.info.json`;

      try {
        const jsonStr = await readTextFile(infoPath);
        const info = JSON.parse(jsonStr);
        rawTitle = info.title || info.fulltitle || '';
        uploadDate = info.upload_date || '';
        timestampNum = info.timestamp || info.release_timestamp || 0;
        uploader = info.uploader || info.channel || '';
      } catch (e: any) {

        logs.push('Failed to read info.json: ' + (e.message || String(e)));
        console.warn('Failed to read info.json for title', e);
      }

      // 1. 完整繁體標題 (用於 UI 展示)
      const fullTitle = rawTitle ? convertCnToTw(rawTitle) : '';

      // 格式化發布時間
      let pubTimeStr = '';
      let pubTimeMs = 0;
      if (timestampNum) {
        pubTimeMs = timestampNum * 1000;
        pubTimeStr = formatPublishTime(pubTimeMs);
      } else if (uploadDate && String(uploadDate).length === 8) {
        const str = String(uploadDate);
        const y = str.slice(0, 4);
        const m = str.slice(4, 6);
        const d = str.slice(6, 8);
        pubTimeStr = `${y}/${m}/${d} 00:00:00`;
        const parsed = new Date(`${y}-${m}-${d}T00:00:00`).getTime();
        if (!isNaN(parsed)) pubTimeMs = parsed;
      }

      // 2. 檔名化：標題（去非法字元、截 30 字）+ 發布時間。
      //    只用標題會讓 TikTok／Douyin 同描述的多支影片撞成同一個檔名。
      const cleanFileName = buildDownloadFileName(fullTitle, pubTimeMs);

      // 3. 重複檔名檢測與重新命名
      let downloadedFilePath = tempFilePath;

      try {
        // 碰撞時遞增改名而非覆蓋或失敗；含嘗試次數上限，避免病態情形下的無窮迴圈。
        const targetFileName = await nextAvailableName(
          cleanFileName,
          ext,
          (name) => exists(`${targetDirPath}/${name}`)
        );
        const candidatePath = `${targetDirPath}/${targetFileName}`;

        if (await exists(tempFilePath)) {
          await rename(tempFilePath, candidatePath);
          downloadedFilePath = candidatePath;
        }

        if (await exists(infoPath)) {
          try {
            await remove(infoPath);
          } catch (err) {
            console.warn('Failed to remove info.json', err);
          }
        }
      } catch (e: any) {
        logs.push('Failed to rename file: ' + (e.message || String(e)));
        console.error('Failed to rename file, using temp path', e);
      }

      // 偵測影片編碼與解析度
      let quality = '';
      let fileSizeBytes = 0;

      if (downloadedFilePath) {
        try {
          const probeCmd = Command.sidecar('bin/ffmpeg', ['-i', downloadedFilePath, '-hide_banner'], { encoding: 'utf-8' });
          const probeOutput = await probeCmd.execute();
          const stderr = probeOutput.stderr || '';
          
          if (options.mp3) {
            const bitrateMatch = stderr.match(/bitrate:\s*(\d+)\s*kb\/s/i) || stderr.match(/Audio:.*?(\d+)\s*kb\/s/i);
            if (bitrateMatch) {
              quality = bitrateMatch[1] + 'kbps';
            } else {
              quality = 'MP3';
            }
          } else {
            // 解析解析度：1920x1080
            const resMatch = stderr.match(/(\d{3,5})x(\d{3,5})/);
            if (resMatch) {
              const height = parseInt(resMatch[2]);
              if (height >= 2160) quality = '4K';
              else if (height >= 1080) quality = '1080p';
              else if (height >= 720) quality = '720p';
              else if (height >= 480) quality = '480p';
              else quality = height + 'p';
            }

            // 解析編碼：Video: h264, hevc, vp9, av1
            const codecMatch = stderr.match(/Video:\s+(\w+)/);
            if (codecMatch) {
              let codec = codecMatch[1].toLowerCase();
              if (codec === 'h264') codec = 'H.264';
              else if (codec === 'hevc') codec = 'H.265';
              else if (codec === 'vp9') codec = 'VP9';
              else if (codec === 'av1') codec = 'AV1';
              else codec = codec.toUpperCase();
              quality = quality ? quality + ' ' + codec : codec;
            }
          }
        } catch (e: any) {
          logs.push('ffprobe failed: ' + (e.message || String(e)));
          console.warn('ffprobe failed, skipping codec detection', e);
        }
      }

      // 取得檔案大小
      if (downloadedFilePath) {
        try {
          const fileInfo = await stat(downloadedFilePath);
          if (fileInfo.size) fileSizeBytes = fileInfo.size;
        } catch (e: any) {
          logs.push('Failed to get file size: ' + (e.message || String(e)));
          console.warn('Failed to get file size', e);
        }
      }

      let displayTitle = fullTitle || cleanFileName;
      if (displayTitle && pubTimeStr && !displayTitle.includes(pubTimeStr)) {
        displayTitle = `${displayTitle} (${pubTimeStr})`;
      }

      if (!displayTitle) {
        throw new Error('影片下載可能已完成，但無法解析標題與檔案資訊。\n日誌:\n' + logs.join('\n'));
      }

      return {
        path: downloadedFilePath || downDir,
        mediaUri: downloadedFilePath || downDir,
        title: displayTitle,
        rawTitle: fullTitle || cleanFileName,
        publishTimeStr: pubTimeStr,
        channelPrefix: uploader ? convertCnToTw(uploader) : '',
        quality: quality,
        fileSizeBytes: fileSizeBytes,
        isAudio: options.mp3
      };

    } catch (e: any) {
      activeChildProcess = null;
      let msg = e.message || String(e);
      throw new Error(msg);
    }
  },

  /**
   * 補齊清單項目的 metadata。
   *
   * 在勾選對話框**已經顯示之後**才呼叫 —— 不延後使用者看到清單。
   * 逐塊回呼，每塊之間節流以降低觸發來源限流的機率。
   *
   * 局部失敗不視為錯誤：補不到的項目保留退化標籤，仍可勾選與下載。
   * 超出時間預算即停止並保留已取得的結果。
   *
   * @param onChunk 每取得一塊就回呼一次，供呼叫端漸進回填
   */
  async enrichPlaylistItems(
    urls: string[],
    onChunk: (enriched: EnrichedItem[]) => void,
    options?: { budgetMs?: number; chunkSize?: number }
  ): Promise<void> {
    isEnrichCancelling = false;
    const startedAt = Date.now();
    const budget = options?.budgetMs ?? ENRICH_BUDGET_MS;
    const chunks = chunkUrls(urls, options?.chunkSize ?? ENRICH_CHUNK_SIZE);

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (isEnrichCancelling) return;
        if (!withinBudget(startedAt, Date.now(), budget)) {
          console.warn(`[補齊] 超出時間預算，已取得 ${i} / ${chunks.length} 塊`);
          return;
        }

        const enriched = await runEnrichChunk(chunks[i]);
        if (isEnrichCancelling) return;
        if (enriched.length > 0) onChunk(enriched);

        // 塊間節流：實測 Bilibili 在 5 個連續請求下已有 3 個被 412。
        if (i < chunks.length - 1) await sleepUnlessEnrichCancelled(ENRICH_THROTTLE_MS);
      }
    } catch (e: any) {
      if (e?.message === ENRICH_CANCELLED) return;
      // 補齊是增益，整體失敗也只是少了資訊。
      console.warn('[補齊] 中止', e);
    }
  },

  /** 中止進行中的補齊。與解析的取消分開，互不波及。 */
  async cancelEnrich() {
    isEnrichCancelling = true;

    if (!isTauri()) {
      if (!currentAndroidEnrichId) return;
      try {
        await YoutubeDlPlugin.cancelParsePlaylist({ processId: currentAndroidEnrichId });
      } catch (e) {
        console.error('Failed to cancel Android enrich process', e);
      }
      return;
    }

    for (const child of Array.from(activeEnrichChildren)) {
      try {
        await child.kill();
      } catch (e) {
        console.error('Failed to kill enrich child process', e);
      }
    }
    activeEnrichChildren.clear();
  },

  /**
   * 中止進行中的播放清單解析。
   *
   * 與 cancelDownload 分離：兩者管的是不同的行程，解析被取消時
   * 不應波及正在進行的下載。
   */
  async cancelParsePlaylist() {
    if (!isTauri()) {
      if (!currentAndroidParseId) return;
      try {
        await YoutubeDlPlugin.cancelParsePlaylist({ processId: currentAndroidParseId });
      } catch (e) {
        console.error('Failed to cancel Android parse process', e);
      }
      return;
    }

    isParseCancelling = true;
    for (const child of Array.from(activeParseChildren)) {
      try {
        await child.kill();
      } catch (e) {
        console.error('Failed to kill parse child process', e);
      }
    }
    activeParseChildren.clear();
  },

  async cancelDownload() {
    if (!isTauri()) {
      const pid = currentAndroidProcessId || 'avd_download';
      return YoutubeDlPlugin.cancelDownload({ processId: pid });
    }
    isManualCancelling = true;
    if (activeChildProcess) {
      try {
        await activeChildProcess.kill();
      } catch (e) {
        console.error('Failed to kill child process', e);
      }
      activeChildProcess = null;
    }
    if (activeRcloneChildProcess) {
      try {
        await activeRcloneChildProcess.kill();
      } catch (e) {
        console.error('Failed to kill rclone child process', e);
      }
      activeRcloneChildProcess = null;
    }
    emitEvent('downloadProgress', { cancelled: true });
  },

  async deleteMediaFile(options: { uri: string; path: string }) {
    if (!isTauri()) {
      return YoutubeDlPlugin.deleteMediaFile(options);
    }
    const targetPath = options.path || options.uri;
    if (!targetPath) return;

    try {
      if (await exists(targetPath)) {
        await remove(targetPath);
      }
    } catch (e: any) {
      console.error('Failed to delete media file on Windows', e);
      throw new Error(`無法刪除檔案: ${e.message || String(e)}`);
    }
  },

  async playVideo(options: { uri: string; mimeType?: string }) {
    if (!isTauri()) {
      return YoutubeDlPlugin.playVideo(options);
    }
    try {
      await open(options.uri);
    } catch (e: any) {
      const msg = e.message || (typeof e === 'string' ? e : JSON.stringify(e));
      throw new Error(`無法透過 Tauri open 開啟 ${options.uri}: ${msg}`);
    }
  },

  async openDownloadFolder() {
    if (isTauri()) {
      try {
        const rawDownDir = await downloadDir();
        const downDir = rawDownDir.replace(/[/\\]+$/, '');
        const avdDir = `${downDir}/AVD`;
        await open(avdDir);
      } catch (e: any) {
        console.error('Failed to open download folder', e);
      }
    }
  },

  async uploadToGoogleDrive(options: any) {
    if (!isTauri()) return YoutubeDlPlugin.uploadToGoogleDrive(options);
    throw new Error('Google Drive upload not supported on Windows yet.');
  },

  async directUploadToDrive(options: any) {
    if (!isTauri()) return YoutubeDlPlugin.directUploadToDrive(options);
    
    try {
      // options.accessToken 存著 Rclone 路徑 (例如: yiichungGDGD:avd)
      const rcloneDest = options.accessToken || '';
      if (!rcloneDest) throw new Error('Rclone 路徑未設定');

      // 判斷子目錄
      const subfolder = options.fileName.endsWith('.mp3') ? 'Music' : 'Video';
      // 組合最終目的地 (確保後面沒有多餘的斜線，然後加上子目錄)
      const cleanDest = rcloneDest.replace(/\/$/, '');
      const targetPath = `${cleanDest}/${subfolder}`;

      const args = [
        'copy',
        options.uri,
        targetPath,
        '--progress',
        '--stats=1s'
      ];

      const command = Command.sidecar('bin/rclone', args, { encoding: 'utf-8' });

      let rcloneStderr = '';
      const exitPromise = new Promise<void>((resolve, reject) => {
        command.on('close', (data) => {
          activeRcloneChildProcess = null;
          if (data.code === 0) {
            resolve();
          } else {
            reject(new Error('rclone failed with code ' + data.code + ': ' + rcloneStderr));
          }
        });
        command.on('error', (err) => {
          activeRcloneChildProcess = null;
          reject(new Error('rclone error: ' + err));
        });
      });

      command.stdout.on('data', (line: string) => {
        if (line.includes('%') && line.includes('Transferred:')) {
          const progressMatch = line.match(/(\d+)%/);
          if (progressMatch) {
            emitEvent('driveUploadProgress', {
              taskId: options.taskId,
              progress: parseInt(progressMatch[1])
            });
          }
        }
      });

      command.stderr.on('data', (line: string) => {
        rcloneStderr += line + '\n';
      });

      const child = await command.spawn();
      activeRcloneChildProcess = child;
      await exitPromise;
      return { success: true };
    } catch (e: any) {
      throw new Error(`Rclone 同步錯誤: ${e.message || String(e)}`);
    }
  },

  async backupChannelsToDrive(channelsJsonStr: string, tokenOrPath: string): Promise<void> {
    if (!tokenOrPath) throw new Error('尚未設定雲端硬碟 (Google Drive / Rclone)');

    if (isTauri()) {
      const cleanDest = tokenOrPath.replace(/\/$/, '');
      const targetPath = `${cleanDest}/avd_channels_backup.json`;
      const tempPath = await join(await tempDir(), 'avd_channels_backup.json');
      await writeTextFile(tempPath, channelsJsonStr);
      
      const cmd = Command.sidecar('bin/rclone', ['copyto', tempPath, targetPath]);
      const out = await cmd.execute();
      if (out.code !== 0) {
        throw new Error(`Rclone 上傳失敗 (代碼 ${out.code}): ${out.stderr || out.stdout}`);
      }
    } else {
      const boundary = '-------314159265358979323846';
      const delimiter = '\r\n--' + boundary + '\r\n';
      const closeDelim = '\r\n--' + boundary + '--';

      const metadata = {
        name: 'avd_channels_backup.json',
        mimeType: 'application/json'
      };

      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        channelsJsonStr +
        closeDelim;

      const searchRes = await fetch(
        "https://www.googleapis.com/drive/v3/files?q=name%3D'avd_channels_backup.json'+and+trashed%3Dfalse&fields=files(id)",
        {
          headers: { Authorization: `Bearer ${tokenOrPath}` }
        }
      );

      if (!searchRes.ok) {
        throw new Error(`搜尋雲端備份失敗: HTTP ${searchRes.status}`);
      }

      const searchData = await searchRes.json();
      const existingFileId = searchData.files && searchData.files.length > 0 ? searchData.files[0].id : null;

      let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      let uploadMethod = 'POST';

      if (existingFileId) {
        uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
        uploadMethod = 'PATCH';
      }

      const uploadRes = await fetch(uploadUrl, {
        method: uploadMethod,
        headers: {
          Authorization: `Bearer ${tokenOrPath}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartRequestBody
      });

      if (!uploadRes.ok) {
        throw new Error(`雲端備份上傳失敗: HTTP ${uploadRes.status}`);
      }
    }
  },

  async restoreChannelsFromDrive(tokenOrPath: string): Promise<string> {
    if (!tokenOrPath) throw new Error('尚未設定雲端硬碟 (Google Drive / Rclone)');

    if (isTauri()) {
      const cleanDest = tokenOrPath.replace(/\/$/, '');
      const targetPath = `${cleanDest}/avd_channels_backup.json`;
      const cmd = Command.sidecar('bin/rclone', ['cat', targetPath]);
      const out = await cmd.execute();
      if (out.code !== 0 || !out.stdout.trim()) {
        throw new Error(`雲端未找到備份檔案或 Rclone 讀取失敗: ${out.stderr || out.stdout}`);
      }
      return out.stdout.trim();
    } else {
      const searchRes = await fetch(
        "https://www.googleapis.com/drive/v3/files?q=name%3D'avd_channels_backup.json'+and+trashed%3Dfalse&fields=files(id)",
        {
          headers: { Authorization: `Bearer ${tokenOrPath}` }
        }
      );

      if (!searchRes.ok) {
        throw new Error(`搜尋雲端備份失敗: HTTP ${searchRes.status}`);
      }

      const searchData = await searchRes.json();
      if (!searchData.files || searchData.files.length === 0) {
        throw new Error('雲端硬碟中尚未有頻道備份檔 (avd_channels_backup.json)');
      }

      const fileId = searchData.files[0].id;
      const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${tokenOrPath}` }
      });

      if (!downloadRes.ok) {
        throw new Error(`下載雲端備份失敗: HTTP ${downloadRes.status}`);
      }

      return await downloadRes.text();
    }
  },

  async getSharedUrl() {
    if (!isTauri()) return YoutubeDlPlugin.getSharedUrl();
    return { url: null };
  },

  async startLocalServer() {
    if (!isTauri()) return YoutubeDlPlugin.startLocalServer();
    return invoke('start_win_local_server');
  },

  async stopLocalServer() {
    if (!isTauri()) return YoutubeDlPlugin.stopLocalServer();
    return invoke('stop_win_local_server');
  },

  /**
   * 主畫面網路狀態探測：打固定的 generate_204 端點，只有取得預期回應才視為 online。
   *
   * 刻意不拋出例外——任何失敗（連線層、逾時、非預期回應）一律回傳 false，
   * 由呼叫端（`useNetworkStatus`）依此區分 online 與 degraded，
   * 與個別請求失敗後的事後分類（`rateLimit.ts` 的 `isDeviceOfflineError`）
   * 是兩件獨立的事，見 show-network-status/design.md 的 Non-Goals。
   */
  async probeInternetConnectivity(timeoutMs: number): Promise<boolean> {
    try {
      if (!isTauri()) {
        const res = await YoutubeDlPlugin.probeInternetConnectivity({ timeoutMs });
        return !!res?.online;
      }
      return await invoke<boolean>('probe_internet_connectivity', { timeoutMs });
    } catch (e) {
      return false;
    }
  },

  async isTvDevice(): Promise<{ isTv: boolean }> {
    if (!isTauri()) {
      try {
        return await YoutubeDlPlugin.isTvDevice();
      } catch (e) {
        return { isTv: false };
      }
    }
    return { isTv: false };
  },

  /**
   * 解析一組影片的直播狀態，回傳 `videoId → 狀態` 的對照表。
   *
   * 一律走 API 批次查詢（單次最多 50 支、僅 1 unit）。逐支 yt-dlp 查詢的
   * 降級路徑已移除 —— 那條路徑倚賴自錯誤訊息推測直播狀態，會因工具版本
   * 或措辭變動而失效，且無法區分「已知為直播」與「查不到」。
   *
   * 批次失敗時該批一律停在 `'unknown'`，並把錯誤分類上報（使配額耗盡與
   * 金鑰無效能觸發抑制）。`'unknown'` 是保守處置：那些影片會阻擋錨點、
   * 下輪重新評估，MUST NOT 樂觀視為 `'not_live'` —— 錯放一支未開播的
   * 直播進佇列，下載必然失敗。
   */
  async resolveLiveStatuses(
    videos: { videoId: string; url: string }[],
    options?: { api?: ChannelApiOptions }
  ): Promise<Map<string, LiveCheckResult>> {
    const list = videos || [];
    if (list.length === 0) return new Map();

    const api = options?.api;
    const blocked = trackingBlockedReason(api);
    if (blocked || !api) {
      // 追蹤停擺：全部維持 unknown（阻擋錨點、下輪重新評估）。
      // 呼叫端已於 fetchChannelVideos 取得同一原因並回報，此處不重複上報。
      return new Map(list.map(v => [v.videoId, 'unknown' as LiveCheckResult]));
    }

    const errors: unknown[] = [];
    const map = await resolveLiveStatusesViaApi(
      list.map(v => v.videoId),
      api.apiKey,
      countedApiFetch(api),
      e => errors.push(e)
    );

    if (errors.length > 0) {
      for (const e of errors) {
        api.onError?.(classifyApiError(e));
        // 這些失敗不向使用者提示，但它們會讓影片停在狀態未定而阻擋錨點推進
        // —— 屬「改變了結果」，故仍須入帳，否則使用者只看得到「沒有新影片」。
        api.onFailure?.('直播狀態批次查詢', e);
      }
      console.warn(`直播狀態批次查詢有 ${errors.length} 批失敗，該批影片維持狀態未定，下輪重新評估`);
    }

    return map;
  },

  /**
   * 取得頻道最新影片。**只有 YouTube Data API 一條通道。**
   *
   * 未設有效金鑰（或金鑰無效、配額耗盡的抑制生效中）時 MUST 拋出可辨識的
   * 停擺錯誤，MUST NOT 回傳空清單 —— 空清單會被上層當成「這個頻道沒有
   * 新影片」，使追蹤完全停止卻毫無徵狀，正是移除備援後最需要防止的假陽性。
   */
  async fetchChannelVideos(
    channelId: string,
    options: { api?: ChannelApiOptions }
  ): Promise<MonitoredVideoResult[]> {
    const api = options?.api;
    const blocked = trackingBlockedReason(api);
    if (blocked || !api) throw trackingUnavailableError(blocked ?? 'missing_key');

    try {
      const { videos, uploadsPlaylistId } = await fetchChannelVideosViaApi(
        channelId, api.apiKey, countedApiFetch(api), api.uploadsPlaylistId
      );
      api.onResolved?.(uploadsPlaylistId);
      return videos;
    } catch (e: any) {
      // 分類後交由呼叫端決定抑制與回饋，錯誤本身照常上拋 —— 已無備援可降級。
      // 刻意不記錄 request 物件 —— 金鑰在標頭中，不得被順帶寫進日誌。
      api.onError?.(classifyApiError(e));
      throw e;
    }
  },

  /**
   * 以 API 取得頻道名稱，供加入頻道與既有頻道的名稱修復使用。
   *
   * 查詢失敗一律回傳空字串而非拋錯：名稱屬輔助資訊，MUST NOT 成為加入
   * 頻道的阻礙 —— 呼叫端沿用既有退回行為（以使用者輸入作為暫時名稱），
   * 並於後續檢查成功時修復。
   */
  async fetchChannelTitle(channelId: string, options?: { api?: ChannelApiOptions }): Promise<string> {
    const api = options?.api;
    if (!api || trackingBlockedReason(api)) return '';

    try {
      const json = await countedApiFetch(api)(buildChannelSnippetRequest(channelId, api.apiKey));
      return convertCnToTw(parseChannelTitle(json));
    } catch (e: any) {
      // 名稱查詢與影片擷取共用同一把金鑰，故此處的失敗同樣值得觸發抑制
      api.onError?.(classifyApiError(e));
      // 不向使用者提示（名稱取不到不阻擋加入頻道），但頻道會停留在以網址
      // 為名的狀態 —— 那是使用者看得到的結果差異，故須入帳。
      api.onFailure?.('取得頻道名稱', e);
      return '';
    }
  },

  async resolveYouTubeChannel(input: string): Promise<{ channelId: string; title?: string; thumbnail?: string }> {
    const raw = input.trim();
    if (!raw) throw new Error('請輸入頻道網址或 ID');

    // 1. Android 行動端：直接調用原生外掛（支援 HttpURLConnection 高速讀取與 youtubedl-android）
    if (!isTauri()) {
      try {
        const res = await YoutubeDlPlugin.resolveChannel({ input: raw });
        if (res && res.channelId) {
          let resolvedTitle = res.title ? convertCnToTw(res.title) : undefined;
          // 防護：如果原生外掛回傳的 title 其實是頻道 ID，視為無效
          if (resolvedTitle && resolvedTitle.startsWith('UC') && resolvedTitle.length === 24) {
            resolvedTitle = undefined;
          }
          return {
            channelId: res.channelId,
            title: resolvedTitle,
            thumbnail: res.thumbnail || undefined
          };
        }
      } catch (e: any) {
        throw new Error(e.message || String(e));
      }
    }

    // 2. Windows 桌面端
    // 若已經是 UC 開頭的 Channel ID
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(raw)) {
      return { channelId: raw };
    }

    // 若為 https://www.youtube.com/channel/UCxxxx
    const matchChannel = raw.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i);
    if (matchChannel && matchChannel[1]) {
      return { channelId: matchChannel[1] };
    }

    // 若為 Handle 網址 (如 https://www.youtube.com/@channelName) 或 @handle
    let targetUrl = raw;
    if (raw.startsWith('@')) {
      targetUrl = `https://www.youtube.com/${raw}`;
    } else if (!raw.startsWith('http')) {
      targetUrl = `https://www.youtube.com/@${raw}`;
    }

    // 桌面端透過 yt-dlp --flat-playlist -J 獲取精準 channel_id
    if (isTauri()) {
      try {
        const cmd = Command.sidecar('bin/yt-dlp', ['--flat-playlist', '-J', '--playlist-end', '1', targetUrl]);
        const out = await cmd.execute();
        if (out.code === 0 && out.stdout.trim()) {
          const data = JSON.parse(out.stdout.trim());
          const cid = data.channel_id || (data.uploader_id?.startsWith('UC') ? data.uploader_id : '') || '';
          let title = data.uploader || data.channel || data.title || '';
          
          // 如果 yt-dlp 抓到的 title 剛好是 ID，將其清空，由後方網頁爬蟲取得真實名稱
          if (title === cid || title === data.uploader_id || (title.startsWith('UC') && title.length === 24)) {
            title = '';
          }

          if (cid.startsWith('UC') && title) {
            let thumbnail: string | undefined = data.thumbnail || undefined;
            if (!thumbnail && data.thumbnails && Array.isArray(data.thumbnails)) {
              const avatar = data.thumbnails.find((t: any) => t.id === 'avatar_uncropped') 
                || data.thumbnails.filter((t: any) => t.id && !String(t.id).includes('banner')).pop()
                || data.thumbnails[data.thumbnails.length - 1];
              if (avatar && avatar.url) thumbnail = avatar.url;
            }
            return {
              channelId: cid,
              title: convertCnToTw(title),
              thumbnail
            };
          }
        }
      } catch (e) {
        console.warn('yt-dlp resolve channelId fallback to fetch', e);
      }
    }

    // Fallback 嘗試讀取網頁內容擷取 channelId 與 title
    try {
      let text = '';
      if (isTauri()) {
        text = await invoke<string>('fetch_http_text', { url: targetUrl });
      } else {
        const resp = await fetch(targetUrl);
        if (resp.ok) {
          text = await resp.text();
        }
      }
      if (text) {
        const m1 = text.match(/"channelId":\s*"(UC[a-zA-Z0-9_-]{22})"/);
        const m2 = text.match(/<meta\s+itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{22})"/);
        const cid = (m1 && m1[1]) ? m1[1] : (m2 && m2[1] ? m2[1] : '');
        
        if (cid) {
          let title = '';
          const tMatch = text.match(/<meta\s+property="og:title"\s+content="(.*?)"/);
          if (tMatch && tMatch[1]) {
            title = tMatch[1];
          } else {
            const titleMatch = text.match(/<title>(.*?) - YouTube<\/title>/);
            if (titleMatch && titleMatch[1]) {
              title = titleMatch[1];
            }
          }
          let thumbnail: string | undefined = undefined;
          const imgMatch = text.match(/<meta\s+property="og:image"\s+content="(.*?)"/);
          if (imgMatch && imgMatch[1]) {
            thumbnail = imgMatch[1];
          }

          return { channelId: cid, title: title ? convertCnToTw(title) : undefined, thumbnail };
        }
      }
    } catch (e) {
      console.warn('Fetch web page failed', e);
    }

    throw new Error('無法識別 YouTube 頻道 ID，請確認頻道網址或直接提供 channel/UC... 連結');
  },

  async updateYtDlp(): Promise<string> {
    if (!isTauri()) return 'Android 會自動維護 yt-dlp';
    try {
      return await invoke<string>('update_yt_dlp');
    } catch (e: any) {
      throw new Error(`yt-dlp 更新失敗: ${e.message || String(e)}`);
    }
  },

  async getYtDlpVersion(): Promise<string> {
    if (!isTauri()) return 'Nightly (Android)';
    try {
      return await invoke<string>('get_yt_dlp_version');
    } catch (e: any) {
      console.warn('獲取 yt-dlp 版本失敗', e);
      return 'Unknown';
    }
  }
};

