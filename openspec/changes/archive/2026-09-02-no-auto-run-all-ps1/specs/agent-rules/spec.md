## Purpose

規範 AI Agent 於此專案中的自動化執行權限邊界，確保自動化行為符合使用者控制原則與專案偏好。

## ADDED Requirements

### Requirement: Manual Execution of Full Platform Build Script
Agent MUST NOT automatically execute `all.ps1`. When code changes or build preparations are finished, Agent SHALL notify the user to manually execute `all.ps1`.

#### Scenario: Agent completes code fixes or build preparations
- **WHEN** Agent completes code fixes or OpenSpec planning
- **THEN** Agent MUST notify the user to execute `all.ps1` manually, and MUST NOT execute `all.ps1` automatically
