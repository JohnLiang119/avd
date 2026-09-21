/**
 * 廣播鬧鐘的前端側：型別、插件封裝，以及顯示與驗證用的純函式。
 *
 * **這裡刻意沒有任何 `defineSetting`。** 鬧鐘設定的權威來源在 Android 原生端
 * （見 config-persistence 規格的「原生端為權威來源的設定」）：鬧鐘必須在 WebView
 * 未執行時響，而前端的儲存埠此時讀不到。前端因此不保有可獨立寫入的副本 ——
 * 每次開啟設定介面都經插件回原生端讀，變更時整包寫回。
 *
 * 模型以鬧鐘為主體（design.md D14）：一筆鬧鐘 = 時刻 + 星期 + 頻道 + 時長 + 啟用。
 * 頻道有四種來源：官方 API（bcc）、自訂串流（url）、複製進私有目錄的本地檔案
 * 播放清單（file，design.md D15）、富果 API 股票報價口說（stock，design.md D16）。
 */

import { registerPlugin } from '@capacitor/core';

const YoutubeDlPlugin = registerPlugin<any>('YoutubeDl');

// ---- 型別 ----

/** 本地檔案頻道中的一個檔案：私有目錄下副本的路徑，與選檔當下的原始檔名。 */
export interface RadioLocalFile {
  path: string;
  displayName: string;
}

interface RadioChannelBase {
  id: string;
  name: string;
  source: string;
}

/** bcc：向中廣官方 API 依名稱解析；url：自訂串流網址。source 就是解析用的字串。 */
export interface RadioStreamChannel extends RadioChannelBase {
  kind: 'bcc' | 'url';
}

/**
 * 本地檔案頻道：一份有序播放清單，順序固定照選取、循環到時長結束（design.md D15）。
 * source 只是顯示用摘要，實際內容在 files。
 */
export interface RadioFileChannel extends RadioChannelBase {
  kind: 'file';
  files: RadioLocalFile[];
}

/** 股票報價頻道中的一支股票；name 是加入時查到的名稱，可為空。 */
export interface RadioStockItem {
  symbol: string;
  name: string;
}

/**
 * 股票報價頻道：觸發時向富果 API 抓每支股票的報價，文字轉語音念出（design.md D16）。
 * 金鑰是全域設定（RadioAlarmConfig.fugleApiKey），不在頻道上。
 */
export interface RadioStockChannel extends RadioChannelBase {
  kind: 'stock';
  stocks: RadioStockItem[];
  /** 句與句之間的停頓（整數秒，1–600）；以靜音檔實作，循環之間也是同樣一次 */
  pauseSeconds: number;
}

export type RadioChannel = RadioStreamChannel | RadioFileChannel | RadioStockChannel;

export function isFileChannel(channel: RadioChannel): channel is RadioFileChannel {
  return channel.kind === 'file';
}

export function isStockChannel(channel: RadioChannel): channel is RadioStockChannel {
  return channel.kind === 'stock';
}

export interface RadioAlarm {
  id: string;
  /** 已正規化的 HH:mm */
  time: string;
  /** 星期遮罩：bit 0 = 週日 … bit 6 = 週六，與 Date.getDay() 一致；必非零 */
  weekdays: number;
  channelId: string;
  durationMin: number;
  enabled: boolean;
}

export interface RadioAlarmConfig {
  schemaVersion: number;
  alarms: RadioAlarm[];
  channels: RadioChannel[];
  /** 應用程式內的音量比例（0–100），在系統音量之下縮放 */
  volumePercent: number;
  /** 富果 API 金鑰（全域）；空字串代表未設定 */
  fugleApiKey: string;
}

/** 插件 lookupStock 的回傳：查不到時 ok=false 且 error 為可顯示的原因。 */
export interface StockLookup {
  ok: boolean;
  symbol: string;
  name: string;
  price: number;
  error: string;
}

