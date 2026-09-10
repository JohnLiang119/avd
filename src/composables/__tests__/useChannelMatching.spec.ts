import { describe, it, expect } from 'vitest';
import {
  channelBaseline,
  isFirstTimeTracking,
  isVideoAlreadyQueued,
  selectNewVideos,
  nextChannelBaseline,
  buildChannelVideoTask,
  normalizeForMatching,
  normalizeChannelKeywords,
  channelKeywords,
  matchesChannelKeywords,
  partitionByKeywords,
  describeKeywordFilteredRound,
  describeKeywordFilteredSuffix,
  describeChannelKeywordMiss,
  conservativeAnchor,
  KEYWORD_MAX_COUNT,
  KEYWORD_MAX_LENGTH,
  type MatchableVideo,
  type MonitoredChannelLike
} from '../useChannelMatching';
import type { TaskItem } from '../useTaskStore';

const T = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime();

const vid = (id: string, publishedTime: number, extra: Partial<MatchableVideo> = {}): MatchableVideo => ({
  videoId: id,
  title: `影片 ${id}`,
  publishedTime,
  url: `https://www.youtube.com/watch?v=${id}`,
  source: 'api',
  ...extra,
});

const channel = (over: Partial<MonitoredChannelLike> = {}): MonitoredChannelLike => ({
  channelId: 'UCtest',
  title: '測試頻道',
  ...over,
});

/** API 回傳為由新至舊 */
const NEWER = T(2026, 9, 3, 12, 0, 0);
const OLDER = T(2026, 9, 1, 8, 0, 0);
const OLDEST = T(2026, 8, 20, 8, 0, 0);

describe('isFirstTimeTracking / channelBaseline', () => {
  it('兩個時間欄位皆無值時為首次追蹤', () => {
    expect(isFirstTimeTracking(channel())).toBe(true);
    expect(channelBaseline(channel())).toBe(0);
  });

  it('任一欄位有值即非首次 —— 沿用向下相容鏈', () => {
    expect(isFirstTimeTracking(channel({ lastPublishedTime: OLDER }))).toBe(false);
    // lastCheckTime 單獨存在時也算已初始化，這正是錨點污染會「復活」的途徑
    expect(isFirstTimeTracking(channel({ lastCheckTime: OLDER }))).toBe(false);
    expect(channelBaseline(channel({ lastCheckTime: OLDER }))).toBe(OLDER);
  });

  it('lastPublishedTime 優先於 lastCheckTime', () => {
    expect(channelBaseline(channel({ lastPublishedTime: NEWER, lastCheckTime: OLDER }))).toBe(NEWER);
  });
});

