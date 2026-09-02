import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  restoreTasks,
  markInterrupted,
  projectTasks,
  applyRetentionLimit,
  pruneEmptyGroups,
  countLeaves,
  forEachLeaf,
  EPHEMERAL_TASK_FIELDS,
  type TaskItem,
  type DownloadTask,
  type ChannelGroupTask,
  type TaskStatus,
} from '../useTaskStore';

const legacyFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/legacy-tasks.sample.json', import.meta.url)), 'utf-8')
) as TaskItem[];

/** 每次取用 fixture 都給一份深複本，避免測試之間互相污染 */
const fixture = (): TaskItem[] => JSON.parse(JSON.stringify(legacyFixture)) as TaskItem[];

const leaf = (id: number, status: TaskStatus): DownloadTask => ({
  id,
  type: 'file',
  url: `https://example.com/${id}`,
  status,
  progress: status === 'success' ? 100 : 0,
  eta: '',
  line: '',
  path: '',
  errorMsg: '',
  mediaUri: '',
  isAudio: false,
});

const channel = (id: number, playlistId: number, subs: DownloadTask[], status: TaskStatus = 'pending'): ChannelGroupTask => ({
  id,
  type: 'channel',
  isChannelGroup: true,
  channelTitle: `頻道 ${id}`,
  status,
  expanded: true,
  playlists: [{ id: playlistId, type: 'playlist', playlistTitle: '清單', status, expanded: true, subTasks: subs }],
});

describe('中斷任務的還原清理', () => {
  it('downloading 與 pending 皆轉為 error 並帶中斷原因', () => {
    const items: TaskItem[] = [leaf(1, 'downloading'), leaf(2, 'pending'), leaf(3, 'success')];
    markInterrupted(items);

    expect((items[0] as DownloadTask).status).toBe('error');
    expect((items[0] as DownloadTask).errorMsg).toBe('APP已關閉，任務中斷');
    expect((items[0] as DownloadTask).progress).toBe(0);
    expect((items[1] as DownloadTask).status).toBe('error');
    expect((items[2] as DownloadTask).status).toBe('success');
  });

  it('巢狀群組：子任務中斷時，該子任務與其播放清單、頻道群組皆為 error', () => {
    const items: TaskItem[] = [channel(10, 11, [leaf(12, 'success'), leaf(13, 'downloading')], 'downloading')];
    markInterrupted(items);

    const ch = items[0] as ChannelGroupTask;
    expect(ch.playlists[0].subTasks[0].status).toBe('success');
    expect(ch.playlists[0].subTasks[1].status).toBe('error');
    expect(ch.playlists[0].status).toBe('error');
    expect(ch.status).toBe('error');
  });

  it('全數成功的頻道群組不應被標記為 error（修正舊版無條件標記的缺陷）', () => {
    const items: TaskItem[] = [channel(20, 21, [leaf(22, 'success'), leaf(23, 'success')], 'success')];
    markInterrupted(items);

    const ch = items[0] as ChannelGroupTask;
    expect(ch.status).toBe('success');
    expect(ch.playlists[0].status).toBe('success');
  });

  it('清理結果具持久性：連續兩次還原後仍為 error，不會回到 downloading', () => {
    const first = restoreTasks(fixture());
    const roundTripped = JSON.parse(JSON.stringify(projectTasks(first.tasks)));
    const second = restoreTasks(roundTripped);

    const statuses: TaskStatus[] = [];
    forEachLeaf(second.tasks, (l) => statuses.push(l.status));
    expect(statuses).not.toContain('downloading');
    expect(statuses).not.toContain('pending');
  });
});

describe('持久化投影', () => {
  it('投影結果不含任何瞬時或檢視狀態欄位', () => {
    const projected = projectTasks(fixture());
    const serialized = JSON.stringify(projected);

    for (const field of EPHEMERAL_TASK_FIELDS) {
      expect(serialized).not.toContain(`"${field}"`);
    }
  });

  it('投影保留識別與領域欄位', () => {
    const items: TaskItem[] = [leaf(1, 'success')];
    const [projected] = projectTasks(items) as Array<Record<string, unknown>>;

    expect(projected.id).toBe(1);
    expect(projected.status).toBe('success');
    expect(projected.url).toBe('https://example.com/1');
  });

  it('僅進度數值變動時投影不變；狀態轉換時投影改變', () => {
    const items: TaskItem[] = [leaf(1, 'downloading')];
    const before = JSON.stringify(projectTasks(items));

    (items[0] as DownloadTask).progress = 55;
    (items[0] as DownloadTask).speed = '9.9MiB/s';
    (items[0] as DownloadTask).eta = '00:12';
    (items[0] as DownloadTask).line = '[download] 55.0%';
    expect(JSON.stringify(projectTasks(items))).toBe(before);

    (items[0] as DownloadTask).status = 'success';
    expect(JSON.stringify(projectTasks(items))).not.toBe(before);
  });

  it('巢狀群組的投影同樣剔除子任務的瞬時欄位', () => {
    const items: TaskItem[] = [channel(10, 11, [leaf(12, 'downloading')])];
    const serialized = JSON.stringify(projectTasks(items));

    expect(serialized).not.toContain('"progress"');
    expect(serialized).not.toContain('"expanded"');
    expect(serialized).toContain('"channelTitle"');
  });
});

