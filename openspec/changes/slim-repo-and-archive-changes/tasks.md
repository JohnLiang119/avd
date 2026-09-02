## 1. 階段 A：本機垃圾清理（低風險，無版控影響）

- [x] 1.1 以雜湊比對驗證 `src-tauri/bin/` 中 gnu 與 msvc 副本內容是否相同，記錄比對結果；若有差異則暫停並回報
  - 比對結果（SHA256 前 16 碼）：`ffmpeg` 兩份皆為 `90B69CA440CBA4B6`、`rclone` 兩份皆為 `505AC2B0B6112428`、`yt-dlp` 兩份皆為 `652E154BCE717007`。三組 gnu 與 msvc 副本位元組完全相同，確認為複製品，可安全刪除 gnu 副本。
- [x] 1.2 刪除 `src-tauri/bin/` 內的測試媒體檔（`*.mp4`）與 `test_output_123.info.json`
  - 已刪除測試 mp4 與 `test_output_123.info.json`，釋出 18.35 MB。兩者原本即未被 git 追蹤。
  - 注意：mp4 檔名含 `[...]`，PowerShell `Remove-Item -Path` 會將中括號視為萬用字元而不刪除，必須使用 `-LiteralPath`。
- [x] 1.3 刪除 `src-tauri/bin/` 內的 `*.exe.old` 備份殘留檔
  - 兩個 `.old` 檔原為 git 追蹤中，已用 `git rm` 同時移出工作區與索引，釋出 34.76 MB。
- [x] 1.4 刪除根目錄 `AVD_1.0.26` ~ `AVD_1.0.60` 共 33 個歷史安裝包，僅保留當前版本 MSI 與 APK
  - 實際數量修正：原估 37 個有誤，實為 34 個 MSI + 1 個 APK，扣除當前版本後刪除 33 個，釋出 2107.88 MB。
  - **查證推翻 design 假設**：GitHub Releases 最舊僅到 v1.0.45，1.0.26 ~ 1.0.44 共 17 個 MSI（1094 MB）遠端並無備份。經使用者裁示接受永久遺失後全數刪除。
- [x] 1.5 刪除 `rclone_temp/` 目錄
  - 刪除前查證：`rclone_temp/` 與 `src-tauri/bin/` 的 rclone 同為 v1.67.0，前者為未壓縮來源（58.41 MB），後者為 UPX 壓縮產物（16.32 MB），確認重複。原為 git 追蹤中，已用 `git rm -r` 移除，釋出 65.86 MB。
- [x] 1.6 補強 `.gitignore`：新增 `*.old`、`src-tauri/bin/*.mp4`、`rclone_temp/`、`upx.exe`、`rclone.zip` 規則
  - `src-tauri/bin/*.mp4` 原已存在，本次新增 `rclone.zip`、`rclone_temp/`、`upx.exe`、`*.old` 四條規則。
  - ignore 規則對已追蹤檔案無效，故一併對 `rclone.zip` 與 `upx.exe` 執行 `git rm --cached`（保留本機檔案），並以 `git check-ignore -v` 驗證規則生效。
  - 查證 `upx.exe` 移出版控的影響：`all.ps1:212-223` 對其缺失有優雅降級（僅警告並略過壓縮步驟），且版控中的 sidecar 已是 UPX 壓縮產物（rclone 58.41 MB → 16.32 MB），全新 clone 不會產出更大的 MSI，建置不受影響。
- [x] 1.7 執行 `git status` 確認無非預期的未追蹤檔案，並記錄階段 A 釋出的磁碟空間
  - 階段 A 釋出合計約 2.23 GB（安裝包 2107.88 + rclone_temp 65.86 + 測試檔 18.35 + `.old` 34.76 MB），專案總佔用 6.3 GB → 4.39 GB。
  - `git status` 僅顯示本變更預期的刪除項與 `.gitignore` 修改，無非預期未追蹤檔案。
  - 附帶發現：`openspec/changes/channel-track-by-publish-time/` 有三個檔案存在**本變更以外的未提交修改**（進行中變更的既有編輯），本次不予處理，提交時須注意分開。

## 2. 階段 A 驗證：建置腳本仍可運作

