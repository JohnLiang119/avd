## Why

當前 Agent 在全平台編譯完成或發現修復時，會自動執行 `all.ps1` 進行全平台編譯，這可能與使用者的操作衝突或不符使用者偏好。使用者要求明確規範 Agent 嚴禁自行執行 `all.ps1`，必須交由使用者手動執行。

## What Changes

- 在專案 `.agent/rules/` 目錄中新增自訂規則 `do-not-auto-run-all-ps1.md`，明確規範 Agent 禁止自動執行 `all.ps1`。
- 新增 `agent-rules` 能力規格，明確記載全平台腳本執行的邊界規範。

## Capabilities

### New Capabilities
- `agent-rules`: 定義 Agent 於此專案中的行為約束與腳本執行規範。

### Modified Capabilities

## Impact

- `.agent/rules/do-not-auto-run-all-ps1.md`: 新增規則檔。
- Agent 行為約束：Agent 今後將不再自動觸發 `all.ps1` 命令，而是在建置或修改完成後提示使用者自行執行。