export interface RadioAlarmStatus {
  playing: boolean;
  /** 播放中的是否為鬧鐘語意（鬧鐘或試播）；手動直播為 false */
  alarmAudioActive: boolean;
  /** 播放中的頻道 id；沒在播放時為空字串 */
  playingChannelId: string;
  exactAlarmAllowed: boolean;
  notificationsGranted: boolean;
  /** 實際存在於系統中的本程式鬧鐘數量（向系統回讀） */
  registeredCount: number;
  systemNextAlarmAt: number;
  systemNextAlarmIsOurs: boolean;
  selfTestAt: number;
  selfTestRegistered: boolean;
  selfTestFiredAt: number;
  manufacturer: string;
  hasLastResult: boolean;
  lastResultTime?: number;
  lastResultSuccess?: boolean;
  lastResultMessage?: string;
}

/** 選檔的結果：使用者取消時 cancelled 為 true 且 files 為空。 */
export interface RadioPickedFiles {
  cancelled: boolean;
  channelId: string;
  files: RadioLocalFile[];
}

export interface RadioAlarmJournalEntry {
  hasEntry: boolean;
  time?: number;
  message?: string;
}

export type TimeValidation =
  | { ok: true; time: string }
  | { ok: false; reason: string };

// ---- 常數 ----

export const ALL_WEEKDAYS = 0x7f;
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 180;
export const DEFAULT_DURATION_MIN = 30;
export const MIN_VOLUME_PERCENT = 0;
export const MAX_VOLUME_PERCENT = 100;
export const DEFAULT_VOLUME_PERCENT = 100;
export const DEFAULT_ALARM_TIME = '06:00';

const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_MON_TO_FRI = 0b0111110;
const WEEKDAYS_WEEKEND = 0b1000001;

// ---- 時間 ----

/** 正規化為 HH:mm；與原生端 `RadioAlarmConfig.normalizeTime` 同一套規則。 */
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

/** 時刻的把關。不合法時附上可直接顯示的原因 —— 規格明訂不得靜默忽略。 */
export function validateTime(raw: string | null | undefined): TimeValidation {
  const time = normalizeTime(raw);
  if (time === null) return { ok: false, reason: '請輸入 00:00 至 23:59 之間的時間' };
  return { ok: true, time };
}

// ---- 星期 ----

export function hasWeekday(mask: number, day: number): boolean {
  if (day < 0 || day > 6) return false;
  return (mask & (1 << day)) !== 0;
}

/** 空遮罩或越界位元一律回到全選，與原生端一致。 */
export function normalizeWeekdays(mask: number): number {
  const cleaned = (Number.isFinite(mask) ? mask : 0) & ALL_WEEKDAYS;
  return cleaned === 0 ? ALL_WEEKDAYS : cleaned;
}

/**
 * 切換某一天。**取消最後一天會被拒絕**（回傳原遮罩）—— 規格明訂每筆至少保留一天。
 */
export function toggleWeekday(mask: number, day: number): number {
  const current = normalizeWeekdays(mask);
  if (day < 0 || day > 6) return current;
  const bit = 1 << day;
  if ((current & bit) !== 0) {
    const next = current & ~bit;
    return next === 0 ? current : next;
  }
  return current | bit;
}

/** 星期的摘要：每天／平日／週末／逐日列出。 */
export function describeWeekdays(mask: number): string {
  const m = normalizeWeekdays(mask);
  if (m === ALL_WEEKDAYS) return '每天';
  if (m === WEEKDAYS_MON_TO_FRI) return '平日';
  if (m === WEEKDAYS_WEEKEND) return '週末';
  // 以週一起算排序，週日放最後 —— 符合台灣的閱讀習慣
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((d) => hasWeekday(m, d)).map((d) => WEEKDAY_LABEL[d]).join('、');
}

// ---- 時長與音量 ----

export function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DURATION_MIN;
  const rounded = Math.round(value);
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, rounded));
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME_PERCENT;
  const rounded = Math.round(value);
  return Math.min(MAX_VOLUME_PERCENT, Math.max(MIN_VOLUME_PERCENT, rounded));
}

// ---- 頻道 ----

export function channelName(channels: readonly RadioChannel[], id: string): string {
  const found = channels.find((c) => c.id === id);
  if (found) return found.name;
  return channels[0]?.name ?? '';
}

/** 第一個內建頻道：新增鬧鐘的預設，也是無效頻道參照的落點。 */
export function defaultChannelId(channels: readonly RadioChannel[]): string {
  return channels.find((c) => c.kind === 'bcc')?.id ?? channels[0]?.id ?? '';
}

