import { ref, type Ref } from 'vue';

/**
 * 主畫面網路狀態：四態模型，用以區分「離線」與「已連線但無法連上網際網路」。
 *
 * 與 `rateLimit.ts` 的 `isDeviceOfflineError`（NETWORK_ERROR 前綴）是兩件獨立
 * 的事——那是個別請求失敗後的事後分類，這裡是持續性、主動探測的畫面狀態，
 * 刻意不共用邏輯（見 show-network-status/design.md 的 Non-Goals）。
 */
export type NetworkStatusState = 'checking' | 'online' | 'degraded' | 'offline';

/** 主畫面可見期間，兩次自動探測之間的間隔（毫秒）。 */
export const NETWORK_STATUS_PROBE_INTERVAL_MS = 30_000;

/** 單次探測的逾時上限（毫秒）。實際逾時由平台探測實作自行套用，此處僅供其取用。 */
export const NETWORK_STATUS_PROBE_TIMEOUT_MS = 4_000;

export interface NetworkStatusText {
  /** true 時以精簡標籤呈現（checking/online），false 時展開為全寬提示列（degraded/offline） */
  compact: boolean;
  icon: string;
  main: string;
  sub?: string;
}

/**
 * 依狀態決定顯示文案；標示與文字並列，不單獨依賴顏色傳達狀態。
 *
 * 四個標示構成一組**同一形狀的漸變**：實心圓為完全連通、半圓為部分連通、
 * 空心圓為不通、刪節號為判定中。使用者不需要學習對照表就看得出彼此的關係。
 *
 * 刻意不使用表情符號（見 `visual-language` 的「介面不得以裝飾性圖像傳達
 * 資訊」），也刻意避開 `▸ ↑ × ↓` 那組**動作**字元 —— 狀態與動作若共用字元，
 * 使用者會以為那是可以點的。
 *
 * 標示本身不可省略：調色盤收斂為灰階之後，顏色能傳達的訊息更少，
 * 而「不單獨依賴顏色」這個性質反而更重要。
 */
export function describeNetworkStatus(state: NetworkStatusState): NetworkStatusText {
  switch (state) {
    case 'checking':
      return { compact: true, icon: '…', main: '正在檢查連線' };
    case 'online':
      return { compact: true, icon: '●', main: '網路正常' };
    case 'degraded':
      return {
        compact: false,
        icon: '◐',
        main: '網路不穩定',
        sub: '已連線但暫時無法連上網際網路，部分功能可能較慢或失敗',
      };
    case 'offline':
      return {
        compact: false,
        icon: '○',
        main: '目前無法連上網際網路',
        sub: '請確認 Wi-Fi 或行動網路已開啟',
      };
  }
}

export interface NetworkStatusDeps {
  /** 對固定探測端點發出一次請求，於逾時內取得預期回應（如 204）時 resolve true */
  probe: (timeoutMs: number) => Promise<boolean>;
  /** 裝置目前是否回報有可用網路連線（如 `navigator.onLine`） */
  isDeviceOnline: () => boolean;
  /** 註冊裝置連線狀態變化事件，回傳取消訂閱函式 */
  onDeviceOnlineChange: (cb: (online: boolean) => void) => () => void;
  /** 頁面目前是否可見 */
  isPageVisible: () => boolean;
  /** 註冊頁面可見性變化事件，回傳取消訂閱函式 */
  onVisibilityChange: (cb: (visible: boolean) => void) => () => void;
  /** 可注入的計時器，預設為全域 `setInterval`／`clearInterval`；測試時替換為假計時器 */
  setIntervalFn?: (handler: () => void, timeoutMs: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
}

export interface NetworkStatusController {
  state: Ref<NetworkStatusState>;
  start: () => void;
  stop: () => void;
  recheck: () => void;
}

/**
 * 主畫面網路狀態控制器。
 *
 * 探測以遞增序號防競態：任一時刻只有最後發起的探測可以回寫狀態，較早發起、
 * 較晚完成的探測結果會被忽略（對應 spec 的「探測結果回傳順序顛倒」情境）。
 *
 * 只有明確觸發（啟動、裝置恢復連線、手動重新檢查）才會先切到 `checking`；
 * 主畫面可見期間的定期背景探測不會，避免每 30 秒閃爍一次「檢查中」。
 * spec 並未要求定期探測也顯示 checking，只要求「較舊結果不得覆蓋較新狀態」。
 */
export function useNetworkStatus(deps: NetworkStatusDeps): NetworkStatusController {
  const state = ref<NetworkStatusState>('checking');
  const setIntervalFn = deps.setIntervalFn ?? ((h, ms) => setInterval(h, ms));
  const clearIntervalFn = deps.clearIntervalFn ?? ((id) => clearInterval(id as any));

  let seq = 0;
  let intervalId: unknown = null;
  let unsubOnline: (() => void) | null = null;
  let unsubVisibility: (() => void) | null = null;
  let started = false;

  function stopInterval() {
    if (intervalId !== null) {
      clearIntervalFn(intervalId);
      intervalId = null;
    }
  }

  function startInterval() {
    stopInterval();
    intervalId = setIntervalFn(() => { void runProbe(false); }, NETWORK_STATUS_PROBE_INTERVAL_MS);
  }

  async function runProbe(showChecking: boolean) {
    const mySeq = ++seq;

    if (!deps.isDeviceOnline()) {
      state.value = 'offline';
      return;
    }

    if (showChecking) state.value = 'checking';

    let ok = false;
    try {
      ok = await deps.probe(NETWORK_STATUS_PROBE_TIMEOUT_MS);
    } catch {
      ok = false;
    }

    // 較早發起、較晚完成的探測：忽略其結果，不覆蓋較新的狀態
    if (mySeq !== seq) return;
    if (!deps.isDeviceOnline()) {
      state.value = 'offline';
      return;
    }
    state.value = ok ? 'online' : 'degraded';
  }

  function handleDeviceOnlineChange(online: boolean) {
    if (!online) {
      seq++; // 讓任何進行中的探測結果作廢
      state.value = 'offline';
      stopInterval();
    } else {
      void runProbe(true);
      if (deps.isPageVisible()) startInterval();
    }
  }

  function handleVisibilityChange(visible: boolean) {
    if (visible) {
      void runProbe(true);
      startInterval();
    } else {
      stopInterval();
    }
  }

  function start() {
    if (started) return;
    started = true;
    unsubOnline = deps.onDeviceOnlineChange(handleDeviceOnlineChange);
    unsubVisibility = deps.onVisibilityChange(handleVisibilityChange);
    void runProbe(true);
    if (deps.isPageVisible()) startInterval();
  }

  function stop() {
    if (!started) return;
    started = false;
    seq++; // 讓任何進行中的探測結果作廢，避免 stop 後仍回寫狀態
    unsubOnline?.();
    unsubOnline = null;
    unsubVisibility?.();
    unsubVisibility = null;
    stopInterval();
  }

  function recheck() {
    void runProbe(true);
  }

  return { state, start, stop, recheck };
}