describe('歷史保留上限', () => {
  it('超出上限時由舊至新裁切至上限', () => {
    const items: TaskItem[] = Array.from({ length: 10 }, (_, i) => leaf(i + 1, 'success'));
    const { tasks, removed } = applyRetentionLimit(items, 4);

    expect(removed).toBe(6);
    expect(countLeaves(tasks)).toBe(4);
    expect(tasks.map((t) => t.id)).toEqual([7, 8, 9, 10]);
  });

  it('活躍任務不受裁切', () => {
    const items: TaskItem[] = [
      ...Array.from({ length: 6 }, (_, i) => leaf(i + 1, 'success')),
      leaf(100, 'pending'),
      leaf(101, 'downloading'),
    ];
    const { tasks, removed } = applyRetentionLimit(items, 2);

    expect(removed).toBe(4);
    const kept = tasks.map((t) => t.id);
    expect(kept).toContain(100);
    expect(kept).toContain(101);
    expect(countLeaves(tasks)).toBe(4);
  });

  it('未超出上限時不做任何裁切', () => {
    const items: TaskItem[] = [leaf(1, 'success'), leaf(2, 'error')];
    const { tasks, removed } = applyRetentionLimit(items, 10);

    expect(removed).toBe(0);
    expect(countLeaves(tasks)).toBe(2);
  });

  it('裁切也適用於巢狀群組內的子任務', () => {
    const items: TaskItem[] = [channel(10, 11, [leaf(1, 'success'), leaf(2, 'success'), leaf(3, 'success')], 'success')];
    const { tasks, removed } = applyRetentionLimit(items, 1);

    expect(removed).toBe(2);
    expect(countLeaves(tasks)).toBe(1);
    expect((tasks[0] as ChannelGroupTask).playlists[0].subTasks[0].id).toBe(3);
  });
});

describe('空群組修剪', () => {
  it('移除無子任務的播放清單與隨之變空的頻道群組', () => {
    const items: TaskItem[] = [channel(10, 11, [], 'success'), leaf(1, 'success')];
    const pruned = pruneEmptyGroups(items);

    expect(pruned.map((t) => t.id)).toEqual([1]);
  });

  it('裁切後產生的空群組會被一併移除', () => {
    const items: TaskItem[] = [channel(10, 11, [leaf(1, 'success')], 'success'), leaf(2, 'success')];
    const { tasks } = applyRetentionLimit(items, 1);

    expect(tasks.map((t) => t.id)).toEqual([2]);
  });

  it('仍有子任務的群組會被保留', () => {
    const items: TaskItem[] = [channel(10, 11, [leaf(1, 'success')], 'success')];
    expect(pruneEmptyGroups(items).length).toBe(1);
  });
});

describe('舊格式相容性', () => {
  it('可還原含瞬時欄位的舊格式資料，任務數量與結構正確', () => {
    const { tasks, trimmed } = restoreTasks(fixture());

    expect(trimmed).toBe(0);
    expect(tasks.length).toBe(5);
    expect(countLeaves(tasks)).toBe(7);
  });

  it('舊格式中的中斷任務被正確清理', () => {
    const { tasks } = restoreTasks(fixture());

    const byStatus: Record<string, number> = {};
    forEachLeaf(tasks, (l) => { byStatus[l.status] = (byStatus[l.status] ?? 0) + 1; });

    // fixture: success 2、downloading 2、pending 2、error 1
    //   → 4 個中斷者轉為 error，加上原有的 1 個 error
    expect(byStatus.success).toBe(2);
    expect(byStatus.error).toBe(5);
    expect(byStatus.downloading).toBeUndefined();
    expect(byStatus.pending).toBeUndefined();
  });

  it('接受 JSON 字串形式的舊資料（localStorage 格式）', () => {
    const { tasks } = restoreTasks(JSON.stringify(fixture()));
    expect(countLeaves(tasks)).toBe(7);
  });

  it('解析失敗或型別不符時退回空清單而非拋出', () => {
    expect(restoreTasks('not json').tasks).toEqual([]);
    expect(restoreTasks(null).tasks).toEqual([]);
    expect(restoreTasks({ nope: true }).tasks).toEqual([]);
  });
});
