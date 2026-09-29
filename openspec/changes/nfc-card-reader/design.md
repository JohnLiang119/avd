## Context

動機見 proposal.md「Why」，行為契約見 specs/nfc-card-reader/spec.md。本節只記與做法直接相關的現況與限制。

- **Android 端是 Capacitor**（`BridgeActivity`），原生功能以 Capacitor 插件暴露給 WebView：`MainActivity.onCreate` 以 `registerPlugin(...)` 註冊，前端以 `registerPlugin<any>('名稱')` 取得代理，事件用 `notifyListeners` 推、前端 `addListener` 收（`DownloadService.ts`、`radioAlarm.ts` 皆為此模式）。既有唯一的自訂插件 `YoutubeDlPlugin` 已超過千行。
- **「僅 Android 提供」的功能已有一套慣例**：`App.vue` 偏好設定對話框內以 `v-if="!isTauri()"` 包住 Android 專區（廣播鬧鐘、分享下載連結）；`isTauri()` 檢查 `window.__TAURI_INTERNALS__`。
- **設定持久化**走 `storage.defineSetting(key, default, { serialize, deserialize })`，Android 底層為 WebView localStorage；`config-persistence` 規格要求所有前端設定經此單一介面。
- **偏好設定本身是一個 `van-dialog`**；專案中 `van-popup`（bottom、round）已用於時間選擇器。
- **剪貼簿**既有寫法為 `navigator.clipboard.writeText`（分享連結、錯誤紀錄），在 Capacitor WebView 可用。
- **專案目前沒有任何震動相關程式碼**，Manifest 也未宣告 `VIBRATE`。
- **minSdk 24、targetSdk 36、Java 17**。`android.nfc` 自 API 10 起內建於 SDK，`NfcAdapter.enableReaderMode` 自 API 19 起可用，全部落在 minSdk 內，不需新增依賴。
- **同一份 APK 也裝在 Android TV**（Manifest 有 `LEANBACK_LAUNCHER`），TV 沒有 NFC 硬體。

## Goals / Non-Goals

**Goals:**

- 讀卡只在使用者明確開著讀卡畫面時發生，其餘時間 AVD 對系統的 NFC 行為零影響。
- 只依賴最底層的 UID 探測，不受手機晶片對 Mifare Classic 的支援差異影響。
- 原生端只做「感應並回報位元組」；格式化、去重、截斷全在前端純函式，可被 vitest 釘住。
- 不動 `YoutubeDlPlugin`、不新增第三方套件。

**Non-Goals:**

- 讀 NDEF、讀扇區、寫卡、卡片模擬（HCE）。
- 其他卡號格式（十進位、反序、Wiegand）。
- 背景讀卡、鎖屏讀卡。
- 歷史紀錄的備註、匯出、搜尋。
- Windows 端接 USB 讀卡機。

## Decisions

### D1 感應方式用 Reader Mode，不用 Foreground Dispatch，也不註冊 Manifest intent filter

- **選擇**：讀卡畫面開啟時呼叫 `NfcAdapter.enableReaderMode(activity, callback, flags, null)`，關閉時 `disableReaderMode(activity)`。
- **為什麼不是 Manifest 的 `TECH_DISCOVERED` / `TAG_DISCOVERED` intent filter**：那會讓 AVD 成為系統 NFC 分派的候選 App，使用者平常靠近任何卡片都可能被問「要用 AVD 開啟嗎」，直接違反規格「讀卡只在畫面開著時進行」。
- **為什麼不是 `enableForegroundDispatch`**：它仍走 Intent 分派（`onNewIntent`），會與 `MainActivity` 既有的 `ACTION_SEND` 處理混在同一個入口；且系統會播放平台 NFC 音效並在某些機型觸發「新標籤已掃描」的介面。Reader Mode 直接以 callback 拿到 `Tag`，路徑最短。
- **flags**：`FLAG_READER_NFC_A | FLAG_READER_NFC_B | FLAG_READER_NFC_F | FLAG_READER_NFC_V | FLAG_READER_SKIP_NDEF_CHECK | FLAG_READER_NO_PLATFORM_SOUNDS`。四種技術全開是為了不同廠牌的門禁卡都探測得到；`SKIP_NDEF_CHECK` 免去系統多做一次 NDEF 讀取（快、也不會在 Mifare Classic 上卡住）；`NO_PLATFORM_SOUNDS` 關掉系統嗶聲與震動，改由 D5 自己震一次，避免兩層回饋疊加。

### D2 獨立的 `NfcPlugin`，只回報位元組與狀態

