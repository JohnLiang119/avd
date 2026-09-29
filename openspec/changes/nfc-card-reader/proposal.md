## Why

使用者在登錄或核對門禁卡時需要知道卡片的卡號，但手邊沒有專用的 USB 讀卡機；而 Android 手機本身就有 NFC 讀卡能力。AVD 是使用者日常在用的 Android App，且已具備 Capacitor 原生插件架構（`YoutubeDlPlugin`）與「僅 Android 提供」的功能區段（廣播鬧鐘），在此加一個讀卡畫面成本最低，不必另裝、另維護一個 App。

## What Changes

- **新增「NFC 讀卡機」畫面（Android 手機）**：偏好設定的 Android 專區新增進入點，開啟後提示「將卡片靠近手機背面」，卡片靠近即顯示卡號，並可一鍵複製到剪貼簿。
- **卡號即卡片 UID，格式固定為 Hex 正序大寫、不分隔**（例如 `04A37F12`）。只讀 UID、不讀卡內扇區資料，因此不需金鑰，也不依賴手機晶片對 Mifare Classic 的支援；4、7、10 byte 的 UID 一律照原始位元組順序輸出。
- **讀卡只在畫面開著時進行**：採 Android Reader Mode，畫面開啟時啟用、關閉即停用；不在 Manifest 註冊 NFC intent filter，AVD 不會在使用者平常靠近其他 NFC 卡片時跳出來。
- **歷史紀錄**：保留最近 50 筆（讀取時間、卡號），最新在上，可整批清除；同一張卡在短時間內重複感應只更新時間、不新增一筆。持久化沿用前端既有的單一儲存介面（`useStorage`），不另設儲存路徑。
- **讀到卡時震動一下**作為回饋（畫面上同時更新卡號）。
- **裝置能力提示**：裝置沒有 NFC 硬體時顯示「此裝置不支援 NFC」且不提供讀卡；NFC 已關閉時提示並提供按鈕跳至系統 NFC 設定，回到畫面後自動重新啟用讀卡。
- **新增 Android 權限與功能宣告**：`android.permission.NFC`（安裝即授予，無執行期請求）；`uses-feature android.hardware.nfc` 標記為非必要，Android TV 與無 NFC 裝置照常可安裝。
- **Windows（Tauri）端不顯示此功能**，與廣播鬧鐘同一套平台判斷。

### 已做的假設（可在審閱時推翻）

- 只顯示 Hex 正序一種格式（使用者已確認）；十進位、反序、Wiegand 等其他格式不做。
- 歷史紀錄每筆不附備註欄位；需要對應人名時，使用者複製卡號到門禁系統即可。
- 同一張卡的去重時間窗為 3 秒。
- 不讀 NDEF、不讀扇區、不寫卡、不做卡片模擬（HCE）。

## Capabilities

### New Capabilities

- `nfc-card-reader`: 以手機 NFC 讀取門禁卡 UID 並顯示為 Hex 正序卡號 —— 讀卡的啟用與停用時機、卡號格式、複製、歷史紀錄的保留與去重、裝置無 NFC 或 NFC 關閉時的提示，以及平台可見性。

### Modified Capabilities

（無。歷史紀錄透過前端既有單一儲存介面持久化，符合 `config-persistence` 現行要求，不需修改其規格。）

## Impact

- **Android 原生**（`android/app/src/main/java/com/mattpocock/avd/`）：新增 `NfcPlugin.java`（Capacitor 插件：查詢 NFC 可用狀態、啟用與停用 Reader Mode、開啟系統 NFC 設定、以事件回報讀到的 UID）；`MainActivity` 註冊該插件；`AndroidManifest.xml` 新增 NFC 權限與非必要的功能宣告。不修改 `YoutubeDlPlugin`。
- **前端**：`App.vue` 偏好設定 Android 專區新增進入點與讀卡彈窗；新增 `src/services/nfcReader.ts` 封裝插件方法，並提供純函式（UID 位元組轉 Hex 正序字串、歷史紀錄的去重與截斷），純函式附 vitest 測試。
- **依賴**：不新增第三方套件，只用 Android SDK 的 `android.nfc` 與 Capacitor 既有 API。
- **不影響**：下載佇列、頻道追蹤、廣播鬧鐘、TV 模式、Windows/Tauri 端的既有行為。
- **版本進版**：依工作區規範同步七處版號並更新 `avd_s/publish_all.ps1` 預設發布說明；`all.ps1` 由使用者手動執行。
