## 0. 先讀：這個 change 的驗證重心在實機

九成邏輯在 Android 原生端，而原生端只有純 Java 的部分能跑單元測試（JUnit 4 已在 `testImplementation`，以 `gradlew :app:testDebugUnitTest` 執行）。鬧鐘、前景服務、Doze、勿擾這些行為**只能在實機驗證**，所以：

- 能抽成純函式的（下一次時刻計算、設定驗證與序列化、API 回應選網址）一律抽出並以 JUnit 釘住，讓實機驗證只剩「系統會不會照做」這一層。
- 實機驗證時把觸發時間設在 **2 分鐘後**，不必等到早上；驗證 Doze 用 `adb shell dumpsys deviceidle force-idle`。
- 每一組任務附帶該組的實機驗證項目，破了就知道是哪一組。

兩條紅線：

```
  1. 總開關預設關閉。升級的使用者隔天早上 MUST NOT 被無預警叫醒。
  2. 試播與正式觸發走同一條路徑。試播成功而早上失敗是本功能最糟的結果。
```

## 1. 原生端：可單元測試的核心（先做）

- [x] 1.1 建立 `RadioAlarmConfig`：資料模型（總開關、時間清單 {id, time, enabled, durationMin}、自訂網址）與 JSON 序列化／反序列化，含驗證：`HH:mm` 格式與範圖、清單內不得重複、時長 1–180、自訂網址須為 http(s)；完成方式：JUnit 涵蓋合法、越界（24:10、-1、181）、重複、空清單、損毀 JSON 回退預設，`gradlew :app:testDebugUnitTest` 綠燈

  16 個測試涵蓋：合法時間、24:10／06:60／-1／0600／空／null 等不合法輸入、
  重複時間（保留先出現者）、時長 -1 與 181 夾回範圍、損毀 JSON 與非物件 JSON
  回退預設、來回序列化一致。**預設值 masterEnabled=false 另有一條專門的測試**
  釘住紅線 1。
- [x] 1.2 建立 `RadioAlarmSchedule.nextTrigger(now, time, zone)` 純函式（`java.time`，不依賴 Android API）；完成方式：JUnit 涵蓋「今日尚未到→今日」「已過→次日」「恰為同一分鐘→次日」「23:59」「時區變更後以新時區計算」

  12 個測試。**實作改用 `java.util.Calendar` 而非 design.md 所寫的 `java.time`** ——
  本專案 minSdk 為 24，而 java.time 需要 API 26，未啟用 core library desugaring
  時會在 API 24／25 直接崩潰。Calendar 同樣不依賴 Android API、同樣可在 JVM 測試，
  且 Taipei 無日光節約，行為無差異。已同步更新 design.md 的 D1。
- [x] 1.3 建立 `RadioStreamResolver.pickStreamUrl(json)` 純函式：自 ChannelInfoBat 回應中找 `name == 中廣新聞網`，`iosStream`（https）優先、其次 `androidStream`，找不到回傳 null；完成方式：JUnit 以實測回應樣本（含五個頻道）與缺欄位、非 JSON、空陣列等樣本驗證

  8 個測試，樣本取自 2026-09-17 的實測回應（五個頻道，**目標頻道排第三** ——
  「挑第一個」這種寫法會在此被抓到）。另涵蓋缺欄位、只有 rtmp、非 JSON、空陣列、
  `[null,null]`、目標頻道不存在。
- [x] 1.4 建立內建常數類：預設串流網址 `https://stream.rcs.revma.com/fgtx07f3qtzuv`、官方 API 網址、逾時 5 秒、失敗窗 3 分鐘、試播 30 秒、預設時長 30，每個常數附註解說明來源與確認日期（比照 `NETWORK_PROBE_URL`）；完成方式：`grep` 確認這些數值在原生端只出現於此處

  `RadioAlarmConstants`。`grep` 確認串流網址、API 網址、5 秒、3 分鐘、30 秒、
  30 分鐘等值在原生端只出現於此處（測試檔中的期望值不計）。

## 2. 原生端：儲存與排程

