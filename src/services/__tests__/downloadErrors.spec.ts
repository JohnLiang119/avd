import { describe, it, expect } from 'vitest';
import { matchPermanentError, isUpcomingLiveError } from '../downloadErrors';

describe('matchPermanentError', () => {
  it('確定性錯誤不重試', () => {
    for (const msg of [
      'ERROR: [youtube] Video unavailable',
      'ERROR: Private video. Sign in if you have been granted access',
      'ERROR: Join this channel to get access to members-only content',
      'ERROR: Requested format is not available',
      'ERROR: This live event will begin in 3 hours',
      '解析播放清單失敗: 檔案已存在 (重複)',
    ]) {
      expect(matchPermanentError(msg).permanent, msg).toBe(true);
    }
  });

  it('暫時性錯誤照常重試', () => {
    for (const msg of [
      'ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests',
      'ERROR: [BiliBili] HTTP Error 412: Precondition Failed',
      'ERROR: unable to download video data: <urlopen error timed out>',
      'ERROR: Connection reset by peer',
      '',
    ]) {
      expect(matchPermanentError(msg).permanent, msg).toBe(false);
    }
  });

  it('直播相關的訊息另外標記，供呼叫端給予專屬提示', () => {
    // 不應顯示暗示問題為暫時性的「已自動重試 N 次」
    expect(matchPermanentError('ERROR: Requested format is not available'))
      .toEqual({ permanent: true, liveRelated: true });
    expect(matchPermanentError('ERROR: This live event will begin in 2 minutes'))
      .toEqual({ permanent: true, liveRelated: true });
  });

  it('確定性但與直播無關者不帶直播標記', () => {
    expect(matchPermanentError('ERROR: Video unavailable'))
      .toEqual({ permanent: true, liveRelated: false });
    expect(matchPermanentError('檔案已存在 (重複)'))
      .toEqual({ permanent: true, liveRelated: false });
  });

  it('比對不分大小寫', () => {
    expect(matchPermanentError('VIDEO UNAVAILABLE').permanent).toBe(true);
    expect(matchPermanentError('Video Unavailable').permanent).toBe(true);
  });

  it('null 與 undefined 不拋例外', () => {
    expect(matchPermanentError(null as any).permanent).toBe(false);
    expect(matchPermanentError(undefined as any).permanent).toBe(false);
  });
});

describe('isUpcomingLiveError', () => {
  it('實測樣本判為排程直播', () => {
    for (const msg of [
      'ERROR: [youtube] 4y6daUqsp5c: This live event will begin in 6 hours.',
      'ERROR: [youtube] 3jPB4Vrf5Vk: This live event will begin in 5 hours.',
      '查詢直播狀態失敗: ERROR: [youtube] x: This live event will begin in 21 minutes',
    ]) {
      expect(isUpcomingLiveError(msg), msg).toBe(true);
    }
  });

  it('比對不分大小寫', () => {
    expect(isUpcomingLiveError('THIS LIVE EVENT WILL BEGIN IN 2 HOURS')).toBe(true);
  });

  it('無法辨識的失敗不判為排程直播 —— 保守預設為狀態未知', () => {
    for (const msg of [
      'ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests',
      'ERROR: [youtube] x: Video unavailable',
      'ERROR: Private video. Sign in if you have been granted access',
      'NETWORK_ERROR: dns error',
      '查詢直播狀態失敗: timeout',
    ]) {
      expect(isUpcomingLiveError(msg), msg).toBe(false);
    }
  });

  it('刻意比 LIVE_RELATED_ERRORS 窄 —— 格式不可用不算排程直播', () => {
    // 誤判代價不對稱：太寬會讓一般影片被錨點越過而永久漏抓
    const msg = 'ERROR: Requested format is not available';
    expect(matchPermanentError(msg).liveRelated).toBe(true);
    expect(isUpcomingLiveError(msg)).toBe(false);
  });

  it('null 與 undefined 不拋例外', () => {
    expect(isUpcomingLiveError(null as any)).toBe(false);
    expect(isUpcomingLiveError(undefined as any)).toBe(false);
    expect(isUpcomingLiveError('')).toBe(false);
  });
});
