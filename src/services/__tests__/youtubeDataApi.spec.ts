import { describe, it, expect, vi } from 'vitest';
import {
  API_ROUND_LIMIT,
  LIVE_STATUS_BATCH_SIZE,
  buildPlaylistItemsRequest,
  buildVideosRequest,
  buildChannelUploadsRequest,
  uploadsPlaylistIdFor,
  parseUploadsPlaylistId,
  parsePlaylistItems,
  chunkVideoIds,
  mapLiveStatus,
  resolveLiveStatusesViaApi,
  classifyApiError,
  nextQuotaResetTime,
  apiKeyFingerprint,
  channelTrackingStatus,
  trackingUnavailableError,
  trackingUnavailableStatusOf,
  describeTrackingStatus,
  describeMissingKeyCheck,
  describeApiFetchFailure,
  buildChannelSnippetRequest,
  parseChannelTitle,
  PLAYLIST_ITEMS_FIELDS,
  VIDEOS_FIELDS,
  CHANNEL_UPLOADS_FIELDS,
  CHANNEL_SNIPPET_FIELDS,
  describeCheckProgress,
  minimumCheckIntervalMinutes,
  checkIntervalFloorMinutes,
  describeCheckIntervalFloor,
  fetchChannelVideosViaApi,
  describeApiQuotaExhausted,
  describeApiKeyRejected,
  addApiUnits,
  currentApiUnitsUsed,
  DAILY_QUOTA_UNITS,
} from '../youtubeDataApi';

/** 可辨識的假金鑰 —— 用於斷言它絕不出現在網址、指紋或訊息中 */
const FAKE_KEY = 'AIzaTESTKEY_do_not_leak_1234567890';
const CH = 'UCUexfyzlAnIiCIcUqrZDFBA';
const UU = 'UUUexfyzlAnIiCIcUqrZDFBA';

const playlistItem = (id: string, publishedAt?: string, title = `影片 ${id}`) => ({
  snippet: { title, resourceId: { videoId: id }, publishedAt },
  contentDetails: { videoId: id, videoPublishedAt: publishedAt },
});

describe('請求建構 —— 金鑰只在標頭', () => {
  it('playlistItems 請求的網址不含金鑰任何片段', () => {
    const req = buildPlaylistItemsRequest(UU, FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain('AIza');
    expect(req.url).not.toContain('key=');
    expect(req.headers['X-goog-api-key']).toBe(FAKE_KEY);
  });

  it('videos 與 channels 請求同樣不把金鑰放網址', () => {
    for (const req of [buildVideosRequest(['a', 'b'], FAKE_KEY), buildChannelUploadsRequest(CH, FAKE_KEY)]) {
      expect(req.url).not.toContain(FAKE_KEY);
      expect(req.url).not.toContain('key=');
      expect(req.headers['X-goog-api-key']).toBe(FAKE_KEY);
    }
  });

  it('批次請求以逗號串接影片識別碼', () => {
    expect(buildVideosRequest(['aaa', 'bbb', 'ccc'], FAKE_KEY).url).toContain('id=aaa%2Cbbb%2Cccc');
  });
});

describe('uploads 播放清單識別碼', () => {
  it('UC 前綴替換為 UU', () => {
    expect(uploadsPlaylistIdFor(CH)).toBe(UU);
  });

  it('非 UC 開頭回傳 null —— 呼叫端須改走 channels.list 查詢', () => {
    expect(uploadsPlaylistIdFor('HCsomethingelse')).toBeNull();
    expect(uploadsPlaylistIdFor('')).toBeNull();
    expect(uploadsPlaylistIdFor(undefined as any)).toBeNull();
  });

  it('自 channels.list 回應取出 uploads 識別碼', () => {
    const json = { items: [{ contentDetails: { relatedPlaylists: { uploads: UU } } }] };
    expect(parseUploadsPlaylistId(json)).toBe(UU);
    expect(parseUploadsPlaylistId({ items: [] })).toBeNull();
    expect(parseUploadsPlaylistId({})).toBeNull();
  });
});

describe('playlistItems 解析', () => {
  it('正常解析出識別碼、標題、精確發布時間與 api 來源', () => {
    const iso = '2026-09-09T04:05:06.000Z';
    const got = parsePlaylistItems({ items: [playlistItem('vid1', iso, '機器學習入門')] });
    expect(got).toHaveLength(1);
    expect(got[0].videoId).toBe('vid1');
    expect(got[0].title).toBe('機器學習入門');
    expect(got[0].publishedTime).toBe(Date.parse(iso));
    expect(got[0].source).toBe('api');
    expect(got[0].url).toBe('https://www.youtube.com/watch?v=vid1');
  });

  it('缺少發布時間時 publishedTime 為 0 —— 不得以當下時間替代', () => {
    const got = parsePlaylistItems({ items: [playlistItem('vid1', undefined)] });
    expect(got[0].publishedTime).toBe(0);
  });

  it('缺少影片識別碼的項目被略過', () => {
    const json = { items: [{ snippet: { title: '沒有 id' } }, playlistItem('ok', '2026-09-09T00:00:00Z')] };
    const got = parsePlaylistItems(json);
    expect(got.map(v => v.videoId)).toEqual(['ok']);
  });

  it('回應非預期形狀時回傳空陣列，不拋錯', () => {
    expect(parsePlaylistItems({})).toEqual([]);
    expect(parsePlaylistItems(null)).toEqual([]);
    expect(parsePlaylistItems({ items: 'not-an-array' })).toEqual([]);
  });
});

describe('每輪候選上限與不分頁', () => {
  it(`請求帶 maxResults=${API_ROUND_LIMIT}`, () => {
    expect(buildPlaylistItemsRequest(UU, FAKE_KEY).url).toContain(`maxResults=${API_ROUND_LIMIT}`);
    expect(API_ROUND_LIMIT).toBe(50);
  });

  it('請求不帶 pageToken —— 結構上無分頁', () => {
    expect(buildPlaylistItemsRequest(UU, FAKE_KEY).url).not.toContain('pageToken');
  });

  it('回應含 nextPageToken 時不發出後續請求（fetch 僅呼叫 1 次）', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      nextPageToken: 'CAUQAA',
      items: [playlistItem('v1', '2026-09-09T00:00:00Z'), playlistItem('v2', '2026-09-08T00:00:00Z')],
    });
    const got = await fetchChannelVideosViaApi(CH, FAKE_KEY, fetchJson);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(got.videos).toHaveLength(2);
  });
});

