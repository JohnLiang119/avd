/**
 * 早報鬧鐘的前端側：型別、插件封裝，以及顯示與驗證用的純函式。
 *
 * **這裡刻意沒有任何 `defineSetting`。** 鬧鐘設定的權威來源在 Android 原生端
 * （見 config-persistence 規格的「原生端為權威來源的設定」）：鬧鐘必須在 WebView
 * 未執行時響，而前端的儲存埠此時讀不到。前端因此不保有可獨立寫入的副本 ——
 * 每次開啟設定介面都經插件回原生端讀，變更時整包寫回。
 *
 * 純函式與插件呼叫分開的理由與 `visualLanguage.ts` 相同：前者可被 vitest 直接驗證，
 * 而「時間輸入的把關」與「下一次是什麼時候」正是出錯時最不容易被看見的兩段。
 */

import { registerPlugin } from '@capacitor/core';

const YoutubeDlPlugin = registerPlugin<any>('YoutubeDl');

// ---- 型別 ----

/** 一筆每日觸發時間。與原生端的 RadioAlarmConfig.Entry 對應。 */
export interface RadioAlarmEntry {
  id: string;
  /** 已正規化的 HH:mm */
  time: string;
  enabled: boolean;
  durationMin: number;
}

export interface RadioAlarmConfig {
  masterEnabled: boolean;
  entries: RadioAlarmEntry[];
  /** 空字串代表使用官方來源 */
  customStreamUrl: string;
  /**
   * 應用程式內的音量比例（0–100）。
   *
   * 這是**在系統鬧鐘音量之下**的縮放，不是系統音量本身 —— 去改系統鬧鐘音量
   * 會連使用者真正的鬧鐘一起改掉。100% 即「完全照系統鬧鐘音量」。
   */
  volumePercent: number;
}

export interface RadioAlarmStatus {
  /** 下一次觸發的 epoch 毫秒；沒有任何啟用項目時為 -1 */
  nextTriggerAt: number;
  playing: boolean;
  exactAlarmAllowed: boolean;
  notificationsGranted: boolean;
  manufacturer: string;
  hasLastResult: boolean;
  lastResultTime?: number;
  lastResultSuccess?: boolean;
  lastResultMessage?: string;
}

/** 待寫入錯誤紀錄的失敗摘要（原生端在播放失敗時留下）。 */
export interface RadioAlarmJournalEntry {
  hasEntry: boolean;
  /** 事件實際發生的時間，不是取走的時間 */
  time?: number;
  message?: string;
}

/** 時間輸入的把關結果。不合法時一律附上可直接顯示的原因。 */
export type TimeValidation =
  | { ok: true; time: string }
  | { ok: false; reason: string };

// ---- 純函式：時間的把關 ----

/**
 * 正規化為 HH:mm。
 *
 * 與原生端的 `RadioAlarmConfig.normalizeTime` 採同一套規則（H:m 可接受、
 * 補零後輸出），兩邊各自有測試釘住。前端這一份存在的理由是**即時給出拒絕的原因** ——
 * 規格明訂不得靜默忽略。
 */
export function normalizeTime(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  const colon = text.indexOf(':');
  if (colon <= 0 || colon === text.length - 1) return null;

  const hourPart = text.slice(0, colon).trim();
  const minutePart = text.slice(colon + 1).trim();
  if (!/^\d{1,2}$/.test(hourPart) || !/^\d{1,2}$/.test(minutePart)) return null;

  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 新增一筆時間前的把關：格式、範圍，以及與既有清單是否重複。
 *
 * 重複的判定以正規化後的字串為準 —— 6:00 與 06:00 是同一個時刻，
 * 而使用者兩種都可能輸入。
 */
export function validateNewTime(
  entries: readonly RadioAlarmEntry[],
  raw: string | null | undefined,
): TimeValidation {
  const time = normalizeTime(raw);
  if (time === null) {
    return { ok: false, reason: '請輸入 00:00 至 23:59 之間的時間' };
  }
  if (entries.some((entry) => entry.time === time)) {
    return { ok: false, reason: `清單中已經有 ${time} 了` };
  }
  return { ok: true, time };
}

/** 播放時長的允許範圍，與原生端的常數一致。 */
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 180;
export const DEFAULT_DURATION_MIN = 30;

export function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DURATION_MIN;
  const rounded = Math.round(value);
  if (rounded < MIN_DURATION_MIN) return MIN_DURATION_MIN;
  if (rounded > MAX_DURATION_MIN) return MAX_DURATION_MIN;
  return rounded;
}

/** 音量比例的允許範圍與預設值，與原生端的常數一致。 */
export const MIN_VOLUME_PERCENT = 0;
export const MAX_VOLUME_PERCENT = 100;
export const DEFAULT_VOLUME_PERCENT = 100;

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME_PERCENT;
  const rounded = Math.round(value);
  if (rounded < MIN_VOLUME_PERCENT) return MIN_VOLUME_PERCENT;
  if (rounded > MAX_VOLUME_PERCENT) return MAX_VOLUME_PERCENT;
  return rounded;
}

