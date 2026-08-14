## Context

參見 [proposal.md](file:///c:/JohnLiang/..Project/avd/openspec/changes/auto-retry-clean-build-all-ps1/proposal.md)。Tauri 在 Windows 打包時會在 `src-tauri\target\` 產生路徑相關的 plugin permissions 與中間產物。若發生目錄更名或快取異常，首次編譯可能失敗。

## Goals / Non-Goals

**Goals:**
- 平常打包維持高速增量編譯（10~20 秒）。
- 若首次編譯失敗，腳本自動清理 `src-tauri\target` 快取並自動重新編譯一次。
- 支援 `-Clean` 參數以供手動強制純淨編譯。
- 維持 **UTF-8 with BOM** 格式儲存。

**Non-Goals:**
- 不改變 Android APK 的 Gradle 編譯流程。

## Decisions

### 1. Windows 打包容錯重試機制
在 `all.ps1` 的 [階段二] 加入雙層編譯防護：
```powershell
if ($Clean -and (Test-Path "src-tauri\target")) {
    Write-Host ">>> 已指定 -Clean 參數，正在預先清理 Rust 快取目錄..." -ForegroundColor Yellow
    Remove-Item -Path "src-tauri\target" -Recurse -Force
}

npm run tauri:build

if ($LASTEXITCODE -ne 0) {
    Write-Warning "⚠️ 首次 Windows 打包失敗，可能存在舊路徑或快取衝突。"
    Write-Host ">>> 正在自動清理 src-tauri\target 快取並重新嘗試全量打包..." -ForegroundColor Cyan
    if (Test-Path "src-tauri\target") {
        Remove-Item -Path "src-tauri\target" -Recurse -Force
    }
    
    npm run tauri:build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Windows 打包重試依然失敗，請檢查 Rust 原始碼或編譯環境。"
        exit 1
    }
}
```

## Risks / Trade-offs

- **[Trade-off]** 快取損壞觸發自動救援時，全量重編譯需花費 1~3 分鐘，但可完全免除人工除錯與手動刪除快取的困擾。
