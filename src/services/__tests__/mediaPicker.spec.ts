import { describe, it, expect } from 'vitest';

import {
  normalizeMediaList,
  sortMediaFiles,
  filterMediaFiles,
  filterMediaKind,
  countMediaKinds,
  toggleMediaSelection,
  formatMediaSize,
  formatMediaDuration,
  formatMediaDate,
  describeMediaFolder,
  describeMediaPermission,
  describeFullScan,
  type DeviceMediaFile,
} from '../mediaPicker';

const file = (over: Partial<DeviceMediaFile>): DeviceMediaFile => ({
  uri: 'content://media/external/audio/media/1',
  displayName: 'a.mp3',
  folder: 'Music',
  kind: 'audio',
  sizeBytes: 1000,
  modifiedAt: 1_700_000_000_000,
  durationMs: 0,
  ...over,
});

describe('normalizeMediaList', () => {
  it('轉成型別安全的清單，數值欄位不合法時為 0', () => {
    const list = normalizeMediaList({
      files: [
        { uri: ' content://media/external/video/media/9 ', displayName: ' clip.mp4 ', folder: 'Movies/AVD', kind: 'video', sizeBytes: '2048', modifiedAt: 1700000000000, durationMs: -5 },
      ],
      truncated: 1,
      audioGranted: true,
      videoGranted: false,
    });
    expect(list.files).toEqual([
      { uri: 'content://media/external/video/media/9', displayName: 'clip.mp4', folder: 'Movies/AVD', kind: 'video', sizeBytes: 2048, modifiedAt: 1700000000000, durationMs: 0 },
    ]);
    expect(list.truncated).toBe(true);
    expect(list.audioGranted).toBe(true);
    expect(list.videoGranted).toBe(false);
    expect(list.fullAccess).toBe(false);
    expect(list.scannedAt).toBe(0);
  });

  it('完整掃描的狀態', () => {
    const list = normalizeMediaList({ files: [], fullAccess: true, scannedAt: 1700000000000 });
    expect(list.fullAccess).toBe(true);
    expect(list.scannedAt).toBe(1700000000000);
  });

  it('剔除缺 uri 或檔名的列，重複的 uri 只留第一個，未知 kind 當音訊', () => {
    const list = normalizeMediaList({
      files: [
        { uri: '', displayName: 'x.mp3' },
        { uri: 'content://media/external/audio/media/1', displayName: '' },
        { uri: 'content://media/external/audio/media/2', displayName: 'first.mp3', kind: '???' },
        { uri: 'content://media/external/audio/media/2', displayName: 'dup.mp3' },
        null,
      ],
    });
    expect(list.files.map((f) => f.displayName)).toEqual(['first.mp3']);
    expect(list.files[0].kind).toBe('audio');
  });

  it('原生端回傳壞掉時是空清單、無權限', () => {
    expect(normalizeMediaList(undefined)).toEqual({ files: [], truncated: false, audioGranted: false, videoGranted: false, fullAccess: false, scannedAt: 0 });
  });
});

describe('sortMediaFiles', () => {
  const old = file({ uri: 'u1', displayName: '第10集.mp3', modifiedAt: 1000, sizeBytes: 300 });
  const mid = file({ uri: 'u2', displayName: '第2集.mp3', modifiedAt: 2000, sizeBytes: 100 });
  const recent = file({ uri: 'u3', displayName: 'Alarm.mp4', modifiedAt: 3000, sizeBytes: 200, kind: 'video' });

  it('預設日期新到舊', () => {
    expect(sortMediaFiles([old, recent, mid], 'date').map((f) => f.uri)).toEqual(['u3', 'u2', 'u1']);
  });

  it('名稱：數字依數值（第2集在第10集前）', () => {
    const names = sortMediaFiles([old, recent, mid], 'name').map((f) => f.displayName);
    expect(names.indexOf('第2集.mp3')).toBeLessThan(names.indexOf('第10集.mp3'));
  });

  it('大小：大到小', () => {
    expect(sortMediaFiles([old, recent, mid], 'size').map((f) => f.uri)).toEqual(['u1', 'u3', 'u2']);
  });

  it('同值時以日期新到舊定序，且不改動輸入', () => {
    const a = file({ uri: 'a', sizeBytes: 5, modifiedAt: 10 });
    const b = file({ uri: 'b', sizeBytes: 5, modifiedAt: 20 });
    const input = [a, b];
    expect(sortMediaFiles(input, 'size').map((f) => f.uri)).toEqual(['b', 'a']);
    expect(input.map((f) => f.uri)).toEqual(['a', 'b']);
  });
});

describe('filterMediaFiles', () => {
  const files = [
    file({ uri: '1', displayName: '中廣早報 1106.mp3', folder: 'Music/AVD' }),
    file({ uri: '2', displayName: 'Morning Song.MP4', folder: 'Download' }),
    file({ uri: '3', displayName: 'voice.mp3', folder: 'Recordings' }),
  ];

  it('空字串回傳全部', () => {
    expect(filterMediaFiles(files, '   ')).toHaveLength(3);
  });

  it('比對檔名與資料夾，不分大小寫', () => {
    expect(filterMediaFiles(files, 'morning').map((f) => f.uri)).toEqual(['2']);
    expect(filterMediaFiles(files, 'avd').map((f) => f.uri)).toEqual(['1']);
    expect(filterMediaFiles(files, 'DOWNLOAD').map((f) => f.uri)).toEqual(['2']);
  });

  it('多個詞須全部符合', () => {
    expect(filterMediaFiles(files, '早報 avd').map((f) => f.uri)).toEqual(['1']);
    expect(filterMediaFiles(files, '早報 download')).toEqual([]);
  });
});

