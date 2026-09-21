## Why

使用者想把 AVD 介紹給別人時，目前只能口頭說「去 GitHub 找 JohnLiang119/avd 的 Releases」或手動抄網址 —— 對不熟 GitHub 的人來說找不到、打錯字都很常見。App 裡已經有 QR code 元件（快傳功能用它顯示 Wi-Fi 與網頁網址），把「最新版下載頁」也做成 QR code，拿手機或電腦畫面給對方掃一下就到。

## What Changes

- **偏好設定「版本與更新」新增「分享下載連結」**：點開顯示一個 QR code，內容為 GitHub 最新發布頁（`https://github.com/JohnLiang119/avd/releases/latest`），附一行說明與網址原文，並提供「複製連結」。Android 與 Windows 兩端都顯示 —— 在電腦上開給對方用手機掃，正是最常見的情境。
- **網址收成一個常數**：`UpdateService` 內目前寫死的 releases 網址抽成匯出的 `LATEST_RELEASE_URL`，QR code 與既有的「在瀏覽器開啟下載」退路共用，日後搬倉庫只改一處。
- 不引入新依賴：沿用既有的 `qrcode.vue`。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `auto-update`: 新增「分享最新版下載連結」需求 —— 設定頁提供 QR code 與可複製的網址，指向 GitHub 最新發布頁，兩個平台皆提供。

## Impact

- **前端**：`App.vue` 偏好設定的「版本與更新」區段加一列與一個對話框；`UpdateService.ts` 新增匯出常數。
- **不影響**：原生端、更新檢查流程、下載與安裝流程。
- **版本進版**：依工作區規範同步七處版號並更新 `avd_s/publish_all.ps1` 預設發布說明。
