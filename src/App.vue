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
        <!-- 網路狀態（不穩定／離線）：獨立全寬提示列，位於「重整」列上方 -->
        <div
          v-if="!networkStatusText.compact"
          style="width: 100%; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; font-size: 12.5px; border: 1px solid transparent;"
          :style="networkStatusState === 'offline'
            ? 'background: #fef2f2; border-color: #fecaca; color: #b91c1c;'
            : 'background: #fffbeb; border-color: #fde68a; color: #92400e;'"
        >
          <span style="font-size: 18px; flex-shrink: 0; line-height: 1;">{{ networkStatusText.icon }}</span>
          <div style="flex: 1; line-height: 1.4;">
            <span style="font-weight: 700; display: block; margin-bottom: 1px;">{{ networkStatusText.main }}</span>
            <span v-if="networkStatusText.sub" style="font-size: 11px; opacity: 0.85;">{{ networkStatusText.sub }}</span>
          </div>
          <button
            type="button"
            style="flex-shrink: 0; border: 1px solid currentColor; background: transparent; color: inherit; font-size: 11.5px; font-weight: 600; padding: 5px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap;"
            @click="networkStatus.recheck()"
          >重新檢查</button>
        </div>

        <!-- 網路狀態標籤（正常／檢查中，置左，與右側兩排按鈕等高）＋ 重整/清除/刪除/設定、音訊/頻道/快傳/收合 -->
        <div style="display: flex; align-items: stretch; gap: 8px;">
          <div v-if="networkStatusText.compact" style="display: flex; align-items: center; flex-shrink: 0;">
            <span
              style="display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 34px; font-size: 11px; font-weight: 600; line-height: 1.3; text-align: center; padding: 4px 6px; border-radius: 10px;"
              :style="networkStatusState === 'online'
                ? 'background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;'
                : 'background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb;'"
            >
              <span v-if="networkStatusState === 'checking'" class="ns-spinner"></span>
              <span v-for="(line, i) in networkStatusBadgeLines" :key="i">{{ line }}</span>
            </span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; flex: 1;">
            <!-- 第一排：重整、清除、刪除、設定 (4 顆按鈕) -->
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
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
      <div style="padding: 12px 16px;">
        <p style="font-size: 13px; color: #4b5563; margin-bottom: 8px; font-weight: bold;">
          確認視窗 (防呆)
        </p>
        <van-cell-group inset style="margin: 0; border: 1px solid #ebedf0;">
          <van-cell title="刪除檔案" center>
            <template #right-icon>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 11px; color: #999;">全部</span>
                <van-switch v-model="confirmDeleteAll" size="18px" />
                <span style="font-size: 11px; color: #999; margin-left: 4px;">單一</span>
                <van-switch v-model="confirmDeleteSingle" size="18px" />
              </div>
            </template>
          </van-cell>
          <van-cell title="清除列表" center>
            <template #right-icon>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 11px; color: #999;">全部</span>
                <van-switch v-model="confirmClearAll" size="18px" />
                <span style="font-size: 11px; color: #999; margin-left: 4px;">單一</span>
                <van-switch v-model="confirmClearSingle" size="18px" />
              </div>
            </template>
          </van-cell>
        </van-cell-group>

        <p style="font-size: 13px; color: #4b5563; margin-top: 12px; margin-bottom: 8px; font-weight: bold;">
          診斷
        </p>
        <van-cell-group inset style="margin: 0 0 16px 0; border: 1px solid #ebedf0;">
          <van-cell
            title="錯誤紀錄"
            :value="errorLog.length ? `${errorLog.length} 筆` : '無'"
            is-link
            @click="showErrorLogModal = true"
          />
        </van-cell-group>

        <p style="font-size: 13px; color: #4b5563; margin-bottom: 8px; font-weight: bold;">
          版本與更新
        </p>
        <van-cell-group inset style="margin: 0; border: 1px solid #ebedf0;">
          <van-cell title="App 版本" :value="`v${version}`" is-link @click="handleManualCheckUpdate" />
          <van-cell title="yt-dlp" :value="ytDlpVersion" :label="`更新: ${ytDlpLastUpdate}`" is-link @click="handleManualUpdateYtDlp" title-style="flex: none; margin-right: 16px;" />
          <van-cell title="測試版更新" center label="Pre-release">
            <template #right-icon>
              <van-switch v-model="testModeEnabled" size="18px" />
            </template>
          </van-cell>
        </van-cell-group>
      </div>
    </van-dialog>

    <van-dialog
      v-model:show="showParsingModal"
      :show-confirm-button="false"
      show-cancel-button
      cancel-button-text="取消"
      :close-on-click-overlay="false"
      @cancel="onParsingCancel"
      style="max-width: 360px; width: 82%;"
    >
      <div style="padding: 26px 20px 18px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <van-loading size="26px" />
        <span style="font-size: 14px; color: #1f2937; text-align: center;">{{ parsingMessage }}</span>
      </div>
    </van-dialog>

    <van-dialog
      v-model:show="showErrorLogModal"
      title="🧾 錯誤紀錄"
      show-cancel-button
      confirm-button-text="複製全部"
      cancel-button-text="關閉"
      :before-close="onErrorLogClose"
      style="max-width: 560px; width: 94%;"
    >
      <div style="padding: 12px 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 12px; color: #6b7280;">
            共 {{ errorLog.length }} 筆，最新在最上面
          </span>
          <van-button size="mini" type="danger" plain :disabled="!errorLog.length" @click="clearErrorLog">
            清空
          </van-button>
        </div>

        <div v-if="!errorLog.length" style="padding: 24px 0; text-align: center; color: #9ca3af; font-size: 13px;">
          目前沒有錯誤紀錄
        </div>

        <div v-else style="max-height: 340px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 6px;">
          <div
            v-for="(item, idx) in displayedErrorLog"
            :key="item.time + '_' + idx"
            style="padding: 8px 10px; border-bottom: 1px solid #f1f3f5;"
          >
            <div style="font-size: 11px; color: #6b7280; margin-bottom: 3px;">
              {{ formatPublishTime(item.time) }} · {{ item.context }}
            </div>
            <div style="font-size: 12px; color: #1f2937; word-break: break-all; line-height: 1.5; white-space: pre-wrap;">
              {{ item.message }}
            </div>
          </div>
        </div>

        <p style="font-size: 11px; color: #9ca3af; margin: 10px 0 0 0; line-height: 1.5;">
          紀錄僅存於本機、不會自動上傳。複製前請確認內容不含你不願外流的資訊（例如帶權杖的網址）。
        </p>
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

          <!-- 備援機制開關 (預設關閉) -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
            <div>
              <div style="font-size: 12px; font-weight: 500; color: #1e293b;">啟用 yt-dlp 備援機制</div>
              <div style="font-size: 10px; color: #94a3b8;">官方 RSS 連線異常時切換首頁解析備援（預設關閉）</div>
            </div>
            <van-switch v-model="monitorConfig.enableYtDlpFallback" size="18px" />
          </div>
          <!-- YouTube Data API 金鑰（選填）。未設定時完全維持 RSS → yt-dlp 行為 -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
            <div style="flex: 1; min-width: 0; margin-right: 8px;">
              <div style="font-size: 12px; font-weight: 500; color: #1e293b;">
                YouTube Data API 金鑰
                <span
                  :style="{ fontSize: '10px', marginLeft: '6px', color: youtubeApiKey.trim() ? '#16a34a' : '#94a3b8' }"
                >{{ youtubeApiKey.trim() ? '● 已設定' : '○ 未設定' }}</span>
              </div>
              <div style="font-size: 10px; color: #94a3b8;">
                設定後改以官方 API 為第一通道，最穩定；未設定則維持 RSS → yt-dlp（選填）
              </div>
            </div>
            <van-button size="mini" plain round @click="openApiKeyEditor" style="padding: 0 10px; height: 22px; font-size: 10px; flex-shrink: 0;">
              設定
            </van-button>
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
          </div>

          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <van-button size="small" type="default" plain block icon="down" @click="exportChannelsJson" style="font-size: 11px; height: 32px; border-radius: 6px;">
              📁 備份
            </van-button>
            <van-button size="small" type="default" plain block icon="upgrade" @click="triggerImportChannels" style="font-size: 11px; height: 32px; border-radius: 6px;">
              📥 匯入
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
            <!-- 第一行：頭像 + (頻道名稱 + 時間) + Switch開關 + 刪除按鈕 -->
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1; margin-right: 8px;">
                <img
                  :src="channel.thumbnail || 'https://www.youtube.com/favicon.ico'"
                  style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #e2e8f0; flex-shrink: 0;"
                  @error="($event.target as HTMLImageElement).src='https://www.youtube.com/favicon.ico'"
                />
                <div style="display: flex; flex-direction: column; overflow: hidden; flex: 1; min-width: 0;">
                  <div style="font-size: 13px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;">
                    {{ channel.title }}
                  </div>
                  <div v-if="channel.lastPublishedTime" style="font-size: 10.5px; color: #64748b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="最新影片發布時間">
                    🕒 {{ formatPublishTime(channel.lastPublishedTime) }}
                  </div>
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
              <!-- 關鍵字入口：只顯示狀態與數量，完整內容留在對話框，維持雙行版面 -->
              <van-button
                size="mini"
                :type="channel.keywords && channel.keywords.length ? 'primary' : 'default'"
                plain
                round
                title="設定此頻道的標題關鍵字篩選"
                @click="openKeywordEditor(channel)"
                style="padding: 0 8px; height: 20px; font-size: 10px; flex-shrink: 0;"
              >
                {{ keywordEntryLabel(channel) }}
              </van-button>
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


    <!-- 頻道標題關鍵字編輯（草稿式：確認才寫回訂閱，取消不影響） -->
    <van-dialog
      v-model:show="showKeywordDialog"
      :title="`🔎 ${keywordEditingChannelTitle} 的關鍵字`"
      show-cancel-button
      confirm-button-text="確認"
      cancel-button-text="取消"
      :before-close="onKeywordDialogBeforeClose"
    >
      <div style="padding: 14px 16px; max-height: 60vh; overflow-y: auto;">
        <p style="font-size: 12px; color: #64748b; line-height: 1.6; margin: 0 0 10px;">
          只下載<b>標題含有</b>下列任一關鍵字的新影片。未設定任何關鍵字時，維持追蹤該頻道的全部影片。
        </p>
        <p style="font-size: 11px; color: #94a3b8; line-height: 1.6; margin: 0 0 12px;">
          比對忽略英文大小寫、全形半形與繁簡字形差異。<br>
          逗號（<code>,</code> 或 <code>，</code>）是<b>分隔符</b>，不可作為關鍵字內容；
          每個頻道最多 {{ KEYWORD_MAX_COUNT }} 個關鍵字，單項最長 {{ KEYWORD_MAX_LENGTH }} 字元。
        </p>

        <van-field
          v-model="keywordInput"
          placeholder="輸入關鍵字後按 Enter 或逗號新增"
          clearable
          style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px;"
          @keyup.enter="commitKeywordInput"
          @update:model-value="(v: string) => { if (/[,，]/.test(v)) commitKeywordInput(); }"
        />

        <div v-if="keywordRejections.length > 0" style="margin-top: 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px;">
          <div v-for="(reason, i) in keywordRejections" :key="i" style="font-size: 11px; color: #b91c1c; line-height: 1.6;">
            ⚠️ {{ reason }}
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; margin: 14px 0 6px;">
          <span style="font-size: 12px; font-weight: 600; color: #475569;">
            已設定 ({{ keywordDraft.length }}/{{ KEYWORD_MAX_COUNT }})
          </span>
          <span
            v-if="keywordDraft.length > 0"
            style="font-size: 12px; color: #ef4444; cursor: pointer;"
            @click="clearKeywordDraft"
          >
            全部清空
          </span>
        </div>

        <div v-if="keywordDraft.length === 0" style="font-size: 12px; color: #94a3b8; text-align: center; padding: 14px 0; background: #f8fafc; border-radius: 8px;">
          尚未設定關鍵字 —— 目前追蹤此頻道的全部影片。
        </div>
        <div v-else style="display: flex; flex-wrap: wrap; gap: 6px;">
          <van-tag
            v-for="(kw, i) in keywordDraft"
            :key="kw"
            type="primary"
            plain
            closeable
            size="medium"
            style="font-size: 12px; padding: 4px 8px;"
            @close="removeKeywordAt(i)"
          >
            {{ kw }}
          </van-tag>
        </div>
      </div>
    </van-dialog>

    <!-- YouTube Data API 金鑰編輯（草稿式：確認才寫回，取消不影響） -->
    <van-dialog
      v-model:show="showApiKeyDialog"
      title="🔑 YouTube Data API 金鑰"
      show-cancel-button
      confirm-button-text="儲存"
      cancel-button-text="取消"
      :before-close="onApiKeyDialogBeforeClose"
    >
      <div style="padding: 14px 16px; max-height: 60vh; overflow-y: auto;">
        <p style="font-size: 12px; color: #64748b; line-height: 1.6; margin: 0 0 10px;">
          設定金鑰後，頻道追蹤改以 <b>YouTube Data API</b> 為第一通道 —— 官方 RSS 端點會回傳隨機的假 404，API 則有服務水準保證，且回傳精確發布時間與更寬的候選範圍。
        </p>
        <p style="font-size: 11px; color: #94a3b8; line-height: 1.7; margin: 0 0 12px;">
          <b>免費，不需信用卡</b>：每個 Google Cloud 專案每日 10,000 單位額度，本應用程式的用量約 5%。<br>
          需自行於 Google Cloud Console 建立專案、啟用「YouTube Data API v3」並產生 API 金鑰。<br>
          金鑰只存在本機，<b>不會</b>寫入頻道備份，也不會出現在錯誤日誌中。<br>
          留空即停用 API 通道，回到 RSS → yt-dlp。
        </p>

        <van-field
          v-model="apiKeyDraft"
          :type="apiKeyVisible ? 'text' : 'password'"
          placeholder="貼上 API 金鑰（AIza...）"
          clearable
          style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px;"
        />

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px;">
          <span
            style="font-size: 11px; color: #64748b; cursor: pointer;"
            @click="apiKeyVisible = !apiKeyVisible"
          >
            {{ apiKeyVisible ? '🙈 隱藏金鑰' : '👁 顯示金鑰' }}
          </span>
          <span
            v-if="apiKeyDraft.trim()"
            style="font-size: 11px; color: #ef4444; cursor: pointer;"
            @click="apiKeyDraft = ''"
          >
            清除
          </span>
        </div>

        <div v-if="youtubeApiKey.trim()" style="margin-top: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; color: #475569;">
            <span>今日用量（估算）</span>
            <span style="font-variant-numeric: tabular-nums;">
              <b>{{ apiUnitsUsedToday }}</b> / {{ DAILY_QUOTA_UNITS }}
            </span>
          </div>
          <div style="font-size: 10px; color: #94a3b8; line-height: 1.6; margin-top: 4px;">
            由本機自行累計，非官方數字。同一把金鑰用於多台裝置、或同一專案被其他工具使用時，實際用量會高於此值。
            權威數字請見 Google Cloud Console 的「配額和系統限制」。<br>
            每天 <b>{{ apiQuotaResetLocalTime }}</b> 歸零（Google 以太平洋時間午夜重置，此處已換算為當地時間）。
          </div>
        </div>

        <div v-if="monitorConfig.apiQuotaSuppressedUntil && Date.now() < monitorConfig.apiQuotaSuppressedUntil"
             style="margin-top: 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; font-size: 11px; color: #92400e; line-height: 1.6;">
          ⚠️ 今日配額已用盡，目前暫時改用官方 RSS。配額於太平洋時間午夜重置後會自動恢復，不需手動處理。
        </div>
        <div v-else-if="monitorConfig.apiRejectedKeyFingerprint"
             style="margin-top: 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px; font-size: 11px; color: #b91c1c; line-height: 1.6;">
          ⚠️ 目前的金鑰被 API 拒絕（無效、已撤銷，或該專案未啟用 YouTube Data API v3）。請確認後更換金鑰。
        </div>
      </div>
    </van-dialog>

    <YouTubeBatchModal
      v-model:show="showPlaylistModal"
      :channel-title="parsedChannelTitle"
      :playlist-title="parsedPlaylistTitle"
      :items="parsedPlaylistItems"
      @confirm="onBatchModalConfirm"
      @cancel="onBatchModalCancel"
    />
    <van-action-sheet
      v-model:show="showRestoreSheet"
      :actions="restoreActions"
      cancel-text="取消"
      :title="`還原頻道清單 (${restoreSourceName})`"
      :description="`偵測到備份中共有 ${restoreIncomingChannels.length} 個頻道。\n請選擇還原模式：`"
      close-on-click-action
      @select="onRestoreActionSelect"
      style="max-width: 400px; margin: 0 auto; left: 0; right: 0;"
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
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { open as openShell } from '@tauri-apps/plugin-shell';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { DownloadService, isTauri, formatPublishTime, type PlaylistItem } from './services/DownloadService';
import {
  parseProgressKey, advanceParseProgress, collectSourceProgress, pendingSequences,
  applySequenceResults, resetSourceProgress, describeNextBatch, describeProgress,
  SINGLE_SEQUENCE, PARSE_TIMEOUT_MS, PARSE_CANCELLED, PARSE_BATCH_SIZE, type ParseProgress
} from './services/parseScope';
import { buildTaskDisplayTitle } from './services/displayFormat';
import { appendErrorEntry, formatErrorLog, sortedForDisplay, type ErrorEntry } from './composables/useErrorLog';
import { useNetworkStatus, describeNetworkStatus } from './composables/useNetworkStatus';
import { classifyChannelRssError, describeChannelRssFailure, describeEarlyStop, describeDegradedRound, CHANNEL_CHECK_DEGRADE_AFTER_FAILURES, shouldBackoff, describeRateLimit, type ChannelRssErrorLevel } from './services/rateLimit';
import { resolveSourceProfile } from './services/sourceProfiles';
import { mergeEnriched, type EnrichedItem } from './services/enrichment';
import { matchPermanentError } from './services/downloadErrors';
import {
  nextQuotaResetTime,
  apiKeyFingerprint,
  describeApiQuotaDegraded,
  describeApiKeyRejected,
  addApiUnits,
  currentApiUnitsUsed,
  DAILY_QUOTA_UNITS,
  type ApiErrorKind,
} from './services/youtubeDataApi';
import {
  channelBaseline,
  isFirstTimeTracking,
  selectNewVideos,
  nextChannelBaseline,
  buildChannelVideoTask,
  channelSourceLabel,
  normalizeChannelKeywords,
  channelKeywords,
  partitionByKeywords,
  describeKeywordFilteredRound,
  describeKeywordFilteredSuffix,
  describeChannelKeywordMiss,
  conservativeAnchor,
  KEYWORD_MAX_COUNT,
  KEYWORD_MAX_LENGTH,
  type ChannelAnchor
} from './composables/useChannelMatching';
import { UpdateService, type UpdateInfo, type DownloadProgress } from './services/UpdateService';
import { createStorage } from './composables/useStorage';
import { LocalStorageAdapter, TauriStoreAdapter, localStorageLegacyFallback } from './composables/storageAdapters';
import {
  createTaskStore,
  projectTasks,
  isPlaylistCompleted,
  getPlaylistCompletedCount,
  getPlaylistProgress,
  getChannelCompletedCount,
  type DownloadTask,
  type PlaylistGroupTask,
  type ChannelGroupTask,
} from './composables/useTaskStore';

