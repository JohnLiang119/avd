## 0. 測試可行性前提（先讀，決定每節的驗證方式）

本 change 的邏輯橫跨兩層，兩層的可驗證方式**本質不同**，任務不得混寫：

- **可自動測試層**：`src/composables/__tests__/useChannelMatching.spec.ts` 已在保護
  `src/composables/useChannelMatching.ts` 的無狀態純函式（`channelBaseline`、
  `selectNewVideos`、`nextChannelBaseline`、`buildChannelVideoTask` 等）。凡能寫成純函式的
  規則（正規化、字形折算、輸入上限、比對、錨點計算、訊息片段）一律放進該檔，並以
  `npx vitest run src/composables/__tests__/useChannelMatching.spec.ts` 驗證。
- **不可自動測試層（實際佈線）**：檢查迴圈、模擬入口、備份還原與關鍵字 UI 都寫在
  `src/App.vue` 的 `<script setup>` 內嵌未匯出函式中；本專案**未安裝 `@vue/test-utils`**，
  現有 12 個 spec 檔**沒有任何一個 mount `App.vue`**。因此第 2～4 節**不得宣稱自動測試覆蓋**，
  一律以「靜態核對（grep 呈現呼叫佈線）＋ 第 5 節指定編號的人工驗證」作為完成方式。

## 1. 關鍵字資料模型與共用純函式（可自動測試層）

本節全部實作於既有的 `src/composables/useChannelMatching.ts`，並在
`src/composables/__tests__/useChannelMatching.spec.ts` 增補案例。除另有註明外，
每項的完成方式皆為：`npx vitest run src/composables/__tests__/useChannelMatching.spec.ts` 綠燈
且該項指定案例存在。

- [x] 1.1 擴充 `MonitoredChannelLike` 與 `src/App.vue` 的 `MonitoredChannel` 加入選填 `keywords?: string[]`，並在持久化反序列化時統一正規化；完成方式：測試驗證三種既有資料形態 ——「缺少 `keywords` 欄位」「`keywords` 為 `undefined`」「`keywords` 為非陣列值」—— 經正規化後皆得到 `[]`，且空清單時比對函式一律回傳符合（全量追蹤行為不變）
- [x] 1.2 實作關鍵字正規化純函式：輸入限字串、去除前後空白、移除空項、以正規化值去除重複項；【D-D】去重後 MUST 保留使用者輸入的**第一個**對應項目之原始大小寫作為顯示文字；完成方式：測試驗證 `['AI', 'ai', ' Ai ']` 去重後長度為 1 且顯示文字為 `'AI'`
- [x] 1.3 【D-A】實作單一字形正規化管線，並對**關鍵字與影片標題兩側各自套用同一管線**：先 `normalize('NFKC')`（全形英數→半形）、再以專案既有 `opencc-js` 依賴折算到簡體字形域（沿用 `DownloadService.ts` 既有的 `{ from: 't', to: 'cn' }` 設定，避開台灣標準對「么」的強制校正）、最後轉小寫。MUST NOT 新增第三方依賴；MUST NOT 從 `DownloadService.ts` 匯入該轉換器（該檔帶 Tauri 執行期相依，匯入會使單元測試無法載入），改為在本模組自行建立。完成方式：混合字形固定案例測試，標題「機器学习入門」與「机器学习入门」× 關鍵字「學習」與「学习」的**四種組合全部命中**，另加全形「ＡＩ」標題對關鍵字「ai」命中
- [x] 1.4 【D-E】實作輸入契約純函式：每頻道關鍵字數上限 20、單項長度上限 100 字元；「空白」的判定 MUST 涵蓋 Unicode 空白與零寬字元（U+200B～U+200D、U+2060、U+FEFF）；超出上限 MUST 回傳可供 UI 顯示的拒絕原因，**MUST NOT 靜默截斷**；完成方式：測試驗證第 21 項被拒絕（回傳原因且結果仍為 20 項）、101 字元項被拒絕、以 U+200B、U+200C、U+200D、U+2060、U+FEFF 零寬字元加全形空白 U+3000 組成的項目視為空白而被移除、前後夾 U+200B 的「ai」正規化為 `'ai'` 且仍能命中、100 字元項可通過
- [x] 1.5 實作 OR 標題子字串比對與「命中／未命中」分割純函式（回傳命中候選清單與未命中清單兩者），空關鍵字清單一律視為全部命中；此分割是【D-C】（未命中影片 MUST NOT 觸發直播狀態查詢）在純函式層的可測試部分，實際佈線見 3.1；完成方式：測試驗證多關鍵字任一命中即進入命中清單、未命中影片只出現在未命中清單、空清單時未命中清單為空
- [x] 1.6 【D-B】修正 `nextChannelBaseline` 的錨點守門：由現行「把未處理影片從候選中剔除後取最大值」改為「錨點 MUST NOT 超過任何未處理影片的發布時間」——候選僅限發布時間**嚴格小於**未處理影片最小發布時間者，取其最大值；未命中關鍵字的影片不計入未處理集合（可被越過）；缺少精確發布時間（`publishedTime` 為 `0`）時仍不推進，MUST NOT 以當下時間替代。完成方式：**新增**測試案例「較舊的未處理影片不得被越過」——影片 `[n1 最新／已處理, n2 較舊／未處理, n3 最舊／已處理]` 的錨點結果 MUST 為 `n3`（現行實作會錯誤地回傳 `n1`），且既有的「unhandled 恰為最新」「全數未處理時錨點不變」「不倚賴輸入順序」案例仍綠燈
- [x] 1.7 【D-F】實作備援候選視窗上限：本輪影片皆來自 `source === 'fallback'` 且筆數達備援上限（`--playlist-end 2`，即 2 筆）時，錨點 MUST NOT 推進至超過本輪實際取回影片的**最小**發布時間（避免跨過未被比對的影片）；官方 RSS（約 15 筆）不套用此上限。完成方式：測試驗證 2 筆備援影片時錨點取較舊者、1 筆備援影片（未達上限）時不套用上限、RSS 來源不受影響
- [x] 1.8 【D-G】實作檢查結果訊息片段純函式（沿用 `src/services/rateLimit.ts` 既有 `describeChannelRssFailure`／`describeEarlyStop` 的「純函式產生訊息片段、由 `App.vue` 組裝 Toast」慣例）：「本輪有 N 部符合既有新片條件的影片、但全部未命中關鍵字」MUST 與「目前沒有新影片」產生**不同**訊息；「發現 N 部新影片」的 N MUST 只計入實際建立下載任務的影片數。完成方式：測試驗證 `N=0` 與「有候選但全部未命中」兩種輸入產生不同字串、且命中 2 部但其中 1 部因直播未建立任務時 N 為 1
- [x] 1.9 【D-H】實作還原錨點保守選擇純函式：覆蓋還原時若備份的頻道錨點晚於本機現值，MUST 取較舊（較保守）者，避免跨裝置還原造成永久漏片；完成方式：測試驗證備份錨點較新時回傳本機值、較舊時回傳備份值、任一方缺值時回傳另一方有效值

