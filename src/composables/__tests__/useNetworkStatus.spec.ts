import { describe, it, expect } from 'vitest';
import {
  useNetworkStatus,
  describeNetworkStatus,
  NETWORK_STATUS_PROBE_INTERVAL_MS,
  type NetworkStatusDeps,
} from '../useNetworkStatus';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * 假的平台邊界：探測、裝置連線事件、頁面可見性事件與計時器全部可控，
 * 測試不接觸真實網路、真實計時器或瀏覽器 API。
 */
function createHarness(initialDeviceOnline = true, initialVisible = true) {
  let deviceOnline = initialDeviceOnline;
  let visible = initialVisible;
  let onlineCb: ((online: boolean) => void) | null = null;
  let visibilityCb: ((v: boolean) => void) | null = null;
  const probeCalls: Array<{ resolve: (v: boolean) => void; reject: (e: unknown) => void }> = [];
  const intervalCallbacks: Array<() => void> = [];
  const clearedIntervalIds: unknown[] = [];
  const flags = { onlineUnsubscribed: false, visibilityUnsubscribed: false };
  let nextIntervalId = 1;

  const deps: NetworkStatusDeps = {
    probe: () => {
      const d = deferred<boolean>();
      probeCalls.push({ resolve: d.resolve, reject: d.reject });
      return d.promise;
    },
    isDeviceOnline: () => deviceOnline,
    onDeviceOnlineChange: (cb) => {
      onlineCb = cb;
      return () => { flags.onlineUnsubscribed = true; onlineCb = null; };
    },
    isPageVisible: () => visible,
    onVisibilityChange: (cb) => {
      visibilityCb = cb;
      return () => { flags.visibilityUnsubscribed = true; visibilityCb = null; };
    },
    setIntervalFn: (handler) => {
      intervalCallbacks.push(handler);
      return nextIntervalId++;
    },
    clearIntervalFn: (id) => { clearedIntervalIds.push(id); },
  };

  return {
    deps,
    probeCalls,
    intervalCallbacks,
    clearedIntervalIds,
    flags,
    setDeviceOnline: (v: boolean) => { deviceOnline = v; },
    emitOnlineChange: (online: boolean) => { deviceOnline = online; onlineCb?.(online); },
    emitVisibilityChange: (v: boolean) => { visible = v; visibilityCb?.(v); },
    runLatestIntervalTick: () => { intervalCallbacks[intervalCallbacks.length - 1]?.(); },
  };
}

describe('describeNetworkStatus', () => {
  it('四態各自對應圖示與文字，不單靠顏色', () => {
    expect(describeNetworkStatus('checking')).toMatchObject({ compact: true, main: '正在檢查連線' });
    expect(describeNetworkStatus('online')).toMatchObject({ compact: true, main: '網路正常' });
    const degraded = describeNetworkStatus('degraded');
    expect(degraded.compact).toBe(false);
    expect(degraded.main).toContain('不穩定');
    expect(degraded.sub).toBeTruthy();
    const offline = describeNetworkStatus('offline');
    expect(offline.compact).toBe(false);
    expect(offline.main).toContain('無法連上網際網路');
    expect(offline.sub).toBeTruthy();
  });
});

describe('useNetworkStatus：初始狀態', () => {
  it('尚未 start() 前即為 checking', () => {
    const h = createHarness();
    const { state } = useNetworkStatus(h.deps);
    expect(state.value).toBe('checking');
    expect(h.probeCalls).toHaveLength(0);
  });
});

