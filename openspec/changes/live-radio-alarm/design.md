## Context

動機見 proposal.md「Why」。本節只記與做法直接相關的現況與限制。

- **播放路徑只有一條**：`DownloadService.playVideo` 在 Android 以 `ACTION_VIEW` 交給外部播放器、在 Windows 以 `open` 交給系統，App 內沒有播放器，也沒有任何背景執行的機制可在 WebView 停擺時動作。
- **既有的「定時」都是 JS 計時器**：頻道追蹤以 `setInterval` 輪詢，只在 App 活著時有效，不能當鬧鐘用。
- **Android 端已有前景服務基礎**：`KeepAliveService`（`dataSync` 型、notification id 1、channel `DownloadChannel`），持有 WakeLock 與 WifiLock 供下載使用。鬧鐘播放不能共用它 —— 型別不同（需 `mediaPlayback`），生命週期也不同（下載結束會 `stopSelf`）。
- **設定持久化在 Android 是 WebView 的 localStorage**（`LocalStorageAdapter`），原生端讀不到；`config-persistence` 規格要求所有設定走這個單一介面。本 change 以 MODIFIED delta 補上「原生端權威」例外，見 specs。
- **App 為側載發行**（GitHub Releases），不受 Google Play 對鬧鐘權限的政策限制，可以宣告 `USE_EXACT_ALARM`。
- **直播來源已實測**：官方播放頁以 jQuery 呼叫 `https://www.bcc.com.tw/webapi/BCCRadioWebAPI/ChannelInfoBat`，回傳各頻道的 `androidStream`（http）與 `iosStream`（https）；中廣新聞網目前為 `https://stream.rcs.revma.com/fgtx07f3qtzuv`，無長度的 ADTS AAC 串流，`curl` 可直接讀到音訊資料。社群資料庫（radio-browser）記載的是另一個 key，說明 **串流 key 會變**，不能只寫死。
- **節目時間**：06:00《早安新聞》／《中廣 10 分鐘早報》、07:00《中廣早報新聞》／《葉蓉早報》（維基百科與官方節目表，名稱不一，時段一致）。
- **minSdk 24、targetSdk 36**；`build.gradle` 已有 `google()` 與 `mavenCentral()`，加 media3 不需新增倉庫。JUnit 4 已在 `testImplementation`。

## Goals / Non-Goals

**Goals:**

- 時間到就響，可靠度對齊系統鬧鐘：Doze、螢幕關閉、App 被系統回收、重開機後皆成立。
- 串流網址變動時不需發新版：先問官方、再退回上次成功、最後退回內建。
- 所有新增的原生狀態（設定、上次結果、快取網址）集中一處，前端不另存。
- 不動既有的下載、頻道追蹤、`KeepAliveService`。

**Non-Goals:**

- Windows/Tauri 與 Android TV 的定時播放。
- 星期篩選、假日略過、多電台清單（中廣其他四個頻道雖可自同一 API 取得，不在本次）。
- App 內的一般播放器（下載檔仍交外部播放器）。
- 錄音、節目表顯示、「現正播出」資訊（API 有 `program` 欄位，留待日後）。

## Decisions

### D1 排程用 `AlarmManager.setAlarmClock()`，一律登錄「下一次」單次觸發

