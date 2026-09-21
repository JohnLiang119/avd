## 1. 實作

- [x] 1.1 `UpdateService.ts` 新增匯出常數 `LATEST_RELEASE_URL = 'https://github.com/JohnLiang119/avd/releases/latest'`，`checkForUpdates` 預設結果的 `htmlUrl` 改用它；完成方式：`npx vue-tsc --noEmit` 通過，`grep` 確認 App.vue 與 UpdateService 內不再有第二份寫死的 releases 網址

  `LATEST_RELEASE_URL` 已匯出並供 `htmlUrl` 使用；`grep` 確認 `src/` 內不再有第二份寫死的 releases 網址。
- [x] 1.2 `App.vue`「版本與更新」區段加一列「分享下載連結」，點開對話框顯示 `qrcode-vue`（`LATEST_RELEASE_URL`、180px、level M）、一行說明、網址原文，「複製連結」寫入剪貼簿並 Toast；兩平台皆顯示；只用既有中性色；完成方式：`npm run build` 通過，`grep` 確認未引入新色碼

  「版本與更新」加一列「分享下載連結」，對話框含 `qrcode-vue`（180px／M）、說明、網址原文；「複製連結」以 `before-close` 攔下不關閉對話框並 Toast，失敗時提示改抄網址。只用既有中性色（`#64748b`／`#94a3b8`）。
- [x] 1.3 六項建置驗證（`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac`、`gradlew :app:testDebugUnitTest`）全數通過

  vue-tsc、vitest 413、npm run build、cargo check、compileDebugJavaWithJavac、testDebugUnitTest 63 個全數通過。

## 2. 驗證與進版

- [x] 2.1 實機驗證：Android 與 Windows 各開一次對話框，以另一支手機相機掃描 QR code 能開到 GitHub 最新發布頁；「複製連結」貼到記事本為正確網址

  **已被第 3 節取代**（使用者審閱後改為指向 APK 本身且只在 Android），不再驗證此版行為；實機驗證見 3.6。
- [x] 2.2 功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`

  功能 commit `312e64d`；版本 1.0.106 → 1.0.107（versionCode 144），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。

## 3. 審閱後修正：指向 APK 本身、只在 Android（design.md D1／D2 改版）

- [x] 3.1 新增 `releaseAssets.ts`：`pickApkAsset(assets)`（`.apk` 不分大小寫、需有 `browser_download_url`）、`versionFromTag`；vitest 釘住不會挑到 msi 或校驗檔；完成方式：`npm test` 綠燈

  `releaseAssets.ts` 與 `releaseAssets.spec.ts`（4 個測試）；`npm test` 417 passed。
- [x] 3.2 `UpdateService.fetchLatestApk(timeoutMs)`：GET `releases/latest`（正式版），回傳 `{ url, name, version }` 或 null，不拋例外；完成方式：`npx vue-tsc --noEmit` 通過

  `fetchLatestApk` 已加入，離線／逾時／無 APK 回 null；`vue-tsc` 通過。
- [x] 3.3 `App.vue`：那一列加 `v-if="!isTauri()"`；開啟時查詢，查詢中顯示載入指示而非 QR code；QR code 與「複製連結」皆用查到的 APK 網址，查不到退回 `LATEST_RELEASE_URL` 並以一行說明；說明含版本與檔名；完成方式：`npm run build` 通過

  那一列 `v-if="!isTauri()"`；查詢中顯示 `van-loading`（180px 高，對話框不跳動）；QR code 與複製皆用 `shareDownloadUrl`；說明含版本與檔名，退回時改為一行說明。`npm run build` 通過。
- [x] 3.4 規格、design、proposal 同步為改版後的內容；`openspec validate share-latest-apk-qrcode` 通過；delta 規格無 BOM

  三份文件已改為 D1／D2 改版後內容；`openspec validate` 通過；delta 規格無 BOM。
- [ ] 3.5 六項建置驗證通過後，功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`
- [ ] 3.6 實機驗證（取代 2.1）：Android 開對話框後 QR code 內容為 `.../releases/download/v<最新版>/AVD_<最新版>.apk`，另一支手機掃描後直接開始下載；飛航模式下開啟則顯示發布頁網址與說明；Windows 端不見此列
