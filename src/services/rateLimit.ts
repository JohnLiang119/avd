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
export type ChannelRssErrorLevel = 'network' | 'server' | 'content';

function errorMessageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

/** 將頻道 RSS 邊界層傳回的錯誤前綴轉成前端可用的錯誤層級。 */
export function classifyChannelRssError(error: unknown): ChannelRssErrorLevel {
  const message = errorMessageOf(error);
  if (/NETWORK_ERROR:/i.test(message)) return 'network';
  if (/HTTP_STATUS:\d+:/i.test(message)) return 'server';
  return 'content';
}

/** 從 `HTTP_STATUS:<code>:` 前綴取出 HTTP 狀態碼；非伺服器層錯誤回傳 0。 */
export function channelRssHttpStatus(error: unknown): number {
  const match = /HTTP_STATUS:(\d+):/i.exec(errorMessageOf(error));
  return match ? Number(match[1]) : 0;
}

/**
 * 頻道 RSS 各類錯誤的重試等待時間表（毫秒陣列，長度即重試次數，空陣列代表不重試）。
 *
 * 刻意**不**沿用 `RATE_LIMIT_BASE_DELAY_MS` 那組 2s→4s→8s —— 那是 yt-dlp 下載/解析
 * 路徑面對來源限流（429/412）的時間尺度，套到頻道 RSS 上會讓每個失敗頻道白等 14 秒。
 * 2026-09-08 實測：11 個頻道全數失敗的一輪耗時約 160 秒，其中絕大部分是這段等待。
 *
 * 分層依據（各層的錯誤性質完全不同，不該共用同一張表）：
 * - `network`：DNS 解析失敗／連線被拒幾乎即刻拋出，重試多次無望；但保留一次短重試以
 *   容忍 Wi-Fi 重連之類的瞬斷。
 * - 404／410：實測證實 YouTube RSS 端點會回**隨機的假 404**，重試 1-2 次即可取得 200，
 *   所以重試方向正確，錯的只是等待長度 —— 壓到累計約 1.1 秒。
 * - 其餘伺服器層（5xx、403、逾時）：較可能是真的暫時性狀況，值得多等一些。
 * - `content`：XML 解析失敗屬單一頻道的資料問題，重試不會有不同結果。
 */
export const CHANNEL_RSS_RETRY_DELAYS_MS = {
  network: [500],
  notFound: [300, 800],
  server: [1000, 3000],
  content: [] as number[],
} as const;

/** 依錯誤決定本次應採用的重試等待時間表。 */
export function channelRssRetryDelays(error: unknown): number[] {
  const level = classifyChannelRssError(error);
  if (level === 'network') return [...CHANNEL_RSS_RETRY_DELAYS_MS.network];
  if (level === 'content') return [...CHANNEL_RSS_RETRY_DELAYS_MS.content];
  const status = channelRssHttpStatus(error);
  return status === 404 || status === 410
    ? [...CHANNEL_RSS_RETRY_DELAYS_MS.notFound]
    : [...CHANNEL_RSS_RETRY_DELAYS_MS.server];
}

/** 依頻道 RSS 失敗層級產生通知文案；network 不提供無效的備援建議。 */
export function describeChannelRssFailure(
  level: ChannelRssErrorLevel,
  options: { fallbackEnabled?: boolean; compact?: boolean } = {}
): string {
  if (level === 'network') {
    return '目前無法連線（裝置未連上網路）';
  }
  if (options.compact) {
    return options.fallbackEnabled ? '無法連線' : 'RSS 異常';
  }
  return options.fallbackEnabled
    ? '無法連線至 YouTube 頻道 (官方 RSS 與備援均失敗)'
    : '官方 RSS 連線異常 (可於設定中開啟 yt-dlp 備援)';
}

/**
 * 頻道檢查因裝置網路層錯誤提早停止時的總結文案。
 *
 * 與 `describeChannelRssFailure` 刻意分開、措辭不同：後者代表「已檢查、確認失敗」，
 * 這裡代表「尚未檢查」——兩者混用會讓使用者誤以為被跳過的頻道也實際檢查過。
 */
export function describeEarlyStop(skippedCount: number): string {
  return `本輪已提早結束，尚有 ${skippedCount} 個頻道未檢查（裝置目前無法連線）`;
}

/**
 * 本輪連續失敗達門檻後改為「單次嘗試」模式的門檻值。
 *
 * 刻意用「降級」而非 `break` 整輪停止：若使用者清單前段有數個永久失效的頻道，
 * 整輪停止會讓後段健康的頻道每一輪都檢查不到（被餓死）。降級後所有頻道仍被走訪，
 * 只是不再為每個失敗頻道支付重試等待。
 */
export const CHANNEL_CHECK_DEGRADE_AFTER_FAILURES = 2;

/** 本輪已降級為單次嘗試時的補充說明，接在失敗總結之後。 */
export function describeDegradedRound(degradedCount: number): string {
  return `已改為快速模式檢查其餘 ${degradedCount} 個頻道（不重試）`;
}

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
