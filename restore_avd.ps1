$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "   ???? avd ??啣?" -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

Write-Host ">>> 蝚砌??挾嚗???node_modules 靘陷憟辣" -ForegroundColor Cyan
Write-Host "甇??瑁? npm install..."
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install 憭望?嚗?瑼Ｘ Node.js ?啣??雯頝舫????
    exit 1
}

Write-Host "??npm install ??嚗? -ForegroundColor Green
Write-Host ""

Write-Host ">>> 蝚砌??挾嚗?甇?Android 撠?鞈?" -ForegroundColor Cyan
Write-Host "甇??瑁? npx cap sync..."
npx cap sync

if ($LASTEXITCODE -ne 0) {
    Write-Error "npx cap sync 憭望?嚗?
    exit 1
}

Write-Host "??Android 鞈??郊??嚗? -ForegroundColor Green
Write-Host ""

Write-Host "?? ??啣???摰嚗?臭誑???脰??鈭? -ForegroundColor Magenta