describe('批次分組', () => {
  it('8 支影片產生 1 批', () => {
    expect(chunkVideoIds(Array.from({ length: 8 }, (_, i) => `v${i}`))).toHaveLength(1);
  });

  it('120 支影片產生 3 批，各批 50/50/20', () => {
    const batches = chunkVideoIds(Array.from({ length: 120 }, (_, i) => `v${i}`));
    expect(batches.map(b => b.length)).toEqual([50, 50, 20]);
    expect(LIVE_STATUS_BATCH_SIZE).toBe(50);
  });

  it('空清單產生 0 批', () => {
    expect(chunkVideoIds([])).toEqual([]);
  });
});

describe('直播狀態映射 —— 與 yt-dlp live_status 等價', () => {
  it('進行中直播與排程未開播皆為 live', () => {
    expect(mapLiveStatus({ snippet: { liveBroadcastContent: 'live' } })).toBe('live');
    expect(mapLiveStatus({ snippet: { liveBroadcastContent: 'upcoming' } })).toBe('live');
  });

  it('一般影片與已結束存檔直播為 not_live', () => {
    expect(mapLiveStatus({ snippet: { liveBroadcastContent: 'none' } })).toBe('not_live');
    // 已結束的直播帶 liveStreamingDetails 但 liveBroadcastContent 為 none，可正常下載
    expect(mapLiveStatus({
      snippet: { liveBroadcastContent: 'none' },
      liveStreamingDetails: { actualStartTime: '2026-09-01T00:00:00Z', actualEndTime: '2026-09-01T02:00:00Z' },
    })).toBe('not_live');
  });

  it('缺少狀態欄位為 unknown —— 不得樂觀視為 not_live', () => {
    expect(mapLiveStatus({ snippet: {} })).toBe('unknown');
    expect(mapLiveStatus({})).toBe('unknown');
    expect(mapLiveStatus(null)).toBe('unknown');
    expect(mapLiveStatus({ snippet: { liveBroadcastContent: '' } })).toBe('unknown');
  });
});

describe('批次狀態解析的保守處置', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `v${i}`);

  it('回應未涵蓋的影片一律 unknown', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      items: ids.slice(0, 8).map(id => ({ id, snippet: { liveBroadcastContent: 'none' } })),
    });
    const got = await resolveLiveStatusesViaApi(ids, FAKE_KEY, fetchJson);
    expect(got.get('v0')).toBe('not_live');
    expect(got.get('v8')).toBe('unknown');
    expect(got.get('v9')).toBe('unknown');
  });

  it('整批請求失敗時該批全部 unknown，不得放行入佇列', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('NETWORK_ERROR:offline'));
    const got = await resolveLiveStatusesViaApi(ids, FAKE_KEY, fetchJson);
    expect(got.size).toBe(10);
    expect([...got.values()].every(v => v === 'unknown')).toBe(true);
  });

  it('批次失敗會上報錯誤，使呼叫端能觸發抑制', async () => {
    // 若在此靜默吞掉，配額耗盡就永遠不會觸發抑制，每輪都重打必然失敗的請求
    const err = new Error('HTTP_STATUS:403:quotaExceeded');
    const fetchJson = vi.fn().mockRejectedValue(err);
    const seen: unknown[] = [];
    const got = await resolveLiveStatusesViaApi(ids, FAKE_KEY, fetchJson, e => seen.push(e));
    expect(seen).toHaveLength(1);
    expect(classifyApiError(seen[0])).toBe('quota');
    // 回傳仍維持保守契約
    expect([...got.values()].every(v => v === 'unknown')).toBe(true);
  });

  it('一批失敗不影響其餘批次', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `v${i}`);
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: many.slice(50).map(id => ({ id, snippet: { liveBroadcastContent: 'none' } })) });
    const got = await resolveLiveStatusesViaApi(many, FAKE_KEY, fetchJson);
    expect(got.get('v0')).toBe('unknown');
    expect(got.get('v55')).toBe('not_live');
  });
});

describe('API 錯誤分類', () => {
  it('配額耗盡', () => {
    expect(classifyApiError({ error: { errors: [{ reason: 'quotaExceeded' }] } })).toBe('quota');
    expect(classifyApiError(new Error('HTTP_STATUS:403:dailyLimitExceeded'))).toBe('quota');
  });

  it('金鑰問題', () => {
    expect(classifyApiError(new Error('API key not valid. Please pass a valid API key.'))).toBe('key');
    expect(classifyApiError({ error: { errors: [{ reason: 'accessNotConfigured' }] } })).toBe('key');
  });

  it('其他錯誤', () => {
    expect(classifyApiError(new Error('HTTP_STATUS:500:internal'))).toBe('other');
    expect(classifyApiError(new Error('NETWORK_ERROR:dns'))).toBe('other');
    expect(classifyApiError(null)).toBe('other');
  });

  it('配額與金鑰兩類不得互相誤判', () => {
    expect(classifyApiError(new Error('quotaExceeded'))).not.toBe('key');
    expect(classifyApiError(new Error('API key not valid'))).not.toBe('quota');
  });
});