- **選擇**：每筆啟用時間各登錄一個 `setAlarmClock()`，觸發後在接收器內立刻登錄次日同一時刻；停用或刪除即 `cancel()`。
- **為什麼不是** `setExactAndAllowWhileIdle()`：兩者都能穿透 Doze，但 `setAlarmClock` 額外（a）在狀態列與系統「下一個鬧鐘」顯示，使用者看得到、(b) 明確屬於「使用者要求的精確鬧鐘」而享有 Android 12+ 從背景啟動前景服務的豁免、(c) 不受 `setExactAndAllowWhileIdle` 每 9 分鐘一次的節流。
- **為什麼不是 WorkManager／JobScheduler**：不保證準時，可能延遲數分鐘到數十分鐘，不符 60 秒內開始的要求。
- **為什麼不是 `setRepeating`**：API 19 起不精確，且 DST／時區變更的處理不透明；自己登錄下一次更可控。
- **權限**：`USE_EXACT_ALARM`（API 33+，安裝即授予，不可撤銷）與 `SCHEDULE_EXACT_ALARM`（API 31–32，預設授予、可被使用者撤銷）。啟用時以 `canScheduleExactAlarms()` 檢查，為 false 時開 `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` 設定頁並在介面說明後果。
- **下一次時刻的計算**抽成不依賴 Android API 的純 Java 類（一律用裝置預設時區），以 JUnit 測試釘住「已過→次日」「恰為同一分鐘→次日」「23:59」「跨月」「時區變更」等邊界，`gradlew :app:testDebugUnitTest` 執行。
  **實作時改用 `java.util.Calendar` 而非原訂的 `java.time`**：本專案 minSdk 為 24，而 `java.time` 需要 API 26，未啟用 core library desugaring 時會在 API 24／25 的裝置上直接崩潰。啟用 desugaring 會改變整個 App 的 D8 處理流程，代價大於此處所需；`Calendar` 自 API 1 起可用、同樣不依賴 Android API、同樣可在 JVM 測試，且台灣無日光節約，兩者在本用途下行為無差異。

### D2 觸發後：接收器 → `mediaPlayback` 前景服務

- 鬧鐘的 `PendingIntent` 指向 `BroadcastReceiver`，接收器只做三件事：登錄下一次、讀設定、`startForegroundService()`。播放邏輯全在服務內，避免接收器 10 秒限制。
- 服務為 **新類別**（不是擴充 `KeepAliveService`），`foregroundServiceType="mediaPlayback"`，需 `FOREGROUND_SERVICE_MEDIA_PLAYBACK`。通知用**獨立的 channel 與 id**，與下載通知（id 1）互不覆蓋。
- 服務持有 `PARTIAL_WAKE_LOCK`（上限＝結束時間＋緩衝）與 `WifiLock`；`onStartCommand` 收到新的 START 時若已在播放，只把結束時間更新為兩者較晚者（規格「重疊」情境），不重建播放器。
- 自動停止以 `Handler.postDelayed` 到結束時刻；「停止」按鈕的 `PendingIntent` 送 ACTION_STOP 回服務。
- **為什麼不是直接在接收器裡播**：接收器不能長時間存活；系統會在回傳後隨時回收程序。

### D3 播放器用 media3 ExoPlayer，不用 `android.media.MediaPlayer`

- 目標串流是無 Content-Length 的 icecast 型 ADTS AAC。`MediaPlayer` 對這類串流的表現依廠牌與版本不一（有的要等很久才起播、有的斷線不重連），而鬧鐘情境**沒有人在旁邊按重試**。ExoPlayer 對此成熟：可設定 `LoadErrorHandlingPolicy` 重試、支援 ICY、起播延遲可控。
- 成本：APK 約 +1.5 MB。可接受，本 App 已含 yt-dlp、ffmpeg 等大件。
- 音訊屬性 `USAGE_ALARM` + `CONTENT_TYPE_SPEECH`：走鬧鐘音量、勿擾模式仍會出聲（Android 預設允許鬧鐘），這是規格「鬧鐘語意」的實作依據。**替代案**：`USAGE_MEDIA` 走媒體音量 —— 靜音時不會響，與「鬧鐘」的預期相悖，不採。
- 音訊焦點請求 `AUDIOFOCUS_GAIN_TRANSIENT`：正在播的音樂暫停，結束後恢復。

### D4 來源解析：官方 API → 上次成功 → 內建常數

```
  自訂網址有值 ─────────────────────────────────> 直接用（不查 API）
  否則  GET ChannelInfoBat（逾時 5 秒）
          └─ 找 name == "中廣新聞網" ─> iosStream（https）優先，其次 androidStream
               成功 -> 播放並寫入 last_good_url
               失敗 -> last_good_url（若有）-> 內建常數 https://stream.rcs.revma.com/fgtx07f3qtzuv
```

