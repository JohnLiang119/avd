## 1. 規則建立與配置

- [x] 1.1 在專案區域 `.agent/rules/` 目錄中建立自訂規則檔 `do-not-auto-run-all-ps1.md`（僅作用於 `avd_vue` 專案，不影響其他專案）
- [x] 1.2 撰寫明確規範：嚴禁 Agent 自動觸發或執行 `all.ps1`，必須提示並交由使用者手動執行

## 2. 驗證與存檔

- [x] 2.1 檢查規則檔編碼格式為 UTF-8 (with BOM)
- [x] 2.2 使用 `openspec validate` 驗證 Change 完整度
