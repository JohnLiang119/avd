## 0. 先讀：這個 change 的驗證重心在實機

九成邏輯在 Android 原生端，而原生端只有純 Java 的部分能跑單元測試（JUnit 4 已在 `testImplementation`，以 `gradlew :app:testDebugUnitTest` 執行）。鬧鐘、前景服務、Doze、勿擾這些行為**只能在實機驗證**，所以：

- 能抽成純函式的（下一次時刻計算、設定驗證與序列化、API 回應選網址）一律抽出並以 JUnit 釘住，讓實機驗證只剩「系統會不會照做」這一層。
- 實機驗證時把觸發時間設在 **2 分鐘後**，不必等到早上；驗證 Doze 用 `adb shell dumpsys deviceidle force-idle`。
- 每一組任務附帶該組的實機驗證項目，破了就知道是哪一組。

兩條紅線：

```
  1. 清單預設為空（原為「總開關預設關閉」，第 12 組拿掉總開關後改由此達成）。
     升級的使用者隔天早上 MUST NOT 被無預警叫醒。
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

## 7. 音量控制（第 1～6 組完成後追加）

使用者在驗收前提出「聲音沒法控制？」，點出原設計的兩個缺口：想調小聲只能去改整台
手機的鬧鐘音量（連帶影響真正的鬧鐘），而早上被吵醒後打開 App 按音量鍵調到的是
媒體音量。已擴充 `live-radio-alarm` 規格（新增「音量的控制與說明」需求與四個情境）
與 design.md 的 D11。**漸強未納入本次範圍。**

- [x] 7.1 `RadioAlarmConfig` 新增 `volumePercent`（0–100，預設 100）與其夾值、序列化；完成方式：JUnit 涵蓋 -1／101／缺欄位／損毀值，`gradlew :app:testDebugUnitTest` 綠燈

  `RadioAlarmConfig` 新增 `volumePercent`（0–100，預設 100）、`clampVolume` 與
  `volumeGain()`（回傳 0.0–1.0 給播放器）。新增 3 個 JUnit（共 39 個、0 失敗）。

  其中一條專門釘住**舊版設定沒有這個欄位時要讀成 100 而不是 0** ——
  讀成 0 會讓升級的使用者以為鬧鐘壞了，而且那種「沒有聲音」最難查。
- [x] 7.2 `RadioPlaybackService` 於備妥播放器時套用 `player.setVolume(volumePercent / 100f)`，並新增 `ACTION_SET_VOLUME`：播放中收到即重讀設定並套用，不重建播放器；`setRadioAlarmConfig` 在服務播放中時送出該動作；完成方式：編譯通過，實機驗證列於 8.6

  **程式已完成並通過編譯與 39 個 JUnit；完成方式所列的實機驗證列於 7.6。**

  `preparePlayer` 備妥播放器後即 `applyVolume()`；新增 `ACTION_SET_VOLUME`，
  播放中收到就重讀設定並套用，**不重建播放器**（沒在播放時什麼都不做 ——
  下次播放時 `preparePlayer` 自然會讀到新值）。`setRadioAlarmConfig` 在
  `RadioPlaybackService.isPlaying()` 為真時送出該動作。

  用 `Player.setVolume` 而非 `AudioManager.setStreamVolume`：後者會改掉裝置的
  鬧鐘音量設定，使用者真正的鬧鐘會跟著變。`grep` 確認全專案沒有 `setStreamVolume`。
- [x] 7.3 `MainActivity` 於播放期間 `setVolumeControlStream(STREAM_ALARM)`、停止後還原為 `USE_DEFAULT_STREAM_TYPE`；Activity 於 `onResume` 依目前狀態決定，服務於開始與停止時主動通知（以 WeakReference 持有，Activity 不存在時不做事）；完成方式：編譯通過，實機驗證列於 8.6

  **程式已完成並通過編譯；完成方式所列的實機驗證列於 7.6。**

  `MainActivity` 於 `onResume` 依 `RadioPlaybackService.isPlaying()` 決定
  `setVolumeControlStream`，播放中為 `STREAM_ALARM`、否則還原為
  `USE_DEFAULT_STREAM_TYPE`；服務在播放開始與停止時呼叫
  `MainActivity.notifyPlaybackStateChanged()`。

  Activity 以 `WeakReference` 持有（靜態強參考會讓 Activity 無法被回收），
  畫面不存在時什麼都不做 —— 那表示沒有人在按音量鍵。

  編譯時踩到一個小陷阱：Capacitor 的 `BridgeActivity` 把 `onResume`／`onPause`
  宣告為 `public`，以 `protected` 覆寫會因降低可見性而編譯失敗。已改為 `public`。
- [x] 7.4 前端 `radioAlarm.ts` 的型別與 `normalizeConfig` 納入 `volumePercent`，新增 `clampVolume`；完成方式：`radioAlarm.spec.ts` 涵蓋越界與缺欄位，`npm test` 綠燈

  `radioAlarm.ts` 的型別、`normalizeConfig`、`setConfig` 納入 `volumePercent`，
  新增 `clampVolume` 與上下限常數。新增 2 個 vitest（`npm test` 411 passed）。
  同樣有一條釘住「缺欄位讀成 100 而非 0」。
- [x] 7.5 設定介面新增音量滑桿（`van-slider`，顯示百分比）與**說明文字**：音量跟隨系統鬧鐘音量、此比例在其之下縮放、勿擾模式仍會出聲；完成方式：`npx vue-tsc --noEmit` 與 `npm run build` 通過，`grep` 確認未引入新色碼

  `npx vue-tsc --noEmit` 與 `npm run build` 通過。滑桿用 `van-slider`
  （0–100、step 5），以 `@change`（放開才觸發）而非 `@update:model-value`
  綁定 —— 後者會在一次拖曳中送出數十次寫入與重新排程。

  說明文字補上了 design.md 風險欄要求、但第一版**漏做**的那段：
  講明播放走系統鬧鐘音量（所以靜音／勿擾仍會響）、這個百分比是在其之下縮放、
  不會更動手機本身的鬧鐘音量設定，以及整體太小聲時該去哪裡調。

  `grep` 確認新增區段只用到 `#0f172a`／`#64748b`／`#94a3b8`／`#e2e8f0`，
  未引入新色碼。
