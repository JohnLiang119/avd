import { describe, it, expect } from 'vitest';
import {
  parseProgressKey,
  buildPlaylistRangeArgs,
  advanceParseProgress,
  PARSE_BATCH_SIZE
} from '../parseScope';

describe('parseProgressKey', () => {
  it('TikTok 創作者頁忽略易變的追蹤參數', () => {
    // 同一個創作者每次分享的網址都不同，若不正規化會被當成不同來源。
    const a = parseProgressKey('https://www.tiktok.com/@bingleng8888888?_r=1&_t=ZS-99RJ3WEDUOH');
    const b = parseProgressKey('https://www.tiktok.com/@bingleng8888888?_r=1&_t=AAAAAAAAAAAA');
    const c = parseProgressKey('https://www.tiktok.com/@bingleng8888888');
    expect(a).toBe('tiktok:@bingleng8888888');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('不同創作者得到不同的鍵', () => {
    expect(parseProgressKey('https://www.tiktok.com/@aaa'))
      .not.toBe(parseProgressKey('https://www.tiktok.com/@bbb'));
  });

  it('YouTube 播放清單以 list 參數為鍵', () => {
    expect(parseProgressKey('https://www.youtube.com/playlist?list=PLabc-123'))
      .toBe('yt:list:PLabc-123');
    // 同一份清單但附帶其他參數
    expect(parseProgressKey('https://www.youtube.com/watch?v=xyz&list=PLabc-123'))
      .toBe('yt:list:PLabc-123');
  });

  it('YouTube 頻道以 channel id 為鍵，list 優先於 channel', () => {
    expect(parseProgressKey('https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow'))
      .toBe('yt:channel:UCSJ4gkVC6NrvII8umztf0Ow');
    expect(parseProgressKey('https://www.youtube.com/channel/UCabc/playlists?list=PLxyz'))
      .toBe('yt:list:PLxyz');
  });

  it('YouTube handle 與 Douyin 使用者頁各有專屬鍵', () => {
    expect(parseProgressKey('https://www.youtube.com/@SomeCreator')).toBe('yt:@SomeCreator');
    expect(parseProgressKey('https://www.douyin.com/user/MS4wLjABAAAA')).toBe('douyin:MS4wLjABAAAA');
  });

  it('無法辨識的來源退回去除 query 的網址', () => {
    expect(parseProgressKey('https://example.com/list?token=abc'))
      .toBe('https://example.com/list');
  });
});

describe('buildPlaylistRangeArgs', () => {
  it('首批使用 --playlist-end', () => {
    expect(buildPlaylistRangeArgs(0)).toEqual(['--playlist-end', String(PARSE_BATCH_SIZE)]);
  });

  it('續抓使用 --playlist-items 且自上批末尾接續', () => {
    // 實測 200 的末筆與 201 的首筆相鄰，故起點為 fetched + 1。
    expect(buildPlaylistRangeArgs(200, 200)).toEqual(['--playlist-items', '201-400']);
    expect(buildPlaylistRangeArgs(400, 200)).toEqual(['--playlist-items', '401-600']);
  });

  it('批次大小可調整', () => {
    expect(buildPlaylistRangeArgs(0, 50)).toEqual(['--playlist-end', '50']);
    expect(buildPlaylistRangeArgs(50, 50)).toEqual(['--playlist-items', '51-100']);
  });

  it('非整數或負數的進度視為首批，不產生無效範圍', () => {
    expect(buildPlaylistRangeArgs(-5)).toEqual(['--playlist-end', String(PARSE_BATCH_SIZE)]);
    expect(buildPlaylistRangeArgs(NaN)).toEqual(['--playlist-end', String(PARSE_BATCH_SIZE)]);
    expect(buildPlaylistRangeArgs(10.7, 200)).toEqual(['--playlist-items', '11-210']);
  });
});

describe('advanceParseProgress', () => {
  it('回傳滿一批時推進進度且未標記結尾', () => {
    expect(advanceParseProgress(0, 200, 200)).toEqual({ fetched: 200, complete: false });
    expect(advanceParseProgress(200, 200, 200)).toEqual({ fetched: 400, complete: false });
  });

  it('回傳不足一批時標記已抵達來源結尾', () => {
    expect(advanceParseProgress(400, 47, 200)).toEqual({ fetched: 447, complete: true });
  });

  it('回傳零筆時進度不變並標記結尾', () => {
    expect(advanceParseProgress(600, 0, 200)).toEqual({ fetched: 600, complete: true });
  });

  it('推進量取回傳筆數而非勾選筆數，否則下一批會重複', () => {
    // 使用者只勾了 3 部，但這一批的 200 部都已經看過了。
    const after = advanceParseProgress(0, 200, 200);
    expect(after.fetched).toBe(200);
  });
});
