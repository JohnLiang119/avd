import { describe, it, expect } from 'vitest';
import {
  appendErrorEntry,
  decideJournalTransition,
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

describe('decideJournalTransition —— 持續性狀況只記轉換', () => {
  it('狀況開始時記一筆', () => {
    const got = decideJournalTransition('', 'missing_key');
    expect(got.kind).toBe('started');
    expect(got.nextJournaled).toBe('missing_key');
  });

  it('同一狀況持續時不重複寫入 —— 否則 50 筆的日誌會被同一句話灌爆', () => {
    let journaled = '';
    let writes = 0;
    // 模擬自動排程每分鐘核對一次，持續 90 分鐘
    for (let minute = 0; minute < 90; minute++) {
      const got = decideJournalTransition(journaled, 'missing_key');
      if (got.kind !== 'none') writes++;
      journaled = got.nextJournaled;
    }
    expect(writes).toBe(1);
  });

  it('原因改變時另記一筆 —— 三種停擺的解法不同，不得併為一次', () => {
    const got = decideJournalTransition('missing_key', 'key_rejected');
    expect(got.kind).toBe('changed');
    expect(got.nextJournaled).toBe('key_rejected');
  });

  it('狀況解除時記一筆，使「停了多久」可自日誌讀出', () => {
    const got = decideJournalTransition('quota_exhausted', '');
    expect(got.kind).toBe('cleared');
    expect(got.nextJournaled).toBe('');
  });

  it('本來就正常時 MUST NOT 憑空寫一筆解除', () => {
    const got = decideJournalTransition('', '');
    expect(got.kind).toBe('none');
    expect(got.nextJournaled).toBe('');
  });

  it('解除後再度發生會重新記一筆開始', () => {
    let journaled = '';
    const seq = ['missing_key', 'missing_key', '', '', 'missing_key'];
    const kinds = seq.map(current => {
      const got = decideJournalTransition(journaled, current);
      journaled = got.nextJournaled;
      return got.kind;
    });
    expect(kinds).toEqual(['started', 'none', 'cleared', 'none', 'started']);
  });

  it('一次動作走訪多個頻道時，同一個停擺原因只寫一筆', () => {
    // 實測回歸（v1.0.93）：模擬測試在未設金鑰時逐一走訪 20 個頻道，
    // 每個都拋出同一個停擺錯誤並各寫一筆，同一秒灌進 20 筆一模一樣的紀錄，
    // 把只保留 50 筆的日誌吃掉大半。此處釘住「同一原因只記一次轉換」。
    let journaled = '';
    let writes = 0;
    for (let channel = 0; channel < 20; channel++) {
      const got = decideJournalTransition(journaled, 'missing_key');
      if (got.kind !== 'none') writes++;
      journaled = got.nextJournaled;
    }
    expect(writes).toBe(1);
  });

  it('一輪正常檢查不產生任何寫入決定', () => {
    // 【紅線】日誌只有 50 筆，正常運作絕不能佔用任何一筆
    expect(decideJournalTransition('', '').kind).toBe('none');
  });
});
