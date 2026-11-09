## 1. 實作

- [x] 1.1 `App.vue` 主畫面輸入列：外層移除 `v-if="isTauri()"`，輸入框與送出鈕兩平台皆顯示；「開啟資料夾」「連結 Drive」改包 `<template v-if="isTauri()">`；完成方式：`npm run build` 通過，`grep` 確認兩顆按鈕仍在 `isTauri()` 判斷內

  輸入框與送出鈕移出平台判斷；兩顆 Windows 專屬按鈕包在 `<template v-if="isTauri()">`。
- [x] 1.2 六項建置驗證（`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac`、`gradlew :app:testDebugUnitTest`）全數通過

  vue-tsc、vitest 486、npm run build、cargo check、compileDebugJavaWithJavac、testDebugUnitTest 全數通過。
- [x] 1.3 `openspec validate android-url-input` 通過；delta 規格無 BOM

  `openspec validate` 通過；delta 規格無 BOM。

## 2. 進版與發布

- [x] 2.1 功能修正與版本進版各自一個 commit；七處版號同步、`avd_s/publish_all.ps1` 預設 `$Message` 更新

  功能 commit `693a180`；版本 1.0.136 → 1.0.137（versionCode 174），七處版號與 `publish_all.ps1` 預設 `$Message` 已同步。
- [x] 2.2 執行 `avd_s/publish_all.ps1` 發布

  已發布 v1.0.137（Latest），附件 `AVD_1.0.137_arm64-v8a.apk`、`AVD_1.0.137_x64_zh-TW.msi`：https://github.com/JohnLiang119/avd/releases/tag/v1.0.137

## 3. 實機驗證

- [ ] 3.1 Android 主畫面可見輸入框，貼上 YouTube 影片網址按送出能下載完成；輸入關鍵字會跳出搜尋確認；從 YouTube App 分享網址仍可加入佇列；輸入列不見「開啟資料夾」「連結 Drive」
