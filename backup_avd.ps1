$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$zipName = "avd_backup_$timestamp.zip"
$zipPath = Join-Path $env:TEMP $zipName
$sourceDir = $PSScriptRoot
$gdriveRemote = "yiichungGDGD:AVD_Backups"

Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "   開始備份並上傳 avd 專案" -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

Write-Host ">>> 第一階段：打包壓縮" -ForegroundColor Cyan
Write-Host "來源路徑：$sourceDir"
Write-Host "正在排除 node_modules, dist, target, build 等非必要之檔案..."

# 壓縮並排除大檔案與自動產生的檔案
7z a -tzip "$zipPath" "$sourceDir\*" '-xr!node_modules' '-xr!dist' '-xr!src-tauri\target' '-xr!android\app\build' '-xr!android\.gradle' '-xr!android\.idea' '-xr!android\app\src\main\assets\public' '-xr!.cap' '-xr!avd_apk.apk' '-xr!avd_win.msi' '-xr!backup_avd.ps1' | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Error "壓縮失敗！"
    exit 1
}

Write-Host "✅ 壓縮完成：$zipPath" -ForegroundColor Green
Write-Host ""
Write-Host ">>> 第二階段：上傳至 Google Drive" -ForegroundColor Cyan
Write-Host "目標位置：$gdriveRemote"

rclone copy "$zipPath" "$gdriveRemote" -P

if ($LASTEXITCODE -ne 0) {
    Write-Error "上傳 Google Drive 失敗！"
    exit 1
}

Write-Host "✅ 上傳成功！" -ForegroundColor Green
Write-Host ""

# 清理本地壓縮檔
Remove-Item "$zipPath" -Force
Write-Host "🗑️ 已清理本地暫存壓縮檔 ($zipName)。" -ForegroundColor DarkGray
Write-Host "🎉 備份作業全部完成！" -ForegroundColor Magenta