## 0. 先讀：驗證重心

原生端只有 Manifest 宣告與一個薄插件，「感應到卡」這件事只能在**有 NFC 的實機**驗證；所有能抽成純函式的邏輯（卡號歷史的去重與截斷、壞資料清理）放前端並以 vitest 釘住，讓實機驗證只剩「系統會不會照做」這一層。每一組任務附帶其驗證方式，第 4 組是跨任務的整合與實機驗證清單。

兩條紅線：

```
  1. 讀卡畫面沒開時，AVD MUST NOT 對任何 NFC 卡片有反應（design.md D1：不註冊 intent filter）。
  2. 切出再切回、或去系統設定開 NFC 再回來，感應 MUST 自動恢復（design.md D3）。
```

## 1. 前端純函式與插件封裝（先做，可單元測試）

- [x] 1.1 建立 `src/services/nfcReader.ts`：型別 `NfcHistoryEntry { uid, at }`、`NfcStatus { supported, enabled }`；純函式 `appendNfcHistory(list, uid, now, windowMs = 3000, max = 50)` 與 `sanitizeNfcHistory(raw, max = 50)`；完成方式：`src/services/__tests__/nfcReader.spec.ts` 涵蓋「新卡插最前」「3 秒內同卡只更新時間」「3 秒後同卡新增一筆」「第 51 筆擠掉最舊」「非最新那筆的同卡仍新增」「sanitize 濾掉非物件、uid 非字串、at 非數字的項目並截斷至 50」，`npm test` 綠燈
- [x] 1.2 同檔加入插件封裝：`registerPlugin<any>('Nfc')`，匯出 `getNfcStatus()`、`startNfcScan()`、`stopNfcScan()`、`openNfcSettings()`、`onNfcTag(cb)`、`onNfcState(cb)`（後兩者回傳可移除的 listener handle）；完成方式：`npx vue-tsc --noEmit` 通過，且 1.1 的測試不因引入 `@capacitor/core` 而失敗（比照 `radioAlarm.spec.ts` 的處理方式）

## 2. Android 原生

- [x] 2.1 `AndroidManifest.xml` 新增 `android.permission.NFC`、`android.permission.VIBRATE` 與 `uses-feature android.hardware.nfc required=false`（與既有 `touchscreen`、`leanback` 並列）；完成方式：`gradlew :app:compileDebugJavaWithJavac` 通過，`android/app/build/intermediates/merged_manifests/debug/AndroidManifest.xml` 中三行皆存在且 `required="false"`
- [x] 2.2 新增 `NfcPlugin.java`（`@CapacitorPlugin(name = "Nfc")`）：`getStatus` 以 `NfcAdapter.getDefaultAdapter` 為 null 判 `supported`、`isEnabled()` 判 `enabled`；`startScan`／`stopScan` 維護 `scanning` 並呼叫 `enableReaderMode`（design.md D1 的 flags）／`disableReaderMode`；`openSettings` 開 `Settings.ACTION_NFC_SETTINGS`；`onTagDiscovered` 把 `tag.getId()` 轉大寫 Hex、震動 50 毫秒（API 26+ 用 `VibrationEffect`）、`notifyListeners("tagDiscovered", { uidHex, uidLength })`，不碰任何 View；`handleOnResume` 在 `scanning` 為 true 時重新啟用並推 `stateChanged`；完成方式：編譯通過，實機 `adb logcat -s NfcPlugin` 在靠卡時印出 uidHex
- [x] 2.3 `MainActivity.onCreate` 加 `registerPlugin(NfcPlugin.class)`（在 `super.onCreate` 之前，與 `YoutubeDlPlugin` 同位置）；完成方式：前端呼叫 `getNfcStatus()` 回 `{ supported, enabled }` 而非 `"Nfc" plugin is not implemented`

  三項皆以 `gradlew :app:compileDebugJavaWithJavac` 編譯通過，合併後 Manifest 含三行宣告。2.2 的 logcat 與 2.3 的前端回傳屬實機行為，於 4.2 一併驗證。

## 3. 前端介面（App.vue）

