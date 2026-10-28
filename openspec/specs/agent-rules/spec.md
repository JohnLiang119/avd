# agent-rules Specification

## Purpose
規範 AI Agent 於此專案中的自動化執行權限邊界，確保自動化行為符合使用者控制原則與專案偏好。

## Requirements

### Requirement: 發布腳本由 Agent 自動執行

進版（版號七處同步、發布說明更新）並提交後，Agent MUST（必須）直接執行 `avd_s/publish_all.ps1` 完成打包、提交與 GitHub Release，MUST NOT（不得）再詢問使用者是否發布。執行前提：該版本的完整建置驗證（`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac`）已全數通過，且 avd 工作區已無未提交變更。發布腳本失敗時，Agent MUST NOT 重試或以其他方式繞過腳本的防呆，MUST 如實回報腳本輸出。

#### Scenario: Agent 完成修正並進版提交

- **WHEN** Agent 完成程式修正、通過建置驗證並進版提交
- **THEN** Agent 直接執行 `avd_s/publish_all.ps1`，完成後回報發布結果（版本、Release 連結或失敗輸出）

#### Scenario: 發布腳本失敗

- **WHEN** `publish_all.ps1` 的任一階段（打包、提交、發布）失敗而中止
- **THEN** Agent 回報腳本輸出並停止，不重試、不手動執行其中的個別步驟