describe('isVideoAlreadyQueued', () => {
  const flat: TaskItem = {
    id: 1, type: 'file', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', status: 'pending',
  } as any;

  const grouped: TaskItem = {
    id: 2, type: 'channel', isChannelGroup: true, channelTitle: '某頻道', status: 'pending',
    playlists: [{
      id: 3, type: 'playlist', playlistTitle: '某清單', status: 'pending',
      subTasks: [{ id: 4, type: 'file', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', status: 'pending' }],
    }],
  } as any;

  it('比對得到扁平任務', () => {
    expect(isVideoAlreadyQueued([flat], 'aaaaaaaaaaa')).toBe(true);
  });

  it('比對得到頻道群組底下的巢狀子任務', () => {
    // 三層：頻道群組 → 播放清單 → 子任務
    expect(isVideoAlreadyQueued([grouped], 'bbbbbbbbbbb')).toBe(true);
  });

  it('不存在的影片回傳 false', () => {
    expect(isVideoAlreadyQueued([flat, grouped], 'ccccccccccc')).toBe(false);
  });

  it('空佇列與空 videoId 皆安全', () => {
    expect(isVideoAlreadyQueued([], 'aaaaaaaaaaa')).toBe(false);
    expect(isVideoAlreadyQueued([flat], '')).toBe(false);
  });

  it('沿用子字串比對 —— 刻意未改為精確比對', () => {
    // 這是等價重構下刻意保留的行為，不是疏漏（見 design 決策 2）。
    // 改為自 URL 解析 videoId 再精確比對屬行為變更，應另案評估。
    expect(isVideoAlreadyQueued([flat], 'aaaaa')).toBe(true);
  });
});

describe('selectNewVideos', () => {
  const videos = [vid('n1', NEWER), vid('n2', OLDER), vid('n3', OLDEST)];

  it('只回傳發布時間晚於錨點者', () => {
    const got = selectNewVideos(videos, OLDER, []);
    expect(got.map(v => v.videoId)).toEqual(['n1']);
  });

  it('等於錨點的影片不算新片', () => {
    expect(selectNewVideos([vid('same', OLDER)], OLDER, []).length).toBe(0);
  });

  it('已在佇列中的影片被排除', () => {
    const queued = [{ id: 1, type: 'file', url: 'https://youtu.be/n1', status: 'pending' }] as any as TaskItem[];
    expect(selectNewVideos(videos, OLDEST, queued).map(v => v.videoId)).toEqual(['n2']);
  });

  it('回傳順序與輸入一致（由新至舊），不就地修改輸入', () => {
    const input = [vid('n1', NEWER), vid('n2', OLDER)];
    const got = selectNewVideos(input, 0, []);
    expect(got.map(v => v.videoId)).toEqual(['n1', 'n2']);
    got.reverse();
    // 呼叫端會 reverse 結果；輸入不得受影響
    expect(input.map(v => v.videoId)).toEqual(['n1', 'n2']);
  });
});

describe('nextChannelBaseline', () => {
  it('有精確發布時間時推進至最新者（視窗已回溯至錨點之前）', () => {
    // 現實的 API 形狀：回傳的最舊影片早於目前錨點，代表視窗完整覆蓋
    // 「錨點到現在」的缺口，不存在未經比對的較舊影片，故錨點推進至最新者。
    const got = nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER), vid('n3', OLDEST)], OLDER);
    expect(got).toEqual({ publishedTime: NEWER, videoId: 'n1', title: '影片 n1' });
  });

  it('無精確發布時間時不推進 —— 不得以當下時間替代', () => {
    // publishedTime 為 0 代表來源未提供可解析的精確時間。
    // 若此處回傳當下時間，基準會被推到未來而永久漏片。
    expect(nextChannelBaseline([vid('n1', 0)], OLDER)).toBeNull();
  });

  it('計算出的錨點不高於現有錨點時不推進', () => {
    expect(nextChannelBaseline([vid('n1', OLDER)], NEWER)).toBeNull();
    expect(nextChannelBaseline([vid('n1', NEWER)], NEWER)).toBeNull();
  });

  it('不越過未處理的影片，只推進至次新的已處理影片', () => {
    // n1 是最新但因直播而未處理 —— 錨點若推過它，該片日後可正常下載時
    // 也永遠不會再被判定為新片（排程直播的 publishedTime 不會改變）。
    const got = nextChannelBaseline(
      [vid('n1', NEWER), vid('n2', OLDER)],
      OLDEST,
      new Set(['n1'])
    );
    expect(got).toEqual({ publishedTime: OLDER, videoId: 'n2', title: '影片 n2' });
  });

  it('全數未處理時錨點不變', () => {
    const got = nextChannelBaseline(
      [vid('n1', NEWER), vid('n2', OLDER)],
      OLDEST,
      new Set(['n1', 'n2'])
    );
    expect(got).toBeNull();
  });

  it('不倚賴輸入順序，取已處理影片中發布時間最大者', () => {
    // 來源未必依時間排序
    const got = nextChannelBaseline([vid('a', OLDER), vid('b', NEWER), vid('c', OLDEST)], 0);
    expect(got?.videoId).toBe('b');
  });

  it('空清單回傳 null', () => {
    expect(nextChannelBaseline([], 0)).toBeNull();
  });

  it('首次追蹤：只看最新一支，其無精確時間則不建立基準', () => {
    // 呼叫端於首次追蹤時傳入 [videos[0]]，刻意不套用「不越過未處理影片」那道守門
    expect(nextChannelBaseline([vid('n1', 0)], 0)).toBeNull();
    expect(nextChannelBaseline([vid('n1', NEWER)], 0)?.publishedTime).toBe(NEWER);
  });
});