- [x] 2.1 建立 `RadioAlarmStore`：以獨立的 `SharedPreferences`（`avd_radio_alarm`）持有設定 JSON、`last_good_url`、上次結果（time、context、message、pendingJournal）；完成方式：由 1.1 的序列化測試覆蓋格式，讀寫路徑由 2.3 與 4.3 的實機驗證覆蓋

  `RadioAlarmStore`，獨立的 `avd_radio_alarm` 檔（不與既有的 `avd_prefs` 混用：
  兩者的讀取時機與生命週期完全不同，混在一起只會讓「誰寫壞了誰」難以追查）。
  除設定外另存 `last_good_url`、已登錄的鬧鐘 id 清單，以及上次結果
  （時間、成功與否、未截斷的訊息原文、待寫入錯誤紀錄的標記）。
  序列化格式由 1.1 的 16 個測試覆蓋。
- [ ] 2.2 建立 `RadioAlarmScheduler`：對每筆啟用時間以 `setAlarmClock()` 登錄「下一次」、停用或刪除即 `cancel()`、`rescheduleAll()` 先全取消再全登錄；含 `canScheduleExactAlarms()` 檢查與回報；完成方式：實機設定 2 分鐘後的時間，狀態列出現鬧鐘圖示，`adb shell dumpsys alarm | grep com.mattpocock.avd` 可見登錄，時間到接收器被喚起

  **程式已完成並通過 `gradlew :app:compileDebugJavaWithJavac`；完成方式所列的實機驗證尚未執行。**

  `RadioAlarmScheduler` 以 `setAlarmClock()` 登錄，`rescheduleAll()` 先取消上一輪
  登錄過的每一筆再全部重登（不算差異：差異計算是另一個會靜默出錯的地方，而重登的
  成本可忽略）。另附 `canScheduleExactAlarms()` 與 `SecurityException` 的承接。

  實作中補上一個 design.md 未寫、但會讓功能只剩一筆鬧鐘會響的細節：
  **PendingIntent 的比對（filterEquals）不看 extras**，只看 action／data／type／
  component／category。若每筆鬧鐘只靠 extras 區分，兩筆會被視為同一個 PendingIntent
  而互相覆蓋。故每筆的 Intent 另帶唯一的 data URI（`avd-radio-alarm://entry/<id>`），
  requestCode 亦取自 id。
- [ ] 2.3 建立 `RadioAlarmReceiver`：接鬧鐘觸發 → 立即登錄次日 → 啟動播放服務；接 `BOOT_COMPLETED`、`TIME_SET`、`TIMEZONE_CHANGED` → `rescheduleAll()`；`AndroidManifest.xml` 宣告接收器與 `RECEIVE_BOOT_COMPLETED`；完成方式：實機重開機後不開 App，`dumpsys alarm` 仍見登錄；將系統時間往前調越過某筆時刻，該筆不立即播放且登錄至次日

  **程式已完成並通過編譯；完成方式所列的實機驗證（重開機、改系統時間）尚未執行。**

  `RadioAlarmReceiver` 接四種動作：鬧鐘觸發、`BOOT_COMPLETED`（另含
  `QUICKBOOT_POWERON`，部分廠牌只送這個）、`TIME_SET`、`TIMEZONE_CHANGED`。

  觸發時的順序刻意是「**先登錄下一次**，再判斷這次該不該播」：後面的任何一步失敗
  （沒網路、服務起不來）都不該讓這筆鬧鐘從此消失 —— 今天沒響的隔天仍要響。
  判斷時會重讀設定，總開關已關、該筆已停用或已刪除則不播（涵蓋「取消前就已排好的
  廣播仍會送達」這個情況）。

  時鐘往前調越過某時刻時，`nextTrigger` 自然落到次日，不補播 —— 與規格一致。
