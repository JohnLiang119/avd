## 0. 前置驗證與測試可行性（先讀）

**~~阻擋性前置條件~~ 已解除**：第 3 節倚賴「yt-dlp 的排程直播錯誤訊息會原樣抵達 Android 的 Java catch」。
該前提已於規劃階段以位元組碼驗證成立（見任務 1.1），無須實機確認，第 3 節可直接開工。

可測性分層（不得混寫）：

- **可自動測試**：判定樣式的純函式（`src/services/`），以 vitest 覆蓋。這是本 change 唯一能自動
  驗證的邏輯，也是最值得寫測試的部分 —— 它是整個修正的關鍵前提。
- **不可自動測試**：`checkVideoLiveStatus` 的桌面分支（`Command.sidecar`）、Android 原生外掛、
  以及 `App.vue` 的檢查迴圈（本專案未安裝 `@vue/test-utils`，13 個 spec 檔無一 mount `App.vue`）。
  這些以靜態核對（grep 呈現佈線）加第 5 節的驗證作為完成方式。
- **回歸保護**：`useChannelMatching.spec.ts` 的 59 個案例是本 change 的安全網。本 change **不應**
  改動錨點演算法，若這些測試出現任何失敗，代表意外改到了錨點語意，須停下檢視而非調整測試。

## 1. 前置確認

- [x] 1.1 【原為阻擋性，已於規劃階段解決】確認 Android 端 yt-dlp 的排程直播錯誤訊息可抵達 Java catch
  - 反組譯 `io.github.junkfood02.youtubedl-android:library:0.18.1` 的 `YoutubeDL.execute()`：`638: astore 20 <- errBuffer.toString()`（stderr），`642: ifle 699`（exitCode 判斷），`689: new YoutubeDLException` / `693: aload 20` —— 例外訊息即為**完整 stderr**。
  - 外掛的 catch 為 `call.reject("查詢直播狀態失敗: " + e.getMessage())`，故 yt-dlp 原始錯誤會原樣傳到前端。**不需實機驗證，也不需改採其他辨識方式。**

- [ ] 1.2 蒐集判定樣式的實際樣本：至少涵蓋桌面 sidecar 與 Android 兩處的訊息，以及不同剩餘時間的措辭（實測已知 `This live event will begin in 6 hours` / `in 5 hours`）；完成方式：把樣本寫入 1.3 的測試案例，作為樣式比對的依據

## 2. 判定樣式純函式（可自動測試）

- [ ] 2.1 【D-D】於 `src/services/` 新增（或併入既有的 `downloadErrors.ts`，與 `matchPermanentError` 同類）判定純函式：輸入錯誤訊息字串，輸出是否代表「排程未開播的直播」；比對 MUST 以較寬鬆的關鍵片段（如 `live event will begin`）而非整句完全匹配，以容忍 yt-dlp 用詞變動；完成方式：`npx vitest run` 綠燈，且下列案例存在 —— 1.2 蒐集的真實樣本判為 true、一般網路逾時／DNS 失敗判為 false、空字串與 null 判為 false、大小寫差異仍判為 true
- [ ] 2.2 【保守預設】確認比對失敗時的退化行為為 `'unknown'`（即目前行為），MUST NOT 誤判為 `'not_live'`；完成方式：測試驗證無法辨識的錯誤訊息不會導致回傳可下載的狀態

## 3. 兩平台接線（靜態核對）

