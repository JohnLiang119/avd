## 1. 實作

- [x] 1.1 `UpdateService.ts` 新增匯出常數 `LATEST_RELEASE_URL = 'https://github.com/JohnLiang119/avd/releases/latest'`，`checkForUpdates` 預設結果的 `htmlUrl` 改用它；完成方式：`npx vue-tsc --noEmit` 通過，`grep` 確認 App.vue 與 UpdateService 內不再有第二份寫死的 releases 網址

  `LATEST_RELEASE_URL` 已匯出並供 `htmlUrl` 使用；`grep` 確認 `src/` 內不再有第二份寫死的 releases 網址。
- [x] 1.2 `App.vue`「版本與更新」區段加一列「分享下載連結」，點開對話框顯示 `qrcode-vue`（`LATEST_RELEASE_URL`、180px、level M）、一行說明、網址原文，「複製連結」寫入剪貼簿並 Toast；兩平台皆顯示；只用既有中性色；完成方式：`npm run build` 通過，`grep` 確認未引入新色碼

  「版本與更新」加一列「分享下載連結」，對話框含 `qrcode-vue`（180px／M）、說明、網址原文；「複製連結」以 `before-close` 攔下不關閉對話框並 Toast，失敗時提示改抄網址。只用既有中性色（`#64748b`／`#94a3b8`）。
- [x] 1.3 六項建置驗證（`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac`、`gradlew :app:testDebugUnitTest`）全數通過

  vue-tsc、vitest 413、npm run build、cargo check、compileDebugJavaWithJavac、testDebugUnitTest 63 個全數通過。

## 2. 驗證與進版

- [ ] 2.1 實機驗證：Android 與 Windows 各開一次對話框，以另一支手機相機掃描 QR code 能開到 GitHub 最新發布頁；「複製連結」貼到記事本為正確網址
- [ ] 2.2 功能修正與版本進版各自一個 commit，並同步更新 `avd_s/publish_all.ps1` 的預設 `$Message`