- [x] 2.1 刪除 `src-tauri/bin/` 中的三個 `*-gnu.exe` 副本（依 1.1 驗證結果）
  - 三個 gnu 副本原為 git 追蹤中，已用 `git rm` 移除，釋出 58.62 MB。`src-tauri/bin/` 現僅存三個 msvc 副本。
- [x] 2.2 檢視 `all.ps1` 的 host-triple 補齊邏輯，補上「完全找不到某 sidecar 時顯示明確錯誤訊息並中止」的處理
  - 原邏輯在找不到任何副本時靜默跳過，會產生缺少 sidecar 的安裝包。改為將缺少的工具收集至 `$missingBinaries`，於 `try/catch` 區塊外統一檢查，列出工具名稱與應放置的完整路徑後 `exit 1`。
  - 變數 `$binDir`、`$binaries`、`$rustcHost` 提升至 `try` 區塊外宣告，供後續缺檔檢查與 UPX 段落共用。
- [x] 2.3 檢視 `all.ps1` 的 UPX 壓縮段落，調整為僅處理當前 host triple 所需副本，避免重複壓縮
  - 原以 `Get-ChildItem -Include "ffmpeg-*.exe", "rclone-*.exe"` 萬用字元比對，會對同一工具的多個平台副本重複壓縮。改為依 `$rustcHost` 直接組出單一檔名取用；若 host 偵測失敗則退回取第一個副本，確保每個工具至多壓縮一次。
  - 驗證：以擷取出的段落在暫存目錄執行三個規格情境，結果皆符合 — 情境 A（僅 msvc 副本）不複製且 exit 0；情境 B（僅 gnu 命名）三個工具皆自動複製為 msvc 檔名且 exit 0；情境 C（缺少 rclone）輸出「缺少工具「rclone」，請將執行檔放置於: src-tauri\bin\rclone-x86_64-pc-windows-msvc.exe」並 exit 1。
  - `all.ps1` 已確認維持 UTF-8 with BOM，且通過 PowerShell 語法解析檢查。
- [x] 2.4 執行完整 Tauri 建置，確認 MSI 產出成功且內含三個 sidecar
  - `npm run tauri:build` 以 exit 0 完成（release profile 52.59s），產出 `AVD_1.0.61_x64_zh-TW.msi`，63.26 MB — 與移除 gnu 副本前的同版本 MSI 尺寸一致，確認刪除重複副本對產出無影響。
  - 以 WindowsInstaller COM 查詢 MSI 的 File 資料表，內含 4 個檔案，其中 `yt-dlp.exe`、`ffmpeg.exe`、`rclone.exe` 三個 sidecar 皆齊備。
- [ ] 2.5 安裝產出的 MSI 並實測一次下載，確認 yt-dlp / ffmpeg / rclone 皆正常運作

## 3. 階段 B：OpenSpec 變更歸檔與規格回填

- [x] 3.1 依變更的時間先後排序 14 個待歸檔變更，產出歸檔執行順序清單
  - 以 `git log -1 --format=%cI -- <變更目錄>` 取得各變更最後提交時間並排序。實際時間序與提案時的推測順序不同，3.2 ~ 3.15 已依實測結果重排。
- [x] 3.2 歸檔 `no-auto-run-all-ps1`（2026-08-13），檢視 `git diff openspec/specs/` 確認合併正確
  - 歸檔為 `2026-09-02-no-auto-run-all-ps1`，新建能力 `agent-rules`（+1 requirement）。
  - **此規格對本變更後續任務有約束**：`agent-rules` 明訂 Agent MUST NOT 自動執行 `all.ps1`。任務 2.4 已改用 `npm run tauri:build` 符合規範；任務 6.4 的發布流程實測須改由使用者手動執行。
### 3.A 既有主規格結構修復（實作中發現的既有缺陷，非原規劃範圍）

- [x] 3.A.1 修復 6 個主規格缺少 `## Requirements` 區段標頭的問題
  - 發現 `openspec/specs/` 7 個主規格中有 6 個（`auto-retry-clean-build`、`auto-update`、`channel-auto-monitor`、`channel-ui-layout`、`release-automation`、`youtube-download`）缺少 `## Requirements` 標頭，導致其下共 14 條已交付需求對 openspec 工具完全不可見（validate / list / archive 皆讀不到），且會使 archive 直接中止。
  - 已於各檔第一條 `### Requirement:` 前插入 `## Requirements` 標頭，並一併補上專案規範要求的 UTF-8 BOM。`git diff` 確認需求內容一字未改。