// 單一權威來源：Windows 使用 Tauri Store，Android / Web 使用 localStorage。
// 舊版雙寫時期遺留於 localStorage 的資料，僅在權威來源無值時作為一次性遷移來源讀取。
const storage = createStorage(
  isTauri() ? new TauriStoreAdapter('config.json') : new LocalStorageAdapter(),
  localStorageLegacyFallback
);
const taskStore = createTaskStore(storage);
const { tasks } = taskStore;

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
    reportError('檢查更新', e);
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

const isTvMode = storage.defineSetting('avd_tv_mode', false);

const toggleTvMode = () => {
  isTvMode.value = !isTvMode.value;
  showToast(isTvMode.value ? '已開啟 TV 遙控器模式' : '已恢復 手機模式');
  if (isTvMode.value && !isTauri() && !serverStatus.value.isActive) {
    startLocalServer();
  }
};
void toggleTvMode;

/**
 * 主畫面網路狀態：與 TV 接收模式無關，即使切到 TV 模式也持續在背景探測
 * （不改變 TV 接收模式既有行為），只在畫面上以 `v-show="!isTvMode"` 隱藏顯示。
 */
const networkStatus = useNetworkStatus({
  probe: (timeoutMs) => DownloadService.probeInternetConnectivity(timeoutMs),
  isDeviceOnline: () => navigator.onLine,
  onDeviceOnlineChange: (cb) => {
    const onOnline = () => cb(true);
    const onOffline = () => cb(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  },
  isPageVisible: () => document.visibilityState === 'visible',
  onVisibilityChange: (cb) => {
    const handler = () => cb(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
});
const networkStatusState = networkStatus.state;
const networkStatusText = computed(() => describeNetworkStatus(networkStatusState.value));
/** 精簡標籤佔滿「重整／音訊」兩排高度，文字改為每兩字一行堆疊呈現（如「網路」／「正常」）。 */
const networkStatusBadgeLines = computed(() => {
  const chars = Array.from(networkStatusText.value.main);
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += 2) {
    lines.push(chars.slice(i, i + 2).join(''));
  }
  return lines;
});

const targetTvIp = storage.defineSetting('avd_target_tv_ip', '');

const showCastListModal = ref(false);
const remoteTasks = ref<any[]>([]);

const pushListToTv = async () => {
  if (!targetTvIp.value) {
    showToast('請輸入 TV 的 IP 位址');
    return;
  }
  
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
    // 與持久化共用同一份投影：不把單機的展開狀態與瞬時進度推送到其他裝置
    const pushedTasks = JSON.parse(JSON.stringify(projectTasks(tasks.value)));
    
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
      reportError('推播清單至 TV', data.error || '未知錯誤');
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
      reportError('取得 TV 清單', `HTTP ${resp.status}`);
    }
  } catch (e) {
    showToast('無法取得清單，請確認服務運行中');
  }
};




