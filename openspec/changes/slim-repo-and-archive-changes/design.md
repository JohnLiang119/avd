## Context

現況實測數據（見 proposal.md - Why 說明動機）：

```
.git                    207 MB      追蹤中二進位檔歷史 blob 約 141 MB
node_modules            153 MB      已 gitignore
src-tauri/target        2.8 GB      已 gitignore
android/app/build       470 MB      已 gitignore
rclone_temp              66 MB      未 gitignore、與 rclone.zip 重複
根目錄 MSI × 37                      已 gitignore，僅佔本機空間
────────────────────────────────
專案總計                6.3 GB
```

倉庫條件對重寫歷史相當有利：單一遠端 `origin`（`JohnLiang119/avd`）、單一分支 `main`、僅 78 個 commit、單人開發無其他協作者 clone。

既有機制：`all.ps1:194-201` 已具備「掃描 `src-tauri/bin/` 中任一 `$bin-*.exe`，複製為當前 host triple 命名」的邏輯，因此刪除 gnu 副本後建置仍可運作。`rustc -vV` 顯示 host 為 `x86_64-pc-windows-msvc`，與保留的副本一致。

工具現況：`git filter-repo` 尚未安裝，但環境有 Python 3.11.15，可透過 `pip install git-filter-repo` 取得。

## Goals / Non-Goals

**Goals:**

- 一次性清除 Git 歷史中的二進位 blob，讓 `.git` 回到合理量級並停止未來增長。
- 讓 `openspec/specs/` 成為系統已交付能力的可信單一來源。
- 保持離線可建置：不引入任何建置期網路下載相依。

**Non-Goals:**

- 不觸碰 `src/`、`src-tauri/src/`、`android/` 任何應用程式原始碼，本變更對執行期行為零影響。
- 不處理 `node_modules`、`src-tauri/target`、`android/app/build` 等已 gitignore 的建置快取（可隨時重建，非本變更責任）。
- 不引入 Git LFS。
- 不重構 `App.vue`（另案處理）。

## Decisions

### 決策 1：以 `git filter-repo` 重寫歷史，而非 `git rm --cached`

`git rm --cached` 只能停止未來追蹤，歷史中的 141 MB blob 永遠留存，`.git` 仍維持 207 MB，等於問題只被凍結而非解決。

選用 `git filter-repo`（官方推薦、取代已棄用的 `filter-branch`）以 `--invert-paths` 清除指定路徑的全部歷史版本。

**替代方案 BFG Repo-Cleaner**：需要 JVM 相依，且本專案已有 Python 環境，`git filter-repo` 相依較輕。

**代價**：78 個 commit 的 SHA 全部改變，需 `--force` 推送。因單人單分支，此代價可接受。

### 決策 2：清空歷史後，以全新 commit 重新提交 msvc sidecar

此處存在一個張力：「重寫歷史徹底瘦身」與「版控保留 msvc 一份」方向相反——若保留追蹤，當前 blob 仍會進入新歷史。

採取的折衷是：`filter-repo` 移除 `src-tauri/bin/` 的**全部歷史版本**（包含所有已淘汰的 yt-dlp 舊版與 gnu 副本），再以單一新 commit 提交當前 msvc 三件套。歷史中每個工具僅存在一份 blob。

```
清理前歷史                      清理後歷史
  yt-dlp v1 (17M)                 (無)
  yt-dlp v2 (17M)                  ↓
  yt-dlp v3 (17M)          單一新 commit
  yt-dlp-gnu × 3 (51M)       yt-dlp-msvc  17M
  ffmpeg × 2 (52M)           ffmpeg-msvc  26M
  rclone × 2 (34M)           rclone-msvc  17M
  rclone.zip (21M)          ────────────────
  upx.exe (0.5M)             .git ≈ 70 MB
────────────────
  .git = 207 MB
```

**預期結果**：207 MB → 約 70 MB（非 20 MB，因當前 sidecar 仍受追蹤）。

**未來增長的緩解**：`yt-dlp` 已具備執行期自我更新能力（`DownloadService.updateYtDlp`），版控中的副本僅作為初始種子，不需隨上游頻繁 bump；`ffmpeg` 與 `rclone` 更新頻率低。約定為每次 sidecar 版本升級改以 `--amend` 或定期再次 filter-repo，避免逐版堆疊。

### 決策 3：刪除 gnu 副本而非保留雙平台

`ffmpeg-*-gnu.exe` 與 `ffmpeg-*-msvc.exe` 兩份檔案大小與時間戳完全一致，`rclone` 與 `yt-dlp` 亦然，實為同一檔案的複製品而非針對不同 ABI 編譯的產物。保留兩份無任何技術效益，且 `all.ps1` 的 host-triple 補齊邏輯已能從單一副本衍生所需檔名。

**驗證前提**：實作時須先以雜湊比對確認 gnu 與 msvc 副本內容確實相同，若不同則保留 msvc 並記錄差異原因。