- [ ] 7.6 實機驗證【音量】：比例調 50% 後觸發音量明顯變小且系統鬧鐘音量設定未變；播放中調整立即生效且不中斷；播放中開著 App 按音量鍵調到的是鬧鐘音量、媒體音量不變；停止後 App 的音量鍵行為回復正常

  **尚未執行 —— 我無法操作實機。** 四項：

  1. 比例調 50% → 觸發後音量明顯變小；到系統設定確認**鬧鐘音量的設定值沒有被改掉**
  2. 播放中拖動滑桿 → 音量立即改變、播放不中斷、不重頭開始
  3. 播放中開著 App 按音量鍵 → 調到的是鬧鐘音量（音量面板顯示鬧鐘），媒體音量不變
  4. 停止播放後再按音量鍵 → 回到 App 平常的行為（媒體音量）
- [x] 7.7 六項建置驗證全數通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`

  六項建置驗證全數通過：`npm run build` ✓、`npm test` ✓ 411 passed、
  `npx vue-tsc --noEmit` ✓、`cargo check` ✓、
  `gradlew :app:compileDebugJavaWithJavac` ✓、`gradlew :app:testDebugUnitTest` ✓ 39 passed。
  功能與進版分兩個 commit，`publish_all.ps1` 的預設說明同步更新。

## 8. 兩層選單與內容可捲動（使用者回報後追加）

使用者回報「沒法向下拉」並要求「改為 2 層 MENU，如中廣 -> 時間」。兩者其實是同一件事的
兩面：偏好設定加了早報鬧鐘之後高過一個畫面，而 Vant 的對話框用**預設插槽**時既沒有
高度上限也沒有捲動（`.van-dialog` 本身是 `overflow: hidden`），超出的部分**直接被切掉**
—— 不是拉不動，是根本沒有可捲動的區域。已擴充規格（新增「設定介面的內容必須可觸及」
需求與三個情境）。

- [x] 8.1 對話框內容可捲動：補上 Vant 只在 `message` 屬性時才有的行為（高度上限與 `overflow-y: auto`），以非 scoped 樣式對全部對話框生效；完成方式：`npm run build` 後 `grep` 確認 `.van-dialog__content` 規則進入產物，實機驗證列於 8.4

  以非 scoped 的 `<style>` 區塊補上 `.van-dialog__content { max-height: 65vh;
  overflow-y: auto; }`。`grep` 確認已進入 `dist/assets/index-*.css`。

  非 scoped 是刻意的：對話框 teleport 到 body，而這條規則本來就該對**全部**對話框
  生效 —— 頻道管理、關鍵字編輯等在小螢幕上會踩到同一個坑。標題與底部按鈕維持固定，
  只有中間的內容捲。

  根因值得記下來：Vant 的對話框只有在使用 `message` 屬性時才有捲動
  （`.van-dialog__message` 自帶 max-height 與 overflow-y）。改用預設插槽放自訂內容時
  兩者都沒有，而 `.van-dialog` 本身是 `overflow: hidden` —— 超出的部分不是「拉不動」，
  是**根本沒有可捲動的區域，直接被切掉**。
- [x] 8.2 設定內容改為兩層：第一層為電台（名稱、摘要、展開鍵、總開關），第二層為時間清單與音量、串流網址、試播與狀態；第二層以虛線左邊界表示層級，與主佇列的「頻道 > 播放清單」同一套；完成方式：`npx vue-tsc --noEmit` 與 `npm run build` 通過，`grep` 確認未引入新色碼

  `npx vue-tsc --noEmit` 與 `npm run build` 通過。`grep` 確認新增區段只用到
  `#0f172a`／`#64748b`／`#94a3b8`／`#e2e8f0`，未引入新色碼。

  第一層（`.radio-station-header`）：電台名稱、摘要、展開鍵、總開關。
  第二層（`.radio-alarm-detail`）：時間清單、音量、串流網址、試播與狀態，
  以 `border-left: 2px dashed` 表示層級 —— 與主佇列的「頻道 > 播放清單 > 子項」
  同一套視覺，傳達的是結構而非裝飾。

  展開狀態為純介面狀態（`radioStationExpanded`），不持久化。首次開啟總開關時
  自動展開（使用者要看到自己被預填了哪兩個時間），關閉再開啟設定時回到收合。
- [x] 8.3 收合時的摘要 `describeStationSummary`：列出啟用中的時間與音量，超過三個時段改為總數以免撐爆整行；總開關關閉與沒有時間各有各的說法；完成方式：`radioAlarm.spec.ts` 涵蓋五種情況，`npm test` 綠燈

  `describeStationSummary` 與 5 個 vitest（`npm test` 416 passed）。

  摘要這一行是兩層選單成不成立的關鍵：**收合著也要看得出設定了什麼**，
  否則收合只是把資訊藏起來，那比原本的長清單更糟。時段超過三個時改為
  「05:00、06:00、07:00 等 4 個時段」，避免撐爆整行。