/** 頻道標題的長度上限（字元）。下載的檔名常是整句影片標題，只取前段當標題。 */
export const CHANNEL_TITLE_MAX_CHARS = 16;

/**
 * 新建本地檔案頻道的預設名稱：**第一個檔案檔名的前段**，去掉副檔名、超過上限截斷加「…」。
 * 不附「等 N 個檔案」—— 檔案數量在頻道列另有一格顯示，明細點進去看。
 * 使用者可再改名；空清單回傳固定字樣而非空字串，介面不該出現沒有名字的列。
 */
export function defaultFileChannelName(files: readonly RadioLocalFile[]): string {
  const first = (files[0]?.displayName ?? '').trim();
  if (!first) return '本地檔案';
  const stem = first.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || first;
  const chars = Array.from(stem);
  return chars.length > CHANNEL_TITLE_MAX_CHARS
    ? `${chars.slice(0, CHANNEL_TITLE_MAX_CHARS).join('')}…`
    : stem;
}

/** 頻道列上的小字摘要：檔案頻道是檔案數、股票頻道是股票數；直播頻道沒有。 */
export function describeChannelSummary(channel: RadioChannel): string {
  if (isFileChannel(channel)) return `${channel.files.length} 個檔案`;
  if (isStockChannel(channel)) return `${channel.stocks.length} 支股票`;
  return '';
}

export const DEFAULT_STOCK_CHANNEL_NAME = '股市晨報';
export const DEFAULT_STOCK_PAUSE_SECONDS = 1;
export const MIN_STOCK_PAUSE_SECONDS = 1;
export const MAX_STOCK_PAUSE_SECONDS = 600;

/** 句間停頓：整數秒、夾在 1–600（不允許 0）；非數字回預設。與原生端 clampPauseSeconds 同一套規則。 */
export function clampPauseSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_STOCK_PAUSE_SECONDS;
  const clamped = Math.min(MAX_STOCK_PAUSE_SECONDS, Math.max(MIN_STOCK_PAUSE_SECONDS, value));
  return Math.round(clamped);
}

/** 股票代號：1–10 個英數字，一律大寫；不合法回傳 null。與原生端 normalizeStockSymbol 同一套規則。 */
export function normalizeStockSymbol(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim().toUpperCase();
  return /^[0-9A-Z]{1,10}$/.test(text) ? text : null;
}

/** 顯示用：有名稱就「台積電（2330）」，否則只有代號。 */
export function describeStock(item: RadioStockItem): string {
  return item.name ? `${item.name}（${item.symbol}）` : item.symbol;
}

// ---- 顯示用文字 ----

/** 鬧鐘卡片收合時的摘要：星期與頻道。這一行要讓人不展開就看得出設定了什麼。 */
export function describeAlarmSummary(alarm: RadioAlarm, channels: readonly RadioChannel[]): string {
  return `${describeWeekdays(alarm.weekdays)} · ${channelName(channels, alarm.channelId)}`;
}

