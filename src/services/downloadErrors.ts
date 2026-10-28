/**
 * 下載錯誤的分類判定。
 *
 * 自 `App.vue` 抽出：原本宣告於單檔元件內，屬純邏輯卻無法被測試引用
 * （`fix-live-stream-handling` 任務 4.7c 已記錄此問題）。
 */

/**
 * 重試必然再次失敗的確定性錯誤。
 *
 * yt-dlp 不提供結構化的錯誤代碼，只能比對訊息文字。此清單刻意只納入語意
 * 明確、不可能因網路狀況而出現的訊息 —— 誤判會讓使用者失去自動重試，
 * 代價高於漏判。若日後 yt-dlp 改變措辭導致漏判，行為會退回「照常重試」，
 * 即現況，不會產生新故障。
 *
 * 清單的意義是「確定性錯誤不重試」這條通則，不是逐一列舉已知錯誤。
 */
export const PERMANENT_DOWNLOAD_ERRORS = [
  'requested format is not available',
  'video unavailable',
  'private video',
  'members-only',
  'join this channel',
  'this live event will begin in',
  // 檔名碰撞為 100% 確定性，重試毫無意義。取子字串以容忍括號內文字變動。
  // 修正 fix-filename-collision 後理論上不再出現，保留作為通則的防禦。
  '檔案已存在',
] as const;

/** 這兩種訊息在本專案的情境中幾乎必然來自直播或尚未開播的影片 */
export const LIVE_RELATED_ERRORS = [
  'requested format is not available',
  'this live event will begin in',
] as const;

/**
 * YouTube 依 IP 信譽做的 bot 驗證（「Sign in to confirm you’re not a bot」）。
 *
 * 2026-10-28 以 adb 實測：同一份 yt-dlp、同樣的 player client，手機走 4G
 * （行動網路共用 IP）對剛上架的影片 6/6 次被擋，切到 WiFi 立即成功。
 * 此錯誤綁定網路 IP，與 App 或 yt-dlp 版本無關，在同一網路下重試必然再被擋，
 * 而且每次重試都會多打一輪 player API，只會讓共用 IP 更快被標記。
 *
 * YouTube 文案使用彎引號（’），比對前由 `normalizeQuotes` 統一為直引號。
 */
export const BOT_CHECK_ERRORS = [
  "sign in to confirm you're not a bot",
] as const;

/** 命中 bot 驗證時呈現給使用者的訊息，取代 yt-dlp 的英文 cookies 指引 */
export const BOT_CHECK_USER_MESSAGE =
  'YouTube 要求登入驗證（判定為機器人），通常是行動網路共用 IP 所致，請改用 WiFi 或稍後再試';

/** 把 YouTube 文案的彎引號統一為直引號，讓清單只需維護一種寫法 */
const normalizeQuotes = (s: string): string => s.replace(/[‘’]/g, "'");

/**
 * 判定一則錯誤訊息是否為確定性錯誤，以及是否與直播相關或為 bot 驗證。
 *
 * `liveRelated` 或 `botCheck` 為真時，呼叫端應給予專屬訊息，而非顯示暗示
 * 問題為暫時性的「已自動重試 N 次」。
 */
export const matchPermanentError = (
  msg: string,
): { permanent: boolean; liveRelated: boolean; botCheck: boolean } => {
  const lower = normalizeQuotes((msg || '').toLowerCase());
  const botCheck = BOT_CHECK_ERRORS.some(k => lower.includes(k));
  return {
    permanent: botCheck || PERMANENT_DOWNLOAD_ERRORS.some(k => lower.includes(k)),
    liveRelated: LIVE_RELATED_ERRORS.some(k => lower.includes(k)),
    botCheck,
  };
};

