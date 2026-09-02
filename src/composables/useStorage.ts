import { ref, watch, type Ref } from 'vue';

/**
 * 儲存介面卡：封裝單一平台的持久化實作。
 *
 * 刻意設計為可注入，使 useStorage 的邏輯能在不依賴平台 API 的情況下被測試。
 */
export interface StorageAdapter {
  /** 名稱，僅用於錯誤訊息 */
  readonly name: string;
  /** 準備就緒（例如 Tauri Store 的延遲載入）。失敗時應拋出。 */
  init(): Promise<void>;
  /** 讀取單一鍵；不存在時回傳 undefined */
  get(key: string): Promise<unknown>;
  /** 寫入單一鍵並落地 */
  set(key: string, value: unknown): Promise<void>;
}

/**
 * 遷移用的唯讀後備來源。
 *
 * 舊版採 localStorage 與 Tauri Store 雙寫；改為單一權威來源後，
 * 權威來源尚無值的鍵會回頭讀這裡一次，確保既有使用者的設定不遺失。
 * 此來源永遠不會被寫入。
 */
export interface LegacyFallback {
  get(key: string): unknown;
}

export interface SettingOptions<T> {
  /** 寫入前的投影：剔除不應落地的瞬時欄位 */
  serialize?: (value: T) => unknown;
  /** 還原時的轉換：套用清理、裁切等規則 */
  deserialize?: (raw: unknown, defaultValue: T) => T;
}

/**
 * 依預設值推導型別並轉換原始值。
 *
 * 取代舊版硬編碼於兩處的布林鍵名白名單 —— 新增設定項時只需宣告預設值。
 * 需同時容忍兩種既有格式：localStorage 一律存字串，Tauri Store 存原生型別。
 */
export function coerce<T>(raw: unknown, defaultValue: T): T {
  if (raw === undefined || raw === null) return defaultValue;

  if (typeof defaultValue === 'boolean') {
    return (typeof raw === 'string' ? raw === 'true' : Boolean(raw)) as unknown as T;
  }
  if (typeof defaultValue === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return (Number.isFinite(n) ? n : defaultValue) as unknown as T;
  }
  if (typeof defaultValue === 'string') {
    return (typeof raw === 'string' ? raw : String(raw)) as unknown as T;
  }
  // 物件或陣列：localStorage 存的是 JSON 字串，Store 存的是原生物件
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }
  return raw as T;
}

export interface Storage {
  /**
   * 宣告一個設定項，回傳與之綁定的 ref。
   * 對該 ref 的變更會在還原完成後自動持久化。
   */
  defineSetting<T>(key: string, defaultValue: T, options?: SettingOptions<T>): Ref<T>;
  /** 自權威來源還原所有已宣告的設定項 */
  hydrate(): Promise<void>;
  /**
   * 該鍵在還原時是否確實找到既有值。
   * 供「首次啟動」判斷使用（例如首次啟動時自動偵測 TV 裝置）。
   */
  wasRestored(key: string): boolean;
  /** 還原是否已完成 */
  readonly isReady: Ref<boolean>;
}

export function createStorage(adapter: StorageAdapter, legacy?: LegacyFallback): Storage {
  interface Entry {
    key: string;
    valueRef: Ref<any>;
    defaultValue: any;
    options: SettingOptions<any>;
    /** 上一次已落地的序列化結果，用於略過無實質變更的寫入 */
    lastPersisted: string | null;
    /** 還原完成前是否已被明確寫入；若是，還原不得覆蓋 */
    dirtyBeforeHydrate: boolean;
    /** 還原時是否找到既有值 */
    restored: boolean;
  }

  const entries = new Map<string, Entry>();
  const isReady = ref(false);

  const project = (entry: Entry, value: any): unknown =>
    entry.options.serialize ? entry.options.serialize(value) : value;

  const persist = (entry: Entry): void => {
    const projected = project(entry, entry.valueRef.value);
    const signature = JSON.stringify(projected ?? null);

    // 投影未變即不寫入 —— 下載期間的進度數值變動會在此被擋下
    if (signature === entry.lastPersisted) return;
    entry.lastPersisted = signature;

    adapter.set(entry.key, projected).catch((e: unknown) => {
      console.error(`[useStorage] ${adapter.name} 寫入 ${entry.key} 失敗`, e);
    });
  };

  const defineSetting = <T,>(key: string, defaultValue: T, options: SettingOptions<T> = {}): Ref<T> => {
    const existing = entries.get(key);
    if (existing) return existing.valueRef as Ref<T>;

    const valueRef = ref(defaultValue) as Ref<T>;
    const entry: Entry = {
      key,
      valueRef,
      defaultValue,
      options,
      lastPersisted: null,
      dirtyBeforeHydrate: false,
      restored: false,
    };
    entries.set(key, entry);

    watch(
      valueRef,
      () => {
        if (!isReady.value) {
          // 還原尚未完成時的寫入：記下來，讓還原略過此鍵，避免使用者的變更被舊值覆蓋
          entry.dirtyBeforeHydrate = true;
          return;
        }
        persist(entry);
      },
      { deep: true }
    );

    return valueRef;
  };

  const hydrate = async (): Promise<void> => {
    try {
      await adapter.init();
    } catch (e) {
      console.error(`[useStorage] ${adapter.name} 初始化失敗，改以預設值啟動`, e);
      isReady.value = true;
      return;
    }

    for (const entry of entries.values()) {
      if (entry.dirtyBeforeHydrate) continue;

      let raw: unknown;
      try {
        raw = await adapter.get(entry.key);
      } catch (e) {
        console.error(`[useStorage] 讀取 ${entry.key} 失敗，改以預設值`, e);
        raw = undefined;
      }

      // 權威來源無值時，回頭讀一次舊版來源以完成遷移
      if (raw === undefined || raw === null) {
        try {
          raw = legacy?.get(entry.key);
        } catch {
          raw = undefined;
        }
      }
      entry.restored = raw !== undefined && raw !== null;

      try {
        const value = entry.options.deserialize
          ? entry.options.deserialize(raw, entry.defaultValue)
          : coerce(raw, entry.defaultValue);
        entry.valueRef.value = value;
        // 記錄還原後的基準，使還原本身不觸發一次多餘的寫入
        entry.lastPersisted = JSON.stringify(project(entry, value) ?? null);
      } catch (e) {
        console.error(`[useStorage] 還原 ${entry.key} 失敗，改以預設值`, e);
        entry.valueRef.value = entry.defaultValue;
      }
    }

    isReady.value = true;

    // 還原期間被寫入的鍵，此時才落地
    for (const entry of entries.values()) {
      if (entry.dirtyBeforeHydrate) persist(entry);
    }
  };

  const wasRestored = (key: string): boolean => entries.get(key)?.restored ?? false;

  return { defineSetting, hydrate, wasRestored, isReady };
}