onMounted(async () => {
  networkStatus.start();
  await storage.hydrate();

  if (taskStore.trimmedOnRestore.value > 0) {
    showToast(`已自動清理 ${taskStore.trimmedOnRestore.value} 筆較舊的任務紀錄`);
  }

  // 首次啟動（該鍵尚無存值）時自動偵測是否為 TV 裝置
  if (!storage.wasRestored('avd_tv_mode')) {
    try {
      const res = await DownloadService.isTvDevice();
      if (res && res.isTv) {
        isTvMode.value = true;
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

  // 啟動時自動修復：如果有頻道的 title 是 UC 開頭的 Channel ID，嘗試取得真實名稱
  setTimeout(async () => {
    for (const channel of monitoredChannels.value) {
      if (channel.title && channel.title.startsWith('UC') && channel.title.length === 24) {
        try {
          const realTitle = await DownloadService.fetchChannelTitleFromRss(channel.channelId);
          if (realTitle) {
            channel.title = realTitle;
            console.log(`自動修復頻道標題: ${channel.channelId} -> ${realTitle}`);
          }
        } catch (e) {
          console.warn(`修復頻道標題失敗 (${channel.channelId}):`, e);
        }
      }
    }
  }, 5000);
});

interface MonitoredChannel {
  channelId: string;
  title: string;
  thumbnail: string;
  enabled: boolean;
  lastPublishedTime?: number;
  lastCheckTime?: number;
  lastKnownVideoId?: string;
  lastVideoTitle?: string;
  /**
   * 該頻道的 uploads 播放清單識別碼（API 通道用）。
   * 終生不變，故查得後即快取，之後不再查詢。非機密（可由頻道 ID 推得），
   * 無須遮蔽；舊備份缺此欄位時回到前綴推導。
   */
  uploadsPlaylistId?: string;
  /**
   * 標題關鍵字篩選。空陣列代表無篩選（全量追蹤）。
   *
   * 頻道物件有三個建構點（頻道管理彈窗新增、網址列自動加入追蹤、還原匯入）
   * 加上持久化反序列化，四處皆須經 `normalizeChannelKeywords` 產生此欄位，
   * 且一律寫入 `[]` 而非留 `undefined`，使後續 UI 與檢查不必反覆處理該形態。
   */
  keywords?: string[];
}

interface ChannelMonitorConfig {
  autoCheckEnabled: boolean;
  checkIntervalMinutes: number;
  lastGlobalCheckTime: number;
  enableYtDlpFallback?: boolean;
  /**
   * API 配額耗盡的抑制解除時點（下一個太平洋時間午夜）。
   * 此時點之前一律跳過 API 通道直接走 RSS —— 配額耗盡後在重置前的每次
   * 請求都必然失敗，不抑制的話每個頻道每輪都要白付一次失敗往返。
   * 必須持久化：app 重啟頻繁，只放記憶體會讓抑制失效而恢復白打。
   */
  apiQuotaSuppressedUntil?: number;
  /**
   * 被 API 拒絕的金鑰指紋。與當前金鑰指紋相符時跳過 API。
   * 綁定金鑰內容而非時間 —— 無效金鑰不會因時間而變有效，
   * 但「使用者換了金鑰」是明確可偵測的解除條件。存指紋而非金鑰本身。
   */
  apiRejectedKeyFingerprint?: string;
  /**
   * 當日 API 用量估算（單位）與其計數週期結束時點。
   * **估算值**：API 不提供查詢自身用量的端點，同專案被其他工具使用、
   * 同一金鑰用於多台裝置皆會使此值低於實際。持久化以免重啟後歸零。
   */
  apiUnitsUsedToday?: number;
  apiUnitsResetAt?: number;
}

const monitoredChannels = storage.defineSetting<MonitoredChannel[]>('avd_monitored_channels', [], {
  deserialize: (raw) => {
    const list = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw ?? []);
    if (!Array.isArray(list)) return [];
    // 向下相容：舊資料只有 lastCheckTime，且不含 keywords 欄位
    return list.map((c: any) => ({
      ...c,
      lastPublishedTime: c.lastPublishedTime || c.lastCheckTime || 0,
      keywords: normalizeChannelKeywords(c?.keywords).keywords,
    }));
  },
});

const monitorConfig = storage.defineSetting<ChannelMonitorConfig>('avd_monitor_config', {
  autoCheckEnabled: true,
  checkIntervalMinutes: 60,
  lastGlobalCheckTime: 0,
  enableYtDlpFallback: false,
}, {
  deserialize: (raw, defaultValue) => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {});
      return { ...defaultValue, ...(parsed as object) };
    } catch {
      return defaultValue;
    }
  },
});

// API 金鑰刻意存為獨立設定鍵，不放進 ChannelMonitorConfig：
// 規格要求金鑰 MUST NOT 出現在頻道備份中。頻道匯出目前只序列化
// monitoredChannels，所以放 monitorConfig 目前也不會被帶出 —— 但那是巧合
// 而非保證，日後若有人把設定納入備份或雲端同步就會順帶外洩，且不會有任何
// 測試失敗來提醒。獨立鍵讓「不得匯出」成為結構性事實。
const youtubeApiKey = storage.defineSetting('avd_youtube_api_key', '');

// 本輪 API 通道的狀態，供檢查結果回饋使用（每輪開始時重設）
let apiQuotaDegradedThisRound = false;
let apiKeyRejectedThisRound = false;

/**
 * 產生傳給 `fetchChannelVideos` 的 API 選項。
 *
 * 四個呼叫點（檢查迴圈、加入頻道、單頻道模擬、全頻道模擬）共用同一份，
 * 使抑制狀態一致 —— 否則模擬入口會在配額已耗盡時仍逐一白打 API。
 * 金鑰為空時回傳 `undefined`，`fetchChannelVideos` 因此完全不觸碰 API。
 */
const buildApiOptions = (channel?: MonitoredChannel) => {
  const apiKey = youtubeApiKey.value.trim();
  if (!apiKey) return undefined;

  return {
    apiKey,
    now: Date.now(),
    quotaSuppressedUntil: monitorConfig.value.apiQuotaSuppressedUntil,
    rejectedKeyFingerprint: monitorConfig.value.apiRejectedKeyFingerprint,
    uploadsPlaylistId: channel?.uploadsPlaylistId,
    onResolved: (uploadsPlaylistId: string) => {
      if (channel) channel.uploadsPlaylistId = uploadsPlaylistId;
      // 成功即代表金鑰可用，清掉可能殘留的被拒指紋
      if (monitorConfig.value.apiRejectedKeyFingerprint) {
        monitorConfig.value.apiRejectedKeyFingerprint = undefined;
      }
    },
    onUnitsConsumed: (units: number) => {
      const next = addApiUnits(
        { used: monitorConfig.value.apiUnitsUsedToday || 0, resetAt: monitorConfig.value.apiUnitsResetAt || 0 },
        units,
        Date.now()
      );
      monitorConfig.value.apiUnitsUsedToday = next.used;
      monitorConfig.value.apiUnitsResetAt = next.resetAt;
    },
    onError: (kind: ApiErrorKind) => {
      if (kind === 'quota') {
        // 配額為每日額度，重置前的每次請求都必然失敗 —— 抑制到下一個
        // 太平洋時間午夜，並持久化以免重啟後恢復白打
        monitorConfig.value.apiQuotaSuppressedUntil = nextQuotaResetTime(Date.now());
        apiQuotaDegradedThisRound = true;
      } else if (kind === 'key') {
        // 綁定金鑰指紋而非時間：無效金鑰不會因時間而變有效
        monitorConfig.value.apiRejectedKeyFingerprint = apiKeyFingerprint(apiKey);
        apiKeyRejectedThisRound = true;
      }
      // 'other'（5xx、網路錯誤）不抑制 —— 那是暫時性狀況，下輪值得再試
    },
  };
};

