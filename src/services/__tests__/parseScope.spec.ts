import { describe, it, expect } from 'vitest';
import {
  collectSourceProgress,
  pendingSequences,
  applySequenceResults,
  sequenceProgressKey,
  SINGLE_SEQUENCE,
  type ParseProgress,
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

describe('多序列來源的進度定址', () => {
  const KEY = 'yt:channel:UCSJ4gkVC6NrvII8umztf0Ow';
  // Lofi Girl 實測：videos 117／streams 23／shorts 332
  const afterFirstBatch: Record<string, ParseProgress> = {
    [`${KEY}/videos`]: { fetched: 117, complete: true },
    [`${KEY}/streams`]: { fetched: 23, complete: true },
    [`${KEY}/shorts`]: { fetched: 200, complete: false },
  };

  it('合計為各序列之和，但續抓不以合計定址', () => {
    const view = collectSourceProgress(afterFirstBatch, KEY, true);
    expect(view.total).toBe(340);
    // 340 對任何一個分頁都沒有意義 —— 拿它當範圍起點正是原本的漏片根因
    expect(view.sequences.shorts.fetched).toBe(200);
  });

  it('只有未抓完的序列會被續抓，且各自帶自己的起點', () => {
    const view = collectSourceProgress(afterFirstBatch, KEY, true);
    // videos 與 streams 已完成，不再發出請求
    expect(pendingSequences(view)).toEqual({ shorts: 200 });
  });

  it('shorts 續抓自第 201 部而非第 341 部', () => {
    const pending = pendingSequences(collectSourceProgress(afterFirstBatch, KEY, true));
    expect(buildPlaylistRangeArgs(pending.shorts, 200)).toEqual(['--playlist-items', '201-400']);
    // 原本的錯誤行為：以合計 340 定址 → 341-540 → 三個分頁都回 0
    expect(buildPlaylistRangeArgs(340, 200)).toEqual(['--playlist-items', '341-540']);
  });

  it('部分序列未完成時，來源不算抓完', () => {
    expect(collectSourceProgress(afterFirstBatch, KEY, true).allComplete).toBe(false);
  });

  it('所有序列皆完成時，來源才算抓完', () => {
    const done = { ...afterFirstBatch, [`${KEY}/shorts`]: { fetched: 332, complete: true } };
    expect(collectSourceProgress(done, KEY, true).allComplete).toBe(true);
  });

  it('推進只動本批回傳的序列，其餘不變', () => {
    const next = applySequenceResults(afterFirstBatch, KEY, { shorts: 200 }, { shorts: 132 }, 200);
    expect(next[`${KEY}/shorts`]).toEqual({ fetched: 332, complete: true });
    expect(next[`${KEY}/videos`]).toEqual({ fetched: 117, complete: true });
    expect(next[`${KEY}/streams`]).toEqual({ fetched: 23, complete: true });
  });

  it('推進回傳新物件，不就地修改', () => {
    const before = { ...afterFirstBatch };
    applySequenceResults(afterFirstBatch, KEY, { shorts: 200 }, { shorts: 132 }, 200);
    expect(afterFirstBatch).toEqual(before);
  });
});

describe('舊格式進度鍵（不寫遷移，直接忽略）', () => {
  const KEY = 'yt:channel:UCabc';

  it('多序列來源忽略不帶序列識別的舊鍵', () => {
    // 舊鍵是本變更之前的單一純量進度，其數值對任何序列都沒有意義。
    const view = collectSourceProgress({ [KEY]: { fetched: 340, complete: true } }, KEY, true);
    expect(view.hasAny).toBe(false);
    expect(view.total).toBe(0);
    expect(view.allComplete).toBe(false);
  });

  it('單序列來源仍讀取不帶識別的鍵', () => {
    const view = collectSourceProgress({ [KEY]: { fetched: 200, complete: false } }, KEY, false);
    expect(view.sequences[SINGLE_SEQUENCE]).toEqual({ fetched: 200, complete: false });
    expect(view.total).toBe(200);
  });

  it('單序列來源不會誤讀其他來源的鍵', () => {
    const view = collectSourceProgress({ 'yt:channel:UCother': { fetched: 5, complete: false } }, KEY, false);
    expect(view.hasAny).toBe(false);
  });

  it('sequenceProgressKey：單序列不加分隔符', () => {
    expect(sequenceProgressKey(KEY, 'videos')).toBe(`${KEY}/videos`);
    expect(sequenceProgressKey(KEY, SINGLE_SEQUENCE)).toBe(KEY);
  });

  it('空進度表安全', () => {
    expect(collectSourceProgress(undefined, KEY, true).hasAny).toBe(false);
    expect(pendingSequences(collectSourceProgress({}, KEY, true))).toEqual({});
  });
});
