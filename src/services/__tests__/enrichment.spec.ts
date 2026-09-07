import { describe, it, expect } from 'vitest';
import {
  chunkUrls,
  parseEnrichNdjson,
  mergeEnriched,
  withinBudget,
  ENRICH_CHUNK_SIZE,
  ENRICH_BUDGET_MS,
  type EnrichableItem
} from '../enrichment';

const item = (id: string, title = `影片 ${id}`): EnrichableItem =>
  ({ id, url: `https://www.bilibili.com/video/${id}`, title });

describe('chunkUrls', () => {
  it('依塊大小切分，最後一塊可不滿', () => {
    expect(chunkUrls(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3))
      .toEqual([['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]);
  });

  it('預設塊大小為 5', () => {
    const chunks = chunkUrls(Array.from({ length: 38 }, (_, i) => `u${i}`));
    expect(ENRICH_CHUNK_SIZE).toBe(5);
    expect(chunks).toHaveLength(8);
    expect(chunks[0]).toHaveLength(5);
    expect(chunks[7]).toHaveLength(3);
  });

  it('空清單與異常塊大小皆安全', () => {
    expect(chunkUrls([])).toEqual([]);
    expect(chunkUrls(undefined as any)).toEqual([]);
    expect(chunkUrls(['a', 'b'], 0)).toEqual([['a'], ['b']]);
  });
});

describe('parseEnrichNdjson', () => {
  const line = (o: object) => JSON.stringify(o);

  it('解析標題、片長與發布時間', () => {
    const ts = Math.floor(new Date(2026, 5, 29, 3, 50, 12).getTime() / 1000);
    const got = parseEnrichNdjson(line({ id: 'BV1', title: '測試片', duration: 701, timestamp: ts }));
    expect(got).toEqual([{
      id: 'BV1',
      title: '測試片',
      durationStr: '11:41',
      publishTimeStr: '2026/06/29 03:50:12',
    }]);
  });

  it('無 timestamp 時退回 upload_date 的當日午夜', () => {
    const [got] = parseEnrichNdjson(line({ id: 'BV2', title: 'x', upload_date: '20260629' }));
    expect(got.publishTimeStr).toBe('2026/06/29 00:00:00');
  });

  it('兩者皆無時不給發布時間，而非填當下', () => {
    const [got] = parseEnrichNdjson(line({ id: 'BV3', title: 'x' }));
    expect(got.publishTimeStr).toBeUndefined();
  });

  it('多行各自成筆', () => {
    const nd = [line({ id: 'a', title: 'A' }), '', line({ id: 'b', title: 'B' })].join('\n');
    expect(parseEnrichNdjson(nd).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('壞掉的行略過，不讓整塊作廢 —— 補齊是增益', () => {
    const nd = ['{壞掉的 json', line({ id: 'ok', title: 'OK' })].join('\n');
    expect(parseEnrichNdjson(nd).map(e => e.id)).toEqual(['ok']);
  });

  it('沒有 id 的行略過（無從對回清單）', () => {
    expect(parseEnrichNdjson(line({ title: '無 id' }))).toEqual([]);
  });

  it('空輸入安全', () => {
    expect(parseEnrichNdjson('')).toEqual([]);
    expect(parseEnrichNdjson(undefined as any)).toEqual([]);
  });

  it('片長為 0 或負數視為沒有', () => {
    expect(parseEnrichNdjson(line({ id: 'a', duration: 0 }))[0].durationStr).toBeUndefined();
  });
});

describe('mergeEnriched', () => {
  const items = [item('BV1'), item('BV2'), item('BV3')];

  it('id 序列必須保持不變 —— 勾選狀態以 id 記錄', () => {
    const merged = mergeEnriched(items, [{ id: 'BV2', title: '第二片' }]);
    expect(merged.map(i => i.id)).toEqual(['BV1', 'BV2', 'BV3']);
  });

  it('標題帶入發布時間', () => {
    const merged = mergeEnriched(items, [
      { id: 'BV1', title: '第一片', publishTimeStr: '2026/06/29 03:50:12', durationStr: '3:18' },
    ]);
    expect(merged[0].title).toBe('第一片 (2026/06/29 03:50:12)');
    expect(merged[0].durationStr).toBe('3:18');
  });

  it('沒有發布時間時只放標題', () => {
    expect(mergeEnriched(items, [{ id: 'BV1', title: '第一片' }])[0].title).toBe('第一片');
  });

  it('補不到的項目原樣保留退化標籤，仍可勾選與下載', () => {
    const merged = mergeEnriched(items, [{ id: 'BV1', title: '第一片' }]);
    expect(merged[1].title).toBe('影片 BV2');
    expect(merged[2].title).toBe('影片 BV3');
  });

  it('部分失敗的結果可分批合併，先前補上的不被洗掉', () => {
    const first = mergeEnriched(items, [{ id: 'BV1', title: 'A' }]);
    const second = mergeEnriched(first, [{ id: 'BV3', title: 'C' }]);
    expect(second.map(i => i.title)).toEqual(['A', '影片 BV2', 'C']);
  });

  it('空結果直接回傳原陣列，不做無謂的重建', () => {
    expect(mergeEnriched(items, [])).toBe(items);
  });

  it('不就地修改輸入', () => {
    mergeEnriched(items, [{ id: 'BV1', title: '改過' }]);
    expect(items[0].title).toBe('影片 BV1');
  });
});

describe('withinBudget', () => {
  it('預算內為真，超出為偽', () => {
    expect(withinBudget(1000, 1000 + ENRICH_BUDGET_MS - 1)).toBe(true);
    expect(withinBudget(1000, 1000 + ENRICH_BUDGET_MS)).toBe(false);
  });

  it('補齊的預算遠寬於列表階段 —— 使用者此時已在選片，不是空等', () => {
    expect(ENRICH_BUDGET_MS).toBeGreaterThan(90000);
  });
});