describe('buildChannelVideoTask', () => {
  const ch = channel({ title: '某 / 頻道: 名稱' });

  it('標題含頻道前綴與發布時間', () => {
    const t = buildChannelVideoTask(vid('n1', T(2026, 9, 3, 12, 34, 56)), channel(), 7);
    expect(t.title).toBe('[測試頻道] 影片 n1 (2026/09/03 12:34:56)');
    expect(t.publishTimeStr).toBe('2026/09/03 12:34:56');
    expect(t.rawTitle).toBe('影片 n1');
    expect(t.id).toBe(7);
  });

  it('任務狀態文字不標註來源 —— 只有一條通道，標註已無資訊量', () => {
    const line = buildChannelVideoTask(vid('n1', NEWER), channel(), 1).line;
    expect(line).toContain('自動追蹤');
    expect(line).not.toContain('RSS');
    expect(line).not.toContain('備援');
  });

  it('子資料夾名稱移除檔案系統不接受的字元', () => {
    expect(buildChannelVideoTask(vid('n1', NEWER), ch, 1).subFolder).toBe('某 _ 頻道_ 名稱');
  });

  it('無精確發布時間時標題仍帶時間 —— 顯示可退回當下，錨點不可', () => {
    // 這裡刻意與 nextChannelBaseline 的規則不同：顯示用的時間退回當下無害，
    // 錨點退回當下則會造成永久漏片。
    const t = buildChannelVideoTask(vid('n1', 0), channel(), 1);
    expect(t.publishTimeStr).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('建立的任務為待下載狀態且非音訊', () => {
    const t = buildChannelVideoTask(vid('n1', NEWER), channel(), 1);
    expect(t.status).toBe('pending');
    expect(t.isAudio).toBe(false);
    expect(t.url).toBe('https://www.youtube.com/watch?v=n1');
  });
});

// ============================================================================
// 關鍵字篩選
// ============================================================================

describe('channelKeywords —— 既有資料形態的向下相容', () => {
  it('缺少 keywords 欄位、undefined、非陣列值皆得到空清單', () => {
    expect(channelKeywords(channel())).toEqual([]);
    expect(channelKeywords(channel({ keywords: undefined }))).toEqual([]);
    expect(channelKeywords(channel({ keywords: 'ai' as any }))).toEqual([]);
    expect(channelKeywords(channel({ keywords: 123 as any }))).toEqual([]);
    expect(channelKeywords(channel({ keywords: null as any }))).toEqual([]);
  });

  it('空清單時比對一律回傳符合 —— 未設關鍵字維持全量追蹤', () => {
    expect(matchesChannelKeywords('任何標題', [])).toBe(true);
    expect(matchesChannelKeywords('', [])).toBe(true);
    expect(matchesChannelKeywords('任何標題', channelKeywords(channel()))).toBe(true);
  });
});

describe('normalizeChannelKeywords —— 去重與顯示文字', () => {
  it('依正規化值去重，保留第一個項目的原始大小寫', () => {
    const got = normalizeChannelKeywords(['AI', 'ai', ' Ai ']);
    expect(got.keywords).toHaveLength(1);
    expect(got.keywords[0]).toBe('AI');
  });

  it('非字串與空白項目被移除，不視為拒絕', () => {
    const got = normalizeChannelKeywords(['ai', 123, null, undefined, '   ', '\t\n', {}]);
    expect(got.keywords).toEqual(['ai']);
    expect(got.rejections).toEqual([]);
  });

  it('去重以正規化值為準 —— 繁簡與全形視為同一項', () => {
    expect(normalizeChannelKeywords(['學習', '学习']).keywords).toEqual(['學習']);
    expect(normalizeChannelKeywords(['ＡＩ', 'ai']).keywords).toEqual(['ＡＩ']);
  });
});

describe('normalizeForMatching —— 字形正規化管線', () => {
  it('混合字形的四種組合全部命中', () => {
    // 影片標題入庫前已被整串啟發式簡繁轉換改寫，同一個詞會以不同字形入庫。
    // 兩側折算到同一字形域後，四種組合必須得到一致結果。
    for (const title of ['機器学习入門', '机器学习入门']) {
      for (const kw of ['學習', '学习']) {
        expect(matchesChannelKeywords(title, [kw])).toBe(true);
      }
    }
  });

  it('全形英數折半形後忽略大小寫', () => {
    expect(matchesChannelKeywords('ＡＩ 新知', ['ai'])).toBe(true);
    expect(matchesChannelKeywords('AI 新知', ['ＡＩ'])).toBe(true);
    expect(normalizeForMatching('ＡＩ')).toBe('ai');
  });

  it('未命中的標題不會被誤判為命中', () => {
    expect(matchesChannelKeywords('料理教學', ['機器學習'])).toBe(false);
  });
});

describe('normalizeChannelKeywords —— 輸入契約', () => {
  it('超過數量上限的項目被拒絕且回傳原因，結果仍為上限值', () => {
    const input = Array.from({ length: KEYWORD_MAX_COUNT + 1 }, (_, i) => `kw${i}`);
    const got = normalizeChannelKeywords(input);
    expect(got.keywords).toHaveLength(KEYWORD_MAX_COUNT);
    expect(got.rejections).toHaveLength(1);
    expect(got.rejections[0]).toContain(String(KEYWORD_MAX_COUNT));
    // MUST NOT 靜默截斷 —— 必須有可顯示的原因，且指出是哪一項
    expect(got.rejections[0]).toContain(`kw${KEYWORD_MAX_COUNT}`);
  });

  it('長度剛好達上限可通過，超過一個字元被拒絕', () => {
    const ok = normalizeChannelKeywords(['a'.repeat(KEYWORD_MAX_LENGTH)]);
    expect(ok.keywords).toHaveLength(1);
    expect(ok.rejections).toEqual([]);

    const tooLong = normalizeChannelKeywords(['a'.repeat(KEYWORD_MAX_LENGTH + 1)]);
    expect(tooLong.keywords).toEqual([]);
    expect(tooLong.rejections).toHaveLength(1);
    expect(tooLong.rejections[0]).toContain(String(KEYWORD_MAX_LENGTH));
  });

  it('零寬字元與全形空白組成的項目視為空白而被移除', () => {
    // trim() 不會移除零寬字元 —— 不另行處理會產生永不命中的關鍵字
    const blank = '​‌‍⁠﻿　';
    expect(normalizeChannelKeywords([blank]).keywords).toEqual([]);
  });

  it('前後夾零寬字元的關鍵字正規化為純文字且仍能命中', () => {
    const got = normalizeChannelKeywords(['​ai​']);
    expect(got.keywords).toEqual(['ai']);
    expect(matchesChannelKeywords('AI 週報', got.keywords)).toBe(true);
  });
});

describe('partitionByKeywords', () => {
  const videos = [vid('a', NEWER, { title: '機器學習入門' }), vid('b', OLDER, { title: '週末料理' })];

  it('多關鍵字任一命中即進入命中清單', () => {
    const got = partitionByKeywords(videos, ['料理', '機器學習']);
    expect(got.matched.map(v => v.videoId)).toEqual(['a', 'b']);
    expect(got.missed).toEqual([]);
  });

  it('未命中影片只出現在未命中清單', () => {
    const got = partitionByKeywords(videos, ['機器學習']);
    expect(got.matched.map(v => v.videoId)).toEqual(['a']);
    expect(got.missed.map(v => v.videoId)).toEqual(['b']);
  });

  it('空關鍵字清單時全部命中，未命中清單為空', () => {
    const got = partitionByKeywords(videos, []);
    expect(got.matched).toHaveLength(2);
    expect(got.missed).toEqual([]);
  });
});

describe('nextChannelBaseline —— 錨點守門為上限而非排除', () => {
  it('較舊的未處理影片不得被越過', () => {
    // 較新的 n1 未命中關鍵字（可被越過），較舊的 n2 命中但為直播（未處理）。
    // 排除式作法會錯誤地回傳 n1，使 n2 日後轉存檔也不再被判定為新片。
    const got = nextChannelBaseline(
      [vid('n1', NEWER), vid('n2', OLDER), vid('n3', OLDEST)],
      0,
      new Set(['n2'])
    );
    expect(got?.videoId).toBe('n3');
    expect(got?.publishedTime).toBe(OLDEST);
  });

  it('未處理影片的發布時間本身也不得被觸及', () => {
    // 上限為嚴格小於：與未處理影片同一時間點的影片不得成為錨點
    const got = nextChannelBaseline(
      [vid('n1', NEWER), vid('n2', OLDER), vid('n3', OLDER)],
      0,
      new Set(['n2'])
    );
    expect(got).toBeNull();
  });

  it('未命中關鍵字的影片不計入未處理集合，錨點得以越過', () => {
    // 呼叫端不把未命中影片放進 unhandledVideoIds，故錨點正常推進至最新者
    const got = nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER)], 0, new Set());
    expect(got?.videoId).toBe('n1');
  });
});

