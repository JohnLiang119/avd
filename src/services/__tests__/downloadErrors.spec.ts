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
      .toEqual({ permanent: true, liveRelated: true, botCheck: false });
    expect(matchPermanentError('ERROR: This live event will begin in 2 minutes'))
      .toEqual({ permanent: true, liveRelated: true, botCheck: false });
  });

  it('確定性但與直播無關者不帶直播標記', () => {
    expect(matchPermanentError('ERROR: Video unavailable'))
      .toEqual({ permanent: true, liveRelated: false, botCheck: false });
    expect(matchPermanentError('檔案已存在 (重複)'))
      .toEqual({ permanent: true, liveRelated: false, botCheck: false });
  });

  it('YouTube bot 驗證為確定性錯誤並另外標記（彎引號與直引號皆命中）', () => {
    // 2026-10-28 Android 4G 實際 logcat 原文（YouTube 文案使用彎引號 ’）
    const real = 'ERROR: [youtube] Xkv3CNa1h5g: Sign in to confirm you’re not a bot. This helps protect our community. Use --cookies-from-browser or --cookies for the authentication.';
    expect(matchPermanentError(real))
      .toEqual({ permanent: true, liveRelated: false, botCheck: true });
    expect(matchPermanentError("ERROR: [youtube] abc: Sign in to confirm you're not a bot"))
      .toEqual({ permanent: true, liveRelated: false, botCheck: true });
  });

  it('「Sign in」開頭但非 bot 驗證的訊息不帶 bot 標記', () => {
    // 私人影片的訊息也含「Sign in」字樣，不可誤判為 bot 驗證
    expect(matchPermanentError('ERROR: Private video. Sign in if you have been granted access').botCheck)
      .toBe(false);
    expect(matchPermanentError('ERROR: Sign in to confirm your age').botCheck).toBe(false);
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