describe('配額抑制時點 —— 太平洋時間午夜', () => {
  /** 取某時間戳的太平洋當地時間字串，供斷言 */
  const pacific = (ts: number) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ts));

  it('太平洋日中觸發，解除時點落在當地午夜', () => {
    // 2026-09-09 12:00 PDT = 19:00 UTC
    const now = Date.parse('2026-09-09T19:00:00Z');
    const reset = nextQuotaResetTime(now);
    expect(reset).toBeGreaterThan(now);
    expect(pacific(reset)).toContain('09/10/2026, 00:00');
  });

  it('太平洋午夜前一分鐘觸發，解除時點為一分鐘後的當地午夜', () => {
    // 2026-09-09 23:59 PDT = 2026-09-10 06:59 UTC
    const now = Date.parse('2026-09-10T06:59:00Z');
    const reset = nextQuotaResetTime(now);
    expect(reset - now).toBeLessThanOrEqual(60 * 1000);
    expect(pacific(reset)).toContain('09/10/2026, 00:00');
  });

  it('秋季回撥日的真實邊界：天真 +24h 會差一小時，本實作校正到當地午夜', () => {
    // 轉換發生在當地 02:00，故只有 now 落在換日日 00:00–02:00 之間才會偏差。
    // 2026-11-01 為美國西岸回撥日（當地 25 小時）；00:30 PDT = 07:30 UTC。
    // 天真的「now + (24h - 當日已過毫秒)」會落在 11/01 23:00 PST —— 差一小時。
    const now = Date.parse('2026-11-01T07:30:00Z');
    const reset = nextQuotaResetTime(now);
    expect(pacific(reset)).toContain('11/02/2026, 00:00');
    // 釘住「不早於午夜」：過短會恢復每輪對每個頻道白打一次必然失敗的請求
    expect(reset - now).toBeGreaterThan(24 * 3600 * 1000);
  });

  it('春季前撥日偏晚時刻意不往回修 —— 較晚才是安全方向', () => {
    // 2026-03-08 為美國西岸前撥日（當地 23 小時）；00:30 PST = 08:30 UTC。
    // 加 24 小時會落在 03/09 01:00 PDT（偏晚一小時）。設計上刻意保留：
    // 抑制過長只是少用一段配額窗口，過短則會恢復白打。
    const now = Date.parse('2026-03-08T08:30:00Z');
    const reset = nextQuotaResetTime(now);
    expect(pacific(reset)).toContain('03/09/2026, 01:00');
    expect(reset).toBeGreaterThan(now);
  });

  it('一般日期不受校正分支影響', () => {
    for (const iso of ['2026-06-15T19:00:00Z', '2026-01-20T08:00:00Z', '2026-12-25T03:00:00Z']) {
      const now = Date.parse(iso);
      const reset = nextQuotaResetTime(now);
      const localHour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit' })
          .format(new Date(reset))
      ) % 24;
      expect(localHour).toBe(0);
      expect(reset).toBeGreaterThan(now);
    }
  });
});

