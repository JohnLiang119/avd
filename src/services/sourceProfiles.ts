/**
 * 媒體來源能力表 —— 「這個網址是什麼、要怎麼處理」的單一真相。
 *
 * 此前這些判斷散在五個互不相干的位置（`isPlaylistUrl`、`isCreatorPageUrl`、
 * `parseProgressKey`、項目網址組法兩處，以及根本不存在的 metadata 完整度），
 * 每接一個新平台都要記得改五處。歷史證明會漏，也會留下假的 ——
 * Bilibili 空間頁明明支援卻沒被辨識，Douyin 使用者頁明明不支援卻留著判定。
 *
 * 加新來源只需在 `SOURCE_PROFILES` 增加一筆。
 */

/**
 * 來源的性質。
 *
 * `unsupported` 是刻意保留的第三態：既不假裝支援（讓使用者撞上困惑的失敗），
 * 也不直接移除（讓它被當成單一影片，失敗得同樣困惑），而是明確表達
 * 「已知不支援」，使 App 能給出清楚的訊息。
 */
export type SourceKind = 'collection' | 'single' | 'unsupported';

/**
 * 清單解析結果是否已含可供選片的資訊（標題、片長、發布時間）。
 *
 * 只有兩檔而非三檔：實測結果非黑即白 —— TikTok 的 entry 給 26 個欄位、
 * Bilibili 只給 3 個（`id` / `url` / `ie_key`）。硬造一個 `partial` 檔位
 * 沒有實測依據，需要時再加。
 */
export type FlatMetadata = 'full' | 'none';

export interface SourceProfile {
  /** 穩定識別，用於測試與日誌 */
  id: string;
  /** 使用者可見的名稱，用於訊息 */
  label: string;
  kind: SourceKind;
  /** 此網址是否屬於本來源 */
  match(url: string): boolean;
  /** 自網址取出穩定的續抓進度鍵 */
  progressKey(url: string): string;
  /** 啟動解析前是否須徵詢確認（高成本的創作者頁面） */
  needsPreParseConfirm: boolean;
  /** 清單解析結果的資訊完整度，決定是否啟動補齊階段 */
  flatMetadata: FlatMetadata;
  /**
   * 是否可加入自動追蹤。
   *
   * 追蹤機制綁定 YouTube 的官方 RSS，故僅 YouTube 頻道成立。呼叫端仍需
   * 自行排除子頁面（`/watch`、`/playlist`）—— 那是網址形狀的問題，
   * 與來源本身的能力無關。
   */
  supportsChannelTracking: boolean;
  /** 由解析結果組出項目網址；未提供則直接採用 entry 自帶的網址 */
  buildItemUrl?(videoId: string, entry: any, sourceUrl: string): string;
}

/** 去除查詢字串後的網址，作為無專屬規則時的進度鍵。 */
const stripQuery = (url: string) => url.split('?')[0];

/** 自網址擷取第一個符合的擷取群組。 */
const capture = (url: string, re: RegExp): string => (url.match(re) || [])[1] || '';

/**
 * 由解析結果組出 TikTok 的正式影片網址。
 *
 * yt-dlp 的 TikTok entry 實際上已直接帶完整網址（`TikTokUserIE` 以
 * `_create_url()` 產生 `https://www.tiktok.com/@{user}/video/{id}`），
 * 故此處只處理它沒帶的退化情形：`tiktok.com/video/{id}` 不被 TikTok
 * extractor 接受，會落入 generic extractor 並導向 404。
 *
 * 只取 `uploader`：實測 `channel` 是顯示名稱（如「冰冷（小号冲一万）」）、
 * `uploader_id` 是純數字，兩者拿來組網址都是錯的。
 */
function buildTikTokVideoUrl(videoId: string, entry: any, sourceUrl: string): string {
  const fromEntry = entry?.uploader || '';
  const fromSource = capture(sourceUrl, /tiktok\.com\/@([\w.\-]+)/);
  const handle = String(fromEntry || fromSource).replace(/^@/, '').trim();
  // 兩個來源都取不到時保留舊格式，結果不會比現況更差。
  return handle
    ? `https://www.tiktok.com/@${handle}/video/${videoId}`
    : `https://www.tiktok.com/video/${videoId}`;
}

