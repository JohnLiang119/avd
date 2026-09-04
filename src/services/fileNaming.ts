/**
 * 下載檔案的命名規則。
 *
 * 獨立於平台 API，可被 vitest 引用 —— Android 端維持各自的 Java 實作，
 * 兩者的對照案例以本檔的測試為準（見 design D3）。
 */

/** 標題在檔名中保留的最大字元數。 */
export const FILENAME_TITLE_MAX = 30;

/** 檔名碰撞時的最大嘗試次數，避免病態情形下的無窮迴圈。 */
export const FILENAME_COLLISION_MAX_TRIES = 100;

/** Windows 與 Android 皆不允許出現在檔名中的字元。 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * 將標題轉為可用於檔名的字串：去除非法字元、截斷、去掉尾端的句點與空白。
 *
 * 尾端句點必須去除 —— Windows 不接受以句點結尾的檔名。
 */
export function sanitizeTitleForFile(title: string): string {
  let s = (title || '').replace(ILLEGAL_FILENAME_CHARS, '_');
  if (s.length > FILENAME_TITLE_MAX) s = s.slice(0, FILENAME_TITLE_MAX);
  return s.trim().replace(/\.+$/, '').trim();
}

/**
 * 將發布時間格式化為檔名用的時間戳 `yyyyMMdd_HHmmss`。
 *
 * 刻意不用 `yyyy-MM-dd HH:mm:ss`：冒號是 Windows 的非法檔名字元，
 * 空白在跨平台的腳本處理中易生麻煩。無分隔符的形式天然可排序。
 *
 * 取不到有效時間時回傳空字串，由呼叫端決定退路。
 */
export function formatFileTimestamp(publishTimeMs?: number): string {
  if (!publishTimeMs || !isFinite(publishTimeMs) || publishTimeMs <= 0) return '';
  const d = new Date(publishTimeMs);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 組出下載檔案的名稱主體（不含副檔名）。
 *
 * 一律帶入發布時間：TikTok／Douyin 的標題即描述文字，同一創作者的多支影片
 * 經常完全相同，只用標題必然碰撞。時間取影片的發布時間而非下載時間 ——
 * 後者對使用者無意義，且同一批下載會落在極相近的秒數內。
 *
 * 以雙底線分隔，讓標題與時間戳的界線清楚（單底線在標題中很常見，
 * 非法字元正是被替換成單底線）。
 */
export function buildDownloadFileName(title: string, publishTimeMs?: number): string {
  const base = sanitizeTitleForFile(title);
  const stamp = formatFileTimestamp(publishTimeMs);
  if (base && stamp) return `${base}__${stamp}`;
  if (base) return base;
  if (stamp) return `video_${stamp}`;
  return `video_${Date.now()}`;
}

/**
 * 尋找一個尚未被占用的檔名。
 *
 * 碰撞絕不得使下載失敗，故以遞增後綴取得可用名稱，而非中止。
 * `exists` 由呼叫端注入（Tauri 的檔案系統、Android 的 MediaStore 等），
 * 使本函式與平台無關。
 *
 * 超過嘗試上限時退回附加時間戳的名稱，確保一定回傳可用結果。
 */
export async function nextAvailableName(
  base: string,
  ext: string,
  exists: (fileName: string) => boolean | Promise<boolean>,
  maxTries = FILENAME_COLLISION_MAX_TRIES
): Promise<string> {
  const suffix = ext ? `.${ext}` : '';

  if (!(await exists(base + suffix))) return base + suffix;

  for (let i = 1; i <= maxTries; i++) {
    const candidate = `${base}_${i}${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  return `${base}_${Date.now()}${suffix}`;
}
