import { describe, it, expect } from 'vitest';

import {
  NFC_HISTORY_MAX,
  NFC_DEDUP_WINDOW_MS,
  appendNfcHistory,
  sanitizeNfcHistory,
  describeUidLength,
  type NfcHistoryEntry,
} from '../nfcReader';

const T0 = 1_700_000_000_000;

const entry = (uid: string, at: number): NfcHistoryEntry => ({ uid, at });

describe('appendNfcHistory', () => {
  it('新卡插到最前面，其餘順序不變', () => {
    const list = [entry('B', T0 - 10_000), entry('A', T0 - 20_000)];
    const next = appendNfcHistory(list, 'C', T0);
    expect(next.map(e => e.uid)).toEqual(['C', 'B', 'A']);
    expect(next[0].at).toBe(T0);
  });

  it('3 秒內同一張卡只更新時間、不新增', () => {
    const list = [entry('A', T0)];
    const next = appendNfcHistory(list, 'A', T0 + NFC_DEDUP_WINDOW_MS - 1);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual(entry('A', T0 + NFC_DEDUP_WINDOW_MS - 1));
  });

  it('超過 3 秒後同一張卡新增一筆', () => {
    const list = [entry('A', T0)];
    const next = appendNfcHistory(list, 'A', T0 + NFC_DEDUP_WINDOW_MS);
    expect(next).toHaveLength(2);
    expect(next[0].at).toBe(T0 + NFC_DEDUP_WINDOW_MS);
    expect(next[1].at).toBe(T0);
  });

  it('去重只看最新一筆：中間讀過別張卡，再讀回來是新的一筆', () => {
    const list = [entry('B', T0 - 500), entry('A', T0 - 1000)];
    const next = appendNfcHistory(list, 'A', T0);
    expect(next.map(e => e.uid)).toEqual(['A', 'B', 'A']);
  });

  it('第 51 筆擠掉最舊的一筆，總數維持 50', () => {
    const list: NfcHistoryEntry[] = [];
    for (let i = 0; i < NFC_HISTORY_MAX; i++) {
      list.push(entry(`U${NFC_HISTORY_MAX - i}`, T0 - (i + 1) * 10_000));
    }
    expect(list).toHaveLength(NFC_HISTORY_MAX);
    const oldest = list[list.length - 1].uid;

    const next = appendNfcHistory(list, 'NEW', T0);
    expect(next).toHaveLength(NFC_HISTORY_MAX);
    expect(next[0].uid).toBe('NEW');
    expect(next.some(e => e.uid === oldest)).toBe(false);
  });

  it('不改動輸入陣列', () => {
    const list = [entry('A', T0)];
    const snapshot = JSON.stringify(list);
    appendNfcHistory(list, 'B', T0 + 1);
    appendNfcHistory(list, 'A', T0 + 1);
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

describe('sanitizeNfcHistory', () => {
  it('非陣列回空', () => {
    expect(sanitizeNfcHistory(null)).toEqual([]);
    expect(sanitizeNfcHistory(undefined)).toEqual([]);
    expect(sanitizeNfcHistory('[]')).toEqual([]);
    expect(sanitizeNfcHistory({ uid: 'A', at: T0 })).toEqual([]);
  });

  it('濾掉非物件、uid 非字串或空字串、at 非有限數字的項目，其餘照原順序保留', () => {
    const raw = [
      entry('A', T0),
      null,
      'x',
      { uid: 123, at: T0 },
      { uid: '', at: T0 },
      { uid: 'B', at: 'T0' },
      { uid: 'C', at: Number.NaN },
      { uid: 'D', at: Number.POSITIVE_INFINITY },
      { uid: 'E' },
      entry('F', T0 - 1),
    ];
    expect(sanitizeNfcHistory(raw)).toEqual([entry('A', T0), entry('F', T0 - 1)]);
  });

  it('多餘欄位被剔除，只留 uid 與 at', () => {
    const raw = [{ uid: 'A', at: T0, note: 'x' }];
    expect(sanitizeNfcHistory(raw)).toEqual([entry('A', T0)]);
  });

  it('超過 50 筆時截斷至 50，保留前面的', () => {
    const raw: NfcHistoryEntry[] = [];
    for (let i = 0; i < NFC_HISTORY_MAX + 7; i++) raw.push(entry(`U${i}`, T0 - i));
    const clean = sanitizeNfcHistory(raw);
    expect(clean).toHaveLength(NFC_HISTORY_MAX);
    expect(clean[0].uid).toBe('U0');
    expect(clean[NFC_HISTORY_MAX - 1].uid).toBe(`U${NFC_HISTORY_MAX - 1}`);
  });

  it('壞資料夾在中間時，截斷仍以合格筆數計', () => {
    const raw: unknown[] = [];
    for (let i = 0; i < NFC_HISTORY_MAX + 3; i++) {
      raw.push(i % 2 === 0 ? null : entry(`U${i}`, T0 - i));
    }
    const clean = sanitizeNfcHistory(raw);
    expect(clean.length).toBe(Math.floor((NFC_HISTORY_MAX + 3) / 2));
    expect(clean.every(e => e.uid.startsWith('U'))).toBe(true);
  });
});

describe('describeUidLength', () => {
  it('4 byte 以下不提示', () => {
    expect(describeUidLength(4)).toBe('');
    expect(describeUidLength(0)).toBe('');
  });

  it('7 與 10 byte 提示長度', () => {
    expect(describeUidLength(7)).toContain('7 byte');
    expect(describeUidLength(10)).toContain('10 byte');
  });
});