describe('filterMediaKind／countMediaKinds', () => {
  const files = [
    file({ uri: '1', displayName: 'a.mp3', kind: 'audio' }),
    file({ uri: '2', displayName: 'b.mp4', kind: 'video' }),
    file({ uri: '3', displayName: 'c.mp3', kind: 'audio' }),
  ];

  it('全部、只看 mp3、只看 mp4，順序不變且不改動輸入', () => {
    expect(filterMediaKind(files, 'all').map((f) => f.uri)).toEqual(['1', '2', '3']);
    expect(filterMediaKind(files, 'audio').map((f) => f.uri)).toEqual(['1', '3']);
    expect(filterMediaKind(files, 'video').map((f) => f.uri)).toEqual(['2']);
    expect(files).toHaveLength(3);
  });

  it('各種類的數量', () => {
    expect(countMediaKinds(files)).toEqual({ all: 3, audio: 2, video: 1 });
    expect(countMediaKinds([])).toEqual({ all: 0, audio: 0, video: 0 });
  });
});

describe('toggleMediaSelection', () => {
  it('勾選接在尾端，順序即加入順序', () => {
    let selected: string[] = [];
    selected = toggleMediaSelection(selected, 'b');
    selected = toggleMediaSelection(selected, 'a');
    selected = toggleMediaSelection(selected, 'c');
    expect(selected).toEqual(['b', 'a', 'c']);
  });

  it('取消勾選後面的往前補位，不改動輸入', () => {
    const before = ['b', 'a', 'c'];
    expect(toggleMediaSelection(before, 'a')).toEqual(['b', 'c']);
    expect(before).toEqual(['b', 'a', 'c']);
  });
});

describe('格式化', () => {
  it('大小', () => {
    expect(formatMediaSize(0)).toBe('');
    expect(formatMediaSize(300)).toBe('1 KB');
    expect(formatMediaSize(850 * 1024)).toBe('850 KB');
    expect(formatMediaSize(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatMediaSize(1.25 * 1024 * 1024 * 1024)).toBe('1.25 GB');
  });

  it('長度', () => {
    expect(formatMediaDuration(0)).toBe('');
    expect(formatMediaDuration(245_000)).toBe('4:05');
    expect(formatMediaDuration(59_600)).toBe('1:00');
    expect(formatMediaDuration(3_723_000)).toBe('1:02:03');
  });

  it('日期：今天、昨天、今年、更早', () => {
    const now = new Date(2026, 10, 10, 9, 0);
    expect(formatMediaDate(new Date(2026, 10, 10, 8, 31).getTime(), now)).toBe('今天 08:31');
    expect(formatMediaDate(new Date(2026, 10, 9, 21, 10).getTime(), now)).toBe('昨天 21:10');
    expect(formatMediaDate(new Date(2026, 0, 3, 7, 5).getTime(), now)).toBe('01/03 07:05');
    expect(formatMediaDate(new Date(2025, 10, 8, 7, 5).getTime(), now)).toBe('2025/11/08');
    expect(formatMediaDate(0, now)).toBe('');
  });

  it('跨年的昨天仍是昨天', () => {
    const now = new Date(2026, 0, 1, 6, 0);
    expect(formatMediaDate(new Date(2025, 11, 31, 23, 50).getTime(), now)).toBe('昨天 23:50');
  });

  it('資料夾：根目錄有文字', () => {
    expect(describeMediaFolder('Music/AVD')).toBe('Music/AVD');
    expect(describeMediaFolder('')).toBe('根目錄');
  });
});

describe('describeMediaPermission', () => {
  it('全部允許時安靜', () => {
    expect(describeMediaPermission({ audioGranted: true, videoGranted: true })).toBe('');
  });

  it('缺哪類說哪類', () => {
    expect(describeMediaPermission({ audioGranted: false, videoGranted: false })).toContain('音樂與影片');
    expect(describeMediaPermission({ audioGranted: false, videoGranted: true })).toContain('mp3');
    expect(describeMediaPermission({ audioGranted: true, videoGranted: false })).toContain('mp4');
  });
});

describe('describeFullScan', () => {
  const now = new Date(2026, 10, 11, 9, 0);

  it('未開所有檔案存取權時說明清單可能不完整', () => {
    expect(describeFullScan({ fullAccess: false, scannedAt: 0 }, now)).toContain('所有檔案存取權');
  });

  it('已開時說明用的是哪一次的掃描紀錄', () => {
    const scannedAt = new Date(2026, 10, 10, 21, 10).getTime();
    expect(describeFullScan({ fullAccess: true, scannedAt }, now)).toBe('已掃描全部資料夾（昨天 21:10）');
    expect(describeFullScan({ fullAccess: true, scannedAt: 0 }, now)).toBe('已掃描全部資料夾');
  });

  it('已開所有檔案存取權時不再提讀取媒體的權限', () => {
    expect(describeMediaPermission({ audioGranted: false, videoGranted: false, fullAccess: true })).toBe('');
  });
});
