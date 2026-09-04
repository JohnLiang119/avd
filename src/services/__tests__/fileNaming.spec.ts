import { describe, it, expect } from 'vitest';
import {
  sanitizeTitleForFile,
  formatFileTimestamp,
  buildDownloadFileName,
  nextAvailableName,
  FILENAME_TITLE_MAX,
  FILENAME_COLLISION_MAX_TRIES
} from '../fileNaming';

/** 2026/06/29 03:50:12（本地時間） */
const T = new Date(2026, 5, 29, 3, 50, 12).getTime();

describe('sanitizeTitleForFile', () => {
  it('非法字元替換為底線', () => {
    expect(sanitizeTitleForFile('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('截斷至上限字元數', () => {
    const long = 'x'.repeat(FILENAME_TITLE_MAX + 20);
    expect(sanitizeTitleForFile(long)).toHaveLength(FILENAME_TITLE_MAX);
  });

  it('去除尾端句點與空白（Windows 不接受句點結尾）', () => {
    expect(sanitizeTitleForFile('  片名...  ')).toBe('片名');
  });

  it('空標題與 undefined 皆回傳空字串', () => {
    expect(sanitizeTitleForFile('')).toBe('');
    expect(sanitizeTitleForFile(undefined as any)).toBe('');
  });
});

describe('formatFileTimestamp', () => {
  it('格式為 yyyyMMdd_HHmmss 且補零', () => {
    expect(formatFileTimestamp(T)).toBe('20260629_035012');
  });

  it('無效或缺漏的時間回傳空字串', () => {
    expect(formatFileTimestamp(0)).toBe('');
    expect(formatFileTimestamp(undefined)).toBe('');
    expect(formatFileTimestamp(-1)).toBe('');
    expect(formatFileTimestamp(NaN)).toBe('');
  });
});

describe('buildDownloadFileName', () => {
  it('標題相同但發布時間不同的影片得到互異的檔名', () => {
    // 這正是本次的缺陷情境：TikTok 同一創作者的描述一字不差。
    const title = '#ちいかわ #chiikawa #吉伊卡哇';
    const a = buildDownloadFileName(title, new Date(2026, 5, 29, 3, 50, 12).getTime());
    const b = buildDownloadFileName(title, new Date(2026, 5, 29, 3, 49, 47).getTime());
    const c = buildDownloadFileName(title, new Date(2026, 5, 29, 3, 49, 32).getTime());
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toBe('#ちいかわ #chiikawa #吉伊卡哇__20260629_035012');
  });

  it('以雙底線分隔標題與時間戳', () => {
    expect(buildDownloadFileName('片名', T)).toBe('片名__20260629_035012');
  });

  it('無發布時間時退回僅使用標題', () => {
    expect(buildDownloadFileName('片名', 0)).toBe('片名');
    expect(buildDownloadFileName('片名')).toBe('片名');
  });

  it('無標題但有時間時仍產生可辨識的名稱', () => {
    expect(buildDownloadFileName('', T)).toBe('video_20260629_035012');
  });

  it('兩者皆無時退回帶當下毫秒的名稱', () => {
    expect(buildDownloadFileName('', 0)).toMatch(/^video_\d+$/);
  });

  it('截斷發生在接上時間戳之前，時間戳不會被截掉', () => {
    const long = 'y'.repeat(FILENAME_TITLE_MAX + 20);
    const name = buildDownloadFileName(long, T);
    expect(name).toBe('y'.repeat(FILENAME_TITLE_MAX) + '__20260629_035012');
  });
});

describe('nextAvailableName', () => {
  const taken = (...names: string[]) => {
    const set = new Set(names);
    return (n: string) => set.has(n);
  };

  it('名稱未被占用時直接使用', async () => {
    expect(await nextAvailableName('片名', 'mp4', taken())).toBe('片名.mp4');
  });

  it('被占用時遞增後綴', async () => {
    expect(await nextAvailableName('片名', 'mp4', taken('片名.mp4'))).toBe('片名_1.mp4');
    expect(await nextAvailableName('片名', 'mp4', taken('片名.mp4', '片名_1.mp4')))
      .toBe('片名_2.mp4');
  });

  it('支援非同步的存在性判斷', async () => {
    const asyncTaken = async (n: string) => n === '片名.mp4';
    expect(await nextAvailableName('片名', 'mp4', asyncTaken)).toBe('片名_1.mp4');
  });

  it('超過嘗試上限時退回帶毫秒的名稱，不會無窮迴圈', async () => {
    const alwaysTaken = () => true;
    const name = await nextAvailableName('片名', 'mp4', alwaysTaken, 5);
    expect(name).toMatch(/^片名_\d{10,}\.mp4$/);
  });

  it('嘗試上限預設值有限，確保不會卡住', () => {
    expect(FILENAME_COLLISION_MAX_TRIES).toBeGreaterThan(0);
    expect(FILENAME_COLLISION_MAX_TRIES).toBeLessThanOrEqual(1000);
  });

  it('無副檔名時不加句點', async () => {
    expect(await nextAvailableName('片名', '', taken())).toBe('片名');
  });
});