### 決策 4：14 個變更逐一歸檔，不批次腳本化

`openspec archive` 會將 spec delta 合併進主規格；14 個變更涉及重疊的能力（例如 4 個頻道相關變更都會寫入 `channel-auto-monitor`），批次執行會讓合併衝突難以定位。

改為逐一執行並在每個變更後檢視主規格 diff，確保 MODIFIED 區塊沒有覆蓋掉先前變更貢獻的內容。歸檔順序依變更的時間先後，讓後續變更的修改疊加在前者之上。

### 決策 5：新增的 `repo-artifact-hygiene` 能力涵蓋建置腳本行為

版控資產邊界與 sidecar 補齊看似純工具議題，但兩者都有可驗證的外部行為（稽核結果、建置成敗），因此以正式能力入規格，而非僅寫在 design 中。`all.ps1` 既有邏輯即為此規格的現有實作，本變更主要補上規格覆蓋與缺檔錯誤處理。

## Risks / Trade-offs

**[歷史重寫不可逆，操作失誤將永久遺失 commit]** → 執行 `filter-repo` 前，先將整個專案目錄（含 `.git`）完整複製為 `avd_backup_<日期>` 離線備份；確認新歷史的檔案樹與 `HEAD` 內容正確、且應用程式可成功建置後，才執行 force push；備份保留至少 30 天再刪除。

**[force push 後，任何既存的本機 clone 或 CI 快取將無法 fast-forward]** → 已確認僅單人單機開發、無 CI 拉取歷史。若日後發現其他 clone，一律重新 clone 而非嘗試 rebase。

**[GitHub Releases 的既有資產是否受影響]** → Releases 資產獨立於 Git 物件儲存，不受歷史重寫影響；但 Release 綁定的 tag 若指向被重寫的 commit 會失效。實作時須先列出所有既有 tag，force push 後重新指向對應的新 SHA，或確認 Release 頁面的下載連結仍正常。

**[刪除 gnu 副本後，若未來需在 MinGW 工具鏈建置將缺檔]** → `all.ps1` 的補齊邏輯會自動從 msvc 副本複製為 gnu 命名，實際仍可運作；且本專案並無 MinGW 建置需求。

**[歸檔 14 個變更時，spec 合併可能靜默遺失內容]** → 每次 `openspec archive` 後執行 `git diff openspec/specs/` 檢視，並在全部歸檔後執行 `openspec validate --strict` 與人工通讀 7 個主規格。

**[清理歷史 MSI 後無法回退到舊版本測試]** → ~~所有版本的 MSI 皆已上傳至 GitHub Releases，需要時可從 Releases 頁面重新下載，本機保留無實質價值。~~

> **實作時查證後修正（此假設不成立）**：GitHub Releases 最舊版本僅到 `v1.0.45`（共 17 個 Release），本機的 `1.0.26` ~ `1.0.44` 共 17 個 MSI 遠端並無任何備份，刪除即永久遺失。實際安裝包數量亦修正為 34 個 MSI + 1 個 APK（原估 37 個 MSI 有誤）。
>
> 經使用者裁示，接受 `1.0.26` ~ `1.0.44` 永久遺失（該區間為未正式發布的開發中建置），全數刪除 33 個非當前版本安裝包。`1.0.45` 以後的版本仍可自 Releases 重新下載，回退測試能力不受影響。

## Migration Plan

分三階段，每階段結束都是可安全停下的檢查點：

```
階段 A：低風險清理（無版控影響）
  ├─ 刪除 src-tauri/bin/ 測試 mp4、*.exe.old、test_output_123.info.json
  ├─ 刪除根目錄 1.0.26 ~ 1.0.60 共 37 個 MSI
  ├─ 刪除 rclone_temp/
  └─ 補強 .gitignore
        ↓ 檢查點：git status 乾淨、all.ps1 建置成功

階段 B：OpenSpec 歸檔（無檔案風險，可 git revert）
  ├─ 逐一 openspec archive × 14（每次檢視 specs/ diff）
  └─ openspec validate --strict
        ↓ 檢查點：changes/ 僅剩 channel-track-by-publish-time

階段 C：Git 歷史重寫（不可逆）
  ├─ 完整備份專案目錄
  ├─ pip install git-filter-repo
  ├─ 記錄現有 tag 清單與對應 commit
  ├─ git filter-repo --invert-paths（清除二進位路徑）
  ├─ 重新加入 origin remote（filter-repo 會移除）
  ├─ 重新提交 msvc sidecar 三件套
  ├─ 本機驗證：建置成功、.git 體積達標
  ├─ git push --force origin main
  └─ 修復 tag 指向並驗證 Releases 下載連結
        ↓ 檢查點：GitHub 頁面正常、重新 clone 可建置
```

**回退策略**：階段 A、B 可透過 `git revert` 或自備份復原。階段 C 一旦 force push 即不可逆，唯一回退途徑是從離線備份還原 `.git` 後再次 force push——這也是備份必須在階段 C 開始前完成的原因。