## 2. 頻道關鍵字管理介面（`App.vue`／人工驗證）

本節為 `src/App.vue` 模板與內嵌函式，無自動測試覆蓋（見第 0 節）。

- [x] 2.1 在頻道卡片第二行加入顯示「全部影片」或關鍵字數量的精簡入口；完成方式：`openspec/specs/channel-ui-layout/spec.md` 的雙行結構不變，並由 5.11 人工驗證桌面與手機寬度下無橫向捲軸、既有啟用／刪除／模擬操作皆可用
- [x] 2.2 建立暫存式（草稿）關鍵字編輯對話框，支援 Enter、半形逗號、全形逗號新增標籤，以及單項刪除、全部清空、確認與取消；【D-E】UI MUST 明確告知「逗號為分隔符，不可作為關鍵字內容」，並在超出 20 項／100 字元時顯示 1.4 回傳的拒絕原因而非靜默截斷；完成方式：由 5.11 人工驗證取消不寫入、確認後重新開啟仍為正規化結果、超限有提示且未截斷
- [x] 2.3 確認時把草稿套用到訂閱並關閉對話框。**注意前提已修正**：`src/composables/useStorage.ts` 的 watch 已是 `{ deep: true }`，原地修改 `keywords` 陣列一樣會觸發持久化，因此「替換頻道物件」只是草稿／確認語意與不可變風格的選擇，**不是持久化的必要條件**，實作時不需為此增加額外複雜度；完成方式：`grep -n "deep: true" src/composables/useStorage.ts` 確認深度監聽存在，並由 5.11 人工驗證重新啟動應用程式後關鍵字仍存在

## 3. 自動、手動與模擬檢查的實際佈線（`App.vue`／人工驗證）

本節為 `src/App.vue` 檢查迴圈與模擬入口的佈線，**不宣稱自動測試覆蓋**（見第 0 節）；
純函式規則本身已由第 1 節測試。

