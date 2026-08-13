## Context

依據 Antigravity IDE 規格與自訂規則機制，`.agent/rules/` 目錄用於定義當前專案特有的 Agent 行為約束規則。當專案下存在 `.agent/rules/*.md` 時，Agent 在執行相關任務時會讀取並遵守該目錄中的規則。

## Goals / Non-Goals

**Goals:**
- 在 `.agent/rules/` 中建立規則檔案 `do-not-auto-run-all-ps1.md`。
- 明確規定：Agent 嚴禁自動執行 `all.ps1`，所有全平台編譯作業均需由使用者手動執行。

**Non-Goals:**
- 修改 `all.ps1` 腳本本身的內容。

## Decisions

- **使用 `.agent/rules/do-not-auto-run-all-ps1.md` 定義規則**：
  - 選擇放在 `.agent/rules/` 專案區域，可使任何在 `c:\JohnLiang\..Project\avd_vue` 工作區運行的 Agent 自動載入並遵守此規範。
  - 替代方案（全域設定）：全域設定會影響其他專案，不符合本專案特定需求的限定範圍。

## Risks / Trade-offs

- [Risk] 使用者若忘記執行 `all.ps1`，本機環境可能無法立即取得最新打包檔。
  - **Mitigation**: Agent 在完成程式碼異動後，提供清晰且明顯的提醒訊息，提示使用者執行 `all.ps1`。
