[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [switch]$Clean
)

Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "   開始執行全平台編譯 (APK + Windows)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "[階段一] 編譯 Android APK" -ForegroundColor Magenta
Write-Host "開始編譯前端 Vue 專案..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Frontend Build Failed!"; exit 1 }

Write-Host "同步資源到 Android 專案..." -ForegroundColor Cyan
npx cap sync
if ($LASTEXITCODE -ne 0) { Write-Error "Capacitor Sync Failed!"; exit 1 }

Write-Host "開始使用 Gradle 打包 APK (Debug版)..." -ForegroundColor Cyan
cd android
# 全自動動態檢測並設定有效的 JAVA_HOME (適用於任何電腦)
$jdkPath = $env:JAVA_HOME
if (-not ($jdkPath -and (Test-Path "$jdkPath\bin\javac.exe"))) {
    # 1. 嘗試從系統 PATH 中的 javac.exe 指令位置反推
    $javacCmd = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($javacCmd) {
        $possibleJdk = Split-Path -Parent (Split-Path -Parent $javacCmd.Source)
        if (Test-Path "$possibleJdk\bin\javac.exe") {
            $jdkPath = $possibleJdk
        }
    }
    
    # 2. 若 PATH 無 javac，則動態掃描常見 JDK / JBR 安裝根目錄
    if (-not $jdkPath) {
        $searchRoots = @(
            "C:\Program Files\Java",
            "C:\Program Files\Microsoft",
            "C:\Program Files\Eclipse Adoptium",
            "C:\Program Files\Amazon Corretto",
            "C:\Program Files\Zulu",
            "C:\Program Files\Android\Android Studio\jbr",
            "$env:LOCALAPPDATA\Programs\Java"
        )
        foreach ($root in $searchRoots) {
            if (Test-Path "$root\bin\javac.exe") {
                $jdkPath = $root
                break
            }
            if (Test-Path $root) {
                $foundDir = Get-ChildItem -Path $root -ErrorAction SilentlyContinue | Where-Object { Test-Path "$($_.FullName)\bin\javac.exe" } | Select-Object -First 1 -ExpandProperty FullName
                if ($foundDir) {
                    $jdkPath = $foundDir
                    break
                }
            }
        }
    }
}

if ($jdkPath -and (Test-Path "$jdkPath\bin\javac.exe")) {
    $env:JAVA_HOME = $jdkPath
    Write-Host "使用 JDK: $env:JAVA_HOME" -ForegroundColor Green
} else {
    Write-Warning "未找到有效的 JDK，將嘗試使用預設環境變數。"
}
# 自動檢測並設定有效的 ANDROID_HOME (Android SDK)
$sdkPath = $env:ANDROID_HOME
if (-not ($sdkPath -and (Test-Path $sdkPath))) {
    $sdkCandidates = @(
        "C:\Android\Sdk",
        "$env:LOCALAPPDATA\Android\Sdk"
    )
    foreach ($cand in $sdkCandidates) {
        if ($cand -and (Test-Path $cand)) {
            $sdkPath = $cand
            break
        }
    }
}

