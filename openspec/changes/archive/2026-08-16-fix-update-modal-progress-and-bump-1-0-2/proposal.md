## Why

在點擊「立即更新」按鈕時，Vant `van-dialog` 的預設行為會在 `@confirm` 觸發時自動將彈窗關閉（`show = false`），導致使用者看到進度條一閃而過，彈窗直接消失，無法看到下載進度與狀態。

此外，為了驗證更新修復效果並發布新版，需要將專案版本升級至 **`1.0.2`**。

## What Changes

* **修正更新彈窗關閉行為 (Fix Dialog Premature Close)**：
  * 為 `van-dialog` 實作 `beforeClose` 攔截器，當使用者點擊「立即更新」時，**阻止彈窗關閉**（保持 `showUpdateModal = true`），並切換至下載中介面。
  * 只有在使用者點擊「稍後再說」或下載發生嚴重錯誤手動關閉時，才允許關閉彈窗。
* **強化下載與安裝反饋狀態 UI**：
  * 下載中：顯示「正在下載更新檔 (XX%)...」、即時進度條與傳輸量 (`XX MB / XX MB`)。
  * 下載完成：顯示「下載完成，正在叫起安裝程序...」與旋轉載入指示。
  * 下載失敗：顯示錯誤訊息與「重試」及「開啟瀏覽器手動下載」按鈕。
* **版本全域升級至 1.0.2**：
  * `package.json` $\rightarrow$ `1.0.2`
  * `src-tauri/tauri.conf.json` $\rightarrow$ `1.0.2`
  * `src-tauri/Cargo.toml` $\rightarrow$ `1.0.2`
  * `android/app/build.gradle` $\rightarrow$ `versionCode 39`, `versionName "1.0.2"`

## Capabilities

### Modified Capabilities
- `auto-update`: 修正更新彈窗生命週期控制（阻止確認時提早關閉）與完整呈現下載/安裝進度。

## Impact

* **受影響檔案**：
  * `src/App.vue` (加入 `beforeClose` 處理，自訂下載中按鈕區)
  * `package.json` (1.0.2)
  * `src-tauri/tauri.conf.json` (1.0.2)
  * `src-tauri/Cargo.toml` (1.0.2)
  * `android/app/build.gradle` (1.0.2, versionCode 39)
