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

/**
 * 限流的**間接徵狀**：來源不回 HTTP 狀態碼，而是回一個內容殘缺的頁面，
 * 使 extractor 抽不到必要欄位。
 *
 * 實證（2026-09-04 同一日內）：
 *   Windows  @bingleng8888888  抽不出 secondary user ID
 *   Windows  @tiktok（官方）    同一錯誤 —— 官方帳號不可能是私人
 *   Windows  @bingleng8888888  稍後重試成功，3247 筆
 *   Android  @lq5325155        明確的 HTTP 429
 *   Android  @ttggwang         抽不出 secondary user ID
 *   Windows  @ttggwang         同一時段從另一 IP 打，完全正常
 *
 * 官方帳號也中、同一帳號稍後就好、換 IP 就正常 —— 三者合起來只有
 * 「被擋」解釋得通。yt-dlp 併發的「account is either private or has
 * embedding disabled」警告對公開帳號一樣會出現，是同一個被擋頁面的產物。
 *
 * **但成因有歧義**：真正的私人帳號也可能產生同一則訊息。故此類徵狀
 * 退避重試的處置與明確限流相同，對使用者的措辭則不可一口咬定原因。
 */
const THROTTLE_SYMPTOM_PHRASES = [
  'unable to extract secondary user id',
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

/** 判定一則錯誤訊息是否為**明確**的來源限流（帶 HTTP 狀態碼）。 */
export function isRateLimited(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return RATE_LIMIT_PHRASES.some(p => lower.includes(p));
}

/** 判定一則錯誤訊息是否為限流的間接徵狀（成因有歧義）。 */
export function isThrottleSymptom(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return THROTTLE_SYMPTOM_PHRASES.some(p => lower.includes(p));
}

/**
 * 是否應退避重試。明確限流與間接徵狀的處置相同 —— 兩者都會自行解除，
 * 差別只在對使用者怎麼說。
 */
export function shouldBackoff(message: string): boolean {
  return isRateLimited(message) || isThrottleSymptom(message);
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
 * 給使用者看的訊息。原始訊息不在此改寫 —— 它仍會原樣寫入錯誤紀錄，
 * 使「使用者看到友善訊息」與「開發者拿得到原文」兩者並存。
 *
 * 明確限流與間接徵狀給不同措辭：前者知道原因，後者不知道，
 * 不該假裝知道。
 */
export function describeRateLimit(message?: string): string {
  if (message !== undefined && !isRateLimited(message) && isThrottleSymptom(message)) {
    return '暫時無法取得此來源的資料（可能是請求過於頻繁，或該內容不公開），請稍後再試';
  }
  return '來源暫時限流（請求過於頻繁），請稍後再試';
}
