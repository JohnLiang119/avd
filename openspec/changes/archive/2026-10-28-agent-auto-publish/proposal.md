## Why

使用者於 2026-10-28 決定：「之後更新你就自己跑（發布腳本），改規則」。現行 `agent-rules` 規格要求 Agent 不得自動執行 `all.ps1`、完成後只能通知使用者手動發布；根目錄 `CLAUDE.md` 的「進版不等於發布」亦同。這條規則的原意是保留發布的決定權給使用者，但實際運作下每次進版都要使用者再手動跑一次 `publish_all.ps1`，而該腳本已有版號防呆、模擬執行與失敗即中止的保護，沒有再多一道人工確認的必要。

## What Changes

- `agent-rules`：把「不得自動執行 all.ps1、須通知使用者手動執行」改為「進版並提交後，Agent 直接執行 `avd_s/publish_all.ps1`，不再詢問」。前提維持不變：完整建置驗證通過、版號七處同步、發布說明已更新為本次內容。發布失敗時 Agent 不得重試或繞過，須如實回報腳本輸出。
- 根目錄 `CLAUDE.md` 第 5 條同步改寫（屬父倉庫，另行提交）。

## Capabilities

### Modified Capabilities

- `agent-rules`：發布腳本由 Agent 自動執行。

## Impact

- `openspec/specs/agent-rules/spec.md`（經本變更同步）
- `C:\JohnLiang\CLAUDE.md` 版本進版規範第 5 條
- 無程式碼變更。
