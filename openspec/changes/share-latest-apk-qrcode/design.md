## Context

- App 內已有 `qrcode.vue`（快傳功能以它顯示 Wi-Fi 與網頁網址的 QR code），不需新依賴。
- `UpdateService.checkForUpdates` 的預設結果把 releases 網址寫死在 `htmlUrl`，「在瀏覽器開啟下載」的退路用的就是它。
- README 已有「前往下載最新 Android APK」連結指向 `releases/latest`；GitHub 的 `releases/latest` 會 302 到當下最新的 release 頁。

## Decisions

### D1 QR code 指向 `releases/latest` 頁，而不是 APK 附件的直接下載網址

- 附件網址含版本號與檔名（`AVD_1.0.106.apk`），每次發布都變；QR code 若指它，畫面上的 QR code 在下一版發布後就過期。`releases/latest` 永遠是最新版。
- 掃描者多一步「在頁面上點 APK」，但頁面同時列出 Windows 安裝檔與更新說明，對第一次接觸的人反而是好事。
- **替代案**：呼叫 GitHub API 取得目前最新 APK 網址再產 QR code —— 需要網路、離線時顯示不出來，且解決的是不存在的問題。

### D2 兩個平台都顯示

最常見的情境是在電腦上開 AVD、對方拿手機掃；只做 Android 會剛好漏掉這個情境。QR code 是純前端渲染，沒有平台差異，不加 `isTauri()` 判斷。

### D3 網址抽成 `LATEST_RELEASE_URL` 常數

與既有的 `htmlUrl` 退路共用同一個來源。放在 `UpdateService.ts` 而非新檔：它本來就是「更新來源在哪裡」的知識所在。

### D4 介面：一列進入、一個對話框

- 「版本與更新」區段加一列 `van-cell`「分享下載連結」，點開對話框：QR code（180px，`level="M"`，與快傳一致）、一行說明、網址原文、「複製連結」與「關閉」。
- 不放在主畫面：這是偶爾才用的功能，主畫面已經很擠（minimal-ui 的原則）。
- 顏色只用既有中性色階，不引入新色碼。

## Risks / Trade-offs

- **[倉庫搬家]** → 只改 `LATEST_RELEASE_URL` 一處；舊版 App 內的 QR code 會指向舊網址，GitHub 對搬家的倉庫會自動轉址。
- **[QR code 在暗色或小螢幕上難掃]** → 對話框底為白、QR code 180px，與快傳功能實測可掃的尺寸相同。
