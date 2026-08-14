## Why

在打包 Windows 版本時，若遇到專案目錄更名、套件升級或 Rust 內部快取損壞，常會引發 `failed to read plugin permissions` 或 `os error 3` 導致編譯中斷。為了提供無需手動介入的穩定打包體驗，`all.ps1` 應在 Windows 打包首次失敗時自動清理 `src-tauri\target` 快取並自動重新編譯。

## What Changes

- **升級 `all.ps1` Windows 打包流程（加入智慧救援與重試機制）**：
  - 支援增量高速打包（平常 10~20 秒）。
  - 若首次 `tauri build` 失敗，自動顯示提示、自動移除 `src-tauri\target` 快取目錄並自動重新嘗試第二次全量編譯。
  - 新增可選參數 `param([switch]$Clean)`，支援使用者主動執行 `.\all.ps1 -Clean` 進行乾淨全量建置。
- **編碼規範遵循**：
  - 確保 `all.ps1` 存檔格式維持 **UTF-8 with BOM**。

## Capabilities

### New Capabilities
- `auto-retry-clean-build`: 提供 Windows 打包失敗時自動清理 Rust 快取並自動重新編譯之容錯救援機制。

### Modified Capabilities
<!-- 無既有規格修改 -->

## Impact

- 影響檔案：`C:\JohnLiang\..Project\avd\all.ps1`。
- 大幅提升跨電腦打包與目錄遷移時的容錯性與全自動化體驗。
