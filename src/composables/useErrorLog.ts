/**
 * 錯誤日誌：讓失敗訊息在提示消失之後仍可回看與複製。
 *
 * 系統原本有兩種命運完全不同的錯誤呈現 —— 下載任務的失敗留在卡片上，
 * 其餘一律只有一則 2 秒的 toast。後者在 Android 上等於看不到，也抄不下來。
 *
 * 本模組只放純函式（環狀裁切與格式化），持久化與提示由 `App.vue` 承接。
 * 這是 `parseScope.ts`、`fileNaming.ts`、`displayFormat.ts` 之後第四次
 * 採用同一模式：純邏輯不與有平台相依的模組混居，否則測試引用不到。
 */

/** 日誌保留的最大筆數。約 15 KB，足以涵蓋一輪驗證或一次批次下載的失敗。 */
export const ERROR_LOG_LIMIT = 50;

/** 一筆錯誤紀錄。 */
export interface ErrorEntry {
  /** 發生時間（毫秒） */
  time: number;
  /** 操作情境，例如「解析播放清單」 */
  context: string;
  /** 錯誤訊息原文，不截斷 */
  message: string;
}

/**
 * 附加一筆紀錄並維持保留上限，回傳新陣列。
 *
 * 回傳新陣列而非就地修改：呼叫端是持久化的 `Ref`，替換整個值才會觸發寫入。
 */
export function appendErrorEntry(
  entries: ErrorEntry[],
  entry: ErrorEntry,
  limit = ERROR_LOG_LIMIT
): ErrorEntry[] {
  const next = [...(entries || []), entry];
  const max = Math.max(1, limit);
  // 超出上限時捨棄最舊者
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 將時間格式化為日誌用的 `YYYY/MM/DD HH:mm:ss`。 */
function stamp(time: number): string {
  const d = new Date(time);
  if (isNaN(d.getTime())) return '時間不明';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 轉為供複製的純文字，最新的在最上面。
 *
 * 刻意不用 JSON：複製出來的內容是給人讀、給對話貼的，JSON 的引號與
 * 跳脫字元只會讓它更難讀。
 */
export function formatErrorLog(entries: ErrorEntry[]): string {
  const list = entries || [];
  if (list.length === 0) return '目前沒有錯誤紀錄';

  return [...list]
    .reverse()
    .map(e => `[${stamp(e.time)}] ${e.context}\n${e.message}`)
    .join('\n\n');
}

/** 依時間由新至舊排列，供檢視畫面使用。 */
export function sortedForDisplay(entries: ErrorEntry[]): ErrorEntry[] {
  return [...(entries || [])].reverse();
}