describe('nextChannelBaseline —— 候選視窗上限', () => {
  it('視窗未回溯至錨點時，錨點取本輪最舊者', () => {
    // 兩筆都比錨點新 —— 錨點與本輪最舊者之間可能還有未被取回也未經比對的
    // 影片，故錨點不得跨過本輪最舊者。
    const got = nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER)], OLDEST);
    expect(got?.videoId).toBe('n2');
    expect(got?.publishedTime).toBe(OLDER);
  });

  it('視窗已回溯至錨點時不設限，錨點推進至本輪最新者', () => {
    expect(
      nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER), vid('n3', OLDEST)], OLDER)?.videoId
    ).toBe('n1');
  });

  it('上限判定與取回筆數無關 —— 只看視窗是否覆蓋錨點', () => {
    // 這是採「取回筆數達每輪上限即設限」會踩到的故障：API 每輪 50 筆且
    // 時間跨度遠大於檢查間隔，以筆數判定會使上限恆成立，而上限（最舊者）
    // 早於現有錨點，錨點將永遠無法推進、每輪重新比對整個清單。
    const feed = Array.from({ length: 50 }, (_, i) => vid(`r${i}`, NEWER - i * 86400000));
    const baseline = NEWER - 2 * 86400000;   // 錨點在近兩天內，遠晚於最舊那筆
    const got = nextChannelBaseline(feed, baseline);
    expect(got?.videoId).toBe('r0');
    expect(got?.publishedTime).toBe(NEWER);
  });

  it('尚未建立錨點時不設限 —— 首次追蹤不存在可跳過的缺口', () => {
    expect(nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER)], 0)?.videoId).toBe('n1');
    expect(nextChannelBaseline([vid('n1', NEWER)], 0)?.videoId).toBe('n1');
  });

  it('本輪最舊影片恰等於錨點時視為已覆蓋，不設限', () => {
    const got = nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER)], OLDER);
    expect(got?.videoId).toBe('n1');
  });

  it('視窗上限與未處理上限同時生效時取較嚴格者', () => {
    const got = nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER)], 0, new Set(['n2']));
    expect(got).toBeNull();
  });
});