- [x] 3.A.2 依問題 1 選定的慣例，將 6 個主規格中 14 條缺少 `MUST`/`SHALL` 的需求改寫為「MUST（必須）」形式
  - 以指令碼僅針對每條需求「標題到第一個 `#### Scenario:` 之前」的描述句替換首次出現的「必須」，不影響情境內文。合計改寫 14 條：`auto-retry-clean-build` 2、`auto-update` 1、`channel-auto-monitor` 3、`channel-ui-layout` 2、`release-automation` 3、`youtube-download` 3。
- [x] 3.A.3 補寫 `auto-update`（25 字）與 `channel-auto-monitor`（46 字）過短的 `## Purpose`，達到 50 字門檻
  - `auto-update` 25 → 116 字、`channel-auto-monitor` 46 → 125 字。
  - 額外發現並修復兩處 `TBD - ... Update Purpose after archive.` 佔位符：`channel-backup-restore`（本次歸檔產生，其 delta 未帶 `## Purpose`）與 `windows-native-http-fetch`（先前歸檔遺留），皆已補寫實質內容。

### 3.B 逐一歸檔

- [ ] 3.3 歸檔 `startup-auto-update-check`（2026-08-15），檢視合併 diff（預期併入 `auto-update`）
  - 已修正其 delta：5 處中文「必須」改為「MUST（必須）」；並依問題 3 裁示移除與主規格撞名的 `更新內容展示與使用者同意`（主規格版本較完整，含「阻止彈窗關閉、持續展示進度」細節），delta 保留其餘 4 條 ADDED。
- [x] 3.4 歸檔 `prompt-channel-tracking`（2026-08-16），檢視合併 diff（預期併入 `channel-auto-monitor`）
  - delta 的 MODIFIED 需求含 3 處中文「必須」，依慣例改寫後歸檔。`channel-auto-monitor` ~1 modified。
- [x] 3.5 歸檔 `filter-live-streams`（2026-08-16），檢視合併 diff（預期併入 `youtube-download`）
  - 實際新建能力 `auto-check-filtering`（+1），非預期的併入 `youtube-download`。
- [x] 3.6 歸檔 `reduce-app-size`（2026-08-16），檢視合併 diff
  - 該變更 `.openspec.yaml` 宣告 `skip_specs: true`，無 spec 更新，僅移入 archive。
- [x] 3.7 歸檔 `channel-backup-restore`（2026-08-17），檢視合併 diff
  - 新建能力 `channel-backup-restore`（+2）。其 delta 未帶 `## Purpose`，主規格產生 TBD 佔位符，已於 3.A.3 補寫。
- [x] 3.8 歸檔 `refine-channel-add-prompt`（2026-08-17），檢視合併 diff
  - 依問題 2 裁示，將原本的英文編號需求清單（`specs/refine-channel-add-prompt/spec.md`，無任何 delta 標頭）重寫為 `specs/channel-auto-monitor/spec.md` 的 ADDED delta：新增需求「輸入頻道網址時的追蹤與掃描兩段確認」含 4 個情境（未追蹤頻道、已追蹤頻道、確認掃描、略過掃描），語意完整保留。`channel-auto-monitor` +1。
- [x] 3.9 歸檔 `add-capacitor-share`（2026-08-17），檢視合併 diff
  - 新建能力 `capacitor-share-export`（+1）。
- [x] 3.10 歸檔 `yt-dlp-auto-update`（2026-08-19），檢視合併 diff
  - 新建能力 `yt-dlp-auto-update`（+2）。
- [x] 3.11 歸檔 `settings-ui-compact`（2026-08-19），檢視合併 diff
  - 宣告 `skip_specs`，無 spec 更新。
- [x] 3.12 歸檔 `fix-channel-check-feedback`（2026-08-19），檢視合併 diff
  - 新建能力 `channel-check-feedback`（+1）。
- [x] 3.13 歸檔 `yt-dlp-rss-fallback`（2026-08-25），檢視合併 diff
  - 新建能力 `yt-dlp-rss-fallback`（+1）。
- [x] 3.14 歸檔 `update-windows-layout`（2026-08-25），檢視合併 diff
  - 宣告 `skip_specs`，無 spec 更新。
