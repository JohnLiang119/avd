## Context

- App 內已有 `qrcode.vue`（快傳功能以它顯示 Wi-Fi 與網頁網址的 QR code），不需新依賴。
- `UpdateService.checkForUpdates` 的預設結果把 releases 網址寫死在 `htmlUrl`，「在瀏覽器開啟下載」的退路用的就是它。
- README 已有「前往下載最新 Android APK」連結指向 `releases/latest`；GitHub 的 `releases/latest` 會 302 到當下最新的 release 頁。

## Decisions

### D1 QR code 指向最新版 APK 本身，開對話框時向 GitHub 查一次

（第一版指向 `releases/latest` 頁面；使用者審閱後要求改為直接指向 APK。）

- 對掃的人來說，「掃了就開始下載」和「掃了進到一個英文網頁再找 `.apk`」差很多 —— 這個功能的對象正是不熟 GitHub 的人。
- APK 附件網址含版本號、每版都變，所以不能寫死：開對話框時 GET `releases/latest`（正式版，不含 pre-release），從 `assets` 挑 `.apk` 的 `browser_download_url`。挑選是純函式 `pickApkAsset`，以 vitest 釘住「不會挑到 msi 或校驗檔」。
- **每次開啟都重查**，不快取：上次查到的可能已經不是最新版，而查詢本身只是一個小 JSON。
- **查不到就退回發布頁**（離線、逾時 5 秒、找不到 APK），並用一行文字說明掃到的是頁面。退回的存在是為了「永遠有東西可掃」，不是常態。
- **查詢中不先畫發布頁的 QR code**：畫了再換掉，對方可能已經掃了舊的。改顯示載入指示，180px 高度與 QR code 相同，對話框不跳動。
- **不重用 `checkForUpdates`**：它在「不是新版」時刻意不回傳網址，而分享連結最常在使用者已是最新版時使用。另寫 `fetchLatestApk`，同樣不拋例外。
- **替代案：發布腳本另傳一個固定檔名的 `AVD.apk`**，讓 `releases/latest/download/AVD.apk` 成為不需查詢的穩定網址 —— 每版多傳一份幾十 MB 的重複附件，且發布腳本是使用者手動執行的流程，不為此改動。

### D2 只在 Android 提供

（第一版兩平台都顯示；使用者審閱後要求 Windows 不做。）

- 分享的是 APK，掃的人拿的是手機；在 Windows 端開這個對話框的情境使用者評估為不需要。
- 以 `v-if="!isTauri()"` 隱藏那一列，與鬧鐘區段同一套「功能可用性」的判斷；對話框本身不加判斷 —— 沒有入口就開不到。

### D3 網址抽成 `LATEST_RELEASE_URL` 常數

與既有的 `htmlUrl` 退路共用同一個來源。放在 `UpdateService.ts` 而非新檔：它本來就是「更新來源在哪裡」的知識所在。

### D4 介面：一列進入、一個對話框

- 「版本與更新」區段加一列 `van-cell`「分享下載連結」，點開對話框：QR code（180px，`level="M"`，與快傳一致）、一行說明（含查到的版本與檔名）、網址原文、「複製連結」與「關閉」。「複製連結」複製的是 QR code 當下的內容。
- 不放在主畫面：這是偶爾才用的功能，主畫面已經很擠（minimal-ui 的原則）。
- 顏色只用既有中性色階，不引入新色碼。

## Risks / Trade-offs

- **[倉庫搬家]** → 改 `LATEST_RELEASE_URL` 與 `LATEST_RELEASE_API_URL` 兩處（同一檔）；GitHub 對搬家的倉庫會自動轉址。
- **[GitHub API 未登入的速率限制（每 IP 每小時 60 次）]** → 只在使用者主動開對話框時查一次，與啟動時的更新檢查合計仍遠低於上限。
- **[QR code 在暗色或小螢幕上難掃]** → 對話框底為白、QR code 180px，與快傳功能實測可掃的尺寸相同。
