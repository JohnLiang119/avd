## 1. 實作

- [x] 1.1 `App.vue` 主畫面輸入列：外層移除 `v-if="isTauri()"`，輸入框與送出鈕兩平台皆顯示；「開啟資料夾」「連結 Drive」改包 `<template v-if="isTauri()">`；完成方式：`npm run build` 通過，`grep` 確認兩顆按鈕仍在 `isTauri()` 判斷內

  輸入框與送出鈕移出平台判斷；兩顆 Windows 專屬按鈕包在 `<template v-if="isTauri()">`。
- [x] 1.2 六項建置驗證（`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac`、`gradlew :app:testDebugUnitTest`）全數通過

  vue-tsc、vitest 486、npm run build、cargo check、compileDebugJavaWithJavac、testDebugUnitTest 全數通過。
- [x] 1.3 `openspec validate android-url-input` 通過；delta 規格無 BOM

  `openspec validate` 通過；delta 規格無 BOM。

## 2. 進版與發布

- [ ] 2.1 功能修正與版本進版各自一個 commit；七處版號同步、`avd_s/publish_all.ps1` 預設 `$Message` 更新
- [ ] 2.2 執行 `avd_s/publish_all.ps1` 發布

## 3. 實機驗證

- [ ] 3.1 Android 主畫面可見輸入框，貼上 YouTube 影片網址按送出能下載完成；輸入關鍵字會跳出搜尋確認；從 YouTube App 分享網址仍可加入佇列；輸入列不見「開啟資料夾」「連結 Drive」