describe('金鑰指紋', () => {
  it('同一金鑰得到相同指紋，不同金鑰得到不同指紋', () => {
    expect(apiKeyFingerprint(FAKE_KEY)).toBe(apiKeyFingerprint(FAKE_KEY));
    expect(apiKeyFingerprint(FAKE_KEY)).not.toBe(apiKeyFingerprint(FAKE_KEY + 'x'));
  });

  it('指紋不含金鑰任何片段', () => {
    const fp = apiKeyFingerprint(FAKE_KEY);
    expect(fp).not.toContain('AIza');
    expect(fp).not.toContain('TESTKEY');
    expect(fp).not.toContain('do_not_leak');
    expect(FAKE_KEY).not.toContain(fp);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it('前後空白不影響指紋，空金鑰得到空字串', () => {
    expect(apiKeyFingerprint(`  ${FAKE_KEY}  `)).toBe(apiKeyFingerprint(FAKE_KEY));
    expect(apiKeyFingerprint('')).toBe('');
    expect(apiKeyFingerprint('   ')).toBe('');
  });
});

describe('追蹤狀態判定', () => {
  const NOW = Date.parse('2026-09-09T19:00:00Z');

  it('未設金鑰即為停擺 —— 已無其他通道可退', () => {
    expect(channelTrackingStatus({ apiKey: '', now: NOW })).toBe('missing_key');
    expect(channelTrackingStatus({ apiKey: '   ', now: NOW })).toBe('missing_key');
  });

  it('已設金鑰且未抑制時可正常追蹤', () => {
    expect(channelTrackingStatus({ apiKey: FAKE_KEY, now: NOW })).toBe('ok');
  });

  it('配額抑制中為停擺，抑制時點已過自動恢復', () => {
    expect(channelTrackingStatus({ apiKey: FAKE_KEY, now: NOW, quotaSuppressedUntil: NOW + 3600000 }))
      .toBe('quota_exhausted');
    expect(channelTrackingStatus({ apiKey: FAKE_KEY, now: NOW, quotaSuppressedUntil: NOW - 1 })).toBe('ok');
  });

  it('金鑰無效抑制中為停擺，更換金鑰後恢復', () => {
    const rejected = apiKeyFingerprint(FAKE_KEY);
    expect(channelTrackingStatus({ apiKey: FAKE_KEY, now: NOW, rejectedKeyFingerprint: rejected }))
      .toBe('key_rejected');
    // 換了金鑰 —— 指紋不符，抑制自動解除
    expect(channelTrackingStatus({ apiKey: 'AIzaANOTHERKEY', now: NOW, rejectedKeyFingerprint: rejected }))
      .toBe('ok');
  });

  it('未設金鑰優先於任何抑制 —— 三者的解法不同，不得混為一談', () => {
    expect(channelTrackingStatus({
      apiKey: '',
      now: NOW,
      quotaSuppressedUntil: NOW + 3600000,
      rejectedKeyFingerprint: apiKeyFingerprint(FAKE_KEY),
    })).toBe('missing_key');
  });
});

describe('追蹤停擺錯誤的往返', () => {
  it('三種停擺原因皆可自錯誤原樣取回', () => {
    for (const status of ['missing_key', 'key_rejected', 'quota_exhausted'] as const) {
      expect(trackingUnavailableStatusOf(trackingUnavailableError(status))).toBe(status);
    }
  });

  it('包在其他訊息中仍可辨識 —— 邊界層可能加上前後文', () => {
    expect(trackingUnavailableStatusOf(new Error('檢查頻道失敗: CHANNEL_TRACKING_UNAVAILABLE:quota_exhausted')))
      .toBe('quota_exhausted');
  });

  it('一般錯誤不誤判為停擺，否則會把可重試的失敗當成停止追蹤', () => {
    for (const err of [
      new Error('HTTP_STATUS:500:server unavailable'),
      new Error('NETWORK_ERROR:unable to resolve host'),
      'API_CHANNEL_NOT_FOUND:UCxxx',
      null,
      undefined,
    ]) {
      expect(trackingUnavailableStatusOf(err), String(err)).toBeNull();
    }
  });
});

describe('停擺狀態指示', () => {
  const NOTICES = (['missing_key', 'key_rejected', 'quota_exhausted'] as const)
    .map(s => describeTrackingStatus(s, { quotaResetAt: Date.parse('2026-09-11T07:00:00Z') })!);

  it('正常運作時不產生任何指示', () => {
    expect(describeTrackingStatus('ok')).toBeNull();
  });

  it('三種原因的文案兩兩互異 —— 解法不同，混用會讓使用者做無效處理', () => {
    const titles = NOTICES.map(n => n.title);
    const details = NOTICES.map(n => n.detail);
    expect(new Set(titles).size).toBe(3);
    expect(new Set(details).size).toBe(3);
  });

  it('配額耗盡明說會自動恢復，未設金鑰與金鑰無效則指向使用者的動作', () => {
    const [missing, rejected, quota] = NOTICES;
    expect(missing.detail).toContain('金鑰');
    expect(rejected.detail).toContain('金鑰');
    expect(quota.detail).toContain('自動恢復');
    // 配額耗盡不得叫使用者去改金鑰 —— 那是無效處理
    expect(quota.detail).not.toContain('請於上方');
  });

  it('皆不含金鑰片段 —— 函式不接受金鑰參數即結構性保證', () => {
    for (const notice of NOTICES) {
      for (const text of [notice.title, notice.detail]) {
        expect(text).not.toContain('AIza');
        expect(text).not.toContain(FAKE_KEY);
      }
    }
  });

  it('無重置時點時仍可產生配額文案，不因缺少參數而失敗', () => {
    const notice = describeTrackingStatus('quota_exhausted')!;
    expect(notice.detail).toContain('自動恢復');
  });
});

describe('檢查間隔的安全下限', () => {
  it('下限依頻道數推導 —— 6 個約 2.5 分鐘、20 個約 8.2、50 個約 20.6', () => {
    expect(minimumCheckIntervalMinutes(6)).toBeCloseTo(2.47, 1);
    expect(minimumCheckIntervalMinutes(20)).toBeCloseTo(8.23, 1);
    expect(minimumCheckIntervalMinutes(50)).toBeCloseTo(20.57, 1);
  });

  it('0 個頻道不回傳 0 或負值 —— 那會算出「間隔可以是 0 分鐘」', () => {
    for (const n of [0, -1, NaN, undefined as any]) {
      expect(minimumCheckIntervalMinutes(n), String(n)).toBeGreaterThan(0);
      expect(checkIntervalFloorMinutes(n), String(n)).toBeGreaterThanOrEqual(1);
    }
  });

  it('可設定的下限一律向上取整，不得四捨五入到下限之下', () => {
    expect(checkIntervalFloorMinutes(6)).toBe(3);
    expect(checkIntervalFloorMinutes(20)).toBe(9);
    expect(checkIntervalFloorMinutes(50)).toBe(21);
    expect(checkIntervalFloorMinutes(6)).toBeGreaterThanOrEqual(minimumCheckIntervalMinutes(6));
  });

  it('下限隨頻道數單調遞增 —— 加頻道只會使下限提高', () => {
    let prev = 0;
    for (let n = 1; n <= 60; n++) {
      const floor = checkIntervalFloorMinutes(n);
      expect(floor).toBeGreaterThanOrEqual(prev);
      prev = floor;
    }
  });

  it('說明含下限的依據：頻道數與每日配額', () => {
    const text = describeCheckIntervalFloor(20);
    expect(text).toContain('20 個頻道');
    expect(text).toContain(String(DAILY_QUOTA_UNITS));
    expect(text).toContain('9 分鐘');
  });
});

describe('以 API 取得頻道名稱', () => {
  it('請求只取 snippet，且金鑰在標頭而非網址', () => {
    const req = buildChannelSnippetRequest(CH, FAKE_KEY);
    expect(req.url).toContain('channels');
    expect(req.url).toContain('part=snippet');
    expect(req.url).toContain(CH);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.headers['X-goog-api-key']).toBe(FAKE_KEY);
  });

  it('自回應取出名稱；缺項或形狀不符時回空字串而非拋錯', () => {
    expect(parseChannelTitle({ items: [{ snippet: { title: '測試頻道' } }] })).toBe('測試頻道');
    expect(parseChannelTitle({ items: [] })).toBe('');
    expect(parseChannelTitle({ items: [{ snippet: {} }] })).toBe('');
    expect(parseChannelTitle({})).toBe('');
    expect(parseChannelTitle(null)).toBe('');
  });
});

describe('fetchChannelVideosViaApi —— uploads 清單後備查詢', () => {
  it('前綴推導成功時直接取用，不查 channels.list', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ items: [playlistItem('v1', '2026-09-09T00:00:00Z')] });
    const got = await fetchChannelVideosViaApi(CH, FAKE_KEY, fetchJson);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(got.uploadsPlaylistId).toBe(UU);
    expect(fetchJson.mock.calls[0][0].url).toContain(UU);
  });

  it('清單不存在時改查 channels.list 並重試', async () => {
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP_STATUS:404:playlistNotFound'))
      .mockResolvedValueOnce({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUCUSTOM' } } }] })
      .mockResolvedValueOnce({ items: [playlistItem('v1', '2026-09-09T00:00:00Z')] });
    const got = await fetchChannelVideosViaApi(CH, FAKE_KEY, fetchJson);
    expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(got.uploadsPlaylistId).toBe('UUCUSTOM');
    expect(got.videos).toHaveLength(1);
  });

  it('配額耗盡不觸發後備查詢 —— 換清單識別碼也不會成功', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('HTTP_STATUS:403:quotaExceeded'));
    await expect(fetchChannelVideosViaApi(CH, FAKE_KEY, fetchJson)).rejects.toThrow('quotaExceeded');
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('已知清單識別碼時省去推導與後備', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ items: [] });
    const got = await fetchChannelVideosViaApi(CH, FAKE_KEY, fetchJson, 'UUCACHED');
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0].url).toContain('UUCACHED');
    expect(got.uploadsPlaylistId).toBe('UUCACHED');
  });

  it('後備查詢確認頻道不存在才視為頻道層級錯誤', async () => {
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP_STATUS:404:playlistNotFound'))
      .mockResolvedValueOnce({ items: [] });
    await expect(fetchChannelVideosViaApi(CH, FAKE_KEY, fetchJson)).rejects.toThrow('API_CHANNEL_NOT_FOUND');
  });
});