// ---- YouTube Data API 金鑰編輯（草稿式） ----
//
// 與關鍵字編輯器同形式：編輯期間只改草稿，按「儲存」才寫回設定，
// 「取消」有明確語意。金鑰預設以 password 型態顯示 —— 規格要求
// MUST NOT 預設以明文完整顯示，使用者可自行切換為可見。
/**
 * 配額歸零時點的**當地**時間字串。
 *
 * Google 的配額於太平洋時間午夜重置，換算到其他時區往往落在白天 ——
 * 台灣是下午三點。只寫「太平洋時間午夜」對使用者毫無意義，而且數字在
 * 下午突然歸零看起來就是 bug。故直接顯示當地時鐘時間。
 */
const apiQuotaResetLocalTime = computed(() =>
  new Date(monitorConfig.value.apiUnitsResetAt || nextQuotaResetTime(Date.now()))
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
);

/** 當日已用單位（跨日後自動回 0，不殘留昨日數字）。 */
const apiUnitsUsedToday = computed(() => currentApiUnitsUsed(
  { used: monitorConfig.value.apiUnitsUsedToday || 0, resetAt: monitorConfig.value.apiUnitsResetAt || 0 },
  Date.now()
));

const showApiKeyDialog = ref(false);
const apiKeyDraft = ref('');
const apiKeyVisible = ref(false);

const openApiKeyEditor = () => {
  apiKeyDraft.value = youtubeApiKey.value;
  apiKeyVisible.value = false;
  showApiKeyDialog.value = true;
};

const onApiKeyDialogBeforeClose = (action: string): boolean => {
  // 取消：草稿丟棄，設定不受影響
  if (action !== 'confirm') return true;

  const next = apiKeyDraft.value.trim();
  const changed = next !== youtubeApiKey.value.trim();
  youtubeApiKey.value = next;

  if (changed) {
    // 換了金鑰即解除「金鑰無效」的抑制；配額抑制與金鑰無關，刻意不動
    monitorConfig.value.apiRejectedKeyFingerprint = undefined;
    apiKeyRejectedThisRound = false;
  }

  showToast(next ? '已儲存 API 金鑰，下次檢查將以 API 為第一通道' : '已清除 API 金鑰，回到 RSS → yt-dlp');
  return true;
};

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
    let latestPubTime = 0;
    try {
      // 尚未建立頻道物件，故不帶快取的 uploads 清單識別碼；
      // 首次成功後由檢查迴圈的 onResolved 寫入該頻道並快取。
      const rss = await DownloadService.fetchChannelVideos(res.channelId, {
        enableFallback: monitorConfig.value.enableYtDlpFallback,
        api: buildApiOptions()
      });
      if (rss && rss.length > 0) {
        latestVid = rss[0].videoId;
        latestTitle = rss[0].title;
        latestPubTime = rss[0].publishedTime || 0;
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
      thumbnail: res.thumbnail || 'https://www.youtube.com/favicon.ico',
      enabled: true,
      lastPublishedTime: latestPubTime || Date.now(),
      lastCheckTime: Date.now(),
      lastKnownVideoId: latestVid,
      lastVideoTitle: latestTitle,
      // 一律寫入 []（而非留 undefined），使後續 UI 與檢查不必處理該形態
      keywords: []
    });

    manualChannelInput.value = '';
    showToast(`成功加入頻道追蹤！`);
  } catch (e: any) {
    reportError('加入頻道', e);
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

// ---- 頻道標題關鍵字編輯（草稿式） ----
//
// 草稿與訂閱分離：編輯期間只改 keywordDraft，按「確認」才寫回頻道物件。
// 這讓「取消」有明確語意。註：useStorage 的 watch 已是 { deep: true }，
// 原地修改 keywords 陣列一樣會持久化，因此草稿式並非持久化的必要條件，
// 純粹是編輯語意的選擇 —— 不需為此額外替換整個頻道物件。
const showKeywordDialog = ref(false);
const keywordEditingChannelId = ref('');
const keywordEditingChannelTitle = ref('');
const keywordDraft = ref<string[]>([]);
const keywordInput = ref('');
const keywordRejections = ref<string[]>([]);

const openKeywordEditor = (channel: MonitoredChannel) => {
  keywordEditingChannelId.value = channel.channelId;
  keywordEditingChannelTitle.value = channel.title;
  keywordDraft.value = channelKeywords(channel);
  keywordInput.value = '';
  keywordRejections.value = [];
  showKeywordDialog.value = true;
};

/**
 * 把輸入框內容併入草稿。Enter 與逗號（半形 `,`／全形 `，`）皆為分隔符。
 *
 * 正規化與上限檢查全交由 normalizeChannelKeywords，UI 只負責顯示它回傳的
 * 拒絕原因 —— 超限一律拒絕並提示，不靜默截斷。
 */
const commitKeywordInput = (): boolean => {
  const raw = keywordInput.value;
  if (!raw.trim()) {
    keywordRejections.value = [];
    return true;
  }
  const merged = [...keywordDraft.value, ...raw.split(/[,，]/)];
  const { keywords, rejections } = normalizeChannelKeywords(merged);
  keywordDraft.value = keywords;
  keywordRejections.value = rejections;
  keywordInput.value = '';
  return rejections.length === 0;
};

const removeKeywordAt = (index: number) => {
  keywordDraft.value = keywordDraft.value.filter((_, i) => i !== index);
  keywordRejections.value = [];
};

const clearKeywordDraft = () => {
  keywordDraft.value = [];
  keywordInput.value = '';
  keywordRejections.value = [];
};

/**
 * 對話框關閉前的守門。
 *
 * 走 before-close 而非 @confirm：van-dialog 的確認鈕會無條件關閉，
 * 若在 @confirm 內發現超限而想留住使用者，對話框早已關掉、拒絕原因
 * 也就看不到了 —— 那正是「靜默截斷」的另一種形式。
 */
const onKeywordDialogBeforeClose = (action: string): boolean => {
  // 取消：草稿直接丟棄，訂閱不受影響
  if (action !== 'confirm') return true;

  // 先把輸入框殘留文字併入，避免使用者打完字直接按確認而遺失該項
  if (!commitKeywordInput()) {
    // 有項目被拒絕：留在對話框讓使用者看見原因，不靜默套用
    return false;
  }

  const target = monitoredChannels.value.find(c => c.channelId === keywordEditingChannelId.value);
  if (target) {
    target.keywords = normalizeChannelKeywords(keywordDraft.value).keywords;
    showToast(target.keywords.length
      ? `已設定 ${target.keywords.length} 個關鍵字`
      : '已清空關鍵字，恢復追蹤全部影片');
  }
  return true;
};

/** 頻道卡片上的關鍵字入口文案。 */
const keywordEntryLabel = (channel: MonitoredChannel): string => {
  const count = channel.keywords ? channel.keywords.length : 0;
  return count > 0 ? `關鍵字 ${count}` : '全部影片';
};


// 頻道本地與雲端備份/還原功能
const channelFileInputRef = ref<HTMLInputElement | null>(null);


const exportChannelsJson = async () => {
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
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const fileName = `avd_channels_${dateStr}.json`;

  if (!isTauri()) {
    // Android (Capacitor) 環境：使用 Filesystem 與 Share
    try {
      const result = await Filesystem.writeFile({
        path: fileName,
        data: jsonStr,
        directory: Directory.Cache,
        encoding: Encoding.UTF8
      });
      await Share.share({
        title: `匯出 AVD 頻道備份 (${dateStr})`,
        url: result.uri,
        dialogTitle: `儲存或分享頻道備份 (${dateStr})`
      });
      showToast(`已成功匯出 ${monitoredChannels.value.length} 個頻道備份！`);
    } catch (e: any) {
      reportError('匯出頻道清單', e);
    }
  } else {
    // Windows (Tauri) 環境：使用原生存檔對話框
    try {
      const filePath = await save({
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        defaultPath: fileName,
      });
      if (filePath) {
        await writeTextFile(filePath, jsonStr);
        showToast(`已成功匯出 ${monitoredChannels.value.length} 個頻道備份！`);
      }
    } catch (e: any) {
      reportError('匯出頻道清單', e);
    }
  }
};

const triggerImportChannels = () => {
  if (channelFileInputRef.value) {
    channelFileInputRef.value.value = '';
    channelFileInputRef.value.click();
  }
};

const showRestoreSheet = ref(false);
const restoreIncomingChannels = ref<any[]>([]);
const restoreSourceName = ref('');
const restoreActions = [
  { name: '合併現有', subname: '保留現有頻道並自動去重加入' },
  { name: '覆蓋現有', subname: '以備份檔完全取代現有清單', color: '#ee0a24' }
];

/**
 * 由備份項目建構頻道物件。覆蓋與合併兩條還原路徑共用，確保關鍵字
 * 正規化只有一處實作 —— 缺少欄位的舊版備份、含非字串／空白／重複值的
 * 備份，皆在此收斂為正規化後的陣列。
 *
 * @param anchor 已由 conservativeAnchor 決定的時間錨點；`undefined`
 *   代表兩方皆無有效錨點，此時**不得**以當下時間建立錨點 —— 連
 *   `lastCheckTime` 也必須留空，否則 `channelBaseline` 的向下相容鏈
 *   （`lastPublishedTime || lastCheckTime || 0`）會讓污染從該欄位復活。
 */
const buildRestoredChannel = (c: any, anchor?: number): MonitoredChannel => ({
  channelId: c.channelId,
  title: c.title || c.channelId,
  thumbnail: c.thumbnail || 'https://www.youtube.com/favicon.ico',
  enabled: c.enabled !== false,
  lastPublishedTime: anchor,
  lastCheckTime: anchor,
  lastKnownVideoId: c.lastKnownVideoId || '',
  lastVideoTitle: c.lastVideoTitle || '',
  keywords: normalizeChannelKeywords(c?.keywords).keywords,
});

/** 備份項目中的時間錨點（沿用既有的向下相容鏈）。 */
const backupAnchorOf = (c: any): number | undefined =>
  c?.lastPublishedTime || c?.lastCheckTime || undefined;

const onRestoreActionSelect = (action: any) => {
  const validChannels = restoreIncomingChannels.value;
  if (action.name === '覆蓋現有') {
    // 覆蓋：錨點取本機與備份中較舊者。
    // 關鍵字改變了錨點的語意（推進不再只代表「已下載」，也代表「已略過」），
    // 直接採用備份中較新的錨點會使未設關鍵字的本機裝置永久漏掉那批影片。
    const localAnchors = new Map(
      monitoredChannels.value.map(c => [c.channelId, c.lastPublishedTime || c.lastCheckTime || undefined])
    );
    monitoredChannels.value = validChannels.map(c =>
      buildRestoredChannel(c, conservativeAnchor(localAnchors.get(c.channelId), backupAnchorOf(c)))
    );
    showToast(`已覆蓋還原 ${monitoredChannels.value.length} 個頻道！`);
  } else if (action.name === '合併現有') {
    // 合併：新增頻道採用備份錨點；已存在的頻道維持本機錨點與關鍵字不變
    let added = 0;
    let keptLocalKeywords = 0;
    validChannels.forEach(c => {
      if (!monitoredChannels.value.some(existing => existing.channelId === c.channelId)) {
        monitoredChannels.value.push(buildRestoredChannel(c, backupAnchorOf(c)));
        added++;
      } else if (normalizeChannelKeywords(c?.keywords).keywords.length > 0) {
        // 依既有去重規則保留本機頻道，其關鍵字不得被匯入值覆寫或合併；
        // 但必須告知使用者，否則會誤以為關鍵字已同步
        keptLocalKeywords++;
      }
    });
    const keptHint = keptLocalKeywords > 0
      ? `（${keptLocalKeywords} 個頻道已存在，保留本機關鍵字設定、未套用匯入值）`
      : '';
    showToast(`合併完成！新增了 ${added} 個頻道 (現共 ${monitoredChannels.value.length} 個)${keptHint}`);
  }
  showRestoreSheet.value = false;
};

const confirmRestoreChannels = (incomingChannels: any[], sourceName: string) => {
  const validChannels = incomingChannels.filter(c => c && c.channelId && typeof c.channelId === 'string');
  if (validChannels.length === 0) {
    showToast('備份檔案中無有效的頻道資料');
    return;
  }
  restoreIncomingChannels.value = validChannels;
  restoreSourceName.value = sourceName;
  showRestoreSheet.value = true;
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
      reportError('讀取頻道備份', err);
    }
  };
  reader.readAsText(file);
};