- [ ] 3.1 桌面端 `DownloadService.checkVideoLiveStatus` 的 catch 區塊套用 2.1 的判定：命中則回傳 `'live'`，否則維持 `'unknown'`；完成方式：`grep -n "checkVideoLiveStatus" -A 20 src/services/DownloadService.ts` 呈現 catch 中的判定呼叫，且 `npx vue-tsc --noEmit` 通過
- [ ] 3.2 【D-C】Android `YoutubeDlPlugin.checkVideoLiveStatus` 的 catch 比照：命中樣式時 `call.resolve` 回 `is_upcoming`（而非 `call.reject`），使前端得到 `'live'`；完成方式：`gradlew :app:compileDebugJavaWithJavac` 通過，且 Java 端的樣式常數以註解指向 2.1 的純函式、註明兩處須同步
- [ ] 3.3 確認 API 通道無須改動：`youtubeDataApi.mapLiveStatus` 已將 `liveBroadcastContent: 'upcoming'` 映射為 `'live'`；完成方式：`grep -n "upcoming" src/services/youtubeDataApi.ts` 呈現既有映射，且其既有測試仍綠燈

## 4. 檢查迴圈收斂未處理集合

- [ ] 4.1 【D-A】`App.vue` 檢查迴圈改為**僅** `liveStatus === 'unknown'` 時加入 `unhandledVideoIds`；`'live'` 仍不建立任務、不計入 `newVideoCount`，但不進入該集合；完成方式：`grep -n "unhandledVideoIds.add" -B 6 src/App.vue` 呈現該加入受 `'unknown'` 條件保護
- [ ] 4.2 確認 `nextChannelBaseline` **未被改動**；完成方式：`git diff src/composables/useChannelMatching.ts` 為空
- [ ] 4.3 確認記錄用的 Console 訊息仍能區分兩種情形（跳過直播 vs 狀態未知），以利日後診斷；完成方式：`grep -n "跳過直播\|狀態查詢失敗" src/App.vue` 兩者皆在

## 5. 驗證

- [ ] 5.1 執行五項建置驗證全數通過：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml`、`gradlew :app:compileDebugJavaWithJavac`
- [ ] 5.2 【回歸安全網】`useChannelMatching.spec.ts` 的 59 個案例全數維持綠燈。**若有任何失敗，代表本 change 意外改動了錨點語意，須停下檢視而非調整測試**
- [ ] 5.3 人工驗證【卡死已解除】：對 `中廣新聞網`（`UCkqrvXuqW7dN3E2_4v8Ha5Q`，或其他每日有排程直播的頻道）執行立即檢查兩次，確認①第二次不再把同一批影片判定為新片②頻道卡片的 🕒 時間推進至接近最新影片③清空下載佇列後再檢查，**不再湧入先前已處理過的影片**
- [ ] 5.4 人工驗證【排程直播仍不入佇列】：確認該頻道的 `is_upcoming` 影片沒有被加入下載佇列（規格只放寬錨點，未放寬佇列排除）
- [ ] 5.5 人工驗證【Android 端一致】：於 Android 重複 5.3，確認錨點同樣能推進 —— 這是 D-C 的關鍵前提，且 Android 是主要使用平台

## 6. 提交與版本進版

- [ ] 6.1 建立功能修正 commit，並以 `git status --short` 與 commit diff 確認只包含本 change 的程式、測試及 OpenSpec 任務進度
- [ ] 6.2 將 avd 下一版版號同步更新至七處：`package.json`、`package-lock.json`（2 處）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（以 `cargo update --workspace --offline` 同步）、`android/app/build.gradle` 的 `versionName`／`versionCode`（皆須遞增），並更新 `avd_s/publish_all.ps1` 的版本化預設發布說明；以跨檔比對確認七處一致
- [ ] 6.3 【發布說明須含遷移提示】既有已被污染的頻道錨點不會自動復原 —— 修正後第一次檢查仍會把舊錨點之後的影片判定為新片（實測案例為 32 支）。發布說明 MUST 告知使用者可能有一次性的舊片湧入，清空佇列一次即可；完成方式：`publish_all.ps1` 的預設 `$Message` 含該提示
- [ ] 6.4 重新執行五項建置驗證全數通過後，建立獨立的版本進版 commit（與 6.1 分開）；**提交與進版期間 MUST NOT 併行執行發布腳本** —— 工作區乾淨且已推送後，才由使用者手動執行