describe('回饋訊息片段', () => {
  it('配額耗盡與金鑰無效的文案互異', () => {
    expect(describeApiQuotaExhausted()).not.toBe(describeApiKeyRejected());
  });

  it('配額耗盡明說會自動恢復，避免使用者做無效處理', () => {
    const msg = describeApiQuotaExhausted();
    expect(msg).toContain('配額');
    expect(msg).toContain('自動恢復');
    expect(msg).not.toContain('目前沒有新影片');
  });

  it('金鑰無效指向可修正的動作，且不與配額混淆', () => {
    const msg = describeApiKeyRejected();
    expect(msg).toContain('金鑰');
    expect(msg).toContain('檢查');
    expect(msg).not.toContain('配額');
  });

  it('兩者皆不含金鑰片段 —— 函式不接受金鑰參數即結構性保證', () => {
    for (const msg of [describeApiQuotaExhausted(), describeApiKeyRejected()]) {
      expect(msg).not.toContain('AIza');
      expect(msg).not.toContain(FAKE_KEY);
    }
  });

  it('未設金鑰的回饋不與「沒有新影片」或「無法連線」混用', () => {
    const msg = describeMissingKeyCheck();
    expect(msg).toContain('金鑰');
    // 系統根本沒有檢查，顯示「沒有新影片」是假陽性
    expect(msg).not.toContain('目前沒有新影片');
    expect(msg).not.toContain('沒有新影片');
    // 系統並未發出任何請求，不是連線問題
    expect(msg).not.toContain('無法連線');
    expect(msg).not.toBe(describeApiFetchFailure());
    expect(msg).not.toBe(describeApiFetchFailure({ offline: true }));
  });

  it('擷取失敗的文案不再提及 RSS 或備援 —— 已無第二條通道', () => {
    for (const msg of [
      describeApiFetchFailure(),
      describeApiFetchFailure({ compact: true }),
      describeApiFetchFailure({ offline: true }),
      describeApiQuotaExhausted(),
      describeApiKeyRejected(),
      describeMissingKeyCheck(),
    ]) {
      expect(msg).not.toContain('RSS');
      expect(msg).not.toContain('備援');
    }
  });

  it('裝置離線與服務層失敗的措辭分開，不把兩者混用', () => {
    expect(describeApiFetchFailure({ offline: true })).toContain('裝置');
    expect(describeApiFetchFailure()).not.toContain('裝置');
    expect(describeApiFetchFailure()).not.toBe(describeApiFetchFailure({ offline: true }));
  });
});

describe('當日用量估算', () => {
  const NOON = Date.parse('2026-09-09T19:00:00Z');   // 太平洋 09/09 12:00

  it('同一配額日內累加，重置時點與 nextQuotaResetTime 一致', () => {
    const a = addApiUnits(undefined, 1, NOON);
    expect(a.used).toBe(1);
    expect(a.resetAt).toBe(nextQuotaResetTime(NOON));

    const b = addApiUnits(a, 1, NOON + 60000);
    expect(b.used).toBe(2);
    expect(b.resetAt).toBe(a.resetAt);
  });

  it('跨越重置時點後自零起算', () => {
    const before = addApiUnits(undefined, 480, NOON);
    const after = addApiUnits(before, 1, before.resetAt);
    expect(after.used).toBe(1);
    expect(after.resetAt).toBeGreaterThan(before.resetAt);
  });

  it('缺少既有狀態時視為零', () => {
    expect(addApiUnits(undefined, 3, NOON).used).toBe(3);
    expect(addApiUnits({ used: 0, resetAt: 0 }, 3, NOON).used).toBe(3);
  });

  it('顯示用的讀取在跨日後回傳 0，不會殘留昨日數字', () => {
    const counter = addApiUnits(undefined, 480, NOON);
    expect(currentApiUnitsUsed(counter, NOON + 3600000)).toBe(480);
    expect(currentApiUnitsUsed(counter, counter.resetAt)).toBe(0);
    expect(currentApiUnitsUsed(undefined, NOON)).toBe(0);
  });

  it('重啟後以持久化的狀態續計，不從零開始', () => {
    // 模擬重啟：從儲存讀回 { used, resetAt } 後再累計一次
    const persisted = { used: 480, resetAt: nextQuotaResetTime(NOON) };
    const afterRestart = addApiUnits(persisted, 1, NOON + 3600000);
    expect(afterRestart.used).toBe(481);
    expect(afterRestart.resetAt).toBe(persisted.resetAt);
    // 顯示端同樣要讀到續計值，而非 0
    expect(currentApiUnitsUsed(persisted, NOON + 3600000)).toBe(480);
  });

  it('每日上限為 10000', () => {
    expect(DAILY_QUOTA_UNITS).toBe(10000);
  });

  it('負值與非數字不會使計數倒退', () => {
    const c = addApiUnits(undefined, 5, NOON);
    expect(addApiUnits(c, -3, NOON).used).toBe(5);
    expect(addApiUnits(c, NaN as any, NOON).used).toBe(5);
  });
});

