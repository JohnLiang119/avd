---
trigger: always_on
---

# 專案執行與腳本規範 (Project Execution Rules)

## 🚫 嚴禁自動執行編譯與發布腳本 (`all.ps1` / `publish_all.ps1`)
- **禁止行為**：Agent 在此專案中**嚴禁自動觸發或執行**以下打包、編譯與發布腳本（無論在前台、背景、指令模式或任務流程中）：
  - `all.ps1`（全平台編譯打包）
  - `publish_all.ps1`（一鍵打包、提交並發布）
  - `release_avd.ps1`（GitHub Release 發布）
- **正確流程**：當程式碼修改完畢、BUG 修復或 OpenSpec 規劃流程完成後，Agent 必須提示並引導使用者手動執行上述腳本，由使用者自行決定執行時機。
- **作用範圍**：本規則於本專案區域（`avd`）及相關管理腳本目錄生效。

