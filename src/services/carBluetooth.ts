/**
 * 車機藍牙的前端側（OpenSpec car-bluetooth-connect）：型別、插件封裝，以及顯示用純函式。
 *
 * **與廣播鬧鐘相同，這裡沒有 `defineSetting`。** 選定的車機由 Android 原生端持有
 * （config-persistence 規格的「原生端為權威來源的設定」）：鬧鐘響起前要連車機，那一刻
 * WebView 多半沒在執行；快速設定磚也在 WebView 之外運作。前端因此不保有副本，每次開
 * 設定都經插件回原生端讀。
 *
 * Android 12 起 App 不能直接叫系統連某台已配對裝置（需 BLUETOOTH_PRIVILEGED），原生端
 * 的連線是「盡力而為」（RFCOMM 喚醒鏈路、等車機自己接回音訊協定）；介面在失敗時一律
 * 退回「開系統藍牙設定讓使用者點一下」。
 */

import { registerPlugin } from '@capacitor/core';

import { ALL_WEEKDAYS, normalizeTime, normalizeWeekdays } from './radioAlarm';

const YoutubeDlPlugin = registerPlugin<any>('YoutubeDl');

// ---- 型別 ----

/** 選定的車機：位址是識別，名稱只用來顯示。 */
export interface CarBluetoothDevice {
  address: string;
  name: string;
}

/** 已配對裝置的分類：車用音訊、其他音訊裝置、其餘。供排序與副標。 */
export type BondedDeviceKind = 'car' | 'audio' | 'other';

export interface BondedDevice extends CarBluetoothDevice {
  kind: BondedDeviceKind;
}

export interface CarBluetoothState {
  device: CarBluetoothDevice | null;
  /** API 31 起的 BLUETOOTH_CONNECT；更舊的版本恆為 true。 */
  permissionGranted: boolean;
  adapterOn: boolean;
  /** 選定的車機目前是否接著音訊協定（A2DP 或通話）。 */
  connected: boolean;
}

/** 與原生端 CarBluetooth.Outcome 一一對應。 */
export type CarBluetoothOutcome =
  | 'noDevice'
  | 'noPermission'
  | 'adapterOff'
  | 'alreadyConnected'
  | 'connected'
  | 'notConnected';

export interface CarBluetoothConnectResult {
  outcome: CarBluetoothOutcome;
  connected: boolean;
  /** 原生端產生、可直接顯示的結果說明。 */
  message: string;
}

/** 連線排程的一筆：到時間自動盡力連線車機。星期為遮罩（bit 0 = 週日），語意同鬧鐘。 */
export interface CarScheduleEntry {
  id: string;
  time: string;
  weekdays: number;
  enabled: boolean;
}

export interface CarScheduleState {
  entries: CarScheduleEntry[];
  /** 下一次連線的 epoch 毫秒；沒有啟用的排程為 -1。 */
  nextTriggerAt: number;
  /** 精確鬧鐘是否被允許；被關閉時排程可能晚幾分鐘。 */
  exactAlarmAllowed: boolean;
}

/** 與原生端 CarBluetoothSchedule.MAX_ENTRIES 一致。 */
export const MAX_CAR_SCHEDULE_ENTRIES = 12;
export const DEFAULT_CAR_SCHEDULE_TIME = '07:30';

// ---- 正規化 ----

function normalizeDevice(raw: any): CarBluetoothDevice | null {
  const address = String(raw?.address ?? '').trim();
  if (!address) return null;
  const name = String(raw?.name ?? '').trim();
  return { address, name: name || address };
}

function normalizeKind(raw: unknown): BondedDeviceKind {
  return raw === 'car' || raw === 'audio' ? raw : 'other';
}

function normalizeState(raw: any): CarBluetoothState {
  return {
    device: normalizeDevice(raw?.device),
    permissionGranted: raw?.permissionGranted !== false,
    adapterOn: raw?.adapterOn === true,
    connected: raw?.connected === true,
  };
}

const OUTCOMES: readonly CarBluetoothOutcome[] = [
  'noDevice', 'noPermission', 'adapterOff', 'alreadyConnected', 'connected', 'notConnected',
];

function normalizeOutcome(raw: unknown): CarBluetoothOutcome {
  return OUTCOMES.includes(raw as CarBluetoothOutcome) ? (raw as CarBluetoothOutcome) : 'notConnected';
}

// ---- 插件封裝 ----