// ============================================================================
// 欄位遮罩與解析的一致性（【D-A】）
// ============================================================================
//
// 這條耦合斷裂時**不會拋錯** —— 遮罩少寫一個仍在讀的欄位，該欄位只會變成
// `undefined`，於是影片被略過或發布時間退化為 0。所以夾具刻意**由遮罩推導**
// 而非手寫：手寫的完整回應當夾具，遮罩改錯測試照樣綠燈，那就白測了。

/** 依括號深度切分，使括號內的分隔符不被誤切。 */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map(x => x.trim()).filter(Boolean);
}

/** 把 `fields` 遮罩展開為葉路徑清單。 */
function maskPaths(mask: string): string[][] {
  const out: string[][] = [];
  for (const selector of splitTop(mask, ',')) {
    const segments = splitTop(selector, '/');
    const prefix: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const grouped = /^([^(]+)\((.*)\)$/.exec(segment);
      if (grouped) {
        const base = [...prefix, grouped[1]];
        for (const sub of maskPaths(grouped[2])) out.push([...base, ...sub]);
      } else if (i === segments.length - 1) {
        out.push([...prefix, segment]);
      } else {
        prefix.push(segment);
      }
    }
  }
  return out;
}

/** 只保留 `paths` 指定的路徑，其餘一律移除（陣列逐元素套用）。 */
function pick(value: any, paths: string[][]): any {
  if (Array.isArray(value)) return value.map(v => pick(v, paths));
  if (value === null || typeof value !== 'object') return value;

  const byHead = new Map<string, string[][]>();
  for (const path of paths) {
    if (path.length === 0) continue;
    const [head, ...rest] = path;
    if (!byHead.has(head)) byHead.set(head, []);
    byHead.get(head)!.push(rest);
  }

  const out: any = {};
  for (const [head, rests] of byHead) {
    if (!(head in value)) continue;
    const isLeaf = rests.some(r => r.length === 0);
    out[head] = isLeaf ? value[head] : pick(value[head], rests.filter(r => r.length > 0));
  }
  return out;
}

/** 模擬服務端套用 `fields` 後的回應。 */
const applyMask = (json: any, mask: string) => pick(json, maskPaths(mask));

describe('遮罩展開與裁剪工具本身', () => {
  it('展開巢狀括號與斜線混用的選擇器', () => {
    expect(maskPaths('items(id,snippet/liveBroadcastContent)')).toEqual([
      ['items', 'id'],
      ['items', 'snippet', 'liveBroadcastContent'],
    ]);
    expect(maskPaths('items/snippet/title')).toEqual([['items', 'snippet', 'title']]);
    expect(maskPaths('items(a(b,c),d/e)')).toEqual([
      ['items', 'a', 'b'],
      ['items', 'a', 'c'],
      ['items', 'd', 'e'],
    ]);
  });

  it('裁剪會移除未列於遮罩的欄位，並逐元素套用於陣列', () => {
    const got = applyMask(
      { items: [{ id: 'x', extra: 1, snippet: { title: 't', description: 'd' } }], pageInfo: {} },
      'items(id,snippet/title)'
    );
    expect(got).toEqual({ items: [{ id: 'x', snippet: { title: 't' } }] });
  });
});