- [x] 2.4 `AndroidManifest.xml` 新增權限：`USE_EXACT_ALARM`、`SCHEDULE_EXACT_ALARM`（`maxSdkVersion=32`）、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`、`RECEIVE_BOOT_COMPLETED`；完成方式：`gradlew :app:compileDebugJavaWithJavac` 通過，安裝後 `adb shell dumpsys package com.mattpocock.avd | grep -iE "exact_alarm|media_playback|boot"` 皆出現

  `AndroidManifest.xml` 新增四個權限與兩個元件（服務 `RadioPlaybackService` 為
  `mediaPlayback` 型、接收器 `RadioAlarmReceiver`）。`gradlew :app:compileDebugJavaWithJavac`
  通過。接收器採 `exported="false"`：系統以 SYSTEM_UID 發送廣播，權限檢查在 exported
  之前就已放行，而鬧鐘的 PendingIntent 與本 App 同一個 UID，故不需對外開放。

  安裝後的 `dumpsys package` 核對列於 5.1。

## 3. 原生端：播放服務與來源解析

- [x] 3.1 於 `android/app/build.gradle` 加入 media3 ExoPlayer（鎖定版本，於 design.md Open Questions 補記所選版本）；完成方式：`gradlew :app:compileDebugJavaWithJavac` 通過，APK 體積增幅記錄於任務下方

  `androidx.media3:media3-exoplayer:1.11.1`（Google Maven 當日最新穩定版，已鎖定）。
  `gradlew :app:compileDebugJavaWithJavac` 通過。只引入 `media3-exoplayer`
  （連帶 common／datasource／extractor），未引入 media3-session 與 media3-ui ——
  本功能不需要媒體控制介面。APK 體積增幅待 `all.ps1` 產出安裝包後量測，記於 5.1。
- [ ] 3.2 完成 `RadioStreamResolver.resolve(store)`：自訂網址有值直接回傳；否則 `HttpURLConnection` GET ChannelInfoBat（連線與讀取各 5 秒）→ 1.3 選網址 → 成功寫入 `last_good_url` → 失敗依序退回 `last_good_url`、內建常數；完成方式：實機三次試播分別在「網路正常」「以 hosts／防火牆擋掉 bcc.com.tw」「同時清除 last_good_url」下皆能開始播放

  **程式已完成並通過編譯；完成方式所列的三種網路情境實機驗證尚未執行。**

  `RadioStreamResolver.resolve(store)` 依退回鏈實作，並與純函式 `pickStreamUrl`
  分開（後者已有 8 個測試）。`resolve` **保證不回傳 null**：查不到來源不算失敗，
  真正的失敗是「連不上」，那由播放端的 3 分鐘失敗窗判定。
- [ ] 3.3 建立 `RadioPlaybackService`（`foregroundServiceType="mediaPlayback"`，獨立通知 channel 與 id，不與 `KeepAliveService` 的 id 1 衝突）：ExoPlayer 以 `USAGE_ALARM`＋`CONTENT_TYPE_SPEECH` 播放、請求 `AUDIOFOCUS_GAIN_TRANSIENT`、持有 WakeLock 與 WifiLock、持續性通知含電台名、預計停止時間與「停止」；`postDelayed` 至結束時刻自動停止；再次收到 START 只延長結束時間；完成方式：實機驗證【螢幕關閉一小時後觸發 60 秒內出聲】【點停止立即停】【時長到自動停且通知消失】【重疊：第二筆觸發不中斷、停止時間更新】【勿擾模式仍出聲】

  **程式已完成並通過編譯；完成方式所列的五項實機驗證（螢幕關閉觸發、停止、時長到、
  重疊、勿擾）尚未執行。**

  `RadioPlaybackService`：獨立的通知 channel 與 id（4101／4102，不與下載的 id 1 衝突）、
  ExoPlayer 以 `USAGE_ALARM` + `AUDIO_CONTENT_TYPE_SPEECH` 播放、`AUDIOFOCUS_GAIN_TRANSIENT`、
  PARTIAL_WAKE_LOCK 與 WifiLock、持續性通知含電台名與預計停止時間與「停止」動作、
  `postDelayed` 至結束時刻自動停止。

  重疊的處理在 `onStartCommand`：已在播放時只把結束時間延後到兩者較晚者並更新通知，
  **不重建播放器、不重頭開始**。

  一個刻意的選擇：失去音訊焦點時**不停止播放**。使用者要的是「早上被叫醒」，
  不是「被別的 App 靜音」；來電等情況由系統自行壓低音量。
- [ ] 3.4 失敗處理：自預定開始時刻起 3 分鐘未進入就緒即停止，發一則一般通知說明原因，寫入上次結果並標記 `pendingJournal`；連線中斷自動重連（`LoadErrorHandlingPolicy`）；完成方式：實機關閉所有網路後觸發，3 分鐘後出現失敗通知；播放中切換 Wi-Fi／行動網路，播放自行恢復

  **程式已完成並通過編譯；完成方式所列的實機驗證（斷網 3 分鐘、切換網路）尚未執行。**

  失敗窗自**預定開始時刻**起算而非服務實際啟動時刻 —— 兩者在系統延遲喚醒時會差上
  數十秒，用後者會讓窗口悄悄變長。逾時即停止、發一般通知（`BigTextStyle`，訊息不截斷）、
  寫入上次結果並標記 `pendingJournal`。

  斷線重連由 `onPlayerError` 與 `STATE_ENDED` 承接（直播不該結束，結束即視為斷線），
  延遲 3 秒後重新 `prepare`；失敗窗已過且從未就緒過則交給 giveUp 收尾，不無限重試。
- [ ] 3.5 於 `YoutubeDlPlugin` 新增插件方法：`getRadioAlarmConfig`、`setRadioAlarmConfig`（寫入後 `rescheduleAll()`）、`getRadioAlarmStatus`（下一次觸發、上次結果、通知與精確鬧鐘權限狀態）、`testRadioAlarm`（結束時間＝現在＋30 秒，走同一服務）、`stopRadioAlarm`、`consumeRadioAlarmJournal`；並以 `@Permission` 別名宣告 `POST_NOTIFICATIONS`；完成方式：前端 console 呼叫各方法回傳結構正確，`testRadioAlarm` 於 30 秒後自動停止

  **程式已完成並通過編譯；完成方式所列的實機驗證（前端呼叫各方法、試播 30 秒自停）
  尚未執行。**

  八個插件方法：`getRadioAlarmConfig`、`setRadioAlarmConfig`、`getRadioAlarmStatus`、
  `testRadioAlarm`、`stopRadioAlarm`、`consumeRadioAlarmJournal`，另加
  `requestRadioAlarmNotificationPermission`（Capacitor 的 `@Permission` 別名
  `notifications` 加 `@PermissionCallback`）、`openExactAlarmSettings` 與
  `openBatteryOptimizationSettings`。

  `setRadioAlarmConfig` 一律把傳入內容經 `RadioAlarmConfig.fromJson` 過一次再落地 ——
  前端負責顯示拒絕的原因，這裡是最後一道防守。寫入後立即 `rescheduleAll()`。

  電池最佳化刻意開**清單**頁（`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`）而非
  會跳對話框的 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`：後者需要另外宣告
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 權限，為了一個提示多要一個敏感權限不划算。
- [ ] 3.6 從背景啟動前景服務的後路：接收器捕捉 `ForegroundServiceStartNotAllowedException`，記錄並改以 `setAlarmClock` 的 `showIntent` 拉起 Activity；完成方式：實機於 Android 12+ 以 `force-idle` 觸發驗證是否進入此後路，結果記錄於任務下方（若從未進入，保留程式碼並註明）

  **程式已完成並通過編譯；完成方式所列的 `force-idle` 實機驗證尚未執行，
  故「是否真的會進入此後路」仍未知。**

  接收器以 `IllegalStateException` 承接（`ForegroundServiceStartNotAllowedException`
  即其子類；以父類承接可避免在 API 31 以下解析不到該類別），後路為以鬧鐘的
  `showIntent` 把 App 拉到前景後再啟動服務；兩段都失敗才記錄失敗原因。