/** 新增鬧鐘的預設值：06:00、每天、第一個內建頻道、30 分鐘、啟用。 */
export function newAlarm(channels: readonly RadioChannel[]): RadioAlarm {
  return {
    id: `t${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    time: DEFAULT_ALARM_TIME,
    weekdays: ALL_WEEKDAYS,
    channelId: defaultChannelId(channels),
    durationMin: DEFAULT_DURATION_MIN,
    enabled: true,
  };
}

/**
 * 播放中的狀態字；沒在播放時回傳空字串。
 *
 * 手動直播與鬧鐘要分得出來，因為**兩者的音量來源不同** —— 使用者若看到「直播中」
 * 卻去調鬧鐘音量，會發現怎麼調都沒反應。
 */
export function describePlaybackState(
  status: RadioAlarmStatus | null,
  channels: readonly RadioChannel[],
): string {
  if (!status || !status.playing) return '';
  const name = channelName(channels, status.playingChannelId);
  return status.alarmAudioActive
    ? `播放中：${name}（鬧鐘音量）`
    : `直播中：${name}（媒體音量）`;
}

function stampOf(at: number, withSeconds = false): string {
  const d = new Date(at);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const tail = withSeconds ? `:${String(d.getSeconds()).padStart(2, '0')}` : '';
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}${tail}`;
}

/**
 * 「系統到底有沒有收下這些鬧鐘」—— **只在異常時說話**。
 *
 * 有啟用的鬧鐘、系統中卻一筆都沒有，這是使用者最擔心的情況，也正是原本的介面
 * 看起來最正常的時候（「下一次觸發」是本程式自己算的）。正常時回傳空字串。
 */
export function registrationWarning(config: RadioAlarmConfig, status: RadioAlarmStatus | null): string {
  if (!status) return '';
  const enabled = config.alarms.filter((a) => a.enabled).length;
  if (enabled === 0 || status.registeredCount > 0) return '';
  return '系統中沒有本程式的鬧鐘，時間到不會響。請確認未被「強制停止」，並允許自啟動。';
}

/**
 * 自我測試的狀態。「已響起」由接收器寫入，而接收器只有在**系統把程序叫起來**時
 * 才會執行 —— 使用者關掉 App 回來看到這行，就知道關掉之後鬧鐘依然有效。
 */
export function describeSelfTest(status: RadioAlarmStatus | null, now: Date): string {
  if (!status) return '';
  if (status.selfTestRegistered && status.selfTestAt > now.getTime()) {
    const at = new Date(status.selfTestAt);
    const hhmmss = [at.getHours(), at.getMinutes(), at.getSeconds()]
      .map((n) => String(n).padStart(2, '0')).join(':');
    return `測試鬧鐘已登錄，${hhmmss} 會響。現在可以把本程式完全關掉再等它。`;
  }
  if (status.selfTestFiredAt > 0) {
    return `上次測試：${stampOf(status.selfTestFiredAt, true)} 由系統喚起並響起`;
  }
  return '尚未測試過';
}

/** 上次播放**失敗**時的說明；成功或從未觸發回傳空字串（安靜原則）。 */
export function lastFailureText(status: RadioAlarmStatus | null): string {
  if (!status || !status.hasLastResult || !status.lastResultTime || status.lastResultSuccess) return '';
  const message = (status.lastResultMessage || '').trim();
  return `${stampOf(status.lastResultTime)} 播放失敗${message ? `：${message}` : ''}`;
}

/** 需要提醒使用者去放行的系統限制；一切正常時為空陣列。 */
export function permissionWarnings(status: RadioAlarmStatus | null): string[] {
  if (!status) return [];
  const warnings: string[] = [];
  if (!status.exactAlarmAllowed) warnings.push('未允許精確鬧鐘：時間到可能不會響。');
  if (!status.notificationsGranted) warnings.push('未允許通知：播放仍會開始，但通知列不會有「停止」按鈕。');
  if (isAggressiveVendor(status.manufacturer)) {
    warnings.push('此廠牌的省電機制可能關掉背景鬧鐘。若某天早上沒響，請允許自啟動並關閉電池最佳化。');
  }
  return warnings;
}

const AGGRESSIVE_VENDORS = ['xiaomi', 'redmi', 'poco', 'huawei', 'honor', 'oppo', 'realme', 'oneplus', 'vivo', 'iqoo', 'meizu', 'samsung', 'asus', 'transsion', 'tecno', 'infinix'];

export function isAggressiveVendor(manufacturer: string | null | undefined): boolean {
  const name = (manufacturer || '').trim().toLowerCase();
  return name !== '' && AGGRESSIVE_VENDORS.some((v) => name.includes(v));
}

// ---- 插件回傳的收斂 ----

/**
 * 把插件回傳的一個頻道收斂成型別正確的物件；不認識的 kind、或沒有檔案的 file 頻道
 * 回傳 null 由呼叫端剔除 —— 早先「非 url 一律當 bcc」會把 file 頻道誤標成內建頻道，
 * 然後拿檔名去問中廣 API。
 */
function normalizeChannel(c: any): RadioChannel | null {
  const id = String(c?.id ?? '');
  if (id === '') return null;
  const name = String(c?.name ?? '');
  const source = String(c?.source ?? '');
  const kind = c?.kind;
  if (kind === 'bcc' || kind === 'url') {
    return { id, name, kind, source };
  }
  if (kind === 'file') {
    const files: RadioLocalFile[] = Array.isArray(c?.files)
      ? c.files
          .map((f: any) => ({ path: String(f?.path ?? ''), displayName: String(f?.displayName ?? '') }))
          .filter((f: RadioLocalFile) => f.path !== '')
      : [];
    if (files.length === 0) return null;
    return { id, name: name || defaultFileChannelName(files), kind, source, files };
  }
  if (kind === 'stock') {
    // 允許空清單（原生端會念「尚未加入任何股票」）；不合法與重複的代號剔除
    const seen = new Set<string>();
    const stocks: RadioStockItem[] = [];
    for (const raw of Array.isArray(c?.stocks) ? c.stocks : []) {
      const symbol = normalizeStockSymbol(raw?.symbol);
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      stocks.push({ symbol, name: String(raw?.name ?? '').trim() });
    }
    return {
      id, name: name || DEFAULT_STOCK_CHANNEL_NAME, kind, source, stocks,
      pauseSeconds: clampPauseSeconds(Number(c?.pauseSeconds ?? DEFAULT_STOCK_PAUSE_SECONDS)),
    };
  }
  return null;
}

export function normalizeConfig(raw: any): RadioAlarmConfig {
  const channels: RadioChannel[] = Array.isArray(raw?.channels)
    ? raw.channels.map(normalizeChannel).filter((c: RadioChannel | null): c is RadioChannel => c !== null)
    : [];

  const fallbackChannel = defaultChannelId(channels);

  const alarms: RadioAlarm[] = Array.isArray(raw?.alarms)
    ? raw.alarms
        .map((a: any) => ({
          id: String(a?.id ?? ''),
          time: normalizeTime(a?.time) ?? '',
          weekdays: normalizeWeekdays(Number(a?.weekdays)),
          channelId: channels.some((c) => c.id === a?.channelId) ? String(a.channelId) : fallbackChannel,
          durationMin: clampDuration(Number(a?.durationMin)),
          enabled: Boolean(a?.enabled),
        }))
        .filter((a: RadioAlarm) => a.time !== '' && a.id !== '')
    : [];

  return {
    schemaVersion: Number(raw?.schemaVersion ?? 2),
    alarms,
    channels,
    volumePercent: raw?.volumePercent === undefined || raw?.volumePercent === null
      ? DEFAULT_VOLUME_PERCENT
      : clampVolume(Number(raw.volumePercent)),
    fugleApiKey: String(raw?.fugleApiKey ?? '').trim(),
  };
}

// ---- 插件封裝 ----

export const RadioAlarmService = {
  async getConfig(): Promise<RadioAlarmConfig> {
    return normalizeConfig(await YoutubeDlPlugin.getRadioAlarmConfig());
  },

  async setConfig(config: RadioAlarmConfig): Promise<RadioAlarmConfig> {
    const result = await YoutubeDlPlugin.setRadioAlarmConfig({
      volumePercent: clampVolume(Number(config.volumePercent)),
      fugleApiKey: String(config.fugleApiKey ?? '').trim(),
      channels: config.channels.map((c) => {
        if (isFileChannel(c)) {
          return { id: c.id, name: c.name, kind: c.kind, source: c.source, files: c.files.map((f) => ({ path: f.path, displayName: f.displayName })) };
        }
        if (isStockChannel(c)) {
          return { id: c.id, name: c.name, kind: c.kind, source: c.source, stocks: c.stocks.map((st) => ({ symbol: st.symbol, name: st.name })), pauseSeconds: clampPauseSeconds(c.pauseSeconds) };
        }
        return { id: c.id, name: c.name, kind: c.kind, source: c.source };
      }),
      alarms: config.alarms.map((a) => ({
        id: a.id,
        time: a.time,
        weekdays: a.weekdays,
        channelId: a.channelId,
        durationMin: a.durationMin,
        enabled: a.enabled,
      })),
    });
    return normalizeConfig(result);
  },

  async getStatus(): Promise<RadioAlarmStatus> {
    const r = await YoutubeDlPlugin.getRadioAlarmStatus();
    return {
      playing: Boolean(r?.playing),
      alarmAudioActive: Boolean(r?.alarmAudioActive),
      playingChannelId: String(r?.playingChannelId ?? ''),
      exactAlarmAllowed: Boolean(r?.exactAlarmAllowed),
      notificationsGranted: Boolean(r?.notificationsGranted),
      registeredCount: Number(r?.registeredCount ?? 0),
      systemNextAlarmAt: Number(r?.systemNextAlarmAt ?? -1),
      systemNextAlarmIsOurs: Boolean(r?.systemNextAlarmIsOurs),
      selfTestAt: Number(r?.selfTestAt ?? -1),
      selfTestRegistered: Boolean(r?.selfTestRegistered),
      selfTestFiredAt: Number(r?.selfTestFiredAt ?? -1),
      manufacturer: String(r?.manufacturer ?? ''),
      hasLastResult: Boolean(r?.hasLastResult),
      lastResultTime: r?.lastResultTime ? Number(r.lastResultTime) : undefined,
      lastResultSuccess: r?.hasLastResult ? Boolean(r.lastResultSuccess) : undefined,
      lastResultMessage: r?.lastResultMessage ? String(r.lastResultMessage) : undefined,
    };
  },

  async test(): Promise<void> {
    await YoutubeDlPlugin.testRadioAlarm();
  },

  /** 手動直播指定頻道。不依賴任何鬧鐘的存在。 */
  async playLive(channelId: string): Promise<void> {
    await YoutubeDlPlugin.playRadioLive({ channelId });
  },

  async stop(): Promise<void> {
    await YoutubeDlPlugin.stopRadioAlarm();
  },

  /**
   * 開系統選檔器（可多選）並把選到的檔案複製進私有目錄。只複製、不寫設定：
   * 頻道要不要成立由呼叫端整包 setConfig 決定；失敗時呼叫端 MUST 以
   * removeChannelFiles 清掉副本。
   */
  async pickFiles(): Promise<RadioPickedFiles> {
    const r = await YoutubeDlPlugin.pickRadioAlarmFiles();
    const files: RadioLocalFile[] = Array.isArray(r?.files)
      ? r.files
          .map((f: any) => ({ path: String(f?.path ?? ''), displayName: String(f?.displayName ?? '') }))
          .filter((f: RadioLocalFile) => f.path !== '')
      : [];
    return {
      cancelled: Boolean(r?.cancelled) || files.length === 0,
      channelId: String(r?.channelId ?? ''),
      files,
    };
  },

  /** 刪除某個本地檔案頻道的全部副本（移除頻道時呼叫）。 */
  async removeChannelFiles(channelId: string): Promise<void> {
    await YoutubeDlPlugin.removeRadioAlarmChannelFiles({ channelId });
  },

  /** 以目前設定的富果金鑰查一支股票的名稱與現價（加入股票時確認代號）。查不到不拋，看 ok。 */
  async lookupStock(symbol: string): Promise<StockLookup> {
    const r = await YoutubeDlPlugin.lookupStock({ symbol });
    return {
      ok: Boolean(r?.ok),
      symbol: String(r?.symbol ?? symbol),
      name: String(r?.name ?? ''),
      price: Number(r?.price ?? 0),
      error: String(r?.error ?? ''),
    };
  },

  async consumeJournal(): Promise<RadioAlarmJournalEntry> {
    const r = await YoutubeDlPlugin.consumeRadioAlarmJournal();
    return {
      hasEntry: Boolean(r?.hasEntry),
      time: r?.time ? Number(r.time) : undefined,
      message: r?.message ? String(r.message) : undefined,
    };
  },

  async requestNotificationPermission(): Promise<boolean> {
    const r = await YoutubeDlPlugin.requestRadioAlarmNotificationPermission();
    return Boolean(r?.granted);
  },

  async scheduleSelfTest(): Promise<number> {
    const r = await YoutubeDlPlugin.scheduleRadioAlarmSelfTest();
    return Number(r?.triggerAt ?? -1);
  },

  async cancelSelfTest(): Promise<void> {
    await YoutubeDlPlugin.cancelRadioAlarmSelfTest();
  },

  async openExactAlarmSettings(): Promise<void> {
    await YoutubeDlPlugin.openExactAlarmSettings();
  },

  async openBatteryOptimizationSettings(): Promise<void> {
    await YoutubeDlPlugin.openBatteryOptimizationSettings();
  },
};
