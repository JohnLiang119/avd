import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { createStorage, coerce, type StorageAdapter, type LegacyFallback } from '../useStorage';

/** 可控的記憶體 adapter，用於驗證 useStorage 本身的邏輯 */
class FakeAdapter implements StorageAdapter {
  readonly name = 'fake';
  data = new Map<string, unknown>();
  writes: Array<[string, unknown]> = [];
  initError: Error | null = null;
  getError: Error | null = null;
  /** 用於模擬非同步還原：解析前 hydrate 會停在 init */
  gate: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    await this.gate;
    if (this.initError) throw this.initError;
  }
  async get(key: string): Promise<unknown> {
    if (this.getError) throw this.getError;
    return this.data.get(key);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.writes.push([key, value]);
    this.data.set(key, value);
  }
}

describe('coerce — 型別由預設值推導（取代鍵名白名單）', () => {
  it('布林值容忍 localStorage 的字串格式與 Store 的原生格式', () => {
    expect(coerce('true', false)).toBe(true);
    expect(coerce('false', true)).toBe(false);
    expect(coerce(true, false)).toBe(true);
  });

  it('物件容忍 JSON 字串與原生物件兩種既有格式', () => {
    expect(coerce('{"a":1}', {} as Record<string, number>)).toEqual({ a: 1 });
    expect(coerce({ a: 1 }, {} as Record<string, number>)).toEqual({ a: 1 });
  });

  it('缺值或解析失敗時退回預設值', () => {
    expect(coerce(undefined, 'fallback')).toBe('fallback');
    expect(coerce(null, 42)).toBe(42);
    expect(coerce('not json', { a: 1 })).toEqual({ a: 1 });
    expect(coerce('abc', 7)).toBe(7);
  });
});

describe('useStorage — 單一真相來源的設定持久化', () => {
  let adapter: FakeAdapter;

  beforeEach(() => {
    adapter = new FakeAdapter();
  });

  it('寫入設定後再次還原可取回相同值', async () => {
    const s1 = createStorage(adapter);
    const mp3 = s1.defineSetting('avd_mp3_mode', false);
    await s1.hydrate();

    mp3.value = true;
    await nextTick();

    const s2 = createStorage(adapter);
    const mp3Again = s2.defineSetting('avd_mp3_mode', false);
    await s2.hydrate();

    expect(mp3Again.value).toBe(true);
  });

  it('還原期間的寫入不得被還原流程覆蓋', async () => {
    adapter.data.set('avd_target_tv_ip', '192.168.0.10');
    let release!: () => void;
    adapter.gate = new Promise<void>((r) => { release = r; });

    const s = createStorage(adapter);
    const ip = s.defineSetting('avd_target_tv_ip', '');
    const hydrating = s.hydrate();

    // 還原尚未完成，此時使用者變更了設定
    ip.value = '10.0.0.99';
    await nextTick();

    release();
    await hydrating;

    expect(ip.value).toBe('10.0.0.99');
    expect(adapter.data.get('avd_target_tv_ip')).toBe('10.0.0.99');
  });

  it('儲存來源解析失敗時以預設值啟動且不中斷初始化', async () => {
    adapter.data.set('avd_monitor_config', 'not-valid-json');
    const s = createStorage(adapter);
    const cfg = s.defineSetting('avd_monitor_config', { autoCheckEnabled: true });

    await expect(s.hydrate()).resolves.toBeUndefined();
    expect(cfg.value).toEqual({ autoCheckEnabled: true });
    expect(s.isReady.value).toBe(true);
  });

  it('adapter 初始化失敗時以預設值啟動且不中斷初始化', async () => {
    adapter.initError = new Error('store 載入失敗');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = createStorage(adapter);
    const flag = s.defineSetting('avd_tv_mode', false);

    await expect(s.hydrate()).resolves.toBeUndefined();
    expect(flag.value).toBe(false);
    expect(s.isReady.value).toBe(true);
  });

  it('權威來源無值時自舊版來源遷移，且不寫回舊來源', async () => {
    const legacy: LegacyFallback = { get: (k) => (k === 'avd_wifi_ssid' ? 'OldNetwork' : undefined) };
    const s = createStorage(adapter, legacy);
    const ssid = s.defineSetting('avd_wifi_ssid', '');
    await s.hydrate();

    expect(ssid.value).toBe('OldNetwork');
  });

  it('投影未變則不觸發寫入', async () => {
    const s = createStorage(adapter);
    const obj = s.defineSetting(
      'avd_projected',
      { keep: 0, ephemeral: 0 },
      { serialize: (v) => ({ keep: v.keep }) }
    );
    await s.hydrate();
    const before = adapter.writes.length;

    obj.value = { keep: 0, ephemeral: 99 };
    await nextTick();
    expect(adapter.writes.length).toBe(before);

    obj.value = { keep: 1, ephemeral: 99 };
    await nextTick();
    expect(adapter.writes.length).toBe(before + 1);
  });
});
