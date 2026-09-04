import { describe, it, expect } from 'vitest';
import {
  channelBaseline,
  isFirstTimeTracking,
  isVideoAlreadyQueued,
  selectNewVideos,
  nextChannelBaseline,
  buildChannelVideoTask,
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
  source: 'rss',
  ...extra,
});

const channel = (over: Partial<MonitoredChannelLike> = {}): MonitoredChannelLike => ({
  channelId: 'UCtest',
  title: '測試頻道',
  ...over,
});

/** RSS 回傳為由新至舊 */
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
  it('有精確發布時間時推進至最新者', () => {
    const got = nextChannelBaseline([vid('n1', NEWER), vid('n2', OLDER)], OLDEST);
    expect(got).toEqual({ publishedTime: NEWER, videoId: 'n1', title: '影片 n1' });
  });

  it('無精確發布時間時不推進 —— 不得以當下時間替代', () => {
    // publishedTime 為 0 代表備援模式未提供精確時間。
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
    // 備援來源未必依時間排序
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

  it('來源標記區分 RSS 與 yt-dlp 備援', () => {
    expect(buildChannelVideoTask(vid('n1', NEWER), channel(), 1).line)
      .toContain('RSS');
    expect(buildChannelVideoTask(vid('n1', NEWER, { source: 'fallback' }), channel(), 1).line)
      .toContain('yt-dlp 備援');
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