describe('關鍵字回饋訊息片段', () => {
  it('「全部被關鍵字篩除」與「目前沒有新影片」產生不同字串', () => {
    const filtered = describeKeywordFilteredRound(12);
    expect(filtered).not.toContain('目前沒有新影片');
    expect(filtered).toContain('12');
    expect(filtered).toContain('不符合關鍵字設定');
  });

  it('K 為零時補充片段為空字串 —— 未設關鍵字時既有訊息完全不變', () => {
    expect(describeKeywordFilteredSuffix(0)).toBe('');
  });

  it('K 大於零時補充片段可附加於「發現 N 部新影片」之後', () => {
    // N 只計入實際建立任務數：命中 2 部但 1 部因直播跳過時 N 為 1、K 不含該部
    const n = 1;
    const msg = `🔔 發現 ${n} 部新影片，已優先加入下載佇列！` + describeKeywordFilteredSuffix(5);
    expect(msg).toContain('發現 1 部新影片');
    expect(msg).toContain('另有 5 部');
    expect(msg).not.toContain('目前沒有新影片');
  });

  it('片段不含失敗頻道提示 —— 由 App.vue 與既有片段組裝', () => {
    expect(describeKeywordFilteredRound(3)).not.toContain('無法連線');
    expect(describeKeywordFilteredSuffix(3)).not.toContain('無法連線');
  });

  it('單頻道全部未命中時有專用提示，不退回「沒有新影片」', () => {
    const msg = describeChannelKeywordMiss('測試頻道', 3);
    expect(msg).toContain('測試頻道');
    expect(msg).toContain('3');
    expect(msg).not.toContain('目前沒有新影片');
  });
});

describe('conservativeAnchor —— 還原時取較舊者', () => {
  it('備份錨點較新時保留本機值', () => {
    expect(conservativeAnchor(OLDER, NEWER)).toBe(OLDER);
  });

  it('備份錨點較舊時採用備份值', () => {
    expect(conservativeAnchor(NEWER, OLDER)).toBe(OLDER);
  });

  it('任一方缺值時採用另一方', () => {
    expect(conservativeAnchor(undefined, NEWER)).toBe(NEWER);
    expect(conservativeAnchor(NEWER, undefined)).toBe(NEWER);
    expect(conservativeAnchor(0, NEWER)).toBe(NEWER);
  });

  it('兩方皆無時維持未初始化，不以當下時間建立錨點', () => {
    expect(conservativeAnchor(undefined, undefined)).toBeUndefined();
    expect(conservativeAnchor(0, 0)).toBeUndefined();
  });
});

