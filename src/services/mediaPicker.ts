/**
 * 鬧鐘選檔清單（OpenSpec live-radio-alarm design.md D19）的純函式：
 * 正規化原生端回傳、排序、搜尋、勾選順序、顯示格式。
 *
 * 刻意不匯入任何平台模組（`@capacitor/*`），讓 vitest 直接引用 —— 插件封裝在
 * `radioAlarm.ts` 的 `RadioAlarmService`，畫面在 `components/RadioMediaPicker.vue`。
 */

/** 手機上的一個 mp3／mp4（MediaStore 的一列）。uri 是 content://media/…，複製時用。 */
export interface DeviceMediaFile {
  uri: string;
  displayName: string;
  /** 所在資料夾，如 `Music/AVD`；在儲存區根目錄時為空字串 */
  folder: string;
  kind: 'audio' | 'video';
  sizeBytes: number;
  /** 修改時間（毫秒）；未知為 0 */
  modifiedAt: number;
  /** 長度（毫秒）；未知為 0 */
  durationMs: number;
}

export interface DeviceMediaList {
  files: DeviceMediaFile[];
  /** 超過原生端上限，只列最新的那些 */
  truncated: boolean;
  /** 讀得到別的 App 的 mp3（有讀取音訊權限） */
  audioGranted: boolean;
  /** 讀得到別的 App 的 mp4（有讀取影片權限） */
  videoGranted: boolean;
  /** 已開「所有檔案存取權」，清單含完整掃描的結果（design.md D20） */
  fullAccess: boolean;
  /** 上次完整掃描的時間（毫秒）；未開權限或從未掃描為 0 */
  scannedAt: number;
}

export type MediaSortKey = 'date' | 'name' | 'size';

export const MEDIA_SORT_OPTIONS: ReadonlyArray<{ key: MediaSortKey; label: string }> = [
  { key: 'date', label: '日期' },
  { key: 'name', label: '名稱' },
  { key: 'size', label: '大小' },
];

/** 種類篩選：全部、只看 mp3（音訊）、只看 mp4（影片）。 */
export type MediaKindFilter = 'all' | 'audio' | 'video';

export const MEDIA_KIND_OPTIONS: ReadonlyArray<{ key: MediaKindFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'audio', label: 'MP3' },
  { key: 'video', label: 'MP4' },
];

/** 依種類過濾（不改動輸入）；`all` 回傳全部。 */
export function filterMediaKind(files: readonly DeviceMediaFile[], kind: MediaKindFilter): DeviceMediaFile[] {
  return kind === 'all' ? [...files] : files.filter((f) => f.kind === kind);
}

/** 各種類的檔案數，顯示在篩選鈕上。 */
export function countMediaKinds(files: readonly DeviceMediaFile[]): Record<MediaKindFilter, number> {
  const video = files.reduce((n, f) => n + (f.kind === 'video' ? 1 : 0), 0);
  return { all: files.length, audio: files.length - video, video };
}

/** 清單一次畫幾列；其餘按「顯示更多」再畫（design.md D19「大量檔案」）。 */
export const MEDIA_PAGE_SIZE = 200;

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 原生端回傳 → 型別安全的清單；缺 uri 或檔名的列剔除，重複的 uri 只留第一個。 */
export function normalizeMediaList(raw: any): DeviceMediaList {
  const seen = new Set<string>();
  const files: DeviceMediaFile[] = [];
  for (const f of Array.isArray(raw?.files) ? raw.files : []) {
    const uri = String(f?.uri ?? '').trim();
    const displayName = String(f?.displayName ?? '').trim();
    if (!uri || !displayName || seen.has(uri)) continue;
    seen.add(uri);
    files.push({
      uri,
      displayName,
      folder: String(f?.folder ?? '').trim(),
      kind: f?.kind === 'video' ? 'video' : 'audio',
      sizeBytes: toNumber(f?.sizeBytes),
      modifiedAt: toNumber(f?.modifiedAt),
      durationMs: toNumber(f?.durationMs),
    });
  }
  return {
    files,
    truncated: Boolean(raw?.truncated),
    audioGranted: Boolean(raw?.audioGranted),
    videoGranted: Boolean(raw?.videoGranted),
    fullAccess: Boolean(raw?.fullAccess),
    scannedAt: toNumber(raw?.scannedAt),
  };
}

const nameCollator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });

