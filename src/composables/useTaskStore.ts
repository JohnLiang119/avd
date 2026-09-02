import { ref, type Ref } from 'vue';
import type { Storage } from './useStorage';

export const TASKS_STORAGE_KEY = 'avd_tasks';

/** 終態葉任務的保留上限；超出時由舊至新裁切 */
export const TERMINAL_TASK_LIMIT = 200;

/**
 * 不納入持久化與跨裝置推送的欄位。
 *
 * 前四項為下載期間的即時數值，重啟後必被重設（任務不是標為 error 就是已完成），
 * 落地沒有意義；expanded 則是單機的檢視狀態，不應同步到其他裝置。
 */
export const EPHEMERAL_TASK_FIELDS = ['progress', 'eta', 'speed', 'line', 'expanded'] as const;

export type TaskStatus = 'pending' | 'downloading' | 'success' | 'error';

export interface DownloadTask {
  id: number;
  type?: 'file';
  isGroup?: false;
  url: string;
  title?: string;
  rawTitle?: string;
  publishTimeStr?: string;
  channelPrefix?: string;
  status: TaskStatus;
  progress: number;
  eta: string;
  speed?: string;
  line: string;
  path: string;
  errorMsg: string;
  mediaUri: string;
  isAudio: boolean;
  uploadStatus?: 'idle' | 'uploading' | 'success' | 'error';
  uploadProgress?: number;
  uploadErrorMsg?: string;
  quality?: string;
  fileSizeBytes?: number;
  subFolder?: string;
}

export interface PlaylistGroupTask {
  id: number;
  type: 'playlist';
  playlistTitle: string;
  status: TaskStatus;
  expanded?: boolean;
  subTasks: DownloadTask[];
}

export interface ChannelGroupTask {
  id: number;
  type: 'channel';
  isChannelGroup: true;
  channelTitle: string;
  status: TaskStatus;
  expanded?: boolean;
  playlists: PlaylistGroupTask[];
}

export type TaskItem = DownloadTask | ChannelGroupTask;

const INTERRUPTED_ERROR_MSG = 'APP已關閉，任務中斷';
const INTERRUPTED_LINE = '任務被強制中斷';

const isTerminal = (status: TaskStatus): boolean => status === 'success' || status === 'error';
const isInterrupted = (status: TaskStatus): boolean => status === 'downloading' || status === 'pending';

/** 走訪任務樹中所有的葉任務（扁平任務與頻道群組下的子任務） */
export function forEachLeaf(items: TaskItem[], fn: (leaf: DownloadTask) => void): void {
  for (const item of items) {
    if (item.type === 'channel') {
      for (const pl of item.playlists ?? []) {
        for (const sub of pl.subTasks ?? []) fn(sub);
      }
    } else {
      fn(item as DownloadTask);
    }
  }
}

/** 計算任務樹中的葉任務總數 */
export function countLeaves(items: TaskItem[]): number {
  let n = 0;
  forEachLeaf(items, () => { n += 1; });
  return n;
}

/**
 * 持久化與跨裝置推送共用的投影：剔除瞬時與檢視狀態欄位。
 *
 * 下載期間任務樹的投影保持不變，因此進度變動不會觸發任何寫入。
 */
export function projectTasks(items: TaskItem[]): unknown[] {
  const stripLeaf = (leaf: DownloadTask): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(leaf)) {
      if ((EPHEMERAL_TASK_FIELDS as readonly string[]).includes(k)) continue;
      out[k] = v;
    }
    return out;
  };

  return items.map((item) => {
    if (item.type === 'channel') {
      return {
        id: item.id,
        type: item.type,
        isChannelGroup: item.isChannelGroup,
        channelTitle: item.channelTitle,
        status: item.status,
        playlists: (item.playlists ?? []).map((pl) => ({
          id: pl.id,
          type: pl.type,
          playlistTitle: pl.playlistTitle,
          status: pl.status,
          subTasks: (pl.subTasks ?? []).map(stripLeaf),
        })),
      };
    }
    return stripLeaf(item as DownloadTask);
  });
}

/**
 * 將中斷的任務標記為失敗。
 *
 * 群組與播放清單只在其底下確實有子任務被中斷時才標記為失敗。
 * 舊版無條件將所有頻道群組標為 error，會讓全數成功的群組在重啟後顯示為失敗。
 */
export function markInterrupted(items: TaskItem[]): void {
  const markLeaf = (leaf: DownloadTask): boolean => {
    if (!isInterrupted(leaf.status)) return false;
    leaf.status = 'error';
    leaf.errorMsg = INTERRUPTED_ERROR_MSG;
    leaf.line = INTERRUPTED_LINE;
    leaf.progress = 0;
    return true;
  };

  for (const item of items) {
    if (item.type === 'channel') {
      let channelHit = false;
      for (const pl of item.playlists ?? []) {
        let playlistHit = false;
        for (const sub of pl.subTasks ?? []) {
          if (markLeaf(sub)) playlistHit = true;
        }
        if (playlistHit || isInterrupted(pl.status)) {
          pl.status = 'error';
          playlistHit = true;
        }
        if (playlistHit) channelHit = true;
      }
      if (channelHit || isInterrupted(item.status)) item.status = 'error';
    } else {
      markLeaf(item as DownloadTask);
    }
  }
}

