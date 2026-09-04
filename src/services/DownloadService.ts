import { registerPlugin } from '@capacitor/core';
import { Command, open } from '@tauri-apps/plugin-shell';
import { downloadDir, tempDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readTextFile, writeTextFile, rename, remove, exists, stat } from '@tauri-apps/plugin-fs';
import * as OpenCC from 'opencc-js';
import { PARSE_CANCELLED, buildPlaylistRangeArgs } from './parseScope';

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
  return window.hasOwnProperty('__TAURI_INTERNALS__');
};

export const formatPublishTime = (timestamp?: number | string | Date): string => {
  if (!timestamp) return '';
  let date: Date;
  if (typeof timestamp === 'number') {
    date = timestamp < 1e11 ? new Date(timestamp * 1000) : new Date(timestamp);
  } else if (typeof timestamp === 'string') {
    if (/^\d+$/.test(timestamp)) {
      const num = parseInt(timestamp, 10);
      date = num < 1e11 ? new Date(num * 1000) : new Date(num);
    } else {
      date = new Date(timestamp);
    }
  } else {
    date = timestamp;
  }

  if (!date || isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
};

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
 * 由解析結果組出 TikTok 的正式影片網址。
 *
 * yt-dlp 的 TikTok entry 實際上已直接帶完整網址（其 TikTokUserIE 以
 * `https://www.tiktok.com/@{user}/video/{id}` 建立 entry），故此處只處理
 * 它沒帶的退化情形：`tiktok.com/video/{id}` 不被 TikTok extractor 接受，
 * 會落入 generic extractor 並導向 404，必須帶上 `@handle` 區段。
 *
 * Douyin 不需要對應處理 —— 實測 `douyin.com/video/{id}` 可正確進入
 * Douyin extractor。
 */
function buildTikTokVideoUrl(videoId: string, entry: any, sourceUrl: string): string {
  // 只取 uploader：實測 channel 是顯示名稱（如「冰冷（小号冲一万）」）、
  // uploader_id 是純數字 id，兩者拿來組網址都會組出錯的。
  const fromEntry = entry?.uploader || '';
  const fromSource = (sourceUrl.match(/tiktok\.com\/@([\w.\-]+)/) || [])[1] || '';
  const handle = String(fromEntry || fromSource).replace(/^@/, '').trim();
  // 兩個來源都取不到時保留舊格式，結果不會比現況更差。
  return handle
    ? `https://www.tiktok.com/@${handle}/video/${videoId}`
    : `https://www.tiktok.com/video/${videoId}`;
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
async function runParseCommand(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
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
  source: 'rss' | 'fallback';
}

/**
 * 判斷一筆 yt-dlp 備援結果是否來自頻道的 Live 分頁。
 *
 * yt-dlp 抓取 /channel/{id} 時會遍歷該頻道存在的各分頁，`playlist` 欄位格式為
 * 「{頻道名} - {分頁名}」（如 `Lofi Girl - Live`）。
 *
 * 刻意不使用 `playlist.includes('Live')`：頻道名稱本身含 "Live" 時會誤殺
 * （例如 `Live Music - Videos`），因此改為比對分頁名後綴。
 *
 * 也刻意不採用 `was_live === true` 作為判準，原因有二：
 *   1. 實測顯示 Live 分頁影片的 `was_live` 為 `false`，該條件對此用途完全無效。
 *   2. `was_live` 指的是「該影片是否為已結束的直播存檔」；這類影片若出現在
 *      Videos 分頁，官方 RSS 是會涵蓋的，濾掉反而與 RSS 的範圍不一致。
 */
function isLiveTabEntry(entry: any): boolean {
  const playlist = typeof entry?.playlist === 'string' ? entry.playlist : '';
  return /\s-\sLive$/.test(playlist.trim());
}

/**
 * 將一筆 yt-dlp 備援結果轉為 MonitoredVideoResult。
 *
 * 時間解析優先序：`timestamp`（Unix 秒）→ `upload_date`（YYYYMMDD）→ `0`。
 * 兩者皆無時回傳 `0` 而非當下時間，交由呼叫端判斷是否推進基準。
 */
function mapFallbackEntry(entry: any): MonitoredVideoResult {
  const videoId = entry?.id || '';
  const url = entry?.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

  let pubTime = 0;
  if (typeof entry?.timestamp === 'number' && entry.timestamp > 0) {
    pubTime = entry.timestamp * 1000;
  } else if (entry?.upload_date && String(entry.upload_date).length === 8) {
    const str = String(entry.upload_date);
    const parsed = new Date(`${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T00:00:00Z`).getTime();
    if (Number.isFinite(parsed)) pubTime = parsed;
  }

  return {
    videoId,
    title: convertCnToTw(entry?.title || ''),
    published: pubTime ? new Date(pubTime).toISOString() : '',
    publishedTime: pubTime,
    url,
    source: 'fallback' as const,
  };
}

/**
 * 將備援回傳的 NDJSON（每行一個 JSON 物件）轉為最新影片清單。
 * 濾除 Live 分頁後依發布時間由新至舊排序，再取前 `limit` 筆。
 */
function parseFallbackNdjson(ndjson: string, limit = 2): MonitoredVideoResult[] {
  const entries = ndjson
    .trim()
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line.trim());
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry: any) => !isLiveTabEntry(entry));

  if (entries.length === 0) return [];

  return entries
    .map(mapFallbackEntry)
    .sort((a, b) => b.publishedTime - a.publishedTime)
    .slice(0, limit);
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
  async parsePlaylist(url: string, options?: { fetched?: number }): Promise<PlaylistResult> {
    // 每次解析都重置取消旗標，避免前一次的取消殘留影響本次。
    isParseCancelling = false;
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

      const processEntries = async (entriesData: any[]): Promise<PlaylistItem[]> => {
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
            if (url.includes('douyin.com')) {
              itemUrl = `https://www.douyin.com/video/${itemUrl}`;
            } else if (url.includes('tiktok.com')) {
              itemUrl = buildTikTokVideoUrl(itemUrl, entry, url);
            } else {
              itemUrl = `https://www.youtube.com/watch?v=${itemUrl}`;
            }
          }
          if (!itemUrl) {
            if (url.includes('douyin.com')) {
              itemUrl = `https://www.douyin.com/video/${videoId}`;
            } else if (url.includes('tiktok.com')) {
              itemUrl = buildTikTokVideoUrl(videoId, entry, url);
            } else {
              itemUrl = `https://www.youtube.com/watch?v=${videoId}`;
            }
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

      const items = await processEntries(initialEntries);

      return {
        channelTitle,
        playlistTitle,
        items
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
      if (timestampNum) {
        pubTimeStr = formatPublishTime(timestampNum * 1000);
      } else if (uploadDate && String(uploadDate).length === 8) {
        const str = String(uploadDate);
        const y = str.slice(0, 4);
        const m = str.slice(4, 6);
        const d = str.slice(6, 8);
        pubTimeStr = `${y}/${m}/${d} 00:00:00`;
      }

      // 2. 檔名化 (去除非法衝突字元 \ / : * ? " < > | 且限制前 30 字)
      let cleanFileName = fullTitle.replace(/[\\/:*?"<>|]/g, '_');
      if (cleanFileName.length > 30) {
        cleanFileName = cleanFileName.slice(0, 30);
      }
      cleanFileName = cleanFileName.trim().replace(/\.+$/, '');
      if (!cleanFileName) {
        cleanFileName = `video_${Date.now()}`;
      }

      // 3. 重複檔名檢測與重新命名
      let downloadedFilePath = tempFilePath;

      try {
        let targetFileName = `${cleanFileName}.${ext}`;
        let candidatePath = `${targetDirPath}/${targetFileName}`;
        let counter = 1;

        // 避免重複檔名覆蓋
        while (await exists(candidatePath)) {
          targetFileName = `${cleanFileName}_${counter}.${ext}`;
          candidatePath = `${targetDirPath}/${targetFileName}`;
          counter++;
        }

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
   * 查詢影片是否為直播中或排程尚未開播。
   *
   * 兩平台的判準一致：`is_live` 與 `is_upcoming` 皆視為直播而應排除。
   * 尚未開播的排程直播不存在任何可下載格式，放行必然導致下載失敗。
   *
   * 刻意回傳三態而非布林：`'unknown'` 代表查詢本身失敗、無從判定。
   * 呼叫端據此得知該影片並未被實際處理，不應讓頻道的時間錨點越過它，
   * 以便下次檢查重新評估。
   */
  async checkVideoLiveStatus(url: string): Promise<LiveCheckResult> {
    try {
      let status = '';

      if (isTauri()) {
        const cmd = Command.sidecar('bin/yt-dlp', [
          '--print', 'live_status',
          '--skip-download',
          url
        ]);
        const output = await cmd.execute();
        status = output.stdout.trim();
      } else {
        const res = await YoutubeDlPlugin.checkVideoLiveStatus({ url });
        status = (res?.liveStatus || '').trim();
      }

      const normalized = status.toLowerCase();
      if (!normalized) return 'unknown';
      return normalized === 'is_live' || normalized === 'is_upcoming' ? 'live' : 'not_live';
    } catch (e) {
      console.warn(`檢查直播狀態失敗 (${url}):`, e);
      return 'unknown';
    }
  },

  async fetchYouTubeRss(
    channelId: string,
    options?: { enableFallback?: boolean }
  ): Promise<MonitoredVideoResult[]> {
    try {
      let xmlText = '';
      if (!isTauri()) {
        // Android 端使用原生外掛繞過 WebView CORS 限制
        const res = await YoutubeDlPlugin.fetchChannelRss({ channelId });
        xmlText = res.xml || '';
      } else {
        // Windows/桌面端調用 Rust 原生 HTTP 請求通道，繞過 WebView CORS 限制
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
        xmlText = await invoke<string>('fetch_http_text', { url: rssUrl });
      }

      if (!xmlText) throw new Error('頻道 RSS 內容為空');

      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const entries = Array.from(doc.querySelectorAll('entry'));
      
      return entries.map(entry => {
        const outer = entry.outerHTML || '';
        
        let videoId = (entry.getElementsByTagName('yt:videoId')[0] || entry.getElementsByTagName('videoId')[0] || entry.querySelector('videoId'))?.textContent || '';
        if (!videoId && outer) {
          const match = outer.match(/<(?:yt:)?videoId>([^<]+)<\/(?:yt:)?videoId>/i);
          if (match) videoId = match[1];
        }

        let rawTitle = (entry.getElementsByTagName('title')[0] || entry.querySelector('title'))?.textContent || '';
        if (!rawTitle && outer) {
          const match = outer.match(/<title>([^<]+)<\/title>/i);
          if (match) rawTitle = match[1];
        }

        let published = (entry.getElementsByTagName('published')[0] || entry.querySelector('published') || entry.getElementsByTagName('updated')[0])?.textContent || '';
        if (!published && outer) {
          const match = outer.match(/<published>([^<]+)<\/published>/i) || outer.match(/<updated>([^<]+)<\/updated>/i);
          if (match) published = match[1];
        }

        const linkEl = entry.getElementsByTagName('link')[0] || entry.querySelector('link');
        let url = linkEl?.getAttribute('href') || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

        let pubTime = 0;
        if (published) {
          pubTime = new Date(published).getTime();
        }
        if (!pubTime || isNaN(pubTime)) {
          pubTime = Date.now();
        }

        return {
          videoId,
          title: convertCnToTw(rawTitle),
          published: published || new Date(pubTime).toISOString(),
          publishedTime: pubTime,
          url,
          source: 'rss' as const
        };
      });
    } catch (e: any) {
      if (!options?.enableFallback) {
        throw new Error(`官方 RSS 連線失敗: ${e.message || String(e)}`);
      }

      console.warn(`官方 RSS 失敗 (${channelId})，已啟用備援機制，嘗試啟動 yt-dlp 備援...`, e);
      if (isTauri()) {
        try {
          const jsonString = await invoke<string>('fetch_channel_videos_fallback', { channelId });
          const videos = parseFallbackNdjson(jsonString);
          if (videos.length === 0) {
            throw new Error('yt-dlp 未回傳任何有效影片資料');
          }
          return videos;
        } catch (fallbackError: any) {
          console.error(`yt-dlp 備援也失敗 (${channelId}):`, fallbackError);
          throw new Error(`獲取頻道 RSS 失敗: 官方 RSS 與 yt-dlp 備援均失敗. 原錯誤: ${e.message}`);
        }
      } else {
        try {
          // Android 端備援：改用專用的 fetchChannelVideosFallback。
          // 先前使用 parsePlaylist，其內部以 --flat-playlist 執行而無法取得發布時間，
          // 只能一律填入當下時間，正是造成追蹤基準被污染的來源。
          const res = await YoutubeDlPlugin.fetchChannelVideosFallback({ channelId });
          const videos = parseFallbackNdjson(res?.ndjson || '');
          if (videos.length === 0) {
            throw new Error('Android 備援未回傳任何有效影片資料');
          }
          return videos;
        } catch (fallbackError: any) {
          console.error(`Android 備援也失敗 (${channelId}):`, fallbackError);
          throw new Error(`獲取頻道 RSS 失敗: 官方 RSS 與 Android 備援均失敗. 原錯誤: ${e.message}`);
        }
      }
    }
  },

  // 從 YouTube RSS feed 的 <title> 取得頻道名稱
  async fetchChannelTitleFromRss(channelId: string): Promise<string> {
    try {
      let xmlText = '';
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
      if (!isTauri()) {
        const res = await YoutubeDlPlugin.fetchChannelRss({ channelId });
        xmlText = res.xml || '';
      } else {
        xmlText = await invoke<string>('fetch_http_text', { url: rssUrl });
      }
      if (xmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'application/xml');
        // RSS feed 根層的 <title> 就是頻道名稱
        const feedTitleEl = doc.querySelector('feed > title');
        if (feedTitleEl && feedTitleEl.textContent) {
          return convertCnToTw(feedTitleEl.textContent);
        }
      }
    } catch (e) {
      console.warn('fetchChannelTitleFromRss failed:', e);
    }
    return '';
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

