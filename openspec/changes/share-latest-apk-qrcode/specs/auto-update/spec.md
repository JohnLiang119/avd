## ADDED Requirements

### Requirement: 分享最新版 APK 下載連結

系統 MUST（必須）在 Android 端設定頁的版本區段提供「分享下載連結」：開啟時向 GitHub 查詢最新正式版（不含 pre-release）的 Android APK 附件網址，以 QR code 呈現該網址，並同時以文字顯示網址與提供複製操作。QR code 的內容 MUST（必須）是最新版 APK 本身的下載網址，使掃描者掃到即直接下載，不需再於網頁中尋找附件。

查詢進行中 MUST NOT（不得）先顯示其他網址的 QR code。查詢失敗（離線、逾時、找不到 APK）時系統 MUST（必須）改以 GitHub 最新發布頁網址呈現，並以一行文字說明掃到的是頁面而非安裝檔。

此功能僅於 Android 提供；Windows 端 MUST NOT（不得）顯示此列。

#### Scenario: 開啟分享下載連結

- **WHEN** 使用者在 Android 端設定頁點選「分享下載連結」，且能連上 GitHub
- **THEN** 介面顯示一個可被手機相機辨識的 QR code，內容為最新正式版 APK 的下載網址
- **AND** 網址與檔名以文字一併顯示

#### Scenario: 掃描後直接下載

- **WHEN** 另一位使用者以手機掃描該 QR code
- **THEN** 手機直接開始下載最新版的 Android APK

#### Scenario: 連不上 GitHub

- **WHEN** 使用者開啟「分享下載連結」時裝置離線或 GitHub 逾時未回應
- **THEN** QR code 內容為 GitHub 最新發布頁網址
- **AND** 介面以一行文字說明掃到的是頁面，需再點選 APK 下載

#### Scenario: Windows 端

- **WHEN** 使用者於 Windows 版開啟偏好設定
- **THEN** 介面中不出現「分享下載連結」

#### Scenario: 複製連結

- **WHEN** 使用者點選「複製連結」
- **THEN** 該網址被寫入剪貼簿並以 Toast 告知