- [x] 3.1 `storage.defineSetting<NfcHistoryEntry[]>('avd_nfc_history', [], { deserialize: sanitizeNfcHistory })`；完成方式：手動塞入 51 筆與一筆壞資料到 localStorage 後重啟，畫面歷史為 50 筆且無壞資料
- [x] 3.2 偏好設定 Android 專區（`v-if="!isTauri()"` 內）新增 `van-cell` 「NFC 讀卡機」，label 寫明「開啟後將卡片靠近手機背面」，點擊設 `showNfcReader = true`；完成方式：Android 偏好設定看得到、`npm run tauri:dev` 的 Windows 偏好設定看不到
- [x] 3.3 新增 `van-popup`（bottom、round）：依 `{ supported, enabled }` 三態互斥顯示「此裝置不支援 NFC」／「NFC 已關閉」＋「前往設定」鈕／「請將卡片靠近手機背面（僅支援 13.56 MHz 卡片）」；卡號以等寬大字顯示，附「複製」鈕（`navigator.clipboard.writeText` 後 `showToast('已複製')`），`uidLength > 4` 時附一行提示；歷史清單最新在上（時間以既有 `displayFormat` 慣例顯示）與「清除歷史」鈕；完成方式：以 2.2 的插件在實機切換 NFC 開關，三態顯示正確且無法讀卡時不出現靠近提示
- [x] 3.4 `watch(showNfcReader)`：true 時先 `getNfcStatus()` 再 `startNfcScan()` 並註冊 `onNfcTag`／`onNfcState`；false 時 `stopNfcScan()` 並移除 listener；`onBeforeUnmount` 亦 `stopNfcScan()`；收到 `tagDiscovered` 時更新目前卡號並 `appendNfcHistory`；完成方式：關閉彈窗後靠卡，畫面與歷史皆無變化（紅線 1）

  四項程式碼完成：`npx vue-tsc --noEmit`、`npm run build`、`npm test`（438 個測試）皆通過；Windows 端不顯示由 `v-if="!isTauri()"` 結構保證。3.1 的還原清理已由 `sanitizeNfcHistory` 單元測試涵蓋；三態顯示、關閉後靠卡無反應等實機行為於 4.2 驗證。

## 4. 建置與實機驗證

- [x] 4.1 完整建置驗證：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`（於 `src-tauri`）、`gradlew :app:compileDebugJavaWithJavac` 全數通過；完成方式：五個指令皆零錯誤

  五個指令皆零錯誤：`npm run build`、`npm test`（16 檔 438 測試）、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac`。
- [ ] 4.2 實機驗證（有 NFC 的 Android 手機）：(a) 4 byte 門禁卡顯示 8 碼大寫 Hex 且與 NFC Tools 顯示一致；(b) 若有 7 byte 卡，顯示 14 碼並出現長度提示；(c) 複製後貼到記事本內容一致；(d) 靠卡時震動一次且無系統嗶聲；(e) 同卡貼著不放，歷史只有一筆；(f) 讀卡畫面開著切到其他 App 再切回，靠卡仍有反應（紅線 2）；(g) 關閉 NFC 後開畫面顯示已關閉，按「前往設定」開啟 NFC 返回後自動變為靠近提示且可讀卡；(h) 關閉畫面後靠卡，AVD 無任何反應且系統不跳「以 AVD 開啟」（紅線 1）；(i) 完全關閉 App 再開，歷史仍在；完成方式：九項逐一勾核於本任務下方
- [ ] 4.3 無 NFC 裝置驗證：Android TV 或 Android 模擬器（無 NFC）安裝 APK 成功，開啟讀卡畫面顯示「此裝置不支援 NFC」且無靠近提示、無前往設定鈕；完成方式：安裝成功且畫面如述

## 5. 進版與提交

- [ ] 5.1 功能 commit（繁體中文訊息，commit 訊息檔無 BOM）；完成方式：`git log -1` 訊息正確，diff 不含進版檔案
- [ ] 5.2 依工作區規範同步七處版號（`package.json`、`package-lock.json` 兩處、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`Cargo.lock` 以 `cargo update --workspace --offline`、`android/app/build.gradle` 的 `versionName` 與 `versionCode`），並把 `avd_s/publish_all.ps1` 的 `$Message` 預設值改為描述本次改動且版號正確的文字；完成方式：`grep` 七處版號一致，`publish_all.ps1` 的版號與 `package.json` 相同
- [ ] 5.3 進版 commit（獨立於 5.1）；完成方式：`git log -2` 為「功能」與「進版」兩筆，並告知使用者可手動執行 `all.ps1` 與發布腳本