- [x] 3.1 在既有新片判定（`selectNewVideos`）之後、直播狀態查詢**之前**插入 1.5 的命中／未命中分割，迴圈只走命中候選清單；【D-C】未命中影片 MUST NOT 觸發直播狀態查詢。設計性檢查：`DownloadService.fetchYouTubeRss` 一次回傳含 `source` 標記的統一陣列，檢查迴圈只有一條，因此官方 RSS 與 yt-dlp 備援自動共用同一條篩選路徑，無須也不得為兩來源分寫邏輯。完成方式：`grep -n "checkVideoLiveStatus\|fetchYouTubeRss" src/App.vue` 呈現「每頻道每輪僅一次 `fetchYouTubeRss`」且 `checkVideoLiveStatus` 的唯一呼叫點位於命中候選迴圈內，並由 5.7 人工驗證未命中影片的直播查詢確實未發出
- [x] 3.2 保持首次追蹤與完整 Feed 錨點計算的既有順序，並把 1.6／1.7 的新錨點規則接上：未命中關鍵字的影片不加入未處理集合（可被越過）、命中但屬直播／狀態未知者仍加入未處理集合；完成方式：`grep -n "unhandledVideoIds\|nextChannelBaseline" src/App.vue` 呈現未處理集合只收命中影片，並由 5.8 人工驗證錨點不越過較舊的未處理影片
- [x] 3.3 將 1.8 的訊息片段接上檢查結果 Toast：【D-G】區分「全部未命中關鍵字」與「目前沒有新影片」，且「發現 N 部新影片」的 N 只計入實際建立任務數；完成方式：`grep -n "newVideoCount" src/App.vue` 呈現計數只在 `tasks.value.unshift` 成功後遞增（因直播或狀態未知而跳過者不遞增），並由 5.9 人工驗證兩種提示文案確實不同
- [x] 3.4 修改單頻道模擬為選擇最新**命中**影片、全頻道模擬為每頻道最多選擇最新兩支**命中**影片；無命中時顯示專用提示且 MUST NOT 建立任何測試任務；完成方式：`grep -n "simulateNewVideo\|simulateGlobalNewVideo" src/App.vue` 呈現兩入口皆套用 1.5 的分割函式，並由 5.10 人工驗證無命中時不產生任務
- [x] 3.5 【D-I】確認頻道物件的三個建構點（頻道管理彈窗新增、網址列自動加入追蹤、還原匯入）**全數**經同一關鍵字正規化，新增頻道一律寫入 `keywords: []` 而非留 `undefined`；完成方式：`grep -n "monitoredChannels.value.push\|monitoredChannels.value = " src/App.vue` 列出的每一處建構點（還原匯入含覆蓋的 `map` 與合併的 `push` 兩處程式位置）都可見正規化呼叫，無遺漏

## 4. 備份與還原相容性（`App.vue`／人工驗證）

- [x] 4.1 確保記憶體中的 `keywords` 已正規化，使既有 `exportChannelsJson`（直接序列化 `monitoredChannels.value`）與雲端備份自然攜帶該欄位，不新增備份版本協定；完成方式：`grep -n "channels: monitoredChannels.value" src/App.vue` 確認匯出未再作欄位挑選，並由 5.10 人工驗證匯出的 JSON 每個頻道皆含正規化後的 `keywords` 陣列
- [x] 4.2 在覆蓋還原與合併新增頻道時以 1.2～1.4 的函式正規化匯入關鍵字（涵蓋新版備份、缺少欄位的舊版備份、非字串／空白／重複值），合併遇到重複 Channel ID 時保留本機頻道與其關鍵字；完成方式：`grep -n -A 40 "onRestoreActionSelect" src/App.vue` 呈現覆蓋與合併兩條還原路徑皆呼叫同一正規化，並由 5.10 人工驗證四種備份輸入
- [x] 4.3 【D-H】覆蓋還原時以 1.9 的保守選擇決定頻道錨點（備份錨點較新則保留本機較舊值）；合併還原時統計「因 Channel ID 已存在而未套用匯入關鍵字」的頻道數並在結果提示中告知；完成方式：`grep -n "已覆蓋還原\|合併完成" src/App.vue` 呈現合併提示含該數量，並由 5.10 人工驗證跨裝置還原後錨點未被推新、合併提示數量正確

## 5. 整合與跨平台驗證

5.1～5.5 為根 `CLAUDE.md`「版本進版規範」第 3 條要求的**五項**建置驗證，全數通過才可進版。

