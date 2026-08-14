## Context

在 Vue 3 + Vant 的 `<van-dialog>` 組件中，若未傳入 `:before-close` 屬性，點擊確認按鈕時內部會直接執行 `show.value = false`。
因此當 `@confirm="startDownloadAndInstall"` 觸發非同步下載時，彈窗已經被 Vant 關閉，使用者便看到彈窗一閃即逝。

## Goals / Non-Goals

**Goals:**
* 透過 `:before-close="handleBeforeCloseUpdateModal"` 攔截確認事件：若點擊 confirm，非同步啟動下載並回傳 `false` 以阻止關閉彈窗。
* 下載期間隱藏底部確認/取消按鈕，並自訂下載中與完成後的進度畫面。
* 下載失敗時才允許使用者點擊「關閉」或「重試」。
* 將版本號在全平台專案中升級為 `1.0.2`。

## Decisions

### 1. 使用 beforeClose 攔截器保持彈窗開啟
* **決策**：在 `App.vue` 定義 `handleBeforeCloseUpdateModal(action: string)`。
* **邏輯**：
  * 若 `action === 'confirm'`：回傳 `false`（保持彈窗），並執行 `startDownloadAndInstall()`。
  * 若 `action === 'cancel'`：若正在下載中則忽略或回傳 `false`，若未在下載中則回傳 `true`（允許關閉）。

### 2. 升級版號至 1.0.2
* **決策**：同步修改 `package.json`、`tauri.conf.json`、`Cargo.toml`、`build.gradle`。
