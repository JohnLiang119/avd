/**
 * NFC 讀卡機的前端側：型別、插件封裝，以及歷史紀錄的純函式。
 *
 * 原生端（`NfcPlugin.java`）只做「感應並回報 UID 的大寫 Hex」；格式已固定，
 * 前端不再轉換。去重、截斷、壞資料清理全在這裡的純函式，可被 vitest 釘住
 * （design.md D2／D6）。
 *
 * 歷史紀錄的權威來源在前端（`useStorage`）：它只在讀卡畫面顯示，WebView 未執行時
 * 沒有任何讀取需求，不符 config-persistence 對「原生端權威」例外的條件。
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

const NfcPlugin = registerPlugin<any>('Nfc');

// ---- 型別 ----

/** 裝置的 NFC 能力：沒有硬體時 supported 為 false；有硬體但使用者關閉時 enabled 為 false。 */
export interface NfcStatus {
  supported: boolean;
  enabled: boolean;
}

/** 原生端感應到卡片時推送的事件。uidHex 為大寫、不分隔、每位元組兩位。 */
export interface NfcTagEvent {
  uidHex: string;
  uidLength: number;
}

/** 歷史紀錄的一筆：卡號與讀取時間（epoch 毫秒）。 */
export interface NfcHistoryEntry {
  uid: string;
  at: number;
}

// ---- 常數 ----

/** 歷史紀錄保留筆數（規格「歷史紀錄」）。 */
export const NFC_HISTORY_MAX = 50;

/** 同一卡號在此時間窗內重複感應只更新時間、不新增（規格「歷史紀錄」）。 */
export const NFC_DEDUP_WINDOW_MS = 3000;

// ---- 純函式 ----

/**
 * 把一次讀卡加進歷史。
 *
 * 去重只看最新的一筆：規格說的是「短時間內重複感應」，也就是同一張卡貼著不放、
 * 或拿開又放回；若中間讀過別張卡，再讀回來就是一次新的讀取，應該新增一筆。
 * 回傳新陣列，不改動輸入。
 */
export function appendNfcHistory(
  list: NfcHistoryEntry[],
  uid: string,
  now: number,
  windowMs: number = NFC_DEDUP_WINDOW_MS,
  max: number = NFC_HISTORY_MAX,
): NfcHistoryEntry[] {
  const head = list[0];
  if (head && head.uid === uid && now - head.at < windowMs) {
    return [{ uid, at: now }, ...list.slice(1)];
  }
  return [{ uid, at: now }, ...list].slice(0, max);
}

/**
 * 自持久化層還原時的清理：濾掉格式不符的項目並截斷。
 *
 * localStorage 裡的東西可能來自舊版或被手動改過，任何一筆壞掉都不該讓整份歷史
 * 讀不出來，所以逐筆判斷、壞的丟掉、好的照原順序保留。
 */
export function sanitizeNfcHistory(raw: unknown, max: number = NFC_HISTORY_MAX): NfcHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const clean: NfcHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { uid, at } = item as Record<string, unknown>;
    if (typeof uid !== 'string' || uid.length === 0) continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    clean.push({ uid, at });
    if (clean.length >= max) break;
  }
  return clean;
}

/**
 * UID 長度超過 4 byte 時的提示文字；4 byte 以下回空字串。
 *
 * 部分門禁系統對 7 或 10 byte 的 UID 只取其中一段（design.md「Risks」），
 * 這裡不猜截法，只提醒使用者比對時留意。
 */
export function describeUidLength(uidLength: number): string {
  if (uidLength <= 4) return '';
  return `此卡 UID 為 ${uidLength} byte，門禁系統可能只取其中一段，比對時請留意。`;
}

// ---- 插件封裝 ----

export async function getNfcStatus(): Promise<NfcStatus> {
  const result = await NfcPlugin.getStatus();
  return {
    supported: Boolean(result?.supported),
    enabled: Boolean(result?.enabled),
  };
}

export async function startNfcScan(): Promise<void> {
  await NfcPlugin.startScan();
}

export async function stopNfcScan(): Promise<void> {
  await NfcPlugin.stopScan();
}

export async function openNfcSettings(): Promise<void> {
  await NfcPlugin.openSettings();
}

/** 感應到卡片。回傳的 handle 供關閉畫面時 `remove()`。 */
export function onNfcTag(callback: (event: NfcTagEvent) => void): Promise<PluginListenerHandle> {
  return NfcPlugin.addListener('tagDiscovered', (data: any) => {
    callback({
      uidHex: String(data?.uidHex ?? ''),
      uidLength: Number(data?.uidLength ?? 0),
    });
  });
}

/** NFC 能力狀態變化（App 回到前景時原生端重查後推送，design.md D3）。 */
export function onNfcState(callback: (status: NfcStatus) => void): Promise<PluginListenerHandle> {
  return NfcPlugin.addListener('stateChanged', (data: any) => {
    callback({
      supported: Boolean(data?.supported),
      enabled: Boolean(data?.enabled),
    });
  });
}