## 4. 前端

- [x] 4.1 建立 `src/services/radioAlarm.ts`：型別定義、插件封裝，以及純函式 `normalizeTime`／`validateTime`（含重複判定）、`describeNextTrigger(config, now)`、`formatLastResult(result)`；完成方式：`src/services/__tests__/radioAlarm.spec.ts` 涵蓋合法／越界／重複、跨日的「下一次」文字、三種上次結果文字，`npm test` 綠燈

  `src/services/radioAlarm.ts` 與 29 個 vitest 測試（`npm test` 全數 409 passed）。

  純函式：`normalizeTime`、`validateNewTime`（含重複判定，以正規化後的字串比對 ——
  6:00 與 06:00 是同一個時刻而使用者兩種都可能輸入）、`validateStreamUrl`、
  `clampDuration`、`nextOccurrence`、`describeNextTrigger`、`formatLastResult`、
  `permissionWarnings`、`isAggressiveVendor`、`normalizeConfig`、`defaultEntries`。

  `nextOccurrence` 與原生端的 `RadioAlarmSchedule.nextTrigger` 採同一套規則（含
  「恰好等於現在即算次日」），兩邊各自有測試釘住 —— 不一致的話介面顯示的時間
  會與實際響的時間差一天。

  `describeNextTrigger` 標出今天／明天而非只給 HH:mm：只顯示 06:00 的話，
  使用者無從判斷自己剛才的變更有沒有生效。