/**
 * 排序（不改動輸入）：日期新到舊（預設）、名稱 A→Z（數字依數值、中文依字典序）、大小大到小。
 * 同值時一律以日期新到舊、再以名稱定序，讓清單在重新整理後不會跳動。
 */
export function sortMediaFiles(files: readonly DeviceMediaFile[], key: MediaSortKey): DeviceMediaFile[] {
  const byDate = (a: DeviceMediaFile, b: DeviceMediaFile) => b.modifiedAt - a.modifiedAt;
  const byName = (a: DeviceMediaFile, b: DeviceMediaFile) => nameCollator.compare(a.displayName, b.displayName);
  const primary = key === 'name'
    ? byName
    : key === 'size'
      ? (a: DeviceMediaFile, b: DeviceMediaFile) => b.sizeBytes - a.sizeBytes
      : byDate;
  return [...files].sort((a, b) => primary(a, b) || byDate(a, b) || byName(a, b) || a.uri.localeCompare(b.uri));
}

/**
 * 以檔名或資料夾過濾：空白分隔的每個詞都要出現在「檔名 + 資料夾」裡（不分大小寫）。
 * 空字串回傳全部。
 */
export function filterMediaFiles(files: readonly DeviceMediaFile[], query: string): DeviceMediaFile[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...files];
  return files.filter((f) => {
    const haystack = `${f.displayName}\n${f.folder}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/**
 * 勾選／取消勾選：回傳新的有序清單。勾選的先後就是加入頻道的順序（design.md D19），
 * 取消時後面的往前補位。
 */
export function toggleMediaSelection(selected: readonly string[], uri: string): string[] {
  return selected.includes(uri) ? selected.filter((u) => u !== uri) : [...selected, uri];
}

/** 檔案大小：`850 KB`、`3.4 MB`、`1.25 GB`；0 或未知為空字串。 */
export function formatMediaSize(bytes: number): string {
  if (!(bytes > 0)) return '';
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / KB))} KB`;
}

/** 長度：`4:05`、`1:02:03`；0 或未知為空字串。 */
export function formatMediaDuration(ms: number): string {
  if (!(ms > 0)) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * 日期：今天 `今天 08:31`、昨天 `昨天 21:10`、今年 `11/08 21:10`、更早 `2025/11/08`。
 * 預設依日期排序，故近的要精確到分鐘，遠的只需年月日。0 或未知為空字串。
 */
export function formatMediaDate(ms: number, now: Date = new Date()): string {
  if (!(ms > 0)) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, now)) return `今天 ${hm}`;
  if (sameDay(d, yesterday)) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** 列上顯示的資料夾；根目錄顯示「根目錄」。 */
export function describeMediaFolder(folder: string): string {
  return folder.trim() || '根目錄';
}

/**
 * 權限不足時清單上方的一行說明（正常時安靜、異常才說話）；全部有權限時為空字串。
 */
export function describeMediaPermission(
  list: Pick<DeviceMediaList, 'audioGranted' | 'videoGranted'> & Partial<Pick<DeviceMediaList, 'fullAccess'>>,
): string {
  // 已開「所有檔案存取權」時直接走訪資料夾，讀取媒體的權限缺不缺都不影響清單
  if (list.fullAccess) return '';
  if (list.audioGranted && list.videoGranted) return '';
  if (!list.audioGranted && !list.videoGranted) {
    return '未允許讀取音樂與影片，只列得到本 App 下載的檔案';
  }
  if (!list.audioGranted) return '未允許讀取音樂，mp3 只列得到本 App 下載的';
  return '未允許讀取影片，mp4 只列得到本 App 下載的';
}

/**
 * 完整掃描的狀態說明（design.md D20）。未開「所有檔案存取權」時說明清單可能不完整；
 * 已開時說明清單用的是哪一次的掃描紀錄 —— 掃完就記錄，之後開清單不重掃，要按「重新掃描」才更新。
 */
export function describeFullScan(
  list: Pick<DeviceMediaList, 'fullAccess' | 'scannedAt'>,
  now: Date = new Date(),
): string {
  if (!list.fullAccess) return '只列系統媒體庫裡的檔，可能不完整；開啟「所有檔案存取權」可掃描全部資料夾';
  const when = formatMediaDate(list.scannedAt, now);
  return when ? `已掃描全部資料夾（${when}）` : '已掃描全部資料夾';
}
