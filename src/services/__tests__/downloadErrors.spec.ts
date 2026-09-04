import { describe, it, expect } from 'vitest';
import { matchPermanentError } from '../downloadErrors';

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