describe('useNetworkStatus：start() 後的探測收斂', () => {
  it('裝置在線且探測成功時收斂為 online', async () => {
    const h = createHarness(true);
    const { state, start } = useNetworkStatus(h.deps);
    start();
    expect(state.value).toBe('checking');
    expect(h.probeCalls).toHaveLength(1);
    h.probeCalls[0].resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('online');
  });

  it('裝置在線但探測失敗（逾時或非預期回應）時收斂為 degraded，不斷言為離線', async () => {
    const h = createHarness(true);
    const { state, start } = useNetworkStatus(h.deps);
    start();
    h.probeCalls[0].resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('degraded');
  });

  it('探測過程拋出例外時視為失敗，收斂為 degraded 而不拋出', async () => {
    const h = createHarness(true);
    const { state, start } = useNetworkStatus(h.deps);
    start();
    h.probeCalls[0].reject(new Error('probe crashed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('degraded');
  });

  it('start() 時裝置已回報離線，直接進入 offline，不發出探測', () => {
    const h = createHarness(false);
    const { state, start } = useNetworkStatus(h.deps);
    start();
    expect(state.value).toBe('offline');
    expect(h.probeCalls).toHaveLength(0);
  });
});

describe('useNetworkStatus：裝置連線事件', () => {
  it('裝置離線事件立即切換為 offline，不等待下一次定期探測', () => {
    const h = createHarness(true);
    const { state, start } = useNetworkStatus(h.deps);
    start();
    h.emitOnlineChange(false);
    expect(state.value).toBe('offline');
  });

  it('裝置恢復連線事件先顯示 checking，再依探測結果收斂', async () => {
    const h = createHarness(true);
    const { state, start } = useNetworkStatus(h.deps);
    start();
    h.emitOnlineChange(false);
    expect(state.value).toBe('offline');

    h.emitOnlineChange(true);
    expect(state.value).toBe('checking');

    const latest = h.probeCalls[h.probeCalls.length - 1];
    latest.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('online');
  });
});

describe('useNetworkStatus：手動重新檢查', () => {
  it('立即顯示 checking 並啟動新探測，完成後更新為最新結果', async () => {
    const h = createHarness(true);
    const { state, start, recheck } = useNetworkStatus(h.deps);
    start();
    h.probeCalls[0].resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('degraded');

    recheck();
    expect(state.value).toBe('checking');
    expect(h.probeCalls).toHaveLength(2);
    h.probeCalls[1].resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('online');
  });
});

describe('useNetworkStatus：探測結果回傳順序顛倒', () => {
  it('只採用最後啟動之探測的結果，較晚回傳的過期結果不覆蓋', async () => {
    const h = createHarness(true);
    const { state, start, recheck } = useNetworkStatus(h.deps);
    start(); // 探測 #1（進行中）
    recheck(); // 探測 #2（進行中，作廢 #1）
    expect(h.probeCalls).toHaveLength(2);

    // 較新的 #2 先完成
    h.probeCalls[1].resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('online');

    // 較舊的 #1 較晚才完成，且結果相反（false）——不得覆蓋 #2 已寫入的 online
    h.probeCalls[0].resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('online');
  });
});

describe('useNetworkStatus：頁面可見性與定期探測', () => {
  it('可見期間以固定間隔常數註冊定期探測', () => {
    const h = createHarness(true, true);
    const { start } = useNetworkStatus(h.deps);
    start();
    expect(h.intervalCallbacks).toHaveLength(1);
  });

  it('定期背景探測不將狀態打回 checking（避免每次閃爍）', async () => {
    const h = createHarness(true, true);
    const { state, start } = useNetworkStatus(h.deps);
    start();
    h.probeCalls[0].resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('online');

    h.runLatestIntervalTick();
    expect(state.value).toBe('online'); // 未被打回 checking
    expect(h.probeCalls).toHaveLength(2);
  });

  it('頁面隱藏時停止週期探測；恢復可見時立即刷新並重啟週期', () => {
    const h = createHarness(true, true);
    const { start } = useNetworkStatus(h.deps);
    start();
    const probesBeforeHide = h.probeCalls.length;

    h.emitVisibilityChange(false);
    expect(h.clearedIntervalIds).toHaveLength(1);

    h.emitVisibilityChange(true);
    expect(h.probeCalls.length).toBeGreaterThan(probesBeforeHide);
    expect(h.intervalCallbacks.length).toBeGreaterThan(1); // 重新註冊了新的週期
  });
});

describe('useNetworkStatus：停止與清理', () => {
  it('stop() 會取消事件訂閱並清除計時器', () => {
    const h = createHarness(true, true);
    const { start, stop } = useNetworkStatus(h.deps);
    start();
    stop();
    expect(h.flags.onlineUnsubscribed).toBe(true);
    expect(h.flags.visibilityUnsubscribed).toBe(true);
    expect(h.clearedIntervalIds.length).toBeGreaterThanOrEqual(1);
  });

  it('stop() 後才完成的探測結果不再回寫狀態', async () => {
    const h = createHarness(true, true);
    const { state, start, stop } = useNetworkStatus(h.deps);
    start();
    const pending = h.probeCalls[0];
    stop();
    pending.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value).toBe('checking'); // 停留在 stop() 當下的狀態，未被延遲結果覆蓋
  });
});

describe('常數', () => {
  it('定期探測間隔為 30 秒', () => {
    expect(NETWORK_STATUS_PROBE_INTERVAL_MS).toBe(30_000);
  });
});