- [x] 4.2 偏好設定新增「早報鬧鐘」區段（`v-if="!isTauri()"`）：總開關 → 時間清單（時間、時長 `van-stepper`、啟用 `van-switch`、移除 `ACTION_GLYPH.remove` 中性色）→ 新增（`van-popup`＋`van-time-picker`）→ 串流網址 `van-field`（空值＝用官方）→ 試播／停止 → 狀態行（下一次、上次結果）；開啟區段時自插件讀取，變更時整包寫回，**不**對這些鍵 `defineSetting`；完成方式：`npx vue-tsc --noEmit` 與 `npm run build` 通過，`grep` 確認無新增的 `defineSetting` 鍵與硬編色碼，Windows 版開啟偏好設定不見此區段

  `npx vue-tsc --noEmit` 與 `npm run build` 皆通過。`grep` 核對：
  diff 中唯一出現 `defineSetting` 的地方是「說明這裡沒有 defineSetting」的註解；
  新增區段用到的色碼只有 `#0f172a`／`#64748b`／`#94a3b8`／`#e2e8f0`，
  全為 visual-language 既有的中性色階，未引入新顏色，也未動用強調色
  （移除時間只是設定調整，不是不可逆操作）。

  時間列改用自訂的 flex 列（`.radio-alarm-row`）而非 `van-cell` 的 right-icon：
  時間、時長 stepper、啟用開關與移除鍵在窄畫面上放不進一行 —— 這正是本版
  稍早修掉的溢出問題，故一開始就讓它 `flex-wrap: wrap`。

  **與任務描述的一處差異**：新增時間用 `van-popup` + `van-time-picker`（如任務所述），
  因此「輸入 24:10 這類不合法值」在介面上**無法產生** —— 選擇器只給得出合法時刻。
  規格「拒絕不合法的時間並說明原因」仍然成立，只是把關落在會真正收到不合法值的
  兩層：`validateNewTime`（已測）與原生端的 `RadioAlarmConfig.fromJson`（已測）。
  介面上實際會遇到的拒絕是**重複時間**（`showToast` 顯示原因）與**串流網址格式**
  （`van-field` 的 error-message）。5.1 的對應項目請照此核對。

  Windows 端不顯示此區段由單一的 `v-if="!isTauri()"` 保證；實機（桌面）核對列於 5.1。
- [ ] 4.3 首次開啟總開關的流程：清單為空時預填 06:00 與 07:00（啟用、30 分鐘）→ 請求通知權限 → 精確鬧鐘不可用時開系統設定頁；完成方式：實機全新安裝後開啟總開關，清單出現兩筆並見權限請求

  **程式已完成並通過建置；完成方式所列的實機驗證（全新安裝後開啟總開關）尚未執行。**

  `onRadioMasterToggle`：開啟且清單為空時預填 06:00 與 07:00（啟用、30 分鐘）→
  整包寫回原生端（立即 `rescheduleAll`）→ 請求通知權限 → 若 `exactAlarmAllowed`
  為 false 則以對話框詢問是否前往系統設定。

  通知權限刻意**不阻擋**流程：缺了它播放仍會照常開始，失去的只是通知與停止按鈕。
- [ ] 4.4 權限與廠牌提示：依 `getRadioAlarmStatus` 顯示「未允許通知：播放時將沒有停止按鈕」「未允許精確鬧鐘：時間到可能不會響」與重新授權入口；非原生 Android 廠牌加一行「若未響起，請允許自啟動／關閉電池最佳化」與 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 入口；狀態一律以文字表達，不新增顏色；完成方式：實機拒絕通知權限後介面出現對應說明，點入口能到正確的系統頁

  **程式已完成並通過建置；完成方式所列的實機驗證（拒絕權限後的介面、入口是否到正確的
  系統頁）尚未執行。**

  `permissionWarnings` 產生三種提示（精確鬧鐘、通知、廠牌省電機制），全部以**文字**
  表達，未引入顏色。對應的入口按鈕只在該項缺失時出現。

  廠牌清單（`isAggressiveVendor`）刻意寬鬆：判斷錯了最多多一行字，漏掉的後果卻是
  使用者某天早上沒被叫醒而不知道為什麼。