describe('playlistItems 遮罩與 parsePlaylistItems 一致', () => {
  /** 貼近真實的完整回應：含所有我們**不**索取的欄位 */
  const fullResponse = {
    kind: 'youtube#playlistItemListResponse',
    etag: 'etag-abc',
    nextPageToken: 'TOKEN',
    pageInfo: { totalResults: 500, resultsPerPage: 50 },
    items: [
      {
        kind: 'youtube#playlistItem',
        etag: 'etag-1',
        id: 'playlist-item-id-1',
        snippet: {
          publishedAt: '2026-09-09T01:00:00Z',
          channelId: 'UCchannel',
          title: '康普茶品質優劣原來差這麼多！',
          description: 'x'.repeat(3000),
          thumbnails: {
            default: { url: 'https://i.ytimg.com/vi/v1/default.jpg', width: 120, height: 90 },
            medium: { url: 'https://i.ytimg.com/vi/v1/mqdefault.jpg', width: 320, height: 180 },
            high: { url: 'https://i.ytimg.com/vi/v1/hqdefault.jpg', width: 480, height: 360 },
            standard: { url: 'https://i.ytimg.com/vi/v1/sddefault.jpg', width: 640, height: 480 },
            maxres: { url: 'https://i.ytimg.com/vi/v1/maxresdefault.jpg', width: 1280, height: 720 },
          },
          channelTitle: '某某頻道',
          playlistId: 'UUchannel',
          position: 0,
          resourceId: { kind: 'youtube#video', videoId: 'v1' },
          videoOwnerChannelTitle: '某某頻道',
          videoOwnerChannelId: 'UCchannel',
        },
        contentDetails: {
          videoId: 'v1',
          videoPublishedAt: '2026-09-09T01:00:00Z',
          note: '',
        },
      },
    ],
  };

  it('遮罩裁剪後解析結果與完整回應完全相同', () => {
    const masked = applyMask(fullResponse, PLAYLIST_ITEMS_FIELDS);
    expect(parsePlaylistItems(masked)).toEqual(parsePlaylistItems(fullResponse));
  });

  it('裁剪後的最小回應仍解析出完整的識別碼、標題與精確發布時間', () => {
    const got = parsePlaylistItems(applyMask(fullResponse, PLAYLIST_ITEMS_FIELDS));
    expect(got).toHaveLength(1);
    expect(got[0].videoId).toBe('v1');
    expect(got[0].title).toBe('康普茶品質優劣原來差這麼多！');
    // 0 代表發布時間退化 —— 那會使錨點永遠不推進，是本改動最需要防的靜默故障
    expect(got[0].publishedTime).toBe(Date.parse('2026-09-09T01:00:00Z'));
    expect(got[0].publishedTime).not.toBe(0);
  });

  it('遮罩確實排除了那些被丟棄的大欄位', () => {
    const masked = applyMask(fullResponse, PLAYLIST_ITEMS_FIELDS) as any;
    expect(masked.items[0].snippet.description).toBeUndefined();
    expect(masked.items[0].snippet.thumbnails).toBeUndefined();
    expect(masked.items[0].snippet.channelTitle).toBeUndefined();
    expect(masked.items[0].snippet.position).toBeUndefined();
    expect(masked.items[0].snippet.videoOwnerChannelTitle).toBeUndefined();
    expect(masked.nextPageToken).toBeUndefined();
    expect(masked.pageInfo).toBeUndefined();
  });

  it('後備欄位也在遮罩內 —— contentDetails 缺漏時仍能自 snippet 取得', () => {
    const withoutContentDetails = {
      items: [{ snippet: (fullResponse.items[0].snippet as any) }],
    };
    const got = parsePlaylistItems(applyMask(withoutContentDetails, PLAYLIST_ITEMS_FIELDS));
    expect(got[0].videoId).toBe('v1');
    expect(got[0].publishedTime).toBe(Date.parse('2026-09-09T01:00:00Z'));
  });

  it('遮罩的葉路徑集合即為程式實際讀取的欄位，不多不少', () => {
    // 這個斷言是「MUST NOT 索取系統不會讀取的欄位」的防線：
    // 往遮罩加一個沒人讀的欄位，此處就會失敗，迫使加的人說明理由。
    expect(maskPaths(PLAYLIST_ITEMS_FIELDS).map(p => p.join('/')).sort()).toEqual([
      'items/contentDetails/videoId',
      'items/contentDetails/videoPublishedAt',
      'items/snippet/publishedAt',
      'items/snippet/resourceId/videoId',
      'items/snippet/title',
    ]);
  });
});

describe('videos 遮罩與直播狀態判定一致', () => {
  const fullResponse = {
    kind: 'youtube#videoListResponse',
    etag: 'etag-v',
    pageInfo: { totalResults: 3, resultsPerPage: 3 },
    items: [
      {
        kind: 'youtube#video',
        etag: 'e1',
        id: 'live1',
        snippet: {
          title: '直播中',
          description: 'y'.repeat(2000),
          thumbnails: { default: { url: 'u', width: 1, height: 1 } },
          liveBroadcastContent: 'live',
          channelTitle: '某頻道',
          tags: ['a', 'b'],
        },
        liveStreamingDetails: { actualStartTime: '2026-09-09T00:00:00Z', concurrentViewers: '123' },
      },
      {
        id: 'vod1',
        snippet: { title: '存檔', liveBroadcastContent: 'none', description: 'z'.repeat(500) },
        liveStreamingDetails: { actualStartTime: '2026-09-01T00:00:00Z', actualEndTime: '2026-09-01T02:00:00Z' },
      },
      {
        id: 'weird1',
        snippet: { title: '沒有直播欄位', description: 'w' },
      },
    ],
  };

  it('遮罩裁剪後三態判定與完整回應完全相同', () => {
    const masked = applyMask(fullResponse, VIDEOS_FIELDS) as any;
    for (let i = 0; i < fullResponse.items.length; i++) {
      expect(mapLiveStatus(masked.items[i])).toBe(mapLiveStatus(fullResponse.items[i]));
    }
    expect(masked.items.map((x: any) => mapLiveStatus(x))).toEqual(['live', 'not_live', 'unknown']);
  });

  it('遮罩排除了從未被讀取的 liveStreamingDetails 與 description', () => {
    const masked = applyMask(fullResponse, VIDEOS_FIELDS) as any;
    expect(masked.items[0].liveStreamingDetails).toBeUndefined();
    expect(masked.items[0].snippet.description).toBeUndefined();
    expect(masked.items[0].snippet.thumbnails).toBeUndefined();
    expect(masked.items[0].snippet.title).toBeUndefined();
    // 但識別碼與直播狀態必須留著 —— 少了任一個，整批都會退化為 unknown
    expect(masked.items[0].id).toBe('live1');
    expect(masked.items[0].snippet.liveBroadcastContent).toBe('live');
  });

  it('批次解析在遮罩後的回應上仍正確對號入座', async () => {
    const masked = applyMask(fullResponse, VIDEOS_FIELDS);
    const got = await resolveLiveStatusesViaApi(
      ['live1', 'vod1', 'weird1'], FAKE_KEY, async () => masked
    );
    expect(got.get('live1')).toBe('live');
    expect(got.get('vod1')).toBe('not_live');
    expect(got.get('weird1')).toBe('unknown');
  });

  it('videos 請求不再索取 liveStreamingDetails', () => {
    const req = buildVideosRequest(['a'], FAKE_KEY);
    expect(req.url).toContain('part=snippet');
    expect(req.url).not.toContain('liveStreamingDetails');
  });

  it('遮罩的葉路徑集合即為程式實際讀取的欄位，不多不少', () => {
    expect(maskPaths(VIDEOS_FIELDS).map(p => p.join('/')).sort()).toEqual([
      'items/id',
      'items/snippet/liveBroadcastContent',
    ]);
  });
});