/** 自訂串流網址的把關：空字串代表用官方，其餘必須是 http(s)。 */
export function validateStreamUrl(raw: string | null | undefined): { ok: boolean; reason: string } {
  const text = (raw ?? '').trim();
  if (text === '') return { ok: true, reason: '' };
  if (text.startsWith('http://') || text.startsWith('https://')) return { ok: true, reason: '' };
  return { ok: false, reason: '請輸入以 http:// 或 https:// 開頭的網址，或留空以使用官方來源' };
}

// ---- 純函式：顯示用文字 ----

const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 「下一次觸發時間」的顯示文字。
 *
 * 以裝置本地時間計算，並標出是今天、明天還是更久以後 —— 只顯示 06:00 而不說是哪天，
 * 使用者無從判斷自己剛才的變更有沒有生效。
 */
export function describeNextTrigger(config: RadioAlarmConfig, now: Date): string {
  if (!config.masterEnabled) return '已關閉';

  const active = config.entries.filter((entry) => entry.enabled);
  if (active.length === 0) return '沒有啟用中的時間';

  let earliest: Date | null = null;
  for (const entry of active) {
    const at = nextOccurrence(entry.time, now);
    if (at === null) continue;
    if (earliest === null || at.getTime() < earliest.getTime()) earliest = at;
  }
  if (earliest === null) return '沒有啟用中的時間';

  const hhmm = `${String(earliest.getHours()).padStart(2, '0')}:${String(earliest.getMinutes()).padStart(2, '0')}`;
  const days = dayDifference(now, earliest);
  if (days === 0) return `今天 ${hhmm}`;
  if (days === 1) return `明天 ${hhmm}`;
  return `${earliest.getMonth() + 1}/${earliest.getDate()}（週${WEEKDAY_LABEL[earliest.getDay()]}）${hhmm}`;
}

/**
 * 某個 HH:mm 的下一次出現。
 *
 * 與原生端的 `RadioAlarmSchedule.nextTrigger` 同一套規則，包含「恰好等於現在即算次日」——
 * 兩邊若不一致，介面顯示的時間會與實際響的時間差一天。
 */
