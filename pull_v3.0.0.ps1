# Git 更新至 v3.0.0 腳本 (PowerShell)

Write-Host "開始拉取遠端最新程式碼 (v3.0.0)..." -ForegroundColor Cyan

# 清理可能的 git index 鎖定檔案
if (Test-Path "$pwd\.git\index.lock") {
    Remove-Item "$pwd\.git\index.lock" -Force -ErrorAction SilentlyContinue
}

# 檢查本地是否已經有初始 Commit (HEAD)
$hasHead = git rev-parse --verify HEAD 2>$null

$stashed = $false
if ($hasHead) {
    # 只有在有 HEAD 時才檢查並暫存變更
    $status = git status --porcelain
    if ($status) {
        Write-Host "檢測到本地有未提交的變更，正進行暫存 (git stash)..." -ForegroundColor Yellow
        git stash
        $stashed = $true
    }
} else {
    Write-Host "提示：目前本地為全新倉庫（尚無 Commit）。" -ForegroundColor Yellow
}

# 從遠端抓取最新標籤與分支
Write-Host "正在從遠端 (origin) 抓取最新程式碼與標籤..." -ForegroundColor Cyan
git fetch origin --tags

# 切換並更新至 main 分支
Write-Host "同步至遠端 main 分支..." -ForegroundColor Green
$localMain = git branch --list main
if ($localMain) {
    git checkout main
    git reset --hard origin/main
} else {
    git checkout -b main origin/main
}

# 如果有暫存的修改，將其還原
if ($stashed) {
    Write-Host "正在還原先前的本地變更 (git stash pop)..." -ForegroundColor Yellow
    git stash pop
}

Write-Host "完成！目前本地最新 Commit 紀錄：" -ForegroundColor Green
git log -n 1 --oneline
