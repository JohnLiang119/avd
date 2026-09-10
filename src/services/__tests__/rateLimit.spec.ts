import { describe, it, expect } from 'vitest';
import {
  isRateLimited,
  isThrottleSymptom,
  shouldBackoff,
  rateLimitBackoffMs,
  totalBackoffMs,
  describeRateLimit,
  isDeviceOfflineError,
  describeEarlyStop,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_BASE_DELAY_MS
} from '../rateLimit';
import { matchPermanentError } from '../downloadErrors';
import { PARSE_TIMEOUT_MS } from '../parseScope';

describe('isRateLimited', () => {
  it('辨識實機回報的 TikTok 429', () => {
    // 使用者於 Android v1.0.71 的錯誤紀錄實錄
    expect(isRateLimited(
      'ERROR: lq5325155: Unable to download JSON metadata: HTTP Error 429: ' +
      'Too Many Requests (caused by <HTTPError 429: Too Many Requests>)'
    )).toBe(true);
  });

  it('辨識實測的 Bilibili 412', () => {
    expect(isRateLimited(
      'ERROR: [BiliBili] 181t46eEZm: Unable to download webpage: ' +
      'HTTP Error 412: Precondition Failed (caused by <HTTPError 412: Precondition Failed>)'
    )).toBe(true);
    expect(isRateLimited('Request is blocked by server (412), please wait and try later.')).toBe(true);
  });

  it('不分大小寫', () => {
    expect(isRateLimited('TOO MANY REQUESTS')).toBe(true);
    expect(isRateLimited('Precondition Failed')).toBe(true);
  });

  it('非限流的失敗不命中', () => {
    for (const msg of [
      'ERROR: [youtube] Video unavailable',
      'ERROR: Private video',
      'ERROR: Requested format is not available',
      'ERROR: [tiktok:user] Unable to extract secondary user ID',
      'ERROR: HTTP Error 404: Not Found',
      '',
    ]) {
      expect(isRateLimited(msg), msg).toBe(false);
    }
  });

  it('null 與 undefined 不拋例外', () => {
    expect(isRateLimited(null as any)).toBe(false);
    expect(isRateLimited(undefined as any)).toBe(false);
  });
});

describe('限流與確定性錯誤互斥', () => {
  it('限流不得被歸入確定性錯誤 —— 它會自行解除', () => {
    // 釘住這條關係：日後若有人「順手」把 429 加進 PERMANENT_DOWNLOAD_ERRORS，
    // 使用者會失去退避重試，而該錯誤其實只要等一下就好。
    for (const msg of [
      'HTTP Error 429: Too Many Requests',
      'HTTP Error 412: Precondition Failed',
    ]) {
      expect(isRateLimited(msg), msg).toBe(true);
      expect(matchPermanentError(msg).permanent, msg).toBe(false);
    }
  });

  it('確定性錯誤不得被誤認為限流', () => {
    for (const msg of ['ERROR: Video unavailable', 'ERROR: Private video', '檔案已存在 (重複)']) {
      expect(matchPermanentError(msg).permanent, msg).toBe(true);
      expect(isRateLimited(msg), msg).toBe(false);
    }
  });
});

describe('rateLimitBackoffMs', () => {
  it('指數退避 2s → 4s → 8s', () => {
    expect(rateLimitBackoffMs(1)).toBe(2000);
    expect(rateLimitBackoffMs(2)).toBe(4000);
    expect(rateLimitBackoffMs(3)).toBe(8000);
  });

  it('超出次數上限回傳 0，表示不應再重試', () => {
    expect(rateLimitBackoffMs(RATE_LIMIT_MAX_RETRIES + 1)).toBe(0);
    expect(rateLimitBackoffMs(99)).toBe(0);
  });

  it('無效的次數回傳 0', () => {
    expect(rateLimitBackoffMs(0)).toBe(0);
    expect(rateLimitBackoffMs(-1)).toBe(0);
  });

  it('次數與初值可調整', () => {
    expect(rateLimitBackoffMs(1, 2, 500)).toBe(500);
    expect(rateLimitBackoffMs(2, 2, 500)).toBe(1000);
    expect(rateLimitBackoffMs(3, 2, 500)).toBe(0);
  });
});

