## Why

使用者想把 AVD 介紹給別人時，目前只能口頭說「去 GitHub 找 JohnLiang119/avd 的 Releases」或手動抄網址 —— 對不熟 GitHub 的人來說找不到、打錯字都很常見。App 裡已經有 QR code 元件（快傳功能用它顯示 Wi-Fi 與網頁網址），把「最新版下載頁」也做成 QR code，拿手機或電腦畫面給對方掃一下就到。

## What Changes

- **偏好設定「版本與更新」新增「分享下載連結」（僅 Android）**：點開時向 GitHub 查最新正式版的 APK 附件網址，以 QR code 呈現，掃到就直接下載；附一行說明（版本與檔名）、網址原文與「複製連結」。連不上 GitHub 時退回最新發布頁的網址並說明。
- **網址收成常數**：`UpdateService` 內寫死的 releases 網址抽成匯出的 `LATEST_RELEASE_URL`（退回用，與「在瀏覽器開啟下載」共用）；新增 `fetchLatestApk` 查最新 APK，附件挑選為純函式 `pickApkAsset` 並有 vitest。
- 不引入新依賴：沿用既有的 `qrcode.vue`。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `auto-update`: 新增「分享最新版 APK 下載連結」需求 —— Android 端設定頁提供指向最新 APK 的 QR code 與可複製的網址，查不到時退回發布頁並說明；Windows 端不顯示。

## Impact

- **前端**：`App.vue` 偏好設定的「版本與更新」區段加一列（Android 限定）與一個對話框；`UpdateService.ts` 新增常數與 `fetchLatestApk`；新增 `releaseAssets.ts`（純函式）與其 vitest。
- **對外網路存取**：開對話框時 GET `api.github.com/repos/JohnLiang119/avd/releases/latest`（與啟動時的更新檢查同一端點）。
- **不影響**：原生端、更新檢查流程、下載與安裝流程。
- **版本進版**：依工作區規範同步七處版號並更新 `avd_s/publish_all.ps1` 預設發布說明。
