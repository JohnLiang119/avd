import { resolveSourceProfile } from './sourceProfiles';

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
 * 規則本身由來源能力表宣告（`sourceProfiles.ts`）—— 此處僅委派，
 * 以維持既有的匯入路徑。不能直接拿輸入網址當鍵：分享出來的網址帶有
 * 每次都不同的追蹤參數（如 `?_r=1&_t=ZS-99RJ3WEDUOH`），會讓同一個
 * 創作者每次分享都被當成新來源。
 */
export function parseProgressKey(url: string): string {
  return resolveSourceProfile(url).progressKey(url || '');
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

/** 序列識別與來源鍵之間的分隔符。 */
export const SEQUENCE_SEPARATOR = '/';

/** 單序列來源在進度表中使用的序列識別（空字串，鍵即為來源鍵本身）。 */
export const SINGLE_SEQUENCE = '';

/** 組出某序列在進度表中的鍵。 */
export function sequenceProgressKey(sourceKey: string, sequence: string): string {
  return sequence ? `${sourceKey}${SEQUENCE_SEPARATOR}${sequence}` : sourceKey;
}

/** 某來源目前的進度概觀。 */
export interface SourceProgressView {
  /** 各序列的進度。單序列來源以 `SINGLE_SEQUENCE` 為識別。 */
  sequences: Record<string, ParseProgress>;
  /** 已抓筆數合計 */
  total: number;
  /** 是否有任何進度紀錄 */
  hasAny: boolean;
  /** 是否所有已知序列皆已抓完 */
  allComplete: boolean;
}

/**
 * 自完整進度表取出某來源的進度。
 *
 * 多序列來源**只認帶序列識別的鍵**，不帶識別的舊格式鍵直接忽略 ——
 * 那是本變更之前寫下的單一純量進度，其數值對任何一個序列都沒有意義
 * （見 design D6）。忽略等同於「沒抓過」，該來源會從頭抓一次，
 * 重複的項目本就由既有的去重過濾吸收。刻意不寫遷移邏輯。
 */
export function collectSourceProgress(
  all: Record<string, ParseProgress> | undefined,
  sourceKey: string,
  multiSequence: boolean
): SourceProgressView {
  const table = all || {};
  const sequences: Record<string, ParseProgress> = {};

  if (multiSequence) {
    const prefix = sourceKey + SEQUENCE_SEPARATOR;
    for (const key of Object.keys(table)) {
      if (key.startsWith(prefix)) {
        sequences[key.slice(prefix.length)] = table[key];
      }
    }
  } else if (table[sourceKey]) {
    sequences[SINGLE_SEQUENCE] = table[sourceKey];
  }

  const entries = Object.values(sequences);
  return {
    sequences,
    total: entries.reduce((sum, p) => sum + (p?.fetched || 0), 0),
    hasAny: entries.length > 0,
    // 所有已知序列皆抓完才算抓完 —— 只要有一個還沒完，來源就還沒完。
    allComplete: entries.length > 0 && entries.every(p => p?.complete),
  };
}

/** 取出尚未抓完的序列及其已抓筆數，供續抓決定各自的範圍。 */
export function pendingSequences(view: SourceProgressView): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [seq, p] of Object.entries(view.sequences)) {
    if (!p?.complete) out[seq] = p?.fetched || 0;
  }
  return out;
}

/**
 * 依本批各序列的回傳筆數推進進度，回傳更新後的完整進度表。
 *
 * 回傳新物件而非就地修改：呼叫端是持久化的 Ref，替換整個值才會觸發寫入。
 */
export function applySequenceResults(
  all: Record<string, ParseProgress> | undefined,
  sourceKey: string,
  before: Record<string, number>,
  returns: Record<string, number>,
  batchSize = PARSE_BATCH_SIZE
): Record<string, ParseProgress> {
  const next = { ...(all || {}) };
  for (const [seq, returned] of Object.entries(returns)) {
    const prior = before[seq] || 0;
    next[sequenceProgressKey(sourceKey, seq)] = advanceParseProgress(prior, returned, batchSize);
  }
  return next;
}

/** 清除某來源的所有進度（含各序列），供「從頭開始」使用。 */
export function resetSourceProgress(
  all: Record<string, ParseProgress> | undefined,
  sourceKey: string,
  multiSequence: boolean
): Record<string, ParseProgress> {
  const next = { ...(all || {}) };
  delete next[sourceKey];
  if (multiSequence) {
    const prefix = sourceKey + SEQUENCE_SEPARATOR;
    for (const key of Object.keys(next)) {
      if (key.startsWith(prefix)) delete next[key];
    }
  }
  return next;
}

/**
 * 供事前確認對話框使用的範圍說明。
 *
 * 多序列來源不報單一合計數字 —— 「200」對它的意義是「每序列 200」，
 * 只說一個總數會讓使用者以為那是全部（見 design D6 的風險項）。
 */
export function describeNextBatch(
  view: SourceProgressView,
  multiSequence: boolean,
  batchSize = PARSE_BATCH_SIZE
): string {
  if (!multiSequence) {
    const fetched = view.sequences[SINGLE_SEQUENCE]?.fetched || 0;
    return `第 ${fetched + 1}–${fetched + batchSize} 部`;
  }

  const pending = pendingSequences(view);
  const names = Object.keys(pending);
  if (names.length === 0) {
    return `每個分頁的前 ${batchSize} 部`;
  }
  return names
    .map(seq => `${seq} 第 ${pending[seq] + 1}–${pending[seq] + batchSize} 部`)
    .join('、');
}

/** 各序列已抓進度的摘要，如 `videos 117（已完）、shorts 200`。 */
export function describeProgress(view: SourceProgressView, multiSequence: boolean): string {
  if (!multiSequence) return `${view.total} 部`;
  const parts = Object.entries(view.sequences)
    .map(([seq, p]) => `${seq} ${p.fetched}${p.complete ? '（已完）' : ''}`);
  return parts.length ? `${parts.join('、')}，合計 ${view.total} 部` : `${view.total} 部`;
}