describe('totalBackoffMs', () => {
  it('累計為 14 秒', () => {
    expect(totalBackoffMs()).toBe(14000);
  });

  it('累計退避須遠低於解析階段的總時長上限，否則退避本身會撐爆逾時', () => {
    expect(totalBackoffMs()).toBeLessThan(PARSE_TIMEOUT_MS / 2);
  });
});

describe('describeRateLimit', () => {
  it('訊息說明是暫時性且可再試，不含技術細節', () => {
    const msg = describeRateLimit();
    expect(msg).toContain('稍後再試');
    expect(msg).not.toMatch(/429|412|HTTP|Error/);
  });
});

describe('限流的間接徵狀', () => {
  // 使用者於 Android v1.0.72 的錯誤紀錄實錄
  const SYMPTOM =
    'ERROR: [tiktok:user] ttggwang: Unable to extract secondary user ID. ' +
    'If you are able to get the channel_id from a video posted by this user, ' +
    'try using "tiktokuser:channel_id" as the input URL';

  it('辨識為徵狀，但不是明確的限流', () => {
    expect(isThrottleSymptom(SYMPTOM)).toBe(true);
    expect(isRateLimited(SYMPTOM)).toBe(false);
  });

  it('與明確限流同樣退避重試', () => {
    expect(shouldBackoff(SYMPTOM)).toBe(true);
    expect(shouldBackoff('HTTP Error 429: Too Many Requests')).toBe(true);
  });

  it('不得被歸入確定性錯誤 —— 同一帳號稍後即可成功', () => {
    expect(matchPermanentError(SYMPTOM).permanent).toBe(false);
  });

  it('訊息誠實反映成因的歧義，不斷言為單一原因', () => {
    const msg = describeRateLimit(SYMPTOM);
    expect(msg).toContain('請求過於頻繁');
    expect(msg).toContain('不公開');
    expect(msg).toContain('稍後再試');
  });

  it('明確限流仍給確定的措辭，不混入歧義', () => {
    const msg = describeRateLimit('HTTP Error 429: Too Many Requests');
    expect(msg).toContain('請求過於頻繁');
    expect(msg).not.toContain('不公開');
  });

  it('未提供訊息時退回明確限流的措辭', () => {
    expect(describeRateLimit()).toContain('請求過於頻繁');
  });

  it('一般失敗既非限流也非徵狀', () => {
    for (const msg of ['ERROR: Video unavailable', 'ERROR: HTTP Error 404: Not Found']) {
      expect(shouldBackoff(msg), msg).toBe(false);
    }
  });
});

describe('裝置離線的判定與提早停止', () => {
  it('邊界層的 NETWORK_ERROR 前綴與 WebView 的傳輸層失敗皆判為裝置離線', () => {
    // Rust 的 fetch_http_text 對 ureq::Error::Transport 加上此前綴
    expect(isDeviceOfflineError('NETWORK_ERROR:Unable to resolve host')).toBe(true);
    expect(isDeviceOfflineError(new Error('取得頻道影片失敗: NETWORK_ERROR:connection refused'))).toBe(true);
    // WebView fetch() 於傳輸層失敗時拋 TypeError
    expect(isDeviceOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isDeviceOfflineError('TypeError: Failed to fetch')).toBe(true);
  });

  it('服務層錯誤不判為裝置離線 —— 只代表這個請求失敗，不足以推論整輪', () => {
    for (const err of [
      'HTTP_STATUS:403:quotaExceeded',
      'HTTP_STATUS:500:server unavailable',
      new Error('API_CHANNEL_NOT_FOUND:UCxxxx'),
      'CHANNEL_TRACKING_UNAVAILABLE:missing_key',
      '',
    ]) {
      expect(isDeviceOfflineError(err), String(err)).toBe(false);
    }
  });

  it('null 與 undefined 不拋例外', () => {
    expect(isDeviceOfflineError(null)).toBe(false);
    expect(isDeviceOfflineError(undefined)).toBe(false);
  });

  it('提早停止文案標註「未檢查」，且不誤稱為已檢查失敗', () => {
    expect(describeEarlyStop(1)).toContain('1 個頻道未檢查');
    expect(describeEarlyStop(10)).toContain('10 個頻道未檢查');
    expect(describeEarlyStop(1)).not.toContain('失敗');
  });

  it('下載路徑的限流退避維持原樣，不受頻道追蹤改動影響', () => {
    expect(totalBackoffMs()).toBe(14000);
  });
});
