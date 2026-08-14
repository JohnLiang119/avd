import { registerPlugin } from '@capacitor/core';
import { isTauri } from './DownloadService';
import { downloadDir } from '@tauri-apps/api/path';
import { writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { open as openShell } from '@tauri-apps/plugin-shell';

const YoutubeDlPlugin = registerPlugin<any>('YoutubeDl');

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseTitle: string;
  releaseNotes: string;
  downloadUrl: string;
  assetName: string;
  htmlUrl: string;
}

export interface DownloadProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

/**
 * 比較兩組版本號 (SemVer: 如 1.0.1 vs 1.0.0)
 * 回傳:
 *   1  -> v1 > v2 (有新版本)
 *   0  -> v1 == v2 (相同)
 *  -1  -> v1 < v2 (更舊)
 */
export function compareSemVer(v1: string, v2: string): number {
  const parse = (v: string) =>
    v.replace(/^[^\d]*/, '')
      .split('.')
      .map(part => parseInt(part, 10) || 0);

  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);

  for (let i = 0; i < len; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export const UpdateService = {
  /**
   * 檢查 GitHub Releases 是否有新版本
   * @param currentVersion 目前本機版本號 (例如 1.0.0)
   * @param timeoutMs 超時時間 (預設 5000ms)
   */
  async checkForUpdates(currentVersion: string, timeoutMs = 5000): Promise<UpdateInfo> {
    const defaultResult: UpdateInfo = {
      hasUpdate: false,
      latestVersion: currentVersion,
      currentVersion,
      releaseTitle: '',
      releaseNotes: '',
      downloadUrl: '',
      assetName: '',
      htmlUrl: 'https://github.com/JohnLiang119/avd/releases'
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch('https://api.github.com/repos/JohnLiang119/avd/releases/latest', {
        signal: controller.signal,
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        return defaultResult;
      }

      const release = await resp.json();
      const tagName = release.tag_name || '';
      const remoteVersion = tagName.replace(/^[^\d]*/, '');

      if (!remoteVersion) {
        return defaultResult;
      }

      const isNewer = compareSemVer(remoteVersion, currentVersion) > 0;
      if (!isNewer) {
        return defaultResult;
      }

      // 依目前平台尋找對應的安裝檔
      const assets: any[] = release.assets || [];
      let targetAsset: any = null;

      if (isTauri()) {
        // Windows: 優先找 .msi
        targetAsset = assets.find(a => a.name?.toLowerCase().endsWith('.msi')) ||
                      assets.find(a => a.name?.toLowerCase().endsWith('.exe'));
      } else {
        // Android: 找 .apk
        targetAsset = assets.find(a => a.name?.toLowerCase().endsWith('.apk'));
      }

      const downloadUrl = targetAsset ? targetAsset.browser_download_url : (release.html_url || '');
      const assetName = targetAsset ? targetAsset.name : '';

      return {
        hasUpdate: true,
        latestVersion: remoteVersion,
        currentVersion,
        releaseTitle: release.name || `v${remoteVersion}`,
        releaseNotes: release.body || '暫無更新說明。',
        downloadUrl,
        assetName,
        htmlUrl: release.html_url || defaultResult.htmlUrl
      };
    } catch (e) {
      // 離線、逾時或連線失敗，靜默返回無更新
      return defaultResult;
    }
  },

  /**
   * 下載並自動叫起各平台原生安裝程序
   */
  async downloadAndInstall(
    updateInfo: UpdateInfo,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<void> {
    if (!updateInfo.downloadUrl) {
      throw new Error('找不到可用的安裝檔下載連結');
    }

    if (!isTauri()) {
      // Android 流程
      return new Promise<void>((resolve, reject) => {
        let listenerHandle: any = null;

        const cleanup = () => {
          if (listenerHandle && listenerHandle.remove) {
            listenerHandle.remove();
          }
        };

        YoutubeDlPlugin.addListener('updateDownloadProgress', (data: any) => {
          onProgress({
            percent: data.percent || 0,
            downloadedBytes: data.downloadedBytes || 0,
            totalBytes: data.totalBytes || 0
          });
        }).then((handle: any) => {
          listenerHandle = handle;
        });

        const fileName = updateInfo.assetName || `AVD_${updateInfo.latestVersion}.apk`;

        YoutubeDlPlugin.downloadUpdateFile({
          url: updateInfo.downloadUrl,
          fileName
        }).then((res: any) => {
          cleanup();
          const filePath = res.filePath;
          if (!filePath) {
            reject(new Error('下載完成但未取得檔案路徑'));
            return;
          }
          // 喚起系統安裝 Intent
          return YoutubeDlPlugin.installApk({ filePath });
        }).then(() => {
          resolve();
        }).catch((err: any) => {
          cleanup();
          reject(err);
        });
      });
    } else {
      // Windows 流程
      try {
        const fileName = updateInfo.assetName || `AVD_${updateInfo.latestVersion}.msi`;
        const rawDownDir = await downloadDir();
        const downDir = rawDownDir.replace(/[/\\]+$/, '');
        const targetPath = `${downDir}/${fileName}`;

        const response = await fetch(updateInfo.downloadUrl);
        if (!response.ok) {
          throw new Error(`下載失敗 (${response.status} ${response.statusText})`);
        }

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        let downloadedBytes = 0;

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('無法讀取下載資料流');
        }

        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            downloadedBytes += value.length;
            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
            onProgress({
              percent,
              downloadedBytes,
              totalBytes
            });
          }
        }

        // 合併 bytes
        const allChunks = new Uint8Array(downloadedBytes);
        let position = 0;
        for (const chunk of chunks) {
          allChunks.set(chunk, position);
          position += chunk.length;
        }

        // 寫入本地檔案
        await writeFile(targetPath, allChunks);

        // 透過 Rust 執行 msiexec 安裝並重啟
        await invoke('install_win_msi', { msiPath: targetPath });
      } catch (e: any) {
        throw new Error(`Windows 更新失敗: ${e.message || String(e)}`);
      }
    }
  },

  /**
   * 在外部瀏覽器開啟 Release 頁面（備用下載）
   */
  async openReleasePage(url: string): Promise<void> {
    if (isTauri()) {
      try {
        await openShell(url);
      } catch (e) {
        window.open(url, '_blank');
      }
    } else {
      window.open(url, '_system');
    }
  }
};
