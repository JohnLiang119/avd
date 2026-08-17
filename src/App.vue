<template>
  <div class="app-container" :class="{ 'tv-mode': isTvMode }">
    <div class="content">

      <div v-if="serverStatus.isActive && !isTvMode" class="transfer-btn-wrapper" style="margin-bottom: 12px; display: flex; justify-content: center; flex-direction: column; align-items: center; gap: 8px;">
        <div class="server-status-card" style="width: 100%; max-width: 320px; background: white; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid #e5e7eb; display: flex; flex-direction: column; align-items: center; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
            <span style="display: inline-block; width: 8px; height: 8px; background-color: #10b981; border-radius: 50%;"></span>
            <span style="font-size: 13px; font-weight: bold; color: #374151;">伺服器運行中</span>
            <span style="font-size: 11px; color: #6b7280; margin-left: auto;">{{ serverStatus.ip }}</span>
          </div>
          
          <div style="text-align: center; margin: 8px 0; width: 100%;">
            <van-tabs v-if="wifiSsid" v-model:active="activeTab" type="card" color="#1989fa" style="margin-bottom: 8px;">
              <van-tab title="🔗 1. 連線 Wi-Fi">
                <div style="padding-top: 12px;">
                  <qrcode-vue :value="wifiQrCodeValue" :size="140" level="M" />
                  <p style="font-size: 11px; color: #666; margin-top: 8px;">掃描即可自動連上熱點</p>
                </div>
              </van-tab>
              <van-tab title="🌍 2. 開啟網頁">
                <div style="padding-top: 12px;">
                  <qrcode-vue v-if="serverStatus.ip" :value="serverStatus.ip" :size="140" level="M" />
                  <p style="font-size: 11px; color: #666; margin-top: 8px;">連上 Wi-Fi 後掃描開啟</p>
                </div>
              </van-tab>
            </van-tabs>

            <div v-else>
              <p style="font-size: 12px; color: #666; margin-bottom: 8px;">請確保 iPad 與本設備連線至同一個 Wi-Fi，然後使用相機掃描</p>
              <qrcode-vue v-if="serverStatus.ip" :value="serverStatus.ip" :size="160" level="M" />
            </div>

            <van-button size="mini" type="primary" plain @click="showWifiModal = true" style="margin-top: 8px;">
              ⚙️ {{ wifiSsid ? '修改 Wi-Fi QR Code 設定' : '設定 Wi-Fi 自動連線 QR Code' }}
            </van-button>
          </div>

          <div style="font-size: 12px; color: #4b5563; display: flex; flex-direction: column; width: 100%; padding-top: 8px; border-top: 1px solid #f3f4f6;">
            <div style="display: flex; justify-content: space-between;">
              <span>目前傳輸給設備總速度:</span>
              <span style="font-family: monospace; font-weight: bold; color: #2563eb;">{{ formattedUploadSpeed }}</span>
            </div>
            
            <div v-if="Object.keys(serverStatus.devices).length > 0" style="margin-top: 4px; border-top: 1px dashed #e5e7eb; padding-top: 4px;">
              <div v-for="(speed, ip) in serverStatus.devices" :key="ip" style="display: flex; justify-content: space-between; margin-left: 8px; margin-top: 2px;">
                <span style="color: #6b7280;">📱 {{ ip }}</span>
                <span style="font-family: monospace; font-weight: bold; color: #10b981;">{{ formatSpeedBps(speed) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <van-form @submit="onSubmit" class="download-form" v-show="!isTvMode">
        <div v-if="isTauri()" style="display: flex; align-items: center; gap: 8px; margin: 0 16px;">
          <van-cell-group inset style="flex: 1; margin: 0;">
            <van-field
              v-model="url"
              name="url"
              placeholder="請輸入 YouTube 影片網址"
              :rules="[]"
              clearable
            />
          </van-cell-group>
          
          <van-button 
            size="small" 
            plain
            round
            type="primary"
            icon="folder-o"
            @click="openDownloadFolder"
            style="padding: 0 10px; flex-shrink: 0;"
          >
            開啟資料夾
          </van-button>
          <van-button 
            size="small" 
            plain
            round
            :type="driveToken ? 'success' : 'primary'" 
            icon="share-o" 
            @click="showTokenModal = true"
            style="padding: 0 10px; flex-shrink: 0;"
          >
            {{ driveToken ? 'Drive 已連結' : '連結 Drive' }}
          </van-button>
          <van-button 
            size="small"
            round 
            type="primary" 
            native-type="submit"
            icon="down"
            style="padding: 0; width: 32px; height: 32px; flex-shrink: 0;"
          />
        </div>
      </van-form>

      <div class="control-panel-wrapper" style="padding: 0 10px 10px; margin-bottom: 10px; border-bottom: 1px solid #eee;" v-show="!isTvMode">
        <!-- 第一排：重整、清除、刪除、設定 (4 顆按鈕) -->
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 8px;">
          <van-button 
            size="small" 
            round 
            type="default"
            icon="replay" 
            @click="batchRetryDownloads" 
            class="top-ctrl-btn"
            title="批次重新下載失敗/中止的任務"
          >重整</van-button>
          <van-button 
            size="small" 
            round 
            type="default" 
            icon="delete-o" 
            @click="clearCompleted" 
            class="top-ctrl-btn"
            title="清除已完成紀錄"
          >清除</van-button>
          <van-button 
            size="small" 
            round 
            type="default" 
            icon="delete" 
            @click="deleteAllFiles" 
            class="top-ctrl-btn"
            title="刪除全部實體檔案"
          >刪除</van-button>
          <van-button 
            size="small" 
            round 
            type="default" 
            icon="setting-o" 
            @click="showSettingsModal = true" 
            class="top-ctrl-btn"
            title="偏好設定"
          >設定</van-button>
        </div>

        <!-- 第二排：音訊、頻道、快傳、收合 (4 顆按鈕，與第一排垂直精確對齊) -->
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <van-button 
            size="small" 
            round 
            type="default"
            :class="['top-ctrl-btn', { 'btn-active': mp3Mode }]"
            :icon="mp3Mode ? 'music' : 'music-o'" 
            @click="mp3Mode = !mp3Mode" 
            :title="mp3Mode ? '目前為 MP3 音訊下載模式 (點擊切換為影片)' : '目前為 影片下載模式 (點擊切換為 MP3)'"
          >音訊</van-button>
          
          <van-button 
            size="small" 
            round 
            type="default"
            class="top-ctrl-btn"
            icon="bullhorn-o" 
            @click="showChannelModal = true" 
            :title="`YouTube 頻道自動追蹤 (${monitoredChannels.length} 個頻道)`"
          >頻道</van-button>

          <van-button 
            size="small" 
            round 
            type="default"
            :class="['top-ctrl-btn', { 'btn-active': serverStatus.isActive }]"
            :icon="serverStatus.isActive ? 'stop-circle-o' : 'scan'" 
            @click="toggleLocalServer" 
            title="開啟/關閉 快傳伺服器"
          >快傳</van-button>

          <van-button 
            size="small" 
            round 
            type="default"
            :icon="isAllExpanded ? 'arrow-up' : 'arrow-down'" 
            @click="toggleExpandAll" 
            class="top-ctrl-btn"
            :title="isAllExpanded ? '全部收合' : '全部展開'"
          >{{ isAllExpanded ? '收合' : '展開' }}</van-button>
        </div>
      </div>

      <!-- TV 模式專屬大字體接收端畫面 (未推播時) -->
      <div v-if="isTvMode && remoteTasks.length === 0" class="tv-receiver-screen" style="display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 60vh; padding: 20px; text-align: center;">
        <h1 style="font-size: 28px; color: #1e40af; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          📺 TV 接收模式運作中
        </h1>
        <p style="font-size: 16px; color: #4b5563; margin-bottom: 32px;">請在電腦版 AVD 點擊影片下方的「推播至 TV」並輸入以下 IP</p>
        
        <div v-if="serverStatus.isActive" style="background: white; padding: 24px 36px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 2px solid #3b82f6;">
          <div style="font-size: 32px; font-weight: bold; font-family: monospace; color: #10b981; letter-spacing: 2px;">
            {{ serverStatus.ip.replace('http://', '').replace(':8080', '') }}
          </div>
          <div style="font-size: 14px; color: #9ca3af; margin-top: 8px;">Port: 8080</div>
        </div>
        <div v-else style="color: #ee0a24; font-size: 18px; display: flex; align-items: center; gap: 8px;">
          伺服器啟動中...
        </div>

        <van-button size="normal" type="primary" round style="margin-top: 40px;" @click="fetchRemoteTasks">重新讀取本機推播清單</van-button>
      </div>

      <div class="task-list" v-if="isTvMode && remoteTasks.length > 0">
        <!-- TV 模式已連線狀態標頭 -->
        <div style="padding: 16px; background: #ecfdf5; border-radius: 12px; margin-bottom: 16px; border: 1px solid #34d399; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.1);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <van-icon name="checked" color="#059669" size="24px" />
            <div style="color: #065f46; font-size: 16px; font-weight: bold; display: flex; flex-direction: column;">
              <span>已接收電腦端清單 (共 {{ remoteTasks.length }} 個頻道)</span>
              <span v-if="serverStatus.isActive" style="font-size: 12px; font-weight: normal; opacity: 0.8; margin-top: 2px;">
                本機接收端 IP: {{ serverStatus.ip.replace('http://', '').replace(':8080', '') }}
              </span>
            </div>
          </div>
          <van-button size="small" type="success" plain round icon="replay" @click="fetchRemoteTasks" style="border-width: 2px;">
            手動更新
          </van-button>
        </div>
        <div v-for="task in remoteTasks.slice().reverse()" :key="task.id">
          <!-- 一級 Menu 卡片 (Remote ChannelGroupTask 頻道) -->
          <div v-if="task.type === 'channel'" class="task-card status-channel" style="border-left: 4px solid #3b82f6; background: #eff6ff;">
            <div class="task-header" style="cursor: pointer;" @click="task.expanded = !task.expanded">
              <div class="task-title-group">
                <div class="task-title" style="font-weight: bold; color: #1e40af; display: flex; align-items: center; gap: 6px; font-size: 15px;">
                  <span>📺 {{ task.channelTitle }}</span>
                </div>
              </div>
              <div style="display: flex; gap: 4px; align-items: center;">
                <van-button size="mini" plain round type="primary" @click.stop="task.expanded = !task.expanded" style="padding: 0 8px;">
                  {{ task.expanded ? '▲' : '▼' }}
                </van-button>
              </div>
            </div>

            <!-- 二級 Menu 播放清單列表 (Remote) -->
            <div v-if="task.expanded" class="playlists-container" style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px; padding-left: 8px; border-left: 2px dashed #93c5fd;">
              <div v-for="playlist in task.playlists" :key="playlist.id" class="playlist-card" style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 10px;">
                <div class="playlist-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" @click="playlist.expanded = !playlist.expanded">
                  <div style="font-weight: 600; color: #6b21a8; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                    <span>📂 {{ playlist.playlistTitle }}</span>
                  </div>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <van-button size="mini" plain round type="primary" style="color: #8b5cf6; border-color: #c084fc; padding: 0 8px;" @click.stop="playlist.expanded = !playlist.expanded">
                      {{ playlist.expanded ? '▲' : '▼' }}
                    </van-button>
                  </div>
                </div>

                <!-- 三級 Menu 影片項目列表 (Remote) -->
                <div v-if="playlist.expanded" class="subtasks-container" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px; padding-left: 8px; border-left: 2px dashed #d8b4fe;">
                  <div v-for="subTask in playlist.subTasks" :key="subTask.id" class="task-card status-success" style="padding: 8px; border: 1px solid #86efac; background: white;">
                    <div class="task-header" style="margin-bottom: 0;">
                      <div class="task-title-group" style="width: 100%;">
                        <div class="task-title" style="font-size: 13px; color: #15803d; line-height: 1.4;">{{ subTask.title }}</div>
                      </div>
                    </div>
                    <div style="margin-top: 4px; padding: 4px 6px; background: #f0f0f0; border-radius: 4px; word-break: break-all; font-size: 10px; color: #666; font-family: monospace;">
                      🔗 {{ subTask.mediaUri || '(無 mediaUri)' }}
                    </div>
                    <div class="task-footer success-action" style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
                      <div style="display: flex; gap: 4px; align-items: center;">
                        <span v-if="subTask.quality" class="quality-badge" :class="'quality-' + subTask.quality.split(' ')[0]">{{ subTask.quality }}</span>
                      </div>
                      <div style="display: flex; gap: 4px;">
                        <van-button size="small" round type="success" plain icon="play-circle-o" @click="playVideo(subTask)" style="padding: 0; width: 32px; height: 32px;" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- TV 模式：單一影片卡片 (Remote Single Task) -->
          <div v-else-if="task.type !== 'channel' && task.status === 'success'" class="task-card status-success" style="padding: 10px; border: 1px solid #86efac; background: white;">
            <div class="task-header" style="margin-bottom: 0;">
              <div class="task-title-group" style="width: 100%;">
                <div class="task-title" style="font-size: 14px; color: #15803d; line-height: 1.4;">🎬 {{ task.title }}</div>
              </div>
            </div>
            <div style="margin-top: 4px; padding: 4px 6px; background: #f0f0f0; border-radius: 4px; word-break: break-all; font-size: 10px; color: #666; font-family: monospace;">
              🔗 {{ task.mediaUri || '(無 mediaUri)' }}
            </div>
            <div class="task-footer success-action" style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; gap: 4px; align-items: center;">
                <span v-if="task.quality" class="quality-badge" :class="'quality-' + task.quality.split(' ')[0]">{{ task.quality }}</span>
              </div>
              <div style="display: flex; gap: 4px;">
                <van-button size="small" round type="success" plain icon="play-circle-o" @click="playVideo(task)" style="padding: 0; width: 32px; height: 32px;" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="task-list" v-show="!isTvMode">
        <div v-for="task in tasks.slice().reverse()" :key="task.id">
          <!-- 一級 Menu 卡片 (ChannelGroupTask 頻道) -->
          <div v-if="task.type === 'channel'" class="task-card status-channel" style="border-left: 4px solid #3b82f6; background: #eff6ff;">
            <div class="task-header" style="cursor: pointer;" @click="task.expanded = !task.expanded">
              <div class="task-title-group">
                <div class="task-title" style="font-weight: bold; color: #1e40af; display: flex; align-items: center; gap: 6px; font-size: 15px;">
                  <span>📺 {{ task.channelTitle }}</span>
                  <van-tag type="primary" plain style="font-size: 10px;">{{ getChannelCompletedCount(task) }}</van-tag>
                </div>
              </div>
              <div style="display: flex; gap: 4px; align-items: center;">
                <van-button size="mini" plain round type="primary" @click.stop="task.expanded = !task.expanded" style="padding: 0 8px;">
                  {{ task.expanded ? '▲' : '▼' }}
                </van-button>
                <van-button size="mini" round type="default" icon="delete-o" title="清理卡片紀錄" @click.stop="removeChannelGroup(task.id)" style="padding: 0; width: 22px; height: 22px;" />
                <van-button size="mini" round type="danger" plain icon="delete-o" title="徹底刪除實體檔案" @click.stop="deleteChannelFiles(task)" style="padding: 0; width: 22px; height: 22px;" />
              </div>
            </div>

            <!-- 二級 Menu 播放清單列表 -->
            <div v-if="task.expanded" class="playlists-container" style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px; padding-left: 8px; border-left: 2px dashed #93c5fd;">
              <div v-for="playlist in task.playlists" :key="playlist.id" class="playlist-card" style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 10px;">
                <div class="playlist-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" @click="playlist.expanded = !playlist.expanded">
                  <div style="font-weight: 600; color: #6b21a8; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                    <span>📂 {{ playlist.playlistTitle }}</span>
                    <van-tag type="primary" plain style="font-size: 10px; border-color: #c084fc; color: #8b5cf6;">{{ getPlaylistCompletedCount(playlist) }}</van-tag>
                  </div>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <van-button size="mini" plain round type="primary" style="color: #8b5cf6; border-color: #c084fc; padding: 0 8px;" @click.stop="playlist.expanded = !playlist.expanded">
                      {{ playlist.expanded ? '▲' : '▼' }}
                    </van-button>
                    <van-button size="mini" round type="default" icon="delete-o" title="清理卡片紀錄" @click.stop="removePlaylistGroup(task, playlist.id)" style="padding: 0; width: 20px; height: 20px;" />
                    <van-button size="mini" round type="danger" plain icon="delete-o" title="徹底刪除實體檔案" @click.stop="deletePlaylistFiles(task, playlist)" style="padding: 0; width: 20px; height: 20px;" />
                  </div>
                </div>

                <div v-if="!isPlaylistCompleted(playlist)" class="progress-wrapper" style="margin-top: 8px;">
                  <div class="progress-info" style="font-size: 11px;">
                    <span>播放清單整體進度: {{ getPlaylistProgress(playlist) }}%</span>
                  </div>
                  <van-progress :percentage="getPlaylistProgress(playlist)" color="#8b5cf6" stroke-width="6" />
                </div>

                <!-- 三級 Menu 檔案列表 -->
                <div v-if="playlist.expanded" class="sub-tasks-container" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px; padding-left: 8px; border-left: 2px dashed #d8b4fe;">
                  <div v-for="subTask in playlist.subTasks" :key="subTask.id" class="sub-task-item" style="background: white; padding: 8px 10px; border-radius: 6px; border: 1px solid #f3e8ff;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                      <div style="font-size: 12px; font-weight: 600; color: #374151; word-break: break-all;">
                        🎬 {{ subTask.title || subTask.url }}
                      </div>
                      <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                        <van-tag v-if="subTask.status === 'pending' || subTask.status === 'downloading'" :type="getStatusType(subTask.status)">{{ getStatusText(subTask.status) }}</van-tag>
                        <van-button
                          v-if="subTask.status === 'downloading'"
                          size="mini"
                          type="danger"
                          plain
                          @click="cancelTask(subTask.id)"
                          style="margin-left: 4px; padding: 0 6px; height: 20px; font-size: 11px;"
                        >中止</van-button>
                        <van-button v-if="subTask.status === 'pending' || subTask.status === 'error'" size="mini" round type="default" icon="delete-o" title="清除卡片紀錄" @click="removeSubTask(playlist, subTask.id)" style="padding: 0; width: 18px; height: 18px;" />
                      </div>
                    </div>

                    <div v-if="(subTask.status === 'downloading' || subTask.progress > 0) && subTask.status !== 'success'" class="progress-wrapper" style="margin-top: 6px;">
                      <div class="progress-info" style="font-size: 11px;">
                        <span>{{ subTask.progress }}%</span>
                        <span v-if="subTask.speed" style="color: #2563eb; font-weight: bold; font-family: monospace;">{{ subTask.speed }}</span>
                      </div>
                      <van-progress :percentage="subTask.progress" :color="subTask.status === 'error' ? '#ee0a24' : '#1989fa'" stroke-width="6" />
                    </div>

                    <div v-if="subTask.uploadStatus && subTask.uploadStatus !== 'idle'" class="progress-wrapper upload-wrapper" style="margin-top: 6px;">
                      <div class="progress-info" style="font-size: 11px;">
                        <span>☁ 雲端備份: {{ subTask.uploadProgress || 0 }}%</span>
                        <span v-if="subTask.uploadStatus === 'uploading'">上傳中...</span>
                        <span v-if="subTask.uploadStatus === 'success'" style="color: #07c160;">✓ 備份成功</span>
                        <span v-if="subTask.uploadStatus === 'error'" style="color: #ee0a24;">✕ 備份失敗</span>
                      </div>
                      <van-progress :percentage="subTask.uploadProgress || 0" :color="subTask.uploadStatus === 'error' ? '#ee0a24' : '#07c160'" stroke-width="6" />
                      <div v-if="subTask.uploadErrorMsg" class="action-log" style="color: #ee0a24; font-size: 11px;">
                        <code>{{ subTask.uploadErrorMsg }}</code>
                      </div>
                    </div>

                    <div class="action-log" v-if="subTask.line && subTask.status !== 'success'" style="margin-top: 4px;">
                      <code>{{ subTask.line }}</code>
                    </div>

                    <div class="task-footer success-action" v-if="subTask.status === 'success'" style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
                      <div style="display: flex; gap: 4px; align-items: center;">
                        <span v-if="subTask.quality" class="quality-badge" :class="'quality-' + subTask.quality.split(' ')[0]">{{ subTask.quality }}</span>
                        <span v-if="subTask.fileSizeBytes" style="font-size: 11px; color: #888; font-weight: 500; white-space: nowrap;">{{ formatBytes(subTask.fileSizeBytes) }}</span>
                      </div>
                      <div style="display: flex; gap: 4px;">
                        <van-button size="small" round type="success" plain icon="play-circle-o" @click="playVideo(subTask)" style="padding: 0; width: 24px; height: 24px;" />
                        <van-button size="small" round type="primary" plain icon="share-o" @click="uploadToDrive(subTask)" style="padding: 0; width: 24px; height: 24px;" />
                        <van-button size="small" round type="default" icon="delete-o" title="清除卡片紀錄" @click="removeSubTask(playlist, subTask.id)" style="padding: 0; width: 24px; height: 24px;" />
                        <van-button size="small" round type="danger" plain icon="delete-o" title="徹底刪除實體檔案" @click="deleteDownloadedFile(subTask)" style="padding: 0; width: 24px; height: 24px;" />
                      </div>
                    </div>

                    <div class="task-footer error-action" v-if="subTask.status === 'error'" style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
                      <van-tag type="danger" style="font-size: 10px;">失敗</van-tag>
                      <van-button size="mini" type="danger" plain @click="retryTask(subTask.id)">重試下載</van-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 單一任務卡片 -->
          <div v-else class="task-card" :class="'status-' + task.status">
            <div class="task-header">
              <div class="task-title-group">
                <div v-if="task.title" class="task-title">
                  {{ task.title }}
                </div>
                <span v-if="task.status !== 'success'" class="task-url">{{ task.url }}</span>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0;">
                <div class="task-header-actions">
                  <van-tag v-if="task.status === 'pending' || task.status === 'downloading'" :type="getStatusType(task.status)">{{ getStatusText(task.status) }}</van-tag>
                  <van-button
                    v-if="task.status === 'downloading'"
                    size="mini"
                    type="danger"
                    plain
                    @click="cancelTask(task.id)"
                    style="margin-left: 4px; padding: 0 6px; height: 20px; font-size: 11px;"
                  >中止</van-button>
                  <van-button
                    v-if="task.status === 'pending' || task.status === 'error'"
                    size="mini"
                    round
                    type="default"
                    icon="delete-o"
                    title="清除卡片紀錄"
                    @click="removeTask(task.id)"
                    style="padding: 0; width: 20px; height: 20px; margin-left: 4px;"
                  />
                </div>
              </div>
            </div>
            
            <div v-if="(task.status === 'downloading' || task.progress > 0) && task.status !== 'success'" class="progress-wrapper">
              <div class="progress-info">
                <span>{{ task.progress }}%</span>
                <div style="display: flex; gap: 8px;">
                  <span v-if="task.speed" style="color: #2563eb; font-weight: bold; font-family: monospace;">{{ task.speed }}</span>
                  <span v-if="task.eta && task.status === 'downloading'">剩餘 {{ task.eta }} 秒</span>
                </div>
              </div>
              <van-progress :percentage="task.progress" :color="task.status === 'error' ? '#ee0a24' : '#1989fa'" stroke-width="8" />
            </div>

            <div v-if="task.uploadStatus && task.uploadStatus !== 'idle'" class="progress-wrapper upload-wrapper">
              <div class="progress-info">
                <span>☁ 雲端備份: {{ task.uploadProgress || 0 }}%</span>
                <span v-if="task.uploadStatus === 'uploading'">上傳中...</span>
                <span v-if="task.uploadStatus === 'success'" style="color: #07c160;">✓ 備份成功</span>
                <span v-if="task.uploadStatus === 'error'" style="color: #ee0a24;">✕ 備份失敗</span>
              </div>
              <van-progress :percentage="task.uploadProgress || 0" :color="task.uploadStatus === 'error' ? '#ee0a24' : '#07c160'" stroke-width="6" />
              <div v-if="task.uploadErrorMsg" class="action-log" style="color: #ee0a24;">
                <code>{{ task.uploadErrorMsg }}</code>
              </div>
            </div>

            <div class="action-log" v-if="task.line && task.status !== 'success'">
              <code>{{ task.line }}</code>
            </div>
            
            <div class="task-footer success-action" v-if="task.status === 'success'" style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; gap: 4px; align-items: center;">
                <span v-if="task.quality" class="quality-badge" :class="'quality-' + task.quality.split(' ')[0]">{{ task.quality }}</span>
                <span v-if="task.fileSizeBytes" style="font-size: 11px; color: #888; font-weight: 500; white-space: nowrap;">{{ formatBytes(task.fileSizeBytes) }}</span>
              </div>
              <div class="footer-buttons" style="display: flex; gap: 6px;">
                <van-button size="small" round type="success" plain icon="play-circle-o" @click="playVideo(task)" style="padding: 0; width: 28px; height: 28px;" />
                <van-button size="small" round type="primary" plain icon="share-o" @click="uploadToDrive(task)" style="padding: 0; width: 28px; height: 28px;" />
                <van-button size="small" round type="default" icon="delete-o" title="清除卡片紀錄" @click="removeTask(task.id)" style="padding: 0; width: 28px; height: 28px;" />
                <van-button size="small" round type="danger" plain icon="delete-o" title="徹底刪除實體檔案" @click="deleteDownloadedFile(task)" style="padding: 0; width: 28px; height: 28px;" />
              </div>
            </div>
            <div class="task-footer error-action" v-if="task.status === 'error'" style="display: flex; justify-content: space-between; align-items: center;">
              <van-tag type="danger">失敗</van-tag>
              <van-button size="small" type="danger" plain @click="retryTask(task.id)">重試下載</van-button>
            </div>
          </div>
        </div>
      </div>

      <div class="version-text" v-show="false">
        v{{ version }}
      </div>
    </div>

    <van-dialog v-model:show="showTokenModal" :title="isTauri() ? '⚙️ Rclone 雲端同步設定' : '🔑 啟用 0%~100% 實時進度模式'" show-cancel-button confirm-button-text="儲存並啟用" @confirm="saveDriveToken">
      <div style="padding: 16px;">
        <template v-if="isTauri()">
          <p style="font-size: 13px; color: #323233; margin-bottom: 10px; line-height: 1.5;">
            💡 <b>提示</b>：Windows 版使用 Rclone 進行永久同步，無需處理 Token 過期問題。
          </p>
          <van-field v-model="driveTokenInput" placeholder="例如: yiichungGDGD:avd" clearable label="Rclone 路徑" label-width="85px" />
        </template>
        <template v-else>
          <p style="font-size: 12px; color: #323233; margin-bottom: 10px; line-height: 1.5;">
            💡 <b>提示</b>：若未設定 Token，點擊「雲端備份」會<b>直接呼叫 Google Drive App 上傳</b>（無需任何設定）。
          </p>
          <van-button block type="primary" icon="search" size="small" style="margin-bottom: 10px;" @click="openOAuthPage">
            點此開啟 Google 官方授權取得網頁
          </van-button>
          <p style="font-size: 11px; color: #969799; margin-bottom: 8px; line-height: 1.4;">
            (點擊授權 -> 登入 Google 帳號 -> 點擊 Exchange 即可複製 Access Token 貼在下方)
          </p>
          <van-field v-model="driveTokenInput" placeholder="請貼上 Access Token (ya29...)" clearable label="Token" />
        </template>
      </div>
    </van-dialog>

    <van-dialog v-model:show="showCastListModal" title="推播清單至 TV" show-cancel-button confirm-button-text="推播" cancel-button-text="取消" @confirm="pushListToTv">
      <div style="padding: 16px;">
        <van-field v-model="targetTvIp" label="TV IP" placeholder="例如: 10.10.11.200" required />
        <div style="font-size: 12px; color: #6b7280; margin-top: 8px; text-align: center;">
          請查看 TV 畫面上顯示的 IP 位址。
        </div>
      </div>
    </van-dialog>

    <van-dialog v-model:show="showWifiModal" title="⚙️ Wi-Fi 熱點設定" show-cancel-button confirm-button-text="儲存" @confirm="saveWifiConfig">
      <div style="padding: 16px;">
        <p style="font-size: 12px; color: #666; margin-bottom: 16px; line-height: 1.5;">
          請輸入您的手機「無線基地台」名稱與密碼。這只會儲存在本機，用來產生 QR Code 讓其他設備能一鍵掃描連線。
        </p>
        <van-cell-group inset style="margin: 0; box-shadow: 0 1px 4px rgba(0,0,0,0.05); border: 1px solid #ebedf0;">
          <van-field v-model="wifiSsid" label="熱點名稱" placeholder="例如: My_Hotspot" required />
          <van-field v-model="wifiPassword" label="密碼" placeholder="熱點連線密碼" type="password" />
        </van-cell-group>
      </div>
    </van-dialog>

    <van-dialog v-model:show="showSettingsModal" title="⚙️ 偏好設定" confirm-button-text="關閉">
      <div style="padding: 16px;">
        <p style="font-size: 13px; color: #4b5563; margin-bottom: 12px; font-weight: bold;">
          操作前顯示確認視窗 (防呆機制)
        </p>
        <van-cell-group inset style="margin: 0; border: 1px solid #ebedf0;">
          <van-cell title="全部刪除檔案" center>
            <template #icon>
              <van-button size="mini" round type="danger" plain icon="delete-o" style="margin-right: 8px; pointer-events: none; width: 22px; height: 22px; padding: 0;" />
            </template>
            <template #right-icon>
              <van-switch v-model="confirmDeleteAll" size="20px" />
            </template>
          </van-cell>
          <van-cell title="單一刪除檔案" center>
            <template #icon>
              <van-button size="mini" round type="danger" plain icon="delete-o" style="margin-right: 8px; pointer-events: none; width: 22px; height: 22px; padding: 0;" />
            </template>
            <template #right-icon>
              <van-switch v-model="confirmDeleteSingle" size="20px" />
            </template>
          </van-cell>
          <van-cell title="全部清除列表" center>
            <template #icon>
              <van-button size="mini" round type="default" icon="delete-o" style="margin-right: 8px; pointer-events: none; width: 22px; height: 22px; padding: 0;" />
            </template>
            <template #right-icon>
              <van-switch v-model="confirmClearAll" size="20px" />
            </template>
          </van-cell>
          <van-cell title="單一清除列表" center>
            <template #icon>
              <van-button size="mini" round type="default" icon="delete-o" style="margin-right: 8px; pointer-events: none; width: 22px; height: 22px; padding: 0;" />
            </template>
            <template #right-icon>
              <van-switch v-model="confirmClearSingle" size="20px" />
            </template>
          </van-cell>
        </van-cell-group>

        <p style="font-size: 13px; color: #4b5563; margin-top: 16px; margin-bottom: 12px; font-weight: bold;">
          系統版本與更新
        </p>
        <van-cell-group inset style="margin: 0; border: 1px solid #ebedf0;">
          <van-cell title="目前版本" :value="`v${version}`" />
          <van-cell title="檢查新版本" is-link @click="handleManualCheckUpdate" />
          <van-cell title="接收測試版更新" center label="開發與測試用途 (Pre-release)">
            <template #right-icon>
              <van-switch v-model="testModeEnabled" size="20px" />
            </template>
          </van-cell>
        </van-cell-group>
      </div>
    </van-dialog>

    <!-- 🚀 應用程式更新彈窗 -->
    <van-dialog
      v-model:show="showUpdateModal"
      :title="`🚀 發現新版本 v${updateInfo.latestVersion}`"
      :show-confirm-button="!isUpdating"
      :show-cancel-button="!isUpdating"
      :confirm-button-text="updateFailed ? '重試下載' : '立即更新'"
      cancel-button-text="稍後再說"
      :close-on-click-overlay="false"
      :before-close="handleBeforeCloseUpdateModal"
    >
      <div style="padding: 16px; max-height: 380px; overflow-y: auto;">
        <div style="font-size: 13px; color: #4b5563; margin-bottom: 8px; display: flex; justify-content: space-between;">
          <span>目前版本: <b>v{{ version }}</b></span>
          <span style="color: #10b981; font-weight: bold;">最新: v{{ updateInfo.latestVersion }}</span>
        </div>

        <div v-if="!isUpdating && !updateFailed" style="background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid #e5e7eb;">
          <div style="font-size: 12px; font-weight: bold; color: #374151; margin-bottom: 4px;">📝 更新說明:</div>
          <div style="font-size: 12px; color: #4b5563; white-space: pre-wrap; line-height: 1.5;">{{ updateInfo.releaseNotes }}</div>
        </div>

        <!-- 下載進度條 -->
        <div v-if="isUpdating" style="padding: 16px 0; text-align: center;">
          <div style="font-size: 14px; color: #1f2937; margin-bottom: 12px; font-weight: 600;">
            {{ updateStatusText || `正在下載更新檔 (${updateProgress.percent}%)...` }}
          </div>
          <van-progress :percentage="updateProgress.percent" stroke-width="10" color="#10b981" />
          <div v-if="updateProgress.totalBytes > 0" style="font-size: 12px; color: #6b7280; text-align: right; margin-top: 8px;">
            {{ formatBytes(updateProgress.downloadedBytes) }} / {{ formatBytes(updateProgress.totalBytes) }}
          </div>
          <div v-if="updateProgress.percent >= 100" style="font-size: 12px; color: #10b981; margin-top: 10px; font-weight: 500;">
            ⚡ 下載完成，正在啟動安裝程序...
          </div>
        </div>

        <!-- 錯誤狀態 -->
        <div v-if="updateFailed" style="padding: 12px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca; margin-top: 8px;">
          <div style="font-size: 12px; color: #b91c1c; font-weight: 500;">⚠️ 下載失敗: {{ updateErrorMsg }}</div>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <van-button size="small" type="primary" block @click="startDownloadAndInstall">
              重試下載
            </van-button>
            <van-button size="small" type="default" block @click="openBrowserRelease">
              瀏覽器下載
            </van-button>
          </div>
        </div>
      </div>
    </van-dialog>

    <!-- 頻道自動追蹤管理彈窗 -->
    <van-dialog v-model:show="showChannelModal" title="📡 頻道自動追蹤排程" confirm-button-text="關閉" :show-cancel-button="false">
      <div style="padding: 16px; max-height: 70vh; overflow-y: auto;">
        <!-- 頂部控制面板 -->
        <div style="background: #f8fafc; border-radius: 12px; padding: 12px; border: 1px solid #e2e8f0; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 13px; font-weight: 600; color: #1e293b;">每小時自動檢查新片</span>
            <van-switch v-model="monitorConfig.autoCheckEnabled" size="20px" />
          </div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 10px;">
            上次檢查: {{ monitorConfig.lastGlobalCheckTime ? new Date(monitorConfig.lastGlobalCheckTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '尚未檢查' }}
          </div>
          <div style="display: flex; gap: 8px;">
            <van-button size="small" type="primary" plain block icon="replay" :loading="isCheckingChannels" @click="checkAllMonitoredChannels(true)">
              立即檢查
            </van-button>
            <van-button size="small" type="warning" plain block icon="play-circle-o" @click="simulateGlobalNewVideo">
              🧪 模擬測試
            </van-button>
          </div>
        </div>

        <!-- 頻道備份與還原面板 -->
        <div style="background: #f8fafc; border-radius: 12px; padding: 12px; border: 1px solid #e2e8f0; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 600; color: #1e293b; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span>💾 頻道備份與回復</span>
            <span style="font-size: 10px; color: #94a3b8; font-weight: normal;">(本地 / 雲端雙軌)</span>
          </div>

          <!-- 第一排：本地匯出與匯入 -->
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <van-button size="small" type="default" plain block icon="down" @click="exportChannelsJson" style="font-size: 11px; height: 32px; border-radius: 6px;">
              📁 匯出本地備份
            </van-button>
            <van-button size="small" type="default" plain block icon="upgrade" @click="triggerImportChannels" style="font-size: 11px; height: 32px; border-radius: 6px;">
              📥 匯入本地檔案
            </van-button>
          </div>

          <!-- 第二排：雲端備份與還原 -->
          <div style="display: flex; gap: 8px;">
            <van-button size="small" type="primary" plain block icon="cloud-upload" :loading="isCloudBackingUp" @click="backupChannelsToCloud" style="font-size: 11px; height: 32px; border-radius: 6px;">
              ☁️ 備份至雲端
            </van-button>
            <van-button size="small" type="primary" plain block icon="revoke" :loading="isCloudRestoring" @click="restoreChannelsFromCloud" style="font-size: 11px; height: 32px; border-radius: 6px;">
              🔄 從雲端還原
            </van-button>
          </div>

          <!-- 隱藏的本地 JSON 檔案選取 input -->
          <input ref="channelFileInputRef" type="file" accept=".json" style="display: none;" @change="handleChannelFileChange" />
        </div>

        <!-- 手動加入頻道輸入框 -->
        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <van-field
            v-model="manualChannelInput"
            placeholder="貼上 YouTube 頻道網址或 @handle"
            clearable
            style="background: #f1f5f9; border-radius: 8px; font-size: 12px; padding: 8px 12px;"
          />
          <van-button size="small" type="primary" :loading="isAddingManualChannel" @click="addManualChannel" style="flex-shrink: 0; height: 36px; border-radius: 8px;">
            加入
          </van-button>
        </div>

        <!-- 已追蹤頻道清單 -->
        <div style="font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 8px; display: flex; justify-content: space-between;">
          <span>已追蹤頻道 ({{ monitoredChannels.length }})</span>
          <span v-if="monitoredChannels.length > 0" style="color: #ef4444; cursor: pointer;" @click="clearAllChannels">清空</span>
        </div>

        <div v-if="monitoredChannels.length === 0" style="text-align: center; color: #94a3b8; padding: 24px 0; font-size: 12px;">
          尚未新增追蹤頻道。<br>請在上方輸入框貼上 YouTube 頻道網址或 @handle 加入追蹤。
        </div>

        <div v-else style="display: flex; flex-direction: column; gap: 8px;">
          <div
            v-for="channel in monitoredChannels"
            :key="channel.channelId"
            style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);"
          >
            <!-- 第一行：頭像 + 頻道名稱 + Switch開關 + 刪除按鈕 -->
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1; margin-right: 8px;">
                <img
                  :src="channel.thumbnail || 'https://www.youtube.com/s/desktop/9d31bfd1/img/favicon_144x144.png'"
                  style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background: #e2e8f0; flex-shrink: 0;"
                  @error="($event.target as HTMLImageElement).src='https://www.youtube.com/s/desktop/9d31bfd1/img/favicon_144x144.png'"
                />
                <div style="font-size: 13px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  {{ channel.title }}
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <van-switch v-model="channel.enabled" size="18px" />
                <van-button size="mini" type="danger" plain icon="cross" round @click="removeMonitoredChannel(channel.channelId)" style="padding: 0; width: 22px; height: 22px;" />
              </div>
            </div>

            <!-- 第二行：最新影片標題 + 測試按鈕 -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #f8fafc; padding: 4px 8px; border-radius: 6px; border: 1px solid #f1f5f9;">
              <div style="font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">
                {{ channel.lastVideoTitle ? '最新: ' + channel.lastVideoTitle : '等待新片比對中...' }}
              </div>
              <van-button 
                size="mini" 
                type="warning" 
                plain 
                round 
                icon="play-circle-o" 
                title="模擬此頻道發布新片（插隊下載最新一部影片）" 
                @click="simulateNewVideo(channel)"
                style="padding: 0 8px; height: 20px; font-size: 10px; flex-shrink: 0;"
              >
                測試
              </van-button>
            </div>
          </div>
        </div>
      </div>
    </van-dialog>

    <YouTubeBatchModal
      v-model:show="showPlaylistModal"
      :channel-title="parsedChannelTitle"
      :playlist-title="parsedPlaylistTitle"
      :items="parsedPlaylistItems"
      @confirm="onBatchModalConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, onMounted, computed } from 'vue';
import { showToast, showLoadingToast, closeToast, showDialog, showConfirmDialog } from 'vant';
import QrcodeVue from 'qrcode.vue';
import YouTubeBatchModal from './components/YouTubeBatchModal.vue';
import pkg from '../package.json';

const version = pkg.version;

import { App } from '@capacitor/app';
import { open as openShell } from '@tauri-apps/plugin-shell';
import { DownloadService, isTauri, type PlaylistItem } from './services/DownloadService';
import { UpdateService, type UpdateInfo, type DownloadProgress } from './services/UpdateService';
import { LazyStore } from '@tauri-apps/plugin-store';

const store = new LazyStore('config.json');
const isStoreInitialized = ref(false);

const saveConfig = (key: string, value: any) => {
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  localStorage.setItem(key, strVal);
  if (isTauri() && isStoreInitialized.value) {
    store.set(key, value).then(() => {
      store.save().catch((e: any) => console.error('Store save error:', e));
    }).catch((e: any) => console.error('Store set error:', e));
  }
};

// ===== 🚀 自動更新狀態與邏輯 =====
const showUpdateModal = ref(false);
const updateInfo = ref<UpdateInfo>({
  hasUpdate: false,
  latestVersion: version,
  currentVersion: version,
  releaseTitle: '',
  releaseNotes: '',
  downloadUrl: '',
  assetName: '',
  htmlUrl: ''
});
const isUpdating = ref(false);
const updateFailed = ref(false);
const updateErrorMsg = ref('');
const updateProgress = ref<DownloadProgress>({
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0
});

const updateStatusText = ref('');

// 攔截更新彈窗關閉動作 (防止點擊立即更新時彈窗自動關閉)
const handleBeforeCloseUpdateModal = (action: string) => {
  if (action === 'confirm') {
    startDownloadAndInstall();
    return false; // 關鍵：阻止 Vant Dialog 自動關閉！
  } else if (action === 'cancel') {
    if (isUpdating.value && !updateFailed.value) {
      return false; // 下載進行中禁止關閉
    }
    return true; // 允許關閉
  }
  return true;
};

// 手動檢查更新 (設定面板)
const handleManualCheckUpdate = async () => {
  showLoadingToast({
    message: '正在檢查新版本...',
    forbidClick: true,
    duration: 0
  });

  try {
    const res = await UpdateService.checkForUpdates(version, 8000);
    closeToast();
    if (res.hasUpdate) {
      updateInfo.value = res;
      updateFailed.value = false;
      isUpdating.value = false;
      updateStatusText.value = '';
      showUpdateModal.value = true;
    } else {
      showToast({
        message: `目前已是最新版本 (v${version})`,
        icon: 'success'
      });
    }
  } catch (e: any) {
    closeToast();
    showToast('檢查更新失敗，請確認網路連線');
  }
};

// 啟動時靜默檢查更新 (背景執行，不打擾)
const checkUpdateOnStartup = async () => {
  try {
    const res = await UpdateService.checkForUpdates(version, 5000);
    if (res.hasUpdate) {
      updateInfo.value = res;
      updateFailed.value = false;
      isUpdating.value = false;
      updateStatusText.value = '';
      showUpdateModal.value = true;
    }
  } catch (e) {
    // 靜默忽略離線或超時
  }
};

// 開始下載與安裝
const startDownloadAndInstall = async () => {
  if (isUpdating.value) return;
  isUpdating.value = true;
  updateFailed.value = false;
  updateErrorMsg.value = '';
  updateStatusText.value = '正在連接伺服器...';
  updateProgress.value = {
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0
  };

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    if (attempt > 0) {
      updateStatusText.value = `下載失敗，正在進行第 ${attempt} 次重試 (共 ${MAX_RETRIES} 次)...`;
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      await UpdateService.downloadAndInstall(updateInfo.value, (progress) => {
        updateProgress.value = progress;
        if (progress.percent >= 100) {
          updateStatusText.value = '下載完成，正在啟動安裝程序...';
        } else {
          updateStatusText.value = `正在下載更新檔 (${progress.percent}%)...`;
        }
      });
      return;
    } catch (e: any) {
      attempt++;
      if (attempt > MAX_RETRIES) {
        isUpdating.value = false;
        updateFailed.value = true;
        updateErrorMsg.value = `已自動重試 ${MAX_RETRIES} 次仍失敗: ${e.message || String(e)}`;
      }
    }
  }
};

// 在瀏覽器開啟 Release 頁面
const openBrowserRelease = () => {
  if (updateInfo.value.htmlUrl) {
    UpdateService.openReleasePage(updateInfo.value.htmlUrl);
  }
};

// 啟動時觸發背景靜默檢查
checkUpdateOnStartup();

const isTvMode = ref(localStorage.getItem('avd_tv_mode') === 'true');

const toggleTvMode = () => {
  isTvMode.value = !isTvMode.value;
  saveConfig('avd_tv_mode', isTvMode.value);
  showToast(isTvMode.value ? '已開啟 TV 遙控器模式' : '已恢復 手機模式');
  if (isTvMode.value && !isTauri() && !serverStatus.value.isActive) {
    startLocalServer();
  }
};
void toggleTvMode;

const targetTvIp = ref(localStorage.getItem('avd_target_tv_ip') || '');

const showCastListModal = ref(false);
const remoteTasks = ref<any[]>([]);

const pushListToTv = async () => {
  if (!targetTvIp.value) {
    showToast('請輸入 TV 的 IP 位址');
    return;
  }
  
  saveConfig('avd_target_tv_ip', targetTvIp.value);
  let targetIp = targetTvIp.value.trim();
  if (targetIp.startsWith('http://')) targetIp = targetIp.replace('http://', '');
  if (targetIp.includes(':')) targetIp = targetIp.split(':')[0];
  
  try {
    // 確保快傳伺服器已啟動
    if (!serverStatus.value.isActive) {
      await startLocalServer();
    }
    
    // 取得正確的 LAN IP（與圖2顯示的一致）
    const serverIp = serverStatus.value.ip || localServerUrl.value;
    if (!serverIp || serverIp.includes('127.0.0.1')) {
      showToast('快傳伺服器尚未啟動，請先在「共享」頁面開啟伺服器');
      return;
    }
    
    // Convert tasks into remote tasks
    const pushedTasks = JSON.parse(JSON.stringify(tasks.value));
    
    // 將 Windows 絕對路徑轉為相對路徑（與 /api/list 的 playUrl 格式一致）
    const rewriteUri = (task: any) => {
      let rawPath = task.filePath || task.mediaUri || '';
      if (!rawPath || rawPath.startsWith('http')) return;
      
      // 統一為正斜線
      rawPath = rawPath.replace(/\\/g, '/');
      
      // 擷取 AVD 資料夾之後的相對路徑
      // 例如 C:/Users/101169/Downloads/AVD/频道主/file.mp3 → 频道主/file.mp3
      const avdMarker = '/AVD/';
      const idx = rawPath.indexOf(avdMarker);
      const relativePath = idx !== -1 ? rawPath.substring(idx + avdMarker.length) : rawPath.split('/').pop() || rawPath;
      
      // 用 encodeURIComponent 對每個層級進行編碼，確保單引號 (') 等字元被正確編碼，避免 VLC 解析錯誤
      const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
      task.mediaUri = `${serverIp}/play/${encodedPath}`;
    };
    
    pushedTasks.forEach((t: any) => {
      if (t.type === 'channel' && t.playlists) {
        t.playlists.forEach((p: any) => {
          if (p.subTasks) {
            p.subTasks.forEach((item: any) => rewriteUri(item));
          }
        });
      } else if (t.type !== 'channel') {
        rewriteUri(t);
      }
    });

    const pushUrl = `http://${targetIp}:8080/api/push-tasks`;
    showToast(`正在推播清單至 TV (${targetIp})...`);
    
    const params = new URLSearchParams();
    params.append('postData', JSON.stringify(pushedTasks));
    
    const resp = await fetch(pushUrl, {
      method: 'POST',
      body: params
    });
    
    const data = await resp.json();
    if (data.success) {
      showToast('推播清單成功！請在 TV 上查看。');
      showCastListModal.value = false;
    } else {
      showToast('推播清單失敗: ' + (data.error || '未知錯誤'));
    }
  } catch (e: any) {
    showToast(`無法連線至 ${targetIp}:8080，請確認兩端已連上同一 Wi-Fi`);
    console.error('Failed to push list to TV', e);
  }
};

const fetchRemoteTasks = async () => {
  if (isTauri() || !isTvMode.value) return;
  try {
    showToast('正在向本機服務取得清單...');
    const resp = await fetch('http://127.0.0.1:8080/api/get-pushed-tasks');
    if (resp.ok) {
      const dataStr = await resp.text();
      const data = JSON.parse(dataStr);
      if (Array.isArray(data) && data.length > 0) {
        remoteTasks.value = data;
        showToast('清單已更新');
      } else {
        remoteTasks.value = [];
        showToast('目前沒有任何推播清單');
      }
    } else {
      showToast('取得清單失敗: ' + resp.status);
    }
  } catch (e) {
    showToast('無法取得清單，請確認服務運行中');
  }
};



const initStore = async () => {
  if (!isTauri()) {
    monitoredChannels.value = JSON.parse(localStorage.getItem('avd_monitored_channels') || '[]');
    monitorConfig.value = JSON.parse(localStorage.getItem('avd_monitor_config') || JSON.stringify({
      autoCheckEnabled: true,
      checkIntervalMinutes: 60,
      lastGlobalCheckTime: 0
    }));
    isStoreInitialized.value = true;
    return;
  }

  try {
    const loadStoreItem = async (key: string, refVar: any, isJson = false) => {
      const stored = await store.get(key);
      if (stored !== undefined && stored !== null) {
        if (isJson && typeof stored === 'string') {
          refVar.value = JSON.parse(stored);
        } else if (['avd_tv_mode', 'avd_mp3_mode', 'avd_confirm_delete_all', 'avd_confirm_delete_single', 'avd_confirm_clear_all', 'avd_confirm_clear_single', 'avd_test_mode_enabled'].includes(key)) {
          refVar.value = typeof stored === 'string' ? stored === 'true' : !!stored;
        } else {
          refVar.value = stored;
        }
        const strVal = typeof refVar.value === 'string' ? refVar.value : JSON.stringify(refVar.value);
        localStorage.setItem(key, strVal);
      } else {
        const local = localStorage.getItem(key);
        if (local !== null) {
          if (isJson) {
            const parsed = JSON.parse(local);
            refVar.value = parsed;
            await store.set(key, parsed);
          } else if (['avd_tv_mode', 'avd_mp3_mode', 'avd_confirm_delete_all', 'avd_confirm_delete_single', 'avd_confirm_clear_all', 'avd_confirm_clear_single', 'avd_test_mode_enabled'].includes(key)) {
            refVar.value = local === 'true';
            await store.set(key, refVar.value);
          } else {
            refVar.value = local;
            await store.set(key, local);
          }
          await store.save();
        }
      }
    };

    await loadStoreItem('avd_monitored_channels', monitoredChannels, true);
    await loadStoreItem('avd_monitor_config', monitorConfig, true);
    await loadStoreItem('avd_tv_mode', isTvMode, false);
    await loadStoreItem('avd_target_tv_ip', targetTvIp, false);
    await loadStoreItem('avd_mp3_mode', mp3Mode, false);
    await loadStoreItem('avd_wifi_ssid', wifiSsid, false);
    await loadStoreItem('avd_wifi_pwd', wifiPassword, false);
    await loadStoreItem('avd_confirm_delete_all', confirmDeleteAll, false);
    await loadStoreItem('avd_confirm_delete_single', confirmDeleteSingle, false);
    await loadStoreItem('avd_confirm_clear_all', confirmClearAll, false);
    await loadStoreItem('avd_confirm_clear_single', confirmClearSingle, false);
    await loadStoreItem('avd_test_mode_enabled', testModeEnabled, false);
    await loadStoreItem('avd_tasks', tasks, true);
    await loadStoreItem('avd_drive_token', driveToken, false);

  } catch (e) {
    console.error('Failed to init store', e);
  }
  isStoreInitialized.value = true;
};

onMounted(async () => {
  await initStore();

  if (localStorage.getItem('avd_tv_mode') === null) {
    try {
      const res = await DownloadService.isTvDevice();
      if (res && res.isTv) {
        isTvMode.value = true;
        saveConfig('avd_tv_mode', true);
      }
    } catch (e) {
      console.error('Failed to detect TV device', e);
    }
  }

  // 自動啟動 TV 的快傳伺服器
  if (isTvMode.value && !isTauri()) {
    startLocalServer();
  }
  
  if (!isTauri()) {
    let lastFetchedTasksStr = '';
    setInterval(async () => {
      if (isTvMode.value) {
        try {
          const resp = await fetch('http://127.0.0.1:8080/api/get-pushed-tasks');
          if (resp.ok) {
            const dataStr = await resp.text();
            if (dataStr !== lastFetchedTasksStr) {
              lastFetchedTasksStr = dataStr;
              const data = JSON.parse(dataStr);
              if (Array.isArray(data) && data.length > 0) {
                remoteTasks.value = data;
              } else if (data.length === 0) {
                remoteTasks.value = [];
              }
            }
          }
        } catch (e) {
          // Ignore network errors silently
        }
      }
    }, 3000);
  }

  // 頻道自動追蹤排程：APP 開啟時比對自上次檢查是否已達週期
  const checkIntervalMs = (monitorConfig.value.checkIntervalMinutes || 60) * 60 * 1000;
  const timeSinceLastCheck = Date.now() - (monitorConfig.value.lastGlobalCheckTime || 0);
  if (monitorConfig.value.autoCheckEnabled && timeSinceLastCheck >= checkIntervalMs) {
    setTimeout(() => {
      checkAllMonitoredChannels(false);
    }, 3000);
  }

  // 每一分鐘背景核對是否已達下一個一小時檢查週期
  setInterval(() => {
    if (!monitorConfig.value.autoCheckEnabled) return;
    const intervalMs = (monitorConfig.value.checkIntervalMinutes || 60) * 60 * 1000;
    const elapsed = Date.now() - (monitorConfig.value.lastGlobalCheckTime || 0);
    if (elapsed >= intervalMs) {
      checkAllMonitoredChannels(false);
    }
  }, 60000);
});

interface MonitoredChannel {
  channelId: string;
  title: string;
  thumbnail: string;
  enabled: boolean;
  lastCheckTime: number;
  lastKnownVideoId?: string;
  lastVideoTitle?: string;
}

interface ChannelMonitorConfig {
  autoCheckEnabled: boolean;
  checkIntervalMinutes: number;
  lastGlobalCheckTime: number;
}

const monitoredChannels = ref<MonitoredChannel[]>(
  JSON.parse(localStorage.getItem('avd_monitored_channels') || '[]')
);

const monitorConfig = ref<ChannelMonitorConfig>(
  JSON.parse(localStorage.getItem('avd_monitor_config') || JSON.stringify({
    autoCheckEnabled: true,
    checkIntervalMinutes: 60,
    lastGlobalCheckTime: 0
  }))
);

watch(monitoredChannels, (val) => {
  if (!isStoreInitialized.value) return;
  saveConfig('avd_monitored_channels', val);
}, { deep: true });

watch(monitorConfig, (val) => {
  if (!isStoreInitialized.value) return;
  saveConfig('avd_monitor_config', val);
}, { deep: true });

const showChannelModal = ref(false);
const isAddingManualChannel = ref(false);
const isCheckingChannels = ref(false);
const manualChannelInput = ref('');

const addManualChannel = async () => {
  if (!manualChannelInput.value.trim()) {
    showToast('請輸入頻道網址或 @handle');
    return;
  }

  isAddingManualChannel.value = true;
  try {
    const res = await DownloadService.resolveYouTubeChannel(manualChannelInput.value.trim());
    if (monitoredChannels.value.some(c => c.channelId === res.channelId)) {
      showToast('此頻道已在追蹤清單中');
      return;
    }

    let channelTitle = res.title || '';
    // 防護：如果 title 是頻道 ID (UC 開頭 24 字元)，視為無效
    if (channelTitle.startsWith('UC') && channelTitle.length === 24) {
      channelTitle = '';
    }
    let latestVid = '';
    let latestTitle = '';
    try {
      const rss = await DownloadService.fetchYouTubeRss(res.channelId);
      if (rss && rss.length > 0) {
        latestVid = rss[0].videoId;
        latestTitle = rss[0].title;
      }
      // 如果 title 仍為空，嘗試從 RSS feed 取得頻道名稱
      if (!channelTitle) {
        channelTitle = await DownloadService.fetchChannelTitleFromRss(res.channelId);
      }
    } catch (e) {
      console.warn('Initial RSS fetch for title skipped', e);
    }
    // 最終 fallback：使用原始輸入
    if (!channelTitle) {
      channelTitle = manualChannelInput.value.trim();
    }

    monitoredChannels.value.push({
      channelId: res.channelId,
      title: channelTitle,
      thumbnail: 'https://www.youtube.com/s/desktop/9d31bfd1/img/favicon_144x144.png',
      enabled: true,
      lastCheckTime: Date.now(),
      lastKnownVideoId: latestVid,
      lastVideoTitle: latestTitle
    });

    manualChannelInput.value = '';
    showToast(`成功加入頻道追蹤！`);
  } catch (e: any) {
    showToast(`加入失敗: ${e.message || String(e)}`);
  } finally {
    isAddingManualChannel.value = false;
  }
};

const removeMonitoredChannel = (channelId: string) => {
  monitoredChannels.value = monitoredChannels.value.filter(c => c.channelId !== channelId);
  showToast('已取消追蹤');
};

const clearAllChannels = () => {
  showDialog({
    title: '確認清空',
    message: '確定要清空所有追蹤的頻道嗎？',
    showCancelButton: true
  }).then(() => {
    monitoredChannels.value = [];
    showToast('已清空追蹤清單');
  }).catch(() => {});
};

// 頻道本地與雲端備份/還原功能
const channelFileInputRef = ref<HTMLInputElement | null>(null);
const isCloudBackingUp = ref(false);
const isCloudRestoring = ref(false);

const exportChannelsJson = () => {
  if (monitoredChannels.value.length === 0) {
    showToast('目前沒有已追蹤的頻道可備份');
    return;
  }
  const backupData = {
    version: version,
    backupTime: Date.now(),
    channels: monitoredChannels.value
  };
  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `avd_channels_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`已成功匯出 ${monitoredChannels.value.length} 個頻道備份！`);
};

const triggerImportChannels = () => {
  if (channelFileInputRef.value) {
    channelFileInputRef.value.value = '';
    channelFileInputRef.value.click();
  }
};

const confirmRestoreChannels = (incomingChannels: any[], sourceName: string) => {
  const validChannels = incomingChannels.filter(c => c && c.channelId && typeof c.channelId === 'string');
  if (validChannels.length === 0) {
    showToast('備份檔案中無有效的頻道資料');
    return;
  }

  showDialog({
    title: `還原頻道清單 (${sourceName})`,
    message: `偵測到備份中共有 ${validChannels.length} 個頻道。\n\n請選擇還原模式：\n• 覆蓋現有：以備份檔完全取代現有清單\n• 合併現有：保留現有頻道並自動去重加入`,
    confirmButtonText: '覆蓋現有',
    cancelButtonText: '合併加入',
    showCancelButton: true
  }).then(() => {
    // 覆蓋
    monitoredChannels.value = validChannels.map(c => ({
      channelId: c.channelId,
      title: c.title || c.channelId,
      thumbnail: c.thumbnail || 'https://www.youtube.com/s/desktop/9d31bfd1/img/favicon_144x144.png',
      enabled: c.enabled !== false,
      lastCheckTime: c.lastCheckTime || Date.now(),
      lastKnownVideoId: c.lastKnownVideoId || '',
      lastVideoTitle: c.lastVideoTitle || ''
    }));
    showToast(`已覆蓋還原 ${monitoredChannels.value.length} 個頻道！`);
  }).catch(() => {
    // 合併
    let added = 0;
    validChannels.forEach(c => {
      if (!monitoredChannels.value.some(existing => existing.channelId === c.channelId)) {
        monitoredChannels.value.push({
          channelId: c.channelId,
          title: c.title || c.channelId,
          thumbnail: c.thumbnail || 'https://www.youtube.com/s/desktop/9d31bfd1/img/favicon_144x144.png',
          enabled: c.enabled !== false,
          lastCheckTime: c.lastCheckTime || Date.now(),
          lastKnownVideoId: c.lastKnownVideoId || '',
          lastVideoTitle: c.lastVideoTitle || ''
        });
        added++;
      }
    });
    showToast(`合併完成！新增了 ${added} 個頻道 (現共 ${monitoredChannels.value.length} 個)`);
  });
};

const handleChannelFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const file = target.files[0];
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const content = event.target?.result as string;
      const parsed = JSON.parse(content);
      const incoming = Array.isArray(parsed) ? parsed : (parsed.channels || []);
      if (!Array.isArray(incoming) || incoming.length === 0) {
        showToast('備份檔案中無頻道資料');
        return;
      }
      confirmRestoreChannels(incoming, '本地檔案');
    } catch (err: any) {
      showToast(`讀取失敗: ${err.message || String(err)}`);
    }
  };
  reader.readAsText(file);
};

const backupChannelsToCloud = async () => {
  if (monitoredChannels.value.length === 0) {
    showToast('目前沒有已追蹤的頻道可備份');
    return;
  }
  if (!driveToken.value) {
    showToast(isTauri() ? '請先點擊主畫面「連結 Drive」設定 Rclone 路徑' : '請先點擊主畫面「連結 Drive」登入 Google 帳號');
    return;
  }

  isCloudBackingUp.value = true;
  try {
    const backupData = {
      version: version,
      backupTime: Date.now(),
      channels: monitoredChannels.value
    };
    const jsonStr = JSON.stringify(backupData, null, 2);
    await DownloadService.backupChannelsToDrive(jsonStr, driveToken.value);
    showToast(`☁️ 成功備份 ${monitoredChannels.value.length} 個頻道至雲端！`);
  } catch (e: any) {
    showToast(`雲端備份失敗: ${e.message || String(e)}`);
  } finally {
    isCloudBackingUp.value = false;
  }
};

const restoreChannelsFromCloud = async () => {
  if (!driveToken.value) {
    showToast(isTauri() ? '請先點擊主畫面「連結 Drive」設定 Rclone 路徑' : '請先點擊主畫面「連結 Drive」登入 Google 帳號');
    return;
  }

  isCloudRestoring.value = true;
  try {
    const jsonStr = await DownloadService.restoreChannelsFromDrive(driveToken.value);
    const parsed = JSON.parse(jsonStr);
    const incoming = Array.isArray(parsed) ? parsed : (parsed.channels || []);
    if (!Array.isArray(incoming) || incoming.length === 0) {
      showToast('雲端備份檔中無頻道資料');
      return;
    }
    confirmRestoreChannels(incoming, '雲端硬碟');
  } catch (e: any) {
    showToast(`雲端還原失敗: ${e.message || String(e)}`);
  } finally {
    isCloudRestoring.value = false;
  }
};

const checkAllMonitoredChannels = async (isManual = false) => {
  if (isCheckingChannels.value) return;
  if (!monitorConfig.value.autoCheckEnabled && !isManual) return;

  const enabledChannels = monitoredChannels.value.filter(c => c.enabled);
  if (enabledChannels.length === 0) {
    if (isManual) showToast('目前沒有啟用的追蹤頻道');
    return;
  }

  isCheckingChannels.value = true;
  if (isManual) showToast(`正在檢查 ${enabledChannels.length} 個頻道...`);

  let newVideoCount = 0;
  const now = Date.now();

  for (const channel of enabledChannels) {
    try {
      const videos = await DownloadService.fetchYouTubeRss(channel.channelId);
      if (!videos || videos.length === 0) continue;

      const latestVideo = videos[0];
      const channelLastCheck = channel.lastCheckTime || 0;

      if (channelLastCheck === 0) {
        channel.lastCheckTime = now;
        channel.lastKnownVideoId = latestVideo.videoId;
        channel.lastVideoTitle = latestVideo.title;
        continue;
      }

      const newVideos = videos.filter(v => {
        const isTimeNewer = v.publishedTime > channelLastCheck;
        const isDifferentId = v.videoId !== channel.lastKnownVideoId;
        const alreadyInTasks = tasks.value.some((t: any) => {
          if (t.url && typeof t.url === 'string' && t.url.includes(v.videoId)) return true;
          if (t.playlists && Array.isArray(t.playlists)) {
            return t.playlists.some((pl: any) => 
              pl.subTasks && Array.isArray(pl.subTasks) && pl.subTasks.some((st: any) => st.url && st.url.includes(v.videoId))
            );
          }
          return false;
        });
        return isTimeNewer && isDifferentId && !alreadyInTasks;
      });

      if (newVideos.length > 0) {
        for (const vid of newVideos.reverse()) {
          const isLive = await DownloadService.checkVideoLiveStatus(vid.url);
          if (isLive) {
            console.log(`[自動追蹤] 跳過直播/首播影片: ${vid.title}`);
            continue;
          }

          const newTask: DownloadTask = {
            id: taskIdCounter++,
            type: 'file',
            isGroup: false,
            url: vid.url,
            title: `[${channel.title}] ${vid.title}`,
            status: 'pending',
            progress: 0,
            eta: '',
            line: '【自動追蹤】排隊優先下載中...',
            path: '',
            errorMsg: '',
            mediaUri: '',
            isAudio: false,
            subFolder: channel.title ? channel.title.replace(/[\/\\:*?"<>|]/g, '_') : ''
          };
          tasks.value.unshift(newTask); // 優先插隊至佇列最前面第一位！
          newVideoCount++;
        }
      }

      channel.lastCheckTime = now;
      channel.lastKnownVideoId = latestVideo.videoId;
      channel.lastVideoTitle = latestVideo.title;
    } catch (err) {
      console.warn(`檢查頻道 ${channel.title} 失敗:`, err);
    }
  }

  monitorConfig.value.lastGlobalCheckTime = now;
  isCheckingChannels.value = false;

  if (newVideoCount > 0) {
    showToast(`🔔 發現 ${newVideoCount} 部新影片，已優先加入下載佇列！`);
    processQueue();
  } else if (isManual) {
    showToast('已檢查完成，目前沒有新影片');
  }
};

const simulateNewVideo = async (channel: MonitoredChannel) => {
  showLoadingToast({ message: '正在模擬抓取最新影片...', forbidClick: true });
  try {
    const videos = await DownloadService.fetchYouTubeRss(channel.channelId);
    closeToast();
    if (!videos || videos.length === 0) {
      showToast('無法取得該頻道影片清單');
      return;
    }

    const latestVideo = videos[0];
    const testTask: DownloadTask = {
      id: taskIdCounter++,
      type: 'file',
      isGroup: false,
      url: latestVideo.url,
      title: `[測試模擬] [${channel.title}] ${latestVideo.title}`,
      status: 'pending',
      progress: 0,
      eta: '',
      line: '【測試模式】優先排隊下載中...',
      path: '',
      errorMsg: '',
      mediaUri: '',
      isAudio: false,
      subFolder: channel.title ? channel.title.replace(/[\/\\:*?"<>|]/g, '_') : ''
    };

    tasks.value.unshift(testTask); // 優先插隊至佇列最前面第一位！
    showToast(`🔔 成功模擬！已將《${latestVideo.title}》插隊至最前面！`);
    showChannelModal.value = false; // 關閉彈窗回到主介面直接看下載進度
    processQueue();
  } catch (e: any) {
    closeToast();
    showToast(`測試失敗: ${e.message || String(e)}`);
  }
};

const simulateGlobalNewVideo = async () => {
  const enabledChannels = monitoredChannels.value.filter(c => c.enabled);
  if (enabledChannels.length === 0) {
    showToast('請先新增並啟用至少一個追蹤頻道');
    return;
  }

  showLoadingToast({ message: `正在抓取 ${enabledChannels.length} 個頻道最新 2 集影片...`, forbidClick: true });
  let totalAdded = 0;

  try {
    for (const channel of enabledChannels) {
      try {
        const videos = await DownloadService.fetchYouTubeRss(channel.channelId);
        if (!videos || videos.length === 0) continue;

        // 取得最新 2 集影片
        const topVideos = videos.slice(0, 2);
        // 按時間正序反轉插入，讓最新的在最頂部
        for (const vid of topVideos.reverse()) {
          const testTask: DownloadTask = {
            id: taskIdCounter++,
            type: 'file',
            isGroup: false,
            url: vid.url,
            title: `[測試模擬] [${channel.title}] ${vid.title}`,
            status: 'pending',
            progress: 0,
            eta: '',
            line: '【測試模式】優先排隊下載中...',
            path: '',
            errorMsg: '',
            mediaUri: '',
            isAudio: false,
            subFolder: channel.title ? channel.title.replace(/[\/\\:*?"<>|]/g, '_') : ''
          };
          tasks.value.unshift(testTask);
          totalAdded++;
        }
      } catch (err) {
        console.warn(`模擬抓取頻道 ${channel.title} 失敗:`, err);
      }
    }

    closeToast();
    if (totalAdded > 0) {
      showToast(`🔔 成功！已將各頻道最新影片（共 ${totalAdded} 部）插隊至最前面！`);
      showChannelModal.value = false;
      processQueue();
    } else {
      showToast('未能取得任何頻道的影片');
    }
  } catch (e: any) {
    closeToast();
    showToast(`模擬失敗: ${e.message || String(e)}`);
  }
};

const url = ref('');
const savedMp3Mode = localStorage.getItem('avd_mp3_mode');
const mp3Mode = ref(savedMp3Mode === 'true');

const wifiSsid = ref(localStorage.getItem('avd_wifi_ssid') || '');
const wifiPassword = ref(localStorage.getItem('avd_wifi_pwd') || '');
const showWifiModal = ref(false);
const showSettingsModal = ref(false);

const getStoredBool = (key: string, defaultValue = true) => {
  const val = localStorage.getItem(key);
  if (val === null) return defaultValue;
  return val === 'true';
};

const confirmDeleteAll = ref(getStoredBool('avd_confirm_delete_all', true));
const confirmDeleteSingle = ref(getStoredBool('avd_confirm_delete_single', true));
const confirmClearAll = ref(getStoredBool('avd_confirm_clear_all', true));
const confirmClearSingle = ref(getStoredBool('avd_confirm_clear_single', true));
const testModeEnabled = ref(getStoredBool('avd_test_mode_enabled', false));

watch(confirmDeleteAll, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_delete_all', val); });
watch(confirmDeleteSingle, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_delete_single', val); });
watch(confirmClearAll, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_clear_all', val); });
watch(confirmClearSingle, (val) => { if (isStoreInitialized.value) saveConfig('avd_confirm_clear_single', val); });
watch(testModeEnabled, (val) => { if (isStoreInitialized.value) saveConfig('avd_test_mode_enabled', val); });

const saveWifiConfig = () => {
  saveConfig('avd_wifi_ssid', wifiSsid.value);
  saveConfig('avd_wifi_pwd', wifiPassword.value);
  showToast('Wi-Fi 設定已儲存');
};

const activeTab = ref(0);
const wifiQrCodeValue = computed(() => {
  if (!wifiSsid.value) return '';
  return `WIFI:S:${wifiSsid.value};T:WPA;P:${wifiPassword.value};;`;
});

const serverStatus = ref({
  isActive: false,
  ip: '',
  uploadSpeedBps: 0,
  devices: {} as Record<string, number>
});

const formatSpeedBps = (bps: number) => {
  if (!bps || bps === 0) return '0 KB/s';
  if (bps > 1024 * 1024) return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
  return (bps / 1024).toFixed(1) + ' KB/s';
};

const formattedUploadSpeed = computed(() => {
  return formatSpeedBps(serverStatus.value.uploadSpeedBps);
});

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  if (sizes[i] === 'GB') {
    return parseFloat(val.toFixed(2)) + ' GB';
  }
  return Math.floor(val) + ' ' + sizes[i];
};

DownloadService.addListener('serverUploadSpeed', (info: any) => {
  if (info && typeof info.speed === 'number') {
    serverStatus.value.uploadSpeedBps = info.speed;
    if (info.devices) {
      serverStatus.value.devices = info.devices;
    } else {
      serverStatus.value.devices = {};
    }
  }
});

watch(mp3Mode, (newVal) => {
  saveConfig('avd_mp3_mode', newVal);
});

interface DownloadTask {
  id: number;
  type?: 'file';
  isGroup?: false;
  url: string;
  title?: string;
  status: 'pending' | 'downloading' | 'success' | 'error';
  progress: number;
  eta: string;
  speed?: string;
  line: string;
  path: string;
  errorMsg: string;
  mediaUri: string;
  isAudio: boolean;
  uploadStatus?: 'idle' | 'uploading' | 'success' | 'error';
  uploadProgress?: number;
  uploadErrorMsg?: string;
  quality?: string;
  fileSizeBytes?: number;
  subFolder?: string;
}

interface PlaylistGroupTask {
  id: number;
  type: 'playlist';
  playlistTitle: string;
  status: 'pending' | 'downloading' | 'success' | 'error';
  expanded?: boolean;
  subTasks: DownloadTask[];
}

interface ChannelGroupTask {
  id: number;
  type: 'channel';
  isChannelGroup: true;
  channelTitle: string;
  status: 'pending' | 'downloading' | 'success' | 'error';
  expanded?: boolean;
  playlists: PlaylistGroupTask[];
}

type TaskItem = DownloadTask | ChannelGroupTask;

const tasks = ref<TaskItem[]>([]);

const expandAll = () => {
  tasks.value.forEach(task => {
    if (task.type === 'channel') {
      task.expanded = true;
      if (task.playlists) {
        task.playlists.forEach(p => p.expanded = true);
      }
    }
  });
  remoteTasks.value.forEach(task => {
    if (task.type === 'channel') {
      task.expanded = true;
      if (task.playlists) {
        task.playlists.forEach((p: any) => p.expanded = true);
      }
    }
  });
};

const collapseAll = () => {
  tasks.value.forEach(task => {
    if (task.type === 'channel') {
      task.expanded = false;
      if (task.playlists) {
        task.playlists.forEach(p => p.expanded = false);
      }
    }
  });
  remoteTasks.value.forEach(task => {
    if (task.type === 'channel') {
      task.expanded = false;
      if (task.playlists) {
        task.playlists.forEach((p: any) => p.expanded = false);
      }
    }
  });
};

const isAllExpanded = ref(true);
const toggleExpandAll = () => {
  isAllExpanded.value = !isAllExpanded.value;
  if (isAllExpanded.value) {
    expandAll();
  } else {
    collapseAll();
  }
};
const isProcessingQueue = ref(false);
let taskIdCounter = 1;

const showPlaylistModal = ref(false);
const parsedChannelTitle = ref('');
const parsedPlaylistTitle = ref('');
const parsedPlaylistItems = ref<PlaylistItem[]>([]);

const onBatchModalConfirm = (selectedItems: PlaylistItem[]) => {
  if (!selectedItems || selectedItems.length === 0) {
    showToast('請至少勾選一部影片');
    return;
  }

  const cleanChannel = parsedChannelTitle.value.replace(/[\/\\:*?"<>|]/g, '_').trim();
  const cleanPlaylist = parsedPlaylistTitle.value.replace(/[\/\\:*?"<>|]/g, '_').trim();
  const subFolderPath = `${cleanChannel}/${cleanPlaylist}`;

  const newSubTasks: DownloadTask[] = selectedItems.map(item => ({
    id: taskIdCounter++,
    type: 'file',
    isGroup: false,
    url: item.url,
    title: item.title,
    status: 'pending',
    progress: 0,
    eta: '',
    line: '排隊等待中...',
    path: '',
    errorMsg: '',
    mediaUri: '',
    isAudio: mp3Mode.value,
    subFolder: subFolderPath
  }));

  let channelGroup = tasks.value.find(t => t.type === 'channel' && t.channelTitle === parsedChannelTitle.value) as ChannelGroupTask | undefined;

  if (channelGroup) {
    channelGroup.status = 'pending';
    let existingPlaylist = channelGroup.playlists.find(p => p.playlistTitle === parsedPlaylistTitle.value);
    if (existingPlaylist) {
      existingPlaylist.subTasks.push(...newSubTasks);
      existingPlaylist.status = 'pending';
      existingPlaylist.expanded = true;
    } else {
      channelGroup.playlists.push({
        id: taskIdCounter++,
        type: 'playlist',
        playlistTitle: parsedPlaylistTitle.value,
        status: 'pending',
        expanded: true,
        subTasks: newSubTasks
      });
    }
  } else {
    channelGroup = {
      id: taskIdCounter++,
      type: 'channel',
      isChannelGroup: true,
      channelTitle: parsedChannelTitle.value,
      status: 'pending',
      expanded: true,
      playlists: [{
        id: taskIdCounter++,
        type: 'playlist',
        playlistTitle: parsedPlaylistTitle.value,
        status: 'pending',
        expanded: true,
        subTasks: newSubTasks
      }]
    };
    tasks.value.push(channelGroup);
  }

  showToast(`已成功加入播放清單 (${selectedItems.length} 部影片)`);
  processQueue();
};

const isPlaylistCompleted = (playlist: PlaylistGroupTask) => {
  if (!playlist.subTasks || playlist.subTasks.length === 0) return false;
  return playlist.status === 'success' || playlist.subTasks.every(s => s.status === 'success');
};

const getPlaylistCompletedCount = (playlist: PlaylistGroupTask) => {
  return playlist.subTasks.filter(s => s.status === 'success').length;
};

const getPlaylistProgress = (playlist: PlaylistGroupTask) => {
  if (!playlist.subTasks.length) return 0;
  const totalProg = playlist.subTasks.reduce((acc, cur) => {
    if (cur.status === 'success') return acc + 100;
    return acc + (cur.progress || 0);
  }, 0);
  return Math.round(totalProg / playlist.subTasks.length);
};

const getChannelCompletedCount = (channel: ChannelGroupTask) => {
  return channel.playlists.reduce((acc, pl) => acc + getPlaylistCompletedCount(pl), 0);
};

const removePlaylistGroup = (channel: ChannelGroupTask, playlistId: number) => {
  const playlist = channel.playlists.find(p => p.id === playlistId);
  const doRemove = () => {
    channel.playlists = channel.playlists.filter(p => p.id !== playlistId);
    if (channel.playlists.length === 0) {
      tasks.value = tasks.value.filter(t => t.id !== channel.id);
    }
  };

  if (confirmClearSingle.value) {
    showDialog({
      title: '確認清除播放清單',
      message: `確定要清除「${playlist?.playlistTitle || '播放清單'}」任務紀錄嗎？\n(這只會清除畫面上的紀錄，不會刪除已下載的實體檔案)`,
      showCancelButton: true,
    }).then(() => {
      doRemove();
    }).catch(() => {});
  } else {
    doRemove();
  }
};

const removeChannelGroup = (channelId: number) => {
  const channel = tasks.value.find(t => t.id === channelId) as ChannelGroupTask | undefined;
  const doRemove = () => {
    tasks.value = tasks.value.filter(t => t.id !== channelId);
  };

  if (confirmClearSingle.value || confirmClearAll.value) {
    showDialog({
      title: '確認清除頻道紀錄',
      message: `確定要清除「${channel?.channelTitle || '頻道'}」卡片與其所有播放清單紀錄嗎？\n(這只會清除畫面上的紀錄，不會刪除已下載的實體檔案)`,
      showCancelButton: true,
    }).then(() => {
      doRemove();
    }).catch(() => {});
  } else {
    doRemove();
  }
};

const deletePlaylistFiles = async (channel: ChannelGroupTask, playlist: PlaylistGroupTask) => {
  const completed = playlist.subTasks.filter(s => s.status === 'success');
  if (completed.length === 0) {
    showToast('此清單無已完成的下載檔案');
    return;
  }

  const doDelete = async () => {
    let successCount = 0;
    for (const task of completed) {
      try {
        await DownloadService.deleteMediaFile({ uri: task.mediaUri, path: task.path });
        playlist.subTasks = playlist.subTasks.filter(s => s.id !== task.id);
        successCount++;
      } catch (e) {
        console.error('Failed to delete file', e);
      }
    }
    if (playlist.subTasks.length === 0) {
      removePlaylistGroup(channel, playlist.id);
    }
    showToast(`已成功刪除 ${successCount} 個檔案`);
  };

  if (confirmDeleteSingle.value) {
    showDialog({
      title: '確認刪除檔案',
      message: `確定要從設備中徹底刪除「${playlist.playlistTitle}」內已下載的 ${completed.length} 個檔案嗎？`,
      showCancelButton: true,
    }).then(() => {
      doDelete();
    }).catch(() => {});
  } else {
    doDelete();
  }
};

const deleteChannelFiles = async (channel: ChannelGroupTask) => {
  const completedTasks: DownloadTask[] = [];
  channel.playlists.forEach(pl => {
    pl.subTasks.filter(s => s.status === 'success').forEach(s => completedTasks.push(s));
  });

  if (completedTasks.length === 0) {
    showToast('此頻道無已完成的下載檔案');
    return;
  }

  const doDelete = async () => {
    let successCount = 0;
    for (const task of completedTasks) {
      try {
        await DownloadService.deleteMediaFile({ uri: task.mediaUri, path: task.path });
        removeTaskDirect(task.id);
        successCount++;
      } catch (e) {
        console.error('Failed to delete file', e);
      }
    }
    showToast(`已成功刪除 ${successCount} 個檔案`);
  };

  if (confirmDeleteAll.value || confirmDeleteSingle.value) {
    showDialog({
      title: '確認刪除頻道檔案',
      message: `確定要從設備中徹底刪除「${channel.channelTitle}」頻道內所有已下載的 ${completedTasks.length} 個檔案嗎？`,
      showCancelButton: true,
    }).then(() => {
      doDelete();
    }).catch(() => {});
  } else {
    doDelete();
  }
};

const removeSubTask = (playlist: PlaylistGroupTask, subId: number) => {
  playlist.subTasks = playlist.subTasks.filter(s => s.id !== subId);
};

// Load tasks from localStorage
const savedTasks = localStorage.getItem('avd_tasks');
if (savedTasks) {
  try {
    tasks.value = JSON.parse(savedTasks);
    tasks.value.forEach(t => {
      // If app was killed while pending/downloading, mark as error so user can retry
      if (t.type === 'channel') {
        t.playlists.forEach(pl => {
          pl.subTasks.forEach(s => {
            if (s.status === 'downloading' || s.status === 'pending') {
              s.status = 'error';
              s.errorMsg = 'APP已關閉，任務中斷';
              s.line = '任務被強制中斷';
              s.progress = 0;
            }
          });
        });
        t.status = 'error';
      } else if (t.status === 'downloading' || t.status === 'pending') {
        t.status = 'error';
        t.errorMsg = 'APP已關閉，任務中斷';
        t.line = '任務被強制中斷';
        t.progress = 0;
      }
    });
    if (tasks.value.length > 0) {
      taskIdCounter = Math.max(...tasks.value.map(t => t.id)) + 1;
    }
  } catch (e) {
    console.error("Failed to parse saved tasks", e);
  }
}

// Watch and save to localStorage
watch(tasks, (newTasks) => {
  saveConfig('avd_tasks', newTasks);
}, { deep: true });

const getStatusType = (status: string) => {
  switch (status) {
    case 'pending': return 'warning';
    case 'downloading': return 'primary';
    case 'success': return 'success';
    case 'error': return 'danger';
    default: return 'default';
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case 'pending': return '等待中';
    case 'downloading': return '下載中';
    case 'success': return '已完成';
    case 'error': return '失敗';
    default: return status;
  }
};

const addTask = async (urlToAdd: string) => {
  if (!urlToAdd.startsWith('http://') && !urlToAdd.startsWith('https://')) {
    showToast('請輸入正確的影音網址');
    return;
  }

  const isStrictChannelUrl = 
    (urlToAdd.includes('/channel/') || urlToAdd.includes('/c/') || urlToAdd.includes('youtube.com/@')) 
    && !urlToAdd.includes('/watch') 
    && !urlToAdd.includes('/playlist');

  if (isStrictChannelUrl) {
    try {
      showLoadingToast({
        message: '正在檢查頻道資訊...',
        forbidClick: true,
        duration: 0
      });
      const channelInfo = await DownloadService.resolveYouTubeChannel(urlToAdd);
      closeToast();
      
      const isMonitored = monitoredChannels.value.some(c => c.channelId === channelInfo.channelId);
      
      if (!isMonitored) {
        try {
          await showConfirmDialog({
            title: '發現新頻道',
            message: `您輸入的是頻道網址。是否要將「${channelInfo.title || urlToAdd}」加入自動追蹤清單？\n\n加入後系統將每小時自動為您檢查並下載新影片。`,
            confirmButtonText: '加入追蹤',
            cancelButtonText: '不加入',
            confirmButtonColor: '#1989fa'
          });
          // Confirm
          monitoredChannels.value.push({
            channelId: channelInfo.channelId,
            title: channelInfo.title || urlToAdd,
            thumbnail: channelInfo.thumbnail || 'https://www.youtube.com/s/desktop/9d31bfd1/img/favicon_144x144.png',
            enabled: true,
            lastCheckTime: Date.now()
          });
          // watch 已經負責 saveConfig，無需手動儲存
          showToast('已加入自動追蹤清單');
        } catch {
          // Cancelled - do nothing, just proceed
        }
      }
      
      try {
        await showConfirmDialog({
          title: '掃描歷史明細',
          message: `是否要掃描「${channelInfo.title || urlToAdd}」的歷史影片明細？\n\n(若頻道影片較多，可能需要較長時間)`,
          confirmButtonText: '掃描並選擇下載',
          cancelButtonText: '略過',
          confirmButtonColor: '#1989fa'
        });
        // Confirm - fall through to playlist scanning
      } catch {
        // Cancelled - abort parsing
        return;
      }
    } catch (e) {
      closeToast();
      console.warn('Failed to resolve channel info for tracking prompt:', e);
    }
  }

  const isPlaylistUrl = urlToAdd.includes('list=') ||
    urlToAdd.includes('douyin.com/user/') ||
    urlToAdd.includes('v.douyin.com') ||
    urlToAdd.includes('tiktok.com/@') ||
    urlToAdd.includes('/channel/') ||
    urlToAdd.includes('/c/') ||
    (urlToAdd.includes('youtube.com/@') && !urlToAdd.includes('/watch'));

  if (isPlaylistUrl) {
    showLoadingToast({
      message: '正在解析播放清單資訊...',
      forbidClick: true,
      duration: 0
    });

    try {
      const res = await DownloadService.parsePlaylist(urlToAdd);
      closeToast();

      if (!res.items || res.items.length === 0) {
        showToast('此播放清單無可下載的影片');
        return;
      }

      parsedChannelTitle.value = res.channelTitle;
      parsedPlaylistTitle.value = res.playlistTitle;

      // 收集目前已被加入/下載過的網址
      const existingUrls = new Set<string>();
      tasks.value.forEach(t => {
        if (t.type === 'channel') {
          t.playlists.forEach(pl => {
            pl.subTasks.forEach(s => existingUrls.add(s.url));
          });
        } else {
          existingUrls.add(t.url);
        }
      });

      const freshItems = res.items.filter(i => !existingUrls.has(i.url));

      if (freshItems.length === 0) {
        showToast('此播放清單所有影片均已存在或已下載過');
        return;
      }

      parsedPlaylistItems.value = freshItems;
      showPlaylistModal.value = true;
      url.value = '';
    } catch (e: any) {
      closeToast();
      showToast(e.message || '播放清單解析失敗');
    }
    return;
  }
  
  // 避免重複排隊完全一樣的 pending 網址
  const isDuplicate = tasks.value.some(t => t.type !== 'channel' && t.url === urlToAdd && (t.status === 'pending' || t.status === 'downloading'));
  if (isDuplicate) {
    showToast('此網址已經在下載佇列中');
    return;
  }

  tasks.value.push({
    id: taskIdCounter++,
    type: 'file',
    isGroup: false,
    url: urlToAdd,
    status: 'pending',
    progress: 0,
    eta: '',
    line: '排隊等待中...',
    path: '',
    errorMsg: '',
    mediaUri: '',
    isAudio: mp3Mode.value
  });
  
  url.value = ''; // 清空輸入框
  showToast('已加入下載佇列');
  
  // 嘗試啟動佇列處理
  processQueue();
};

const onSubmit = () => {
  addTask(url.value);
};

const getNextPendingTask = (): { task: DownloadTask; parentPlaylist?: PlaylistGroupTask; parentChannel?: ChannelGroupTask } | null => {
  for (const item of tasks.value) {
    if (item.type === 'channel') {
      for (const pl of item.playlists) {
        const sub = pl.subTasks.find(s => s.status === 'pending');
        if (sub) return { task: sub, parentPlaylist: pl, parentChannel: item };
      }
    } else {
      if (item.status === 'pending') return { task: item as DownloadTask };
    }
  }
  return null;
};

const processQueue = async () => {
  if (isProcessingQueue.value) return;
  
  const pendingInfo = getNextPendingTask();
  if (!pendingInfo) return;

  const { task: nextTask, parentPlaylist, parentChannel } = pendingInfo;

  isProcessingQueue.value = true;
  nextTask.status = 'downloading';
  nextTask.line = '準備開始下載...';
  if (parentPlaylist) parentPlaylist.status = 'downloading';
  if (parentChannel) parentChannel.status = 'downloading';

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    if (attempt > 0) {
      nextTask.line = `下載失敗，正在進行第 ${attempt} 次重試 (共 ${MAX_RETRIES} 次)...`;
      await new Promise(resolve => setTimeout(resolve, 2000));
      // 檢查是否在此期間被手動取消
      if (nextTask.errorMsg === '已手動中止下載' || nextTask.line === '已手動中止下載') {
        break;
      }
    }

    try {
      const result = await DownloadService.download({
        url: nextTask.url,
        mp3: nextTask.isAudio,
        subFolder: nextTask.subFolder
      });
      nextTask.status = 'success';
      nextTask.progress = 100;
      nextTask.path = result.path;
      if (!nextTask.title && result.title) nextTask.title = result.title;
      if (result.quality) nextTask.quality = result.quality;
      if (result.fileSizeBytes) nextTask.fileSizeBytes = result.fileSizeBytes;
      nextTask.mediaUri = result.mediaUri || '';
      nextTask.line = nextTask.isAudio ? '音樂已轉換完成 (MP3)' : '影片已處理完畢並合併成功';
      break;
    } catch (error: any) {
      const errorMsgStr = String(error.message || error);
      if (errorMsgStr.includes('CANCELLED_BY_USER') || nextTask.line === '已手動中止下載' || nextTask.line === '已中止下載' || nextTask.errorMsg === '已手動中止下載') {
        nextTask.status = 'error';
        nextTask.errorMsg = '已手動中止下載';
        nextTask.line = '已手動中止下載';
        break;
      }

      attempt++;
      if (attempt > MAX_RETRIES) {
        nextTask.status = 'error';
        nextTask.errorMsg = `已自動重試 ${MAX_RETRIES} 次仍失敗: ${errorMsgStr}`;
        nextTask.line = nextTask.errorMsg;
      } else {
        nextTask.line = `下載失敗，準備進行第 ${attempt}/${MAX_RETRIES} 次自動重試...`;
      }
    }
  }

  if (parentPlaylist) {
    const allSubDone = parentPlaylist.subTasks.every(s => s.status === 'success' || s.status === 'error');
    if (allSubDone) {
      const hasError = parentPlaylist.subTasks.some(s => s.status === 'error');
      parentPlaylist.status = hasError ? 'error' : 'success';
    }
  }
  if (parentChannel) {
    const allPlDone = parentChannel.playlists.every(p => p.status === 'success' || p.status === 'error');
    if (allPlDone) {
      const hasError = parentChannel.playlists.some(p => p.status === 'error');
      parentChannel.status = hasError ? 'error' : 'success';
    }
  }
  isProcessingQueue.value = false;
  processQueue(); 
};

const retryTask = (id: number) => {
  let found = false;
  for (const item of tasks.value) {
    if (item.type === 'channel') {
      for (const pl of item.playlists) {
        const sub = pl.subTasks.find(s => s.id === id);
        if (sub) {
          sub.status = 'pending';
          sub.progress = 0;
          sub.errorMsg = '';
          sub.line = '等待重試...';
          found = true;
          break;
        }
      }
      if (found) break;
    } else if (item.id === id) {
      item.status = 'pending';
      item.progress = 0;
      item.errorMsg = '';
      item.line = '等待重試...';
      found = true;
      break;
    }
  }
  if (found) {
    processQueue();
  }
};

const batchRetryDownloads = () => {
  let found = false;
  tasks.value.forEach(t => {
    if (t.type === 'channel') {
      t.playlists.forEach(pl => {
        pl.subTasks.forEach(s => {
          if (s.status === 'error') {
            s.status = 'pending';
            s.progress = 0;
            s.errorMsg = '';
            s.line = '等待重試...';
            found = true;
          }
        });
      });
    } else {
      if (t.status === 'error') {
        t.status = 'pending';
        t.progress = 0;
        t.errorMsg = '';
        t.line = '等待重試...';
        found = true;
      }
    }
  });

  if (found) {
    showToast('已將所有失敗/中止的任務重新加入佇列');
    processQueue();
  } else {
    showToast('目前沒有需要重試的任務');
  }
};

const cancelTask = async (id: number) => {
  let targetTask: DownloadTask | undefined;
  for (const item of tasks.value) {
    if (item.type === 'channel') {
      for (const pl of item.playlists) {
        const sub = pl.subTasks.find(s => s.id === id);
        if (sub) {
          targetTask = sub;
          break;
        }
      }
      if (targetTask) break;
    } else if (item.id === id) {
      targetTask = item as DownloadTask;
      break;
    }
  }

  if (!targetTask || targetTask.status !== 'downloading') return;
  targetTask.status = 'error';
  targetTask.errorMsg = '已手動中止下載';
  targetTask.line = '已手動中止下載';
  try {
    await DownloadService.cancelDownload();
  } catch (e) {
    console.warn('cancel error', e);
  }
};

const removeTaskDirect = (id: number) => {
  tasks.value.forEach(item => {
    if (item.type === 'channel') {
      item.playlists.forEach(pl => {
        pl.subTasks = pl.subTasks.filter(s => s.id !== id);
      });
      item.playlists = item.playlists.filter(pl => pl.subTasks.length > 0);
    }
  });
  tasks.value = tasks.value.filter(t => {
    if (t.type === 'channel') return t.playlists.length > 0;
    return t.id !== id;
  });
};

const removeTask = (id: number) => {
  if (confirmClearSingle.value) {
    showDialog({
      title: '確認清除紀錄',
      message: '確定要清除這筆任務紀錄嗎？\n(這只會清除畫面上的紀錄，不會刪除您下載的實體檔案)',
      showCancelButton: true,
    }).then(() => {
      removeTaskDirect(id);
    }).catch(() => {});
  } else {
    removeTaskDirect(id);
  }
};

const executeDeleteDownloadedFile = async (task: DownloadTask) => {
  try {
    await DownloadService.deleteMediaFile({ uri: task.mediaUri, path: task.path });
    removeTaskDirect(task.id);
    showToast('已刪除檔案');
  } catch (e: any) {
    showToast('刪除失敗: ' + (e.message || '未知錯誤'));
  }
};

const deleteDownloadedFile = (task: DownloadTask) => {
  if (confirmDeleteSingle.value) {
    showDialog({
      title: '確認刪除',
      message: isTauri()
        ? '這將會從您的電腦中永久刪除這個檔案與下載紀錄，確定要刪除嗎？'
        : '這將會從您的手機中永久刪除這個檔案與下載紀錄，確定要刪除嗎？',
      showCancelButton: true,
    }).then(() => {
      executeDeleteDownloadedFile(task);
    }).catch(() => {});
  } else {
    executeDeleteDownloadedFile(task);
  }
};

const playVideo = async (task: DownloadTask) => {
  if (!task.mediaUri) {
    showToast('此為舊版下載，請重新下載以啟用播放功能');
    return;
  }
  try {
    const mimeType = task.isAudio ? 'audio/*' : 'video/*';
    await DownloadService.playVideo({ uri: task.mediaUri, mimeType });
  } catch (e: any) {
    const errStr = e.message || (typeof e === 'string' ? e : JSON.stringify(e)) || '未知錯誤';
    showToast('無法播放: ' + errStr);
    console.error('Play video error:', e);
  }
};

const openDownloadFolder = async () => {
  await DownloadService.openDownloadFolder();
};

const driveToken = ref(localStorage.getItem('avd_drive_token') || '');
const driveTokenInput = ref(driveToken.value);
const showTokenModal = ref(false);

const openOAuthPage = async () => {
  const authUrl = 'https://developers.google.com/oauthplayground/#step1&scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file';
  if (isTauri()) {
    try {
      await openShell(authUrl);
    } catch (e) {
      showToast('無法開啟瀏覽器');
      console.error('Failed to open browser', e);
    }
  } else {
    window.open(authUrl, '_system');
  }
};

const saveDriveToken = () => {
  driveToken.value = driveTokenInput.value.trim();
  saveConfig('avd_drive_token', driveToken.value);
  showToast('Google 雲端帳號連結成功！已開啟進度模式');
};

const uploadToDrive = async (task: DownloadTask) => {
  if (!task.mediaUri) {
    showToast('此為舊版下載，請重新下載以啟用雲端備份功能');
    return;
  }

  const mimeType = task.isAudio ? 'audio/mpeg' : 'video/mp4';

  // 如果沒有設定 Token，自動降級為免登入的「Google Drive 原廠 App 直接上傳」
  if (!driveToken.value) {
    if (isTauri()) {
      showToast('Windows 版無內建 Google Drive APP，請先點擊上方「連結 Google 帳號」取得權限');
      return;
    }
    try {
      showToast('喚起 Google Drive App 上傳中...');
      await DownloadService.uploadToGoogleDrive({ uri: task.mediaUri, mimeType });
    } catch (e: any) {
      showToast('備份失敗: ' + (e.message || '未知錯誤'));
    }
    return;
  }

  // 若有設定 Token，啟用 0%~100% 實時進度上傳
  task.uploadStatus = 'uploading';
  task.uploadProgress = 0;
  task.uploadErrorMsg = '';

  try {
    const fileName = (task.title ? task.title.replace(/[\/\\:*?"<>|]/g, '_') : ('AVD_' + task.id)) + (task.isAudio ? '.mp3' : '.mp4');
    await DownloadService.directUploadToDrive({
      taskId: task.id,
      uri: task.mediaUri,
      fileName,
      mimeType,
      accessToken: driveToken.value
    });
    task.uploadStatus = 'success';
    task.uploadProgress = 100;
    showToast('雲端硬碟備份成功！');
  } catch (e: any) {
    task.uploadStatus = 'error';
    task.uploadErrorMsg = String(e.message || e);
    showToast('雲端備份失敗: ' + task.uploadErrorMsg);
  }
};

const executeClearCompleted = () => {
  tasks.value = tasks.value.filter(t => t.status === 'pending' || t.status === 'downloading');
};

const clearCompleted = () => {
  if (confirmClearAll.value) {
    showDialog({
      title: '清除紀錄',
      message: '確定要清除列表中「已完成」的任務紀錄嗎？\n(這只會清除畫面上的紀錄，不會刪除您下載的實體檔案)',
      showCancelButton: true,
    }).then(() => {
      executeClearCompleted();
    }).catch(() => {});
  } else {
    executeClearCompleted();
  }
};

const executeDeleteAllFiles = async () => {
  let successCount = 0;
  const tasksToDelete: DownloadTask[] = [];
  for (const t of tasks.value) {
    if (t.type === 'channel') {
      for (const pl of t.playlists) {
        pl.subTasks.filter(s => s.status === 'success').forEach(s => tasksToDelete.push(s));
      }
    } else if (t.status === 'success') {
      tasksToDelete.push(t as DownloadTask);
    }
  }

  for (const task of tasksToDelete) {
    try {
      await DownloadService.deleteMediaFile({ uri: task.mediaUri, path: task.path });
      removeTaskDirect(task.id);
      successCount++;
    } catch (e) {
      console.error('Failed to delete file', e);
    }
  }
  showToast(`已成功刪除 ${successCount} 個檔案`);
};

const deleteAllFiles = () => {
  if (confirmDeleteAll.value) {
    showDialog({
      title: '確認刪除全部',
      message: isTauri()
        ? '這將會從電腦中徹底刪除「所有已完成下載」的影音檔案，確定要刪除嗎？'
        : '這將會從手機中徹底刪除「所有已完成下載」的影音檔案，確定要刪除嗎？',
      showCancelButton: true,
    }).then(() => {
      executeDeleteAllFiles();
    }).catch(() => {});
  } else {
    executeDeleteAllFiles();
  }
};

const checkSharedUrl = async () => {
  try {
    const result = await DownloadService.getSharedUrl();
    if (result && result.url) {
      const urlMatch = result.url.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        addTask(urlMatch[0]);
      }
    }
  } catch (e) {
    console.error("Error checking shared url", e);
  }
};

// 啟動時檢查
checkSharedUrl();

const showQrModal = ref(false); // Can be removed later
const localServerUrl = ref('');
const localMdnsUrl = ref('');

const toggleLocalServer = () => {
  if (serverStatus.value.isActive) {
    stopLocalServer();
  } else {
    startLocalServer();
  }
};

const startLocalServer = async () => {
  try {
    const res = await DownloadService.startLocalServer();
    if (res && res.url) {
      localServerUrl.value = res.url;
      localMdnsUrl.value = res.mdnsUrl || '';
      serverStatus.value.isActive = true;
      serverStatus.value.ip = res.url;
    } else {
      showToast('無法取得區域網路 IP');
    }
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
    showToast('啟動快傳服務失敗: ' + msg);
  }
};

const stopLocalServer = async () => {
  try {
    await DownloadService.stopLocalServer();
    serverStatus.value.isActive = false;
    serverStatus.value.uploadSpeedBps = 0;
  } catch (e) {
    console.warn("Failed to stop local server", e);
  }
};

onUnmounted(() => {
  if (showQrModal.value) {
    stopLocalServer();
  }
});

// 從背景返回時檢查
App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
  if (isActive) {
    checkSharedUrl();
  }
});

// 註冊進度監聽
DownloadService.addListener('downloadProgress', (info: any) => {
  let currentTask: DownloadTask | undefined;
  for (const t of tasks.value) {
    if (t.type === 'channel') {
      for (const pl of t.playlists) {
        const sub = pl.subTasks.find(s => s.status === 'downloading');
        if (sub) {
          currentTask = sub;
          break;
        }
      }
      if (currentTask) break;
    } else if (t.status === 'downloading') {
      currentTask = t as DownloadTask;
      break;
    }
  }
  if (currentTask) {
    if (info.cancelled) {
      // 使用者主動中止
      currentTask.status = 'error';
      currentTask.errorMsg = '已中止下載';
      currentTask.line = '已中止下載';
      isProcessingQueue.value = false;
      return;
    }
    currentTask.progress = Math.round(info.progress || 0);
    if (info.eta) currentTask.eta = info.eta;
    if (info.speed) currentTask.speed = info.speed;
    if (info.line) currentTask.line = info.line;
    if (info.title) currentTask.title = info.title;
  }
});

// 註冊雲端上傳進度監聽
DownloadService.addListener('driveUploadProgress', (info: any) => {
  let task: DownloadTask | undefined;
  for (const t of tasks.value) {
    if (t.type === 'channel') {
      for (const pl of t.playlists) {
        const sub = pl.subTasks.find(s => s.id === info.taskId);
        if (sub) {
          task = sub;
          break;
        }
      }
      if (task) break;
    } else if (t.id === info.taskId) {
      task = t as DownloadTask;
      break;
    }
  }
  if (task) {
    task.uploadStatus = 'uploading';
    task.uploadProgress = Math.min(100, Math.max(0, info.progress || 0));
  }
});

</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background-color: #f7f8fa;
}
.content {
  padding: 20px;
}
.header {
  text-align: center;
  margin-bottom: 25px;
}
:deep(.van-nav-bar__title) {
  max-width: 100% !important;
  width: calc(100% - 32px);
}
.nav-title-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}
.nav-title-text {
  font-size: 15px;
  font-weight: 600;
  color: #323233;
  white-space: nowrap;
}
.nav-mp3-checkbox {
  font-size: 12px;
  font-weight: normal;
  white-space: nowrap;
}
.nav-version-text {
  font-size: 10px;
  color: #c8c9cc;
  white-space: nowrap;
}
.download-form {
  margin-bottom: 25px;
}
.submit-btn-wrapper {
  margin: 20px 16px 0;
}
.options-wrapper {
  margin: 14px 16px 0;
}
.drive-btn-wrapper {
  margin: 12px 16px 0;
}
.drive-auth-btn {
  font-size: 13px;
  height: 42px;
  line-height: 42px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0,0,0,0.05);
}
.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 10px 5px 15px;
}
.queue-header h3 {
  margin: 0;
  font-size: 16px;
  color: #323233;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.task-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  border-left: 4px solid #ebedf0;
  transition: all 0.3s ease;
}
.task-card.status-pending { border-left-color: #ff976a; }
.task-card.status-downloading { border-left-color: #1989fa; }
.task-card.status-success { border-left-color: #07c160; }
.task-card.status-error { border-left-color: #ee0a24; }

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 10px;
}

.quality-badge {
  display: inline-block;
  background-color: #6b7280;
  color: white;
  padding: 0px 4px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: bold;
  margin-left: 0;
  vertical-align: middle;
  white-space: nowrap;
}
.quality-4K { background-color: #ef4444; }
.quality-1080p { background-color: #f59e0b; }
.quality-720p { background-color: #3b82f6; }
.quality-480p { background-color: #10b981; }
.quality-badge[class*='kbps'], .quality-MP3 { background-color: #8b5cf6; }

.task-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f2f3f5;
  color: #969799;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s;
}
.remove-btn:active {
  background: #ee0a24;
  color: white;
}
.task-url {
  font-size: 11px;
  color: #969799;
  word-break: break-all;
  line-height: 1.3;
  flex: 1;
}
.task-title-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.task-title {
  font-size: 14px;
  font-weight: 600;
  color: #323233;
  word-break: break-all;
  line-height: 1.35;
}
.progress-wrapper {
  margin-bottom: 12px;
}
.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #646566;
  margin-bottom: 8px;
}
.action-log {
  margin-top: 10px;
  padding: 8px 10px;
  background-color: #f2f3f5;
  border-radius: 6px;
  font-size: 11px;
  color: #646566;
  max-height: 100px;
  overflow-y: auto;
  word-break: break-all;
}
.task-footer {
  margin-top: 12px;
  font-size: 12px;
  color: #07c160;
  font-weight: 500;
  word-break: break-all;
}
.success-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.save-path {
  flex: 1;
}
.upload-wrapper {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed #ebedf0;
}
.footer-buttons {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.version-text {
  text-align: center;
  margin-top: 30px;
  font-size: 12px;
  color: #c8c9cc;
}

/* Android TV 模式與 D-Pad 遙控器焦點發光放大樣式 */
.tv-mode {
  font-size: 16px !important;
}

.tv-mode button:focus,
.tv-mode button:focus-visible,
.tv-mode input:focus,
.tv-mode a:focus,
.tv-mode .task-card:focus,
.tv-mode .sub-task-item:focus,
.tv-mode .van-button:focus,
.tv-mode .van-button:focus-visible {
  outline: 3px solid #3b82f6 !important;
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.7) !important;
  transform: scale(1.04);
  transition: all 0.15s ease-in-out;
  z-index: 10;
}

/* 頂部 8 顆操作按鈕統一等寬等高置中樣式 */
.top-ctrl-btn {
  width: 70px !important;
  height: 30px !important;
  padding: 0 !important;
  font-size: 12px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex-shrink: 0 !important;
  border-radius: 999px !important;
  border: 1px solid #dcdfe6 !important;
  color: #323233 !important;
  background-color: #ffffff !important;
  transition: all 0.2s ease !important;
}
.top-ctrl-btn .van-button__content {
  justify-content: center !important;
  width: 100% !important;
}
.top-ctrl-btn .van-icon {
  font-size: 13px !important;
  margin-right: 2px !important;
}
.top-ctrl-btn:hover {
  background-color: #f8fafc !important;
  border-color: #cbd5e1 !important;
}
.top-ctrl-btn:active {
  background-color: #f1f5f9 !important;
}
/* 當功能處於啟用狀態時的精緻主色高亮 (如: 音訊模式開啟、頻道有追蹤、快傳中) */
.top-ctrl-btn.btn-active {
  border-color: #1989fa !important;
  color: #1989fa !important;
  background-color: #eff6ff !important;
  font-weight: 500 !important;
}
</style>