- **選擇**：新增 `NfcPlugin.java`（`@CapacitorPlugin(name = "Nfc")`），方法：`getStatus()` 回 `{ supported, enabled }`、`startScan()`、`stopScan()`、`openSettings()`；事件：`tagDiscovered` 帶 `{ uidHex, uidLength }`、`stateChanged` 帶 `{ supported, enabled }`。
- **為什麼獨立而非加進 `YoutubeDlPlugin`**：後者已承載下載、檔案伺服器、鬧鐘、更新，責任邊界早已模糊；NFC 與它們毫無共用狀態，獨立成檔可讀性與日後移除的成本都好得多。註冊只多一行 `registerPlugin(NfcPlugin.class)`。
- **原生端就把 UID 轉成大寫 Hex**（`String.format("%02X")` 逐位元組），而不是回傳位元組陣列交前端組：規格的格式固定只有一種，Java 端一個迴圈即得，經 JS bridge 傳字串也比傳陣列省事。`uidLength` 一併回傳，供介面在 7 或 10 byte 時提示「此卡 UID 較長，門禁系統可能只取其中一段」。
- **`Tag.getId()` 即 UID**，對 NfcA／B／F／V 皆有值，不需 `MifareClassic.get(tag)`；後者在 Broadcom 晶片的手機上回 null，會讓「讀到卡卻顯示不出來」。

### D3 Reader Mode 的生命週期跟著畫面與 Activity 兩層走

- 插件保有 `scanning` 布林：`startScan()` 設 true 並啟用；`stopScan()` 設 false 並停用。
- Activity 暫停時系統會自動解除 Reader Mode。因此覆寫插件的 `handleOnResume()`：若 `scanning` 為 true，重新 `enableReaderMode` 並重查狀態、推 `stateChanged`。這一步同時滿足規格的兩個情境：「切出再切回自動恢復」與「去系統設定開啟 NFC 後回來自動開始感應」。
- **為什麼不監聽 `ACTION_ADAPTER_STATE_CHANGED` 廣播**：使用者要開 NFC 必然離開 App 去設定頁，回來時 `onResume` 一定會跑；廣播監聽多一組註冊與解除的生命週期，卻沒有多覆蓋任何情境。
- 前端以 `watch(showNfcReader)` 綁定：開為 true 呼叫 `getStatus()` 再 `startScan()`，變 false 呼叫 `stopScan()`。彈窗元件卸載時亦呼叫 `stopScan()` 作為保險。

### D4 前端介面：偏好設定內一個 cell，點開為底部 `van-popup`

- **選擇**：Android 專區新增 `van-cell` 「NFC 讀卡機」，點擊開啟 `van-popup`（`position="bottom"`、`round`），內容為狀態提示、卡號大字、複製鈕、歷史清單與清除鈕。
- **為什麼不是另一個 `van-dialog`**：偏好設定本身就是 dialog，dialog 疊 dialog 在 Vant 的層級與關閉手勢上容易互相干擾；`van-popup` 已在專案中用於時間選擇器，慣例一致。
- **三種狀態互斥顯示**：`supported=false` 只顯示「此裝置不支援 NFC」；`enabled=false` 顯示「NFC 已關閉」與「前往設定」鈕；兩者皆 true 才顯示「請將卡片靠近手機背面」。規格明定不可在無法讀卡時顯示靠近提示。
- 卡號區塊的字級與等寬字型使 `0` 與 `O`、`1` 與 `I` 可辨；Hex 只含 0–9 與 A–F，不會出現 `O` 與 `I`，但等寬仍有助於逐字核對。

### D5 回饋震動由原生端在 callback 內發出

- **選擇**：`onTagDiscovered` 內以 `Vibrator`（API 26+ 用 `VibrationEffect.createOneShot(50, DEFAULT_AMPLITUDE)`，以下退回 `vibrate(50)`）震 50 毫秒，再 `notifyListeners`。Manifest 加 `android.permission.VIBRATE`（普通權限，安裝即授予）。
- **為什麼不在前端用 `navigator.vibrate`**：WebView 對它的支援不一致，且 Reader Mode 的 callback 跑在 binder 執行緒，原生端震動與回報同步發出，回饋不會晚於畫面更新。
- **為什麼不沿用系統平台音效**：D1 已關閉，理由同上（避免雙重回饋，且系統音效在某些機型會伴隨介面）。

### D6 歷史紀錄放前端，`defineSetting` 一個鍵