- [ ] 8.4 實機驗證【版面】：偏好設定可一路捲到底且每個控制項都點得到；收合時摘要看得出設定了什麼；首次開啟總開關會自動展開並看到預填的兩個時間；關閉再開啟設定時回到收合

  **尚未執行 —— 我無法操作實機。** 四項：

  1. 偏好設定可一路捲到底，最下方的「測試版更新」開關點得到
  2. 收合時摘要顯示「每天 06:00、07:00 · 音量 100%」之類
  3. 首次開啟總開關 → 自動展開並看到預填的兩個時間
  4. 關閉設定再開啟 → 回到收合
- [x] 8.5 六項建置驗證全數通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`

  六項建置驗證全數通過：`npm run build` ✓、`npm test` ✓ 416 passed、
  `npx vue-tsc --noEmit` ✓、`cargo check` ✓、
  `gradlew :app:compileDebugJavaWithJavac` ✓、`gradlew :app:testDebugUnitTest` ✓ 39 passed。

## 9. 手動直播（使用者要求後追加）

使用者要求「加個直播鈕」，位置「放中廣新聞網邊」。已擴充規格（新增「手動收聽直播」
需求與五個情境）與 design.md 的 D12。

- [x] 9.1 播放服務由「一種行為＋ isTest 旗標」改為三種模式（alarm／test／live），共用同一個服務與同一套來源解析；`test` 刻意維持鬧鐘音量（它要驗的就是早上會不會響），`live` 改走媒體音量；完成方式：`gradlew :app:compileDebugJavaWithJavac` 通過，`grep` 確認 `ACTION_START` 的送出點與 `new ExoPlayer.Builder` 的數量未增加

  `grep` 結果：`ACTION_START` 送出點三處（接收器、試播、直播）皆指向同一個
  `RadioPlaybackService`；`new ExoPlayer.Builder` 全專案仍只有一處。
  模式是**參數**不是分岔的實作 —— 分岔才會出現「試播成功、早上不響」。

- [x] 9.2 新增插件方法 `playRadioLive`（3 小時上限、媒體音量），`getRadioAlarmStatus` 多回傳 `alarmAudioActive`；`MainActivity` 的音量鍵改為只在鬧鐘語意的播放時才搶走；完成方式：編譯通過，實機驗證列於 9.5

- [x] 9.3 視覺語言新增 `stop: '■'`（方形即停止，與三角形向右即播放同一套準則），並同步 `visualLanguage.spec.ts` 的兩條斷言；完成方式：`npm test` 綠燈

- [x] 9.4 介面：直播鍵放在電台那一排、**不受總開關約束**，播放中同一位置換成停止；播放中以文字標示是直播（媒體音量）或鬧鐘播放（鬧鐘音量）；設定開著時每 3 秒輪詢狀態，關閉即停；完成方式：`npx vue-tsc --noEmit` 與 `npm run build` 通過，`describePlaybackState` 有測試

  播放狀態字抽為純函式 `describePlaybackState` 並附 2 個測試。要分得出來的理由不是
  好看：**兩者的音量來源不同**，使用者若看到「直播中」卻去調鬧鐘音量會發現沒反應。

- [ ] 9.5 實機驗證【直播】：鬧鐘總開關關閉時按直播仍可播；靜音／勿擾下按直播**不會**強行出聲；播放中按鈕變停止、按下即停；播放中的狀態文字分得出直播與鬧鐘；通知載明預計停止時間；播放結束後按鈕自行變回播放（輪詢）

- [x] 9.6 六項建置驗證全數通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`

## 10. 可驗證性（使用者提出疑慮後追加）

使用者問「AVD 關掉就沒用了吧？」。設計上不會，但**當時沒有任何辦法讓他驗證** ——
試播繞過整段鬧鐘機制，而「下一次觸發」是本程式自己算的，系統中一個鬧鐘都沒有時
它照樣顯示得很正常。已擴充規格（新增「鬧鐘機制必須可被使用者自行驗證」需求與
五個情境）與 design.md 的 D13。

- [x] 10.1 向系統回讀登錄狀態：以 `PendingIntent.FLAG_NO_CREATE` 逐一探測已登錄的 id，另以 `getNextAlarmClock()` 與 `getCreatorPackage()` 判斷裝置的下一個鬧鐘是否為本程式的；完成方式：編譯通過，實機驗證列於 10.5

  `getNextAlarmClock()` 回傳的是**整台裝置**的下一個鬧鐘，可能是使用者時鐘 App 的。
  「不是我們的」不代表我們沒登錄 —— 措辭照這個語意，有一條測試專門釘住它不得謊稱。

- [x] 10.2 一次性自我測試鬧鐘（兩分鐘後）：走 `setAlarmClock` → 接收器 → 前景服務，與早上完全相同；另存於 `self_test_at` 不進 `scheduled_ids`（否則等待期間改設定會被 `rescheduleAll` 連帶取消），不看總開關，可取消；完成方式：編譯通過，實機驗證列於 10.5

- [x] 10.3 響起的事實持久化於 `self_test_fired_at`，由接收器寫入；完成方式：編譯通過

  這是整個設計最關鍵的一點：該記錄只有在**系統把不在前景的程序叫起來**時才會被寫入。
  使用者關掉 App、回來看到那一行，就得到了他要的答案 —— 而不是我說「設計上不會」。

- [x] 10.4 介面：測試鬧鐘按鈕（登錄／取消），狀態區新增「系統登錄」與「測試鬧鐘」兩行；純函式 `describeSystemRegistration` 與 `describeSelfTest` 附測試；完成方式：`npm test` 綠燈（426 passed，新增 8 個）、`npx vue-tsc --noEmit` 與 `npm run build` 通過

