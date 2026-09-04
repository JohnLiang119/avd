/**
 * 來源限流的辨識與退避。
 *
 * 限流（HTTP 429／412）與「影片不存在」「私人影片」等永久性失敗性質不同 ——
 * 它會隨時間自行解除。若被歸入確定性錯誤而立即放棄，使用者會看到一長串
 * 技術訊息並以為程式壞了；正確的處置是稍後再試。
 *
 * 此為「列表階段快速失敗」原則的明確例外，且**僅**適用於限流類狀況。
 */

/**
 * 限流的判斷片語。
 *
 * yt-dlp 不提供結構化的錯誤代碼，只能比對訊息文字 —— 與
 * `downloadErrors.ts` 出於同一理由採取相同作法。
 *
 * 清單只收語義明確者：誤判的代價只是多等十餘秒，不會產生錯誤結果。
 */
const RATE_LIMIT_PHRASES = [
  '429',
  'too many requests',
  '412',
  'precondition failed',
] as const;

/** 退避的初始間隔（毫秒）。 */
export const RATE_LIMIT_BASE_DELAY_MS = 2000;

/**
 * 退避重試的次數上限。
 *
 * 2s → 4s → 8s，累計 14 秒。此值受解析階段的 PARSE_TIMEOUT_MS（90 秒）
 * 約束 —— 14 秒在其中仍有充裕餘裕，不會讓退避本身把逾時撐爆。
 */
export const RATE_LIMIT_MAX_RETRIES = 3;

/** 判定一則錯誤訊息是否為來源限流。 */
export function isRateLimited(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return RATE_LIMIT_PHRASES.some(p => lower.includes(p));
}

/**
 * 第 `attempt` 次重試前應等待的毫秒數（`attempt` 自 1 起算）。
 * 超出次數上限時回傳 `0`，表示不應再重試。
 */
export function rateLimitBackoffMs(
  attempt: number,
  maxRetries = RATE_LIMIT_MAX_RETRIES,
  base = RATE_LIMIT_BASE_DELAY_MS
): number {
  if (attempt < 1 || attempt > maxRetries) return 0;
  return base * Math.pow(2, attempt - 1);
}

/** 累計退避時間，供呼叫端確認不會撐爆總時長上限。 */
export function totalBackoffMs(
  maxRetries = RATE_LIMIT_MAX_RETRIES,
  base = RATE_LIMIT_BASE_DELAY_MS
): number {
  let sum = 0;
  for (let i = 1; i <= maxRetries; i++) sum += rateLimitBackoffMs(i, maxRetries, base);
  return sum;
}

/**
 * 給使用者看的限流訊息。
 *
 * 原始訊息不在此改寫 —— 它仍會原樣寫入錯誤紀錄，使「使用者看到友善訊息」
 * 與「開發者拿得到原文」兩者並存。
 */
export function describeRateLimit(): string {
  return '來源暫時限流（請求過於頻繁），請稍後再試';
}
