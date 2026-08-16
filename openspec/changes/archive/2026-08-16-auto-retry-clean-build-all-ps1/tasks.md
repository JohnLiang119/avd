## 1. 升級 all.ps1 Windows 打包容錯與救援機制

- [x] 1.1 在 `all.ps1` 頂部加入 `param([switch]$Clean)` 參數支援
- [x] 1.2 在 `all.ps1` [階段二] 實作首次打包失敗自動清理 `src-tauri\target` 並重新嘗試第二次編譯之邏輯
- [x] 1.3 確保 `all.ps1` 以 UTF-8 with BOM 儲存並進行語法驗證
