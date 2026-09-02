## Purpose

定義本專案版本控制系統可追蹤之二進位資產邊界，以及建置流程取得 sidecar 執行檔（yt-dlp / ffmpeg / rclone）的唯一來源與自動補齊行為，確保倉庫體積長期可控且離線建置仍可成功。

## ADDED Requirements

### Requirement: 版控二進位資產白名單

版本控制系統追蹤的二進位執行檔 MUST 僅限於 `src-tauri/bin/` 目錄下每個 sidecar 工具的單一 `x86_64-pc-windows-msvc` 副本。任何其他目標平台副本、壓縮包、打包工具、測試媒體檔與備份殘留檔 MUST NOT 被追蹤。

#### Scenario: 檢視版控中的二進位資產

- **WHEN** 開發者對倉庫執行二進位資產稽核
- **THEN** `src-tauri/bin/` 僅有 `yt-dlp-x86_64-pc-windows-msvc.exe`、`ffmpeg-x86_64-pc-windows-msvc.exe`、`rclone-x86_64-pc-windows-msvc.exe` 三個受追蹤執行檔
- **AND** 不存在任何受追蹤的 `*-gnu.exe`、`*.exe.old`、`*.mp4`、`rclone.zip`、`upx.exe` 或 `rclone_temp/` 內容

#### Scenario: 新增被禁止的資產類型

- **WHEN** 開發者將 `*.old`、`src-tauri/bin/*.mp4`、`rclone_temp/` 或 `upx.exe` 放入工作目錄
- **THEN** `.gitignore` 規則 MUST 使其不出現在 `git status` 的未追蹤清單中

### Requirement: Sidecar 執行檔的 host triple 自動補齊

建置腳本 MUST 在編譯 Tauri 應用前，檢查 `src-tauri/bin/` 是否存在符合當前 Rust host triple 命名的 sidecar 執行檔；若不存在，MUST 自其目錄中既有的同名工具副本複製產生，且不得因缺少特定平台副本而中斷建置。

#### Scenario: 僅存在 msvc 副本且 host triple 相符

- **WHEN** 建置環境的 Rust host triple 為 `x86_64-pc-windows-msvc`，且 `src-tauri/bin/` 僅有對應的 msvc 副本
- **THEN** 建置腳本直接使用該副本，不進行複製，並成功完成 Tauri 打包

#### Scenario: host triple 與既有副本命名不符

- **WHEN** 建置環境的 Rust host triple 與 `src-tauri/bin/` 內既有 sidecar 副本的命名後綴不同
- **THEN** 建置腳本自動將既有副本複製為符合 host triple 命名的檔案，並在主控台顯示複製動作
- **AND** 後續 Tauri 打包成功取得所需 sidecar

#### Scenario: 完全缺少某個 sidecar

- **WHEN** `src-tauri/bin/` 中找不到某個 sidecar 工具的任何副本
- **THEN** 建置腳本 MUST 顯示明確錯誤訊息，指出缺少的工具名稱與應放置的路徑，而非產生不完整的安裝包

### Requirement: 建置前置壓縮僅處理單一副本

建置腳本執行 UPX 壓縮時 MUST 僅針對當前 host triple 所需的 sidecar 執行檔進行處理，不得對同一工具的多個平台副本重複壓縮。

#### Scenario: 壓縮階段的處理範圍

- **WHEN** 建置腳本進入 sidecar 壓縮階段
- **THEN** 每個 sidecar 工具至多被壓縮一次
- **AND** 主控台輸出的壓縮項目數量等於 sidecar 工具的數量