- [ ] 4.5 啟動時呼叫 `consumeRadioAlarmJournal`，有內容即 `reportError('早報鬧鐘', message)`，時間欄位用實際發生時間；完成方式：製造一次失敗後開 App，錯誤紀錄出現一筆且原文未截斷；再次開 App 不重複出現

  **程式已完成並通過建置；完成方式所列的實機驗證（製造失敗後開 App、再開一次不重複）
  尚未執行。**

  `drainRadioAlarmJournal` 於 `onMounted` 呼叫。`reportError` 新增第三個選用參數
  `atTime`，讓這筆紀錄用**實際發生時間**而非寫入時間 —— 用寫入時間會讓紀錄對不上事實。
  不重複寫入由原生端的 `consumeJournal` 清除 `pendingJournal` 標記保證。

## 5. 規格對照與整體驗證

- [ ] 5.1 逐條對照 `specs/live-radio-alarm/spec.md` 的每個 Scenario 於實機驗證並在此記錄結果（含裝置型號與 Android 版本）：首次開總開關、升級後不響、新增合法／不合法、停用單筆、螢幕關閉觸發、勿擾、時長到、通知停止、重疊、官方來源正常／逾時、自訂網址、中途斷線、重開機、時鐘往前調、變更後不重啟、清除前端儲存、無網路失敗、上次結果顯示、通知權限被拒、Windows 端、試播成功／失敗

  **尚未執行 —— 我無法操作實機。** 本節的每一項都需要一台 Android 手機。

  程式已全部完成、六項自動化驗證全綠（見 5.4）。以下是實機驗證時的建議順序，
  把最快破的排前面（觸發時間設在 2 分鐘後即可，不必等到早上）：

  1. 【紅線 1】升級後總開關為關閉（見 5.2）
  2. 開啟總開關 → 清單出現 06:00／07:00、跳出通知權限請求
  3. 試播 → 30 秒後自動停止（這一步過了，代表來源解析與播放路徑都通）
  4. 改一筆時間為 2 分鐘後 → 關螢幕等它響 → 通知列有「停止」→ 點停止立即停
  5. 時長設 1 分鐘 → 響後一分鐘自動停、通知消失
  6. 重疊：兩筆相隔 1 分鐘、第一筆時長 5 分鐘 → 第二筆到達時不中斷、停止時間變晚
  7. 勿擾模式下重覆第 4 步
  8. 關掉所有網路 → 觸發 → 3 分鐘後出現失敗通知 → 開 App 看錯誤紀錄有一筆完整原文
     → 再開一次 App，**不應**重複出現
  9. 重開機 → 不開 App → `adb shell dumpsys alarm | grep com.mattpocock.avd` 仍見登錄
  10. 把系統時間往前調越過某筆時刻 → 不立即播放、登錄至次日
  11. 改時間後不重啟 App → 舊的登錄消失、新的出現
  12. 清除 App 的網頁儲存（或清掉 localStorage）→ 鬧鐘設定不受影響
  13. 自訂串流網址填一個可用網址 → 試播 → 確認不查官方（可用抓包或關掉 bcc.com.tw 驗證）
  14. 自訂網址填 `rtmp://x/y` → 欄位顯示拒絕原因
  15. 重複時間 → `showToast` 顯示「清單中已經有 06:00 了」
  16. 拒絕通知權限後 → 介面出現說明與「重新要求通知權限」按鈕
  17. Windows 版開啟偏好設定 → 不見早報鬧鐘區段
  18. `adb shell dumpsys package com.mattpocock.avd | grep -iE "exact_alarm|media_playback|boot"`
  19. 量測 APK 體積增幅（media3 預估 +1.5 MB），記於 3.1

  **「輸入 24:10 這類不合法值」在介面上無法產生**（用的是時間選擇器），
  把關落在 `validateNewTime` 與原生端的 `fromJson`，兩者皆有測試 —— 詳見 4.2 的說明。
