$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$zipName = "avd_backup_$timestamp.zip"
$zipPath = Join-Path $env:TEMP $zipName
$sourceDir = $PSScriptRoot
$gdriveRemote = "yiichungGDGD:AVD_Backups"

Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "   ???遢銝虫???avd 撠?" -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

Write-Host ">>> 蝚砌??挾嚗?蝮桀?獢? -ForegroundColor Cyan
Write-Host "靘?頝臬?嚗?sourceDir"
Write-Host "甇??蕪 node_modules, dist, target, build 蝑?敹???獢?.."

# 憯葬銝行??文之瑼?????瑼?
7z a -tzip "$zipPath" "$sourceDir\*" '-xr!node_modules' '-xr!dist' '-xr!src-tauri\target' '-xr!android\app\build' '-xr!android\.gradle' '-xr!android\.idea' '-xr!android\app\src\main\assets\public' '-xr!.cap' '-xr!avd_apk.apk' '-xr!avd_win.msi' '-xr!backup_avd.ps1' | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Error "憯葬憭望?嚗?
    exit 1
}

Write-Host "??憯葬摰?嚗?zipPath" -ForegroundColor Green
Write-Host ""
Write-Host ">>> 蝚砌??挾嚗??唾 Google Drive" -ForegroundColor Cyan
Write-Host "?格?雿蔭嚗?gdriveRemote"

rclone copy "$zipPath" "$gdriveRemote" -P

if ($LASTEXITCODE -ne 0) {
    Write-Error "銝 Google Drive 憭望?嚗?
    exit 1
}

Write-Host "??銝??嚗? -ForegroundColor Green
Write-Host ""

# 皜??砍憯葬瑼?Remove-Item "$zipPath" -Force
Write-Host "?完 撌脫???唳摮?隞賣? ($zipName)?? -ForegroundColor DarkGray
Write-Host "?? ?遢隞餃??券摰?嚗? -ForegroundColor Magenta