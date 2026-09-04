import { describe, it, expect } from 'vitest';
import {
  appendErrorEntry,
  formatErrorLog,
  sortedForDisplay,
  ERROR_LOG_LIMIT,
  type ErrorEntry
} from '../useErrorLog';

const T = (h: number, mi = 0, s = 0) => new Date(2026, 8, 4, h, mi, s).getTime();

const entry = (context: string, message: string, time = T(10)): ErrorEntry =>
  ({ time, context, message });

describe('appendErrorEntry', () => {
  it('附加至末端', () => {
    const a = entry('解析播放清單', 'ERROR A');
    const b = entry('匯出頻道清單', 'ERROR B');
    expect(appendErrorEntry([a], b).map(e => e.message)).toEqual(['ERROR A', 'ERROR B']);
  });

  it('不就地修改輸入', () => {
    const list = [entry('X', 'A')];
    appendErrorEntry(list, entry('Y', 'B'));
    expect(list).toHaveLength(1);
  });

  it('超出上限時捨棄最舊者', () => {
    let list: ErrorEntry[] = [];
    for (let i = 1; i <= 5; i++) list = appendErrorEntry(list, entry('C', `E${i}`), 3);
    expect(list.map(e => e.message)).toEqual(['E3', 'E4', 'E5']);
  });

  it('預設上限為 50', () => {
    let list: ErrorEntry[] = [];
    for (let i = 0; i < ERROR_LOG_LIMIT + 10; i++) list = appendErrorEntry(list, entry('C', `E${i}`));
    expect(list).toHaveLength(ERROR_LOG_LIMIT);
    expect(list[list.length - 1].message).toBe(`E${ERROR_LOG_LIMIT + 9}`);
  });

  it('上限至少為 1，不會產生空日誌', () => {
    expect(appendErrorEntry([entry('C', 'A')], entry('C', 'B'), 0).map(e => e.message)).toEqual(['B']);
  });

  it('容忍未初始化的日誌', () => {
    expect(appendErrorEntry(undefined as any, entry('C', 'A'))).toHaveLength(1);
  });

  it('長訊息不被截斷', () => {
    const long = 'ERROR: ' + 'x'.repeat(2000);
    const [got] = appendErrorEntry([], entry('C', long));
    expect(got.message).toHaveLength(long.length);
  });
});

describe('formatErrorLog', () => {
  it('最新的在最上面，每筆一段', () => {
    const list = [
      entry('解析播放清單', 'ERROR A', T(10, 0, 0)),
      entry('匯出頻道清單', 'ERROR B', T(11, 30, 15)),
    ];
    expect(formatErrorLog(list)).toBe(
      '[2026/09/04 11:30:15] 匯出頻道清單\nERROR B\n\n' +
      '[2026/09/04 10:00:00] 解析播放清單\nERROR A'
    );
  });

  it('時間補零', () => {
    expect(formatErrorLog([entry('C', 'M', new Date(2026, 0, 5, 3, 4, 5).getTime())]))
      .toContain('[2026/01/05 03:04:05]');
  });

  it('空日誌給出可讀的說明而非空字串', () => {
    expect(formatErrorLog([])).toBe('目前沒有錯誤紀錄');
    expect(formatErrorLog(undefined as any)).toBe('目前沒有錯誤紀錄');
  });

  it('時間無效時不拋例外', () => {
    expect(formatErrorLog([entry('C', 'M', NaN)])).toContain('時間不明');
  });

  it('不就地反轉輸入', () => {
    const list = [entry('C', 'A', T(10)), entry('C', 'B', T(11))];
    formatErrorLog(list);
    expect(list.map(e => e.message)).toEqual(['A', 'B']);
  });

  it('輸出為純文字，不含 JSON 的引號與跳脫', () => {
    const out = formatErrorLog([entry('解析', 'ERROR: "quoted" \\ path')]);
    expect(out).toContain('ERROR: "quoted" \\ path');
    expect(out.startsWith('[')).toBe(true);
    expect(out).not.toContain('\\"');
  });
});

describe('sortedForDisplay', () => {
  it('由新至舊，且不就地修改', () => {
    const list = [entry('C', 'A'), entry('C', 'B')];
    expect(sortedForDisplay(list).map(e => e.message)).toEqual(['B', 'A']);
    expect(list.map(e => e.message)).toEqual(['A', 'B']);
  });

  it('容忍未初始化的日誌', () => {
    expect(sortedForDisplay(undefined as any)).toEqual([]);
  });
});
