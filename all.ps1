Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "   開始執行全平台編譯 (APK + Windows)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

Write-Host ">>> 第一階段：編譯 Android APK" -ForegroundColor Magenta
Write-Host "開始編譯前端 Vue 專案..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Frontend Build Failed!"; exit 1 }

Write-Host "同步資源到 Android 專案..." -ForegroundColor Cyan
npx cap sync
if ($LASTEXITCODE -ne 0) { Write-Error "Capacitor Sync Failed!"; exit 1 }

Write-Host "開始使用 Gradle 打包 APK (Debug版)..." -ForegroundColor Cyan
cd android
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.6.7-hotspot"
.\gradlew assembleDebug
if ($LASTEXITCODE -ne 0) { Write-Error "Gradle Build Failed!"; exit 1 }
cd ..

Write-Host "複製 APK 檔案..." -ForegroundColor Cyan
$apkPath = "android\app\build\outputs\apk\debug\app-debug.apk"
$destPath = "avd_apk.apk"

if (Test-Path $apkPath) {
    Copy-Item -Path $apkPath -Destination $destPath -Force
    Write-Host "打包成功！APK 已匯出至: $pwd\$destPath" -ForegroundColor Green
    
    Write-Host "嘗試安裝 APK 到連接的手機..." -ForegroundColor Cyan
    adb install -r $destPath
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "自動安裝失敗！請確認手機已接上傳輸線、開啟 USB 偵錯，且允許電腦連線。"
    } else {
        Write-Host "安裝成功！你現在可以打開手機查看 App 了。" -ForegroundColor Green
    }
} else {
    Write-Error "找不到編譯出的 APK 檔案。"
}

Write-Host ""
Write-Host ">>> 第二階段：編譯 Windows MSI" -ForegroundColor Magenta
$cargoPath = Join-Path $env:USERPROFILE ".cargo\bin"
if ($env:PATH -notmatch [regex]::Escape($cargoPath)) {
    $env:PATH = "$cargoPath;$env:PATH"
}

Write-Host "開始編譯 Windows 版 (Tauri)..." -ForegroundColor Cyan
npm run tauri:build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Windows 打包失敗！"
    exit 1
}

Write-Host "複製安裝檔..." -ForegroundColor Cyan
$installer = Get-ChildItem -Path "src-tauri\target\release\bundle\msi\*.msi" | Select-Object -First 1
if ($installer) {
    Copy-Item -Path $installer.FullName -Destination "avd_win.msi" -Force
    Write-Host "打包成功！安裝檔已匯出至: $pwd\avd_win.msi" -ForegroundColor Green
} else {
    Write-Warning "找不到 MSI 安裝檔"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "   🎉 全平台任務順利完成！" -ForegroundColor Magenta
Write-Host "   APK: $pwd\avd_apk.apk" -ForegroundColor Green
Write-Host "   WIN: $pwd\avd_win.msi" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Magenta

Write-Host ""
Write-Host "🚀 正在為您全自動安裝最新的 Windows 版本..." -ForegroundColor Cyan
Start-Process msiexec.exe -ArgumentList "/i `"$pwd\avd_win.msi`" /passive" -Wait
if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 1641 -or $LASTEXITCODE -eq 3010) {
    Write-Host "✅ 電腦版自動安裝成功！正在為您開啟新版程式..." -ForegroundColor Green
    $appPath = Join-Path $env:LOCALAPPDATA "AVD\app.exe"
    if (Test-Path $appPath) {
        Start-Process $appPath
    }
} else {
    Write-Warning "自動安裝可能未完全成功，您可以手動雙擊 avd_win.msi 進行安裝。"
}
