import { LazyStore } from '@tauri-apps/plugin-store';
import type { LegacyFallback, StorageAdapter } from './useStorage';

/**
 * Android / Web 平台的權威來源。
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localStorage';

  async init(): Promise<void> {
    // localStorage 為同步 API，無需準備
  }

  async get(key: string): Promise<unknown> {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : raw;
  }

  async set(key: string, value: unknown): Promise<void> {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    localStorage.setItem(key, str);
  }
}

/**
 * Windows (Tauri) 平台的權威來源。
 */
export class TauriStoreAdapter implements StorageAdapter {
  readonly name = 'TauriStore';
  private store: LazyStore;

  constructor(fileName = 'config.json') {
    this.store = new LazyStore(fileName);
  }

  async init(): Promise<void> {
    // LazyStore 於首次存取時載入；此處主動觸發以便及早暴露載入失敗
    await this.store.get('__init_probe__');
  }

  async get(key: string): Promise<unknown> {
    return await this.store.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.store.set(key, value);
    await this.store.save();
  }
}

/**
 * 舊版雙寫時期遺留於 localStorage 的資料，作為一次性的唯讀遷移來源。
 * 僅在權威來源尚無該鍵時被讀取，永遠不會被寫入。
 */
export const localStorageLegacyFallback: LegacyFallback = {
  get(key: string): unknown {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : raw;
  },
};
