import { describe, it, expect } from 'vitest';
import { resolveSourceProfile, SOURCE_PROFILES, FALLBACK_PROFILE } from '../sourceProfiles';
import { parseProgressKey } from '../parseScope';

const id = (url: string) => resolveSourceProfile(url).id;
const kind = (url: string) => resolveSourceProfile(url).kind;

describe('resolveSourceProfile 命中', () => {
  it('TikTok 創作者頁', () => {
    expect(id('https://www.tiktok.com/@bingleng8888888?_r=1&_t=ZS-99RJ3WEDUOH')).toBe('tiktok-user');
    expect(kind('https://www.tiktok.com/@abc')).toBe('collection');
  });

  it('抖音使用者頁為已知不支援', () => {
    // yt-dlp 沒有 Douyin 使用者頁 extractor；標記出來才能給明確訊息。
    expect(id('https://www.douyin.com/user/MS4wLjABAAAA')).toBe('douyin-user');
    expect(kind('https://www.douyin.com/user/MS4wLjABAAAA')).toBe('unsupported');
  });

  it('抖音分享連結', () => {
    expect(id('https://v.douyin.com/abcdef/')).toBe('douyin-short');
  });

  it('Bilibili 空間頁', () => {
    expect(id('https://space.bilibili.com/3493134753335919?spm_id_from=333.788.upinfo.detail.click'))
      .toBe('bilibili-space');
    expect(kind('https://space.bilibili.com/3493134753335919')).toBe('collection');
    // /video 變體
    expect(id('https://space.bilibili.com/3493134753335919/video')).toBe('bilibili-space');
  });

  it('Bilibili 的清單資訊不完整，需要補齊階段', () => {
    // 實測 entry 只有 id / url / ie_key 三個欄位，對照 TikTok 的 26 個
    const p = resolveSourceProfile('https://space.bilibili.com/123');
    expect(p.flatMetadata).toBe('none');
    // 空間頁是扁平清單，不展開成多個分頁
    expect(p.expandsToSequences).toBe(false);
  });

  it('YouTube 播放清單', () => {
    expect(id('https://www.youtube.com/playlist?list=PLabc-123')).toBe('youtube-playlist');
  });

  it('YouTube 頻道（channel id 與 /c/ 兩種形式）', () => {
    expect(id('https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow')).toBe('youtube-channel');
    expect(id('https://www.youtube.com/c/SomeName')).toBe('youtube-channel');
  });

  it('YouTube handle', () => {
    expect(id('https://www.youtube.com/@SomeCreator')).toBe('youtube-handle');
  });

  it('單一影片落到 fallback', () => {
    expect(id('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(FALLBACK_PROFILE.id);
    expect(kind('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('single');
    expect(id('https://example.com/whatever')).toBe(FALLBACK_PROFILE.id);
  });

  it('空字串與 undefined 不拋例外', () => {
    expect(id('')).toBe(FALLBACK_PROFILE.id);
    expect(resolveSourceProfile(undefined as any).id).toBe(FALLBACK_PROFILE.id);
  });
});

describe('比對順序（順序敏感，改動註冊表順序會破壞既有行為）', () => {
  it('watch?v=x&list=PL... 必須解析為清單而非單片', () => {
    // 既有行為：isPlaylistUrl 先檢查 list=，故此網址走清單流程。
    const url = 'https://www.youtube.com/watch?v=xyz&list=PLabc-123';
    expect(id(url)).toBe('youtube-playlist');
    expect(kind(url)).toBe('collection');
  });

  it('youtube.com/@handle 帶 /watch 時不算頻道', () => {
    // 既有行為：(youtube.com/@ && !/watch)
    expect(id('https://www.youtube.com/@creator/watch?v=abc')).not.toBe('youtube-handle');
  });

  it('TikTok 排在 youtube-playlist 之前，保留原進度鍵的判定順序', () => {
    const tiktokIdx = SOURCE_PROFILES.findIndex(p => p.id === 'tiktok-user');
    const listIdx = SOURCE_PROFILES.findIndex(p => p.id === 'youtube-playlist');
    expect(tiktokIdx).toBeGreaterThanOrEqual(0);
    expect(tiktokIdx).toBeLessThan(listIdx);
  });

  it('fallback 不在註冊表內，只作為最後退路', () => {
    expect(SOURCE_PROFILES.some(p => p.id === FALLBACK_PROFILE.id)).toBe(false);
  });
});

describe('progressKey 的字面輸出（抽離前 parseProgressKey 的既有格式）', () => {
  // 刻意斷言字面值而非與 parseProgressKey 比對 —— 後者現已委派給本表，
  // 那樣的測試是套套邏輯，看起來有覆蓋卻什麼都沒保證。
  // 進度鍵格式若改變，既有的 avd_parse_progress 會全部對不上。
  const cases: Array<[string, string]> = [
    ['https://www.tiktok.com/@bingleng8888888?_r=1&_t=ZS-99RJ3WEDUOH', 'tiktok:@bingleng8888888'],
    ['https://www.tiktok.com/@bingleng8888888', 'tiktok:@bingleng8888888'],
    ['https://www.youtube.com/playlist?list=PLabc-123', 'yt:list:PLabc-123'],
    ['https://www.youtube.com/watch?v=xyz&list=PLabc-123', 'yt:list:PLabc-123'],
    ['https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow', 'yt:channel:UCSJ4gkVC6NrvII8umztf0Ow'],
    ['https://www.youtube.com/@SomeCreator', 'yt:@SomeCreator'],
    ['https://www.douyin.com/user/MS4wLjABAAAA', 'douyin:MS4wLjABAAAA'],
    ['https://space.bilibili.com/3493134753335919?spm_id_from=333.788.x', 'bilibili:space:3493134753335919'],
    ['https://space.bilibili.com/3493134753335919/video', 'bilibili:space:3493134753335919'],
    ['https://example.com/list?token=abc', 'https://example.com/list'],
  ];

  for (const [url, expected] of cases) {
    it(expected, () => {
      expect(resolveSourceProfile(url).progressKey(url)).toBe(expected);
      // 轉出的入口與表內規則一致
      expect(parseProgressKey(url)).toBe(expected);
    });
  }

  it('同一創作者的不同分享網址得到相同的鍵', () => {
    const a = parseProgressKey('https://www.tiktok.com/@abc?_t=AAAA');
    const b = parseProgressKey('https://www.tiktok.com/@abc?_t=BBBB');
    expect(a).toBe(b);
  });
});

describe('能力宣告', () => {
  it('只有創作者頁需要事前確認', () => {
    const needs = SOURCE_PROFILES.filter(p => p.needsPreParseConfirm).map(p => p.id);
    expect(needs).toEqual(['tiktok-user', 'douyin-user']);
    // Bilibili 38 筆僅 2 秒，且有 200 筆上限兜著，不值得多一道確認
    expect(resolveSourceProfile('https://space.bilibili.com/123').needsPreParseConfirm).toBe(false);
  });

  it('YouTube 頻道不走此旗標 —— 它有自己的兩段式確認', () => {
    expect(resolveSourceProfile('https://www.youtube.com/channel/UCabc').needsPreParseConfirm).toBe(false);
  });

  it('有專屬項目網址規則的來源', () => {
    const withBuilder = SOURCE_PROFILES.filter(p => p.buildItemUrl).map(p => p.id);
    expect(withBuilder).toEqual(['tiktok-user', 'douyin-short']);
  });

  it('抖音項目網址為 douyin.com/video/{id}', () => {
    // 實測此形式可正確進入 [Douyin] extractor（不同於 TikTok 需帶 @handle）
    const build = resolveSourceProfile('https://v.douyin.com/abc/').buildItemUrl!;
    expect(build('7300000000000000000', {}, 'https://v.douyin.com/abc/'))
      .toBe('https://www.douyin.com/video/7300000000000000000');
  });

  it('只有 YouTube 頻道可加入自動追蹤', () => {
    // 追蹤機制綁定官方 RSS，其他平台沒有等價物
    const trackable = SOURCE_PROFILES.filter(p => p.supportsChannelTracking).map(p => p.id);
    expect(trackable).toEqual(['youtube-channel', 'youtube-handle']);
    expect(FALLBACK_PROFILE.supportsChannelTracking).toBe(false);
  });

  it('TikTok 項目網址：優先 uploader，退回自輸入網址擷取，皆無則保留舊格式', () => {
    const build = resolveSourceProfile('https://www.tiktok.com/@fromurl').buildItemUrl!;
    expect(build('123', { uploader: 'fromentry' }, 'https://www.tiktok.com/@fromurl'))
      .toBe('https://www.tiktok.com/@fromentry/video/123');
    expect(build('123', {}, 'https://www.tiktok.com/@fromurl'))
      .toBe('https://www.tiktok.com/@fromurl/video/123');
    expect(build('123', {}, 'https://www.tiktok.com/'))
      .toBe('https://www.tiktok.com/video/123');
  });

  it('channel 與 uploader_id 不得被用來組網址', () => {
    // 實測：channel 是顯示名稱、uploader_id 是純數字，用它們組出來的都是壞的。
    const build = resolveSourceProfile('https://www.tiktok.com/@fromurl').buildItemUrl!;
    const got = build('123', { channel: '冰冷（小号冲一万）', uploader_id: '7192982787066217474' },
                      'https://www.tiktok.com/@fromurl');
    expect(got).toBe('https://www.tiktok.com/@fromurl/video/123');
  });

  it('每筆 profile 的 id 唯一', () => {
    const ids = SOURCE_PROFILES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
