import { describe, expect, it } from 'vitest';
import {
  YT_DLP_UPDATE_RETRY_COOLDOWN_MS,
  parseAttemptTimestamp,
  shouldAttemptYtDlpUpdate,
  todayKey,
} from '../ytDlpUpdatePolicy';

// 固定一個時間點：2026-10-05 02:00:00 UTC
const NOW = Date.UTC(2026, 9, 5, 2, 0, 0);

describe('shouldAttemptYtDlpUpdate', () => {
  it('從未更新也從未嘗試過 → 要更新', () => {
    expect(shouldAttemptYtDlpUpdate({ now: NOW, lastSuccessDate: null, lastAttemptAt: null })).toBe(true);
  });

  it('今天已成功更新過 → 不更新', () => {
    expect(
      shouldAttemptYtDlpUpdate({ now: NOW, lastSuccessDate: todayKey(NOW), lastAttemptAt: NOW - 1000 })
    ).toBe(false);
  });

  it('昨天成功過、今天還沒嘗試 → 要更新', () => {
    const yesterday = todayKey(NOW - 24 * 60 * 60 * 1000);
    expect(shouldAttemptYtDlpUpdate({ now: NOW, lastSuccessDate: yesterday, lastAttemptAt: null })).toBe(true);
  });

  it('剛剛嘗試失敗（冷卻時間內）→ 不更新，避免每次下載都卡逾時', () => {
    expect(
      shouldAttemptYtDlpUpdate({ now: NOW, lastSuccessDate: null, lastAttemptAt: NOW - 5 * 60 * 1000 })
    ).toBe(false);
  });

  it('冷卻時間剛好到 → 要更新', () => {
    expect(
      shouldAttemptYtDlpUpdate({
        now: NOW,
        lastSuccessDate: null,
        lastAttemptAt: NOW - YT_DLP_UPDATE_RETRY_COOLDOWN_MS,
      })
    ).toBe(true);
  });

  it('嘗試時間戳在未來（時鐘被調過）→ 視為冷卻中，不更新', () => {
    expect(
      shouldAttemptYtDlpUpdate({ now: NOW, lastSuccessDate: null, lastAttemptAt: NOW + 60 * 1000 })
    ).toBe(false);
  });
});

describe('parseAttemptTimestamp', () => {
  it('null / 空字串 / 非數字 → null', () => {
    expect(parseAttemptTimestamp(null)).toBeNull();
    expect(parseAttemptTimestamp('')).toBeNull();
    expect(parseAttemptTimestamp('abc')).toBeNull();
  });

  it('數字字串 → 數值', () => {
    expect(parseAttemptTimestamp(String(NOW))).toBe(NOW);
  });
});

describe('todayKey', () => {
  it('輸出 YYYY-MM-DD', () => {
    expect(todayKey(NOW)).toBe('2026-10-05');
  });
});
