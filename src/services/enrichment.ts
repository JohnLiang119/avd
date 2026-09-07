/**
 * 清單項目 metadata 的補齊階段。
 *
 * 部分來源的 `--flat-playlist` 結果只有網址 —— 實測 Bilibili 空間頁的
 * entry 只有 `id` / `url` / `ie_key` 三個欄位，對照 TikTok 的 26 個。
 * 勾選對話框因而只能顯示「影片 1」「影片 2」，使用者等於瞎選。
 *
 * 補齊是**列表之後的第二階段**，性質與列表相反：
 *
 *   列表  必須成功、受 90 秒總時長約束、失敗即整體失敗、快速失敗
 *   補齊  可局部失敗、自有預算、失敗僅保留退化標籤、對限流退避重試
 *
 * 本模組只放純函式（分塊、NDJSON 解析、結果合併），實際執行與平台
 * 相依的部分留在 DownloadService。
 */

import { formatPublishTime } from './displayFormat';

/**
 * 每塊的網址數。
 *
 * 取小值有三個理由：漸進回填需要中途就有結果；限流需要塊間節流；
 * 取消需要有中斷點。實測 Bilibili 在 5 個連續請求下已有 3 個被 412，
 * 故初值保守。
 */
export const ENRICH_CHUNK_SIZE = 5;

/** 塊與塊之間的節流間隔（毫秒）。 */
export const ENRICH_THROTTLE_MS = 1000;

/**
 * 補齊的自有時間預算（毫秒）。
 *
 * 與列表階段的 PARSE_TIMEOUT_MS 分開：補齊在勾選對話框已顯示之後才跑，
 * 使用者不是在空等，故可以寬鬆得多。超出即停止並保留已取得的結果。
 */
export const ENRICH_BUDGET_MS = 120000;

/** 補齊取得的單筆資訊。欄位缺漏即代表該筆補不到，呼叫端保留退化標籤。 */
export interface EnrichedItem {
  id: string;
  title?: string;
  durationStr?: string;
  publishTimeStr?: string;
}

/** 可被補齊的清單項目（`PlaylistItem` 的結構子集）。 */
export interface EnrichableItem {
  id: string;
  url: string;
  title: string;
  durationStr?: string;
}

/** 將網址切成固定大小的塊。 */
export function chunkUrls(urls: string[], size = ENRICH_CHUNK_SIZE): string[][] {
  const step = Math.max(1, Math.floor(size) || 1);
  const out: string[][] = [];
  for (let i = 0; i < (urls || []).length; i += step) {
    out.push(urls.slice(i, i + step));
  }
  return out;
}

/** 由秒數組出 `m:ss` 形式的片長，與 parsePlaylist 的既有格式一致。 */
function formatDuration(seconds: unknown): string | undefined {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) return undefined;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * 解析 `--dump-json` 的 NDJSON 輸出（每行一個 JSON 物件）。
 *
 * 無法解析的行直接略過 —— 補齊是增益，一行壞掉不該讓整塊作廢。
 * 時間解析優先序與下載路徑一致：`timestamp`（秒）→ `upload_date`。
 */
export function parseEnrichNdjson(ndjson: string): EnrichedItem[] {
  const out: EnrichedItem[] = [];
  for (const raw of String(ndjson || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const id = obj?.id ? String(obj.id) : '';
    if (!id) continue;

    let publishTimeStr: string | undefined;
    if (typeof obj.timestamp === 'number' && obj.timestamp > 0) {
      publishTimeStr = formatPublishTime(obj.timestamp * 1000) || undefined;
    } else if (obj.upload_date && String(obj.upload_date).length === 8) {
      const d = String(obj.upload_date);
      publishTimeStr = `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)} 00:00:00`;
    }

    out.push({
      id,
      title: obj.title ? String(obj.title) : undefined,
      durationStr: formatDuration(obj.duration),
      publishTimeStr,
    });
  }
  return out;
}

/**
 * 將補齊結果併回清單。
 *
 * **id 序列必須保持不變** —— 勾選狀態以 id 記錄，換掉序列會讓已勾選的
 * 項目對不上。故只更新欄位、不新增不刪除不重排。
 *
 * 補不到的項目原樣保留（退化標籤），仍可勾選與下載 —— 補齊是增益，
 * 不是前提。
 */
export function mergeEnriched<T extends EnrichableItem>(items: T[], enriched: EnrichedItem[]): T[] {
  const byId = new Map<string, EnrichedItem>();
  for (const e of enriched || []) {
    if (e?.id) byId.set(e.id, e);
  }
  if (byId.size === 0) return items || [];

  return (items || []).map(item => {
    const hit = byId.get(item.id);
    if (!hit) return item;
    const title = hit.title
      ? (hit.publishTimeStr ? `${hit.title} (${hit.publishTimeStr})` : hit.title)
      : item.title;
    return { ...item, title, durationStr: hit.durationStr || item.durationStr };
  });
}

/** 目前是否仍在預算之內。 */
export function withinBudget(startedAt: number, now: number, budgetMs = ENRICH_BUDGET_MS): boolean {
  return now - startedAt < budgetMs;
}
