/**
 * GitHub Release 附件的挑選 —— 純函式，不碰網路與平台 API，供 vitest 釘住。
 *
 * 「分享下載連結」的 QR code 要指向**最新版的 APK 本身**（使用者的決定，見
 * share-latest-apk-qrcode/design.md D1），而 APK 的附件網址含版本號、每版都變，
 * 所以開對話框時向 GitHub 查一次 releases/latest 再從附件中挑；挑錯（例如挑到 msi）
 * 不會有例外，只會讓掃到的人下載錯檔，故把挑選抽出來測。
 */

export interface ApkAsset {
  url: string;
  name: string;
}

/**
 * 從 release 的 assets 陣列中挑出 APK。名稱以 `.apk` 結尾（不分大小寫）的第一個；
 * 沒有可用的 `browser_download_url` 時視為沒有。
 */
export function pickApkAsset(assets: unknown): ApkAsset | null {
  if (!Array.isArray(assets)) return null;
  for (const a of assets) {
    const name = String((a as { name?: unknown })?.name ?? '');
    const url = String((a as { browser_download_url?: unknown })?.browser_download_url ?? '');
    if (name.toLowerCase().endsWith('.apk') && url.startsWith('http')) {
      return { url, name };
    }
  }
  return null;
}

/** 自 tag（如 `v1.0.107`）取出版本號；取不到回傳空字串。 */
export function versionFromTag(tag: unknown): string {
  return String(tag ?? '').replace(/^[^\d]*/, '');
}
