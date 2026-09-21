## ADDED Requirements

### Requirement: 分享最新版下載連結

系統 MUST（必須）在設定頁的版本區段提供「分享下載連結」：以 QR code 呈現 GitHub 最新發布頁的網址，並同時以文字顯示該網址與提供複製操作。QR code 的內容 MUST（必須）是固定的「最新發布」頁面網址（而非某一特定版本的附件），使掃描者永遠取得當下最新版。此功能 MUST（必須）於 Android 與 Windows 兩端皆提供。

#### Scenario: 開啟分享下載連結

- **WHEN** 使用者在設定頁點選「分享下載連結」
- **THEN** 介面顯示一個可被手機相機辨識的 QR code，內容為 GitHub 最新發布頁網址
- **AND** 網址以文字一併顯示

#### Scenario: 掃描後取得最新版

- **WHEN** 另一位使用者以手機掃描該 QR code
- **THEN** 手機開啟 GitHub 最新發布頁，其中可下載目前最新版的 Android APK 與 Windows 安裝檔

#### Scenario: 複製連結

- **WHEN** 使用者點選「複製連結」
- **THEN** 該網址被寫入剪貼簿並以 Toast 告知