/** 移除已無子任務的播放清單，以及已無播放清單的頻道群組 */
export function pruneEmptyGroups(items: TaskItem[]): TaskItem[] {
  const kept: TaskItem[] = [];
  for (const item of items) {
    if (item.type === 'channel') {
      item.playlists = (item.playlists ?? []).filter((pl) => (pl.subTasks ?? []).length > 0);
      if (item.playlists.length > 0) kept.push(item);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

/**
 * 對終態葉任務套用保留上限，由舊至新（依 id）裁切。
 * pending 與 downloading 的任務永不被裁切。
 *
 * @returns 裁切後的任務樹與實際移除的筆數
 */
export function applyRetentionLimit(
  items: TaskItem[],
  limit = TERMINAL_TASK_LIMIT
): { tasks: TaskItem[]; removed: number } {
  const terminalIds: number[] = [];
  forEachLeaf(items, (leaf) => {
    if (isTerminal(leaf.status)) terminalIds.push(leaf.id);
  });

  const excess = terminalIds.length - limit;
  if (excess <= 0) return { tasks: items, removed: 0 };

  const doomed = new Set(terminalIds.sort((a, b) => a - b).slice(0, excess));

  let next = items.filter((item) => {
    if (item.type === 'channel') {
      for (const pl of item.playlists ?? []) {
        pl.subTasks = (pl.subTasks ?? []).filter((s) => !doomed.has(s.id));
      }
      return true;
    }
    return !doomed.has(item.id);
  });

  next = pruneEmptyGroups(next);
  return { tasks: next, removed: doomed.size };
}

/** 還原結果，供呼叫端決定是否提示使用者 */
export interface RestoreOutcome {
  tasks: TaskItem[];
  trimmed: number;
}

/**
 * 自原始儲存值還原任務樹：解析 → 中斷清理 → 保留上限裁切 → 空群組修剪。
 *
 * 需容忍舊格式（含 progress / eta / speed / line / expanded 等瞬時欄位）。
 */
export function restoreTasks(raw: unknown, limit = TERMINAL_TASK_LIMIT): RestoreOutcome {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('[useTaskStore] 任務樹解析失敗，改以空清單啟動', e);
      return { tasks: [], trimmed: 0 };
    }
  }
  if (!Array.isArray(parsed)) return { tasks: [], trimmed: 0 };

  const items = parsed as TaskItem[];
  markInterrupted(items);
  const { tasks, removed } = applyRetentionLimit(items, limit);
  return { tasks, trimmed: removed };
}

// ---- 純粹的統計輔助函式 ----

export const isPlaylistCompleted = (playlist: PlaylistGroupTask): boolean => {
  if (!playlist.subTasks || playlist.subTasks.length === 0) return false;
  return playlist.status === 'success' || playlist.subTasks.every((s) => s.status === 'success');
};

export const getPlaylistCompletedCount = (playlist: PlaylistGroupTask): number =>
  playlist.subTasks.filter((s) => s.status === 'success').length;

export const getPlaylistProgress = (playlist: PlaylistGroupTask): number => {
  if (!playlist.subTasks.length) return 0;
  const total = playlist.subTasks.reduce(
    (acc, cur) => acc + (cur.status === 'success' ? 100 : cur.progress || 0),
    0
  );
  return Math.round(total / playlist.subTasks.length);
};

export const getChannelCompletedCount = (channel: ChannelGroupTask): number =>
  channel.playlists.reduce((acc, pl) => acc + getPlaylistCompletedCount(pl), 0);

// ---- Store ----

export interface TaskStore {
  tasks: Ref<TaskItem[]>;
  /** 還原時被保留上限裁切掉的筆數，供呼叫端提示使用者 */
  trimmedOnRestore: Ref<number>;
  nextTaskId(): number;
  setAllExpanded(expanded: boolean): void;
  removeTaskById(id: number): void;
  removePlaylistFromChannel(channel: ChannelGroupTask, playlistId: number): void;
  removeSubTask(playlist: PlaylistGroupTask, subId: number): void;
  pruneEmpty(): void;
}

export function createTaskStore(storage: Storage): TaskStore {
  const trimmedOnRestore = ref(0);
  let idCounter = 1;

  const tasks = storage.defineSetting<TaskItem[]>(TASKS_STORAGE_KEY, [], {
    serialize: (value) => projectTasks(value),
    deserialize: (raw) => {
      const outcome = restoreTasks(raw);
      trimmedOnRestore.value = outcome.trimmed;
      const maxId = outcome.tasks.length ? Math.max(...outcome.tasks.map((t) => t.id)) : 0;
      idCounter = maxId + 1;
      return outcome.tasks;
    },
  });

  const nextTaskId = (): number => idCounter++;

  const setAllExpanded = (expanded: boolean): void => {
    for (const task of tasks.value) {
      if (task.type === 'channel') {
        task.expanded = expanded;
        for (const pl of task.playlists ?? []) pl.expanded = expanded;
      }
    }
  };

  const removeTaskById = (id: number): void => {
    tasks.value = tasks.value.filter((t) => t.id !== id);
  };

  const removePlaylistFromChannel = (channel: ChannelGroupTask, playlistId: number): void => {
    channel.playlists = channel.playlists.filter((p) => p.id !== playlistId);
    if (channel.playlists.length === 0) removeTaskById(channel.id);
  };

  const removeSubTask = (playlist: PlaylistGroupTask, subId: number): void => {
    playlist.subTasks = playlist.subTasks.filter((s) => s.id !== subId);
  };

  const pruneEmpty = (): void => {
    tasks.value = pruneEmptyGroups(tasks.value);
  };

  return {
    tasks,
    trimmedOnRestore,
    nextTaskId,
    setAllExpanded,
    removeTaskById,
    removePlaylistFromChannel,
    removeSubTask,
    pruneEmpty,
  };
}