- **選擇**：`storage.defineSetting<NfcHistoryEntry[]>('avd_nfc_history', [], { deserialize })`，`deserialize` 濾掉格式不符的項目並截斷至 50。每筆 `{ uid: string, at: number }`（epoch 毫秒）。
- **去重與截斷是純函式** `appendNfcHistory(list, uid, now, windowMs = 3000, max = 50)`：若第一筆同 uid 且 `now - at < windowMs` 則只更新 `at`；否則插到最前並截斷。附 vitest 涵蓋：新卡插最前、3 秒內同卡只更新時間、3 秒後同卡新增一筆、第 51 筆擠掉最舊、非最前那筆的同卡仍新增（去重只看最新一筆，符合「短時間內重複感應」的語意）。
- **為什麼不放原生端**：歷史只在讀卡畫面顯示，WebView 未執行時沒有任何讀取需求，不符 `config-persistence` 對「原生端權威」例外的條件；放前端才是該規格的正路。
- 「清除歷史」把陣列設為空即持久化；畫面目前顯示的卡號是獨立的瞬時 ref，不隨清除消失，與規格 MAY 一致。

### D7 Manifest 宣告

- `<uses-permission android:name="android.permission.NFC" />`、`<uses-permission android:name="android.permission.VIBRATE" />`：皆為普通權限，無執行期請求。
- `<uses-feature android:name="android.hardware.nfc" android:required="false" />`：沒有這行，Play 與部分側載安裝器會依權限推斷需要 NFC 硬體而拒絕安裝於 TV；本專案以 GitHub Releases 側載，但同一份 APK 要裝到 TV，必須明示非必要。與既有 `touchscreen`、`leanback` 兩行 `required="false"` 並列。

### D8 檔案落點

- 原生：`android/app/src/main/java/com/mattpocock/avd/NfcPlugin.java`（新）；`MainActivity.java` 加一行註冊；`AndroidManifest.xml` 加 D7 三行。
- 前端：`src/services/nfcReader.ts`（新：型別、插件封裝 `getNfcStatus / startNfcScan / stopNfcScan / openNfcSettings / onNfcTag / onNfcState`、純函式 `appendNfcHistory`、`sanitizeNfcHistory`）；`src/services/__tests__/nfcReader.spec.ts`（新）；`App.vue` 偏好設定新增 cell 與 popup，`defineSetting` 一行。
- 純函式與插件封裝同檔，比照 `radioAlarm.ts` 的組織方式。

## Risks / Trade-offs

- [部分門禁系統對 7 byte UID 只取前 4 或後 4 byte，使用者拿完整 UID 去對可能對不上] → 介面在 `uidLength > 4` 時附一行提示，並把完整 UID 原樣顯示，讓使用者能自行比對哪一段；不自行猜測截法。
- [Reader Mode 在 Activity 暫停時由系統解除，若只在 `startScan` 啟用一次，切出再切回會靜默失效] → D3 於 `handleOnResume` 依 `scanning` 重新啟用，並列為實機驗證項目。
- [`onTagDiscovered` 在 binder 執行緒呼叫，直接碰 UI 會崩潰] → 插件內只做震動與 `notifyListeners`（Capacitor 會派回主執行緒），不碰任何 View。
- [同一張卡持續貼著手機，Reader Mode 可能每隔數百毫秒重複回報] → 前端 3 秒去重吸收，畫面卡號不變、歷史不增；`FLAG_READER_SKIP_NDEF_CHECK` 也降低重複回報頻率。
- [使用者未開讀卡畫面就期待靠卡有反應] → 進入點 label 寫明「開啟後將卡片靠近手機背面」，靠近提示只在畫面內顯示。
- [Android TV 有 `LEANBACK_LAUNCHER` 卻無 NFC，介面出現不支援訊息略顯多餘] → 接受此代價：只在點入時顯示，不在偏好設定列表層級判斷硬體，避免啟動時多一次插件呼叫。
- [125 kHz 低頻門禁卡（EM4100、HID Prox）手機完全讀不到] → 這是硬體限制，非本設計可解；介面的靠近提示旁加一句「僅支援 13.56 MHz 卡片」，讓使用者遇到讀不到時知道原因而非以為功能壞了。

## Migration Plan

- 無資料遷移：新增的設定鍵預設為空陣列，既有設定不受影響。
- 部署即隨一般版本進版與 `all.ps1` 建置（使用者手動執行）。
- 回退：移除偏好設定的 cell 與 popup 即對使用者不可見；`avd_nfc_history` 鍵殘留於 localStorage 無害。原生插件與 Manifest 宣告可一併移除，不影響其他功能。

## Open Questions

- 7 byte UID 的門禁系統在實際比對後若發現固定取某一段，是否要在介面另加一行顯示該段？待使用者實測後決定，不影響本次規格與任務拆解。