describe('迴歸：排程直播不得釘住錨點（2026-09-10 實機案例）', () => {
  // 取自使用者實機的真實 feed（中廣新聞網 UCkqrvXuqW7dN3E2_4v8Ha5Q）。
  // 該頻道每日固定節目會提前建立 is_upcoming 的排程直播，因此 feed 中
  // 永遠存在直播項目。錨點若被它們釘住，其後所有影片每輪重新判定為新片，
  // 使用者清空下載佇列後即全部湧入（實測 32 支）。
  const T = (iso: string) => Date.parse(iso);
  const feed: MatchableVideo[] = [
    vid('u6EySITKmOw', T('2026-09-09T02:06:00Z')),
    vid('4y6daUqsp5c', T('2026-09-09T03:15:00Z')),   // 排程直播
    vid('3jPB4Vrf5Vk', T('2026-09-09T03:55:00Z')),   // 排程直播
    vid('WJBnl1H9SLs', T('2026-09-09T03:57:00Z')),   // 排程直播
    vid('VN7nFTOwKB4', T('2026-09-09T04:14:00Z')),
    vid('9jx_r9nyAOI', T('2026-09-09T11:46:00Z')),
    vid('T4Ha357a9mA', T('2026-09-09T21:50:00Z')),
    vid('en3Wvo6rnEA', T('2026-09-09T22:20:00Z')),
    vid('PyHMh0FtECs', T('2026-09-10T01:03:00Z')),   // 最新
  ];
  const UPCOMING = ['4y6daUqsp5c', '3jPB4Vrf5Vk', 'WJBnl1H9SLs'];
  // 穩態下的錨點：位於本輪 feed 的涵蓋範圍內，故候選視窗上限不介入，
  // 單獨檢驗「未處理集合」這個變因。
  const steady = T('2026-09-09T02:06:00Z');

  it('修正前的行為：排程直播進入未處理集合會使錨點完全無法推進', () => {
    // 舊佈線把 live 與 unknown 一併放入未處理集合。最早的排程直播在 03:15，
    // 錨點候選必須嚴格早於它 —— 只剩 02:06 那支，而它正是現有錨點，故不推進。
    const got = nextChannelBaseline(feed, steady, new Set(UPCOMING));
    expect(got).toBeNull();
    // 錨點之後仍有 8 支影片，每輪重新判定為新片
    expect(feed.filter(v => v.publishedTime > steady)).toHaveLength(8);
  });

  it('修正後：排程直播不列入未處理集合，錨點推進至最新', () => {
    // 新佈線只把 unknown 放入未處理集合；已知的排程直播不放
    const got = nextChannelBaseline(feed, steady, new Set());
    expect(got?.videoId).toBe('PyHMh0FtECs');
    expect(got?.publishedTime).toBe(T('2026-09-10T01:03:00Z'));
    // 錨點之後沒有殘留影片 —— 下一輪不會重複判定，清空佇列也不會湧回
    expect(feed.filter(v => v.publishedTime > (got?.publishedTime ?? 0))).toHaveLength(0);
  });

  it('狀態無法判定者仍阻擋錨點 —— 保守處置未被一併放寬', () => {
    // 查詢失敗屬暫時性，仍須壓住錨點以便下輪重新評估
    const got = nextChannelBaseline(feed, steady, new Set(['9jx_r9nyAOI']));
    expect(got?.videoId).toBe('VN7nFTOwKB4');
    expect(got?.publishedTime).toBe(T('2026-09-09T04:14:00Z'));
  });

  it('錨點遠落後於 feed 時分兩輪追上，不會卡死', () => {
    // 實機當下的狀態：錨點 09-07，而 feed 最舊者為 09-09 —— 視窗未涵蓋錨點，
    // 故第一輪受候選視窗上限約束只推進到本輪最舊者（09-07～09-09 之間可能
    // 有未取回的影片，不得跳過）。第二輪視窗已涵蓋錨點，即推進至最新。
    const stale = T('2026-09-07T11:06:00Z');
    const first = nextChannelBaseline(feed, stale, new Set());
    expect(first?.videoId).toBe('u6EySITKmOw');

    const second = nextChannelBaseline(feed, first!.publishedTime, new Set());
    expect(second?.videoId).toBe('PyHMh0FtECs');
  });
});
