/**
 * 顯示字串的格式化：發布時間與任務標題。
 *
 * 刻意獨立成一個沒有平台相依的模組。這兩個函式原本分別位於
 * `DownloadService.ts`（匯入 `@tauri-apps/*` 與 `@capacitor/core`）與
 * `App.vue`（單檔元件），兩處都讓 vitest 引用不到 —— 與先前
 * `matchPermanentError`、`parseProgressKey` 是同一個問題。
 *
 * 原始定義處改為自本模組轉出，既有的匯入路徑不受影響。
 */

/**
 * 將時間戳格式化為 `YYYY/MM/DD HH:mm:ss`。
 *
 * 數值小於 1e11 時視為 Unix 秒（否則視為毫秒）—— 此門檻約當
 * 西元 5138 年的秒數與 1973 年的毫秒數，兩者不會混淆。
 * 無效輸入回傳空字串，由呼叫端決定退路。
 */
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

/**
 * 組出任務在佇列上顯示的標題：`[頻道名] 影片標題 (發布時間)`。
 *
 * 必須是冪等的 —— 下載過程中會以既有標題為輸入重複呼叫（進度更新、
 * 完成事件），若每次都疊加前綴或時間，標題會愈長愈畸形。故先自
 * `rawTitle` 剝出既有的前綴與時間標記，再統一重組；剝出的值在呼叫端
 * 未提供對應參數時作為後備。
 */
export const buildTaskDisplayTitle = (
  rawTitle?: string,
  channelPrefix?: string,
  publishTimeStr?: string
): string => {
  let title = (rawTitle || '').trim();

  if (title) {
    // 檢查並提取前綴 [頻道名]
    const prefixMatch = title.match(/^\[([^\]]+)\]\s*/);
    if (prefixMatch) {
      if (!channelPrefix) channelPrefix = prefixMatch[1];
      title = title.replace(/^\[[^\]]+\]\s*/, '').trim();
    }
    // 檢查並提取發布時間標記
    const timeMatch = title.match(/\s*(\(\d{4}\/\d{2}\/\d{2}[^\)]*\))$/);
    if (timeMatch) {
      if (!publishTimeStr) publishTimeStr = timeMatch[1].replace(/[()]/g, '').trim();
      title = title.replace(/\s*\(\d{4}\/\d{2}\/\d{2}[^\)]*\)$/, '').trim();
    }
  }

  let finalTitle = title;
  if (channelPrefix && channelPrefix.trim()) {
    const cleanPrefix = channelPrefix.trim();
    if (!finalTitle.startsWith(`[${cleanPrefix}]`)) {
      finalTitle = `[${cleanPrefix}] ${finalTitle}`;
    }
  }
  if (publishTimeStr && publishTimeStr.trim()) {
    const cleanTime = publishTimeStr.trim().replace(/[()]/g, '');
    if (!finalTitle.includes(`(${cleanTime})`)) {
      finalTitle = `${finalTitle} (${cleanTime})`;
    }
  }

  return finalTitle.trim();
};