- 用 `HttpURLConnection` 即可（JSON 小、單次），不引入新的 HTTP 依賴；`usesCleartextTraffic` 已開，但一律優先 https。
- 內建常數集中於一個常數類，與 `NETWORK_PROBE_URL` 同樣附註解說明來源與日期。
- **為什麼要問 API 而不是只寫死**：實測社群記錄的 key 與官方現行不同，key 會輪替；寫死等於某天早上無聲。
- **為什麼還要內建常數**：API 可能改版或下線；退回鏈末端必須有東西。

### D5 設定與狀態存在原生端 `SharedPreferences`（獨立檔 `avd_radio_alarm`）

- 內容：總開關、時間清單（JSON 陣列：id、HH:mm、enabled、durationMin）、自訂網址、`last_good_url`、上次結果（time、context、message、pendingJournal）。
- 插件方法：`getRadioAlarmConfig`、`setRadioAlarmConfig`（寫入後立即重新登錄全部鬧鐘）、`getRadioAlarmStatus`（下一次觸發、上次結果、權限狀態）、`testRadioAlarm`（試播 30 秒）、`stopRadioAlarm`、`consumeRadioAlarmJournal`（取出待寫入錯誤紀錄的摘要並清除 pending）。
- 前端**不**對這些鍵 `defineSetting`；設定區段開啟時呼叫 `getRadioAlarmConfig`，變更時整包 `setRadioAlarmConfig`。這正是 `config-persistence` MODIFIED delta 所允許並約束的形態。
- **替代案**：讓 Android 的儲存埠改成原生 Preferences，讓所有設定都能被原生讀到 —— 範圍太大且需遷移既有 localStorage 資料，不在本次。

### D6 重開機與時間變更：一個接收器接三個廣播

- `BOOT_COMPLETED`、`TIME_SET`、`TIMEZONE_CHANGED` → 讀設定 → 全部重新登錄（先 `cancel` 再 `set`）。需 `RECEIVE_BOOT_COMPLETED` 權限。
- 時鐘往前調越過某時刻時，「下一次」計算自然落到次日，不會補播（規格明訂）。

### D7 失敗處理與錯誤紀錄的延遞寫入

- 服務內自預定開始時刻起計時，累計 3 分鐘仍未進入 `STATE_READY` → 停止、發一則一般通知（非前景通知）說明原因、將摘要寫入 prefs 並標記 `pendingJournal=true`。
- 前端啟動時呼叫 `consumeRadioAlarmJournal`，有東西就 `reportError('早報鬧鐘', message)`（沿用既有錯誤紀錄流程，滿足 error-journal「未截斷原文」），寫完即清 pending，避免重複。
- **為什麼不即時寫**：錯誤紀錄住在 WebView 的 localStorage，觸發當下 WebView 多半沒在跑。

### D8 通知權限在啟用總開關時請求

- API 33+ 需 `POST_NOTIFICATIONS` 執行期權限。前景服務即使沒有此權限也照跑（只是通知不顯示），所以**播放不會因此失敗**，失去的是「停止」按鈕與失敗通知。介面依 `getRadioAlarmStatus` 回傳的權限狀態顯示說明與重新授權入口。
- 透過 Capacitor 的 `@Permission` 別名機制請求，不自己處理 requestCode。

### D9 介面：偏好設定新增區段，遵循 visual-language