if ($sdkPath -and (Test-Path $sdkPath)) {
    $env:ANDROID_HOME = $sdkPath
    $env:ANDROID_SDK_ROOT = $sdkPath
    Write-Host "使用 Android SDK: $env:ANDROID_HOME" -ForegroundColor Green
    
    # 確保 local.properties 存在且設定正確 sdk.dir
    $localPropsPath = "local.properties"
    $escapedSdk = $sdkPath.Replace('\', '/')
    "sdk.dir=$escapedSdk" | Out-File -FilePath $localPropsPath -Encoding utf8 -Force

    # 將 platform-tools 加入 PATH，確保 adb 指令可用
    $platformTools = Join-Path $sdkPath "platform-tools"
    if ((Test-Path $platformTools) -and ($env:PATH -notmatch [regex]::Escape($platformTools))) {
        $env:PATH = "$platformTools;$env:PATH"
    }
} else {
    Write-Warning "未找到有效的 Android SDK 路徑。"
}

.\gradlew assembleDebug
if ($LASTEXITCODE -ne 0) { Write-Error "Gradle Build Failed!"; exit 1 }
cd ..

Write-Host "複製 APK 檔案..." -ForegroundColor Cyan
$apkPath = "android\app\build\outputs\apk\debug\app-debug.apk"
$appVersion = "1.0.0"
try {
    if (Test-Path "package.json") {
        $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
        if ($pkg.version) { $appVersion = $pkg.version }
    }
} catch {}
$destApkName = "AVD_${appVersion}.apk"

if (Test-Path $apkPath) {
    Copy-Item -Path $apkPath -Destination $destApkName -Force
    Write-Host "打包成功！APK 已匯出至: $pwd\$destApkName" -ForegroundColor Green
    
    Write-Host "嘗試安裝 APK 到連接的手機..." -ForegroundColor Cyan
    $installOutput = adb install -r $destApkName 2>&1
    Write-Host ($installOutput -join "`n")
    if ($LASTEXITCODE -ne 0) {
        if ("$installOutput" -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
            Write-Warning "偵測到手機上已有不同簽名之舊版 AVD，正在嘗試卸載舊版並重新安裝..."
            adb uninstall com.mattpocock.avd
            adb install -r $destApkName
            if ($LASTEXITCODE -eq 0) {
                Write-Host "安裝成功！你現在可以打開手機查看 App 了。" -ForegroundColor Green
            } else {
                Write-Warning "重新安裝失敗！請手動在手機上將舊版 AVD App 解除安裝後重試。"
            }
        } else {
            Write-Warning "自動安裝失敗！請確認手機螢幕是否跳出「允許 USB 安裝」對話框，或確認已開啟 USB 偵錯。"
        }
    } else {
        Write-Host "安裝成功！你現在可以打開手機查看 App 了。" -ForegroundColor Green
    }
} else {
    Write-Error "找不到編譯出的 APK 檔案。"
}

Write-Host ""
Write-Host "[階段二] 編譯 Windows MSI" -ForegroundColor Magenta
$cargoPath = Join-Path $env:USERPROFILE ".cargo\bin"
if ($env:PATH -notmatch [regex]::Escape($cargoPath)) {
    $env:PATH = "$cargoPath;$env:PATH"
}

# 支援手動 -Clean 預先清理快取
if ($Clean -and (Test-Path "src-tauri\target")) {
    Write-Host ">>> 已指定 -Clean 參數，正在預先清理 Rust 快取目錄..." -ForegroundColor Yellow
    Remove-Item -Path "src-tauri\target" -Recurse -Force
}

# 自動檢測當前 Rust target triple 並確保 sidecar 二進制檔齊全
try {
    $rustcHost = (rustc -vV | Select-String "host:\s*(.+)$").Matches.Groups[1].Value.Trim()
    if ($rustcHost) {
        Write-Host "檢測到 Rust 編譯目標平台: $rustcHost" -ForegroundColor Cyan
        $binDir = "src-tauri\bin"
        $binaries = @("yt-dlp", "ffmpeg", "rclone")
        foreach ($bin in $binaries) {
            $targetFile = Join-Path $binDir "$bin-$rustcHost.exe"
            if (-not (Test-Path $targetFile)) {
                $sourceFile = Get-ChildItem -Path $binDir -Filter "$bin-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($sourceFile) {
                    Write-Host "為 $bin 複製適配二進制檔: $($sourceFile.Name) -> $(Split-Path $targetFile -Leaf)" -ForegroundColor Green
                    Copy-Item -Path $sourceFile.FullName -Destination $targetFile -Force
                }
            }
        }
    }
} catch {
    Write-Warning "自動檢測 Rust target 失敗，將使用現有二進制檔。"
}

Write-Host "開始編譯 Windows 版 (Tauri)..." -ForegroundColor Cyan
npm run tauri:build

# 智慧容錯救援機制：若首次打包失敗，自動清理 target 快取並重新嘗試全量打包
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

Write-Host "複製安裝檔..." -ForegroundColor Cyan
$installer = Get-ChildItem -Path "src-tauri\target\release\bundle\msi\*${appVersion}*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installer) {
    $installer = Get-ChildItem -Path "src-tauri\target\release\bundle\msi\*.msi" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
$destMsiName = $null
if ($installer) {
    $destMsiName = $installer.Name
    Copy-Item -Path $installer.FullName -Destination $destMsiName -Force
    Write-Host "打包成功！安裝檔已匯出至: $pwd\$destMsiName" -ForegroundColor Green
} else {
    Write-Warning "找不到 MSI 安裝檔"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "   🎉 全平台任務順利完成！" -ForegroundColor Magenta
if ($destApkName -and (Test-Path $destApkName)) {
    Write-Host "   APK: $pwd\$destApkName" -ForegroundColor Green
}
if ($destMsiName -and (Test-Path $destMsiName)) {
    Write-Host "   WIN: $pwd\$destMsiName" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Magenta

Write-Host ""
Write-Host "🚀 正在為您全自動安裝最新的 Windows 版本..." -ForegroundColor Cyan
if ($destMsiName -and (Test-Path $destMsiName)) {
    Start-Process msiexec.exe -ArgumentList "/i `"$pwd\$destMsiName`" /passive" -Wait
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 1641 -or $LASTEXITCODE -eq 3010) {
        Write-Host "✅ 電腦版自動安裝成功！正在為您開啟新版程式..." -ForegroundColor Green
        $appPath = Join-Path $env:LOCALAPPDATA "AVD\app.exe"
        if (Test-Path $appPath) {
            Start-Process $appPath
        }
    } else {
        Write-Warning "自動安裝可能未完全成功，您可以手動雙擊 $destMsiName 進行安裝。"
    }
}