- [ ] 10.5 實機驗證【可驗證性】：按下測試鬧鐘 → **把 AVD 完全關掉（從最近工作列滑掉）** → 兩分鐘後應響起 → 重新開啟 App，「測試鬧鐘」那一行顯示響起時刻；另確認「系統登錄」那一行在正常狀態下顯示已收下的數量，且在系統設定中「強制停止」本程式後會變成「不會響」的警示

- [x] 10.6 六項建置驗證全數通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`

## 12. 三層結構：時間 > 星期 > 頻道（使用者要求後重構）

使用者要求「第一層時間、第二層星期、第三層頻道，並清掉過多的解釋」。這是資料模型的
翻轉（電台為容器 → 鬧鐘為主體，頻道是屬性），規格已重寫（14 條需求、45 個情境），
design.md 新增 D14、改寫 D4／D9。

**本組取代先前實機驗證清單中的這些項目**：5.1 的「首次開總開關預填」「新增重複時間被拒」
「自訂網址欄位」、8.4 的「收合時電台摘要」「首次開啟總開關自動展開」、9.5 的「鬧鐘總開關
關閉時按直播」—— 這些概念已不存在，改由 12.9 的清單取代。

- [x] 12.1 原生資料模型：`Alarm`（id、time、weekdays 7 位元遮罩、channelId、durationMin、enabled）與 `Channel`（id、name、source 為 bcc.apiName 或 url），`Config` 含 `schemaVersion`；`fromJson` 校正空遮罩為全選、無效 channelId 為第一個內建頻道；完成方式：JUnit 涵蓋遮罩邊界、缺欄位、無效頻道，`gradlew :app:testDebugUnitTest` 綠燈

  `RadioAlarmConfig` 重寫：`Alarm`（id、time、weekdays 7 位元遮罩、channelId、durationMin、
  enabled）、`Channel`（id、name、kind = bcc|url、source）、`schemaVersion = 2`。
  `fromJson` 把空遮罩校正為全選、無效 channelId 落到預設頻道、壞網址的自訂頻道剔除、
  內建頻道缺了就補回（允許改名）。**「同一時刻不得重複」的檢查已移除**，有測試釘住
  兩筆同時刻並存。JUnit 23 個。

  星期遮罩的位元順序：bit 0 = 週日 … bit 6 = 週六，與 `Calendar.DAY_OF_WEEK - 1` 及
  JS `Date.getDay()` 一致 —— 前後端不必換算，也有測試釘住這個約定。
- [x] 12.2 舊格式遷移（一次性，以 `schemaVersion` 判斷）：`entries` → 每筆一個 Alarm（全選、bcc-news、時長與啟用沿用）；`customStreamUrl` 非空 → 建自訂頻道並讓所有遷移的鬧鐘指向它；`masterEnabled=false` → 全部停用；完成方式：JUnit 以 v1.0.98～1.0.103 的實際 JSON 樣本驗證三種情境，且重複呼叫不再改變內容

  `migrateLegacy`：`entries` → 每筆一個 Alarm（全選、bcc-news、時長與啟用沿用）；
  `customStreamUrl` 非空 → 建 `custom-legacy` 自訂頻道並讓所有鬧鐘指向它；
  `masterEnabled=false` → 全部停用。以 v1.0.98～1.0.103 的實際 JSON 形狀寫了三種情境的
  測試，另有一條驗證「遷移結果寫回後再讀一次內容不變」—— 遷移只發生一次由
  `schemaVersion` 保證。`RadioAlarmStore.getLastGoodUrl(bcc-news)` 在新鍵不存在時
  退回舊的單一鍵，升級後第一次退回仍有東西可用。
- [x] 12.3 `RadioAlarmSchedule.nextTrigger` 支援星期：自今天起往後最多 7 天取第一個「時刻未過且星期符合」者，空遮罩回傳 -1；完成方式：JUnit 涵蓋「今天符合未過」「今天符合已過→下一個符合日」「今天不符合」「僅週一、今天週二→下週一」「跨月」「時區」

  `nextTrigger(now, time, weekdays, zone)`：自今天起往後最多 7 天（含第 7 天 —— 只選週一、
  今天週一但已過 → 下週一），取第一個「時刻未過且星期符合」者。三參數版保留為全選的
  簡寫。JUnit 20 個，含一條先確認 2026-09-17 是週四，其餘星期測試以此為基準。
- [x] 12.4 `RadioStreamResolver` 依頻道：`pickStreamUrl(json, apiName)`、`last_good_url` 按頻道存、內建常數表（新聞、流行）；自訂頻道直接回傳 url；完成方式：JUnit 以實測回應樣本分別挑出新聞與流行，缺頻道時退回正確的內建常數

  `pickStreamUrl(json, apiName)` 依名稱挑；`resolve(store, channel)` 自訂頻道直接回傳網址，
  內建頻道走官方 → 該頻道 last_good_url → 該頻道內建常數。常數表新增流行網的退回位址，
  並有一條測試釘住「內建常數必須等於官方目前給的值，否則退回等於換台」。JUnit 10 個。
- [x] 12.5 排程器／接收器／服務：觸發帶 alarmId → 查該筆的頻道 → 播放；`ACTION_START` 帶 channelId；通知顯示頻道名；重疊時維持第一筆的頻道；試播播第一個內建頻道、自我測試不看頻道；完成方式：編譯通過，`grep` 確認 `ACTION_START` 送出點與 `new ExoPlayer.Builder` 數量未增加

  接收器依 alarmId 查鬧鐘 → 取其 channelId → `ACTION_START` 帶 `EXTRA_CHANNEL_ID`；
  自我測試取預設頻道。服務新增 `channel` 欄位與 `activeChannelId()`，通知標題改為頻道名；
  重疊時只延長結束時間、頻道維持第一筆。`grep` 確認 `ACTION_START` 送出點仍為三處
  （接收器、試播、直播）、`new ExoPlayer.Builder` 仍一處。編譯通過。
- [x] 12.6 插件：config 結構改版（alarms、channels、volumePercent），移除 masterEnabled／customStreamUrl 欄位；`playRadioLive(channelId)`；狀態多回傳播放中的 channelId；完成方式：編譯通過

  `setRadioAlarmConfig` 收 `alarms`／`channels`／`volumePercent` 並帶 `schemaVersion`，
  `configToJs` 對應改版；`masterEnabled`／`customStreamUrl` 欄位移除。`playRadioLive`
  接 `channelId`（找不到由 `channelById` 落到預設）；試播帶預設頻道；狀態多回傳
  `playingChannelId`。編譯通過。
- [x] 12.7 前端 `radioAlarm.ts`：型別與 `normalizeConfig` 改版；新增純函式 `describeWeekdays`（每天／平日／週末／一二三…）、`describeAlarmSummary`、含星期的 `nextOccurrence`、「系統登錄只在異常時顯示」的判斷；移除 `describeStationSummary` 與總開關相關函式及其測試；完成方式：`npm test` 綠燈

  `radioAlarm.ts` 重寫：新型別、`normalizeConfig`、`toggleWeekday`（取消最後一天回傳原遮罩）、
  `describeWeekdays`（每天／平日／週末／逐日，週一起算、週日放最後）、`describeAlarmSummary`、
  `newAlarm`、`registrationWarning`（**只在有啟用鬧鐘卻一筆都沒登錄時說話**）、
  `lastFailureText`（只在失敗時說話）。移除 `describeStationSummary`、`describeNextTrigger`、
  `nextOccurrence`、`validateNewTime`、`validateStreamUrl`、`defaultEntries` 及其測試。
  vitest 29 個（`npm test` 409 passed）。
- [x] 12.8 介面重構：鬧鐘卡片（收合：時刻、開關、摘要；展開：星期七鍵、頻道單選、時長、移除）、新增鈕（預設 06:00／每天／第一個內建頻道／30 分）、頻道列（每個頻道一顆 `ACTION_GLYPH.play`／`stop`）、音量滑桿加**一行**說明、「進階」摺疊（試播、測試鬧鐘、測試結果）、安靜原則（登錄狀態／上次播放／權限提示只在異常時出現）；完成方式：`npx vue-tsc --noEmit` 與 `npm run build` 通過，`grep` 確認未引入新色碼、無多行解釋段落殘留

  `npx vue-tsc --noEmit` 與 `npm run build` 通過。`grep`：新區段與新 CSS 只用到
  `#0f172a`／`#64748b`／`#94a3b8`／`#e2e8f0`／`#ffffff`，全為中性色階；舊的
  `.radio-station-*`／`.radio-alarm-row` 類與總開關、串流網址欄位皆無殘留。

  結構：鬧鐘卡片（收合：時刻鍵、摘要、時長、開關；展開：星期七顆圓鍵、頻道單選、
  時長、移除）→ 新增鬧鐘鍵 → 頻道列（每頻道一顆播放／停止）→ 音量滑桿加**一行**說明
  → 異常才出現的警示區 → 「進階」摺疊（試播、停止、測試鬧鐘、測試狀態）。
  星期鍵每顆 32px 圓形，是可觸控範圍的下限。點時刻開時間選擇器修改；新增鬧鐘直接以
  預設值建立並展開，首次新增才請求通知權限。

  **實機回報「設了 06:00 不知道怎麼取消」後補修**：卡片右側加回 ▼／▲（手機上沒有
  hover，原本完全看不出卡片能點），移除改為展開後底部一顆完整的「移除這筆鬧鐘」按鈕，
  不再是時長列角落的一個 `×`。「安靜」是不說廢話，不是把操作藏起來。
