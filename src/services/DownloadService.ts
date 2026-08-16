import { registerPlugin } from '@capacitor/core';
import { Command, open } from '@tauri-apps/plugin-shell';
import { downloadDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readTextFile, rename, remove, exists, stat } from '@tauri-apps/plugin-fs';
import * as OpenCC from 'opencc-js';

// 改用 t (標準繁體) 轉 cn，避開台灣標準對「么」的強制校正
const _t2cn = OpenCC.Converter({ from: 't', to: 'cn' });
const _cn2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });

const convertCnToTw = (text: string): string => {
  if (!text) return text;
  // 若嘗試把繁體轉簡體時發生了改變，代表原文【含有繁體專屬字】
  // 這時我們判斷原文「已經是繁體」，就不做任何轉換，保持原狀（避免「岳」被過度轉換成「嶽」）
  if (_t2cn(text) !== text) {
    return text;
  }
  // 如果裡面完全沒有繁體專屬字，我們就當作它是簡體或中性字，進行簡轉繁
  return _cn2tw(text);
};

const YoutubeDlPlugin = registerPlugin<any>('YoutubeDl');

export const isTauri = () => {
  return window.hasOwnProperty('__TAURI_INTERNALS__');
};

let activeChildProcess: any = null;
let activeRcloneChildProcess: any = null;
let isManualCancelling = false;
let currentAndroidProcessId = '';

// Mock event emitter for Tauri
type Listener = (info: any) => void;
const listeners: Record<string, Listener[]> = {
  downloadProgress: [],
  serverUploadSpeed: [],
  driveUploadProgress: []
};

function emitEvent(eventName: string, data: any) {
  if (listeners[eventName]) {
    listeners[eventName].forEach(fn => fn(data));
  }
}

if (isTauri()) {
  try {
    listen('serverUploadSpeed', (event: any) => {
      emitEvent('serverUploadSpeed', event.payload);
    });
  } catch (e) {
    console.error('Failed to listen for serverUploadSpeed', e);
  }
}

export interface PlaylistItem {
  id: string;
  url: string;
  title: string;
  durationStr?: string;
}

export interface PlaylistResult {
  channelTitle: string;
  playlistTitle: string;
  items: PlaylistItem[];
}

