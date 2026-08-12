$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "   開始還原 avd_vue 開發環境" -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

Write-Host ">>> 第一階段：還原 node_modules 依賴套件" -ForegroundColor Cyan
Write-Host "正在執行 npm install..."
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install 失敗！請檢查 Node.js 環境或網路連線。"
    exit 1
}

Write-Host "✅ npm install 成功！" -ForegroundColor Green
Write-Host ""

Write-Host ">>> 第二階段：同步 Android 專案資源" -ForegroundColor Cyan
Write-Host "正在執行 npx cap sync..."
npx cap sync

if ($LASTEXITCODE -ne 0) {
    Write-Error "npx cap sync 失敗！"
    exit 1
}

Write-Host "✅ Android 資源同步成功！" -ForegroundColor Green
Write-Host ""

Write-Host "🎉 開發環境還原完畢！您可以開始進行開發了。" -ForegroundColor Magenta