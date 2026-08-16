## 1. 修正更新彈窗生命週期與進度展示 (App.vue)

- [x] 1.1 在 `App.vue` 的 `van-dialog` 加入 `:before-close="handleBeforeCloseUpdateModal"`，阻止點擊「立即更新」時自動關閉彈窗
- [x] 1.2 優化下載進度條 UI 與完成安裝時的載入提示狀態（例如「下載完成，正在喚起安裝...」）

## 2. 全平台版本升級至 1.0.2

- [x] 2.1 修改 `package.json` 中的 `version` 為 `1.0.2`
- [x] 2.2 修改 `src-tauri/tauri.conf.json` 與 `src-tauri/Cargo.toml` 為 `1.0.2`
- [x] 2.3 修改 `android/app/build.gradle` 的 `versionName` 為 `1.0.2`，`versionCode` 遞增至 `39`

## 3. 編譯與驗證

- [x] 3.1 執行 `npm run build` 與 `npx cap sync`，確認編譯無誤