- [x] 5.1 執行 `npm run build`，確認正式前端建置（含 `vue-tsc -b`）成功
  - `vite v8.1.5` 建置成功（含 `vue-tsc -b`），366 個模組轉換完成。
- [x] 5.2 執行 `npm test`，確認第 1 節新增案例與所有既有單元測試全數通過
  - 12 個測試檔、253 個測試全數通過（`useChannelMatching.spec.ts` 由 29 增至 56 個案例）。
- [x] 5.3 執行 `npx vue-tsc --noEmit`，確認 Vue／TypeScript 型別檢查無錯誤
  - 無型別錯誤。
- [x] 5.4 執行 `cargo check --manifest-path src-tauri/Cargo.toml`（或於 `src-tauri` 目錄執行 `cargo check`），確認 Rust 端編譯無錯誤
  - `Finished dev profile`，Rust 端編譯無錯誤。
- [x] 5.5 執行 Android `gradlew :app:compileDebugJavaWithJavac`，確認訂閱資料與前端變更未破壞 Android 編譯
  - `BUILD SUCCESSFUL`，81 個 task 完成。
- [ ] 5.6 人工驗證【基本篩選】：無關鍵字頻道維持全量追蹤；設定單一與多重關鍵字時 OR 命中；未命中影片不出現在下載佇列；清空所有關鍵字後恢復全量追蹤；修改關鍵字不回補先前已檢查的影片
- [ ] 5.7 人工驗證【D-C 直播查詢未發出】：對設有關鍵字的頻道執行立即檢查，於開發者工具 Console／錯誤日誌確認**未命中影片沒有任何直播狀態查詢紀錄**，僅命中影片有
- [ ] 5.8 人工驗證【D-B 錨點守門】：構造「較新的未命中影片 + 較舊的命中但屬直播／狀態未知影片」情境，確認該直播影片在下一輪仍被視為新片（錨點未越過它），且未命中影片不再重複比對
- [ ] 5.9 人工驗證【D-G 回饋訊息】：分別造出「本輪無任何新片」與「本輪有新片但全部未命中關鍵字」，確認兩者提示文案明確不同；並確認「發現 N 部新影片」的 N 等於佇列實際新增的任務數（命中但因直播跳過者不計入）
- [ ] 5.10 人工驗證【備份還原】：匯出含關鍵字的備份並檢視 JSON；以覆蓋與合併兩模式還原新版備份、缺欄位的舊版備份、含非字串／空白／重複值的備份；確認【D-H】備份錨點較新時保留本機較舊值、合併時因 Channel ID 已存在而未套用關鍵字的頻道數出現在提示中
- [ ] 5.11 人工驗證【UI 與持久化】：桌面與手機寬度下頻道卡片維持雙行、無橫向捲軸；關鍵字對話框的 Enter／半形逗號／全形逗號、單項刪除、全部清空、取消不寫入皆正常；【D-E】超出 20 項或 100 字元時有拒絕提示且未靜默截斷、逗號不可作為關鍵字內容的說明可見；重新啟動應用程式後關鍵字仍存在
- [ ] 5.12 人工驗證【單／全頻道模擬】：兩個模擬入口皆只選命中影片（全頻道每頻道最多兩支），無命中時顯示專用提示且不建立任何測試任務

## 6. 提交與版本進版

- [x] 6.1 在第 5 節全部驗證完成後建立功能修正 commit，並以 `git status --short` 與 commit diff 確認只包含本 change 的程式、測試及 OpenSpec 任務進度
  - commit `<pending>`：功能與測試（`useChannelMatching.ts`、其 spec、`App.vue`）與本檔進度。
  - 依使用者指示於 5.6～5.12 人工驗證前先行提交與進版。
- [ ] 6.2 將 avd 下一版版號同步更新至 `package.json`、`package-lock.json` 兩處、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（以 `cargo update --workspace --offline` 同步）、`android/app/build.gradle` 的 `versionName`／`versionCode`（皆須遞增），並更新 `avd_s/publish_all.ps1` 的版本化預設發布說明；以跨檔比對確認七處版號一致
- [ ] 6.3 重新執行五項建置驗證 —— `npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml`、`gradlew :app:compileDebugJavaWithJavac` —— 全數通過後建立獨立的版本進版 commit（與 6.1 分開，保留可單獨 revert 的空間），確認發布腳本的預設訊息版號與 `package.json` 一致；發布腳本仍由使用者手動執行，進版後主動告知使用者可以發布