/**
 * 將計算出的錨點寫回頻道。`anchor` 為 null 時完全不動任何欄位 ——
 * 包含 lastCheckTime：`lastPublishedTime || lastCheckTime` 的向下相容鏈
 * 會讓單獨更新的 lastCheckTime 把當下時間當成基準復活。
 */
const applyChannelAnchor = (channel: MonitoredChannel, anchor: ChannelAnchor | null, now: number) => {
  if (!anchor) return;
  channel.lastPublishedTime = anchor.publishedTime;
  channel.lastCheckTime = now;
  channel.lastKnownVideoId = anchor.videoId;
  channel.lastVideoTitle = anchor.title;
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

  apiQuotaDegradedThisRound = false;
  apiKeyRejectedThisRound = false;

  let newVideoCount = 0;
  // 符合既有新片條件、但未命中關鍵字而未建立任務的影片數（K）。
  // 與 newVideoCount（N）互斥：命中但因直播／狀態未知而未處理者兩者皆不計入。
  let keywordFilteredCount = 0;
  let fallbackVideoCount = 0;
  let failedCount = 0;
  const failedLevels: ChannelRssErrorLevel[] = [];
  const now = Date.now();
  // 提早停止：偵測到裝置網路層錯誤即中止本輪（裝置連不上網，剩餘頻道不可能有不同結果）。
  let stoppedEarly = false;
  let skippedChannelCount = 0;
  // 降級：連續失敗達門檻後，本輪其餘頻道改為單次嘗試（不重試）。
  // 刻意不用 break —— 若清單前段有數個永久失效的頻道，整輪停止會讓後段健康頻道每輪都被餓死。
  let consecutiveFailures = 0;
  let degraded = false;
  let degradedChannelCount = 0;

  for (let i = 0; i < enabledChannels.length; i++) {
    const channel = enabledChannels[i];
    try {
      if (degraded) degradedChannelCount++;
      const videos = await DownloadService.fetchChannelVideos(channel.channelId, {
        enableFallback: monitorConfig.value.enableYtDlpFallback,
        noRetry: degraded,
        api: buildApiOptions(channel)
      });
      consecutiveFailures = 0;
      if (!videos || videos.length === 0) continue;

      const channelLastPub = channelBaseline(channel);

      if (isFirstTimeTracking(channel)) {
        // 首次追蹤：以最新影片的發布時間建立初始防線，不觸發下載。
        // 只看 videos[0]：若來源未提供精確時間（備援模式的 publishedTime 為 0），
        // 則不建立基準 —— 維持未初始化狀態，待下次能取得精確時間時再錨定。
        // 切勿以當下時間替代：那會把基準推至未來，使該時點之前發布的影片永久漏抓。
        // 刻意不套用「不越過未處理影片」那道守門：此情境本就不下載任何既有內容。
        applyChannelAnchor(channel, nextChannelBaseline([videos[0]], 0), now);
        continue;
      }

      // 本次未被實際處理的影片（因直播而跳過，或直播狀態查詢失敗而無從判定）。
      // 時間錨點不得越過這些影片，否則它們日後即使可正常下載也永遠不會再被判定為新片
      // —— 排程直播的 publishedTime 是「建立時間」，在直播結束轉為存檔後並不會改變。
      //
      // 未命中關鍵字的影片**不列入**此集合：那是使用者明確要求永久略過的項目，
      // 錨點必須能越過，否則每輪都會重新比對整個 Feed。
      const unhandledVideoIds = new Set<string>();

      // 關鍵字篩選必須先於直播狀態驗證 —— 未命中的影片不得觸發任何直播查詢
      // 或額外的影片資訊擷取。fetchChannelVideos 已把官方 RSS 與 yt-dlp 備援
      // 併為一條帶 source 標記的陣列，因此兩種來源自動共用這條篩選路徑。
      const newVideos = selectNewVideos(videos, channelLastPub, tasks.value);
      const { matched, missed } = partitionByKeywords(newVideos, channelKeywords(channel));
      keywordFilteredCount += missed.length;

      // reverse() 使較舊的影片先進入佇列，較新者最後 unshift 而位於最前。
      // matched 為 partitionByKeywords 產生的新陣列，reverse 不影響 videos 的順序。
      const ordered = matched.reverse();

      // 兩段式：先一次解析整組候選的直播狀態，再走訪建立任務。
      // 交織在同一輪走訪中就無法批次 —— API 可用時單次請求可涵蓋 50 支，
      // 取代逐支各開一個 yt-dlp 行程。無金鑰時內部自動退回逐支，
      // 故此處不需要知道金鑰是否存在。
      const liveStatuses = await DownloadService.resolveLiveStatuses(ordered, {
        api: buildApiOptions(channel)
      });

      for (const vid of ordered) {
        // 查不到一律視為 unknown —— 保守處置，阻擋錨點並於下輪重新評估
        const liveStatus = liveStatuses.get(vid.videoId) ?? 'unknown';
        if (liveStatus !== 'not_live') {
          // 兩種狀態的處置刻意不同：
          //
          // 'live'（直播中或排程未開播）—— 系統**已知**且明確不予下載，與未命中
          //   關鍵字的影片同列，錨點得以越過。以壓住錨點來表達「之後再看」，在
          //   每日建立排程直播的頻道（如新聞台）上會使錨點永久卡死：feed 中永遠
          //   有未處理影片，每輪把錨點之後的所有影片重新判定為新片，僅靠佇列去重
          //   掩蓋，使用者清空佇列時即全部湧入。
          //
          // 'unknown'（查詢失敗而無從判定）—— 尚未確定，仍須阻擋錨點以便下輪
          //   重新評估。此狀態為暫時性，且影片離開候選視窗後即自然停止阻擋。
          if (liveStatus === 'unknown') {
            unhandledVideoIds.add(vid.videoId);
            console.log(`[自動追蹤] 直播狀態查詢失敗，暫不處理: ${vid.title}`);
          } else {
            console.log(`[自動追蹤] 跳過直播/首播影片（錨點得以越過）: ${vid.title}`);
          }
          continue;
        }

        if (vid.source === 'fallback') {
          fallbackVideoCount++;
        }

        // 優先插隊至佇列最前面第一位！
        tasks.value.unshift(buildChannelVideoTask(vid, channel, taskStore.nextTaskId()));
        newVideoCount++;
      }

      applyChannelAnchor(channel, nextChannelBaseline(videos, channelLastPub, unhandledVideoIds), now);
    } catch (err) {
      failedCount++;
      const level = classifyChannelRssError(err);
      failedLevels.push(level);
      console.warn(`檢查頻道 ${channel.title} 失敗:`, err);
      // 只記入日誌、不逐頻道彈提示 —— 迴圈結束後由總結提示統一告知。
      try {
        errorLog.value = appendErrorEntry(errorLog.value, {
          time: Date.now(),
          context: `檢查頻道「${channel.title}」`,
          message: (err as any)?.message || String(err)
        });
      } catch { /* 記錄失敗不得影響檢查流程 */ }

      if (level === 'network') {
        // 裝置端網路層錯誤：這台裝置現在確定連不上網，剩餘頻道逐一嘗試也不會有不同結果。
        skippedChannelCount = enabledChannels.length - (i + 1);
        // 停在最後一個頻道等於本輪其實已跑完 —— 不是提早結束，不可宣稱有頻道未檢查。
        stoppedEarly = skippedChannelCount > 0;
        break;
      }

      consecutiveFailures++;
      if (!degraded && consecutiveFailures >= CHANNEL_CHECK_DEGRADE_AFTER_FAILURES) {
        // 連續失敗到達門檻：視為全域性故障，本輪其餘頻道不再支付重試等待，但仍逐一走訪。
        degraded = true;
        console.warn(`[自動追蹤] 連續 ${consecutiveFailures} 個頻道失敗，本輪其餘頻道改為單次嘗試`);
      }
    }
  }

  monitorConfig.value.lastGlobalCheckTime = now;
  isCheckingChannels.value = false;

  // 本輪 API 狀態片段。金鑰無效優先於配額耗盡 —— 前者需使用者修正，
  // 後者只需等待重置。抑制生效後續輪不再呼叫 API，故 onError 不再觸發，
  // 此片段自然只出現一次，不會每輪或每頻道重複騷擾。
  const apiHint = apiKeyRejectedThisRound
    ? describeApiKeyRejected()
    : apiQuotaDegradedThisRound
      ? describeApiQuotaDegraded()
      : '';

  const isFallbackEnabled = !!monitorConfig.value.enableYtDlpFallback;
  const failureLevel: ChannelRssErrorLevel = failedLevels.every(level => level === 'network')
    ? 'network'
    : failedLevels.includes('server')
      ? 'server'
      : 'content';

  if (stoppedEarly) {
    // 提早停止優先於下方既有四分支：failedCount 只計入實際跑過的頻道，
    // 硬套現有判斷會誤入「部分失敗」分支，讓使用者誤以為被跳過的頻道也檢查過。
    try {
      errorLog.value = appendErrorEntry(errorLog.value, {
        time: Date.now(),
        context: '頻道檢查（提早結束）',
        message: describeEarlyStop(skippedChannelCount)
      });
    } catch { /* 記錄失敗不得影響檢查流程 */ }

    if (newVideoCount > 0) {
      const sourceHint = fallbackVideoCount > 0 ? ` (⚠️ 含 ${fallbackVideoCount} 部備援抓取)` : ' [官方 RSS]';
      showToast(`🔔 發現 ${newVideoCount} 部新片${sourceHint}，已排隊下載！${describeKeywordFilteredSuffix(keywordFilteredCount)}（⚠️ ${describeEarlyStop(skippedChannelCount)}）${apiHint}`);
      processQueue();
    } else if (isManual) {
      const filteredHint = keywordFilteredCount > 0
        ? `${describeKeywordFilteredRound(keywordFilteredCount)}　`
        : '';
      showToast({
        message: `${filteredHint}⚠️ ${describeEarlyStop(skippedChannelCount)}${apiHint}`,
        duration: 5000,
        closeOnClick: true
      });
    }
  } else if (failedCount > 0 && failedCount >= enabledChannels.length) {
    // 全部失敗
    if (isManual) {
      // 逐頻道的原始錯誤已於迴圈中記入日誌，此處只做總結提示。
      const degradedHint = degradedChannelCount > 0 ? `（${describeDegradedRound(degradedChannelCount)}）` : '';
      showToast({
        message: `❌ ${describeChannelRssFailure(failureLevel, { fallbackEnabled: isFallbackEnabled })}${degradedHint}${apiHint}`,
        duration: 5000,
        closeOnClick: true
      });
    }
  } else if (newVideoCount > 0 && failedCount > 0) {
    // 有新影片但部分失敗
    const sourceHint = fallbackVideoCount > 0 ? ` (⚠️ 含 ${fallbackVideoCount} 部備援抓取)` : ' [官方 RSS]';
    const failHint = `⚠️ ${failedCount} 個頻道${describeChannelRssFailure(failureLevel, { fallbackEnabled: isFallbackEnabled, compact: true })}`;
    showToast(`🔔 發現 ${newVideoCount} 部新片${sourceHint}，已排隊下載！${describeKeywordFilteredSuffix(keywordFilteredCount)}（${failHint}）${apiHint}`);
    processQueue();
  } else if (newVideoCount > 0) {
    // 全部成功且有新影片
    const sourceHint = fallbackVideoCount > 0 ? ` (⚠️ 包含 ${fallbackVideoCount} 部 yt-dlp 備援抓取)` : ' [官方 RSS]';
    showToast(`🔔 發現 ${newVideoCount} 部新影片${sourceHint}，已優先加入下載佇列！${describeKeywordFilteredSuffix(keywordFilteredCount)}${apiHint}`);
    processQueue();
  } else if (isManual && failedCount > 0) {
    // 沒新影片但部分失敗
    // K 大於零時 MUST NOT 顯示「目前沒有新影片」—— 那正是本能力要防止的假陽性
    const noNewHint = keywordFilteredCount > 0
      ? describeKeywordFilteredRound(keywordFilteredCount)
      : '已檢查完成，目前沒有新影片';
    showToast(`${noNewHint}（⚠️ ${failedCount} 個頻道${describeChannelRssFailure(failureLevel, { fallbackEnabled: isFallbackEnabled, compact: true })}${failureLevel === 'network' ? '' : !isFallbackEnabled ? '，可於設定開啟備援' : ''}）${apiHint}`);
  } else if (isManual) {
    // 全部成功且沒新片。K 大於零代表「有新片但被自己的關鍵字篩掉」，
    // 與「真的沒有新片」是兩回事，MUST 以不同文案區分。
    showToast((keywordFilteredCount > 0
      ? describeKeywordFilteredRound(keywordFilteredCount)
      : '已檢查完成 [官方 RSS]，目前沒有新影片') + apiHint);
  }
};