describe('channels 兩個遮罩與其解析一致', () => {
  const uploadsFull = {
    items: [{
      kind: 'youtube#channel',
      etag: 'e',
      id: 'UCchannel',
      contentDetails: {
        relatedPlaylists: { likes: 'LLxxx', uploads: 'UUchannel', favorites: 'FLxxx' },
      },
    }],
  };

  const snippetFull = {
    items: [{
      id: 'UCchannel',
      snippet: {
        title: '某某頻道',
        description: 'd'.repeat(1000),
        customUrl: '@someone',
        publishedAt: '2020-01-01T00:00:00Z',
        thumbnails: { high: { url: 'u', width: 800, height: 800 } },
        localized: { title: '某某頻道', description: 'd' },
        country: 'TW',
      },
    }],
  };

  it('uploads 清單識別碼在遮罩後仍取得，且無關的 relatedPlaylists 被排除', () => {
    const masked = applyMask(uploadsFull, CHANNEL_UPLOADS_FIELDS) as any;
    expect(parseUploadsPlaylistId(masked)).toBe(parseUploadsPlaylistId(uploadsFull));
    expect(parseUploadsPlaylistId(masked)).toBe('UUchannel');
    expect(masked.items[0].contentDetails.relatedPlaylists.likes).toBeUndefined();
    expect(masked.items[0].id).toBeUndefined();
  });

  it('頻道名稱在遮罩後仍取得，且 description 與縮圖被排除', () => {
    const masked = applyMask(snippetFull, CHANNEL_SNIPPET_FIELDS) as any;
    expect(parseChannelTitle(masked)).toBe(parseChannelTitle(snippetFull));
    expect(parseChannelTitle(masked)).toBe('某某頻道');
    expect(masked.items[0].snippet.description).toBeUndefined();
    expect(masked.items[0].snippet.thumbnails).toBeUndefined();
    expect(masked.items[0].snippet.localized).toBeUndefined();
  });

  it('頻道不存在時，遮罩後的空 items 仍正確回報取不到', () => {
    expect(parseUploadsPlaylistId(applyMask({ items: [] }, CHANNEL_UPLOADS_FIELDS))).toBeNull();
    expect(parseChannelTitle(applyMask({ items: [] }, CHANNEL_SNIPPET_FIELDS))).toBe('');
  });

  it('兩個遮罩的葉路徑集合即為程式實際讀取的欄位，不多不少', () => {
    expect(maskPaths(CHANNEL_UPLOADS_FIELDS).map(p => p.join('/'))).toEqual([
      'items/contentDetails/relatedPlaylists/uploads',
    ]);
    expect(maskPaths(CHANNEL_SNIPPET_FIELDS).map(p => p.join('/'))).toEqual([
      'items/snippet/title',
    ]);
  });
});

describe('四個請求皆帶遮罩，且遮罩不含金鑰片段', () => {
  it('每個請求的網址都帶 fields 參數', () => {
    for (const req of [
      buildPlaylistItemsRequest(UU, FAKE_KEY),
      buildVideosRequest(['a', 'b'], FAKE_KEY),
      buildChannelUploadsRequest(CH, FAKE_KEY),
      buildChannelSnippetRequest(CH, FAKE_KEY),
    ]) {
      expect(req.url).toContain('fields=');
      expect(req.url).not.toContain(FAKE_KEY);
      expect(req.url).not.toContain('AIza');
    }
  });
});

describe('檢查進度文案', () => {
  it('同時含已完成數、總數與當前頻道名稱', () => {
    const text = describeCheckProgress({ done: 2, total: 20, currentTitle: '某某頻道' });
    expect(text).toContain('3/20');
    expect(text).toContain('某某頻道');
  });

  it('沒有進行中的檢查時為空字串 —— 結束後不得殘留於畫面', () => {
    expect(describeCheckProgress({ done: 0, total: 0, currentTitle: '' })).toBe('');
    expect(describeCheckProgress({ done: 5, total: 0, currentTitle: '某頻道' })).toBe('');
  });

  it('頻道名稱缺漏時仍顯示計數，不產生空洞的冒號', () => {
    const text = describeCheckProgress({ done: 0, total: 3, currentTitle: '' });
    expect(text).toContain('1/3');
    expect(text.endsWith('：')).toBe(false);
  });

  it('計數不超出總數，也不出現負值', () => {
    expect(describeCheckProgress({ done: 9, total: 3, currentTitle: 'x' })).toContain('3/3');
    expect(describeCheckProgress({ done: -5, total: 3, currentTitle: 'x' })).toContain('1/3');
  });

  it('MUST NOT 含金鑰片段 —— 函式不接受金鑰參數即結構性保證', () => {
    // 頻道名稱由使用者資料而來，即使有人把金鑰貼成頻道名，文案本身也不引入金鑰
    const text = describeCheckProgress({ done: 1, total: 2, currentTitle: '正常頻道' });
    expect(text).not.toContain('AIza');
    expect(text).not.toContain(FAKE_KEY);
  });
});
