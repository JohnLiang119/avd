import { describe, it, expect } from 'vitest';
import {
  isRateLimited,
  rateLimitBackoffMs,
  totalBackoffMs,
  describeRateLimit,
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