- [ ] 5.2 【紅線 1】以含既有設定的舊版升級至本版，確認總開關為關閉且 `dumpsys alarm` 無本 App 的登錄；完成方式：實機升級驗證並記錄

  **尚未執行 —— 需要實機升級。**

  程式面的保證：`RadioAlarmConfig.defaults()` 的 `masterEnabled` 為 false，且
  `RadioAlarmConfigTest.defaultsAreSilent` 專門釘住這一條；`fromJson` 在讀不到
  `masterEnabled` 欄位時亦回傳 false（`optBoolean(..., false)`）。舊版沒有
  `avd_radio_alarm` 這個 SharedPreferences 檔，故升級後必然走到預設值。
- [x] 5.3 【紅線 2】試播與鬧鐘觸發共用同一服務入口，`grep` 確認沒有第二條播放路徑；完成方式：靜態核對＋一次「試播成功後隔日鬧鐘成功」的實際觀察

  靜態核對完成，**實際觀察（試播成功後隔日鬧鐘成功）待實機驗證**。

  `grep` 結果：`ACTION_START` 的送出點只有兩處 —— `RadioAlarmReceiver`（正式觸發）
  與 `YoutubeDlPlugin.testRadioAlarm`（試播），兩者指向同一個
  `RadioPlaybackService`；`new ExoPlayer.Builder` 全專案只有一處。
  來源解析（`RadioStreamResolver.resolve`）亦只被服務呼叫一次，
  試播與正式觸發因此連退回鏈都完全相同。
- [x] 5.4 五項建置驗證全數通過：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml`、`gradlew :app:compileDebugJavaWithJavac`；另加 `gradlew :app:testDebugUnitTest` 綠燈

  六項全數通過：

  - `npm run build` ✓
  - `npm test` ✓ 409 passed（新增 29 個）
  - `npx vue-tsc --noEmit` ✓
  - `cargo check --manifest-path src-tauri/Cargo.toml` ✓
  - `gradlew :app:compileDebugJavaWithJavac` ✓
  - `gradlew :app:testDebugUnitTest` ✓ 36 個測試、0 失敗（新增 36 個 —— 原專案的
    Android 端沒有自己的單元測試，本 change 是第一批）

## 6. 提交與版本進版

- [x] 6.1 建立功能 commit（程式、測試、`tasks.md` 進度），`git status --short` 確認未夾帶無關檔案

  `022354b feat: 早報鬧鐘 - 每日定時播放中廣新聞網直播`
  24 檔、3763 行新增。`git status --short` 確認無夾帶無關檔案
  （`components.d.ts` 的三行是 unplugin-vue-components 為新用到的
  `van-popup`／`van-stepper`／`van-time-picker` 自動產生的）。
- [x] 6.2 同步七處版號：`package.json`、`package-lock.json`（2 處）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（`cargo update --workspace --offline`）、`android/app/build.gradle`（`versionName` 與 `versionCode` 皆遞增）

  `fda7341 chore: 版本進版至 v1.0.99`。七處全數同步，
  `versionCode` 135 → 136，`Cargo.lock` 以 `cargo update --workspace --offline` 更新。
- [x] 6.3 更新 `avd_s/publish_all.ps1` 的預設 `$Message`：描述早報鬧鐘功能、預設關閉需手動開啟、Android 限定，版號與 `package.json` 一致（該檔屬工作區 repo，獨立提交）

  工作區 repo 的 `1afa173 chore: publish_all.ps1 預設發布說明更新至 v1.0.99`。
  內嵌版號與 `package.json` 一致，說明中明確寫出「Android 限定、預設關閉、
  需自行到偏好設定開啟」—— 這是使用者升級後最需要先知道的一件事
  （否則會以為功能沒生效）。PowerShell 解析檢查通過。
- [x] 6.4 重新執行 5.4 全數通過後建立獨立的進版 commit；**提交與進版期間 MUST NOT 併行執行發布腳本**；完成後告知使用者可手動發布

  進版前後各跑一次六項驗證，全數通過。發布腳本未執行 —— 依規範由使用者手動執行。

## 7. 歸檔

- [ ] 7.1 歸檔前確認：`config-persistence` 的 MODIFIED 合併後無 TBD、原三個 Scenario 完整保留；`live-radio-alarm` 新主規格的 Purpose 正確寫入（兩份 delta 皆無 BOM 是此事的前提，`head -c 3 | xxd -p` 不得為 `efbbbf`）