const simulateNewVideo = async (channel: MonitoredChannel) => {
  showLoadingToast({ message: '正在模擬抓取最新影片...', forbidClick: true });
  try {
    const videos = await DownloadService.fetchChannelVideos(channel.channelId, {
      enableFallback: monitorConfig.value.enableYtDlpFallback,
      api: buildApiOptions(channel)
    });
    closeToast();
    if (!videos || videos.length === 0) {
      showToast('無法取得該頻道影片清單');
      return;
    }

    // 模擬會實際建立下載任務，若繞過關鍵字會讓使用者誤認正式排程也不受篩選控制。
    // 取最新的「命中」影片；無命中時顯示專用提示且不建立任何測試任務。
    const { matched, missed } = partitionByKeywords(videos, channelKeywords(channel));
    if (matched.length === 0) {
      showToast(describeChannelKeywordMiss(channel.title, missed.length));
      return;
    }

    const latestVideo = matched[0];
    const pubTimeStr = formatPublishTime(latestVideo.publishedTime) || formatPublishTime(Date.now());
    const sourceLabel = `【測試模式 (${channelSourceLabel(latestVideo.source)})】`;
    const testTitle = `[測試模擬] ${buildTaskDisplayTitle(latestVideo.title, channel.title, pubTimeStr)}`;

    const testTask: DownloadTask = {
      id: taskStore.nextTaskId(),
      type: 'file',
      isGroup: false,
      url: latestVideo.url,
      title: testTitle,
      rawTitle: `[測試模擬] ${latestVideo.title}`,
      publishTimeStr: pubTimeStr,
      channelPrefix: channel.title,
      status: 'pending',
      progress: 0,
      eta: '',
      line: `${sourceLabel}優先排隊下載中...`,
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
    reportError('測試抓取', e);
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
  // 因關鍵字全數未命中而未建立任務的頻道數與影片數
  let keywordMissChannels = 0;
  let keywordMissVideos = 0;

  try {
    for (const channel of enabledChannels) {
      try {
        const videos = await DownloadService.fetchChannelVideos(channel.channelId, {
          enableFallback: monitorConfig.value.enableYtDlpFallback,
          api: buildApiOptions(channel)
        });
        if (!videos || videos.length === 0) continue;

        // 每頻道最多取最新 2 集「命中關鍵字」的影片；未命中者不建立測試任務
        const { matched, missed } = partitionByKeywords(videos, channelKeywords(channel));
        if (matched.length === 0) {
          keywordMissChannels++;
          keywordMissVideos += missed.length;
          continue;
        }
        const topVideos = matched.slice(0, 2);
        // 按時間正序反轉插入，讓最新的在最頂部
        for (const vid of topVideos.reverse()) {
          const pubTimeStr = formatPublishTime(vid.publishedTime) || formatPublishTime(Date.now());
          const taskTitle = `[測試模擬] ${buildTaskDisplayTitle(vid.title, channel.title, pubTimeStr)}`;
          const sourceLabel = `【測試模式 (${channelSourceLabel(vid.source)})】`;

          const testTask: DownloadTask = {
            id: taskStore.nextTaskId(),
            type: 'file',
            isGroup: false,
            url: vid.url,
            title: taskTitle,
            rawTitle: `[測試模擬] ${vid.title}`,
            publishTimeStr: pubTimeStr,
            channelPrefix: channel.title,
            status: 'pending',
            progress: 0,
            eta: '',
            line: `${sourceLabel}優先排隊下載中...`,
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
    } else if (keywordMissChannels > 0) {
      // 有取到影片但全被關鍵字篩掉 —— MUST NOT 混為「取不到影片」
      showToast(`已檢查 ${keywordMissChannels} 個頻道共 ${keywordMissVideos} 部影片，但都不符合關鍵字設定，未建立測試任務`);
    } else {
      showToast('未能取得任何頻道的影片');
    }
  } catch (e: any) {
    closeToast();
    reportError('模擬新片', e);
  }
};

const url = ref('');
const mp3Mode = storage.defineSetting('avd_mp3_mode', false);

/**
 * 解析進行中的對話框。
 *
 * 刻意不用 showLoadingToast：vant 的 `forbidClick` 會把
 * `van-toast--unclickable` 加在 document.body 上，而該 class 的 CSS 是
 * `.van-toast--unclickable * { pointer-events: none }` —— 對 body 的所有
 * 後代關閉指標事件，**包含 toast 自己**。故 forbidClick 與 closeOnClick
 * 互斥，Toast 上做不出「擋住頁面但自己可點」的取消途徑。
 *
 * 改用只帶「取消」鈕的對話框：遮罩照樣擋住頁面，取消是明確的按鈕而非
 * 猜測性的點擊，也不會被誤觸。
 */
const showParsingModal = ref(false);
const parsingMessage = ref('');
/** 由目前進行中的解析註冊；對話框的取消鈕透過它回呼。 */
let parseCancelHandler: (() => void) | null = null;

const openParsingModal = (message: string, onCancel: () => void) => {
  parsingMessage.value = message;
  parseCancelHandler = onCancel;
  showParsingModal.value = true;
};

const closeParsingModal = () => {
  showParsingModal.value = false;
  parseCancelHandler = null;
};

const onParsingCancel = () => {
  const handler = parseCancelHandler;
  parseCancelHandler = null;
  handler?.();
};

/** 錯誤日誌：讓失敗訊息在提示消失後仍可回看與複製。 */
const errorLog = storage.defineSetting<ErrorEntry[]>('avd_error_log', []);
const showErrorLogModal = ref(false);
const displayedErrorLog = computed(() => sortedForDisplay(errorLog.value));

/**
 * 錯誤的單一回報入口：同時寫入日誌並顯示提示。
 *
 * 刻意合為一個函式而非分別呼叫 —— 分開必然會漏，單一入口讓
 * 「提示了就一定有紀錄」成為結構保證而非紀律要求。
 *
 * 提示延長至 5 秒並可點擊關閉；讀不完的部分由日誌承接。
 */
const reportError = (context: string, error: unknown) => {
  const message = (error as any)?.message || String(error);
  try {
    errorLog.value = appendErrorEntry(errorLog.value, { time: Date.now(), context, message });
  } catch (e) {
    // 記錄失敗絕不可讓原本的錯誤處理更糟 —— 這裡本來就已經在錯誤路徑上了。
    console.error('寫入錯誤日誌失敗', e);
  }
  // 限流是暫時性的，原始訊息（一長串 HTTP Error 429...）只會讓使用者
  // 以為程式壞了。改寫只發生在呈現層 —— 日誌留的仍是原文。
  const shown = shouldBackoff(message)
    ? `${context}：${describeRateLimit(message)}`
    : `${context}失敗: ${message}`;
  showToast({ message: shown, duration: 5000, closeOnClick: true });
};

const copyErrorLog = async () => {
  try {
    await navigator.clipboard.writeText(formatErrorLog(errorLog.value));
    showToast('已複製錯誤紀錄');
  } catch (e) {
    // 靜默失敗會讓使用者以為複製成功、貼出空白，比直接說失敗更糟。
    showToast({ message: '複製失敗，此裝置可能不允許存取剪貼簿', duration: 5000, closeOnClick: true });
  }
};

/** 「複製全部」不應順手關掉對話框 —— 使用者往往要複製後再看一眼。 */
const onErrorLogClose = async (action: string) => {
  if (action === 'confirm') {
    await copyErrorLog();
    return false;
  }
  return true;
};

const clearErrorLog = () => {
  errorLog.value = [];
  showToast('已清空錯誤紀錄');
};

/** 各來源的解析進度：key 為 parseProgressKey 正規化後的來源鍵。 */
const parseProgress = storage.defineSetting<Record<string, ParseProgress>>('avd_parse_progress', {});

const wifiSsid = storage.defineSetting('avd_wifi_ssid', '');
const wifiPassword = storage.defineSetting('avd_wifi_pwd', '');
const showWifiModal = ref(false);
const showSettingsModal = ref(false);

const ytDlpVersion = ref('讀取中...');
const ytDlpLastUpdate = ref(localStorage.getItem('yt_dlp_last_update_check') || '尚未更新');

const fetchYtDlpInfo = async () => {
  ytDlpVersion.value = await DownloadService.getYtDlpVersion();
  ytDlpLastUpdate.value = localStorage.getItem('yt_dlp_last_update_check') || '尚未更新';
};

watch(showSettingsModal, async (val) => {
  if (val) {
    await fetchYtDlpInfo();
  }
});

const handleManualUpdateYtDlp = async () => {
  showLoadingToast({
    message: '正在更新 yt-dlp...',
    forbidClick: true,
    duration: 0
  });
  try {
    await DownloadService.updateYtDlp();
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('yt_dlp_last_update_check', today);
    await fetchYtDlpInfo();
    closeToast();
    showToast('yt-dlp 更新成功');
  } catch (err: any) {
    closeToast();
    reportError('yt-dlp 更新', err);
  }
};

const confirmDeleteAll = storage.defineSetting('avd_confirm_delete_all', true);
const confirmDeleteSingle = storage.defineSetting('avd_confirm_delete_single', true);
const confirmClearAll = storage.defineSetting('avd_confirm_clear_all', true);
const confirmClearSingle = storage.defineSetting('avd_confirm_clear_single', true);
const testModeEnabled = storage.defineSetting('avd_test_mode_enabled', false);

// 設定項的變更由 useStorage 自動持久化，此處僅提供使用者回饋
const saveWifiConfig = () => {
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

// buildTaskDisplayTitle 已移至 services/displayFormat.ts（純函式，可被測試引用）



const expandAll = () => {
  taskStore.setAllExpanded(true);
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
  taskStore.setAllExpanded(false);
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

const showPlaylistModal = ref(false);
const parsedChannelTitle = ref('');
const parsedPlaylistTitle = ref('');
const parsedPlaylistItems = ref<PlaylistItem[]>([]);

/**
 * 補齊可被取消：對話框關閉（略過或確認）皆停止背景行程 ——
 * 確認後清單已定案交給下載，補齊不再有意義；略過則使用者根本不需要它。
 */
const onBatchModalCancel = () => {
  DownloadService.cancelEnrich().catch(e => console.warn('取消補齊失敗', e));
};

const onBatchModalConfirm = (selectedItems: PlaylistItem[]) => {
  DownloadService.cancelEnrich().catch(e => console.warn('取消補齊失敗', e));

  if (!selectedItems || selectedItems.length === 0) {
    showToast('請至少勾選一部影片');
    return;
  }

  const cleanChannel = parsedChannelTitle.value.replace(/[\/\\:*?"<>|]/g, '_').trim();
  const cleanPlaylist = parsedPlaylistTitle.value.replace(/[\/\\:*?"<>|]/g, '_').trim();
  const subFolderPath = `${cleanChannel}/${cleanPlaylist}`;

  const newSubTasks: DownloadTask[] = selectedItems.map(item => {
    const timeMatch = item.title ? item.title.match(/\s*(\(\d{4}\/\d{2}\/\d{2}[^\)]*\))$/) : null;
    const pubTime = timeMatch ? timeMatch[1].replace(/[()]/g, '').trim() : '';
    const raw = item.title ? item.title.replace(/\s*\(\d{4}\/\d{2}\/\d{2}[^\)]*\)$/, '').trim() : '';
    const finalTitle = buildTaskDisplayTitle(raw || item.title, '', pubTime);

    return {
      id: taskStore.nextTaskId(),
      type: 'file',
      isGroup: false,
      url: item.url,
      title: finalTitle || item.title,
      rawTitle: raw || item.title,
      publishTimeStr: pubTime,
      channelPrefix: parsedChannelTitle.value,
      status: 'pending',
      progress: 0,
      eta: '',
      line: '排隊等待中...',
      path: '',
      errorMsg: '',
      mediaUri: '',
      isAudio: mp3Mode.value,
      subFolder: subFolderPath
    };
  });


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
        id: taskStore.nextTaskId(),
        type: 'playlist',
        playlistTitle: parsedPlaylistTitle.value,
        status: 'pending',
        expanded: true,
        subTasks: newSubTasks
      });
    }
  } else {
    channelGroup = {
      id: taskStore.nextTaskId(),
      type: 'channel',
      isChannelGroup: true,
      channelTitle: parsedChannelTitle.value,
      status: 'pending',
      expanded: true,
      playlists: [{
        id: taskStore.nextTaskId(),
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

const removePlaylistGroup = (channel: ChannelGroupTask, playlistId: number) => {
  const playlist = channel.playlists.find(p => p.id === playlistId);
  const doRemove = () => taskStore.removePlaylistFromChannel(channel, playlistId);

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
  const doRemove = () => taskStore.removeTaskById(channelId);

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
  taskStore.removeSubTask(playlist, subId);
};


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

  // 來源的一切判斷（是否多片、要不要事前確認、能否追蹤、進度鍵、
  // 項目網址組法）皆由 sourceProfiles.ts 的能力表提供，此處不再比對字串。
  const sourceProfile = resolveSourceProfile(urlToAdd);

  if (sourceProfile.kind === 'unsupported') {
    // 已知不支援：明講，而非讓它落入 generic extractor 後產生困惑的失敗。
    // 置於追蹤詢問之前 —— 不支援的來源連問都不該問。
    showToast({
      message: `${sourceProfile.label}目前無法解析`,
      duration: 4000,
      closeOnClick: true
    });
    return;
  }

  // 能否加入自動追蹤由能力表宣告；此處另排除子頁面 —— 那是網址形狀的
  // 問題（頻道底下的 /watch 或 /playlist），與來源本身的能力無關。
  const isStrictChannelUrl = sourceProfile.supportsChannelTracking
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
            thumbnail: channelInfo.thumbnail || 'https://www.youtube.com/favicon.ico',
            enabled: true,
            lastCheckTime: Date.now(),
            keywords: []
          });
          // 設定項的變更由 useStorage 自動持久化
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

  const isPlaylistUrl = sourceProfile.kind === 'collection';

  // 高成本的創作者頁面解析須先徵詢確認。
  // 刻意不併入 isStrictChannelUrl：那條路徑會連帶詢問「加入自動追蹤」，
  // 而 TikTok／Douyin 沒有追蹤能力，resolveYouTubeChannel 對它們也不適用。
  const isCreatorPageUrl = sourceProfile.needsPreParseConfirm;

  // 本次要抓的批次範圍，由該來源已記錄的進度決定。
  // 多序列來源（YouTube 頻道的 Videos／Live／Shorts）逐序列記錄 ——
  // 以合計筆數定址會讓較長的分頁在合計超過其長度後再也取不到內容。
  const progressKey = parseProgressKey(urlToAdd);
  const multiSequence = sourceProfile.expandsToSequences;
  let progressView = collectSourceProgress(parseProgress.value, progressKey, multiSequence);
  let fetchedBefore = progressView.sequences[SINGLE_SEQUENCE]?.fetched || 0;
  const sourceComplete = progressView.allComplete;

  const restartFromScratch = () => {
    parseProgress.value = resetSourceProgress(parseProgress.value, progressKey, multiSequence);
    progressView = collectSourceProgress(parseProgress.value, progressKey, multiSequence);
    fetchedBefore = 0;
  };

  // 有進度時一律徵詢確認（讓使用者知道本次抓的是哪一段）；
  // 無進度時只有高成本的創作者頁面才需要事前確認。
  if (isPlaylistUrl && (isCreatorPageUrl || progressView.hasAny)) {
    // 多序列來源不報單一合計數字 —— 「200」對它的意義是「每序列 200」。
    const rangeHint = describeNextBatch(progressView, multiSequence);
    let message: string;
    let confirmText: string;

    if (sourceComplete) {
      message = `此來源先前已抓完（${describeProgress(progressView, multiSequence)}）。

要從頭重新抓取嗎？`;
      confirmText = '從頭開始';
    } else if (progressView.hasAny) {
      message = `此來源已抓過 ${describeProgress(progressView, multiSequence)}。

本次將抓取 ${rangeHint}。`;
      confirmText = '繼續抓下一批';
    } else if (multiSequence) {
      message = `此網址指向創作者的全部作品，底下可能有多個分頁。

本次將抓取${rangeHint}，其餘可日後再次輸入同一網址接續抓取。`;
      confirmText = '掃描並選擇下載';
    } else {
      message = `此網址指向創作者的全部作品。

本次將抓取前 ${PARSE_BATCH_SIZE} 部，其餘可日後再次輸入同一網址接續抓取。`;
      confirmText = '掃描並選擇下載';
    }

    try {
      await showConfirmDialog({
        title: sourceComplete ? '重新抓取' : '掃描創作者頁面',
        message,
        confirmButtonText: confirmText,
        cancelButtonText: '略過',
        confirmButtonColor: '#1989fa'
      });
      if (sourceComplete) restartFromScratch();
    } catch {
      // 抓到一半時，取消後再問一次是否改為從頭開始（Vant 對話框只有兩個按鈕）
      if (progressView.hasAny && !sourceComplete) {
        try {
          await showConfirmDialog({
            title: '從頭開始？',
            message: `要改為從第 1 部重新抓取嗎？\n\n(先前記錄的 ${fetchedBefore} 部進度會被清除)`,
            confirmButtonText: '從頭開始',
            cancelButtonText: '放棄',
            confirmButtonColor: '#1989fa'
          });
          restartFromScratch();
        } catch {
          return;
        }
      } else {
        // 使用者略過：不啟動解析，也不顯示載入提示
        return;
      }
    }
  }

  if (isPlaylistUrl) {
    // 解析已結束（成功／失敗／逾時）後，關閉提示不應再被視為使用者取消。
    let parseSettled = false;
    let parseCancelled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const abortParse = () => {
      DownloadService.cancelParsePlaylist().catch(e => console.warn('取消解析失敗', e));
    };

    openParsingModal('正在解析播放清單資訊...', () => {
      if (!parseSettled) {
        parseSettled = true;
        parseCancelled = true;
        abortParse();
      }
    });

    try {
      // 總時長的唯一保證：--socket-timeout 只約束單次連線，擋不住反覆重試。
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => reject(new Error('PARSE_TIMEOUT')), PARSE_TIMEOUT_MS);
      });
      // 多序列來源的續抓：各序列帶自己的起點，而非以合計筆數定址。
      const pending = multiSequence ? pendingSequences(progressView) : {};
      const isSequenceContinuation = Object.keys(pending).length > 0;

      const res = await Promise.race([
        DownloadService.parsePlaylist(
          urlToAdd,
          isSequenceContinuation ? { sequences: pending } : { fetched: fetchedBefore }
        ),
        timeoutPromise
      ]);
      parseSettled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      closeParsingModal();

      // 解析在使用者按下取消後才回來：尊重取消，不彈出嚮導對話框。
      if (parseCancelled) return;

      // 只有解析成功才推進進度；失敗、逾時、取消都不動，使用者可原地重試。
      // 推進量取實際回傳筆數（未勾選的也算看過了）。
      if (res.sequenceReturns) {
        // 多序列：逐序列推進，未回傳的序列不動（例如已抓完者本就不再請求）。
        parseProgress.value = applySequenceResults(
          parseProgress.value, progressKey, pending, res.sequenceReturns
        );
      } else {
        parseProgress.value = {
          ...parseProgress.value,
          [progressKey]: advanceParseProgress(fetchedBefore, res.items?.length || 0)
        };
      }

      if (!res.items || res.items.length === 0) {
        showToast(fetchedBefore > 0 ? '已無更多影片可抓取' : '此播放清單無可下載的影片');
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

      // 補齊在對話框已顯示之後才啟動 —— 不延後使用者看到清單。
      // 只有 metadata 不完整的來源才需要（見來源能力表 flatMetadata）。
      if (sourceProfile.flatMetadata === 'none') {
        DownloadService.enrichPlaylistItems(
          freshItems.map(i => i.url),
          (chunk: EnrichedItem[]) => {
            // 就地更新欄位，id 序列不變 —— 勾選狀態以 id 記錄，
            // 換掉序列會讓已勾選的項目對不上。
            parsedPlaylistItems.value = mergeEnriched(parsedPlaylistItems.value, chunk);
          }
        ).catch(e => console.warn('補齊失敗', e));
      }
    } catch (e: any) {
      const wasTimeout = e?.message === 'PARSE_TIMEOUT';
      parseSettled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      closeParsingModal();

      if (wasTimeout) {
        // 逾時同樣要終止背景行程，否則會留下持續重試的孤兒行程。
        abortParse();
        showToast(`解析逾時（超過 ${Math.round(PARSE_TIMEOUT_MS / 1000)} 秒），已中止`);
      } else if (e?.message !== PARSE_CANCELLED) {
        reportError('解析播放清單', e);
      }
      // 使用者主動取消不顯示錯誤訊息
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
    id: taskStore.nextTaskId(),
    type: 'file',
    isGroup: false,
    url: urlToAdd,
    title: '',
    rawTitle: '',
    publishTimeStr: '',
    channelPrefix: '',
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

// PERMANENT_DOWNLOAD_ERRORS / LIVE_RELATED_ERRORS / matchPermanentError
// 已移至 services/downloadErrors.ts（純函式，可被測試引用），連同其說明註解。

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
      
      // 結構化屬性更新
      if (result.rawTitle) {
        nextTask.rawTitle = result.rawTitle;
      } else if (result.title) {
        nextTask.rawTitle = result.title;
      }

      if (result.publishTimeStr) {
        nextTask.publishTimeStr = result.publishTimeStr;
      }
      if (result.channelPrefix && !nextTask.channelPrefix) {
        nextTask.channelPrefix = result.channelPrefix;
      }

      // 若結構化欄位尚未填入，嘗試從原 title 反向解析
      if (!nextTask.publishTimeStr && nextTask.title) {
        const timeMatch = nextTask.title.match(/\s*(\(\d{4}\/\d{2}\/\d{2}[^\)]*\))$/);
        if (timeMatch) nextTask.publishTimeStr = timeMatch[1].replace(/[()]/g, '').trim();
      }
      if (!nextTask.channelPrefix && nextTask.title) {
        const prefixMatch = nextTask.title.match(/^\[([^\]]+)\]/);
        if (prefixMatch) nextTask.channelPrefix = prefixMatch[1].trim();
      }

      // 統一合成最終標題，確保時間標記與頻道前綴完整保留
      nextTask.title = buildTaskDisplayTitle(
        nextTask.rawTitle || result.title || nextTask.title || '',
        nextTask.channelPrefix,
        nextTask.publishTimeStr
      );

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

      // 確定性錯誤重試必然再次失敗，立即結束並如實說明原因，
      // 不再顯示暗示問題可能是暫時性的「已自動重試 N 次」。
      const { permanent, liveRelated } = matchPermanentError(errorMsgStr);
      if (permanent) {
        nextTask.status = 'error';
        nextTask.errorMsg = liveRelated
          ? '此影片為直播或尚未開播，暫時無法下載'
          : errorMsgStr;
        nextTask.line = nextTask.errorMsg;
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
    reportError('刪除檔案', e);
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
    reportError('播放檔案', errStr);
    console.error('Play video error:', e);
  }
};

const openDownloadFolder = async () => {
  await DownloadService.openDownloadFolder();
};

const driveToken = storage.defineSetting('avd_drive_token', '');
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
      reportError('備份頻道清單', e);
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
    reportError('雲端備份', task.uploadErrorMsg);
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
    reportError('啟動快傳服務', msg);
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
  networkStatus.stop();
});

// 從背景返回時檢查
App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
  if (isActive) {
    checkSharedUrl();
    // 部分 Android 版本的 WebView 在回到前景時不可靠觸發 visibilitychange，
    // 在此補一次手動刷新作為保險（見 useNetworkStatus 內建的可見性監聽為主要來源）。
    networkStatus.recheck();
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
    if (info.title || info.publishTimeStr || info.channelPrefix) {
      if (info.title) currentTask.rawTitle = info.title;
      if (info.publishTimeStr && !currentTask.publishTimeStr) currentTask.publishTimeStr = info.publishTimeStr;
      if (info.channelPrefix && !currentTask.channelPrefix) currentTask.channelPrefix = info.channelPrefix;

      if (!currentTask.publishTimeStr && currentTask.title) {
        const timeMatch = currentTask.title.match(/\s*(\(\d{4}\/\d{2}\/\d{2}[^\)]*\))$/);
        if (timeMatch) currentTask.publishTimeStr = timeMatch[1].replace(/[()]/g, '').trim();
      }
      if (!currentTask.channelPrefix && currentTask.title) {
        const prefixMatch = currentTask.title.match(/^\[([^\]]+)\]/);
        if (prefixMatch) currentTask.channelPrefix = prefixMatch[1].trim();
      }

      currentTask.title = buildTaskDisplayTitle(
        currentTask.rawTitle || currentTask.title || '',
        currentTask.channelPrefix,
        currentTask.publishTimeStr
      );
    }

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
.ns-spinner {
  width: 9px;
  height: 9px;
  border: 2px solid #9ca3af;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ns-spin 0.8s linear infinite;
  display: inline-block;
}
@keyframes ns-spin {
  to { transform: rotate(360deg); }
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
