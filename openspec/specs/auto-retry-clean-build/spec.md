## Purpose

提供 Windows 打包失敗時自動清理 Rust 快取並自動重新編譯之容錯救援機制，保證編譯穩定性。

### Requirement: Auto-clean and Retry on Tauri Build Failure
當 `all.ps1` 執行 Windows 版打包（`tauri build`）遭遇失敗時，系統必須自動顯示警告訊息、自動清理 `src-tauri\target` 快取目錄，並自動進行第二次全新打包嘗試。

#### Scenario: Automatic retry after build failure
- **WHEN** 首次 `npm run tauri:build` 失敗
- **THEN** 系統自動刪除 `src-tauri\target` 目錄並重新執行編譯

### Requirement: Manual Clean Build Parameter Support
`all.ps1` 腳本必須支援 `-Clean` 參數，允許使用者手動指定在編譯前先行清理 `src-tauri\target` 快取。

#### Scenario: Manual clean build execution
- **WHEN** 使用者帶有 `-Clean` 參數執行 `all.ps1`
- **THEN** 系統在執行 Windows 打包前先行移除快取目錄進行全量編譯
