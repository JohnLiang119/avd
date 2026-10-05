/**
 * yt-dlp 每日自動更新的觸發策略（純函式，方便測試）。
 *
 * 背景：下載前會做「每日首次」的核心引擎自我更新。更新需連 GitHub，
 * 在網路慢或被擋的環境會逾時失敗；若失敗後每次下載都再試一次，
 * 使用者每次按下載都要先等整段逾時才會開始，體感就是「沒反應」。
 * 因此失敗後在一段冷卻時間內不再嘗試，直接以現有版本下載。
 */

/** 今日日期鍵（與 localStorage 的 yt_dlp_last_update_check 同格式：YYYY-MM-DD） */
export function todayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().split('T')[0];
}

/** 更新失敗後的冷卻時間：1 小時內不再嘗試 */
export const YT_DLP_UPDATE_RETRY_COOLDOWN_MS = 60 * 60 * 1000;

export interface YtDlpUpdateCheckInput {
  /** 目前時間（epoch ms） */
  now: number;
  /** 上次成功更新的日期鍵（YYYY-MM-DD），無則 null */
  lastSuccessDate: string | null;
  /** 上次「嘗試」更新的時間（epoch ms），無則 null；成功與失敗都算嘗試 */
  lastAttemptAt: number | null;
}

/**
 * 是否該在這次下載前嘗試更新 yt-dlp。
 * - 今天已成功更新過 → 不用
 * - 距上次嘗試不到冷卻時間（代表剛失敗/逾時過）→ 不用
 * - 其他 → 要
 */
export function shouldAttemptYtDlpUpdate(input: YtDlpUpdateCheckInput): boolean {
  if (input.lastSuccessDate === todayKey(input.now)) return false;
  if (
    input.lastAttemptAt !== null &&
    Number.isFinite(input.lastAttemptAt) &&
    input.now - input.lastAttemptAt < YT_DLP_UPDATE_RETRY_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

/** 解析 localStorage 存的嘗試時間戳；無效值視為 null */
export function parseAttemptTimestamp(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