- 以 `!isTauri()` 決定是否渲染（功能可用性的判斷，不是為了持久化判斷平台）。
- 結構：總開關 → 時間清單（每列：時間、時長 stepper、啟用 switch、移除 `ACTION_GLYPH.remove` 灰色）→ 新增（Vant `van-time-picker` 於 popup 內）→ 串流網址（`van-field`，空值代表用官方）→ 試播／停止 → 狀態行（下一次、上次結果、權限提示）。
- **沒有不可逆操作**：移除一筆時間只是設定調整，不用 `danger` 色；不加二次確認（與關鍵字標籤的移除一致）。
- 狀態行的成功／失敗以**文字**表達，不引入新顏色（visual-language：不得為單一元素另立顏色）。
- 前端純函式（`HH:mm` 驗證與正規化、由清單與現在時間算「下一次」顯示字串）放新的 service 模組並附 vitest；插件封裝亦放同模組。

### D11 音量分兩層：系統鬧鐘音量是上限，應用程式內的比例在其下縮放

實作後的追加範圍。原設計只寫「音量跟隨系統鬧鐘音量」，實際用起來有兩個缺口：使用者若覺得太大聲，只能去改**整台手機的鬧鐘音量**，連帶影響真正的鬧鐘；而早上被吵醒後打開 App 想調，按音量鍵調到的卻是媒體音量。

```
  系統鬧鐘音量（使用者的手機設定，本功能 MUST NOT 更動）
        ↓  上限
  應用程式內的比例 0-100%（player.setVolume，預設 100%）
        ↓
  實際輸出
```

- **用 `Player.setVolume(float)` 而非 `AudioManager.setStreamVolume`**：後者會改掉裝置的鬧鐘音量設定，使用者真正的鬧鐘會跟著變 —— 那是替使用者做了他沒要求的決定。前者只在本次播放的輸出上衰減，離開播放不留痕跡。
- **比例是單一全域設定，不做逐筆**：逐筆音量的用途難以想像（同一個人、同一個房間、相隔一小時），而每多一個逐筆欄位，時間列就更擠一分 —— 那一列已經在窄畫面上換行了。
- **播放中變更立即生效**：設定寫回後，若服務正在播放，插件送一則 `ACTION_SET_VOLUME` 給服務，服務自己重讀設定並套用。不重建播放器。
- **音量鍵**：`Activity.setVolumeControlStream(STREAM_ALARM)` 只在播放期間套用，停止後還原為 `USE_DEFAULT_STREAM_TYPE` —— 否則 App 平常的音量鍵行為會被改掉。Activity 於 `onResume` 依目前播放狀態決定，服務則在開始與停止時主動通知 Activity（以 WeakReference 持有，Activity 不存在時什麼都不做）。

**替代案：漸強（前 30 秒由小聲升到設定音量）** —— 使用者在此次範圍中未選擇，未實作。若日後要加，位置在 `preparePlayer` 之後以 Handler 分段調整 `setVolume`，與本決策不衝突。

### D12 手動直播是第三種模式，不是第二條播放路徑

實作後的追加範圍（使用者要求「加個直播鈕」，位置在電台那一排）。

播放服務因此從「一種行為＋一個 isTest 旗標」改為**三種模式**，共用同一個服務、同一套來源解析、同一套重試與通知：

```
  模式    音訊語意      長度              失敗的處理
  alarm   鬧鐘音量      該筆鬧鐘的時長    發通知 + 留給錯誤紀錄
  test    鬧鐘音量      30 秒             只留紀錄（使用者正看著畫面）
  live    媒體音量      3 小時上限        只留紀錄
```