export function nextOccurrence(time: string, now: Date): Date | null {
  const normalized = normalizeTime(time);
  if (normalized === null) return null;

  const [hour, minute] = normalized.split(':').map(Number);
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

/** 以「日曆上的天數」計算相差幾天，而非除以 86400000 —— 後者在跨日界時會差一天。 */
function dayDifference(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * 電台那一層收合時顯示的摘要。
 *
 * 兩層選單的重點在這一行：**收合著也看得出設定了什麼**，不必展開。
 * 少了它，收合就只是把資訊藏起來，那比原本的長清單更糟。
 */
export function describeStationSummary(config: RadioAlarmConfig): string {
  if (!config.masterEnabled) return '已關閉';

  const times = config.entries
    .filter((entry) => entry.enabled)
    .map((entry) => entry.time)
    .sort();

  if (times.length === 0) return '尚未設定時間';

  // 時段多起來會把這一行撐爆，超過三個就改為總數
  const shown = times.length > 3
    ? `${times.slice(0, 3).join('、')} 等 ${times.length} 個時段`
    : times.join('、');

  return `每天 ${shown} · 音量 ${config.volumePercent}%`;
}

/** 「上次播放結果」的顯示文字。三種狀態：從未觸發、成功、失敗。 */
export function formatLastResult(status: RadioAlarmStatus | null): string {
  if (!status || !status.hasLastResult || !status.lastResultTime) return '尚未觸發過';

  const at = new Date(status.lastResultTime);
  const stamp = `${at.getMonth() + 1}/${at.getDate()} `
    + `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

  if (status.lastResultSuccess) {
    return `${stamp} 播放成功`;
  }
  const message = (status.lastResultMessage || '').trim();
  return message ? `${stamp} 失敗：${message}` : `${stamp} 失敗`;
}

/**
 * 需要提醒使用者去放行的系統限制。
 *
 * 一律以文字表達，不動用視覺語言中唯一的強調色 —— 這些是需要注意的狀態，
 * 不是不可逆的操作（見 visual-language 規格）。
 */
export function permissionWarnings(status: RadioAlarmStatus | null): string[] {
  if (!status) return [];
  const warnings: string[] = [];

  if (!status.exactAlarmAllowed) {
    warnings.push('未允許精確鬧鐘：時間到可能不會響，請點此前往系統設定開啟。');
  }
  if (!status.notificationsGranted) {
    warnings.push('未允許通知：播放仍會照常開始，但通知列不會有「停止」按鈕。');
  }
  if (isAggressiveVendor(status.manufacturer)) {
    warnings.push('部分廠牌的省電機制會關掉背景的鬧鐘。若某天早上沒響，請允許本程式自啟動並關閉其電池最佳化。');
  }
  return warnings;
}

/**
 * 以省電機制積極著稱的廠牌。
 *
 * 這份清單只用來決定「要不要多顯示一行提示」，判斷錯了最多是多一行字，
 * 故寧可寬鬆也不要漏掉 —— 漏掉的後果是使用者某天早上沒被叫醒卻不知道為什麼。
 */
const AGGRESSIVE_VENDORS = ['xiaomi', 'redmi', 'poco', 'huawei', 'honor', 'oppo', 'realme', 'oneplus', 'vivo', 'iqoo', 'meizu', 'samsung', 'asus', 'transsion', 'tecno', 'infinix'];

export function isAggressiveVendor(manufacturer: string | null | undefined): boolean {
  const name = (manufacturer || '').trim().toLowerCase();
  if (!name) return false;
  return AGGRESSIVE_VENDORS.some((vendor) => name.includes(vendor));
}

// ---- 插件封裝 ----

export const RadioAlarmService = {
  async getConfig(): Promise<RadioAlarmConfig> {
    const result = await YoutubeDlPlugin.getRadioAlarmConfig();
    return normalizeConfig(result);
  },

  async setConfig(config: RadioAlarmConfig): Promise<RadioAlarmConfig> {
    const result = await YoutubeDlPlugin.setRadioAlarmConfig({
      masterEnabled: config.masterEnabled,
      customStreamUrl: config.customStreamUrl ?? '',
      volumePercent: clampVolume(Number(config.volumePercent)),
      entries: config.entries.map((entry) => ({
        id: entry.id,
        time: entry.time,
        enabled: entry.enabled,
        durationMin: entry.durationMin,
      })),
    });
    return normalizeConfig(result);
  },

  async getStatus(): Promise<RadioAlarmStatus> {
    const result = await YoutubeDlPlugin.getRadioAlarmStatus();
    return {
      nextTriggerAt: Number(result?.nextTriggerAt ?? -1),
      playing: Boolean(result?.playing),
      exactAlarmAllowed: Boolean(result?.exactAlarmAllowed),
      notificationsGranted: Boolean(result?.notificationsGranted),
      manufacturer: String(result?.manufacturer ?? ''),
      hasLastResult: Boolean(result?.hasLastResult),
      lastResultTime: result?.lastResultTime ? Number(result.lastResultTime) : undefined,
      lastResultSuccess: result?.hasLastResult ? Boolean(result.lastResultSuccess) : undefined,
      lastResultMessage: result?.lastResultMessage ? String(result.lastResultMessage) : undefined,
    };
  },

  async test(): Promise<void> {
    await YoutubeDlPlugin.testRadioAlarm();
  },

  async stop(): Promise<void> {
    await YoutubeDlPlugin.stopRadioAlarm();
  },

  async consumeJournal(): Promise<RadioAlarmJournalEntry> {
    const result = await YoutubeDlPlugin.consumeRadioAlarmJournal();
    return {
      hasEntry: Boolean(result?.hasEntry),
      time: result?.time ? Number(result.time) : undefined,
      message: result?.message ? String(result.message) : undefined,
    };
  },

  async requestNotificationPermission(): Promise<boolean> {
    const result = await YoutubeDlPlugin.requestRadioAlarmNotificationPermission();
    return Boolean(result?.granted);
  },

  async openExactAlarmSettings(): Promise<void> {
    await YoutubeDlPlugin.openExactAlarmSettings();
  },

  async openBatteryOptimizationSettings(): Promise<void> {
    await YoutubeDlPlugin.openBatteryOptimizationSettings();
  },
};

/** 把插件回傳的鬆散結構收斂成確定的型別，避免各處各自防禦 undefined。 */
export function normalizeConfig(raw: any): RadioAlarmConfig {
  const entries: RadioAlarmEntry[] = Array.isArray(raw?.entries)
    ? raw.entries
        .map((item: any) => ({
          id: String(item?.id ?? ''),
          time: normalizeTime(item?.time) ?? '',
          enabled: Boolean(item?.enabled),
          durationMin: clampDuration(Number(item?.durationMin)),
        }))
        .filter((entry: RadioAlarmEntry) => entry.time !== '')
    : [];

  return {
    masterEnabled: Boolean(raw?.masterEnabled),
    entries,
    customStreamUrl: String(raw?.customStreamUrl ?? ''),
    // 舊版寫入的設定沒有這個欄位，必須讀成 100 —— 讀成 0 會讓人以為鬧鐘壞了
    volumePercent: raw?.volumePercent === undefined || raw?.volumePercent === null
      ? DEFAULT_VOLUME_PERCENT
      : clampVolume(Number(raw.volumePercent)),
  };
}

/** 首次開啟總開關時預填的兩個時段：06:00《早安新聞》與 07:00《中廣早報新聞》。 */
export function defaultEntries(): RadioAlarmEntry[] {
  return ['06:00', '07:00'].map((time, index) => ({
    id: `t${Date.now() + index}_${time.replace(':', '')}`,
    time,
    enabled: true,
    durationMin: DEFAULT_DURATION_MIN,
  }));
}