- [x] 3.15 歸檔 `optional-ytdlp-fallback`（2026-08-26），檢視合併 diff
  - 首次歸檔被工具擋下：MODIFIED 區塊將情境更名為「Auto and manual checking via official RSS」，導致主規格既有情境「Auto and manual checking」會被丟棄（即 design.md 預警的 MODIFIED 陷阱）。判定兩者為同一情境的精修版（以發布時間錨點取代 `lastCheckTime`），故保留 delta 的精修內容並沿用原情境名稱，不丟失任何情境。`channel-auto-monitor` +1 ~1。
- [x] 3.16 確認 `openspec/changes/` 僅剩 `channel-track-by-publish-time` 與本變更
  - 已確認，14 個變更全數移入 `openspec/changes/archive/`，以 `2026-09-02-` 為前綴。
- [x] 3.17 執行 `openspec validate --strict`，修正所有回報問題
  - `openspec validate --all --strict` 結果：**16 passed, 0 failed**（14 個主規格 + 2 個進行中變更）。
- [x] 3.18 人工通讀 `openspec/specs/` 各主規格，確認無 MODIFIED 覆蓋造成的內容遺失、無 `TBD` 佔位殘留
  - 檢查項目：`TBD` 佔位殘留（發現 2 處並修復）、重複 Requirement 名稱（無）、無 Scenario 的空需求（無）。
  - 規格庫成果：能力數 7 → **14**，需求數 14 → **30**，且原本 14 條因缺少 `## Requirements` 標頭而對工具不可見的需求已全部可正常解析。

## 4. 階段 C 前置：備份與盤點

- [ ] 4.1 將整個專案目錄（含 `.git`）完整複製為 `avd_backup_<日期>`，並驗證備份可正常 `git log`
- [ ] 4.2 執行 `pip install git-filter-repo` 並確認 `git filter-repo --version` 可用
- [ ] 4.3 記錄現有全部 tag 與其對應 commit SHA 至暫存清單，供重寫後修復指向
- [ ] 4.4 記錄重寫前的 `.git` 體積與 commit 數（207 MB / 78 commits）作為對照基準
- [ ] 4.5 確認工作目錄無未提交變更（先提交階段 A 與階段 B 的成果）

## 5. 階段 C：Git 歷史重寫（不可逆）

- [ ] 5.1 執行 `git filter-repo --invert-paths`，清除 `src-tauri/bin/`、`rclone.zip`、`upx.exe`、`rclone_temp/` 的全部歷史版本
- [ ] 5.2 重新設定 `origin` remote（`git filter-repo` 會主動移除遠端設定）
- [ ] 5.3 將備份中的三個 msvc sidecar 複製回 `src-tauri/bin/`，以單一新 commit 提交
- [ ] 5.4 驗證 `.git` 體積已降至約 70 MB（執行 `git gc --aggressive --prune=now` 後量測）
- [ ] 5.5 在重寫後的工作目錄執行完整建置，確認 MSI 產出成功
- [ ] 5.6 執行 `git push --force origin main`
- [ ] 5.7 修復所有 tag 指向新的 commit SHA 並推送
- [ ] 5.8 開啟 GitHub Releases 頁面，逐一確認既有版本的下載連結仍可正常下載

## 6. 階段 C 後置：發布腳本保留策略

- [ ] 6.1 於 `release_avd.ps1` 新增「上傳成功後清理舊版本本機安裝包」邏輯，並輸出清理數量與釋出空間
- [ ] 6.2 於 `release_avd.ps1` 新增保留參數（如 `-KeepOldPackages`），啟用時跳過清理並說明原因
- [ ] 6.3 確認上傳失敗路徑不會觸發任何本機安裝包刪除
- [ ] 6.4 以測試版號實際執行一次發布流程，驗證清理與保留兩種行為皆符合規格

## 7. 收尾驗證

- [ ] 7.1 於全新目錄 `git clone` 遠端倉庫，確認 clone 體積符合預期
- [ ] 7.2 在該全新 clone 執行 `npm install` 與完整建置，確認離線 sidecar 齊備且建置成功
- [ ] 7.3 記錄最終成果對照表（`.git` 體積、專案總佔用、`openspec/changes/` 數量）並更新 `README.md` 的開發環境說明（若有變動）
- [ ] 7.4 確認離線備份 `avd_backup_<日期>` 完整保留，標註可刪除日期（30 天後）