- [ ] 12.9 實機驗證【三層結構】：升級自 v1.0.103 後兩筆舊時間變成每天＋中廣新聞網、行為不變；新增鬧鐘預設值正確；同一時刻兩筆不同頻道各自觸發（設 2 分鐘後、今天的星期一筆選一筆不選）；取消最後一天被拒；改頻道為流行網後觸發播的是流行網；頻道列直播鈕各自獨立；一切正常時介面只有清單、頻道、音量；強制停止後出現「不會響」警示
- [ ] 12.10 六項建置驗證全數通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`（說明結構改變與舊設定自動遷移）

## 13. 歸檔

- [ ] 13.1 歸檔前確認：`config-persistence` 的 MODIFIED 合併後無 TBD、原三個 Scenario 完整保留；`live-radio-alarm` 新主規格的 Purpose 正確寫入（兩份 delta 皆無 BOM 是此事的前提，`head -c 3 | xxd -p` 不得為 `efbbbf`）

## 14. 本地檔案頻道（使用者要求後追加；design.md D15）

第 13 節的歸檔在本節完成後才進行。本節的紅線沿用第 0 節的兩條，另加一條：**file 頻道只播私有目錄下的副本**，任何指向私有目錄以外的路徑一律拒絕 —— 那正是複製要避免的東西。

- [x] 14.1 原生模型：`RadioAlarmConfig.Channel` 新增 kind `file`，以有序清單 `files`（私有目錄下的絕對路徑）取代單一 `source`，`source` 留作顯示摘要；`parseChannels` 對 file 驗證「清單非空且每個路徑皆位於 `filesDir/radio_alarm/` 下」，不合者剔除；`toJson` 對稱輸出；schemaVersion 維持 2；完成方式：JUnit 涵蓋合法清單、空清單剔除、路徑越界剔除、bcc／url 的 source 行為不變、舊版讀到 file 頻道時剔除且鬧鐘落回預設頻道，`gradlew :app:testDebugUnitTest` 綠燈

  `RadioAlarmConfig` 新增 `CHANNEL_KIND_FILE`、`LocalFile { path, displayName }`、`Channel.files`
  （其他 kind 為空清單）、`isValidLocalFilePath(path, root)`（純字串：必須在 root 之下、無空片段與 `..`）、
  `fromJson(json, localFileRoot)`（root 為 null 時 file 頻道一律剔除，等同舊版讀到新 kind 的行為）。
  `RadioAlarmStore` 以 `RadioAlarmFiles.rootPath()` 為 root 提供 `parseConfig()`，插件寫回改走它。
  JUnit 新增 7 個（`RadioAlarmConfigTest` 30 個全綠）。
- [x] 14.2 選檔與複製的插件方法 `pickRadioAlarmFiles`：`ACTION_OPEN_DOCUMENT` 加 `EXTRA_ALLOW_MULTIPLE`，MIME `audio/*`＋`video/*`，經 Capacitor `startActivityForResult` 回傳；於背景執行緒逐檔以 `ContentResolver.openInputStream` 複製到 `filesDir/radio_alarm/<channelId>/<序號>_<DISPLAY_NAME>`，任一檔失敗即刪除已複製的部分並 reject 附原因；成功回傳 `{ channelId, files: [{ path, displayName }] }`；另加 `removeRadioAlarmChannelFiles({ channelId })` 刪除整個資料夾；完成方式：實機選 3 個檔（含 1 個 mp4）後 `adb shell run-as` 可見三個副本，空間不足（以大檔模擬）時無殘留資料夾

  新增 `RadioAlarmFiles`（rootDir／channelDir／displayName／sanitizeFileName／copyInto／deleteChannelDir，
  channelId 含 `/`、`..` 一律拒絕）。`YoutubeDlPlugin.pickRadioAlarmFiles` 以 `startActivityForResult`
  ＋`@ActivityCallback radioAlarmFilesPicked` 收 ClipData 多選，背景執行緒逐檔複製到
  `filesDir/radio_alarm/<channelId>/NNN_<原名>`，任一失敗即 `deleteChannelDir` 並 reject 附原因；
  取消回 `{cancelled:true}`。`removeRadioAlarmChannelFiles` 刪整個資料夾。**實機驗證併入 14.7。**
- [x] 14.3 播放服務的 file 分支：`RadioStreamResolver.resolve` 對 file 回傳存在且可讀的路徑清單（不碰網路）；`preparePlayer` 改收 `List<MediaItem>`，bcc／url 傳單元素清單；file 模式設 `REPEAT_MODE_ALL` 並以 `TrackSelectionParameters` 停用 `TRACK_TYPE_VIDEO`；清單為空即 `fail("…檔案不存在")` 走既有失敗流程且 MUST NOT 改播其他頻道；部分缺檔時照播其餘並於 `recordSuccess` 訊息附「有 N 個檔案無法讀取」；`STATE_ENDED` 在 file 模式只記錄不重試；`new ExoPlayer.Builder` 仍只有一處；完成方式：實機以兩個 4 分鐘 mp3 設 10 分鐘鬧鐘，聽到第三次開頭後於 10 分停止；mp4 播放中 `adb shell dumpsys media.codec` 無影像解碼器；`run-as` 刪掉副本後觸發，出現失敗通知且不出聲

  `RadioStreamResolver.resolve` 改回傳 `Resolution { sources, local, missingCount }`；`resolveLocal`
  逐檔檢查 isFile／canRead／length>0，保留順序、跳過缺檔（JUnit 以暫存檔釘住 2 個情境，共 12 個全綠）。
  `RadioPlaybackService.preparePlayer(Resolution)`：空清單即 `fail("頻道「…」的檔案不存在或無法讀取，未播放。")`
  走既有失敗流程、不改播；file 模式 `REPEAT_MODE_ALL`＋`setTrackTypeDisabled(TRACK_TYPE_VIDEO)`、
  `STATE_ENDED` 只記錄、`onPlayerError` 直接 fail；多個 `MediaItem` 以 `setMediaItems` 一次交給播放器；
  `recordSuccess` 訊息附「（有 N 個檔案無法讀取，已跳過）」。`new ExoPlayer.Builder` 仍只有一處。
  `compileDebugJavaWithJavac` 通過。**實機驗證併入 14.7。**
- [x] 14.4 前端型別與收斂：`RadioChannel` 改為以 `kind` 區分的 union（`file` 含 `files: { path, displayName }[]`）；`normalizeConfig` 改為三值判斷，未知 kind 剔除（修掉「非 url 一律當 bcc」）；`RadioAlarmService` 新增 `pickFiles()`、`removeChannelFiles()`；`channelName` 等純函式對 file 頻道正常運作；完成方式：vitest 涵蓋 file 頻道的 normalize、未知 kind 剔除、鬧鐘指向被剔除頻道時落回預設，`npm test` 綠燈

  `RadioChannel` 改為 `RadioStreamChannel | RadioFileChannel` union，新增 `RadioLocalFile`、`isFileChannel`、
  `defaultFileChannelName`、`describeChannelFiles`；`normalizeChannel` 三值判斷、未知 kind 與空清單的 file 剔除；
  `RadioAlarmService.pickFiles()`／`removeChannelFiles()`；`setConfig` 對 file 頻道送出 `files`。
  vitest 改寫「非 url 一律當 bcc」那條並新增 4 個（`npm test` 413 passed）。
- [x] 14.5 介面：頻道列加一顆新增（開選檔器，複製期間顯示忙碌、失敗以文字提示原因）；非內建頻道可展開檢視檔案清單（顯示名稱、順序）、改名、移除（移除即呼叫 `removeChannelFiles` 並整包 `setConfig`，指向它的鬧鐘由原生端落回預設頻道）；新頻道預設名稱為第一個檔案的顯示名稱，多檔時加「等 N 個檔案」；直播鈕對 file 頻道照常可用；不引入新色碼、不加多行解釋段落；完成方式：`npx vue-tsc --noEmit` 與 `npm run build` 通過，`grep` 確認無新色碼

  頻道列改為 `.radio-channel-item`（列＋可展開的 body）：非內建頻道右側有 ▼／▲，展開後為檔案順序清單
  （`<ol>`）、名稱欄（失焦或 Enter 寫回）、「移除這個頻道」；清單下方一顆「從手機選擇 mp3／mp4 新增頻道」，
  複製期間 `loading` 顯示「正在複製檔案…」。`addRadioFileChannel` 寫回失敗時呼叫 `removeChannelFiles` 清副本；
  `removeRadioChannel` 正在播該頻道先停、寫回成功後刪副本。新增 CSS 只用既有中性色
  （`#0f172a`／`#64748b`／`#94a3b8`／`#e2e8f0`）。`npx vue-tsc --noEmit` 與 `npm run build` 通過。

  **實機回報「檔名太長把清單撐爆」後改版**：預設名稱只取第一個檔名的前段（去副檔名、最多 16 字），
  不再附「等 N 個檔案」；列上只有短標題、檔案數與 `›`，檔案明細、改名、移除改為點進對話框
  （清單 `max-height: 40vh` 可捲動）；鬧鐘卡片的頻道單選標籤加省略。vitest 改 2 個、加 1 個。
- [x] 14.6 規格與文件同步：`specs/live-radio-alarm/spec.md` 的「頻道」需求與新增的「本地檔案頻道的播放」需求（本節依據）已寫入；design.md D15 已寫入；proposal.md 的「What Changes」補一條本地檔案頻道、「Impact」補插件方法與私有目錄；完成方式：`openspec validate live-radio-alarm` 通過，三份 delta 皆無 BOM

  規格「頻道」需求與「本地檔案頻道的播放」需求、design.md D15、proposal.md（What Changes 補本地檔案頻道、
  Impact 補兩個插件方法與私有目錄）皆已寫入；`openspec validate live-radio-alarm` 通過；三份 delta 無 BOM。
- [ ] 14.7 實機驗證【本地檔案】逐條對照規格 Scenario：新增三檔頻道順序正確；其中一檔無法複製時不建頻道並提示；移除頻道後副本消失且鬧鐘落回新聞網未消失；清單短於時長時循環；mp4 只出聲不解影像；清除 App 資料（保留設定的模擬：手動刪副本）後觸發不出聲且有失敗通知；部分缺檔時照播其餘且上次結果載明數量；靜音下仍以鬧鐘音量響；手動收聽 file 頻道走媒體音量且循環至上限
- [x] 14.8 六項建置驗證全數通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`（說明鬧鐘可選本地 mp3／mp4 播放清單）

  功能 commit `2c4cc00`；版本 1.0.105 → 1.0.106（versionCode 143），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

## 15. 股票報價頻道（使用者要求後追加；design.md D16）

第 13 節的歸檔在本節完成後才進行。紅線沿用：合成出的語音檔交給**同一個**播放器，不另開 `speak()` 路徑。

- [x] 15.1 純函式與解析：`FugleQuoteClient.parseQuote`（closePrice → lastPrice → previousClose；change／changePercent 缺時自前收計算；401／404／429 與非 JSON 回應各有可念的原因，不得成為價格）、`StockReportScript.build`／`allFailed`／`describeFailures`／`formatNumber`／`formatDate`；完成方式：JUnit `StockReportScriptTest` 涵蓋文件範例、盤中退回、錯誤回應、無金鑰、部分失敗、全部失敗、空清單，`gradlew :app:testDebugUnitTest` 綠燈

  `FugleQuoteClient`（parseQuote／fetch／fetchAll）與 `StockReportScript` 已加入；`StockReportScriptTest` 9 個全綠（修正一處：`formatNumber` 改用 `BigDecimal.valueOf`，否則 1.005 會四捨五入成 1）。

  **使用者以自己的金鑰實機測過後改版**：口說稿改為極簡「名稱 價格。」每支一句、循環；不念頻道名、日期、漲跌、結尾；取不到的那支在原位念「名稱 無法取得」。`buildSentences` 回傳一句一個元素。測試同步。

  **句間停頓可調**：新增 `SilenceWav`（純 Java 寫 16 kHz 單聲道 PCM 靜音檔）、`Channel.pauseSeconds`（整數秒 1–600、預設 1，`clampPauseSeconds`；原為 0–10 一位小數，依使用者要求放寬上限、改整數並不允許 0）與 `roundPauseSeconds`（下一輪停頓，缺欄位沿用 pauseSeconds）；`RadioTts.synthesizeAll` 一句一檔；服務把「句、靜音、句、靜音…」串成播放清單，最後一句後也接靜音使循環之間只有同樣一次停頓。前端 `pauseSeconds` 型別、`clampPauseSeconds`、明細對話框 stepper（0.5 秒一格）。JUnit 加 2 個、vitest 加 1 個。
- [x] 15.2 模型：`RadioAlarmConfig` 新增 kind `stock`、`StockItem { symbol, name }`、`Channel.stocks`、`normalizeStockSymbol`（1–10 英數字大寫）、全域 `fugleApiKey`；股票清單允許為空、重複與不合法代號剔除；toJson 對稱；完成方式：JUnit 新增 4 個，全綠

  `CHANNEL_KIND_STOCK`、`StockItem`、`Channel.stocks`、`normalizeStockSymbol`、`fugleApiKey` 已加入；`RadioAlarmConfigTest` 新增 4 個（共 34 個全綠）。
- [x] 15.3 `RadioTts.synthesizeToFile`：初始化 → zh-TW 或任何中文 → `synthesizeToFile` → `onDone` 交檔；初始化失敗、無中文、引擎拒絕、逾時 60 秒四條路互斥收尾並 `shutdown`；`AndroidManifest.xml` 加 `TTS_SERVICE` 的 `<queries>`；完成方式：`compileDebugJavaWithJavac` 通過，**實機驗證併入 15.7**

  `RadioTts` 已加入；Manifest 加 `TTS_SERVICE` 的 `<queries>`；`compileDebugJavaWithJavac` 通過。
- [x] 15.4 播放服務：`channel.isStock()` 走 `beginStockReport`（背景抓報價 → 組稿 → 主執行緒合成 → `preparePlayer(Resolution{wav, local})`）；全部失敗以 `stockFailureMessage` 在結束或停止時 `recordFailure` 取代「播放完成」；`new ExoPlayer.Builder` 仍只有一處；完成方式：編譯通過，實機見 15.7

  `beginStockReport`／`synthesizeAndPlay` 已加入，合成的 wav 以 `Resolution{local}` 交給既有 `preparePlayer`；`stockFailureMessage` 於結束或停止時改記失敗；`new ExoPlayer.Builder` 仍只有一處。
- [x] 15.5 插件：`setRadioAlarmConfig`／`configToJs` 帶 `fugleApiKey` 與 `stocks`；新增 `lookupStock({symbol})`（背景查一支，回 ok／name／price／error，不 reject）；完成方式：編譯通過

  `setRadioAlarmConfig`／`configToJs` 帶 `fugleApiKey` 與 `stocks`；`lookupStock` 已加入。
- [x] 15.6 前端：`RadioStockChannel` 型別、`isStockChannel`、`describeChannelSummary`（取代 describeChannelFiles）、`normalizeStockSymbol`、`describeStock`、`RadioAlarmConfig.fugleApiKey`、`RadioAlarmService.lookupStock`；介面：頻道列「新增股票報價頻道」、明細對話框（名稱、金鑰密碼欄失焦寫回、股票清單可移除、代號輸入＋「加入」先查名稱、移除頻道）；完成方式：vitest 新增 3 個綠燈、`vue-tsc` 與 `npm run build` 通過、無新色碼

  型別、純函式、`lookupStock` 封裝與介面（新增鈕、明細對話框：名稱、金鑰密碼欄、股票清單可移除、代號加入先查名稱）皆已加入；vitest 新增 3 個（共 421 個）；`vue-tsc`、`npm run build` 通過；只用既有色碼。

  **聲音與語速可選**（使用者要求）：全域 `ttsVoice`／`ttsSpeechRate`（Config、插件、前端型別）；`RadioTts.listChineseVoices`、`applyVoice`；插件 `listTtsVoices`；明細對話框「聲音」按鈕開清單對話框（第一項系統預設，每列一顆 ▸ 試聽；`RadioTts.preview`／`stopPreview`、插件 `previewTtsVoice`／`stopTtsPreview`）、「語速」stepper 0.5–2.0。JUnit 加 1、vitest 加 2。

  **可用名稱加入**（使用者要求）：新增 `FugleTickerSearch`（parseTickers／cache／search 純函式，JUnit 3 個）、`FugleQuoteClient.fetchUrl`、Store 的股票清單快取（一天）、插件 `searchStocks`；前端 `searchStocks` 封裝、輸入框接受名稱、多筆命中以 action sheet 挑選。
- [ ] 15.7 實機驗證【股票報價】：填金鑰、加入 2330 與 2317 看到名稱與現價；設 2 分鐘後鬧鐘、時長 2 分，時間到念出頻道名、日期、兩支報價並循環至 2 分停；加入一個不存在的代號後再觸發，念出其餘並說「另有 1 支無法取得」；清空金鑰觸發，念出「尚未設定富果 API 金鑰」且上次結果顯示失敗；飛航模式觸發念出連不上並記失敗；手動收聽股票頻道走媒體音量；`adb shell dumpsys media.codec` 無影像解碼器
- [x] 15.8 六項建置驗證全數通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`

  功能 commit `d79d3f5`；版本 1.0.109 → 1.0.110（versionCode 147），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  口說稿極簡與停頓可調：功能 commit `03b99d7`；版本 1.0.110 → 1.0.111（versionCode 148），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  停頓上限放寬至 600 秒：功能 commit `e684629`；版本 1.0.111 → 1.0.112（versionCode 149），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  停頓改整數秒、最小 1：功能 commit `83de2e8`；版本 1.0.112 → 1.0.113（versionCode 150），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  新增鈕文字精簡：功能 commit `b26969a`；版本 1.0.113 → 1.0.114（versionCode 151），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  可用名稱加入股票：功能 commit `d66b604`；版本 1.0.114 → 1.0.115（versionCode 152），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  停頓分兩個（股票間、下一輪）：功能 commit `b4b2e4a`；版本 1.0.115 → 1.0.116（versionCode 153），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  價格後加漲跌金額：功能 commit `a27af97`；版本 1.0.116 → 1.0.117（versionCode 154），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  聲音與語速可選：功能 commit `b5d4ceb`；版本 1.0.117 → 1.0.118（versionCode 155），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

  聲音可試聽：功能 commit `73edee4`；版本 1.0.118 → 1.0.119（versionCode 156），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。