- **紅線 2 仍然成立**：`ACTION_START` 的送出點仍只有接收器與插件，`new ExoPlayer.Builder` 仍只有一處。模式是**參數**，不是分岔的實作 —— 分岔才會出現「試播成功、早上不響」。
- **試播刻意維持鬧鐘音量**：它的用途就是驗證早上會不會響，換成媒體音量就驗不到真正要驗的東西。
- **手動直播改走媒體音量**：鬧鐘能蓋過靜音與勿擾，是因為使用者要求被叫醒；手動按播放並沒有這個要求，在會議中蓋過靜音放出聲音是錯的。代價是同一個功能有兩種音量來源，故介面在播放中必須顯示是哪一種（`describePlaybackState`）——否則使用者會對著沒反應的音量鍵發愣。
- **不受總開關約束**：「現在想聽廣播」與「明天早上要被叫醒」是兩件事，為了聽廣播而去開鬧鐘並不合理。
- **有上限而非無限**：「聽到我按停止為止」的正確實作不是無限 —— 忘了關的前景服務會整天持有 WakeLock 與 WifiLock。3 小時上限加上通知載明預計停止時間，要續聽再按一次。
- **介面需要輪詢**：播放在服務裡進行，前端不會被通知。設定開著時每 3 秒讀一次狀態；少了它，播放結束後按鈕會一直停在「停止」，試播失敗的原因也不會出現在狀態那一行（規格要求試播即時顯示結果）。關掉對話框即停 —— 這不是背景工作。
- **新增一個操作字元 `stop: '■'`**：方形即停止，與三角形向右即播放同一套準則。它與 `play` 出現在同一個位置、依狀態互換，故不會同時出現而需要互相區辨；`visualLanguage.spec.ts` 的「只有兩顆刪除共用字元」與「可復原動作不得歸為不可逆」兩條測試已同步。

### D10 試播走與正式觸發完全相同的路徑

- `testRadioAlarm` 直接以「結束時間＝現在＋30 秒」啟動同一個服務，來源解析、重試、通知全部一致。這樣試播成功就代表早上會成功，不會出現「試播用 A 路徑、鬧鐘用 B 路徑」的假安心。

## Risks / Trade-offs

- **[廠牌省電機制殺程序（小米、華為、OPPO 等）]** → `setAlarmClock` 是各家最少干預的鬧鐘型別；介面在偵測到非原生 Android 廠牌時提示「若未響起，請允許本 App 自啟動／關閉電池最佳化」，並提供 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 入口。無法保證所有廠牌，於 proposal 假設中已標示。
- **[官方 API 改版或串流 CDN 更換]** → 三層退回鏈；使用者可填自訂網址即時繞過，不需等新版。
- **[6 點 Wi-Fi 因 Doze 斷線、資料網路慢]** → WifiLock ＋ 3 分鐘重試窗；仍失敗則通知並記錄，不會無聲無息。
- **[Android 12+ 從背景啟動前景服務被拒]** → 精確鬧鐘屬豁免清單；若某版本仍拒絕，接收器捕捉 `ForegroundServiceStartNotAllowedException` 並改以 `setAlarmClock` 的 `showIntent` 拉起 Activity 再啟動服務（實作時以實機驗證是否需要此後路）。
- **[鬧鐘音量被使用者設為 0]** → 與系統鬧鐘同樣的限制；介面說明「音量跟隨系統鬧鐘音量」。不主動改音量（避免驚嚇）。
- **[ExoPlayer 增加 APK 體積、引入新依賴]** → 接受；鎖定版本，`gradlew` 離線建置需先同步一次依賴。
- **[錯誤紀錄延後到下次開 App 才寫]** → 通知已即時告知；紀錄的時間欄位用實際發生時間而非寫入時間，事後可對得上。
- **[日後若上架 Play，`USE_EXACT_ALARM` 需改申請]** → 目前側載，不影響；若上架再改為 `SCHEDULE_EXACT_ALARM` 引導授權，排程程式碼不變。

## Migration Plan

1. 新增功能預設**總開關關閉**，升級不改變任何既有行為；使用者手動開啟後才登錄鬧鐘。
2. 關閉總開關即取消全部鬧鐘並停止播放；解除安裝時 `SharedPreferences` 隨之刪除，無殘留。
3. 回滾：退回上一版 APK 即可，本 change 不改任何既有設定鍵或資料格式。

## Open Questions

- media3 的確切版本以實作當日 Google Maven 最新穩定版為準，鎖定於 `build.gradle`；不影響規格與任務。（實作時選用的版本記於 tasks.md 的 3.1。）
- 07:00 早報的實際長度（約 25 分鐘或整點檔 55 分鐘）未確認，使用者可調整時長，預設 30 分鐘不受此影響。
