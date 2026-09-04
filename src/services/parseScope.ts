/**
 * 解析階段的界限與批次範圍計算。
 *
 * 刻意獨立成一個沒有平台相依的模組：DownloadService 匯入了
 * `@tauri-apps/*` 與 `@capacitor/core`，直接在其中宣告純函式會讓測試
 * 無法引用（先前 matchPermanentError 就是因宣告位置而測不到）。
 */

/** 解析階段的總時長上限（毫秒）。由前端負責計時，兩平台共用同一個數字。 */
export const PARSE_TIMEOUT_MS = 90000;

/** 解析被取消時使用的錯誤訊息，與下載階段的取消區分開來。 */
export const PARSE_CANCELLED = 'PARSE_CANCELLED_BY_USER';

/**
 * 單次解析的抓取上限。
 *
 * 實測某 TikTok 帳號全抓為 3247 筆／2 分 18 秒，取 200 筆則為 11 秒。
 * 此上限同時是勾選對話框（無虛擬列表）與任務樹的合理邊界。
 * 超出的部分不丟棄，由來源進度記錄後分批續抓。
 */
export const PARSE_BATCH_SIZE = 200;

/**
 * 將來源網址正規化為穩定的進度鍵。
 *
 * 不能直接拿輸入網址當鍵：分享出來的網址帶有每次都不同的追蹤參數
 * （如 `?_r=1&_t=ZS-99RJ3WEDUOH`），會讓同一個創作者每次分享都被當成新來源。
 */
export function parseProgressKey(url: string): string {
  const tiktok = url.match(/tiktok\.com\/@([\w.\-]+)/);
  if (tiktok) return `tiktok:@${tiktok[1]}`;

  const list = url.match(/[?&]list=([\w\-]+)/);
  if (list) return `yt:list:${list[1]}`;

  const channel = url.match(/\/channel\/([\w\-]+)/);
  if (channel) return `yt:channel:${channel[1]}`;

  const ytHandle = url.match(/youtube\.com\/@([\w.\-]+)/);
  if (ytHandle) return `yt:@${ytHandle[1]}`;

  const douyin = url.match(/douyin\.com\/user\/([\w.\-]+)/);
  if (douyin) return `douyin:${douyin[1]}`;

  return url.split('?')[0];
}

/**
 * 依已抓筆數組出本批的 yt-dlp 範圍參數。
 *
 * 首批用 `--playlist-end N`；續抓用 `--playlist-items {start}-{end}`。
 * 實測兩者邊界無縫接續（第 200 筆的 id 與第 201 筆相鄰）。
 */
export function buildPlaylistRangeArgs(fetched: number, batchSize = PARSE_BATCH_SIZE): string[] {
  const start = Math.max(0, Math.floor(fetched) || 0) + 1;
  if (start === 1) return ['--playlist-end', String(batchSize)];
  return ['--playlist-items', `${start}-${start + batchSize - 1}`];
}

/** 單一來源的解析進度。 */
export interface ParseProgress {
  /** 已抓過的筆數，決定下一批的起點 */
  fetched: number;
  /** 是否已抓到該來源結尾（某批回傳筆數少於上限） */
  complete: boolean;
}

/**
 * 依本批實際回傳的筆數推進進度。
 *
 * 推進量取回傳筆數而非使用者勾選數 —— 沒勾選的也算看過了，
 * 否則下一批會重複抓到同一段。
 */
export function advanceParseProgress(
  before: number,
  returned: number,
  batchSize = PARSE_BATCH_SIZE
): ParseProgress {
  const safeBefore = Math.max(0, before || 0);
  const safeReturned = Math.max(0, returned || 0);
  return {
    fetched: safeBefore + safeReturned,
    complete: safeReturned < batchSize
  };
}