/**
 * 註冊表。**依序比對、首個命中者生效**，故順序有意義：
 *
 * - `tiktok-user` 置於 `youtube-playlist` 之前，以保留原
 *   `parseProgressKey` 中 TikTok 優先於 `list=` 的判定順序。
 * - `youtube-playlist` 必須先於 fallback，否則
 *   `watch?v=x&list=PL...` 會被當成單一影片 —— 既有行為是視為清單。
 *
 * 此順序依賴以測試釘住。
 */
export const SOURCE_PROFILES: SourceProfile[] = [
  {
    id: 'tiktok-user',
    label: 'TikTok 創作者頁',
    kind: 'collection',
    match: url => url.includes('tiktok.com/@'),
    progressKey: url => `tiktok:@${capture(url, /tiktok\.com\/@([\w.\-]+)/)}`,
    needsPreParseConfirm: true,
    flatMetadata: 'full',
    supportsChannelTracking: false,
    buildItemUrl: buildTikTokVideoUrl,
  },
  {
    id: 'douyin-user',
    label: '抖音使用者頁',
    // yt-dlp 沒有 Douyin 使用者頁 extractor —— 實測 `douyin.com/user/` 落入
    // generic。此前這裡有判定卻無實作，命中後只會產生令人困惑的失敗。
    kind: 'unsupported',
    match: url => url.includes('douyin.com/user/'),
    progressKey: url => `douyin:${capture(url, /douyin\.com\/user\/([\w.\-]+)/)}`,
    needsPreParseConfirm: true,
    flatMetadata: 'full',
    supportsChannelTracking: false,
  },
  {
    id: 'douyin-short',
    label: '抖音分享連結',
    kind: 'collection',
    match: url => url.includes('v.douyin.com'),
    progressKey: stripQuery,
    needsPreParseConfirm: false,
    flatMetadata: 'full',
    supportsChannelTracking: false,
    buildItemUrl: (videoId) => `https://www.douyin.com/video/${videoId}`,
  },
  {
    id: 'youtube-playlist',
    label: 'YouTube 播放清單',
    kind: 'collection',
    match: url => /[?&]list=/.test(url),
    progressKey: url => `yt:list:${capture(url, /[?&]list=([\w\-]+)/)}`,
    needsPreParseConfirm: false,
    flatMetadata: 'full',
    supportsChannelTracking: false,
  },
  {
    id: 'youtube-channel',
    label: 'YouTube 頻道',
    // `/c/` 為既有的寬鬆比對（不限定網域），刻意維持原樣 ——
    // 收緊屬行為變更，應另案評估。
    kind: 'collection',
    match: url => url.includes('/channel/') || url.includes('/c/'),
    progressKey: url => {
      const id = capture(url, /\/channel\/([\w\-]+)/);
      return id ? `yt:channel:${id}` : stripQuery(url);
    },
    // YouTube 頻道有自己的兩段式確認（加入追蹤 → 掃描明細），不走此旗標。
    needsPreParseConfirm: false,
    flatMetadata: 'full',
    supportsChannelTracking: true,
  },
  {
    id: 'youtube-handle',
    label: 'YouTube 頻道',
    kind: 'collection',
    match: url => url.includes('youtube.com/@') && !url.includes('/watch'),
    progressKey: url => `yt:@${capture(url, /youtube\.com\/@([\w.\-]+)/)}`,
    needsPreParseConfirm: false,
    flatMetadata: 'full',
    supportsChannelTracking: true,
  },
];

/** 未命中任何來源時的退路：視為單一影片，照常處理。 */
export const FALLBACK_PROFILE: SourceProfile = {
  id: 'generic-single',
  label: '影片',
  kind: 'single',
  match: () => true,
  progressKey: stripQuery,
  needsPreParseConfirm: false,
  flatMetadata: 'full',
  supportsChannelTracking: false,
};

/** 依序比對，回傳首個命中的來源；皆未命中則回傳 fallback。 */
export function resolveSourceProfile(url: string): SourceProfile {
  const target = url || '';
  return SOURCE_PROFILES.find(p => p.match(target)) || FALLBACK_PROFILE;
}
