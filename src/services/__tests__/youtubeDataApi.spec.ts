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
  selectFirstChannel,
  fetchChannelVideosViaApi,
  describeApiQuotaDegraded,
  describeApiKeyRejected,
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

describe('通道選擇', () => {
  const NOW = Date.parse('2026-09-09T19:00:00Z');

  it('未設金鑰一律走 RSS', () => {
    expect(selectFirstChannel({ apiKey: '', now: NOW })).toBe('rss');
    expect(selectFirstChannel({ apiKey: '   ', now: NOW })).toBe('rss');
  });

  it('已設金鑰且未抑制走 API', () => {
    expect(selectFirstChannel({ apiKey: FAKE_KEY, now: NOW })).toBe('api');
  });

  it('配額抑制中走 RSS，抑制時點已過恢復 API', () => {
    expect(selectFirstChannel({ apiKey: FAKE_KEY, now: NOW, quotaSuppressedUntil: NOW + 3600000 })).toBe('rss');
    expect(selectFirstChannel({ apiKey: FAKE_KEY, now: NOW, quotaSuppressedUntil: NOW - 1 })).toBe('api');
  });

  it('金鑰無效抑制中走 RSS，更換金鑰後恢復 API', () => {
    const rejected = apiKeyFingerprint(FAKE_KEY);
    expect(selectFirstChannel({ apiKey: FAKE_KEY, now: NOW, rejectedKeyFingerprint: rejected })).toBe('rss');
    // 換了金鑰 —— 指紋不符，抑制自動解除
    expect(selectFirstChannel({ apiKey: 'AIzaANOTHERKEY', now: NOW, rejectedKeyFingerprint: rejected })).toBe('api');
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
    expect(describeApiQuotaDegraded()).not.toBe(describeApiKeyRejected());
  });

  it('配額耗盡明說會自動恢復，避免使用者做無效處理', () => {
    const msg = describeApiQuotaDegraded();
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
    for (const msg of [describeApiQuotaDegraded(), describeApiKeyRejected()]) {
      expect(msg).not.toContain('AIza');
      expect(msg).not.toContain(FAKE_KEY);
    }
  });
});