export const DownloadService = {
  addListener(eventName: string, callback: Listener) {
    if (isTauri()) {
      listeners[eventName].push(callback);
    } else {
      YoutubeDlPlugin.addListener(eventName, (info: any) => {
        if (info) {
          if (info.title) info.title = convertCnToTw(info.title);
          if (info.line) info.line = convertCnToTw(info.line);
          if (info.channel) info.channel = convertCnToTw(info.channel);
        }
        callback(info);
      });
    }
  },

  async parsePlaylist(url: string): Promise<PlaylistResult> {
    if (!isTauri()) {
      const res = await YoutubeDlPlugin.parsePlaylist({ url });
      if (res) {
        if (res.channelTitle) res.channelTitle = convertCnToTw(res.channelTitle);
        if (res.playlistTitle) res.playlistTitle = convertCnToTw(res.playlistTitle);
        if (res.items) {
          res.items.forEach((item: any) => {
            if (item.title) item.title = convertCnToTw(item.title);
          });
        }
      }
      return res;
    }

    try {
      const args = [
        '--extractor-args', 'youtube:player_client=web_creator,default',
        '--rm-cache-dir',
        '--flat-playlist',
        '-J',
        url
      ];

      const command = Command.sidecar('bin/yt-dlp', args, { encoding: 'utf-8' });
      const output = await command.execute();

      if (output.code !== 0) {
        throw new Error('解析播放清單失敗: ' + output.stderr);
      }

      const data = JSON.parse(output.stdout);
      const channelTitle = convertCnToTw(data.uploader || data.channel || data.uploader_id || '頻道主');
      const playlistTitle = convertCnToTw(data.title || '播放清單');

      const processEntries = async (entriesData: any[]): Promise<PlaylistItem[]> => {
        const result: PlaylistItem[] = [];

        for (let index = 0; index < entriesData.length; index++) {
          const entry = entriesData[index];
          const entryUrl = entry.url || entry.webpage_url || '';
          const entryId = entry.id || '';
          const ieKey = entry.ie_key || '';
          const entryType = entry._type || '';

          const isSubPlaylist = entryType === 'playlist' ||
                                entryType === 'multi_video' ||
                                ieKey === 'YoutubePlaylist' ||
                                ieKey === 'YoutubeTab' ||
                                (entryUrl && (entryUrl.includes('list=PL') || entryUrl.includes('/playlist?list='))) ||
                                (entryId && typeof entryId === 'string' && entryId.startsWith('PL'));

          if (isSubPlaylist && (entryUrl || entryId)) {
            try {
              const subUrl = entryUrl.startsWith('http')
                ? entryUrl
                : `https://www.youtube.com/playlist?list=${entryId || entryUrl}`;
              const subArgs = [
                '--extractor-args', 'youtube:player_client=web_creator,default',
                '--rm-cache-dir',
                '--flat-playlist',
                '-J',
                subUrl
              ];
              const subCmd = Command.sidecar('bin/yt-dlp', subArgs, { encoding: 'utf-8' });
              const subOut = await subCmd.execute();
              if (subOut.code === 0) {
                const subData = JSON.parse(subOut.stdout);
                if (subData.entries && subData.entries.length > 0) {
                  const subItems = await processEntries(subData.entries);
                  result.push(...subItems);
                  continue;
                }
              }
            } catch (e) {
              console.warn('Expanding sub-playlist failed:', entryUrl, e);
            }
          }

          const itemTitle = convertCnToTw(entry.title || entry.fulltitle || `影片 ${index + 1}`);
          const videoId = entry.id || entry.url || String(index);
          let itemUrl = entry.url || entry.webpage_url || '';
          if (itemUrl && !itemUrl.startsWith('http')) {
            if (url.includes('douyin.com')) {
              itemUrl = `https://www.douyin.com/video/${itemUrl}`;
            } else if (url.includes('tiktok.com')) {
              itemUrl = `https://www.tiktok.com/video/${itemUrl}`;
            } else {
              itemUrl = `https://www.youtube.com/watch?v=${itemUrl}`;
            }
          }
          if (!itemUrl) {
            if (url.includes('douyin.com')) {
              itemUrl = `https://www.douyin.com/video/${videoId}`;
            } else if (url.includes('tiktok.com')) {
              itemUrl = `https://www.tiktok.com/video/${videoId}`;
            } else {
              itemUrl = `https://www.youtube.com/watch?v=${videoId}`;
            }
          }

          let durationStr = '';
          if (typeof entry.duration === 'number') {
            const mins = Math.floor(entry.duration / 60);
            const secs = Math.floor(entry.duration % 60);
            durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          }

          result.push({
            id: String(videoId),
            url: itemUrl,
            title: itemTitle,
            durationStr
          });
        }
        return result;
      };

      let initialEntries = data.entries || [];
      if (!initialEntries.length && (data.id || data.url)) {
        initialEntries = [data];
      }

      const items = await processEntries(initialEntries);

      return {
        channelTitle,
        playlistTitle,
        items
      };
    } catch (e: any) {
      throw new Error('播放清單解析失敗: ' + (e.message || String(e)));
    }
  },

  async download(options: { url: string; mp3: boolean; subFolder?: string }) {
    if (!isTauri()) {
      currentAndroidProcessId = 'process_' + Date.now() + Math.random().toString().slice(2, 8);
      return YoutubeDlPlugin.download({ ...options, processId: currentAndroidProcessId });
    }

    try {
      const rawDownDir = await downloadDir();
      const downDir = rawDownDir.replace(/[/\\]+$/, '');
      const avdDir = `${downDir}/AVD`;
      
      const sanitizeFolder = options.subFolder ? options.subFolder.replace(/[\/\\:*?"<>|]/g, '_').trim() : '';
      const targetDirPath = sanitizeFolder ? `${avdDir}/${sanitizeFolder}` : avdDir;

      // 產生一個隨機 ID 來當作唯一檔名
      const uniqueId = Date.now().toString() + '_' + Math.floor(Math.random() * 1000);

      const args = [
        '--extractor-args', 'youtube:player_client=web_creator,default',
        '--rm-cache-dir',
        '--retries', '3',
        '--fragment-retries', '3',
        '--extractor-retries', '3',
        '--newline',
        '-q',              // 靜默模式：只輸出 ASCII 進度，不輸出中文訊息
        '--progress',
        '--write-info-json', // 將影片標題等中繼資料寫入 .info.json（UTF-8 格式）
        '-o', `${targetDirPath}/${uniqueId}.%(ext)s`  // 使用唯一 ID 儲存，確保不衝突
      ];

      if (options.mp3) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      } else {
        // 強制下載 H.264 影片與 M4A 音訊，打包成 mp4 (iPad/iPhone 最高相容性)
        args.push('-f', 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
        args.push('--merge-output-format', 'mp4');
      }

      args.push(options.url);

      isManualCancelling = false;
      const command = Command.sidecar('bin/yt-dlp', args, { encoding: 'utf-8' });

      let stderrOutput = '';

      command.stdout.on('data', (line: string) => {
        // 進度行是純 ASCII，可以安全解析
        if (line.includes('[download]') && line.includes('%')) {
          const progressMatch = line.match(/(\d+\.?\d*)%/);
          const speedMatch = line.match(/at\s+([0-9.]+[a-zA-Z]+\/s)/);
          const etaMatch = line.match(/ETA\s+([0-9:]+)/);
          
          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]);
            emitEvent('downloadProgress', {
              progress: progress,
              speed: speedMatch ? speedMatch[1] : '',
              eta: etaMatch ? etaMatch[1] : ''
            });
          }
        }
      });

      command.stderr.on('data', (line: string) => {
        stderrOutput += line + '\n';
      });

      const exitPromise = new Promise<void>((resolve, reject) => {
        command.on('close', (data) => {
          activeChildProcess = null;
          if (isManualCancelling) {
            reject(new Error('CANCELLED_BY_USER'));
            return;
          }
          if (data.code === 0) {
            resolve();
          } else {
            reject(new Error('yt-dlp failed with code ' + data.code + ': ' + stderrOutput));
          }
        });
        command.on('error', (err) => {
          activeChildProcess = null;
          if (isManualCancelling) {
            reject(new Error('CANCELLED_BY_USER'));
            return;
          }
          reject(new Error('yt-dlp error: ' + err));
        });
      });

      const child = await command.spawn();
      activeChildProcess = child;
      await exitPromise;

      const ext = options.mp3 ? 'mp3' : 'mp4';
      let logs: string[] = [];
      let rawTitle = '';
      const tempFilePath = `${targetDirPath}/${uniqueId}.${ext}`;
      const infoPath = `${targetDirPath}/${uniqueId}.info.json`;

      try {
        const jsonStr = await readTextFile(infoPath);
        const info = JSON.parse(jsonStr);
        rawTitle = info.title || info.fulltitle || '';
      } catch (e: any) {
        logs.push('Failed to read info.json: ' + (e.message || String(e)));
        console.warn('Failed to read info.json for title', e);
      }

      // 1. 完整繁體標題 (用於 UI 展示)
      const fullTitle = rawTitle ? convertCnToTw(rawTitle) : '';

      // 2. 檔名化 (去除非法衝突字元 \ / : * ? " < > | 且限制前 30 字)
      let cleanFileName = fullTitle.replace(/[\\/:*?"<>|]/g, '_');
      if (cleanFileName.length > 30) {
        cleanFileName = cleanFileName.slice(0, 30);
      }
      cleanFileName = cleanFileName.trim().replace(/\.+$/, '');
      if (!cleanFileName) {
        cleanFileName = `video_${Date.now()}`;
      }

      // 3. 重複檔名檢測與重新命名
      let downloadedFilePath = tempFilePath;

      try {
        let targetFileName = `${cleanFileName}.${ext}`;
        let candidatePath = `${targetDirPath}/${targetFileName}`;
        let counter = 1;

        // 避免重複檔名覆蓋
        while (await exists(candidatePath)) {
          targetFileName = `${cleanFileName}_${counter}.${ext}`;
          candidatePath = `${targetDirPath}/${targetFileName}`;
          counter++;
        }

        if (await exists(tempFilePath)) {
          await rename(tempFilePath, candidatePath);
          downloadedFilePath = candidatePath;
        }

        if (await exists(infoPath)) {
          try {
            await remove(infoPath);
          } catch (err) {
            console.warn('Failed to remove info.json', err);
          }
        }
      } catch (e: any) {
        logs.push('Failed to rename file: ' + (e.message || String(e)));
        console.error('Failed to rename file, using temp path', e);
      }

      // 偵測影片編碼與解析度
      let quality = '';
      let fileSizeBytes = 0;

      if (downloadedFilePath) {
        try {
          const probeCmd = Command.sidecar('bin/ffmpeg', ['-i', downloadedFilePath, '-hide_banner'], { encoding: 'utf-8' });
          const probeOutput = await probeCmd.execute();
          const stderr = probeOutput.stderr || '';
          
          if (options.mp3) {
            const bitrateMatch = stderr.match(/bitrate:\s*(\d+)\s*kb\/s/i) || stderr.match(/Audio:.*?(\d+)\s*kb\/s/i);
            if (bitrateMatch) {
              quality = bitrateMatch[1] + 'kbps';
            } else {
              quality = 'MP3';
            }
          } else {
            // 解析解析度：1920x1080
            const resMatch = stderr.match(/(\d{3,5})x(\d{3,5})/);
            if (resMatch) {
              const height = parseInt(resMatch[2]);
              if (height >= 2160) quality = '4K';
              else if (height >= 1080) quality = '1080p';
              else if (height >= 720) quality = '720p';
              else if (height >= 480) quality = '480p';
              else quality = height + 'p';
            }

            // 解析編碼：Video: h264, hevc, vp9, av1
            const codecMatch = stderr.match(/Video:\s+(\w+)/);
            if (codecMatch) {
              let codec = codecMatch[1].toLowerCase();
              if (codec === 'h264') codec = 'H.264';
              else if (codec === 'hevc') codec = 'H.265';
              else if (codec === 'vp9') codec = 'VP9';
              else if (codec === 'av1') codec = 'AV1';
              else codec = codec.toUpperCase();
              quality = quality ? quality + ' ' + codec : codec;
            }
          }
        } catch (e: any) {
          logs.push('ffprobe failed: ' + (e.message || String(e)));
          console.warn('ffprobe failed, skipping codec detection', e);
        }
      }

      // 取得檔案大小
      if (downloadedFilePath) {
        try {
          const fileInfo = await stat(downloadedFilePath);
          if (fileInfo.size) fileSizeBytes = fileInfo.size;
        } catch (e: any) {
          logs.push('Failed to get file size: ' + (e.message || String(e)));
          console.warn('Failed to get file size', e);
        }
      }

      const displayTitle = fullTitle || cleanFileName;
      if (!displayTitle) {
        throw new Error('影片下載可能已完成，但無法解析標題與檔案資訊。\n日誌:\n' + logs.join('\n'));
      }

      return {
        path: downloadedFilePath || downDir,
        mediaUri: downloadedFilePath || downDir,
        title: displayTitle,
        quality: quality,
        fileSizeBytes: fileSizeBytes,
        isAudio: options.mp3
      };
    } catch (e: any) {
      activeChildProcess = null;
      let msg = e.message || String(e);
      throw new Error(msg);
    }
  },

  async cancelDownload() {
    if (!isTauri()) {
      const pid = currentAndroidProcessId || 'avd_download';
      return YoutubeDlPlugin.cancelDownload({ processId: pid });
    }
    isManualCancelling = true;
    if (activeChildProcess) {
      try {
        await activeChildProcess.kill();
      } catch (e) {
        console.error('Failed to kill child process', e);
      }
      activeChildProcess = null;
    }
    if (activeRcloneChildProcess) {
      try {
        await activeRcloneChildProcess.kill();
      } catch (e) {
        console.error('Failed to kill rclone child process', e);
      }
      activeRcloneChildProcess = null;
    }
    emitEvent('downloadProgress', { cancelled: true });
  },

  async deleteMediaFile(options: { uri: string; path: string }) {
    if (!isTauri()) {
      return YoutubeDlPlugin.deleteMediaFile(options);
    }
    const targetPath = options.path || options.uri;
    if (!targetPath) return;

    try {
      if (await exists(targetPath)) {
        await remove(targetPath);
      }
    } catch (e: any) {
      console.error('Failed to delete media file on Windows', e);
      throw new Error(`無法刪除檔案: ${e.message || String(e)}`);
    }
  },

  async playVideo(options: { uri: string; mimeType?: string }) {
    if (!isTauri()) {
      return YoutubeDlPlugin.playVideo(options);
    }
    try {
      await open(options.uri);
    } catch (e: any) {
      const msg = e.message || (typeof e === 'string' ? e : JSON.stringify(e));
      throw new Error(`無法透過 Tauri open 開啟 ${options.uri}: ${msg}`);
    }
  },

  async openDownloadFolder() {
    if (isTauri()) {
      try {
        const rawDownDir = await downloadDir();
        const downDir = rawDownDir.replace(/[/\\]+$/, '');
        const avdDir = `${downDir}/AVD`;
        await open(avdDir);
      } catch (e: any) {
        console.error('Failed to open download folder', e);
      }
    }
  },

  async uploadToGoogleDrive(options: any) {
    if (!isTauri()) return YoutubeDlPlugin.uploadToGoogleDrive(options);
    throw new Error('Google Drive upload not supported on Windows yet.');
  },

  async directUploadToDrive(options: any) {
    if (!isTauri()) return YoutubeDlPlugin.directUploadToDrive(options);
    
    try {
      // options.accessToken 存著 Rclone 路徑 (例如: yiichungGDGD:avd)
      const rcloneDest = options.accessToken || '';
      if (!rcloneDest) throw new Error('Rclone 路徑未設定');

      // 判斷子目錄
      const subfolder = options.fileName.endsWith('.mp3') ? 'Music' : 'Video';
      // 組合最終目的地 (確保後面沒有多餘的斜線，然後加上子目錄)
      const cleanDest = rcloneDest.replace(/\/$/, '');
      const targetPath = `${cleanDest}/${subfolder}`;

      const args = [
        'copy',
        options.uri,
        targetPath,
        '--progress',
        '--stats=1s'
      ];

      const command = Command.sidecar('bin/rclone', args, { encoding: 'utf-8' });

      let rcloneStderr = '';
      const exitPromise = new Promise<void>((resolve, reject) => {
        command.on('close', (data) => {
          activeRcloneChildProcess = null;
          if (data.code === 0) {
            resolve();
          } else {
            reject(new Error('rclone failed with code ' + data.code + ': ' + rcloneStderr));
          }
        });
        command.on('error', (err) => {
          activeRcloneChildProcess = null;
          reject(new Error('rclone error: ' + err));
        });
      });

      command.stdout.on('data', (line: string) => {
        if (line.includes('%') && line.includes('Transferred:')) {
          const progressMatch = line.match(/(\d+)%/);
          if (progressMatch) {
            emitEvent('driveUploadProgress', {
              taskId: options.taskId,
              progress: parseInt(progressMatch[1])
            });
          }
        }
      });

      command.stderr.on('data', (line: string) => {
        rcloneStderr += line + '\n';
      });

      const child = await command.spawn();
      activeRcloneChildProcess = child;
      await exitPromise;
      return { success: true };
    } catch (e: any) {
      throw new Error(`Rclone 同步錯誤: ${e.message || String(e)}`);
    }
  },

  async getSharedUrl() {
    if (!isTauri()) return YoutubeDlPlugin.getSharedUrl();
    return { url: null };
  },

  async startLocalServer() {
    if (!isTauri()) return YoutubeDlPlugin.startLocalServer();
    return invoke('start_win_local_server');
  },

  async stopLocalServer() {
    if (!isTauri()) return YoutubeDlPlugin.stopLocalServer();
    return invoke('stop_win_local_server');
  },

  async isTvDevice(): Promise<{ isTv: boolean }> {
    if (!isTauri()) {
      try {
        return await YoutubeDlPlugin.isTvDevice();
      } catch (e) {
        return { isTv: false };
      }
    }
    return { isTv: false };
  },

  async checkVideoLiveStatus(url: string): Promise<boolean> {
    try {
      if (!isTauri()) {
        // Android 目前不支援此功能，預設當作非直播
        return false;
      }
      
      const cmd = Command.sidecar('bin/yt-dlp', [
        '--print', 'live_status',
        url
      ]);
      const output = await cmd.execute();
      const status = output.stdout.trim().toLowerCase();
      return status === 'is_live' || status === 'is_upcoming';
    } catch (e) {
      console.warn(`檢查直播狀態失敗 (${url}):`, e);
      return false; // 如果檢查失敗，預設加入佇列以免漏掉
    }
  },

  async fetchYouTubeRss(channelId: string): Promise<Array<{ videoId: string; title: string; published: string; publishedTime: number; url: string }>> {
    try {
      let xmlText = '';
      if (!isTauri()) {
        // Android 端使用原生外掛繞過 WebView CORS 限制
        const res = await YoutubeDlPlugin.fetchChannelRss({ channelId });
        xmlText = res.xml || '';
      } else {
        // Windows/桌面端直接 fetch
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
        const response = await fetch(rssUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: 無法讀取頻道 RSS`);
        }
        xmlText = await response.text();
      }

      if (!xmlText) throw new Error('頻道 RSS 內容為空');

      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const entries = Array.from(doc.querySelectorAll('entry'));
      
      return entries.map(entry => {
        const videoIdEl = entry.getElementsByTagName('yt:videoId')[0] || entry.getElementsByTagName('videoId')[0];
        const videoId = videoIdEl ? videoIdEl.textContent || '' : '';
        const titleEl = entry.getElementsByTagName('title')[0];
        const rawTitle = titleEl ? titleEl.textContent || '' : '';
        const publishedEl = entry.getElementsByTagName('published')[0];
        const published = publishedEl ? publishedEl.textContent || '' : '';
        const linkEl = entry.getElementsByTagName('link')[0];
        const url = linkEl?.getAttribute('href') || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
        
        return {
          videoId,
          title: convertCnToTw(rawTitle),
          published,
          publishedTime: published ? new Date(published).getTime() : 0,
          url
        };
      });
    } catch (e: any) {
      console.error(`獲取頻道 RSS 失敗 (${channelId}):`, e);
      throw e;
    }
  },

  async resolveYouTubeChannel(input: string): Promise<{ channelId: string; title?: string; thumbnail?: string }> {
    const raw = input.trim();
    if (!raw) throw new Error('請輸入頻道網址或 ID');

    // 1. Android 行動端：直接調用原生外掛（支援 HttpURLConnection 高速讀取與 youtubedl-android）
    if (!isTauri()) {
      try {
        const res = await YoutubeDlPlugin.resolveChannel({ input: raw });
        if (res && res.channelId) {
          return {
            channelId: res.channelId,
            title: res.title ? convertCnToTw(res.title) : undefined,
            thumbnail: res.thumbnail || undefined
          };
        }
      } catch (e: any) {
        throw new Error(e.message || String(e));
      }
    }

    // 2. Windows 桌面端
    // 若已經是 UC 開頭的 Channel ID
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(raw)) {
      return { channelId: raw };
    }

    // 若為 https://www.youtube.com/channel/UCxxxx
    const matchChannel = raw.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i);
    if (matchChannel && matchChannel[1]) {
      return { channelId: matchChannel[1] };
    }

    // 若為 Handle 網址 (如 https://www.youtube.com/@channelName) 或 @handle
    let targetUrl = raw;
    if (raw.startsWith('@')) {
      targetUrl = `https://www.youtube.com/${raw}`;
    } else if (!raw.startsWith('http')) {
      targetUrl = `https://www.youtube.com/@${raw}`;
    }

    // 桌面端透過 yt-dlp --flat-playlist -J 獲取精準 channel_id
    if (isTauri()) {
      try {
        const cmd = Command.sidecar('bin/yt-dlp', ['--flat-playlist', '-J', '--playlist-end', '1', targetUrl]);
        const out = await cmd.execute();
        if (out.code === 0 && out.stdout.trim()) {
          const data = JSON.parse(out.stdout.trim());
          const cid = data.channel_id || (data.uploader_id?.startsWith('UC') ? data.uploader_id : '') || '';
          const title = data.uploader || data.channel || data.title || '';
          if (cid.startsWith('UC')) {
            return {
              channelId: cid,
              title: title ? convertCnToTw(title) : undefined
            };
          }
        }
      } catch (e) {
        console.warn('yt-dlp resolve channelId fallback to fetch', e);
      }
    }

    // Fallback 嘗試讀取網頁內容擷取 channelId
    try {
      const resp = await fetch(targetUrl);
      if (resp.ok) {
        const text = await resp.text();
        const m1 = text.match(/"channelId":\s*"(UC[a-zA-Z0-9_-]{22})"/);
        if (m1 && m1[1]) return { channelId: m1[1] };
        const m2 = text.match(/<meta\s+itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{22})"/);
        if (m2 && m2[1]) return { channelId: m2[1] };
      }
    } catch (e) {
      console.warn('Fetch web page failed', e);
    }

    throw new Error('無法識別 YouTube 頻道 ID，請確認頻道網址或直接提供 channel/UC... 連結');
  }
};