export const CarBluetoothService = {
  async getState(): Promise<CarBluetoothState> {
    return normalizeState(await YoutubeDlPlugin.getCarBluetooth());
  },

  /** 列出已配對裝置；原生端在需要時先請求藍牙權限，拒絕即 reject。 */
  async listBonded(): Promise<{ adapterOn: boolean; devices: BondedDevice[] }> {
    const r = await YoutubeDlPlugin.listBondedBluetoothDevices();
    const devices: BondedDevice[] = [];
    for (const item of Array.isArray(r?.devices) ? r.devices : []) {
      const device = normalizeDevice(item);
      if (device) devices.push({ ...device, kind: normalizeKind(item?.kind) });
    }
    return { adapterOn: r?.adapterOn === true, devices };
  },

  /** `null` 代表清除。回傳寫入後的最新狀態。 */
  async setDevice(device: CarBluetoothDevice | null): Promise<CarBluetoothState> {
    return normalizeState(await YoutubeDlPlugin.setCarBluetooth({
      address: device?.address ?? '',
      name: device?.name ?? '',
    }));
  },

  /** 盡力連線（原生端最多等 10 秒）。呼叫端依 needsSettingsFallback 決定要不要開藍牙設定。 */
  async connect(): Promise<CarBluetoothConnectResult> {
    const r = await YoutubeDlPlugin.connectCarBluetooth();
    return {
      outcome: normalizeOutcome(r?.outcome),
      connected: r?.connected === true,
      message: String(r?.message ?? ''),
    };
  },

  async getSchedule(): Promise<CarScheduleState> {
    return normalizeSchedule(await YoutubeDlPlugin.getCarBluetoothSchedule());
  },

  /** 整包寫回；原生端會過濾不合法項目並重新登錄系統鬧鐘，回傳過濾後的結果。 */
  async setSchedule(entries: readonly CarScheduleEntry[]): Promise<CarScheduleState> {
    return normalizeSchedule(await YoutubeDlPlugin.setCarBluetoothSchedule({ entries }));
  },

  async openSettings(): Promise<void> {
    await YoutubeDlPlugin.openBluetoothSettings();
  },
};

// ---- 純函式 ----

const KIND_RANK: Record<BondedDeviceKind, number> = { car: 0, audio: 1, other: 2 };

/** 選擇清單的順序：車用音訊最前、其他音訊次之、其餘最後；同類依名稱。不改動輸入。 */
export function sortBondedDevices(devices: readonly BondedDevice[]): BondedDevice[] {
  return [...devices].sort((a, b) => {
    const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name, 'zh-Hant');
  });
}

/** 選擇清單每列的副標；「其餘」不標，免得整列都是字。 */
export function describeBondedKind(kind: BondedDeviceKind): string {
  if (kind === 'car') return '車用音訊';
  if (kind === 'audio') return '音訊裝置';
  return '';
}

/** 偏好設定裡選定車機那一列的狀態小字。「正常時安靜」：已連線只說已連線。 */
export function describeCarBluetoothStatus(state: CarBluetoothState | null): string {
  if (!state || !state.device) return '尚未選擇車機';
  if (!state.permissionGranted) return '需要藍牙權限，請重新選擇車機以授權';
  if (!state.adapterOn) return '手機的藍牙是關閉的';
  return state.connected ? '已連線' : '未連線。鬧鐘響起前會先嘗試連線';
}

/** 哪些結果該退回「開藍牙設定讓使用者點一下」：車機沒回應、或藍牙根本關著。 */
export function needsSettingsFallback(outcome: CarBluetoothOutcome): boolean {
  return outcome === 'notConnected' || outcome === 'adapterOff';
}

// ---- 連線排程 ----

function normalizeSchedule(raw: any): CarScheduleState {
  const entries: CarScheduleEntry[] = [];
  for (const item of Array.isArray(raw?.entries) ? raw.entries : []) {
    const id = String(item?.id ?? '').trim();
    const time = normalizeTime(item?.time);
    if (!id || time === null) continue;
    entries.push({
      id,
      time,
      weekdays: normalizeWeekdays(Number(item?.weekdays ?? ALL_WEEKDAYS)),
      enabled: item?.enabled !== false,
    });
  }
  return {
    entries,
    nextTriggerAt: Number.isFinite(raw?.nextTriggerAt) ? Number(raw.nextTriggerAt) : -1,
    exactAlarmAllowed: raw?.exactAlarmAllowed !== false,
  };
}

/** 新增一筆排程的預設值：07:30、每天、啟用。 */
export function newCarScheduleEntry(): CarScheduleEntry {
  return {
    id: `c${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    time: DEFAULT_CAR_SCHEDULE_TIME,
    weekdays: ALL_WEEKDAYS,
    enabled: true,
  };
}

/** 排程依時刻由早到晚排序，介面看起來才有條理；不改動輸入。 */
export function sortCarSchedule(entries: readonly CarScheduleEntry[]): CarScheduleEntry[] {
  return [...entries].sort((a, b) => a.time.localeCompare(b.time));
}

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 「下一次連線」的說明：今天／明天／週X 加上時刻。沒有啟用的排程回空字串（正常時安靜）。
 * `now` 可注入以便測試。
 */
export function describeNextConnect(nextTriggerAt: number, now: Date = new Date()): string {
  if (!Number.isFinite(nextTriggerAt) || nextTriggerAt <= 0) return '';
  const at = new Date(nextTriggerAt);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86400000);
  const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const label = days <= 0 ? '今天' : days === 1 ? '明天' : `週${DAY_NAMES[at.getDay()]}`;
  return `下一次連線：${label} ${hhmm}`;
}
